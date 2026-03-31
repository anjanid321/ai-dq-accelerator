"""ProfileAnalyzerGraph — four-phase investigation-first profiling agent.

Phase 1 — Overview:     Read ydata-profiling summary + alerts, plan investigation.
Phase 2 — Investigate:  Tool-calling loop; Claude queries the data until satisfied.
Phase 3 — Synthesize:   Write a "data passport" — what the data IS, not what's wrong.
Phase 4 — Propose rules: Grounded rules derived from the passport + use case.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

from backend.agents.emit import emit as _emit, _find_project_root
from backend.agents.retry import call_claude_with_retry

from langgraph.graph import END, StateGraph

from backend.agents.prompts import (
    PROFILE_INVESTIGATION_SYSTEM,
    PROFILE_OVERVIEW_SYSTEM,
    PROFILE_SYNTHESIZE_SYSTEM,
    RULE_PROPOSER_SYSTEM,
)
from backend.agents.state import ProfileAnalyzerState
from dq_tools.explorer import (
    EXPLORER_TOOLS,
    check_regex_pattern,
    get_column_detail,
    get_sample_rows,
    get_value_counts,
    run_sql,
)
from dq_tools.rule_engine import rule_to_sodacl_check


def _load_profile_summary(session_id: str) -> dict:
    """Load the trimmed profile summary from disk (written by profile_dataset)."""
    path = _find_project_root() / "data" / "sessions" / session_id / "profile.json"
    if not path.exists():
        return {}
    try:
        full = json.loads(path.read_text())
        from dq_tools.profiler import _trim_profile_for_llm

        return _trim_profile_for_llm(full, session_id)
    except Exception:
        return {}


def _propose_rules_by_category(client, passport: str, columns: list, use_case_context: str) -> list:
    """Fallback: propose rules in 3 category batches when the single-call response was truncated."""
    all_rules: list = []
    for category in ("validity", "completeness", "uniqueness"):
        try:
            resp = call_claude_with_retry(client,
                model="claude-sonnet-4-6",
                max_tokens=4096,
                temperature=0,
                system=RULE_PROPOSER_SYSTEM,
                messages=[
                    {
                        "role": "user",
                        "content": f"""{use_case_context}
Available columns: {columns}

Data passport:
{passport}

Propose ONLY **{category}** rules. Output a JSON array of rule objects.
Start with [ and end with ] — no preamble.""",
                    }
                ],
            )
            if resp.stop_reason != "max_tokens":
                batch = _parse_json(resp.content[0].text) or []
                if isinstance(batch, list):
                    all_rules.extend(batch)
            else:
                logger.warning("propose_rules_by_category: %s batch also truncated — skipping", category)
        except Exception as e:
            logger.error("propose_rules_by_category: %s batch failed: %s", category, e)
    return all_rules


def _parse_json(text: str):
    """Extract and parse the first JSON object or array from text."""
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
    for start_c, end_c in [("[", "]"), ("{", "}")]:
        s, e = text.find(start_c), text.rfind(end_c)
        if s != -1 and e > s:
            try:
                return json.loads(text[s : e + 1])
            except json.JSONDecodeError:
                pass
    return None


def _execute_tool(session_id: str, tool_name: str, tool_input: dict):
    """Dispatch an explorer tool call by name."""
    try:
        if tool_name == "run_sql":
            return run_sql(session_id, tool_input["sql"])
        elif tool_name == "get_value_counts":
            return get_value_counts(session_id, tool_input["column"], tool_input.get("top_n", 20))
        elif tool_name == "check_regex_pattern":
            return check_regex_pattern(session_id, tool_input["column"], tool_input["pattern"])
        elif tool_name == "get_sample_rows":
            return get_sample_rows(
                session_id,
                n=tool_input.get("n", 10),
                where_clause=tool_input.get("where_clause"),
            )
        elif tool_name == "get_column_detail":
            return get_column_detail(session_id, tool_input["column"])
        else:
            return {"error": f"Unknown tool: {tool_name}"}
    except Exception as e:
        return {"error": str(e)}


# Phase 1 Overview
def read_overview_node(state: ProfileAnalyzerState) -> ProfileAnalyzerState:
    """Read the profiling summary and decide which columns to investigate."""
    import anthropic

    client = anthropic.Anthropic()
    profile = _load_profile_summary(state["session_id"])

    context_lines = [f"Dataset context: {state['use_case']}"]
    if state.get("target_column"):
        context_lines.append(f"Target/label column: {state['target_column']}")
    if state.get("description"):
        context_lines.append(f"Additional context: {state['description']}")

    prompt = f"""{chr(10).join(context_lines)}

Here is the automated profiling summary for this dataset:
{json.dumps(profile, indent=2)}

Output JSON with this structure:
{{
  "data_hypothesis": "In one sentence: what business entity or process does this dataset describe?",
  "overview_notes": "2-3 sentences of initial structural observations (not quality judgments yet)",
  "columns_to_investigate": [
    {{"column": "email", "reason": "Text type with near-unique values — check format consistency"}},
    ...
  ],
  "immediate_flags": ["Any structural issue obvious from the overview alone", ...]
}}

Include all columns that warrant investigation. Prioritise columns flagged in alerts,
columns with unexpected missingness, and columns likely to have format inconsistencies."""

    response = call_claude_with_retry(client,
        model="claude-sonnet-4-6",
        max_tokens=2048,
        temperature=0,
        system=PROFILE_OVERVIEW_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text
    parsed = _parse_json(text)

    if not parsed:
        all_cols = list(profile.get("variables_summary", {}).keys())
        return {
            **state,
            "overview_notes": text[:2000],
            "columns_to_investigate": [
                {"column": c, "reason": "flagged for general investigation"} for c in all_cols[:15]
            ],
        }

    return {
        **state,
        "overview_notes": (
            parsed.get("data_hypothesis", "") + "\n\n" + parsed.get("overview_notes", "")
        ).strip(),
        "columns_to_investigate": parsed.get("columns_to_investigate", []),
    }


# Phase 2 Investigation loop
def _progress_path(session_id: str) -> Path:
    return _find_project_root() / "data" / "sessions" / session_id / "investigation_progress.jsonl"



def investigate_node(state: ProfileAnalyzerState) -> ProfileAnalyzerState:
    """
    Tool-calling loop, Claude investigates the data until it is satisfied
    """
    import anthropic

    client = anthropic.Anthropic()
    session_id = state["session_id"]

    # Clear any leftover progress file from a previous run
    prog = _progress_path(session_id)
    if prog.exists():
        prog.unlink()

    logger.info(
        "[investigate:%s] Starting investigation — %d columns queued",
        session_id[:8],
        len(state.get("columns_to_investigate", [])),
    )

    context_lines = [f"Dataset: {state['use_case']}"]
    if state.get("target_column"):
        context_lines.append(f"Target column (ML label): {state['target_column']}")

    messages = [
        {
            "role": "user",
            "content": f"""{chr(10).join(context_lines)}

Initial overview:
{state["overview_notes"]}

Columns identified for investigation:
{json.dumps(state["columns_to_investigate"], indent=2)}

Use the provided tools to investigate the data. For each column:
- Check actual value distributions (get_value_counts)
- Test format patterns for structured text — emails, dates, IDs, codes (check_regex_pattern)
- Look at problematic rows directly (get_sample_rows with a where_clause)
- Run cross-column checks where columns are logically related (run_sql)
- Get full profiling stats when you need more depth (get_column_detail)

Follow interesting threads — if you find something unexpected, investigate further.

When you have a thorough, specific understanding of every flagged column and have followed
all interesting threads, write up your complete findings WITHOUT using any more tools.
Your findings feed directly into the data passport and rule proposals.""",
        }
    ]

    all_findings: list[str] = []
    max_iterations = 25
    total_tool_calls = 0

    for iteration in range(max_iterations):
        response = call_claude_with_retry(client,
            model="claude-sonnet-4-6",
            max_tokens=4096,
            tools=EXPLORER_TOOLS,
            messages=messages,
        )

        # Emit any text blocks (agent reasoning / interim summaries)
        for block in response.content:
            if hasattr(block, "text") and block.text.strip():
                all_findings.append(block.text.strip())
                _emit(session_id, "thinking", text=block.text.strip())

        if response.stop_reason == "end_turn":
            break

        # Execute tools and emit progress for each call
        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue

            total_tool_calls += 1
            _emit(session_id, "tool_call", tool=block.name, input=block.input, iteration=iteration)

            result = _execute_tool(session_id, block.name, block.input)

            # Build a short preview of the result for the log
            result_str = json.dumps(result, default=str)
            if isinstance(result, dict) and "error" in result:
                preview = f"ERROR: {result['error']}"
            elif isinstance(result, list):
                preview = f"{len(result)} rows"
            elif isinstance(result, dict):
                top_keys = list(result.keys())[:4]
                preview = "{" + ", ".join(f"{k}: ..." for k in top_keys) + "}"
            else:
                preview = result_str[:80]

            _emit(session_id, "tool_result", tool=block.name, preview=preview)

            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_str[:10_000],
                }
            )

        if not tool_results:
            break

        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

    _emit(session_id, "done", iterations=iteration + 1, tool_calls=total_tool_calls)

    return {
        **state,
        "investigation_findings": "\n\n---\n\n".join(all_findings) if all_findings else "",
    }


# Phase 3 Synthesize understanding
def synthesize_understanding_node(state: ProfileAnalyzerState) -> ProfileAnalyzerState:
    """Write a structured data passport from the investigation findings."""
    import anthropic

    client = anthropic.Anthropic()

    response = call_claude_with_retry(client,
        model="claude-sonnet-4-6",
        max_tokens=3000,
        temperature=0.1,
        system=PROFILE_SYNTHESIZE_SYSTEM,
        messages=[
            {
                "role": "user",
                "content": f"""Dataset: {state["use_case"]}

Investigation findings:
{state["investigation_findings"]}

Write a complete data passport. Cover:
1. What this dataset represents (the business entity or process)
2. Each column: semantic meaning, actual value range/set, data quality state, specific issues found (with counts)
3. Cross-column relationships and dependencies
4. A plain-English list of quality issues — specific, quantified where possible

Do NOT propose rules or transformations. Just describe what you found.""",
            }
        ],
    )

    return {
        **state,
        "data_passport": response.content[0].text,
    }


# Phase 4 Propose rules
def propose_rules_node(state: ProfileAnalyzerState) -> ProfileAnalyzerState:
    """Propose data quality rules grounded in the data passport."""
    import anthropic

    client = anthropic.Anthropic()

    profile = _load_profile_summary(state["session_id"])
    columns = list(profile.get("variables_summary", {}).keys())

    use_case_context = f"""Dataset: {state["use_case"]}
{f"Target/label column: {state['target_column']}" if state.get("target_column") else ""}"""

    try:
        rules_response = call_claude_with_retry(client,
            model="claude-sonnet-4-6",
            max_tokens=8192,
            temperature=0,
            system=RULE_PROPOSER_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": f"""{use_case_context}
Available columns: {columns}

Data passport (grounded understanding of the data):
{state["data_passport"]}

Propose data quality rules. Rules must be:
- Grounded in what the data passport actually describes — no generic templates
- Specific: reference actual column names, actual patterns found, actual valid value sets
- Ordered by importance to the use case (most critical first)

Output a JSON array of rule objects following the schema in your instructions.
Start your response with [ and end with ] — no preamble, no explanation.""",
                },
            ],
        )
        raw_rules_text = rules_response.content[0].text
        logger.info(
            "[propose_rules:%s] raw response (first 200): %s",
            state["session_id"][:8],
            raw_rules_text[:200],
        )
        if rules_response.stop_reason == "max_tokens":
            logger.warning(
                "[propose_rules:%s] response truncated at max_tokens — falling back to per-category batches",
                state["session_id"][:8],
            )
            rules = _propose_rules_by_category(
                client, state["data_passport"], columns, use_case_context
            )
        else:
            rules = _parse_json(raw_rules_text)
    except Exception as e:
        logger.error("[propose_rules:%s] rules API call failed: %s", state["session_id"][:8], e)
        rules = None

    if not isinstance(rules, list):
        logger.warning(
            "[propose_rules:%s] _parse_json returned %r — raw (first 500): %s",
            state["session_id"][:8],
            type(rules).__name__,
            raw_rules_text[:500] if "raw_rules_text" in dir() else "N/A",
        )
        rules = []
    for i, rule in enumerate(rules):
        rule["id"] = f"r{i + 1}"
        # Attach SodaCL block so the user can inspect/edit it at approval time
        if not rule.get("sodacl"):
            rule["sodacl"] = rule_to_sodacl_check(rule)

    issues_response = call_claude_with_retry(client,
        model="claude-sonnet-4-6",
        max_tokens=600,
        temperature=0,
        messages=[
            {
                "role": "user",
                "content": f"""From this data passport, extract the 5 most important data quality issues
as short, specific bullet points (one sentence each, include numbers where known):

{state["data_passport"]}

Output ONLY a JSON array of strings. Start with [ and end with ].""",
            },
        ],
    )
    raw_issues_text = issues_response.content[0].text
    top_issues = _parse_json(raw_issues_text)
    if not isinstance(top_issues, list):
        logger.warning(
            "[propose_rules:%s] top_issues parse failed — raw: %s",
            state["session_id"][:8],
            raw_issues_text[:300],
        )
        top_issues = []

    ai_summary = state["overview_notes"] + "\n\n" + state["data_passport"][:1500]

    return {
        **state,
        "suggested_rules": rules,
        "top_issues": top_issues,
        "ai_summary": ai_summary,
    }


# Graph assembly
def build_profile_analyzer_graph():
    graph = StateGraph(ProfileAnalyzerState)

    graph.add_node("read_overview", read_overview_node)
    graph.add_node("investigate", investigate_node)
    graph.add_node("synthesize_understanding", synthesize_understanding_node)
    graph.add_node("propose_rules", propose_rules_node)

    graph.set_entry_point("read_overview")
    graph.add_edge("read_overview", "investigate")
    graph.add_edge("investigate", "synthesize_understanding")
    graph.add_edge("synthesize_understanding", "propose_rules")
    graph.add_edge("propose_rules", END)

    return graph.compile()


def run_profile_analyzer(
    session_id: str,
    use_case: str,
    target_column: str | None = None,
    description: str | None = None,
) -> dict:
    """Run the profile analyzer graph.

    Returns {ai_summary, suggested_rules, top_issues, data_passport}.
    profile.json must already exist on disk (written by dq_tools.profiler.profile_dataset).
    """
    app = build_profile_analyzer_graph()

    initial_state: ProfileAnalyzerState = {
        "session_id": session_id,
        "use_case": use_case,
        "target_column": target_column,
        "description": description,
        "overview_notes": "",
        "columns_to_investigate": [],
        "investigation_findings": "",
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": [],
        "top_issues": [],
    }

    try:
        result = app.invoke(initial_state)
        return {
            "ai_summary": result.get("ai_summary", ""),
            "suggested_rules": result.get("suggested_rules", []),
            "top_issues": result.get("top_issues", []),
            "data_passport": result.get("data_passport", ""),
        }
    except Exception as e:
        return {
            "ai_summary": f"Profile analysis encountered an error: {e}",
            "suggested_rules": [],
            "top_issues": [],
            "data_passport": "",
        }
