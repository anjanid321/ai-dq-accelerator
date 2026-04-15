"""Tests for _detect_triage_contradictions."""
import json
import pytest
from unittest.mock import MagicMock, patch


def _mock_llm_response(contradictions: list[dict]) -> MagicMock:
    """Build a mock Anthropic response containing a contradictions JSON."""
    resp = MagicMock()
    block = MagicMock()
    block.text = json.dumps({"contradictions": contradictions})
    resp.content = [block]
    return resp


@patch("backend.agents.graphs.triage_agent.call_claude_with_retry")
def test_detects_fix_cascade(mock_call):
    """null_invalid fix on email will break a passing not_null rule on the same column."""
    from backend.agents.graphs.triage_agent import _detect_triage_contradictions

    client = MagicMock()
    mock_call.return_value = _mock_llm_response([{
        "rule_ids": ["r3", "r7"],
        "conflict_type": "fix_cascade",
        "description": "Fixing r3 null_invalid on email will introduce nulls that break r7 not_null",
        "suggested_fix": {
            "target_rule": "r7",
            "action": "raise_threshold",
            "proposed_threshold": 0.15,
            "rationale": "Accommodate nulls from r3 fix",
        },
    }])

    classifications = [
        {"rule_id": "r3", "classification": "transform_fixable", "check": "null_invalid", "column": "email", "confidence": "high", "reason": "12% bad emails"},
        {"rule_id": "r7", "classification": "transform_fixable", "check": "not_null", "column": "email", "confidence": "high", "reason": "nulls present"},
    ]
    failing_rules = [
        {"id": "r3", "check": "null_invalid", "column": "email", "threshold": 0.0},
        {"id": "r7", "check": "not_null", "column": "email", "threshold": 0.0},
    ]

    result = _detect_triage_contradictions(client, "test-session", classifications, failing_rules, "ML training")

    assert len(result) == 1
    assert result[0]["conflict_type"] == "fix_cascade"
    assert set(result[0]["rule_ids"]) == {"r3", "r7"}
    assert result[0]["suggested_fix"]["action"] == "raise_threshold"
    assert result[0]["suggested_fix"]["proposed_threshold"] == 0.15


@patch("backend.agents.graphs.triage_agent.call_claude_with_retry")
def test_returns_empty_when_no_contradictions(mock_call):
    """Returns [] when the LLM finds no contradictions."""
    from backend.agents.graphs.triage_agent import _detect_triage_contradictions

    client = MagicMock()
    mock_call.return_value = _mock_llm_response([])

    classifications = [
        {"rule_id": "r1", "classification": "transform_fixable", "check": "not_null", "column": "id", "confidence": "high", "reason": "nulls"},
        {"rule_id": "r2", "classification": "transform_fixable", "check": "not_null", "column": "name", "confidence": "high", "reason": "nulls"},
    ]
    failing_rules = [
        {"id": "r1", "check": "not_null", "column": "id", "threshold": 0.0},
        {"id": "r2", "check": "not_null", "column": "name", "threshold": 0.0},
    ]

    result = _detect_triage_contradictions(client, "test-session", classifications, failing_rules, "ML")

    assert result == []


@patch("backend.agents.graphs.triage_agent.call_claude_with_retry")
def test_returns_empty_on_llm_failure(mock_call):
    """Exceptions from the LLM call return [] without raising."""
    from backend.agents.graphs.triage_agent import _detect_triage_contradictions

    client = MagicMock()
    mock_call.side_effect = Exception("API timeout")

    classifications = [
        {"rule_id": "r1", "classification": "transform_fixable", "check": "null_invalid", "column": "x", "confidence": "high", "reason": "bad"},
        {"rule_id": "r2", "classification": "transform_fixable", "check": "not_null", "column": "x", "confidence": "high", "reason": "nulls"},
    ]
    failing_rules = [
        {"id": "r1", "check": "null_invalid", "column": "x", "threshold": 0.0},
        {"id": "r2", "check": "not_null", "column": "x", "threshold": 0.0},
    ]

    result = _detect_triage_contradictions(client, "test-session", classifications, failing_rules, "ML")

    assert result == []


def test_skipped_with_single_rule():
    """No LLM call made when only one rule — contradictions require pairs."""
    from backend.agents.graphs.triage_agent import _detect_triage_contradictions

    client = MagicMock()
    classifications = [
        {"rule_id": "r1", "classification": "transform_fixable", "check": "not_null", "column": "id", "confidence": "high", "reason": "nulls"},
    ]
    failing_rules = [{"id": "r1", "check": "not_null", "column": "id", "threshold": 0.0}]

    result = _detect_triage_contradictions(client, "test-session", classifications, failing_rules, "ML")

    assert result == []
    client.messages.create.assert_not_called()
