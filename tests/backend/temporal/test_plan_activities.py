# tests/backend/temporal/test_plan_activities.py
import pytest
from unittest.mock import patch, MagicMock
from backend.temporal.activities.transform_activities import (
    plan_transforms_activity,
    generate_custom_code_activity,
)


@patch("backend.temporal.activities.transform_activities.run_transform_planner")
async def test_plan_transforms_activity_calls_planner(mock_planner):
    mock_planner.return_value = {"steps": [], "summary": "", "projected_final_score": 0.8}
    params = {
        "session_id": "s1",
        "fixable_rules": [],
        "validation_results": {},
        "profile": {},
        "use_case": "test",
        "transformation_log": [],
    }
    result = await plan_transforms_activity(params)
    assert result == {"steps": [], "summary": "", "projected_final_score": 0.8}
    mock_planner.assert_called_once_with(
        session_id="s1", fixable_rules=[], validation_results={},
        profile={}, use_case="test", transformation_log=[]
    )


@patch("backend.temporal.activities.transform_activities.run_custom_code_generator")
async def test_generate_custom_code_activity_calls_generator(mock_gen):
    mock_gen.return_value = {"custom_code": "def transform(df): return df", "validation_passed": True}
    step = {"id": "step_1", "type": "custom", "intent": "fill", "target_columns": ["age"], "params": {}}
    params = {"session_id": "s1", "step": step, "prior_context": "", "human_instruction": None}
    result = await generate_custom_code_activity(params)
    assert result["validation_passed"] is True
    mock_gen.assert_called_once_with(
        session_id="s1", step=step, prior_context="", human_instruction=None
    )
