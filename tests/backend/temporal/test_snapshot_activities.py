import uuid
import pytest
from backend.temporal.activities.snapshot_activities import snapshot_stage
from backend.db.repository import insert_session, get_snapshot, get_session_row


async def test_snapshot_stage_upserts_and_updates_session(app_sessionmaker):
    sid = uuid.uuid4()
    async with app_sessionmaker() as s:
        await insert_session(s, id=sid, filename="a.csv", file_ext="csv")
        await s.commit()

    await snapshot_stage({
        "session_id": str(sid),
        "stage": "profile",
        "payload": {"ai_summary": "x"},
        "session_updates": {"stage": "PROFILING", "current_score": 0.5},
    })

    async with app_sessionmaker() as s:
        snap = await get_snapshot(s, sid, "profile")
        assert snap.payload == {"ai_summary": "x"}
        row = await get_session_row(s, sid)
        assert row.stage == "PROFILING"
        assert row.current_score == 0.5


async def test_snapshot_stage_is_idempotent(app_sessionmaker):
    sid = uuid.uuid4()
    async with app_sessionmaker() as s:
        await insert_session(s, id=sid, filename="a.csv", file_ext="csv")
        await s.commit()

    await snapshot_stage({"session_id": str(sid), "stage": "profile",
                          "payload": {"v": 1}, "session_updates": None})
    await snapshot_stage({"session_id": str(sid), "stage": "profile",
                          "payload": {"v": 2}, "session_updates": None})

    async with app_sessionmaker() as s:
        snap = await get_snapshot(s, sid, "profile")
        assert snap.payload == {"v": 2}
