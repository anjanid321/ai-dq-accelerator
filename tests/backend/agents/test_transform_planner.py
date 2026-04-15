"""Tests for the refactored TransformPlanner (deep_plan_node-backed)."""
from unittest.mock import patch


def test_run_transform_planner_returns_empty_plan_when_no_fixable_rules():
    from backend.agents.graphs.transform_planner import run_transform_planner
    result = run_transform_planner(
        session_id="test",
        fixable_rules=[],
        validation_results={"baseline_quality_score": 0.75},
        profile={},
        use_case="test",
        transformation_log=[],
    )
    assert result["steps"] == []
    assert result["projected_final_score"] == 0.75
    assert "No transform-fixable" in result["summary"]


def test_finalize_assembles_result():
    from backend.agents.graphs.transform_planner import finalize, TransformPlannerState

    state: TransformPlannerState = {
        "session_id": "s1",
        "fixable_rules": [],
        "validation_results": {},
        "profile": {},
        "use_case": "test",
        "transformation_log": [],
        "plan_steps": [{"id": "step_1"}],
        "plan_summary": "Fix everything.",
        "plan_projected_final_score": 0.92,
        "result": None,
    }

    with patch("backend.agents.graphs.transform_planner.emit"):
        result_state = finalize(state)

    result = result_state["result"]
    assert result is not None
    assert result["steps"] == [{"id": "step_1"}]
    assert result["summary"] == "Fix everything."
    assert result["projected_final_score"] == 0.92


def test_graph_has_correct_nodes():
    from backend.agents.graphs.transform_planner import _build_transform_planner_graph
    g = _build_transform_planner_graph()
    node_names = set(g.nodes)
    assert "deep_plan" in node_names
    assert "finalize" in node_names


def test_run_transform_planner_returns_empty_on_exception():
    from backend.agents.graphs.transform_planner import run_transform_planner

    with patch("backend.agents.graphs.transform_planner._build_transform_planner_graph") as mock_build:
        mock_build.return_value.invoke.side_effect = RuntimeError("boom")
        result = run_transform_planner(
            session_id="test",
            fixable_rules=[{"id": "r1"}],
            validation_results={"baseline_quality_score": 0.5},
            profile={},
            use_case="test",
            transformation_log=[],
        )

    assert result["steps"] == []
    assert result["projected_final_score"] == 0.5
    assert result["summary"] == "Planning failed."
