import json

import anthropic
from langgraph.graph import END, StateGraph

from backend.agents.emit import emit
from backend.agents.prompts import SCORECARD_NARRATOR_SYSTEM
from backend.agents.retry import call_claude_with_retry
from backend.agents.state import ScorecardNarratorState

MODEL = "claude-sonnet-4-6"


def write_narrative(state: ScorecardNarratorState) -> ScorecardNarratorState:
    """Single node: generate an executive narrative from the scorecard."""
    client = anthropic.Anthropic()
    session_id = state.get("session_id", "")

    emit(session_id, "thinking", text="Writing executive narrative...")

    scorecard = state.get("scorecard", {})
    transformation_log = state.get("transformation_log", [])
    baseline_score = state.get("baseline_score", 0.0)
    use_case = state.get("use_case", "general ML use case")

    final_score = scorecard.get("overall_score", scorecard.get("score", None))
    score_display = f"{final_score:.2%}" if isinstance(final_score, float) else str(final_score)
    baseline_display = f"{baseline_score:.2%}"

    user_message = f"""Use case: {use_case}

Baseline data quality score: {baseline_display}
Final data quality score: {score_display}

Final scorecard:
```json
{json.dumps(scorecard, indent=2)}
```

Transformation log (all transformations applied in order):
```json
{json.dumps(transformation_log, indent=2)}
```

Write a 3-4 paragraph executive summary of this data quality improvement session.
Do not use bullet points — write entirely in prose.
Use specific numbers from the scorecard and transformation log.
"""

    try:
        response = call_claude_with_retry(
            client,
            model=MODEL,
            max_tokens=1500,
            temperature=0.3,
            system=SCORECARD_NARRATOR_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )
        narrative = response.content[0].text.strip()
        emit(session_id, "done", tool_calls=1)
    except anthropic.RateLimitError:
        raise
    except Exception as e:
        narrative = (
            f"Narrative generation failed: {e}. "
            f"The data quality score improved from {baseline_display} to {score_display} "
            f"after {len(transformation_log)} transformation(s) were applied."
        )

    return {
        **state,
        "narrative": narrative,
    }


def build_scorecard_narrator_graph():
    """Build and return the compiled ScorecardNarrator graph."""
    graph = StateGraph(ScorecardNarratorState)

    graph.add_node("write_narrative", write_narrative)

    graph.set_entry_point("write_narrative")
    graph.add_edge("write_narrative", END)

    return graph.compile()


def run_scorecard_narrator(
    session_id: str,
    scorecard: dict,
    transformation_log: list[dict],
    baseline_score: float,
    use_case: str,
) -> str:
    """Run the scorecard narrator graph and return the narrative string."""
    app = build_scorecard_narrator_graph()

    initial_state: ScorecardNarratorState = {
        "session_id": session_id,
        "scorecard": scorecard,
        "transformation_log": transformation_log,
        "baseline_score": baseline_score,
        "use_case": use_case,
        # Output
        "narrative": "",
    }

    try:
        final_state = app.invoke(initial_state)
    except anthropic.RateLimitError:
        raise
    except Exception as e:
        return f"Narrative generation failed: {e}. Baseline score: {baseline_score:.2%}."

    return final_state.get("narrative", "")
