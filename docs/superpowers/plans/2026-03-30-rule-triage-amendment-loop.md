# Rule Triage / Amendment Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a triage phase between validation and the transformation loop that classifies each failing rule as transform-fixable, threshold-too-strict, unfixable, or eval-error — then pauses for human approval of rule amendments before the transform loop starts.

**Architecture:** A new LangGraph agent (`triage_agent.py`) uses the same explorer tool-calling loop as the profiler to investigate failing rules and classify them. A new Temporal signal (`approve_triage`) carries the engineer's accepted amendments. After approval, `approved_rules` is updated in-place, validation re-runs to establish a clean baseline, and the transformation loop starts with only genuinely fixable failures. The workflow gains two new stages: `TRIAGING` and `AWAITING_TRIAGE_APPROVAL` (the wait is skipped automatically if no amendments are proposed).

**Tech Stack:** Python, LangGraph, Temporal workflows, FastAPI, Pydantic, DuckDB (via existing `dq_tools/explorer.py` tools)

---

## Files to Create or Modify

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/agents/prompts.py` | Modify | Add `TRIAGE_SYSTEM_PROMPT` |
| `backend/agents/state.py` | Modify | Add `TriageAgentState` TypedDict |
| `backend/agents/graphs/triage_agent.py` | **Create** | LangGraph agent: tool-calling loop → classify each failing rule |
| `backend/temporal/activities/triage_activities.py` | **Create** | Temporal activity wrapping the triage agent |
| `backend/temporal/workflows/dq_workflow.py` | Modify | New stages, signal, query, triage logic + re-validation |
| `backend/api/schemas.py` | Modify | New Pydantic models + new `WorkflowStage` values |
| `backend/api/routers/triage.py` | **Create** | `GET /triage` and `POST /triage/approve` endpoints |
| `backend/api/main.py` | Modify | Register triage router |
| `backend/temporal/worker.py` | Modify | Register `triage_rules_activity` |
| `tests/backend/agents/test_triage_agent.py` | **Create** | Unit tests for classification logic |

---

## Task 1: Add `TRIAGE_SYSTEM_PROMPT` and `TriageAgentState`

**Files:**
- Modify: `backend/agents/prompts.py`
- Modify: `backend/agents/state.py`

- [ ] **Append `TRIAGE_SYSTEM_PROMPT` to `backend/agents/prompts.py`**

```python
TRIAGE_SYSTEM_PROMPT = """You are a data quality rule triage specialist. Your job is to
investigate failing DQ rules against the actual data and classify each one.

Classification categories — assign exactly one per rule:

**transform_fixable**: The data has a real quality issue that CAN be corrected by a
transformation (null imputation, outlier capping, format standardization, type casting,
string standardization, deduplication). The rule correctly identifies a real problem.

**threshold_too_strict**: The rule logic is correct but the acceptable failure rate
(threshold) is set too tightly for this dataset. Some failures represent legitimate
business data (new records at contract start, known edge cases, design exceptions).
Propose a specific numeric threshold (e.g. 0.005 means 0.5% failure is acceptable).
Only propose this when failures cluster around clearly legitimate patterns.

**unfixable**: The rule identifies something that cannot be fixed by transforming the
data. Examples: requires external reference data not in the dataset, checks a
logical relationship that is violated by design, cross-column constraint that the
business process legitimately breaks.

**eval_error**: The rule SQL errored during execution (missing column, syntax error,
DuckDB incompatibility). Cannot produce a pass/fail result. Should be removed.

Investigation approach for each rule:
1. Read the sample_failing_rows already provided in the rule data
2. Use get_sample_rows with a where_clause to see more failing examples
3. Use run_sql to count how failures distribute across column values
4. For threshold_too_strict candidates: verify that the failing rows share a
   legitimate business pattern (e.g. all have tenure=0, all are from a specific date)
5. For unfixable candidates: confirm there is no transform that could satisfy the rule

Be specific. Reference actual counts and actual values from your investigation.
Do not classify as threshold_too_strict unless you have concrete evidence the failures
are legitimate. When in doubt, classify as transform_fixable.

Output format — when done investigating ALL rules, write a single JSON object:
{
  "classifications": [
    {
      "rule_id": "r7",
      "check": "cross_column_order",
      "column": null,
      "classification": "threshold_too_strict",
      "proposed_threshold": 0.005,
      "proposed_remove": false,
      "reason": "312 of 70k rows (0.44%) violate tenure<=TotalCharges. Query confirms all 312 have tenure=0, consistent with new customers at contract start — a legitimate business state.",
      "confidence": "high"
    }
  ],
  "summary": {
    "transform_fixable": 9,
    "threshold_too_strict": 3,
    "unfixable": 2,
    "eval_error": 1
  }
}

Rules:
- proposed_threshold is only set for threshold_too_strict (null otherwise)
- proposed_remove is true for unfixable and eval_error
- confidence: "high" (strong evidence), "medium" (probable), "low" (uncertain)
- Investigate every rule — do not skip any
"""
```

- [ ] **Add `TriageAgentState` to `backend/agents/state.py`**

```python
class TriageAgentState(TypedDict):
    session_id: str
    failing_rules: list[dict]   # per_rule entries where passed=False
    use_case: str
    # Outputs
    classifications: list[dict]
    summary: dict               # {transform_fixable, threshold_too_strict, unfixable, eval_error}
```

---

## Task 2: Create `triage_agent.py`

**Files:**
- Create: `backend/agents/graphs/triage_agent.py`
- Test: `tests/backend/agents/test_triage_agent.py`

- [ ] **Write the failing test first**

```python
# tests/backend/agents/test_triage_agent.py
"""Unit tests for triage agent classification output structure."""
import pytest
from unittest.mock import patch, MagicMock


def _make_failing_rule(rule_id: str, check: str, column: str | None,
                        failure_count: int, failure_rate: float,
                        threshold: float = 0.0, error: str | None = None) -> dict:
    return {
        "id": rule_id,
        "category": "validity",
        "check": check,
        "column": column,
        "passed": False,
        "failure_count": failure_count,
        "failure_rate": failure_rate,
        "threshold": threshold,
        "sample_failing_rows": [],
        "rationale": "Test rule",
        "error": error,
    }


def test_triage_output_has_required_keys():
    """Each classification must have all required keys."""
    from backend.agents.graphs.triage_agent import _validate_classifications

    classifications = [
        {
            "rule_id": "r1",
            "check": "not_null",
            "column": "col_a",
            "classification": "transform_fixable",
            "proposed_threshold": None,
            "proposed_remove": False,
            "reason": "Nulls are imputable",
            "confidence": "high",
        }
    ]
    result = _validate_classifications(classifications, [_make_failing_rule("r1", "not_null", "col_a", 100, 0.01)])
    assert len(result) == 1
    assert result[0]["rule_id"] == "r1"
    assert result[0]["classification"] == "transform_fixable"


def test_triage_fallback_covers_all_rules():
    """If agent output is missing a rule, fallback fills it in as transform_fixable."""
    from backend.agents.graphs.triage_agent import _validate_classifications

    failing_rules = [
        _make_failing_rule("r1", "not_null", "col_a", 100, 0.01),
        _make_failing_rule("r2", "unique", "col_b", 5, 0.0001),
    ]
    # Agent only classified r1
    partial_classifications = [
        {"rule_id": "r1", "check": "not_null", "column": "col_a",
         "classification": "transform_fixable", "proposed_threshold": None,
         "proposed_remove": False, "reason": "ok", "confidence": "high"}
    ]
    result = _validate_classifications(partial_classifications, failing_rules)
    assert len(result) == 2
    r2 = next(c for c in result if c["rule_id"] == "r2")
    assert r2["classification"] == "transform_fixable"
    assert r2["confidence"] == "low"


def test_eval_error_rules_get_proposed_remove():
    """Rules with error field should be proposed for removal."""
    from backend.agents.graphs.triage_agent import _validate_classifications

    failing_rules = [
        _make_failing_rule("r1", "custom_sql", None, 0, 0.0, error="CatalogException: column not found"),
    ]
    classifications = [
        {"rule_id": "r1", "check": "custom_sql", "column": None,
         "classification": "eval_error", "proposed_threshold": None,
         "proposed_remove": True, "reason": "SQL error", "confidence": "high"}
    ]
    result = _validate_classifications(classifications, failing_rules)
    assert result[0]["proposed_remove"] is True


def test_summary_counts_match_classifications():
    """_build_summary correctly counts each classification bucket."""
    from backend.agents.graphs.triage_agent import _build_summary

    classifications = [
        {"classification": "transform_fixable"},
        {"classification": "transform_fixable"},
        {"classification": "threshold_too_strict"},
        {"classification": "unfixable"},
        {"classification": "eval_error"},
    ]
    summary = _build_summary(classifications)
    assert summary["transform_fixable"] == 2
    assert summary["threshold_too_strict"] == 1
    assert summary["unfixable"] == 1
    assert summary["eval_error"] == 1
```

- [ ] **Run tests to confirm they fail**

```bash
cd /Users/Connor/claude/ai-dq-accelerator
pytest tests/backend/agents/test_triage_agent.py -v
```
Expected: `ImportError` — `triage_agent` does not exist yet.

- [ ] **Create `backend/agents/graphs/triage_agent.py`**

```python
"""TriageAgent — classifies failing DQ rules before the transformation loop.

Single-node LangGraph graph with a tool-calling loop. Investigates each
failing rule against the live DuckDB session and outputs a classification
for each: transform_fixable | threshold_too_strict | unfixable | eval_error.
"""
from __future__ import annotations

import json
import logging
import re

import anthropic
from langgraph.graph import END, StateGraph

from backend.agents.emit import emit
from backend.agents.retry import call_claude_with_retry
from backend.agents.prompts import TRIAGE_SYSTEM_PROMPT
from backend.agents.state import TriageAgentState
from dq_tools.explorer import (
    EXPLORER_TOOLS,
    check_regex_pattern,
    get_column_detail,
    get_sample_rows,
    get_value_counts,
    run_sql,
)

logger = logging.getLogger(__name__)
MODEL = "claude-sonnet-4-6"
VALID_CLASSIFICATIONS = {"transform_fixable", "threshold_too_strict", "unfixable", "eval_error"}


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
                return json.loads(text[s:e + 1])
            except json.JSONDecodeError:
                pass
    return None


def _execute_tool(session_id: str, tool_name: str, tool_input: dict):
    try:
        if tool_name == "run_sql":
            return run_sql(session_id, tool_input["sql"])
        elif tool_name == "get_value_counts":
            return get_value_counts(session_id, tool_input["column"], tool_input.get("top_n", 20))
        elif tool_name == "check_regex_pattern":
            return check_regex_pattern(session_id, tool_input["column"], tool_input["pattern"])
        elif tool_name == "get_sample_rows":
            return get_sample_rows(session_id, n=tool_input.get("n", 10),
                                   where_clause=tool_input.get("where_clause"))
        elif tool_name == "get_column_detail":
            return get_column_detail(session_id, tool_input["column"])
        else:
            return {"error": f"Unknown tool: {tool_name}"}
    except Exception as exc:
        return {"error": str(exc)}


def _build_summary(classifications: list[dict]) -> dict:
    summary = {"transform_fixable": 0, "threshold_too_strict": 0, "unfixable": 0, "eval_error": 0}
    for c in classifications:
        bucket = c.get("classification", "transform_fixable")
        if bucket in summary:
            summary[bucket] += 1
    return summary


def _validate_classifications(classifications: list[dict], failing_rules: list[dict]) -> list[dict]:
    """Ensure every failing rule has a classification. Fill gaps with transform_fixable/low-confidence."""
    classified_ids = {c["rule_id"] for c in classifications}
    result = list(classifications)

    for rule in failing_rules:
        rid = rule["id"]
        if rid not in classified_ids:
            result.append({
                "rule_id": rid,
                "check": rule.get("check"),
                "column": rule.get("column"),
                "classification": "eval_error" if rule.get("error") else "transform_fixable",
                "proposed_threshold": None,
                "proposed_remove": bool(rule.get("error")),
                "reason": f"Not classified by agent — defaulting based on error field.",
                "confidence": "low",
            })

    # Ensure valid classification values and required keys
    required_keys = {"rule_id", "check", "column", "classification",
                     "proposed_threshold", "proposed_remove", "reason", "confidence"}
    clean = []
    for c in result:
        if c.get("classification") not in VALID_CLASSIFICATIONS:
            c["classification"] = "transform_fixable"
        for k in required_keys:
            c.setdefault(k, None)
        c.setdefault("proposed_remove", False)
        c.setdefault("confidence", "low")
        clean.append(c)

    return clean


def triage_node(state: TriageAgentState) -> TriageAgentState:
    """Tool-calling loop: investigate each failing rule and classify it."""
    client = anthropic.Anthropic()
    session_id = state["session_id"]
    failing_rules = state["failing_rules"]
    use_case = state["use_case"]

    emit(session_id, "thinking", text=f"Triaging {len(failing_rules)} failing rules...")

    if not failing_rules:
        return {**state, "classifications": [], "summary": _build_summary([])}

    # Slim down sample_failing_rows to keep context manageable
    rules_for_prompt = []
    for r in failing_rules:
        entry = dict(r)
        entry["sample_failing_rows"] = r.get("sample_failing_rows", [])[:5]
        rules_for_prompt.append(entry)

    messages = [
        {
            "role": "user",
            "content": (
                f"Use case: {use_case}\n\n"
                f"Failing rules to classify ({len(failing_rules)} total):\n"
                f"```json\n{json.dumps(rules_for_prompt, indent=2, default=str)}\n```\n\n"
                "Investigate each rule using the tools, then output the classification JSON."
            ),
        }
    ]

    max_iterations = 30
    last_response = None

    for iteration in range(max_iterations):
        response = call_claude_with_retry(
            client,
            model=MODEL,
            max_tokens=4096,
            system=TRIAGE_SYSTEM_PROMPT,
            tools=EXPLORER_TOOLS,
            messages=messages,
        )
        last_response = response

        for block in response.content:
            if hasattr(block, "text") and block.text.strip():
                emit(session_id, "thinking", text=block.text.strip()[:300])

        if response.stop_reason == "end_turn":
            break

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            emit(session_id, "tool_call", tool=block.name, input=block.input, iteration=iteration)
            result = _execute_tool(session_id, block.name, block.input)
            emit(session_id, "tool_result", tool=block.name,
                 preview=str(result)[:80])
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": json.dumps(result, default=str)[:8000],
            })

        if not tool_results:
            break

        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

    # Extract final text and parse JSON
    final_text = ""
    if last_response:
        for block in last_response.content:
            if hasattr(block, "text"):
                final_text += block.text

    parsed = _parse_json(final_text)
    classifications: list[dict] = []
    if isinstance(parsed, dict) and isinstance(parsed.get("classifications"), list):
        classifications = parsed["classifications"]
    else:
        logger.warning("[triage:%s] Could not parse classification JSON — using fallback", session_id[:8])

    classifications = _validate_classifications(classifications, failing_rules)
    summary = _build_summary(classifications)

    emit(session_id, "done",
         transform_fixable=summary["transform_fixable"],
         threshold_too_strict=summary["threshold_too_strict"],
         unfixable=summary["unfixable"],
         eval_error=summary["eval_error"])

    return {**state, "classifications": classifications, "summary": summary}


def build_triage_graph():
    graph = StateGraph(TriageAgentState)
    graph.add_node("triage", triage_node)
    graph.set_entry_point("triage")
    graph.add_edge("triage", END)
    return graph.compile()


def run_triage_agent(session_id: str, failing_rules: list[dict], use_case: str) -> dict:
    """Run triage agent. Returns {classifications, summary}."""
    app = build_triage_graph()
    initial_state: TriageAgentState = {
        "session_id": session_id,
        "failing_rules": failing_rules,
        "use_case": use_case,
        "classifications": [],
        "summary": {},
    }
    try:
        result = app.invoke(initial_state)
        return {
            "classifications": result.get("classifications", []),
            "summary": result.get("summary", {}),
        }
    except Exception as exc:
        logger.error("[triage:%s] Agent failed: %s", session_id[:8], exc)
        # Fallback: classify everything as transform_fixable
        fallback = _validate_classifications([], failing_rules)
        return {"classifications": fallback, "summary": _build_summary(fallback)}
```

- [ ] **Run tests to confirm they pass**

```bash
pytest tests/backend/agents/test_triage_agent.py -v
```
Expected: all 4 PASS.

---

## Task 3: Create `triage_activities.py`

**Files:**
- Create: `backend/temporal/activities/triage_activities.py`

- [ ] **Create the activity file**

```python
"""Temporal activity wrapping the triage agent."""
from temporalio import activity
import asyncio
from functools import partial


@activity.defn
async def triage_rules_activity(params: dict) -> dict:
    """
    params: {session_id, failing_rules, use_case}
    Returns: {classifications, summary}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_triage_rules_sync, params))


def _triage_rules_sync(params: dict) -> dict:
    from backend.agents.graphs.triage_agent import run_triage_agent
    return run_triage_agent(
        session_id=params["session_id"],
        failing_rules=params["failing_rules"],
        use_case=params.get("use_case", ""),
    )
```

---

## Task 4: Add Schemas

**Files:**
- Modify: `backend/api/schemas.py`

- [ ] **Add `TRIAGING` and `AWAITING_TRIAGE_APPROVAL` to `WorkflowStage`**

In the `WorkflowStage` enum, add after `VALIDATING`:
```python
TRIAGING = "TRIAGING"
AWAITING_TRIAGE_APPROVAL = "AWAITING_TRIAGE_APPROVAL"
```

- [ ] **Add triage Pydantic models to `backend/api/schemas.py`**

After the existing `Rule` model:
```python
class TriageClassification(BaseModel):
    rule_id: str
    check: str | None = None
    column: str | None = None
    classification: str          # transform_fixable | threshold_too_strict | unfixable | eval_error
    proposed_threshold: float | None = None
    proposed_remove: bool = False
    reason: str = ""
    confidence: str = "low"      # high | medium | low

    model_config = {"extra": "allow"}


class TriageResult(BaseModel):
    classifications: list[TriageClassification] = []
    summary: dict = {}           # {transform_fixable, threshold_too_strict, unfixable, eval_error}


class TriageApprovalRequest(BaseModel):
    accepted_threshold_changes: list[dict] = []  # [{rule_id, new_threshold}]
    rejected_rule_ids: list[str] = []            # rule IDs to remove from approved_rules


class TriageApprovalResponse(BaseModel):
    accepted: bool
    message: str = "Triage approved. Re-validating with amended rules."
    rules_amended: int = 0
    rules_removed: int = 0
```

- [ ] **Add `triage_result` to `SessionStateResponse`**

```python
triage_result: dict = {}
```

---

## Task 5: Update `dq_workflow.py`

**Files:**
- Modify: `backend/temporal/workflows/dq_workflow.py`

- [ ] **Import `triage_rules_activity` in the workflow imports block**

In the `with workflow.unsafe.imports_passed_through():` block, add:
```python
from backend.temporal.activities.triage_activities import triage_rules_activity
```

- [ ] **Add triage state fields to `__init__`**

After the `transformation_log` line:
```python
# Triage state
self.triage_result: dict = {}
self.triage_amendments: dict | None = None  # None until approve_triage signal received
```

- [ ] **Add `approve_triage` signal**

```python
@workflow.signal
def approve_triage(self, amendments: dict) -> None:
    """amendments: {accepted_threshold_changes: [...], rejected_rule_ids: [...]}"""
    self.triage_amendments = amendments
```

- [ ] **Add `get_triage_result` query**

```python
@workflow.query
def get_triage_result(self) -> dict:
    return self.triage_result
```

- [ ] **Add `triage_result` to `get_full_state` return dict**

```python
"triage_result": self.triage_result,
```

- [ ] **Insert triage stage in `run()` between `analyze_and_prioritize` and `TRANSFORMATION_LOOP`**

Replace the comment `# ── Stage: TRANSFORMATION_LOOP` and the `self.stage = "TRANSFORMATION_LOOP"` line with:

```python
        # ── Stage: TRIAGING ────────────────────────────────────────────────
        self.stage = "TRIAGING"

        # Only triage if there are failing rules to classify
        failing_rules = [
            r for r in self.validation_results.get("per_rule", [])
            if not r.get("passed", True)
        ]

        if failing_rules:
            triage_result = await workflow.execute_activity(
                triage_rules_activity,
                {
                    "session_id": self.session_id,
                    "failing_rules": failing_rules,
                    "use_case": self.use_case,
                },
                start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )
            self.triage_result = triage_result

            # Only wait for human if there are proposed amendments
            has_amendments = any(
                c.get("proposed_threshold") is not None or c.get("proposed_remove", False)
                for c in triage_result.get("classifications", [])
            )

            if has_amendments:
                self.stage = "AWAITING_TRIAGE_APPROVAL"
                await workflow.wait_condition(lambda: self.triage_amendments is not None)
            else:
                # No amendments needed — proceed automatically
                self.triage_amendments = {}

            # Apply accepted amendments to approved_rules
            amendments = self.triage_amendments or {}
            threshold_changes = {
                item["rule_id"]: item["new_threshold"]
                for item in amendments.get("accepted_threshold_changes", [])
            }
            rejected_ids = set(amendments.get("rejected_rule_ids", []))

            if threshold_changes or rejected_ids:
                updated_rules = []
                for rule in (self.approved_rules or []):
                    if rule["id"] in rejected_ids:
                        continue
                    if rule["id"] in threshold_changes:
                        rule = {**rule, "threshold": threshold_changes[rule["id"]]}
                    updated_rules.append(rule)
                self.approved_rules = updated_rules

                # Re-run validation with amended rules to establish clean baseline
                amended_validation = await workflow.execute_activity(
                    run_validation_activity,
                    {"session_id": self.session_id, "approved_rules": self.approved_rules},
                    start_to_close_timeout=ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )
                self.validation_results = amended_validation["validation_results"]
                self.baseline_quality_score = amended_validation["baseline_quality_score"]
                self.current_score = self.baseline_quality_score

        # ── Stage: TRANSFORMATION_LOOP ─────────────────────────────────────
        self.stage = "TRANSFORMATION_LOOP"
```

---

## Task 6: Create Triage API Router

**Files:**
- Create: `backend/api/routers/triage.py`

- [ ] **Create the router**

```python
"""Triage endpoints — get classification result and submit amendments."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from temporalio.service import RPCError, RPCStatusCode

from backend.api.schemas import (
    TriageApprovalRequest,
    TriageApprovalResponse,
    TriageResult,
)
from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow

router = APIRouter()


@router.get("/sessions/{session_id}/triage", response_model=TriageResult)
async def get_triage_result(session_id: str, request: Request):
    """Return the triage agent's classification of each failing rule."""
    client = request.app.state.temporal_client
    try:
        handle = client.get_workflow_handle(session_id)
        raw = await handle.query(DQAcceleratorWorkflow.get_triage_result)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return TriageResult(
        classifications=raw.get("classifications", []),
        summary=raw.get("summary", {}),
    )


@router.post("/sessions/{session_id}/triage/approve", response_model=TriageApprovalResponse)
async def approve_triage(
    session_id: str,
    body: TriageApprovalRequest,
    request: Request,
):
    """Submit engineer-approved rule amendments. Triggers re-validation and starts transform loop."""
    client = request.app.state.temporal_client

    amendments = {
        "accepted_threshold_changes": body.accepted_threshold_changes,
        "rejected_rule_ids": body.rejected_rule_ids,
    }

    try:
        handle = client.get_workflow_handle(session_id)
        await handle.signal(DQAcceleratorWorkflow.approve_triage, amendments)
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return TriageApprovalResponse(
        accepted=True,
        message="Triage approved. Re-validating with amended rules.",
        rules_amended=len(body.accepted_threshold_changes),
        rules_removed=len(body.rejected_rule_ids),
    )
```

---

## Task 7: Register Router and Activity

**Files:**
- Modify: `backend/api/main.py`
- Modify: `backend/temporal/worker.py`

- [ ] **Register triage router in `backend/api/main.py`**

Add to the imports:
```python
from backend.api.routers import sessions, rules, transformations, pipeline, triage
```

Add after the existing `include_router` calls:
```python
app.include_router(triage.router, prefix="/api/v1", tags=["triage"])
```

- [ ] **Register `triage_rules_activity` in `backend/temporal/worker.py`**

Add to imports:
```python
from backend.temporal.activities.triage_activities import triage_rules_activity
```

Add to the `activities=[...]` list:
```python
triage_rules_activity,
```

---

## Task 8: Integration Test

**Files:**
- Test: `tests/backend/agents/test_triage_agent.py` (add to existing)

- [ ] **Add an integration-style test for the full `run_triage_agent` fallback path**

```python
def test_run_triage_agent_returns_valid_structure_on_empty_rules():
    """run_triage_agent with no failing rules returns empty classifications."""
    from backend.agents.graphs.triage_agent import run_triage_agent
    from unittest.mock import patch

    # Patch the LangGraph invocation so no API call is made
    with patch("backend.agents.graphs.triage_agent.build_triage_graph") as mock_build:
        mock_app = MagicMock()
        mock_app.invoke.return_value = {"classifications": [], "summary": {}}
        mock_build.return_value = mock_app

        result = run_triage_agent("test-session", [], "test use case")
        assert "classifications" in result
        assert "summary" in result
        assert result["classifications"] == []


def test_validate_classifications_requires_all_rules_covered():
    """Every failing rule must appear in output even if agent missed it."""
    from backend.agents.graphs.triage_agent import _validate_classifications

    failing_rules = [
        _make_failing_rule("r1", "not_null", "col_a", 10, 0.01),
        _make_failing_rule("r2", "unique", "col_b", 5, 0.005),
        _make_failing_rule("r3", "custom_sql", None, 0, 0.0, error="syntax error"),
    ]
    # Agent classified only r1
    partial = [
        {"rule_id": "r1", "check": "not_null", "column": "col_a",
         "classification": "transform_fixable", "proposed_threshold": None,
         "proposed_remove": False, "reason": "ok", "confidence": "high"}
    ]
    result = _validate_classifications(partial, failing_rules)
    ids = [c["rule_id"] for c in result]
    assert "r1" in ids
    assert "r2" in ids
    assert "r3" in ids
    # r3 has error → should be eval_error with proposed_remove=True
    r3 = next(c for c in result if c["rule_id"] == "r3")
    assert r3["proposed_remove"] is True
```

- [ ] **Run the full test suite**

```bash
pytest tests/backend/agents/test_triage_agent.py -v
```
Expected: all tests PASS.

- [ ] **Run all project tests to confirm nothing is broken**

```bash
pytest --tb=short -q
```
Expected: all existing tests still pass.

---

## Verification Checklist

- [ ] `GET /api/v1/sessions/{id}/triage` returns `{classifications: [...], summary: {...}}` when stage is `AWAITING_TRIAGE_APPROVAL`
- [ ] `POST /api/v1/sessions/{id}/triage/approve` with `{accepted_threshold_changes: [], rejected_rule_ids: []}` advances workflow to `TRANSFORMATION_LOOP`
- [ ] Workflow skips `AWAITING_TRIAGE_APPROVAL` automatically when all failing rules are `transform_fixable`
- [ ] After approval with threshold changes, `get_full_state` shows updated thresholds in `approved_rules`
- [ ] After approval with rule removals, removed rules are absent from `approved_rules`
- [ ] `baseline_quality_score` and `current_score` reflect post-amendment re-validation
- [ ] The transform loop only receives genuinely-fixable failures (no unfixable or eval_error rules)
- [ ] All existing tests still pass: `pytest --tb=short -q`
