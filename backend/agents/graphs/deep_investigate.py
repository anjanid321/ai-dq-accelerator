"""Deep investigation agent for ProfileAnalyzer.

Replaces the hand-rolled investigate_node with a create_deep_agent-backed
sub-graph. Session context flows to tools via ToolRuntime[InvestigationContext, None].

Import surface: deep_investigate_node (the LangGraph node function).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Optional

from langchain_core.runnables import RunnableConfig

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.prebuilt import ToolRuntime

from backend.agents.emit import _find_project_root
from backend.agents.emit import emit as _emit
from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
from backend.agents.state import ProfileAnalyzerState
import dq_tools.explorer as _explorer
from deepagents.graph import create_deep_agent
from langchain_anthropic import ChatAnthropic

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
    runtime: ToolRuntime[InvestigationContext, None],
) -> str:
    """Run a read-only SQL SELECT query against the dataset."""
    result = _explorer.run_sql(runtime.context.session_id, sql)
    return json.dumps(result, default=str)


def dq_get_value_counts(
    column: Annotated[str, "Column name to analyse."],
    top_n: Annotated[int, "Number of top values to return. Default 20."] = 20,
    *,
    runtime: ToolRuntime[InvestigationContext, None],
) -> str:
    """Return the top-N frequency distribution of values in a column."""
    result = _explorer.get_value_counts(runtime.context.session_id, column, top_n)
    return json.dumps(result, default=str)


def dq_check_regex_pattern(
    column: Annotated[str, "Column name to test."],
    pattern: Annotated[str, "Python regex pattern to match against non-null values."],
    runtime: ToolRuntime[InvestigationContext, None],
) -> str:
    """Check what percentage of non-null values in a column match a regex."""
    result = _explorer.check_regex_pattern(runtime.context.session_id, column, pattern)
    return json.dumps(result, default=str)


def dq_get_sample_rows(
    n: Annotated[int, "Number of rows to return (max 50). Default 10."] = 10,
    where_clause: Annotated[
        Optional[str],
        "SQL WHERE condition without the WHERE keyword. Example: \"email NOT LIKE '%@%'\"",
    ] = None,
    *,
    runtime: ToolRuntime[InvestigationContext, None],
) -> str:
    """Return sample rows from the dataset, optionally filtered by a WHERE clause."""
    result = _explorer.get_sample_rows(runtime.context.session_id, n=n, where_clause=where_clause)
    return json.dumps(result, default=str)


def dq_get_column_detail(
    column: Annotated[str, "Column name to retrieve full profiling stats for."],
    runtime: ToolRuntime[InvestigationContext, None],
) -> str:
    """Return full ydata-profiling statistics for a specific column."""
    result = _explorer.get_column_detail(runtime.context.session_id, column)
    return json.dumps(result, default=str)


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
    return create_deep_agent(
        model=ChatAnthropic(model="claude-sonnet-4-6", max_tokens=8192),  # pyright: ignore[reportCallIssue]
        tools=[
            dq_run_sql,
            dq_get_value_counts,
            dq_check_regex_pattern,
            dq_get_sample_rows,
            dq_get_column_detail,
            dq_group_over_time,            # NEW
            dq_find_correlated_nulls,      # NEW
            dq_pairwise_profile,           # NEW
            dq_compute_correlation_matrix, # NEW
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

    config: RunnableConfig = {
        "recursion_limit": 120,  # ~60 tool-call rounds (agent + tools = 2 hops each)
    }

    # Stream with stream_mode="values" — each chunk is the full state.
    # Track seen message count to process only new messages each step.
    seen = 0
    final_state = None

    for chunk in agent.stream(
        {"messages": [initial_message]},
        config=config,
        context=context,
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
