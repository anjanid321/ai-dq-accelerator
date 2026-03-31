"""POST /sessions/{id}/rules/approve — send approve_rules signal to Temporal."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from temporalio.service import RPCError, RPCStatusCode

from backend.api.schemas import RuleApprovalRequest, RuleApprovalResponse
from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow

router = APIRouter()


@router.post("/sessions/{session_id}/rules/approve", response_model=RuleApprovalResponse)
async def approve_rules(
    session_id: str,
    body: RuleApprovalRequest,
    request: Request,
):
    """Approve (and optionally modify) the AI-proposed rules, rejecting others."""
    client = request.app.state.temporal_client

    # Filter out rejected rules
    rejected_ids = set(body.rejected_rule_ids)
    approved = [r.model_dump() for r in body.approved_rules if r.id not in rejected_ids]

    try:
        handle = client.get_workflow_handle(session_id)
        await handle.signal(DQAcceleratorWorkflow.approve_rules, approved)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return RuleApprovalResponse(
        accepted=True,
        message=f"Approved {len(approved)} rules. Validation and anomaly detection starting.",
    )
