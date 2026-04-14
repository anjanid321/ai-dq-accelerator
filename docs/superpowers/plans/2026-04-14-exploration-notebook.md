# Exploration Notebook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a human-in-the-loop exploration review step between investigation and rule proposal — the agent explores data deeply (including cross-column patterns), generates a pre-executed notebook served as browser HTML, and the user can approve or submit free-form feedback for up to 2 targeted re-investigation rounds.

**Architecture:** New cross-column tools in `dq_tools/cross_column.py` are registered on the deep agent. After investigation, `structure_findings_node` extracts `ExplorationFindings` JSON (raw `investigation_findings` text travels alongside it everywhere as a fidelity safeguard). The notebook generator uses both to render per-column sections, cross-column findings, and a raw notes appendix via `nbformat` + `nbconvert`. The Temporal workflow splits the old monolithic `PROFILING` activity into `profile_and_investigate_activity` + `synthesize_and_propose_activity` with a new `AWAITING_INVESTIGATION_REVIEW` pause and optional `REINVESTIGATING` rounds in between. When synthesis proceeds without user approval, `synthesis_constrained=True` is flagged and unresolved questions are surfaced at rule approval time.

**Tech Stack:** Python 3.11, DuckDB, pandas, numpy, matplotlib (Agg), nbformat, nbconvert, ipykernel, LangGraph, deepagents, anthropic SDK, Temporal, FastAPI

**Spec:** `docs/superpowers/specs/2026-04-14-exploration-notebook-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `dq_tools/cross_column.py` | CREATE | Four cross-column explorer functions |
| `tests/dq_tools/test_cross_column.py` | CREATE | Unit tests for cross_column tools |
| `backend/agents/state.py` | MODIFY | Four new fields on ProfileAnalyzerState |
| `backend/agents/prompts.py` | MODIFY | STRUCTURE_FINDINGS_SYSTEM (new) + PROFILE_INVESTIGATION_SYSTEM (add cross-column mandate) |
| `backend/agents/graphs/profile_analyzer.py` | MODIFY | Add structure_findings_node, update graph and run_profile_analyzer |
| `tests/backend/agents/test_structure_findings.py` | CREATE | Unit tests for structure_findings_node |
| `backend/agents/graphs/deep_investigate.py` | MODIFY | Add dq_* wrappers for 4 new tools; re-investigation context injection |
| `backend/agents/graphs/exploration_notebook.py` | CREATE | Notebook builder + generator |
| `tests/backend/agents/test_exploration_notebook.py` | CREATE | Unit tests for notebook structure |
| `backend/temporal/activities/investigation_activities.py` | CREATE | profile_and_investigate, synthesize_and_propose, reinvestigate activities |
| `backend/temporal/activities/data_activities.py` | MODIFY | Remove profile_and_analyze_activity and its sync helper |
| `backend/temporal/worker.py` | MODIFY | Swap activity registrations |
| `backend/temporal/workflows/dq_workflow.py` | MODIFY | New state fields, signal, query, stages, re-investigation loop, constrained synthesis |
| `backend/api/schemas.py` | MODIFY | Three new WorkflowStage values, new request/response models |
| `backend/api/routers/exploration.py` | CREATE | Four new exploration endpoints |
| `backend/api/main.py` | MODIFY | Register exploration router |

---

## Task 1: Cross-column explorer tools

**Files:**
- Create: `dq_tools/cross_column.py`
- Create: `tests/dq_tools/test_cross_column.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/dq_tools/test_cross_column.py
import uuid
import duckdb
import pandas as pd
import pytest
from datetime import datetime, timedelta
from pathlib import Path


@pytest.fixture
def session_id(tmp_path, monkeypatch):
    """DuckDB session with known cross-column patterns."""
    sid = str(uuid.uuid4())
    n = 100
    dates = [datetime(2023, 1, 1) + timedelta(days=i * 3) for i in range(n)]
    employee_groups = ["Field-Ops"] * 50 + ["FieldOperations"] * 50
    departments = (["Office"] * 30 + ["Remote"] * 20) * 2
    emails = [None if departments[i] == "Remote" else f"u{i}@x.com" for i in range(n)]
    salaries = [30000 + i * 500 for i in range(n)]
    ages = [22 + i // 3 for i in range(n)]

    df = pd.DataFrame({
        "HireDate": dates,
        "EmployeeGroup": employee_groups,
        "Department": departments,
        "Email": emails,
        "Salary": salaries,
        "Age": ages,
    })

    # Patch _find_project_root to point at tmp_path
    from dq_tools import explorer as explorer_mod
    monkeypatch.setattr(explorer_mod, "_find_project_root", lambda: tmp_path)

    import dq_tools.cross_column as cc_mod
    monkeypatch.setattr(cc_mod, "_find_project_root", lambda: tmp_path)

    session_dir = tmp_path / "data" / "sessions" / sid
    session_dir.mkdir(parents=True)
    db_path = session_dir / "working.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute("CREATE TABLE working_data AS SELECT * FROM df")
    con.close()
    return sid


class TestGroupOverTime:
    def test_detects_value_set_change(self, session_id):
        from dq_tools.cross_column import group_over_time
        result = group_over_time(session_id, "EmployeeGroup", "HireDate", bins=4)
        assert "distribution" in result
        bins = list(result["distribution"].items())
        early_vals = {item["value"] for item in bins[0][1]}
        late_vals = {item["value"] for item in bins[-1][1]}
        assert "Field-Ops" in early_vals
        assert "FieldOperations" in late_vals

    def test_missing_column_returns_error(self, session_id):
        from dq_tools.cross_column import group_over_time
        result = group_over_time(session_id, "NoSuchCol", "HireDate")
        assert "error" in result

    def test_non_datetime_column_returns_error(self, session_id):
        from dq_tools.cross_column import group_over_time
        result = group_over_time(session_id, "EmployeeGroup", "Department")
        assert "error" in result


class TestFindCorrelatedNulls:
    def test_finds_pairs(self, session_id):
        from dq_tools.cross_column import find_correlated_nulls
        result = find_correlated_nulls(session_id, threshold=0.0)
        assert "pairs" in result
        assert isinstance(result["pairs"], list)

    def test_phi_in_range(self, session_id):
        from dq_tools.cross_column import find_correlated_nulls
        result = find_correlated_nulls(session_id, threshold=0.0)
        for pair in result["pairs"]:
            assert -1.0 <= pair["phi"] <= 1.0

    def test_threshold_filters(self, session_id):
        from dq_tools.cross_column import find_correlated_nulls
        low = find_correlated_nulls(session_id, threshold=0.0)
        high = find_correlated_nulls(session_id, threshold=0.99)
        assert len(low["pairs"]) >= len(high["pairs"])


class TestPairwiseProfile:
    def test_numeric_vs_numeric(self, session_id):
        from dq_tools.cross_column import pairwise_profile
        result = pairwise_profile(session_id, "Salary", "Age")
        assert result["type"] == "numeric_vs_numeric"
        assert result["correlation"] > 0

    def test_categorical_vs_categorical(self, session_id):
        from dq_tools.cross_column import pairwise_profile
        result = pairwise_profile(session_id, "EmployeeGroup", "Department")
        assert result["type"] == "categorical_vs_categorical"
        assert "crosstab" in result

    def test_mixed(self, session_id):
        from dq_tools.cross_column import pairwise_profile
        result = pairwise_profile(session_id, "Department", "Salary")
        assert result["type"] == "categorical_vs_numeric"
        assert len(result["group_stats"]) > 0

    def test_missing_column_error(self, session_id):
        from dq_tools.cross_column import pairwise_profile
        result = pairwise_profile(session_id, "NoCol", "Salary")
        assert "error" in result


class TestComputeCorrelationMatrix:
    def test_returns_matrix(self, session_id):
        from dq_tools.cross_column import compute_correlation_matrix
        result = compute_correlation_matrix(session_id)
        assert "matrix" in result
        assert "Salary" in result["matrix"]
        assert "Age" in result["matrix"]["Salary"]

    def test_salary_age_positive(self, session_id):
        from dq_tools.cross_column import compute_correlation_matrix
        result = compute_correlation_matrix(session_id, columns=["Salary", "Age"])
        assert result["matrix"]["Salary"]["Age"] > 0

    def test_specific_columns(self, session_id):
        from dq_tools.cross_column import compute_correlation_matrix
        result = compute_correlation_matrix(session_id, columns=["Salary", "Age"])
        assert set(result["columns"]) == {"Salary", "Age"}

    def test_missing_column_error(self, session_id):
        from dq_tools.cross_column import compute_correlation_matrix
        result = compute_correlation_matrix(session_id, columns=["NoCol"])
        assert "error" in result
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/dq_tools/test_cross_column.py -v
```
Expected: `ModuleNotFoundError: No module named 'dq_tools.cross_column'`

- [ ] **Step 3: Implement `dq_tools/cross_column.py`**

```python
"""Cross-column explorer tools for deep investigation.

Four read-only functions that reveal multi-column data quality patterns.
All accept session_id and operate on that session's working.duckdb.
"""
from __future__ import annotations
from typing import Optional
from pathlib import Path
import pandas as pd
import numpy as np


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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/dq_tools/test_cross_column.py -v
```
Expected: all 14 tests PASS

- [ ] **Step 5: Commit**

```bash
git add dq_tools/cross_column.py tests/dq_tools/test_cross_column.py
git commit -m "feat: add cross-column explorer tools (group_over_time, find_correlated_nulls, pairwise_profile, compute_correlation_matrix)"
```

---

## Task 2: State fields and new prompts

**Files:**
- Modify: `backend/agents/state.py`
- Modify: `backend/agents/prompts.py`

- [ ] **Step 1: Add four fields to ProfileAnalyzerState**

In `backend/agents/state.py`, the `ProfileAnalyzerState` TypedDict currently ends at `top_issues: list[str]`. Add after it:

```python
class ProfileAnalyzerState(TypedDict):
    # Inputs
    session_id: str
    use_case: str
    target_column: str | None
    description: str | None
    # Phase 1: overview
    overview_notes: str
    columns_to_investigate: list[dict]
    # Phase 2: investigation
    investigation_findings: str
    # Phase 2b: cross-column findings (populated by structure_findings_node)
    cross_column_findings: list[dict]
    # Phase 2c: structured findings extraction (NEW)
    exploration_findings: dict          # ExplorationFindings JSON
    exploration_notebook_path: str      # absolute path to generated .ipynb
    investigation_feedback: str | None  # user's free-form feedback message
    investigation_round: int            # 0 = first pass, 1-2 = re-investigation rounds
    # Phase 3: synthesize
    data_passport: str
    # Phase 4: rules
    ai_summary: str
    suggested_rules: list[dict]
    top_issues: list[str]
```

- [ ] **Step 2: Add STRUCTURE_FINDINGS_SYSTEM to prompts.py**

Append to the bottom of `backend/agents/prompts.py`:

```python
STRUCTURE_FINDINGS_SYSTEM = """You are extracting structured findings from a data investigation report.

Parse the investigation text and produce a JSON object with EXACTLY this schema:
{
  "column_findings": [
    {
      "column": "<column name>",
      "semantic_meaning": "<what this column represents in the business context>",
      "data_type_actual": "<text|numeric|categorical|date|boolean|id>",
      "stats": {
        "null_count": <integer or null>,
        "null_pct": <float or null>,
        "distinct_count": <integer or null>,
        "total_rows": <integer or null>
      },
      "full_analysis": "<COMPLETE agent text about this column — do NOT truncate, paraphrase, or compress>",
      "issues": [
        {
          "description": "<exact description with counts as mentioned in the text>",
          "severity": "critical|warning|info",
          "count": <integer or null>,
          "pct": <float or null>,
          "sample_values": ["<value>"],
          "where_clause": "<DuckDB-compatible SQL WHERE condition (no WHERE keyword) that selects failing rows, or null if not derivable>"
        }
      ],
      "assumptions": ["<inference that business context could change>"],
      "rule_implications": ["<direction for a potential DQ rule, including suggested threshold>"]
    }
  ],
  "cross_column_findings": [
    {
      "columns": ["<col1>", "<col2>"],
      "full_analysis": "<COMPLETE agent text about this finding — do NOT truncate>",
      "pattern": "<concise one-sentence description of the pattern>",
      "severity": "critical|warning|info",
      "investigation_sql": "<SQL SELECT that reveals this pattern, or null>",
      "rule_implications": ["<direction for a potential DQ rule>"]
    }
  ],
  "open_questions": ["<explicit uncertainty where business context would change interpretation>"],
  "readiness_assessment": "good|moderate|poor",
  "key_risks": ["<specific risk to ML-readiness or downstream analysis>"]
}

Critical rules:
- full_analysis fields contain COMPLETE text from the investigation — never summarized
- Preserve ALL specific counts, percentages, and sample values exactly as mentioned
- where_clause must use the DuckDB table name 'working_data' is NOT needed — it is a WHERE condition only
- cross_column_findings must list ALL columns involved, not just two
- open_questions are explicit uncertainties, not rhetorical — only include real unknowns
- Output ONLY the JSON object. Start with { and end with }."""
```

- [ ] **Step 3: Update PROFILE_INVESTIGATION_SYSTEM in prompts.py**

The existing `PROFILE_INVESTIGATION_SYSTEM` string ends with `"Do NOT propose rules or fixes. Just investigate and accumulate findings."`. Append a cross-column mandate:

```python
PROFILE_INVESTIGATION_SYSTEM = """You are a data investigator with access to query tools. Your goal is to understand a dataset deeply and specifically before anyone proposes rules or transformations.

Approach:
- Start with the columns flagged for investigation
- For text columns: find out what formats actually exist (dates, IDs, codes, emails — what patterns appear?)
- For numeric columns: look at the real distribution — are zeros meaningful or erroneous? Are there clusters?
- For categorical columns: what are all the values? Are there typos, inconsistencies, or unexpected codes?
- For date columns: what formats exist? What's the actual date range? Are there impossible dates?
- Follow threads — if something looks suspicious, investigate further
- Check cross-column consistency where columns are logically related

Cross-column investigation (required before concluding):
1. Run dq_compute_correlation_matrix to identify numeric column pairs worth investigating further.
2. For any time or date column found, run dq_group_over_time against every categorical column — value sets that appear or disappear across time bins are a common and easily-missed quality signal (e.g. a category renamed mid-dataset).
3. Run dq_find_correlated_nulls to identify columns whose missing values co-occur — systematic missingness is invisible in per-column profiling.
4. Use dq_pairwise_profile for any column pair where a relationship is suspected but not yet verified.
5. For complex conditional patterns (e.g. "Code A only valid when Region=X AND Status=Active"), use dq_run_sql to formulate and test the hypothesis directly.
6. Cross-column findings may span 3 or more columns — always list all involved columns in your notes.

Before concluding, explicitly state your assumptions — any inference you made where business context could change the interpretation. These will be shown to the user for confirmation.

You are done when you can describe every column in plain language: what it represents, what values it contains, and what quality issues exist. You have also tested systematic cross-column hypotheses.

Do NOT propose rules or fixes. Just investigate and accumulate findings."""
```

- [ ] **Step 4: Run linter to verify syntax**

```bash
ruff check backend/agents/state.py backend/agents/prompts.py
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add backend/agents/state.py backend/agents/prompts.py
git commit -m "feat: add ProfileAnalyzerState exploration fields and STRUCTURE_FINDINGS_SYSTEM prompt"
```

---

## Task 3: structure_findings_node

**Files:**
- Modify: `backend/agents/graphs/profile_analyzer.py`
- Create: `tests/backend/agents/test_structure_findings.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/backend/agents/test_structure_findings.py
from unittest.mock import MagicMock, patch
from backend.agents.state import ProfileAnalyzerState


def _make_state(**overrides) -> ProfileAnalyzerState:
    base: ProfileAnalyzerState = {
        "session_id": "test-session",
        "use_case": "test use case",
        "target_column": None,
        "description": None,
        "overview_notes": "",
        "columns_to_investigate": [],
        "investigation_findings": "Email column: 847 values (3.2%) fail email format. Null count: 234 (0.9%). Assuming nulls are missing data.",
        "cross_column_findings": [],
        "exploration_findings": {},
        "exploration_notebook_path": "",
        "investigation_feedback": None,
        "investigation_round": 0,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": [],
        "top_issues": [],
    }
    base.update(overrides)
    return base


SAMPLE_FINDINGS_JSON = """{
  "column_findings": [
    {
      "column": "Email",
      "semantic_meaning": "Customer contact email",
      "data_type_actual": "text",
      "stats": {"null_count": 234, "null_pct": 0.9, "distinct_count": 25847, "total_rows": 26500},
      "full_analysis": "Email column: 847 values (3.2%) fail email format. Null count: 234 (0.9%). Assuming nulls are missing data.",
      "issues": [{"description": "847 values (3.2%) fail email format", "severity": "warning", "count": 847, "pct": 3.2, "sample_values": ["noemail"], "where_clause": null}],
      "assumptions": ["Assuming nulls represent missing data"],
      "rule_implications": ["Validity rule: email format regex"]
    }
  ],
  "cross_column_findings": [],
  "open_questions": [],
  "readiness_assessment": "moderate",
  "key_risks": []
}"""


def test_structure_findings_node_populates_exploration_findings():
    from backend.agents.graphs.profile_analyzer import structure_findings_node

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=SAMPLE_FINDINGS_JSON)]

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response

    with patch("backend.agents.graphs.profile_analyzer.call_claude_with_retry",
               return_value=mock_response):
        with patch("anthropic.Anthropic", return_value=mock_client):
            state = _make_state()
            result = structure_findings_node(state)

    assert isinstance(result["exploration_findings"], dict)
    assert len(result["exploration_findings"]["column_findings"]) == 1
    assert result["exploration_findings"]["column_findings"][0]["column"] == "Email"


def test_structure_findings_node_populates_cross_column_findings():
    from backend.agents.graphs.profile_analyzer import structure_findings_node

    findings_with_cross = SAMPLE_FINDINGS_JSON.replace(
        '"cross_column_findings": []',
        '"cross_column_findings": [{"columns": ["A", "B"], "full_analysis": "test", "pattern": "p", "severity": "warning", "investigation_sql": null, "rule_implications": []}]'
    )
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=findings_with_cross)]

    with patch("backend.agents.graphs.profile_analyzer.call_claude_with_retry",
               return_value=mock_response):
        with patch("anthropic.Anthropic"):
            state = _make_state()
            result = structure_findings_node(state)

    assert len(result["cross_column_findings"]) == 1
    assert result["cross_column_findings"][0]["columns"] == ["A", "B"]


def test_structure_findings_node_fallback_on_invalid_json():
    from backend.agents.graphs.profile_analyzer import structure_findings_node

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text="NOT VALID JSON AT ALL")]

    with patch("backend.agents.graphs.profile_analyzer.call_claude_with_retry",
               return_value=mock_response):
        with patch("anthropic.Anthropic"):
            state = _make_state()
            result = structure_findings_node(state)

    # Fallback: should return a minimal valid structure, not crash
    assert isinstance(result["exploration_findings"], dict)
    assert "column_findings" in result["exploration_findings"]
    assert result["exploration_findings"]["column_findings"][0]["column"] == "__raw__"


def test_structure_findings_node_preserves_existing_state():
    from backend.agents.graphs.profile_analyzer import structure_findings_node

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=SAMPLE_FINDINGS_JSON)]

    with patch("backend.agents.graphs.profile_analyzer.call_claude_with_retry",
               return_value=mock_response):
        with patch("anthropic.Anthropic"):
            state = _make_state(use_case="HR data pipeline")
            result = structure_findings_node(state)

    assert result["use_case"] == "HR data pipeline"
    assert result["investigation_findings"] == state["investigation_findings"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/backend/agents/test_structure_findings.py -v
```
Expected: `ImportError` — `structure_findings_node` does not exist yet

- [ ] **Step 3: Implement structure_findings_node in profile_analyzer.py**

Add these imports at the top of `backend/agents/graphs/profile_analyzer.py` (after existing imports):

```python
from backend.agents.prompts import (
    PROFILE_OVERVIEW_SYSTEM,
    PROFILE_SYNTHESIZE_SYSTEM,
    RULE_PROPOSER_SYSTEM,
    STRUCTURE_FINDINGS_SYSTEM,   # NEW
)
```

Add the node function after the existing `_investigate_node_deprecated` function and before `synthesize_understanding_node`:

```python
def structure_findings_node(state: ProfileAnalyzerState) -> ProfileAnalyzerState:
    """Extract ExplorationFindings JSON from raw investigation_findings text.

    Single non-tool Claude call. Instructs verbatim preservation of all counts,
    sample values, and reasoning. Falls back to a prose entry on JSON parse failure
    so the notebook degrades gracefully rather than crashing.
    """
    import anthropic

    client = anthropic.Anthropic()

    response = call_claude_with_retry(
        client,
        model="claude-sonnet-4-6",
        max_tokens=8192,
        temperature=0,
        system=STRUCTURE_FINDINGS_SYSTEM,
        messages=[
            {
                "role": "user",
                "content": f"""Dataset: {state["use_case"]}

Investigation findings:
{state["investigation_findings"]}

Extract the structured ExplorationFindings JSON. Output ONLY the JSON object.""",
            }
        ],
    )

    text = response.content[0].text
    parsed = _parse_json(text)

    if not isinstance(parsed, dict):
        logger.warning(
            "[structure_findings:%s] JSON parse failed — using prose fallback",
            state["session_id"][:8],
        )
        parsed = {
            "column_findings": [
                {
                    "column": "__raw__",
                    "semantic_meaning": "Raw investigation text (structure extraction failed)",
                    "data_type_actual": "text",
                    "stats": {},
                    "full_analysis": state["investigation_findings"],
                    "issues": [],
                    "assumptions": [],
                    "rule_implications": [],
                }
            ],
            "cross_column_findings": [],
            "open_questions": [],
            "readiness_assessment": "unknown",
            "key_risks": [],
        }

    return {
        **state,
        "exploration_findings": parsed,
        "cross_column_findings": parsed.get("cross_column_findings", []),
    }
```

- [ ] **Step 4: Update build_profile_analyzer_graph to include structure_findings_node**

In `build_profile_analyzer_graph()`, update the graph assembly:

```python
def build_profile_analyzer_graph():
    graph = StateGraph(ProfileAnalyzerState)

    graph.add_node("read_overview", read_overview_node)
    graph.add_node("investigate", deep_investigate_node)
    graph.add_node("structure_findings", structure_findings_node)   # NEW
    graph.add_node("synthesize_understanding", synthesize_understanding_node)
    graph.add_node("propose_rules", propose_rules_node)

    graph.set_entry_point("read_overview")
    graph.add_edge("read_overview", "investigate")
    graph.add_edge("investigate", "structure_findings")             # NEW
    graph.add_edge("structure_findings", "synthesize_understanding") # CHANGED (was investigate)
    graph.add_edge("synthesize_understanding", "propose_rules")
    graph.add_edge("propose_rules", END)

    return graph.compile()
```

- [ ] **Step 5: Update run_profile_analyzer to initialise new state fields and return exploration_findings**

Update the `initial_state` dict in `run_profile_analyzer` to add the new fields:

```python
initial_state: ProfileAnalyzerState = {
    "session_id": session_id,
    "use_case": use_case,
    "target_column": target_column,
    "description": description,
    "overview_notes": "",
    "columns_to_investigate": [],
    "investigation_findings": "",
    "cross_column_findings": [],
    "exploration_findings": {},        # NEW
    "exploration_notebook_path": "",   # NEW
    "investigation_feedback": None,    # NEW
    "investigation_round": 0,          # NEW
    "data_passport": "",
    "ai_summary": "",
    "suggested_rules": [],
    "top_issues": [],
}
```

Update the return dict:

```python
return {
    "ai_summary": result.get("ai_summary", ""),
    "suggested_rules": result.get("suggested_rules", []),
    "top_issues": result.get("top_issues", []),
    "data_passport": result.get("data_passport", ""),
    "exploration_findings": result.get("exploration_findings", {}),    # NEW
    "investigation_findings": result.get("investigation_findings", ""), # NEW
}
```

- [ ] **Step 6: Run tests**

```bash
pytest tests/backend/agents/test_structure_findings.py -v
```
Expected: all 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add backend/agents/graphs/profile_analyzer.py tests/backend/agents/test_structure_findings.py
git commit -m "feat: add structure_findings_node with ExplorationFindings extraction and graceful fallback"
```

---

## Task 4: Cross-column tools on deep agent + re-investigation context

**Files:**
- Modify: `backend/agents/graphs/deep_investigate.py`

- [ ] **Step 1: Add four dq_* wrapper functions after the existing dq_get_column_detail function**

These go in `deep_investigate.py` alongside the existing `dq_run_sql` etc. wrappers:

```python
def dq_group_over_time(
    group_col: Annotated[str, "Categorical column to track over time bins."],
    time_col: Annotated[str, "Date/time column to split into bins."],
    bins: Annotated[int, "Number of time bins (default 10)."] = 10,
    *,
    runtime: ToolRuntime[InvestigationContext, None],
) -> str:
    """Track how categorical values change across time bins.
    Detects renames, retirements, and structural shifts over time."""
    from dq_tools.cross_column import group_over_time
    result = group_over_time(runtime.context.session_id, group_col, time_col, bins)
    return json.dumps(result, default=str)


def dq_find_correlated_nulls(
    threshold: Annotated[float, "Phi coefficient threshold (default 0.3). Lower = more pairs returned."] = 0.3,
    *,
    runtime: ToolRuntime[InvestigationContext, None],
) -> str:
    """Find column pairs whose null patterns co-occur above threshold.
    Detects systematic missingness invisible in per-column profiling."""
    from dq_tools.cross_column import find_correlated_nulls
    result = find_correlated_nulls(runtime.context.session_id, threshold)
    return json.dumps(result, default=str)


def dq_pairwise_profile(
    col_a: Annotated[str, "First column name."],
    col_b: Annotated[str, "Second column name."],
    *,
    runtime: ToolRuntime[InvestigationContext, None],
) -> str:
    """Cross-column profile dispatched by dtype: crosstab, correlation, or group stats."""
    from dq_tools.cross_column import pairwise_profile
    result = pairwise_profile(runtime.context.session_id, col_a, col_b)
    return json.dumps(result, default=str)


def dq_compute_correlation_matrix(
    columns: Annotated[
        Optional[list[str]],
        "List of numeric column names. Omit to auto-select all numeric columns (capped at 20).",
    ] = None,
    *,
    runtime: ToolRuntime[InvestigationContext, None],
) -> str:
    """Pearson correlation matrix for numeric columns. Use early to find pairs worth investigating."""
    from dq_tools.cross_column import compute_correlation_matrix
    result = compute_correlation_matrix(runtime.context.session_id, columns)
    return json.dumps(result, default=str)
```

- [ ] **Step 2: Register the four new tools in _build_deep_investigate_agent**

Update the `tools` list in `_build_deep_investigate_agent`:

```python
return create_deep_agent(
    model=ChatAnthropic(model="claude-sonnet-4-6", max_tokens=8192),  # pyright: ignore[reportCallIssue]
    tools=[
        dq_run_sql,
        dq_get_value_counts,
        dq_check_regex_pattern,
        dq_get_sample_rows,
        dq_get_column_detail,
        dq_group_over_time,          # NEW
        dq_find_correlated_nulls,    # NEW
        dq_pairwise_profile,         # NEW
        dq_compute_correlation_matrix,  # NEW
    ],
    system_prompt=PROFILE_INVESTIGATION_SYSTEM,
    context_schema=InvestigationContext,
)
```

- [ ] **Step 3: Add re-investigation context injection to deep_investigate_node**

In `deep_investigate_node`, after the `context_header` block is built and before `initial_message` is assigned, add a branch for re-investigation rounds:

```python
investigation_round = state.get("investigation_round", 0)

if investigation_round > 0:
    prior_findings = state.get("exploration_findings", {})
    prior_raw = state.get("investigation_findings", "")
    user_feedback = state.get("investigation_feedback", "")
    initial_message = HumanMessage(
        content=f"""{context_header}

Your prior investigation (round {investigation_round}) established these findings.

=== Structured findings (ExplorationFindings JSON) ===
{json.dumps(prior_findings, indent=2, default=str)}

=== Raw investigation notes (authoritative record) ===
{prior_raw}

=== User feedback after reviewing the exploration notebook ===
{user_feedback}

Your job for this re-investigation round:
- Use the dq_* tools to investigate the specific threads the user raised.
- Where the user's claim conflicts with your prior evidence, verify it against
  the data before accepting it. State your evidence explicitly.
- Do not re-investigate findings already well-established unless the user
  specifically asked you to revisit them.
- At the end of your investigation, output COMPLETE UPDATED FINDINGS that
  extend (do not replace) the prior raw investigation notes.
  Begin your final output with the marker: === UPDATED FINDINGS ===
  then write the full combined findings (prior + new).

Use ONLY the dq_* tools for all data access."""
    )
else:
    initial_message = HumanMessage(
        content=f"""{context_header}

Overview findings:
{state["overview_notes"]}

Columns flagged for investigation:
{json.dumps(state["columns_to_investigate"], indent=2)}

Use ONLY the dq_* tools (dq_run_sql, dq_get_value_counts, dq_check_regex_pattern,
dq_get_sample_rows, dq_get_column_detail, dq_group_over_time, dq_find_correlated_nulls,
dq_pairwise_profile, dq_compute_correlation_matrix) for all data access.

Use write_todos to plan and track your investigation across all flagged columns
so you don't miss any. Follow unexpected threads — if you find something
surprising in one column, investigate further. Check cross-column relationships
where columns are logically related.

When you have a thorough, specific understanding of every flagged column and
have followed all interesting threads, write up your complete findings WITHOUT
using any more tools. Your findings feed directly into the data passport."""
    )
```

- [ ] **Step 4: Run linter**

```bash
ruff check backend/agents/graphs/deep_investigate.py
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add backend/agents/graphs/deep_investigate.py
git commit -m "feat: add cross-column tools to deep agent and re-investigation context injection"
```

---

## Task 5: Exploration notebook generator

**Files:**
- Create: `backend/agents/graphs/exploration_notebook.py`
- Create: `tests/backend/agents/test_exploration_notebook.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/backend/agents/test_exploration_notebook.py
import uuid
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


SAMPLE_FINDINGS = {
    "column_findings": [
        {
            "column": "Email",
            "semantic_meaning": "Customer contact email",
            "data_type_actual": "text",
            "stats": {"null_count": 10, "null_pct": 1.0, "distinct_count": 990, "total_rows": 1000},
            "full_analysis": "Email column analysis: 30 values fail format check.",
            "issues": [
                {
                    "description": "30 values fail email format",
                    "severity": "warning",
                    "count": 30,
                    "pct": 3.0,
                    "sample_values": ["noemail"],
                    "where_clause": "email NOT LIKE '%@%'",
                }
            ],
            "assumptions": ["Nulls assumed to be missing data"],
            "rule_implications": ["Validity rule: email format regex"],
        }
    ],
    "cross_column_findings": [
        {
            "columns": ["EmployeeGroup", "HireDate"],
            "full_analysis": "Group rename detected at 2022-04.",
            "pattern": "Field-Ops → FieldOperations rename at boundary",
            "severity": "critical",
            "investigation_sql": "SELECT EmployeeGroup, COUNT(*) FROM working_data GROUP BY 1",
            "rule_implications": ["Standardize EmployeeGroup before aggregation"],
        }
    ],
    "open_questions": ["Are Email nulls intentional for online accounts?"],
    "readiness_assessment": "moderate",
    "key_risks": ["EmployeeGroup inconsistency will corrupt group-level analysis"],
}


@pytest.fixture
def session_id(tmp_path, monkeypatch):
    """Minimal DuckDB session for notebook generation tests."""
    import duckdb
    import pandas as pd

    sid = str(uuid.uuid4())

    import backend.agents.graphs.exploration_notebook as nb_mod
    monkeypatch.setattr(nb_mod, "_find_project_root", lambda: tmp_path)

    session_dir = tmp_path / "data" / "sessions" / sid
    session_dir.mkdir(parents=True)
    db_path = session_dir / "working.duckdb"
    df = pd.DataFrame({
        "Email": [f"u{i}@x.com" for i in range(95)] + [None] * 5,
        "EmployeeGroup": ["Field-Ops"] * 50 + ["FieldOperations"] * 50,
        "Salary": list(range(1000, 2000, 10)),
    })
    con = duckdb.connect(str(db_path))
    con.execute("CREATE TABLE working_data AS SELECT * FROM df")
    con.close()

    output_dir = tmp_path / "output" / "sessions" / sid
    output_dir.mkdir(parents=True)
    return sid


def test_build_notebook_returns_valid_notebook(session_id):
    import nbformat
    from backend.agents.graphs.exploration_notebook import _build_notebook

    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "raw investigation text")
    assert isinstance(nb, nbformat.NotebookNode)
    assert len(nb.cells) > 0


def test_build_notebook_contains_open_questions(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "raw text")
    all_text = " ".join(c.source for c in nb.cells if c.cell_type == "markdown")
    assert "Are Email nulls intentional" in all_text


def test_build_notebook_contains_column_section(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "raw text")
    all_text = " ".join(c.source for c in nb.cells if c.cell_type == "markdown")
    assert "Email" in all_text
    assert "Customer contact email" in all_text


def test_build_notebook_contains_cross_column_section(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "raw text")
    all_text = " ".join(c.source for c in nb.cells if c.cell_type == "markdown")
    assert "Cross-Column" in all_text
    assert "EmployeeGroup" in all_text


def test_build_notebook_contains_raw_appendix(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "MY RAW INVESTIGATION TEXT MARKER")
    all_text = " ".join(c.source for c in nb.cells if c.cell_type == "markdown")
    assert "MY RAW INVESTIGATION TEXT MARKER" in all_text


def test_build_notebook_contains_rule_implications(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "raw text")
    all_text = " ".join(c.source for c in nb.cells if c.cell_type == "markdown")
    assert "Preliminary Rule Implications" in all_text
    assert "Validity rule: email format regex" in all_text


def test_generate_exploration_notebook_writes_files(session_id, tmp_path):
    from backend.agents.graphs.exploration_notebook import generate_exploration_notebook

    # Mock ExecutePreprocessor to avoid running a real kernel in tests
    with patch("backend.agents.graphs.exploration_notebook.ExecutePreprocessor") as mock_ep:
        mock_ep.return_value.preprocess = MagicMock()
        ipynb_path, html_path = generate_exploration_notebook(
            session_id, SAMPLE_FINDINGS, "raw investigation text"
        )

    assert Path(ipynb_path).exists()
    assert Path(html_path).exists()
    assert ipynb_path.endswith(".ipynb")
    assert html_path.endswith(".html")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/backend/agents/test_exploration_notebook.py -v
```
Expected: `ModuleNotFoundError: No module named 'backend.agents.graphs.exploration_notebook'`

- [ ] **Step 3: Implement `backend/agents/graphs/exploration_notebook.py`**

```python
"""Exploration notebook generator.

Builds a pre-executed .ipynb and a self-contained HTML export from
ExplorationFindings JSON + raw investigation_findings text.

Public API:
    generate_exploration_notebook(session_id, exploration_findings, investigation_findings)
        -> tuple[str, str]  # (ipynb_path, html_path)
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import nbformat
from nbformat.v4 import new_notebook, new_markdown_cell, new_code_cell

from backend.agents.emit import _find_project_root

logger = logging.getLogger(__name__)


def _db_path_str(session_id: str) -> str:
    return str(_find_project_root() / "data" / "sessions" / session_id / "working.duckdb")


def _setup_cell(session_id: str) -> str:
    db_path = _db_path_str(session_id)
    return f"""import duckdb
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np

SESSION_DB = {db_path!r}
con = duckdb.connect(SESSION_DB, read_only=True)
df = con.execute("SELECT * FROM working_data").df()
print(f"Dataset: {{len(df):,}} rows x {{len(df.columns)}} columns")
print(f"Columns: {{', '.join(df.columns)}}")""".strip()


def _distribution_cell(column: str, data_type: str, issues: list) -> str:
    issue_sample_vals = repr(
        [str(s) for issue in issues for s in issue.get("sample_values", [])][:10]
    )
    if data_type in ("numeric", "int", "float", "integer"):
        return f"""col = df[{column!r}].dropna()
if len(col) > 0:
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.hist(col, bins=min(50, max(10, col.nunique())), color='steelblue', alpha=0.7, edgecolor='white')
    for stat, fn, color, ls in [
        ('mean', lambda s: s.mean(), 'red', '--'),
        ('median', lambda s: s.median(), 'orange', '-'),
        ('p5', lambda s: s.quantile(0.05), 'green', ':'),
        ('p95', lambda s: s.quantile(0.95), 'green', ':'),
    ]:
        val = fn(col)
        ax.axvline(val, color=color, linestyle=ls, linewidth=1.5, label=f'{{stat}}={{val:.2f}}')
    ax.set_title(f{repr(column + " — Distribution (n={:,})")}.format(len(col)))
    ax.set_xlabel({column!r})
    ax.set_ylabel('Count')
    ax.legend(fontsize=8)
    plt.tight_layout()
    plt.show()""".strip()
    else:
        return f"""vc = df[{column!r}].value_counts(dropna=False).head(25)
issue_vals = {issue_sample_vals}
colors = ['#e07b39' if str(v) in issue_vals else 'steelblue' for v in vc.index]
fig, ax = plt.subplots(figsize=(10, max(4, len(vc) * 0.35)))
ax.barh([str(v) for v in vc.index], vc.values, color=colors)
ax.set_title({repr(column + " — Top value counts  (orange = flagged values)")!r})
ax.set_xlabel('Count')
ax.invert_yaxis()
for i, (lbl, val) in enumerate(zip([str(v) for v in vc.index], vc.values)):
    ax.text(val * 1.005, i, f'{{val:,}}', va='center', fontsize=8)
plt.tight_layout()
plt.show()
print(f"Showing top 25 of {{df[{column!r}].nunique()}} distinct values | Nulls: {{df[{column!r}].isnull().sum():,}}")""".strip()


def _failing_rows_cell(column: str, issue_desc: str, where_clause: str, count) -> str:
    count_str = f"~{count:,}" if isinstance(count, int) else "?"
    return f"""# Failing rows: {issue_desc[:60]}
try:
    failing = con.execute("SELECT * FROM working_data WHERE {where_clause} LIMIT 25").df()
    print(f"{{len(failing)}} sample rows shown (total: {count_str})")
    display(failing)
except Exception as e:
    print(f"Could not run filter: {{e}}")""".strip()


def _cross_column_viz_cell(finding_idx: int, cols: list, sql: str) -> str:
    title = f"Cross-column finding {finding_idx}: {' x '.join(cols)}"
    return f"""try:
    result = con.execute({sql!r}).df()
    print(result.to_string())
    if len(result.columns) >= 2 and len(result) > 1:
        fig, ax = plt.subplots(figsize=(12, 5))
        x_col, y_col = result.columns[0], result.columns[1]
        if pd.api.types.is_numeric_dtype(result[y_col]):
            ax.bar(result[x_col].astype(str), result[y_col])
            ax.set_ylabel(str(y_col))
        else:
            result[y_col].value_counts().head(20).plot(kind='bar', ax=ax)
        ax.set_title({title!r})
        ax.set_xlabel(str(x_col))
        plt.xticks(rotation=45, ha='right')
        plt.tight_layout()
        plt.show()
except Exception as e:
    print(f"Visualization error: {{e}}")""".strip()


def _build_notebook(
    session_id: str,
    exploration_findings: dict,
    investigation_findings: str,
) -> nbformat.NotebookNode:
    nb = new_notebook()
    cells = []

    # Title + setup
    cells.append(new_markdown_cell(f"# Data Exploration Report\n\n**Session:** `{session_id}`"))
    cells.append(new_code_cell(_setup_cell(session_id)))

    # Open questions — pinned at top
    open_questions = exploration_findings.get("open_questions", [])
    if open_questions:
        oq_lines = "\n".join(f"{i}. {q}" for i, q in enumerate(open_questions, 1))
        cells.append(new_markdown_cell(
            f"## Open Questions for Review\n\n"
            f"> **Answer these before approving — the agent could not resolve them from data alone.**\n\n"
            f"{oq_lines}"
        ))

    # Key risks + readiness
    key_risks = exploration_findings.get("key_risks", [])
    readiness = exploration_findings.get("readiness_assessment", "unknown")
    if key_risks or readiness != "unknown":
        risk_lines = "".join(f"- {r}\n" for r in key_risks)
        cells.append(new_markdown_cell(
            f"## Dataset Readiness: **{readiness.upper()}**\n\n"
            f"{'**Key risks:**\n\n' + risk_lines if key_risks else ''}"
        ))

    # Per-column sections
    cells.append(new_markdown_cell("---\n\n## Per-Column Findings"))
    for cf in exploration_findings.get("column_findings", []):
        column = cf.get("column", "unknown")
        if column == "__raw__":
            cells.append(new_markdown_cell(
                f"## Raw Investigation Findings\n\n{cf.get('full_analysis', '')}"
            ))
            continue

        stats = cf.get("stats", {})
        issues = cf.get("issues", [])
        assumptions = cf.get("assumptions", [])
        rule_implications = cf.get("rule_implications", [])

        # Stats table
        if stats.get("total_rows"):
            stats_md = (
                f"\n\n| Metric | Value |\n|--------|-------|\n"
                f"| Total rows | {stats['total_rows']:,} |\n"
                f"| Null count | {stats.get('null_count', '?')} ({stats.get('null_pct', '?')}%) |\n"
                f"| Distinct values | {stats.get('distinct_count', '?')} |"
            )
        else:
            stats_md = ""

        # Issues
        issues_md = ""
        if issues:
            icon = {"critical": "🔴", "warning": "🟡", "info": "🔵"}
            issues_md = "\n\n**Issues found:**\n\n"
            for issue in issues:
                ic = icon.get(issue.get("severity", "info"), "⚪")
                count = issue.get("count")
                pct = issue.get("pct")
                count_str = f" ({count:,} rows, {pct}%)" if count is not None else ""
                issues_md += f"{ic} {issue['description']}{count_str}\n"
                samples = issue.get("sample_values", [])
                if samples:
                    issues_md += f"   Sample values: `{'`, `'.join(str(s) for s in samples[:5])}`\n"

        assumptions_md = ""
        if assumptions:
            assumptions_md = "\n\n> **Assumptions (verify with business context):**\n"
            for a in assumptions:
                assumptions_md += f"> - {a}\n"

        rule_md = ""
        if rule_implications:
            rule_md = "\n\n**Rule implications:**\n" + "".join(f"- {r}\n" for r in rule_implications)

        cells.append(new_markdown_cell(
            f"### {column}\n\n"
            f"**Semantic meaning:** {cf.get('semantic_meaning', '')}\n\n"
            f"**Data type:** {cf.get('data_type_actual', '')}"
            f"{stats_md}\n\n"
            f"{cf.get('full_analysis', '')}"
            f"{issues_md}{assumptions_md}{rule_md}"
        ))

        # Distribution plot
        cells.append(new_code_cell(
            _distribution_cell(column, cf.get("data_type_actual", "text"), issues)
        ))

        # Failing rows tables
        for issue in issues:
            wc = issue.get("where_clause")
            if wc:
                cells.append(new_code_cell(
                    _failing_rows_cell(column, issue["description"], wc, issue.get("count"))
                ))

    # Cross-column findings
    cross = exploration_findings.get("cross_column_findings", [])
    if cross:
        cells.append(new_markdown_cell("---\n\n## Cross-Column Findings"))
        for i, finding in enumerate(cross, 1):
            cols = finding.get("columns", [])
            severity = finding.get("severity", "info")
            label = {"critical": "[CRITICAL]", "warning": "[WARNING]", "info": "[INFO]"}.get(severity, "")
            rule_md = ""
            if finding.get("rule_implications"):
                rule_md = "\n\n**Rule implications:**\n" + "".join(
                    f"- {r}\n" for r in finding["rule_implications"]
                )
            cells.append(new_markdown_cell(
                f"### Finding {i} — {' × '.join(cols)} {label}\n\n"
                f"{finding.get('full_analysis', '')}\n\n"
                f"**Pattern:** {finding.get('pattern', '')}"
                f"{rule_md}"
            ))
            sql = finding.get("investigation_sql")
            if sql:
                cells.append(new_code_cell(_cross_column_viz_cell(i, cols, sql)))

    # Preliminary rule implications
    all_implications = []
    for cf in exploration_findings.get("column_findings", []):
        for r in cf.get("rule_implications", []):
            all_implications.append({
                "label": cf["column"],
                "implication": r,
                "assumptions": cf.get("assumptions", []),
            })
    for cf in exploration_findings.get("cross_column_findings", []):
        for r in cf.get("rule_implications", []):
            all_implications.append({
                "label": " × ".join(cf.get("columns", [])),
                "implication": r,
                "assumptions": [],
            })
    if all_implications:
        cells.append(new_markdown_cell(
            "---\n\n## Preliminary Rule Implications\n\n"
            "> **These are directions for review — not the final rule set. "
            "Formal rules are proposed after you approve this notebook.**"
        ))
        for item in all_implications:
            assumption_md = ""
            if item["assumptions"]:
                assumption_md = "\n\n" + "".join(f"> Assumption: {a}\n" for a in item["assumptions"])
            cells.append(new_markdown_cell(
                f"**{item['label']}:** {item['implication']}{assumption_md}"
            ))

    # Appendix: raw investigation notes
    cells.append(new_markdown_cell(
        "---\n\n## Appendix: Raw Investigation Notes\n\n"
        "> **This is the agent's unstructured output before structured extraction. "
        "If anything in the sections above seems incomplete, check here.**\n\n"
        f"{investigation_findings}"
    ))

    nb.cells = cells
    return nb


def generate_exploration_notebook(
    session_id: str,
    exploration_findings: dict,
    investigation_findings: str,
) -> tuple[str, str]:
    """Generate a pre-executed exploration notebook.

    Writes exploration_notebook.ipynb and exploration_notebook.html to
    output/sessions/{session_id}/. Returns (ipynb_path, html_path).
    The HTML is self-contained (base64 plots, embedded CSS) for browser viewing.
    """
    from nbconvert.preprocessors import ExecutePreprocessor
    from nbconvert import HTMLExporter

    project_root = _find_project_root()
    output_dir = project_root / "output" / "sessions" / session_id
    output_dir.mkdir(parents=True, exist_ok=True)

    nb = _build_notebook(session_id, exploration_findings, investigation_findings)

    ep = ExecutePreprocessor(timeout=300, kernel_name="python3")
    try:
        ep.preprocess(nb, {"metadata": {"path": str(project_root)}})
    except Exception as e:
        logger.warning(
            "[exploration_notebook:%s] Execution errors (partial output preserved): %s",
            session_id[:8], e,
        )

    ipynb_path = output_dir / "exploration_notebook.ipynb"
    with open(ipynb_path, "w", encoding="utf-8") as f:
        nbformat.write(nb, f)

    exporter = HTMLExporter()
    exporter.theme = "light"
    body, _ = exporter.from_notebook_node(nb)
    html_path = output_dir / "exploration_notebook.html"
    html_path.write_text(body, encoding="utf-8")

    logger.info("[exploration_notebook:%s] Written to %s", session_id[:8], output_dir)
    return str(ipynb_path), str(html_path)
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/backend/agents/test_exploration_notebook.py -v
```
Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/agents/graphs/exploration_notebook.py tests/backend/agents/test_exploration_notebook.py
git commit -m "feat: add exploration notebook generator with per-column plots, cross-column findings, and raw notes appendix"
```

---

## Task 6: Investigation activities

**Files:**
- Create: `backend/temporal/activities/investigation_activities.py`

- [ ] **Step 1: Create the file**

```python
"""Activities for the investigation split: investigate, synthesize, and re-investigate.

Replaces the monolithic profile_and_analyze_activity with three focused activities:

- profile_and_investigate_activity: profile + investigate + structure findings + generate notebook
- synthesize_and_propose_activity: synthesize understanding + propose rules
- reinvestigate_activity: targeted re-investigation with prior context + regenerate notebook
"""
from __future__ import annotations

import asyncio
from functools import partial

from temporalio import activity


@activity.defn
async def profile_and_investigate_activity(params: dict) -> dict:
    """
    params: {session_id, use_case, target_column, description}
    Returns: {exploration_findings, investigation_findings, overview_notes,
              columns_to_investigate, notebook_path, html_path}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_profile_and_investigate_sync, params))


def _profile_and_investigate_sync(params: dict) -> dict:
    from dq_tools.profiler import profile_dataset
    from backend.agents.graphs.profile_analyzer import (
        read_overview_node,
        structure_findings_node,
    )
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    from backend.agents.graphs.exploration_notebook import generate_exploration_notebook

    session_id = params["session_id"]
    profile_dataset(session_id)

    state = {
        "session_id": session_id,
        "use_case": params.get("use_case", ""),
        "target_column": params.get("target_column"),
        "description": params.get("description"),
        "overview_notes": "",
        "columns_to_investigate": [],
        "investigation_findings": "",
        "cross_column_findings": [],
        "exploration_findings": {},
        "exploration_notebook_path": "",
        "investigation_feedback": None,
        "investigation_round": 0,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": [],
        "top_issues": [],
    }

    state = read_overview_node(state)
    state = deep_investigate_node(state)
    state = structure_findings_node(state)

    notebook_path, html_path = generate_exploration_notebook(
        session_id=session_id,
        exploration_findings=state["exploration_findings"],
        investigation_findings=state["investigation_findings"],
    )

    return {
        "exploration_findings": state["exploration_findings"],
        "investigation_findings": state["investigation_findings"],
        "overview_notes": state["overview_notes"],
        "columns_to_investigate": state["columns_to_investigate"],
        "notebook_path": notebook_path,
        "html_path": html_path,
    }


@activity.defn
async def synthesize_and_propose_activity(params: dict) -> dict:
    """
    params: {session_id, use_case, target_column, description, investigation_findings,
             exploration_findings, overview_notes, columns_to_investigate,
             synthesis_constrained, synthesis_constraint_reasons}
    Returns: {profile, ai_summary, suggested_rules, top_issues}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_synthesize_and_propose_sync, params))


def _synthesize_and_propose_sync(params: dict) -> dict:
    from backend.agents.graphs.profile_analyzer import (
        synthesize_understanding_node,
        propose_rules_node,
        _load_profile_summary,
    )

    session_id = params["session_id"]

    state = {
        "session_id": session_id,
        "use_case": params.get("use_case", ""),
        "target_column": params.get("target_column"),
        "description": params.get("description"),
        "overview_notes": params.get("overview_notes", ""),
        "columns_to_investigate": params.get("columns_to_investigate", []),
        "investigation_findings": params["investigation_findings"],
        "cross_column_findings": params.get("exploration_findings", {}).get("cross_column_findings", []),
        "exploration_findings": params.get("exploration_findings", {}),
        "exploration_notebook_path": "",
        "investigation_feedback": None,
        "investigation_round": 0,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": [],
        "top_issues": [],
    }

    # Prepend constraint warning to guide synthesis if investigation was not approved
    if params.get("synthesis_constrained") and params.get("synthesis_constraint_reasons"):
        reasons = "\n".join(f"- {r}" for r in params["synthesis_constraint_reasons"])
        constraint_preamble = (
            f"\n\nNOTE: The investigation review was not fully approved by the user. "
            f"The following questions remain unresolved:\n{reasons}\n"
            f"Propose rules conservatively — flag any rule whose correctness depends "
            f"on an unresolved question."
        )
        state["investigation_findings"] = state["investigation_findings"] + constraint_preamble

    state = synthesize_understanding_node(state)
    state = propose_rules_node(state)

    profile_summary = _load_profile_summary(session_id)

    # If constrained, prepend a visible warning to ai_summary
    ai_summary = state.get("ai_summary", "")
    if params.get("synthesis_constrained"):
        reasons = params.get("synthesis_constraint_reasons", [])
        warning = (
            "⚠️ CONSTRAINED SYNTHESIS: The exploration review was not fully approved. "
            f"Unresolved questions: {'; '.join(reasons)}. "
            "Review rules carefully — some may reflect unconfirmed assumptions.\n\n"
        )
        ai_summary = warning + ai_summary

    return {
        "profile": profile_summary,
        "ai_summary": ai_summary,
        "suggested_rules": state.get("suggested_rules", []),
        "top_issues": state.get("top_issues", []),
    }


@activity.defn
async def reinvestigate_activity(params: dict) -> dict:
    """
    params: {session_id, use_case, target_column, overview_notes,
             columns_to_investigate, exploration_findings, investigation_findings,
             feedback_message, investigation_round}
    Returns: {exploration_findings, investigation_findings, notebook_path, html_path}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_reinvestigate_sync, params))


def _reinvestigate_sync(params: dict) -> dict:
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    from backend.agents.graphs.profile_analyzer import structure_findings_node
    from backend.agents.graphs.exploration_notebook import generate_exploration_notebook

    session_id = params["session_id"]
    investigation_round = params["investigation_round"]

    state = {
        "session_id": session_id,
        "use_case": params.get("use_case", ""),
        "target_column": params.get("target_column"),
        "description": None,
        "overview_notes": params.get("overview_notes", ""),
        "columns_to_investigate": params.get("columns_to_investigate", []),
        "investigation_findings": params["investigation_findings"],
        "cross_column_findings": [],
        "exploration_findings": params["exploration_findings"],
        "exploration_notebook_path": "",
        "investigation_feedback": params["feedback_message"],
        "investigation_round": investigation_round,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": [],
        "top_issues": [],
    }

    state = deep_investigate_node(state)
    state = structure_findings_node(state)

    notebook_path, html_path = generate_exploration_notebook(
        session_id=session_id,
        exploration_findings=state["exploration_findings"],
        investigation_findings=state["investigation_findings"],
    )

    return {
        "exploration_findings": state["exploration_findings"],
        "investigation_findings": state["investigation_findings"],
        "notebook_path": notebook_path,
        "html_path": html_path,
    }
```

- [ ] **Step 2: Run linter**

```bash
ruff check backend/temporal/activities/investigation_activities.py
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/temporal/activities/investigation_activities.py
git commit -m "feat: add investigation_activities (profile_and_investigate, synthesize_and_propose, reinvestigate)"
```

---

## Task 7: Worker registration + data_activities cleanup

**Files:**
- Modify: `backend/temporal/worker.py`
- Modify: `backend/temporal/activities/data_activities.py`

- [ ] **Step 1: Update worker.py imports and activity list**

Replace the `profile_and_analyze_activity` import from `data_activities` with the three new activities from `investigation_activities`:

```python
# Remove this line:
from backend.temporal.activities.data_activities import (
    load_dataset_activity,
    profile_and_analyze_activity,   # REMOVE
    run_validation_activity,
    detect_anomalies_activity,
    analyze_and_prioritize_activity,
)

# Add this import block:
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
)
```

In the `Worker(...)` activities list, replace `profile_and_analyze_activity` with the three new ones:

```python
activities=[
    load_dataset_activity,
    profile_and_investigate_activity,   # replaces profile_and_analyze_activity
    synthesize_and_propose_activity,    # NEW
    reinvestigate_activity,             # NEW
    run_validation_activity,
    detect_anomalies_activity,
    analyze_and_prioritize_activity,
    # ... rest unchanged
],
```

- [ ] **Step 2: Remove profile_and_analyze_activity from data_activities.py**

Delete the `profile_and_analyze_activity` function and its `_profile_and_analyze_sync` helper from `data_activities.py`. These are now replaced by the three activities in `investigation_activities.py`.

- [ ] **Step 3: Run linter**

```bash
ruff check backend/temporal/worker.py backend/temporal/activities/data_activities.py
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add backend/temporal/worker.py backend/temporal/activities/data_activities.py
git commit -m "refactor: swap profile_and_analyze_activity for split investigation activities in worker"
```

---

## Task 8: Workflow changes

**Files:**
- Modify: `backend/temporal/workflows/dq_workflow.py`

- [ ] **Step 1: Add new workflow state fields in `__init__`**

In `DQAcceleratorWorkflow.__init__`, add after the `self.profile` line:

```python
# Investigation / exploration state
self.investigation_findings: str = ""
self.exploration_findings: dict = {}
self.exploration_notebook_path: str = ""
self.investigation_round: int = 0
self.investigation_feedback: dict | None = None  # {"message": str, "approve": bool}
self.synthesis_constrained: bool = False
self.synthesis_constraint_reasons: list = []
```

- [ ] **Step 2: Add new import in the workflow file**

In the `with workflow.unsafe.imports_passed_through():` block, add:

```python
from backend.temporal.activities.investigation_activities import (
    profile_and_investigate_activity,
    synthesize_and_propose_activity,
    reinvestigate_activity,
)
```

Remove the import of `profile_and_analyze_activity` from `data_activities`.

- [ ] **Step 3: Add submit_investigation_feedback signal**

After the existing `@workflow.signal` methods:

```python
@workflow.signal
def submit_investigation_feedback(self, payload: dict) -> None:
    """payload: {"message": str, "approve": bool}"""
    self.investigation_feedback = payload
```

- [ ] **Step 4: Add get_exploration query**

After the existing `@workflow.query` methods:

```python
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
```

- [ ] **Step 5: Replace the PROFILING stage in `run()` with the new multi-stage flow**

Find the current `# ── Stage: PROFILING` block and replace it:

```python
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
```

- [ ] **Step 6: Update get_full_state query to include new fields**

In `get_full_state`, add the new fields to the returned dict:

```python
"exploration_findings": self.exploration_findings,
"exploration_notebook_path": self.exploration_notebook_path,
"investigation_round": self.investigation_round,
"synthesis_constrained": self.synthesis_constrained,
"synthesis_constraint_reasons": self.synthesis_constraint_reasons,
```

- [ ] **Step 7: Run linter**

```bash
ruff check backend/temporal/workflows/dq_workflow.py
```
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add backend/temporal/workflows/dq_workflow.py
git commit -m "feat: add exploration review stages to workflow (AWAITING_INVESTIGATION_REVIEW, REINVESTIGATING, PROFILING_SYNTHESIS) with constrained synthesis gating"
```

---

## Task 9: API schema additions

**Files:**
- Modify: `backend/api/schemas.py`

- [ ] **Step 1: Add three new WorkflowStage values**

In `WorkflowStage` enum, after `PROFILING = "PROFILING"` add:

```python
AWAITING_INVESTIGATION_REVIEW = "AWAITING_INVESTIGATION_REVIEW"
REINVESTIGATING = "REINVESTIGATING"
PROFILING_SYNTHESIS = "PROFILING_SYNTHESIS"
```

- [ ] **Step 2: Add InvestigationFeedbackRequest model**

After the existing `RuleApprovalRequest` model:

```python
class InvestigationFeedbackRequest(BaseModel):
    message: str = ""
    approve: bool = False


class InvestigationFeedbackResponse(BaseModel):
    accepted: bool
    message: str = "Feedback submitted."
    investigation_round: int = 0


class ExplorationStateResponse(BaseModel):
    exploration_findings: dict = {}
    open_questions: list[str] = []
    investigation_round: int = 0
    notebook_ready: bool = False
    synthesis_constrained: bool = False
    synthesis_constraint_reasons: list[str] = []
```

- [ ] **Step 3: Run linter**

```bash
ruff check backend/api/schemas.py
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add backend/api/schemas.py
git commit -m "feat: add WorkflowStage exploration values and exploration API models"
```

---

## Task 10: Exploration API router

**Files:**
- Create: `backend/api/routers/exploration.py`
- Modify: `backend/api/main.py`

- [ ] **Step 1: Create the exploration router**

```python
# backend/api/routers/exploration.py
"""Exploration notebook endpoints — review step between investigation and rule proposal."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from temporalio.service import RPCError, RPCStatusCode

from backend.api.schemas import (
    ExplorationStateResponse,
    InvestigationFeedbackRequest,
    InvestigationFeedbackResponse,
)
from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow

router = APIRouter()


def _project_root() -> Path:
    p = Path(__file__)
    while p != p.parent:
        if (p / "pyproject.toml").exists():
            return p
        p = p.parent
    return Path(".")


@router.get("/sessions/{session_id}/exploration", response_model=ExplorationStateResponse)
async def get_exploration_state(session_id: str, request: Request):
    """Return current exploration findings and notebook availability."""
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        state = await handle.query(DQAcceleratorWorkflow.get_exploration)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))

    notebook_path = state.get("notebook_path", "")
    notebook_ready = bool(notebook_path and Path(notebook_path).exists())

    return ExplorationStateResponse(
        exploration_findings=state.get("exploration_findings", {}),
        open_questions=state.get("open_questions", []),
        investigation_round=state.get("investigation_round", 0),
        notebook_ready=notebook_ready,
        synthesis_constrained=state.get("synthesis_constrained", False),
        synthesis_constraint_reasons=state.get("synthesis_constraint_reasons", []),
    )


@router.get("/sessions/{session_id}/exploration/notebook")
async def get_exploration_notebook_html(session_id: str, request: Request):
    """Serve the pre-executed exploration notebook as browser-viewable HTML."""
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        state = await handle.query(DQAcceleratorWorkflow.get_exploration)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))

    notebook_path = state.get("notebook_path", "")
    if not notebook_path:
        raise HTTPException(status_code=404, detail="Notebook not yet generated")

    html_path = Path(notebook_path).with_suffix(".html")
    if not html_path.exists():
        raise HTTPException(status_code=404, detail="Notebook HTML not found on disk")

    return HTMLResponse(content=html_path.read_text(encoding="utf-8"))


@router.get("/sessions/{session_id}/exploration/notebook/download")
async def download_exploration_notebook(session_id: str, request: Request):
    """Download the .ipynb source file for local Jupyter use."""
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        state = await handle.query(DQAcceleratorWorkflow.get_exploration)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))

    notebook_path = state.get("notebook_path", "")
    if not notebook_path or not Path(notebook_path).exists():
        raise HTTPException(status_code=404, detail="Notebook .ipynb not found")

    return FileResponse(
        path=notebook_path,
        media_type="application/octet-stream",
        filename=f"exploration_{session_id[:8]}.ipynb",
    )


@router.post(
    "/sessions/{session_id}/exploration/feedback",
    response_model=InvestigationFeedbackResponse,
)
async def submit_investigation_feedback(
    session_id: str,
    body: InvestigationFeedbackRequest,
    request: Request,
):
    """Submit user feedback on the exploration notebook.

    Set approve=True to proceed to synthesis. Set approve=False with a message
    to trigger a targeted re-investigation round (max 2 rounds total).
    """
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        await handle.signal(
            DQAcceleratorWorkflow.submit_investigation_feedback,
            {"message": body.message, "approve": body.approve},
        )
        state = await handle.query(DQAcceleratorWorkflow.get_exploration)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))

    verb = "approved" if body.approve else "submitted for re-investigation"
    return InvestigationFeedbackResponse(
        accepted=True,
        message=f"Feedback {verb}.",
        investigation_round=state.get("investigation_round", 0),
    )
```

- [ ] **Step 2: Register the router in main.py**

In `backend/api/main.py`, add the import and `include_router` call:

```python
# Add to imports:
from backend.api.routers import sessions, rules, transformations, pipeline, triage, plan_router, exploration

# Add after the last app.include_router call:
app.include_router(exploration.router, prefix="/api/v1", tags=["exploration"])
```

- [ ] **Step 3: Run linter**

```bash
ruff check backend/api/routers/exploration.py backend/api/main.py
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add backend/api/routers/exploration.py backend/api/main.py
git commit -m "feat: add exploration API router with notebook HTML serve, download, and feedback endpoints"
```

---

## Task 11: Self-review pass

- [ ] **Step 1: Run the full test suite**

```bash
pytest -x -q
```
Expected: no new failures. The existing tests that reference `profile_and_analyze_activity` or the old `ProfileAnalyzerState` shape may need minor updates if they construct state dicts directly. Fix any that fail.

- [ ] **Step 2: Lint everything changed**

```bash
ruff check dq_tools/cross_column.py \
    backend/agents/state.py \
    backend/agents/prompts.py \
    backend/agents/graphs/profile_analyzer.py \
    backend/agents/graphs/deep_investigate.py \
    backend/agents/graphs/exploration_notebook.py \
    backend/temporal/activities/investigation_activities.py \
    backend/temporal/activities/data_activities.py \
    backend/temporal/worker.py \
    backend/temporal/workflows/dq_workflow.py \
    backend/api/schemas.py \
    backend/api/routers/exploration.py \
    backend/api/main.py
```
Expected: no errors

- [ ] **Step 3: Verify data flow consistency**

Check these specific points:
- `investigation_findings` is passed to all three activities (profile_and_investigate returns it, synthesize receives it, reinvestigate receives it and returns updated version)
- `exploration_findings` is returned by profile_and_investigate, updated by reinvestigate, passed to synthesize
- `synthesis_constrained` is set on workflow state and passed to synthesize_and_propose_activity
- `get_full_state` query includes `exploration_findings`, `synthesis_constrained`, `synthesis_constraint_reasons`

- [ ] **Step 4: Commit any fixes**

```bash
git add -p
git commit -m "fix: address test and lint issues from self-review pass"
```

---

## Task 12: Final integration commit

- [ ] **Step 1: Run full test suite one more time**

```bash
pytest -q
```
Expected: all tests pass

- [ ] **Step 2: Final commit**

```bash
git commit --allow-empty -m "chore: exploration notebook feature complete — investigation review, cross-column tools, constrained synthesis"
```
