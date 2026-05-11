"""Per-test Postgres schema fixture using the running container.

We re-create the dq_app schema between tests rather than spinning up a
separate container — simpler and faster on a dev laptop.
"""
import os
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from backend.db.engine import build_engine, dispose_engine, set_engine
from backend.db.models import Base


@pytest.fixture
async def app_engine():
    dsn = os.getenv(
        "APP_DB_DSN_TEST",
        "postgresql+asyncpg://temporal:temporal@localhost:5433/temporal",
    )
    engine = build_engine(dsn)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("DROP SCHEMA IF EXISTS dq_app CASCADE")
        await conn.exec_driver_sql("CREATE SCHEMA dq_app")
        await conn.run_sync(Base.metadata.create_all)
    set_engine(engine)
    yield engine
    await dispose_engine()


@pytest.fixture
def app_sessionmaker(app_engine):
    return async_sessionmaker(app_engine, expire_on_commit=False)
