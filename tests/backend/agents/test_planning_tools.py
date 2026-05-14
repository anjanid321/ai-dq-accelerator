from unittest.mock import patch
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


@patch("backend.agents.graphs.planning_tools._find_project_root")
def test_execute_unknown_tool_returns_error(mock_root, tmp_path):
    mock_root.return_value = tmp_path
    result = execute_planning_tool("nonexistent_tool", {}, "test-session")
    assert "unknown tool" in result.lower() or "error" in result.lower()


@patch("backend.agents.graphs.planning_tools._find_project_root")
def test_run_sql_rejects_non_select(mock_root, tmp_path):
    mock_root.return_value = tmp_path
    result = execute_planning_tool("run_sql", {"query": "DROP TABLE foo"}, "test-session")
    import json
    parsed = json.loads(result)
    assert "error" in parsed
