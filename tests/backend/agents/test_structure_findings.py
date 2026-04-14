# tests/backend/agents/test_structure_findings.py
from unittest.mock import MagicMock, patch
from backend.agents.state import ProfileAnalyzerState


def _make_state(**overrides) -> ProfileAnalyzerState:
    base: ProfileAnalyzerState = {
        "session_id": "test-session",
        "use_case": "test use case",
        "target_column": None,
        "description": None,
        "overview_notes": "",
        "columns_to_investigate": [],
        "investigation_findings": "Email column: 847 values (3.2%) fail email format. Null count: 234 (0.9%). Assuming nulls are missing data.",
        "cross_column_findings": [],
        "exploration_findings": {},
        "exploration_notebook_path": "",
        "investigation_feedback": None,
        "investigation_round": 0,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": [],
        "top_issues": [],
    }
    base.update(overrides)
    return base


SAMPLE_FINDINGS_JSON = """{
  "column_findings": [
    {
      "column": "Email",
      "semantic_meaning": "Customer contact email",
      "data_type_actual": "text",
      "stats": {"null_count": 234, "null_pct": 0.9, "distinct_count": 25847, "total_rows": 26500},
      "full_analysis": "Email column: 847 values (3.2%) fail email format. Null count: 234 (0.9%). Assuming nulls are missing data.",
      "issues": [{"description": "847 values (3.2%) fail email format", "severity": "warning", "count": 847, "pct": 3.2, "sample_values": ["noemail"], "where_clause": null}],
      "assumptions": ["Assuming nulls represent missing data"],
      "rule_implications": ["Validity rule: email format regex"]
    }
  ],
  "cross_column_findings": [],
  "open_questions": [],
  "readiness_assessment": "moderate",
  "key_risks": []
}"""


def test_structure_findings_node_populates_exploration_findings():
    from backend.agents.graphs.profile_analyzer import structure_findings_node

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=SAMPLE_FINDINGS_JSON)]

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response

    with patch("backend.agents.graphs.profile_analyzer.call_claude_with_retry",
               return_value=mock_response):
        with patch("anthropic.Anthropic", return_value=mock_client):
            state = _make_state()
            result = structure_findings_node(state)

    assert isinstance(result["exploration_findings"], dict)
    assert len(result["exploration_findings"]["column_findings"]) == 1
    assert result["exploration_findings"]["column_findings"][0]["column"] == "Email"


def test_structure_findings_node_populates_cross_column_findings():
    from backend.agents.graphs.profile_analyzer import structure_findings_node

    findings_with_cross = SAMPLE_FINDINGS_JSON.replace(
        '"cross_column_findings": []',
        '"cross_column_findings": [{"columns": ["A", "B"], "full_analysis": "test", "pattern": "p", "severity": "warning", "investigation_sql": null, "rule_implications": []}]'
    )
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=findings_with_cross)]

    with patch("backend.agents.graphs.profile_analyzer.call_claude_with_retry",
               return_value=mock_response):
        with patch("anthropic.Anthropic"):
            state = _make_state()
            result = structure_findings_node(state)

    assert len(result["cross_column_findings"]) == 1
    assert result["cross_column_findings"][0]["columns"] == ["A", "B"]


def test_structure_findings_node_fallback_on_invalid_json():
    from backend.agents.graphs.profile_analyzer import structure_findings_node

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text="NOT VALID JSON AT ALL")]

    with patch("backend.agents.graphs.profile_analyzer.call_claude_with_retry",
               return_value=mock_response):
        with patch("anthropic.Anthropic"):
            state = _make_state()
            result = structure_findings_node(state)

    # Fallback: should return a minimal valid structure, not crash
    assert isinstance(result["exploration_findings"], dict)
    assert "column_findings" in result["exploration_findings"]
    assert result["exploration_findings"]["column_findings"][0]["column"] == "__raw__"


def test_structure_findings_node_preserves_existing_state():
    from backend.agents.graphs.profile_analyzer import structure_findings_node

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=SAMPLE_FINDINGS_JSON)]

    with patch("backend.agents.graphs.profile_analyzer.call_claude_with_retry",
               return_value=mock_response):
        with patch("anthropic.Anthropic"):
            state = _make_state(use_case="HR data pipeline")
            result = structure_findings_node(state)

    assert result["use_case"] == "HR data pipeline"
    assert result["investigation_findings"] == state["investigation_findings"]
