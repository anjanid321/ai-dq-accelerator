#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── colours ──────────────────────────────────────────────────────────────────
CYAN=$(printf '\033[0;36m')
GREEN=$(printf '\033[0;32m')
YELLOW=$(printf '\033[0;33m')
RED=$(printf '\033[0;31m')
BOLD=$(printf '\033[1m')
RESET=$(printf '\033[0m')

echo ""
echo "${BOLD}DQ Accelerator — starting local dev stack${RESET}"
echo ""
echo "  ${CYAN}Backend API${RESET}    →  http://localhost:8000"
echo "  ${CYAN}API Docs${RESET}       →  http://localhost:8000/docs"
echo "  ${YELLOW}Temporal UI${RESET}    →  http://localhost:8088"
echo "  ${GREEN}Frontend${RESET}       →  http://localhost:3000"
echo ""

# ── venv ──────────────────────────────────────────────────────────────────────
VENV="$ROOT/.venv"
if [ ! -f "$VENV/bin/python" ]; then
  echo "${RED}ERROR:${RESET} .venv not found at $VENV"
  echo "Run: pip install -e '.[dev]' inside a virtualenv first."
  exit 1
fi
PYTHON="$VENV/bin/python"
UVICORN="$VENV/bin/uvicorn"

# ── docker infra ──────────────────────────────────────────────────────────────
echo "${BOLD}Starting infrastructure (PostgreSQL + Temporal)...${RESET}"
docker compose -f "$ROOT/docker-compose.yml" up -d postgresql temporal temporal-ui

echo "Waiting for Temporal to be ready on :7233 ..."
for i in $(seq 1 60); do
  if nc -z localhost 7233 2>/dev/null; then
    echo "${GREEN}Temporal is up.${RESET}"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "${RED}ERROR:${RESET} Temporal did not become ready after 60 seconds. Is Docker running?"
    exit 1
  fi
  sleep 1
done

echo ""
echo "Press ${BOLD}Ctrl+C${RESET} to stop all processes."
echo ""

# ── per-process log prefix helpers ───────────────────────────────────────────
API_PFX="${CYAN}[api]${RESET}     "
WRK_PFX="${YELLOW}[worker]${RESET}  "
FE_PFX="${GREEN}[frontend]${RESET} "

prefix() { awk -v p="$1" '{ print p $0; fflush() }'; }

# ── cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "${BOLD}Stopping app processes...${RESET}"
  kill "$API_PID" "$WORKER_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$API_PID" "$WORKER_PID" "$FRONTEND_PID" 2>/dev/null || true
  echo "Done. (Docker infra left running — stop with: docker compose down)"
}
trap cleanup EXIT INT TERM

# ── FastAPI ───────────────────────────────────────────────────────────────────
cd "$ROOT"
echo "${CYAN}[api]${RESET}     Starting FastAPI on :8000 ..."
"$UVICORN" backend.api.main:app --reload --port 8000 2>&1 | prefix "$API_PFX" &
API_PID=$!

# ── Temporal worker ───────────────────────────────────────────────────────────
echo "${YELLOW}[worker]${RESET}  Starting Temporal worker ..."
"$PYTHON" -m backend.temporal.worker 2>&1 | prefix "$WRK_PFX" &
WORKER_PID=$!

# ── Next.js frontend ──────────────────────────────────────────────────────────
echo "${GREEN}[frontend]${RESET} Starting Next.js on :3000 ..."
cd "$ROOT/frontend"
npm run dev 2>&1 | prefix "$FE_PFX" &
FRONTEND_PID=$!

# ── wait ──────────────────────────────────────────────────────────────────────
wait "$API_PID" "$WORKER_PID" "$FRONTEND_PID"
