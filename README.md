# AI Data Quality Accelerator

A guided, agentic data quality workflow that takes a raw dataset through profiling, rule validation, anomaly triage, iterative transformation, and production pipeline generation — with human approval at every decision point.

**Try it:** upload [`samples/loan_applications.csv`](samples/loan_applications.csv) to walk the full pipeline against engineered data-quality issues (200 rows, all three Profile alert buckets, 8–10 proposed rules with failing samples).

---

## Getting Started (First-Time Setup)

### Prerequisites

- Docker and Docker Compose
- [Homebrew](https://brew.sh) Python 3.12: `brew install python@3.12`
- [uv](https://docs.astral.sh/uv/): `curl -LsSf https://astral.sh/uv/install.sh | sh`
- An Anthropic API key

### 1. Clone and configure environment

```bash
git clone <repo-url>
cd ai-dq-accelerator
cp .env.example .env
# Open .env and set ANTHROPIC_API_KEY
```

### 2. Create the virtual environment and install dependencies

```bash
uv venv .venv --python /opt/homebrew/bin/python3.12
uv pip install -e ".[dev]" --python .venv/bin/python
```

### 3. Start infrastructure

```bash
docker compose up -d postgresql temporal temporal-ui
```

This starts:
- PostgreSQL on port 5433 (Temporal + app database)
- Temporal server on port 7233
- Temporal UI at http://127.0.0.1:8088

### 4. Start the full dev stack

```bash
./dev.sh
```

This starts FastAPI (port 8000), the Temporal worker, and the Next.js frontend (port 3000) in a single terminal with prefixed log output. It waits for each service to be healthy before starting the next.

The UI is at **http://127.0.0.1:3000**.

### 5. Verify

```bash
curl http://127.0.0.1:8000/health
```

---

## Workflow Stages

The pipeline runs as a Temporal workflow. Stages execute in order; two stages pause and wait for a human signal before continuing.

### Load

The user uploads a CSV file. The file is ingested into a session-scoped DuckDB database and basic structural checks are run. Each session gets a UUID that tracks all data and artifacts through the rest of the workflow.

### Profile

The dataset is profiled using ydata-profiling to produce statistical summaries, then handed to the **ProfileAnalyzer** agent. The agent runs a multi-phase investigation:

1. Reads the profiling summary and plans which columns and patterns to investigate further.
2. Uses a tool-calling loop to query the live DuckDB session — checking distributions, null rates, value ranges, regex patterns, and cross-column relationships — until it has enough evidence.
3. Synthesizes a "data passport" describing what the data is and its key characteristics.
4. Proposes grounded DQ rules derived from the passport and the user's stated use case.

A deep rule review agent then cross-checks the proposed rules for contradictions before they are shown to the user.

### Rules (human approval required)

The proposed rules are surfaced for human review. The user can approve, reject, or edit individual rules. No further processing happens until the user submits their decisions.

### Validate

Approved rules are executed against the dataset. The **ValidationAnalyzer** agent interprets the results, identifies the most impactful failures, and groups them by root cause. An **ExplorationNotebook** is generated — a pre-executed Jupyter notebook and HTML export that lets the user explore the data in detail.

### Triage

The **TriageAgent** classifies each failing rule into one of four categories:

- `transform_fixable` — a data transformation can resolve this
- `threshold_too_strict` — the rule's threshold is likely misconfigured
- `unfixable` — the data cannot be corrected without external input
- `eval_error` — the rule itself has a definition problem

This classification shapes which issues enter the transformation loop and which are flagged for human attention.

### Plan

The **TransformPlanner** agent uses the triage results to build a sequenced remediation plan. It uses a deep planning loop with access to the live DuckDB session to check row counts, inspect samples, and validate assumptions before committing to each step. The result is an ordered list of named transformation steps the user can review, reorder, or remove before approving.

### Transform

Approved transformation steps execute sequentially. For standard transformations (null imputation, deduplication, type coercion, outlier handling, etc.) the **TransformationAdvisor** agent generates the logic. For custom-coded steps, the **CustomCodeGenerator** agent writes Python code that runs in a sandboxed `exec` environment. After each step, the running quality score is updated. If a step produces an unexpected result, the workflow pauses and escalates to the user for a decision before continuing.

### Scorecard

After all transformations are applied, the **ScorecardNarrator** agent generates a human-readable quality report comparing the baseline dataset to the cleaned version. It includes per-rule pass/fail status, the delta in quality score, and a narrative summary of what changed and why.

### Pipeline

The user confirms their target deployment environment (warehouse, orchestrator, Python version) and the workflow generates a complete, portable pipeline package:

```
output/sessions/{session_id}/
├── dbt_project/
│   ├── models/staging/      # One .sql model per transformation
│   ├── tests/               # dbt tests from approved rules
│   └── dbt_project.yml
├── python_pipeline/
│   ├── transform.py         # Entry point
│   └── requirements.txt
├── data_contract/
│   └── schema.py            # Pandera schema
├── orchestration/
│   └── dag.py               # Airflow DAG
├── quality_report/
│   └── scorecard.json
├── cleaned_data.parquet
└── README.md
```

---

## Architecture

```
Browser (Next.js, port 3000)
  └── FastAPI (port 8000)           REST API + SSE event stream
        └── Temporal Workflow       Durable orchestration, signals, queries
              └── Temporal Activities
                    ├── dq_tools    Core DQ logic (DuckDB-backed, synchronous)
                    └── LangGraph   AI agents (stateless per invocation)
```

Human-in-the-loop pauses are implemented as Temporal **signals** (`approve_rules`, `decide_transformation`, `confirm_pipeline`). The frontend polls workflow state via Temporal **queries** and receives real-time agent narration via server-sent events.

Session state is persisted to Postgres at each stage boundary so past stages can be reviewed after the workflow has moved forward.

---

## Project Structure

```
ai-dq-accelerator/
├── dq_tools/                # Core DQ library (DuckDB-backed, sync)
│   ├── profiler.py
│   ├── rule_engine.py
│   ├── anomaly_detector.py
│   ├── transformation_executor.py
│   ├── pipeline_generator.py
│   └── scorecard.py
├── dq_tools_runtime/        # Lightweight runtime shipped with generated pipelines
│   └── nodes.py             # CustomCodeTransform (sandboxed exec)
├── backend/
│   ├── api/                 # FastAPI application
│   │   ├── main.py          # Lifespan (Alembic migrations + Temporal client)
│   │   ├── schemas.py
│   │   └── routers/         # sessions, rules, transformations, triage, plan, pipeline, exploration
│   ├── db/                  # SQLAlchemy async engine, models, Alembic migrations
│   ├── temporal/            # Workflow, activities, worker
│   └── agents/
│       ├── graphs/          # LangGraph agent implementations
│       ├── state.py         # TypedDict state definitions
│       └── prompts.py       # System prompts
├── frontend/                # Next.js application
│   ├── app/                 # App router pages
│   ├── components/          # Stage components, AI panel, workspace chrome
│   └── hooks/               # useSession, useAIStream, useStageSnapshot
├── templates/               # Jinja2 templates (dbt models, Airflow DAG)
├── tests/
├── docker-compose.yml
├── pyproject.toml
└── dev.sh
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Required. Claude API key. |
| `APP_DB_DSN` | `postgresql+asyncpg://temporal:temporal@localhost:5433/temporal` | SQLAlchemy DSN for the app database. |
| `TEMPORAL_HOST` | `localhost:7233` | Temporal server address. |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace. |
| `DATA_DIR` | `./data` | Session working data directory. |
| `OUTPUT_DIR` | `./output` | Pipeline output directory. |

---

## Running Tests

```bash
pytest                          # all tests
pytest tests/path/to/test.py    # single file
pytest -k "test_name"           # by name pattern
pytest --cov=dq_tools           # with coverage
```

Tests use `asyncio_mode = "auto"` — no `@pytest.mark.asyncio` decorator needed.

## Lint and Format

```bash
ruff check .          # lint
ruff check . --fix    # auto-fix
ruff format .         # format
```
