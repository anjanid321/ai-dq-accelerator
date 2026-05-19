# Mock Dataset for Real-App Walkthrough — Design Spec

**Round / Stage:** Post-Round-2 mini-stage (queued in `docs/superpowers/context-handoff/2026-05-19-explore-stage-handoff.md`)
**Date:** 2026-05-19
**Predecessors:** none — first sample-data artifact in this repo.

---

## Goal

Ship a small, deterministic, loan-origination CSV that exercises the whole DQ pipeline when uploaded to the live app — profiler alerts across all three chip buckets, proposed rules with both passing and failing rows, and a small cross-column quirk that gives the deep-investigation agent something genuine to ask about. Replaces the per-stage `/preview/*` route pattern as the canonical way to demo the redesign work and walk new features end-to-end.

Continuity with the loan-application narrative used in the Profile (`131:239`) and Explore (`147:269`) Figma mocks so docs, screenshots, and customer demos stay coherent.

---

## Out of scope

- Multi-domain coverage (no CRM, healthcare, retail variants). One file, one domain.
- Realistic-volume datasets. Profiler runs on the full file on every upload — keeping the row count tight keeps PROFILING fast (<1 s) which matters for the demo loop.
- Backend/profiler/rule-proposer changes. We're designing data to fit the existing pipeline, not the other way around.
- Multi-file pipelines (no joins, no foreign-key scenarios across files). The exploration agent's open-questions UX already surfaces enough complexity at the single-table level.
- Test fixtures. The unit tests already have what they need; this artifact is for the running app, not the test suite.

---

## Background

### Where this fits

The handoff at `docs/superpowers/context-handoff/2026-05-19-explore-stage-handoff.md` queues two mini-stages after Stage 5: (a) an a11y audit + token contrast fix, and (b) this mock-dataset task. Both unblock real-app walkthroughs going forward — instead of building disposable `/preview/{stage}` routes to demo each stage, the user can upload one CSV and see the full pipeline.

The README at `README.md` describes the live flow: upload a CSV → PROFILING → AWAITING_RULE_APPROVAL → VALIDATING → TRANSFORMATION_LOOP → AWAITING_PIPELINE_CONFIRMATION → GENERATING → COMPLETE. Each stage surfaces some piece of the data's quality — this dataset is engineered so that piece is interesting at every stage.

### Existing sample-data state

There are no checked-in sample CSVs. `data/` is mounted as a Docker volume for runtime session storage (`data/sessions/{session_id}/working.duckdb`) and is gitignored. The README mentions `data/customers.csv` as a hypothetical upload but no such file exists.

### Profiler alert vocabulary

`dq_tools/profiler.py` normalizes ydata-profiling alerts into `{column, type, description}` triples. The frontend's `chipClasses` helper (`frontend/components/stages/_profile/chip-classes.ts`) maps alert types to three buckets:

- **Warning** (amber): `Missing`, `Constant`
- **Info** (blue): `High Cardinality`, `Duplicates`, `Skewness`
- **Danger** (red — intentional fallback for unknown types): everything else, including type-mismatch / format / range surfaces.

The dataset deliberately triggers each bucket.

---

## Design

### File

`samples/loan_applications.csv` — UTF-8, comma-delimited, single header row, 200 data rows, 12 columns.

The folder name avoids `data/` (Docker-volume runtime path) and `tests/fixtures/` (test-only convention) so the file is discoverable for manual upload.

### Generator

`samples/_generate_loan_applications.py` — deterministic Python script that emits the CSV. Same folder as the CSV so the relationship is obvious. Underscore prefix on the generator signals "support file, not the artifact itself." Runs with `python samples/_generate_loan_applications.py`.

Determinism comes from `random.seed(42)` at the top. Re-running the generator produces a byte-identical CSV — important so the CSV is a reproducible build artifact, not a source of unexplained drift.

The generator is checked in (so the dataset is reviewable) and the CSV is checked in (so users don't need Python to walk the app).

### Schema (12 columns)

| # | Column | Type | Distribution / quirks engineered |
|---|---|---|---|
| 1 | `application_id` | string | 200 unique IDs (`LA-000001`…`LA-000200`). Triggers **High Cardinality / Unique** info-chip alert. Drives uniqueness rule proposal. |
| 2 | `applicant_name` | string | 200 distinct full names (e.g. `Maria Gonzalez`, `Jin Park`). 0% missing. Quiet baseline column — gives the profiler something normal to contrast against. |
| 3 | `email` | string | ~7% missing (14 rows), ~3% format-invalid (6 rows missing `@` or TLD), rest valid. Triggers **Missing** warning chip and at least one format-validation rule failure. |
| 4 | `phone` | string | Mixed formats across the column: `(703) 555-1234`, `7035551234`, `703.555.1234`, `+1-703-555-1234`. ~5% missing. Triggers a format inconsistency the rule proposer should pick up; gives the transformation planner a normalization candidate. |
| 5 | `state_code` | string | Every row is `VA`. Triggers the **Constant** warning chip. Gives the agent a reason to ask "is this single-state by design?" in Open Questions. |
| 6 | `application_date` | string (ISO `YYYY-MM-DD`) | Mostly 2024-01-01 → 2026-04-30. 3 rows in 2030 (future-dated, data-entry errors). Triggers a range-validation rule failure. |
| 7 | `co_signer_ssn` | string | ~41% missing (82 rows). Format `XXX-XX-XXXX` for present values. Triggers a strong **Missing** warning chip and Stage-5-relevant agent question ("is this optional for non-cosigned loans?"). |
| 8 | `loan_amount` | int | Right-skewed: 90% in $5,000–$50,000; ~5 outliers in $500,000–$2,000,000. Triggers the **Skewness** info chip; gives the transformation planner a log-transform or winsorize candidate. |
| 9 | `income` | int | Normally distributed $30,000–$250,000. Quiet baseline numeric column. |
| 10 | `credit_score` | int | Mostly 600–820. 2 rows below 600 (e.g. 540, 580) AND `loan_status = 'APPROVED'` (cross-column anomaly). Drives the deep-investigation agent's open question. |
| 11 | `loan_status` | string | Values from {`APPROVED`, `REJECTED`, `PENDING`}. ~5 row pairs duplicated by `email + applicant_name` (with possibly differing `application_id`). Triggers the **Duplicates** info-chip alert plus uniqueness validation failures with sample failing rows the user can inspect. |
| 12 | `notes` | string | ~85% missing (free-text on present rows). Triggers a second **Missing** warning chip and exercises the alerts list rendering ≥4 entries. |

### Engineered anomalies — summary

| Anomaly | Where | Why |
|---|---|---|
| `email` missing × 14, invalid × 6 | column 3 | Warning + danger chips, regex rule failures with samples. |
| Mixed `phone` formats | column 4 | Triggers transformation planner; doesn't fail a rule per se but shows up in the AI summary. |
| `state_code` all `VA` | column 5 | Single constant; classic profiler alert. |
| Future `application_date` × 3 | column 6 | Range validation failures. |
| `co_signer_ssn` 41% missing | column 7 | Matches the existing Profile mock; large enough to drive an agent open question. |
| `loan_amount` outliers × 5 | column 8 | Skewness alert; transformation candidate. |
| Sub-600 credit + APPROVED × 2 | columns 10+11 | Cross-column anomaly for the investigation agent. |
| Email/name duplicates × 5 pairs | columns 3+2 | Duplicates alert + uniqueness rule failures with inspectable rows. |
| `notes` 85% missing | column 12 | Second warning chip; alerts list density. |

### Expected pipeline behavior on upload

| Stage | What the user should see |
|---|---|
| **LOADING** | 200 rows × 12 columns confirmed in <1 s. |
| **PROFILING → Profile stage** | AI summary card narrates the loan-origination dataset; 4 warning chips (Missing × 3 + Constant × 1), 3 info chips (High Cardinality + Skewness + Duplicates), and (likely) 1–2 danger chips for `email` / `phone` format issues. Alerts list has 7–9 entries. |
| **PROFILING_SYNTHESIS → Explore stage** | Notebook iframe loads with charts of the engineered distributions. Open Questions card lists the cross-column credit/APPROVED quirk and the `co_signer_ssn` optionality question. Round 1 of 3. |
| **AWAITING_RULE_APPROVAL → Rules stage** | ~8–10 proposed rules: uniqueness on `application_id`, completeness on `applicant_name` / `state_code`, range on `credit_score` 300–850, range on `application_date` ≤ today, format/regex on `email` and `phone`, format on `co_signer_ssn` (or skip if optional), value-set on `loan_status`. |
| **VALIDATING** | Each rule has 0–14 failing rows; most fail in single digits. Validator surfaces sample failing rows the user can scan. |
| **TRANSFORMATION_LOOP** | Planner proposes: normalize `phone` format, drop or impute `co_signer_ssn` based on agent recommendation, winsorize `loan_amount`, parse `application_date` to date type and clip future values, fix invalid `email` rows (drop or null). User walks each. |
| **GENERATING → COMPLETE** | Quality scorecard improves materially from baseline; dbt + Airflow + contract artifacts ship cleanly. |

### Documentation

Append a one-line pointer to the README's "Quickstart" or "Try it" section:

```md
Try it: upload `samples/loan_applications.csv` to walk the full pipeline against engineered data quality issues.
```

No new docs directory. The CSV's header + the generator script's docstring carry the rest.

---

## File / folder layout

```
samples/
  loan_applications.csv             # 200 rows × 12 columns, checked in
  _generate_loan_applications.py    # deterministic generator (seed=42), checked in
README.md                            # MODIFY — append one-line pointer
```

`.gitignore` does not currently exclude `samples/`, so both files will commit normally. No changes to it.

---

## Open notes

- **Phone normalization choice.** The mixed-format `phone` column intentionally does not have a single "correct" format pre-engineered — the transformation planner gets to choose. Both `(XXX) XXX-XXXX` and `XXX-XXX-XXXX` are reasonable targets; the planner picks one based on its prompt.
- **Anomaly counts are targets, not exact.** The generator might land at 13 missing emails instead of 14 due to interaction between the seeded RNG and column-order generation. We accept ±1–2 on every count; the spec defines the *intent*, and the generator is the source of truth for the actual file. Tests aren't checking specific counts.
- **PII shape, not real PII.** Names, addresses, SSN-shaped strings, phone numbers — all synthetic. The generator includes a header comment making this explicit so nobody mistakes the file for sanitized production data.
- **Future iteration.** If/when we need a second dataset (e.g. for the Clayton brand-swap demo), drop a sibling generator in `samples/` — don't bake multi-tenant variants into this one.

---

## Success criteria

1. `samples/loan_applications.csv` exists, is 200 rows × 12 columns, commits clean (UTF-8, no BOM, LF line endings).
2. `python samples/_generate_loan_applications.py` regenerates the file byte-identically.
3. Uploading the CSV in the running app reaches COMPLETE without crashes.
4. The Profile stage shows ≥6 alert chips across all three chipClasses buckets.
5. The Explore stage's Open Questions card surfaces at least one question that references the cross-column credit/APPROVED quirk OR the `co_signer_ssn` optionality.
6. The Validate stage shows at least 3 distinct rules with failing-row counts > 0.
7. README has the one-line pointer.
