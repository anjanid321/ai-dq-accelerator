"""Pipeline generation and download endpoints."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from temporalio.service import RPCError, RPCStatusCode

from backend.api.schemas import (
    PipelineGenerateRequest,
    PipelineGenerateResponse,
    ScorecardResponse,
    TransformationLogEntry,
    WorkflowStage,
)
from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow

router = APIRouter()

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "output"))


def _project_root() -> Path:
    p = Path(__file__)
    while p != p.parent:
        if (p / "pyproject.toml").exists():
            return p
        p = p.parent
    return Path(".")


@router.get("/sessions/{session_id}/scorecard", response_model=ScorecardResponse)
async def get_scorecard(session_id: str, request: Request):
    """Get the full scorecard and narrative for the session."""
    client = request.app.state.temporal_client

    try:
        handle = client.get_workflow_handle(session_id)
        scorecard_state = await handle.query(DQAcceleratorWorkflow.get_scorecard)
        stage_str = await handle.query(DQAcceleratorWorkflow.get_stage)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    scorecard = scorecard_state.get("scorecard", {})
    baseline = scorecard_state.get("baseline_score", 0.0)
    current = scorecard_state.get("current_score", 0.0)

    # Extract transformation log from full state for the scorecard view
    try:
        full_state = await handle.query(DQAcceleratorWorkflow.get_full_state)
        transformation_log = [
            TransformationLogEntry(**e) for e in full_state.get("transformation_log", [])
        ]
    except Exception:
        transformation_log = []

    return ScorecardResponse(
        stage=WorkflowStage(stage_str),
        baseline_score=baseline,
        final_score=current,
        delta=round(current - baseline, 4),
        original_rows=scorecard.get("original_rows", 0),
        final_rows=scorecard.get("current_rows", 0),
        rows_removed=scorecard.get("rows_removed", 0),
        rows_modified=scorecard.get("rows_modified", 0),
        rules_passing=scorecard.get("rules_passing", 0),
        rules_total=scorecard.get("rules_total", 0),
        narrative=scorecard_state.get("narrative", ""),
        transformation_log=transformation_log,
    )


@router.post(
    "/sessions/{session_id}/pipeline/generate",
    response_model=PipelineGenerateResponse,
)
async def generate_pipeline(
    session_id: str,
    body: PipelineGenerateRequest,
    request: Request,
):
    """Confirm pipeline generation with target environment config."""
    client = request.app.state.temporal_client

    try:
        handle = client.get_workflow_handle(session_id)
        await handle.signal(
            DQAcceleratorWorkflow.confirm_pipeline,
            body.target_env.model_dump(),
        )
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return PipelineGenerateResponse(
        accepted=True,
        message="Pipeline generation started. Poll GET /sessions/{id} for completion.",
        session_id=session_id,
    )


@router.get("/sessions/{session_id}/pipeline/download")
async def download_pipeline(session_id: str, request: Request):
    """Download the generated pipeline ZIP once generation is complete."""
    client = request.app.state.temporal_client

    try:
        handle = client.get_workflow_handle(session_id)
        full_state = await handle.query(DQAcceleratorWorkflow.get_full_state)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    stage = full_state.get("stage", "")
    if stage not in ("COMPLETE", "GENERATING"):
        raise HTTPException(
            status_code=409,
            detail=f"Pipeline not yet generated. Current stage: {stage}",
        )

    zip_path = full_state.get("zip_path", "")
    if not zip_path:
        # Try to construct expected path
        project_root = _project_root()
        zip_path = str(project_root / OUTPUT_DIR / "sessions" / session_id) + ".zip"

    zip_file = Path(zip_path)
    if not zip_file.exists():
        raise HTTPException(status_code=404, detail="Pipeline ZIP not found. Generation may still be in progress.")

    return FileResponse(
        path=str(zip_file),
        media_type="application/zip",
        filename=f"dq_pipeline_{session_id[:8]}.zip",
    )
