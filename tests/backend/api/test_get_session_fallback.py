import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from temporalio.service import RPCError, RPCStatusCode

from backend.api.routers import sessions as sessions_router
from backend.db.repository import insert_session, upsert_snapshot


@pytest.fixture
async def client(app_engine):
    app = FastAPI()
    app.include_router(sessions_router.router, prefix="/api/v1")
    fake = MagicMock()
    fake_handle = MagicMock()
    fake_handle.query = AsyncMock(side_effect=RPCError("gone", RPCStatusCode.NOT_FOUND, None))
    fake.get_workflow_handle = MagicMock(return_value=fake_handle)
    app.state.temporal_client = fake
    app.state.task_queue = "test-queue"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def test_get_session_falls_back_to_db_when_temporal_not_found(client, app_sessionmaker):
    sid = uuid.uuid4()
    async with app_sessionmaker() as s:
        await insert_session(s, id=sid, filename="a.csv", file_ext="csv")
        await upsert_snapshot(
            s, session_id=sid, stage="scorecard",
            payload={"scorecard": {}, "narrative": "done", "current_score": 0.95},
            session_updates={"stage": "COMPLETE", "current_score": 0.95, "baseline_score": 0.5},
        )
        await s.commit()

    res = await client.get(f"/api/v1/sessions/{sid}")
    assert res.status_code == 200
    body = res.json()
    assert body["stage"] == "COMPLETE"
    assert body["current_score"] == 0.95
    assert body["narrative"] == "done"


async def test_get_session_returns_404_when_neither_temporal_nor_db_has_it(client):
    sid = uuid.uuid4()
    res = await client.get(f"/api/v1/sessions/{sid}")
    assert res.status_code == 404
