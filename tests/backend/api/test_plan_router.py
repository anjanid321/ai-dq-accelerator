# tests/backend/api/test_plan_router.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from fastapi import FastAPI
from backend.api.routers.plan_router import router


@pytest.fixture
def app():
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    mock_client = MagicMock()
    app.state.temporal_client = mock_client
    return app


@pytest.fixture
def client(app):
    return TestClient(app)


def test_approve_plan_sends_signal(client, app):
    mock_handle = AsyncMock()
    app.state.temporal_client.get_workflow_handle.return_value = mock_handle
    response = client.post(
        "/api/v1/sessions/test-session/plan/approve",
        json={"steps": [{"id": "step_1", "type": "impute_constant"}]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["accepted"] is True
    assert data["steps_count"] == 1
    mock_handle.signal.assert_called_once()


def test_approve_plan_404_on_missing_session(client, app):
    from temporalio.service import RPCError, RPCStatusCode
    mock_handle = AsyncMock()
    mock_handle.signal.side_effect = RPCError("not found", RPCStatusCode.NOT_FOUND, None)
    app.state.temporal_client.get_workflow_handle.return_value = mock_handle
    response = client.post(
        "/api/v1/sessions/missing/plan/approve",
        json={"steps": []},
    )
    assert response.status_code == 404


def test_resolve_escalation_sends_signal(client, app):
    mock_handle = AsyncMock()
    app.state.temporal_client.get_workflow_handle.return_value = mock_handle
    response = client.post(
        "/api/v1/sessions/test-session/execution/resolve",
        json={"action": "continue_anyway"},
    )
    assert response.status_code == 200
    assert response.json()["accepted"] is True
    mock_handle.signal.assert_called_once()


def test_resolve_escalation_with_instruction(client, app):
    mock_handle = AsyncMock()
    app.state.temporal_client.get_workflow_handle.return_value = mock_handle
    response = client.post(
        "/api/v1/sessions/test-session/execution/resolve",
        json={"action": "provide_instruction", "instruction": "Use median"},
    )
    assert response.status_code == 200
    signal_call = mock_handle.signal.call_args
    payload = signal_call[0][1]
    assert payload["instruction"] == "Use median"
