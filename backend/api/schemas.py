"""Pydantic models for all API I/O."""
from __future__ import annotations

from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


# ── Enums ─────────────────────────────────────────────────────────────────────

class WorkflowStage(str, Enum):
    LOADING = "LOADING"
    PROFILING = "PROFILING"
    AWAITING_RULE_APPROVAL = "AWAITING_RULE_APPROVAL"
    VALIDATING = "VALIDATING"
    TRIAGING = "TRIAGING"
    AWAITING_TRIAGE_APPROVAL = "AWAITING_TRIAGE_APPROVAL"
    PLANNING = "PLANNING"
    AWAITING_PLAN_APPROVAL = "AWAITING_PLAN_APPROVAL"
    TRANSFORMATION_LOOP = "TRANSFORMATION_LOOP"
    AWAITING_HUMAN_INPUT = "AWAITING_HUMAN_INPUT"
    AWAITING_PIPELINE_CONFIRMATION = "AWAITING_PIPELINE_CONFIRMATION"
    GENERATING = "GENERATING"
    COMPLETE = "COMPLETE"


class Warehouse(str, Enum):
    snowflake = "snowflake"
    postgres = "postgres"
    bigquery = "bigquery"
    duckdb = "duckdb"


class Orchestrator(str, Enum):
    airflow = "airflow"


# ── Shared sub-models ─────────────────────────────────────────────────────────

class TargetEnv(BaseModel):
    warehouse: Warehouse = Warehouse.duckdb
    orchestrator: Orchestrator = Orchestrator.airflow
    python_version: str = "3.11"
    slack_channel: str | None = None
    schedule: str = "@daily"


class Rule(BaseModel):
    id: str
    category: str  # validity | completeness | uniqueness
    column: str | None = None
    check: str
    pattern: str | None = None
    values: list[Any] | None = None
    min: float | None = None
    max: float | None = None
    format: str | None = None
    col_a: str | None = None
    col_b: str | None = None
    threshold: float = 0.0
    rationale: str | None = None
    modified: bool = False
    sodacl: str | None = None  # SodaCL check block; user-editable at approval time

    model_config = {"extra": "allow"}


class TriageClassification(BaseModel):
    rule_id: str
    check: str | None = None
    column: str | None = None
    classification: str          # transform_fixable | threshold_too_strict | unfixable | eval_error
    proposed_threshold: float | None = None
    proposed_remove: bool = False
    reason: str = ""
    confidence: str = "low"      # high | medium | low

    model_config = {"extra": "allow"}


class TriageResult(BaseModel):
    classifications: list[TriageClassification] = []
    summary: dict = {}           # {transform_fixable, threshold_too_strict, unfixable, eval_error}


class TriageApprovalRequest(BaseModel):
    accepted_threshold_changes: list[dict] = []  # [{rule_id, new_threshold}]
    rejected_rule_ids: list[str] = []            # rule IDs to remove from approved_rules


class TriageApprovalResponse(BaseModel):
    accepted: bool
    message: str = "Triage approved. Re-validating with amended rules."
    rules_amended: int = 0
    rules_removed: int = 0


class TransformPlanStep(BaseModel):
    id: str
    type: str
    column: str | None = None
    params: dict = {}
    custom_code: str | None = None
    rationale: str = ""
    targets_rules: list[str] = []
    depends_on: list[str] = []
    conflicts_with: list[str] = []
    projected_score_delta: float = 0.0
    needs_review: bool = False
    status: str = "pending"   # pending | applied | skipped | failed
    actual_score_delta: float | None = None
    intent: str | None = None
    target_columns: list[str] | None = None
    approach: str | None = None

    model_config = {"extra": "allow"}


class TransformPlan(BaseModel):
    steps: list[TransformPlanStep] = []
    summary: str = ""
    projected_final_score: float = 0.0


class PlanApprovalRequest(BaseModel):
    steps: list[dict]   # full TransformPlanStep dicts; validated loosely to allow frontend edits


class PlanApprovalResponse(BaseModel):
    accepted: bool
    message: str = "Plan approved. Execution starting."
    steps_count: int = 0


class EscalationResolveRequest(BaseModel):
    action: str    # continue_anyway | abort_plan | skip_step | provide_instruction
    instruction: str | None = None


class EscalationResolveResponse(BaseModel):
    accepted: bool
    message: str = "Escalation resolved."


class TransformationPreview(BaseModel):
    before_sample: list[dict] = []
    after_sample: list[dict] = []
    affected_row_count: int = 0
    projected_score_delta: float | None = None
    projected_score: float | None = None
    error: str | None = None          # surfaces preview() runtime errors to client


class TransformationLogEntry(BaseModel):
    id: str
    type: str
    params: dict = {}
    affected_rows: int = 0
    score_delta: float = 0.0
    status: str  # applied | rejected
    custom_code: str | None = None
    rationale: str = ""
    regressions: list = []

    model_config = {"extra": "allow"}


class CurrentSuggestion(BaseModel):
    transformation_id: str
    type: str
    params: dict = {}
    rationale: str = ""
    custom_code: str | None = None
    preview: TransformationPreview | None = None


# ── POST /sessions ─────────────────────────────────────────────────────────────

class CreateSessionResponse(BaseModel):
    session_id: str
    workflow_id: str
    stage: WorkflowStage
    row_count: int = 0
    col_count: int = 0
    message: str = "Session created. Profiling in progress."


# ── GET /sessions/{id} ────────────────────────────────────────────────────────

class SessionStateResponse(BaseModel):
    session_id: str
    stage: WorkflowStage
    # Profile stage
    profile: dict = {}
    ai_summary: str = ""
    suggested_rules: list[dict] = []
    # Post-validation
    baseline_quality_score: float = 0.0
    current_score: float = 0.0
    validation_summary: str = ""
    anomaly_summary: str = ""
    # Transformation loop
    current_suggestion: CurrentSuggestion | None = None
    transformation_log: list[TransformationLogEntry] = []
    # Scorecard
    scorecard: dict = {}
    narrative: str = ""
    # Triage
    triage_result: dict = {}
    # Validation results
    validation_results: dict = {}
    # Transform plan
    transform_plan: dict | None = None
    execution_escalation: dict | None = None
    # Pipeline
    output_dir: str = ""
    zip_path: str = ""


# ── POST /sessions/{id}/rules/approve ─────────────────────────────────────────

class RuleApprovalRequest(BaseModel):
    approved_rules: list[Rule]
    rejected_rule_ids: list[str] = []


class RuleApprovalResponse(BaseModel):
    accepted: bool
    message: str = "Rules approved. Validation starting."


# ── GET /sessions/{id}/transformations/next ───────────────────────────────────

class NextTransformationResponse(BaseModel):
    stage: WorkflowStage
    current_score: float
    current_suggestion: CurrentSuggestion | None = None
    transformation_log: list[TransformationLogEntry] = []


# ── POST /sessions/{id}/transformations/{tid}/decision ───────────────────────

class TransformationDecisionRequest(BaseModel):
    approved: bool
    modification: dict | None = None


class TransformationDecisionResponse(BaseModel):
    accepted: bool
    transformation_id: str
    applied: bool
    updated_score: float | None = None
    score_delta: float | None = None
    rows_modified: int | None = None
    transformation_log: list[TransformationLogEntry] = []


# ── GET /sessions/{id}/scorecard ─────────────────────────────────────────────

class ScorecardResponse(BaseModel):
    stage: WorkflowStage
    baseline_score: float
    final_score: float
    delta: float
    original_rows: int = 0
    final_rows: int = 0
    rows_removed: int = 0
    rows_modified: int = 0
    rules_passing: int = 0
    rules_total: int = 0
    narrative: str = ""
    transformation_log: list[TransformationLogEntry] = []


# ── POST /sessions/{id}/pipeline/generate ────────────────────────────────────

class PipelineGenerateRequest(BaseModel):
    target_env: TargetEnv = Field(default_factory=TargetEnv)


class PipelineGenerateResponse(BaseModel):
    accepted: bool
    message: str = "Pipeline generation started."
    session_id: str
