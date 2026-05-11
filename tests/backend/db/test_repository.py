import uuid
import pytest
from backend.db.repository import (
    insert_session, list_active_sessions, upsert_snapshot,
    get_snapshot, soft_update_session, delete_session, get_session_row,
)


async def test_insert_session_then_list(app_sessionmaker):
    sid = uuid.uuid4()
    async with app_sessionmaker() as s:
        await insert_session(s, id=sid, filename="orders.csv", file_ext="csv",
                             use_case="", target_column=None, description=None)
        await s.commit()
    async with app_sessionmaker() as s:
        rows = await list_active_sessions(s)
        assert len(rows) == 1
        assert rows[0].id == sid
        assert rows[0].stage == "LOADING"


async def test_upsert_snapshot_inserts_then_updates(app_sessionmaker):
    sid = uuid.uuid4()
    async with app_sessionmaker() as s:
        await insert_session(s, id=sid, filename="a.csv", file_ext="csv")
        await upsert_snapshot(s, session_id=sid, stage="profile",
                              payload={"profile": {}, "ai_summary": "first"},
                              session_updates={"stage": "PROFILING", "current_score": 0.5})
        await s.commit()
    async with app_sessionmaker() as s:
        snap = await get_snapshot(s, sid, "profile")
        assert snap.payload["ai_summary"] == "first"
        row = await get_session_row(s, sid)
        assert row.stage == "PROFILING"
        assert row.current_score == 0.5

    async with app_sessionmaker() as s:
        await upsert_snapshot(s, session_id=sid, stage="profile",
                              payload={"profile": {}, "ai_summary": "second"},
                              session_updates={"stage": "RULE_REVIEW"})
        await s.commit()
    async with app_sessionmaker() as s:
        snap = await get_snapshot(s, sid, "profile")
        assert snap.payload["ai_summary"] == "second"
        row = await get_session_row(s, sid)
        assert row.stage == "RULE_REVIEW"


async def test_delete_session_cascades_snapshots(app_sessionmaker):
    sid = uuid.uuid4()
    async with app_sessionmaker() as s:
        await insert_session(s, id=sid, filename="a.csv", file_ext="csv")
        await upsert_snapshot(s, session_id=sid, stage="profile",
                              payload={"ai_summary": "x"})
        await s.commit()
    async with app_sessionmaker() as s:
        deleted = await delete_session(s, sid)
        await s.commit()
        assert deleted is True
    async with app_sessionmaker() as s:
        assert await get_session_row(s, sid) is None
        assert await get_snapshot(s, sid, "profile") is None


async def test_delete_session_idempotent(app_sessionmaker):
    sid = uuid.uuid4()
    async with app_sessionmaker() as s:
        deleted = await delete_session(s, sid)
        await s.commit()
        assert deleted is False


async def test_get_snapshot_missing_returns_none(app_sessionmaker):
    async with app_sessionmaker() as s:
        sid = uuid.uuid4()
        await insert_session(s, id=sid, filename="a.csv", file_ext="csv")
        await s.commit()
        assert await get_snapshot(s, sid, "profile") is None
