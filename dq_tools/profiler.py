"""Dataset profiler using ydata-profiling for comprehensive automated EDA.

All public functions accept ``session_id`` as their first positional argument.
Session artefacts live under ``data/sessions/{session_id}/`` relative to the
project root (identified by the presence of ``pyproject.toml``).
"""

from __future__ import annotations

import json
from pathlib import Path

import duckdb


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


def _db_path(session_id: str) -> Path:
    return _session_dir(session_id) / "working.duckdb"


def _output_dir(session_id: str) -> Path:
    return _find_project_root() / "output" / "sessions" / session_id


def load_into_duckdb(session_id: str, file_path: str, file_ext: str) -> dict:
    """Load a CSV, Parquet, or JSON file into a DuckDB session database.

    Creates data/sessions/{session_id}/working.duckdb with table working_data.
    Returns {session_id, row_count, col_count, col_names}.
    """
    session_path = _session_dir(session_id)
    session_path.mkdir(parents=True, exist_ok=True)

    db = _db_path(session_id)
    ext = file_ext.lower().lstrip(".")

    con = duckdb.connect(str(db))
    try:
        con.execute("DROP TABLE IF EXISTS working_data")
        if ext == "csv":
            con.execute(
                f"CREATE TABLE working_data AS SELECT * FROM read_csv_auto('{file_path}', header=true)"
            )
        elif ext == "parquet":
            con.execute(f"CREATE TABLE working_data AS SELECT * FROM read_parquet('{file_path}')")
        elif ext in ("json", "jsonl", "ndjson"):
            con.execute(f"CREATE TABLE working_data AS SELECT * FROM read_json_auto('{file_path}')")
        else:
            raise ValueError(f"Unsupported file extension: {file_ext!r}")

        row_count = con.execute("SELECT COUNT(*) FROM working_data").fetchone()[0]
        cols = con.execute("DESCRIBE working_data").fetchall()
        col_names = [c[0] for c in cols]
    finally:
        con.close()

    return {
        "session_id": session_id,
        "row_count": row_count,
        "col_count": len(col_names),
        "col_names": col_names,
    }


def profile_dataset(session_id: str) -> dict:
    """Run ydata-profiling on the working dataset.

    Writes to disk:
    - data/sessions/{session_id}/profile.json        (full ydata-profiling JSON)
    - data/sessions/{session_id}/profile_report.html (human-readable report)

    Returns a *trimmed* profile summary suitable for passing through Temporal
    event history and the LLM's initial overview call. The full profile JSON
    stays on disk so the investigation agent can access column details via
    the explorer tools without re-loading the whole thing.
    """
    from ydata_profiling import ProfileReport

    session_dir = _session_dir(session_id)
    db = _db_path(session_id)

    con = duckdb.connect(str(db), read_only=False)
    try:
        df = con.execute("SELECT * FROM working_data").df()
    finally:
        con.close()

    report = ProfileReport(
        df,
        title=f"DQ Session {session_id[:8]}",
        minimal=False,
        explorative=True,
        progress_bar=False,
        correlations={
            "auto": {"calculate": True},
            "pearson": {"calculate": True},
            "spearman": {"calculate": False},
            "kendall": {"calculate": False},
            "phi_k": {"calculate": False},
            "cramers": {"calculate": False},
        },
    )

    # Persist HTML report (useful for human review during a session)
    report.to_file(session_dir / "profile_report.html")

    # Persist full JSON (used by explorer.get_column_detail)
    profile_json_str = report.to_json()
    (session_dir / "profile.json").write_text(profile_json_str)

    profile_json = json.loads(profile_json_str)
    return _trim_profile_for_llm(profile_json, session_id)


def _trim_profile_for_llm(profile: dict, session_id: str) -> dict:
    """Extract a compact summary of the ydata-profiling output for the LLM.

    The investigation agent receives this on its first call; it uses explorer
    tools to drill into individual columns rather than receiving the full JSON.
    """
    table = profile.get("table", {})
    alerts = profile.get("alerts", [])
    variables = profile.get("variables", {})

    # Normalise alerts (structure varies between ydata-profiling versions)
    alert_list = []
    for a in alerts:
        if isinstance(a, dict):
            alert_list.append(
                {
                    "column": a.get("column_name", a.get("column", "")),
                    "type": a.get("alert_type", a.get("type", "")),
                    "description": str(a.get("description", "")),
                }
            )
        else:
            alert_list.append({"description": str(a)})

    # Per-column summary — type + missingness + cardinality + numeric range
    variables_summary = {}
    for col, info in variables.items():
        entry: dict = {
            "type": info.get("type", "Unknown"),
            "n_missing": info.get("n_missing", 0),
            "p_missing": round(float(info.get("p_missing") or 0), 4),
            "n_distinct": info.get("n_distinct", 0),
            "p_distinct": round(float(info.get("p_distinct") or 0), 4),
            "is_unique": bool(info.get("is_unique", False)),
        }
        if info.get("mean") is not None:

            def _safe_float(v):
                try:
                    f = float(v)
                    return None if f != f else round(f, 4)  # NaN guard
                except (TypeError, ValueError):
                    return None

            entry["mean"] = _safe_float(info.get("mean"))
            entry["std"] = _safe_float(info.get("std"))
            entry["min"] = info.get("min")
            entry["max"] = info.get("max")
            entry["skewness"] = _safe_float(info.get("skewness"))
            entry["n_zeros"] = info.get("n_zeros", 0)
        variables_summary[col] = entry

    # High correlations (|r| > 0.7) — useful signal for the overview
    high_correlations = []
    pearson = profile.get("correlations", {}).get("pearson", {})
    if isinstance(pearson, dict):
        seen: set = set()
        for col_a, pairs in pearson.items():
            if isinstance(pairs, dict):
                for col_b, val in pairs.items():
                    if col_a != col_b and (col_b, col_a) not in seen:
                        try:
                            r = float(val)
                            if abs(r) > 0.7:
                                high_correlations.append(
                                    {"col_a": col_a, "col_b": col_b, "r": round(r, 3)}
                                )
                                seen.add((col_a, col_b))
                        except (TypeError, ValueError):
                            pass

    return {
        "session_id": session_id,
        "table": {
            "n_rows": table.get("n"),
            "n_columns": table.get("n_var"),
            "n_cells_missing": table.get("n_cells_missing"),
            "p_cells_missing": table.get("p_cells_missing"),
            "n_duplicates": table.get("n_duplicates"),
            "column_types": table.get("types", {}),
        },
        "alerts": alert_list,
        "high_correlations": high_correlations,
        "variables_summary": variables_summary,
    }


def export_to_parquet(session_id: str) -> str:
    """Export working_data to output/sessions/{session_id}/cleaned_data.parquet."""
    out_dir = _output_dir(session_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "cleaned_data.parquet"

    con = duckdb.connect(str(_db_path(session_id)), read_only=False)
    try:
        con.execute(f"COPY working_data TO '{out_path}' (FORMAT PARQUET)")
    finally:
        con.close()

    return str(out_path)
