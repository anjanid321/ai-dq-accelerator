"""TransformPlanner LangGraph agent — builds a full dependency-aware transform plan."""
from __future__ import annotations
from typing import TypedDict, Optional
import anthropic
from langgraph.graph import StateGraph, END

from backend.agents.emit import emit
from backend.agents.graphs.deep_plan import deep_plan_node


MODEL = "claude-sonnet-4-6"


class TransformPlannerState(TypedDict):
    session_id: str
    fixable_rules: list
    validation_results: dict
    profile: dict
    use_case: str
    transformation_log: list
    # Output fields populated by deep_plan_node
    plan_steps: list
    plan_summary: str
    plan_projected_final_score: float
    # Final assembled result
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
        "plan_steps": [],
        "plan_summary": "",
        "plan_projected_final_score": 0.0,
        "result": None,
    }


def finalize(state: TransformPlannerState) -> TransformPlannerState:
    """Assemble the final result dict."""
    emit(state["session_id"], "done", tool_calls=0)
    result = {
        "steps": state["plan_steps"],
        "summary": state["plan_summary"],
        "projected_final_score": state["plan_projected_final_score"],
    }
    return {**state, "result": result}


def _build_transform_planner_graph():
    graph = StateGraph(TransformPlannerState)
    graph.add_node("deep_plan", deep_plan_node)
    graph.add_node("finalize", finalize)
    graph.set_entry_point("deep_plan")
    graph.add_edge("deep_plan", "finalize")
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
        return {
            "steps": [],
            "summary": "Planning failed.",
            "projected_final_score": validation_results.get("baseline_quality_score", 0.0),
        }

    return final_state.get("result") or {"steps": [], "summary": "", "projected_final_score": 0.0}
