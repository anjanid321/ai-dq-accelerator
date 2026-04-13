import json
from dataclasses import fields
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_runtime(session_id: str) -> MagicMock:
    """Build a minimal ToolRuntime mock with a context.session_id."""
    runtime = MagicMock()
    runtime.context.session_id = session_id
    return runtime


# ---------------------------------------------------------------------------
# InvestigationContext
# ---------------------------------------------------------------------------

def test_investigation_context_has_session_id_field():
    from backend.agents.graphs.deep_investigate import InvestigationContext
    field_names = {f.name for f in fields(InvestigationContext)}
    assert "session_id" in field_names


def test_investigation_context_stores_session_id():
    from backend.agents.graphs.deep_investigate import InvestigationContext
    ctx = InvestigationContext(session_id="abc-123")
    assert ctx.session_id == "abc-123"


# ---------------------------------------------------------------------------
# dq_run_sql
# ---------------------------------------------------------------------------

@patch("dq_tools.explorer.run_sql")
def test_dq_run_sql_passes_session_id_and_sql(mock_run_sql):
    from backend.agents.graphs.deep_investigate import dq_run_sql
    mock_run_sql.return_value = [{"id": 1}]
    result = dq_run_sql("SELECT 1", _make_runtime("sess-1"))
    mock_run_sql.assert_called_once_with("sess-1", "SELECT 1")
    assert json.loads(result) == [{"id": 1}]


@patch("dq_tools.explorer.run_sql")
def test_dq_run_sql_returns_json_string(mock_run_sql):
    from backend.agents.graphs.deep_investigate import dq_run_sql
    mock_run_sql.return_value = {"error": "bad sql"}
    result = dq_run_sql("BAD", _make_runtime("sess-1"))
    assert isinstance(result, str)
    assert "error" in json.loads(result)


# ---------------------------------------------------------------------------
# dq_get_value_counts
# ---------------------------------------------------------------------------

@patch("dq_tools.explorer.get_value_counts")
def test_dq_get_value_counts_passes_args(mock_gvc):
    from backend.agents.graphs.deep_investigate import dq_get_value_counts
    mock_gvc.return_value = {"column": "email", "top_values": []}
    result = dq_get_value_counts("email", runtime=_make_runtime("sess-2"))
    mock_gvc.assert_called_once_with("sess-2", "email", 20)
    assert isinstance(result, str)


@patch("dq_tools.explorer.get_value_counts")
def test_dq_get_value_counts_respects_top_n(mock_gvc):
    from backend.agents.graphs.deep_investigate import dq_get_value_counts
    mock_gvc.return_value = {}
    dq_get_value_counts("status", 5, runtime=_make_runtime("sess-2"))
    mock_gvc.assert_called_once_with("sess-2", "status", 5)


# ---------------------------------------------------------------------------
# dq_check_regex_pattern
# ---------------------------------------------------------------------------

@patch("dq_tools.explorer.check_regex_pattern")
def test_dq_check_regex_pattern_passes_args(mock_crp):
    from backend.agents.graphs.deep_investigate import dq_check_regex_pattern
    mock_crp.return_value = {"match_rate": 0.95}
    result = dq_check_regex_pattern("email", r".+@.+\..+", _make_runtime("sess-3"))
    mock_crp.assert_called_once_with("sess-3", "email", r".+@.+\..+")
    assert isinstance(result, str)


# ---------------------------------------------------------------------------
# dq_get_sample_rows
# ---------------------------------------------------------------------------

@patch("dq_tools.explorer.get_sample_rows")
def test_dq_get_sample_rows_default_args(mock_gsr):
    from backend.agents.graphs.deep_investigate import dq_get_sample_rows
    mock_gsr.return_value = [{"col": "val"}]
    dq_get_sample_rows(runtime=_make_runtime("sess-4"))
    mock_gsr.assert_called_once_with("sess-4", n=10, where_clause=None)


@patch("dq_tools.explorer.get_sample_rows")
def test_dq_get_sample_rows_with_where_clause(mock_gsr):
    from backend.agents.graphs.deep_investigate import dq_get_sample_rows
    mock_gsr.return_value = []
    dq_get_sample_rows(5, "age IS NULL", runtime=_make_runtime("sess-4"))
    mock_gsr.assert_called_once_with("sess-4", n=5, where_clause="age IS NULL")


# ---------------------------------------------------------------------------
# dq_get_column_detail
# ---------------------------------------------------------------------------

@patch("dq_tools.explorer.get_column_detail")
def test_dq_get_column_detail_passes_args(mock_gcd):
    from backend.agents.graphs.deep_investigate import dq_get_column_detail
    mock_gcd.return_value = {"type": "Numeric", "mean": 3.5}
    result = dq_get_column_detail("age", _make_runtime("sess-5"))
    mock_gcd.assert_called_once_with("sess-5", "age")
    assert isinstance(result, str)
    assert "mean" in json.loads(result)
