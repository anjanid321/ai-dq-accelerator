"""Tests for deep_rule_review_node."""
import json
import pytest
from unittest.mock import MagicMock, patch
from langchain_core.messages import AIMessage


def _make_state(suggested_rules: list[dict]) -> dict:
    return {
        "session_id": "test-session-id",
        "use_case": "ML churn prediction",
        "target_column": None,
        "description": None,
        "overview_notes": "",
        "columns_to_investigate": [],
        "investigation_findings": "",
        "cross_column_findings": [],
        "exploration_findings": {
            "column_findings": [
                {
                    "column": "email",
                    "stats": {"null_pct": 0.02, "distinct_count": 9800, "total_rows": 10000},
                }
            ],
            "cross_column_findings": [],
            "open_questions": [],
            "readiness_assessment": "good",
            "key_risks": [],
        },
        "exploration_notebook_path": "",
        "investigation_feedback": None,
        "investigation_round": 0,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": suggested_rules,
        "top_issues": [],
        "rule_revision_log": [],
    }


def _make_agent_stream(output: dict) -> MagicMock:
    """Return a mock agent whose .stream() yields one chunk with a final AIMessage."""
    fake_agent = MagicMock()
    fake_agent.stream.return_value = iter([
        {"messages": [AIMessage(content=json.dumps(output))]}
    ])
    return fake_agent


@patch("backend.agents.graphs.deep_rule_review.create_deep_agent")
def test_no_contradictions_returns_original_rules(mock_create):
    """When agent finds no conflicts, suggested_rules is unchanged and revision_log is empty."""
    from backend.agents.graphs.deep_rule_review import deep_rule_review_node

    rules = [
        {"id": "r1", "check": "not_null", "column": "customer_id", "threshold": 0.0, "rationale": "PK"},
    ]
    mock_create.return_value = _make_agent_stream({
        "revised_rules": rules,
        "revision_log": [],
    })

    result = deep_rule_review_node(_make_state(rules))

    assert result["suggested_rules"] == rules
    assert result["rule_revision_log"] == []


@patch("backend.agents.graphs.deep_rule_review.create_deep_agent")
def test_null_conflict_raises_not_null_threshold(mock_create):
    """null_invalid + not_null at 0% threshold → not_null threshold raised."""
    from backend.agents.graphs.deep_rule_review import deep_rule_review_node

    rules = [
        {"id": "r1", "check": "null_invalid", "column": "email", "pattern": r".*@.*", "threshold": 0.0, "rationale": "Bad emails nulled"},
        {"id": "r2", "check": "not_null", "column": "email", "threshold": 0.0, "rationale": "Email required"},
    ]
    revised = [
        {"id": "r1", "check": "null_invalid", "column": "email", "pattern": r".*@.*", "threshold": 0.0, "rationale": "Bad emails nulled"},
        {"id": "r2", "check": "not_null", "column": "email", "threshold": 0.15, "rationale": "Email required"},
    ]
    mock_create.return_value = _make_agent_stream({
        "revised_rules": revised,
        "revision_log": [{
            "rule_ids": ["r1", "r2"],
            "conflict_type": "null_conflict",
            "description": "r1 null_invalid will null ~15% of email rows; r2 not_null has 0% threshold",
            "resolution": "Raised r2 threshold from 0.0 to 0.15",
            "original_rules": {"r1": rules[0], "r2": rules[1]},
        }],
    })

    result = deep_rule_review_node(_make_state(rules))

    assert result["suggested_rules"][1]["threshold"] == 0.15
    assert len(result["rule_revision_log"]) == 1
    assert result["rule_revision_log"][0]["conflict_type"] == "null_conflict"
    assert result["rule_revision_log"][0]["rule_ids"] == ["r1", "r2"]


@patch("backend.agents.graphs.deep_rule_review.create_deep_agent")
def test_agent_parse_failure_falls_back_to_original_rules(mock_create):
    """If agent output is unparseable, original suggested_rules are preserved unchanged."""
    from backend.agents.graphs.deep_rule_review import deep_rule_review_node

    rules = [{"id": "r1", "check": "not_null", "column": "id", "threshold": 0.0, "rationale": "PK"}]
    fake_agent = MagicMock()
    fake_agent.stream.return_value = iter([
        {"messages": [AIMessage(content="I found no contradictions in these rules.")]}
    ])
    mock_create.return_value = fake_agent

    result = deep_rule_review_node(_make_state(rules))

    assert result["suggested_rules"] == rules
    assert result["rule_revision_log"] == []


@patch("backend.agents.graphs.deep_rule_review.create_deep_agent")
def test_original_rules_preserved_in_revision_log(mock_create):
    """original_rules snapshot in the log matches the pre-revision rule dicts."""
    from backend.agents.graphs.deep_rule_review import deep_rule_review_node

    rules = [
        {"id": "r1", "check": "null_invalid", "column": "age", "pattern": r"^\d+$", "threshold": 0.0, "rationale": "Age must be numeric"},
        {"id": "r2", "check": "not_null", "column": "age", "threshold": 0.0, "rationale": "Age required"},
    ]
    revised = [rules[0], {**rules[1], "threshold": 0.1}]
    log_entry = {
        "rule_ids": ["r1", "r2"],
        "conflict_type": "null_conflict",
        "description": "r1 will null non-numeric age values",
        "resolution": "Raised r2 threshold to 0.1",
        "original_rules": {"r1": rules[0], "r2": rules[1]},
    }
    mock_create.return_value = _make_agent_stream({"revised_rules": revised, "revision_log": [log_entry]})

    result = deep_rule_review_node(_make_state(rules))

    assert result["rule_revision_log"][0]["original_rules"]["r2"]["threshold"] == 0.0
