# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Local Development

```bash
# Start all services (Postgres, Temporal, Temporal UI, FastAPI, Worker)
docker compose up -d

# Start only infrastructure (skip app services)
docker compose up -d postgres temporal temporal-ui

# Run FastAPI dev server (outside Docker)
uvicorn backend.api.main:app --reload --port 8000

# Run Temporal worker (outside Docker)
python -m backend.temporal.worker
```

### Tests

```bash
pytest                          # Run all tests
pytest tests/path/to/test.py    # Run a single file
pytest -k "test_name"           # Run by name pattern
pytest --cov=dq_tools           # Run with coverage
```

Tests use `asyncio_mode = "auto"` — no `@pytest.mark.asyncio` needed.

### Lint & Format

```bash
ruff check .         # Lint
ruff check . --fix   # Auto-fix
ruff format .        # Format
```

### Install (editable)

```bash
pip install -e ".[dev]"
```

## Architecture

The system is a human-in-the-loop data quality pipeline orchestrated by Temporal. The main components are:

**Request flow:**
```
Client → FastAPI (port 8000) → Temporal client → Workflow (task queue: dq-accelerator-queue)
                                                  └→ Activities → dq_tools + LangGraph agents
```

**Workflow stages** (linear, with two human pause points):
```
LOADING → PROFILING → AWAITING_RULE_APPROVAL → VALIDATING
→ TRANSFORMATION_LOOP → AWAITING_PIPELINE_CONFIRMATION → GENERATING → COMPLETE
```

Human-in-the-loop is implemented as Temporal **signals** (`approve_rules`, `decide_transformation`, `confirm_pipeline`). Current workflow state is readable via Temporal **queries** (`get_stage`, `get_full_state`, etc.).

### Key Layers

**`dq_tools/`** — Synchronous, session-scoped DQ library. All functions accept `session_id` as first arg and operate on a DuckDB file at `data/sessions/{session_id}/working.duckdb`. The 8 public functions exported from `__init__.py` are the entire public API used by Temporal activities.

**`backend/temporal/activities/`** — Three activity modules (`data_activities`, `transform_activities`, `pipeline_activities`). Because `dq_tools` is synchronous, activities wrap calls in `asyncio.run_in_executor`.

**`backend/agents/graphs/`** — Four stateless LangGraph graphs (ProfileAnalyzer, ValidationAnalyzer, TransformationAdvisor, ScorecardNarrator). Graphs receive all state as arguments and return results — no disk I/O inside a graph.

**`backend/api/routers/`** — Four router modules map REST endpoints to Temporal client calls (workflow start, signal, query, or result fetch).

**`templates/`** — Jinja2 templates for generated artifacts (`dbt/` SQL models, `airflow/` DAG + operator). `pipeline_generator.py` populates these.

**`dq_tools_runtime/`** — Lightweight package that ships with generated Airflow pipelines. Contains `CustomCodeTransform` with a sandboxed `exec` environment (only `pd`/`np` in scope; imports, file I/O, eval/exec blocked).

### Data Persistence

- **Session database**: `data/sessions/{session_id}/working.duckdb` — live DuckDB per session
- **Generated artifacts**: `output/sessions/{session_id}/` — dbt project, Python pipeline, data contract, orchestration DAG, quality report, `cleaned_data.parquet`
- Both directories are mounted as Docker volumes and are gitignored

### AI Model

Claude model used throughout: `claude-sonnet-4-6`. Configured in `backend/agents/` and passed to LangGraph graphs.

### Environment Variables

See `.env.example`. Required: `ANTHROPIC_API_KEY`. Optional overrides: `TEMPORAL_HOST`, `TEMPORAL_NAMESPACE`, `DATA_DIR`, `OUTPUT_DIR`.
