from typing import TypedDict


class ProfileAnalyzerState(TypedDict):
    # Inputs — session_id is the key; large data lives on disk, not in state
    session_id: str
    use_case: str
    target_column: str | None
    description: str | None
    # Phase 1: overview
    overview_notes: str
    columns_to_investigate: list[dict]      # [{column, reason}, ...]
    # Phase 2: investigation
    investigation_findings: str             # running notes from tool-calling loop
    # Phase 2b: cross-column analysis findings (extracted by propose_rules_node)
    cross_column_findings: list[dict]       # [{cat_col, time_col, finding, severity}, ...]
    # Phase 2c: structured findings extraction
    exploration_findings: dict              # ExplorationFindings JSON
    exploration_notebook_path: str          # absolute path to generated .ipynb
    investigation_feedback: str | None      # user's free-form feedback message
    investigation_round: int                # 0 = first pass, 1-2 = re-investigation rounds
    # Phase 3: synthesize
    data_passport: str                      # structured "what this data is"
    # Phase 4: rules (final outputs)
    ai_summary: str
    suggested_rules: list[dict]
    top_issues: list[str]
    # Phase 4b: rule review (pre-approval contradiction resolution)
    rule_revision_log: list[dict]           # [{rule_ids, conflict_type, description, resolution, original_rules}]


class ValidationAnalyzerState(TypedDict):
    session_id: str
    validation_results: dict   # from rule_engine.run_rules
    anomaly_report: dict       # from anomaly_detector.detect
    profile: dict
    use_case: str
    # Outputs
    validation_summary: str
    anomaly_summary: str
    transformation_queue: list[dict]  # ordered list of suggested transformations


class TransformationAdvisorState(TypedDict):
    session_id: str
    remaining_failures: list[dict]   # per_rule results with failures
    anomaly_report: dict
    transformation_log: list[dict]   # already applied
    current_score: float
    use_case: str
    profile: dict
    # Outputs
    done: bool
    suggestion: dict | None          # TransformationSpec
    custom_code: str | None
    custom_code_valid: bool
    custom_code_error: str | None    # error message from last validation attempt
    custom_code_attempts: int        # number of generation/validation attempts so far
    prebuilt_error: str | None       # error message from last prebuilt param validation
    prebuilt_attempts: int           # number of prebuilt validation attempts so far


class TriageAgentState(TypedDict):
    session_id: str
    failing_rules: list[dict]   # per_rule entries where passed=False
    use_case: str
    # Outputs
    classifications: list[dict]
    summary: dict               # {transform_fixable, threshold_too_strict, unfixable, eval_error}
    contradictions: list[dict]  # [{rule_ids, conflict_type, description, suggested_fix}]


class ScorecardNarratorState(TypedDict):
    session_id: str
    scorecard: dict
    transformation_log: list[dict]
    baseline_score: float
    use_case: str
    # Output
    narrative: str
