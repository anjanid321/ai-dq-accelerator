"""Deep investigation agent for ProfileAnalyzer.

Replaces the hand-rolled investigate_node with a create_deep_agent-backed
sub-graph. Session context flows to tools via ToolRuntime[InvestigationContext, None].

Import surface: deep_investigate_node (the LangGraph node function).
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Optional

from langchain_core.runnables import RunnableConfig

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.errors import GraphRecursionError
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
# Structured-findings helpers
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
    for start, end in [
        ("===COLUMN_FINDING_START===", "===COLUMN_FINDING_END==="),
        ("===CROSS_COLUMN_FINDING_START===", "===CROSS_COLUMN_FINDING_END==="),
        ("===EXPLORATION_SUMMARY_START===", "===EXPLORATION_SUMMARY_END==="),
    ]:
        text = re.sub(
            re.escape(start) + r"[\s\S]*?" + re.escape(end),
            "",
            text,
        )
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _parse_structured_findings(text: str) -> dict:
    """Parse ===COLUMN_FINDING_START=== / ===CROSS_COLUMN_FINDING_START=== / ===EXPLORATION_SUMMARY_START=== blocks.

    Returns an ExplorationFindings-shaped dict. Returns a minimal valid structure on any failure.
    """
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
    prior_cols: dict = {
        cf["column"]: cf
        for cf in prior.get("column_findings", [])
        if cf.get("column")
    }
    for cf in new.get("column_findings", []):
        if cf.get("column"):
            prior_cols[cf["column"]] = cf

    has_new_data = bool(new.get("column_findings"))
    return {
        "column_findings": list(prior_cols.values()),
        "cross_column_findings": (
            new.get("cross_column_findings", []) if has_new_data else prior.get("cross_column_findings", [])
        ),
        "open_questions": (
            new.get("open_questions", []) if has_new_data else prior.get("open_questions", [])
        ),
        "readiness_assessment": (
            new.get("readiness_assessment", "unknown")
            if has_new_data
            else prior.get("readiness_assessment", "unknown")
        ),
        "key_risks": (
            new.get("key_risks", []) if has_new_data else prior.get("key_risks", [])
        ),
    }


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
            dq_group_over_time,
            dq_find_correlated_nulls,
            dq_pairwise_profile,
            dq_compute_correlation_matrix,
        ],
        system_prompt=PROFILE_INVESTIGATION_SYSTEM,
        context_schema=InvestigationContext,
    )


# ---------------------------------------------------------------------------
# LangGraph node
# ---------------------------------------------------------------------------

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
                    # Emit prose reasoning (strip marker blocks to keep SSE feed readable)
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
