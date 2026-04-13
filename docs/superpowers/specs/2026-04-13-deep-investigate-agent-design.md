# Deep Investigation Agent — Design Spec

**Date:** 2026-04-13  
**Status:** Approved  
**Scope:** Replace the manual tool-calling loop in `ProfileAnalyzer`'s investigation phase with a `create_deep_agent` sub-graph, keeping the old node as deprecated rollback code.

---

## Problem

The existing `investigate_node` in `profile_analyzer.py` is a hand-rolled ReAct loop: it manually builds a messages array, calls the Anthropic SDK, extracts tool calls, dispatches them, and accumulates findings as concatenated text blocks. This works but is rigid — the agent cannot plan its investigation, track coverage, or delegate sub-investigations as datasets scale in column count and complexity.

## Goal

Swap in a `create_deep_agent`-backed node that:
- Manages the tool-calling loop via LangGraph's compiled graph (no manual message wiring)
- Uses `write_todos` to plan and track column coverage systematically
- Is structured to support subagents for deep-dives in future iterations
- Emits the same JSONL progress events the streaming UI already consumes
- Produces the same `investigation_findings` string that `synthesize_understanding_node` already reads — zero downstream changes

---

## Packages Required

The following must be present in `pyproject.toml` dependencies:

| Package | Version floor | Purpose |
|---|---|---|
| `deepagents` | `>=0.5.0` | `create_deep_agent` factory |
| `langchain` | `>=1.2.0` | `create_agent` (used internally by deepagents) |
| `langchain-anthropic` | `>=1.4.0` | `ChatAnthropic` model |

All three are already installed in the project venv as of this spec. `pyproject.toml` must be updated to record them.

---

## File Organization

```
backend/agents/graphs/
├── profile_analyzer.py      ← 3 targeted edits; all other logic untouched
├── deep_investigate.py      ← NEW: full deep agent implementation
└── ...
```

No other files change.

---

## `deep_investigate.py` — Full Specification

### `InvestigationContext`

A plain `dataclass` passed as `context_schema` to `create_deep_agent`. The framework injects an instance at invocation time; tools access it via `runtime.context`.

```python
@dataclass
class InvestigationContext:
    session_id: str
```

### DuckDB Tool Functions

Five plain Python functions — no `@tool` decorator needed. The `ToolRuntime` parameter is auto-injected and excluded from the tool schema sent to the model. Prefixed `dq_` to avoid name collision with `create_deep_agent`'s built-in tools (`grep`, `glob`, etc.).

Each function:
- Accepts its data parameters as `Annotated[type, "description"]` for schema generation
- Accepts `runtime: ToolRuntime[None, InvestigationContext]` as the final parameter
- Calls the existing `dq_tools.explorer` function with `runtime.context.session_id`
- Returns `json.dumps(result, default=str)` — string output, consistent with what Claude expects

| Tool name | Wraps |
|---|---|
| `dq_run_sql` | `dq_tools.explorer.run_sql` |
| `dq_get_value_counts` | `dq_tools.explorer.get_value_counts` |
| `dq_check_regex_pattern` | `dq_tools.explorer.check_regex_pattern` |
| `dq_get_sample_rows` | `dq_tools.explorer.get_sample_rows` |
| `dq_get_column_detail` | `dq_tools.explorer.get_column_detail` |

The `ToolRuntime` import path is resolved at implementation time from the installed `langgraph.prebuilt` or `deepagents` package.

### `_build_deep_investigate_agent()`

Private factory. Called once per node invocation. Returns a compiled `CompiledStateGraph`.

```python
def _build_deep_investigate_agent():
    from deepagents.graph import create_deep_agent
    from langchain_anthropic import ChatAnthropic

    return create_deep_agent(
        model=ChatAnthropic(model="claude-sonnet-4-6", max_tokens=8192),
        tools=[dq_run_sql, dq_get_value_counts, dq_check_regex_pattern,
               dq_get_sample_rows, dq_get_column_detail],
        system_prompt=PROFILE_INVESTIGATION_SYSTEM,  # existing prompt, unchanged
        context_schema=InvestigationContext,
        # No backend — built-in filesystem/execute tools have no execution
        # environment and fail gracefully; agent is directed to dq_* tools only
    )
```

No `subagents` parameter for this iteration — that is a planned follow-on once the basic loop is proven in production.

### `deep_investigate_node(state: ProfileAnalyzerState)`

The LangGraph-compatible node function. Importable by any graph.

**Steps:**
1. Clear leftover `investigation_progress.jsonl` (same as deprecated node)
2. Build agent via `_build_deep_investigate_agent()`
3. Construct `InvestigationContext(session_id=session_id)`
4. Build initial `HumanMessage` from state fields: `use_case`, `target_column`, `overview_notes`, `columns_to_investigate`. The message explicitly names the `dq_*` tools and instructs the agent to use `write_todos` for tracking column coverage.
5. Stream the agent with `stream_mode="values"` and `recursion_limit=120` (~60 tool-call rounds)
6. On each chunk: diff against previously seen message count, emit `"thinking"` events for new `AIMessage` content and `"tool_result"` events for new `ToolMessage` content
7. After stream exhaustion: emit `"done"` event with total message count
8. Extract `investigation_findings` from `final_state["messages"][-1].content`
9. Return `{**state, "investigation_findings": findings}`

**Config passed at invocation:**
```python
config = {
    "configurable": {"context": context},
    "recursion_limit": 120,
}
```

**Iteration budget:** `recursion_limit=120` gives ~60 tool-call rounds (each round = agent node + tools node = 2 graph hops). The old node had a hard cap of 25 iterations.

---

## `profile_analyzer.py` — Changes

Exactly three edits:

**1.** Add at top of imports:
```python
from backend.agents.graphs.deep_investigate import deep_investigate_node
```

**2.** Rename existing function and add deprecation header:
```python
# DEPRECATED — kept for rollback only. No logic changes.
# To revert: replace `deep_investigate_node` with `_investigate_node_deprecated`
# in the single add_node call in build_profile_analyzer_graph().
def _investigate_node_deprecated(state: ProfileAnalyzerState) -> ProfileAnalyzerState:
    # ... body identical to current investigate_node ...
```

**3.** In `build_profile_analyzer_graph()`, one line change:
```python
# Before:
graph.add_node("investigate", investigate_node)
# After:
graph.add_node("investigate", deep_investigate_node)
```

All other nodes, edges, and the `run_profile_analyzer` entry point are untouched.

---

## `pyproject.toml` — Changes

Add to `[project] dependencies`:
```toml
"deepagents>=0.5.0",
"langchain>=1.2.0",
"langchain-anthropic>=1.4.0",
```

---

## What Does NOT Change

| Component | Status |
|---|---|
| `PROFILE_INVESTIGATION_SYSTEM` prompt | Unchanged — passed directly as `system_prompt` |
| `ProfileAnalyzerState` TypedDict | Unchanged — `investigation_findings` field already exists |
| `synthesize_understanding_node` | Unchanged — consumes `investigation_findings` as before |
| `propose_rules_node` | Unchanged |
| `_emit` / `_progress_path` helpers | Unchanged — imported into `deep_investigate.py` |
| `EXPLORER_TOOLS` (Anthropic format) | Unchanged — still used by `TriageAgent` |
| `dq_tools.explorer` functions | Unchanged — wrapped, not replaced |
| Streaming UI / JSONL event format | Unchanged — same event types emitted |

---

## Rollback

One-line revert in `build_profile_analyzer_graph()`:
```python
graph.add_node("investigate", _investigate_node_deprecated)
```

No other changes needed. The deprecated function body is identical to the current implementation.

---

## Future Extensions (Out of Scope for This Spec)

- **Subagents**: Pass `subagents=[...]` to `create_deep_agent` to enable the main agent to delegate deep-dives on specific columns or relationships to isolated sub-investigations
- **Memory**: Pass `memory=[...]` to load domain-specific investigation patterns (e.g., HR dataset playbooks, financial data patterns) across sessions
- **Skills**: Pass `skills=[...]` to load investigation playbooks for different dataset domains
