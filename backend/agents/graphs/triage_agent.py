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

from backend.agents.emit import emit as _emit
from backend.agents.retry import call_claude_with_retry
from backend.agents.prompts import TRIAGE_SYSTEM_PROMPT, TRIAGE_CONTRADICTION_SYSTEM
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


def emit(session_id: str, event: str, **kwargs):
    try:
        _emit(session_id, event, **kwargs)
    except Exception:
        pass


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


def _execute_tool(session_id: str, tool_name: str, tool_input: dict):
    try:
        if tool_name == "run_sql":
            return run_sql(session_id, tool_input["sql"])
        elif tool_name == "get_value_counts":
            return get_value_counts(session_id, tool_input["column"], tool_input.get("top_n", 20))
        elif tool_name == "check_regex_pattern":
            return check_regex_pattern(session_id, tool_input["column"], tool_input["pattern"])
        elif tool_name == "get_sample_rows":
            return get_sample_rows(
                session_id, n=tool_input.get("n", 10), where_clause=tool_input.get("where_clause")
            )
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
            result.append(
                {
                    "rule_id": rid,
                    "check": rule.get("check"),
                    "column": rule.get("column"),
                    "classification": "eval_error" if rule.get("error") else "transform_fixable",
                    "proposed_threshold": None,
                    "proposed_remove": bool(rule.get("error")),
                    "reason": "Not classified by agent — defaulting based on error field.",
                    "confidence": "low",
                }
            )

    # Ensure valid classification values and required keys
    required_keys = {
        "rule_id",
        "check",
        "column",
        "classification",
        "proposed_threshold",
        "proposed_remove",
        "reason",
        "confidence",
    }
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


def triage_node(state: TriageAgentState) -> TriageAgentState:
    """Tool-calling loop: investigate each failing rule and classify it."""
    client = anthropic.Anthropic()
    session_id = state["session_id"]
    failing_rules = state["failing_rules"]
    use_case = state["use_case"]

    emit(session_id, "thinking", text=f"Triaging {len(failing_rules)} failing rules...")

    if not failing_rules:
        return {**state, "classifications": [], "summary": _build_summary([]), "contradictions": []}

    # Slim down sample_failing_rows to keep context manageable
    rules_for_prompt = []
    for r in failing_rules:
        entry = dict(r)
        entry["sample_failing_rows"] = r.get("sample_failing_rows", [])[:5]
        rules_for_prompt.append(entry)

    messages: list[dict] = [
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
            max_tokens=8192,
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
            emit(session_id, "tool_result", tool=block.name, preview=str(result)[:80])
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result, default=str)[:8000],
                }
            )

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
    elif isinstance(parsed, list):
        classifications = parsed
    else:
        logger.warning(
            "[triage:%s] Could not parse classification JSON — using fallback", session_id[:8]
        )

    # Re-prompt for JSON if initial parse failed
    if not classifications:
        logger.info("[triage:%s] Initial parse failed — re-prompting for JSON only", session_id[:8])
        json_request_messages = list(messages)
        if last_response:
            assistant_text = "".join(b.text for b in last_response.content if hasattr(b, "text"))
            if assistant_text.strip():
                json_request_messages.append({"role": "assistant", "content": assistant_text})
        json_request_messages.append(
            {
                "role": "user",
                "content": "Output ONLY the JSON object with classifications and summary. No prose, no explanation.",
            }
        )
        json_response = call_claude_with_retry(
            client,
            model=MODEL,
            max_tokens=8192,
            system=TRIAGE_SYSTEM_PROMPT,
            # No tools — force a pure-text JSON response
            messages=json_request_messages,
        )
        retry_text = "".join(b.text for b in json_response.content if hasattr(b, "text"))
        retry_parsed = _parse_json(retry_text)
        if isinstance(retry_parsed, dict) and isinstance(retry_parsed.get("classifications"), list):
            classifications = retry_parsed["classifications"]
        elif isinstance(retry_parsed, list):
            classifications = retry_parsed
        else:
            logger.warning("[triage:%s] Re-prompt also failed — using fallback", session_id[:8])

    classifications = _validate_classifications(classifications, failing_rules)
    summary = _build_summary(classifications)

    contradictions = _detect_triage_contradictions(
        client, session_id, classifications, failing_rules, use_case
    )

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


def build_triage_graph():
    graph = StateGraph(TriageAgentState)
    graph.add_node("triage", triage_node)
    graph.set_entry_point("triage")
    graph.add_edge("triage", END)
    return graph.compile()


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
        # Fallback: classify everything as transform_fixable
        fallback = _validate_classifications([], failing_rules)
        return {"classifications": fallback, "summary": _build_summary(fallback), "contradictions": []}
