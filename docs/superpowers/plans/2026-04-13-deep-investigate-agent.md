# Deep Investigation Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual tool-calling loop in `ProfileAnalyzer`'s investigation phase with a `create_deep_agent`-backed node in its own file, keeping the old node as deprecated rollback code.

**Architecture:** A new `deep_investigate.py` file owns the `InvestigationContext` dataclass, five DuckDB tool functions with `ToolRuntime` injection, a `_build_deep_investigate_agent()` factory, and the public `deep_investigate_node()` LangGraph node. `profile_analyzer.py` receives three targeted edits: rename the old node to `_investigate_node_deprecated`, add the import, and swap one `add_node` call.

**Tech Stack:** `deepagents>=0.5.0` (`create_deep_agent`), `langchain>=1.2.0`, `langchain-anthropic>=1.4.0` (`ChatAnthropic`), `langgraph.prebuilt.ToolRuntime`, `langchain_core.messages`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `backend/agents/graphs/deep_investigate.py` | Full deep agent implementation |
| Create | `tests/backend/agents/test_deep_investigate.py` | All tests for the new file |
| Modify | `backend/agents/graphs/profile_analyzer.py` | Deprecate old node, import + wire new one |
| Modify | `pyproject.toml` | Record three new dependencies |

---

## Task 1: Add Dependencies to `pyproject.toml`

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Add the three new packages to the dependencies list**

Open `pyproject.toml`. In the `[project] dependencies` list, add these three lines after the `"anthropic>=0.40.0"` entry:

```toml
"deepagents>=0.5.0",
"langchain>=1.2.0",
"langchain-anthropic>=1.4.0",
```

The block should look like:

```toml
    # AI / agents
    "langgraph>=0.2.0",
    "anthropic>=0.40.0",
    "deepagents>=0.5.0",
    "langchain>=1.2.0",
    "langchain-anthropic>=1.4.0",
```

- [ ] **Step 2: Verify all three are importable from the project venv**

```bash
python -c "from deepagents.graph import create_deep_agent; from langchain_anthropic import ChatAnthropic; from langchain_core.messages import HumanMessage, AIMessage, ToolMessage; from langgraph.prebuilt import ToolRuntime; print('all imports ok')"
```

Expected output:
```
all imports ok
```

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml
git commit -m "chore: add deepagents, langchain, langchain-anthropic deps"
```

---

## Task 2: Write Failing Tests for `InvestigationContext` and Tool Functions

**Files:**
- Create: `tests/backend/agents/test_deep_investigate.py`

- [ ] **Step 1: Create the test file with InvestigationContext and tool function tests**

Create `tests/backend/agents/test_deep_investigate.py`:

```python
import json
from dataclasses import fields
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_runtime(session_id: str) -> MagicMock:
    """Build a minimal ToolRuntime mock with a context.session_id."""
    runtime = MagicMock()
    runtime.context.session_id = session_id
    return runtime


# ---------------------------------------------------------------------------
# InvestigationContext
# ---------------------------------------------------------------------------

def test_investigation_context_has_session_id_field():
    from backend.agents.graphs.deep_investigate import InvestigationContext
    field_names = {f.name for f in fields(InvestigationContext)}
    assert "session_id" in field_names


def test_investigation_context_stores_session_id():
    from backend.agents.graphs.deep_investigate import InvestigationContext
    ctx = InvestigationContext(session_id="abc-123")
    assert ctx.session_id == "abc-123"


# ---------------------------------------------------------------------------
# dq_run_sql
# ---------------------------------------------------------------------------

@patch("dq_tools.explorer.run_sql")
def test_dq_run_sql_passes_session_id_and_sql(mock_run_sql):
    from backend.agents.graphs.deep_investigate import dq_run_sql
    mock_run_sql.return_value = [{"id": 1}]
    result = dq_run_sql("SELECT 1", _make_runtime("sess-1"))
    mock_run_sql.assert_called_once_with("sess-1", "SELECT 1")
    assert json.loads(result) == [{"id": 1}]


@patch("dq_tools.explorer.run_sql")
def test_dq_run_sql_returns_json_string(mock_run_sql):
    from backend.agents.graphs.deep_investigate import dq_run_sql
    mock_run_sql.return_value = {"error": "bad sql"}
    result = dq_run_sql("BAD", _make_runtime("sess-1"))
    assert isinstance(result, str)
    assert "error" in json.loads(result)


# ---------------------------------------------------------------------------
# dq_get_value_counts
# ---------------------------------------------------------------------------

@patch("dq_tools.explorer.get_value_counts")
def test_dq_get_value_counts_passes_args(mock_gvc):
    from backend.agents.graphs.deep_investigate import dq_get_value_counts
    mock_gvc.return_value = {"column": "email", "top_values": []}
    result = dq_get_value_counts("email", runtime=_make_runtime("sess-2"))
    mock_gvc.assert_called_once_with("sess-2", "email", 20)
    assert isinstance(result, str)


@patch("dq_tools.explorer.get_value_counts")
def test_dq_get_value_counts_respects_top_n(mock_gvc):
    from backend.agents.graphs.deep_investigate import dq_get_value_counts
    mock_gvc.return_value = {}
    dq_get_value_counts("status", 5, runtime=_make_runtime("sess-2"))
    mock_gvc.assert_called_once_with("sess-2", "status", 5)


# ---------------------------------------------------------------------------
# dq_check_regex_pattern
# ---------------------------------------------------------------------------

@patch("dq_tools.explorer.check_regex_pattern")
def test_dq_check_regex_pattern_passes_args(mock_crp):
    from backend.agents.graphs.deep_investigate import dq_check_regex_pattern
    mock_crp.return_value = {"match_rate": 0.95}
    result = dq_check_regex_pattern("email", r".+@.+\..+", _make_runtime("sess-3"))
    mock_crp.assert_called_once_with("sess-3", "email", r".+@.+\..+")
    assert isinstance(result, str)


# ---------------------------------------------------------------------------
# dq_get_sample_rows
# ---------------------------------------------------------------------------

@patch("dq_tools.explorer.get_sample_rows")
def test_dq_get_sample_rows_default_args(mock_gsr):
    from backend.agents.graphs.deep_investigate import dq_get_sample_rows
    mock_gsr.return_value = [{"col": "val"}]
    dq_get_sample_rows(runtime=_make_runtime("sess-4"))
    mock_gsr.assert_called_once_with("sess-4", n=10, where_clause=None)


@patch("dq_tools.explorer.get_sample_rows")
def test_dq_get_sample_rows_with_where_clause(mock_gsr):
    from backend.agents.graphs.deep_investigate import dq_get_sample_rows
    mock_gsr.return_value = []
    dq_get_sample_rows(5, "age IS NULL", runtime=_make_runtime("sess-4"))
    mock_gsr.assert_called_once_with("sess-4", n=5, where_clause="age IS NULL")


# ---------------------------------------------------------------------------
# dq_get_column_detail
# ---------------------------------------------------------------------------

@patch("dq_tools.explorer.get_column_detail")
def test_dq_get_column_detail_passes_args(mock_gcd):
    from backend.agents.graphs.deep_investigate import dq_get_column_detail
    mock_gcd.return_value = {"type": "Numeric", "mean": 3.5}
    result = dq_get_column_detail("age", _make_runtime("sess-5"))
    mock_gcd.assert_called_once_with("sess-5", "age")
    assert isinstance(result, str)
    assert "mean" in json.loads(result)
```

- [ ] **Step 2: Run the tests to confirm they all fail with ImportError**

```bash
pytest tests/backend/agents/test_deep_investigate.py -v 2>&1 | head -30
```

Expected: All tests fail with `ModuleNotFoundError: No module named 'backend.agents.graphs.deep_investigate'`

---

## Task 3: Implement `InvestigationContext` and Tool Functions

**Files:**
- Create: `backend/agents/graphs/deep_investigate.py`

- [ ] **Step 1: Create `deep_investigate.py` with the context dataclass and all five tool functions**

Create `backend/agents/graphs/deep_investigate.py`:

```python
"""Deep investigation agent for ProfileAnalyzer.

Replaces the hand-rolled investigate_node with a create_deep_agent-backed
sub-graph. Session context flows to tools via ToolRuntime[None, InvestigationContext].

Import surface: deep_investigate_node (the LangGraph node function).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Optional

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.prebuilt import ToolRuntime

from backend.agents.emit import _find_project_root
from backend.agents.emit import emit as _emit
from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
from backend.agents.state import ProfileAnalyzerState
from dq_tools.explorer import (
    check_regex_pattern,
    get_column_detail,
    get_sample_rows,
    get_value_counts,
    run_sql,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Context schema — injected into every tool call via ToolRuntime
# ---------------------------------------------------------------------------

@dataclass
class InvestigationContext:
    session_id: str


# ---------------------------------------------------------------------------
# DuckDB tool functions
# Prefixed dq_ to avoid name collision with create_deep_agent built-ins
# (grep, glob, read_file, etc.). ToolRuntime is auto-injected by the
# framework and excluded from the tool schema sent to the model.
# ---------------------------------------------------------------------------

def dq_run_sql(
    sql: Annotated[str, "Read-only SELECT query against table 'working_data'. Returns up to 200 rows."],
    runtime: ToolRuntime[None, InvestigationContext],
) -> str:
    """Run a read-only SQL SELECT query against the dataset."""
    result = run_sql(runtime.context.session_id, sql)
    return json.dumps(result, default=str)


def dq_get_value_counts(
    column: Annotated[str, "Column name to analyse."],
    top_n: Annotated[int, "Number of top values to return. Default 20."] = 20,
    *,
    runtime: ToolRuntime[None, InvestigationContext],
) -> str:
    """Return the top-N frequency distribution of values in a column."""
    result = get_value_counts(runtime.context.session_id, column, top_n)
    return json.dumps(result, default=str)


def dq_check_regex_pattern(
    column: Annotated[str, "Column name to test."],
    pattern: Annotated[str, "Python regex pattern to match against non-null values."],
    runtime: ToolRuntime[None, InvestigationContext],
) -> str:
    """Check what percentage of non-null values in a column match a regex."""
    result = check_regex_pattern(runtime.context.session_id, column, pattern)
    return json.dumps(result, default=str)


def dq_get_sample_rows(
    n: Annotated[int, "Number of rows to return (max 50). Default 10."] = 10,
    where_clause: Annotated[
        Optional[str],
        "SQL WHERE condition without the WHERE keyword. Example: \"email NOT LIKE '%@%'\"",
    ] = None,
    *,
    runtime: ToolRuntime[None, InvestigationContext],
) -> str:
    """Return sample rows from the dataset, optionally filtered by a WHERE clause."""
    result = get_sample_rows(runtime.context.session_id, n=n, where_clause=where_clause)
    return json.dumps(result, default=str)


def dq_get_column_detail(
    column: Annotated[str, "Column name to retrieve full profiling stats for."],
    runtime: ToolRuntime[None, InvestigationContext],
) -> str:
    """Return full ydata-profiling statistics for a specific column."""
    result = get_column_detail(runtime.context.session_id, column)
    return json.dumps(result, default=str)
```

- [ ] **Step 2: Run the tool function tests**

```bash
pytest tests/backend/agents/test_deep_investigate.py -v -k "not build and not node and not context"
```

Expected: All tool function tests PASS. The `InvestigationContext` tests should also pass now.

- [ ] **Step 3: Run all context + tool tests together**

```bash
pytest tests/backend/agents/test_deep_investigate.py -v
```

Expected: All tests PASS (factory/node tests don't exist yet so nothing is skipped).

- [ ] **Step 4: Commit**

```bash
git add backend/agents/graphs/deep_investigate.py tests/backend/agents/test_deep_investigate.py
git commit -m "feat: add InvestigationContext and dq_* tool functions for deep investigate agent"
```

---

## Task 4: Write Failing Tests for the Agent Factory and Node

**Files:**
- Modify: `tests/backend/agents/test_deep_investigate.py`

- [ ] **Step 1: Append factory and node tests to the test file**

Append to the bottom of `tests/backend/agents/test_deep_investigate.py`:

```python
# ---------------------------------------------------------------------------
# _build_deep_investigate_agent
# ---------------------------------------------------------------------------

@patch("backend.agents.graphs.deep_investigate.ChatAnthropic")
@patch("backend.agents.graphs.deep_investigate.create_deep_agent")
def test_build_agent_calls_create_deep_agent(mock_create, mock_anthropic):
    from backend.agents.graphs.deep_investigate import _build_deep_investigate_agent
    mock_create.return_value = MagicMock()
    _build_deep_investigate_agent()
    assert mock_create.called


@patch("backend.agents.graphs.deep_investigate.ChatAnthropic")
@patch("backend.agents.graphs.deep_investigate.create_deep_agent")
def test_build_agent_passes_context_schema(mock_create, mock_anthropic):
    from backend.agents.graphs.deep_investigate import (
        InvestigationContext,
        _build_deep_investigate_agent,
    )
    mock_create.return_value = MagicMock()
    _build_deep_investigate_agent()
    kwargs = mock_create.call_args.kwargs
    assert kwargs.get("context_schema") is InvestigationContext


@patch("backend.agents.graphs.deep_investigate.ChatAnthropic")
@patch("backend.agents.graphs.deep_investigate.create_deep_agent")
def test_build_agent_passes_all_five_tools(mock_create, mock_anthropic):
    from backend.agents.graphs.deep_investigate import _build_deep_investigate_agent
    mock_create.return_value = MagicMock()
    _build_deep_investigate_agent()
    kwargs = mock_create.call_args.kwargs
    tool_names = {t.__name__ for t in kwargs["tools"]}
    assert tool_names == {
        "dq_run_sql",
        "dq_get_value_counts",
        "dq_check_regex_pattern",
        "dq_get_sample_rows",
        "dq_get_column_detail",
    }


@patch("backend.agents.graphs.deep_investigate.ChatAnthropic")
@patch("backend.agents.graphs.deep_investigate.create_deep_agent")
def test_build_agent_passes_investigation_system_prompt(mock_create, mock_anthropic):
    from backend.agents.graphs.deep_investigate import _build_deep_investigate_agent
    from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
    mock_create.return_value = MagicMock()
    _build_deep_investigate_agent()
    kwargs = mock_create.call_args.kwargs
    assert kwargs.get("system_prompt") == PROFILE_INVESTIGATION_SYSTEM


# ---------------------------------------------------------------------------
# deep_investigate_node
# ---------------------------------------------------------------------------

def _make_state(session_id: str = "test-session") -> dict:
    return {
        "session_id": session_id,
        "use_case": "HR employee records",
        "target_column": None,
        "overview_notes": "Dataset has 5 columns including email and hire_date.",
        "columns_to_investigate": [
            {"column": "email", "reason": "format check"},
            {"column": "hire_date", "reason": "date range plausibility"},
        ],
        "investigation_findings": "",
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": [],
        "top_issues": [],
    }


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_extracts_findings(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    last_msg = MagicMock(spec=AIMessage)
    last_msg.content = "email column has invalid formats in 847 rows (15%)."
    last_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [last_msg]}])
    mock_build.return_value = mock_agent

    result = deep_investigate_node(_make_state())
    assert result["investigation_findings"] == "email column has invalid formats in 847 rows (15%)."


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_preserves_other_state_fields(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    last_msg = MagicMock(spec=AIMessage)
    last_msg.content = "findings"
    last_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [last_msg]}])
    mock_build.return_value = mock_agent

    state = _make_state()
    state["data_passport"] = "existing passport"
    result = deep_investigate_node(state)
    assert result["data_passport"] == "existing passport"
    assert result["use_case"] == "HR employee records"


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_emits_done_event(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    last_msg = MagicMock(spec=AIMessage)
    last_msg.content = "done"
    last_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [last_msg]}])
    mock_build.return_value = mock_agent

    deep_investigate_node(_make_state())
    done_calls = [c for c in mock_emit.call_args_list if c.args[1] == "done"]
    assert len(done_calls) == 1


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_emits_thinking_for_ai_message(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    ai_msg = MagicMock(spec=AIMessage)
    ai_msg.content = "I will investigate the email column first."
    ai_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [ai_msg]}])
    mock_build.return_value = mock_agent

    deep_investigate_node(_make_state())
    thinking_calls = [c for c in mock_emit.call_args_list if c.args[1] == "thinking"]
    assert len(thinking_calls) >= 1


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_handles_empty_stream(mock_build, mock_emit):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    mock_agent.stream.return_value = iter([])
    mock_build.return_value = mock_agent

    result = deep_investigate_node(_make_state())
    assert result["investigation_findings"] == ""


@patch("backend.agents.graphs.deep_investigate._emit")
@patch("backend.agents.graphs.deep_investigate._build_deep_investigate_agent")
def test_deep_investigate_node_clears_progress_file(mock_build, mock_emit, tmp_path):
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    mock_agent = MagicMock()
    last_msg = MagicMock(spec=AIMessage)
    last_msg.content = "findings"
    last_msg.tool_calls = []
    mock_agent.stream.return_value = iter([{"messages": [last_msg]}])
    mock_build.return_value = mock_agent

    # Create a stale progress file
    session_dir = tmp_path / "data" / "sessions" / "test-session"
    session_dir.mkdir(parents=True)
    stale_file = session_dir / "investigation_progress.jsonl"
    stale_file.write_text('{"event": "stale"}\n')

    with patch(
        "backend.agents.graphs.deep_investigate._find_project_root",
        return_value=tmp_path,
    ):
        deep_investigate_node(_make_state())

    assert not stale_file.exists()
```

- [ ] **Step 2: Run tests to confirm the new ones fail**

```bash
pytest tests/backend/agents/test_deep_investigate.py -v -k "build or node"
```

Expected: All new tests FAIL with `ImportError` — `_build_deep_investigate_agent` and `deep_investigate_node` not yet defined.

---

## Task 5: Implement `_build_deep_investigate_agent` and `deep_investigate_node`

**Files:**
- Modify: `backend/agents/graphs/deep_investigate.py`

- [ ] **Step 1: Add the `_progress_path` helper, factory, and node to `deep_investigate.py`**

Append to the bottom of `backend/agents/graphs/deep_investigate.py` (after the tool function definitions):

```python
# ---------------------------------------------------------------------------
# Progress file path helper (mirrors profile_analyzer._progress_path)
# ---------------------------------------------------------------------------

def _progress_path(session_id: str) -> Path:
    return _find_project_root() / "data" / "sessions" / session_id / "investigation_progress.jsonl"


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

def _build_deep_investigate_agent():
    """Build and return the compiled create_deep_agent graph.

    Called once per node invocation. No backend is passed — the built-in
    filesystem/execute tools have no execution environment. The system prompt
    directs the agent to use only the dq_* tools for all data access.
    """
    from deepagents.graph import create_deep_agent
    from langchain_anthropic import ChatAnthropic

    return create_deep_agent(
        model=ChatAnthropic(model="claude-sonnet-4-6", max_tokens=8192),
        tools=[
            dq_run_sql,
            dq_get_value_counts,
            dq_check_regex_pattern,
            dq_get_sample_rows,
            dq_get_column_detail,
        ],
        system_prompt=PROFILE_INVESTIGATION_SYSTEM,
        context_schema=InvestigationContext,
    )


# ---------------------------------------------------------------------------
# LangGraph node
# ---------------------------------------------------------------------------

def deep_investigate_node(state: ProfileAnalyzerState) -> ProfileAnalyzerState:
    """Deep investigation node backed by create_deep_agent.

    Replaces the deprecated investigate_node. Produces the same
    `investigation_findings` string consumed by synthesize_understanding_node.
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

    initial_message = HumanMessage(
        content=f"""{chr(10).join(context_lines)}

Overview findings:
{state["overview_notes"]}

Columns flagged for investigation:
{json.dumps(state["columns_to_investigate"], indent=2)}

Use ONLY the dq_* tools (dq_run_sql, dq_get_value_counts, dq_check_regex_pattern,
dq_get_sample_rows, dq_get_column_detail) for all data access.

Use write_todos to plan and track your investigation across all flagged columns
so you don't miss any. Follow unexpected threads — if you find something
surprising in one column, investigate further. Check cross-column relationships
where columns are logically related.

When you have a thorough, specific understanding of every flagged column and
have followed all interesting threads, write up your complete findings WITHOUT
using any more tools. Your findings feed directly into the data passport."""
    )

    config = {
        "configurable": {"context": context},
        "recursion_limit": 120,  # ~60 tool-call rounds (agent + tools = 2 hops each)
    }

    # Stream with stream_mode="values" — each chunk is the full state.
    # Track seen message count to process only new messages each step.
    seen = 0
    final_state = None

    for chunk in agent.stream(
        {"messages": [initial_message]},
        config=config,
        stream_mode="values",
    ):
        messages = chunk.get("messages", [])
        for msg in messages[seen:]:
            if isinstance(msg, AIMessage):
                # Emit text reasoning
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

    _emit(session_id, "done", total_messages=seen)

    findings = ""
    if final_state:
        last = final_state["messages"][-1]
        if isinstance(last.content, str):
            findings = last.content
        elif isinstance(last.content, list):
            text_parts = [
                b["text"]
                for b in last.content
                if isinstance(b, dict) and b.get("type") == "text"
            ]
            findings = "\n".join(text_parts)
        else:
            findings = str(last.content)

    return {**state, "investigation_findings": findings}
```

- [ ] **Step 2: Run the full test suite for the new file**

```bash
pytest tests/backend/agents/test_deep_investigate.py -v
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/agents/graphs/deep_investigate.py tests/backend/agents/test_deep_investigate.py
git commit -m "feat: implement deep_investigate_node with create_deep_agent"
```

---

## Task 6: Update `profile_analyzer.py`

**Files:**
- Modify: `backend/agents/graphs/profile_analyzer.py`

- [ ] **Step 1: Add the import for `deep_investigate_node` at the top of the imports block**

In `backend/agents/graphs/profile_analyzer.py`, add this line after the existing `backend.agents` imports (around line 29):

```python
from backend.agents.graphs.deep_investigate import deep_investigate_node
```

The import block should look like:

```python
from backend.agents.prompts import (
    PROFILE_INVESTIGATION_SYSTEM,
    PROFILE_OVERVIEW_SYSTEM,
    PROFILE_SYNTHESIZE_SYSTEM,
    RULE_PROPOSER_SYSTEM,
)
from backend.agents.state import ProfileAnalyzerState
from backend.agents.graphs.deep_investigate import deep_investigate_node
```

- [ ] **Step 2: Rename `investigate_node` to `_investigate_node_deprecated` and add a deprecation comment**

Find the function definition at line 205:

```python
def investigate_node(state: ProfileAnalyzerState) -> ProfileAnalyzerState:
    """
    Tool-calling loop, Claude investigates the data until it is satisfied
    """
```

Replace with:

```python
# DEPRECATED — kept for rollback only. No logic changes made.
# To revert: replace `deep_investigate_node` with `_investigate_node_deprecated`
# in the single graph.add_node call in build_profile_analyzer_graph().
def _investigate_node_deprecated(state: ProfileAnalyzerState) -> ProfileAnalyzerState:
    """
    Tool-calling loop, Claude investigates the data until it is satisfied.
    DEPRECATED: use deep_investigate_node from deep_investigate.py instead.
    """
```

- [ ] **Step 3: Update the graph wiring — one line change in `build_profile_analyzer_graph()`**

Find (around line 482):
```python
    graph.add_node("investigate", investigate_node)
```

Replace with:
```python
    graph.add_node("investigate", deep_investigate_node)
```

- [ ] **Step 4: Verify the graph compiles without error**

```bash
python -c "
from backend.agents.graphs.profile_analyzer import build_profile_analyzer_graph
g = build_profile_analyzer_graph()
print('nodes:', list(g.nodes))
"
```

Expected output (order may vary):
```
nodes: ['read_overview', 'investigate', 'synthesize_understanding', 'propose_rules', '__start__']
```

- [ ] **Step 5: Run the existing test suite to check for regressions**

```bash
pytest tests/ -v --ignore=tests/backend/temporal -x 2>&1 | tail -20
```

Expected: All previously passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add backend/agents/graphs/profile_analyzer.py
git commit -m "feat: wire deep_investigate_node into ProfileAnalyzer graph, deprecate investigate_node"
```

---

## Self-Review

**Spec coverage:**
- `pyproject.toml` deps — Task 1 ✓
- `InvestigationContext` dataclass — Task 3 ✓
- Five `dq_*` tool functions with `ToolRuntime` injection — Task 3 ✓
- `_build_deep_investigate_agent()` factory — Task 5 ✓
- `deep_investigate_node()` with streaming + emit — Task 5 ✓
- Deprecate `investigate_node` → `_investigate_node_deprecated` — Task 6 ✓
- Import and wire `deep_investigate_node` in `profile_analyzer.py` — Task 6 ✓
- Rollback path (one-line revert) — documented in Task 6 Step 3 ✓

**Placeholder scan:** No TBDs. All code blocks are complete. All commands include expected output.

**Type consistency:**
- `InvestigationContext` defined in Task 3, referenced identically in Task 4 tests and Task 5 implementation ✓
- `_build_deep_investigate_agent` defined in Task 5, mocked by exact name in Task 4 tests ✓
- `deep_investigate_node` defined in Task 5, imported and wired in Task 6 ✓
- `dq_*` tool names consistent across Task 3 implementation, Task 4 tests, Task 5 factory ✓
- `investigation_findings` state key consistent with `ProfileAnalyzerState` and `synthesize_understanding_node` ✓
