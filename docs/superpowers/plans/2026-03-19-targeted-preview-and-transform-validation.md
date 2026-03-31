# Targeted Preview Samples + Transform Validation Feedback Loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic `head(5)` preview with rows that are actually failing the relevant rules, and add a runtime execution check + Claude-powered retry loop for custom-code transforms.

**Architecture:** Task 1 is purely inside `dq_tools/transformation_executor.py` — a new index-selector helper feeds into `preview()`. Tasks 2–3 are entirely inside `backend/agents/graphs/transformation_advisor.py` and `backend/agents/state.py` — `validate_custom_code` gains a live `exec()` dry-run, and a new `fix_custom_code` node loops back up to 3 times before giving up. No workflow, activity, API, or schema changes required.

**Tech Stack:** pandas, numpy, LangGraph, Anthropic Python SDK (`claude-sonnet-4-6`), pytest + pytest-asyncio

---

## File Map

| File | Change |
|---|---|
| `dq_tools/transformation_executor.py` | Add `_get_preview_indices()`, update `preview()` |
| `backend/agents/state.py` | Add `custom_code_error` and `custom_code_attempts` to `TransformationAdvisorState` |
| `backend/agents/graphs/transformation_advisor.py` | Update `validate_custom_code`, add `_build_sample_df`, add `fix_custom_code` node, add routing, add `pd`/`np` imports, update graph construction and initial state |
| `tests/dq_tools/test_transformation_executor_preview.py` | New test file |
| `tests/backend/agents/test_transformation_advisor.py` | New test file |

---

## Task 1: Targeted Failing-Row Sampling in `preview()`

**Files:**
- Modify: `dq_tools/transformation_executor.py`
- Create: `tests/dq_tools/test_transformation_executor_preview.py`

The current `preview()` always uses `df.head(5)` for both `before_sample` and `after_sample`. This task replaces that with a helper that finds rows actually failing the relevant rules (up to 3 unique failures + up to 2 passing rows for contrast), falling back to `head(5)` when no relevant rules apply.

"Relevant" means the rule's `column` matches the column the transformation targets. For row-removing transforms (`filter_rows`, `deduplicate`) the `after_sample` still uses `new_df.head(5)` because row indices no longer correspond after deletion.

- [ ] **Step 1: Create the test file and write failing tests**

Create `tests/dq_tools/test_transformation_executor_preview.py`:

```python
"""Tests for targeted preview sampling in transformation_executor.preview()."""
import pandas as pd
import pytest
from unittest.mock import patch

# We test the internal helper directly to avoid needing a real DuckDB session.
from dq_tools.transformation_executor import _get_preview_indices


@pytest.fixture()
def sample_df():
    return pd.DataFrame({
        "email": ["good@example.com", "bad-email", "INVALID", "ok@test.com", "x@y.com"],
        "age":   [25, 30, -1, 40, 22],
        "name":  ["Alice", "Bob", "Charlie", "Dan", "Eve"],
    })


@pytest.fixture()
def email_rule():
    return {
        "id": "r1",
        "category": "validity",
        "column": "email",
        "check": "regex_match",
        "pattern": r"^[^@]+@[^@]+\.[^@]+$",
        "threshold": 0.0,
    }


def test_returns_failing_rows_first(sample_df, email_rule):
    """Failing rows should appear before passing rows in the index list."""
    spec = {"type": "null_invalid", "params": {"column": "email", "pattern": r"^[^@]+@[^@]+\.[^@]+$"}}
    indices = _get_preview_indices(sample_df, spec, [email_rule])
    # rows 1 ("bad-email") and 2 ("INVALID") fail the regex
    failing_indices = [i for i in indices if sample_df.loc[i, "email"] in ("bad-email", "INVALID")]
    passing_indices = [i for i in indices if sample_df.loc[i, "email"] not in ("bad-email", "INVALID")]
    assert len(failing_indices) >= 1, "Expected at least one failing row"
    assert len(passing_indices) >= 1, "Expected at least one passing row for contrast"
    # Failing indices come first
    assert indices.index(failing_indices[0]) < indices.index(passing_indices[0])


def test_deduplicates_failing_values(sample_df, email_rule):
    """Duplicate failure values should only appear once."""
    df_with_dupes = pd.DataFrame({
        "email": ["bad-email", "bad-email", "bad-email", "good@x.com", "ok@y.com"],
    })
    spec = {"type": "null_invalid", "params": {"column": "email", "pattern": r"^[^@]+@[^@]+\.[^@]+$"}}
    indices = _get_preview_indices(df_with_dupes, spec, [email_rule])
    # "bad-email" should appear only once after dedup
    email_values = [df_with_dupes.loc[i, "email"] for i in indices]
    assert email_values.count("bad-email") == 1


def test_falls_back_to_head5_when_no_rules(sample_df):
    """No approved_rules → first 5 rows."""
    spec = {"type": "null_invalid", "params": {"column": "email"}}
    indices = _get_preview_indices(sample_df, spec, None)
    assert indices == list(sample_df.head(5).index)


def test_falls_back_to_head5_when_no_relevant_rules(sample_df, email_rule):
    """Transform targets a different column than the rule → first 5 rows."""
    spec = {"type": "impute_constant", "params": {"column": "age", "value": 0}}
    # email_rule is for "email", not "age"
    indices = _get_preview_indices(sample_df, spec, [email_rule])
    assert indices == list(sample_df.head(5).index)


def test_falls_back_to_head5_when_all_pass(sample_df):
    """All rows pass the rule → first 5 rows."""
    all_good = pd.DataFrame({"email": ["a@b.com", "c@d.com", "e@f.com"]})
    spec = {"type": "null_invalid", "params": {"column": "email", "pattern": r"^[^@]+@[^@]+\.[^@]+$"}}
    rule = {
        "id": "r1", "category": "validity", "column": "email",
        "check": "regex_match", "pattern": r"^[^@]+@[^@]+\.[^@]+$", "threshold": 0.0,
    }
    indices = _get_preview_indices(all_good, spec, [rule])
    assert indices == list(all_good.head(5).index)


def test_not_null_rule_surfaces_null_rows():
    """not_null check should surface rows where the column is null."""
    df = pd.DataFrame({"score": [None, None, 10.0, 20.0, 30.0]})
    rule = {"id": "r1", "category": "completeness", "column": "score", "check": "not_null", "threshold": 0.0}
    spec = {"type": "impute_constant", "params": {"column": "score", "value": 0}}
    indices = _get_preview_indices(df, spec, [rule])
    null_indices = [i for i in indices if pd.isna(df.loc[i, "score"])]
    assert len(null_indices) >= 1


def test_range_rule_surfaces_out_of_range_rows():
    """range check should surface rows outside min/max."""
    df = pd.DataFrame({"age": [-5, 200, 25, 30, 40]})
    rule = {"id": "r1", "category": "validity", "column": "age", "check": "range",
            "min": 0, "max": 120, "threshold": 0.0}
    spec = {"type": "winsorize", "params": {"column": "age", "cap_value": 120}}
    indices = _get_preview_indices(df, spec, [rule])
    bad_indices = [i for i in indices if df.loc[i, "age"] in (-5, 200)]
    assert len(bad_indices) >= 1


def test_at_most_3_failing_and_2_passing_rows(sample_df, email_rule):
    """Result should have at most 3 failing rows and at most 2 passing rows."""
    big_df = pd.DataFrame({
        "email": ["bad"] * 10 + ["good@x.com"] * 10
    })
    spec = {"type": "null_invalid", "params": {"column": "email", "pattern": r"^[^@]+@[^@]+\.[^@]+$"}}
    indices = _get_preview_indices(big_df, spec, [email_rule])
    bad = [i for i in indices if big_df.loc[i, "email"] == "bad"]
    good = [i for i in indices if big_df.loc[i, "email"] == "good@x.com"]
    assert len(bad) <= 3
    assert len(good) <= 2
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
pytest tests/dq_tools/test_transformation_executor_preview.py -v
```
Expected: All 8 tests **FAIL** with `ImportError: cannot import name '_get_preview_indices'`

- [ ] **Step 3: Implement `_get_preview_indices` and update `preview()`**

In `dq_tools/transformation_executor.py`, add after `_score_df_with_rules` (around line 317) and update `preview()`:

```python
_ROW_REMOVING_TRANSFORMS = {"filter_rows", "deduplicate"}


def _get_preview_indices(
    df: pd.DataFrame,
    transformation_spec: dict,
    approved_rules: list[dict] | None,
) -> list:
    """Return up to 3 failing-row indices + up to 2 passing-row indices for preview.

    Selects rows relevant to *transformation_spec*'s target column by evaluating
    *approved_rules* against the DataFrame. Falls back to ``df.head(5).index``
    when no relevant rules exist or no failures are found.
    """
    fallback = df.head(5).index.tolist()

    if not approved_rules or df.empty:
        return fallback

    col = (
        transformation_spec.get("column")
        or transformation_spec.get("params", {}).get("column")
    )
    relevant_rules = [r for r in approved_rules if r.get("column") == col] if col else []
    if not relevant_rules:
        return fallback

    fail_mask = pd.Series(False, index=df.index)
    for rule in relevant_rules:
        r_col = rule.get("column")
        if not r_col or r_col not in df.columns:
            continue
        try:
            check = rule.get("check")
            if check == "not_null":
                fail_mask |= df[r_col].isna()
            elif check == "regex_match":
                pattern = rule.get("pattern", "")
                # str.match anchors at the start only (not a full match), consistent
                # with _score_df_with_rules — patterns should use ^ and $ anchors
                fail_mask |= ~df[r_col].astype(str).str.match(pattern, na=False)
            elif check == "value_in_set":
                values = rule.get("values", [])
                fail_mask |= ~df[r_col].astype(str).isin([str(v) for v in values])
            elif check == "range":
                s = pd.to_numeric(df[r_col], errors="coerce")
                min_v, max_v = rule.get("min"), rule.get("max")
                if min_v is not None:
                    fail_mask |= s < float(min_v)
                if max_v is not None:
                    fail_mask |= s > float(max_v)
            elif check == "unique":
                fail_mask |= df[r_col].duplicated(keep=False)
        except Exception:
            continue

    failing = df[fail_mask]
    passing = df[~fail_mask]

    # Deduplicate failing rows by target column value → unique failure cases only
    if col and col in df.columns:
        failing = failing.drop_duplicates(subset=[col])

    failing_indices = failing.head(3).index.tolist()
    passing_indices = passing.head(2).index.tolist()

    combined = failing_indices + passing_indices
    return combined if combined else fallback
```

Then replace the two `head(5)` lines inside `preview()` (currently lines 344 and 358):

```python
# BEFORE (lines ~344 and ~358):
#   before_sample = df.head(5).replace({np.nan: None}).to_dict(orient="records")
#   ...
#   after_sample = new_df.head(5).replace({np.nan: None}).to_dict(orient="records")

# AFTER:
    sample_indices = _get_preview_indices(df, transformation_spec, approved_rules)
    before_sample = df.loc[sample_indices].replace({np.nan: None}).to_dict(orient="records")
```

And replace the `after_sample` line with:

```python
    t_type = transformation_spec.get("type", "")
    if t_type in _ROW_REMOVING_TRANSFORMS:
        after_sample = new_df.head(5).replace({np.nan: None}).to_dict(orient="records")
    else:
        existing = [i for i in sample_indices if i in new_df.index]
        after_sample = new_df.loc[existing].replace({np.nan: None}).to_dict(orient="records")
```

- [ ] **Step 4: Run the tests and confirm they all pass**

```bash
pytest tests/dq_tools/test_transformation_executor_preview.py -v
```
Expected: All 8 tests **PASS**

- [ ] **Step 5: Commit**

```bash
git add dq_tools/transformation_executor.py tests/dq_tools/test_transformation_executor_preview.py
git commit -m "feat: preview() samples failing rows instead of head(5)"
```

---

## Task 2: Runtime Execution Check for Custom Code

**Files:**
- Modify: `backend/agents/state.py`
- Modify: `backend/agents/graphs/transformation_advisor.py`
- Create: `tests/backend/agents/test_transformation_advisor.py`

The `validate_custom_code` node currently only does regex safety checks. This task adds a live `exec()` dry-run: build a small synthetic DataFrame from the profile, exec the code, call `transform(sample_df)`, and verify it returns a DataFrame. If anything errors, `custom_code_valid = False` and `custom_code_error` is set.

- [ ] **Step 1: Write failing tests for runtime validation**

Create `tests/backend/agents/test_transformation_advisor.py`:

```python
"""Tests for transformation advisor — runtime validation and fix loop."""
import pandas as pd
import pytest
from unittest.mock import patch, MagicMock

from backend.agents.graphs.transformation_advisor import (
    validate_custom_code,
    _build_sample_df,
    _is_safe_custom_code,
)
from backend.agents.state import TransformationAdvisorState


def _base_state(**overrides) -> TransformationAdvisorState:
    base: TransformationAdvisorState = {
        "remaining_failures": [],
        "anomaly_report": {},
        "transformation_log": [],
        "current_score": 0.8,
        "use_case": "test",
        "profile": {
            "columns": {
                "email": {"type": "object"},
                "age": {"type": "int64"},
            }
        },
        "done": False,
        "suggestion": {"type": "custom", "column": "email", "params": {}, "rationale": ""},
        "custom_code": None,
        "custom_code_valid": False,
        "custom_code_error": None,
        "custom_code_attempts": 0,
    }
    return {**base, **overrides}


# ── _build_sample_df ─────────────────────────────────────────────────────────

def test_build_sample_df_uses_profile_columns():
    profile = {"columns": {"name": {"type": "object"}, "score": {"type": "float64"}}}
    df = _build_sample_df(profile)
    assert "name" in df.columns
    assert "score" in df.columns
    assert len(df) == 3


def test_build_sample_df_empty_profile_returns_default():
    df = _build_sample_df({})
    assert isinstance(df, pd.DataFrame)
    assert len(df) > 0


def test_build_sample_df_handles_various_dtypes():
    profile = {
        "columns": {
            "dt_col": {"type": "datetime64[ns]"},
            "int_col": {"type": "int64"},
            "str_col": {"type": "object"},
            "float_col": {"type": "float64"},
        }
    }
    df = _build_sample_df(profile)
    assert set(df.columns) == {"dt_col", "int_col", "str_col", "float_col"}


# ── validate_custom_code — runtime execution ─────────────────────────────────

def test_valid_code_passes_runtime_check():
    """A well-formed transform() should set custom_code_valid=True."""
    code = "def transform(df):\n    return df"
    state = _base_state(custom_code=code)
    result = validate_custom_code(state)
    assert result["custom_code_valid"] is True
    assert result["custom_code_error"] is None
    assert result["suggestion"]["custom_code"] == code


def test_code_that_raises_on_execution_is_invalid():
    """Code that errors at runtime should set custom_code_valid=False with error."""
    code = "def transform(df):\n    return df['nonexistent_column_xyz']"
    state = _base_state(custom_code=code)
    result = validate_custom_code(state)
    assert result["custom_code_valid"] is False
    assert result["custom_code_error"] is not None
    assert result["suggestion"]["custom_code"] is None


def test_code_that_returns_non_dataframe_is_invalid():
    """transform() returning a non-DataFrame should fail validation."""
    code = "def transform(df):\n    return 42"
    state = _base_state(custom_code=code)
    result = validate_custom_code(state)
    assert result["custom_code_valid"] is False
    assert "DataFrame" in result["custom_code_error"]


def test_code_missing_transform_function_is_invalid():
    """Code without a 'transform' function should fail.

    This is caught by _is_safe_custom_code (safety check path), not the exec
    path, because _is_safe_custom_code requires 'def transform' in the code.
    """
    code = "def process(df):\n    return df"
    state = _base_state(custom_code=code)
    result = validate_custom_code(state)
    assert result["custom_code_valid"] is False
    assert "safety check" in result["custom_code_error"]


def test_unsafe_code_fails_before_execution():
    """Code with import statements should fail the safety check, not reach exec."""
    code = "import os\ndef transform(df):\n    return df"
    state = _base_state(custom_code=code)
    result = validate_custom_code(state)
    assert result["custom_code_valid"] is False
    # Should not expose any execution error since it was blocked by safety check
    assert result["custom_code_error"] is not None


def test_none_code_is_invalid():
    state = _base_state(custom_code=None)
    result = validate_custom_code(state)
    assert result["custom_code_valid"] is False


def test_code_that_mutates_df_column_is_valid():
    """A realistic transform that actually modifies data should pass."""
    code = (
        "def transform(df):\n"
        "    df = df.copy()\n"
        "    df['email'] = df['email'].str.lower()\n"
        "    return df\n"
    )
    state = _base_state(custom_code=code)
    result = validate_custom_code(state)
    assert result["custom_code_valid"] is True
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/backend/agents/test_transformation_advisor.py -v
```
Expected: Most tests **FAIL** because `_build_sample_df` doesn't exist and `validate_custom_code` doesn't do runtime execution.

- [ ] **Step 3: Add `custom_code_error` and `custom_code_attempts` to state**

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
    custom_code_error: str | None    # ADD
    custom_code_attempts: int        # ADD
```

- [ ] **Step 4: Add `pd`/`np` imports and `_build_sample_df` to `transformation_advisor.py`**

At the top of `backend/agents/graphs/transformation_advisor.py`, add after `import re`:

```python
import numpy as np
import pandas as pd
```

Then add this function after `_is_safe_custom_code` (before the "Nodes" section):

```python
def _build_sample_df(profile: dict) -> pd.DataFrame:
    """Build a minimal 3-row DataFrame from profile columns for custom code dry-runs.

    Note: integer columns are built with a None value and will have dtype float64
    (standard pandas nullable behavior). This is intentional — it exercises null
    handling that transforms must be robust to. Use pd.isna() rather than int()
    casts when writing transform code.
    """
    columns = list(profile.get("columns", {}).keys())
    if not columns:
        return pd.DataFrame({"value": [1, 2, 3]})
    data: dict = {}
    for col in columns:
        dtype = profile["columns"].get(col, {}).get("type", "object")
        if dtype in ("int64", "int32", "integer", "int"):
            data[col] = [1, 2, None]   # → float64 due to None; intentional
        elif dtype in ("float64", "float32", "float", "double"):
            data[col] = [1.0, 2.5, None]
        elif dtype in ("datetime64[ns]", "datetime", "date"):
            data[col] = pd.to_datetime(["2024-01-01", "2024-01-02", None])
        else:
            data[col] = ["a", "b", None]
    return pd.DataFrame(data)
```

- [ ] **Step 5: Update `validate_custom_code` to perform runtime execution**

Replace the current `validate_custom_code` function (lines 276–289) with:

```python
def validate_custom_code(state: TransformationAdvisorState) -> TransformationAdvisorState:
    """Node 3b: Safety-check AND dry-run the generated custom code."""
    code = state.get("custom_code")

    # Static safety check first — fast, no exec needed
    if not _is_safe_custom_code(code or ""):
        suggestion = dict(state.get("suggestion") or {})
        suggestion["custom_code"] = None
        return {
            **state,
            "custom_code_valid": False,
            "custom_code_error": "Code failed safety check (unsafe patterns or missing transform function)",
            "suggestion": suggestion,
        }

    # Runtime dry-run against a synthetic sample DataFrame
    profile = state.get("profile", {})
    sample_df = _build_sample_df(profile)
    error: str | None = None
    try:
        local_ns: dict = {}
        exec(code, {"pd": pd, "np": np, "__builtins__": {}}, local_ns)  # noqa: S102
        transform_fn = local_ns.get("transform")
        if not callable(transform_fn):
            error = "No callable 'transform' function found in code"
        else:
            result = transform_fn(sample_df.copy())
            if not isinstance(result, pd.DataFrame):
                error = f"transform() must return a DataFrame, got {type(result).__name__}"
    except Exception as exc:
        error = str(exc)

    valid = error is None
    suggestion = dict(state.get("suggestion") or {})
    suggestion["custom_code"] = code if valid else None

    return {
        **state,
        "custom_code_valid": valid,
        "custom_code_error": error,
        "suggestion": suggestion,
    }
```

- [ ] **Step 6: Update `assess_remaining_issues` and `run_transformation_advisor` to include new state keys**

`assess_remaining_issues` is the entry node and resets output state on every run. Its return dict must include the two new keys so the TypedDict is always complete. Update the return statement in `assess_remaining_issues`:

```python
    return {
        **state,
        "done": done,
        "suggestion": None,
        "custom_code": None,
        "custom_code_valid": False,
        "custom_code_error": None,      # ADD
        "custom_code_attempts": 0,      # ADD
    }
```

Also update `run_transformation_advisor`'s `initial_state` dict:

```python
    initial_state: TransformationAdvisorState = {
        # ... existing fields ...
        "custom_code": None,
        "custom_code_valid": False,
        "custom_code_error": None,      # ADD
        "custom_code_attempts": 0,      # ADD
    }
```

- [ ] **Step 7: Run the tests and confirm they pass**

```bash
pytest tests/backend/agents/test_transformation_advisor.py -v
```
Expected: All tests **PASS**

- [ ] **Step 8: Commit**

```bash
git add backend/agents/state.py backend/agents/graphs/transformation_advisor.py \
        tests/backend/agents/test_transformation_advisor.py
git commit -m "feat: validate_custom_code dry-runs exec against sample data"
```

---

## Task 3: Retry / Fix Loop for Custom Code

**Files:**
- Modify: `backend/agents/graphs/transformation_advisor.py`
- Modify: `tests/backend/agents/test_transformation_advisor.py`

When `validate_custom_code` fails, instead of immediately falling through to `format_suggestion` (which clears the code), a new `fix_custom_code` node sends the failing code + error message back to Claude and loops back to `validate_custom_code`. The loop runs at most `MAX_CUSTOM_CODE_ATTEMPTS = 3` times before giving up.

- [ ] **Step 1: Add failing tests for the fix loop**

Append to `tests/backend/agents/test_transformation_advisor.py`:

```python
# ── fix loop (integration-style with mocked Claude) ──────────────────────────

from backend.agents.graphs.transformation_advisor import fix_custom_code

def test_fix_custom_code_increments_attempt_counter():
    """fix_custom_code should increment custom_code_attempts."""
    state = _base_state(
        custom_code="def transform(df):\n    return df['bad']",
        custom_code_error="KeyError: 'bad'",
        custom_code_attempts=0,
    )
    fixed_code = "def transform(df):\n    return df"
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=f"```python\n{fixed_code}\n```")]

    with patch("backend.agents.graphs.transformation_advisor.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        result = fix_custom_code(state)

    assert result["custom_code_attempts"] == 1
    assert result["custom_code"] == fixed_code


def test_fix_custom_code_returns_extracted_code():
    """fix_custom_code should parse the python block from Claude's response."""
    state = _base_state(
        custom_code="bad code",
        custom_code_error="SyntaxError",
        custom_code_attempts=1,
    )
    fixed = "def transform(df):\n    return df.dropna()"
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=f"```python\n{fixed}\n```")]

    with patch("backend.agents.graphs.transformation_advisor.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        result = fix_custom_code(state)

    assert result["custom_code"] == fixed


def test_fix_custom_code_on_api_failure_clears_code():
    """If Claude call fails, fix_custom_code should clear the code gracefully."""
    state = _base_state(
        custom_code="bad",
        custom_code_error="SyntaxError",
        custom_code_attempts=0,
    )
    with patch("backend.agents.graphs.transformation_advisor.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.side_effect = Exception("API error")
        result = fix_custom_code(state)

    assert result["custom_code"] is None
    assert result["custom_code_valid"] is False
    assert result["custom_code_attempts"] == 1  # must increment so routing can give up


def test_route_after_validate_loops_when_invalid_and_under_limit():
    """Routing after failed validation should go to fix_custom_code if attempts < 3."""
    from backend.agents.graphs.transformation_advisor import _route_after_validate
    state = _base_state(custom_code_valid=False, custom_code_attempts=1)
    assert _route_after_validate(state) == "fix_custom_code"


def test_route_after_validate_gives_up_at_limit():
    """After 3 attempts routing should go to format_suggestion (give up)."""
    from backend.agents.graphs.transformation_advisor import _route_after_validate
    state = _base_state(custom_code_valid=False, custom_code_attempts=3)
    assert _route_after_validate(state) == "format_suggestion"


def test_route_after_validate_proceeds_when_valid():
    """Valid code should route to format_suggestion immediately."""
    from backend.agents.graphs.transformation_advisor import _route_after_validate
    state = _base_state(custom_code_valid=True, custom_code_attempts=0)
    assert _route_after_validate(state) == "format_suggestion"
```

- [ ] **Step 2: Run new tests to confirm they fail**

```bash
pytest tests/backend/agents/test_transformation_advisor.py -v -k "fix_loop or route_after_validate or fix_custom_code"
```
Expected: All 6 new tests **FAIL** (`ImportError` or `AssertionError`)

- [ ] **Step 3: Add `MAX_CUSTOM_CODE_ATTEMPTS`, `fix_custom_code`, and `_route_after_validate`**

In `backend/agents/graphs/transformation_advisor.py`, add after the `PREBUILT_TYPES` set at the top:

```python
MAX_CUSTOM_CODE_ATTEMPTS = 3
```

Add the `fix_custom_code` node function after `validate_custom_code`:

```python
def fix_custom_code(state: TransformationAdvisorState) -> TransformationAdvisorState:
    """Node 3c: Send the failing code + error back to Claude for a fix."""
    client = anthropic.Anthropic()

    code = state.get("custom_code", "")
    error = state.get("custom_code_error") or "Unknown error"
    use_case = state.get("use_case", "general ML use case")
    attempts = state.get("custom_code_attempts", 0)

    user_message = f"""The following Python transform function failed:

Error: {error}

Failing code:
```python
{code}
```

Fix the code. The function signature must be:
    def transform(df: pd.DataFrame) -> pd.DataFrame:

Rules:
- pandas available as `pd`, numpy as `np` — no import statements
- Handle edge cases: empty DataFrame, unexpected nulls, wrong dtypes
- Must return a DataFrame

Output ONLY the fixed function in a ```python code block. No prose."""

    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=1500,
            temperature=0,
            system=TRANSFORMATION_ADVISOR_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )
        raw = response.content[0].text
        fixed_code = _extract_python_block(raw)
    except Exception:
        # Must still increment attempts so the routing function can eventually
        # give up — without this the graph would loop forever on API failures.
        return {
            **state,
            "custom_code": None,
            "custom_code_valid": False,
            "custom_code_attempts": attempts + 1,
        }

    return {
        **state,
        "custom_code": fixed_code,
        "custom_code_attempts": attempts + 1,
    }
```

Add the routing function after `fix_custom_code`:

```python
def _route_after_validate(state: TransformationAdvisorState) -> str:
    """Conditional edge after validate_custom_code."""
    if state.get("custom_code_valid"):
        return "format_suggestion"
    if state.get("custom_code_attempts", 0) < MAX_CUSTOM_CODE_ATTEMPTS:
        return "fix_custom_code"
    return "format_suggestion"  # give up — custom_code will be None in suggestion
```

- [ ] **Step 4: Update the graph construction to wire in the new node and routing**

**Important:** The current graph has a direct edge `graph.add_edge("validate_custom_code", "format_suggestion")`. This line **must be deleted** before adding the conditional edge below — LangGraph will raise a compile error if a node has both a direct edge and a conditional edge leaving it.

Replace the entire `build_transformation_advisor_graph()` function with:

```python
def build_transformation_advisor_graph():
    """Build and return the compiled TransformationAdvisor graph."""
    graph = StateGraph(TransformationAdvisorState)

    graph.add_node("assess_remaining_issues", assess_remaining_issues)
    graph.add_node("select_next_transformation", select_next_transformation)
    graph.add_node("generate_custom_code", generate_custom_code)
    graph.add_node("validate_custom_code", validate_custom_code)
    graph.add_node("fix_custom_code", fix_custom_code)       # NEW
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
        {"generate_custom_code": "generate_custom_code", "format_suggestion": "format_suggestion"},
    )
    graph.add_edge("generate_custom_code", "validate_custom_code")

    # UPDATED: conditional routing out of validate_custom_code
    graph.add_conditional_edges(
        "validate_custom_code",
        _route_after_validate,
        {"fix_custom_code": "fix_custom_code", "format_suggestion": "format_suggestion"},
    )
    graph.add_edge("fix_custom_code", "validate_custom_code")  # loop back

    graph.add_edge("format_suggestion", END)

    return graph.compile()
```

- [ ] **Step 5: Run the full test suite to confirm everything passes**

```bash
pytest tests/ -v
```
Expected: All tests **PASS** (both Task 1 and Tasks 2–3)

- [ ] **Step 6: Commit**

```bash
git add backend/agents/graphs/transformation_advisor.py \
        tests/backend/agents/test_transformation_advisor.py
git commit -m "feat: retry loop fixes invalid custom code up to 3 times before giving up"
```
