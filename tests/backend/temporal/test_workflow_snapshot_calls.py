"""Verifies the workflow source contains a _snapshot call for each UI stage."""
import inspect
from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow

EXPECTED_STAGES = {
    "profile", "explore", "rules", "validate",
    "triage", "plan", "transform", "scorecard", "pipeline",
}

def test_workflow_calls_snapshot_for_every_ui_stage():
    src = inspect.getsource(DQAcceleratorWorkflow)
    for stage in EXPECTED_STAGES:
        assert f'self._snapshot("{stage}"' in src, f"missing _snapshot('{stage}') in workflow"
