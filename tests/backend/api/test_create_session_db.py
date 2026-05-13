"""Verifies POST /sessions writes a sessions row before starting the workflow."""
import io
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
import httpx

from backend.api.routers import sessions as sessions_router
from backend.db.repository import get_session_row


@pytest.fixture
def app_with_mocks(app_engine):
    app = FastAPI()
    app.include_router(sessions_router.router, prefix="/api/v1")

    fake_client = MagicMock()
    fake_client.start_workflow = AsyncMock()
    app.state.temporal_client = fake_client
    app.state.task_queue = "test-queue"
    app.state.db_engine = app_engine

    return app, fake_client


async def test_post_sessions_inserts_db_row(app_with_mocks, app_sessionmaker):
    app, fake_temporal = app_with_mocks
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        files = {"file": ("orders.csv", io.BytesIO(b"a,b\n1,2\n"), "text/csv")}
        res = await client.post("/api/v1/sessions", files=files, data={"use_case": "billing"})
    assert res.status_code == 200
    body = res.json()
    sid = uuid.UUID(body["session_id"])

    async with app_sessionmaker() as s:
        row = await get_session_row(s, sid)
        assert row is not None
        assert row.filename == "orders.csv"
        assert row.file_ext == "csv"
        assert row.use_case == "billing"
        assert row.stage == "LOADING"

    fake_temporal.start_workflow.assert_awaited_once()
