# Rule Contradiction Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-powered cross-rule contradiction detection at two points: a pre-approval deep agent that resolves contradictions in `suggested_rules` before the user sees them, and a triage post-pass that flags fix-cascade conflicts among classified failing rules.

**Architecture:** A `create_deep_agent`-backed `deep_rule_review_node` runs as a new `RULE_REVIEW` Temporal stage between `PROFILING_SYNTHESIS` and `AWAITING_RULE_APPROVAL`. It reads profile data first and queries DuckDB on demand, then rewrites `suggested_rules` in place with a `rule_revision_log`. The existing `triage_node` gains a `_detect_triage_contradictions` post-pass — a single focused LLM call (no tool loop) that appends a `contradictions` list to the triage output.

**Tech Stack:** Python, LangGraph (`create_deep_agent`, `ToolRuntime`), Anthropic SDK (`call_claude_with_retry`), Temporal activities, TypedDict state.

---

## File Map

| File | Change |
|---|---|
| `backend/agents/state.py` | Add `rule_revision_log: list[dict]` to `ProfileAnalyzerState`; add `contradictions: list[dict]` to `TriageAgentState` |
| `backend/agents/prompts.py` | Add `RULE_REVIEW_SYSTEM` and `TRIAGE_CONTRADICTION_SYSTEM` constants |
| `backend/agents/graphs/deep_rule_review.py` | **New** — `create_deep_agent`-backed pre-approval node |
| `backend/agents/graphs/triage_agent.py` | Add `_detect_triage_contradictions`; wire into `triage_node` and `run_triage_agent` |
| `backend/temporal/activities/investigation_activities.py` | Add `review_rules_activity` and `_review_rules_sync` |
| `backend/temporal/workflows/dq_workflow.py` | Add `RULE_REVIEW` stage; add `self.rule_revision_log`; update queries; import new activity |
| `frontend/lib/types.ts` | Add `'RULE_REVIEW'` to `WorkflowStage` union |
| `tests/backend/agents/test_rule_review.py` | **New** — unit tests for `deep_rule_review_node` |
| `tests/backend/agents/test_triage_contradiction.py` | **New** — unit tests for `_detect_triage_contradictions` |

---

## Task 1: State Schema Changes

**Files:**
- Modify: `backend/agents/state.py`

- [ ] **Step 1: Add `rule_revision_log` to `ProfileAnalyzerState` and `contradictions` to `TriageAgentState`**

Open `backend/agents/state.py`. The current `ProfileAnalyzerState` ends at `top_issues`. Add one field after it. The current `TriageAgentState` ends at `summary`. Add one field after it.

```python
class ProfileAnalyzerState(TypedDict):
    # Inputs — session_id is the key; large data lives on disk, not in state
    session_id: str
    use_case: str
    target_column: str | None
    description: str | None
    # Phase 1: overview
    overview_notes: str
    columns_to_investigate: list[dict]      # [{column, reason}, ...]
    # Phase 2: investigation
    investigation_findings: str             # running notes from tool-calling loop
    # Phase 2b: cross-column analysis findings (extracted by propose_rules_node)
    cross_column_findings: list[dict]       # [{cat_col, time_col, finding, severity}, ...]
    # Phase 2c: structured findings extraction
    exploration_findings: dict              # ExplorationFindings JSON
    exploration_notebook_path: str          # absolute path to generated .ipynb
    investigation_feedback: str | None      # user's free-form feedback message
    investigation_round: int                # 0 = first pass, 1-2 = re-investigation rounds
    # Phase 3: synthesize
    data_passport: str                      # structured "what this data is"
    # Phase 4: rules (final outputs)
    ai_summary: str
    suggested_rules: list[dict]
    top_issues: list[str]
    # Phase 4b: rule review (pre-approval contradiction resolution)
    rule_revision_log: list[dict]           # [{rule_ids, conflict_type, description, resolution, original_rules}]


class TriageAgentState(TypedDict):
    session_id: str
    failing_rules: list[dict]   # per_rule entries where passed=False
    use_case: str
    # Outputs
    classifications: list[dict]
    summary: dict               # {transform_fixable, threshold_too_strict, unfixable, eval_error}
    contradictions: list[dict]  # [{rule_ids, conflict_type, description, suggested_fix}]
```

- [ ] **Step 2: Verify no existing tests break**

```bash
pytest tests/ -x -q 2>&1 | tail -20
```

Expected: all existing tests pass (no runtime impact from TypedDict field additions).

- [ ] **Step 3: Commit**

```bash
git add backend/agents/state.py
git commit -m "feat: add rule_revision_log and contradictions fields to state schemas"
```

---

## Task 2: Add Prompts

**Files:**
- Modify: `backend/agents/prompts.py`

- [ ] **Step 1: Append `RULE_REVIEW_SYSTEM` and `TRIAGE_CONTRADICTION_SYSTEM` at the end of `backend/agents/prompts.py`**

```python
RULE_REVIEW_SYSTEM = """You are a data quality rule consistency analyst. Your job is to review a proposed DQ rule set and resolve any contradictions before the user approves them.

Start by calling get_rules() to see the full rule set, then get_profile_summary() to understand the data profile.

Contradiction types to find and resolve:

1. **null_conflict**: A null_invalid or filter_rows rule will null/remove rows from column X, but a not_null rule on the same column has a 0% (or very tight) threshold. Use dq_run_sql or dq_get_value_counts to estimate how many rows the null_invalid will affect, then raise the not_null threshold to accommodate.

2. **value_set_conflict**: A value_in_set rule allows values [A, B] but a custom_sql rule on the same column only passes rows with a different value. Reconcile the allowed value sets.

3. **range_transform_conflict**: A range rule [min, max] on a column whose profile shows many values outside that range. Triage will null those out-of-range values, which then breaks a not_null rule on the same column. Raise the not_null threshold to accommodate the expected null rate.

4. **threshold_arithmetic**: Two rules on the same column where the combined realistic failure rate exceeds both thresholds. Use the profile null_pct or value distribution to estimate realistic pass rates and raise the tighter threshold.

5. **logical_impossibility**: A unique constraint combined with constraints that make deduplication impossible (e.g., a column the dedup is keyed on has a not_null rule that will be violated during dedup row removal). Remove or rekey the conflicting constraint.

Investigation strategy:
- ALWAYS call get_rules() and get_profile_summary() first. Most conflicts resolve from profile data alone.
- Only call dq_run_sql, dq_get_value_counts, or dq_get_sample_rows when you need a quantitative count the profile doesn't provide (e.g., "exactly how many rows fail this pattern?").
- Use write_todos to track which rule pairs you need to verify.
- Review ALL rule pairs — cross-column rules can interact with single-column rules on related columns.

Resolution principles:
- Prefer raising a threshold over removing a rule.
- Prefer tightening the rule that addresses a real quality issue over loosening it.
- Never change a rule's check type or column — only adjust threshold, values, pattern, min, max, or rationale.
- If a conflict cannot be resolved by threshold adjustment alone, set proposed_remove=true on the weaker rule and explain why in the revision_log.

When done, output ONLY a JSON object:
{
  "revised_rules": [ /* complete rule list, same schema as input, with conflicts resolved */ ],
  "revision_log": [
    {
      "rule_ids": ["r2", "r5"],
      "conflict_type": "null_conflict",
      "description": "r2 null_invalid on email will null ~12% of rows based on regex match rate; r5 not_null on email has 0% threshold",
      "resolution": "Raised r5 threshold from 0.0 to 0.15 to accommodate nulls introduced by r2 fix",
      "original_rules": {"r2": {<original r2 dict>}, "r5": {<original r5 dict>}}
    }
  ]
}

If no contradictions are found, return the original rules unchanged with "revision_log": [].
Do NOT modify rules that have no contradictions.
Do NOT add, remove, or reorder rules except as described above."""


TRIAGE_CONTRADICTION_SYSTEM = """You are a data quality rule conflict analyst. Given a set of classified failing rules, identify fix-cascade contradictions: cases where applying the recommended fix for one rule will break another rule on the next validation pass.

Fix-cascade patterns to detect:

1. **fix_cascade**: Rule A is transform_fixable via null_invalid on column X. Rule B is a currently-passing not_null rule (or another rule) on the same column. Applying the null_invalid fix for A will introduce nulls that cause B to fail next pass.

2. **fix_order**: Two transform_fixable rules target the same column with fixes that cancel each other out if applied in the wrong order. Example: rule A is null_invalid (nulls bad values), rule B is impute_constant on the same column (fills nulls with a constant). If impute runs before null_invalid, the imputed values get nulled out — wasted step. If null_invalid runs before impute, the nulls are filled correctly. Flag this as fix_order so the transformation planner can sequence them correctly.

3. **threshold_cascade**: A threshold_too_strict reclassification with a proposed new threshold on column X would, if accepted, push the effective failure rate of another rule on column X above that rule's own threshold.

For each contradiction, identify:
- rule_ids: the two rules involved
- conflict_type: "fix_cascade", "fix_order", or "threshold_cascade"
- description: specific description referencing column names, check types, and what breaks
- suggested_fix: one of:
  - {"target_rule": "<rule_id>", "action": "raise_threshold", "proposed_threshold": <float>, "rationale": "<why>"}
  - {"target_rule": "<rule_id>", "action": "reorder_fix", "rationale": "<which fix should run first and why>"}
  - {"target_rule": "<rule_id>", "action": "remove_rule", "rationale": "<why this rule should be dropped>"}

Output ONLY a JSON object:
{
  "contradictions": [
    {
      "rule_ids": ["r3", "r7"],
      "conflict_type": "fix_cascade",
      "description": "Fixing r3 via null_invalid on email will null ~12% of rows; r7 is a passing not_null on email at 0% threshold — it will fail next validation pass.",
      "suggested_fix": {
        "target_rule": "r7",
        "action": "raise_threshold",
        "proposed_threshold": 0.15,
        "rationale": "Accommodate nulls introduced by r3 null_invalid fix"
      }
    }
  ]
}

If no contradictions are found: {"contradictions": []}
Output ONLY the JSON object. No prose."""
```

- [ ] **Step 2: Verify prompts are importable**

```bash
python -c "from backend.agents.prompts import RULE_REVIEW_SYSTEM, TRIAGE_CONTRADICTION_SYSTEM; print('OK', len(RULE_REVIEW_SYSTEM), len(TRIAGE_CONTRADICTION_SYSTEM))"
```

Expected: `OK <number> <number>` with no import errors.

- [ ] **Step 3: Commit**

```bash
git add backend/agents/prompts.py
git commit -m "feat: add RULE_REVIEW_SYSTEM and TRIAGE_CONTRADICTION_SYSTEM prompts"
```

---

## Task 3: Tests for `deep_rule_review_node`

**Files:**
- Create: `tests/backend/agents/test_rule_review.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/backend/agents/test_rule_review.py`:

```python
"""Tests for deep_rule_review_node."""
import json
import pytest
from unittest.mock import MagicMock, patch
from langchain_core.messages import AIMessage


def _make_state(suggested_rules: list[dict]) -> dict:
    return {
        "session_id": "test-session-id",
        "use_case": "ML churn prediction",
        "target_column": None,
        "description": None,
        "overview_notes": "",
        "columns_to_investigate": [],
        "investigation_findings": "",
        "cross_column_findings": [],
        "exploration_findings": {
            "column_findings": [
                {
                    "column": "email",
                    "stats": {"null_pct": 0.02, "distinct_count": 9800, "total_rows": 10000},
                }
            ],
            "cross_column_findings": [],
            "open_questions": [],
            "readiness_assessment": "good",
            "key_risks": [],
        },
        "exploration_notebook_path": "",
        "investigation_feedback": None,
        "investigation_round": 0,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": suggested_rules,
        "top_issues": [],
        "rule_revision_log": [],
    }


def _make_agent_stream(output: dict) -> MagicMock:
    """Return a mock agent whose .stream() yields one chunk with a final AIMessage."""
    fake_agent = MagicMock()
    fake_agent.stream.return_value = iter([
        {"messages": [AIMessage(content=json.dumps(output))]}
    ])
    return fake_agent


@patch("backend.agents.graphs.deep_rule_review.create_deep_agent")
def test_no_contradictions_returns_original_rules(mock_create):
    """When agent finds no conflicts, suggested_rules is unchanged and revision_log is empty."""
    from backend.agents.graphs.deep_rule_review import deep_rule_review_node

    rules = [
        {"id": "r1", "check": "not_null", "column": "customer_id", "threshold": 0.0, "rationale": "PK"},
    ]
    mock_create.return_value = _make_agent_stream({
        "revised_rules": rules,
        "revision_log": [],
    })

    result = deep_rule_review_node(_make_state(rules))

    assert result["suggested_rules"] == rules
    assert result["rule_revision_log"] == []


@patch("backend.agents.graphs.deep_rule_review.create_deep_agent")
def test_null_conflict_raises_not_null_threshold(mock_create):
    """null_invalid + not_null at 0% threshold → not_null threshold raised."""
    from backend.agents.graphs.deep_rule_review import deep_rule_review_node

    rules = [
        {"id": "r1", "check": "null_invalid", "column": "email", "pattern": r".*@.*", "threshold": 0.0, "rationale": "Bad emails nulled"},
        {"id": "r2", "check": "not_null", "column": "email", "threshold": 0.0, "rationale": "Email required"},
    ]
    revised = [
        {"id": "r1", "check": "null_invalid", "column": "email", "pattern": r".*@.*", "threshold": 0.0, "rationale": "Bad emails nulled"},
        {"id": "r2", "check": "not_null", "column": "email", "threshold": 0.15, "rationale": "Email required"},
    ]
    mock_create.return_value = _make_agent_stream({
        "revised_rules": revised,
        "revision_log": [{
            "rule_ids": ["r1", "r2"],
            "conflict_type": "null_conflict",
            "description": "r1 null_invalid will null ~15% of email rows; r2 not_null has 0% threshold",
            "resolution": "Raised r2 threshold from 0.0 to 0.15",
            "original_rules": {"r1": rules[0], "r2": rules[1]},
        }],
    })

    result = deep_rule_review_node(_make_state(rules))

    assert result["suggested_rules"][1]["threshold"] == 0.15
    assert len(result["rule_revision_log"]) == 1
    assert result["rule_revision_log"][0]["conflict_type"] == "null_conflict"
    assert result["rule_revision_log"][0]["rule_ids"] == ["r1", "r2"]


@patch("backend.agents.graphs.deep_rule_review.create_deep_agent")
def test_agent_parse_failure_falls_back_to_original_rules(mock_create):
    """If agent output is unparseable, original suggested_rules are preserved unchanged."""
    from backend.agents.graphs.deep_rule_review import deep_rule_review_node

    rules = [{"id": "r1", "check": "not_null", "column": "id", "threshold": 0.0, "rationale": "PK"}]
    fake_agent = MagicMock()
    fake_agent.stream.return_value = iter([
        {"messages": [AIMessage(content="I found no contradictions in these rules.")]}
    ])
    mock_create.return_value = fake_agent

    result = deep_rule_review_node(_make_state(rules))

    assert result["suggested_rules"] == rules
    assert result["rule_revision_log"] == []


@patch("backend.agents.graphs.deep_rule_review.create_deep_agent")
def test_original_rules_preserved_in_revision_log(mock_create):
    """original_rules snapshot in the log matches the pre-revision rule dicts."""
    from backend.agents.graphs.deep_rule_review import deep_rule_review_node

    rules = [
        {"id": "r1", "check": "null_invalid", "column": "age", "pattern": r"^\d+$", "threshold": 0.0, "rationale": "Age must be numeric"},
        {"id": "r2", "check": "not_null", "column": "age", "threshold": 0.0, "rationale": "Age required"},
    ]
    revised = [rules[0], {**rules[1], "threshold": 0.1}]
    log_entry = {
        "rule_ids": ["r1", "r2"],
        "conflict_type": "null_conflict",
        "description": "r1 will null non-numeric age values",
        "resolution": "Raised r2 threshold to 0.1",
        "original_rules": {"r1": rules[0], "r2": rules[1]},
    }
    mock_create.return_value = _make_agent_stream({"revised_rules": revised, "revision_log": [log_entry]})

    result = deep_rule_review_node(_make_state(rules))

    assert result["rule_revision_log"][0]["original_rules"]["r2"]["threshold"] == 0.0
```

- [ ] **Step 2: Run tests to verify they fail (module not found)**

```bash
pytest tests/backend/agents/test_rule_review.py -v 2>&1 | tail -20
```

Expected: `ModuleNotFoundError` or `ImportError` for `backend.agents.graphs.deep_rule_review`.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/backend/agents/test_rule_review.py
git commit -m "test: add failing tests for deep_rule_review_node"
```

---

## Task 4: Implement `deep_rule_review.py`

**Files:**
- Create: `backend/agents/graphs/deep_rule_review.py`

- [ ] **Step 1: Create the module**

Create `backend/agents/graphs/deep_rule_review.py`:

```python
"""Deep rule review agent — detects and resolves cross-rule contradictions pre-approval.

Runs between PROFILING_SYNTHESIS and AWAITING_RULE_APPROVAL. Uses create_deep_agent
with a two-tier tool strategy: profile data first (no DuckDB queries), then dq_* tools
on demand for quantitative verification.

Import surface: deep_rule_review_node (the LangGraph node function).
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Annotated, Optional

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.errors import GraphRecursionError
from langgraph.prebuilt import ToolRuntime

from backend.agents.emit import emit as _emit
from backend.agents.prompts import RULE_REVIEW_SYSTEM
from backend.agents.state import ProfileAnalyzerState
import dq_tools.explorer as _explorer
from deepagents.graph import create_deep_agent
from langchain_anthropic import ChatAnthropic

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Context schema
# ---------------------------------------------------------------------------

@dataclass
class RuleReviewContext:
    session_id: str
    suggested_rules: list[dict]
    exploration_findings: dict


# ---------------------------------------------------------------------------
# Tier 1 tools — read context directly, no DuckDB queries
# ---------------------------------------------------------------------------

def get_rules(
    runtime: ToolRuntime[RuleReviewContext, None],
) -> str:
    """Return the full proposed rule set as JSON. Call this first."""
    return json.dumps(runtime.context.suggested_rules, indent=2, default=str)


def get_profile_summary(
    runtime: ToolRuntime[RuleReviewContext, None],
) -> str:
    """Return exploration_findings: column stats, null rates, value distributions, cross-column findings."""
    return json.dumps(runtime.context.exploration_findings, indent=2, default=str)


# ---------------------------------------------------------------------------
# Tier 2 tools — on-demand DuckDB queries for quantitative verification
# ---------------------------------------------------------------------------

def dq_run_sql(
    sql: Annotated[str, "Read-only SELECT query against table 'working_data'. Returns up to 200 rows."],
    runtime: ToolRuntime[RuleReviewContext, None],
) -> str:
    """Run a read-only SQL SELECT query. Use to count how many rows a fix would affect."""
    result = _explorer.run_sql(runtime.context.session_id, sql)
    return json.dumps(result, default=str)


def dq_get_value_counts(
    column: Annotated[str, "Column name to analyse."],
    top_n: Annotated[int, "Number of top values to return. Default 20."] = 20,
    *,
    runtime: ToolRuntime[RuleReviewContext, None],
) -> str:
    """Return top-N value frequency distribution. Use to check value set overlaps between rules."""
    result = _explorer.get_value_counts(runtime.context.session_id, column, top_n)
    return json.dumps(result, default=str)


def dq_get_sample_rows(
    n: Annotated[int, "Number of rows to return (max 50). Default 10."] = 10,
    where_clause: Annotated[
        Optional[str],
        "SQL WHERE condition without the WHERE keyword.",
    ] = None,
    *,
    runtime: ToolRuntime[RuleReviewContext, None],
) -> str:
    """Return sample rows, optionally filtered. Use to spot-check conflict hypotheses."""
    result = _explorer.get_sample_rows(runtime.context.session_id, n=n, where_clause=where_clause)
    return json.dumps(result, default=str)


# ---------------------------------------------------------------------------
# JSON parsing helper (same pattern as triage_agent._parse_json)
# ---------------------------------------------------------------------------

def _parse_json(text: str):
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass
    for open_c, close_c in [("{", "}"), ("[", "]")]:
        s, e = text.find(open_c), text.rfind(close_c)
        if s != -1 and e > s:
            try:
                return json.loads(text[s : e + 1])
            except json.JSONDecodeError:
                pass
    return None


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

def _build_deep_rule_review_agent():
    return create_deep_agent(
        model=ChatAnthropic(model="claude-sonnet-4-6", max_tokens=8192),  # pyright: ignore[reportCallIssue]
        tools=[
            get_rules,
            get_profile_summary,
            dq_run_sql,
            dq_get_value_counts,
            dq_get_sample_rows,
        ],
        system_prompt=RULE_REVIEW_SYSTEM,
        context_schema=RuleReviewContext,
    )


# ---------------------------------------------------------------------------
# LangGraph node
# ---------------------------------------------------------------------------

def deep_rule_review_node(state: ProfileAnalyzerState) -> ProfileAnalyzerState:
    """Pre-approval contradiction resolution backed by create_deep_agent.

    Reads suggested_rules + exploration_findings from state.
    Returns updated state with resolved suggested_rules and rule_revision_log.
    On any failure, returns state unchanged (never blocks the approval gate).
    """
    session_id = state["session_id"]
    suggested_rules = state.get("suggested_rules", [])

    if not suggested_rules:
        return {**state, "rule_revision_log": []}

    logger.info(
        "[deep_rule_review:%s] Reviewing %d rules for contradictions",
        session_id[:8],
        len(suggested_rules),
    )

    agent = _build_deep_rule_review_agent()
    context = RuleReviewContext(
        session_id=session_id,
        suggested_rules=suggested_rules,
        exploration_findings=state.get("exploration_findings", {}),
    )

    initial_message = HumanMessage(
        content=(
            f"Use case: {state['use_case']}\n\n"
            "Start with get_rules() to see the rule set, then get_profile_summary() to understand the data. "
            "Only call dq_* tools when you need a quantitative count to resolve an ambiguous conflict.\n\n"
            "When done, output ONLY the JSON object with revised_rules and revision_log."
        )
    )

    config: RunnableConfig = {"recursion_limit": 150}
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
                    if isinstance(msg.content, str) and msg.content.strip():
                        _emit(session_id, "thinking", text=msg.content.strip()[:300])
                    elif isinstance(msg.content, list):
                        for block in msg.content:
                            if (
                                isinstance(block, dict)
                                and block.get("type") == "text"
                                and block.get("text", "").strip()
                            ):
                                _emit(session_id, "thinking", text=block["text"].strip()[:300])
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
            "[deep_rule_review:%s] Recursion limit reached — using original rules",
            session_id[:8],
        )

    _emit(session_id, "done", total_messages=seen)

    # Extract last substantive AI text and parse JSON output
    if final_state:
        for msg in reversed(final_state.get("messages", [])):
            if not isinstance(msg, AIMessage):
                continue
            text = ""
            if isinstance(msg.content, str) and msg.content.strip():
                text = msg.content
            elif isinstance(msg.content, list):
                parts = [
                    b["text"]
                    for b in msg.content
                    if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip()
                ]
                text = "\n".join(parts)
            if not text:
                continue

            parsed = _parse_json(text)
            if isinstance(parsed, dict) and isinstance(parsed.get("revised_rules"), list):
                revised_rules = parsed["revised_rules"]
                revision_log = parsed.get("revision_log", [])
                logger.info(
                    "[deep_rule_review:%s] Resolved %d contradiction(s)",
                    session_id[:8],
                    len(revision_log),
                )
                return {**state, "suggested_rules": revised_rules, "rule_revision_log": revision_log}
            break  # found last AI message but couldn't parse — fall through to fallback

    # Fallback: return state unchanged
    logger.warning(
        "[deep_rule_review:%s] Could not parse agent output — returning original rules",
        session_id[:8],
    )
    return {**state, "rule_revision_log": []}
```

- [ ] **Step 2: Run the tests**

```bash
pytest tests/backend/agents/test_rule_review.py -v 2>&1 | tail -30
```

Expected: all 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/agents/graphs/deep_rule_review.py
git commit -m "feat: implement deep_rule_review_node with create_deep_agent"
```

---

## Task 5: Tests for Triage Contradiction Post-Pass

**Files:**
- Create: `tests/backend/agents/test_triage_contradiction.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/backend/agents/test_triage_contradiction.py`:

```python
"""Tests for _detect_triage_contradictions."""
import json
import pytest
from unittest.mock import MagicMock, patch


def _mock_llm_response(contradictions: list[dict]) -> MagicMock:
    """Build a mock Anthropic response containing a contradictions JSON."""
    resp = MagicMock()
    block = MagicMock()
    block.text = json.dumps({"contradictions": contradictions})
    resp.content = [block]
    return resp


@patch("backend.agents.graphs.triage_agent.call_claude_with_retry")
def test_detects_fix_cascade(mock_call):
    """null_invalid fix on email will break a passing not_null rule on the same column."""
    from backend.agents.graphs.triage_agent import _detect_triage_contradictions

    client = MagicMock()
    mock_call.return_value = _mock_llm_response([{
        "rule_ids": ["r3", "r7"],
        "conflict_type": "fix_cascade",
        "description": "Fixing r3 null_invalid on email will introduce nulls that break r7 not_null",
        "suggested_fix": {
            "target_rule": "r7",
            "action": "raise_threshold",
            "proposed_threshold": 0.15,
            "rationale": "Accommodate nulls from r3 fix",
        },
    }])

    classifications = [
        {"rule_id": "r3", "classification": "transform_fixable", "check": "null_invalid", "column": "email", "confidence": "high", "reason": "12% bad emails"},
        {"rule_id": "r7", "classification": "transform_fixable", "check": "not_null", "column": "email", "confidence": "high", "reason": "nulls present"},
    ]
    failing_rules = [
        {"id": "r3", "check": "null_invalid", "column": "email", "threshold": 0.0},
        {"id": "r7", "check": "not_null", "column": "email", "threshold": 0.0},
    ]

    result = _detect_triage_contradictions(client, "test-session", classifications, failing_rules, "ML training")

    assert len(result) == 1
    assert result[0]["conflict_type"] == "fix_cascade"
    assert set(result[0]["rule_ids"]) == {"r3", "r7"}
    assert result[0]["suggested_fix"]["action"] == "raise_threshold"
    assert result[0]["suggested_fix"]["proposed_threshold"] == 0.15


@patch("backend.agents.graphs.triage_agent.call_claude_with_retry")
def test_returns_empty_when_no_contradictions(mock_call):
    """Returns [] when the LLM finds no contradictions."""
    from backend.agents.graphs.triage_agent import _detect_triage_contradictions

    client = MagicMock()
    mock_call.return_value = _mock_llm_response([])

    classifications = [
        {"rule_id": "r1", "classification": "transform_fixable", "check": "not_null", "column": "id", "confidence": "high", "reason": "nulls"},
    ]
    failing_rules = [{"id": "r1", "check": "not_null", "column": "id", "threshold": 0.0}]

    result = _detect_triage_contradictions(client, "test-session", classifications, failing_rules, "ML")

    assert result == []


@patch("backend.agents.graphs.triage_agent.call_claude_with_retry")
def test_returns_empty_on_llm_failure(mock_call):
    """Exceptions from the LLM call return [] without raising."""
    from backend.agents.graphs.triage_agent import _detect_triage_contradictions

    client = MagicMock()
    mock_call.side_effect = Exception("API timeout")

    classifications = [
        {"rule_id": "r1", "classification": "transform_fixable", "check": "null_invalid", "column": "x", "confidence": "high", "reason": "bad"},
        {"rule_id": "r2", "classification": "transform_fixable", "check": "not_null", "column": "x", "confidence": "high", "reason": "nulls"},
    ]
    failing_rules = [
        {"id": "r1", "check": "null_invalid", "column": "x", "threshold": 0.0},
        {"id": "r2", "check": "not_null", "column": "x", "threshold": 0.0},
    ]

    result = _detect_triage_contradictions(client, "test-session", classifications, failing_rules, "ML")

    assert result == []


def test_skipped_with_single_rule():
    """No LLM call made when only one rule — contradictions require pairs."""
    from backend.agents.graphs.triage_agent import _detect_triage_contradictions

    client = MagicMock()
    classifications = [
        {"rule_id": "r1", "classification": "transform_fixable", "check": "not_null", "column": "id", "confidence": "high", "reason": "nulls"},
    ]
    failing_rules = [{"id": "r1", "check": "not_null", "column": "id", "threshold": 0.0}]

    result = _detect_triage_contradictions(client, "test-session", classifications, failing_rules, "ML")

    assert result == []
    client.messages.create.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/backend/agents/test_triage_contradiction.py -v 2>&1 | tail -20
```

Expected: `ImportError` — `_detect_triage_contradictions` does not exist yet.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/backend/agents/test_triage_contradiction.py
git commit -m "test: add failing tests for _detect_triage_contradictions"
```

---

## Task 6: Implement Triage Contradiction Post-Pass

**Files:**
- Modify: `backend/agents/graphs/triage_agent.py`

- [ ] **Step 1: Add `_detect_triage_contradictions` and wire it into `triage_node` and `run_triage_agent`**

Add the import for `TRIAGE_CONTRADICTION_SYSTEM` at the top of `triage_agent.py` (with the other prompt imports):

```python
from backend.agents.prompts import TRIAGE_SYSTEM_PROMPT, TRIAGE_CONTRADICTION_SYSTEM
```

Add the function after `_validate_classifications` (before `triage_node`):

```python
def _detect_triage_contradictions(
    client: anthropic.Anthropic,
    session_id: str,
    classifications: list[dict],
    failing_rules: list[dict],
    use_case: str,
) -> list[dict]:
    """Single LLM call to detect fix-cascade contradictions among classified failing rules.

    Returns a list of contradiction dicts. Returns [] on any failure — never raises.
    Skips the call entirely when fewer than 2 rules are present.
    """
    if len(classifications) < 2:
        return []

    try:
        response = call_claude_with_retry(
            client,
            model=MODEL,
            max_tokens=4096,
            system=TRIAGE_CONTRADICTION_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Use case: {use_case}\n\n"
                        f"Classified failing rules:\n```json\n{json.dumps(classifications, indent=2, default=str)}\n```\n\n"
                        f"Full rule details:\n```json\n{json.dumps(failing_rules, indent=2, default=str)}\n```\n\n"
                        "Identify fix-cascade contradictions. Output only the JSON object."
                    ),
                }
            ],
        )
        text = "".join(b.text for b in response.content if hasattr(b, "text"))
        parsed = _parse_json(text)
        if isinstance(parsed, dict) and isinstance(parsed.get("contradictions"), list):
            return parsed["contradictions"]
        if isinstance(parsed, list):
            return parsed
        logger.warning("[triage_contradiction:%s] Unparseable response", session_id[:8])
    except Exception as exc:
        logger.warning("[triage_contradiction:%s] Failed: %s", session_id[:8], exc)
    return []
```

In `triage_node`, after the line `classifications = _validate_classifications(classifications, failing_rules)`, add:

```python
    contradictions = _detect_triage_contradictions(
        client, session_id, classifications, failing_rules, use_case
    )
```

Update the final `emit` call and return in `triage_node` to include `contradictions`:

```python
    emit(
        session_id,
        "done",
        transform_fixable=summary["transform_fixable"],
        threshold_too_strict=summary["threshold_too_strict"],
        unfixable=summary["unfixable"],
        eval_error=summary["eval_error"],
        contradictions_found=len(contradictions),
    )

    return {**state, "classifications": classifications, "summary": summary, "contradictions": contradictions}
```

In `build_triage_graph`, update the initial state in `run_triage_agent` to include `contradictions`:

```python
def run_triage_agent(session_id: str, failing_rules: list[dict], use_case: str) -> dict:
    """Run triage agent. Returns {classifications, summary, contradictions}."""
    app = build_triage_graph()
    initial_state: TriageAgentState = {
        "session_id": session_id,
        "failing_rules": failing_rules,
        "use_case": use_case,
        "classifications": [],
        "summary": {},
        "contradictions": [],
    }
    try:
        result = app.invoke(initial_state)
        return {
            "classifications": result.get("classifications", []),
            "summary": result.get("summary", {}),
            "contradictions": result.get("contradictions", []),
        }
    except Exception as exc:
        logger.error("[triage:%s] Agent failed: %s", session_id[:8], exc)
        fallback = _validate_classifications([], failing_rules)
        return {"classifications": fallback, "summary": _build_summary(fallback), "contradictions": []}
```

- [ ] **Step 2: Run the tests**

```bash
pytest tests/backend/agents/test_triage_contradiction.py -v 2>&1 | tail -20
```

Expected: all 4 tests pass.

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
pytest tests/ -x -q 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/agents/graphs/triage_agent.py
git commit -m "feat: add _detect_triage_contradictions post-pass to triage_node"
```

---

## Task 7: Temporal Activity for Rule Review

**Files:**
- Modify: `backend/temporal/activities/investigation_activities.py`

- [ ] **Step 1: Add `review_rules_activity` and `_review_rules_sync` at the end of `investigation_activities.py`**

```python
@activity.defn
async def review_rules_activity(params: dict) -> dict:
    """
    params: {session_id, suggested_rules, exploration_findings, use_case}
    Returns: {suggested_rules, rule_revision_log}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_review_rules_sync, params))


def _review_rules_sync(params: dict) -> dict:
    from backend.agents.graphs.deep_rule_review import deep_rule_review_node

    session_id = params["session_id"]

    state = {
        "session_id": session_id,
        "use_case": params.get("use_case", ""),
        "target_column": None,
        "description": None,
        "overview_notes": "",
        "columns_to_investigate": [],
        "investigation_findings": "",
        "cross_column_findings": [],
        "exploration_findings": params.get("exploration_findings", {}),
        "exploration_notebook_path": "",
        "investigation_feedback": None,
        "investigation_round": 0,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": params["suggested_rules"],
        "top_issues": [],
        "rule_revision_log": [],
    }

    state = deep_rule_review_node(state)

    return {
        "suggested_rules": state["suggested_rules"],
        "rule_revision_log": state.get("rule_revision_log", []),
    }
```

- [ ] **Step 2: Verify the activity is importable**

```bash
python -c "from backend.temporal.activities.investigation_activities import review_rules_activity; print('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/temporal/activities/investigation_activities.py
git commit -m "feat: add review_rules_activity Temporal activity"
```

---

## Task 8: Workflow Integration

**Files:**
- Modify: `backend/temporal/workflows/dq_workflow.py`

- [ ] **Step 1: Add `self.rule_revision_log` to `__init__`**

In `DQAcceleratorWorkflow.__init__`, after `self.top_issues: list = []` (or wherever the profile/rules state block ends, near line 56), add:

```python
        self.rule_revision_log: list = []
```

- [ ] **Step 2: Import `review_rules_activity`**

In the `with workflow.unsafe.imports_passed_through():` block, add to the `investigation_activities` import:

```python
    from backend.temporal.activities.investigation_activities import (
        profile_and_investigate_activity,
        synthesize_and_propose_activity,
        reinvestigate_activity,
        review_rules_activity,
    )
```

- [ ] **Step 3: Add the `RULE_REVIEW` stage after `PROFILING_SYNTHESIS`**

After the block that sets `self.suggested_rules = profile_result["suggested_rules"]` (around line 354), insert:

```python
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
```

- [ ] **Step 4: Update `get_profile` query to surface `rule_revision_log`**

Change `get_profile` from:

```python
    @workflow.query
    def get_profile(self) -> dict:
        return {
            "profile": self.profile,
            "ai_summary": self.ai_summary,
            "suggested_rules": self.suggested_rules,
        }
```

To:

```python
    @workflow.query
    def get_profile(self) -> dict:
        return {
            "profile": self.profile,
            "ai_summary": self.ai_summary,
            "suggested_rules": self.suggested_rules,
            "rule_revision_log": self.rule_revision_log,
        }
```

- [ ] **Step 5: Update `get_full_state` query to surface `rule_revision_log`**

Add `"rule_revision_log": self.rule_revision_log,` to the `get_full_state` return dict (after `"suggested_rules": self.suggested_rules,`).

- [ ] **Step 6: Verify the workflow module imports cleanly**

```bash
python -c "from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow; print('OK')"
```

Expected: `OK`.

- [ ] **Step 7: Run full test suite**

```bash
pytest tests/ -x -q 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/temporal/workflows/dq_workflow.py
git commit -m "feat: add RULE_REVIEW stage to DQAcceleratorWorkflow; surface rule_revision_log in queries"
```

---

## Task 9: Frontend Type Update

**Files:**
- Modify: `frontend/lib/types.ts`

- [ ] **Step 1: Add `'RULE_REVIEW'` to the `WorkflowStage` union**

In `frontend/lib/types.ts`, change the `WorkflowStage` type from:

```typescript
export type WorkflowStage =
  | 'LOADING' | 'PROFILING'
  | 'AWAITING_INVESTIGATION_REVIEW' | 'REINVESTIGATING' | 'PROFILING_SYNTHESIS'
  | 'AWAITING_RULE_APPROVAL'
  | 'VALIDATING' | 'TRIAGING' | 'AWAITING_TRIAGE_APPROVAL'
  | 'PLANNING' | 'AWAITING_PLAN_APPROVAL'
```

To:

```typescript
export type WorkflowStage =
  | 'LOADING' | 'PROFILING'
  | 'AWAITING_INVESTIGATION_REVIEW' | 'REINVESTIGATING' | 'PROFILING_SYNTHESIS'
  | 'RULE_REVIEW'
  | 'AWAITING_RULE_APPROVAL'
  | 'VALIDATING' | 'TRIAGING' | 'AWAITING_TRIAGE_APPROVAL'
  | 'PLANNING' | 'AWAITING_PLAN_APPROVAL'
```

- [ ] **Step 2: Check for exhaustive stage switches in the frontend**

```bash
grep -rn "PROFILING_SYNTHESIS\|AWAITING_RULE_APPROVAL" frontend/ --include="*.tsx" --include="*.ts" -l
```

Open each file returned and check if there are `switch` statements or `if/else if` chains over `WorkflowStage` that need a `RULE_REVIEW` case. If the Stepper or stage display component maps stages to labels, add `'RULE_REVIEW': 'Reviewing Rules'` (or equivalent) to match the pattern used for other stages.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/types.ts
git commit -m "feat: add RULE_REVIEW to WorkflowStage frontend type"
```

---

## Self-Review

**Spec coverage check:**
- [x] Pre-approval deep agent (`deep_rule_review.py`) — Task 4
- [x] Prompts (`RULE_REVIEW_SYSTEM`, `TRIAGE_CONTRADICTION_SYSTEM`) — Task 2
- [x] State schema (`rule_revision_log`, `contradictions`) — Task 1
- [x] `RULE_REVIEW` Temporal stage — Task 8
- [x] `rule_revision_log` in `get_profile` query — Task 8 Step 4
- [x] Triage contradiction post-pass — Task 6
- [x] `contradictions` in `TriageAgentState` — Task 1
- [x] `contradictions` flows through `triage_result` / `get_full_state` — Task 6 (via `run_triage_agent` return) + Task 8 Step 5
- [x] Temporal activity wrapper — Task 7
- [x] Frontend `WorkflowStage` — Task 9
- [x] Error handling: fallback to original rules on parse failure — Task 4 (implemented in node)
- [x] Error handling: `contradictions: []` on LLM failure — Task 6

**Placeholder scan:** No TBDs or incomplete code blocks.

**Type consistency:**
- `deep_rule_review_node` reads/writes `suggested_rules` and `rule_revision_log` — both defined in `ProfileAnalyzerState` (Task 1)
- `_detect_triage_contradictions` signature: `(client, session_id, classifications, failing_rules, use_case)` — called the same way in `triage_node` (Task 6)
- `run_triage_agent` returns `{classifications, summary, contradictions}` — `triage_rules_activity` passes through the full dict unchanged — workflow stores in `self.triage_result` — `get_triage_result` returns `self.triage_result` — consistent throughout
- `review_rules_activity` params match what the workflow passes in Task 8 Step 3
