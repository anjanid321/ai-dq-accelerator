"""Temporal activity that persists stage snapshots to dq_app."""
from __future__ import annotations

import uuid
from temporalio import activity

from backend.db.engine import get_sessionmaker
from backend.db.repository import upsert_snapshot


@activity.defn
async def snapshot_stage(params: dict) -> None:
    """Persist a stage snapshot and update the parent session row.

    params:
      session_id: str (UUID)
      stage: str (UI StageId — profile, explore, rules, validate, triage,
                  plan, transform, scorecard, pipeline)
      payload: dict (whatever that stage view needs to re-render)
      session_updates: dict | None (e.g. {"stage": "...", "current_score": 0.7})
    """
    sid = uuid.UUID(params["session_id"])
    sm = get_sessionmaker()
    async with sm() as db:
        await upsert_snapshot(
            db,
            session_id=sid,
            stage=params["stage"],
            payload=params["payload"],
            session_updates=params.get("session_updates"),
        )
        await db.commit()
