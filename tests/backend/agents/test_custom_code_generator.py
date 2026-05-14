# tests/backend/agents/test_custom_code_generator.py
import pytest
from unittest.mock import patch, MagicMock
from backend.agents.graphs.custom_code_generator import run_custom_code_generator


def _mock_response(text="", stop_reason="end_turn", tool_uses=None):
    resp = MagicMock()
    resp.stop_reason = stop_reason
    content = []
    if text:
        block = MagicMock(); block.type = "text"; block.text = text
        content.append(block)
    for tu in (tool_uses or []):
        block = MagicMock(); block.type = "tool_use"
        block.id = "t1"; block.name = tu["name"]; block.input = tu["input"]
        content.append(block)
    resp.content = content
    return resp


VALID_CODE = "def transform(df):\n    df['age'] = df['age'].fillna(0)\n    return df"
INVALID_CODE = "def transform(df):\n    import os\n    return df"


@patch("backend.agents.graphs.custom_code_generator.call_claude_with_retry")
@patch("backend.agents.graphs.custom_code_generator.execute_planning_tool")
def test_returns_valid_code_on_first_attempt(mock_tool, mock_call):
    mock_call.return_value = _mock_response(text=f"```python\n{VALID_CODE}\n```")
    mock_tool.return_value = '{"rows": []}'
    step = {"id": "step_1", "type": "custom", "column": "age", "intent": "Fill nulls",
            "target_columns": ["age"], "approach": "fillna(0)", "params": {}}
    result = run_custom_code_generator(
        session_id="test", step=step, prior_context="", human_instruction=None
    )
    assert result["validation_passed"] is True
    assert "def transform" in result["custom_code"]


@patch("backend.agents.graphs.custom_code_generator.call_claude_with_retry")
@patch("backend.agents.graphs.custom_code_generator.execute_planning_tool")
def test_rejects_unsafe_code(mock_tool, mock_call):
    mock_call.return_value = _mock_response(text=f"```python\n{INVALID_CODE}\n```")
    mock_tool.return_value = '{"rows": []}'
    step = {"id": "step_1", "type": "custom", "column": "age", "intent": "Fill nulls",
            "target_columns": ["age"], "approach": "fillna(0)", "params": {}}
    result = run_custom_code_generator(
        session_id="test", step=step, prior_context="", human_instruction=None
    )
    # Should fail safety check and exhaust retries → validation_passed=False
    assert result["validation_passed"] is False


@patch("backend.agents.graphs.custom_code_generator.call_claude_with_retry")
@patch("backend.agents.graphs.custom_code_generator.execute_planning_tool")
def test_human_instruction_injected_into_prompt(mock_tool, mock_call):
    mock_call.return_value = _mock_response(text=f"```python\n{VALID_CODE}\n```")
    mock_tool.return_value = '{"rows": []}'
    step = {"id": "step_1", "type": "custom", "column": "age", "intent": "Fill nulls",
            "target_columns": ["age"], "approach": "fillna(0)", "params": {}}
    result = run_custom_code_generator(
        session_id="test", step=step, prior_context="step_1: +4%",
        human_instruction="Use median not zero"
    )
    # Verify human_instruction was passed in some call
    call_args = mock_call.call_args[1]
    msg_content = str(call_args.get("messages", []))
    assert "median" in msg_content
