# Session Persistence, Polling, Delete, and Light Mode — Design

**Date:** 2026-05-11
**Status:** Approved (ready for implementation plan)

## Motivation

The DQ Accelerator UI has four related problems:

1. **Past stage views lose data.** Every stage view reads from a live `useSession` Temporal query. As the workflow advances, fields like `current_suggestion` and `current_preview` are overwritten, and once a workflow completes its retention expires entirely. Clicking back into Profiling or Rules after they've completed shows empty/partial state.
2. **Polling is wasteful.** `useSession` polls every 2s. On the home page, every visible session card mounts its own poller. On `/sessions/{id}`, polling continues even when the user is looking at a past stage or has the tab in the background.
3. **No way to delete sessions.** `useSessionList.removeSession` only edits localStorage. The workflow keeps running, `data/sessions/{id}/` and `output/sessions/{id}/` leak indefinitely.
4. **Dark-mode only.** Tailwind tokens are a dark palette; users want light mode.

## Goals

- Stage views render their full historical data even after the workflow advances or expires.
- Polling stops when there's nothing to poll for (hidden tab, viewing a past stage).
- Delete is a single user action that terminates the workflow and reclaims disk.
- Light mode is the default; no toggle.

## Non-goals

- Auth / multi-user. Single-user dev tool. Schema doesn't preclude adding `user_id` later.
- Soft delete / undelete. Hard delete only. `deleted_at` column kept nullable as a hedge but no UI for it.
- Backfill of in-flight or localStorage sessions. New sessions only after deploy.
- Real-time push (websockets / SSE for session state). SWR polling is sufficient.

## Architecture

Today: Temporal workflow memory is the only source of session state; UI fetches via `query`.

Change: add a durability layer on the FastAPI side. Temporal remains source of truth for the *active* stage; Postgres becomes source of truth for *completed* stages and for the session list.

```
Workflow ──(at stage exit)──► snapshot_stage activity ──► Postgres (dq_app schema)
                                                              ▲
FastAPI ──(read/list/delete)──────────────────────────────────┘
                                                              ▲
UI ──GET /sessions, GET /sessions/{id}, GET /sessions/{id}/stages/{stage}, DELETE /sessions/{id}
```

Key routing rule in the UI: when the user is viewing the active stage, render from `useSession` (live Temporal query). When viewing any past stage, render from `useStageSnapshot` (DB read, never refreshes). The stepper enforces this routing.

localStorage's `dq_sessions` list goes away. Home page hits `GET /sessions`.

## Data model

New schema `dq_app` in the existing Postgres container. Two tables. Managed via Alembic from the FastAPI service.

```sql
-- One row per upload. Mirrors what SessionCard needs without a workflow query.
CREATE TABLE dq_app.sessions (
    id              UUID PRIMARY KEY,            -- session_id == workflow_id
    filename        TEXT NOT NULL,
    file_ext        TEXT NOT NULL,               -- csv/parquet/json
    use_case        TEXT,
    target_column   TEXT,
    description     TEXT,
    stage           TEXT NOT NULL,               -- last known WorkflowStage
    current_score   DOUBLE PRECISION,
    baseline_score  DOUBLE PRECISION,
    output_dir      TEXT,                        -- set when GENERATING completes
    zip_path        TEXT,                        -- set when GENERATING completes
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ                  -- NULL = active
);
CREATE INDEX ix_sessions_active ON dq_app.sessions (created_at DESC) WHERE deleted_at IS NULL;

-- One row per (session, stage) completion. Holds the exact JSON the UI needs.
CREATE TABLE dq_app.stage_snapshots (
    session_id   UUID NOT NULL REFERENCES dq_app.sessions(id) ON DELETE CASCADE,
    stage        TEXT NOT NULL,                  -- UI StageId: profile, explore, rules, validate, triage, plan, transform, scorecard, pipeline
    payload      JSONB NOT NULL,                 -- whatever that stage view reads
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, stage)              -- upsert on re-snapshot
);
```

`stage` strings in `stage_snapshots` use the **UI's** vocabulary (the `StageId` values used by the stepper), not the internal `WorkflowStage` values, so the frontend can look up by the same identifier it uses to render.

### Payload contents per stage

Only the fields the corresponding `*Stage.tsx` reads.

| `stage` | payload keys |
|---|---|
| `profile` | `profile`, `ai_summary` |
| `explore` | `investigation_events` (frozen array from `investigation_progress.jsonl`) |
| `rules` | `suggested_rules`, `approved_rule_ids`, `rejected_rule_ids` |
| `validate` | `validation_summary`, `validation_results`, `baseline_score` |
| `triage` | `triage_result`, `threshold_changes`, `rejected_rule_ids` |
| `plan` | `transform_plan` |
| `transform` | `transformation_log`, `anomaly_summary`, `execution_escalation` |
| `scorecard` | `scorecard`, `narrative`, `current_score` |
| `pipeline` | `output_dir`, `zip_path` |

## API surface

All under `/api/v1`, implemented in `backend/api/routers/sessions.py`.

```
GET    /sessions                              # list (DB) — replaces localStorage
GET    /sessions/{id}                         # unchanged shape; reads Temporal first, falls back to DB
GET    /sessions/{id}/stages/{stage}          # NEW — snapshot read
DELETE /sessions/{id}                         # NEW — terminate workflow + cascade
POST   /sessions                              # unchanged path, now also INSERTs the DB row
```

### `GET /sessions`

```json
[
  { "id": "...", "filename": "orders.csv", "stage": "TRANSFORMATION_LOOP",
    "current_score": 0.82, "baseline_score": 0.61,
    "created_at": "2026-05-11T12:00:00Z", "updated_at": "2026-05-11T12:11:00Z" }
]
```

Reads `dq_app.sessions WHERE deleted_at IS NULL ORDER BY created_at DESC`. Returns the existing `SessionListEntry` shape augmented with `stage` and scores so `SessionCard` renders without a per-card Temporal query.

### `GET /sessions/{id}`

Same response schema as today. New read order:

1. Try Temporal query (existing behavior).
2. On `RPCStatusCode.NOT_FOUND` (workflow retention expired), hydrate from the DB row + most-advanced snapshot.
3. Opportunistically update `sessions.stage` / `current_score` / `updated_at` on Temporal-served reads.

### `GET /sessions/{id}/stages/{stage}`

```json
{ "stage": "rules",
  "payload": { "suggested_rules": [...], "approved_rule_ids": [...] },
  "created_at": "2026-05-11T12:05:00Z" }
```

- `stage` path param uses UI `StageId` vocabulary.
- 404 if the snapshot doesn't exist yet (UI falls back to "this stage hasn't run yet" empty state).

### `DELETE /sessions/{id}`

1. Look up workflow handle; if it exists, `handle.terminate(reason="user-deleted")`. Swallow `NOT_FOUND`.
2. `DELETE FROM dq_app.sessions WHERE id = $1` (cascades the snapshots via FK).
3. `shutil.rmtree("data/sessions/{id}", ignore_errors=True)` and same for `output/sessions/{id}`.
4. Return `204`. Idempotent — calling on a missing id returns `204` too.

## Workflow + snapshot mechanics

New activity at `backend/temporal/activities/snapshot_activities.py`:

```python
@activity.defn
async def snapshot_stage(session_id: str, stage: str, payload: dict) -> None:
    # In a single transaction:
    #   UPSERT INTO dq_app.stage_snapshots ON CONFLICT (session_id, stage) DO UPDATE
    #   UPDATE dq_app.sessions SET stage=?, current_score=?, baseline_score=?,
    #                              output_dir=?, zip_path=?, updated_at=now()
```

Both writes in one transaction. Idempotent via UPSERT, so Temporal retries are safe.

### Snapshot call sites in `DQAcceleratorWorkflow`

Snapshots happen at **stage exit**, not entry, so the payload is fully populated.

| Snapshot point (after this WorkflowStage completes) | UI `stage` written | Payload source |
|---|---|---|
| `PROFILING` done | `profile` | `profile`, `ai_summary` |
| `PROFILING_SYNTHESIS` done (post-explore) | `explore` | freeze `investigation_progress.jsonl` into JSON array |
| `AWAITING_RULE_APPROVAL` resolved | `rules` | `suggested_rules` + approve/reject lists from the signal |
| `VALIDATING` done | `validate` | `validation_summary`, `validation_results`, `baseline_quality_score` |
| `AWAITING_TRIAGE_APPROVAL` resolved | `triage` | `triage_result`, threshold changes, rejected ids |
| `AWAITING_PLAN_APPROVAL` resolved | `plan` | `transform_plan` |
| `TRANSFORMATION_LOOP` done | `transform` | `transformation_log`, `anomaly_summary`, `execution_escalation` |
| Before `AWAITING_PIPELINE_CONFIRMATION` | `scorecard` | `scorecard`, `narrative`, `current_score` |
| `GENERATING` done (terminal) | `pipeline` | `output_dir`, `zip_path` |

Additionally: `POST /sessions` INSERTs the `sessions` row (stage=`LOADING`) **before** starting the workflow so the home page can show the card immediately and the first snapshot call has a parent row.

### What does NOT change

- DuckDB session DB at `data/sessions/{id}/working.duckdb`.
- `dq_tools` (still synchronous, session-scoped).
- Existing investigation SSE stream (we just snapshot a frozen copy at exploration exit).

### Connection management

- New module `backend/db/` with an async SQLAlchemy engine + session factory.
- DSN from env `APP_DB_DSN` (default `postgresql+asyncpg://temporal:temporal@postgresql:5432/temporal`, schema `dq_app`).
- FastAPI lifespan opens the engine alongside the Temporal client; the worker opens its own engine for the activity.

## Frontend changes

### Light mode (palette swap, no toggle)

`frontend/tailwind.config.ts` — swap values, keep semantic token names so component classes don't change:

```ts
colors: {
  bg:           '#f8fafc',
  surface:      '#ffffff',
  elevated:     '#f1f5f9',
  border:       '#e2e8f0',
  'text-primary':   '#0f172a',
  'text-secondary': '#475569',
  'text-muted':     '#94a3b8',
  indigo:  { DEFAULT: '#4f46e5', light: '#6366f1' },
  success: { DEFAULT: '#16a34a', light: '#22c55e' },
  warning: { DEFAULT: '#d97706', light: '#f59e0b' },
  danger:  { DEFAULT: '#dc2626', light: '#ef4444' },
  purple:  { DEFAULT: '#7c3aed', light: '#a78bfa' },
}
```

`globals.css` — remove the `prefers-color-scheme: dark` block; set body bg/color from the new tokens.

Sweep that's needed in components: a handful of hardcoded hexes (`#22c55e`, `#f59e0b`, `#f87171` in `SessionCard.tsx`) and a few `bg-*-400/10` status pills become semantic tokens or get adjusted for contrast on white. No structural changes.

### Polling discipline

- **`useSession`**: gains an `enabled` arg. SWR config: `refreshInterval: enabled ? 2000 : 0`, `refreshWhenHidden: false`, `revalidateOnFocus: true`. The hook delegates tab-visibility pausing to SWR's built-in options rather than reading `document.visibilityState` directly (which doesn't trigger React re-renders on change).
- **Home page** (`app/page.tsx`): drop `LiveSessionCard` and per-session SWR. Replace with one `useSessionsList()` hook backed by SWR on `GET /sessions`, `refreshInterval: 5000`, `refreshWhenHidden: false`. Cards render from the list payload (which now carries `stage`/scores).
- **Workspace page** (`app/sessions/[id]/page.tsx`): pass `enabled={!isPastStage}`. Visibility-based pause is handled by `refreshWhenHidden: false` inside `useSession`. When viewing a past stage, polling stops entirely; the past-stage view reads the immutable snapshot and never refreshes.

### Snapshot-aware stage rendering

New hook:

```ts
// frontend/hooks/useStageSnapshot.ts
export function useStageSnapshot(sessionId: string, stage: StageId, enabled: boolean) {
  return useSWR(enabled ? `/sessions/${sessionId}/stages/${stage}` : null, fetcher,
                { revalidateOnFocus: false, refreshInterval: 0 })  // immutable once captured
}
```

`app/sessions/[id]/page.tsx` `renderStage()` becomes:

```ts
if (isPastStage) {
  return <SnapshotStageView stage={displayStage} sessionId={id} />
}
// otherwise existing live rendering
```

`SnapshotStageView` is a small dispatcher that loads `useStageSnapshot`, then renders the same `*Stage.tsx` components in a **read-only** variant. To avoid component duplication, each stage component gains a `readOnly` boolean prop that disables buttons and hides "decide" controls. The data shape it consumes stays the same; the snapshot payload is passed through.

### Delete

- `SessionCard` gains a `×` button (hover-visible) → confirm dialog → `DELETE /sessions/{id}` → SWR `mutate('/sessions')` to drop it. If the user is currently inside the deleted session's workspace, the router pushes back to `/`.
- `useSessionList` (localStorage) is removed.

### localStorage cleanup

On first load after deploy, if `localStorage['dq_sessions']` exists, drop it silently. The DB is now authoritative.

## Migrations and ops

### Postgres setup

Reuse the existing `postgresql` service in `docker-compose.yml`. Two changes:

1. **Schema isolation.** Temporal owns `public`; we own `dq_app`. The Alembic migration starts with `CREATE SCHEMA IF NOT EXISTS dq_app`, sets `search_path` for our models, and never touches Temporal's tables.
2. **Connection string.** Reuse Temporal's credentials against the same `temporal` database. Add to `docker-compose.yml` for both `api` and `worker`:
   ```yaml
   - APP_DB_DSN=postgresql+asyncpg://temporal:temporal@postgresql:5432/temporal
   ```
   And `.env.example`:
   ```
   APP_DB_DSN=postgresql+asyncpg://temporal:temporal@localhost:5432/temporal
   ```

### Dependencies

Add to `pyproject.toml`:

- `sqlalchemy[asyncio]>=2.0`
- `asyncpg>=0.29`
- `alembic>=1.13`

### Alembic layout

```
backend/db/
  __init__.py          # async engine + AsyncSessionLocal
  models.py            # Session, StageSnapshot SQLAlchemy models
  repository.py        # async CRUD: insert_session, upsert_snapshot, list_sessions, delete_session, get_snapshot
  migrations/
    env.py
    versions/
      0001_initial.py  # CREATE SCHEMA + sessions + stage_snapshots
alembic.ini            # project root
```

### Migrations on startup

FastAPI `lifespan`:

1. Open async engine.
2. Run `alembic upgrade head` programmatically (via `Config` + `command.upgrade`). Idempotent; safe to re-run on every boot.
3. Connect to Temporal as today.

`worker.py`: open engine only (no migrations — API owns schema lifecycle), register the new `snapshot_stage` activity.

## Rollout order

This is also the natural plan-phase split.

1. **DB foundation.** `backend/db/` + Alembic + lifespan wiring + env vars. No behavior change. Verifiable in isolation.
2. **Sessions API + delete endpoint.** `POST /sessions` writes a row; `GET /sessions`, `DELETE /sessions/{id}` work. Frontend still on localStorage; endpoints exercised by curl.
3. **Snapshot activity + workflow calls.** Activity registered, workflow calls it at each stage exit. Snapshots accumulate; nothing reads them yet.
4. **Frontend: list + delete.** Switch home page to `GET /sessions`, drop `useSessionList`, add delete button.
5. **Frontend: snapshot-aware past stages.** `useStageSnapshot` + `readOnly` prop threaded through `*Stage.tsx` + dispatcher in `[id]/page.tsx`.
6. **Frontend: polling discipline.** Visibility + `enabled` flags in `useSession`. Tiny diff; deferred so we don't fight it during earlier debugging.
7. **Light mode.** Palette swap + hardcoded-hex sweep. Decoupled from everything else; last so earlier UX changes settle without theme noise.

## Testing strategy

- **DB layer.** pytest fixture creates a fresh schema per test (or via `pytest-postgresql`); repository functions tested directly.
- **Activity.** Unit test `snapshot_stage` against a real test DB; assert UPSERT semantics and the `sessions` row update.
- **Workflow.** Extend existing workflow tests with a mocked `snapshot_stage`; assert call args at each transition.
- **API.** Tests for `GET /sessions`, `GET /sessions/{id}/stages/{stage}`, `DELETE /sessions/{id}` including idempotency and the Temporal-NOT_FOUND fallback in `GET /sessions/{id}`.
- **Frontend.** Jest tests for `useStageSnapshot`, the read-only stage dispatcher, and home-page list rendering from API.
