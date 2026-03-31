"""POST /sessions and GET /sessions/{id}."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from temporalio.service import RPCError, RPCStatusCode

from backend.api.schemas import (
    CreateSessionResponse,
    SessionStateResponse,
    WorkflowStage,
    CurrentSuggestion,
    TransformationPreview,
    TransformationLogEntry,
)
from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow

router = APIRouter()

ALLOWED_EXTENSIONS = {".csv", ".parquet", ".json"}
DATA_DIR = Path(os.getenv("DATA_DIR", "data"))


def _project_root() -> Path:
    p = Path(__file__)
    while p != p.parent:
        if (p / "pyproject.toml").exists():
            return p
        p = p.parent
    return Path(".")


@router.post("/sessions", response_model=CreateSessionResponse)
async def create_session(
    request: Request,
    file: UploadFile = File(...),
    use_case: str = Form(""),
    target_column: str | None = Form(None),
    description: str | None = Form(None),
):
    """Upload a dataset and start a DQ Accelerator session."""
    # Validate file type
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Allowed: {ALLOWED_EXTENSIONS}",
        )

    session_id = str(uuid.uuid4())
    project_root = _project_root()
    session_dir = project_root / DATA_DIR / "sessions" / session_id / "raw"
    session_dir.mkdir(parents=True, exist_ok=True)

    # Save uploaded file
    file_path = session_dir / f"input{suffix}"
    async with aiofiles.open(file_path, "wb") as f:
        content = await file.read()
        await f.write(content)

    # Start Temporal workflow
    client = request.app.state.temporal_client
    task_queue = request.app.state.task_queue

    await client.start_workflow(
        DQAcceleratorWorkflow.run,
        {
            "session_id": session_id,
            "file_path": str(file_path),
            "file_ext": suffix.lstrip("."),
            "use_case": use_case,
            "target_column": target_column,
            "description": description,
        },
        id=session_id,
        task_queue=task_queue,
    )

    return CreateSessionResponse(
        session_id=session_id,
        workflow_id=session_id,
        stage=WorkflowStage.LOADING,
        message="Session created. Profiling in progress — poll GET /sessions/{id} for updates.",
    )


@router.get("/sessions/{session_id}", response_model=SessionStateResponse)
async def get_session(session_id: str, request: Request):
    """Get current state of a DQ session by querying the Temporal workflow."""
    client = request.app.state.temporal_client

    try:
        handle = client.get_workflow_handle(session_id)
        state = await handle.query(DQAcceleratorWorkflow.get_full_state)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Build current_suggestion from state
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
    )


@router.get("/sessions/{session_id}/investigation/progress")
async def get_investigation_progress(session_id: str, since: int = 0):
    """Return investigation progress events as a JSON array.

    ``since`` is a line offset — pass the length of the last response to poll
    for only new events, making this suitable for simple frontend polling.

    Each event has the shape:
      {ts, event, ...}
    where event is one of: tool_call | tool_result | thinking | done
    """
    project_root = _project_root()
    progress_path = project_root / "data" / "sessions" / session_id / "investigation_progress.jsonl"

    if not progress_path.exists():
        return {"events": [], "total": 0}

    lines = progress_path.read_text().splitlines()
    events = []
    for line in lines[since:]:
        line = line.strip()
        if line:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass

    return {"events": events, "total": len(lines)}


@router.get("/sessions/{session_id}/investigation/stream")
async def stream_investigation_progress(session_id: str):
    """Server-Sent Events stream of investigation progress.

    Connect once; receives all past events immediately then live events as they
    are written.  The stream ends when a ``done`` event is received.
    """
    import asyncio

    project_root = _project_root()
    progress_path = project_root / "data" / "sessions" / session_id / "investigation_progress.jsonl"

    async def event_generator():
        seen = 0
        max_wait = 600  # give up after 10 minutes with no activity
        idle = 0
        last_send = 0.0

        while idle < max_wait:
            if not progress_path.exists():
                await asyncio.sleep(1)
                idle += 1
                last_send += 1
                if last_send >= 20:
                    yield ": heartbeat\n\n"
                    last_send = 0
                continue

            lines = progress_path.read_text().splitlines()
            new_lines = lines[seen:]
            if new_lines:
                idle = 0
                last_send = 0
                for line in new_lines:
                    line = line.strip()
                    if not line:
                        continue
                    seen += 1
                    yield f"data: {line}\n\n"
                    try:
                        evt = json.loads(line)
                        if evt.get("event") == "done":
                            return
                    except json.JSONDecodeError:
                        pass
            else:
                await asyncio.sleep(0.5)
                idle += 0.5
                last_send += 0.5
                if last_send >= 20:
                    yield ": heartbeat\n\n"
                    last_send = 0

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
