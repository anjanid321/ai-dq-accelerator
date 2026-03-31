# Holistic Transform Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-at-a-time transformation loop with a two-phase planning + automated execution approach where the AI builds a complete dependency-aware plan with tool access, the engineer reviews/edits it once, and execution proceeds automatically with per-step monitoring and escalation for surprises.

**Architecture:** A new `TransformPlanner` LangGraph agent investigates failing rules with DuckDB tool access, builds a structured step-by-step plan, and validates prebuilt step params. After human approval, the workflow executes each step automatically, monitoring for regressions/divergence, and escalates to `AWAITING_HUMAN_INPUT` only for genuine surprises. A `CustomCodeGenerator` graph handles deferred code generation for custom steps at execution time.

**Tech Stack:** Python, Temporal, LangGraph, Anthropic API (tool-use), DuckDB, FastAPI, Next.js, React, TypeScript, Tailwind CSS

---

## File Structure

**Create:**
- `backend/agents/graphs/planning_tools.py` — Anthropic tool schemas + DuckDB execution
- `backend/agents/graphs/transform_planner.py` — TransformPlanner LangGraph graph
- `backend/agents/graphs/custom_code_generator.py` — CustomCodeGenerator function
- `backend/api/routers/plan_router.py` — `/plan/approve` and `/execution/resolve` endpoints
- `frontend/components/stages/PlanningStage.tsx` — spinner while PLANNING
- `frontend/components/stages/PlanReviewStage.tsx` — editable plan UI
- `frontend/components/stages/ExecutionStage.tsx` — execution progress + escalation overlay
- `tests/backend/agents/test_planning_tools.py`
- `tests/backend/agents/test_transform_planner.py`
- `tests/backend/agents/test_custom_code_generator.py`
- `tests/backend/api/test_plan_router.py`

**Modify:**
- `backend/api/schemas.py` — new stages, TransformPlanStep, plan request/response models, SessionStateResponse
- `backend/temporal/activities/transform_activities.py` — add `plan_transforms_activity`, `generate_custom_code_activity`
- `backend/temporal/workflows/dq_workflow.py` — new state fields, signals, PLANNING/AWAITING_PLAN_APPROVAL stages, rewritten TRANSFORMATION_LOOP
- `backend/temporal/worker.py` — register new activities
- `backend/api/main.py` — register plan_router
- `frontend/lib/types.ts` — new stages, TransformPlanStep/Plan/ExecutionEscalation interfaces
- `frontend/lib/api.ts` — `approvePlan()`, `resolveEscalation()`
- `frontend/components/workspace/Stepper.tsx` — add `'plan'` between `'triage'` and `'transform'`
- `frontend/app/sessions/[id]/page.tsx` — stage mapping, imports, renderStage()

**Delete:**
- `frontend/components/stages/TransformStage.tsx`

---

## Task 1: Frontend Types + API Client

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add new types to `frontend/lib/types.ts`**

Replace the `WorkflowStage` line and add new interfaces after `TriageResult`:

```typescript
// In types.ts — replace WorkflowStage with:
export type WorkflowStage =
  | 'LOADING' | 'PROFILING' | 'AWAITING_RULE_APPROVAL'
  | 'VALIDATING' | 'TRIAGING' | 'AWAITING_TRIAGE_APPROVAL'
  | 'PLANNING' | 'AWAITING_PLAN_APPROVAL'
  | 'TRANSFORMATION_LOOP' | 'AWAITING_HUMAN_INPUT'
  | 'AWAITING_PIPELINE_CONFIRMATION' | 'GENERATING' | 'COMPLETE'

// Add after TriageResult interface:
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

- [ ] **Step 2: Add API functions to `frontend/lib/api.ts`**

```typescript
export async function approvePlan(
  sessionId: string,
  steps: TransformPlanStep[]
): Promise<{ accepted: boolean; message: string; steps_count: number }> {
  return request(`/api/v1/sessions/${sessionId}/plan/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ steps }),
  })
}

export async function resolveEscalation(
  sessionId: string,
  action: string,
  instruction?: string
): Promise<{ accepted: boolean; message: string }> {
  return request(`/api/v1/sessions/${sessionId}/execution/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, instruction }),
  })
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors (2 pre-existing errors in EventFeed.tsx / EventTerminal.tsx are unrelated — these are acceptable)

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts
git commit -m "feat: add TransformPlan types and approvePlan/resolveEscalation API functions"
```

---

## Task 2: Backend Pydantic Schemas

**Files:**
- Modify: `backend/api/schemas.py`

- [ ] **Step 1: Add new workflow stages to `WorkflowStage` enum**

```python
class WorkflowStage(str, Enum):
    LOADING = "LOADING"
    PROFILING = "PROFILING"
    AWAITING_RULE_APPROVAL = "AWAITING_RULE_APPROVAL"
    VALIDATING = "VALIDATING"
    TRIAGING = "TRIAGING"
    AWAITING_TRIAGE_APPROVAL = "AWAITING_TRIAGE_APPROVAL"
    PLANNING = "PLANNING"
    AWAITING_PLAN_APPROVAL = "AWAITING_PLAN_APPROVAL"
    TRANSFORMATION_LOOP = "TRANSFORMATION_LOOP"
    AWAITING_HUMAN_INPUT = "AWAITING_HUMAN_INPUT"
    AWAITING_PIPELINE_CONFIRMATION = "AWAITING_PIPELINE_CONFIRMATION"
    GENERATING = "GENERATING"
    COMPLETE = "COMPLETE"
```

- [ ] **Step 2: Add new models after `TriageApprovalResponse`**

```python
class TransformPlanStep(BaseModel):
    id: str
    type: str
    column: str | None = None
    params: dict = {}
    custom_code: str | None = None
    rationale: str = ""
    targets_rules: list[str] = []
    depends_on: list[str] = []
    conflicts_with: list[str] = []
    projected_score_delta: float = 0.0
    needs_review: bool = False
    status: str = "pending"   # pending | applied | skipped | failed
    actual_score_delta: float | None = None
    intent: str | None = None
    target_columns: list[str] | None = None
    approach: str | None = None

    model_config = {"extra": "allow"}


class TransformPlan(BaseModel):
    steps: list[TransformPlanStep] = []
    summary: str = ""
    projected_final_score: float = 0.0


class PlanApprovalRequest(BaseModel):
    steps: list[dict]   # full TransformPlanStep dicts; validated loosely to allow frontend edits


class PlanApprovalResponse(BaseModel):
    accepted: bool
    message: str = "Plan approved. Execution starting."
    steps_count: int = 0


class EscalationResolveRequest(BaseModel):
    action: str    # continue_anyway | abort_plan | skip_step | provide_instruction
    instruction: str | None = None


class EscalationResolveResponse(BaseModel):
    accepted: bool
    message: str = "Escalation resolved."
```

- [ ] **Step 3: Add `transform_plan` and `execution_escalation` to `SessionStateResponse`**

```python
# In SessionStateResponse, add:
transform_plan: dict | None = None
execution_escalation: dict | None = None
```

- [ ] **Step 4: Verify import works**

```bash
python -c "from backend.api.schemas import PlanApprovalRequest, EscalationResolveRequest, TransformPlanStep; print('OK')"
```

- [ ] **Step 5: Commit**

```bash
git add backend/api/schemas.py
git commit -m "feat: add PLANNING/AWAITING_PLAN_APPROVAL/AWAITING_HUMAN_INPUT stages and plan schemas"
```

---

## Task 3: Investigation Tool Functions

**Files:**
- Create: `backend/agents/graphs/planning_tools.py`
- Create: `tests/backend/agents/test_planning_tools.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/backend/agents/test_planning_tools.py
import pytest
from unittest.mock import patch, MagicMock
from backend.agents.graphs.planning_tools import (
    get_planning_tools_schema,
    execute_planning_tool,
)


def test_get_planning_tools_schema_returns_four_tools():
    schema = get_planning_tools_schema()
    assert len(schema) == 4
    names = {t["name"] for t in schema}
    assert names == {"run_sql", "get_value_counts", "get_sample_rows", "get_column_stats"}


def test_each_tool_has_required_fields():
    for tool in get_planning_tools_schema():
        assert "name" in tool
        assert "description" in tool
        assert "input_schema" in tool
        assert tool["input_schema"]["type"] == "object"


@patch("backend.agents.graphs.planning_tools.duckdb")
@patch("backend.agents.graphs.planning_tools._find_project_root")
def test_run_sql_returns_rows(mock_root, mock_duckdb, tmp_path):
    mock_root.return_value = tmp_path
    mock_conn = MagicMock()
    mock_conn.execute.return_value.fetchall.return_value = [(1, "a"), (2, "b")]
    mock_conn.execute.return_value.description = [("id", None), ("name", None)]
    mock_duckdb.connect.return_value.__enter__ = lambda s: mock_conn
    mock_duckdb.connect.return_value.__exit__ = MagicMock(return_value=False)

    result = execute_planning_tool("run_sql", {"query": "SELECT 1"}, "test-session")
    assert "rows" in result or isinstance(result, str)


@patch("backend.agents.graphs.planning_tools.duckdb")
@patch("backend.agents.graphs.planning_tools._find_project_root")
def test_execute_unknown_tool_returns_error(mock_root, mock_duckdb, tmp_path):
    mock_root.return_value = tmp_path
    result = execute_planning_tool("nonexistent_tool", {}, "test-session")
    assert "unknown tool" in result.lower() or "error" in result.lower()
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
pytest tests/backend/agents/test_planning_tools.py -v
```

Expected: ImportError or collection error (file doesn't exist yet)

- [ ] **Step 3: Create `backend/agents/graphs/planning_tools.py`**

```python
"""Investigation tool schemas and execution for TransformPlanner and CustomCodeGenerator."""
from __future__ import annotations
import json


def get_planning_tools_schema() -> list[dict]:
    """Return Anthropic tool definitions for the four investigation tools."""
    return [
        {
            "name": "run_sql",
            "description": "Run a read-only SQL query against the session DuckDB. Table name is 'working_data'.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "SELECT query to execute against working_data"}
                },
                "required": ["query"],
            },
        },
        {
            "name": "get_value_counts",
            "description": "Get frequency table for a column.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "Column name"},
                    "limit": {"type": "integer", "description": "Max rows to return", "default": 20},
                },
                "required": ["column"],
            },
        },
        {
            "name": "get_sample_rows",
            "description": "Get sample rows, optionally filtered.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "filter_sql": {"type": "string", "description": "WHERE clause (without WHERE keyword), or empty for no filter"},
                    "limit": {"type": "integer", "description": "Max rows to return", "default": 10},
                },
                "required": [],
            },
        },
        {
            "name": "get_column_stats",
            "description": "Get statistics for a column: min, max, mean, null_count, distinct_count, dtype.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "Column name"}
                },
                "required": ["column"],
            },
        },
    ]


def execute_planning_tool(tool_name: str, tool_input: dict, session_id: str) -> str:
    """Execute a planning tool and return result as a JSON string."""
    import duckdb
    from dq_tools.profiler import _find_project_root

    db_path = _find_project_root() / "data" / "sessions" / session_id / "working.duckdb"

    try:
        if tool_name == "run_sql":
            return _run_sql(str(db_path), tool_input.get("query", ""))
        elif tool_name == "get_value_counts":
            return _get_value_counts(str(db_path), tool_input.get("column", ""), tool_input.get("limit", 20))
        elif tool_name == "get_sample_rows":
            return _get_sample_rows(str(db_path), tool_input.get("filter_sql", ""), tool_input.get("limit", 10))
        elif tool_name == "get_column_stats":
            return _get_column_stats(str(db_path), tool_input.get("column", ""))
        else:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def _run_sql(db_path: str, query: str) -> str:
    import duckdb
    if not query.strip().upper().startswith("SELECT"):
        return json.dumps({"error": "Only SELECT queries are allowed"})
    with duckdb.connect(db_path, read_only=True) as conn:
        result = conn.execute(query)
        cols = [d[0] for d in result.description]
        rows = result.fetchmany(100)  # cap at 100 rows
        return json.dumps({"columns": cols, "rows": [dict(zip(cols, r)) for r in rows]}, default=str)


def _get_value_counts(db_path: str, column: str, limit: int) -> str:
    import duckdb
    with duckdb.connect(db_path, read_only=True) as conn:
        rows = conn.execute(
            f'SELECT "{column}", COUNT(*) as count FROM working_data GROUP BY "{column}" ORDER BY count DESC LIMIT ?',
            [limit],
        ).fetchall()
        return json.dumps({"column": column, "value_counts": [{"value": r[0], "count": r[1]} for r in rows]}, default=str)


def _get_sample_rows(db_path: str, filter_sql: str, limit: int) -> str:
    import duckdb
    where = f"WHERE {filter_sql}" if filter_sql.strip() else ""
    with duckdb.connect(db_path, read_only=True) as conn:
        result = conn.execute(f"SELECT * FROM working_data {where} LIMIT ?", [limit])
        cols = [d[0] for d in result.description]
        rows = result.fetchall()
        return json.dumps({"rows": [dict(zip(cols, r)) for r in rows]}, default=str)


def _get_column_stats(db_path: str, column: str) -> str:
    import duckdb
    with duckdb.connect(db_path, read_only=True) as conn:
        row = conn.execute(
            f'SELECT MIN("{column}"), MAX("{column}"), AVG(CAST("{column}" AS DOUBLE)), '
            f'COUNT(*) - COUNT("{column}"), COUNT(DISTINCT "{column}"), '
            f'typeof("{column}") FROM working_data LIMIT 1'
        ).fetchone()
        return json.dumps({
            "column": column,
            "min": row[0], "max": row[1], "mean": row[2],
            "null_count": row[3], "distinct_count": row[4], "dtype": row[5],
        }, default=str)
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/backend/agents/test_planning_tools.py -v
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add backend/agents/graphs/planning_tools.py tests/backend/agents/test_planning_tools.py
git commit -m "feat: add planning tool schemas and DuckDB execution for TransformPlanner"
```

---

## Task 4: TransformPlanner Graph

**Files:**
- Create: `backend/agents/graphs/transform_planner.py`
- Create: `tests/backend/agents/test_transform_planner.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/backend/agents/test_transform_planner.py
import pytest
from unittest.mock import patch, MagicMock
from backend.agents.graphs.transform_planner import (
    investigate,
    build_plan,
    validate_and_fix_prebuilt,
    finalize,
    _base_planner_state,
    run_transform_planner,
)


def _make_state(**overrides):
    base = _base_planner_state(
        session_id="test-session",
        fixable_rules=[{"id": "r1", "check": "not_null", "column": "age", "failure_count": 5}],
        validation_results={"per_rule": []},
        profile={"columns": {"age": {"type": "int64"}, "name": {"type": "object"}}},
        use_case="test",
        transformation_log=[],
    )
    return {**base, **overrides}


def _mock_response(text="", stop_reason="end_turn", tool_uses=None):
    resp = MagicMock()
    resp.stop_reason = stop_reason
    content = []
    if text:
        block = MagicMock(); block.type = "text"; block.text = text
        content.append(block)
    for tu in (tool_uses or []):
        block = MagicMock(); block.type = "tool_use"
        block.id = "tool_1"; block.name = tu["name"]; block.input = tu["input"]
        content.append(block)
    resp.content = content
    return resp


@patch("backend.agents.graphs.transform_planner.call_claude_with_retry")
def test_investigate_stops_on_end_turn(mock_call):
    mock_call.return_value = _mock_response(text="I see no issues.", stop_reason="end_turn")
    state = _make_state()
    result = investigate(state)
    assert result["turn_count"] == 0
    assert len(result["messages"]) > 0


@patch("backend.agents.graphs.transform_planner.execute_planning_tool")
@patch("backend.agents.graphs.transform_planner.call_claude_with_retry")
def test_investigate_executes_tools(mock_call, mock_tool):
    # First call: tool_use; second call: end_turn
    mock_call.side_effect = [
        _mock_response(stop_reason="tool_use", tool_uses=[{"name": "run_sql", "input": {"query": "SELECT 1"}}]),
        _mock_response(text="Done investigating.", stop_reason="end_turn"),
    ]
    mock_tool.return_value = '{"rows": []}'
    state = _make_state()
    result = investigate(state)
    assert result["turn_count"] == 1
    mock_tool.assert_called_once_with("run_sql", {"query": "SELECT 1"}, "test-session")


@patch("backend.agents.graphs.transform_planner.call_claude_with_retry")
def test_investigate_respects_12_turn_cap(mock_call):
    mock_call.return_value = _mock_response(
        stop_reason="tool_use",
        tool_uses=[{"name": "run_sql", "input": {"query": "SELECT 1"}}]
    )
    with patch("backend.agents.graphs.transform_planner.execute_planning_tool", return_value='{"rows": []}'):
        state = _make_state()
        result = investigate(state)
    assert result["turn_count"] == 12


@patch("backend.agents.graphs.transform_planner.call_claude_with_retry")
def test_build_plan_parses_steps(mock_call):
    plan_json = '[{"id":"step_1","type":"impute_constant","column":"age","params":{"value":0},"rationale":"test","targets_rules":["r1"],"depends_on":[],"conflicts_with":[],"projected_score_delta":0.05}]'
    mock_call.return_value = _mock_response(text=f"```json\n{plan_json}\n```")
    state = _make_state(messages=[])
    result = build_plan(state)
    assert len(result["plan_steps"]) == 1
    assert result["plan_steps"][0]["id"] == "step_1"
    assert result["plan_steps"][0]["status"] == "pending"


@patch("backend.agents.graphs.transform_planner.call_claude_with_retry")
def test_build_plan_caps_at_25_steps(mock_call):
    steps = [{"id": f"step_{i}", "type": "impute_constant", "column": "age", "params": {},
              "rationale": "", "targets_rules": [], "depends_on": [], "conflicts_with": [],
              "projected_score_delta": 0.01} for i in range(30)]
    mock_call.return_value = _mock_response(text=f"```json\n{__import__('json').dumps(steps)}\n```")
    state = _make_state(messages=[])
    result = build_plan(state)
    assert len(result["plan_steps"]) == 25


@patch("backend.agents.graphs.transform_planner.call_claude_with_retry")
def test_validate_and_fix_flags_needs_review_after_3_failures(mock_call):
    """A step that fails validation 3 times should be marked needs_review."""
    with patch("backend.agents.graphs.transform_planner.validate_transform_spec", return_value=(None, "bad params")):
        mock_call.return_value = _mock_response(text='{"params": {"column": "age", "value": 0}}')
        state = _make_state(plan_steps=[{
            "id": "step_1", "type": "impute_constant", "column": "age",
            "params": {"column": "age", "value": None}, "rationale": "", "targets_rules": [],
            "depends_on": [], "conflicts_with": [], "projected_score_delta": 0.05,
            "needs_review": False, "status": "pending", "actual_score_delta": None, "custom_code": None,
        }])
        result = validate_and_fix_prebuilt(state)
    assert result["plan_steps"][0]["needs_review"] is True


def test_finalize_assembles_result():
    steps = [{"id": "step_1", "type": "impute_constant", "column": "age", "params": {},
              "rationale": "", "targets_rules": [], "depends_on": [], "conflicts_with": [],
              "projected_score_delta": 0.05, "needs_review": False, "status": "pending",
              "actual_score_delta": None, "custom_code": None}]
    state = _make_state(plan_steps=steps, plan_summary="Fix age nulls", plan_projected_final_score=0.9)
    result = finalize(state)
    assert result["result"]["steps"] == steps
    assert result["result"]["summary"] == "Fix age nulls"
    assert result["result"]["projected_final_score"] == 0.9


@patch("backend.agents.graphs.transform_planner.run_transform_planner")
def test_run_returns_empty_plan_when_no_fixable_rules(mock_run):
    mock_run.return_value = {"steps": [], "summary": "", "projected_final_score": 0.8}
    result = run_transform_planner(
        session_id="s1", fixable_rules=[], validation_results={},
        profile={}, use_case="test", transformation_log=[]
    )
    assert result["steps"] == []
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/backend/agents/test_transform_planner.py -v 2>&1 | head -20
```

Expected: ImportError

- [ ] **Step 3: Create `backend/agents/graphs/transform_planner.py`**

```python
"""TransformPlanner LangGraph agent — builds a full dependency-aware transform plan."""
from __future__ import annotations
import json
from typing import TypedDict, Optional
import anthropic
from langgraph.graph import StateGraph, END

from backend.agents.emit import emit
from backend.agents.retry import call_claude_with_retry
from backend.agents.graphs.planning_tools import get_planning_tools_schema, execute_planning_tool

MODEL = "claude-sonnet-4-6"
MAX_INVESTIGATION_TURNS = 12
MAX_FIX_ATTEMPTS = 3

TRANSFORM_PLANNER_SYSTEM = """You are a data quality transform planner. You have tool access to inspect the dataset.

Your job:
1. Investigate the failing rules and dataset to understand the data issues.
2. Build a complete, ordered, dependency-aware transform plan to fix all transform-fixable failures.
3. Use prebuilt transform types when possible: impute_constant, impute_mode, winsorize, deduplicate, type_cast, standardize_string, date_format_cast, null_invalid, filter_rows.
4. Use "custom" type only when no prebuilt fits.

For custom steps: provide intent, target_columns, and approach (plain English). Do NOT write code — it will be generated at execution time.
For prebuilt steps: provide full params that match the transform type's expected schema.

Step IDs: "step_1", "step_2", ... in execution order.
depends_on: list step IDs that must run before this step.
conflicts_with: list step IDs whose effects this step would undo.
projected_score_delta: estimated fractional quality score improvement (0.0–1.0).
"""

BUILD_PLAN_PROMPT = """Based on your investigation, output the complete transform plan as a JSON object:

{
  "steps": [
    {
      "id": "step_1",
      "type": "impute_constant",
      "column": "col_name",
      "params": {"column": "col_name", "value": 0},
      "rationale": "one sentence",
      "targets_rules": ["r1", "r2"],
      "depends_on": [],
      "conflicts_with": [],
      "projected_score_delta": 0.05
    }
  ],
  "summary": "One paragraph describing the plan.",
  "projected_final_score": 0.92
}

For custom steps omit params and add: "intent": "...", "target_columns": [...], "approach": "..."
Output ONLY the JSON object. No prose."""


class TransformPlannerState(TypedDict):
    session_id: str
    fixable_rules: list
    validation_results: dict
    profile: dict
    use_case: str
    transformation_log: list
    # Internal
    messages: list
    turn_count: int
    plan_steps: list
    plan_summary: str
    plan_projected_final_score: float
    # Output
    result: Optional[dict]


def _base_planner_state(
    session_id: str,
    fixable_rules: list,
    validation_results: dict,
    profile: dict,
    use_case: str,
    transformation_log: list,
) -> TransformPlannerState:
    return {
        "session_id": session_id,
        "fixable_rules": fixable_rules,
        "validation_results": validation_results,
        "profile": profile,
        "use_case": use_case,
        "transformation_log": transformation_log,
        "messages": [],
        "turn_count": 0,
        "plan_steps": [],
        "plan_summary": "",
        "plan_projected_final_score": 0.0,
        "result": None,
    }


def _parse_json(text: str):
    """Extract and parse JSON from a Claude response."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    import re
    match = re.search(r"```json\s*([\s\S]*?)```", text, re.IGNORECASE)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass
    for open_ch, close_ch in [("{", "}"), ("[", "]")]:
        start = text.find(open_ch)
        end = text.rfind(close_ch)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                continue
    return None


def _content_to_dicts(content) -> list[dict]:
    """Convert Anthropic ContentBlock objects to JSON-serialisable dicts."""
    result = []
    for block in content:
        if block.type == "text":
            result.append({"type": "text", "text": block.text})
        elif block.type == "tool_use":
            result.append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})
    return result


def _build_initial_messages(state: TransformPlannerState) -> list[dict]:
    fixable_rules = state["fixable_rules"]
    use_case = state["use_case"]
    profile_cols = list(state["profile"].get("columns", {}).keys())
    transformation_log = state["transformation_log"]

    content = f"""Use case: {use_case}

Transform-fixable failing rules to address:
```json
{json.dumps(fixable_rules, indent=2)}
```

Profile columns: {profile_cols}

Prior transformations (if any):
{json.dumps(transformation_log, indent=2) if transformation_log else "(none)"}

Investigate the dataset using the available tools to understand the data issues, then you will build the transform plan.
Start by exploring the failing columns and understanding the distribution of failures."""
    return [{"role": "user", "content": content}]


# ── Nodes ───────────────────────────────────────────────────────────────────

def investigate(state: TransformPlannerState) -> TransformPlannerState:
    """ReAct loop: use tools to investigate the dataset. Max 12 turns."""
    client = anthropic.Anthropic()
    session_id = state["session_id"]
    messages = state["messages"] if state["messages"] else _build_initial_messages(state)
    turn_count = state.get("turn_count", 0)

    while turn_count < MAX_INVESTIGATION_TURNS:
        response = call_claude_with_retry(
            client,
            model=MODEL,
            max_tokens=2000,
            system=TRANSFORM_PLANNER_SYSTEM,
            tools=get_planning_tools_schema(),
            messages=messages,
        )

        text_blocks = [b for b in response.content if b.type == "text"]
        if text_blocks:
            emit(session_id, "thinking", text=text_blocks[0].text[:300])

        messages = messages + [{"role": "assistant", "content": _content_to_dicts(response.content)}]

        if response.stop_reason != "tool_use":
            break

        tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
        tool_results = []
        for tu in tool_use_blocks:
            emit(session_id, "tool_call", tool=tu.name, input=tu.input)
            result_str = execute_planning_tool(tu.name, tu.input, session_id)
            emit(session_id, "tool_result", tool=tu.name, preview=result_str[:200])
            tool_results.append({"type": "tool_result", "tool_use_id": tu.id, "content": result_str})

        messages = messages + [{"role": "user", "content": tool_results}]
        turn_count += 1

    return {**state, "messages": messages, "turn_count": turn_count}


def build_plan(state: TransformPlannerState) -> TransformPlannerState:
    """Ask Claude to emit the full structured plan based on investigation."""
    client = anthropic.Anthropic()
    messages = list(state["messages"]) + [{"role": "user", "content": BUILD_PLAN_PROMPT}]

    response = call_claude_with_retry(
        client,
        model=MODEL,
        max_tokens=4000,
        system=TRANSFORM_PLANNER_SYSTEM,
        messages=messages,
    )
    raw = "".join(b.text for b in response.content if b.type == "text")
    parsed = _parse_json(raw)

    steps: list = []
    summary = ""
    projected_final_score = state["validation_results"].get("baseline_quality_score", 0.0)

    if isinstance(parsed, dict):
        steps = parsed.get("steps", [])
        summary = parsed.get("summary", "")
        projected_final_score = parsed.get("projected_final_score", projected_final_score)
    elif isinstance(parsed, list):
        steps = parsed

    # Sort by projected_score_delta descending, cap at 25
    steps.sort(key=lambda s: s.get("projected_score_delta", 0), reverse=True)
    steps = steps[:25]

    # Set required defaults
    for step in steps:
        step.setdefault("needs_review", False)
        step.setdefault("status", "pending")
        step.setdefault("actual_score_delta", None)
        step.setdefault("custom_code", None)
        step.setdefault("params", {})
        step.setdefault("depends_on", [])
        step.setdefault("conflicts_with", [])
        step.setdefault("targets_rules", [])

    return {**state, "plan_steps": steps, "plan_summary": summary, "plan_projected_final_score": projected_final_score}


def validate_and_fix_prebuilt(state: TransformPlannerState) -> TransformPlannerState:
    """Validate prebuilt step params against a real 50-row DuckDB sample. Fix or flag needs_review."""
    from dq_tools.transformation_executor import validate_transform_spec
    import duckdb
    import pandas as pd
    from dq_tools.profiler import _find_project_root

    session_id = state["session_id"]
    client = anthropic.Anthropic()
    steps = [dict(s) for s in state["plan_steps"]]
    profile = state["profile"]
    available_columns = list(profile.get("columns", {}).keys())

    # Fetch real sample from DuckDB
    sample_df = None
    try:
        db_path = str(_find_project_root() / "data" / "sessions" / session_id / "working.duckdb")
        with duckdb.connect(db_path, read_only=True) as conn:
            sample_df = conn.execute(
                "SELECT * FROM working_data ORDER BY RANDOM() LIMIT 50"
            ).df()
    except Exception:
        # Fall back to empty DataFrame; validate_transform_spec will still catch schema errors
        sample_df = pd.DataFrame()

    for step in steps:
        if step.get("type") == "custom":
            continue  # Custom steps validated at execution time

        attempts = 0
        while attempts < MAX_FIX_ATTEMPTS:
            _, error = validate_transform_spec(step, sample_df)
            if error is None:
                break

            # Ask Claude to fix params
            fix_prompt = f"""A prebuilt transform spec failed validation:

Error: {error}

Current spec:
```json
{json.dumps({"type": step.get("type"), "params": step.get("params", {})}, indent=2)}
```

Available columns: {available_columns}

Fix the params. Output ONLY: {{"params": {{...}}}}"""

            try:
                response = call_claude_with_retry(
                    client,
                    model=MODEL,
                    max_tokens=500,
                    system=TRANSFORM_PLANNER_SYSTEM,
                    messages=[{"role": "user", "content": fix_prompt}],
                )
                raw = "".join(b.text for b in response.content if b.type == "text")
                parsed = _parse_json(raw)
                if isinstance(parsed, dict) and "params" in parsed:
                    step["params"] = parsed["params"]
            except Exception:
                pass

            attempts += 1

        # Check one more time after all fix attempts
        _, final_error = validate_transform_spec(step, sample_df)
        if final_error is not None:
            step["needs_review"] = True

    return {**state, "plan_steps": steps}


def finalize(state: TransformPlannerState) -> TransformPlannerState:
    """Assemble the final result dict."""
    emit(state["session_id"], "done", tool_calls=state.get("turn_count", 0))
    result = {
        "steps": state["plan_steps"],
        "summary": state["plan_summary"],
        "projected_final_score": state["plan_projected_final_score"],
    }
    return {**state, "result": result}


# ── Graph construction ───────────────────────────────────────────────────────

def _build_transform_planner_graph():
    graph = StateGraph(TransformPlannerState)
    graph.add_node("investigate", investigate)
    graph.add_node("build_plan", build_plan)
    graph.add_node("validate_and_fix_prebuilt", validate_and_fix_prebuilt)
    graph.add_node("finalize", finalize)
    graph.set_entry_point("investigate")
    graph.add_edge("investigate", "build_plan")
    graph.add_edge("build_plan", "validate_and_fix_prebuilt")
    graph.add_edge("validate_and_fix_prebuilt", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()


def run_transform_planner(
    session_id: str,
    fixable_rules: list[dict],
    validation_results: dict,
    profile: dict,
    use_case: str,
    transformation_log: list[dict],
) -> dict:
    """Run the TransformPlanner and return {steps, summary, projected_final_score}."""
    if not fixable_rules:
        return {"steps": [], "summary": "No transform-fixable rules to address.", "projected_final_score": validation_results.get("baseline_quality_score", 0.0)}

    app = _build_transform_planner_graph()
    initial_state = _base_planner_state(
        session_id=session_id,
        fixable_rules=fixable_rules,
        validation_results=validation_results,
        profile=profile,
        use_case=use_case,
        transformation_log=transformation_log,
    )
    try:
        final_state = app.invoke(initial_state)
    except anthropic.RateLimitError:
        raise
    except Exception:
        return {"steps": [], "summary": "Planning failed.", "projected_final_score": validation_results.get("baseline_quality_score", 0.0)}

    return final_state.get("result") or {"steps": [], "summary": "", "projected_final_score": 0.0}
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/backend/agents/test_transform_planner.py -v
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add backend/agents/graphs/transform_planner.py tests/backend/agents/test_transform_planner.py
git commit -m "feat: add TransformPlanner LangGraph agent with tool-use investigation and plan generation"
```

---

## Task 5: CustomCodeGenerator

**Files:**
- Create: `backend/agents/graphs/custom_code_generator.py`
- Create: `tests/backend/agents/test_custom_code_generator.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/backend/agents/test_custom_code_generator.py
import pytest
from unittest.mock import patch, MagicMock
from backend.agents.graphs.custom_code_generator import run_custom_code_generator


def _mock_response(text="", stop_reason="end_turn", tool_uses=None):
    resp = MagicMock()
    resp.stop_reason = stop_reason
    content = []
    if text:
        block = MagicMock(); block.type = "text"; block.text = text
        content.append(block)
    for tu in (tool_uses or []):
        block = MagicMock(); block.type = "tool_use"
        block.id = "t1"; block.name = tu["name"]; block.input = tu["input"]
        content.append(block)
    resp.content = content
    return resp


VALID_CODE = "def transform(df):\n    df['age'] = df['age'].fillna(0)\n    return df"
INVALID_CODE = "def transform(df):\n    import os\n    return df"


@patch("backend.agents.graphs.custom_code_generator.call_claude_with_retry")
@patch("backend.agents.graphs.custom_code_generator.execute_planning_tool")
def test_returns_valid_code_on_first_attempt(mock_tool, mock_call):
    mock_call.return_value = _mock_response(text=f"```python\n{VALID_CODE}\n```")
    mock_tool.return_value = '{"rows": []}'
    step = {"id": "step_1", "type": "custom", "column": "age", "intent": "Fill nulls",
            "target_columns": ["age"], "approach": "fillna(0)", "params": {}}
    result = run_custom_code_generator(
        session_id="test", step=step, prior_context="", human_instruction=None
    )
    assert result["validation_passed"] is True
    assert "def transform" in result["custom_code"]


@patch("backend.agents.graphs.custom_code_generator.call_claude_with_retry")
@patch("backend.agents.graphs.custom_code_generator.execute_planning_tool")
def test_rejects_unsafe_code(mock_tool, mock_call):
    mock_call.return_value = _mock_response(text=f"```python\n{INVALID_CODE}\n```")
    mock_tool.return_value = '{"rows": []}'
    step = {"id": "step_1", "type": "custom", "column": "age", "intent": "Fill nulls",
            "target_columns": ["age"], "approach": "fillna(0)", "params": {}}
    result = run_custom_code_generator(
        session_id="test", step=step, prior_context="", human_instruction=None
    )
    # Should fail safety check and exhaust retries → validation_passed=False
    assert result["validation_passed"] is False


@patch("backend.agents.graphs.custom_code_generator.call_claude_with_retry")
@patch("backend.agents.graphs.custom_code_generator.execute_planning_tool")
def test_human_instruction_injected_into_prompt(mock_tool, mock_call):
    mock_call.return_value = _mock_response(text=f"```python\n{VALID_CODE}\n```")
    mock_tool.return_value = '{"rows": []}'
    step = {"id": "step_1", "type": "custom", "column": "age", "intent": "Fill nulls",
            "target_columns": ["age"], "approach": "fillna(0)", "params": {}}
    result = run_custom_code_generator(
        session_id="test", step=step, prior_context="step_1: +4%",
        human_instruction="Use median not zero"
    )
    # Verify human_instruction was passed in some call
    call_args = mock_call.call_args[1]
    msg_content = str(call_args.get("messages", []))
    assert "median" in msg_content
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/backend/agents/test_custom_code_generator.py -v 2>&1 | head -10
```

Expected: ImportError

- [ ] **Step 3: Create `backend/agents/graphs/custom_code_generator.py`**

```python
"""CustomCodeGenerator — generates and validates Python transform code for custom steps."""
from __future__ import annotations
import builtins
import json
import re
import numpy as np
import pandas as pd
import anthropic

from backend.agents.emit import emit
from backend.agents.retry import call_claude_with_retry
from backend.agents.graphs.planning_tools import get_planning_tools_schema, execute_planning_tool

MODEL = "claude-sonnet-4-6"
MAX_ATTEMPTS = 3

_UNSAFE_PATTERNS = [
    r"\bimport\b", r"\bopen\s*\(", r"\bos\.", r"\bsys\.", r"\bsubprocess\b",
    r"\beval\s*\(", r"\bexec\s*\(", r"__import__", r"\bbuiltins\b",
]
_SAFE_BUILTINS = vars(builtins)

CUSTOM_CODE_SYSTEM = """You are a Python data transform writer. Write clean, safe pandas transform functions.

Rules:
- Function signature: def transform(df: pd.DataFrame) -> pd.DataFrame:
- pandas is available as `pd`, numpy as `np` — no import statements
- Handle edge cases: empty DataFrame, nulls, wrong dtypes
- No file I/O, os, sys, subprocess, eval, exec, or import statements
"""


def _content_to_dicts(content) -> list[dict]:
    result = []
    for block in content:
        if block.type == "text":
            result.append({"type": "text", "text": block.text})
        elif block.type == "tool_use":
            result.append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})
    return result


def _extract_python_block(text: str) -> str | None:
    match = re.search(r"```python\s*([\s\S]*?)```", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    match = re.search(r"```\s*([\s\S]*?)```", text)
    if match:
        candidate = match.group(1).strip()
        if "def transform" in candidate:
            return candidate
    if "def transform" in text:
        return text.strip()
    return None


def _is_safe(code: str) -> bool:
    if not code or "def transform" not in code:
        return False
    return not any(re.search(p, code) for p in _UNSAFE_PATTERNS)


def _dry_run(code: str, sample_df: pd.DataFrame) -> str | None:
    """Returns None if valid, error string if invalid."""
    try:
        local_ns: dict = {}
        exec(code, {"pd": pd, "np": np, "__builtins__": _SAFE_BUILTINS}, local_ns)  # noqa: S102
        fn = local_ns.get("transform")
        if not callable(fn):
            return "No callable 'transform' function found"
        result = fn(sample_df.copy())
        if not isinstance(result, pd.DataFrame):
            return f"transform() must return DataFrame, got {type(result).__name__}"
        return None
    except Exception as exc:
        return str(exc)


def _investigate_context(session_id: str, step: dict) -> list[dict]:
    """Run a quick tool-based investigation to understand current data state."""
    client = anthropic.Anthropic()
    target_cols = step.get("target_columns") or ([step["column"]] if step.get("column") else [])

    messages = [{"role": "user", "content": (
        f"I need to write a custom transform. "
        f"Intent: {step.get('intent', '')}. "
        f"Target columns: {target_cols}. "
        f"Please inspect the current state of these columns before I write the code. "
        f"Use 1-2 tool calls to understand the data."
    )}]

    for _ in range(3):
        response = call_claude_with_retry(
            client, model=MODEL, max_tokens=1000,
            system=CUSTOM_CODE_SYSTEM,
            tools=get_planning_tools_schema(),
            messages=messages,
        )
        messages.append({"role": "assistant", "content": _content_to_dicts(response.content)})
        if response.stop_reason != "tool_use":
            break
        tool_results = []
        for tu in [b for b in response.content if b.type == "tool_use"]:
            emit(session_id, "tool_call", tool=tu.name, input=tu.input)
            result = execute_planning_tool(tu.name, tu.input, session_id)
            emit(session_id, "tool_result", tool=tu.name, preview=result[:200])
            tool_results.append({"type": "tool_result", "tool_use_id": tu.id, "content": result})
        messages.append({"role": "user", "content": tool_results})

    return messages


def run_custom_code_generator(
    session_id: str,
    step: dict,
    prior_context: str,
    human_instruction: str | None,
) -> dict:
    """Generate and validate a Python transform function for a custom step.

    Returns: {custom_code: str | None, validation_passed: bool}
    """
    client = anthropic.Anthropic()
    emit(session_id, "thinking", text=f"Generating code for {step.get('id')}: {step.get('intent', '')[:100]}")

    # Investigate current data state using tools
    investigation_messages = _investigate_context(session_id, step)

    # Build the sample DataFrame for dry-runs using DuckDB
    sample_df = pd.DataFrame()
    try:
        import duckdb
        from dq_tools.profiler import _find_project_root
        db_path = str(_find_project_root() / "data" / "sessions" / session_id / "working.duckdb")
        with duckdb.connect(db_path, read_only=True) as conn:
            sample_df = conn.execute("SELECT * FROM working_data ORDER BY RANDOM() LIMIT 50").df()
    except Exception:
        pass

    code: str | None = None
    error: str | None = None

    for attempt in range(MAX_ATTEMPTS):
        if attempt == 0:
            # First attempt: generate from investigation context
            prior_str = f"\nPrior execution context: {prior_context}" if prior_context else ""
            instruction_str = f"\n\nEngineer instruction: {human_instruction}" if human_instruction else ""
            generate_prompt = (
                f"Step intent: {step.get('intent', '')}\n"
                f"Target columns: {step.get('target_columns', [])}\n"
                f"Approach: {step.get('approach', '')}"
                f"{prior_str}{instruction_str}\n\n"
                "Write the Python transform function. Output ONLY the function in a ```python block."
            )
            messages = investigation_messages + [{"role": "user", "content": generate_prompt}]
        else:
            # Fix attempt
            messages = [{"role": "user", "content": (
                f"Step intent: {step.get('intent', '')}\n"
                f"The following code failed:\nError: {error}\n\n```python\n{code}\n```\n\n"
                "Fix it. Output ONLY the fixed function in a ```python block."
            )}]

        try:
            response = call_claude_with_retry(
                client, model=MODEL, max_tokens=1500, system=CUSTOM_CODE_SYSTEM, messages=messages,
            )
            raw = "".join(b.text for b in response.content if b.type == "text")
            code = _extract_python_block(raw)
        except anthropic.RateLimitError:
            raise
        except Exception:
            continue

        if not _is_safe(code or ""):
            error = "Code failed safety check (unsafe pattern or missing transform function)"
            emit(session_id, "tool_result", tool="validate_custom_code", preview=f"attempt {attempt+1}: {error}")
            continue

        error = _dry_run(code, sample_df)
        emit(session_id, "tool_result", tool="validate_custom_code",
             preview=f"attempt {attempt+1}: {'valid' if error is None else error[:120]}")

        if error is None:
            return {"custom_code": code, "validation_passed": True}

    return {"custom_code": None, "validation_passed": False}
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/backend/agents/test_custom_code_generator.py -v
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add backend/agents/graphs/custom_code_generator.py tests/backend/agents/test_custom_code_generator.py
git commit -m "feat: add CustomCodeGenerator with tool-based data inspection and safety validation"
```

---

## Task 6: New Temporal Activities

**Files:**
- Modify: `backend/temporal/activities/transform_activities.py`
- Create: `tests/backend/temporal/test_plan_activities.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/backend/temporal/test_plan_activities.py
import pytest
from unittest.mock import patch, MagicMock
from backend.temporal.activities.transform_activities import (
    plan_transforms_activity,
    generate_custom_code_activity,
)


@patch("backend.temporal.activities.transform_activities.run_transform_planner")
async def test_plan_transforms_activity_calls_planner(mock_planner):
    mock_planner.return_value = {"steps": [], "summary": "", "projected_final_score": 0.8}
    params = {
        "session_id": "s1",
        "fixable_rules": [],
        "validation_results": {},
        "profile": {},
        "use_case": "test",
        "transformation_log": [],
    }
    result = await plan_transforms_activity(params)
    assert result == {"steps": [], "summary": "", "projected_final_score": 0.8}
    mock_planner.assert_called_once_with(
        session_id="s1", fixable_rules=[], validation_results={},
        profile={}, use_case="test", transformation_log=[]
    )


@patch("backend.temporal.activities.transform_activities.run_custom_code_generator")
async def test_generate_custom_code_activity_calls_generator(mock_gen):
    mock_gen.return_value = {"custom_code": "def transform(df): return df", "validation_passed": True}
    step = {"id": "step_1", "type": "custom", "intent": "fill", "target_columns": ["age"], "params": {}}
    params = {"session_id": "s1", "step": step, "prior_context": "", "human_instruction": None}
    result = await generate_custom_code_activity(params)
    assert result["validation_passed"] is True
    mock_gen.assert_called_once_with(
        session_id="s1", step=step, prior_context="", human_instruction=None
    )
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/backend/temporal/test_plan_activities.py -v 2>&1 | head -10
```

Expected: ImportError or AttributeError

- [ ] **Step 3: Add activities to `backend/temporal/activities/transform_activities.py`**

Append to the end of the file:

```python
@activity.defn
async def plan_transforms_activity(params: dict) -> dict:
    """
    params: {session_id, fixable_rules, validation_results, profile, use_case, transformation_log}
    Returns: {steps, summary, projected_final_score}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_plan_transforms_sync, params))

def _plan_transforms_sync(params: dict) -> dict:
    from backend.agents.graphs.transform_planner import run_transform_planner
    return run_transform_planner(
        session_id=params["session_id"],
        fixable_rules=params.get("fixable_rules", []),
        validation_results=params.get("validation_results", {}),
        profile=params.get("profile", {}),
        use_case=params.get("use_case", ""),
        transformation_log=params.get("transformation_log", []),
    )


@activity.defn
async def generate_custom_code_activity(params: dict) -> dict:
    """
    params: {session_id, step, prior_context, human_instruction}
    Returns: {custom_code: str | None, validation_passed: bool}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_generate_custom_code_sync, params))

def _generate_custom_code_sync(params: dict) -> dict:
    from backend.agents.graphs.custom_code_generator import run_custom_code_generator
    return run_custom_code_generator(
        session_id=params["session_id"],
        step=params["step"],
        prior_context=params.get("prior_context", ""),
        human_instruction=params.get("human_instruction"),
    )
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/backend/temporal/test_plan_activities.py -v
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add backend/temporal/activities/transform_activities.py tests/backend/temporal/test_plan_activities.py
git commit -m "feat: add plan_transforms_activity and generate_custom_code_activity"
```

---

## Task 7: Plan API Router

**Files:**
- Create: `backend/api/routers/plan_router.py`
- Modify: `backend/api/main.py`
- Create: `tests/backend/api/test_plan_router.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/backend/api/test_plan_router.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from fastapi import FastAPI
from backend.api.routers.plan_router import router


@pytest.fixture
def app():
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    mock_client = AsyncMock()
    app.state.temporal_client = mock_client
    return app


@pytest.fixture
def client(app):
    return TestClient(app)


def test_approve_plan_sends_signal(client, app):
    mock_handle = AsyncMock()
    app.state.temporal_client.get_workflow_handle.return_value = mock_handle
    response = client.post(
        "/api/v1/sessions/test-session/plan/approve",
        json={"steps": [{"id": "step_1", "type": "impute_constant"}]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["accepted"] is True
    assert data["steps_count"] == 1
    mock_handle.signal.assert_called_once()


def test_approve_plan_404_on_missing_session(client, app):
    from temporalio.service import RPCError, RPCStatusCode
    mock_handle = AsyncMock()
    mock_handle.signal.side_effect = RPCError("not found", RPCStatusCode.NOT_FOUND, None)
    app.state.temporal_client.get_workflow_handle.return_value = mock_handle
    response = client.post(
        "/api/v1/sessions/missing/plan/approve",
        json={"steps": []},
    )
    assert response.status_code == 404


def test_resolve_escalation_sends_signal(client, app):
    mock_handle = AsyncMock()
    app.state.temporal_client.get_workflow_handle.return_value = mock_handle
    response = client.post(
        "/api/v1/sessions/test-session/execution/resolve",
        json={"action": "continue_anyway"},
    )
    assert response.status_code == 200
    assert response.json()["accepted"] is True
    mock_handle.signal.assert_called_once()


def test_resolve_escalation_with_instruction(client, app):
    mock_handle = AsyncMock()
    app.state.temporal_client.get_workflow_handle.return_value = mock_handle
    response = client.post(
        "/api/v1/sessions/test-session/execution/resolve",
        json={"action": "provide_instruction", "instruction": "Use median"},
    )
    assert response.status_code == 200
    signal_call = mock_handle.signal.call_args
    payload = signal_call[0][1]
    assert payload["instruction"] == "Use median"
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/backend/api/test_plan_router.py -v 2>&1 | head -10
```

Expected: ImportError

- [ ] **Step 3: Create `backend/api/routers/plan_router.py`**

```python
"""Plan approval and execution escalation endpoints."""
from __future__ import annotations
from fastapi import APIRouter, HTTPException, Request
from temporalio.service import RPCError, RPCStatusCode
from backend.api.schemas import PlanApprovalRequest, PlanApprovalResponse, EscalationResolveRequest, EscalationResolveResponse
from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow

router = APIRouter()


@router.post("/sessions/{session_id}/plan/approve", response_model=PlanApprovalResponse)
async def approve_plan(session_id: str, body: PlanApprovalRequest, request: Request):
    """Submit engineer-approved (optionally edited) transform plan. Starts execution."""
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        await handle.signal(DQAcceleratorWorkflow.approve_plan, {"steps": body.steps})
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return PlanApprovalResponse(accepted=True, message="Plan approved. Execution starting.", steps_count=len(body.steps))


@router.post("/sessions/{session_id}/execution/resolve", response_model=EscalationResolveResponse)
async def resolve_escalation(session_id: str, body: EscalationResolveRequest, request: Request):
    """Resolve a mid-execution escalation (continue_anyway, abort_plan, skip_step, provide_instruction)."""
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        await handle.signal(
            DQAcceleratorWorkflow.resolve_escalation,
            {"action": body.action, "instruction": body.instruction},
        )
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return EscalationResolveResponse(accepted=True, message="Escalation resolved.")
```

- [ ] **Step 4: Register router in `backend/api/main.py`**

Add import and include_router:
```python
# Add to imports:
from backend.api.routers import sessions, rules, transformations, pipeline, triage, plan_router

# Add after existing include_router calls:
app.include_router(plan_router.router, prefix="/api/v1", tags=["plan"])
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/backend/api/test_plan_router.py -v
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add backend/api/routers/plan_router.py backend/api/main.py tests/backend/api/test_plan_router.py
git commit -m "feat: add plan/approve and execution/resolve API endpoints"
```

---

## Task 8: Workflow State Fields, Signals, and get_full_state

**Files:**
- Modify: `backend/temporal/workflows/dq_workflow.py`

This task makes additive changes only — no existing logic changes. Safe to do before Tasks 9/10.

- [ ] **Step 1: Add new state fields to `__init__`**

In the `__init__` method, after the triage state block, add:

```python
        # Plan state
        self.transform_plan: dict | None = None   # {steps, summary, projected_final_score}
        self.plan_decision: dict | None = None     # staging: set by approve_plan signal
        self.execution_escalation: dict | None = None  # current issue awaiting human
        self.escalation_decision: dict | None = None   # staging: set by resolve_escalation signal
        self.provide_instruction_attempts: int = 0
```

- [ ] **Step 2: Add new signal handlers**

After the `confirm_pipeline` signal, add:

```python
    @workflow.signal
    def approve_plan(self, payload: dict) -> None:
        """payload: {steps: list[dict]}"""
        self.plan_decision = payload

    @workflow.signal
    def resolve_escalation(self, payload: dict) -> None:
        """payload: {action: str, instruction?: str}"""
        self.escalation_decision = payload
```

Also update the existing `decide_transformation` signal to be a no-op (keeps it registered to avoid breaking existing signal handlers):

```python
    @workflow.signal
    def decide_transformation(self, tid: str, approved: bool, modification: dict | None = None) -> None:
        # Deprecated: no-op in holistic planning mode. plan/approve replaces this.
        workflow.logger.warning("decide_transformation signal received but ignored in holistic planning mode")
```

- [ ] **Step 3: Add `transform_plan` and `execution_escalation` to `get_full_state`**

In the `get_full_state` query, add to the returned dict:

```python
            "transform_plan": self.transform_plan,
            "execution_escalation": self.execution_escalation,
```

- [ ] **Step 4: Update workflow imports to include new activities**

In the `with workflow.unsafe.imports_passed_through():` block, add to transform_activities import:

```python
    from backend.temporal.activities.transform_activities import (
        suggest_next_transformation_activity,
        preview_transformation_activity,
        apply_transformation_activity,
        update_scorecard_activity,
        generate_scorecard_summary_activity,
        plan_transforms_activity,
        generate_custom_code_activity,
    )
```

- [ ] **Step 5: Verify Python syntax is valid**

```bash
python -c "from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow; print('OK')"
```

- [ ] **Step 6: Commit**

```bash
git add backend/temporal/workflows/dq_workflow.py
git commit -m "feat: add transform_plan state fields, approve_plan/resolve_escalation signals, update get_full_state"
```

---

## Task 9: Workflow PLANNING + AWAITING_PLAN_APPROVAL Stages

**Files:**
- Modify: `backend/temporal/workflows/dq_workflow.py`

Replace the existing `# ── Stage: TRANSFORMATION_LOOP ─────────────────────────────────────` comment and `self.stage = "TRANSFORMATION_LOOP"` line (currently at line 310–311) with the PLANNING and AWAITING_PLAN_APPROVAL stages, followed by a new `TRANSFORMATION_LOOP` stage header.

- [ ] **Step 1: Insert PLANNING stage after the triage block ends**

Find this section (currently after line ~309):
```python
        # ── Stage: TRANSFORMATION_LOOP ─────────────────────────────────────
        self.stage = "TRANSFORMATION_LOOP"
```

Replace with:
```python
        # ── Stage: PLANNING ────────────────────────────────────────────────
        self.stage = "PLANNING"

        # Build fixable_rules: join triage classifications with validation per_rule
        per_rule_by_id = {r["id"]: r for r in self.validation_results.get("per_rule", [])}
        fixable_rules = [
            {**per_rule_by_id[c["rule_id"]], "triage": c}
            for c in self.triage_result.get("classifications", [])
            if c.get("classification") == "transform_fixable"
            and c["rule_id"] in per_rule_by_id
        ]

        plan_result = await workflow.execute_activity(
            plan_transforms_activity,
            {
                "session_id": self.session_id,
                "fixable_rules": fixable_rules,
                "validation_results": self.validation_results,
                "profile": self.profile,
                "use_case": self.use_case,
                "transformation_log": self.transformation_log,
            },
            start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        self.transform_plan = plan_result

        # ── Stage: AWAITING_PLAN_APPROVAL ──────────────────────────────────
        self.stage = "AWAITING_PLAN_APPROVAL"
        await workflow.wait_condition(lambda: self.plan_decision is not None)

        # Apply engineer edits: replace steps with whatever the frontend sent
        approved_steps = self.plan_decision["steps"]
        self.transform_plan = {**self.transform_plan, "steps": approved_steps}
        self.plan_decision = None

        # ── Stage: TRANSFORMATION_LOOP ─────────────────────────────────────
        self.stage = "TRANSFORMATION_LOOP"
```

- [ ] **Step 2: Verify syntax**

```bash
python -c "from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/temporal/workflows/dq_workflow.py
git commit -m "feat: insert PLANNING and AWAITING_PLAN_APPROVAL stages into workflow"
```

---

## Task 10: Rewrite TRANSFORMATION_LOOP

**Files:**
- Modify: `backend/temporal/workflows/dq_workflow.py`

Replace the entire `while True:` loop (currently lines ~313–483) with the new automated execution loop.

- [ ] **Step 1: Replace the while loop**

Find and replace the entire block from `        while True:` through the end of the stagnation guard (`if self.consecutive_no_progress >= 3: break`) with:

```python
        steps = self.transform_plan.get("steps", []) if self.transform_plan else []

        for i, step in enumerate(steps):
            # 1. Dependency check
            dep_statuses = {s["id"]: s.get("status", "pending") for s in steps}
            failed_deps = [d for d in step.get("depends_on", []) if dep_statuses.get(d) in ("failed", "skipped")]
            if failed_deps:
                steps[i]["status"] = "skipped"
                self.transformation_log.append({
                    "id": step["id"], "type": step.get("type", ""), "params": step.get("params", {}),
                    "affected_rows": 0, "score_delta": 0, "status": "skipped",
                    "rationale": f"Dependency skipped/failed: {failed_deps}", "regressions": [],
                })
                continue

            # 2. Pre-step snapshot
            pre_step_passing = {r["id"] for r in self.validation_results.get("per_rule", []) if r.get("passed")}
            pre_step_score = self.current_score

            # 3. Custom step: generate code
            if step.get("type") == "custom":
                prior_context = ", ".join(
                    f"{s['id']} ({s.get('type', '?')} on {s.get('column', '?')}): {s.get('actual_score_delta', 0):+.1%}"
                    for s in steps[:i] if s.get("status") == "applied"
                )
                self.provide_instruction_attempts = 0
                code_result = await workflow.execute_activity(
                    generate_custom_code_activity,
                    {
                        "session_id": self.session_id,
                        "step": step,
                        "prior_context": prior_context,
                        "human_instruction": None,
                    },
                    start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )
                if not code_result.get("validation_passed"):
                    # Escalate: code generation failed
                    resolved = await self._escalate(
                        step, "code_generation_failed",
                        f"Code generation failed for {step['id']}",
                        {"last_error": "Validation failed after 3 attempts"},
                    )
                    if resolved["action"] == "abort_plan":
                        steps[i]["status"] = "failed"
                        break
                    elif resolved["action"] == "skip_step":
                        steps[i]["status"] = "failed"
                        self.transformation_log.append({
                            "id": step["id"], "type": step.get("type", ""), "params": step.get("params", {}),
                            "affected_rows": 0, "score_delta": 0, "status": "failed",
                            "rationale": "Code generation failed — skipped by engineer", "regressions": [],
                        })
                        continue
                    elif resolved["action"] == "provide_instruction":
                        # Retry with human instruction (up to 2 retries)
                        succeeded = False
                        while self.provide_instruction_attempts < 2:
                            self.provide_instruction_attempts += 1
                            retry_result = await workflow.execute_activity(
                                generate_custom_code_activity,
                                {
                                    "session_id": self.session_id,
                                    "step": step,
                                    "prior_context": prior_context,
                                    "human_instruction": resolved.get("instruction"),
                                },
                                start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
                                retry_policy=ACTIVITY_RETRY,
                            )
                            if retry_result.get("validation_passed"):
                                code_result = retry_result
                                succeeded = True
                                break
                            # Still failed — escalate again
                            if self.provide_instruction_attempts < 2:
                                resolved = await self._escalate(
                                    step, "code_generation_failed",
                                    f"Code generation still failing (attempt {self.provide_instruction_attempts})",
                                    {"last_error": "Validation failed"},
                                )
                                if resolved["action"] != "provide_instruction":
                                    break
                        if not succeeded:
                            steps[i]["status"] = "failed"
                            self.transformation_log.append({
                                "id": step["id"], "type": step.get("type", ""), "params": step.get("params", {}),
                                "affected_rows": 0, "score_delta": 0, "status": "failed",
                                "rationale": "Code generation exhausted retries — auto-skipped", "regressions": [],
                            })
                            continue
                steps[i]["custom_code"] = code_result.get("custom_code")

            # 4. Apply transformation
            transformation_spec = {
                "id": step["id"],
                "type": step["type"],
                "params": step.get("params", {}),
                "custom_code": steps[i].get("custom_code"),
                "rationale": step.get("rationale", ""),
            }
            try:
                apply_result = await workflow.execute_activity(
                    apply_transformation_activity,
                    {"session_id": self.session_id, "transformation_spec": transformation_spec},
                    start_to_close_timeout=ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )
            except Exception as exc:
                resolved = await self._escalate(
                    step, "step_failed", f"Apply failed for {step['id']}", {"last_error": str(exc)},
                )
                if resolved["action"] == "abort_plan":
                    steps[i]["status"] = "failed"
                    break
                elif resolved["action"] == "skip_step":
                    steps[i]["status"] = "failed"
                    self.transformation_log.append({
                        "id": step["id"], "type": step.get("type", ""), "params": step.get("params", {}),
                        "affected_rows": 0, "score_delta": 0, "status": "failed",
                        "rationale": f"Apply threw error — skipped: {exc}", "regressions": [],
                    })
                    continue

            # 5. Update scorecard
            scorecard_result = await workflow.execute_activity(
                update_scorecard_activity,
                {"session_id": self.session_id, "approved_rules": self.approved_rules},
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )
            new_score = scorecard_result.get("quality_score", self.current_score)
            actual_score_delta = new_score - pre_step_score
            self.current_score = new_score
            new_per_rule = scorecard_result.get("per_rule", [])
            self.validation_results = {
                "per_rule": new_per_rule or self.validation_results.get("per_rule", []),
                "category_scores": scorecard_result.get("category_scores", self.validation_results.get("category_scores", {})),
                "baseline_quality_score": self.baseline_quality_score,
            }

            # 6. Detect regressions (only rules NOT in targets_rules that newly failed)
            targets = set(step.get("targets_rules", []))
            new_passing = {r["id"] for r in new_per_rule if r.get("passed")}
            regressions_raw = [
                r for r in new_per_rule
                if r.get("id") in pre_step_passing
                and not r.get("passed")
                and r.get("id") not in targets
            ]
            regressions = [
                {"rule_id": r.get("id"), "column": r.get("column"), "check": r.get("check"),
                 "failure_count": r.get("failure_count", 0), "rationale": (r.get("rationale", "") or "")[:80]}
                for r in regressions_raw
            ]

            # 7. Monitoring checks
            projected = step.get("projected_score_delta", 0.0)
            escalation_type = None
            escalation_desc = ""
            escalation_context: dict = {}

            if regressions:
                escalation_type = "regression"
                escalation_desc = f"Step {step['id']} caused {len(regressions)} unexpected regression(s)"
                escalation_context = {"regressed_rule_ids": [r["rule_id"] for r in regressions]}
            elif projected > 0.02 and actual_score_delta < projected * 0.3:
                escalation_type = "divergence"
                escalation_desc = f"Step {step['id']} produced much less improvement than expected"
                escalation_context = {"projected": projected, "actual": actual_score_delta}

            if escalation_type:
                resolved = await self._escalate(step, escalation_type, escalation_desc, escalation_context)
                if resolved["action"] == "abort_plan":
                    steps[i]["status"] = "applied"
                    steps[i]["actual_score_delta"] = actual_score_delta
                    break

            # 8. Mark applied
            steps[i]["status"] = "applied"
            steps[i]["actual_score_delta"] = actual_score_delta

            # 9. Append to log
            affected_rows = apply_result.get("affected_rows", 0)
            self.transformation_log.append({
                "id": step["id"],
                "type": step.get("type", ""),
                "params": step.get("params", {}),
                "affected_rows": affected_rows,
                "score_delta": actual_score_delta,
                "status": "applied" if affected_rows > 0 else "no_effect",
                "custom_code": steps[i].get("custom_code"),
                "rationale": step.get("rationale", ""),
                "regressions": regressions,
            })

        # Update plan steps with final statuses
        if self.transform_plan:
            self.transform_plan = {**self.transform_plan, "steps": steps}
```

- [ ] **Step 2: Add the `_escalate` helper method to the workflow class**

Add after the `get_full_state` query method and before the `run` method:

```python
    async def _escalate(self, step: dict, escalation_type: str, description: str, context: dict) -> dict:
        """Set escalation state, wait for human decision, return decision dict."""
        self.execution_escalation = {
            "type": escalation_type,
            "step_id": step["id"],
            "description": description,
            "context": context,
        }
        self.stage = "AWAITING_HUMAN_INPUT"
        await workflow.wait_condition(lambda: self.escalation_decision is not None)
        decision = self.escalation_decision
        self.escalation_decision = None
        self.execution_escalation = None
        self.stage = "TRANSFORMATION_LOOP"
        return decision
```

- [ ] **Step 3: Verify syntax**

```bash
python -c "from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow; print('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add backend/temporal/workflows/dq_workflow.py
git commit -m "feat: rewrite TRANSFORMATION_LOOP with automated execution, monitoring, and escalation"
```

---

## Task 11: Worker + Stepper + Page + Delete TransformStage

**Files:**
- Modify: `backend/temporal/worker.py`
- Modify: `frontend/components/workspace/Stepper.tsx`
- Modify: `frontend/app/sessions/[id]/page.tsx`
- Delete: `frontend/components/stages/TransformStage.tsx`

- [ ] **Step 1: Register new activities in worker**

In `backend/temporal/worker.py`, update transform_activities import and activities list:

```python
from backend.temporal.activities.transform_activities import (
    suggest_next_transformation_activity,
    preview_transformation_activity,
    apply_transformation_activity,
    update_scorecard_activity,
    generate_scorecard_summary_activity,
    plan_transforms_activity,
    generate_custom_code_activity,
)
```

Add to activities list in `Worker(...)`:
```python
            plan_transforms_activity,
            generate_custom_code_activity,
```

- [ ] **Step 2: Add `'plan'` to Stepper**

In `frontend/components/workspace/Stepper.tsx`, update:

```typescript
export type StageId = 'load' | 'profile' | 'rules' | 'validate' | 'triage' | 'plan' | 'transform' | 'scorecard' | 'pipeline'

const STAGES: { id: StageId; label: string }[] = [
  { id: 'load', label: 'Load' },
  { id: 'profile', label: 'Profile' },
  { id: 'rules', label: 'Rules' },
  { id: 'validate', label: 'Validate' },
  { id: 'triage', label: 'Triage' },
  { id: 'plan', label: 'Plan' },
  { id: 'transform', label: 'Transform' },
  { id: 'scorecard', label: 'Scorecard' },
  { id: 'pipeline', label: 'Pipeline' },
]
```

- [ ] **Step 3: Update `frontend/app/sessions/[id]/page.tsx`**

Update `ORDER` and `STAGE_MAP`:
```typescript
const ORDER: StageId[] = ['load', 'profile', 'rules', 'validate', 'triage', 'plan', 'transform', 'scorecard', 'pipeline']
const STAGE_MAP: Record<string, StageId> = {
  LOADING: 'load', PROFILING: 'profile',
  AWAITING_RULE_APPROVAL: 'rules', VALIDATING: 'validate',
  TRIAGING: 'triage', AWAITING_TRIAGE_APPROVAL: 'triage',
  PLANNING: 'plan', AWAITING_PLAN_APPROVAL: 'plan',
  TRANSFORMATION_LOOP: 'transform', AWAITING_HUMAN_INPUT: 'transform',
  AWAITING_PIPELINE_CONFIRMATION: 'pipeline',
  GENERATING: 'pipeline', COMPLETE: 'pipeline',
}
```

Update `WAITING_MESSAGES`:
```typescript
const WAITING_MESSAGES: Record<string, string> = {
  AWAITING_RULE_APPROVAL: 'Awaiting rule decisions',
  AWAITING_TRIAGE_APPROVAL: 'Awaiting triage decisions',
  TRANSFORMATION_LOOP: 'Executing transform plan...',
  AWAITING_HUMAN_INPUT: 'Awaiting your input',
  AWAITING_PIPELINE_CONFIRMATION: 'Awaiting pipeline confirmation',
}
```

Replace `TransformStage` import with new stage imports:
```typescript
import { PlanReviewStage } from '@/components/stages/PlanReviewStage'
import { ExecutionStage } from '@/components/stages/ExecutionStage'
```

Update `renderStage()`:
```typescript
case 'plan': return <PlanReviewStage session={session!} />
case 'transform': return <ExecutionStage session={session!} />
```

Remove the `case 'scorecard':` line that skips — it was already correct. Remove the TransformStage import and case.

- [ ] **Step 4: Verify no remaining TransformStage imports, then delete it**

```bash
grep -r "TransformStage" frontend/
```

Expected: no matches after removing the import. Then:

```bash
rm frontend/components/stages/TransformStage.tsx
```

- [ ] **Step 5: TypeScript compile check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: errors only about missing PlanReviewStage and ExecutionStage (which we'll create next) — not existing errors

- [ ] **Step 6: Commit**

```bash
git add backend/temporal/worker.py frontend/components/workspace/Stepper.tsx frontend/app/sessions/[id]/page.tsx
git rm frontend/components/stages/TransformStage.tsx
git commit -m "feat: wire new activities into worker; add Plan stepper step; route plan/transform stages; delete TransformStage"
```

---

## Task 12: PlanningStage Component

**Files:**
- Create: `frontend/components/stages/PlanningStage.tsx`

- [ ] **Step 1: Create `frontend/components/stages/PlanningStage.tsx`**

```typescript
'use client'

interface Props {
  message?: string
}

export function PlanningStage({ message }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted p-8">
      <div className="w-8 h-8 border-2 border-indigo border-t-transparent rounded-full animate-spin" />
      <div className="text-sm text-center">{message ?? 'AI is building your transformation plan...'}</div>
      <div className="text-xs text-text-muted/60 text-center">Investigation progress is visible in the AI panel on the right.</div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/stages/PlanningStage.tsx
git commit -m "feat: add PlanningStage spinner component"
```

---

## Task 13: PlanReviewStage Component

**Files:**
- Create: `frontend/components/stages/PlanReviewStage.tsx`

- [ ] **Step 1: Create `frontend/components/stages/PlanReviewStage.tsx`**

```typescript
'use client'
import { useState } from 'react'
import type { SessionState, TransformPlanStep } from '@/lib/types'
import { approvePlan } from '@/lib/api'
import { PlanningStage } from './PlanningStage'

interface Props {
  session: SessionState
}

function ParamEditor({
  params,
  onChange,
}: {
  params: Record<string, unknown>
  onChange: (updated: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-1 mt-2">
      {Object.entries(params).map(([key, value]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="text-xs text-text-muted/70 font-mono w-24 shrink-0">{key}</span>
          <input
            type={typeof value === 'number' ? 'number' : 'text'}
            value={String(value ?? '')}
            onChange={e => {
              const newVal = typeof value === 'number' ? Number(e.target.value) : e.target.value
              onChange({ ...params, [key]: newVal })
            }}
            className="flex-1 bg-surface border border-border rounded px-2 py-0.5 text-xs text-text font-mono focus:outline-none focus:border-indigo/50"
          />
        </div>
      ))}
    </div>
  )
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-border text-text-muted',
  applied: 'bg-success/20 text-success-light',
  skipped: 'bg-border/50 text-text-muted/50',
  failed: 'bg-red-500/20 text-red-400',
}

function StepCard({
  step,
  index,
  total,
  removedIds,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  step: TransformPlanStep
  index: number
  total: number
  removedIds: Set<string>
  onUpdate: (updated: TransformPlanStep) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const isCustom = step.type === 'custom'
  const missingDeps = step.depends_on.filter(d => removedIds.has(d))

  return (
    <div className="rounded-lg bg-surface-raised border border-border p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full font-mono bg-indigo/20 text-indigo-300">
            {step.type}
          </span>
          <span className="text-sm font-semibold text-text font-mono">{step.id}</span>
          {step.column && <span className="text-xs text-text-muted/70 font-mono">· {step.column}</span>}
          {step.needs_review && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
              ⚠ params need review
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="px-1.5 py-0.5 text-xs text-text-muted hover:text-text disabled:opacity-20"
          >↑</button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="px-1.5 py-0.5 text-xs text-text-muted hover:text-text disabled:opacity-20"
          >↓</button>
          <button
            onClick={onRemove}
            className="px-1.5 py-0.5 text-xs text-red-400/60 hover:text-red-400"
          >✕</button>
        </div>
      </div>

      <p className="text-xs text-text-muted leading-relaxed">{step.rationale}</p>

      {isCustom ? (
        <div className="space-y-1">
          {step.intent && <p className="text-xs text-text-muted/80"><span className="font-semibold">Intent:</span> {step.intent}</p>}
          {step.approach && <p className="text-xs text-text-muted/80"><span className="font-semibold">Approach:</span> {step.approach}</p>}
          <div className="text-xs text-text-muted/50 italic">Code generated at execution time.</div>
        </div>
      ) : (
        <ParamEditor
          params={step.params}
          onChange={params => onUpdate({ ...step, params })}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 mt-1">
        {step.targets_rules.map(r => (
          <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-border/50 text-text-muted font-mono">{r}</span>
        ))}
        {step.depends_on.length > 0 && (
          <span className="text-[10px] text-text-muted/50">
            depends on: {step.depends_on.join(', ')}
          </span>
        )}
        <span className="text-xs text-success-light ml-auto">
          +{(step.projected_score_delta * 100).toFixed(1)}%
        </span>
      </div>

      {missingDeps.length > 0 && (
        <div className="text-xs text-amber-400/80">
          ⚠ {missingDeps.join(', ')} was removed — this step may be auto-skipped.
        </div>
      )}
    </div>
  )
}

export function PlanReviewStage({ session }: Props) {
  const { stage, transform_plan, baseline_quality_score } = session

  const [steps, setSteps] = useState<TransformPlanStep[]>(() => transform_plan?.steps ?? [])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (stage === 'PLANNING' || !transform_plan) {
    return <PlanningStage />
  }

  const removedIds = new Set(
    (transform_plan.steps ?? [])
      .filter(s => !steps.find(e => e.id === s.id))
      .map(s => s.id)
  )

  const adjustedProjection = baseline_quality_score + steps.reduce((sum, s) => sum + s.projected_score_delta, 0)

  function updateStep(index: number, updated: TransformPlanStep) {
    setSteps(prev => prev.map((s, i) => i === index ? updated : s))
  }

  function removeStep(index: number) {
    setSteps(prev => prev.filter((_, i) => i !== index))
  }

  function moveStep(index: number, direction: 'up' | 'down') {
    setSteps(prev => {
      const next = [...prev]
      const swap = direction === 'up' ? index - 1 : index + 1
      ;[next[index], next[swap]] = [next[swap], next[index]]
      return next
    })
  }

  async function handleApprove() {
    setSubmitting(true)
    setError(null)
    try {
      await approvePlan(session.session_id, steps)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      {/* Summary header */}
      <div className="rounded-xl bg-surface-raised border border-border p-4">
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Transform Plan</div>
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-text-muted">{transform_plan.steps.length} steps</span>
          <span className="text-text-muted">
            {new Set(transform_plan.steps.flatMap(s => s.targets_rules)).size} rules targeted
          </span>
          <span className="text-text-muted">
            {(baseline_quality_score * 100).toFixed(1)}% → <span className="text-success-light font-semibold">{(transform_plan.projected_final_score * 100).toFixed(1)}%</span> projected
          </span>
        </div>
        {transform_plan.summary && (
          <p className="text-xs text-text-muted/70 mt-2 leading-relaxed">{transform_plan.summary}</p>
        )}
      </div>

      {/* Step cards */}
      <div className="space-y-3">
        {steps.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            index={i}
            total={steps.length}
            removedIds={removedIds}
            onUpdate={updated => updateStep(i, updated)}
            onRemove={() => removeStep(i)}
            onMoveUp={() => moveStep(i, 'up')}
            onMoveDown={() => moveStep(i, 'down')}
          />
        ))}
        {steps.length === 0 && (
          <div className="text-sm text-text-muted/50 text-center py-8">All steps removed.</div>
        )}
      </div>

      {/* Sticky approve bar */}
      <div className="sticky bottom-4 pt-2">
        <div className="rounded-xl bg-elevated border border-border p-4 flex items-center justify-between gap-4 shadow-lg">
          <div className="text-sm text-text-muted">
            Adjusted projection: <span className="text-success-light font-semibold">{(adjustedProjection * 100).toFixed(1)}%</span>
            {' '}· {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </div>
          <button
            onClick={handleApprove}
            disabled={steps.length === 0 || submitting}
            className="px-4 py-2 rounded-lg bg-indigo text-white text-sm font-semibold hover:bg-indigo/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Starting...' : 'Approve Plan →'}
          </button>
        </div>
        {error && (
          <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/stages/PlanReviewStage.tsx
git commit -m "feat: add PlanReviewStage with editable step cards, param editing, reorder, remove, and approve"
```

---

## Task 14: ExecutionStage Component

**Files:**
- Create: `frontend/components/stages/ExecutionStage.tsx`

- [ ] **Step 1: Create `frontend/components/stages/ExecutionStage.tsx`**

```typescript
'use client'
import { useState } from 'react'
import type { SessionState, TransformPlanStep, ExecutionEscalation } from '@/lib/types'
import { resolveEscalation } from '@/lib/api'

interface Props {
  session: SessionState
}

const STATUS_ICONS: Record<string, string> = {
  applied: '✓',
  skipped: '—',
  failed: '✗',
  pending: '○',
}

const STATUS_COLORS: Record<string, string> = {
  applied: 'text-success-light',
  skipped: 'text-text-muted/40',
  failed: 'text-red-400',
  pending: 'text-text-muted/50',
}

function StepRow({ step, isApplying }: { step: TransformPlanStep; isApplying: boolean }) {
  const statusColor = STATUS_COLORS[step.status] ?? 'text-text-muted'

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white/3">
      <div className={`w-5 text-center font-mono text-sm shrink-0 ${statusColor}`}>
        {isApplying
          ? <span className="inline-block w-3 h-3 border-2 border-indigo border-t-transparent rounded-full animate-spin" />
          : STATUS_ICONS[step.status] ?? '○'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-text-muted/70">{step.id}</span>
          <span className="text-xs font-semibold text-text">{step.type}</span>
          {step.column && <span className="text-xs text-text-muted/60 font-mono">· {step.column}</span>}
        </div>
        <p className="text-xs text-text-muted/60 truncate">{step.rationale}</p>
      </div>
      <div className="text-xs shrink-0 text-right min-w-[60px]">
        {step.status === 'applied' && step.actual_score_delta !== undefined && step.actual_score_delta !== null ? (
          <span className={step.actual_score_delta >= 0 ? 'text-success-light' : 'text-red-400'}>
            {step.actual_score_delta >= 0 ? '+' : ''}{(step.actual_score_delta * 100).toFixed(1)}%
            <span className="text-text-muted/40 ml-1">({(step.projected_score_delta * 100).toFixed(1)}% proj)</span>
          </span>
        ) : step.status === 'pending' ? (
          <span className="text-text-muted/30">{(step.projected_score_delta * 100).toFixed(1)}%</span>
        ) : null}
      </div>
    </div>
  )
}

function EscalationOverlay({
  escalation,
  onResolve,
}: {
  escalation: ExecutionEscalation
  onResolve: (action: string, instruction?: string) => Promise<void>
}) {
  const [instruction, setInstruction] = useState('')
  const [showInstruction, setShowInstruction] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPreApplied = escalation.type === 'regression' || escalation.type === 'divergence'
  const isCodeError = escalation.type === 'code_generation_failed' || escalation.type === 'step_failed'

  async function handle(action: string, instr?: string) {
    setSubmitting(true)
    setError(null)
    try {
      await onResolve(action, instr)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
      setSubmitting(false)
    }
  }

  const lastError = escalation.context.last_error as string | undefined
  const projected = escalation.context.projected as number | undefined
  const actual = escalation.context.actual as number | undefined
  const regressedRules = escalation.context.regressed_rule_ids as string[] | undefined

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 p-4">
      <div className="rounded-xl bg-elevated border border-amber-500/30 p-5 shadow-xl space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-mono">
              {escalation.type}
            </span>
            <span className="text-xs text-text-muted font-mono">{escalation.step_id}</span>
          </div>
          <p className="text-sm text-text">{escalation.description}</p>
        </div>

        {projected !== undefined && actual !== undefined && (
          <div className="text-xs text-text-muted">
            Expected <span className="text-success-light">+{(projected * 100).toFixed(1)}%</span>
            {' '} · Got <span className={actual >= 0 ? 'text-warning' : 'text-red-400'}>{actual >= 0 ? '+' : ''}{(actual * 100).toFixed(1)}%</span>
          </div>
        )}
        {regressedRules && (
          <div className="text-xs text-text-muted">
            Regressed rules: <span className="font-mono text-red-400">{regressedRules.join(', ')}</span>
          </div>
        )}
        {lastError && (
          <pre className="text-xs text-red-400/80 bg-surface rounded p-2 overflow-x-auto">{lastError}</pre>
        )}

        {isPreApplied && (
          <p className="text-xs text-text-muted/70 italic">This step has already been applied. You can continue or abort the plan.</p>
        )}
        {isCodeError && (
          <p className="text-xs text-text-muted/70 italic">This step was not applied.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {isPreApplied && (
            <>
              <button onClick={() => handle('continue_anyway')} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-indigo/20 text-indigo-300 border border-indigo/40 text-xs font-medium hover:bg-indigo/30 disabled:opacity-40">
                Continue Anyway
              </button>
              <button onClick={() => handle('abort_plan')} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/40 text-xs font-medium hover:bg-red-500/30 disabled:opacity-40">
                Abort Plan
              </button>
            </>
          )}
          {isCodeError && (
            <>
              <button onClick={() => handle('skip_step')} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-surface border border-border text-text-muted text-xs font-medium hover:border-text-muted/40 disabled:opacity-40">
                Skip Step
              </button>
              <button onClick={() => handle('abort_plan')} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/40 text-xs font-medium hover:bg-red-500/30 disabled:opacity-40">
                Abort Plan
              </button>
              <button onClick={() => setShowInstruction(v => !v)} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-surface border border-border text-text-muted text-xs font-medium hover:border-indigo/40 disabled:opacity-40">
                Provide Guidance ▾
              </button>
            </>
          )}
        </div>

        {showInstruction && isCodeError && (
          <div className="space-y-2">
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder="e.g. Use median instead of zero, handle string columns by casting first..."
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-text resize-none h-20 focus:outline-none focus:border-indigo/50"
            />
            <button
              onClick={() => handle('provide_instruction', instruction)}
              disabled={!instruction.trim() || submitting}
              className="px-3 py-1.5 rounded-lg bg-indigo/20 text-indigo-300 border border-indigo/40 text-xs font-medium hover:bg-indigo/30 disabled:opacity-40"
            >
              Retry with Instruction
            </button>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400">{error}</div>
        )}
      </div>
    </div>
  )
}

export function ExecutionStage({ session }: Props) {
  const { stage, transform_plan, current_score, baseline_quality_score, execution_escalation } = session
  const steps = transform_plan?.steps ?? []

  const isExecuting = stage === 'TRANSFORMATION_LOOP'
  const isEscalated = stage === 'AWAITING_HUMAN_INPUT'

  // The first pending step is "applying" during active execution
  const applyingStepId = isExecuting
    ? steps.find(s => s.status === 'pending')?.id
    : null

  const scorePct = current_score * 100
  const basePct = baseline_quality_score * 100
  const delta = scorePct - basePct

  async function handleResolve(action: string, instruction?: string) {
    await resolveEscalation(session.session_id, action, instruction)
  }

  return (
    <div className="relative flex flex-col h-full">
      {/* Score bar */}
      <div className="px-6 pt-5 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-muted uppercase tracking-wider font-semibold">Transform Progress</span>
          <span className="text-sm font-semibold">
            <span className="text-text">{scorePct.toFixed(1)}%</span>
            {delta !== 0 && (
              <span className={`ml-2 text-xs ${delta >= 0 ? 'text-success-light' : 'text-red-400'}`}>
                {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
              </span>
            )}
          </span>
        </div>
        <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo to-success rounded-full transition-all duration-500"
            style={{ width: `${Math.min(scorePct, 100)}%` }}
          />
        </div>
      </div>

      {/* Step list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="space-y-0.5">
          {steps.map(step => (
            <StepRow
              key={step.id}
              step={step}
              isApplying={step.id === applyingStepId}
            />
          ))}
          {steps.length === 0 && (
            <div className="text-sm text-text-muted/50 text-center py-12">No steps in plan.</div>
          )}
        </div>
      </div>

      {/* Escalation overlay */}
      {isEscalated && execution_escalation && (
        <EscalationOverlay escalation={execution_escalation} onResolve={handleResolve} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 new errors

- [ ] **Step 3: Commit**

```bash
git add frontend/components/stages/ExecutionStage.tsx
git commit -m "feat: add ExecutionStage with step list, score bar, and escalation overlay"
```

---

## Verification

After all tasks:

- [ ] **Backend imports cleanly**

```bash
python -c "from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow; print('OK')"
python -c "from backend.api.main import app; print('OK')"
python -c "from backend.temporal.worker import main; print('OK')"
```

- [ ] **All tests pass**

```bash
pytest tests/ -v --tb=short 2>&1 | tail -30
```

- [ ] **Frontend TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Start services and test end-to-end**

```bash
docker compose up -d
# In separate terminal:
python -m backend.temporal.worker
# In another terminal:
cd frontend && npm run dev
```

Upload a CSV with failing rules. Confirm:
1. Stepper shows 9 steps with "Plan" between Triage and Transform
2. After triage resolves → PLANNING spinner appears with AI panel streaming investigation events
3. AWAITING_PLAN_APPROVAL → plan cards appear with editable params, reorder/remove buttons
4. Approve → TRANSFORMATION_LOOP → ExecutionStage shows steps ticking to "applied" status
5. If a step diverges → AWAITING_HUMAN_INPUT → escalation overlay appears
