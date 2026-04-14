# backend/api/routers/exploration.py
"""Exploration notebook endpoints — review step between investigation and rule proposal."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from temporalio.service import RPCError, RPCStatusCode

from backend.api.schemas import (
    ExplorationStateResponse,
    InvestigationFeedbackRequest,
    InvestigationFeedbackResponse,
)
from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow

router = APIRouter()


@router.get("/sessions/{session_id}/exploration", response_model=ExplorationStateResponse)
async def get_exploration_state(session_id: str, request: Request):
    """Return current exploration findings and notebook availability."""
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        state = await handle.query(DQAcceleratorWorkflow.get_exploration)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))

    notebook_path = state.get("notebook_path", "")
    notebook_ready = bool(notebook_path and Path(notebook_path).exists())

    return ExplorationStateResponse(
        exploration_findings=state.get("exploration_findings", {}),
        open_questions=state.get("open_questions", []),
        investigation_round=state.get("investigation_round", 0),
        notebook_ready=notebook_ready,
        synthesis_constrained=state.get("synthesis_constrained", False),
        synthesis_constraint_reasons=state.get("synthesis_constraint_reasons", []),
    )


@router.get("/sessions/{session_id}/exploration/notebook")
async def get_exploration_notebook_html(session_id: str, request: Request):
    """Serve the pre-executed exploration notebook as browser-viewable HTML."""
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        state = await handle.query(DQAcceleratorWorkflow.get_exploration)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))

    notebook_path = state.get("notebook_path", "")
    if not notebook_path:
        raise HTTPException(status_code=404, detail="Notebook not yet generated")

    html_path = Path(notebook_path).with_suffix(".html")
    if not html_path.exists():
        raise HTTPException(status_code=404, detail="Notebook HTML not found on disk")

    return HTMLResponse(content=html_path.read_text(encoding="utf-8"))


@router.get("/sessions/{session_id}/exploration/notebook/download")
async def download_exploration_notebook(session_id: str, request: Request):
    """Download the .ipynb source file for local Jupyter use."""
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        state = await handle.query(DQAcceleratorWorkflow.get_exploration)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))

    notebook_path = state.get("notebook_path", "")
    if not notebook_path or not Path(notebook_path).exists():
        raise HTTPException(status_code=404, detail="Notebook .ipynb not found")

    return FileResponse(
        path=notebook_path,
        media_type="application/octet-stream",
        filename=f"exploration_{session_id[:8]}.ipynb",
    )


@router.post(
    "/sessions/{session_id}/exploration/feedback",
    response_model=InvestigationFeedbackResponse,
)
async def submit_investigation_feedback(
    session_id: str,
    body: InvestigationFeedbackRequest,
    request: Request,
):
    """Submit user feedback on the exploration notebook.

    Set approve=True to proceed to synthesis. Set approve=False with a message
    to trigger a targeted re-investigation round (max 2 rounds total).
    """
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        await handle.signal(
            DQAcceleratorWorkflow.submit_investigation_feedback,
            {"message": body.message, "approve": body.approve},
        )
        state = await handle.query(DQAcceleratorWorkflow.get_exploration)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))

    verb = "approved" if body.approve else "submitted for re-investigation"
    return InvestigationFeedbackResponse(
        accepted=True,
        message=f"Feedback {verb}.",
        investigation_round=state.get("investigation_round", 0),
    )
