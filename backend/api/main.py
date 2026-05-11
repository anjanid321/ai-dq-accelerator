"""FastAPI application entry point with Temporal client lifecycle."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

# Load .env from project root before anything else
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip())

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from temporalio.client import Client  # noqa: E402

from backend.api.routers import sessions, rules, transformations, pipeline, triage, plan_router, exploration  # noqa: E402

logger = logging.getLogger(__name__)

# Module-level Temporal client (set during lifespan)
temporal_client: Client | None = None
TASK_QUEUE = "dq-accelerator-queue"


def get_temporal_client() -> Client:
    if temporal_client is None:
        raise RuntimeError("Temporal client not initialized")
    return temporal_client


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


app = FastAPI(
    title="AI Data Quality Accelerator",
    description="Guided data quality workflow with Temporal + LangGraph",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router, prefix="/api/v1", tags=["sessions"])
app.include_router(rules.router, prefix="/api/v1", tags=["rules"])
app.include_router(transformations.router, prefix="/api/v1", tags=["transformations"])
app.include_router(pipeline.router, prefix="/api/v1", tags=["pipeline"])
app.include_router(triage.router, prefix="/api/v1", tags=["triage"])
app.include_router(plan_router.router, prefix="/api/v1", tags=["plan"])
app.include_router(exploration.router, prefix="/api/v1", tags=["exploration"])


@app.get("/health")
async def health():
    return {"status": "ok", "temporal_connected": temporal_client is not None}
