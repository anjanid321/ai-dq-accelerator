# Built-in Transform Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three gaps so built-in transform errors surface to the API client and are automatically corrected by Claude before the human ever sees a broken suggestion.

**Architecture:** Task 1 is a one-line schema fix — adds `error: str | None` to `TransformationPreview` so `preview()`'s error key survives the Pydantic round-trip to the client. Tasks 2–3 mirror the custom-code validation pattern already in the graph: Task 2 adds a `validate_prebuilt_params` node that dry-runs each built-in spec against `_build_sample_df()` output using a new public `validate_transform_spec()` helper, and Task 3 adds a `fix_prebuilt_params` node that loops back up to 3 times asking Claude to correct bad params. No workflow, activity, or router changes are needed.

**Tech Stack:** Pydantic v2, pandas, LangGraph, Anthropic Python SDK (`claude-sonnet-4-6`), pytest

---

## File Map

| File | Change |
|---|---|
| `backend/api/schemas.py` | Add `error: str | None = None` to `TransformationPreview` |
| `dq_tools/transformation_executor.py` | Add public `validate_transform_spec()` |
| `backend/agents/state.py` | Add `prebuilt_error: str | None` and `prebuilt_attempts: int` to `TransformationAdvisorState` |
| `backend/agents/graphs/transformation_advisor.py` | Add `MAX_PREBUILT_ATTEMPTS`, `validate_prebuilt_params`, `_route_after_prebuilt_validate`, `fix_prebuilt_params`; update `_route_after_select`, `assess_remaining_issues`, `run_transformation_advisor`, `build_transformation_advisor_graph` |
| `tests/backend/api/test_preview_schema.py` | New — 4 tests for `TransformationPreview.error` |
| `tests/dq_tools/test_validate_transform_spec.py` | New — 5 tests for `validate_transform_spec` |
| `tests/backend/agents/test_transformation_advisor.py` | Append — 7 new tests for prebuilt validation and fix loop |

---

## Task 1: Surface Preview Errors to the API Client

**Files:**
- Modify: `backend/api/schemas.py:63-68`
- Create: `tests/backend/api/test_preview_schema.py`

`preview()` already returns `{"error": "..."}` when `_apply_transform` fails, but `TransformationPreview` has no `error` field, so Pydantic silently drops it. The client sees an empty preview with no indication of what went wrong. This task adds the field.

- [ ] **Step 1: Create the test file and write failing tests**

Create `tests/backend/api/__init__.py` (empty) and `tests/backend/api/test_preview_schema.py`:

```python
"""Tests for TransformationPreview error field."""
from backend.api.schemas import TransformationPreview


def test_error_field_is_none_by_default():
    preview = TransformationPreview()
    assert preview.error is None


def test_error_field_is_included_when_set():
    preview = TransformationPreview(error="type_cast failed: invalid type")
    assert preview.error == "type_cast failed: invalid type"


def test_error_field_preserved_when_constructing_from_dict():
    """When preview() returns an error key it should survive TransformationPreview(**raw)."""
    raw = {
        "before_sample": [],
        "after_sample": [],
        "affected_row_count": 0,
        "projected_score": None,
        "projected_score_delta": None,
        "error": "Column 'nonexistent' not found",
    }
    preview = TransformationPreview(**raw)
    assert preview.error == "Column 'nonexistent' not found"


def test_error_field_absent_in_valid_preview():
    """A successful preview result has no error."""
    raw = {
        "before_sample": [{"id": 1}],
        "after_sample": [{"id": 1}],
        "affected_row_count": 1,
        "projected_score": 0.9,
        "projected_score_delta": 0.1,
    }
    preview = TransformationPreview(**raw)
    assert preview.error is None
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/backend/api/test_preview_schema.py -v
```
Expected: All 4 tests **FAIL** with `AttributeError: 'TransformationPreview' object has no attribute 'error'` — Pydantic v2 silently drops unknown fields rather than storing them, so accessing `.error` raises `AttributeError` in every test.

- [ ] **Step 3: Add `error` field to `TransformationPreview`**

In `backend/api/schemas.py`, update `TransformationPreview`:

```python
class TransformationPreview(BaseModel):
    before_sample: list[dict] = []
    after_sample: list[dict] = []
    affected_row_count: int = 0
    projected_score_delta: float | None = None
    projected_score: float | None = None
    error: str | None = None          # ADD: surfaces preview() runtime errors to client
```

- [ ] **Step 4: Run tests to confirm they all pass**

```bash
pytest tests/backend/api/test_preview_schema.py -v
```
Expected: All 4 tests **PASS**

- [ ] **Step 5: Commit**

No git repo exists; skip.

---

## Task 2: Pre-Flight Param Validation for Built-In Transforms

**Files:**
- Modify: `dq_tools/transformation_executor.py` — add `validate_transform_spec()`
- Modify: `backend/agents/state.py` — add `prebuilt_error` and `prebuilt_attempts`
- Modify: `backend/agents/graphs/transformation_advisor.py` — add `validate_prebuilt_params`, update routing and graph
- Create: `tests/dq_tools/test_validate_transform_spec.py`
- Modify: `tests/backend/agents/test_transformation_advisor.py` — append 2 new tests + update `_base_state`

Currently `_route_after_select` sends prebuilt types straight to `format_suggestion`, bypassing any validation. This task inserts a `validate_prebuilt_params` node on that path. The node uses a new public helper `validate_transform_spec()` — which checks column existence and runs `_apply_transform` against a synthetic sample — to detect bad specs before they reach the human.

**Important constraint:** The graph in this task adds a temporary direct edge `validate_prebuilt_params → format_suggestion`. Task 3 will replace that with conditional edges. This mirrors the pattern used in the previous plan (Task 2 added a direct edge from `validate_custom_code`, Task 3 made it conditional).

### Part A: `validate_transform_spec` helper

- [ ] **Step 1: Write failing tests for `validate_transform_spec`**

Create `tests/dq_tools/test_validate_transform_spec.py`:

```python
"""Tests for validate_transform_spec in transformation_executor."""
import pandas as pd
import pytest
from dq_tools.transformation_executor import validate_transform_spec


@pytest.fixture()
def sample_df():
    return pd.DataFrame({
        "email": ["a@b.com", "bad", None],
        "age": [25, 30.0, None],
        "created_at": pd.to_datetime(["2024-01-01", "2024-01-02", None]),
    })


def test_valid_single_column_spec(sample_df):
    spec = {"type": "impute_constant", "params": {"column": "age", "value": 0}}
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is True
    assert error is None


def test_missing_column_returns_error(sample_df):
    spec = {"type": "impute_constant", "params": {"column": "nonexistent", "value": 0}}
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is False
    assert "nonexistent" in error
    assert "Available" in error


def test_missing_multi_column_returns_error(sample_df):
    """date_format_cast uses params.columns (a list)."""
    spec = {
        "type": "date_format_cast",
        "params": {"columns": ["created_at", "missing_col"], "from_format": "%Y-%m-%d"},
    }
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is False
    assert "missing_col" in error


def test_unknown_transform_type_returns_error(sample_df):
    spec = {"type": "made_up_transform", "params": {}}
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is False
    assert error is not None


def test_valid_deduplicate_with_subset(sample_df):
    spec = {"type": "deduplicate", "params": {"subset_columns": ["email"]}}
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is True
    assert error is None
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/dq_tools/test_validate_transform_spec.py -v
```
Expected: All 5 tests **FAIL** with `ImportError: cannot import name 'validate_transform_spec'`

- [ ] **Step 3: Implement `validate_transform_spec` in `transformation_executor.py`**

Add this function after `_get_preview_indices` (before `preview()`):

```python
def validate_transform_spec(
    transformation_spec: dict,
    sample_df: pd.DataFrame,
) -> tuple[bool, str | None]:
    """Validate a built-in transformation spec against a sample DataFrame.

    Checks that referenced columns exist and that the transform executes without error.
    ``_apply_transform`` silently ignores missing columns, so this function performs
    explicit column-existence checks before delegating to the transform runner.

    Returns
    -------
    tuple[bool, str | None]
        ``(True, None)`` if valid; ``(False, error_message)`` if invalid.
    """
    params = transformation_spec.get("params", {})
    available = list(sample_df.columns)

    # Single-column transforms (most types: impute_*, null_invalid, winsorize, etc.)
    col = transformation_spec.get("column") or params.get("column")
    if col and col not in sample_df.columns:
        return False, f"Column '{col}' not found. Available columns: {available}"

    # date_format_cast uses params.columns (list)
    multi_cols = params.get("columns") or []
    missing_multi = [c for c in multi_cols if c not in sample_df.columns]
    if missing_multi:
        return False, f"Columns not found: {missing_multi}. Available columns: {available}"

    # deduplicate uses params.subset_columns (optional list)
    subset_cols = params.get("subset_columns") or []
    missing_subset = [c for c in subset_cols if c not in sample_df.columns]
    if missing_subset:
        return False, f"Subset columns not found: {missing_subset}. Available columns: {available}"

    # Try running the transform to catch unknown types and operation errors
    try:
        _apply_transform(sample_df.copy(), transformation_spec)
        return True, None
    except Exception as exc:
        return False, str(exc)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest tests/dq_tools/test_validate_transform_spec.py -v
```
Expected: All 5 tests **PASS**

### Part B: State, graph node, and routing

- [ ] **Step 5: Add failing tests for `validate_prebuilt_params`**

Append to `tests/backend/agents/test_transformation_advisor.py`:

```python
# ── validate_prebuilt_params ─────────────────────────────────────────────────

from backend.agents.graphs.transformation_advisor import validate_prebuilt_params


def test_validate_prebuilt_params_clears_error_for_valid_spec():
    """A spec with a column that exists in the profile should set prebuilt_error=None."""
    state = _base_state(
        suggestion={"type": "impute_constant", "params": {"column": "email", "value": "unknown"}, "rationale": ""},
        prebuilt_error="stale error from previous iteration",
    )
    result = validate_prebuilt_params(state)
    assert result["prebuilt_error"] is None


def test_validate_prebuilt_params_sets_error_for_bad_column():
    """A spec referencing a column absent from the profile should set prebuilt_error."""
    state = _base_state(
        suggestion={"type": "impute_constant", "params": {"column": "nonexistent_col", "value": 0}, "rationale": ""},
    )
    result = validate_prebuilt_params(state)
    assert result["prebuilt_error"] is not None
    assert "nonexistent_col" in result["prebuilt_error"]
```

- [ ] **Step 6: Run new tests to confirm they fail**

```bash
pytest tests/backend/agents/test_transformation_advisor.py -v -k "validate_prebuilt"
```
Expected: Both tests **FAIL** with `ImportError: cannot import name 'validate_prebuilt_params'`

- [ ] **Step 7: Add `prebuilt_error` and `prebuilt_attempts` to state**

In `backend/agents/state.py`, update `TransformationAdvisorState`:

```python
class TransformationAdvisorState(TypedDict):
    remaining_failures: list[dict]
    anomaly_report: dict
    transformation_log: list[dict]
    current_score: float
    use_case: str
    profile: dict
    # Outputs
    done: bool
    suggestion: dict | None
    custom_code: str | None
    custom_code_valid: bool
    custom_code_error: str | None
    custom_code_attempts: int
    prebuilt_error: str | None       # ADD
    prebuilt_attempts: int           # ADD
```

- [ ] **Step 8: Update `_base_state` helper in the test file to include new keys**

Find the `_base_state` function in `tests/backend/agents/test_transformation_advisor.py` and add the two new keys to the `base` dict:

```python
        "custom_code_attempts": 0,
        "prebuilt_error": None,      # ADD
        "prebuilt_attempts": 0,      # ADD
```

- [ ] **Step 9: Add `validate_prebuilt_params` node to `transformation_advisor.py`**

Add this function after `format_suggestion` (before the `# Graph construction` comment block):

```python
def validate_prebuilt_params(state: TransformationAdvisorState) -> TransformationAdvisorState:
    """Node 4b: Dry-run a prebuilt transform spec against a synthetic sample DataFrame."""
    from dq_tools.transformation_executor import validate_transform_spec

    suggestion = state.get("suggestion") or {}
    profile = state.get("profile", {})
    sample_df = _build_sample_df(profile)

    _, error = validate_transform_spec(suggestion, sample_df)
    return {
        **state,
        "prebuilt_error": error,
    }
```

- [ ] **Step 10: Update `_route_after_select` to route prebuilt types to `validate_prebuilt_params`**

Replace the current `_route_after_select` function (line 245):

```python
def _route_after_select(state: TransformationAdvisorState) -> str:
    """Conditional edge: custom code path or prebuilt validation path."""
    suggestion = state.get("suggestion") or {}
    t_type = suggestion.get("type", "")
    if t_type == "custom":
        return "generate_custom_code"
    return "validate_prebuilt_params"
```

- [ ] **Step 11: Update `assess_remaining_issues` return dict to include new keys**

The entry node resets output state on every graph run. Add the two new keys:

```python
    return {
        **state,
        "done": done,
        "suggestion": None,
        "custom_code": None,
        "custom_code_valid": False,
        "custom_code_error": None,
        "custom_code_attempts": 0,
        "prebuilt_error": None,      # ADD
        "prebuilt_attempts": 0,      # ADD
    }
```

- [ ] **Step 12: Update `run_transformation_advisor` initial state**

Add both new keys to the `initial_state` dict in `run_transformation_advisor`:

```python
        "custom_code_attempts": 0,
        "prebuilt_error": None,      # ADD
        "prebuilt_attempts": 0,      # ADD
```

- [ ] **Step 13: Update `build_transformation_advisor_graph()` to include the new node**

Replace the entire function:

```python
def build_transformation_advisor_graph():
    """Build and return the compiled TransformationAdvisor graph."""
    graph = StateGraph(TransformationAdvisorState)

    graph.add_node("assess_remaining_issues", assess_remaining_issues)
    graph.add_node("select_next_transformation", select_next_transformation)
    graph.add_node("generate_custom_code", generate_custom_code)
    graph.add_node("validate_custom_code", validate_custom_code)
    graph.add_node("fix_custom_code", fix_custom_code)
    graph.add_node("validate_prebuilt_params", validate_prebuilt_params)   # NEW
    graph.add_node("format_suggestion", format_suggestion)

    graph.set_entry_point("assess_remaining_issues")

    graph.add_conditional_edges(
        "assess_remaining_issues",
        _route_after_assess,
        {END: END, "select_next_transformation": "select_next_transformation"},
    )
    # UPDATED: prebuilt types now go to validate_prebuilt_params, not format_suggestion
    graph.add_conditional_edges(
        "select_next_transformation",
        _route_after_select,
        {"generate_custom_code": "generate_custom_code", "validate_prebuilt_params": "validate_prebuilt_params"},
    )
    graph.add_edge("generate_custom_code", "validate_custom_code")
    graph.add_conditional_edges(
        "validate_custom_code",
        _route_after_validate,
        {"fix_custom_code": "fix_custom_code", "format_suggestion": "format_suggestion"},
    )
    graph.add_edge("fix_custom_code", "validate_custom_code")

    # Temporary direct edge — Task 3 replaces this with conditional edges + fix loop
    graph.add_edge("validate_prebuilt_params", "format_suggestion")

    graph.add_edge("format_suggestion", END)

    return graph.compile()
```

- [ ] **Step 14: Run the full test suite**

```bash
pytest tests/ -v
```
Expected: All tests (the 24 from before + 7 new) **PASS**

- [ ] **Step 15: Commit**

No git repo exists; skip.

---

## Task 3: Retry / Fix Loop for Built-In Transform Params

**Files:**
- Modify: `backend/agents/graphs/transformation_advisor.py` — add `MAX_PREBUILT_ATTEMPTS`, `fix_prebuilt_params`, `_route_after_prebuilt_validate`; update graph
- Modify: `tests/backend/agents/test_transformation_advisor.py` — append 5 new tests

When `validate_prebuilt_params` finds a bad spec, instead of surfacing it to the human immediately, a new `fix_prebuilt_params` node asks Claude to correct the params (JSON only — no code generation). The loop runs at most `MAX_PREBUILT_ATTEMPTS = 3` times before giving up and surfacing the suggestion (possibly still broken) to the human.

**Important:** The current graph has a direct edge `graph.add_edge("validate_prebuilt_params", "format_suggestion")` added in Task 2. This line **must be deleted** before adding the conditional edge below — LangGraph will raise a compile error if a node has both a direct edge and a conditional edge leaving it.

- [ ] **Step 1: Add failing tests for the fix loop**

Append to `tests/backend/agents/test_transformation_advisor.py`:

```python
# ── fix_prebuilt_params ──────────────────────────────────────────────────────

from backend.agents.graphs.transformation_advisor import (
    fix_prebuilt_params,
    _route_after_prebuilt_validate,
)


def test_fix_prebuilt_params_updates_suggestion_params():
    """fix_prebuilt_params should replace suggestion params with Claude's corrected version."""
    state = _base_state(
        suggestion={"type": "impute_constant", "params": {"column": "bad_col", "value": 0}, "rationale": ""},
        prebuilt_error="Column 'bad_col' not found",
        prebuilt_attempts=0,
    )
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text='{"params": {"column": "email", "value": 0}}')]

    with patch("backend.agents.graphs.transformation_advisor.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        result = fix_prebuilt_params(state)

    assert result["prebuilt_attempts"] == 1
    assert result["suggestion"]["params"]["column"] == "email"
    # Transform type must not change
    assert result["suggestion"]["type"] == "impute_constant"


def test_fix_prebuilt_params_increments_counter_on_api_failure():
    """API failure must still increment the counter to prevent infinite loops."""
    state = _base_state(
        suggestion={"type": "impute_constant", "params": {"column": "bad_col", "value": 0}, "rationale": ""},
        prebuilt_error="Column not found",
        prebuilt_attempts=0,
    )
    with patch("backend.agents.graphs.transformation_advisor.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.side_effect = Exception("API error")
        result = fix_prebuilt_params(state)

    assert result["prebuilt_attempts"] == 1


def test_route_after_prebuilt_validate_proceeds_when_no_error():
    state = _base_state(prebuilt_error=None, prebuilt_attempts=0)
    assert _route_after_prebuilt_validate(state) == "format_suggestion"


def test_route_after_prebuilt_validate_loops_when_error_and_under_limit():
    state = _base_state(prebuilt_error="Column not found", prebuilt_attempts=1)
    assert _route_after_prebuilt_validate(state) == "fix_prebuilt_params"


def test_route_after_prebuilt_validate_gives_up_at_limit():
    state = _base_state(prebuilt_error="Column not found", prebuilt_attempts=3)
    assert _route_after_prebuilt_validate(state) == "format_suggestion"
```

- [ ] **Step 2: Run new tests to confirm they fail**

```bash
pytest tests/backend/agents/test_transformation_advisor.py -v -k "fix_prebuilt or route_after_prebuilt"
```
Expected: All 5 tests **FAIL**

- [ ] **Step 3: Add `MAX_PREBUILT_ATTEMPTS` constant**

In `backend/agents/graphs/transformation_advisor.py`, add directly below `MAX_CUSTOM_CODE_ATTEMPTS = 3`:

```python
MAX_PREBUILT_ATTEMPTS = 3
```

- [ ] **Step 4: Add `fix_prebuilt_params` and `_route_after_prebuilt_validate`**

Add these two functions after `validate_prebuilt_params` (before the `# Graph construction` comment):

```python
def fix_prebuilt_params(state: TransformationAdvisorState) -> TransformationAdvisorState:
    """Node 4c: Ask Claude to correct the params of a failing prebuilt transform."""
    client = anthropic.Anthropic()

    suggestion = state.get("suggestion") or {}
    error = state.get("prebuilt_error") or "Unknown error"
    use_case = state.get("use_case", "general ML use case")
    profile = state.get("profile", {})
    attempts = state.get("prebuilt_attempts", 0)
    available_columns = list(profile.get("columns", {}).keys())

    user_message = f"""Use case: {use_case}

A prebuilt transformation spec failed validation:

Error: {error}

Current spec:
```json
{json.dumps({"type": suggestion.get("type"), "params": suggestion.get("params", {})}, indent=2)}
```

Available columns: {available_columns}

Fix the params so this transformation is valid. Output ONLY a JSON object:
{{
  "params": {{...corrected params...}}
}}

Keep the same transformation type ({suggestion.get("type")}). Only fix the params."""

    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=500,
            temperature=0,
            system=TRANSFORMATION_ADVISOR_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )
        raw = response.content[0].text
        parsed = _parse_json(raw)
        if isinstance(parsed, dict) and "params" in parsed:
            fixed_suggestion = {**suggestion, "params": parsed["params"]}
        else:
            fixed_suggestion = suggestion
    except Exception:
        # Must increment attempts even on failure so routing can eventually give up
        return {
            **state,
            "prebuilt_attempts": attempts + 1,
        }

    return {
        **state,
        "suggestion": fixed_suggestion,
        "prebuilt_attempts": attempts + 1,
    }


def _route_after_prebuilt_validate(state: TransformationAdvisorState) -> str:
    """Conditional edge after validate_prebuilt_params."""
    if state.get("prebuilt_error") is None:
        return "format_suggestion"
    if state.get("prebuilt_attempts", 0) < MAX_PREBUILT_ATTEMPTS:
        return "fix_prebuilt_params"
    return "format_suggestion"  # give up — suggestion surfaced as-is
```

- [ ] **Step 5: Update `build_transformation_advisor_graph()` — delete direct edge, add loop**

**Important:** Delete the line `graph.add_edge("validate_prebuilt_params", "format_suggestion")` that was added in Task 2. Then replace the entire `build_transformation_advisor_graph()` function:

```python
def build_transformation_advisor_graph():
    """Build and return the compiled TransformationAdvisor graph."""
    graph = StateGraph(TransformationAdvisorState)

    graph.add_node("assess_remaining_issues", assess_remaining_issues)
    graph.add_node("select_next_transformation", select_next_transformation)
    graph.add_node("generate_custom_code", generate_custom_code)
    graph.add_node("validate_custom_code", validate_custom_code)
    graph.add_node("fix_custom_code", fix_custom_code)
    graph.add_node("validate_prebuilt_params", validate_prebuilt_params)
    graph.add_node("fix_prebuilt_params", fix_prebuilt_params)             # NEW
    graph.add_node("format_suggestion", format_suggestion)

    graph.set_entry_point("assess_remaining_issues")

    graph.add_conditional_edges(
        "assess_remaining_issues",
        _route_after_assess,
        {END: END, "select_next_transformation": "select_next_transformation"},
    )
    graph.add_conditional_edges(
        "select_next_transformation",
        _route_after_select,
        {"generate_custom_code": "generate_custom_code", "validate_prebuilt_params": "validate_prebuilt_params"},
    )
    graph.add_edge("generate_custom_code", "validate_custom_code")
    graph.add_conditional_edges(
        "validate_custom_code",
        _route_after_validate,
        {"fix_custom_code": "fix_custom_code", "format_suggestion": "format_suggestion"},
    )
    graph.add_edge("fix_custom_code", "validate_custom_code")

    # Prebuilt validation + fix loop (replaces direct edge from Task 2)
    graph.add_conditional_edges(
        "validate_prebuilt_params",
        _route_after_prebuilt_validate,
        {"fix_prebuilt_params": "fix_prebuilt_params", "format_suggestion": "format_suggestion"},
    )
    graph.add_edge("fix_prebuilt_params", "validate_prebuilt_params")  # loop back

    graph.add_edge("format_suggestion", END)

    return graph.compile()
```

- [ ] **Step 6: Run the full test suite**

```bash
pytest tests/ -v
```
Expected: All tests **PASS**

- [ ] **Step 7: Commit**

No git repo exists; skip.
