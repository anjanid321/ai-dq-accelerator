# Session Persistence, Polling, Delete, and Light Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make stage views survive workflow advance/expiry by snapshotting completed stages to Postgres; replace localStorage session list with a DB-backed list; add hard delete; pause polling when not focused; convert UI to light mode.

**Architecture:** Add a new `dq_app` schema in the Postgres container already running for Temporal. A `snapshot_stage` Temporal activity writes one row per (session_id, stage) at each stage exit and keeps a `sessions` row up to date. FastAPI gets `GET /sessions`, `GET /sessions/{id}/stages/{stage}`, and `DELETE /sessions/{id}`. The UI routes past-stage views through the snapshot endpoint, drops localStorage in favor of `GET /sessions`, and adds delete + light palette.

**Tech Stack:** SQLAlchemy 2.x (async) + asyncpg + Alembic on the backend; existing FastAPI + Temporal + LangGraph; Next.js 16 + SWR + Tailwind on the frontend.

**Source spec:** `docs/superpowers/specs/2026-05-11-session-persistence-and-ui-design.md`

---

## Phase 1 — DB Foundation

This phase produces an async SQLAlchemy engine, a SQLAlchemy model layer, and Alembic migrations that create the `dq_app` schema. No behavior change yet; verifiable by running `alembic upgrade head` and checking the schema.

### Task 1: Add backend dependencies

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Add SQLAlchemy, asyncpg, Alembic to dependencies**

Insert these into the `dependencies` list in `pyproject.toml` (after `aiofiles>=24.1.0`):

```toml
    "sqlalchemy[asyncio]>=2.0.30",
    "asyncpg>=0.29.0",
    "alembic>=1.13.0",
```

Add `pytest-postgresql>=6.0.0` to the `dev` optional-dependencies list, after `pytest-cov`.

- [ ] **Step 2: Install**

Run: `pip install -e ".[dev]"`
Expected: dependencies install without errors. `python -c "import sqlalchemy, asyncpg, alembic; print(sqlalchemy.__version__)"` prints a 2.x version.

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml
git commit -m "feat: add SQLAlchemy/asyncpg/Alembic for app DB"
```

---

### Task 2: Create the async engine module

**Files:**
- Create: `backend/db/__init__.py`
- Create: `backend/db/engine.py`

The engine is lazily initialized so tests can construct an engine pointing at a test DB without mutating module globals at import time.

- [ ] **Step 1: Write the failing test**

Create `tests/backend/db/__init__.py` (empty) and `tests/backend/db/test_engine.py`:

```python
import os
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/backend/db/test_engine.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.db'`.

- [ ] **Step 3: Implement the engine module**

Create `backend/db/__init__.py` as empty.

Create `backend/db/engine.py`:

```python
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

DEFAULT_DSN = "postgresql+asyncpg://temporal:temporal@localhost:5432/temporal"


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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/backend/db/test_engine.py -v`
Expected: All three tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/db/__init__.py backend/db/engine.py tests/backend/db/__init__.py tests/backend/db/test_engine.py
git commit -m "feat(db): add async SQLAlchemy engine module"
```

---

### Task 3: Define SQLAlchemy models

**Files:**
- Create: `backend/db/models.py`
- Test: `tests/backend/db/test_models.py`

Models target the `dq_app` schema. `Session.id` is `UUID` (Postgres native). `StageSnapshot.payload` is `JSONB`.

- [ ] **Step 1: Write the failing test**

Create `tests/backend/db/test_models.py`:

```python
import uuid
from datetime import datetime
from backend.db.models import Base, Session as SessionRow, StageSnapshot


def test_session_table_uses_dq_app_schema():
    assert SessionRow.__table__.schema == "dq_app"
    assert SessionRow.__tablename__ == "sessions"


def test_stage_snapshot_table_uses_dq_app_schema():
    assert StageSnapshot.__table__.schema == "dq_app"
    assert StageSnapshot.__tablename__ == "stage_snapshots"


def test_session_columns():
    cols = {c.name for c in SessionRow.__table__.columns}
    assert cols == {
        "id", "filename", "file_ext", "use_case", "target_column", "description",
        "stage", "current_score", "baseline_score", "output_dir", "zip_path",
        "created_at", "updated_at", "deleted_at",
    }


def test_stage_snapshot_columns_and_pk():
    cols = {c.name for c in StageSnapshot.__table__.columns}
    assert cols == {"session_id", "stage", "payload", "created_at"}
    pk = {c.name for c in StageSnapshot.__table__.primary_key.columns}
    assert pk == {"session_id", "stage"}


def test_session_round_trip_in_memory():
    """Smoke test: instances populate fields without touching a DB."""
    sid = uuid.uuid4()
    row = SessionRow(
        id=sid, filename="orders.csv", file_ext="csv",
        stage="LOADING",
    )
    assert row.id == sid
    assert row.filename == "orders.csv"
    assert row.deleted_at is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/backend/db/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.db.models'`.

- [ ] **Step 3: Implement models**

Create `backend/db/models.py`:

```python
"""SQLAlchemy models for the dq_app schema."""
from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, DateTime, Float, ForeignKey, Index, String, Text, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index(
            "ix_sessions_active",
            "created_at",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        {"schema": "dq_app"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename = Column(Text, nullable=False)
    file_ext = Column(Text, nullable=False)
    use_case = Column(Text)
    target_column = Column(Text)
    description = Column(Text)
    stage = Column(String, nullable=False)
    current_score = Column(Float)
    baseline_score = Column(Float)
    output_dir = Column(Text)
    zip_path = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True))

    snapshots = relationship(
        "StageSnapshot",
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class StageSnapshot(Base):
    __tablename__ = "stage_snapshots"
    __table_args__ = ({"schema": "dq_app"},)

    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("dq_app.sessions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    stage = Column(String, primary_key=True)
    payload = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("Session", back_populates="snapshots")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/backend/db/test_models.py -v`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/db/models.py tests/backend/db/test_models.py
git commit -m "feat(db): add Session and StageSnapshot models"
```

---

### Task 4: Wire Alembic

**Files:**
- Create: `alembic.ini`
- Create: `backend/db/migrations/__init__.py`
- Create: `backend/db/migrations/env.py`
- Create: `backend/db/migrations/script.py.mako`
- Create: `backend/db/migrations/versions/0001_initial.py`

The migration creates `dq_app` schema, both tables, and the partial index from the spec.

- [ ] **Step 1: Create `alembic.ini` at project root**

```ini
[alembic]
script_location = backend/db/migrations
prepend_sys_path = .
sqlalchemy.url =

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

- [ ] **Step 2: Create migrations package**

Create `backend/db/migrations/__init__.py` (empty).

Create `backend/db/migrations/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

Create `backend/db/migrations/env.py`:

```python
"""Alembic env — reads APP_DB_DSN, targets backend.db.models.Base.metadata."""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import async_engine_from_config

from backend.db.engine import dsn_from_env
from backend.db.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override the URL from env at runtime
config.set_main_option("sqlalchemy.url", dsn_from_env())

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        version_table_schema="dq_app",
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_schemas=True,
        version_table_schema="dq_app",
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

- [ ] **Step 3: Create the initial migration**

Create `backend/db/migrations/versions/0001_initial.py`:

```python
"""Initial schema: dq_app.sessions + dq_app.stage_snapshots.

Revision ID: 0001
Revises:
Create Date: 2026-05-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS dq_app")

    op.create_table(
        "sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("filename", sa.Text, nullable=False),
        sa.Column("file_ext", sa.Text, nullable=False),
        sa.Column("use_case", sa.Text),
        sa.Column("target_column", sa.Text),
        sa.Column("description", sa.Text),
        sa.Column("stage", sa.String, nullable=False),
        sa.Column("current_score", sa.Float),
        sa.Column("baseline_score", sa.Float),
        sa.Column("output_dir", sa.Text),
        sa.Column("zip_path", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        schema="dq_app",
    )
    op.create_index(
        "ix_sessions_active",
        "sessions",
        ["created_at"],
        schema="dq_app",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "stage_snapshots",
        sa.Column("session_id", UUID(as_uuid=True),
                  sa.ForeignKey("dq_app.sessions.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("stage", sa.String, primary_key=True),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        schema="dq_app",
    )


def downgrade() -> None:
    op.drop_table("stage_snapshots", schema="dq_app")
    op.drop_index("ix_sessions_active", table_name="sessions", schema="dq_app")
    op.drop_table("sessions", schema="dq_app")
    op.execute("DROP SCHEMA IF EXISTS dq_app")
```

- [ ] **Step 4: Run migration against the live Postgres**

Make sure Postgres is up: `docker compose up -d postgresql`

Run: `APP_DB_DSN=postgresql+asyncpg://temporal:temporal@localhost:5432/temporal alembic upgrade head`
Expected: log lines `INFO  [alembic.runtime.migration] Running upgrade  -> 0001`.

Verify the schema:
```bash
docker compose exec postgresql psql -U temporal -d temporal -c "\dn"   # expect dq_app schema
docker compose exec postgresql psql -U temporal -d temporal -c "\dt dq_app.*"
```
Expected: `dq_app.sessions` and `dq_app.stage_snapshots` listed.

- [ ] **Step 5: Commit**

```bash
git add alembic.ini backend/db/migrations
git commit -m "feat(db): wire Alembic, add initial dq_app migration"
```

---

### Task 5: Repository functions

**Files:**
- Create: `backend/db/repository.py`
- Test: `tests/backend/db/test_repository.py`

Async CRUD over the new tables. The UPSERT for snapshots uses Postgres `ON CONFLICT`. The same transaction also updates the parent `sessions` row.

- [ ] **Step 1: Add a pytest fixture for a per-test DB**

Create `tests/backend/db/conftest.py`:

```python
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
        "postgresql+asyncpg://temporal:temporal@localhost:5432/temporal",
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
```

- [ ] **Step 2: Write the failing repository tests**

Create `tests/backend/db/test_repository.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/backend/db/test_repository.py -v`
Expected: FAIL — `backend.db.repository` doesn't exist.

- [ ] **Step 4: Implement the repository**

Create `backend/db/repository.py`:

```python
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/backend/db/test_repository.py -v`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/db/repository.py tests/backend/db/conftest.py tests/backend/db/test_repository.py
git commit -m "feat(db): add repository CRUD for sessions and snapshots"
```

---

### Task 6: Lifespan wiring and migration-on-boot

**Files:**
- Modify: `backend/api/main.py`
- Modify: `docker-compose.yml`
- Modify: `.env.example`

FastAPI startup runs `alembic upgrade head` programmatically, then opens the engine.

- [ ] **Step 1: Update `.env.example`**

Append to `.env.example`:

```
APP_DB_DSN=postgresql+asyncpg://temporal:temporal@localhost:5432/temporal
```

- [ ] **Step 2: Add `APP_DB_DSN` to docker-compose for api + worker**

In `docker-compose.yml`, add to the `api` service `environment:` block (in-container DSN uses host `postgresql`):

```yaml
      - APP_DB_DSN=postgresql+asyncpg://temporal:temporal@postgresql:5432/temporal
```

And the same line to the `worker` service `environment:` block.

Also: add Postgres to both services' `depends_on`:

```yaml
    depends_on:
      postgresql:
        condition: service_healthy
      temporal:
        condition: service_healthy
```

(Replace the existing `depends_on` blocks that list only `temporal`.)

- [ ] **Step 3: Modify FastAPI lifespan**

Edit `backend/api/main.py`. Below the existing Temporal connect, run migrations and open the engine.

Replace the body of the `lifespan` function with:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    global temporal_client

    # Run DB migrations
    from alembic import command
    from alembic.config import Config
    from backend.db.engine import build_engine, dispose_engine, dsn_from_env, set_engine

    alembic_cfg = Config(str(Path(__file__).resolve().parent.parent.parent / "alembic.ini"))
    alembic_cfg.set_main_option("sqlalchemy.url", dsn_from_env())
    logger.info("Running alembic upgrade head")
    await asyncio.get_running_loop().run_in_executor(
        None, lambda: command.upgrade(alembic_cfg, "head")
    )

    # Open async engine
    engine = build_engine()
    set_engine(engine)
    app.state.db_engine = engine

    # Connect to Temporal
    temporal_host = os.getenv("TEMPORAL_HOST", "localhost:7233")
    temporal_namespace = os.getenv("TEMPORAL_NAMESPACE", "default")
    logger.info(f"Connecting to Temporal at {temporal_host}")
    temporal_client = await Client.connect(temporal_host, namespace=temporal_namespace)
    logger.info("Temporal client connected")

    app.state.temporal_client = temporal_client
    app.state.task_queue = TASK_QUEUE

    yield

    logger.info("Shutting down")
    await dispose_engine()
```

At the top of the file, add `import asyncio` near the other imports.

- [ ] **Step 4: Smoke test the API boot**

Run: `docker compose up -d postgresql temporal`
Then: `APP_DB_DSN=postgresql+asyncpg://temporal:temporal@localhost:5432/temporal uvicorn backend.api.main:app --port 8001 &`
Wait ~3s, then `curl -s http://localhost:8001/health`.
Expected: `{"status":"ok","temporal_connected":true}`. The uvicorn log should include `Running alembic upgrade head` and a subsequent `INFO  [alembic.runtime.migration] Will assume transactional DDL.`.

Stop the test server: `kill %1`.

- [ ] **Step 5: Commit**

```bash
git add backend/api/main.py docker-compose.yml .env.example
git commit -m "feat: run alembic on FastAPI startup, wire APP_DB_DSN"
```

---

## Phase 2 — Sessions API and Delete

### Task 7: New API response schemas

**Files:**
- Modify: `backend/api/schemas.py`
- Test: `tests/backend/api/test_schemas.py`

- [ ] **Step 1: Write the failing test**

Create `tests/backend/api/test_schemas.py` (or append to an existing one):

```python
from backend.api.schemas import SessionListItem, StageSnapshotResponse, WorkflowStage


def test_session_list_item_fields():
    item = SessionListItem(
        id="00000000-0000-0000-0000-000000000001",
        filename="a.csv",
        stage=WorkflowStage.LOADING,
        current_score=0.0,
        baseline_score=0.0,
        created_at="2026-05-11T00:00:00Z",
        updated_at="2026-05-11T00:00:00Z",
    )
    assert item.filename == "a.csv"
    assert item.stage == WorkflowStage.LOADING


def test_stage_snapshot_response_fields():
    r = StageSnapshotResponse(stage="profile", payload={"x": 1},
                              created_at="2026-05-11T00:00:00Z")
    assert r.stage == "profile"
    assert r.payload == {"x": 1}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/backend/api/test_schemas.py -v`
Expected: FAIL with `ImportError: cannot import name 'SessionListItem'`.

- [ ] **Step 3: Add the schemas**

Append to `backend/api/schemas.py`:

```python
# ── GET /sessions ─────────────────────────────────────────────────────────────


class SessionListItem(BaseModel):
    id: str
    filename: str
    stage: WorkflowStage
    current_score: float = 0.0
    baseline_score: float = 0.0
    created_at: str
    updated_at: str


# ── GET /sessions/{id}/stages/{stage} ─────────────────────────────────────────


class StageSnapshotResponse(BaseModel):
    stage: str
    payload: dict
    created_at: str
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/backend/api/test_schemas.py -v`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/api/schemas.py tests/backend/api/test_schemas.py
git commit -m "feat(api): add SessionListItem and StageSnapshotResponse schemas"
```

---

### Task 8: `POST /sessions` inserts a DB row

**Files:**
- Modify: `backend/api/routers/sessions.py`
- Test: `tests/backend/api/test_create_session_db.py`

- [ ] **Step 1: Write the failing test**

Create `tests/backend/api/test_create_session_db.py`:

```python
"""Verifies POST /sessions writes a sessions row before starting the workflow."""
import io
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routers import sessions as sessions_router
from backend.db.repository import get_session_row


@pytest.fixture
def client_with_mocks(app_engine, monkeypatch):
    app = FastAPI()
    app.include_router(sessions_router.router, prefix="/api/v1")

    fake_client = MagicMock()
    fake_client.start_workflow = AsyncMock()
    app.state.temporal_client = fake_client
    app.state.task_queue = "test-queue"
    app.state.db_engine = app_engine

    return TestClient(app), fake_client


async def test_post_sessions_inserts_db_row(client_with_mocks, app_sessionmaker):
    client, fake_temporal = client_with_mocks
    files = {"file": ("orders.csv", io.BytesIO(b"a,b\n1,2\n"), "text/csv")}
    res = client.post("/api/v1/sessions", files=files, data={"use_case": "billing"})
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/backend/api/test_create_session_db.py -v`
Expected: FAIL — no DB row inserted (or fixture missing the engine wiring).

- [ ] **Step 3: Modify the router**

In `backend/api/routers/sessions.py`, after `session_id = str(uuid.uuid4())` and before `await client.start_workflow(...)`, add the DB insert. Wrap the existing UUID + file save + DB insert + workflow start.

Add these imports at the top:

```python
import uuid as _uuid
from backend.db.engine import get_sessionmaker
from backend.db.repository import insert_session
```

In the `create_session` handler, replace:

```python
    session_id = str(uuid.uuid4())
```

with:

```python
    session_uuid = _uuid.uuid4()
    session_id = str(session_uuid)
```

And insert a new block immediately before `await client.start_workflow(`:

```python
    sm = get_sessionmaker()
    async with sm() as db:
        await insert_session(
            db,
            id=session_uuid,
            filename=file.filename or f"input{suffix}",
            file_ext=suffix.lstrip("."),
            use_case=use_case or None,
            target_column=target_column,
            description=description,
        )
        await db.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/backend/api/test_create_session_db.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/routers/sessions.py tests/backend/api/test_create_session_db.py
git commit -m "feat(api): POST /sessions inserts dq_app.sessions row"
```

---

### Task 9: `GET /sessions` returns the list

**Files:**
- Modify: `backend/api/routers/sessions.py`
- Test: `tests/backend/api/test_list_sessions.py`

- [ ] **Step 1: Write the failing test**

Create `tests/backend/api/test_list_sessions.py`:

```python
import io
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routers import sessions as sessions_router


@pytest.fixture
def client(app_engine):
    app = FastAPI()
    app.include_router(sessions_router.router, prefix="/api/v1")
    fake = MagicMock()
    fake.start_workflow = AsyncMock()
    app.state.temporal_client = fake
    app.state.task_queue = "test-queue"
    app.state.db_engine = app_engine
    return TestClient(app)


def test_list_sessions_empty(client):
    res = client.get("/api/v1/sessions")
    assert res.status_code == 200
    assert res.json() == []


def test_list_sessions_returns_recent_first(client):
    for name in ["a.csv", "b.csv", "c.csv"]:
        files = {"file": (name, io.BytesIO(b"x,y\n1,2\n"), "text/csv")}
        assert client.post("/api/v1/sessions", files=files).status_code == 200

    res = client.get("/api/v1/sessions")
    assert res.status_code == 200
    body = res.json()
    assert [item["filename"] for item in body] == ["c.csv", "b.csv", "a.csv"]
    for item in body:
        assert item["stage"] == "LOADING"
        assert item["current_score"] == 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/backend/api/test_list_sessions.py -v`
Expected: FAIL — endpoint doesn't exist (404).

- [ ] **Step 3: Add the list endpoint**

In `backend/api/routers/sessions.py`, add the import:

```python
from backend.api.schemas import SessionListItem, StageSnapshotResponse  # add to existing import line if same module
from backend.db.repository import list_active_sessions, get_snapshot, delete_session as db_delete_session
```

Then add the route handler before `create_session`:

```python
@router.get("/sessions", response_model=list[SessionListItem])
async def list_sessions(request: Request):
    sm = get_sessionmaker()
    async with sm() as db:
        rows = await list_active_sessions(db)
    return [
        SessionListItem(
            id=str(r.id),
            filename=r.filename,
            stage=WorkflowStage(r.stage) if r.stage in WorkflowStage._value2member_map_ else WorkflowStage.LOADING,
            current_score=r.current_score or 0.0,
            baseline_score=r.baseline_score or 0.0,
            created_at=r.created_at.isoformat(),
            updated_at=r.updated_at.isoformat(),
        )
        for r in rows
    ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/backend/api/test_list_sessions.py -v`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/api/routers/sessions.py tests/backend/api/test_list_sessions.py
git commit -m "feat(api): GET /sessions returns DB-backed session list"
```

---

### Task 10: `DELETE /sessions/{id}` — workflow terminate + cascade + filesystem cleanup

**Files:**
- Modify: `backend/api/routers/sessions.py`
- Test: `tests/backend/api/test_delete_session.py`

- [ ] **Step 1: Write the failing test**

Create `tests/backend/api/test_delete_session.py`:

```python
import io
import shutil
import uuid
from pathlib import Path
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routers import sessions as sessions_router
from backend.db.repository import get_session_row


@pytest.fixture
def client(app_engine, tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    # _project_root is computed from __file__; we don't override that, but we DO
    # override the DATA_DIR env var that the router consults. Update the router
    # constants by reloading:
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
    return TestClient(app), fake, fake_handle


def test_delete_session_terminates_workflow_and_removes_row(client, app_sessionmaker):
    tc, fake_temporal, fake_handle = client
    files = {"file": ("orders.csv", io.BytesIO(b"a,b\n1,2\n"), "text/csv")}
    sid = tc.post("/api/v1/sessions", files=files).json()["session_id"]

    res = tc.delete(f"/api/v1/sessions/{sid}")
    assert res.status_code == 204
    fake_handle.terminate.assert_awaited_once()

    import asyncio
    async def check():
        async with app_sessionmaker() as s:
            row = await get_session_row(s, uuid.UUID(sid))
            assert row is None
    asyncio.get_event_loop().run_until_complete(check())


def test_delete_missing_session_is_idempotent(client):
    tc, _, _ = client
    res = tc.delete(f"/api/v1/sessions/{uuid.uuid4()}")
    assert res.status_code == 204
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/backend/api/test_delete_session.py -v`
Expected: FAIL — DELETE endpoint doesn't exist.

- [ ] **Step 3: Add the delete endpoint**

In `backend/api/routers/sessions.py`, add:

```python
import shutil
from fastapi import Response
```

(`RPCError` and `RPCStatusCode` are already imported at the top of the file.)

Then add the route:

```python
@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, request: Request):
    # 1. Terminate the workflow if it exists
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        await handle.terminate(reason="user-deleted")
    except RPCError as e:
        if e.status != RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=500, detail=str(e))
    except Exception:
        # Best-effort: a handle terminate may also raise if the workflow
        # is already completed; that's fine.
        pass

    # 2. Delete the DB row (cascades stage_snapshots)
    try:
        sid_uuid = _uuid.UUID(session_id)
    except ValueError:
        return Response(status_code=204)
    sm = get_sessionmaker()
    async with sm() as db:
        await db_delete_session(db, sid_uuid)
        await db.commit()

    # 3. Remove on-disk artifacts
    project_root = _project_root()
    shutil.rmtree(project_root / DATA_DIR / "sessions" / session_id, ignore_errors=True)
    shutil.rmtree(project_root / "output" / "sessions" / session_id, ignore_errors=True)

    return Response(status_code=204)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/backend/api/test_delete_session.py -v`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/api/routers/sessions.py tests/backend/api/test_delete_session.py
git commit -m "feat(api): DELETE /sessions/{id} terminates workflow and cleans up"
```

---

### Task 11: `GET /sessions/{id}/stages/{stage}` — snapshot read

**Files:**
- Modify: `backend/api/routers/sessions.py`
- Test: `tests/backend/api/test_get_snapshot.py`

- [ ] **Step 1: Write the failing test**

Create `tests/backend/api/test_get_snapshot.py`:

```python
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routers import sessions as sessions_router
from backend.db.repository import insert_session, upsert_snapshot


@pytest.fixture
def client(app_engine):
    app = FastAPI()
    app.include_router(sessions_router.router, prefix="/api/v1")
    fake = MagicMock()
    fake.start_workflow = AsyncMock()
    app.state.temporal_client = fake
    app.state.task_queue = "test-queue"
    return TestClient(app)


async def test_get_snapshot_returns_payload(client, app_sessionmaker):
    sid = uuid.uuid4()
    async with app_sessionmaker() as s:
        await insert_session(s, id=sid, filename="a.csv", file_ext="csv")
        await upsert_snapshot(s, session_id=sid, stage="profile",
                              payload={"ai_summary": "hello"})
        await s.commit()

    res = client.get(f"/api/v1/sessions/{sid}/stages/profile")
    assert res.status_code == 200
    body = res.json()
    assert body["stage"] == "profile"
    assert body["payload"]["ai_summary"] == "hello"


def test_get_snapshot_missing_returns_404(client):
    res = client.get(f"/api/v1/sessions/{uuid.uuid4()}/stages/profile")
    assert res.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/backend/api/test_get_snapshot.py -v`
Expected: FAIL with 404 on both tests (endpoint doesn't exist).

- [ ] **Step 3: Add the endpoint**

In `backend/api/routers/sessions.py` add:

```python
@router.get("/sessions/{session_id}/stages/{stage}", response_model=StageSnapshotResponse)
async def get_stage_snapshot(session_id: str, stage: str):
    try:
        sid_uuid = _uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    sm = get_sessionmaker()
    async with sm() as db:
        snap = await get_snapshot(db, sid_uuid, stage)
    if snap is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return StageSnapshotResponse(
        stage=snap.stage,
        payload=snap.payload,
        created_at=snap.created_at.isoformat(),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/backend/api/test_get_snapshot.py -v`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/api/routers/sessions.py tests/backend/api/test_get_snapshot.py
git commit -m "feat(api): GET /sessions/{id}/stages/{stage} returns snapshot"
```

---

### Task 11b: `GET /sessions/{id}` falls back to DB on Temporal NOT_FOUND

**Files:**
- Modify: `backend/api/routers/sessions.py`
- Test: `tests/backend/api/test_get_session_fallback.py`

When Temporal retention has rolled off, the workflow handle returns NOT_FOUND. Instead of bubbling a 404, we hydrate the response from the DB row + the most-advanced snapshot so the workspace page still renders.

- [ ] **Step 1: Write the failing test**

Create `tests/backend/api/test_get_session_fallback.py`:

```python
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from fastapi.testclient import TestClient
from temporalio.service import RPCError, RPCStatusCode

from backend.api.routers import sessions as sessions_router
from backend.db.repository import insert_session, upsert_snapshot


@pytest.fixture
def client(app_engine):
    app = FastAPI()
    app.include_router(sessions_router.router, prefix="/api/v1")
    fake = MagicMock()
    fake_handle = MagicMock()
    fake_handle.query = AsyncMock(side_effect=RPCError("gone", RPCStatusCode.NOT_FOUND, None))
    fake.get_workflow_handle = MagicMock(return_value=fake_handle)
    app.state.temporal_client = fake
    app.state.task_queue = "test-queue"
    return TestClient(app)


async def test_get_session_falls_back_to_db_when_temporal_not_found(client, app_sessionmaker):
    sid = uuid.uuid4()
    async with app_sessionmaker() as s:
        await insert_session(s, id=sid, filename="a.csv", file_ext="csv")
        await upsert_snapshot(
            s, session_id=sid, stage="scorecard",
            payload={"scorecard": {}, "narrative": "done", "current_score": 0.95},
            session_updates={"stage": "COMPLETE", "current_score": 0.95, "baseline_score": 0.5},
        )
        await s.commit()

    res = client.get(f"/api/v1/sessions/{sid}")
    assert res.status_code == 200
    body = res.json()
    assert body["stage"] == "COMPLETE"
    assert body["current_score"] == 0.95
    assert body["narrative"] == "done"


async def test_get_session_returns_404_when_neither_temporal_nor_db_has_it(client):
    sid = uuid.uuid4()
    res = client.get(f"/api/v1/sessions/{sid}")
    assert res.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/backend/api/test_get_session_fallback.py -v`
Expected: FAIL — current handler returns 404 unconditionally on NOT_FOUND.

- [ ] **Step 3: Modify `get_session`**

In `backend/api/routers/sessions.py`, replace the `except RPCError as e:` arm of `get_session` with a DB-hydration path. The full replacement:

```python
@router.get("/sessions/{session_id}", response_model=SessionStateResponse)
async def get_session(session_id: str, request: Request):
    """Get current state of a DQ session.

    Reads live from the Temporal workflow when available. If Temporal returns
    NOT_FOUND (workflow retention expired), hydrates from the DB row + the
    most-advanced snapshot."""
    client = request.app.state.temporal_client
    state: dict | None = None
    try:
        handle = client.get_workflow_handle(session_id)
        state = await handle.query(DQAcceleratorWorkflow.get_full_state)
    except RPCError as e:
        if e.status != RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=500, detail=str(e))
        # fall through to DB hydration
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if state is None:
        # Hydrate from DB
        try:
            sid_uuid = _uuid.UUID(session_id)
        except ValueError:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        sm = get_sessionmaker()
        async with sm() as db:
            row = await get_session_row(db, sid_uuid)
            if row is None:
                raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
            # Pick the most-advanced snapshot to hydrate fields. Order matches the workflow.
            STAGE_ORDER = ["pipeline", "scorecard", "transform", "plan", "triage",
                           "validate", "rules", "explore", "profile"]
            payload: dict = {}
            for stage_name in STAGE_ORDER:
                snap = await get_snapshot(db, sid_uuid, stage_name)
                if snap is not None:
                    payload = {**snap.payload, **payload}  # earlier stage values fill gaps
            state = {
                "stage": row.stage,
                "session_id": session_id,
                "profile": payload.get("profile", {}),
                "ai_summary": payload.get("ai_summary", ""),
                "suggested_rules": payload.get("suggested_rules", []),
                "baseline_quality_score": row.baseline_score or 0.0,
                "current_score": row.current_score or 0.0,
                "validation_summary": payload.get("validation_summary", ""),
                "anomaly_summary": payload.get("anomaly_summary", ""),
                "current_suggestion": None,
                "current_preview": None,
                "transformation_log": payload.get("transformation_log", []),
                "scorecard": payload.get("scorecard", {}),
                "narrative": payload.get("narrative", ""),
                "output_dir": row.output_dir or "",
                "zip_path": row.zip_path or "",
                "validation_results": payload.get("validation_results", {}),
                "triage_result": payload.get("triage_result", {}),
                "transform_plan": payload.get("transform_plan"),
                "execution_escalation": payload.get("execution_escalation"),
            }

    # Existing response building (unchanged):
    current_suggestion = None
    raw_suggestion = state.get("current_suggestion")
    raw_preview = state.get("current_preview")
    if raw_suggestion:
        preview = None
        if raw_preview:
            preview = TransformationPreview(
                before_sample=raw_preview.get("before_sample", []),
                after_sample=raw_preview.get("after_sample", []),
                affected_row_count=raw_preview.get("affected_row_count", 0),
                projected_score_delta=raw_preview.get("projected_score_delta"),
                projected_score=raw_preview.get("projected_score"),
            )
        current_suggestion = CurrentSuggestion(
            transformation_id=raw_suggestion.get("id", ""),
            type=raw_suggestion.get("type", ""),
            params=raw_suggestion.get("params", {}),
            rationale=raw_suggestion.get("rationale", ""),
            custom_code=raw_suggestion.get("custom_code"),
            preview=preview,
        )

    transformation_log = [
        TransformationLogEntry(**entry)
        for entry in state.get("transformation_log", [])
    ]

    return SessionStateResponse(
        session_id=session_id,
        stage=WorkflowStage(state.get("stage", "LOADING")),
        profile=state.get("profile", {}),
        ai_summary=state.get("ai_summary", ""),
        suggested_rules=state.get("suggested_rules", []),
        baseline_quality_score=state.get("baseline_quality_score", 0.0),
        current_score=state.get("current_score", 0.0),
        validation_summary=state.get("validation_summary", ""),
        anomaly_summary=state.get("anomaly_summary", ""),
        current_suggestion=current_suggestion,
        transformation_log=transformation_log,
        scorecard=state.get("scorecard", {}),
        narrative=state.get("narrative", ""),
        output_dir=state.get("output_dir", ""),
        zip_path=state.get("zip_path", ""),
        validation_results=state.get("validation_results", {}),
        triage_result=state.get("triage_result", {}),
        transform_plan=state.get("transform_plan"),
        execution_escalation=state.get("execution_escalation"),
    )
```

(`RPCStatusCode` is already imported at the top of `sessions.py`. No import change needed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/backend/api/test_get_session_fallback.py -v`
Expected: 2 tests pass.

Then run the full sessions-router test suite to confirm no regression:
`pytest tests/backend/api/ -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/api/routers/sessions.py tests/backend/api/test_get_session_fallback.py
git commit -m "feat(api): GET /sessions/{id} falls back to DB on Temporal NOT_FOUND"
```

---

## Phase 3 — Snapshot Activity + Workflow Wiring

### Task 12: The `snapshot_stage` activity

**Files:**
- Create: `backend/temporal/activities/snapshot_activities.py`
- Test: `tests/backend/temporal/test_snapshot_activities.py`

- [ ] **Step 1: Write the failing test**

Create `tests/backend/temporal/test_snapshot_activities.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/backend/temporal/test_snapshot_activities.py -v`
Expected: FAIL — `snapshot_activities` module doesn't exist.

- [ ] **Step 3: Implement the activity**

Create `backend/temporal/activities/snapshot_activities.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/backend/temporal/test_snapshot_activities.py -v`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/temporal/activities/snapshot_activities.py tests/backend/temporal/test_snapshot_activities.py
git commit -m "feat(temporal): add snapshot_stage activity"
```

---

### Task 13: Register the activity on the worker, open engine on worker boot

**Files:**
- Modify: `backend/temporal/worker.py`

- [ ] **Step 1: Wire the worker**

Edit `backend/temporal/worker.py`. Above the existing activity imports, add:

```python
from backend.db.engine import build_engine, set_engine, dispose_engine  # noqa: E402
from backend.temporal.activities.snapshot_activities import snapshot_stage  # noqa: E402
```

In `main()`, before constructing `Worker(...)`, add:

```python
    set_engine(build_engine())
    logger.info("App DB engine initialized")
```

Add `snapshot_stage` to the `activities=[...]` list (after the last existing entry, `triage_rules_activity`).

After `await worker.run()` (which won't return until shutdown), add:

```python
    await dispose_engine()
```

- [ ] **Step 2: Smoke test**

`docker compose up -d postgresql temporal`
Then: `APP_DB_DSN=postgresql+asyncpg://temporal:temporal@localhost:5432/temporal python -m backend.temporal.worker &`
Wait ~3s. Expected log lines: `App DB engine initialized` and `Worker started on task queue: dq-accelerator-queue`.
Stop: `kill %1`.

- [ ] **Step 3: Commit**

```bash
git add backend/temporal/worker.py
git commit -m "feat(temporal): worker opens app DB engine, registers snapshot_stage"
```

---

### Task 14: Helper on the workflow for snapshot calls

**Files:**
- Modify: `backend/temporal/workflows/dq_workflow.py`

Add a private helper that constructs `session_updates` from current workflow state and invokes the activity. Centralized so individual snapshot sites stay one-liners.

- [ ] **Step 1: Add the import**

In the `with workflow.unsafe.imports_passed_through():` block in `dq_workflow.py`, add:

```python
    from backend.temporal.activities.snapshot_activities import snapshot_stage
```

- [ ] **Step 2: Add the helper method**

Inside the `DQAcceleratorWorkflow` class (place after the `_escalate` helper, around the existing line ~252):

```python
    async def _snapshot(self, ui_stage: str, payload: dict) -> None:
        """Persist a stage snapshot. Always best-effort; failures shouldn't kill the workflow."""
        session_updates = {
            "stage": self.stage,
            "current_score": self.current_score,
            "baseline_score": self.baseline_quality_score,
            "output_dir": self.output_dir or None,
            "zip_path": self.zip_path or None,
        }
        try:
            await workflow.execute_activity(
                snapshot_stage,
                {
                    "session_id": self.session_id,
                    "stage": ui_stage,
                    "payload": payload,
                    "session_updates": session_updates,
                },
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=ACTIVITY_RETRY,
            )
        except Exception:
            workflow.logger.exception("snapshot_stage failed for %s", ui_stage)
```

- [ ] **Step 3: Verify the workflow still type-checks**

Run: `python -c "from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow; print('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/temporal/workflows/dq_workflow.py
git commit -m "feat(workflow): add _snapshot helper"
```

---

### Task 15: Snapshot at each stage exit

**Files:**
- Modify: `backend/temporal/workflows/dq_workflow.py`
- Test: `tests/backend/temporal/test_workflow_snapshot_calls.py`

We add nine call sites. To keep changes focused and reviewable, each call is added inline at the natural transition point. Each call uses the helper from Task 14.

- [ ] **Step 1: Write the failing test (snapshot call coverage)**

Create `tests/backend/temporal/test_workflow_snapshot_calls.py`:

```python
"""Smoke test that the workflow source contains a _snapshot call for each
UI stage. We can't easily run the full workflow in a unit test, so we
verify by reading the source — cheap and prevents regressions."""
import inspect
from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow

EXPECTED_STAGES = {
    "profile", "explore", "rules", "validate",
    "triage", "plan", "transform", "scorecard", "pipeline",
}


def test_workflow_calls_snapshot_for_every_ui_stage():
    src = inspect.getsource(DQAcceleratorWorkflow)
    for stage in EXPECTED_STAGES:
        assert f'self._snapshot("{stage}"' in src, f"missing _snapshot('{stage}') in workflow"
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/backend/temporal/test_workflow_snapshot_calls.py -v`
Expected: FAIL with the first missing stage.

- [ ] **Step 3: Add snapshot calls in `DQAcceleratorWorkflow.run`**

In `backend/temporal/workflows/dq_workflow.py`:

**(a) Profile** — immediately after the `PROFILING_SYNTHESIS` block assigns `self.profile`/`self.ai_summary` (around line 359, after `self.top_issues = profile_result.get("top_issues", [])`):

```python
        await self._snapshot("profile", {
            "profile": self.profile,
            "ai_summary": self.ai_summary,
        })
```

**(b) Explore** — also after the synthesis block. Read the JSONL progress file and snapshot it. Add after the profile snapshot:

```python
        # Snapshot exploration events (frozen JSONL → list)
        explore_events: list = []
        try:
            from pathlib import Path
            import json as _json
            progress = Path("data/sessions") / self.session_id / "investigation_progress.jsonl"
            if progress.exists():
                explore_events = [
                    _json.loads(l) for l in progress.read_text().splitlines() if l.strip()
                ]
        except Exception:
            workflow.logger.exception("could not freeze investigation_progress.jsonl")
        await self._snapshot("explore", {"investigation_events": explore_events})
```

Note: Path reads from the workflow look ugly but Temporal sandboxes I/O — `imports_passed_through()` is required. Since we already import via that mechanism elsewhere, this is fine. If sandbox complains in your environment, move the JSONL freeze into a tiny new activity.

**(c) Rules** — after `AWAITING_RULE_APPROVAL` resolves, before `VALIDATING`. Insert at around line 380, immediately before `self.stage = "VALIDATING"`:

```python
        approved_ids = [r["id"] for r in (self.approved_rules or [])]
        rejected_ids = [r["id"] for r in self.suggested_rules if r["id"] not in approved_ids]
        await self._snapshot("rules", {
            "suggested_rules": self.suggested_rules,
            "approved_rule_ids": approved_ids,
            "rejected_rule_ids": rejected_ids,
        })
```

**(d) Validate** — after the `analyze_and_prioritize_activity` block, immediately after `self.transformation_queue = analyze_result.get(...)` (around line 418):

```python
        await self._snapshot("validate", {
            "validation_summary": self.validation_summary,
            "validation_results": self.validation_results,
            "baseline_score": self.baseline_quality_score,
        })
```

**(e) Triage** — at the end of the `if failing_rules:` block, after the optional re-validation. Place it after the `if threshold_changes or rejected_ids:` re-validation block (around line 481):

```python
        triage_amendments = self.triage_amendments or {}
        await self._snapshot("triage", {
            "triage_result": self.triage_result,
            "threshold_changes": triage_amendments.get("accepted_threshold_changes", []),
            "rejected_rule_ids": triage_amendments.get("rejected_rule_ids", []),
        })
```

This goes **inside** the `if failing_rules:` arm. After that arm ends, the workflow proceeds to PLANNING.

**(f) Plan** — after `self.plan_decision = None` (around line 541), immediately before `self.stage = "TRANSFORMATION_LOOP"`:

```python
        await self._snapshot("plan", {"transform_plan": self.transform_plan})
```

**(g) Transform** — after the transformation loop completes and `self.transform_plan` is updated with final step statuses (around line 959, after `self.transform_plan = {**self.transform_plan, "steps": steps}`):

```python
        await self._snapshot("transform", {
            "transformation_log": self.transformation_log,
            "anomaly_summary": self.anomaly_narrative,
            "execution_escalation": self.execution_escalation,
            "transform_plan": self.transform_plan,
        })
```

**(h) Scorecard** — after `self.narrative = scorecard_summary.get("narrative", "")` (around line 974), immediately before `self.stage = "AWAITING_PIPELINE_CONFIRMATION"`:

```python
        await self._snapshot("scorecard", {
            "scorecard": self.scorecard,
            "narrative": self.narrative,
            "current_score": self.current_score,
        })
```

**(i) Pipeline** — at the very end, after `self.stage = "COMPLETE"` (around line 1011), before the `return`:

```python
        await self._snapshot("pipeline", {
            "output_dir": self.output_dir,
            "zip_path": self.zip_path,
        })
```

- [ ] **Step 4: Verify the test passes**

Run: `pytest tests/backend/temporal/test_workflow_snapshot_calls.py -v`
Expected: PASS.

- [ ] **Step 5: Smoke run end-to-end**

`docker compose up -d` (full stack). Upload a small CSV via `curl`:

```bash
curl -F file=@<some-test-csv> -F use_case=test http://localhost:8000/api/v1/sessions
```

After the workflow reaches `AWAITING_RULE_APPROVAL`, check:

```bash
docker compose exec postgresql psql -U temporal -d temporal -c \
  "SELECT stage FROM dq_app.stage_snapshots ORDER BY created_at"
```

Expected: rows for `profile` and `explore` at minimum. The `sessions` row should have `stage='AWAITING_RULE_APPROVAL'`.

- [ ] **Step 6: Commit**

```bash
git add backend/temporal/workflows/dq_workflow.py tests/backend/temporal/test_workflow_snapshot_calls.py
git commit -m "feat(workflow): snapshot stages at each transition"
```

---

## Phase 4 — Frontend: List, Delete, Polling Discipline

### Task 16: Frontend `lib/api.ts` — new endpoints

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/lib/types.ts`

- [ ] **Step 1: Add types**

Edit `frontend/lib/types.ts`. Replace the existing `SessionListEntry` interface with the new shape:

```ts
export interface SessionListEntry {
  id: string
  filename: string
  stage: WorkflowStage
  current_score: number
  baseline_score: number
  created_at: string
  updated_at: string
}

export interface StageSnapshot<T = Record<string, unknown>> {
  stage: string
  payload: T
  created_at: string
}
```

- [ ] **Step 2: Add API client functions**

Edit `frontend/lib/api.ts`. Add the import:

```ts
import type { CreateSessionResponse, SessionState, SessionListEntry, StageSnapshot, ScorecardResponse, Rule, TargetEnv, TriageResult, TransformPlanStep } from './types'
```

(Replace the existing import line.)

Then append:

```ts
export async function listSessions(): Promise<SessionListEntry[]> {
  return request('/api/v1/sessions')
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/v1/sessions/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    throw new Error(`${res.status} delete /sessions/${id}`)
  }
}

export async function getStageSnapshot<T = Record<string, unknown>>(
  sessionId: string, stage: string
): Promise<StageSnapshot<T>> {
  return request(`/api/v1/sessions/${sessionId}/stages/${stage}`)
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (existing callers of `SessionListEntry` will need updating in Task 17).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts frontend/lib/types.ts
git commit -m "feat(frontend): add listSessions, deleteSession, getStageSnapshot"
```

---

### Task 17: Replace `useSessionList` (localStorage) with DB-backed `useSessionsList` (SWR)

**Files:**
- Create: `frontend/hooks/useSessionsList.ts`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/components/sessions/SessionCard.tsx`
- Delete: `frontend/hooks/useSessionList.ts`
- Test: `frontend/__tests__/useSessionsList.test.ts` (if `__tests__` setup exists; otherwise skip)

- [ ] **Step 1: Create the new hook**

Create `frontend/hooks/useSessionsList.ts`:

```ts
import useSWR from 'swr'
import { listSessions } from '@/lib/api'
import type { SessionListEntry } from '@/lib/types'

export function useSessionsList() {
  const { data, error, isLoading, mutate } = useSWR<SessionListEntry[]>(
    '/api/v1/sessions',
    () => listSessions(),
    { refreshInterval: 5000, refreshWhenHidden: false }
  )
  return {
    sessions: data ?? [],
    error,
    isLoading,
    refresh: () => mutate(),
  }
}
```

- [ ] **Step 2: Update home page**

Edit `frontend/app/page.tsx`. Replace the entire file with:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSessionsList } from '@/hooks/useSessionsList'
import { SessionCard } from '@/components/sessions/SessionCard'
import { UploadModal } from '@/components/sessions/UploadModal'

export default function HomePage() {
  const router = useRouter()
  const { sessions, refresh } = useSessionsList()
  const [showUpload, setShowUpload] = useState(false)

  function handleCreated(id: string) {
    refresh()
    setShowUpload(false)
    router.push(`/sessions/${id}`)
  }

  return (
    <div className="min-h-screen p-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>⬡</div>
          <div>
            <div className="font-semibold text-text-primary">DQ Accelerator</div>
            <div className="text-xs text-text-muted">AI-powered data quality pipeline</div>
          </div>
        </div>
        <button className="bg-indigo text-white text-sm font-medium px-4 py-2 rounded-lg" onClick={() => setShowUpload(true)}>
          + New Session
        </button>
      </div>

      {sessions.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-text-muted mb-3">Recent Sessions</div>
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {sessions.map(s => (
              <SessionCard
                key={s.id}
                entry={s}
                onOpen={() => router.push(`/sessions/${s.id}`)}
                onDeleted={() => refresh()}
              />
            ))}
            <div
              className="bg-surface border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center min-h-[160px] cursor-pointer hover:border-indigo/30 gap-2"
              onClick={() => setShowUpload(true)}
            >
              <div className="w-9 h-9 rounded-full border border-dashed border-border flex items-center justify-center text-text-muted text-xl">+</div>
              <div className="text-center"><div className="text-sm text-text-muted font-medium">Upload a dataset</div><div className="text-xs text-border mt-0.5">CSV, Parquet, or JSON</div></div>
            </div>
          </div>
        </>
      )}

      {sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="text-text-muted text-sm">No sessions yet</div>
          <button className="bg-indigo text-white text-sm font-medium px-5 py-2.5 rounded-lg" onClick={() => setShowUpload(true)}>Upload your first dataset →</button>
        </div>
      )}

      {showUpload && <UploadModal onCreated={handleCreated} onClose={() => setShowUpload(false)} />}
    </div>
  )
}
```

Note: `UploadModal.onCreated` may have a different signature; check it. The original was `(id, filename) => void`. The new one drops `filename` (we get it back from the list refresh). Update `UploadModal` accordingly in the next step if its signature mismatches.

- [ ] **Step 3: Update UploadModal prop signature**

Open `frontend/components/sessions/UploadModal.tsx` and change the `onCreated` prop type from `(id: string, filename: string) => void` to `(id: string) => void`. Where it currently calls `onCreated(id, file.name)`, change to `onCreated(id)`.

- [ ] **Step 4: Update `SessionCard` to take the new entry shape and add delete**

Replace `frontend/components/sessions/SessionCard.tsx` with:

```tsx
'use client'
import { useState } from 'react'
import type { SessionListEntry } from '@/lib/types'
import { deleteSession, getPipelineDownloadUrl } from '@/lib/api'

const STAGE_LABELS: Record<string, string> = {
  LOADING: 'Loading',
  PROFILING: 'Profiling',
  AWAITING_INVESTIGATION_REVIEW: 'Reviewing Exploration',
  REINVESTIGATING: 'Investigating',
  PROFILING_SYNTHESIS: 'Synthesizing',
  RULE_REVIEW: 'Reviewing Rules',
  AWAITING_RULE_APPROVAL: 'Awaiting Rules',
  VALIDATING: 'Validating',
  TRIAGING: 'Triaging',
  AWAITING_TRIAGE_APPROVAL: 'Awaiting Triage',
  PLANNING: 'Planning',
  AWAITING_PLAN_APPROVAL: 'Awaiting Plan',
  TRANSFORMATION_LOOP: 'Transforming',
  AWAITING_HUMAN_INPUT: 'Awaiting Input',
  AWAITING_PIPELINE_CONFIRMATION: 'Ready for Pipeline',
  GENERATING: 'Generating',
  COMPLETE: 'Complete',
}

interface Props {
  entry: SessionListEntry
  onOpen: () => void
  onDeleted: () => void
}

export function SessionCard({ entry, onOpen, onDeleted }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const stage = entry.stage
  const score = entry.current_score ?? 0
  const baseline = entry.baseline_score ?? 0

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try {
      await deleteSession(entry.id)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="group relative bg-surface border border-border rounded-xl p-[18px] cursor-pointer hover:border-indigo/40 transition-colors"
      onClick={onOpen}
      onMouseLeave={() => setConfirming(false)}
    >
      <button
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger text-xs px-2 py-1 rounded"
        onClick={handleDelete}
        title={confirming ? 'Click again to confirm' : 'Delete session'}
      >
        {deleting ? '…' : confirming ? 'Confirm?' : '×'}
      </button>

      <div className="flex items-start justify-between mb-3 pr-6">
        <div>
          <div className="font-semibold text-text-primary text-sm">{entry.filename}</div>
          <div className="text-xs text-text-muted mt-0.5">{new Date(entry.created_at).toLocaleDateString()}</div>
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo/10 text-indigo">
          {STAGE_LABELS[stage] ?? stage}
        </span>
      </div>

      {score > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-muted">Quality Score</span>
            <span className="font-semibold text-success">
              {Math.round(score * 100)}%
              {stage === 'COMPLETE' && baseline > 0 && (
                <span className="text-success ml-1 text-[10px]">+{Math.round((score - baseline) * 100)}%</span>
              )}
            </span>
          </div>
          <div className="bg-border rounded h-1.5 overflow-hidden">
            <div className="h-full rounded transition-all bg-success" style={{ width: `${score * 100}%` }} />
          </div>
        </div>
      )}

      {stage === 'COMPLETE' && (
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          <a
            href={getPipelineDownloadUrl(entry.id)}
            download
            className="flex-1 text-center text-[11px] border border-border text-text-secondary px-2 py-1.5 rounded-md hover:bg-elevated"
          >
            ↓ Download
          </a>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Delete the old localStorage hook**

```bash
git rm frontend/hooks/useSessionList.ts
```

Search for residual usages:

```bash
rtk proxy grep -rn "useSessionList" frontend/app frontend/components frontend/hooks
```
Expected: no results. If any remain, update them to use `useSessionsList` or remove the import.

- [ ] **Step 6: Verify dev server boots**

Run `cd frontend && npx tsc --noEmit`.
Expected: no type errors.

Then `npm --prefix frontend run dev` (in background) and open `http://localhost:3000`. Existing sessions should appear from the DB; you can delete one with the `×` (hover) button.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/page.tsx frontend/components/sessions/SessionCard.tsx frontend/components/sessions/UploadModal.tsx frontend/hooks/useSessionsList.ts frontend/hooks/useSessionList.ts frontend/lib/types.ts
git commit -m "feat(frontend): DB-backed session list with delete; drop localStorage"
```

---

### Task 18: Polling discipline in `useSession`

**Files:**
- Modify: `frontend/hooks/useSession.ts`
- Modify: `frontend/app/sessions/[id]/page.tsx`

- [ ] **Step 1: Update the hook signature**

Replace `frontend/hooks/useSession.ts` with:

```ts
import useSWR from 'swr'
import { getSession } from '@/lib/api'
import type { SessionState } from '@/lib/types'

export function useSession(id: string | null, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true
  const { data, error, isLoading, mutate } = useSWR<SessionState>(
    id && enabled ? `/session/${id}` : null,
    () => getSession(id!),
    { refreshInterval: 2000, refreshWhenHidden: false, revalidateOnFocus: true }
  )
  return { session: data, error, isLoading, refresh: mutate }
}
```

- [ ] **Step 2: Update workspace page to disable polling on past-stage views**

In `frontend/app/sessions/[id]/page.tsx`, change the existing `useSession(id)` call:

```ts
const isViewingPast = viewingStage !== null && viewingStage !== active
const { session, isLoading } = useSession(id, { enabled: !isViewingPast })
```

Note: `isPastStage` is currently computed *after* `useSession` runs (it depends on `active` from `workflowToStepper(session?.stage)`). That means the very first render still polls. That's fine — on the next render after `viewingStage` is set, polling stops.

Move the `const { active, completed } = workflowToStepper(stage)` computation up so `isViewingPast` can be computed before `useSession(...)`. The order becomes:

1. `const [viewingStage, setViewingStage] = useState<StageId | null>(null)`
2. We do not know `active` yet, so we approximate: `const isViewingPast = viewingStage !== null`
3. `const { session, isLoading } = useSession(id, { enabled: !isViewingPast })`

(The simplified test: if the user has clicked into a past stage at all, stop polling. When they click "Return →" `viewingStage` becomes null and polling resumes.)

Replace the existing line `const [viewingStage, setViewingStage] = useState<StageId | null>(null)` with:

```tsx
  const [viewingStage, setViewingStage] = useState<StageId | null>(null)
  const isViewingPast = viewingStage !== null
  const { session, isLoading } = useSession(id, { enabled: !isViewingPast })
```

And remove the now-duplicate `const { session, isLoading } = useSession(id)` line further down.

- [ ] **Step 3: Manual verification**

`npm --prefix frontend run dev`. Open a session in DevTools Network tab. Confirm:
- Active stage view: `/api/v1/sessions/{id}` requests every ~2s.
- Click a past step: requests stop.
- Switch to a different browser tab: requests pause (SWR `refreshWhenHidden: false`).
- Click "Return →": requests resume.

- [ ] **Step 4: Commit**

```bash
git add frontend/hooks/useSession.ts frontend/app/sessions/[id]/page.tsx
git commit -m "feat(frontend): pause useSession polling when viewing past stage or hidden tab"
```

---

## Phase 5 — Snapshot-Aware Past Stages

### Task 19: `useStageSnapshot` hook

**Files:**
- Create: `frontend/hooks/useStageSnapshot.ts`

- [ ] **Step 1: Implement**

Create `frontend/hooks/useStageSnapshot.ts`:

```ts
import useSWR from 'swr'
import { getStageSnapshot } from '@/lib/api'
import type { StageSnapshot } from '@/lib/types'

export function useStageSnapshot<T = Record<string, unknown>>(
  sessionId: string | null,
  stage: string | null,
  enabled: boolean,
) {
  const key = sessionId && stage && enabled ? `/api/v1/sessions/${sessionId}/stages/${stage}` : null
  const { data, error, isLoading } = useSWR<StageSnapshot<T>>(
    key,
    () => getStageSnapshot<T>(sessionId!, stage!),
    { revalidateOnFocus: false, refreshInterval: 0 },
  )
  return { snapshot: data, error, isLoading }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/hooks/useStageSnapshot.ts
git commit -m "feat(frontend): add useStageSnapshot hook"
```

---

### Task 20: Add `readOnly` prop to all stage components

**Files:**
- Modify: `frontend/components/stages/ProfileStage.tsx`
- Modify: `frontend/components/stages/RulesStage.tsx`
- Modify: `frontend/components/stages/ValidateStage.tsx`
- Modify: `frontend/components/stages/TriageStage.tsx`
- Modify: `frontend/components/stages/PlanReviewStage.tsx`
- Modify: `frontend/components/stages/ExecutionStage.tsx`
- Modify: `frontend/components/stages/ScorecardStage.tsx`
- Modify: `frontend/components/stages/PipelineStage.tsx`
- Modify: `frontend/components/stages/ExplorationStage.tsx`

Each component gets a `readOnly?: boolean` prop. When `readOnly` is true, action buttons (approve, reject, decide, submit) are hidden or disabled.

- [ ] **Step 1: `RulesStage` — example pattern**

In `frontend/components/stages/RulesStage.tsx`, change the prop type:

```tsx
interface Props { session: SessionState; readOnly?: boolean }

export function RulesStage({ session, readOnly = false }: Props) {
```

Anywhere there is a Submit/Approve button block, wrap it in `{!readOnly && (...)}`. The decide buttons on each rule row should also become `disabled` when `readOnly`. For per-card buttons, change `disabled={...}` to `disabled={readOnly || existingCondition}`.

- [ ] **Step 2: Repeat for the other 8 stage components**

For each of `ValidateStage`, `TriageStage`, `PlanReviewStage`, `ExecutionStage`, `ScorecardStage`, `PipelineStage`, `ProfileStage`, `ExplorationStage`: add `readOnly?: boolean` to the props interface, default to `false`, and gate any button that calls an `api.ts` action behind `!readOnly`. Buttons that *navigate* (e.g. `onContinue`) should remain.

- [ ] **Step 3: Type-check**

`cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/stages
git commit -m "feat(frontend): add readOnly prop to all stage components"
```

---

### Task 21: Snapshot-aware stage dispatcher

**Files:**
- Create: `frontend/components/stages/SnapshotStageView.tsx`
- Modify: `frontend/app/sessions/[id]/page.tsx`

The dispatcher fetches the snapshot for the requested past stage and renders the same `*Stage.tsx` component with `readOnly=true`, passing the snapshot payload as a synthetic `SessionState`.

- [ ] **Step 1: Implement the dispatcher**

Create `frontend/components/stages/SnapshotStageView.tsx`:

```tsx
'use client'
import { useStageSnapshot } from '@/hooks/useStageSnapshot'
import type { SessionState } from '@/lib/types'
import { ProfileStage } from './ProfileStage'
import { RulesStage } from './RulesStage'
import { ValidateStage } from './ValidateStage'
import { TriageStage } from './TriageStage'
import { PlanReviewStage } from './PlanReviewStage'
import { ExecutionStage } from './ExecutionStage'
import { ScorecardStage } from './ScorecardStage'
import { PipelineStage } from './PipelineStage'
import type { StageId } from '@/components/workspace/Stepper'

interface Props {
  sessionId: string
  stage: StageId
}

export function SnapshotStageView({ sessionId, stage }: Props) {
  const { snapshot, isLoading } = useStageSnapshot(sessionId, stage, true)

  if (isLoading) return <div className="p-5 text-text-muted">Loading snapshot…</div>
  if (!snapshot) {
    return (
      <div className="p-5 text-text-muted">
        This stage didn't run yet for this session.
      </div>
    )
  }

  // Build a synthetic SessionState that satisfies whatever the stage component reads.
  const p = snapshot.payload as Record<string, unknown>
  const synthetic: SessionState = {
    session_id: sessionId,
    stage: 'COMPLETE',
    profile: (p.profile as Record<string, unknown>) ?? {},
    ai_summary: (p.ai_summary as string) ?? '',
    suggested_rules: (p.suggested_rules as any) ?? [],
    baseline_quality_score: (p.baseline_score as number) ?? 0,
    current_score: (p.current_score as number) ?? 0,
    validation_summary: (p.validation_summary as string) ?? '',
    anomaly_summary: (p.anomaly_summary as string) ?? '',
    transformation_log: (p.transformation_log as any) ?? [],
    validation_results: (p.validation_results as any) ?? undefined,
    triage_result: (p.triage_result as any) ?? undefined,
    transform_plan: (p.transform_plan as any) ?? undefined,
    execution_escalation: (p.execution_escalation as any) ?? undefined,
    scorecard: (p.scorecard as Record<string, unknown>) ?? {},
    narrative: (p.narrative as string) ?? '',
    output_dir: (p.output_dir as string) ?? '',
    zip_path: (p.zip_path as string) ?? '',
  }

  switch (stage) {
    case 'profile':   return <ProfileStage   session={synthetic} onContinue={() => {}} readOnly />
    case 'rules':     return <RulesStage     session={synthetic} readOnly />
    case 'validate':  return <ValidateStage  session={synthetic} readOnly />
    case 'triage':    return <TriageStage    session={synthetic} readOnly />
    case 'plan':      return <PlanReviewStage session={synthetic} readOnly />
    case 'transform': return <ExecutionStage session={synthetic} readOnly />
    case 'scorecard': return <ScorecardStage sessionId={sessionId} readOnly />
    case 'pipeline':  return <PipelineStage  sessionId={sessionId} stage="COMPLETE" readOnly />
    case 'explore':
      // ExplorationStage reads from its own SSE/live source; for past-stage view,
      // render the frozen events.
      return (
        <div className="p-5">
          <h2 className="text-base font-bold text-text-primary mb-2">Exploration (snapshot)</h2>
          <pre className="text-xs text-text-secondary whitespace-pre-wrap">
            {JSON.stringify(p.investigation_events ?? [], null, 2)}
          </pre>
        </div>
      )
    default:
      return <div className="p-5 text-text-muted">Unsupported stage: {stage}</div>
  }
}
```

- [ ] **Step 2: Wire it into the workspace page**

In `frontend/app/sessions/[id]/page.tsx`, import:

```ts
import { SnapshotStageView } from '@/components/stages/SnapshotStageView'
```

Then change `renderStage()`:

```tsx
  function renderStage() {
    if (!session && isLoading) return <LoadingStage />
    if (isPastStage) {
      return <SnapshotStageView sessionId={id} stage={displayStage} />
    }
    switch (displayStage) {
      // ... existing cases unchanged
    }
  }
```

Note `isPastStage` already exists in the file and means `viewingStage !== null && viewingStage !== active`. Keep that definition.

- [ ] **Step 3: Manual verification**

`npm --prefix frontend run dev`. Take a session past `PROFILING_SYNTHESIS`, then click on the `Profile` stepper item. Confirm the page renders the historical profile data, no action buttons appear, and Network DevTools shows a single `GET /api/v1/sessions/{id}/stages/profile` call with no follow-up polling.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/stages/SnapshotStageView.tsx frontend/app/sessions/[id]/page.tsx
git commit -m "feat(frontend): snapshot-aware past-stage rendering"
```

---

## Phase 6 — Light Mode

### Task 22: Tailwind palette swap

**Files:**
- Modify: `frontend/tailwind.config.ts`
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Replace the palette**

Edit `frontend/tailwind.config.ts`. Replace the entire `colors:` block with:

```ts
      colors: {
        bg: '#f8fafc',
        surface: '#ffffff',
        elevated: '#f1f5f9',
        border: '#e2e8f0',
        'text-primary': '#0f172a',
        'text-secondary': '#475569',
        'text-muted': '#94a3b8',
        indigo: { DEFAULT: '#4f46e5', light: '#6366f1' },
        success: { DEFAULT: '#16a34a', light: '#22c55e' },
        warning: { DEFAULT: '#d97706', light: '#f59e0b' },
        danger: { DEFAULT: '#dc2626', light: '#ef4444' },
        purple: { DEFAULT: '#7c3aed', light: '#a78bfa' },
      },
```

- [ ] **Step 2: Replace globals.css**

Replace `frontend/app/globals.css` with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background: #f8fafc;
  color: #0f172a;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

- [ ] **Step 3: Verify**

`npm --prefix frontend run dev`. Confirm pages now render on a light background. Check the home page card list, an active session workspace, and a past-stage view.

- [ ] **Step 4: Commit**

```bash
git add frontend/tailwind.config.ts frontend/app/globals.css
git commit -m "feat(frontend): switch palette to light mode"
```

---

### Task 23: Sweep hardcoded hexes for contrast

**Files:**
- Modify: `frontend/components/sessions/SessionCard.tsx` (already touched in Task 17)
- Modify: any component that uses raw colors `#22c55e`, `#f59e0b`, `#f87171`, `text-cyan-*`, `bg-cyan-*`, hot pinks, etc.

- [ ] **Step 1: Find hardcoded hexes**

```bash
rtk proxy grep -rn "#\([0-9a-fA-F]\)\{6\}" frontend/components frontend/app
```

For each match, decide:
- If it's a semantic color (e.g. `#22c55e` used for "success"), replace with the corresponding Tailwind token: `text-success`, `bg-success`, etc.
- If it's a decorative gradient (e.g. the logo `linear-gradient(135deg,#6366f1,#8b5cf6)`), leave it.

- [ ] **Step 2: Find `text-cyan-*` and `bg-cyan-*` usages**

```bash
rtk proxy grep -rn "cyan-\(300\|400\)" frontend
```

Replace with `text-indigo` / `bg-indigo/10` (or appropriate semantic equivalent) so contrast holds on white.

- [ ] **Step 3: Manual visual pass**

Open each of: home page, every stage view, AI panel, top bar, stepper. Confirm:
- All text is readable (no light-gray-on-white).
- Status pills are visible.
- The warning banner ("Viewing past stage —") in `app/sessions/[id]/page.tsx` is legible against light bg. Adjust if needed.

- [ ] **Step 4: Commit**

```bash
git add frontend
git commit -m "fix(frontend): adjust hardcoded colors for light-mode contrast"
```

---

### Task 24: Drop the localStorage migration crumb

**Files:**
- Modify: `frontend/app/page.tsx`

A small, idempotent cleanup so users upgrading don't keep stale entries.

- [ ] **Step 1: Add cleanup**

In `frontend/app/page.tsx`, inside the `HomePage` component, add at the top of the component body:

```tsx
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem('dq_sessions') } catch {}
  }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "chore(frontend): drop legacy dq_sessions localStorage key"
```

---

## Final verification

- [ ] **Backend tests**: `pytest` → all green.
- [ ] **Frontend type-check**: `cd frontend && npx tsc --noEmit` → no errors.
- [ ] **Frontend tests**: `cd frontend && npm test` → all green.
- [ ] **Manual end-to-end**: upload a CSV; let the workflow advance past profiling and rules; navigate away from the session; come back; click each past stage; confirm data renders. Click delete; confirm session disappears and that `data/sessions/{id}/` and `output/sessions/{id}/` are gone on disk.
- [ ] **DB inspection**: `docker compose exec postgresql psql -U temporal -d temporal -c "SELECT id, filename, stage, current_score FROM dq_app.sessions"` shows the expected rows; `SELECT session_id, stage FROM dq_app.stage_snapshots ORDER BY created_at` shows one row per completed stage.
