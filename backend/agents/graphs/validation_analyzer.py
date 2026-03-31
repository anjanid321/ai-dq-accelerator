import json
import re

import anthropic
from langgraph.graph import END, StateGraph

from backend.agents.emit import emit
from backend.agents.retry import call_claude_with_retry
from backend.agents.prompts import VALIDATION_ANALYZER_SYSTEM
from backend.agents.state import ValidationAnalyzerState

MODEL = "claude-sonnet-4-6"


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

    for open_ch, close_ch in [("[", "]"), ("{", "}")]:
        start = text.find(open_ch)
        end = text.rfind(close_ch)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue

    return None


def analyze_validation(state: ValidationAnalyzerState) -> ValidationAnalyzerState:
    """
    Node 1: Explain each rule failure in plain English
    """
    client = anthropic.Anthropic()
    session_id = state.get("session_id", "")

    emit(session_id, "thinking", text="Analyzing validation failures...")

    validation_results = state.get("validation_results", {})
    use_case = state.get("use_case", "general ML use case")

    # Summarise failures for the prompt — avoid sending huge per-row data
    per_rule = validation_results.get("per_rule", [])
    failures = [r for r in per_rule if r.get("failure_count", 0) > 0]
    overall = {
        "overall_score": validation_results.get("overall_score"),
        "total_rules": validation_results.get("total_rules"),
        "passed": validation_results.get("passed"),
        "failed": validation_results.get("failed"),
        "total_rows": validation_results.get("total_rows"),
    }

    user_message = f"""Use case: {use_case}

Overall validation summary:
```json
{json.dumps(overall, indent=2)}
```

Rule failures (rules where failure_count > 0):
```json
{json.dumps(failures, indent=2)}
```

Please explain each rule failure in plain English. For each failed rule describe:
- What went wrong (which column, what check failed)
- How many rows were affected
- Why this matters for the ML use case

Write as a clear, numbered prose explanation. Label this section "VALIDATION SUMMARY:" at the top.
"""

    try:
        response = call_claude_with_retry(client,
            model=MODEL,
            max_tokens=2000,
            temperature=0.3,
            system=VALIDATION_ANALYZER_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )
        raw = response.content[0].text
    except Exception as e:
        raw = f"Validation analysis failed: {e}"

    # Strip optional section header
    validation_summary = re.sub(r"(?i)^VALIDATION SUMMARY:\s*", "", raw.strip(), count=1).strip()

    emit(session_id, "tool_result", tool="analyze_validation", preview=validation_summary[:120])

    return {
        **state,
        "validation_summary": validation_summary,
    }


def analyze_anomalies(state: ValidationAnalyzerState) -> ValidationAnalyzerState:
    """Node 2: Interpret anomaly detection patterns."""
    client = anthropic.Anthropic()
    session_id = state.get("session_id", "")

    emit(session_id, "thinking", text="Analyzing anomalies...")

    anomaly_report = state.get("anomaly_report", {})
    use_case = state.get("use_case", "general ML use case")
    validation_summary = state.get("validation_summary", "")

    user_message = f"""Use case: {use_case}

Validation summary (already produced):
{validation_summary}

Anomaly detection report:
```json
{json.dumps(anomaly_report, indent=2)}
```

Analyse the anomaly report and explain:
1. What patterns the anomalies reveal about the dataset's data quality
2. Which anomalies are most likely to harm ML model training
3. Whether the anomalies correlate with the rule failures already identified

Label this section "ANOMALY SUMMARY:" at the top. Write in 2-3 clear paragraphs.
"""

    try:
        response = call_claude_with_retry(client,
            model=MODEL,
            max_tokens=1500,
            temperature=0.3,
            system=VALIDATION_ANALYZER_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )
        raw = response.content[0].text
    except Exception as e:
        raw = f"Anomaly analysis failed: {e}"

    anomaly_summary = re.sub(r"(?i)^ANOMALY SUMMARY:\s*", "", raw.strip(), count=1).strip()

    emit(session_id, "tool_result", tool="analyze_anomalies", preview=anomaly_summary[:120])

    return {
        **state,
        "anomaly_summary": anomaly_summary,
    }


def prioritize_transformations(state: ValidationAnalyzerState) -> ValidationAnalyzerState:
    """Node 3: Output an ordered transformation queue."""
    client = anthropic.Anthropic()
    session_id = state.get("session_id", "")

    emit(session_id, "thinking", text="Building transformation queue...")

    validation_results = state.get("validation_results", {})
    anomaly_report = state.get("anomaly_report", {})
    use_case = state.get("use_case", "general ML use case")
    validation_summary = state.get("validation_summary", "")
    anomaly_summary = state.get("anomaly_summary", "")
    profile = state.get("profile", {})

    per_rule = validation_results.get("per_rule", [])
    failures = [r for r in per_rule if r.get("failure_count", 0) > 0]

    user_message = f"""Use case: {use_case}

Validation summary:
{validation_summary}

Anomaly summary:
{anomaly_summary}

Rule failures:
```json
{json.dumps(failures, indent=2)}
```

Anomaly report:
```json
{json.dumps(anomaly_report, indent=2)}
```

Dataset profile columns (for context):
```json
{json.dumps(list(profile.get("columns", {}).keys()) if "columns" in profile else [], indent=2)}
```

Generate a prioritized transformation queue — an ordered list of transformations from highest to lowest impact on ML-readiness.

Output ONLY a JSON array. Each element must follow this schema exactly:
{{
  "type": "<transformation_type>",
  "column": "<column_name or null>",
  "params": {{}},
  "rationale": "<one sentence>",
  "estimated_score_delta": <float between 0.0 and 1.0>,
  "priority": <integer starting at 1>
}}

Use only these transformation types: date_format_cast, null_invalid, filter_rows, winsorize, impute_constant, impute_mode, deduplicate, type_cast, standardize_string, custom

Output only the JSON array, no prose.
"""

    try:
        response = call_claude_with_retry(client,
            model=MODEL,
            max_tokens=3000,
            temperature=0,
            system=VALIDATION_ANALYZER_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )
        raw = response.content[0].text
    except Exception as e:
        raw = "[]"

    parsed = _parse_json(raw)

    if isinstance(parsed, list):
        queue = [t for t in parsed if isinstance(t, dict)]
    elif isinstance(parsed, dict) and "transformations" in parsed:
        queue = [t for t in parsed["transformations"] if isinstance(t, dict)]
    else:
        queue = []

    # Ensure priority field is set and list is sorted
    for i, item in enumerate(queue, start=1):
        if "priority" not in item:
            item["priority"] = i
    queue.sort(key=lambda x: x.get("priority", 999))

    emit(session_id, "done", tool_calls=3)

    return {
        **state,
        "transformation_queue": queue,
    }


def build_validation_analyzer_graph():
    """Build and return the compiled ValidationAnalyzer graph."""
    graph = StateGraph(ValidationAnalyzerState)

    graph.add_node("analyze_validation", analyze_validation)
    graph.add_node("analyze_anomalies", analyze_anomalies)
    graph.add_node("prioritize_transformations", prioritize_transformations)

    graph.set_entry_point("analyze_validation")
    graph.add_edge("analyze_validation", "analyze_anomalies")
    graph.add_edge("analyze_anomalies", "prioritize_transformations")
    graph.add_edge("prioritize_transformations", END)

    return graph.compile()


def run_validation_analyzer(
    session_id: str,
    validation_results: dict,
    anomaly_report: dict,
    profile: dict,
    use_case: str,
) -> dict:
    """Run the validation analyzer graph and return {validation_summary, anomaly_summary, transformation_queue}."""
    app = build_validation_analyzer_graph()

    initial_state: ValidationAnalyzerState = {
        "session_id": session_id,
        "validation_results": validation_results,
        "anomaly_report": anomaly_report,
        "profile": profile,
        "use_case": use_case,
        # Outputs
        "validation_summary": "",
        "anomaly_summary": "",
        "transformation_queue": [],
    }

    try:
        final_state = app.invoke(initial_state)
    except Exception as e:
        return {
            "validation_summary": f"Validation analysis failed: {e}",
            "anomaly_summary": "",
            "transformation_queue": [],
        }

    return {
        "validation_summary": final_state.get("validation_summary", ""),
        "anomaly_summary": final_state.get("anomaly_summary", ""),
        "transformation_queue": final_state.get("transformation_queue", []),
    }
