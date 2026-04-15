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
