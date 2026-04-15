def test_investigation_system_prompt_contains_column_finding_markers():
    from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
    assert "===COLUMN_FINDING_START===" in PROFILE_INVESTIGATION_SYSTEM
    assert "===COLUMN_FINDING_END===" in PROFILE_INVESTIGATION_SYSTEM


def test_investigation_system_prompt_contains_cross_column_markers():
    from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
    assert "===CROSS_COLUMN_FINDING_START===" in PROFILE_INVESTIGATION_SYSTEM
    assert "===CROSS_COLUMN_FINDING_END===" in PROFILE_INVESTIGATION_SYSTEM


def test_investigation_system_prompt_contains_summary_markers():
    from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
    assert "===EXPLORATION_SUMMARY_START===" in PROFILE_INVESTIGATION_SYSTEM
    assert "===EXPLORATION_SUMMARY_END===" in PROFILE_INVESTIGATION_SYSTEM


def test_investigation_system_prompt_contains_visualization_code_field():
    from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
    assert "visualization_code" in PROFILE_INVESTIGATION_SYSTEM
