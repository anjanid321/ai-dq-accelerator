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
        "prebuilt_error": None,
        "prebuilt_attempts": 0,
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
    code = "def transform(df):\n    x = 1 / 0"  # Division by zero always fails
    state = _base_state(custom_code=code)
    result = validate_custom_code(state)
    assert result["custom_code_valid"] is False
    assert result["custom_code_error"] is not None  # Error message should be captured
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
