"""Transformation executor for the AI Data Quality Accelerator.

Applies pre-built and custom DataFrame transformations to the session's
working dataset, with preview support and an append-only transformation log.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import builtins

import duckdb
import numpy as np
import pandas as pd

# Use the full builtins module — the real security boundary is _UNSAFE_PATTERNS
# in the advisor (blocks import, open, os, sys, subprocess, eval, exec).
# A curated subset just breaks legitimate pandas/numpy code.
_SAFE_BUILTINS = vars(builtins)


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


def _log_path(session_id: str) -> Path:
    return _session_dir(session_id) / "transformation_log.json"


def _load_df(session_id: str) -> pd.DataFrame:
    db = _db_path(session_id)
    con = duckdb.connect(str(db))
    try:
        df = con.execute("SELECT * FROM working_data").fetchdf()
    finally:
        con.close()
    return df


def _write_df(session_id: str, df: pd.DataFrame) -> None:
    db = _db_path(session_id)
    con = duckdb.connect(str(db))
    try:
        con.execute("DROP TABLE IF EXISTS working_data")
        con.execute("CREATE TABLE working_data AS SELECT * FROM df")
    finally:
        con.close()


def _apply_transform(df: pd.DataFrame, spec: dict) -> tuple[pd.DataFrame, int]:
    """Apply a single transformation spec to *df* and return (new_df, affected_row_count).

    The original DataFrame is not modified.

    Parameters
    ----------
    df:
        Source DataFrame.
    spec:
        Transformation specification dict with at minimum a ``type`` key.

    Returns
    -------
    tuple
        ``(transformed_df, affected_row_count)``
    """
    t_type = spec.get("type", "")
    params = spec.get("params", {})
    new_df = df.copy()
    affected = 0

    # ------------------------------------------------------------------
    if t_type == "date_format_cast":
        cols: list[str] = params.get("columns", [])
        from_format: str = params.get("from_format", "%Y-%m-%d")
        for col in cols:
            if col not in new_df.columns:
                continue
            before_nulls = new_df[col].isna().sum()
            new_df[col] = pd.to_datetime(new_df[col], format=from_format, errors="coerce").dt.date
            after_nulls = new_df[col].isna().sum()
            affected += int((new_df[col].notna()).sum())
            _ = after_nulls - before_nulls  # newly nulled rows (coerce failures)

    # ------------------------------------------------------------------
    elif t_type == "null_invalid":
        col: str = params.get("column", "")
        pattern: str = params.get("pattern", "")
        if col and col in new_df.columns and pattern:
            mask = new_df[col].astype(str).str.match(pattern, na=False) | new_df[col].isna()
            invalid_mask = ~mask
            affected = int(invalid_mask.sum())
            new_df.loc[invalid_mask, col] = None

    # ------------------------------------------------------------------
    elif t_type == "filter_rows":
        col = params.get("column", "")
        operator = params.get("operator", "eq")
        value = params.get("value")
        if col and col in new_df.columns:
            before_len = len(new_df)
            col_series = new_df[col]
            if operator == "eq":
                keep_mask = col_series != value
            elif operator == "ne":
                keep_mask = col_series == value
            elif operator == "in":
                keep_mask = ~col_series.isin(value if isinstance(value, list) else [value])
            elif operator == "not_in":
                keep_mask = col_series.isin(value if isinstance(value, list) else [value])
            elif operator == "lt":
                keep_mask = col_series >= value
            elif operator == "gt":
                keep_mask = col_series <= value
            elif operator == "lte":
                keep_mask = col_series > value
            elif operator == "gte":
                keep_mask = col_series < value
            else:
                keep_mask = pd.Series([True] * len(new_df), index=new_df.index)
            new_df = new_df[keep_mask].reset_index(drop=True)
            affected = before_len - len(new_df)

    # ------------------------------------------------------------------
    elif t_type == "winsorize":
        col = params.get("column", "")
        if col and col in new_df.columns:
            cap_value = params.get("cap_value")
            percentile = params.get("percentile")
            if percentile is not None:
                cap_value = new_df[col].quantile(float(percentile))
            if cap_value is not None:
                mask = new_df[col] > cap_value
                affected = int(mask.sum())
                new_df.loc[mask, col] = cap_value

    # ------------------------------------------------------------------
    elif t_type == "impute_constant":
        col = params.get("column", "")
        fill_value = params.get("value")
        if col and col in new_df.columns:
            mask = new_df[col].isna()
            affected = int(mask.sum())
            new_df.loc[mask, col] = fill_value

    # ------------------------------------------------------------------
    elif t_type == "impute_mode":
        col = params.get("column", "")
        if col and col in new_df.columns:
            mode_vals = new_df[col].mode()
            if not mode_vals.empty:
                mode_val = mode_vals.iloc[0]
                mask = new_df[col].isna()
                affected = int(mask.sum())
                new_df.loc[mask, col] = mode_val

    # ------------------------------------------------------------------
    elif t_type == "deduplicate":
        subset: list[str] | None = params.get("subset_columns") or None
        # Filter subset to existing columns
        if subset:
            subset = [c for c in subset if c in new_df.columns] or None
        before_len = len(new_df)
        new_df = new_df.drop_duplicates(subset=subset).reset_index(drop=True)
        affected = before_len - len(new_df)

    # ------------------------------------------------------------------
    elif t_type == "type_cast":
        col = params.get("column", "")
        to_type: str = params.get("to_type", "str")
        if col and col in new_df.columns:
            type_map = {
                "str": str,
                "string": str,
                "int": "Int64",
                "integer": "Int64",
                "float": float,
                "double": float,
                "bool": bool,
                "boolean": bool,
                "date": "datetime64[ns]",
            }
            target = type_map.get(to_type.lower(), to_type)
            try:
                if target == "datetime64[ns]":
                    new_df[col] = pd.to_datetime(new_df[col], errors="coerce")
                elif target in ("Int64",):
                    new_df[col] = pd.to_numeric(new_df[col], errors="coerce").astype(target)
                else:
                    new_df[col] = new_df[col].astype(target, errors="ignore")
                affected = int(new_df[col].notna().sum())
            except Exception:
                pass

    # ------------------------------------------------------------------
    elif t_type == "standardize_string":
        col = params.get("column", "")
        lowercase: bool = params.get("lowercase", False)
        strip: bool = params.get("strip", True)
        replace_pattern: str | None = params.get("replace_pattern")
        replace_with: str | None = params.get("replace_with", "")
        if col and col in new_df.columns:
            original = new_df[col].copy()
            s = new_df[col].astype(str)
            if strip:
                s = s.str.strip()
            if lowercase:
                s = s.str.lower()
            if replace_pattern:
                s = s.str.replace(replace_pattern, replace_with or "", regex=True)
            new_df[col] = s
            affected = int((new_df[col] != original.astype(str)).sum())

    # ------------------------------------------------------------------
    elif t_type == "custom":
        code: str = params.get("code") or spec.get("custom_code", "")
        if code:
            local_ns: dict = {}
            try:
                exec(code, {"pd": pd, "np": np, "__builtins__": _SAFE_BUILTINS}, local_ns)  # noqa: S102
                transform_fn = local_ns.get("transform")
                if callable(transform_fn):
                    before_hash = pd.util.hash_pandas_object(new_df).sum()
                    new_df = transform_fn(new_df)
                    after_hash = pd.util.hash_pandas_object(new_df).sum()
                    affected = len(new_df) if before_hash != after_hash else 0
            except Exception as exc:
                raise ValueError(f"Custom transform execution failed: {exc}") from exc

    # ------------------------------------------------------------------
    else:
        raise ValueError(f"Unknown transformation type: {t_type!r}")

    return new_df, affected


def _score_df_with_rules(df: pd.DataFrame, rules: list[dict]) -> float:
    """Compute a composite quality score for *df* against *rules* using pandas.

    This is a lightweight replica of the rule engine that works on an in-memory
    DataFrame (no DuckDB round-trip) for preview purposes.
    """
    if not rules or df.empty:
        return 1.0

    category_results: dict[str, list[int]] = {
        "validity": [],
        "completeness": [],
        "uniqueness": [],
    }
    weights = {"validity": 0.4, "completeness": 0.4, "uniqueness": 0.2}
    total = len(df)

    for rule in rules:
        check = rule.get("check")
        col = rule.get("column")
        cat = rule.get("category", "validity")
        threshold = float(rule.get("threshold", 0.0))

        try:
            if check == "not_null" and col and col in df.columns:
                fail_rate = df[col].isna().sum() / total
            elif check == "regex_match" and col and col in df.columns:
                pattern = rule.get("pattern", "")
                fail_rate = (~df[col].astype(str).str.match(pattern, na=False)).sum() / total
            elif check == "unique" and col and col in df.columns:
                fail_rate = df[col].duplicated(keep=False).sum() / total
            elif check == "value_in_set" and col and col in df.columns:
                values = rule.get("values", [])
                fail_rate = (~df[col].astype(str).isin([str(v) for v in values])).sum() / total
            elif check == "range" and col and col in df.columns:
                s = pd.to_numeric(df[col], errors="coerce")
                min_v = rule.get("min")
                max_v = rule.get("max")
                mask = pd.Series([False] * total, index=df.index)
                if min_v is not None:
                    mask |= s < min_v
                if max_v is not None:
                    mask |= s > max_v
                fail_rate = mask.sum() / total
            elif check == "cross_column_order":
                col_a = rule.get("col_a")
                col_b = rule.get("col_b")
                if col_a in df.columns and col_b in df.columns:
                    fail_rate = (df[col_a] > df[col_b]).sum() / total
                else:
                    continue
            else:
                continue
        except Exception:
            continue

        passed = 1 if fail_rate <= threshold else 0
        if cat in category_results:
            category_results[cat].append(passed)

    category_scores: dict[str, float] = {}
    for cat, results in category_results.items():
        if results:
            category_scores[cat] = sum(results) / len(results)
        else:
            category_scores[cat] = 1.0

    return sum(category_scores.get(c, 1.0) * w for c, w in weights.items())


_ROW_REMOVING_TRANSFORMS = {"filter_rows", "deduplicate"}


def _get_preview_indices(
    df: pd.DataFrame,
    transformation_spec: dict,
    approved_rules: list[dict] | None,
) -> list:
    """Return up to 3 failing-row indices + up to 2 passing-row indices for preview.

    Selects rows relevant to *transformation_spec*'s target column by evaluating
    *approved_rules* against the DataFrame. Falls back to ``df.head(5).index``
    when no relevant rules exist or no failures are found.
    """
    fallback = df.head(5).index.tolist()

    if not approved_rules or df.empty:
        return fallback

    col = (
        transformation_spec.get("column")
        or transformation_spec.get("params", {}).get("column")
    )
    # Note: multi-column transforms (e.g. date_format_cast uses params.columns list)
    # will have col=None here and fall back to head(5). Single-column transforms
    # (the majority) are fully supported.
    relevant_rules = [r for r in approved_rules if r.get("column") == col] if col else []
    if not relevant_rules:
        return fallback

    fail_mask = pd.Series(False, index=df.index)
    for rule in relevant_rules:
        r_col = rule.get("column")
        if not r_col or r_col not in df.columns:
            continue
        try:
            check = rule.get("check")
            if check == "not_null":
                fail_mask |= df[r_col].isna()
            elif check == "regex_match":
                pattern = rule.get("pattern", "")
                # str.match anchors at the start only (not a full match), consistent
                # with _score_df_with_rules — patterns should use ^ and $ anchors
                fail_mask |= ~df[r_col].astype(str).str.match(pattern, na=False)
            elif check == "value_in_set":
                values = rule.get("values", [])
                fail_mask |= ~df[r_col].astype(str).isin([str(v) for v in values])
            elif check == "range":
                s = pd.to_numeric(df[r_col], errors="coerce")
                min_v, max_v = rule.get("min"), rule.get("max")
                if min_v is not None:
                    fail_mask |= s < float(min_v)
                if max_v is not None:
                    fail_mask |= s > float(max_v)
            elif check == "unique":
                fail_mask |= df[r_col].duplicated(keep=False)
        except Exception:
            continue

    failing = df[fail_mask]
    passing = df[~fail_mask]

    # Deduplicate failing rows by target column value → unique failure cases only
    if col and col in df.columns:
        failing = failing.drop_duplicates(subset=[col])

    failing_indices = failing.head(3).index.tolist()

    # No failures found → fall back to head(5) so the sample isn't unexpectedly short
    if not failing_indices:
        return fallback

    passing_indices = passing.head(2).index.tolist()
    return failing_indices + passing_indices


def validate_transform_spec(
    transformation_spec: dict,
    sample_df: pd.DataFrame,
) -> tuple[bool, str | None]:
    """Validate a built-in transformation spec against a sample DataFrame.

    Checks that referenced columns exist and that the transform executes without error.
    ``_apply_transform`` silently ignores missing columns, so this function performs
    explicit column-existence checks before delegating to the transform runner.

    Returns
    -------
    tuple[bool, str | None]
        ``(True, None)`` if valid; ``(False, error_message)`` if invalid.
    """
    params = transformation_spec.get("params", {})
    available = list(sample_df.columns)

    # Single-column transforms (most types: impute_*, null_invalid, winsorize, etc.)
    col = transformation_spec.get("column") or params.get("column")
    if col and col not in sample_df.columns:
        return False, f"Column '{col}' not found. Available columns: {available}"

    # date_format_cast uses params.columns (list)
    multi_cols = params.get("columns") or []
    missing_multi = [c for c in multi_cols if c not in sample_df.columns]
    if missing_multi:
        return False, f"Columns not found: {missing_multi}. Available columns: {available}"

    # deduplicate uses params.subset_columns (optional list)
    subset_cols = params.get("subset_columns") or []
    missing_subset = [c for c in subset_cols if c not in sample_df.columns]
    if missing_subset:
        return False, f"Subset columns not found: {missing_subset}. Available columns: {available}"

    # Try running the transform to catch unknown types and operation errors
    try:
        _apply_transform(sample_df.copy(), transformation_spec)
        return True, None
    except Exception as exc:
        return False, str(exc)


def preview(
    session_id: str,
    transformation_spec: dict,
    approved_rules: list[dict] | None = None,
) -> dict:
    """Preview the effect of a transformation without persisting changes.

    Parameters
    ----------
    session_id:
        Unique identifier for the data-quality session.
    transformation_spec:
        Transformation specification dict.
    approved_rules:
        If supplied, re-scores the transformed data against these rules and
        returns projected score information.

    Returns
    -------
    dict
        ``{before_sample, after_sample, affected_row_count,
           projected_score, projected_score_delta}``
    """
    df = _load_df(session_id)

    sample_indices = _get_preview_indices(df, transformation_spec, approved_rules)
    before_sample = df.loc[sample_indices].replace({np.nan: None}).to_dict(orient="records")

    try:
        new_df, affected = _apply_transform(df, transformation_spec)
    except Exception as exc:
        return {
            "before_sample": before_sample,
            "after_sample": before_sample,
            "affected_row_count": 0,
            "projected_score": None,
            "projected_score_delta": None,
            "error": str(exc),
        }

    t_type = transformation_spec.get("type", "")
    if t_type in _ROW_REMOVING_TRANSFORMS:
        after_sample = new_df.head(5).replace({np.nan: None}).to_dict(orient="records")
    else:
        existing = [i for i in sample_indices if i in new_df.index]
        after_sample = new_df.loc[existing].replace({np.nan: None}).to_dict(orient="records")

    projected_score: float | None = None
    projected_score_delta: float | None = None

    if approved_rules:
        # Baseline score on original df
        baseline = _score_df_with_rules(df, approved_rules)
        projected_score = _score_df_with_rules(new_df, approved_rules)
        projected_score_delta = projected_score - baseline

    return {
        "before_sample": before_sample,
        "after_sample": after_sample,
        "affected_row_count": affected,
        "projected_score": projected_score,
        "projected_score_delta": projected_score_delta,
    }


def apply_transformation(session_id: str, transformation_spec: dict) -> dict:
    """Apply a transformation to the session dataset and persist the result.

    Idempotent: if ``transformation_spec["id"]`` is already in the on-disk log
    the function returns the previously-recorded result without re-applying the
    transform.  This makes it safe to retry inside Temporal activities.

    Parameters
    ----------
    session_id:
        Unique identifier for the data-quality session.
    transformation_spec:
        Transformation specification dict.  Must contain an ``id`` key that is
        stable across retries (set by the workflow before calling this function).

    Returns
    -------
    dict
        ``{affected_rows, row_count_before, row_count_after, already_applied}``
    """
    tid = transformation_spec.get("id") or str(uuid.uuid4())

    # Idempotency check — skip if already recorded in the on-disk log
    log = load_transformation_log(session_id)
    for entry in log:
        if entry.get("id") == tid:
            return {
                "affected_rows": entry.get("affected_rows", 0),
                "row_count_before": entry.get("row_count_before", 0),
                "row_count_after": entry.get("row_count_after", 0),
                "already_applied": True,
            }

    df = _load_df(session_id)
    row_count_before = len(df)

    new_df, affected = _apply_transform(df, transformation_spec)
    row_count_after = len(new_df)

    _write_df(session_id, new_df)

    log_entry = {
        "id": tid,
        "type": transformation_spec.get("type"),
        "params": transformation_spec.get("params", {}),
        "affected_rows": affected,
        "row_count_before": row_count_before,
        "row_count_after": row_count_after,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "status": "applied",
    }
    log.append(log_entry)
    log_path = _log_path(session_id)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(log, indent=2, default=str))

    return {
        "affected_rows": affected,
        "row_count_before": row_count_before,
        "row_count_after": row_count_after,
        "already_applied": False,
    }


def load_transformation_log(session_id: str) -> list[dict]:
    """Load the transformation log for a session.

    Parameters
    ----------
    session_id:
        Unique identifier for the data-quality session.

    Returns
    -------
    list[dict]
        Ordered list of transformation log entries, or an empty list if none.
    """
    log_path = _log_path(session_id)
    if not log_path.exists():
        return []
    try:
        raw = json.loads(log_path.read_text())
        if isinstance(raw, list):
            return raw
    except Exception:
        pass
    return []
