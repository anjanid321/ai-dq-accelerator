# Frontend Design Spec — AI DQ Accelerator

**Date:** 2026-03-20
**Status:** Approved
**Scope:** Next.js frontend in `frontend/` folder

---

## Overview

A Next.js web UI that gives users full visibility into the AI-powered data quality pipeline. The frontend connects to the existing FastAPI backend at port 8000 and exposes every step of the Temporal workflow as an interactive, inspectable interface.

---

## Architecture

### Approach

Next.js App Router with SWR for polling-based session state and SSE for live AI activity streaming. No WebSocket bridge needed — the backend already exposes both patterns.

### Data flow

- **Session state**: `GET /api/v1/sessions/{id}` polled every 2 seconds via SWR. Returns the full `SessionStateResponse` including stage, profile, rules, transformation log, and scorecard.
- **AI activity**: `GET /api/v1/sessions/{id}/investigation/stream` consumed as a persistent SSE connection. Events are `tool_call | tool_result | thinking | done`.
- **Scorecard data**: `GET /api/v1/sessions/{id}/scorecard` fetched once when the Scorecard stage mounts. Returns `ScorecardResponse` with `rules_passing`, `rules_total`, `original_rows`, `final_rows`, `rows_removed`, `rows_modified`, `narrative`, and `transformation_log`.
- **Human signals**: `POST /api/v1/sessions/{id}/rules/approve`, `POST /api/v1/sessions/{id}/transformations/{tid}/decision`, `POST /api/v1/sessions/{id}/pipeline/generate`.
- **Pipeline download**: `GET /api/v1/sessions/{id}/pipeline/download` — returns the ZIP file directly. The `zip_path` field on `SessionStateResponse` is a server-side filesystem path and must NOT be used as a URL.

### Session list persistence

The backend has no `GET /api/v1/sessions` list endpoint. The frontend maintains a session list in `localStorage` under the key `dq_sessions`. Each entry stores `{ id, filename, createdAt }`. When a new session is created, its ID is prepended to this list. On the sessions home page, each stored ID is fetched individually via `GET /api/v1/sessions/{id}` to get live stage and score data. Sessions that return 404 are silently removed from the list.

### Routes

```
/                          → Sessions home page
/sessions/[id]             → Workspace (all stages)
```

No additional routes needed. Stage navigation happens within the workspace via the stepper — it does not change the URL.

### Project structure

```
frontend/
  app/
    page.tsx                    → Sessions home
    sessions/[id]/
      page.tsx                  → Workspace shell
  components/
    sessions/
      SessionCard.tsx
      UploadModal.tsx
    workspace/
      Stepper.tsx
      TopBar.tsx
    stages/
      LoadingStage.tsx          → LOADING state (full-area spinner)
      ProfileStage.tsx          → PROFILING + AWAITING_RULE_APPROVAL
      RulesStage.tsx            → AWAITING_RULE_APPROVAL (interactive)
      ValidateStage.tsx         → VALIDATING (waiting state)
      TransformStage.tsx        → TRANSFORMATION_LOOP
      ScorecardStage.tsx        → AWAITING_PIPELINE_CONFIRMATION + COMPLETE
      PipelineStage.tsx         → AWAITING_PIPELINE_CONFIRMATION + GENERATING + COMPLETE
    ai-panel/
      AIPanel.tsx
      EventFeed.tsx
      EventTerminal.tsx
  hooks/
    useSession.ts               → SWR polling hook (refreshInterval: 2000)
    useSessionList.ts           → localStorage session list read/write
    useAIStream.ts              → SSE connection hook
  lib/
    api.ts                      → Typed fetch wrappers for all endpoints
```

### State management

React Context is sufficient. One `SessionContext` per workspace page holds the polled `SessionStateResponse`. The AI panel maintains its own local event list accumulated from the SSE stream. No Redux or Zustand needed.

---

## Shell Design

### Sessions home (`/`)

- Top nav: logo + "New Session" button (opens upload modal)
- Session cards grid (`auto-fill, minmax(280px, 1fr)`)
- Each card shows: filename, date, row/col count, stage badge (color-coded), quality score bar, mini stage-progress pills
- Sessions awaiting human action (rules approval, transform decision) show an amber call-to-action banner
- Complete sessions show before/after score delta and quick-access buttons (View Report, Download Pipeline)
- Profiling-in-progress sessions show an animated progress bar
- Empty card slot at the end: dashed border, "Upload Dataset" CTA
- Upload modal: file drop zone (CSV/Parquet/JSON), optional use-case text field, Start button. On success, stores `{ id, filename, createdAt }` in `localStorage` and navigates to `/sessions/{id}`.

**Stage badge colors:**
- LOADING / PROFILING: cyan `#22d3ee`
- AWAITING_RULE_APPROVAL: amber `#f59e0b`
- VALIDATING / TRANSFORMATION_LOOP: indigo `#818cf8`
- AWAITING_PIPELINE_CONFIRMATION / GENERATING: indigo
- COMPLETE: green `#4ade80`

### Workspace (`/sessions/[id]`)

**Layout:** Full-height split view.

```
┌─────────────────────────────────────────┬──────────────┐
│  Top bar (44px)                          │              │
├──────────┬──────────────────────────────┤              │
│          │                              │  AI Panel    │
│ Stepper  │  Active Stage Content        │  (300px)     │
│ (160px)  │                              │              │
│          │                              │              │
└──────────┴──────────────────────────────┴──────────────┘
```

**Top bar:** Logo, "← Sessions" breadcrumb, filename, row/col count, live quality score chip (color-coded by score level).

**Stepper (left, 160px):** Vertical list of all stages. Each stage has a dot (done=green, active=indigo glowing, locked=dark). Completed stages are clickable to review past results (read-only). Active stage is highlighted. Locked stages are dimmed and non-interactive. Stage labels: Load, Profile, Rules, Validate, Transform, Scorecard, Pipeline.

**Stage content:** Scrollable. Renders the component for the currently viewed stage. If viewing a past stage, a banner at the top reminds the user to return to the active stage.

**AI panel (right, 300px):** Always visible. Toggle between Feed and Terminal views. Feed/Terminal state persists within the session.

---

## Stage Designs

### Stage: Loading

Shown when `stage === LOADING`. Replaces the stage content area with a centered spinner and the message "Uploading and loading your dataset...". No stepper interaction during this stage.

### Stage: Profile

Shown when `stage === PROFILING` (live, AI still running) or when the stepper navigates back to Profile from a later stage.

**Data source:** `SessionStateResponse.profile` (a dict) and `SessionStateResponse.ai_summary`.

**Profile dict structure** (from `dq_tools/profiler.py`):
```
profile.table.n_rows          → row count
profile.table.n_columns       → column count
profile.table.p_cells_missing → fraction of cells missing (0–1); completeness = 1 - p_cells_missing
profile.table.n_duplicates    → duplicate row count
profile.alerts[]              → list of { column, type, description }
profile.variables_summary     → dict keyed by column name, each with:
    type, n_missing, p_missing, n_distinct, p_distinct, is_unique
    (numeric cols also have: mean, std, min, max, skewness, n_zeros)
```

- **AI Summary card**: indigo tinted background, prose summary from `ai_summary`. Only shown when `ai_summary` is non-empty.
- **Stats grid (2×2)**:
  - Completeness: `(1 - profile.table.p_cells_missing) * 100` — shown as %
  - Rows: `profile.table.n_rows`
  - Columns: `profile.table.n_columns`
  - Alerts: `profile.alerts.length`
  - Note: Validity % is NOT available at this stage — it is set by `baseline_quality_score` after validation completes.
- **Column breakdown table**: one row per entry in `profile.variables`. Columns: name, type, `n_missing`, `p_missing` (with inline bar). Rows where `p_missing > 0.05` are highlighted in red.
- **"Continue to Rules →"** button — only shown when `ai_summary` is non-empty (i.e., profiling is complete). Clicking it does not call an API — the workflow auto-advances; this just scrolls/navigates to the Rules stage panel.

### Stage: Rules

Shown when `stage === AWAITING_RULE_APPROVAL`.

**Data source:** `SessionStateResponse.suggested_rules` (list of Rule objects).

- **Filter toolbar**: All / Validity / Completeness / Uniqueness pill filters + "Approve All" shortcut
- **Rule cards**: Each shows category badge, check description (monospace), column/check metadata, AI rationale from `rule.rationale`
- **Three actions per card**: ✓ Approve (green), ✗ Reject (red), ✎ Edit (amber) — toggle state. There is no "skip" — every rule must be explicitly approved or rejected before submission.
- **Inline editor**: Opens in-card when editing. Fields adapt to rule type: `min`/`max` inputs for `between` checks, `pattern` input for regex checks, `values` list for enum checks. Raw `sodacl` block always shown and editable. "Save & Approve" / "Cancel" actions.
- **Sticky submit bar**: Live count of approved / rejected / pending. Submit button enabled only when zero rules remain in undecided state. On submit, calls `POST /api/v1/sessions/{id}/rules/approve` with `{ approved_rules: [...], rejected_rule_ids: [...] }`.

### Stage: Validate

Shown while `stage === VALIDATING`. Read-only waiting state.

- Centered spinner with "AI is running validation rules against your dataset..."
- AI panel shows live tool calls as validation executes
- SWR polling detects stage change to `TRANSFORMATION_LOOP` and auto-advances the stepper to Transform

### Stage: Transform

Shown when `stage === TRANSFORMATION_LOOP`.

**Data source:** `SessionStateResponse.current_suggestion` (a `CurrentSuggestion`) and `SessionStateResponse.transformation_log`.

- **Score tracker**: Shows `baseline_quality_score` → `current_score` with a dual-bar (baseline marker at the original position, current fill extending right). Delta shown as `+N%`.
- **Suggestion card** (from `current_suggestion`):
  - Transform type badge (e.g., `fill_nulls`, `drop_duplicates`) — from `current_suggestion.type`
  - Progress indicator: "suggestion N of ~M" where N = `transformation_log.length + 1` and M is omitted or shown as "?" since the total is unknown
  - Human-readable title constructed from `current_suggestion.type` + `current_suggestion.params`
  - AI rationale from `current_suggestion.rationale`
  - Impact chips from `current_suggestion.preview`: `affected_row_count`, `projected_score_delta`, `projected_score`
  - Before/After table from `preview.before_sample` / `preview.after_sample`: side-by-side, changed cells highlighted green, prior nulls in red italic
  - Decision bar: "✓ Accept Transform" (green, prominent), "✗ Reject" (red ghost), "Skip →" (neutral grey). Both Reject and Skip call `POST /api/v1/sessions/{id}/transformations/{tid}/decision` with `{ approved: false }` — they are semantically identical at the API level. "Skip" is a softer label for UX clarity when the user is unsure rather than opposed.
  - Accept calls the same endpoint with `{ approved: true }`
- **Transform log** (from `transformation_log`): Running history with type, rows affected, score delta, applied/rejected status
- When `current_suggestion` is null and stage is still `TRANSFORMATION_LOOP`: show loading state ("AI is generating the next suggestion...")
- When stage becomes `AWAITING_PIPELINE_CONFIRMATION`: auto-advance to Scorecard

### Stage: Scorecard

Shown when `stage === AWAITING_PIPELINE_CONFIRMATION` or `COMPLETE`.

**Data source:** `GET /api/v1/sessions/{id}/scorecard` → `ScorecardResponse`. Fetched once when this stage mounts (not via the polling hook). Fields used: `baseline_score`, `final_score`, `delta`, `original_rows`, `final_rows`, `rows_removed`, `rows_modified`, `rules_passing`, `rules_total`, `narrative`, `transformation_log`.

- **Hero**: `baseline_score` → `final_score` (large numerals), `delta` badge, dual progress bar
- **Stats grid (1×4)**: `original_rows`, `final_rows`, `rows_removed`, `rows_modified`
- **AI Narrative**: prose from `narrative`, indigo tinted background
- **Transform history table**: full `transformation_log` with type, rows affected, score delta, applied/rejected status

### Stage: Pipeline

Shown below scorecard (or as a dedicated scrollable continuation) when `stage === AWAITING_PIPELINE_CONFIRMATION`, `GENERATING`, or `COMPLETE`.

- **Config form (2-col grid)**:
  - Warehouse: dropdown — Snowflake / PostgreSQL / BigQuery / DuckDB (maps to `TargetEnv.warehouse`)
  - Orchestrator: dropdown — Airflow (only current option; `TargetEnv.orchestrator`)
  - Schedule: cron text input, default `@daily` (`TargetEnv.schedule`)
  - Python version: text input, default `3.11` (`TargetEnv.python_version`) — surfaced as an advanced field
  - Slack channel: optional text input (`TargetEnv.slack_channel`)
- **Artifact preview grid (3-col)**: 6 cards showing what gets generated — dbt models, SodaCL checks.yml, Airflow DAG, Data Contract YAML, Quality Report HTML, cleaned_data.parquet
- **CTA**:
  - `AWAITING_PIPELINE_CONFIRMATION`: "Generate Pipeline →" button → calls `POST /api/v1/sessions/{id}/pipeline/generate` with `{ target_env: { ... } }`
  - `GENERATING`: spinner, "Generating your pipeline..."
  - `COMPLETE`: "✓ Pipeline Generated" (disabled green button) + "↓ Download ZIP" button → calls `GET /api/v1/sessions/{id}/pipeline/download` as a file download (e.g., via `window.location.href` or a hidden `<a download>` link)

---

## AI Panel

**Header:** "AI Activity" label with a live status dot (green=streaming, amber=waiting, grey=done). Feed/Terminal toggle.

**Feed view:** Scrolling list of event cards. Each card:
- Color-coded left border: indigo = TOOL CALL, green = RESULT, purple = THINKING
- Badge (TOOL CALL / RESULT / THINKING), tool name (monospace), timestamp
- Params/output in small monospace body text
- THINKING events render in italic system-ui (not monospace) for visual distinction

**Terminal view:** Monospace, dark background, timestamp prefix, minimal glyphs (`▶` for calls, `✓` for results, `~` for thinking). Dense and scrollable. Auto-scrolls to bottom.

**Waiting state card:** When the workflow is paused for human input, an amber card appears at the bottom of the feed reminding the user what action is needed.

**Implementation:** `useAIStream` hook connects to `GET /api/v1/sessions/{id}/investigation/stream` (note: the full `/api/v1` prefix is required — requests are proxied by Next.js rewrites to `http://localhost:8000`). Events accumulate in local state. Connection is opened when the workspace mounts and closed on unmount or when a `done` event is received. On stage change, past events are preserved (no clear) so the full session history is always visible.

---

## Visual Design

**Color palette (dark theme only):**
- Background: `#070a0f`
- Surface: `#0f1420`
- Elevated surface: `#0c0f1a`
- Border: `#1e2035`
- Text primary: `#f1f5f9`
- Text secondary: `#94a3b8`
- Text muted: `#475569`
- Accent indigo: `#6366f1` / `#818cf8`
- Success green: `#22c55e` / `#4ade80`
- Warning amber: `#f59e0b` / `#fbbf24`
- Error red: `#ef4444` / `#f87171`
- Thinking purple: `#a78bfa` / `#c4b5fd`

**Typography:** System UI stack. Monospace (`font-family: monospace`) for rule checks, column names, tool names, params, and code blocks.

**No light mode.** Dark only.

---

## Technical Notes

- **Next.js version**: 14+ with App Router
- **Styling**: Tailwind CSS
- **Data fetching**: SWR (`useSWR` with `refreshInterval: 2000` for session state)
- **SSE**: Native `EventSource` API wrapped in `useAIStream` hook
- **File upload**: `FormData` multipart POST to `/api/v1/sessions`
- **Proxy**: Next.js `rewrites` in `next.config.js` to proxy `/api/v1/*` → `http://localhost:8000/api/v1/*` (avoids CORS in dev; backend already has `allow_origins: ["*"]` for flexibility)
- **Type safety**: Hand-write TypeScript interfaces matching `backend/api/schemas.py`
- **Session persistence**: `localStorage` key `dq_sessions` holds `Array<{ id: string, filename: string, createdAt: string }>`
- **No auth**: Not in scope for this version

---

## Out of Scope

- Light mode / theme toggle
- User authentication
- Multi-user / team features
- Mobile responsiveness (desktop-first)
- Real-time collaboration
- Custom rule authoring from scratch (edit-only in this version)
- Backend session list endpoint (handled via localStorage)
