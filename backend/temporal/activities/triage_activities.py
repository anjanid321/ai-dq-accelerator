"""Temporal activity wrapping the triage agent."""
from temporalio import activity
import asyncio
from functools import partial


@activity.defn
async def triage_rules_activity(params: dict) -> dict:
    """
    params: {session_id, failing_rules, use_case}
    Returns: {classifications, summary}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_triage_rules_sync, params))


def _triage_rules_sync(params: dict) -> dict:
    from backend.agents.graphs.triage_agent import run_triage_agent
    return run_triage_agent(
        session_id=params["session_id"],
        failing_rules=params["failing_rules"],
        use_case=params.get("use_case", ""),
    )
