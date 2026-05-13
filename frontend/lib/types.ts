export type WorkflowStage =
  | 'LOADING' | 'PROFILING'
  | 'AWAITING_INVESTIGATION_REVIEW' | 'REINVESTIGATING' | 'PROFILING_SYNTHESIS'
  | 'RULE_REVIEW'
  | 'AWAITING_RULE_APPROVAL'
  | 'VALIDATING' | 'TRIAGING' | 'AWAITING_TRIAGE_APPROVAL'
  | 'PLANNING' | 'AWAITING_PLAN_APPROVAL'
  | 'TRANSFORMATION_LOOP' | 'AWAITING_HUMAN_INPUT'
  | 'AWAITING_PIPELINE_CONFIRMATION' | 'GENERATING' | 'COMPLETE'

export interface Rule {
  id: string
  category: string
  column?: string
  check: string
  pattern?: string
  values?: unknown[]
  min?: number
  max?: number
  format?: string
  col_a?: string
  col_b?: string
  threshold: number
  rationale?: string
  modified: boolean
  sodacl?: string
}

export interface TransformationPreview {
  before_sample: Record<string, unknown>[]
  after_sample: Record<string, unknown>[]
  affected_row_count: number
  projected_score_delta?: number
  projected_score?: number
}

export interface CurrentSuggestion {
  transformation_id: string
  type: string
  params: Record<string, unknown>
  rationale: string
  custom_code?: string
  preview?: TransformationPreview
}

export interface PostStepRuleResult {
  id: string
  category: string
  check: string
  column?: string
  passed: boolean
  failure_count: number
  failure_rate: number
  rationale?: string
  error?: string
}

export interface TransformationLogEntry {
  id: string
  type: string
  params: Record<string, unknown>
  affected_rows: number
  score_delta: number
  status: 'applied' | 'rejected' | 'no_effect'
  custom_code?: string
  rationale?: string
  regressions?: unknown[]
  post_step_per_rule?: PostStepRuleResult[]
}

export interface PerRuleResult {
  id: string
  category: string
  check: string
  column?: string
  passed: boolean
  failure_count: number
  failure_rate: number
  sample_failing_rows: Record<string, unknown>[]
  rationale?: string
  error?: string
}

export interface ValidationResults {
  per_rule: PerRuleResult[]
  category_scores: Record<string, number>
  baseline_quality_score: number
}

export interface TriageClassification {
  rule_id: string
  check?: string
  column?: string
  classification: 'transform_fixable' | 'threshold_too_strict' | 'unfixable' | 'eval_error'
  proposed_threshold?: number
  proposed_remove: boolean
  reason: string
  confidence: 'high' | 'medium' | 'low'
}

export interface TriageResult {
  classifications: TriageClassification[]
  summary: { transform_fixable: number; threshold_too_strict: number; unfixable: number; eval_error: number }
}

export interface TransformPlanStep {
  id: string
  type: string
  column?: string
  params: Record<string, unknown>
  custom_code?: string
  rationale: string
  targets_rules: string[]
  depends_on: string[]
  conflicts_with: string[]
  projected_score_delta: number
  needs_review: boolean
  status: 'pending' | 'applied' | 'skipped' | 'failed'
  actual_score_delta?: number
  intent?: string
  target_columns?: string[]
  approach?: string
  before_sample?: Record<string, unknown>[]
  after_sample?: Record<string, unknown>[]
  affected_row_count?: number
}

export interface TransformPlan {
  steps: TransformPlanStep[]
  summary: string
  projected_final_score: number
}

export interface ExecutionEscalation {
  type: 'regression' | 'divergence' | 'step_failed' | 'code_generation_failed' | 'transform_verification_failed'
  step_id: string
  description: string
  context: Record<string, unknown>
}

export interface SessionState {
  session_id: string
  stage: WorkflowStage
  profile: Record<string, unknown>
  ai_summary: string
  suggested_rules: Rule[]
  baseline_quality_score: number
  current_score: number
  validation_summary: string
  anomaly_summary: string
  current_suggestion?: CurrentSuggestion
  transformation_log: TransformationLogEntry[]
  validation_results?: ValidationResults
  triage_result?: TriageResult
  transform_plan?: TransformPlan
  execution_escalation?: ExecutionEscalation
  scorecard: Record<string, unknown>
  narrative: string
  output_dir: string
  zip_path: string
}

export interface ScorecardResponse {
  stage: WorkflowStage
  baseline_score: number
  final_score: number
  delta: number
  original_rows: number
  final_rows: number
  rows_removed: number
  rows_modified: number
  rules_passing: number
  rules_total: number
  narrative: string
  transformation_log: TransformationLogEntry[]
}

export interface CreateSessionResponse {
  session_id: string
  workflow_id: string
  stage: WorkflowStage
  row_count: number
  col_count: number
  message: string
}

export interface TargetEnv {
  warehouse: 'snowflake' | 'postgres' | 'bigquery' | 'duckdb'
  orchestrator: 'airflow'
  python_version: string
  slack_channel?: string
  schedule: string
}

export interface SessionListEntry {
  id: string
  filename: string
  stage: WorkflowStage
  current_score: number
  baseline_score: number
  created_at: string
  updated_at: string
}

export interface StageSnapshot<T = Record<string, unknown>> {
  stage: string
  payload: T
  created_at: string
}
