# Inline Structured Findings with AI-Generated Visualizations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the `structure_findings_node` LLM extraction call by having `deep_investigate_node` emit structured `ExplorationFindings` JSON with per-finding `visualization_code` inline via a marker protocol, so no post-processing pass is needed and the notebook shows AI-authored visualizations tailored to each specific finding.

**Architecture:** The investigation agent is given a structured output protocol: after finishing each column it emits a `===COLUMN_FINDING_START===` ... `===COLUMN_FINDING_END===` block containing JSON including Python `visualization_code`. The node parses these blocks from the message stream, populates `exploration_findings` directly, and strips them from the prose text that becomes `investigation_findings`. `structure_findings_node` becomes a fallback that only runs if no blocks were parsed (graceful degradation). The notebook generator prefers `visualization_code` over its current hardcoded generic charts.

**Tech Stack:** Python, regex, LangGraph deepagents, nbformat, pytest, existing `ProfileAnalyzerState` TypedDict.

---

## File Map

| File | Change |
|------|--------|
| `backend/agents/prompts.py` | Append structured output protocol to `PROFILE_INVESTIGATION_SYSTEM` |
| `backend/agents/graphs/deep_investigate.py` | Add `_parse_structured_findings`, `_strip_marker_blocks`, `_merge_findings`, `_extract_ai_text`; update `deep_investigate_node` to collect all AI text, parse markers, return `exploration_findings` |
| `backend/agents/graphs/profile_analyzer.py` | Make `structure_findings_node` a no-op when `exploration_findings` is already populated |
| `backend/agents/graphs/exploration_notebook.py` | Prefer `visualization_code` field over generic `_distribution_cell` / `_cross_column_viz_cell` |
| `tests/backend/agents/test_deep_investigate.py` | Add tests for `_parse_structured_findings`, `_strip_marker_blocks`, `_merge_findings`, updated node output |
| `tests/backend/agents/test_exploration_notebook.py` | Add test that `visualization_code` becomes a code cell |
| `tests/backend/agents/test_structure_findings.py` | Add test that `structure_findings_node` skips when findings already populated |

---

## Task 1: Add structured output protocol to `PROFILE_INVESTIGATION_SYSTEM`

**Files:**
- Modify: `backend/agents/prompts.py` (the `PROFILE_INVESTIGATION_SYSTEM` constant, currently ends at line ~38)

- [ ] **Step 1: Write the failing test**

The test will verify that `PROFILE_INVESTIGATION_SYSTEM` contains all required marker strings.

```python
# tests/backend/agents/test_investigation_prompt.py
def test_investigation_system_prompt_contains_column_finding_markers():
    from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
    assert "===COLUMN_FINDING_START===" in PROFILE_INVESTIGATION_SYSTEM
    assert "===COLUMN_FINDING_END===" in PROFILE_INVESTIGATION_SYSTEM


def test_investigation_system_prompt_contains_cross_column_markers():
    from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
    assert "===CROSS_COLUMN_FINDING_START===" in PROFILE_INVESTIGATION_SYSTEM
    assert "===CROSS_COLUMN_FINDING_END===" in PROFILE_INVESTIGATION_SYSTEM


def test_investigation_system_prompt_contains_summary_markers():
    from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
    assert "===EXPLORATION_SUMMARY_START===" in PROFILE_INVESTIGATION_SYSTEM
    assert "===EXPLORATION_SUMMARY_END===" in PROFILE_INVESTIGATION_SYSTEM


def test_investigation_system_prompt_contains_visualization_code_field():
    from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
    assert "visualization_code" in PROFILE_INVESTIGATION_SYSTEM
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/backend/agents/test_investigation_prompt.py -v
```

Expected: All 4 FAIL — `AssertionError` (markers not in prompt yet).

- [ ] **Step 3: Append the structured output protocol to `PROFILE_INVESTIGATION_SYSTEM`**

In `backend/agents/prompts.py`, the current `PROFILE_INVESTIGATION_SYSTEM` ends with:
```
Do NOT propose rules or fixes. Just investigate and accumulate findings."""
```

Replace that closing with:

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

Do NOT propose rules or fixes. Just investigate and accumulate findings.

## Structured Output Protocol

After finishing each column's investigation (before moving to the next column), emit a structured block:

===COLUMN_FINDING_START===
{
  "column": "<exact column name as it appears in the dataset>",
  "semantic_meaning": "<what this column represents in the business context>",
  "data_type_actual": "<text|numeric|categorical|date|boolean|id>",
  "stats": {
    "null_count": <integer or null>,
    "null_pct": <float 0-100 or null>,
    "distinct_count": <integer or null>,
    "total_rows": <integer or null>
  },
  "full_analysis": "<your complete prose analysis — preserve all counts, percentages, sample values>",
  "issues": [
    {
      "description": "<exact description with counts as you found them>",
      "severity": "critical|warning|info",
      "count": <integer or null>,
      "pct": <float or null>,
      "sample_values": ["<value>"],
      "where_clause": "<DuckDB WHERE condition without WHERE keyword, or null>"
    }
  ],
  "assumptions": ["<inference where business context could change interpretation>"],
  "rule_implications": ["<direction for a potential DQ rule, with threshold if applicable>"],
  "visualization_code": "<see guidelines below>"
}
===COLUMN_FINDING_END===

After all cross-column investigation, emit a block for each cross-column finding:

===CROSS_COLUMN_FINDING_START===
{
  "columns": ["<col1>", "<col2>"],
  "full_analysis": "<complete analysis text>",
  "pattern": "<one-sentence description of the pattern>",
  "severity": "critical|warning|info",
  "investigation_sql": "<SQL SELECT that reveals this pattern, or null>",
  "rule_implications": ["<direction for a DQ rule>"],
  "visualization_code": "<see guidelines below>"
}
===CROSS_COLUMN_FINDING_END===

Finally, emit the exploration summary:

===EXPLORATION_SUMMARY_START===
{
  "open_questions": ["<explicit uncertainty where business context matters — only real unknowns>"],
  "readiness_assessment": "good|moderate|poor",
  "key_risks": ["<specific risk to ML-readiness or downstream analysis>"]
}
===EXPLORATION_SUMMARY_END===

### visualization_code guidelines

The notebook environment has these variables already in scope:
- `df` — pandas DataFrame of the full dataset
- `con` — DuckDB connection (read-only) to the same data
- `plt`, `pd`, `np` — matplotlib.pyplot, pandas, numpy
- All imports are done. Do not add import statements.

Always end with `plt.tight_layout()` then `plt.show()`.
Keep code under 80 lines.

**Always use case-insensitive column resolution:**
```python
_col = next((c for c in df.columns if c.lower() == "column_name".lower()), None)
if _col is None:
    print("Column 'column_name' not found in dataset")
else:
    # visualization code here
```

**Choose the visualization type to match what you found:**
- Format/validity issues: horizontal bar chart of top value_counts; highlight invalid values in orange (#e07b39)
- Nulls conditional on another column: bar chart of null% grouped by the conditioning column
- Numeric distribution with outliers/clusters: histogram with mean/median/p5/p95 vertical lines
- Date range or temporal pattern: bar chart grouped by year or month
- Categorical distribution: top-N value counts horizontal bar chart
- Cross-column SQL pattern: `result = con.execute("YOUR SQL").df()` then plot result columns
- Correlated nulls: side-by-side grouped bar showing null co-occurrence
- Group-over-time (category rename): stacked bar or line chart of group shares per time bin

For re-investigation rounds, emit ===COLUMN_FINDING_START=== blocks only for columns you re-investigated. Do not re-emit blocks for columns whose findings are unchanged."""
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/backend/agents/test_investigation_prompt.py -v
```

Expected: All 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/prompts.py tests/backend/agents/test_investigation_prompt.py
git commit -m "feat: add structured output marker protocol to investigation system prompt"
```

---

## Task 2: Add parsing helpers to `deep_investigate.py`

**Files:**
- Modify: `backend/agents/graphs/deep_investigate.py` (add helpers before `deep_investigate_node`)
- Test: `tests/backend/agents/test_deep_investigate.py`

- [ ] **Step 1: Write the failing tests**

Add these tests to `tests/backend/agents/test_deep_investigate.py`:

```python
# ---------------------------------------------------------------------------
# _extract_ai_text
# ---------------------------------------------------------------------------

def test_extract_ai_text_string_content():
    from backend.agents.graphs.deep_investigate import _extract_ai_text
    msg = MagicMock(spec=AIMessage)
    msg.content = "hello world"
    assert _extract_ai_text(msg) == "hello world"


def test_extract_ai_text_list_content():
    from backend.agents.graphs.deep_investigate import _extract_ai_text
    msg = MagicMock(spec=AIMessage)
    msg.content = [{"type": "text", "text": "part one"}, {"type": "text", "text": "part two"}]
    result = _extract_ai_text(msg)
    assert "part one" in result
    assert "part two" in result


def test_extract_ai_text_empty_list():
    from backend.agents.graphs.deep_investigate import _extract_ai_text
    msg = MagicMock(spec=AIMessage)
    msg.content = []
    assert _extract_ai_text(msg) == ""


# ---------------------------------------------------------------------------
# _strip_marker_blocks
# ---------------------------------------------------------------------------

def test_strip_marker_blocks_removes_column_finding():
    from backend.agents.graphs.deep_investigate import _strip_marker_blocks
    text = "Before.\n===COLUMN_FINDING_START===\n{\"col\": \"x\"}\n===COLUMN_FINDING_END===\nAfter."
    result = _strip_marker_blocks(text)
    assert "COLUMN_FINDING" not in result
    assert "Before." in result
    assert "After." in result


def test_strip_marker_blocks_removes_all_marker_types():
    from backend.agents.graphs.deep_investigate import _strip_marker_blocks
    text = (
        "A\n===COLUMN_FINDING_START===\n{}\n===COLUMN_FINDING_END===\n"
        "B\n===CROSS_COLUMN_FINDING_START===\n{}\n===CROSS_COLUMN_FINDING_END===\n"
        "C\n===EXPLORATION_SUMMARY_START===\n{}\n===EXPLORATION_SUMMARY_END===\nD"
    )
    result = _strip_marker_blocks(text)
    assert "FINDING" not in result
    assert "SUMMARY" not in result
    assert "A" in result
    assert "D" in result


# ---------------------------------------------------------------------------
# _parse_structured_findings
# ---------------------------------------------------------------------------

def _col_block(column: str, viz_code: str = "") -> str:
    import json
    obj = {
        "column": column,
        "semantic_meaning": f"Meaning of {column}",
        "data_type_actual": "text",
        "stats": {"null_count": 0, "null_pct": 0.0, "distinct_count": 10, "total_rows": 100},
        "full_analysis": f"{column} analysis",
        "issues": [],
        "assumptions": [],
        "rule_implications": [],
        "visualization_code": viz_code,
    }
    return f"===COLUMN_FINDING_START===\n{json.dumps(obj)}\n===COLUMN_FINDING_END==="


def _summary_block(readiness: str = "good") -> str:
    import json
    obj = {"open_questions": [], "readiness_assessment": readiness, "key_risks": []}
    return f"===EXPLORATION_SUMMARY_START===\n{json.dumps(obj)}\n===EXPLORATION_SUMMARY_END==="


def test_parse_structured_findings_extracts_column_block():
    from backend.agents.graphs.deep_investigate import _parse_structured_findings
    result = _parse_structured_findings(_col_block("email", "plt.show()"))
    assert len(result["column_findings"]) == 1
    assert result["column_findings"][0]["column"] == "email"
    assert result["column_findings"][0]["visualization_code"] == "plt.show()"


def test_parse_structured_findings_returns_empty_on_no_markers():
    from backend.agents.graphs.deep_investigate import _parse_structured_findings
    result = _parse_structured_findings("No markers here, just prose.")
    assert result["column_findings"] == []
    assert result["cross_column_findings"] == []
    assert result["readiness_assessment"] == "unknown"


def test_parse_structured_findings_extracts_multiple_columns():
    from backend.agents.graphs.deep_investigate import _parse_structured_findings
    text = _col_block("email") + "\n\n" + _col_block("salary")
    result = _parse_structured_findings(text)
    assert len(result["column_findings"]) == 2
    columns = {cf["column"] for cf in result["column_findings"]}
    assert columns == {"email", "salary"}


def test_parse_structured_findings_extracts_summary():
    from backend.agents.graphs.deep_investigate import _parse_structured_findings
    text = _col_block("age") + "\n" + _summary_block("poor")
    result = _parse_structured_findings(text)
    assert result["readiness_assessment"] == "poor"


def test_parse_structured_findings_handles_invalid_json_gracefully():
    from backend.agents.graphs.deep_investigate import _parse_structured_findings
    text = "===COLUMN_FINDING_START===\nNOT VALID JSON {{{\n===COLUMN_FINDING_END==="
    result = _parse_structured_findings(text)
    assert result["column_findings"] == []  # invalid block skipped, no crash


def test_parse_structured_findings_extracts_cross_column_finding():
    from backend.agents.graphs.deep_investigate import _parse_structured_findings
    import json
    obj = {
        "columns": ["A", "B"],
        "full_analysis": "A and B are related",
        "pattern": "A increases with B",
        "severity": "warning",
        "investigation_sql": "SELECT A, B FROM working_data LIMIT 10",
        "rule_implications": [],
        "visualization_code": "plt.scatter(df['A'], df['B']); plt.show()",
    }
    text = f"===CROSS_COLUMN_FINDING_START===\n{json.dumps(obj)}\n===CROSS_COLUMN_FINDING_END==="
    result = _parse_structured_findings(text)
    assert len(result["cross_column_findings"]) == 1
    assert result["cross_column_findings"][0]["columns"] == ["A", "B"]


# ---------------------------------------------------------------------------
# _merge_findings
# ---------------------------------------------------------------------------

def test_merge_findings_new_overrides_prior_by_column():
    from backend.agents.graphs.deep_investigate import _merge_findings
    prior = {
        "column_findings": [{"column": "email", "visualization_code": "old_code"}],
        "cross_column_findings": [],
        "open_questions": [],
        "readiness_assessment": "unknown",
        "key_risks": [],
    }
    new = {
        "column_findings": [{"column": "email", "visualization_code": "new_code"}],
        "cross_column_findings": [],
        "open_questions": [],
        "readiness_assessment": "good",
        "key_risks": [],
    }
    result = _merge_findings(prior, new)
    assert len(result["column_findings"]) == 1
    assert result["column_findings"][0]["visualization_code"] == "new_code"


def test_merge_findings_keeps_prior_columns_not_in_new():
    from backend.agents.graphs.deep_investigate import _merge_findings
    prior = {
        "column_findings": [
            {"column": "email", "visualization_code": "e_code"},
            {"column": "salary", "visualization_code": "s_code"},
        ],
        "cross_column_findings": [],
        "open_questions": [],
        "readiness_assessment": "moderate",
        "key_risks": [],
    }
    new = {
        "column_findings": [{"column": "salary", "visualization_code": "s_new"}],
        "cross_column_findings": [],
        "open_questions": ["new question"],
        "readiness_assessment": "good",
        "key_risks": [],
    }
    result = _merge_findings(prior, new)
    assert len(result["column_findings"]) == 2
    col_map = {cf["column"]: cf for cf in result["column_findings"]}
    assert col_map["email"]["visualization_code"] == "e_code"   # unchanged
    assert col_map["salary"]["visualization_code"] == "s_new"   # updated


def test_merge_findings_new_cross_overrides_prior():
    from backend.agents.graphs.deep_investigate import _merge_findings
    prior = {
        "column_findings": [],
        "cross_column_findings": [{"columns": ["A", "B"], "pattern": "old"}],
        "open_questions": [],
        "readiness_assessment": "unknown",
        "key_risks": [],
    }
    new = {
        "column_findings": [{"column": "X", "visualization_code": ""}],
        "cross_column_findings": [{"columns": ["C", "D"], "pattern": "new"}],
        "open_questions": [],
        "readiness_assessment": "poor",
        "key_risks": [],
    }
    result = _merge_findings(prior, new)
    assert result["cross_column_findings"][0]["columns"] == ["C", "D"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/backend/agents/test_deep_investigate.py -v -k "extract_ai_text or strip_marker or parse_structured or merge_findings"
```

Expected: All FAIL with `ImportError` (functions don't exist yet).

- [ ] **Step 3: Add the four helper functions to `backend/agents/graphs/deep_investigate.py`**

Insert after the `_progress_path` helper (after line ~161) and before `_build_deep_investigate_agent`:

```python
# ---------------------------------------------------------------------------
# Structured findings helpers
# ---------------------------------------------------------------------------

def _extract_ai_text(msg: AIMessage) -> str:
    """Extract text content from an AIMessage regardless of content format."""
    if isinstance(msg.content, str):
        return msg.content.strip()
    if isinstance(msg.content, list):
        parts = [
            b["text"]
            for b in msg.content
            if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip()
        ]
        return "\n".join(parts)
    return ""


def _strip_marker_blocks(text: str) -> str:
    """Remove all ===*_START=== ... ===*_END=== blocks, leaving only prose."""
    import re
    for start, end in [
        ("===COLUMN_FINDING_START===", "===COLUMN_FINDING_END==="),
        ("===CROSS_COLUMN_FINDING_START===", "===CROSS_COLUMN_FINDING_END==="),
        ("===EXPLORATION_SUMMARY_START===", "===EXPLORATION_SUMMARY_END==="),
    ]:
        text = re.sub(
            re.escape(start) + r"[\s\S]*?" + re.escape(end),
            "",
            text,
            flags=re.DOTALL,
        )
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _parse_structured_findings(text: str) -> dict:
    """Parse ===COLUMN_FINDING_START=== / ===CROSS_COLUMN_FINDING_START=== / ===EXPLORATION_SUMMARY_START=== blocks.

    Returns an ExplorationFindings-shaped dict. Returns a minimal valid structure on any failure.
    """
    import re

    def _extract_blocks(start_marker: str, end_marker: str) -> list:
        pattern = re.compile(
            re.escape(start_marker) + r"\s*([\s\S]*?)\s*" + re.escape(end_marker)
        )
        blocks = []
        for m in pattern.finditer(text):
            raw = m.group(1).strip()
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    blocks.append(parsed)
            except json.JSONDecodeError:
                logger.warning(
                    "_parse_structured_findings: skipping unparseable block (first 120 chars): %s",
                    raw[:120],
                )
        return blocks

    column_findings = _extract_blocks("===COLUMN_FINDING_START===", "===COLUMN_FINDING_END===")
    cross_findings = _extract_blocks(
        "===CROSS_COLUMN_FINDING_START===", "===CROSS_COLUMN_FINDING_END==="
    )
    summary_blocks = _extract_blocks(
        "===EXPLORATION_SUMMARY_START===", "===EXPLORATION_SUMMARY_END==="
    )
    summary = summary_blocks[0] if summary_blocks else {}

    return {
        "column_findings": column_findings,
        "cross_column_findings": cross_findings,
        "open_questions": summary.get("open_questions", []),
        "readiness_assessment": summary.get("readiness_assessment", "unknown"),
        "key_risks": summary.get("key_risks", []),
    }


def _merge_findings(prior: dict, new: dict) -> dict:
    """Merge new column/cross findings into prior structured findings.

    New column_findings override prior ones by column name.
    Cross-column and summary fields come from new if new has any column_findings, else prior.
    """
    prior_cols: dict = {cf["column"]: cf for cf in prior.get("column_findings", [])}
    for cf in new.get("column_findings", []):
        prior_cols[cf["column"]] = cf

    has_new_data = bool(new.get("column_findings"))
    return {
        "column_findings": list(prior_cols.values()),
        "cross_column_findings": (
            new.get("cross_column_findings") or prior.get("cross_column_findings", [])
        ),
        "open_questions": (
            new.get("open_questions") if has_new_data else prior.get("open_questions", [])
        ),
        "readiness_assessment": (
            new.get("readiness_assessment", "unknown")
            if has_new_data
            else prior.get("readiness_assessment", "unknown")
        ),
        "key_risks": (
            new.get("key_risks") if has_new_data else prior.get("key_risks", [])
        ),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/backend/agents/test_deep_investigate.py -v -k "extract_ai_text or strip_marker or parse_structured or merge_findings"
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/graphs/deep_investigate.py tests/backend/agents/test_deep_investigate.py
git commit -m "feat: add _parse_structured_findings, _strip_marker_blocks, _merge_findings helpers"
```

---

## Task 3: Update `deep_investigate_node` to populate `exploration_findings`

**Files:**
- Modify: `backend/agents/graphs/deep_investigate.py` (the `deep_investigate_node` function)
- Test: `tests/backend/agents/test_deep_investigate.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/backend/agents/test_deep_investigate.py`:

```python
# ---------------------------------------------------------------------------
# deep_investigate_node — exploration_findings output
# ---------------------------------------------------------------------------

def _make_state_full(session_id: str = "test-session") -> dict:
    """Full state dict matching ProfileAnalyzerState."""
    return {
        "session_id": session_id,
        "use_case": "HR employee records",
        "description": None,
        "target_column": None,
        "overview_notes": "Dataset has 5 columns.",
        "columns_to_investigate": [{"column": "email", "reason": "format"}],
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
        "rule_revision_log": [],
    }


import json as _json


def _make_col_finding_text(column: str) -> str:
    obj = {
        "column": column,
        "semantic_meaning": f"Meaning of {column}",
        "data_type_actual": "text",
        "stats": {"null_count": 5, "null_pct": 0.5, "distinct_count": 99, "total_rows": 100},
        "full_analysis": f"{column} has issues",
        "issues": [],
        "assumptions": [],
        "rule_implications": [],
        "visualization_code": f"# {column}_viz\nplt.show()",
    }
    return f"===COLUMN_FINDING_START===\n{_json.dumps(obj)}\n===COLUMN_FINDING_END==="


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_node_populates_exploration_findings_from_markers(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    ai_msg = MagicMock(spec=AIMessage)
    ai_msg.content = _make_col_finding_text("email")
    ai_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [ai_msg]}])
    mock_build.return_value = mock_agent

    result = deep_investigate_node(_make_state_full())

    assert "column_findings" in result["exploration_findings"]
    assert len(result["exploration_findings"]["column_findings"]) == 1
    assert result["exploration_findings"]["column_findings"][0]["column"] == "email"
    assert result["exploration_findings"]["column_findings"][0]["visualization_code"] == "# email_viz\nplt.show()"


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_node_strips_markers_from_investigation_findings(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    ai_msg = MagicMock(spec=AIMessage)
    ai_msg.content = "Some prose.\n" + _make_col_finding_text("email") + "\nMore prose."
    ai_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [ai_msg]}])
    mock_build.return_value = mock_agent

    result = deep_investigate_node(_make_state_full())

    assert "COLUMN_FINDING" not in result["investigation_findings"]
    assert "Some prose." in result["investigation_findings"]
    assert "More prose." in result["investigation_findings"]


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_node_merges_findings_in_reinvestigation_round(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    ai_msg = MagicMock(spec=AIMessage)
    ai_msg.content = _make_col_finding_text("salary")  # only salary re-investigated
    ai_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [ai_msg]}])
    mock_build.return_value = mock_agent

    state = _make_state_full()
    state["investigation_round"] = 1
    state["investigation_feedback"] = "Check salary column more carefully"
    state["exploration_findings"] = {
        "column_findings": [
            {"column": "email", "visualization_code": "# email prior", "semantic_meaning": "email", "data_type_actual": "text", "stats": {}, "full_analysis": "email findings", "issues": [], "assumptions": [], "rule_implications": []},
        ],
        "cross_column_findings": [],
        "open_questions": [],
        "readiness_assessment": "unknown",
        "key_risks": [],
    }

    result = deep_investigate_node(state)

    col_map = {cf["column"]: cf for cf in result["exploration_findings"]["column_findings"]}
    assert "email" in col_map          # prior preserved
    assert "salary" in col_map         # new one added
    assert col_map["email"]["visualization_code"] == "# email prior"


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_node_exploration_findings_empty_when_no_markers(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    ai_msg = MagicMock(spec=AIMessage)
    ai_msg.content = "Just prose, no markers."
    ai_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [ai_msg]}])
    mock_build.return_value = mock_agent

    result = deep_investigate_node(_make_state_full())

    # exploration_findings should still be a valid dict, just empty column_findings
    assert isinstance(result["exploration_findings"], dict)
    assert result["exploration_findings"]["column_findings"] == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/backend/agents/test_deep_investigate.py -v -k "populates_exploration or strips_markers or merges_findings or empty_when_no_markers"
```

Expected: All 4 FAIL — `KeyError: 'exploration_findings'` or `AssertionError`.

- [ ] **Step 3: Rewrite `deep_investigate_node`**

Replace the entire `deep_investigate_node` function in `backend/agents/graphs/deep_investigate.py`:

```python
def deep_investigate_node(state: ProfileAnalyzerState) -> ProfileAnalyzerState:
    """Deep investigation node backed by create_deep_agent.

    Investigates the dataset using dq_* tools and emits structured
    ===COLUMN_FINDING_START=== marker blocks inline. These blocks are parsed
    to populate exploration_findings directly — no separate structure_findings_node
    LLM call needed. The marker blocks are stripped from investigation_findings
    (the prose text used for synthesis and the notebook appendix).
    """
    session_id = state["session_id"]

    # Clear any leftover progress file from a previous run
    prog = _progress_path(session_id)
    if prog.exists():
        prog.unlink()

    logger.info(
        "[deep_investigate:%s] Starting — %d columns queued",
        session_id[:8],
        len(state.get("columns_to_investigate", [])),
    )

    agent = _build_deep_investigate_agent()
    context = InvestigationContext(session_id=session_id)

    context_lines = [f"Dataset: {state['use_case']}"]
    if state.get("target_column"):
        context_lines.append(f"Target column (ML label): {state['target_column']}")
    context_header = "\n".join(context_lines)

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
- After re-investigating a column, emit an updated ===COLUMN_FINDING_START=== block
  for that column only (using the full structured output protocol from your system prompt).
  Do NOT re-emit blocks for columns whose findings are unchanged.
- At the end, emit updated ===CROSS_COLUMN_FINDING_START=== blocks if relevant,
  and always emit a final ===EXPLORATION_SUMMARY_START=== block.

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

When you finish investigating each column, immediately emit its ===COLUMN_FINDING_START===
block (as described in your system prompt) before moving to the next column.
After all columns, emit cross-column blocks, then the ===EXPLORATION_SUMMARY_START=== block."""
        )

    config: RunnableConfig = {
        "recursion_limit": 300,
    }

    all_ai_text: list[str] = []
    seen = 0
    final_state = None

    try:
        for chunk in agent.stream(
            {"messages": [initial_message]},
            config=config,
            context=context,
            stream_mode="values",
        ):
            messages = chunk.get("messages", [])
            for msg in messages[seen:]:
                if isinstance(msg, AIMessage):
                    text = _extract_ai_text(msg)
                    if text:
                        all_ai_text.append(text)
                    # Emit text reasoning (excluding marker blocks for brevity)
                    prose = _strip_marker_blocks(text)
                    if prose.strip():
                        _emit(session_id, "thinking", text=prose.strip()[:300])
                    # Emit outbound tool calls
                    for tc in getattr(msg, "tool_calls", []):
                        _emit(session_id, "tool_call", tool=tc["name"], input=tc.get("args", {}))
                elif isinstance(msg, ToolMessage):
                    _emit(
                        session_id,
                        "tool_result",
                        tool=getattr(msg, "name", "unknown"),
                        preview=str(msg.content)[:80],
                    )
            seen = len(messages)
            final_state = chunk
    except GraphRecursionError:
        logger.warning(
            "[deep_investigate:%s] Recursion limit reached — using findings accumulated so far (%d messages)",
            session_id[:8],
            seen,
        )

    _emit(session_id, "done", total_messages=seen)

    # Parse structured findings from all AI text collected during the stream
    full_text = "\n".join(all_ai_text)
    new_findings = _parse_structured_findings(full_text)
    raw_findings = _strip_marker_blocks(full_text)

    # For re-investigation: merge new findings with prior
    if investigation_round > 0:
        prior = state.get("exploration_findings", {})
        exploration_findings = _merge_findings(prior, new_findings)
        investigation_findings = (
            state.get("investigation_findings", "") + "\n\n---\n\n" + raw_findings
        ).strip()
    else:
        exploration_findings = new_findings
        investigation_findings = raw_findings

    return {
        **state,
        "investigation_findings": investigation_findings,
        "exploration_findings": exploration_findings,
        "cross_column_findings": exploration_findings.get("cross_column_findings", []),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/backend/agents/test_deep_investigate.py -v
```

Expected: All PASS (including all previously passing tests).

- [ ] **Step 5: Commit**

```bash
git add backend/agents/graphs/deep_investigate.py tests/backend/agents/test_deep_investigate.py
git commit -m "feat: deep_investigate_node parses inline COLUMN_FINDING markers into exploration_findings"
```

---

## Task 4: Make `structure_findings_node` a fallback

**Files:**
- Modify: `backend/agents/graphs/profile_analyzer.py` (`structure_findings_node` function, lines ~336-397)
- Test: `tests/backend/agents/test_structure_findings.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/backend/agents/test_structure_findings.py`:

```python
def test_structure_findings_node_skips_when_exploration_findings_populated():
    from backend.agents.graphs.profile_analyzer import structure_findings_node

    state = _make_state(
        rule_revision_log=[],
        exploration_findings={
            "column_findings": [
                {
                    "column": "email",
                    "semantic_meaning": "contact email",
                    "data_type_actual": "text",
                    "stats": {},
                    "full_analysis": "Email analysis",
                    "issues": [],
                    "assumptions": [],
                    "rule_implications": [],
                    "visualization_code": "plt.show()",
                }
            ],
            "cross_column_findings": [],
            "open_questions": [],
            "readiness_assessment": "good",
            "key_risks": [],
        },
    )

    with patch("backend.agents.graphs.profile_analyzer.call_claude_with_retry") as mock_call:
        result = structure_findings_node(state)

    mock_call.assert_not_called()
    assert result["exploration_findings"]["column_findings"][0]["column"] == "email"
    assert result["exploration_findings"]["column_findings"][0]["visualization_code"] == "plt.show()"
```

Note: `_make_state` in `test_structure_findings.py` uses `base.update(overrides)` so you can pass any extra fields as keyword args. Add `rule_revision_log=[]` to the base state in `_make_state` since `ProfileAnalyzerState` now requires it:

```python
def _make_state(**overrides) -> ProfileAnalyzerState:
    base: ProfileAnalyzerState = {
        "session_id": "test-session",
        "use_case": "test use case",
        "target_column": None,
        "description": None,
        "overview_notes": "",
        "columns_to_investigate": [],
        "investigation_findings": "Email column: 847 values (3.2%) fail email format.",
        "cross_column_findings": [],
        "exploration_findings": {},
        "exploration_notebook_path": "",
        "investigation_feedback": None,
        "investigation_round": 0,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": [],
        "top_issues": [],
        "rule_revision_log": [],   # ← add this line
    }
    base.update(overrides)
    return base
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/backend/agents/test_structure_findings.py::test_structure_findings_node_skips_when_exploration_findings_populated -v
```

Expected: FAIL — `call_claude_with_retry` is still called.

- [ ] **Step 3: Update `structure_findings_node` in `profile_analyzer.py`**

Replace the docstring and add the early-return guard at the top of `structure_findings_node`:

```python
def structure_findings_node(state: ProfileAnalyzerState) -> ProfileAnalyzerState:
    """Extract ExplorationFindings from raw text — fallback only.

    If deep_investigate_node already populated exploration_findings via the
    ===COLUMN_FINDING_START=== marker protocol, this function is a no-op.
    Only runs the LLM extraction call when exploration_findings is empty or
    contains only the __raw__ fallback entry.
    """
    ef = state.get("exploration_findings", {})
    col_findings = ef.get("column_findings", [])
    if col_findings and col_findings[0].get("column") != "__raw__":
        logger.info(
            "[structure_findings:%s] Inline extraction already populated — skipping LLM call",
            state["session_id"][:8],
        )
        return state

    import anthropic

    client = anthropic.Anthropic()

    response = call_claude_with_retry(
        client,
        model="claude-sonnet-4-6",
        max_tokens=16384,
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

- [ ] **Step 4: Run all structure_findings tests**

```bash
pytest tests/backend/agents/test_structure_findings.py -v
```

Expected: All 5 PASS (4 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add backend/agents/graphs/profile_analyzer.py tests/backend/agents/test_structure_findings.py
git commit -m "feat: structure_findings_node skips LLM call when inline extraction already populated findings"
```

---

## Task 5: Update notebook generator to use `visualization_code`

**Files:**
- Modify: `backend/agents/graphs/exploration_notebook.py` (`_build_notebook` function)
- Test: `tests/backend/agents/test_exploration_notebook.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/backend/agents/test_exploration_notebook.py`:

```python
def test_build_notebook_uses_visualization_code_for_column(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    findings = {
        **SAMPLE_FINDINGS,
        "column_findings": [
            {
                **SAMPLE_FINDINGS["column_findings"][0],
                "visualization_code": "# MY_CUSTOM_VIZ_MARKER\nprint('done')",
            }
        ],
    }
    nb = _build_notebook(session_id, findings, "raw text")
    code_sources = [c.source for c in nb.cells if c.cell_type == "code"]
    assert any("MY_CUSTOM_VIZ_MARKER" in s for s in code_sources)


def test_build_notebook_falls_back_to_generic_chart_when_no_viz_code(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    # SAMPLE_FINDINGS column_findings has no visualization_code key
    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "raw text")
    code_sources = [c.source for c in nb.cells if c.cell_type == "code"]
    # Should still have a code cell for the column (generic _distribution_cell fallback)
    non_setup = [s for s in code_sources if "SESSION_DB" not in s]
    assert len(non_setup) > 0


def test_build_notebook_uses_visualization_code_for_cross_column(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    findings = {
        **SAMPLE_FINDINGS,
        "cross_column_findings": [
            {
                **SAMPLE_FINDINGS["cross_column_findings"][0],
                "visualization_code": "# CROSS_COL_VIZ_MARKER\nprint('cross')",
            }
        ],
    }
    nb = _build_notebook(session_id, findings, "raw text")
    code_sources = [c.source for c in nb.cells if c.cell_type == "code"]
    assert any("CROSS_COL_VIZ_MARKER" in s for s in code_sources)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/backend/agents/test_exploration_notebook.py -v -k "visualization_code or falls_back_to_generic"
```

Expected: `test_build_notebook_uses_visualization_code_for_column` FAIL — custom viz code not used. Others may pass accidentally; verify the key assertion fails.

- [ ] **Step 3: Update `_build_notebook` in `exploration_notebook.py`**

In the **per-column section** of `_build_notebook`, replace:

```python
        # Distribution plot
        cells.append(new_code_cell(
            _distribution_cell(column, cf.get("data_type_actual", "text"), issues)
        ))
```

With:

```python
        # Visualization — prefer AI-generated code, fall back to generic chart
        viz_code = cf.get("visualization_code", "").strip()
        if viz_code:
            cells.append(new_code_cell(viz_code))
        else:
            cells.append(new_code_cell(
                _distribution_cell(column, cf.get("data_type_actual", "text"), issues)
            ))
```

In the **cross-column section**, replace:

```python
            sql = finding.get("investigation_sql")
            if sql:
                cells.append(new_code_cell(_cross_column_viz_cell(i, cols, sql)))
```

With:

```python
            viz_code = finding.get("visualization_code", "").strip()
            if viz_code:
                cells.append(new_code_cell(viz_code))
            elif finding.get("investigation_sql"):
                cells.append(new_code_cell(_cross_column_viz_cell(i, cols, finding["investigation_sql"])))
```

- [ ] **Step 4: Run all notebook tests**

```bash
pytest tests/backend/agents/test_exploration_notebook.py -v
```

Expected: All PASS (7 existing + 3 new = 10 total).

- [ ] **Step 5: Commit**

```bash
git add backend/agents/graphs/exploration_notebook.py tests/backend/agents/test_exploration_notebook.py
git commit -m "feat: notebook uses AI-generated visualization_code per finding, falls back to generic charts"
```

---

## Task 6: Wire up and verify end-to-end

**Files:**
- No code changes — verify existing wiring is correct
- Test: run the full test suite

The investigation flow is:
1. `profile_and_investigate_activity` calls `read_overview_node` → `deep_investigate_node` → `structure_findings_node`
2. `deep_investigate_node` now populates `exploration_findings` directly
3. `structure_findings_node` sees non-empty `column_findings` → returns state unchanged
4. `generate_exploration_notebook` uses `exploration_findings.column_findings[*].visualization_code`

The re-investigation flow (`reinvestigate_activity`) calls `deep_investigate_node` → `structure_findings_node` with `investigation_round > 0`. The node merges new findings with prior via `_merge_findings`.

- [ ] **Step 1: Run the full test suite**

```bash
pytest tests/backend/agents/ tests/backend/api/test_preview_schema.py tests/dq_tools/ -v
```

Expected: All previously passing tests still pass. New tests from Tasks 1–5 pass.

- [ ] **Step 2: Verify the `_make_state` in `test_deep_investigate.py` doesn't break old tests**

The old `_make_state` helper doesn't include `exploration_findings`, `cross_column_findings`, `rule_revision_log`, etc. The old tests using `_make_state` (not `_make_state_full`) still work because `deep_investigate_node` uses `.get()` for those keys. Verify:

```bash
pytest tests/backend/agents/test_deep_investigate.py -v
```

Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "chore: verify end-to-end wiring after inline structured findings refactor"
```

Only commit if there are unstaged changes. If all changes are already committed from Tasks 1–5, skip this step.

---

## Self-Review Checklist

After writing this plan, I checked it against the goals:

**Spec coverage:**
- ✅ Eliminate `structure_findings_node` as primary path (it's a fallback now)
- ✅ `deep_investigate_node` emits markers inline per column
- ✅ `visualization_code` per finding used by notebook
- ✅ Fallback to generic charts when `visualization_code` absent
- ✅ Fallback to LLM extraction when no markers parsed (graceful degradation)
- ✅ Re-investigation merges rather than replaces prior findings
- ✅ `investigation_findings` prose still available for synthesis and appendix

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:**
- `_parse_structured_findings` returns `dict` with keys matching `ExplorationFindings` schema used everywhere else
- `_merge_findings` takes/returns the same dict shape
- `exploration_findings` key in state is `dict` throughout — consistent with `ProfileAnalyzerState`
- `visualization_code` field added to column_findings dicts — notebook reads it with `.get("visualization_code", "")` — safe if absent
