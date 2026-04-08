"""TransformPlanner LangGraph agent — builds a full dependency-aware transform plan."""
from __future__ import annotations
import json
import re
from typing import TypedDict, Optional
import anthropic
from langgraph.graph import StateGraph, END

from backend.agents.emit import emit
from backend.agents.retry import call_claude_with_retry
from backend.agents.graphs.planning_tools import get_planning_tools_schema, execute_planning_tool
from dq_tools.transformation_executor import validate_transform_spec

MODEL = "claude-sonnet-4-6"
MAX_INVESTIGATION_TURNS = 12
MAX_FIX_ATTEMPTS = 3

TRANSFORM_PLANNER_SYSTEM = """You are a data quality transform planner. You have tool access to inspect the dataset.

Your job:
1. Investigate the failing rules and dataset to understand the data issues.
2. Build a complete, ordered, dependency-aware transform plan to fix all transform-fixable failures.
3. Use prebuilt transform types when possible: impute_constant, impute_mode, winsorize, deduplicate, type_cast, standardize_string, date_format_cast, null_invalid, filter_rows.
4. Use "custom" type only when no prebuilt fits.

For custom steps: provide intent, target_columns, and approach (plain English). Do NOT write code.
For prebuilt steps: provide full params that match the transform type's expected schema.

Step IDs: "step_1", "step_2", ... in execution order.
depends_on: list step IDs that must run before this step.
conflicts_with: list step IDs whose effects this step would undo.
projected_score_delta: estimated fractional quality score improvement (0.0–1.0).
"""

BUILD_PLAN_PROMPT = """Based on your investigation, output the complete transform plan as a JSON object:

{
  "steps": [
    {
      "id": "step_1",
      "type": "impute_constant",
      "column": "col_name",
      "params": {"column": "col_name", "value": 0},
      "rationale": "one sentence",
      "targets_rules": ["r1", "r2"],
      "depends_on": [],
      "conflicts_with": [],
      "projected_score_delta": 0.05
    }
  ],
  "summary": "One paragraph describing the plan.",
  "projected_final_score": 0.92
}

For custom steps omit params and add: "intent": "...", "target_columns": [...], "approach": "..."
Output ONLY the JSON object. No prose."""


class TransformPlannerState(TypedDict):
    session_id: str
    fixable_rules: list
    validation_results: dict
    profile: dict
    use_case: str
    transformation_log: list
    # Internal
    messages: list
    turn_count: int
    plan_steps: list
    plan_summary: str
    plan_projected_final_score: float
    # Output
    result: Optional[dict]


def _base_planner_state(
    session_id: str,
    fixable_rules: list,
    validation_results: dict,
    profile: dict,
    use_case: str,
    transformation_log: list,
) -> TransformPlannerState:
    return {
        "session_id": session_id,
        "fixable_rules": fixable_rules,
        "validation_results": validation_results,
        "profile": profile,
        "use_case": use_case,
        "transformation_log": transformation_log,
        "messages": [],
        "turn_count": 0,
        "plan_steps": [],
        "plan_summary": "",
        "plan_projected_final_score": 0.0,
        "result": None,
    }


def _parse_json(text: str):
    """Extract and parse JSON from a Claude response."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"```json\s*([\s\S]*?)```", text, re.IGNORECASE)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass
    for open_ch, close_ch in [("{", "}"), ("[", "]")]:
        start = text.find(open_ch)
        end = text.rfind(close_ch)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                continue
    return None


def _content_to_dicts(content) -> list[dict]:
    """Convert Anthropic ContentBlock objects to JSON-serialisable dicts."""
    result = []
    for block in content:
        if block.type == "text":
            result.append({"type": "text", "text": block.text})
        elif block.type == "tool_use":
            result.append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})
    return result


def _build_initial_messages(state: TransformPlannerState) -> list[dict]:
    fixable_rules = state["fixable_rules"]
    use_case = state["use_case"]
    profile_cols = list(state["profile"].get("columns", {}).keys())
    transformation_log = state["transformation_log"]

    content = f"""Use case: {use_case}

Transform-fixable failing rules to address:
```json
{json.dumps(fixable_rules, indent=2)}
```

Profile columns: {profile_cols}

Prior transformations (if any):
{json.dumps(transformation_log, indent=2) if transformation_log else "(none)"}

Investigate the dataset using the available tools to understand the data issues, then you will build the transform plan.
Start by exploring the failing columns and understanding the distribution of failures."""
    return [{"role": "user", "content": content}]


# ── Nodes ───────────────────────────────────────────────────────────────────

def investigate(state: TransformPlannerState) -> TransformPlannerState:
    """ReAct loop: use tools to investigate the dataset. Max 12 turns."""
    client = anthropic.Anthropic()
    session_id = state["session_id"]
    messages = state["messages"] if state["messages"] else _build_initial_messages(state)
    turn_count = state.get("turn_count", 0)

    while turn_count < MAX_INVESTIGATION_TURNS:
        response = call_claude_with_retry(
            client,
            model=MODEL,
            max_tokens=2000,
            system=TRANSFORM_PLANNER_SYSTEM,
            tools=get_planning_tools_schema(),
            messages=messages,
        )

        text_blocks = [b for b in response.content if b.type == "text"]
        if text_blocks:
            emit(session_id, "thinking", text=text_blocks[0].text[:300])

        messages = messages + [{"role": "assistant", "content": _content_to_dicts(response.content)}]

        if response.stop_reason != "tool_use":
            break

        tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
        tool_results = []
        for tu in tool_use_blocks:
            emit(session_id, "tool_call", tool=tu.name, input=tu.input)
            result_str = execute_planning_tool(tu.name, tu.input, session_id)
            emit(session_id, "tool_result", tool=tu.name, preview=result_str[:200])
            tool_results.append({"type": "tool_result", "tool_use_id": tu.id, "content": result_str})

        messages = messages + [{"role": "user", "content": tool_results}]
        turn_count += 1

    return {**state, "messages": messages, "turn_count": turn_count}


def build_plan(state: TransformPlannerState) -> TransformPlannerState:
    """Ask Claude to emit the full structured plan based on investigation."""
    client = anthropic.Anthropic()
    messages = list(state["messages"]) + [{"role": "user", "content": BUILD_PLAN_PROMPT}]

    response = call_claude_with_retry(
        client,
        model=MODEL,
        max_tokens=4000,
        system=TRANSFORM_PLANNER_SYSTEM,
        messages=messages,
    )
    raw = "".join(b.text for b in response.content if b.type == "text")
    parsed = _parse_json(raw)

    steps: list = []
    summary = ""
    projected_final_score = state["validation_results"].get("baseline_quality_score", 0.0)

    if isinstance(parsed, dict):
        steps = parsed.get("steps", [])
        summary = parsed.get("summary", "")
        projected_final_score = parsed.get("projected_final_score", projected_final_score)
    elif isinstance(parsed, list):
        steps = parsed

    # Sort by projected_score_delta descending, cap at 25
    steps.sort(key=lambda s: s.get("projected_score_delta", 0), reverse=True)
    steps = steps[:25]

    # Set required defaults
    for step in steps:
        step.setdefault("needs_review", False)
        step.setdefault("status", "pending")
        step.setdefault("actual_score_delta", None)
        step.setdefault("custom_code", None)
        step.setdefault("params", {})
        step.setdefault("depends_on", [])
        step.setdefault("conflicts_with", [])
        step.setdefault("targets_rules", [])

    return {**state, "plan_steps": steps, "plan_summary": summary, "plan_projected_final_score": projected_final_score}


def validate_and_fix_prebuilt(state: TransformPlannerState) -> TransformPlannerState:
    """Validate prebuilt step params against a real 50-row DuckDB sample. Fix or flag needs_review."""
    import duckdb
    import pandas as pd
    from dq_tools.profiler import _find_project_root

    session_id = state["session_id"]
    client = anthropic.Anthropic()
    steps = [dict(s) for s in state["plan_steps"]]
    profile = state["profile"]
    available_columns = list(profile.get("columns", {}).keys())

    # Fetch real sample from DuckDB
    sample_df = pd.DataFrame()
    try:
        db_path = str(_find_project_root() / "data" / "sessions" / session_id / "working.duckdb")
        with duckdb.connect(db_path, read_only=True) as conn:
            sample_df = conn.execute(
                "SELECT * FROM working_data ORDER BY RANDOM() LIMIT 50"
            ).df()
    except Exception:
        pass  # Fall back to empty DataFrame

    for step in steps:
        if step.get("type") == "custom":
            continue  # Custom steps validated at execution time

        attempts = 0
        while attempts < MAX_FIX_ATTEMPTS:
            _, error = validate_transform_spec(step, sample_df)
            if error is None:
                break

            fix_prompt = f"""A prebuilt transform spec failed validation:

Error: {error}

Current spec:
```json
{json.dumps({"type": step.get("type"), "params": step.get("params", {})}, indent=2)}
```

Available columns: {available_columns}

Fix the params. Output ONLY: {{"params": {{...}}}}"""

            try:
                response = call_claude_with_retry(
                    client,
                    model=MODEL,
                    max_tokens=500,
                    system=TRANSFORM_PLANNER_SYSTEM,
                    messages=[{"role": "user", "content": fix_prompt}],
                )
                raw = "".join(b.text for b in response.content if b.type == "text")
                parsed = _parse_json(raw)
                if isinstance(parsed, dict) and "params" in parsed:
                    step["params"] = parsed["params"]
            except Exception:
                pass

            attempts += 1

        # Final check after all fix attempts
        _, final_error = validate_transform_spec(step, sample_df)
        if final_error is not None:
            step["needs_review"] = True

    return {**state, "plan_steps": steps}


def finalize(state: TransformPlannerState) -> TransformPlannerState:
    """Assemble the final result dict."""
    emit(state["session_id"], "done", tool_calls=state.get("turn_count", 0))
    result = {
        "steps": state["plan_steps"],
        "summary": state["plan_summary"],
        "projected_final_score": state["plan_projected_final_score"],
    }
    return {**state, "result": result}


# ── Graph construction ───────────────────────────────────────────────────────

def _build_transform_planner_graph():
    graph = StateGraph(TransformPlannerState)
    graph.add_node("investigate", investigate)
    graph.add_node("build_plan", build_plan)
    graph.add_node("validate_and_fix_prebuilt", validate_and_fix_prebuilt)
    graph.add_node("finalize", finalize)
    graph.set_entry_point("investigate")
    graph.add_edge("investigate", "build_plan")
    graph.add_edge("build_plan", "validate_and_fix_prebuilt")
    graph.add_edge("validate_and_fix_prebuilt", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()


def run_transform_planner(
    session_id: str,
    fixable_rules: list[dict],
    validation_results: dict,
    profile: dict,
    use_case: str,
    transformation_log: list[dict],
) -> dict:
    """Run the TransformPlanner and return {steps, summary, projected_final_score}."""
    if not fixable_rules:
        return {
            "steps": [],
            "summary": "No transform-fixable rules to address.",
            "projected_final_score": validation_results.get("baseline_quality_score", 0.0),
        }

    app = _build_transform_planner_graph()
    initial_state = _base_planner_state(
        session_id=session_id,
        fixable_rules=fixable_rules,
        validation_results=validation_results,
        profile=profile,
        use_case=use_case,
        transformation_log=transformation_log,
    )
    try:
        final_state = app.invoke(initial_state)
    except anthropic.RateLimitError:
        raise
    except Exception:
        return {"steps": [], "summary": "Planning failed.", "projected_final_score": validation_results.get("baseline_quality_score", 0.0)}

    return final_state.get("result") or {"steps": [], "summary": "", "projected_final_score": 0.0}
