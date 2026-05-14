"""Async SQLAlchemy engine + session factory for the dq_app schema."""
from __future__ import annotations

import os
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None

DEFAULT_DSN = "postgresql+asyncpg://temporal:temporal@localhost:5433/temporal"


def dsn_from_env() -> str:
    return os.getenv("APP_DB_DSN", DEFAULT_DSN)


def build_engine(dsn: str | None = None) -> AsyncEngine:
    return create_async_engine(dsn or dsn_from_env(), pool_pre_ping=True)


def set_engine(engine: AsyncEngine) -> None:
    global _engine, _sessionmaker
    _engine = engine
    _sessionmaker = async_sessionmaker(engine, expire_on_commit=False)


def get_engine() -> AsyncEngine:
    if _engine is None:
        raise RuntimeError("Engine not initialized — call set_engine() during app startup")
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        raise RuntimeError("Engine not initialized — call set_engine() during app startup")
    return _sessionmaker


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
