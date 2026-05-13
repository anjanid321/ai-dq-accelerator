import io
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.api.routers import sessions as sessions_router


@pytest.fixture
async def client(app_engine):
    app = FastAPI()
    app.include_router(sessions_router.router, prefix="/api/v1")
    fake = MagicMock()
    fake.start_workflow = AsyncMock()
    app.state.temporal_client = fake
    app.state.task_queue = "test-queue"
    app.state.db_engine = app_engine
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def test_list_sessions_empty(client):
    res = await client.get("/api/v1/sessions")
    assert res.status_code == 200
    assert res.json() == []


async def test_list_sessions_returns_recent_first(client):
    for name in ["a.csv", "b.csv", "c.csv"]:
        files = {"file": (name, io.BytesIO(b"x,y\n1,2\n"), "text/csv")}
        r = await client.post("/api/v1/sessions", files=files)
        assert r.status_code == 200

    res = await client.get("/api/v1/sessions")
    assert res.status_code == 200
    body = res.json()
    assert [item["filename"] for item in body] == ["c.csv", "b.csv", "a.csv"]
    for item in body:
        assert item["stage"] == "LOADING"
        assert item["current_score"] == 0.0
