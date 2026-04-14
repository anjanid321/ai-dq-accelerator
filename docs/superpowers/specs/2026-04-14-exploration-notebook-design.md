# Exploration Notebook — Design Spec

**Date:** 2026-04-14  
**Status:** Approved for implementation

---

## Problem

The `deep_investigate_node` produces rich, specific findings (`investigation_findings`, `data_passport`) that are excellent internal reasoning — but the user never sees them. The first human-visible artifact is the rule proposals. If the agent misunderstood a column or missed a cross-column pattern (e.g., a categorical value set that was renamed mid-dataset), the user has no opportunity to correct it before rules are applied.

Additionally, the current deep agent only investigates columns individually. It has no structured mandate to look for multi-column relationships — patterns spanning 3+ columns, value sets that shift over time, or null patterns that are correlated across columns.

---

## Goal

Give the user a review point between investigation and rule proposal. The agent explores the data deeply, produces a notebook the user can view in the browser, and the user can either approve or submit free-form feedback for a targeted follow-up investigation round. The agent holds the business context gap explicitly — it surfaces its assumptions and open questions so the user can fill in what the data alone can't answer.

---

## Approach

**Option chosen: B — Structured findings extraction + pre-executed notebook**

After `deep_investigate_node` runs, a lightweight `structure_findings_node` (single Claude call, no tools) extracts `ExplorationFindings` JSON from the raw findings text. The notebook generator uses this structured output to render per-column and cross-column sections with full detail, then runs the notebook via `nbconvert --execute` to embed live plots. The HTML export is served inline in the browser.

Re-investigation carries full context forward: `ExplorationFindings` JSON + raw `investigation_findings` text + user feedback are injected into the re-investigation agent's initial message. The agent is explicitly instructed to reconcile the user's claim against its own prior evidence — not to simply defer.

**Raw investigation_findings is a first-class artifact.** `structure_findings_node` introduces a real fidelity risk: even with a strict "do not paraphrase" prompt, one LLM extraction pass can silently omit edge cases, over-normalize messy findings, or lose nuance. The real failure mode is not a crash — it is subtle distortion that looks fine. To mitigate this, `investigation_findings` (the raw agent text) travels alongside `ExplorationFindings` everywhere in the pipeline: the notebook renders it in a collapsible "Raw investigation notes" section, the re-investigation agent receives both, and `synthesize_and_propose_activity` receives both. `ExplorationFindings` provides structure for rendering and routing; `investigation_findings` is the authoritative record.

---

## Architecture

### ProfileAnalyzer graph (modified)

```
read_overview_node
  → deep_investigate_node          (enhanced: 4 new cross-column tools, updated prompt)
  → structure_findings_node        (NEW: extracts ExplorationFindings JSON)
  → synthesize_understanding_node  (unchanged)
  → propose_rules_node             (unchanged, gains cross_column_findings input)
```

`structure_findings_node` sits between investigation and synthesis. It is a single non-tool Claude call (~1-2s) that extracts structured findings from `investigation_findings` text. Fallback: if JSON parsing fails, returns a single prose `column_findings` entry and logs a warning — notebook degrades gracefully rather than crashing.

### Workflow stages (modified)

```
LOADING
  → PROFILING                        (profile_and_investigate_activity)
  → AWAITING_INVESTIGATION_REVIEW    NEW — human pause
  → REINVESTIGATING                  NEW — conditional, max 2 rounds
  → PROFILING_SYNTHESIS              NEW (was end of PROFILING)
  → AWAITING_RULE_APPROVAL           unchanged from here
  → ...
```

The current `profile_and_analyze_activity` splits into two:

- **`profile_and_investigate_activity`** — runs `profile_dataset` + ProfileAnalyzer graph through `structure_findings_node`, generates the exploration notebook (HTML + .ipynb written to disk). Returns `{exploration_findings, investigation_findings, notebook_path}`.
- **`synthesize_and_propose_activity`** — runs `synthesize_understanding_node` + `propose_rules_node`. Takes `investigation_findings` + `exploration_findings` as inputs. Returns `{profile, ai_summary, suggested_rules, top_issues}`.

Both activities use `AI_ACTIVITY_TIMEOUT` (60 min).

Re-investigation loop guard: `while investigation_round < 2 and not feedback.approve`. After 2 rounds the workflow proceeds to synthesis regardless.

**Constrained synthesis.** There is a meaningful difference between "the user approved" and "the round limit was hit." When rounds are exhausted without explicit approval, the workflow checks `exploration_findings["readiness_assessment"]` and whether `open_questions` remain. If `readiness_assessment == "poor"` or any `open_questions` are still present, `synthesis_constrained = True` is set on workflow state and passed to `synthesize_and_propose_activity`. In that case:
- The synthesis prompt receives a preamble: "The investigation review was not fully approved. The following questions remain unresolved: [list]. Propose rules conservatively — flag any rule whose correctness depends on an unresolved question."
- `ai_summary` includes a visible warning about the unresolved uncertainties.
- The proposed rules are still generated, but the user sees the constraint context at `AWAITING_RULE_APPROVAL`.

`synthesis_constrained` and `synthesis_constraint_reasons` (list of unresolved open questions) are surfaced in `get_exploration` query and in `get_full_state`.

### Human-in-the-loop mechanism

Split at the **Temporal level**, not inside LangGraph. LangGraph graphs remain stateless per invocation. Temporal is the durable layer; inserting a `wait_condition` between two activities loses zero context because all investigation artifacts are passed explicitly between activities.

LangGraph's native `interrupt()` + checkpointer was considered but rejected: it would require a parallel state management system (SQLite/Redis checkpointer + thread_id management) alongside Temporal, creating two sources of truth with significant added complexity.

---

## New Components

### `dq_tools/cross_column.py` — four new explorer tools

All four are registered as `dq_*` prefixed tools on the deep agent (same pattern as existing `dq_run_sql` etc.).

**`dq_group_over_time(group_col, time_col, bins=10)`**  
Splits `time_col` into N equal bins; for each bin returns distinct values of `group_col` with counts. Designed to catch: categorical value sets that appear/disappear at a date boundary (renames, restructures, product discontinuations). Returns `{time_bin: [{value, count}]}`.

**`dq_find_correlated_nulls(threshold=0.3)`**  
Computes phi coefficient between null indicator vectors for every column pair. Returns pairs above `threshold`. Catches systematic missingness — e.g., Email and Phone both null for the same rows, or Address null whenever AccountType is "Online". Single-column profiling cannot surface this.

**`dq_pairwise_profile(col_a, col_b)`**  
Dispatches on column types:
- Both categorical → cross-tab (counts for every value-pair)
- Both numeric → correlation coefficient + scatter quantiles
- Mixed → group stats (mean, std, null rate of numeric col grouped by each categorical value)

General-purpose cross-column tool. Agent calls this when a relationship is suspected and a targeted SQL query would be overkill.

**`dq_compute_correlation_matrix(columns=None)`**  
Pearson correlation across all numeric columns (or a specified subset). Returns `{col_a: {col_b: coefficient}}`. Auto-selects all numeric columns when `columns=None`, capped at 20. Used early in cross-column investigation to find which numeric pairs are worth deeper investigation.

**v1 limitation.** These four tools bias toward pairwise and time-binned patterns. Truly complex multi-column conditional logic — e.g., "Code A is only valid when Region=X AND Status=Active AND EndDate is null" — is not natively discoverable by any of these tools. The agent can still find such patterns via `dq_run_sql`, but only if it formulates the right query. The system prompt mandates cross-column investigation and notes findings can span 3+ columns, but the toolset makes those findings more inferential than structurally guaranteed. This is a sound v1; comprehensive conditional multi-column coverage is future work.

### `PROFILE_INVESTIGATION_SYSTEM` prompt update

After the existing per-column investigation instructions, add an explicit cross-column mandate:

> After investigating individual columns, systematically test cross-column hypotheses using the cross-column tools. Required checks: (1) run `dq_compute_correlation_matrix` to find numeric relationships worth investigating; (2) for any time column found, run `dq_group_over_time` against every categorical column — value sets that change over time are a common and easily-missed data quality signal; (3) run `dq_find_correlated_nulls` to identify systematic missingness patterns. For any finding that spans 3+ columns, describe all columns involved — cross-column findings are not limited to pairs.
>
> Before concluding, explicitly list your assumptions — places where you made an inference that business context could change. These will be shown to the user for confirmation.

### `structure_findings_node` — `profile_analyzer.py`

Single non-tool Claude call. Extraction prompt instructs explicitly: *"Preserve all specific counts, percentages, sample values, SQL results, and agent reasoning verbatim. Do not paraphrase or compress."*

**Fidelity risk.** This node is a translation layer and the most likely place for silent loss of nuance. The fallback (graceful degradation to prose) handles the crash case, but the real risk is subtler: valid JSON that omits edge cases or smooths over contradictions. Mitigation: `investigation_findings` is preserved and passed alongside `ExplorationFindings` to every downstream consumer (notebook, re-investigation, synthesis). `ExplorationFindings` drives structure; `investigation_findings` is the ground truth.

Produces `ExplorationFindings` with this schema:

```json
{
  "column_findings": [
    {
      "column": "Email",
      "semantic_meaning": "...",
      "data_type_actual": "text",
      "stats": {
        "null_count": 234,
        "null_pct": 0.9,
        "distinct_count": 25847,
        "total_rows": 26500
      },
      "full_analysis": "[Complete agent text — not truncated]",
      "issues": [
        {
          "description": "847 values (3.2%) fail standard email format regex",
          "severity": "warning",
          "count": 847,
          "pct": 3.2,
          "sample_values": ["noemail", "N/A", "test@"],
          "where_clause": "email NOT REGEXP '^[a-zA-Z0-9._%+\\-]+@...'"
        }
      ],
      "assumptions": ["Assuming nulls represent missing data, not intentional opt-outs"],
      "rule_implications": [
        "Validity rule: email format regex, ~4% threshold to account for edge cases"
      ]
    }
  ],
  "cross_column_findings": [
    {
      "columns": ["EmployeeGroup", "HireDate", "Department"],
      "full_analysis": "[Complete agent text — not truncated]",
      "pattern": "'Field-Ops' present in 4,218 rows with HireDate before 2022-04-01; 'FieldOperations' in 1,843 rows from 2022-04-01 onward. Same Department distribution in both groups.",
      "severity": "critical",
      "investigation_sql": "SELECT EmployeeGroup, COUNT(*), MIN(HireDate), MAX(HireDate) FROM working_data GROUP BY EmployeeGroup ORDER BY MIN(HireDate)",
      "rule_implications": [
        "Standardization transform: map 'Field-Ops' → 'FieldOperations' before any group-level aggregation"
      ]
    }
  ],
  "open_questions": [
    "Are null Email values for AccountType='Online' intentional?",
    "Is the EmployeeGroup rename a data entry change or a genuine restructure?"
  ],
  "readiness_assessment": "moderate",
  "key_risks": [
    "EmployeeGroup inconsistency will corrupt any group-level analysis if not resolved"
  ]
}
```

### `backend/agents/graphs/exploration_notebook.py` — notebook generator

Generates a pre-executed `.ipynb` and an HTML export using `nbformat` + `nbconvert --execute` + nbconvert HTML exporter. Plots use matplotlib with `matplotlib.use('Agg')` (non-interactive). DuckDB access via `dq_tools.explorer`.

**Notebook cell layout:**

*First section — Open Questions (pinned at top, impossible to miss):*
```
## Open Questions for Review
[Markdown listing all open_questions from ExplorationFindings]
[Note: "Answer these before approving — the agent could not resolve them from data alone"]
```

*Per-column sections (one H2 per column):*
```
## {column}
[Markdown] full_analysis verbatim + stats table (nulls, distinct count, total rows)
           Issues listed with exact counts, percentages, sample_values.
           Assumptions in a blockquote.
[Code → bar chart] top-25 value counts. Numeric: histogram with mean/median/p5/p95 annotated.
                   Bars for issues highlighted in orange.
[Code → failing rows table] get_sample_rows(where_clause=issue.where_clause, n=25)
                            rendered as DataFrame. One table per issue. (if where_clause present)
[Code → null correlation heatmap] single-row showing null pattern vs. top 3 correlated
                                  columns from find_correlated_nulls output. (if null_pct > 0)
```

*Cross-column findings section:*
```
## Cross-Column Findings
### Finding N — {columns joined with " × "} [{severity}]
[Markdown] full_analysis verbatim
[Code → visualization] re-runs investigation_sql and renders as stacked bar chart or
                       line chart depending on finding type
[Code → sample rows table] 25 rows from each side of any identified transition boundary
```

*Final section — Preliminary Rule Implications:*
```
## Preliminary Rule Implications
[One markdown cell per rule_implication across all findings]
For each: column(s) involved, what was observed, suggested threshold/condition,
and the assumption that could change this direction.
[Note: "These are directions for review — not the final rule set"]
```

*Appendix — Raw Investigation Notes (collapsible):*
```
## Appendix: Raw Investigation Notes
[Single markdown cell with full investigation_findings text — verbatim, unedited]
[Note: "This is the agent's unstructured output before extraction. 
If anything in the structured sections above seems incomplete, check here."]
```

This appendix is the safety net for fidelity loss: any nuance that `structure_findings_node` failed to extract is visible to the user in the original form.

Output files written to `output/sessions/{session_id}/`:
- `exploration_notebook.ipynb` — source with executed outputs
- `exploration_notebook.html` — self-contained HTML (base64 images, embedded CSS)

### Re-investigation agent (`deep_investigate.py`)

When `investigation_round > 0`, the initial `HumanMessage` is replaced with a context-aware prompt:

```
Your prior investigation established the following findings:
[ExplorationFindings JSON — full, not abbreviated]

Raw investigation notes (full text from prior run):
[investigation_findings text — full, not abbreviated]

The user has reviewed the exploration notebook and submitted this feedback:
[user's message verbatim]

Your job:
- Use the tools to investigate the specific threads the user raised
- Where the user's claim conflicts with your prior evidence, verify it against
  the data before accepting it. If the evidence contradicts the user's claim,
  say so explicitly with supporting counts and examples.
- Do not re-investigate findings that are already well-established unless the
  user specifically asked you to revisit them.
- At the end, write updated findings that extend (not replace) the prior findings.
```

Note: `data_passport` is NOT available at re-investigation time — it is produced by `synthesize_understanding_node` which runs after the human review is complete. The re-investigation agent's full context is `ExplorationFindings` + `investigation_findings` + user feedback.

This framing gives the agent its own evidence base alongside the user's claim — preventing blind deference while still incorporating valid corrections.

---

## State and API Changes

### `ProfileAnalyzerState` additions (`backend/agents/state.py`)

```python
exploration_findings: dict              # ExplorationFindings JSON
exploration_notebook_path: str          # absolute path to generated .ipynb
investigation_feedback: str | None      # user's free-form feedback
investigation_round: int                # 0 = first pass, 1-2 = re-investigation rounds
```

`cross_column_findings: list[dict]` (already in state, currently unpopulated) is populated by `structure_findings_node` from `exploration_findings["cross_column_findings"]`.

### New workflow state fields (`dq_workflow.py`)

```python
self.investigation_findings: str = ""           # raw agent text — first-class artifact
self.exploration_findings: dict = {}
self.exploration_notebook_path: str = ""
self.investigation_round: int = 0
self.investigation_feedback: dict | None = None  # {"message": str, "approve": bool}
self.synthesis_constrained: bool = False         # True when synthesis proceeds without approval
self.synthesis_constraint_reasons: list = []     # unresolved open_questions at synthesis time
```

### New Temporal signal

```python
@workflow.signal
def submit_investigation_feedback(self, payload: dict) -> None:
    # payload: {"message": str, "approve": bool}
    self.investigation_feedback = payload
```

### New Temporal query

```python
@workflow.query
def get_exploration(self) -> dict:
    return {
        "exploration_findings": self.exploration_findings,
        "notebook_path": self.exploration_notebook_path,
        "open_questions": self.exploration_findings.get("open_questions", []),
        "investigation_round": self.investigation_round,
        "synthesis_constrained": self.synthesis_constrained,
        "synthesis_constraint_reasons": self.synthesis_constraint_reasons,
    }
```

### `WorkflowStage` enum additions (`backend/api/schemas.py`)

```python
AWAITING_INVESTIGATION_REVIEW = "AWAITING_INVESTIGATION_REVIEW"
REINVESTIGATING = "REINVESTIGATING"
PROFILING_SYNTHESIS = "PROFILING_SYNTHESIS"
```

### New API endpoints (`backend/api/routers/sessions.py`)

```
GET  /sessions/{session_id}/exploration
     → {exploration_findings, open_questions, investigation_round, notebook_ready: bool}

GET  /sessions/{session_id}/exploration/notebook
     → text/html (nbconvert HTML, opens in browser, plots fully rendered)

GET  /sessions/{session_id}/exploration/notebook/download
     → application/octet-stream (.ipynb attachment for local Jupyter use)

POST /sessions/{session_id}/exploration/feedback
     body: {"message": str, "approve": bool}
     → sends submit_investigation_feedback signal to Temporal
```

---

## New and Modified Files

| File | Change |
|------|--------|
| `dq_tools/cross_column.py` | NEW — four cross-column explorer tools |
| `backend/agents/graphs/exploration_notebook.py` | NEW — notebook generator |
| `backend/temporal/activities/investigation_activities.py` | NEW — activity wrappers for split activities |
| `backend/agents/graphs/deep_investigate.py` | MODIFIED — new tools added, system prompt updated, re-investigation context injection |
| `backend/agents/graphs/profile_analyzer.py` | MODIFIED — `structure_findings_node` added, graph node order updated |
| `backend/agents/state.py` | MODIFIED — four new fields on `ProfileAnalyzerState` |
| `backend/agents/prompts.py` | MODIFIED — `PROFILE_INVESTIGATION_SYSTEM` cross-column mandate added |
| `backend/temporal/activities/data_activities.py` | MODIFIED — `profile_and_analyze_activity` split into two |
| `backend/temporal/workflows/dq_workflow.py` | MODIFIED — two new stages, new signal, new query, re-investigation loop |
| `backend/api/routers/sessions.py` | MODIFIED — four new endpoints |
| `backend/api/schemas.py` | MODIFIED — three new `WorkflowStage` values |

---

## Out of Scope

- Frontend UI for the notebook viewer (the HTML endpoint serves the notebook; no custom rendering component is needed)
- Persistent agent checkpointing / LangGraph session resumption (explicit context injection is sufficient and simpler)
- More than 2 re-investigation rounds (loop guard at `investigation_round < 2`)
- Notebook cell interactivity beyond pre-executed outputs (users who want interactivity download the `.ipynb`)
