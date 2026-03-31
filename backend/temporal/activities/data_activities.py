"""Activities for data loading, profiling, validation, and anomaly detection."""
from temporalio import activity
import asyncio
from functools import partial

# Each activity wraps dq_tools calls in asyncio.get_event_loop().run_in_executor
# since dq_tools is synchronous and Temporal activities must be async-friendly

@activity.defn
async def load_dataset_activity(params: dict) -> dict:
    """
    params: {session_id, file_path, file_ext}
    Returns: {session_id, row_count, col_count, col_names}
    """
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        partial(_load_dataset_sync, params)
    )
    return result

def _load_dataset_sync(params: dict) -> dict:
    from dq_tools.profiler import load_into_duckdb
    return load_into_duckdb(params["session_id"], params["file_path"], params["file_ext"])


@activity.defn
async def profile_and_analyze_activity(params: dict) -> dict:
    """
    params: {session_id, use_case, target_column, description}
    Returns: {profile, ai_summary, suggested_rules, top_issues}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_profile_and_analyze_sync, params))

def _profile_and_analyze_sync(params: dict) -> dict:
    from dq_tools.profiler import profile_dataset
    from backend.agents.graphs.profile_analyzer import run_profile_analyzer

    session_id = params["session_id"]

    # profile_dataset writes profile.json + profile_report.html to disk,
    # returns a trimmed summary dict (not the full multi-MB JSON)
    profile_summary = profile_dataset(session_id)

    # Agent reads full profile.json from disk via session_id;
    # only lightweight summaries flow through Temporal event history
    agent_result = run_profile_analyzer(
        session_id=session_id,
        use_case=params.get("use_case", ""),
        target_column=params.get("target_column"),
        description=params.get("description"),
    )
    return {
        # Return trimmed profile summary, not the full JSON
        "profile": profile_summary,
        "ai_summary": agent_result.get("ai_summary", ""),
        "suggested_rules": agent_result.get("suggested_rules", []),
        "top_issues": agent_result.get("top_issues", []),
    }


@activity.defn
async def run_validation_activity(params: dict) -> dict:
    """
    params: {session_id, approved_rules}
    Returns: {validation_results, baseline_quality_score}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_run_validation_sync, params))

def _run_validation_sync(params: dict) -> dict:
    from dq_tools.rule_engine import run_rules, save_approved_rules
    save_approved_rules(params["session_id"], params["approved_rules"])
    results = run_rules(params["session_id"], params["approved_rules"])
    return {
        "validation_results": results,
        "baseline_quality_score": results["baseline_quality_score"],
    }


@activity.defn
async def detect_anomalies_activity(params: dict) -> dict:
    """
    params: {session_id, methods}
    Returns: {anomaly_report}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_detect_anomalies_sync, params))

def _detect_anomalies_sync(params: dict) -> dict:
    import json
    from pathlib import Path
    from dq_tools.anomaly_detector import detect

    session_id = params["session_id"]
    report = detect(
        session_id,
        methods=params.get("methods", ["zscore", "iqr", "isolation_forest"]),
    )

    # Write full report to disk so it never flows through Temporal event history
    from dq_tools.profiler import _find_project_root
    report_path = _find_project_root() / "data" / "sessions" / session_id / "anomaly_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, default=str))

    # Return only a lightweight summary
    return {
        "anomaly_summary": {
            "flagged_count": report.get("flagged_count", 0),
            "total_rows": report.get("total_rows", 0),
            "critical_count": len(report.get("critical", [])),
            "warning_count": len(report.get("warning", [])),
            "informational_count": len(report.get("informational", [])),
        }
    }


@activity.defn
async def analyze_and_prioritize_activity(params: dict) -> dict:
    """
    params: {session_id, validation_results, anomaly_summary, profile, use_case}
    Returns: {validation_summary, anomaly_summary, transformation_queue}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_analyze_and_prioritize_sync, params))

def _analyze_and_prioritize_sync(params: dict) -> dict:
    import json
    from pathlib import Path
    from backend.agents.graphs.validation_analyzer import run_validation_analyzer

    session_id = params["session_id"]

    # Read full anomaly report from disk (written by detect_anomalies_activity)
    from dq_tools.profiler import _find_project_root
    anomaly_path = _find_project_root() / "data" / "sessions" / session_id / "anomaly_report.json"
    anomaly_report: dict = params.get("anomaly_summary", {})  # fall back to summary counts
    if anomaly_path.exists():
        try:
            anomaly_report = json.loads(anomaly_path.read_text())
        except Exception:
            pass

    return run_validation_analyzer(
        session_id=session_id,
        validation_results=params["validation_results"],
        anomaly_report=anomaly_report,
        profile=params["profile"],
        use_case=params.get("use_case", ""),
    )
