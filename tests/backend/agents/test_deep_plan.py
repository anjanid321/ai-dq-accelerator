# tests/backend/agents/test_deep_plan.py
"""Tests for deep_plan — parser and node wiring."""
import json


def _make_state(**overrides):
    base = {
        "session_id": "test-abc",
        "fixable_rules": [],
        "validation_results": {"baseline_quality_score": 0.7},
        "profile": {"columns": {}},
        "use_case": "test",
        "transformation_log": [],
        "plan_steps": [],
        "plan_summary": "",
        "plan_projected_final_score": 0.0,
        "result": None,
    }
    return {**base, **overrides}


def test_parse_empty_text():
    from backend.agents.graphs.deep_plan import _parse_structured_plan
    steps, summary = _parse_structured_plan("")
    assert steps == []
    assert summary == {}


def test_parse_single_step_and_summary():
    from backend.agents.graphs.deep_plan import _parse_structured_plan

    step = {
        "id": "step_1",
        "type": "impute_constant",
        "column": "age",
        "params": {"column": "age", "value": 0},
        "rationale": "Fill nulls with 0",
        "targets_rules": ["r1"],
        "depends_on": [],
        "conflicts_with": [],
        "projected_score_delta": 0.05,
    }
    text = f"""
Investigating age column — 312 nulls found.

===TRANSFORM_STEP_START===
{json.dumps(step)}
===TRANSFORM_STEP_END===

===PLAN_SUMMARY_START===
{{"summary": "Impute nulls in age.", "projected_final_score": 0.85}}
===PLAN_SUMMARY_END===
"""
    steps, summary = _parse_structured_plan(text)
    assert len(steps) == 1
    assert steps[0]["id"] == "step_1"
    assert steps[0]["type"] == "impute_constant"
    assert summary["projected_final_score"] == 0.85
    assert summary["summary"] == "Impute nulls in age."


def test_parse_multiple_steps_preserves_order():
    from backend.agents.graphs.deep_plan import _parse_structured_plan

    step1 = {"id": "step_1", "type": "null_invalid", "column": "email",
              "params": {"column": "email", "pattern": "^[^@]+@[^@]+\\.[^@]+$"},
              "rationale": "Null bad emails", "targets_rules": ["r2"],
              "depends_on": [], "conflicts_with": [], "projected_score_delta": 0.1}
    step2 = {"id": "step_2", "type": "impute_mode", "column": "email",
              "params": {"column": "email"}, "rationale": "Fill remaining nulls",
              "targets_rules": ["r3"], "depends_on": ["step_1"],
              "conflicts_with": [], "projected_score_delta": 0.05}
    text = f"""
===TRANSFORM_STEP_START===
{json.dumps(step1)}
===TRANSFORM_STEP_END===

===TRANSFORM_STEP_START===
{json.dumps(step2)}
===TRANSFORM_STEP_END===

===PLAN_SUMMARY_START===
{{"summary": "Email fix.", "projected_final_score": 0.90}}
===PLAN_SUMMARY_END===
"""
    steps, summary = _parse_structured_plan(text)
    assert len(steps) == 2
    assert steps[0]["id"] == "step_1"
    assert steps[1]["id"] == "step_2"
    assert steps[1]["depends_on"] == ["step_1"]


def test_parse_invalid_json_block_skipped():
    from backend.agents.graphs.deep_plan import _parse_structured_plan

    valid_step = {"id": "step_1", "type": "deduplicate", "params": {},
                  "rationale": "ok", "targets_rules": [], "depends_on": [],
                  "conflicts_with": [], "projected_score_delta": 0.02}
    text = f"""
===TRANSFORM_STEP_START===
not valid json {{{{
===TRANSFORM_STEP_END===

===TRANSFORM_STEP_START===
{json.dumps(valid_step)}
===TRANSFORM_STEP_END===
"""
    steps, _ = _parse_structured_plan(text)
    assert len(steps) == 1
    assert steps[0]["id"] == "step_1"


def test_parse_missing_summary_returns_empty_dict():
    from backend.agents.graphs.deep_plan import _parse_structured_plan

    step = {"id": "step_1", "type": "deduplicate", "params": {},
            "rationale": "ok", "targets_rules": [], "depends_on": [],
            "conflicts_with": [], "projected_score_delta": 0.02}
    text = f"""
===TRANSFORM_STEP_START===
{json.dumps(step)}
===TRANSFORM_STEP_END===
"""
    steps, summary = _parse_structured_plan(text)
    assert len(steps) == 1
    assert summary == {}


def test_deep_plan_node_applies_step_defaults(monkeypatch):
    """deep_plan_node applies required defaults even when agent omits optional fields."""
    from backend.agents.graphs import deep_plan
    from langchain_core.messages import AIMessage

    raw_step = {
        "id": "step_1",
        "type": "deduplicate",
        "params": {},
        "rationale": "Remove duplicates",
        "targets_rules": [],
        "projected_score_delta": 0.1,
        # intentionally omit depends_on, conflicts_with, needs_review, status, etc.
    }
    step_block = (
        f"===TRANSFORM_STEP_START===\n{json.dumps(raw_step)}\n===TRANSFORM_STEP_END===\n"
        f"===PLAN_SUMMARY_START===\n"
        f'{{"summary": "Dedup plan.", "projected_final_score": 0.80}}\n'
        f"===PLAN_SUMMARY_END==="
    )

    class _FakeAgent:
        def stream(self, *args, **kwargs):
            yield {"messages": [AIMessage(content=step_block)]}

    monkeypatch.setattr(deep_plan, "_build_deep_plan_agent", lambda: _FakeAgent())
    monkeypatch.setattr(deep_plan, "_emit", lambda *a, **kw: None)

    result = deep_plan.deep_plan_node(_make_state())

    assert len(result["plan_steps"]) == 1
    step = result["plan_steps"][0]
    assert step["needs_review"] is False
    assert step["status"] == "pending"
    assert step["custom_code"] is None
    assert step["depends_on"] == []
    assert step["conflicts_with"] == []
    assert result["plan_summary"] == "Dedup plan."
    assert result["plan_projected_final_score"] == 0.80


def test_deep_plan_node_falls_back_to_baseline_score_when_no_summary(monkeypatch):
    from backend.agents.graphs import deep_plan
    from langchain_core.messages import AIMessage

    class _FakeAgent:
        def stream(self, *args, **kwargs):
            yield {"messages": [AIMessage(content="no markers here")]}

    monkeypatch.setattr(deep_plan, "_build_deep_plan_agent", lambda: _FakeAgent())
    monkeypatch.setattr(deep_plan, "_emit", lambda *a, **kw: None)

    result = deep_plan.deep_plan_node(
        _make_state(validation_results={"baseline_quality_score": 0.65})
    )
    assert result["plan_steps"] == []
    assert result["plan_summary"] == ""
    assert result["plan_projected_final_score"] == 0.65
