"""Pipeline generation and download endpoints."""

from __future__ import annotations

import asyncio
import os
import shutil
from functools import partial
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


def _expected_zip_path(session_id: str) -> Path:
    return _project_root() / OUTPUT_DIR / "sessions" / f"{session_id}.zip"


def _generate_pipeline_sync(session_id: str, target_env: dict, approved_rules: list) -> str:
    """Run pipeline generation synchronously — used as Temporal fallback."""
    from dq_tools.pipeline_generator import generate
    from dq_tools.transformation_executor import load_transformation_log

    transformation_log = load_transformation_log(session_id)
    output_dir = generate(
        session_id=session_id,
        transformation_log=transformation_log,
        approved_rules=approved_rules,
        target_env=target_env,
    )
    zip_path = shutil.make_archive(
        str(Path(output_dir)),
        "zip",
        str(Path(output_dir).parent),
        Path(output_dir).name,
    )
    return zip_path


def _load_approved_rules(session_id: str) -> list:
    """Load approved rules from disk (fallback when workflow is gone)."""
    try:
        from dq_tools.rule_engine import load_approved_rules

        return load_approved_rules(session_id)
    except Exception:
        return []


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
    """Confirm pipeline generation with target environment config.

    If the Temporal workflow is no longer running (e.g. it was killed after a
    worker restart), falls back to generating the pipeline artifacts directly
    from data already on disk, then returns the same accepted response so the
    frontend can poll for COMPLETE / download.
    """
    client = request.app.state.temporal_client
    target_env_dict = body.target_env.model_dump()

    # --- Try Temporal signal first ---
    try:
        handle = client.get_workflow_handle(session_id)
        await handle.signal(
            DQAcceleratorWorkflow.confirm_pipeline,
            target_env_dict,
        )
        return PipelineGenerateResponse(
            accepted=True,
            message="Pipeline generation started. Poll GET /sessions/{id} for completion.",
            session_id=session_id,
        )
    except RPCError as e:
        if e.status != RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=500, detail=str(e))
        # Workflow gone — fall through to direct generation below
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # --- Fallback: generate directly from disk ---
    # Check session data exists before attempting generation
    session_db = _project_root() / "data" / "sessions" / session_id / "working.duckdb"
    if not session_db.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Session '{session_id}' not found — workflow is gone and no session data on disk.",
        )

    approved_rules = _load_approved_rules(session_id)
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(
            None,
            partial(_generate_pipeline_sync, session_id, target_env_dict, approved_rules),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Direct pipeline generation failed: {e}")

    return PipelineGenerateResponse(
        accepted=True,
        message="Pipeline generated directly (workflow was no longer running). Ready to download.",
        session_id=session_id,
    )


@router.get("/sessions/{session_id}/pipeline/download")
async def download_pipeline(session_id: str, request: Request):
    """Download the generated pipeline ZIP once generation is complete.

    Checks disk first — if the ZIP already exists it is served immediately
    without querying Temporal.  This means the download keeps working even
    after the Temporal workflow has closed.
    """
    # --- Fast path: ZIP already on disk ---
    zip_file = _expected_zip_path(session_id)
    if zip_file.exists():
        return FileResponse(
            path=str(zip_file),
            media_type="application/zip",
            filename=f"dq_pipeline_{session_id[:8]}.zip",
        )

    # --- Slow path: ask Temporal for status / zip_path ---
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        full_state = await handle.query(DQAcceleratorWorkflow.get_full_state)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(
                status_code=404,
                detail="Pipeline ZIP not found on disk and session workflow is no longer running. "
                "Try clicking 'Generate Pipeline' again to regenerate.",
            )
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    stage = full_state.get("stage", "")
    if stage not in ("COMPLETE", "GENERATING"):
        raise HTTPException(
            status_code=409,
            detail=f"Pipeline not yet generated. Current stage: {stage}",
        )

    zip_path = full_state.get("zip_path") or str(_expected_zip_path(session_id))
    zip_file = Path(zip_path)
    if not zip_file.exists():
        raise HTTPException(
            status_code=404,
            detail="Pipeline ZIP not found. Generation may still be in progress.",
        )

    return FileResponse(
        path=str(zip_file),
        media_type="application/zip",
        filename=f"dq_pipeline_{session_id[:8]}.zip",
    )
