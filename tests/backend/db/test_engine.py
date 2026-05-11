import pytest
from sqlalchemy.ext.asyncio import AsyncEngine

from backend.db.engine import build_engine, dispose_engine, get_engine, set_engine


async def test_build_engine_returns_async_engine():
    engine = build_engine("postgresql+asyncpg://temporal:temporal@localhost:5432/temporal")
    assert isinstance(engine, AsyncEngine)
    await engine.dispose()


async def test_get_engine_raises_when_unset():
    await dispose_engine()
    with pytest.raises(RuntimeError, match="not initialized"):
        get_engine()


async def test_set_and_get_engine():
    engine = build_engine("postgresql+asyncpg://temporal:temporal@localhost:5432/temporal")
    set_engine(engine)
    assert get_engine() is engine
    await dispose_engine()
