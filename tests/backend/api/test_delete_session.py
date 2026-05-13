import io
import uuid
from pathlib import Path
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.api.routers import sessions as sessions_router
from backend.db.repository import get_session_row


@pytest.fixture
async def client_tuple(app_engine, tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    # Router reads DATA_DIR at module import; reload so it picks up the patched env.
    import importlib
    importlib.reload(sessions_router)

    app = FastAPI()
    app.include_router(sessions_router.router, prefix="/api/v1")

    fake = MagicMock()
    fake.start_workflow = AsyncMock()
    fake_handle = MagicMock()
    fake_handle.terminate = AsyncMock()
    fake.get_workflow_handle = MagicMock(return_value=fake_handle)
    app.state.temporal_client = fake
    app.state.task_queue = "test-queue"
    app.state.db_engine = app_engine

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, fake, fake_handle


async def test_delete_session_terminates_workflow_and_removes_row(client_tuple, app_sessionmaker):
    ac, fake_temporal, fake_handle = client_tuple
    files = {"file": ("orders.csv", io.BytesIO(b"a,b\n1,2\n"), "text/csv")}
    create = await ac.post("/api/v1/sessions", files=files)
    sid = create.json()["session_id"]

    res = await ac.delete(f"/api/v1/sessions/{sid}")
    assert res.status_code == 204
    fake_handle.terminate.assert_awaited_once()

    async with app_sessionmaker() as s:
        row = await get_session_row(s, uuid.UUID(sid))
        assert row is None


async def test_delete_missing_session_is_idempotent(client_tuple):
    ac, _, _ = client_tuple
    res = await ac.delete(f"/api/v1/sessions/{uuid.uuid4()}")
    assert res.status_code == 204
