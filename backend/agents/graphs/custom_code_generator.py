"""CustomCodeGenerator — generates and validates Python transform code for custom steps."""
from __future__ import annotations
import builtins
import json
import re
import numpy as np
import pandas as pd
import anthropic

from backend.agents.emit import emit
from backend.agents.retry import call_claude_with_retry
from backend.agents.graphs.planning_tools import get_planning_tools_schema, execute_planning_tool

MODEL = "claude-sonnet-4-6"
MAX_ATTEMPTS = 3

_UNSAFE_PATTERNS = [
    r"\bimport\b", r"\bopen\s*\(", r"\bos\.", r"\bsys\.", r"\bsubprocess\b",
    r"\beval\s*\(", r"\bexec\s*\(", r"__import__", r"\bbuiltins\b",
]
_SAFE_BUILTINS = vars(builtins)

CUSTOM_CODE_SYSTEM = """You are a Python data transform writer. Write clean, safe pandas transform functions.

Rules:
- Function signature: def transform(df: pd.DataFrame) -> pd.DataFrame:
- pandas is available as `pd`, numpy as `np` — no import statements
- Handle edge cases: empty DataFrame, nulls, wrong dtypes
- No file I/O, os, sys, subprocess, eval, exec, or import statements
"""


def _content_to_dicts(content) -> list[dict]:
    result = []
    for block in content:
        if block.type == "text":
            result.append({"type": "text", "text": block.text})
        elif block.type == "tool_use":
            result.append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})
    return result


def _extract_python_block(text: str) -> str | None:
    match = re.search(r"```python\s*([\s\S]*?)```", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    match = re.search(r"```\s*([\s\S]*?)```", text)
    if match:
        candidate = match.group(1).strip()
        if "def transform" in candidate:
            return candidate
    if "def transform" in text:
        return text.strip()
    return None


def _is_safe(code: str) -> bool:
    if not code or "def transform" not in code:
        return False
    return not any(re.search(p, code) for p in _UNSAFE_PATTERNS)


def _dry_run(code: str, sample_df: pd.DataFrame) -> str | None:
    """Returns None if valid, error string if invalid."""
    try:
        local_ns: dict = {}
        exec(code, {"pd": pd, "np": np, "__builtins__": _SAFE_BUILTINS}, local_ns)  # noqa: S102
        fn = local_ns.get("transform")
        if not callable(fn):
            return "No callable 'transform' function found"
        result = fn(sample_df.copy())
        if not isinstance(result, pd.DataFrame):
            return f"transform() must return DataFrame, got {type(result).__name__}"
        return None
    except Exception as exc:
        return str(exc)


def _investigate_context(session_id: str, step: dict) -> list[dict]:
    """Run a quick tool-based investigation to understand current data state."""
    client = anthropic.Anthropic()
    target_cols = step.get("target_columns") or ([step["column"]] if step.get("column") else [])

    messages = [{"role": "user", "content": (
        f"I need to write a custom transform. "
        f"Intent: {step.get('intent', '')}. "
        f"Target columns: {target_cols}. "
        f"Please inspect the current state of these columns before I write the code. "
        f"Use 1-2 tool calls to understand the data."
    )}]

    for _ in range(3):
        response = call_claude_with_retry(
            client, model=MODEL, max_tokens=1000,
            system=CUSTOM_CODE_SYSTEM,
            tools=get_planning_tools_schema(),
            messages=messages,
        )
        messages.append({"role": "assistant", "content": _content_to_dicts(response.content)})
        if response.stop_reason != "tool_use":
            break
        tool_results = []
        for tu in [b for b in response.content if b.type == "tool_use"]:
            emit(session_id, "tool_call", tool=tu.name, input=tu.input)
            result = execute_planning_tool(tu.name, tu.input, session_id)
            emit(session_id, "tool_result", tool=tu.name, preview=result[:200])
            tool_results.append({"type": "tool_result", "tool_use_id": tu.id, "content": result})
        messages.append({"role": "user", "content": tool_results})

    return messages


def run_custom_code_generator(
    session_id: str,
    step: dict,
    prior_context: str,
    human_instruction: str | None,
) -> dict:
    """Generate and validate a Python transform function for a custom step.

    Returns: {custom_code: str | None, validation_passed: bool}
    """
    client = anthropic.Anthropic()
    emit(session_id, "thinking", text=f"Generating code for {step.get('id')}: {step.get('intent', '')[:100]}")

    # Investigate current data state using tools
    investigation_messages = _investigate_context(session_id, step)

    # Build the sample DataFrame for dry-runs using DuckDB
    sample_df = pd.DataFrame()
    try:
        import duckdb
        from dq_tools.profiler import _find_project_root
        db_path = str(_find_project_root() / "data" / "sessions" / session_id / "working.duckdb")
        with duckdb.connect(db_path, read_only=True) as conn:
            sample_df = conn.execute("SELECT * FROM working_data ORDER BY RANDOM() LIMIT 50").df()
    except Exception:
        pass

    code: str | None = None
    error: str | None = None

    for attempt in range(MAX_ATTEMPTS):
        if attempt == 0:
            # First attempt: generate from investigation context
            prior_str = f"\nPrior execution context: {prior_context}" if prior_context else ""
            instruction_str = f"\n\nEngineer instruction: {human_instruction}" if human_instruction else ""
            generate_prompt = (
                f"Step intent: {step.get('intent', '')}\n"
                f"Target columns: {step.get('target_columns', [])}\n"
                f"Approach: {step.get('approach', '')}"
                f"{prior_str}{instruction_str}\n\n"
                "Write the Python transform function. Output ONLY the function in a ```python block."
            )
            messages = investigation_messages + [{"role": "user", "content": generate_prompt}]
        else:
            # Fix attempt
            messages = [{"role": "user", "content": (
                f"Step intent: {step.get('intent', '')}\n"
                f"The following code failed:\nError: {error}\n\n```python\n{code}\n```\n\n"
                "Fix it. Output ONLY the fixed function in a ```python block."
            )}]

        try:
            response = call_claude_with_retry(
                client, model=MODEL, max_tokens=1500, system=CUSTOM_CODE_SYSTEM, messages=messages,
            )
            raw = "".join(b.text for b in response.content if b.type == "text")
            code = _extract_python_block(raw)
        except anthropic.RateLimitError:
            raise
        except Exception:
            continue

        if not _is_safe(code or ""):
            error = "Code failed safety check (unsafe pattern or missing transform function)"
            emit(session_id, "tool_result", tool="validate_custom_code", preview=f"attempt {attempt+1}: {error}")
            continue

        error = _dry_run(code, sample_df) if not sample_df.empty else None
        emit(session_id, "tool_result", tool="validate_custom_code",
             preview=f"attempt {attempt+1}: {'valid' if error is None else error[:120]}")

        if error is None:
            return {"custom_code": code, "validation_passed": True}

    return {"custom_code": None, "validation_passed": False}
