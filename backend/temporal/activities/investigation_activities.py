"""Activities for the investigation split: investigate, synthesize, and re-investigate.

Replaces the monolithic profile_and_analyze_activity with three focused activities:

- profile_and_investigate_activity: profile + investigate + structure findings + generate notebook
- synthesize_and_propose_activity: synthesize understanding + propose rules
- reinvestigate_activity: targeted re-investigation with prior context + regenerate notebook
"""
from __future__ import annotations

import asyncio
from functools import partial

from temporalio import activity


@activity.defn
async def profile_and_investigate_activity(params: dict) -> dict:
    """
    params: {session_id, use_case, target_column, description}
    Returns: {exploration_findings, investigation_findings, overview_notes,
              columns_to_investigate, notebook_path, html_path}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_profile_and_investigate_sync, params))


def _profile_and_investigate_sync(params: dict) -> dict:
    from dq_tools.profiler import profile_dataset
    from backend.agents.graphs.profile_analyzer import (
        read_overview_node,
        structure_findings_node,
    )
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    from backend.agents.graphs.exploration_notebook import generate_exploration_notebook

    session_id = params["session_id"]
    profile_dataset(session_id)

    state = {
        "session_id": session_id,
        "use_case": params.get("use_case", ""),
        "target_column": params.get("target_column"),
        "description": params.get("description"),
        "overview_notes": "",
        "columns_to_investigate": [],
        "investigation_findings": "",
        "cross_column_findings": [],
        "exploration_findings": {},
        "exploration_notebook_path": "",
        "investigation_feedback": None,
        "investigation_round": 0,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": [],
        "top_issues": [],
    }

    state = read_overview_node(state)
    state = deep_investigate_node(state)
    state = structure_findings_node(state)

    notebook_path, html_path = generate_exploration_notebook(
        session_id=session_id,
        exploration_findings=state["exploration_findings"],
        investigation_findings=state["investigation_findings"],
    )

    return {
        "exploration_findings": state["exploration_findings"],
        "investigation_findings": state["investigation_findings"],
        "overview_notes": state["overview_notes"],
        "columns_to_investigate": state["columns_to_investigate"],
        "notebook_path": notebook_path,
        "html_path": html_path,
    }


@activity.defn
async def synthesize_and_propose_activity(params: dict) -> dict:
    """
    params: {session_id, use_case, target_column, description, investigation_findings,
             exploration_findings, overview_notes, columns_to_investigate,
             synthesis_constrained, synthesis_constraint_reasons}
    Returns: {profile, ai_summary, suggested_rules, top_issues}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_synthesize_and_propose_sync, params))


def _synthesize_and_propose_sync(params: dict) -> dict:
    from backend.agents.graphs.profile_analyzer import (
        synthesize_understanding_node,
        propose_rules_node,
        _load_profile_summary,
    )

    session_id = params["session_id"]

    state = {
        "session_id": session_id,
        "use_case": params.get("use_case", ""),
        "target_column": params.get("target_column"),
        "description": params.get("description"),
        "overview_notes": params.get("overview_notes", ""),
        "columns_to_investigate": params.get("columns_to_investigate", []),
        "investigation_findings": params["investigation_findings"],
        "cross_column_findings": params.get("exploration_findings", {}).get("cross_column_findings", []),
        "exploration_findings": params.get("exploration_findings", {}),
        "exploration_notebook_path": "",
        "investigation_feedback": None,
        "investigation_round": 0,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": [],
        "top_issues": [],
    }

    # Prepend constraint warning to guide synthesis if investigation was not approved
    if params.get("synthesis_constrained") and params.get("synthesis_constraint_reasons"):
        reasons = "\n".join(f"- {r}" for r in params["synthesis_constraint_reasons"])
        constraint_preamble = (
            f"\n\nNOTE: The investigation review was not fully approved by the user. "
            f"The following questions remain unresolved:\n{reasons}\n"
            f"Propose rules conservatively — flag any rule whose correctness depends "
            f"on an unresolved question."
        )
        state["investigation_findings"] = state["investigation_findings"] + constraint_preamble

    state = synthesize_understanding_node(state)
    state = propose_rules_node(state)

    profile_summary = _load_profile_summary(session_id)

    # If constrained, prepend a visible warning to ai_summary
    ai_summary = state.get("ai_summary", "")
    if params.get("synthesis_constrained"):
        reasons = params.get("synthesis_constraint_reasons", [])
        warning = (
            "⚠️ CONSTRAINED SYNTHESIS: The exploration review was not fully approved. "
            f"Unresolved questions: {'; '.join(reasons)}. "
            "Review rules carefully — some may reflect unconfirmed assumptions.\n\n"
        )
        ai_summary = warning + ai_summary

    return {
        "profile": profile_summary,
        "ai_summary": ai_summary,
        "suggested_rules": state.get("suggested_rules", []),
        "top_issues": state.get("top_issues", []),
    }


@activity.defn
async def reinvestigate_activity(params: dict) -> dict:
    """
    params: {session_id, use_case, target_column, overview_notes,
             columns_to_investigate, exploration_findings, investigation_findings,
             feedback_message, investigation_round}
    Returns: {exploration_findings, investigation_findings, notebook_path, html_path}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_reinvestigate_sync, params))


def _reinvestigate_sync(params: dict) -> dict:
    from backend.agents.graphs.deep_investigate import deep_investigate_node
    from backend.agents.graphs.profile_analyzer import structure_findings_node
    from backend.agents.graphs.exploration_notebook import generate_exploration_notebook

    session_id = params["session_id"]
    investigation_round = params["investigation_round"]

    state = {
        "session_id": session_id,
        "use_case": params.get("use_case", ""),
        "target_column": params.get("target_column"),
        "description": None,
        "overview_notes": params.get("overview_notes", ""),
        "columns_to_investigate": params.get("columns_to_investigate", []),
        "investigation_findings": params["investigation_findings"],
        "cross_column_findings": [],
        "exploration_findings": params["exploration_findings"],
        "exploration_notebook_path": "",
        "investigation_feedback": params["feedback_message"],
        "investigation_round": investigation_round,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": [],
        "top_issues": [],
    }

    state = deep_investigate_node(state)
    state = structure_findings_node(state)

    notebook_path, html_path = generate_exploration_notebook(
        session_id=session_id,
        exploration_findings=state["exploration_findings"],
        investigation_findings=state["investigation_findings"],
    )

    return {
        "exploration_findings": state["exploration_findings"],
        "investigation_findings": state["investigation_findings"],
        "notebook_path": notebook_path,
        "html_path": html_path,
    }


@activity.defn
async def review_rules_activity(params: dict) -> dict:
    """
    params: {session_id, suggested_rules, exploration_findings, use_case}
    Returns: {suggested_rules, rule_revision_log}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_review_rules_sync, params))


def _review_rules_sync(params: dict) -> dict:
    from backend.agents.graphs.deep_rule_review import deep_rule_review_node

    session_id = params["session_id"]

    state = {
        "session_id": session_id,
        "use_case": params.get("use_case", ""),
        "target_column": None,
        "description": None,
        "overview_notes": "",
        "columns_to_investigate": [],
        "investigation_findings": "",
        "cross_column_findings": [],
        "exploration_findings": params.get("exploration_findings", {}),
        "exploration_notebook_path": "",
        "investigation_feedback": None,
        "investigation_round": 0,
        "data_passport": "",
        "ai_summary": "",
        "suggested_rules": params["suggested_rules"],
        "top_issues": [],
        "rule_revision_log": [],
    }

    state = deep_rule_review_node(state)

    return {
        "suggested_rules": state["suggested_rules"],
        "rule_revision_log": state.get("rule_revision_log", []),
    }
