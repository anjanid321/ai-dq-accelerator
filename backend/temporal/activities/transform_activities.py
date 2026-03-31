"""Activities for transformation suggestion, preview, apply, and scorecard."""
from temporalio import activity
import asyncio
from functools import partial


@activity.defn
async def suggest_next_transformation_activity(params: dict) -> dict:
    """
    params: {session_id, transformation_log, current_score, use_case, profile, approved_rules}
    Returns: {done: bool, suggestion: dict | None}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_suggest_next_sync, params))

def _suggest_next_sync(params: dict) -> dict:
    import json
    from pathlib import Path
    from backend.agents.graphs.transformation_advisor import run_transformation_advisor
    from dq_tools.rule_engine import run_rules

    session_id = params["session_id"]

    # Get current failures
    approved_rules = params.get("approved_rules", [])
    validation_results = {}
    if approved_rules:
        try:
            validation_results = run_rules(session_id, approved_rules)
        except Exception as exc:
            activity.logger.error(
                "run_rules failed for session %s: %s", session_id, exc, exc_info=True
            )
            raise

    remaining_failures = [
        r for r in validation_results.get("per_rule", [])
        if r.get("failure_count", 0) > 0 or (not r.get("passed", True) and r.get("error"))
    ]

    # Read anomaly report from disk — never passed through Temporal event history
    from dq_tools.profiler import _find_project_root
    anomaly_path = _find_project_root() / "data" / "sessions" / session_id / "anomaly_report.json"
    anomaly_report: dict = {}
    if anomaly_path.exists():
        try:
            anomaly_report = json.loads(anomaly_path.read_text())
        except Exception:
            pass

    result = run_transformation_advisor(
        session_id=session_id,
        remaining_failures=remaining_failures,
        anomaly_report=anomaly_report,
        transformation_log=params.get("transformation_log", []),
        current_score=params.get("current_score", 0.0),
        use_case=params.get("use_case", ""),
        profile=params.get("profile", {}),
    )
    return result


@activity.defn
async def preview_transformation_activity(params: dict) -> dict:
    """
    params: {session_id, transformation_spec, approved_rules}
    Returns: {before_sample, after_sample, affected_row_count, projected_score, projected_score_delta}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_preview_transformation_sync, params))

def _preview_transformation_sync(params: dict) -> dict:
    from dq_tools.transformation_executor import preview
    return preview(
        params["session_id"],
        params["transformation_spec"],
        params.get("approved_rules"),
    )


@activity.defn
async def apply_transformation_activity(params: dict) -> dict:
    """
    params: {session_id, transformation_spec}
    Returns: {affected_rows, row_count_before, row_count_after}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_apply_transformation_sync, params))

def _apply_transformation_sync(params: dict) -> dict:
    from dq_tools.transformation_executor import apply_transformation
    return apply_transformation(params["session_id"], params["transformation_spec"])


@activity.defn
async def update_scorecard_activity(params: dict) -> dict:
    """
    params: {session_id, approved_rules}
    Returns: {quality_score, category_scores, per_rule}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_update_scorecard_sync, params))

def _update_scorecard_sync(params: dict) -> dict:
    from dq_tools.scorecard import compute
    return compute(params["session_id"], params["approved_rules"])


@activity.defn
async def generate_scorecard_summary_activity(params: dict) -> dict:
    """
    params: {session_id, approved_rules, baseline_score, use_case}
    Returns: {scorecard, narrative}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_generate_scorecard_summary_sync, params))

def _generate_scorecard_summary_sync(params: dict) -> dict:
    from dq_tools.scorecard import compute_full
    from dq_tools.transformation_executor import load_transformation_log
    from backend.agents.graphs.scorecard_narrator import run_scorecard_narrator

    transformation_log = load_transformation_log(params["session_id"])
    scorecard = compute_full(params["session_id"], params["approved_rules"])
    narrative = run_scorecard_narrator(
        session_id=params["session_id"],
        scorecard=scorecard,
        transformation_log=transformation_log,
        baseline_score=params.get("baseline_score", 0.0),
        use_case=params.get("use_case", ""),
    )
    return {"scorecard": scorecard, "narrative": narrative}
