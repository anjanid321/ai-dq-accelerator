"""DQAcceleratorWorkflow — main Temporal workflow for the DQ Accelerator."""
from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
import asyncio

# Import activities with sandbox-safe pattern
with workflow.unsafe.imports_passed_through():
    from backend.temporal.activities.data_activities import (
        load_dataset_activity,
        profile_and_analyze_activity,
        run_validation_activity,
        detect_anomalies_activity,
        analyze_and_prioritize_activity,
    )
    from backend.temporal.activities.transform_activities import (
        suggest_next_transformation_activity,
        preview_transformation_activity,
        apply_transformation_activity,
        update_scorecard_activity,
        generate_scorecard_summary_activity,
    )
    from backend.temporal.activities.pipeline_activities import (
        generate_pipeline_activity,
        export_working_dataset_activity,
        zip_output_activity,
    )
    from backend.temporal.activities.triage_activities import triage_rules_activity

ACTIVITY_RETRY = RetryPolicy(maximum_attempts=3, initial_interval=timedelta(seconds=2))
ACTIVITY_TIMEOUT = timedelta(minutes=10)
AI_ACTIVITY_TIMEOUT = timedelta(minutes=60)

@workflow.defn
class DQAcceleratorWorkflow:
    """Main DQ Accelerator workflow with human-in-the-loop signals."""

    def __init__(self):
        # Workflow state
        self.stage: str = "LOADING"
        self.session_id: str = ""
        self.use_case: str = ""
        self.target_column: str | None = None
        self.description: str | None = None

        # Profile and rules state
        self.profile: dict = {}
        self.ai_summary: str = ""
        self.suggested_rules: list = []
        self.approved_rules: list | None = None

        # Validation state
        self.validation_results: dict = {}
        self.anomaly_summary: dict = {}   # lightweight summary only; full report lives on disk
        self.validation_summary: str = ""
        self.anomaly_narrative: str = ""
        self.transformation_queue: list = []
        self.baseline_quality_score: float = 0.0

        # Transformation loop state
        self.current_suggestion: dict | None = None
        self.current_preview: dict | None = None
        self.transformation_decisions: dict = {}  # {tid: {approved, modification}}
        self.current_score: float = 0.0
        self.transformation_log: list = []
        self.consecutive_no_progress: int = 0  # applied transforms that fixed 0 new rules

        # Triage state
        self.triage_result: dict = {}
        self.triage_amendments: dict | None = None  # None until approve_triage signal received

        # Scorecard state
        self.scorecard: dict = {}
        self.narrative: str = ""

        # Pipeline state
        self.pipeline_config: dict | None = None
        self.output_dir: str = ""
        self.zip_path: str = ""

    # ── Signals ─────────────────────────────────────────────────────────────

    @workflow.signal
    def approve_rules(self, rules: list) -> None:
        self.approved_rules = rules

    @workflow.signal
    def decide_transformation(self, tid: str, approved: bool, modification: dict | None = None) -> None:
        self.transformation_decisions[tid] = {
            "approved": approved,
            "modification": modification,
        }

    @workflow.signal
    def approve_triage(self, amendments: dict) -> None:
        """amendments: {accepted_threshold_changes: [...], rejected_rule_ids: [...]}"""
        self.triage_amendments = amendments

    @workflow.signal
    def confirm_pipeline(self, config: dict) -> None:
        self.pipeline_config = config

    # ── Queries ─────────────────────────────────────────────────────────────

    @workflow.query
    def get_stage(self) -> str:
        return self.stage

    @workflow.query
    def get_profile(self) -> dict:
        return {
            "profile": self.profile,
            "ai_summary": self.ai_summary,
            "suggested_rules": self.suggested_rules,
        }

    @workflow.query
    def get_current_suggestion(self) -> dict:
        return {
            "suggestion": self.current_suggestion,
            "preview": self.current_preview,
            "current_score": self.current_score,
            "transformation_log": self.transformation_log,
        }

    @workflow.query
    def get_triage_result(self) -> dict:
        return self.triage_result

    @workflow.query
    def get_scorecard(self) -> dict:
        return {
            "scorecard": self.scorecard,
            "narrative": self.narrative,
            "baseline_score": self.baseline_quality_score,
            "current_score": self.current_score,
        }

    @workflow.query
    def get_full_state(self) -> dict:
        return {
            "stage": self.stage,
            "session_id": self.session_id,
            "profile": self.profile,
            "ai_summary": self.ai_summary,
            "suggested_rules": self.suggested_rules,
            "baseline_quality_score": self.baseline_quality_score,
            "validation_summary": self.validation_summary,
            "anomaly_summary": self.anomaly_narrative,
            "anomaly_counts": self.anomaly_summary,
            "triage_result": self.triage_result,
            "current_suggestion": self.current_suggestion,
            "current_preview": self.current_preview,
            "current_score": self.current_score,
            "transformation_log": self.transformation_log,
            "scorecard": self.scorecard,
            "narrative": self.narrative,
            "output_dir": self.output_dir,
            "zip_path": self.zip_path,
            "validation_results": {
                **self.validation_results,
                "per_rule": [
                    {**r, "sample_failing_rows": r.get("sample_failing_rows", [])[:5]}
                    for r in self.validation_results.get("per_rule", [])
                ],
            } if self.validation_results else {},
        }

    # ── Main workflow run ────────────────────────────────────────────────────

    @workflow.run
    async def run(self, params: dict) -> dict:
        self.session_id = params["session_id"]
        self.use_case = params.get("use_case", "")
        self.target_column = params.get("target_column")
        self.description = params.get("description")

        # ── Stage: LOADING ─────────────────────────────────────────────────
        self.stage = "LOADING"
        await workflow.execute_activity(
            load_dataset_activity,
            {"session_id": self.session_id, "file_path": params["file_path"], "file_ext": params["file_ext"]},
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )

        # ── Stage: PROFILING ───────────────────────────────────────────────
        self.stage = "PROFILING"
        profile_result = await workflow.execute_activity(
            profile_and_analyze_activity,
            {
                "session_id": self.session_id,
                "use_case": self.use_case,
                "target_column": self.target_column,
                "description": self.description,
            },
            start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        self.profile = profile_result["profile"]
        self.ai_summary = profile_result["ai_summary"]
        self.suggested_rules = profile_result["suggested_rules"]

        # ── Stage: AWAITING_RULE_APPROVAL ──────────────────────────────────
        self.stage = "AWAITING_RULE_APPROVAL"
        await workflow.wait_condition(lambda: self.approved_rules is not None)

        # ── Stage: VALIDATING ──────────────────────────────────────────────
        self.stage = "VALIDATING"

        validation_result = await workflow.execute_activity(
            run_validation_activity,
            {"session_id": self.session_id, "approved_rules": self.approved_rules},
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        self.validation_results = validation_result["validation_results"]
        self.baseline_quality_score = validation_result["baseline_quality_score"]
        self.current_score = self.baseline_quality_score

        anomaly_result = await workflow.execute_activity(
            detect_anomalies_activity,
            {"session_id": self.session_id},
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        # anomaly_summary is a lightweight dict (counts only); full report on disk
        self.anomaly_summary = anomaly_result["anomaly_summary"]

        analyze_result = await workflow.execute_activity(
            analyze_and_prioritize_activity,
            {
                "session_id": self.session_id,
                "validation_results": self.validation_results,
                "anomaly_summary": self.anomaly_summary,
                "profile": self.profile,
                "use_case": self.use_case,
            },
            start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        self.validation_summary = analyze_result.get("validation_summary", "")
        self.anomaly_narrative = analyze_result.get("anomaly_summary", "")
        self.transformation_queue = analyze_result.get("transformation_queue", [])

        # ── Stage: TRIAGING ────────────────────────────────────────────────
        self.stage = "TRIAGING"

        # Only triage if there are failing rules to classify
        failing_rules = [
            r for r in self.validation_results.get("per_rule", [])
            if not r.get("passed", True)
        ]

        if failing_rules:
            triage_result = await workflow.execute_activity(
                triage_rules_activity,
                {
                    "session_id": self.session_id,
                    "failing_rules": failing_rules,
                    "use_case": self.use_case,
                },
                start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )
            self.triage_result = triage_result

            # Only wait for human if there are proposed amendments
            has_amendments = any(
                c.get("proposed_threshold") is not None or c.get("proposed_remove", False)
                for c in triage_result.get("classifications", [])
            )

            if has_amendments:
                self.stage = "AWAITING_TRIAGE_APPROVAL"
                await workflow.wait_condition(lambda: self.triage_amendments is not None)
            else:
                # No amendments needed — proceed automatically
                self.triage_amendments = {}

            # Apply accepted amendments to approved_rules
            amendments = self.triage_amendments or {}
            threshold_changes = {
                item["rule_id"]: item["new_threshold"]
                for item in amendments.get("accepted_threshold_changes", [])
            }
            rejected_ids = set(amendments.get("rejected_rule_ids", []))

            if threshold_changes or rejected_ids:
                updated_rules = []
                for rule in (self.approved_rules or []):
                    if rule["id"] in rejected_ids:
                        continue
                    if rule["id"] in threshold_changes:
                        rule = {**rule, "threshold": threshold_changes[rule["id"]]}
                    updated_rules.append(rule)
                self.approved_rules = updated_rules

                # Re-run validation with amended rules to establish clean baseline
                amended_validation = await workflow.execute_activity(
                    run_validation_activity,
                    {"session_id": self.session_id, "approved_rules": self.approved_rules},
                    start_to_close_timeout=ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )
                self.validation_results = amended_validation["validation_results"]
                self.baseline_quality_score = amended_validation["baseline_quality_score"]
                self.current_score = self.baseline_quality_score

        # ── Stage: TRANSFORMATION_LOOP ─────────────────────────────────────
        self.stage = "TRANSFORMATION_LOOP"

        while True:
            # Hard cap: stop after 25 total transform decisions
            if len(self.transformation_log) >= 25:
                break

            # Stagnation check: record which rules are currently failing before suggestion
            failing_rule_ids_before = {
                r["id"]
                for r in self.validation_results.get("per_rule", [])
                if not r.get("passed", True)
            }

            # Get next transformation suggestion
            suggest_result = await workflow.execute_activity(
                suggest_next_transformation_activity,
                {
                    "session_id": self.session_id,
                    "transformation_log": self.transformation_log,
                    "current_score": self.current_score,
                    "use_case": self.use_case,
                    "profile": self.profile,
                    "approved_rules": self.approved_rules,
                    # anomaly_report is read from disk by the activity
                },
                start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )

            if suggest_result.get("done", False):
                break

            suggestion = suggest_result.get("suggestion")
            if not suggestion:
                break

            # Guard: if the advisor suggests the same (type, column) combo that was
            # already attempted, break to avoid an infinite loop.
            # Exempt "custom" type — each custom transform has different code so
            # the same column can legitimately receive multiple custom transforms.
            s_type = suggestion.get("type")
            s_col = (suggestion.get("params", {}).get("column")
                     or suggestion.get("column"))
            if s_type != "custom":
                already_tried = any(
                    entry.get("type") == s_type
                    and (entry.get("params", {}).get("column") or entry.get("column")) == s_col
                    for entry in self.transformation_log
                )
                if already_tried:
                    break
            else:
                # For custom transforms: allow multiple, but break if the last 2
                # custom transforms on this column both had no effect
                custom_no_effect = [
                    e for e in self.transformation_log
                    if e.get("type") == "custom"
                    and (e.get("params", {}).get("column") or e.get("column")) == s_col
                    and e.get("status") == "no_effect"
                ]
                if len(custom_no_effect) >= 2:
                    break

            self.current_suggestion = suggestion
            tid = suggestion.get("id", f"t{len(self.transformation_log) + 1}")
            self.current_suggestion["id"] = tid

            # Auto-preview
            preview_result = await workflow.execute_activity(
                preview_transformation_activity,
                {
                    "session_id": self.session_id,
                    "transformation_spec": suggestion,
                    "approved_rules": self.approved_rules,
                },
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )
            self.current_preview = preview_result

            # Wait for human decision
            await workflow.wait_condition(lambda: tid in self.transformation_decisions)
            decision = self.transformation_decisions[tid]

            if decision["approved"]:
                # Snapshot which rules were passing before this transform
                pre_transform_passing = {
                    r["id"]
                    for r in self.validation_results.get("per_rule", [])
                    if r.get("passed", True)
                }

                # Apply modification if provided
                spec_to_apply = suggestion
                if decision.get("modification"):
                    spec_to_apply = {**suggestion, **decision["modification"]}

                apply_result = await workflow.execute_activity(
                    apply_transformation_activity,
                    {"session_id": self.session_id, "transformation_spec": spec_to_apply},
                    start_to_close_timeout=ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )

                # Update score and refresh validation results
                scorecard_result = await workflow.execute_activity(
                    update_scorecard_activity,
                    {"session_id": self.session_id, "approved_rules": self.approved_rules},
                    start_to_close_timeout=ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )
                new_score = scorecard_result.get("quality_score", self.current_score)
                score_delta = new_score - self.current_score
                self.current_score = new_score

                # Detect regressions: rules that were passing before but failing now
                new_per_rule = scorecard_result.get("per_rule", [])
                regressions = [
                    {
                        "rule_id": r.get("id"),
                        "column": r.get("column"),
                        "check": r.get("check"),
                        "failure_count": r.get("failure_count", 0),
                        "rationale": (r.get("rationale", "") or "")[:80],
                    }
                    for r in new_per_rule
                    if r.get("id") in pre_transform_passing and not r.get("passed", True)
                ]

                # Keep validation_results current so the Validate tab reflects post-transform state
                self.validation_results = {
                    "per_rule": new_per_rule or self.validation_results.get("per_rule", []),
                    "category_scores": scorecard_result.get("category_scores", self.validation_results.get("category_scores", {})),
                    "baseline_quality_score": self.baseline_quality_score,
                }

                affected_rows = apply_result.get("affected_rows", 0)
                self.transformation_log.append({
                    "id": tid,
                    "type": spec_to_apply.get("type"),
                    "params": spec_to_apply.get("params", {}),
                    "affected_rows": affected_rows,
                    "score_delta": score_delta,
                    "status": "applied" if affected_rows > 0 else "no_effect",
                    "custom_code": spec_to_apply.get("params", {}).get("code") or spec_to_apply.get("custom_code"),
                    "rationale": suggestion.get("rationale", ""),
                    "regressions": regressions,
                })

                # Stagnation tracking: did this transform clear any failing rules?
                failing_rule_ids_after = {
                    r["id"]
                    for r in self.validation_results.get("per_rule", [])
                    if not r.get("passed", True)
                }
                newly_cleared = failing_rule_ids_before - failing_rule_ids_after
                if newly_cleared:
                    self.consecutive_no_progress = 0
                else:
                    self.consecutive_no_progress += 1

                if self.consecutive_no_progress >= 3:
                    break
            else:
                self.transformation_log.append({
                    "id": tid,
                    "type": suggestion.get("type"),
                    "params": suggestion.get("params", {}),
                    "status": "rejected",
                    "rationale": suggestion.get("rationale", ""),
                    "regressions": [],
                })

        # ── Generate scorecard summary ─────────────────────────────────────
        scorecard_summary = await workflow.execute_activity(
            generate_scorecard_summary_activity,
            {
                "session_id": self.session_id,
                "approved_rules": self.approved_rules,
                "baseline_score": self.baseline_quality_score,
                "use_case": self.use_case,
            },
            start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        self.scorecard = scorecard_summary.get("scorecard", {})
        self.narrative = scorecard_summary.get("narrative", "")

        # ── Stage: AWAITING_PIPELINE_CONFIRMATION ──────────────────────────
        self.stage = "AWAITING_PIPELINE_CONFIRMATION"
        await workflow.wait_condition(lambda: self.pipeline_config is not None)

        # ── Stage: GENERATING ──────────────────────────────────────────────
        self.stage = "GENERATING"

        pipeline_result = await workflow.execute_activity(
            generate_pipeline_activity,
            {
                "session_id": self.session_id,
                "target_env": self.pipeline_config,
                "approved_rules": self.approved_rules,
            },
            start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        self.output_dir = pipeline_result.get("output_dir", "")

        await workflow.execute_activity(
            export_working_dataset_activity,
            {"session_id": self.session_id},
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )

        zip_result = await workflow.execute_activity(
            zip_output_activity,
            {"session_id": self.session_id, "output_dir": self.output_dir},
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        self.zip_path = zip_result.get("zip_path", "")

        # ── Stage: COMPLETE ────────────────────────────────────────────────
        self.stage = "COMPLETE"

        return {
            "session_id": self.session_id,
            "stage": "COMPLETE",
            "baseline_quality_score": self.baseline_quality_score,
            "final_score": self.current_score,
            "output_dir": self.output_dir,
            "zip_path": self.zip_path,
        }
