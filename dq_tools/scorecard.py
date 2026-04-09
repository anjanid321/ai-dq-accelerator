"""Scorecard module for the AI Data Quality Accelerator.

Produces lightweight and full quality scorecards by combining rule-engine
results with row-level statistics and the transformation history.
"""

from __future__ import annotations

import json
from pathlib import Path

from dq_tools.db import duckdb_connect, session_db_lock
from dq_tools.rule_engine import run_rules
from dq_tools.transformation_executor import load_transformation_log


def _find_project_root() -> Path:
    """Walk up from this file until ``pyproject.toml`` is found."""
    current = Path(__file__).resolve().parent
    while current != current.parent:
        if (current / "pyproject.toml").exists():
            return current
        current = current.parent
    raise FileNotFoundError("Could not locate project root (pyproject.toml not found).")


def _session_dir(session_id: str) -> Path:
    return _find_project_root() / "data" / "sessions" / session_id


def _output_dir(session_id: str) -> Path:
    return _find_project_root() / "output" / "sessions" / session_id


def _read_profile(session_id: str) -> dict:
    profile_path = _session_dir(session_id) / "profile.json"
    if not profile_path.exists():
        return {}
    try:
        return json.loads(profile_path.read_text())
    except Exception:
        return {}


def compute(session_id: str, approved_rules: list[dict]) -> dict:
    """Compute a lightweight quality scorecard for the current session data.

    Runs the rule engine against ``working_data`` and returns a concise result
    dict without writing any output files.

    Parameters
    ----------
    session_id:
        Unique identifier for the data-quality session.
    approved_rules:
        List of approved rule dictionaries to evaluate.

    Returns
    -------
    dict
        ``{quality_score, category_scores, per_rule}``
    """
    results = run_rules(session_id, approved_rules)
    return {
        "quality_score": results["baseline_quality_score"],
        "category_scores": results["category_scores"],
        "per_rule": results["per_rule"],
    }


def compute_full(session_id: str, approved_rules: list[dict]) -> dict:
    """Compute a full scorecard and write it to ``output/sessions/{session_id}/scorecard.json``.

    In addition to rule scores the full scorecard includes:

    - Row statistics: original rows (from profile.json), current rows,
      rows removed, rows modified (from transformation log).
    - Transformation summary: count of applied and rejected transforms.

    Parameters
    ----------
    session_id:
        Unique identifier for the data-quality session.
    approved_rules:
        List of approved rule dictionaries to evaluate.

    Returns
    -------
    dict
        Full scorecard dictionary.
    """
    # Rule engine results
    results = run_rules(session_id, approved_rules)

    # Row statistics
    profile = _read_profile(session_id)
    original_rows: int | None = profile.get("row_count")

    # Current row count from current validation results

    db_path = _session_dir(session_id) / "working.duckdb"
    current_rows: int = 0
    if db_path.exists():
        with session_db_lock(session_id):
            con = duckdb_connect(str(db_path))
            try:
                current_rows = con.execute("SELECT COUNT(*) FROM working_data").fetchone()[0]
            except Exception:
                current_rows = 0
            finally:
                con.close()

    rows_removed: int | None = original_rows - current_rows if original_rows is not None else None

    # Transformation log
    log = load_transformation_log(session_id)
    applied_count = sum(1 for e in log if e.get("status") == "applied")
    rejected_count = sum(1 for e in log if e.get("status") == "rejected")
    rows_modified = sum(e.get("affected_rows", 0) for e in log if e.get("status") == "applied")

    scorecard = {
        "session_id": session_id,
        "quality_score": results["baseline_quality_score"],
        "category_scores": results["category_scores"],
        "per_rule": results["per_rule"],
        "row_stats": {
            "original_rows": original_rows,
            "current_rows": current_rows,
            "rows_removed": rows_removed,
            "rows_modified": rows_modified,
        },
        "transformation_summary": {
            "applied_count": applied_count,
            "rejected_count": rejected_count,
            "log": log,
        },
    }

    # Write output
    out_dir = _output_dir(session_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "scorecard.json"
    out_path.write_text(json.dumps(scorecard, indent=2, default=str))

    return scorecard
