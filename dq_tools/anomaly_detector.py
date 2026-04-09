"""Anomaly detection module for the AI Data Quality Accelerator.

Supports z-score, IQR, and Isolation Forest methods. Results are categorised
by severity (critical / warning / informational) based on how many methods
flag each row.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb
import pandas as pd
from dq_tools.db import session_db_lock


def _find_project_root() -> Path:
    """Walk up from this file until ``pyproject.toml`` is found."""
    current = Path(__file__).resolve().parent
    while current != current.parent:
        if (current / "pyproject.toml").exists():
            return current
        current = current.parent
    raise FileNotFoundError("Could not locate project root (pyproject.toml not found).")


def _db_path(session_id: str) -> Path:
    return _find_project_root() / "data" / "sessions" / session_id / "working.duckdb"


def _detect_zscore(df: pd.DataFrame, numeric_cols: list[str]) -> dict[int, dict]:
    """Flag rows where |z-score| > 3 for at least one numeric column.

    Returns
    -------
    dict
        Mapping of row index → {cols_affected: list[str], scores: dict[str, float]}
    """
    flagged: dict[int, dict] = {}
    for col in numeric_cols:
        series = df[col].dropna()
        if series.empty or series.std() == 0:
            continue
        z = (df[col] - series.mean()) / series.std()
        outlier_mask = z.abs() > 3
        for idx in df.index[outlier_mask]:
            if idx not in flagged:
                flagged[idx] = {"cols_affected": [], "scores": {}}
            flagged[idx]["cols_affected"].append(col)
            flagged[idx]["scores"][col] = float(z.loc[idx])
    return flagged


def _detect_iqr(df: pd.DataFrame, numeric_cols: list[str]) -> dict[int, dict]:
    """Flag rows outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR] for any numeric column.

    Returns
    -------
    dict
        Mapping of row index → {cols_affected: list[str]}
    """
    flagged: dict[int, dict] = {}
    for col in numeric_cols:
        series = df[col].dropna()
        if series.empty:
            continue
        q1 = series.quantile(0.25)
        q3 = series.quantile(0.75)
        iqr = q3 - q1
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        outlier_mask = (df[col] < lower) | (df[col] > upper)
        for idx in df.index[outlier_mask & df[col].notna()]:
            if idx not in flagged:
                flagged[idx] = {"cols_affected": []}
            flagged[idx]["cols_affected"].append(col)
    return flagged


def _detect_isolation_forest(df: pd.DataFrame, numeric_cols: list[str]) -> dict[int, dict]:
    """Flag rows using sklearn IsolationForest on all numeric columns combined.

    Returns
    -------
    dict
        Mapping of row index → {score: float}
    """
    from sklearn.ensemble import IsolationForest

    sub = df[numeric_cols].dropna()
    if sub.empty or len(sub) < 10:
        return {}

    clf = IsolationForest(contamination=0.05, random_state=42)
    preds = clf.fit_predict(sub)
    scores = clf.decision_function(sub)  # more negative = more anomalous

    flagged: dict[int, dict] = {}
    for i, idx in enumerate(sub.index):
        if preds[i] == -1:  # anomaly
            flagged[idx] = {"score": float(scores[i])}
    return flagged


def detect(
    session_id: str,
    methods: list[str] | None = None,
    columns: list[str] | None = None,
) -> dict:
    """Detect anomalies in the session dataset using one or more statistical methods.

    Parameters
    ----------
    session_id:
        Unique identifier for the data-quality session.
    methods:
        Methods to apply. Defaults to ``["zscore", "iqr", "isolation_forest"]``.
    columns:
        Numeric columns to analyse. Defaults to all numeric columns.

    Returns
    -------
    dict
        ``{critical, warning, informational, flagged_count, total_rows}``
        where each severity bucket contains a list of
        ``{row_index, methods, columns_affected, values}`` entries.
    """
    if methods is None:
        methods = ["zscore", "iqr", "isolation_forest"]

    db = _db_path(session_id)
    with session_db_lock(session_id):
        con = duckdb.connect(str(db))
        try:
            df: pd.DataFrame = con.execute("SELECT * FROM working_data").fetchdf()
        finally:
            con.close()

    total_rows = len(df)

    if df.empty:
        return {
            "critical": [],
            "warning": [],
            "informational": [],
            "flagged_count": 0,
            "total_rows": total_rows,
        }

    # Determine numeric columns
    all_numeric = list(df.select_dtypes(include=["number"]).columns)
    numeric_cols = [c for c in (columns or all_numeric) if c in all_numeric]

    if not numeric_cols:
        return {
            "critical": [],
            "warning": [],
            "informational": [],
            "flagged_count": 0,
            "total_rows": total_rows,
        }

    # Run selected methods
    zscore_flags: dict[int, dict] = {}
    iqr_flags: dict[int, dict] = {}
    iforest_flags: dict[int, dict] = {}

    if "zscore" in methods:
        zscore_flags = _detect_zscore(df, numeric_cols)
    if "iqr" in methods:
        iqr_flags = _detect_iqr(df, numeric_cols)
    if "isolation_forest" in methods:
        try:
            iforest_flags = _detect_isolation_forest(df, numeric_cols)
        except ImportError:
            pass  # sklearn not available

    # Aggregate per row
    all_flagged_indices = set(zscore_flags) | set(iqr_flags) | set(iforest_flags)

    critical: list[dict] = []
    warning: list[dict] = []
    informational: list[dict] = []

    for idx in sorted(all_flagged_indices):
        row_methods: list[str] = []
        cols_affected: set[str] = set()
        iforest_score: float | None = None

        if idx in zscore_flags:
            row_methods.append("zscore")
            cols_affected.update(zscore_flags[idx].get("cols_affected", []))
        if idx in iqr_flags:
            row_methods.append("iqr")
            cols_affected.update(iqr_flags[idx].get("cols_affected", []))
        if idx in iforest_flags:
            row_methods.append("isolation_forest")
            iforest_score = iforest_flags[idx].get("score")

        # Row values for context
        row_values: dict[str, Any] = {}
        try:
            row_values = df.loc[idx, list(cols_affected)].to_dict() if cols_affected else {}
            # Make JSON-serialisable
            row_values = {k: (None if pd.isna(v) else v) for k, v in row_values.items()}
        except Exception:
            pass

        entry = {
            "row_index": int(idx),
            "methods": row_methods,
            "columns_affected": sorted(cols_affected),
            "values": row_values,
        }
        if iforest_score is not None:
            entry["isolation_score"] = iforest_score

        method_count = len(row_methods)
        if method_count >= 2:
            critical.append(entry)
        elif method_count == 1:
            # "high score" heuristic: if the only flagging method is isolation_forest with
            # a very negative score, or zscore with |z| > 5 for any col, treat as warning
            is_high_score = False
            if "isolation_forest" in row_methods and iforest_score is not None:
                is_high_score = iforest_score < -0.2
            if "zscore" in row_methods:
                zscore_vals = zscore_flags.get(idx, {}).get("scores", {})
                if any(abs(v) > 5 for v in zscore_vals.values()):
                    is_high_score = True

            if is_high_score:
                warning.append(entry)
            else:
                informational.append(entry)

    flagged_count = len(critical) + len(warning) + len(informational)

    return {
        "critical": critical,
        "warning": warning,
        "informational": informational,
        "flagged_count": flagged_count,
        "total_rows": total_rows,
    }
