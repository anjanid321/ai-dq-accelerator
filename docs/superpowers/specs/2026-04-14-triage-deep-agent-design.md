# Rule Contradiction Detection — Design Spec

**Date:** 2026-04-14  
**Status:** Approved  
**Scope:** Pre-approval deep rule review agent + triage contradiction post-pass

---

## Problem

The current pipeline proposes DQ rules and immediately presents them to the user for approval with no cross-rule analysis. Rules that logically contradict each other (e.g., `null_invalid` that will null 12% of rows + `not_null` at 0% threshold on the same column) only surface as failures *after* a full validation + triage cycle. Similarly, the triage agent classifies individual failing rules but does not detect emergent contradictions where fixing one rule cascades into breaking another.

---

## Solution Overview

Two complementary additions:

1. **Pre-approval deep rule review** — a `create_deep_agent`-backed node that runs between `PROFILING` and `AWAITING_RULE_APPROVAL`, detects contradictions in `suggested_rules`, resolves them inline, and stores a revision log.
2. **Triage contradiction post-pass** — a focused single LLM call added after `triage_node` that detects emergent fix-cascade contradictions among classified failing rules.

---

## Workflow Changes

```
LOADING → PROFILING → RULE_REVIEW → AWAITING_RULE_APPROVAL → VALIDATING
→ TRANSFORMATION_LOOP → AWAITING_PIPELINE_CONFIRMATION → GENERATING → COMPLETE
```

`RULE_REVIEW` is a new Temporal stage. If it fails, the workflow falls back to unmodified `suggested_rules` and continues — the stage never blocks approval.

---

## Pre-Approval Deep Rule Review

### File
`backend/agents/graphs/deep_rule_review.py`

### Context Schema
```python
@dataclass
class RuleReviewContext:
    session_id: str
    suggested_rules: list[dict]
    exploration_findings: dict
```

### Tools

**Tier 1 — no data queries (always available):**
- `get_rules()` — returns the full `suggested_rules` list
- `get_profile_summary()` — returns `exploration_findings` (column stats, null %, value distributions, cross-column findings)

**Tier 2 — on-demand data queries:**
- `dq_run_sql` — quantitative verification (e.g., "how many rows go null if we apply this fix?")
- `dq_get_value_counts` — check value set overlaps between rules
- `dq_get_sample_rows` — spot-check conflict hypotheses

The agent reads profile data first and only escalates to Tier 2 tools when a suspected contradiction needs quantitative evidence.

### Contradiction Types

| Type | Example |
|---|---|
| Null conflict | `null_invalid` will null ~10% of col X + `not_null` on col X at 0% threshold |
| Value set conflict | `value_in_set: ["A","B"]` + `custom_sql` only passes rows where value = "C" |
| Range + transform conflict | `range 0–100` on col profiled 0–500; triage will null >100 values, breaking a `not_null` |
| Threshold arithmetic | Two soft rules whose combined failure rates exceed each other's tolerance |
| Logical impossibility | `unique` + `not_null` where dedup changes row count affecting null % thresholds elsewhere |

### Output Contract

The agent's final message is parsed as:
```json
{
  "revised_rules": [ /* full rule list, same schema, conflicts resolved */ ],
  "revision_log": [
    {
      "rule_ids": ["r2", "r5"],
      "conflict_type": "null_conflict",
      "description": "r2 will null ~12% of email rows via null_invalid; r5 requires email not_null at 0% threshold",
      "resolution": "Raised r5 threshold to 0.15 to accommodate legitimate nulling from r2",
      "original_rules": { /* snapshot of r2 and r5 before change */ }
    }
  ]
}
```

### State Changes
`ProfileAnalyzerState` gains:
```python
rule_revision_log: list[dict]   # empty if no contradictions found
```

`suggested_rules` is replaced in state with `revised_rules`. `rule_revision_log` is surfaced in the `get_profile` Temporal query so the frontend can display a "rules were adjusted" notice.

### Error Handling
On `GraphRecursionError`, parse failure, or any exception: `suggested_rules` is left unchanged, `rule_revision_log` is set to `[]`, workflow continues to `AWAITING_RULE_APPROVAL`. The agent never blocks the human approval gate.

---

## Triage Contradiction Post-Pass

### Where It Runs
After `_validate_classifications` in `triage_node`. Single focused LLM call — no tool loop, no `create_deep_agent`. The classified rule set with failure counts and sample rows is already in context; no additional data queries are needed.

### What It Detects
Emergent contradictions that only become visible with real validation failure data:

- A `transform_fixable` rule whose fix (e.g., `null_invalid`) will cause a currently-passing `not_null` rule to fail on the next validation pass
- Two `transform_fixable` rules targeting the same column with conflicting fixes (e.g., `null_invalid` + `impute_constant` applied in wrong order cancel out)
- A `threshold_too_strict` reclassification that, if applied, would push a related rule over its own threshold

### Output
```json
{
  "contradictions": [
    {
      "rule_ids": ["r3", "r7"],
      "conflict_type": "fix_cascade",
      "description": "Fixing r3 (null_invalid on email) will null ~12% of rows, causing r7 (not_null on email at 0% threshold) to fail on next validation pass.",
      "suggested_fix": {
        "target_rule": "r7",
        "action": "raise_threshold",
        "proposed_threshold": 0.15,
        "rationale": "Accommodate nulls introduced by r3 fix"
      }
    }
  ]
}
```

### State Changes
`TriageAgentState` gains:
```python
contradictions: list[dict]   # empty list if none found
```

`contradictions` rides alongside the existing `triage_result` in `get_full_state` — no new Temporal query needed.

### Error Handling
If the LLM call fails or returns unparseable JSON: `contradictions` is set to `[]`. Existing `classifications` and `summary` are never affected.

---

## New Prompts

Two new constants in `backend/agents/prompts.py`:

- `RULE_REVIEW_SYSTEM` — instructs the agent on all five contradiction types, the tier-1/tier-2 tool escalation strategy, and the required output JSON schema
- `TRIAGE_CONTRADICTION_SYSTEM` — instructs the model on fix-cascade detection and the `contradictions` output schema

---

## Files Changed

| File | Change |
|---|---|
| `backend/agents/graphs/deep_rule_review.py` | **New** — `create_deep_agent`-backed pre-approval node |
| `backend/agents/prompts.py` | Add `RULE_REVIEW_SYSTEM`, `TRIAGE_CONTRADICTION_SYSTEM` |
| `backend/agents/state.py` | Add `rule_revision_log` to `ProfileAnalyzerState`; add `contradictions` to `TriageAgentState` |
| `backend/temporal/workflows/dq_workflow.py` | Add `RULE_REVIEW` stage; wire `rule_revision_log`; surface `contradictions` in queries |
| `backend/agents/graphs/triage_agent.py` | Add `_detect_triage_contradictions` post-pass |
| `backend/temporal/activities/data_activities.py` | Add activity wrapper for `deep_rule_review_node` |

---

## Testing

- `tests/backend/agents/test_rule_review.py` — unit tests with synthetic rule sets covering each contradiction type; mocked `create_deep_agent`; assert `revision_log` presence and `revised_rules` diffs
- `tests/backend/agents/test_triage_contradiction.py` — unit tests for `_detect_triage_contradictions` with synthetic classified rule sets; assert `contradictions` structure and known cascades detected
- Integration test: propose rules → review → validate → triage, assert `rule_revision_log` non-empty when contradicting rules are generated
