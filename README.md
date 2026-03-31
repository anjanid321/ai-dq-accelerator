# AI Data Quality Accelerator

Guided, AI-assisted data quality workflow that takes a raw dataset through profiling → rule validation → anomaly detection → iterative transformations → production pipeline generation — all with human-in-the-loop approval at every step.

## Architecture

```
FastAPI (port 8000)           ← REST API (human-facing)
  └── Temporal Workflow        ← Durable orchestration + signals
        └── Temporal Activities
              ├── dq_tools     ← Core DQ logic (DuckDB-backed)
              └── LangGraph    ← AI reasoning (stateless, per-activity)
```

## Quick Start

### Prerequisites

- Docker + Docker Compose
- An `ANTHROPIC_API_KEY`

### 1. Set up environment

```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### 2. Start services

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** (Temporal backing store) — port 5432
- **Temporal** server — port 7233
- **Temporal UI** — http://localhost:8088
- **API** (FastAPI) — http://localhost:8000
- **Worker** (Temporal worker)

### 3. Check health

```bash
curl http://localhost:8000/health
```

### 4. Run locally (without Docker)

```bash
pip install -e ".[dev]"

# Start Temporal (requires Docker)
docker-compose up -d postgresql temporal temporal-ui

# Start worker
python -m backend.temporal.worker &

# Start API
uvicorn backend.api.main:app --reload
```

---

## API Usage

### Step 1 — Upload dataset and start session

```bash
curl -X POST http://localhost:8000/api/v1/sessions \
  -F "file=@data/customers.csv" \
  -F "use_case=churn prediction model" \
  -F "target_column=churned" \
  -F "description=Customer dataset from Salesforce CRM"
```

Response includes `session_id`. Poll `GET /api/v1/sessions/{id}` until `stage == "AWAITING_RULE_APPROVAL"`.

### Step 2 — Approve rules

```bash
curl -X POST http://localhost:8000/api/v1/sessions/{id}/rules/approve \
  -H "Content-Type: application/json" \
  -d '{
    "approved_rules": [...],
    "rejected_rule_ids": ["r5"]
  }'
```

### Step 3 — Transformation loop

Poll `GET /api/v1/sessions/{id}` to see the current suggestion and preview. Then:

```bash
curl -X POST http://localhost:8000/api/v1/sessions/{id}/transformations/{tid}/decision \
  -H "Content-Type: application/json" \
  -d '{"approved": true}'
```

Repeat until `stage == "AWAITING_PIPELINE_CONFIRMATION"`.

### Step 4 — Review scorecard

```bash
curl http://localhost:8000/api/v1/sessions/{id}/scorecard
```

### Step 5 — Generate pipeline

```bash
curl -X POST http://localhost:8000/api/v1/sessions/{id}/pipeline/generate \
  -H "Content-Type: application/json" \
  -d '{
    "target_env": {
      "warehouse": "snowflake",
      "orchestrator": "airflow",
      "python_version": "3.11"
    }
  }'
```

### Step 6 — Download ZIP

```bash
curl -O http://localhost:8000/api/v1/sessions/{id}/pipeline/download
```

---

## Output Package Structure

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

## Project Structure

```
ai-dq-accelerator/
├── dq_tools/                # Core DQ library (DuckDB-backed)
│   ├── profiler.py
│   ├── rule_engine.py
│   ├── anomaly_detector.py
│   ├── transformation_executor.py
│   ├── pipeline_generator.py
│   └── scorecard.py
├── dq_tools_runtime/        # Lightweight Airflow runtime
│   └── nodes.py             # CustomCodeTransform
├── backend/
│   ├── api/                 # FastAPI application
│   │   ├── main.py
│   │   ├── schemas.py
│   │   └── routers/
│   ├── temporal/            # Temporal workflow + activities + worker
│   │   ├── workflows/
│   │   ├── activities/
│   │   └── worker.py
│   └── agents/              # LangGraph graphs
│       ├── graphs/
│       ├── state.py
│       └── prompts.py
├── templates/               # Jinja2 templates
│   ├── dbt/
│   └── airflow/
├── data/sessions/           # Session working data (gitignored)
├── output/sessions/         # Generated pipelines (gitignored)
├── docker-compose.yml
└── pyproject.toml
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Required. Claude API key |
| `TEMPORAL_HOST` | `localhost:7233` | Temporal server address |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `DATA_DIR` | `./data` | Session working data directory |
| `OUTPUT_DIR` | `./output` | Pipeline output directory |

---

## Workflow Stages

| Stage | Description |
|-------|-------------|
| `LOADING` | File upload + DuckDB ingest |
| `PROFILING` | Statistical profiling + AI analysis |
| `AWAITING_RULE_APPROVAL` | Waiting for human to approve rules |
| `VALIDATING` | Rule execution + anomaly detection + AI prioritization |
| `TRANSFORMATION_LOOP` | Iterative suggest → preview → decide cycle |
| `AWAITING_PIPELINE_CONFIRMATION` | Scorecard ready, waiting for pipeline config |
| `GENERATING` | Pipeline artifact generation + ZIP |
| `COMPLETE` | Done |
