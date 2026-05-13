import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.api.routers import sessions as sessions_router
from backend.db.repository import insert_session, upsert_snapshot


@pytest.fixture
async def client(app_engine):
    app = FastAPI()
    app.include_router(sessions_router.router, prefix="/api/v1")
    fake = MagicMock()
    fake.start_workflow = AsyncMock()
    app.state.temporal_client = fake
    app.state.task_queue = "test-queue"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def test_get_snapshot_returns_payload(client, app_sessionmaker):
    sid = uuid.uuid4()
    async with app_sessionmaker() as s:
        await insert_session(s, id=sid, filename="a.csv", file_ext="csv")
        await upsert_snapshot(s, session_id=sid, stage="profile",
                              payload={"ai_summary": "hello"})
        await s.commit()

    res = await client.get(f"/api/v1/sessions/{sid}/stages/profile")
    assert res.status_code == 200
    body = res.json()
    assert body["stage"] == "profile"
    assert body["payload"]["ai_summary"] == "hello"


async def test_get_snapshot_missing_returns_404(client):
    res = await client.get(f"/api/v1/sessions/{uuid.uuid4()}/stages/profile")
    assert res.status_code == 404
