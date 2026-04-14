"""Cross-column explorer tools for deep investigation.

Four read-only functions that reveal multi-column data quality patterns.
All accept session_id and operate on that session's working.duckdb.
"""
from __future__ import annotations
from typing import Optional
from pathlib import Path
import pandas as pd


def _find_project_root() -> Path:
    p = Path(__file__).resolve().parent
    while p != p.parent:
        if (p / "pyproject.toml").exists():
            return p
        p = p.parent
    return Path(".")


def _load_df(session_id: str) -> pd.DataFrame:
    from dq_tools.explorer import _load_df as _explorer_load_df
    return _explorer_load_df(session_id)


def group_over_time(
    session_id: str,
    group_col: str,
    time_col: str,
    bins: int = 10,
) -> dict:
    """Track how categorical values in group_col change across time_col bins.

    Returns {bin_label: [{value, count}]}. Detects renames, retirements,
    and structural shifts over time (e.g. a category renamed mid-dataset).
    """
    df = _load_df(session_id)
    for col in (group_col, time_col):
        if col not in df.columns:
            return {"error": f"Column '{col}' not found. Available: {list(df.columns)}"}
    try:
        time_series = pd.to_datetime(df[time_col], errors="coerce")
    except Exception as e:
        return {"error": f"Could not parse '{time_col}' as datetime: {e}"}
    valid_mask = time_series.notna()
    if valid_mask.sum() == 0:
        return {"error": f"Column '{time_col}' has no parseable datetime values"}
    try:
        time_bins = pd.cut(time_series[valid_mask], bins=bins)
    except Exception as e:
        return {"error": f"Could not bin '{time_col}': {e}"}
    df_valid = df[valid_mask].copy()
    df_valid["_time_bin"] = time_bins
    result: dict = {}
    for bin_label, group in df_valid.groupby("_time_bin", observed=True):
        vc = group[group_col].value_counts(dropna=False)
        result[str(bin_label)] = [
            {"value": str(v), "count": int(c)} for v, c in vc.items()
        ]
    return {
        "group_col": group_col,
        "time_col": time_col,
        "bins": len(result),
        "null_time_count": int((~valid_mask).sum()),
        "distribution": result,
    }


def find_correlated_nulls(session_id: str, threshold: float = 0.3) -> dict:
    """Find column pairs whose null patterns are correlated above threshold.

    Computes the phi coefficient (Pearson on binary null indicators) between
    every column pair. Returns pairs where |phi| >= threshold, sorted by strength.
    Detects systematic missingness that single-column profiling cannot surface.
    """
    df = _load_df(session_id)
    null_df = df.isnull().astype(int)
    has_nulls = null_df.columns[null_df.sum() > 0].tolist()
    if len(has_nulls) < 2:
        return {"pairs": [], "note": "Fewer than 2 columns have null values"}
    null_df = null_df[has_nulls]
    corr = null_df.corr()
    pairs = []
    cols = list(corr.columns)
    for i, col_a in enumerate(cols):
        for col_b in cols[i + 1:]:
            phi = corr.loc[col_a, col_b]
            if abs(phi) >= threshold:
                both_null = int((null_df[col_a] & null_df[col_b]).sum())
                pairs.append({
                    "col_a": col_a,
                    "col_b": col_b,
                    "phi": round(float(phi), 4),
                    "null_count_a": int(null_df[col_a].sum()),
                    "null_count_b": int(null_df[col_b].sum()),
                    "both_null_count": both_null,
                    "total_rows": len(df),
                })
    pairs.sort(key=lambda p: abs(p["phi"]), reverse=True)
    return {"threshold": threshold, "pairs": pairs, "columns_with_nulls": has_nulls}


def pairwise_profile(session_id: str, col_a: str, col_b: str) -> dict:
    """Cross-column profile for any column pair.

    Dispatches by dtype:
    - Both numeric: Pearson correlation + scatter quantiles per decile of col_a
    - Both categorical/text: frequency cross-tab (top 10 values each)
    - Mixed: group stats for numeric col grouped by categorical col values
    """
    df = _load_df(session_id)
    for col in (col_a, col_b):
        if col not in df.columns:
            return {"error": f"Column '{col}' not found. Available: {list(df.columns)}"}

    def _is_num(s: pd.Series) -> bool:
        return pd.api.types.is_numeric_dtype(s)

    a_num, b_num = _is_num(df[col_a]), _is_num(df[col_b])
    if a_num and b_num:
        valid = df[[col_a, col_b]].dropna()
        if len(valid) < 2:
            return {"error": "Not enough non-null rows for numeric comparison"}
        corr = float(valid[col_a].corr(valid[col_b]))
        valid = valid.copy()
        valid["_d"] = pd.qcut(valid[col_a], q=10, duplicates="drop")
        scatter = []
        for label, grp in valid.groupby("_d", observed=True):
            scatter.append({
                "col_a_range": str(label),
                "col_b_mean": round(float(grp[col_b].mean()), 4),
                "col_b_p25": round(float(grp[col_b].quantile(0.25)), 4),
                "col_b_p75": round(float(grp[col_b].quantile(0.75)), 4),
                "count": len(grp),
            })
        return {"type": "numeric_vs_numeric", "col_a": col_a, "col_b": col_b,
                "correlation": round(corr, 4), "n_valid": len(valid),
                "scatter_by_decile": scatter}
    elif not a_num and not b_num:
        top_a = df[col_a].value_counts().head(10).index.tolist()
        top_b = df[col_b].value_counts().head(10).index.tolist()
        filt = df[df[col_a].isin(top_a) & df[col_b].isin(top_b)]
        xtab = pd.crosstab(filt[col_a], filt[col_b])
        return {"type": "categorical_vs_categorical", "col_a": col_a, "col_b": col_b,
                "note": "Top 10 values of each column", "crosstab": xtab.to_dict()}
    else:
        cat_col, num_col = (col_a, col_b) if not a_num else (col_b, col_a)
        top_cats = df[cat_col].value_counts().head(15).index.tolist()
        filt = df[df[cat_col].isin(top_cats)][[cat_col, num_col]].dropna()
        stats = filt.groupby(cat_col)[num_col].agg(
            count="count", mean="mean", std="std",
            p25=lambda x: x.quantile(0.25),
            p75=lambda x: x.quantile(0.75),
        ).reset_index()
        null_rates = {
            str(cat): round(float(df.loc[df[cat_col] == cat, num_col].isnull().mean()), 4)
            for cat in top_cats
        }
        rows = []
        for _, row in stats.iterrows():
            rows.append({
                "category": str(row[cat_col]),
                "count": int(row["count"]),
                "mean": round(float(row["mean"]), 4),
                "std": round(float(row["std"]), 4),
                "p25": round(float(row["p25"]), 4),
                "p75": round(float(row["p75"]), 4),
                "null_rate": null_rates.get(str(row[cat_col]), 0.0),
            })
        return {"type": "categorical_vs_numeric", "cat_col": cat_col,
                "num_col": num_col, "group_stats": rows}


def compute_correlation_matrix(
    session_id: str,
    columns: Optional[list[str]] = None,
) -> dict:
    """Pearson correlation matrix for numeric columns.

    When columns=None, auto-selects all numeric columns (capped at 20).
    Returns {col_a: {col_b: coefficient}} plus a top_pairs list sorted by
    absolute correlation strength.
    """
    df = _load_df(session_id)
    if columns is not None:
        missing = [c for c in columns if c not in df.columns]
        if missing:
            return {"error": f"Columns not found: {missing}"}
        numeric_cols = [c for c in columns if pd.api.types.is_numeric_dtype(df[c])]
    else:
        numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])][:20]
    if len(numeric_cols) < 2:
        return {"error": f"Need ≥ 2 numeric columns. Found: {numeric_cols}"}
    corr_m = df[numeric_cols].corr()
    matrix = {
        col: {
            other: round(float(corr_m.loc[col, other]), 4)
            for other in numeric_cols if other != col
        }
        for col in numeric_cols
    }
    seen: set = set()
    top_pairs = []
    for col_a in numeric_cols:
        for col_b in numeric_cols:
            if col_a == col_b:
                continue
            key = tuple(sorted([col_a, col_b]))
            if key in seen:
                continue
            seen.add(key)
            c = float(corr_m.loc[col_a, col_b])
            if not pd.isna(c):
                top_pairs.append({"col_a": col_a, "col_b": col_b, "correlation": round(c, 4)})
    top_pairs.sort(key=lambda p: abs(p["correlation"]), reverse=True)
    return {"columns": numeric_cols, "matrix": matrix, "top_pairs": top_pairs[:20]}
