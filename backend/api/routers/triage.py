"""Triage endpoints — get classification result and submit amendments."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from temporalio.service import RPCError, RPCStatusCode

from backend.api.schemas import (
    TriageApprovalRequest,
    TriageApprovalResponse,
    TriageResult,
)
from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow

router = APIRouter()


@router.get("/sessions/{session_id}/triage", response_model=TriageResult)
async def get_triage_result(session_id: str, request: Request):
    """Return the triage agent's classification of each failing rule."""
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        raw = await handle.query(DQAcceleratorWorkflow.get_triage_result)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return TriageResult(
        classifications=raw.get("classifications", []),
        summary=raw.get("summary", {}),
    )


@router.post("/sessions/{session_id}/triage/approve", response_model=TriageApprovalResponse)
async def approve_triage(
    session_id: str,
    body: TriageApprovalRequest,
    request: Request,
):
    """Submit engineer-approved rule amendments. Triggers re-validation and starts transform loop."""
    client = request.app.state.temporal_client

    amendments = {
        "accepted_threshold_changes": body.accepted_threshold_changes,
        "rejected_rule_ids": body.rejected_rule_ids,
    }

    try:
        handle = client.get_workflow_handle(session_id)
        await handle.signal(DQAcceleratorWorkflow.approve_triage, amendments)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return TriageApprovalResponse(
        accepted=True,
        message="Triage approved. Re-validating with amended rules.",
        rules_amended=len(body.accepted_threshold_changes),
        rules_removed=len(body.rejected_rule_ids),
    )
