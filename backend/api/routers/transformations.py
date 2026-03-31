"""Transformation endpoints — next suggestion and human decisions."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from temporalio.service import RPCError, RPCStatusCode

from backend.api.schemas import (
    CurrentSuggestion,
    NextTransformationResponse,
    TransformationDecisionRequest,
    TransformationDecisionResponse,
    TransformationLogEntry,
    TransformationPreview,
    WorkflowStage,
)
from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow

router = APIRouter()


@router.get(
    "/sessions/{session_id}/transformations/next",
    response_model=NextTransformationResponse,
)
async def get_next_transformation(session_id: str, request: Request):
    """Get the current transformation suggestion with its auto-generated preview."""
    client = request.app.state.temporal_client

    try:
        handle = client.get_workflow_handle(session_id)
        suggestion_state = await handle.query(DQAcceleratorWorkflow.get_current_suggestion)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Get stage too
    try:
        stage_str = await handle.query(DQAcceleratorWorkflow.get_stage)
        stage = WorkflowStage(stage_str)
    except Exception:
        stage = WorkflowStage.TRANSFORMATION_LOOP

    raw_suggestion = suggestion_state.get("suggestion")
    raw_preview = suggestion_state.get("preview")
    current_suggestion = None
    if raw_suggestion:
        preview = None
        if raw_preview:
            preview = TransformationPreview(**raw_preview)
        current_suggestion = CurrentSuggestion(
            transformation_id=raw_suggestion.get("id", ""),
            type=raw_suggestion.get("type", ""),
            params=raw_suggestion.get("params", {}),
            rationale=raw_suggestion.get("rationale", ""),
            custom_code=raw_suggestion.get("custom_code"),
            preview=preview,
        )

    transformation_log = [
        TransformationLogEntry(**e) for e in suggestion_state.get("transformation_log", [])
    ]

    return NextTransformationResponse(
        stage=stage,
        current_score=suggestion_state.get("current_score", 0.0),
        current_suggestion=current_suggestion,
        transformation_log=transformation_log,
    )


@router.post(
    "/sessions/{session_id}/transformations/{transformation_id}/decision",
    response_model=TransformationDecisionResponse,
)
async def decide_transformation(
    session_id: str,
    transformation_id: str,
    body: TransformationDecisionRequest,
    request: Request,
):
    """Approve or reject a transformation suggestion."""
    client = request.app.state.temporal_client

    try:
        handle = client.get_workflow_handle(session_id)
        await handle.signal(
            DQAcceleratorWorkflow.decide_transformation,
            args=[transformation_id, body.approved, body.modification],
        )
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return TransformationDecisionResponse(
        accepted=True,
        transformation_id=transformation_id,
        applied=body.approved,
        transformation_log=[],  # Client should poll GET /sessions/{id} for updated log
    )
