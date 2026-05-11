"""POST /sessions and GET /sessions/{id}."""
from __future__ import annotations

import json
import os
import shutil
import uuid as _uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from temporalio.service import RPCError, RPCStatusCode

from backend.api.schemas import (
    CreateSessionResponse,
    SessionStateResponse,
    SessionListItem,
    StageSnapshotResponse,
    WorkflowStage,
    CurrentSuggestion,
    TransformationPreview,
    TransformationLogEntry,
)
from backend.db.engine import get_sessionmaker
from backend.db.repository import insert_session, list_active_sessions, delete_session as db_delete_session
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

    session_uuid = _uuid.uuid4()
    session_id = str(session_uuid)
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
        transform_plan=state.get("transform_plan"),
        execution_escalation=state.get("execution_escalation"),
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
async def stream_investigation_progress(session_id: str, request: Request):
    """Server-Sent Events stream of investigation progress.

    Connect once; receives all past events immediately then live events as they
    are written.  The stream ends when a ``done`` event is received.

    Supports Last-Event-ID for reconnects — the browser sends the ID of the last
    event it received and the stream resumes from the next one, preventing replay.
    """
    import asyncio

    project_root = _project_root()
    progress_path = project_root / "data" / "sessions" / session_id / "investigation_progress.jsonl"

    # Resume from after the last event the client already received
    last_event_id = request.headers.get("last-event-id", "")
    initial_seen = int(last_event_id) + 1 if last_event_id.lstrip("-").isdigit() else 0

    async def event_generator():
        seen = max(0, initial_seen)
        max_wait = 600  # give up after 10 minutes with no activity
        idle = 0
        last_send = 0.0
        POST_DONE_TIMEOUT = 30  # seconds to wait after a "done" before closing
        post_done_idle = 0

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
                post_done_idle = 0  # new events arrived — reset the post-done window
                for line in new_lines:
                    line = line.strip()
                    if not line:
                        continue
                    yield f"id: {seen}\ndata: {line}\n\n"
                    seen += 1
                    try:
                        evt = json.loads(line)
                        if evt.get("event") == "done":
                            post_done_idle = 0.001  # mark "seen done", start waiting
                            # Don't return — more stages may follow.
                    except json.JSONDecodeError:
                        pass
            else:
                await asyncio.sleep(0.5)
                idle += 0.5
                last_send += 0.5
                if last_send >= 20:
                    yield ": heartbeat\n\n"
                    last_send = 0
                if post_done_idle > 0:
                    post_done_idle += 0.5
                    if post_done_idle >= POST_DONE_TIMEOUT:
                        return  # 30s of silence after a done — session is complete

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
