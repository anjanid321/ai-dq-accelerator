"""Deep transform planning agent for TransformPlanner.

Replaces the hand-rolled build_plan node with a create_deep_agent-backed
sub-graph. Session context flows to tools via ToolRuntime[PlanningContext, None].

Import surface: deep_plan_node (the LangGraph node function).
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated, Optional

import pandas as pd
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.errors import GraphRecursionError
from langgraph.prebuilt import ToolRuntime

from backend.agents.emit import _find_project_root, emit as _emit
from backend.agents.prompts import TRANSFORM_PLANNER_SYSTEM
import dq_tools.explorer as _explorer
from deepagents.graph import create_deep_agent
from langchain_anthropic import ChatAnthropic

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Context schema — injected into every tool call via ToolRuntime
# ---------------------------------------------------------------------------

@dataclass
class PlanningContext:
    session_id: str


# ---------------------------------------------------------------------------
# DuckDB tool functions
# Prefixed dq_ to avoid name collision with create_deep_agent built-ins
# (grep, glob, read_file, etc.). ToolRuntime is auto-injected by the
# framework and excluded from the tool schema sent to the model.
# ---------------------------------------------------------------------------

def dq_run_sql(
    sql: Annotated[str, "Read-only SELECT query against table 'working_data'. Returns up to 200 rows."],
    runtime: ToolRuntime[PlanningContext, None],
) -> str:
    """Run a read-only SQL SELECT query against the dataset."""
    result = _explorer.run_sql(runtime.context.session_id, sql)
    return json.dumps(result, default=str)


def dq_get_value_counts(
    column: Annotated[str, "Column name to analyse."],
    top_n: Annotated[int, "Number of top values to return. Default 20."] = 20,
    *,
    runtime: ToolRuntime[PlanningContext, None],
) -> str:
    """Return the top-N frequency distribution of values in a column."""
    result = _explorer.get_value_counts(runtime.context.session_id, column, top_n)
    return json.dumps(result, default=str)


def dq_check_regex_pattern(
    column: Annotated[str, "Column name to test."],
    pattern: Annotated[str, "Python regex pattern to match against non-null values."],
    runtime: ToolRuntime[PlanningContext, None],
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
    runtime: ToolRuntime[PlanningContext, None],
) -> str:
    """Return sample rows from the dataset, optionally filtered by a WHERE clause."""
    result = _explorer.get_sample_rows(runtime.context.session_id, n=n, where_clause=where_clause)
    return json.dumps(result, default=str)


def dq_get_column_detail(
    column: Annotated[str, "Column name to retrieve full profiling stats for."],
    runtime: ToolRuntime[PlanningContext, None],
) -> str:
    """Return full ydata-profiling statistics for a specific column."""
    result = _explorer.get_column_detail(runtime.context.session_id, column)
    return json.dumps(result, default=str)


def dq_group_over_time(
    group_col: Annotated[str, "Categorical column to track over time bins."],
    time_col: Annotated[str, "Date/time column to split into bins."],
    bins: Annotated[int, "Number of time bins (default 10)."] = 10,
    *,
    runtime: ToolRuntime[PlanningContext, None],
) -> str:
    """Track how categorical values change across time bins.
    Detects renames, retirements, and structural shifts over time."""
    from dq_tools.cross_column import group_over_time
    result = group_over_time(runtime.context.session_id, group_col, time_col, bins)
    return json.dumps(result, default=str)


def dq_find_correlated_nulls(
    threshold: Annotated[float, "Phi coefficient threshold (default 0.3). Lower = more pairs returned."] = 0.3,
    *,
    runtime: ToolRuntime[PlanningContext, None],
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
    runtime: ToolRuntime[PlanningContext, None],
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
    runtime: ToolRuntime[PlanningContext, None],
) -> str:
    """Pearson correlation matrix for numeric columns. Use early to find pairs worth investigating."""
    from dq_tools.cross_column import compute_correlation_matrix
    result = compute_correlation_matrix(runtime.context.session_id, columns)
    return json.dumps(result, default=str)


def dq_validate_prebuilt_spec(
    step_spec_json: Annotated[
        str,
        "JSON string of the transform step spec to validate. Must include 'type' and 'params' keys. "
        "Example: '{\"type\": \"impute_constant\", \"column\": \"age\", \"params\": {\"column\": \"age\", \"value\": 0}}'",
    ],
    runtime: ToolRuntime[PlanningContext, None],
) -> str:
    """Validate a prebuilt transform spec against a 50-row sample of the current data.

    Returns {"valid": true} if the spec is correct, or {"valid": false, "error": "..."}
    with a description of what is wrong. Call this before emitting any prebuilt step block.
    Custom steps (type='custom') do not need validation — skip this tool for them.
    """
    import duckdb
    from dq_tools.transformation_executor import validate_transform_spec

    try:
        spec = json.loads(step_spec_json)
    except json.JSONDecodeError as exc:
        return json.dumps({"valid": False, "error": f"Invalid JSON: {exc}"})

    if spec.get("type") == "custom":
        return json.dumps({"valid": True, "note": "Custom steps are validated at execution time."})

    session_id = runtime.context.session_id
    sample_df = pd.DataFrame()
    try:
        db_path = str(_find_project_root() / "data" / "sessions" / session_id / "working.duckdb")
        with duckdb.connect(db_path, read_only=True) as conn:
            sample_df = conn.execute("SELECT * FROM working_data ORDER BY RANDOM() LIMIT 50").df()
    except Exception as exc:
        return json.dumps({"valid": False, "error": f"Could not load data sample: {exc}"})

    if sample_df.empty:
        return json.dumps({"valid": False, "error": "Data sample is empty — cannot validate spec."})

    _, error = validate_transform_spec(spec, sample_df)
    if error is None:
        return json.dumps({"valid": True})
    return json.dumps({"valid": False, "error": error})


# ---------------------------------------------------------------------------
# Structured-plan helpers
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
        ("===TRANSFORM_STEP_START===", "===TRANSFORM_STEP_END==="),
        ("===PLAN_SUMMARY_START===", "===PLAN_SUMMARY_END==="),
    ]:
        text = re.sub(re.escape(start) + r"[\s\S]*?" + re.escape(end), "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _parse_structured_plan(text: str) -> tuple[list[dict], dict]:
    """Parse ===TRANSFORM_STEP_START=== and ===PLAN_SUMMARY_START=== blocks.

    Returns (steps, summary). Steps is a list of dicts parsed from each step block.
    Summary is a dict parsed from the plan summary block, or {} if absent/invalid.
    Invalid JSON blocks are skipped with a warning.
    """
    step_pattern = re.compile(
        re.escape("===TRANSFORM_STEP_START===") + r"\s*([\s\S]*?)\s*" + re.escape("===TRANSFORM_STEP_END===")
    )
    steps = []
    for m in step_pattern.finditer(text):
        raw = m.group(1).strip()
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                steps.append(parsed)
        except json.JSONDecodeError:
            logger.warning(
                "_parse_structured_plan: skipping unparseable step block (first 120 chars): %s",
                raw[:120],
            )

    summary_pattern = re.compile(
        re.escape("===PLAN_SUMMARY_START===") + r"\s*([\s\S]*?)\s*" + re.escape("===PLAN_SUMMARY_END===")
    )
    summary: dict = {}
    m = summary_pattern.search(text)
    if m:
        raw = m.group(1).strip()
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                summary = parsed
        except json.JSONDecodeError:
            logger.warning(
                "_parse_structured_plan: skipping unparseable summary block (first 120 chars): %s",
                raw[:120],
            )

    return steps, summary


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

def _build_deep_plan_agent():
    """Build and return the compiled create_deep_agent graph for transform planning."""
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
            dq_validate_prebuilt_spec,
        ],
        system_prompt=TRANSFORM_PLANNER_SYSTEM,
        context_schema=PlanningContext,
    )


# ---------------------------------------------------------------------------
# LangGraph node
# ---------------------------------------------------------------------------

def deep_plan_node(state: "TransformPlannerState") -> "TransformPlannerState":
    """Deep transform planning node backed by create_deep_agent.

    Investigates failing rules using dq_* tools, validates prebuilt specs via
    dq_validate_prebuilt_spec, and emits structured ===TRANSFORM_STEP_START===
    marker blocks inline. These blocks are parsed to populate plan_steps directly
    — no separate build_plan LLM call needed. Marker blocks are stripped from
    prose before emitting to SSE.
    """
    session_id = state["session_id"]
    transformation_log = state.get("transformation_log") or []

    profile_cols = list((state.get("profile") or {}).get("columns", {}).keys())

    logger.info(
        "[deep_plan:%s] Starting — %d fixable rules, %d profile cols",
        session_id[:8],
        len(state.get("fixable_rules", [])),
        len(profile_cols),
    )

    agent = _build_deep_plan_agent()
    context = PlanningContext(session_id=session_id)

    initial_message = HumanMessage(
        content=f"""Use case: {state["use_case"]}

Transform-fixable failing rules to address:
{json.dumps(state["fixable_rules"], indent=2)}

Profile columns: {profile_cols}

Prior transformations (if any):
{json.dumps(transformation_log, indent=2) if transformation_log else "(none)"}

Use write_todos to plan your investigation across all failing rules.
Use the dq_* tools to investigate the actual data issues before deciding on transforms.

For each prebuilt step you decide on:
1. Call dq_validate_prebuilt_spec to verify the params are correct.
2. Fix any validation errors, then re-validate.
3. Emit the ===TRANSFORM_STEP_START=== block.

For custom steps, emit the block immediately with intent/target_columns/approach.

After all steps, emit the ===PLAN_SUMMARY_START=== block."""
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
            "[deep_plan:%s] Recursion limit reached — using plan accumulated so far (%d messages)",
            session_id[:8],
            seen,
        )

    _emit(session_id, "done", total_messages=seen)

    # Parse structured plan from all AI text collected during the stream
    full_text = "\n".join(all_ai_text)
    steps, summary = _parse_structured_plan(full_text)

    # Post-processing: apply defaults, sort, and cap
    baseline_score = state["validation_results"].get("baseline_quality_score", 0.0)

    # Apply defaults to each step
    for step in steps:
        step.setdefault("needs_review", False)
        step.setdefault("status", "pending")
        step.setdefault("actual_score_delta", None)
        step.setdefault("custom_code", None)
        step.setdefault("params", {})
        step.setdefault("depends_on", [])
        step.setdefault("conflicts_with", [])
        step.setdefault("targets_rules", [])

    # Sort by projected_score_delta descending
    steps.sort(key=lambda s: s.get("projected_score_delta", 0.0), reverse=True)

    # Cap at 25 steps
    steps = steps[:25]

    plan_summary = summary.get("summary", "")
    plan_projected_final_score = summary.get("projected_final_score", baseline_score)

    return {
        **state,
        "plan_steps": steps,
        "plan_summary": plan_summary,
        "plan_projected_final_score": plan_projected_final_score,
    }


if TYPE_CHECKING:
    from backend.agents.graphs.transform_planner import TransformPlannerState
