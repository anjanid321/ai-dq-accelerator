# Holistic Transform Planning

**Date:** 2026-03-30
**Status:** Approved for implementation

---

## Problem

The current transformation loop is greedy and myopic. The advisor picks the single highest-impact fix each iteration, applies it, then re-evaluates — without any awareness of what comes next. This produces whack-a-mole behaviour: 17 micro-decisions made without context of what comes later, transforms that conflict with each other, and no guarantee that earlier steps don't undo the assumptions later steps rely on. The engineer approves each step in isolation, never seeing the full picture.

---

## Solution

Replace the one-at-a-time suggestion loop with a two-phase approach:

1. **Planning phase** — the advisor builds a complete, dependency-aware transform plan across all fixable failures using tool access to verify hypotheses against the real data.
2. **Execution phase** — the approved plan executes automatically with per-step self-monitoring and a human escalation path for genuine surprises.

The engineer reviews and edits one coherent plan, then approves it once.

---

## Workflow Stages

Four new stages inserted in the transformation path:

```
... → VALIDATING
  → TRIAGING → AWAITING_TRIAGE_APPROVAL (conditional)
  → PLANNING
  → AWAITING_PLAN_APPROVAL
  → TRANSFORMATION_LOOP  (repurposed: automated execution)
  → AWAITING_HUMAN_INPUT (transient escalation state)
  → GENERATING
```

`PLANNING` is always entered after the triage phase resolves — regardless of whether `AWAITING_TRIAGE_APPROVAL` was skipped (no amendments) or whether triage itself was skipped (no failing rules). The existing code path at line 310 of `dq_workflow.py` that advances directly to `TRANSFORMATION_LOOP` is the insertion point: `PLANNING` replaces that direct transition in all code paths.

`TRANSFORMATION_LOOP` keeps its name to avoid breaking downstream stage-map logic; its behaviour changes entirely. `AWAITING_HUMAN_INPUT` maps to the `transform` stepper step — no new stepper entry.

---

## Data Model

### `TransformPlanStep`

```python
@dataclass
class TransformPlanStep:
    id: str                               # "step_1", "step_2", ...
    type: str                             # canonical type or "custom"
    column: Optional[str]
    params: dict                          # fully specified for prebuilt; empty {} for custom
    custom_code: Optional[str]            # always None at plan time; filled during execution
    rationale: str
    targets_rules: list[str]              # rule IDs this step addresses
    depends_on: list[str]                 # step IDs that must complete first
    conflicts_with: list[str]             # step IDs that would undo this step
    projected_score_delta: float
    needs_review: bool = False            # True if plan-time param validation exhausted retries
    status: Literal['pending', 'applied', 'skipped', 'failed'] = 'pending'
    actual_score_delta: Optional[float] = None
    # Custom steps only:
    intent: Optional[str] = None          # "Rebuild TotalCharges as tenure × MonthlyCharges..."
    target_columns: Optional[list[str]] = None
    approach: Optional[str] = None        # plain-English description of the approach
```

### `TransformPlan`

```python
@dataclass
class TransformPlan:
    steps: list[TransformPlanStep]
    summary: str
    projected_final_score: float
```

### New workflow state fields

```python
transform_plan: Optional[dict] = None         # serialised TransformPlan
plan_decision: Optional[dict] = None          # staging field set by approve_plan signal
execution_escalation: Optional[dict] = None   # current issue awaiting human response
escalation_decision: Optional[dict] = None    # staging field set by resolve_escalation signal
provide_instruction_attempts: int = 0         # retry counter for provide_instruction; stored
                                               # in workflow state so it survives replay
```

**Signal staging pattern** (same as existing `triage_amendments`):
- `approve_plan` signal handler sets `self.plan_decision = payload`
- Workflow `wait_condition(lambda: self.plan_decision is not None)` unblocks
- Workflow reads `self.plan_decision["steps"]`, writes to `self.transform_plan["steps"]`, clears `self.plan_decision = None`
- Same pattern for escalation: `resolve_escalation` sets `self.escalation_decision`, workflow clears it after reading

Both `transform_plan` and `execution_escalation` must be included in the `get_full_state` Temporal query return value. No additional query needed.

**Dataclass vs dict:** All workflow state fields and all activity inputs/outputs use plain dicts — Temporal requires JSON-serialisable types. The `TransformPlanStep` and `TransformPlan` dataclass definitions in this spec are documentation-only (they describe the expected dict shape). The workflow and activities access all fields as dict keys: `step["id"]`, `step["type"]`, etc.

---

## Plan Content: Hybrid Approach

| Step type | Plan contains | Execution does |
|-----------|--------------|----------------|
| Prebuilt (`impute_mode`, `winsorize`, etc.) | Full `type` + `params` | Apply directly — no LLM call |
| Custom | `intent`, `target_columns`, `approach` — no code | Generate code with tool access against post-prior-step data |

Prebuilt params are stable given the schema and do not depend on execution order. Custom code correctness depends on the exact data state after prior steps have run — deferring code generation to execution time is correct, not a concession.

---

## Planning Agent

### Graph: `TransformPlanner`

File: `backend/agents/graphs/transform_planner.py`

```
investigate ⟷ tools          (ReAct loop, max 12 turns)
     ↓
build_plan
     ↓
validate_prebuilt_steps ⟷ fix_invalid_steps   (max 3 attempts per step)
     ↓
finalize
```

### Input context

- `fixable_rules`: built by the workflow before calling `plan_transforms_activity`:
  ```python
  per_rule_by_id = {r["id"]: r for r in self.validation_results.get("per_rule", [])}
  fixable_rules = [
      {**per_rule_by_id[c["rule_id"]], "triage": c}
      for c in self.triage_result.get("classifications", [])
      if c.get("classification") == "transform_fixable"
      and c["rule_id"] in per_rule_by_id
  ]
  ```
  Triage classifications use `rule_id`; validation per_rule entries use `id`. The join is `c["rule_id"] == r["id"]`. If `self.triage_result.get("classifications")` is empty or missing (triage was skipped because there were no failing rules — `self.triage_result` is `{}` by default), `fixable_rules` is `[]` and the planner emits an empty plan immediately.
- Full `validation_results`
- Profile summary
- Session `use_case`
- Existing `transformation_log`

### Investigation tools

All four are read-only queries against `working.duckdb`, called inline within the activity:

| Tool | Signature | Purpose |
|------|-----------|---------|
| `run_sql` | `(query: str) → rows` | Arbitrary read-only DuckDB query |
| `get_value_counts` | `(column: str, limit: int) → freq table` | Value distribution |
| `get_sample_rows` | `(filter_sql: str, limit: int) → rows` | Filtered sample |
| `get_column_stats` | `(column: str) → stats` | min, max, mean, null_count, distinct_count, dtype |

### ReAct loop

Claude calls tools freely until it emits a response with no tool calls, signalling it is ready to plan. Hard cap of 12 tool-call turns forces plan generation if the limit is reached.

### `build_plan` node

Claude emits the full plan as structured JSON. Example step (prebuilt):

```json
{
  "id": "step_1",
  "type": "impute_constant",
  "column": "tenure",
  "params": {"column": "tenure", "value": 0},
  "rationale": "312 nulls all from new customers (TotalCharges=0).",
  "targets_rules": ["r3"],
  "depends_on": [],
  "conflicts_with": ["step_4"],
  "projected_score_delta": 0.04
}
```

Example step (custom):
```json
{
  "id": "step_3",
  "type": "custom",
  "column": "TotalCharges",
  "params": {},
  "intent": "Rebuild TotalCharges as tenure × MonthlyCharges for rows where the relationship is violated",
  "target_columns": ["TotalCharges", "tenure", "MonthlyCharges"],
  "approach": "Conditional update on rows where abs(TotalCharges - tenure*MonthlyCharges) > 0.01",
  "rationale": "312 rows violate the cross-column relationship.",
  "targets_rules": ["r7"],
  "depends_on": ["step_1"],
  "conflicts_with": [],
  "projected_score_delta": 0.03
}
```

### `validate_prebuilt_steps` → `fix_invalid_steps`

For every non-custom step: dry-run using the existing `validate_transform_spec()` function. Unlike the current `TransformationAdvisor` (which runs outside a DuckDB session), `plan_transforms_activity` already has an open DuckDB connection from the investigation tools. Use a real 50-row sample fetched with `SELECT * FROM working_data ORDER BY RANDOM() LIMIT 50` (the table name in every session DuckDB is `working_data`) rather than a synthetic profile-based DataFrame. This gives data-dependent params (e.g. `winsorize` with a percentile derived from actual data) a meaningful validation. Invalid steps go to `fix_invalid_steps` where Claude corrects only the params (same type, new params). Max 3 attempts per step. Steps that exhaust all attempts are flagged `needs_review=True`.

### Temporal activity

`plan_transforms_activity` receives `session_id`, `fixable_rules`, `validation_results`, `profile`, `use_case`, `transformation_log` (passed for continuity context — e.g. if re-planning is ever supported, the advisor avoids re-proposing transforms that already have log entries; in the initial planning case it will be empty). Returns a dict with `steps` (list of dicts matching `TransformPlanStep` fields, with `needs_review` defaulting to `False`, `status` to `'pending'`, `actual_score_delta` to `None`, `custom_code` to `None`), `summary`, and `projected_final_score`. Schedule-to-close timeout: 10 minutes. Wrapped in `asyncio.run_in_executor`.

### Plan size cap

The `plan_transforms_activity` caps the output plan at 25 steps. If the advisor produces more, the activity truncates to the first 25 by projected impact before returning. This preserves the existing 25-transform hard cap without adding a separate rejection path at the signal handler.

### SSE streaming

The `TransformPlanner` investigation loop emits events through the existing SSE infrastructure using the `emit()` function in `backend/agents/emit.py`. Use the same three event types as `TransformationAdvisor`: `"thinking"` for Claude's reasoning steps, `"tool_call"` when a tool is invoked, `"tool_result"` for the tool response. The channel and `done` event at completion are identical to the existing agents.

---

## Execution Loop

### Entry

When `approve_plan` signal arrives, `self.plan_decision` is set. The workflow clears the staging field, performs a full replace of `self.transform_plan["steps"]` with the payload's steps array, and advances to `TRANSFORMATION_LOOP`. The payload is the complete, fully-populated steps array from the frontend — every field must be present. `custom_code` is `None` for all custom steps; this is not an error.

### Per-step sequence

```
1. Check depends_on: if any dependency step has status 'failed' or 'skipped' → auto-skip:
   - Set step status = 'skipped'
   - Append to transformation_log: {id: step.id, type, status: 'skipped',
     rationale: "dependency skipped/failed", affected_rows: 0, score_delta: 0,
     params: {}, regressions: []}
   - Do NOT increment consecutive_no_progress
   - Continue to next step

2. Snapshot: pre_step_passing = {r["id"] for r in validation_results["per_rule"] if r["passed"]}
             pre_step_score = self.current_score

3. If type == "custom":
   - Call generate_custom_code_activity
   - On success: write custom_code into self.transform_plan["steps"][i]["custom_code"]
   - On failure (validation_passed=False): escalate type="code_generation_failed",
     go to escalation handling (see below); do NOT proceed to step 4

4. Assemble transformation_spec:
   {
     "id": step.id,              # REQUIRED — used by apply_transformation for idempotency
     "type": step.type,
     "params": step.params,
     "custom_code": step.custom_code,   # top-level, not inside params["code"]
     "rationale": step.rationale,
   }
   Call apply_transformation_activity(session_id, transformation_spec).
   On exception → escalate type="step_failed", go to escalation handling.

5. Call update_scorecard_activity(session_id, approved_rules).
   Returns {quality_score, per_rule, category_scores}.
   Update self.current_score = scorecard_result["quality_score"].
   Update self.validation_results = {
     "per_rule": scorecard_result.get("per_rule", self.validation_results.get("per_rule", [])),
     "category_scores": scorecard_result.get("category_scores", self.validation_results.get("category_scores", {})),
     "baseline_quality_score": self.baseline_quality_score,   # preserved — never overwritten by scorecard
   }
   (Same merge pattern as lines 442–446 of existing dq_workflow.py.)

6. actual_score_delta = self.current_score - pre_step_score

7. Regression check (using pre_step_passing snapshot).

8. Divergence check.

9. If monitoring check triggers → escalate (see escalation mechanism).
   Resume here after escalation resolves with action='continue_anyway'.

10. Set step status = 'applied' (regardless of affected_rows — 'no_effect' is not used
    in TransformPlanStep; the log entry uses the actual affected_rows value for display).
    Set step actual_score_delta = actual_score_delta.

11. Append to transformation_log (in-memory self.transformation_log and on-disk via
    apply_transformation — both use step.id for the "id" field):
    {
      "id": step.id,
      "type": step.type,
      "params": step.params,
      "affected_rows": apply_result["affected_rows"],
      "score_delta": actual_score_delta,
      "status": "applied" if apply_result["affected_rows"] > 0 else "no_effect",
      "custom_code": step.custom_code,    # top-level, consistent with how log is read back
      "rationale": step.rationale,
      "regressions": [detected regression dicts],
    }
    Note: the on-disk log is written by apply_transformation_activity independently.
    self.transformation_log is the in-memory copy for Temporal queries and downstream activities.
    Both use step.id as the id key; apply_transformation uses it as the idempotency key.

12. (No stagnation counter update — see note below.)

13. (No stagnation guard break — see note below.)
```

### `generate_custom_code_activity`

**Graph name:** `CustomCodeGenerator`
**File:** `backend/agents/graphs/custom_code_generator.py`

**Input:**
```python
{
  "session_id": str,
  "step": dict,           # full TransformPlanStep dict
  "prior_context": str,   # execution history summary assembled by workflow:
                          # "step_1 (impute_constant on tenure): +4.1%, step_2 (winsorize on MonthlyCharges): +2.8%"
                          # (comma-separated entries for all steps with status 'applied')
  "human_instruction": Optional[str],  # only set when called via provide_instruction retry;
                                       # passed as a separate field so the graph can inject it
                                       # into the prompt distinctly from execution history
}
```

**Output:**
```python
{
  "custom_code": Optional[str],   # None if all attempts failed
  "validation_passed": bool
}
```

The graph has the same four investigation tools as `TransformPlanner`. It queries current data state (after prior steps have run) before writing code. Same static safety check and dry-run validation pipeline as existing custom code flow in `TransformationAdvisor`. Internal fix loop: up to 3 attempts. If all fail, returns `{"custom_code": None, "validation_passed": False}`.

When `validation_passed` is `False`, the calling workflow escalates with `code_generation_failed` and does **not** call `apply_transformation_activity`.

### Monitoring checks

**Regression check** — compare `pre_step_passing` snapshot (step 2) against post-step `per_rule`. Escalate only when a rule **not** listed in the step's `targets_rules` was in `pre_step_passing` and is no longer passing. Expected regressions (a step intentionally creating nulls that a later imputation will fix) are logged but not escalated.

**Divergence check** — escalate when `actual_score_delta < projected_score_delta × 0.3` and `projected_score_delta > 0.02`.

**Step failure** — `apply_transformation_activity` threw an error. Always escalate.

### Escalation mechanism

```python
# Workflow sets escalation and waits:
self.execution_escalation = {
  "type": "regression" | "divergence" | "step_failed" | "code_generation_failed",
  "step_id": "step_3",
  "description": "...",
  "context": { ... }   # e.g. {"projected": 0.05, "actual": 0.004} for divergence;
                       # {"last_error": "..."} for code_generation_failed/step_failed;
                       # {"regressed_rule_ids": [...]} for regression
}
self.stage = "AWAITING_HUMAN_INPUT"
await workflow.wait_condition(lambda: self.escalation_decision is not None)
decision = self.escalation_decision
self.escalation_decision = None
self.execution_escalation = None
# handle decision["action"] ...
```

### Human actions per escalation type

For `regression` and `divergence`: the step has already been applied (steps 4–5 ran before monitoring). The data is changed. "Skip" is not meaningful here.

| Escalation type | Valid actions | Step status on resolution |
|-----------------|---------------|--------------------------|
| `regression`, `divergence` | `continue_anyway`, `abort_plan` | `'applied'` (continue_anyway) or unchanged (abort_plan breaks loop) |
| `step_failed`, `code_generation_failed` | `skip_step`, `abort_plan`, `provide_instruction` | `'failed'` (skip_step), unchanged (abort_plan breaks loop), retry (provide_instruction) |

**`provide_instruction` retry loop:**
- The workflow calls `generate_custom_code_activity` again with `human_instruction` set to the engineer's message (`prior_context` is not modified).
- `self.provide_instruction_attempts` is incremented each time. Reset to 0 at the start of each new step. Max 2 retries per escalation event.
- After 2 retries with `provide_instruction`: auto-take `skip_step` (set step status = `'failed'`, log and continue). The workflow does not re-enter `AWAITING_HUMAN_INPUT` for the exhausted case — it proceeds automatically.
- A new `AWAITING_HUMAN_INPUT` wait is issued for each failed retry (engineer sees each attempt failed before deciding to try again or give up).

**`abort_plan`:** breaks the execution loop immediately, transitions to `GENERATING` with whatever has been applied so far.
- For `step_failed`/`code_generation_failed` escalations: the step was **not applied** (apply threw an error or was never called). Set `step.status = 'failed'` before breaking.
- For `regression`/`divergence` escalations: the step **was applied** (data on disk has changed). Set `step.status = 'applied'` with `actual_score_delta` filled before breaking. Do not leave the step as `'pending'`.

### Completion

**Stagnation guard: disabled.** The stagnation guard (3-consecutive-no-progress break) is not used during approved-plan execution. The plan is human-approved and bounded by 25 steps. Aborting mid-plan because dependency-setup steps don't immediately move the score would break valid plans. `self.consecutive_no_progress` remains in workflow state (removing it requires a versioning change) but is not read or written during `TRANSFORMATION_LOOP` execution.

After the last step (or `abort_plan`): transition to `GENERATING`. `transformation_log` accumulates in the existing format throughout — no change to downstream stages.

### Step ID scoping note

Step IDs (`"step_1"`, `"step_2"`, ...) are scoped to a single plan within a session via `session_id` in the `apply_transformation` call. Two different sessions producing `"step_1"` do not collide. If re-planning is ever added (not in scope for this spec), step IDs for the new plan must use a plan-revision prefix (e.g. `"plan2_step_1"`) to avoid the on-disk idempotency guard silently blocking the re-application of the same logical step.

### Note on Temporal workflow versioning

Modifying the `TRANSFORMATION_LOOP` body and inserting `PLANNING` / `AWAITING_PLAN_APPROVAL` constitutes a non-deterministic change to any in-flight Temporal workflow. In production this requires `workflow.patched()` version guards. This spec does not implement versioning — all existing sessions should be allowed to complete before deploying, or the Temporal namespace reset if this is a dev environment.

---

## New Temporal Signals

| Signal | Payload | Purpose |
|--------|---------|---------|
| `approve_plan` | `{steps: list[dict]}` | Sets `self.plan_decision`; workflow reads and replaces plan steps |
| `resolve_escalation` | `{action: str, instruction?: str}` | Sets `self.escalation_decision`; workflow reads and clears |

**`decide_transformation`** — keep the existing handler registered. Change the body to log a warning and return immediately without writing to `self.transformation_decisions`. The `transformation_decisions` dict is still declared in workflow state (removing it is a versioning concern) but is never read in the new execution loop. Do not remove the dict declaration.

---

## New FastAPI Endpoints

New router: `backend/api/routers/plan_router.py`. Mount with `prefix="/api/v1"` in `main.py` (same pattern as all existing routers). The route paths in the router file itself are `/sessions/{session_id}/plan/approve` and `/sessions/{session_id}/execution/resolve`.

```
POST /api/v1/sessions/{session_id}/plan/approve
  Body:    { steps: TransformPlanStep[] }
  Action:  sends approve_plan Temporal signal
  Returns: { accepted: bool, message: str, steps_count: int }

POST /api/v1/sessions/{session_id}/execution/resolve
  Body:    { action: str, instruction?: str }
  Action:  sends resolve_escalation Temporal signal
  Returns: { accepted: bool, message: str }
```

---

## Frontend

### Stepper

`'plan'` inserted between `'triage'` and `'transform'`. Update the `StageId` type union in `Stepper.tsx` to include `'plan'`. The stepper label is "Plan". The existing completion state calculation (slicing `ORDER` up to the active index) works correctly with the added entry — no other changes to the Stepper component are needed.

### `page.tsx` changes

Add to `STAGE_MAP` (merge with existing entries — do not replace):
```typescript
PLANNING: 'plan',
AWAITING_PLAN_APPROVAL: 'plan',
AWAITING_HUMAN_INPUT: 'transform',
```

Update `WAITING_MESSAGES` (replace the existing `TRANSFORMATION_LOOP` entry; add new entry):
```typescript
TRANSFORMATION_LOOP: 'Executing transform plan...',   // was 'Awaiting transform decision'
AWAITING_HUMAN_INPUT: 'Awaiting your input',
```

Update `ORDER` to include `'plan'`:
```typescript
['load', 'profile', 'rules', 'validate', 'triage', 'plan', 'transform', 'scorecard', 'pipeline']
```

Update `renderStage()`:
```typescript
case 'plan': return <PlanReviewStage session={session!} />
case 'transform': return <ExecutionStage session={session!} />
```

Remove `TransformStage` import. Delete `TransformStage.tsx`.

### `PlanningStage`

Standalone component shown when `session.stage === 'PLANNING'` or `session.transform_plan` is null. Spinner + "AI is building your transformation plan... Investigation progress is visible in the AI panel on the right."

### `PlanReviewStage`

Renders `PlanningStage` internally when `session.stage === 'PLANNING'` or `transform_plan` is null. Renders the editable plan UI when `session.stage === 'AWAITING_PLAN_APPROVAL'`.

**State:**
```typescript
const [editableSteps, setEditableSteps] = useState<TransformPlanStep[]>(
  () => session.transform_plan?.steps ?? []
)
```

**Summary header** — step count, targeted rule count (unique across all `targets_rules`), projected score from the plan: `session.baseline_quality_score → session.transform_plan.projected_final_score`. This value is set by the planning agent and is not recalculated as steps are removed.

**Step cards** — one per step in order, with up/down reorder buttons and a remove button.

Prebuilt card shows: type badge, column, rationale, inline-editable param fields, targets_rules chips, projected delta, depends_on/conflicts_with badges. Param fields are type-aware: number params render as `<input type="number">`; string params render as `<input type="text">`. No client-side validation beyond "field is not empty" — the backend validates at execution time.

Custom card shows: type badge, column, intent text, approach text (both read-only), targets_rules chips, projected delta, depends_on badges. Label: "Code generated at execution time." No editable fields.

Steps with `needs_review=True` show an amber `⚠ params need review` badge.

Removing a step that another step lists in its `depends_on` shows an inline warning on the dependent card: "step_N was removed; this step may be skipped." Does not block approval.

**Sticky approve bar:**
- Projected score: `session.baseline_quality_score + sum(step.projected_score_delta for step in editableSteps)`. This recalculates live as steps are removed — it is the only number in the UI that reflects the human's edits, and is intentionally distinct from `projected_final_score` in the summary header (which is the advisor's original projection). Label it "adjusted projection" to avoid confusion with the header value.
- Approve button disabled only when `editableSteps.length === 0`.

### `ExecutionStage`

Replaces `TransformStage`. Score tracker bar (same gradient pattern as existing `TransformStage`, updates after each `applied` step from `session.current_score`).

Step list: all steps from `session.transform_plan.steps` in order with status badges.
- `applied`: green checkmark, actual delta vs projected. Log entries with `no_effect` render as `applied` with a 0% delta — no separate amber badge (deliberate: `TransformPlanStep.status` does not use `no_effect`).
- `applying`: spinner. Shown on the first step with `status === 'pending'` only when `session.stage === 'TRANSFORMATION_LOOP'` (not during `AWAITING_HUMAN_INPUT` — the spinner clears when paused for escalation).
- `skipped`: muted dash, reason in tooltip. Set for dependency-miss auto-skips.
- `failed`: red X. Set when `skip_step` is taken after `step_failed`/`code_generation_failed`, or after `provide_instruction` retries are exhausted.
- `pending`: muted circle.

**Escalation overlay** — rendered when `session.stage === 'AWAITING_HUMAN_INPUT'` and `session.execution_escalation` is non-null. Floats above the step list.

For `divergence` / `regression`:
- Header: escalation type + step ID
- Description and context values (projected vs actual for divergence; regressed rule IDs for regression)
- Note: "This step has already been applied. You can continue or abort the plan."
- Buttons: Continue Anyway · Abort Plan

For `step_failed` / `code_generation_failed`:
- Header, description, `context.last_error` in monospace block
- Note: "This step was not applied."
- Buttons: Skip Step · Abort Plan
- Expandable "Provide guidance" section: textarea + "Retry with Instruction" button
- After 2 failed retries, the workflow auto-skips the step; UI shows a transient "Auto-skipping after failed retries" message before the next step begins.

### New types (`types.ts`)

Add to `WorkflowStage`: `'PLANNING' | 'AWAITING_PLAN_APPROVAL' | 'AWAITING_HUMAN_INPUT'`

Add interfaces:
```typescript
export interface TransformPlanStep {
  id: string
  type: string
  column?: string
  params: Record<string, unknown>
  custom_code?: string
  rationale: string
  targets_rules: string[]
  depends_on: string[]
  conflicts_with: string[]
  projected_score_delta: number
  needs_review: boolean
  status: 'pending' | 'applied' | 'skipped' | 'failed'
  actual_score_delta?: number
  intent?: string
  target_columns?: string[]
  approach?: string
}

export interface TransformPlan {
  steps: TransformPlanStep[]
  summary: string
  projected_final_score: number
}

export interface ExecutionEscalation {
  type: 'regression' | 'divergence' | 'step_failed' | 'code_generation_failed'
  step_id: string
  description: string
  context: Record<string, unknown>
}
```

Add to `SessionState`:
```typescript
transform_plan?: TransformPlan
execution_escalation?: ExecutionEscalation
```

### New API functions (`api.ts`)

```typescript
export async function approvePlan(
  sessionId: string,
  steps: TransformPlanStep[]
): Promise<{ accepted: boolean; message: string; steps_count: number }>

export async function resolveEscalation(
  sessionId: string,
  action: string,
  instruction?: string
): Promise<{ accepted: boolean; message: string }>
```

---

## Known Implementation Constraints

**On-disk log and `custom_code`:** `apply_transformation` writes its own on-disk log entry (used for idempotency and `load_transformation_log`). That on-disk log format does not include a `custom_code` field in its current schema — do not modify it. The in-memory `self.transformation_log` entry at step 11 sources `custom_code` from `step["custom_code"]` directly, not from `apply_result`. These two logs serve different purposes (on-disk: idempotency + scorecard narrator; in-memory: Temporal query responses + frontend display).

**Score delta on replay through regression escalation:** If a Temporal worker crashes and replays between steps 5 and 11 (scorecard updated but log not yet written), `update_scorecard_activity` reruns and returns a delta of 0 (data unchanged), causing `actual_score_delta` to record 0 instead of the original value. This is an acceptable edge case — it only affects display, not data correctness, and requires a crash at a specific 50ms window.

**Stale plan approval:** The `PlanReviewStage` initialises `editableSteps` once via `useState`. If the user leaves and returns while a plan version change occurs (unlikely since `AWAITING_PLAN_APPROVAL` is a stable wait state), they could approve a stale plan. Mitigate by keying the component on `session.transform_plan` identity or adding a version hash to the plan — not required for the initial implementation.

**`consecutive_no_progress` field:** Retained in workflow state but not read or written during `TRANSFORMATION_LOOP` execution. The reset-to-zero entry in the "Files Changed" workflow row should be read as: "remove the reset call from entry — the field value at execution time is whatever it was at the end of AWAITING_PLAN_APPROVAL."

---

## Files Changed

| File | Change |
|------|--------|
| `backend/temporal/workflows/dq_workflow.py` | New state fields (`transform_plan`, `plan_decision`, `execution_escalation`, `escalation_decision`); new signal handlers (`approve_plan`, `resolve_escalation`); `decide_transformation` no-op'd with warning log; `get_full_state` extended to include `transform_plan` + `execution_escalation`; `PLANNING` + `AWAITING_PLAN_APPROVAL` stages inserted at the existing line-310 `TRANSFORMATION_LOOP` transition (all code paths); rewritten `TRANSFORMATION_LOOP` body; `consecutive_no_progress` reset on execution entry |
| `backend/temporal/activities/transform_activities.py` | Add `plan_transforms_activity`, `generate_custom_code_activity` |
| `backend/agents/graphs/transform_planner.py` | **Create** — `TransformPlanner` graph |
| `backend/agents/graphs/custom_code_generator.py` | **Create** — `CustomCodeGenerator` graph |
| `backend/api/routers/plan_router.py` | **Create** — two endpoints |
| `backend/api/main.py` | Register `plan_router` |
| `frontend/lib/types.ts` | New stages, `TransformPlanStep`, `TransformPlan`, `ExecutionEscalation`; `transform_plan` + `execution_escalation` on `SessionState` |
| `frontend/lib/api.ts` | `approvePlan()`, `resolveEscalation()` |
| `frontend/components/workspace/Stepper.tsx` | Add `'plan'` between `'triage'` and `'transform'` |
| `frontend/app/sessions/[id]/page.tsx` | Add `PLANNING`, `AWAITING_PLAN_APPROVAL`, `AWAITING_HUMAN_INPUT` to `STAGE_MAP`; update `WAITING_MESSAGES`; add `'plan'` to `ORDER`; import + render `PlanReviewStage` + `ExecutionStage`; remove `TransformStage` import |
| `frontend/components/stages/TransformStage.tsx` | **Delete** — verify no other imports with `grep -r "TransformStage" frontend/` before deleting |
| `frontend/components/stages/PlanningStage.tsx` | **Create** |
| `frontend/components/stages/PlanReviewStage.tsx` | **Create** |
| `frontend/components/stages/ExecutionStage.tsx` | **Create** |
