"""Plan approval and execution escalation endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from temporalio.service import RPCError, RPCStatusCode

from backend.api.schemas import (
    PlanApprovalRequest,
    PlanApprovalResponse,
    EscalationResolveRequest,
    EscalationResolveResponse,
)

router = APIRouter()


@router.post("/sessions/{session_id}/plan/approve", response_model=PlanApprovalResponse)
async def approve_plan(session_id: str, body: PlanApprovalRequest, request: Request):
    """Submit engineer-approved (optionally edited) transform plan. Starts execution."""
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        await handle.signal("approve_plan", {"steps": body.steps})
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return PlanApprovalResponse(
        accepted=True,
        message="Plan approved. Execution starting.",
        steps_count=len(body.steps),
    )


@router.post("/sessions/{session_id}/execution/resolve", response_model=EscalationResolveResponse)
async def resolve_escalation(session_id: str, body: EscalationResolveRequest, request: Request):
    """Resolve a mid-execution escalation."""
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        await handle.signal(
            "resolve_escalation",
            {"action": body.action, "instruction": body.instruction},
        )
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return EscalationResolveResponse(accepted=True, message="Escalation resolved.")
