"""DQAcceleratorWorkflow — main Temporal workflow for the DQ Accelerator."""

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy

# Import activities with sandbox-safe pattern
with workflow.unsafe.imports_passed_through():
    from backend.temporal.activities.data_activities import (
        load_dataset_activity,
        run_validation_activity,
        detect_anomalies_activity,
        analyze_and_prioritize_activity,
    )
    from backend.temporal.activities.investigation_activities import (
        profile_and_investigate_activity,
        synthesize_and_propose_activity,
        reinvestigate_activity,
        review_rules_activity,
    )
    from backend.temporal.activities.transform_activities import (
        preview_transformation_activity,
        apply_transformation_activity,
        update_scorecard_activity,
        generate_scorecard_summary_activity,
        plan_transforms_activity,
        generate_custom_code_activity,
        verify_transform_activity,
    )
    from backend.temporal.activities.pipeline_activities import (
        generate_pipeline_activity,
        export_working_dataset_activity,
        zip_output_activity,
    )
    from backend.temporal.activities.triage_activities import triage_rules_activity
    from backend.temporal.activities.snapshot_activities import snapshot_stage

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
        self.rule_revision_log: list = []
        self.approved_rules: list | None = None

        # Validation state
        self.validation_results: dict = {}
        self.anomaly_summary: dict = {}  # lightweight summary only; full report lives on disk
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

        # Plan state
        self.transform_plan: dict | None = None  # {steps, summary, projected_final_score}
        self.plan_decision: dict | None = None  # staging: set by approve_plan signal
        self.execution_escalation: dict | None = None  # current issue awaiting human
        self.escalation_decision: dict | None = None  # staging: set by resolve_escalation signal
        self.provide_instruction_attempts: int = 0

        # Scorecard state
        self.scorecard: dict = {}
        self.narrative: str = ""

        # Investigation / exploration state
        self.investigation_findings: str = ""
        self.exploration_findings: dict = {}
        self.exploration_notebook_path: str = ""
        self.investigation_round: int = 0
        self.investigation_feedback: dict | None = None  # {"message": str, "approve": bool}
        self.synthesis_constrained: bool = False
        self.synthesis_constraint_reasons: list = []

        # Pipeline state
        self.pipeline_config: dict | None = None
        self.output_dir: str = ""
        self.zip_path: str = ""

    # ── Signals ─────────────────────────────────────────────────────────────

    @workflow.signal
    def approve_rules(self, rules: list) -> None:
        self.approved_rules = rules

    @workflow.signal
    def decide_transformation(
        self, tid: str, approved: bool, modification: dict | None = None
    ) -> None:
        # Deprecated: no-op in holistic planning mode. plan/approve replaces this.
        workflow.logger.warning(
            "decide_transformation signal received but ignored in holistic planning mode"
        )

    @workflow.signal
    def approve_triage(self, amendments: dict) -> None:
        """amendments: {accepted_threshold_changes: [...], rejected_rule_ids: [...]}"""
        self.triage_amendments = amendments

    @workflow.signal
    def confirm_pipeline(self, config: dict) -> None:
        self.pipeline_config = config

    @workflow.signal
    def approve_plan(self, payload: dict) -> None:
        """payload: {steps: list[dict]}"""
        self.plan_decision = payload

    @workflow.signal
    def resolve_escalation(self, payload: dict) -> None:
        """payload: {action: str, instruction?: str}"""
        self.escalation_decision = payload

    @workflow.signal
    def submit_investigation_feedback(self, payload: dict) -> None:
        """payload: {"message": str, "approve": bool}"""
        self.investigation_feedback = payload

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
            "rule_revision_log": self.rule_revision_log,
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
    def get_exploration(self) -> dict:
        return {
            "exploration_findings": self.exploration_findings,
            "notebook_path": self.exploration_notebook_path,
            "open_questions": self.exploration_findings.get("open_questions", []),
            "investigation_round": self.investigation_round,
            "synthesis_constrained": self.synthesis_constrained,
            "synthesis_constraint_reasons": self.synthesis_constraint_reasons,
        }

    @workflow.query
    def get_full_state(self) -> dict:
        return {
            "stage": self.stage,
            "session_id": self.session_id,
            "profile": self.profile,
            "ai_summary": self.ai_summary,
            "suggested_rules": self.suggested_rules,
            "rule_revision_log": self.rule_revision_log,
            "baseline_quality_score": self.baseline_quality_score,
            "validation_summary": self.validation_summary,
            "anomaly_summary": self.anomaly_narrative,
            "anomaly_counts": self.anomaly_summary,
            "triage_result": self.triage_result,
            "current_suggestion": self.current_suggestion,
            "current_preview": self.current_preview,
            "current_score": self.current_score,
            "transformation_log": self.transformation_log,
            "transform_plan": self.transform_plan,
            "execution_escalation": self.execution_escalation,
            "scorecard": self.scorecard,
            "narrative": self.narrative,
            "output_dir": self.output_dir,
            "zip_path": self.zip_path,
            "exploration_findings": self.exploration_findings,
            "exploration_notebook_path": self.exploration_notebook_path,
            "investigation_round": self.investigation_round,
            "synthesis_constrained": self.synthesis_constrained,
            "synthesis_constraint_reasons": self.synthesis_constraint_reasons,
            "validation_results": {
                **self.validation_results,
                "per_rule": [
                    {**r, "sample_failing_rows": r.get("sample_failing_rows", [])[:5]}
                    for r in self.validation_results.get("per_rule", [])
                ],
            }
            if self.validation_results
            else {},
        }

    # ── Helpers ──────────────────────────────────────────────────────────────

    async def _escalate(
        self, step: dict, escalation_type: str, description: str, context: dict
    ) -> dict:
        """Set escalation state, wait for human decision, return decision dict."""
        self.execution_escalation = {
            "type": escalation_type,
            "step_id": step["id"],
            "description": description,
            "context": context,
        }
        self.stage = "AWAITING_HUMAN_INPUT"
        await workflow.wait_condition(lambda: self.escalation_decision is not None)
        decision = self.escalation_decision
        assert decision is not None  # guaranteed by wait_condition
        self.escalation_decision = None
        self.execution_escalation = None
        self.stage = "TRANSFORMATION_LOOP"
        return decision

    async def _snapshot(self, ui_stage: str, payload: dict) -> None:
        """Persist a stage snapshot. Best-effort — failures are logged, not raised."""
        session_updates = {
            "stage": self.stage,
            "current_score": self.current_score,
            "baseline_score": self.baseline_quality_score,
            "output_dir": self.output_dir or None,
            "zip_path": self.zip_path or None,
        }
        try:
            await workflow.execute_activity(
                snapshot_stage,
                {
                    "session_id": self.session_id,
                    "stage": ui_stage,
                    "payload": payload,
                    "session_updates": session_updates,
                },
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=ACTIVITY_RETRY,
            )
        except Exception:
            workflow.logger.exception("snapshot_stage failed for %s", ui_stage)

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
            {
                "session_id": self.session_id,
                "file_path": params["file_path"],
                "file_ext": params["file_ext"],
            },
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )

        # ── Stage: PROFILING (investigation + structure findings + notebook) ────────
        self.stage = "PROFILING"
        investigation_result = await workflow.execute_activity(
            profile_and_investigate_activity,
            {
                "session_id": self.session_id,
                "use_case": self.use_case,
                "target_column": self.target_column,
                "description": self.description,
            },
            start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        self.exploration_findings = investigation_result["exploration_findings"]
        self.investigation_findings = investigation_result["investigation_findings"]
        self.exploration_notebook_path = investigation_result.get("notebook_path", "")

        # ── Stage: AWAITING_INVESTIGATION_REVIEW ─────────────────────────────────
        self.stage = "AWAITING_INVESTIGATION_REVIEW"
        await workflow.wait_condition(lambda: self.investigation_feedback is not None)
        feedback = self.investigation_feedback
        self.investigation_feedback = None

        # Re-investigation loop (max 2 rounds)
        while not feedback.get("approve", False) and self.investigation_round < 2:
            self.stage = "REINVESTIGATING"
            self.investigation_round += 1

            reinvestigation_result = await workflow.execute_activity(
                reinvestigate_activity,
                {
                    "session_id": self.session_id,
                    "use_case": self.use_case,
                    "target_column": self.target_column,
                    "overview_notes": investigation_result["overview_notes"],
                    "columns_to_investigate": investigation_result["columns_to_investigate"],
                    "exploration_findings": self.exploration_findings,
                    "investigation_findings": self.investigation_findings,
                    "feedback_message": feedback.get("message", ""),
                    "investigation_round": self.investigation_round,
                },
                start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )
            self.exploration_findings = reinvestigation_result["exploration_findings"]
            self.investigation_findings = reinvestigation_result["investigation_findings"]
            self.exploration_notebook_path = reinvestigation_result.get("notebook_path", "")

            self.stage = "AWAITING_INVESTIGATION_REVIEW"
            await workflow.wait_condition(lambda: self.investigation_feedback is not None)
            feedback = self.investigation_feedback
            self.investigation_feedback = None

        # Check for constrained synthesis (round limit hit without approval)
        if not feedback.get("approve", False):
            open_questions = self.exploration_findings.get("open_questions", [])
            readiness = self.exploration_findings.get("readiness_assessment", "good")
            if open_questions or readiness == "poor":
                self.synthesis_constrained = True
                self.synthesis_constraint_reasons = open_questions

        # ── Stage: PROFILING_SYNTHESIS ─────────────────────────────────────────────
        self.stage = "PROFILING_SYNTHESIS"
        profile_result = await workflow.execute_activity(
            synthesize_and_propose_activity,
            {
                "session_id": self.session_id,
                "use_case": self.use_case,
                "target_column": self.target_column,
                "description": self.description,
                "investigation_findings": self.investigation_findings,
                "exploration_findings": self.exploration_findings,
                "overview_notes": investigation_result["overview_notes"],
                "columns_to_investigate": investigation_result["columns_to_investigate"],
                "synthesis_constrained": self.synthesis_constrained,
                "synthesis_constraint_reasons": self.synthesis_constraint_reasons,
            },
            start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        self.profile = profile_result["profile"]
        self.ai_summary = profile_result["ai_summary"]
        self.suggested_rules = profile_result["suggested_rules"]
        self.top_issues = profile_result.get("top_issues", [])

        await self._snapshot("profile", {
            "profile": self.profile,
            "ai_summary": self.ai_summary,
        })

        _explore_events: list = []
        try:
            import json as _json
            from pathlib import Path as _Path
            _progress = _Path("data/sessions") / self.session_id / "investigation_progress.jsonl"
            if _progress.exists():
                _explore_events = [
                    _json.loads(_l) for _l in _progress.read_text().splitlines() if _l.strip()
                ]
        except Exception:
            workflow.logger.exception("could not freeze investigation_progress.jsonl")
        await self._snapshot("explore", {"investigation_events": _explore_events})

        # ── Stage: RULE_REVIEW ─────────────────────────────────────────────
        self.stage = "RULE_REVIEW"
        review_result = await workflow.execute_activity(
            review_rules_activity,
            {
                "session_id": self.session_id,
                "suggested_rules": self.suggested_rules,
                "exploration_findings": self.exploration_findings,
                "use_case": self.use_case,
            },
            start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        self.suggested_rules = review_result["suggested_rules"]
        self.rule_revision_log = review_result["rule_revision_log"]

        # ── Stage: AWAITING_RULE_APPROVAL ──────────────────────────────────
        self.stage = "AWAITING_RULE_APPROVAL"
        await workflow.wait_condition(lambda: self.approved_rules is not None)

        _approved_ids = [r["id"] for r in (self.approved_rules or [])]
        _rejected_ids = [r["id"] for r in self.suggested_rules if r["id"] not in set(_approved_ids)]
        await self._snapshot("rules", {
            "suggested_rules": self.suggested_rules,
            "approved_rule_ids": _approved_ids,
            "rejected_rule_ids": _rejected_ids,
        })

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

        await self._snapshot("validate", {
            "validation_summary": self.validation_summary,
            "validation_results": self.validation_results,
            "baseline_score": self.baseline_quality_score,
        })

        # ── Stage: TRIAGING ────────────────────────────────────────────────
        self.stage = "TRIAGING"

        # Only triage if there are failing rules to classify
        failing_rules = [
            r for r in self.validation_results.get("per_rule", []) if not r.get("passed", True)
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
                for rule in self.approved_rules or []:
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

        if self.triage_result:
            _triage_amendments = self.triage_amendments or {}
            await self._snapshot("triage", {
                "triage_result": self.triage_result,
                "threshold_changes": _triage_amendments.get("accepted_threshold_changes", []),
                "rejected_rule_ids": _triage_amendments.get("rejected_rule_ids", []),
            })

        # ── Stage: PLANNING ────────────────────────────────────────────────
        self.stage = "PLANNING"

        # Build fixable_rules: join triage classifications with validation per_rule
        per_rule_by_id = {r["id"]: r for r in self.validation_results.get("per_rule", [])}
        fixable_rules = [
            {**per_rule_by_id[c["rule_id"]], "triage": c}
            for c in self.triage_result.get("classifications", [])
            if c.get("classification") == "transform_fixable" and c["rule_id"] in per_rule_by_id
        ]

        plan_result = await workflow.execute_activity(
            plan_transforms_activity,
            {
                "session_id": self.session_id,
                "fixable_rules": fixable_rules,
                "validation_results": self.validation_results,
                "profile": self.profile,
                "use_case": self.use_case,
                "transformation_log": self.transformation_log,
            },
            start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        self.transform_plan = plan_result

        # Replace Claude's estimated projected_score_delta with formula-based values
        for step in plan_result.get("steps", []):
            if step.get("type") == "custom":
                continue  # custom steps have no code yet — keep Claude's estimate
            try:
                spec = {
                    **(step.get("params") or {}),
                    "id": step.get("id", ""),
                    "type": step.get("type", ""),
                }
                preview = await workflow.execute_activity(
                    preview_transformation_activity,
                    {
                        "session_id": self.session_id,
                        "transformation_spec": spec,
                        "approved_rules": self.approved_rules,
                    },
                    start_to_close_timeout=ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )
                formula_delta = preview.get("projected_score_delta")
                if formula_delta is not None:
                    step["projected_score_delta"] = formula_delta
            except Exception:
                pass  # keep Claude's estimate if preview fails

        # ── Stage: AWAITING_PLAN_APPROVAL ──────────────────────────────────
        self.stage = "AWAITING_PLAN_APPROVAL"
        await workflow.wait_condition(lambda: self.plan_decision is not None)

        # Apply engineer edits: replace steps with whatever the frontend sent
        approved_steps = self.plan_decision["steps"]
        self.transform_plan = {**self.transform_plan, "steps": approved_steps}
        self.plan_decision = None

        await self._snapshot("plan", {"transform_plan": self.transform_plan})

        # ── Stage: TRANSFORMATION_LOOP ─────────────────────────────────────
        self.stage = "TRANSFORMATION_LOOP"

        steps = self.transform_plan.get("steps", []) if self.transform_plan else []

        for i, step in enumerate(steps):
            # 1. Dependency check
            dep_statuses = {s["id"]: s.get("status", "pending") for s in steps}
            failed_deps = [
                d
                for d in step.get("depends_on", [])
                if dep_statuses.get(d) in ("failed", "skipped")
            ]
            if failed_deps:
                steps[i]["status"] = "skipped"
                self.transformation_log.append(
                    {
                        "id": step["id"],
                        "type": step.get("type", ""),
                        "params": step.get("params", {}),
                        "affected_rows": 0,
                        "score_delta": 0,
                        "status": "skipped",
                        "rationale": f"Dependency skipped/failed: {failed_deps}",
                        "regressions": [],
                    }
                )
                continue

            # 2. Pre-step snapshot
            pre_step_passing = {
                r["id"] for r in self.validation_results.get("per_rule", []) if r.get("passed")
            }
            pre_step_score = self.current_score

            # 3. Custom step: generate code
            prior_context: str = ""  # defined here so post-apply escalation can reference it
            if step.get("type") == "custom":
                prior_context = ", ".join(
                    f"{s['id']} ({s.get('type', '?')} on {s.get('column', '?')}): {s.get('actual_score_delta', 0):+.1%}"
                    for s in steps[:i]
                    if s.get("status") == "applied"
                )
                self.provide_instruction_attempts = 0
                code_result = await workflow.execute_activity(
                    generate_custom_code_activity,
                    {
                        "session_id": self.session_id,
                        "step": step,
                        "prior_context": prior_context,
                        "human_instruction": None,
                    },
                    start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )
                if not code_result.get("validation_passed"):
                    # Escalate: code generation failed
                    resolved = await self._escalate(
                        step,
                        "code_generation_failed",
                        f"Code generation failed for {step['id']}",
                        {"last_error": "Validation failed after 3 attempts"},
                    )
                    if resolved["action"] == "abort_plan":
                        steps[i]["status"] = "failed"
                        break
                    elif resolved["action"] == "skip_step":
                        steps[i]["status"] = "failed"
                        self.transformation_log.append(
                            {
                                "id": step["id"],
                                "type": step.get("type", ""),
                                "params": step.get("params", {}),
                                "affected_rows": 0,
                                "score_delta": 0,
                                "status": "failed",
                                "rationale": "Code generation failed — skipped by engineer",
                                "regressions": [],
                            }
                        )
                        continue
                    elif resolved["action"] == "provide_instruction":
                        if resolved.get("modified_params"):
                            steps[i]["params"] = resolved["modified_params"]
                        # Retry with human instruction (up to 2 retries)
                        succeeded = False
                        while self.provide_instruction_attempts < 2:
                            self.provide_instruction_attempts += 1
                            retry_result = await workflow.execute_activity(
                                generate_custom_code_activity,
                                {
                                    "session_id": self.session_id,
                                    "step": step,
                                    "prior_context": prior_context,
                                    "human_instruction": resolved.get("instruction"),
                                },
                                start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
                                retry_policy=ACTIVITY_RETRY,
                            )
                            if retry_result.get("validation_passed"):
                                code_result = retry_result
                                succeeded = True
                                break
                            # Still failed — escalate again
                            if self.provide_instruction_attempts < 2:
                                resolved = await self._escalate(
                                    step,
                                    "code_generation_failed",
                                    f"Code generation still failing (attempt {self.provide_instruction_attempts})",
                                    {"last_error": "Validation failed"},
                                )
                                if resolved["action"] != "provide_instruction":
                                    break
                        if not succeeded:
                            steps[i]["status"] = "failed"
                            self.transformation_log.append(
                                {
                                    "id": step["id"],
                                    "type": step.get("type", ""),
                                    "params": step.get("params", {}),
                                    "affected_rows": 0,
                                    "score_delta": 0,
                                    "status": "failed",
                                    "rationale": "Code generation exhausted retries — auto-skipped",
                                    "regressions": [],
                                }
                            )
                            continue
                steps[i]["custom_code"] = code_result.get("custom_code")

            # 4. Apply transformation
            transformation_spec = {
                "id": step["id"],
                "type": step["type"],
                "params": step.get("params", {}),
                "custom_code": steps[i].get("custom_code"),
                "rationale": step.get("rationale", ""),
            }

            # 4a. Capture before/after preview snapshot
            try:
                step_preview = await workflow.execute_activity(
                    preview_transformation_activity,
                    {
                        "session_id": self.session_id,
                        "transformation_spec": transformation_spec,
                        "approved_rules": self.approved_rules,
                    },
                    start_to_close_timeout=ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )
                steps[i]["before_sample"] = step_preview.get("before_sample", [])
                steps[i]["after_sample"] = step_preview.get("after_sample", [])
                steps[i]["affected_row_count"] = step_preview.get("affected_row_count", 0)
            except Exception:
                pass  # non-fatal — missing preview is fine

            apply_result: dict = {}
            try:
                apply_result = await workflow.execute_activity(
                    apply_transformation_activity,
                    {"session_id": self.session_id, "transformation_spec": transformation_spec},
                    start_to_close_timeout=ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )
            except Exception as exc:
                resolved = await self._escalate(
                    step,
                    "step_failed",
                    f"Apply failed for {step['id']}",
                    {"last_error": str(exc)},
                )
                if resolved["action"] == "abort_plan":
                    steps[i]["status"] = "failed"
                    break
                elif resolved["action"] == "skip_step":
                    steps[i]["status"] = "failed"
                    self.transformation_log.append(
                        {
                            "id": step["id"],
                            "type": step.get("type", ""),
                            "params": step.get("params", {}),
                            "affected_rows": 0,
                            "score_delta": 0,
                            "status": "failed",
                            "rationale": f"Apply threw error — skipped: {exc}",
                            "regressions": [],
                        }
                    )
                    continue
                elif resolved["action"] == "provide_instruction":
                    if resolved.get("modified_params"):
                        steps[i]["params"] = resolved["modified_params"]
                        transformation_spec = {
                            **resolved["modified_params"],
                            "id": step.get("id", ""),
                            "type": step.get("type", ""),
                        }
                    try:
                        apply_result = await workflow.execute_activity(
                            apply_transformation_activity,
                            {
                                "session_id": self.session_id,
                                "transformation_spec": transformation_spec,
                            },
                            start_to_close_timeout=ACTIVITY_TIMEOUT,
                            retry_policy=ACTIVITY_RETRY,
                        )
                    except Exception:
                        steps[i]["status"] = "failed"
                        self.transformation_log.append(
                            {
                                "id": step["id"],
                                "type": step.get("type", ""),
                                "params": step.get("params", {}),
                                "affected_rows": 0,
                                "score_delta": 0,
                                "status": "failed",
                                "rationale": "Apply failed after user retry — skipped",
                                "regressions": [],
                            }
                        )
                        continue

            # 5. Update scorecard
            scorecard_result = await workflow.execute_activity(
                update_scorecard_activity,
                {"session_id": self.session_id, "approved_rules": self.approved_rules},
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )
            new_score = scorecard_result.get("quality_score", self.current_score)
            actual_score_delta = new_score - pre_step_score
            self.current_score = new_score
            new_per_rule = scorecard_result.get("per_rule", [])
            self.validation_results = {
                "per_rule": new_per_rule or self.validation_results.get("per_rule", []),
                "category_scores": scorecard_result.get(
                    "category_scores", self.validation_results.get("category_scores", {})
                ),
                "baseline_quality_score": self.baseline_quality_score,
            }

            # 6. Detect regressions (only rules NOT in targets_rules that newly failed)
            targets = set(step.get("targets_rules", []))
            {r["id"] for r in new_per_rule if r.get("passed")}
            regressions_raw = [
                r
                for r in new_per_rule
                if r.get("id") in pre_step_passing
                and not r.get("passed")
                and r.get("id") not in targets
            ]
            regressions = [
                {
                    "rule_id": r.get("id"),
                    "column": r.get("column"),
                    "check": r.get("check"),
                    "failure_count": r.get("failure_count", 0),
                    "rationale": (r.get("rationale", "") or "")[:80],
                }
                for r in regressions_raw
            ]

            # 7. Monitoring checks
            projected = step.get("projected_score_delta", 0.0)
            escalation_type = None
            escalation_desc = ""
            escalation_context: dict = {}

            if regressions:
                escalation_type = "regression"
                escalation_desc = (
                    f"Step {step['id']} caused {len(regressions)} unexpected regression(s)"
                )
                escalation_context = {"regressed_rule_ids": [r["rule_id"] for r in regressions]}
            elif projected > 0.02 and actual_score_delta < projected * 0.3:
                escalation_type = "divergence"
                escalation_desc = f"Step {step['id']} produced much less improvement than expected"
                escalation_context = {"projected": projected, "actual": actual_score_delta}

            # 7b. Agent verification (only when no numeric escalation detected)
            if (
                escalation_type is None
                and steps[i].get("before_sample")
                and steps[i].get("after_sample")
            ):
                try:
                    verify_result = await workflow.execute_activity(
                        verify_transform_activity,
                        {
                            "step": step,
                            "before_sample": steps[i].get("before_sample", []),
                            "after_sample": steps[i].get("after_sample", []),
                            "actual_score_delta": actual_score_delta,
                            "targeted_rules": [
                                r
                                for r in self.validation_results.get("per_rule", [])
                                if r.get("id") in set(step.get("targets_rules", []))
                            ],
                        },
                        start_to_close_timeout=ACTIVITY_TIMEOUT,
                        retry_policy=ACTIVITY_RETRY,
                    )
                    if verify_result.get("verdict") == "incorrect":
                        escalation_type = "transform_verification_failed"
                        escalation_desc = verify_result.get(
                            "explanation", "Transform did not achieve expected outcome"
                        )
                        escalation_context = {
                            "agent_suggestion": verify_result.get("suggestion"),
                            "before_sample": steps[i].get("before_sample", []),
                            "after_sample": steps[i].get("after_sample", []),
                        }
                except Exception:
                    pass  # non-fatal — skip verification on error

            if escalation_type:
                resolved = await self._escalate(
                    step, escalation_type, escalation_desc, escalation_context
                )
                if resolved["action"] == "abort_plan":
                    steps[i]["status"] = "applied"
                    steps[i]["actual_score_delta"] = actual_score_delta
                    break
                elif resolved["action"] == "apply_suggestion":
                    suggestion = escalation_context.get("agent_suggestion") or resolved.get(
                        "suggestion"
                    )
                    if suggestion and isinstance(suggestion, dict):
                        corrective = {
                            **suggestion,
                            "id": f"{step['id']}_correction",
                            "status": "pending",
                            "rationale": f"Agent-suggested correction for {step['id']}",
                            "targets_rules": step.get("targets_rules", []),
                            "depends_on": [step["id"]],
                        }
                        steps.insert(i + 1, corrective)
                elif resolved["action"] == "provide_instruction":
                    _instruction = resolved.get("instruction") or ""
                    _modified_params = resolved.get("modified_params")
                    if step.get("type") == "custom" and _instruction:
                        # Regenerate the custom code with the user's instruction
                        try:
                            regen = await workflow.execute_activity(
                                generate_custom_code_activity,
                                {
                                    "session_id": self.session_id,
                                    "step": step,
                                    "prior_context": prior_context,
                                    "human_instruction": _instruction,
                                },
                                start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
                                retry_policy=ACTIVITY_RETRY,
                            )
                            corrective = {
                                **step,
                                "id": f"{step['id']}_regen",
                                "status": "pending",
                                "custom_code": regen.get("custom_code"),
                                "rationale": _instruction,
                                "depends_on": [step["id"]],
                            }
                            steps.insert(i + 1, corrective)
                        except Exception:
                            pass  # leave step as applied, don't crash the plan
                    elif _modified_params:
                        # User edited params — insert a corrective step with new params
                        corrective = {
                            **_modified_params,
                            "id": f"{step['id']}_user_edit",
                            "type": step.get("type", ""),
                            "status": "pending",
                            "rationale": _instruction or f"User-edited correction for {step['id']}",
                            "targets_rules": step.get("targets_rules", []),
                            "projected_score_delta": step.get("projected_score_delta", 0.0),
                        }
                        steps.insert(i + 1, corrective)
                    elif _instruction:
                        # Instruction only for non-custom step — insert same step with instruction
                        corrective = {
                            **step,
                            "id": f"{step['id']}_user_retry",
                            "status": "pending",
                            "rationale": _instruction,
                        }
                        steps.insert(i + 1, corrective)

            # 8. Mark applied
            steps[i]["status"] = "applied"
            steps[i]["actual_score_delta"] = actual_score_delta

            # 9. Append to log
            affected_rows = apply_result.get("affected_rows", 0)
            # Capture per-rule state after this step (truncate sample rows to save space)
            post_step_per_rule = [
                {k: v for k, v in r.items() if k != "sample_failing_rows"} for r in new_per_rule
            ]
            self.transformation_log.append(
                {
                    "id": step["id"],
                    "type": step.get("type", ""),
                    "params": step.get("params", {}),
                    "affected_rows": affected_rows,
                    "score_delta": actual_score_delta,
                    "status": "applied" if affected_rows > 0 else "no_effect",
                    "custom_code": steps[i].get("custom_code"),
                    "rationale": step.get("rationale", ""),
                    "regressions": regressions,
                    "post_step_per_rule": post_step_per_rule,
                }
            )

        # Update plan steps with final statuses
        if self.transform_plan:
            self.transform_plan = {**self.transform_plan, "steps": steps}

        await self._snapshot("transform", {
            "transformation_log": self.transformation_log,
            "anomaly_summary": self.anomaly_narrative,
            "execution_escalation": self.execution_escalation,
            "transform_plan": self.transform_plan,
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

        await self._snapshot("scorecard", {
            "scorecard": self.scorecard,
            "narrative": self.narrative,
            "current_score": self.current_score,
        })

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

        await self._snapshot("pipeline", {
            "output_dir": self.output_dir,
            "zip_path": self.zip_path,
        })

        return {
            "session_id": self.session_id,
            "stage": "COMPLETE",
            "baseline_quality_score": self.baseline_quality_score,
            "final_score": self.current_score,
            "output_dir": self.output_dir,
            "zip_path": self.zip_path,
        }
