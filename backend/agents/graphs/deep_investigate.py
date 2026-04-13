"""Deep investigation agent for ProfileAnalyzer.

Replaces the hand-rolled investigate_node with a create_deep_agent-backed
sub-graph. Session context flows to tools via ToolRuntime[None, InvestigationContext].

Import surface: deep_investigate_node (the LangGraph node function).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Optional

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.prebuilt import ToolRuntime

from backend.agents.emit import _find_project_root
from backend.agents.emit import emit as _emit
from backend.agents.prompts import PROFILE_INVESTIGATION_SYSTEM
from backend.agents.state import ProfileAnalyzerState
import dq_tools.explorer as _explorer

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
    runtime: ToolRuntime[None, InvestigationContext],
) -> str:
    """Run a read-only SQL SELECT query against the dataset."""
    result = _explorer.run_sql(runtime.context.session_id, sql)
    return json.dumps(result, default=str)


def dq_get_value_counts(
    column: Annotated[str, "Column name to analyse."],
    top_n: Annotated[int, "Number of top values to return. Default 20."] = 20,
    *,
    runtime: ToolRuntime[None, InvestigationContext],
) -> str:
    """Return the top-N frequency distribution of values in a column."""
    result = _explorer.get_value_counts(runtime.context.session_id, column, top_n)
    return json.dumps(result, default=str)


def dq_check_regex_pattern(
    column: Annotated[str, "Column name to test."],
    pattern: Annotated[str, "Python regex pattern to match against non-null values."],
    runtime: ToolRuntime[None, InvestigationContext],
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
    runtime: ToolRuntime[None, InvestigationContext],
) -> str:
    """Return sample rows from the dataset, optionally filtered by a WHERE clause."""
    result = _explorer.get_sample_rows(runtime.context.session_id, n=n, where_clause=where_clause)
    return json.dumps(result, default=str)


def dq_get_column_detail(
    column: Annotated[str, "Column name to retrieve full profiling stats for."],
    runtime: ToolRuntime[None, InvestigationContext],
) -> str:
    """Return full ydata-profiling statistics for a specific column."""
    result = _explorer.get_column_detail(runtime.context.session_id, column)
    return json.dumps(result, default=str)
