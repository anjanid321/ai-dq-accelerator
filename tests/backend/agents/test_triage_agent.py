"""Unit tests for triage agent classification output structure."""
import pytest
from unittest.mock import patch, MagicMock


def _make_failing_rule(rule_id: str, check: str, column: str | None,
                        failure_count: int, failure_rate: float,
                        threshold: float = 0.0, error: str | None = None) -> dict:
    return {
        "id": rule_id,
        "category": "validity",
        "check": check,
        "column": column,
        "passed": False,
        "failure_count": failure_count,
        "failure_rate": failure_rate,
        "threshold": threshold,
        "sample_failing_rows": [],
        "rationale": "Test rule",
        "error": error,
    }


def test_triage_output_has_required_keys():
    """Each classification must have all required keys."""
    from backend.agents.graphs.triage_agent import _validate_classifications

    classifications = [
        {
            "rule_id": "r1",
            "check": "not_null",
            "column": "col_a",
            "classification": "transform_fixable",
            "proposed_threshold": None,
            "proposed_remove": False,
            "reason": "Nulls are imputable",
            "confidence": "high",
        }
    ]
    result = _validate_classifications(classifications, [_make_failing_rule("r1", "not_null", "col_a", 100, 0.01)])
    assert len(result) == 1
    assert result[0]["rule_id"] == "r1"
    assert result[0]["classification"] == "transform_fixable"


def test_triage_fallback_covers_all_rules():
    """If agent output is missing a rule, fallback fills it in as transform_fixable."""
    from backend.agents.graphs.triage_agent import _validate_classifications

    failing_rules = [
        _make_failing_rule("r1", "not_null", "col_a", 100, 0.01),
        _make_failing_rule("r2", "unique", "col_b", 5, 0.0001),
    ]
    # Agent only classified r1
    partial_classifications = [
        {"rule_id": "r1", "check": "not_null", "column": "col_a",
         "classification": "transform_fixable", "proposed_threshold": None,
         "proposed_remove": False, "reason": "ok", "confidence": "high"}
    ]
    result = _validate_classifications(partial_classifications, failing_rules)
    assert len(result) == 2
    r2 = next(c for c in result if c["rule_id"] == "r2")
    assert r2["classification"] == "transform_fixable"
    assert r2["confidence"] == "low"


def test_eval_error_rules_get_proposed_remove():
    """Rules with error field should be proposed for removal."""
    from backend.agents.graphs.triage_agent import _validate_classifications

    failing_rules = [
        _make_failing_rule("r1", "custom_sql", None, 0, 0.0, error="CatalogException: column not found"),
    ]
    classifications = [
        {"rule_id": "r1", "check": "custom_sql", "column": None,
         "classification": "eval_error", "proposed_threshold": None,
         "proposed_remove": True, "reason": "SQL error", "confidence": "high"}
    ]
    result = _validate_classifications(classifications, failing_rules)
    assert result[0]["proposed_remove"] is True


def test_summary_counts_match_classifications():
    """_build_summary correctly counts each classification bucket."""
    from backend.agents.graphs.triage_agent import _build_summary

    classifications = [
        {"classification": "transform_fixable"},
        {"classification": "transform_fixable"},
        {"classification": "threshold_too_strict"},
        {"classification": "unfixable"},
        {"classification": "eval_error"},
    ]
    summary = _build_summary(classifications)
    assert summary["transform_fixable"] == 2
    assert summary["threshold_too_strict"] == 1
    assert summary["unfixable"] == 1
    assert summary["eval_error"] == 1


def test_run_triage_agent_returns_valid_structure_on_empty_rules():
    """run_triage_agent with no failing rules returns empty classifications."""
    from backend.agents.graphs.triage_agent import run_triage_agent

    with patch("backend.agents.graphs.triage_agent.build_triage_graph") as mock_build:
        mock_app = MagicMock()
        mock_app.invoke.return_value = {"classifications": [], "summary": {}}
        mock_build.return_value = mock_app

        result = run_triage_agent("test-session", [], "test use case")
        assert "classifications" in result
        assert "summary" in result
        assert result["classifications"] == []


def test_validate_classifications_requires_all_rules_covered():
    """Every failing rule must appear in output even if agent missed it."""
    from backend.agents.graphs.triage_agent import _validate_classifications

    failing_rules = [
        _make_failing_rule("r1", "not_null", "col_a", 10, 0.01),
        _make_failing_rule("r2", "unique", "col_b", 5, 0.005),
        _make_failing_rule("r3", "custom_sql", None, 0, 0.0, error="syntax error"),
    ]
    # Agent classified only r1
    partial = [
        {"rule_id": "r1", "check": "not_null", "column": "col_a",
         "classification": "transform_fixable", "proposed_threshold": None,
         "proposed_remove": False, "reason": "ok", "confidence": "high"}
    ]
    result = _validate_classifications(partial, failing_rules)
    ids = [c["rule_id"] for c in result]
    assert "r1" in ids
    assert "r2" in ids
    assert "r3" in ids
    # r3 has error → should be eval_error with proposed_remove=True
    r3 = next(c for c in result if c["rule_id"] == "r3")
    assert r3["proposed_remove"] is True
