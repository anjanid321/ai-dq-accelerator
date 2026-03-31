import builtins
import json
import re
import anthropic
import numpy as np
import pandas as pd
from langgraph.graph import StateGraph, END

from backend.agents.emit import emit
from backend.agents.retry import call_claude_with_retry
from backend.agents.state import TransformationAdvisorState
from backend.agents.prompts import TRANSFORMATION_ADVISOR_SYSTEM

MODEL = "claude-sonnet-4-6"

# Use the full builtins module — the real security boundary is _UNSAFE_PATTERNS
# (blocks import, open, os, sys, subprocess, eval, exec).
# A curated subset just breaks legitimate pandas/numpy code.
_SAFE_BUILTINS = vars(builtins)

PREBUILT_TYPES = {
    "date_format_cast",
    "null_invalid",
    "filter_rows",
    "winsorize",
    "impute_constant",
    "impute_mode",
    "deduplicate",
    "type_cast",
    "standardize_string",
}

MAX_CUSTOM_CODE_ATTEMPTS = 3
MAX_PREBUILT_ATTEMPTS = 3

# Patterns that indicate unsafe custom code
_UNSAFE_PATTERNS = [
    r"\bimport\b",
    r"\bopen\s*\(",
    r"\bos\.",
    r"\bsys\.",
    r"\bsubprocess\b",
    r"\beval\s*\(",
    r"\bexec\s*\(",
    r"__import__",
    r"\bbuiltins\b",
]


def _parse_json(text: str):
    """Attempt to extract and parse JSON from a Claude response string.

    Strategy:
    1. Try json.loads directly.
    2. Extract content from a ```json ... ``` fenced code block.
    3. Slice from the first '[' or '{' to the last ']' or '}'.
    Returns the parsed object, or None on total failure.
    """
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
        end = text.rfind(close_ch if open_ch == "{" else "]")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue

    return None


def _extract_python_block(text: str) -> str | None:
    """Extract a Python function from a fenced code block or raw text."""
    # ```python ... ```
    match = re.search(r"```python\s*([\s\S]*?)```", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    # ``` ... ``` (no language tag)
    match = re.search(r"```\s*([\s\S]*?)```", text)
    if match:
        candidate = match.group(1).strip()
        if "def transform" in candidate:
            return candidate
    # Raw text containing def transform
    if "def transform" in text:
        return text.strip()
    return None


def _is_safe_custom_code(code: str) -> bool:
    """Return True if the code passes basic safety checks."""
    if not code:
        return False
    if "def transform" not in code:
        return False
    for pattern in _UNSAFE_PATTERNS:
        if re.search(pattern, code):
            return False
    return True


def _build_sample_df(profile: dict) -> pd.DataFrame:
    """Build a minimal 3-row DataFrame from profile columns for custom code dry-runs.

    Note: integer columns are built with a None value and will have dtype float64
    (standard pandas nullable behavior). This is intentional — it exercises null
    handling that transforms must be robust to. Use pd.isna() rather than int()
    casts when writing transform code.
    """
    columns = list(profile.get("columns", {}).keys())
    if not columns:
        return pd.DataFrame({"value": [1, 2, 3]})
    data: dict = {}
    for col in columns:
        dtype = profile["columns"].get(col, {}).get("type", "object")
        if dtype in ("int64", "int32", "integer", "int"):
            data[col] = [1, 2, None]   # → float64 due to None; intentional
        elif dtype in ("float64", "float32", "float", "double"):
            data[col] = [1.0, 2.5, None]
        elif dtype in ("datetime64[ns]", "datetime", "date"):
            data[col] = pd.to_datetime(["2024-01-01", "2024-01-02", None])
        else:
            data[col] = ["a", "b", None]
    return pd.DataFrame(data)


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

def assess_remaining_issues(state: TransformationAdvisorState) -> TransformationAdvisorState:
    """Node 1: Determine whether there are material remaining issues."""
    remaining_failures = state.get("remaining_failures", [])
    anomaly_report = state.get("anomaly_report", {})

    # Check for any rule with failures or eval errors
    has_rule_failures = any(
        f.get("failure_count", 0) > 0 or (not f.get("passed", True) and f.get("error"))
        for f in remaining_failures
    )

    # Check for critical anomalies
    has_critical_anomalies = len(anomaly_report.get("critical", [])) > 0

    done = not has_rule_failures and not has_critical_anomalies

    if not done:
        emit(state.get("session_id", ""), "thinking", text="Assessing remaining issues...")

    return {
        **state,
        "done": done,
        "suggestion": None,
        "custom_code": None,
        "custom_code_valid": False,
        "custom_code_error": None,
        "custom_code_attempts": 0,
        "prebuilt_error": None,
        "prebuilt_attempts": 0,
    }


def _route_after_assess(state: TransformationAdvisorState) -> str:
    """Conditional edge: go to END if done, otherwise select_next_transformation."""
    return END if state.get("done", False) else "select_next_transformation"


def select_next_transformation(state: TransformationAdvisorState) -> TransformationAdvisorState:
    """Node 2: Use Claude to pick the single best next transformation."""
    client = anthropic.Anthropic()

    remaining_failures = state.get("remaining_failures", [])
    anomaly_report = state.get("anomaly_report", {})
    transformation_log = state.get("transformation_log", [])
    current_score = state.get("current_score", 0.0)
    use_case = state.get("use_case", "general ML use case")
    profile = state.get("profile", {})

    # Build a compact summary of what has already been tried per (type, column)
    tried_combos: list[str] = []
    for entry in transformation_log:
        t = entry.get("type", "?")
        col = entry.get("params", {}).get("column") or entry.get("column") or "dataset"
        status = entry.get("status", "applied")
        delta = entry.get("score_delta", 0.0)
        regressions = entry.get("regressions", [])
        reg_note = ""
        if regressions:
            reg_cols = ", ".join(
                f'{r.get("rule_id","?")}({r.get("column") or "cross-col"}, {r.get("failure_count",0)} failures)'
                for r in regressions[:3]
            )
            reg_note = f" ⚠ REGRESSED: {reg_cols}"
        tried_combos.append(
            f"- {t} on '{col}': status={status}, score_delta={delta:+.4f}{reg_note}"
        )

    tried_section = "\n".join(tried_combos) if tried_combos else "(none yet)"

    # Collect all regressions across the log for the prompt
    all_regressions = [
        r for entry in transformation_log
        for r in entry.get("regressions", [])
    ]
    regression_section = ""
    if all_regressions:
        reg_summary = "\n".join(
            f"- {r.get('rule_id')}: {r.get('check')} on {r.get('column') or 'cross-col'} "
            f"({r.get('failure_count',0)} failures) — {(r.get('rationale','') or '')[:60]}"
            for r in all_regressions
        )
        regression_section = f"""
Rules REGRESSED by previous transforms (were passing, now failing — high priority to fix):
{reg_summary}
"""

    # Split failures vs errored rules for clarity
    actual_failures = [f for f in remaining_failures if f.get("failure_count", 0) > 0]
    errored_rules = [f for f in remaining_failures if f.get("error")]

    user_message = f"""Use case: {use_case}
Current data quality score: {current_score:.2%}

Previously attempted transformations — DO NOT suggest the same (type, column) combination again:
{tried_section}
{regression_section}
CRITICAL: If any REGRESSED rules are listed above, prioritize fixing them before addressing original failures.

Remaining rule failures (still failing after all transforms above):
```json
{json.dumps(actual_failures, indent=2)}
```

Rules that failed to evaluate (eval errors — may be addressable via custom transformation):
```json
{json.dumps(errored_rules, indent=2)}
```

Remaining anomalies:
```json
{json.dumps(anomaly_report.get("critical", []) + anomaly_report.get("warning", []), indent=2)}
```

Profile column list:
```json
{json.dumps(list(profile.get("columns", {}).keys()) if "columns" in profile else [], indent=2)}
```

Determine the single highest-impact NEXT transformation to apply.
CRITICAL: If a (type, column) combination was already attempted (see list above), you MUST choose a DIFFERENT type or a different column. Do not repeat what has already been tried.
If all material issues have been addressed or all reasonable approaches have been attempted, set "done": true.

Output ONLY a JSON object with this exact schema:
{{
  "done": false,
  "type": "<transformation_type>",
  "column": "<column or null>",
  "params": {{}},
  "rationale": "<one sentence>",
  "custom_code": null
}}

If there are genuinely no more material issues (or no new approaches remain), set "done": true and omit other fields.
Use only pre-built types (date_format_cast, null_invalid, filter_rows, winsorize, impute_constant, impute_mode, deduplicate, type_cast, standardize_string) unless none fits — then use "custom".
"""

    try:
        response = call_claude_with_retry(
            client,
            model=MODEL,
            max_tokens=1500,
            temperature=0,
            system=TRANSFORMATION_ADVISOR_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )
        raw = response.content[0].text
    except anthropic.RateLimitError:
        raise
    except Exception:
        # Safe fallback — mark as done to avoid infinite loop
        return {**state, "done": True, "suggestion": None}

    parsed = _parse_json(raw)

    if not isinstance(parsed, dict):
        return {**state, "done": True, "suggestion": None}

    if parsed.get("done", False):
        return {**state, "done": True, "suggestion": None}

    emit(
        state.get("session_id", ""),
        "thinking",
        text=f"Selected: {parsed.get('type')} on {parsed.get('column')} — {parsed.get('rationale', '')[:120]}",
    )

    return {
        **state,
        "done": False,
        "suggestion": parsed,
    }


def _route_after_select(state: TransformationAdvisorState) -> str:
    """Conditional edge: custom code path or prebuilt validation path."""
    suggestion = state.get("suggestion") or {}
    t_type = suggestion.get("type", "")
    if t_type == "custom":
        return "generate_custom_code"
    return "validate_prebuilt_params"


def generate_custom_code(state: TransformationAdvisorState) -> TransformationAdvisorState:
    """Node 3a: Ask Claude to write a safe Python transform function."""
    client = anthropic.Anthropic()

    suggestion = state.get("suggestion") or {}
    use_case = state.get("use_case", "general ML use case")
    profile = state.get("profile", {})

    rationale = suggestion.get("rationale", "Custom transformation required.")
    column = suggestion.get("column")

    emit(
        state.get("session_id", ""),
        "tool_call",
        tool="generate_custom_code",
        input={"rationale": rationale[:100]},
    )

    column_info = ""
    if column and "columns" in profile:
        col_data = profile["columns"].get(column, {})
        column_info = f"\nColumn '{column}' profile:\n```json\n{json.dumps(col_data, indent=2)}\n```"

    user_message = f"""Use case: {use_case}

Transformation required: {rationale}
Column: {column or "multiple / unspecified"}{column_info}

Write a Python function with exactly this signature:
    def transform(df: pd.DataFrame) -> pd.DataFrame:

Rules:
- pandas is available as `pd`, numpy as `np` — do NOT write any import statements
- Handle edge cases: empty DataFrame, unexpected nulls, wrong dtypes
- The function must return the transformed DataFrame
- Do not open files, access environment variables, use os/sys/subprocess

Output ONLY the Python function inside a ```python code block. No prose, no explanation.
"""

    try:
        response = call_claude_with_retry(
            client,
            model=MODEL,
            max_tokens=1500,
            temperature=0,
            system=TRANSFORMATION_ADVISOR_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )
        raw = response.content[0].text
    except anthropic.RateLimitError:
        raise
    except Exception:
        return {**state, "custom_code": None, "custom_code_valid": False}

    code = _extract_python_block(raw)

    return {
        **state,
        "custom_code": code,
    }


def validate_custom_code(state: TransformationAdvisorState) -> TransformationAdvisorState:
    """Node 3b: Safety-check AND dry-run the generated custom code."""
    code = state.get("custom_code")

    # Static safety check first — fast, no exec needed
    if not _is_safe_custom_code(code or ""):
        suggestion = dict(state.get("suggestion") or {})
        suggestion["custom_code"] = None
        return {
            **state,
            "custom_code_valid": False,
            "custom_code_error": "Code failed safety check (unsafe patterns or missing transform function)",
            "suggestion": suggestion,
        }

    # Runtime dry-run against a synthetic sample DataFrame
    profile = state.get("profile", {})
    sample_df = _build_sample_df(profile)
    error: str | None = None
    try:
        local_ns: dict = {}
        # Best-effort sandbox: strips builtins to catch accidental misuse.
        # Not adversarially secure — code originates from Claude, not user input.
        exec(code, {"pd": pd, "np": np, "__builtins__": _SAFE_BUILTINS}, local_ns)  # noqa: S102
        transform_fn = local_ns.get("transform")
        if not callable(transform_fn):
            error = "No callable 'transform' function found in code"
        else:
            result = transform_fn(sample_df.copy())
            if not isinstance(result, pd.DataFrame):
                error = f"transform() must return a DataFrame, got {type(result).__name__}"
    except Exception as exc:
        error = str(exc)

    valid = error is None
    suggestion = dict(state.get("suggestion") or {})
    suggestion["custom_code"] = code if valid else None

    emit(
        state.get("session_id", ""),
        "tool_result",
        tool="validate_custom_code",
        preview="valid" if valid else (error or "")[:120],
    )

    return {
        **state,
        "custom_code_valid": valid,
        "custom_code_error": error,
        "suggestion": suggestion,
    }


def fix_custom_code(state: TransformationAdvisorState) -> TransformationAdvisorState:
    """Node 3c: Send the failing code + error back to Claude for a fix."""
    client = anthropic.Anthropic()

    code = state.get("custom_code", "")
    error = state.get("custom_code_error") or "Unknown error"
    use_case = state.get("use_case", "general ML use case")
    attempts = state.get("custom_code_attempts", 0)

    suggestion = state.get("suggestion") or {}
    rationale = suggestion.get("rationale", "")

    user_message = f"""Use case: {use_case}
Transformation goal: {rationale}

The following Python transform function failed:

Error: {error}

Failing code:
```python
{code}
```

Fix the code. The function signature must be:
    def transform(df: pd.DataFrame) -> pd.DataFrame:

Rules:
- pandas available as `pd`, numpy as `np` — no import statements
- Handle edge cases: empty DataFrame, unexpected nulls, wrong dtypes
- Must return a DataFrame

Output ONLY the fixed function in a ```python code block. No prose."""

    try:
        response = call_claude_with_retry(
            client,
            model=MODEL,
            max_tokens=1500,
            temperature=0,
            system=TRANSFORMATION_ADVISOR_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )
        raw = response.content[0].text
        fixed_code = _extract_python_block(raw)
    except anthropic.RateLimitError:
        raise
    except Exception:
        # Must still increment attempts so the routing function can eventually
        # give up — without this the graph would loop forever on API failures.
        return {
            **state,
            "custom_code": None,
            "custom_code_valid": False,
            "custom_code_attempts": attempts + 1,
        }

    return {
        **state,
        "custom_code": fixed_code,
        "custom_code_attempts": attempts + 1,
    }


def _route_after_validate(state: TransformationAdvisorState) -> str:
    """Conditional edge after validate_custom_code."""
    if state.get("custom_code_valid"):
        return "format_suggestion"
    if state.get("custom_code_attempts", 0) < MAX_CUSTOM_CODE_ATTEMPTS:
        return "fix_custom_code"
    return "format_suggestion"  # give up — custom_code will be None in suggestion


def format_suggestion(state: TransformationAdvisorState) -> TransformationAdvisorState:
    """Node 4: Finalise the suggestion dict — ensure required keys are present."""
    suggestion = dict(state.get("suggestion") or {})

    # Ensure mandatory keys exist
    suggestion.setdefault("type", "custom")
    suggestion.setdefault("column", None)
    suggestion.setdefault("params", {})
    suggestion.setdefault("rationale", "")
    suggestion.setdefault("custom_code", None)

    # Remove the top-level 'done' key from the suggestion payload if present
    suggestion.pop("done", None)

    # Normalize: Claude puts `column` at the top level but all _apply_transform
    # handlers read it from params.  Always let the top-level column win —
    # the LLM sometimes puts a wrong placeholder (e.g. "value") in params.column.
    top_col = suggestion.get("column")
    if top_col:
        suggestion["params"]["column"] = top_col

    return {
        **state,
        "suggestion": suggestion,
    }


def validate_prebuilt_params(state: TransformationAdvisorState) -> TransformationAdvisorState:
    """Node 4b: Dry-run a prebuilt transform spec against a synthetic sample DataFrame."""
    from dq_tools.transformation_executor import validate_transform_spec

    suggestion = state.get("suggestion") or {}
    profile = state.get("profile", {})
    sample_df = _build_sample_df(profile)

    _, error = validate_transform_spec(suggestion, sample_df)
    return {
        **state,
        "prebuilt_error": error,
    }


def fix_prebuilt_params(state: TransformationAdvisorState) -> TransformationAdvisorState:
    """Node 4c: Ask Claude to correct the params of a failing prebuilt transform."""
    client = anthropic.Anthropic()

    suggestion = state.get("suggestion") or {}
    error = state.get("prebuilt_error") or "Unknown error"
    use_case = state.get("use_case", "general ML use case")
    profile = state.get("profile", {})
    attempts = state.get("prebuilt_attempts", 0)
    available_columns = list(profile.get("columns", {}).keys())

    user_message = f"""Use case: {use_case}

A prebuilt transformation spec failed validation:

Error: {error}

Current spec:
```json
{json.dumps({"type": suggestion.get("type"), "params": suggestion.get("params", {})}, indent=2)}
```

Available columns: {available_columns}

Fix the params so this transformation is valid. Output ONLY a JSON object:
{{
  "params": {{...corrected params...}}
}}

Keep the same transformation type ({suggestion.get("type")}). Only fix the params."""

    try:
        response = call_claude_with_retry(
            client,
            model=MODEL,
            max_tokens=500,
            temperature=0,
            system=TRANSFORMATION_ADVISOR_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )
        raw = response.content[0].text
        parsed = _parse_json(raw)
        if isinstance(parsed, dict) and "params" in parsed:
            fixed_suggestion = {**suggestion, "params": parsed["params"]}
        else:
            fixed_suggestion = suggestion
    except anthropic.RateLimitError:
        raise
    except Exception:
        # Must increment attempts even on failure so routing can eventually give up
        return {
            **state,
            "prebuilt_attempts": attempts + 1,
        }

    return {
        **state,
        "suggestion": fixed_suggestion,
        "prebuilt_attempts": attempts + 1,
    }


def _route_after_prebuilt_validate(state: TransformationAdvisorState) -> str:
    """Conditional edge after validate_prebuilt_params."""
    if state.get("prebuilt_error") is None:
        return "format_suggestion"
    if state.get("prebuilt_attempts", 0) < MAX_PREBUILT_ATTEMPTS:
        return "fix_prebuilt_params"
    return "format_suggestion"  # give up — suggestion surfaced as-is


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def build_transformation_advisor_graph():
    """Build and return the compiled TransformationAdvisor graph."""
    graph = StateGraph(TransformationAdvisorState)

    graph.add_node("assess_remaining_issues", assess_remaining_issues)
    graph.add_node("select_next_transformation", select_next_transformation)
    graph.add_node("generate_custom_code", generate_custom_code)
    graph.add_node("validate_custom_code", validate_custom_code)
    graph.add_node("fix_custom_code", fix_custom_code)
    graph.add_node("validate_prebuilt_params", validate_prebuilt_params)
    graph.add_node("fix_prebuilt_params", fix_prebuilt_params)             # NEW
    graph.add_node("format_suggestion", format_suggestion)

    graph.set_entry_point("assess_remaining_issues")

    graph.add_conditional_edges(
        "assess_remaining_issues",
        _route_after_assess,
        {END: END, "select_next_transformation": "select_next_transformation"},
    )
    graph.add_conditional_edges(
        "select_next_transformation",
        _route_after_select,
        {"generate_custom_code": "generate_custom_code", "validate_prebuilt_params": "validate_prebuilt_params"},
    )
    graph.add_edge("generate_custom_code", "validate_custom_code")
    graph.add_conditional_edges(
        "validate_custom_code",
        _route_after_validate,
        {"fix_custom_code": "fix_custom_code", "format_suggestion": "format_suggestion"},
    )
    graph.add_edge("fix_custom_code", "validate_custom_code")

    # Prebuilt validation + fix loop (replaces direct edge from Task 2)
    graph.add_conditional_edges(
        "validate_prebuilt_params",
        _route_after_prebuilt_validate,
        {"fix_prebuilt_params": "fix_prebuilt_params", "format_suggestion": "format_suggestion"},
    )
    graph.add_edge("fix_prebuilt_params", "validate_prebuilt_params")  # loop back

    graph.add_edge("format_suggestion", END)

    return graph.compile()


def run_transformation_advisor(
    session_id: str,
    remaining_failures: list[dict],
    anomaly_report: dict,
    transformation_log: list[dict],
    current_score: float,
    use_case: str,
    profile: dict,
) -> dict:
    """Run the transformation advisor graph and return {done: bool, suggestion: dict | None}."""
    app = build_transformation_advisor_graph()

    initial_state: TransformationAdvisorState = {
        "session_id": session_id,
        "remaining_failures": remaining_failures,
        "anomaly_report": anomaly_report,
        "transformation_log": transformation_log,
        "current_score": current_score,
        "use_case": use_case,
        "profile": profile,
        # Outputs
        "done": False,
        "suggestion": None,
        "custom_code": None,
        "custom_code_valid": False,
        "custom_code_error": None,
        "custom_code_attempts": 0,
        "prebuilt_error": None,
        "prebuilt_attempts": 0,
    }

    try:
        final_state = app.invoke(initial_state)
    except anthropic.RateLimitError:
        raise
    except Exception:
        return {"done": True, "suggestion": None}

    result = {
        "done": final_state.get("done", True),
        "suggestion": final_state.get("suggestion"),
    }
    if result["done"]:
        emit(session_id, "done", tool_calls=1)
    return result
