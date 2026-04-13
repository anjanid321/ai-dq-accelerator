import json
from dataclasses import fields
from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessage, ToolMessage


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


# ---------------------------------------------------------------------------
# _build_deep_investigate_agent
# ---------------------------------------------------------------------------

@patch("backend.agents.graphs.deep_investigate.ChatAnthropic")
@patch("backend.agents.graphs.deep_investigate.create_deep_agent")
def test_build_agent_calls_create_deep_agent(mock_create, mock_anthropic):
    from backend.agents.graphs.deep_investigate import _build_deep_investigate_agent
    mock_create.return_value = MagicMock()
    _build_deep_investigate_agent()
    assert mock_create.called


@patch("backend.agents.graphs.deep_investigate.ChatAnthropic")
@patch("backend.agents.graphs.deep_investigate.create_deep_agent")
def test_build_agent_passes_context_schema(mock_create, mock_anthropic):
    from backend.agents.graphs.deep_investigate import (
        InvestigationContext,
        _build_deep_investigate_agent,
    )
    mock_create.return_value = MagicMock()
    _build_deep_investigate_agent()
    kwargs = mock_create.call_args.kwargs
    assert kwargs.get("context_schema") is InvestigationContext


@patch("backend.agents.graphs.deep_investigate.ChatAnthropic")
@patch("backend.agents.graphs.deep_investigate.create_deep_agent")
def test_build_agent_passes_all_five_tools(mock_create, mock_anthropic):
    from backend.agents.graphs.deep_investigate import _build_deep_investigate_agent
    mock_create.return_value = MagicMock()
    _build_deep_investigate_agent()
    kwargs = mock_create.call_args.kwargs
    tool_names = {t.__name__ for t in kwargs["tools"]}
    assert tool_names == {
        "dq_run_sql",
        "dq_get_value_counts",
        "dq_check_regex_pattern",
        "dq_get_sample_rows",
        "dq_get_column_detail",
    }


@patch("backend.agents.graphs.deep_investigate.ChatAnthropic")
@patch("backend.agents.graphs.deep_investigate.create_deep_agent")
def test_build_agent_passes_investigation_system_prompt(mock_create, mock_anthropic):
    from backend.agents.graphs.deep_investigate import _build_deep_investigate_agent
    from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
    mock_create.return_value = MagicMock()
    _build_deep_investigate_agent()
    kwargs = mock_create.call_args.kwargs
    assert kwargs.get("system_prompt") == PROFILE_INVESTIGATION_SYSTEM


# ---------------------------------------------------------------------------
# deep_investigate_node
# ---------------------------------------------------------------------------

def _make_state(session_id: str = "test-session") -> dict:
    return {
        "session_id": session_id,
        "use_case": "HR employee records",
        "target_column": None,
        "overview_notes": "Dataset has 5 columns including email and hire_date.",
        "columns_to_investigate": [
            {"column": "email", "reason": "format check"},
            {"column": "hire_date", "reason": "date range plausibility"},
        ],
        "investigation_findings": "",
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": [],
        "top_issues": [],
    }


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_extracts_findings(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    last_msg = MagicMock(spec=AIMessage)
    last_msg.content = "email column has invalid formats in 847 rows (15%)."
    last_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [last_msg]}])
    mock_build.return_value = mock_agent

    result = deep_investigate_node(_make_state())
    assert result["investigation_findings"] == "email column has invalid formats in 847 rows (15%)."


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_preserves_other_state_fields(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    last_msg = MagicMock(spec=AIMessage)
    last_msg.content = "findings"
    last_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [last_msg]}])
    mock_build.return_value = mock_agent

    state = _make_state()
    state["data_passport"] = "existing passport"
    result = deep_investigate_node(state)
    assert result["data_passport"] == "existing passport"
    assert result["use_case"] == "HR employee records"


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_emits_done_event(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    last_msg = MagicMock(spec=AIMessage)
    last_msg.content = "done"
    last_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [last_msg]}])
    mock_build.return_value = mock_agent

    deep_investigate_node(_make_state())
    done_calls = [c for c in mock_emit.call_args_list if c.args[1] == "done"]
    assert len(done_calls) == 1


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_emits_thinking_for_ai_message(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    ai_msg = MagicMock(spec=AIMessage)
    ai_msg.content = "I will investigate the email column first."
    ai_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [ai_msg]}])
    mock_build.return_value = mock_agent

    deep_investigate_node(_make_state())
    thinking_calls = [c for c in mock_emit.call_args_list if c.args[1] == "thinking"]
    assert len(thinking_calls) >= 1


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_handles_empty_stream(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    mock_agent.stream.return_value = iter([])
    mock_build.return_value = mock_agent

    result = deep_investigate_node(_make_state())
    assert result["investigation_findings"] == ""


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_clears_progress_file(mock_build, mock_emit, tmp_path):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    last_msg = MagicMock(spec=AIMessage)
    last_msg.content = "findings"
    last_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [last_msg]}])
    mock_build.return_value = mock_agent

    # Create a stale progress file
    session_dir = tmp_path / "data" / "sessions" / "test-session"
    session_dir.mkdir(parents=True)
    stale_file = session_dir / "investigation_progress.jsonl"
    stale_file.write_text('{"event": "stale"}\n')

    with patch(
        "backend.agents.graphs.deep_investigate._find_project_root",
        return_value=tmp_path,
    ):
        deep_investigate_node(_make_state())

    assert not stale_file.exists()


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_emits_tool_call_event(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    ai_msg = MagicMock(spec=AIMessage)
    ai_msg.content = ""
    ai_msg.tool_calls = [{"name": "dq_run_sql", "args": {"sql": "SELECT 1"}}]
    mock_agent.stream.return_value = iter([{"messages": [ai_msg]}])
    mock_build.return_value = mock_agent

    deep_investigate_node(_make_state())
    tool_call_events = [c for c in mock_emit.call_args_list if c.args[1] == "tool_call"]
    assert len(tool_call_events) == 1
    assert tool_call_events[0].kwargs["tool"] == "dq_run_sql"


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_emits_tool_result_event(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    tool_msg = MagicMock(spec=ToolMessage)
    tool_msg.content = '{"rows": []}'
    tool_msg.name = "dq_run_sql"
    mock_agent.stream.return_value = iter([{"messages": [tool_msg]}])
    mock_build.return_value = mock_agent

    deep_investigate_node(_make_state())
    tool_result_events = [c for c in mock_emit.call_args_list if c.args[1] == "tool_result"]
    assert len(tool_result_events) == 1


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_includes_target_column_in_message(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    last_msg = MagicMock(spec=AIMessage)
    last_msg.content = "findings"
    last_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [last_msg]}])
    mock_build.return_value = mock_agent

    state = _make_state()
    state["target_column"] = "churn_label"
    deep_investigate_node(state)

    call_args = mock_agent.stream.call_args
    initial_input = call_args.args[0]
    content = initial_input["messages"][0].content
    assert "churn_label" in content
