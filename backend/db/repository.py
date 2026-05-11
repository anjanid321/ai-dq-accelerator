"""CRUD over dq_app tables. All functions take an AsyncSession; caller controls
transactions and commits."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from sqlalchemy import select, delete as sql_delete, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import Session as SessionRow, StageSnapshot


async def insert_session(
    db: AsyncSession,
    *,
    id: uuid.UUID,
    filename: str,
    file_ext: str,
    use_case: str | None = None,
    target_column: str | None = None,
    description: str | None = None,
) -> None:
    db.add(SessionRow(
        id=id, filename=filename, file_ext=file_ext,
        use_case=use_case, target_column=target_column, description=description,
        stage="LOADING",
    ))


async def get_session_row(db: AsyncSession, sid: uuid.UUID) -> SessionRow | None:
    res = await db.execute(select(SessionRow).where(SessionRow.id == sid))
    return res.scalar_one_or_none()


async def list_active_sessions(db: AsyncSession) -> list[SessionRow]:
    res = await db.execute(
        select(SessionRow)
        .where(SessionRow.deleted_at.is_(None))
        .order_by(SessionRow.created_at.desc())
    )
    return list(res.scalars().all())


async def upsert_snapshot(
    db: AsyncSession,
    *,
    session_id: uuid.UUID,
    stage: str,
    payload: dict,
    session_updates: dict | None = None,
) -> None:
    """UPSERT the snapshot row and update the parent sessions row in one tx."""
    stmt = (
        pg_insert(StageSnapshot)
        .values(session_id=session_id, stage=stage, payload=payload)
        .on_conflict_do_update(
            index_elements=["session_id", "stage"],
            set_={"payload": payload, "created_at": func.now()},
        )
    )
    await db.execute(stmt)

    if session_updates:
        updates = {**session_updates, "updated_at": datetime.now(timezone.utc)}
        await db.execute(
            SessionRow.__table__.update()
            .where(SessionRow.id == session_id)
            .values(**updates)
        )


async def get_snapshot(
    db: AsyncSession, sid: uuid.UUID, stage: str
) -> StageSnapshot | None:
    res = await db.execute(
        select(StageSnapshot).where(
            StageSnapshot.session_id == sid,
            StageSnapshot.stage == stage,
        )
    )
    return res.scalar_one_or_none()


async def soft_update_session(
    db: AsyncSession, sid: uuid.UUID, **fields
) -> None:
    fields["updated_at"] = datetime.now(timezone.utc)
    await db.execute(
        SessionRow.__table__.update()
        .where(SessionRow.id == sid)
        .values(**fields)
    )


async def delete_session(db: AsyncSession, sid: uuid.UUID) -> bool:
    """Hard delete. Returns True if a row was deleted, False if it didn't exist."""
    res = await db.execute(
        sql_delete(SessionRow).where(SessionRow.id == sid)
    )
    return res.rowcount > 0
