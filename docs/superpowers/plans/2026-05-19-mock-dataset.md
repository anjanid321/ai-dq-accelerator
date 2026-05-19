# Mock Dataset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `samples/loan_applications.csv` (200 rows × 12 columns) plus a deterministic generator and a README pointer, so users can walk the full live pipeline against engineered DQ issues instead of building per-stage preview routes.

**Architecture:** Stdlib-only Python generator (`csv` + `random` + `datetime`) with `random.seed(42)` for byte-identical regeneration. Both the generator and the resulting CSV are checked in. Generator pre-picks all "engineered anomaly" index sets upfront before the main row-build loop so the random state stays deterministic regardless of column order. A small verification pass uses pandas (already a project dependency via `dq_tools`) to spot-check shape and key anomaly counts before committing.

**Tech Stack:** Python 3.11 stdlib (`csv`, `random`, `datetime`, `pathlib`), pandas (verification only — not a generator dependency).

**Spec:** `docs/superpowers/specs/2026-05-19-mock-dataset-design.md`

---

## File Structure

```
samples/
  _generate_loan_applications.py    # NEW — deterministic generator
  loan_applications.csv             # NEW — checked-in artifact emitted by the generator
README.md                            # MODIFY — append one-line pointer
```

`samples/` is a new top-level folder. `.gitignore` does not exclude it (verified — only `data/` and `output/` are session-volume gitignored), so both files commit normally.

Commit cadence — two commits + a verification phase + tag:

1. **`feat(samples): add loan-applications mock dataset + generator`** (Phase 1)
2. **`docs(readme): point users at samples/loan_applications.csv for walkthroughs`** (Phase 2)
3. Phase 3 is manual smoke test + final review + optional tag.

---

## Phase 1 — Generator + CSV

The generator is a single Python file. No tests — the determinism of the seed is the contract, and the verification step in Task 1.3 confirms shape + key anomaly counts before commit.

### Task 1.1: Write the generator

**Files:**
- Create: `samples/_generate_loan_applications.py`

- [ ] **Step 1: Create the `samples/` directory and write the generator**

```python
# samples/_generate_loan_applications.py
"""Generate samples/loan_applications.csv — a deterministic loan-origination
dataset engineered to exercise the full DQ pipeline.

Synthetic shape only: names, SSN-formatted strings, phone numbers, and
addresses are all generated. None are real people or real data.

Determinism: random.seed(42) at module load. Re-running this script produces
a byte-identical CSV. The engineered-anomaly index sets are sampled before
the main row-build loop so the random state stays predictable regardless of
column order.

Run: python samples/_generate_loan_applications.py
"""
import csv
import random
from datetime import date, timedelta
from pathlib import Path

random.seed(42)

OUTPUT_PATH = Path(__file__).parent / "loan_applications.csv"

N_ROWS = 200

FIRST_NAMES = [
    "Maria", "Jin", "Ahmed", "Priya", "Carlos", "Yuki", "Olumide", "Anna",
    "Diego", "Mei", "Thandiwe", "Lukas", "Aisha", "Noah", "Sofia", "Ravi",
    "Elena", "Tomas", "Fatima", "Hiroshi", "Isabella", "Kofi", "Lena",
    "Mateo", "Nadia", "Omar", "Paloma", "Quentin", "Rania", "Sven",
]

LAST_NAMES = [
    "Gonzalez", "Park", "Hassan", "Patel", "Rivera", "Tanaka", "Adeyemi",
    "Schmidt", "Lopez", "Chen", "Mokoena", "Weber", "Khan", "Martin",
    "Russo", "Iyer", "Petrov", "Nguyen", "Al-Sayed", "Yamamoto", "Brown",
    "Mensah", "Larsson", "Diaz", "Volkov", "Hadid", "Costa", "Beaumont",
    "Saleh", "Eriksson",
]

NOTES_POOL = [
    "First-time applicant",
    "Refi from previous lender",
    "Self-employed; income variable",
    "Co-signer required by underwriter",
    "Pending document upload",
    "Application transferred from branch office",
    "Income verified via tax returns",
    "Joint application with spouse",
]


def _phone(area: int, prefix: int, suffix: int, fmt: str) -> str:
    if fmt == "paren":
        return f"({area}) {prefix}-{suffix}"
    if fmt == "dash":
        return f"{area}-{prefix}-{suffix:04d}"
    if fmt == "dot":
        return f"{area}.{prefix}.{suffix:04d}"
    if fmt == "plus":
        return f"+1-{area}-{prefix}-{suffix:04d}"
    return f"{area}{prefix}{suffix:04d}"


def main() -> None:
    all_idx = list(range(N_ROWS))

    # Engineered anomaly index sets — picked up front so column-order independence holds.
    missing_email_idx = set(random.sample(all_idx, 14))
    invalid_email_idx = set(
        random.sample([i for i in all_idx if i not in missing_email_idx], 6)
    )
    missing_phone_idx = set(random.sample(all_idx, 10))
    missing_ssn_idx = set(random.sample(all_idx, 82))
    outlier_loan_idx = set(random.sample(all_idx, 5))
    low_credit_approved_idx = set(random.sample(all_idx, 2))
    future_date_idx = set(random.sample(all_idx, 3))
    notes_present_idx = set(random.sample(all_idx, 30))  # ~15% present → ~85% missing

    # 5 duplicate pairs by (name + email). dup_target_idx copies the name of its source.
    dup_picks = random.sample(all_idx, 10)
    dup_map = {dup_picks[i + 1]: dup_picks[i] for i in range(0, 10, 2)}

    # First pass: pick a name per row.
    names: list[str] = []
    for _ in range(N_ROWS):
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        names.append(f"{first} {last}")
    for target, source in dup_map.items():
        names[target] = names[source]

    # Email is derived from name + row index so duplicates land identically.
    def _email_for(i: int, name: str) -> str:
        handle = name.lower().replace(" ", ".")
        source = dup_map.get(i, i)
        return f"{handle}{source}@example.com"

    start_date = date(2024, 1, 1)
    end_date = date(2026, 4, 30)
    span_days = (end_date - start_date).days

    rows: list[list[object]] = []
    for i in range(N_ROWS):
        name = names[i]

        application_id = f"LA-{i + 1:06d}"

        if i in missing_email_idx:
            email = ""
        elif i in invalid_email_idx:
            # malformed: missing @ entirely
            email = name.lower().replace(" ", ".") + ".invalid"
        else:
            email = _email_for(i, name)

        if i in missing_phone_idx:
            phone = ""
        else:
            area = random.randint(200, 899)
            prefix = random.randint(200, 899)
            suffix = random.randint(0, 9999)
            fmt = random.choice(["paren", "dash", "dot", "plus", "plain"])
            phone = _phone(area, prefix, suffix, fmt)

        state_code = "VA"

        if i in future_date_idx:
            year = 2030
            month = random.randint(1, 12)
            day = random.randint(1, 28)
            application_date = f"{year}-{month:02d}-{day:02d}"
        else:
            offset = random.randint(0, span_days)
            application_date = (start_date + timedelta(days=offset)).isoformat()

        if i in missing_ssn_idx:
            co_signer_ssn = ""
        else:
            a = random.randint(100, 899)
            b = random.randint(10, 99)
            c = random.randint(0, 9999)
            co_signer_ssn = f"{a:03d}-{b:02d}-{c:04d}"

        if i in outlier_loan_idx:
            loan_amount = random.randint(500_000, 2_000_000)
        else:
            loan_amount = random.randint(5_000, 50_000)

        income = random.randint(30_000, 250_000)

        if i in low_credit_approved_idx:
            credit_score = random.randint(520, 590)
            loan_status = "APPROVED"
        else:
            credit_score = random.randint(600, 820)
            loan_status = random.choice(["APPROVED", "REJECTED", "PENDING"])

        notes = random.choice(NOTES_POOL) if i in notes_present_idx else ""

        rows.append(
            [
                application_id,
                name,
                email,
                phone,
                state_code,
                application_date,
                co_signer_ssn,
                loan_amount,
                income,
                credit_score,
                loan_status,
                notes,
            ]
        )

    headers = [
        "application_id",
        "applicant_name",
        "email",
        "phone",
        "state_code",
        "application_date",
        "co_signer_ssn",
        "loan_amount",
        "income",
        "credit_score",
        "loan_status",
        "notes",
    ]

    with open(OUTPUT_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(headers)
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows × {len(headers)} columns to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
```

### Task 1.2: Run the generator

- [ ] **Step 1: Run the generator**

```bash
python samples/_generate_loan_applications.py
```

Expected: `Wrote 200 rows × 12 columns to /…/samples/loan_applications.csv` (no errors, no traceback).

- [ ] **Step 2: Spot-check file existence and shape**

```bash
ls -la samples/loan_applications.csv
wc -l samples/loan_applications.csv
head -1 samples/loan_applications.csv
```

Expected: file exists, `201` lines (200 rows + 1 header), header reads `application_id,applicant_name,email,phone,state_code,application_date,co_signer_ssn,loan_amount,income,credit_score,loan_status,notes`.

### Task 1.3: Verify engineered anomalies

A one-shot pandas check confirms the engineered counts before commit. This is *verification*, not a test — once verified, we trust the seed.

- [ ] **Step 1: Run the verification script inline**

```bash
python - <<'EOF'
import pandas as pd

df = pd.read_csv("samples/loan_applications.csv", dtype=str)
print(f"rows × cols: {df.shape}")
assert df.shape == (200, 12), f"expected (200, 12) got {df.shape}"

# Missing counts (empty strings → NaN with keep_default_na default behavior on dtype=str)
empties = (df == "").sum()
print("\nEmpty counts per column:")
print(empties.to_string())
assert empties["email"] == 14, f"expected 14 missing emails, got {empties['email']}"
assert empties["phone"] == 10, f"expected 10 missing phones, got {empties['phone']}"
assert empties["co_signer_ssn"] == 82, f"expected 82 missing ssn, got {empties['co_signer_ssn']}"
assert empties["notes"] == 170, f"expected 170 missing notes, got {empties['notes']}"

# Constant state_code
assert (df["state_code"] == "VA").all(), "state_code should be all VA"

# Unique application_id
assert df["application_id"].is_unique, "application_id should be unique"

# Future application_date count
future = df[df["application_date"].str.startswith("2030")]
assert len(future) == 3, f"expected 3 future dates, got {len(future)}"

# Skewed loan_amount — count of outliers above $500k
loan = df["loan_amount"].astype(int)
outliers = (loan >= 500_000).sum()
assert outliers == 5, f"expected 5 loan outliers, got {outliers}"
print(f"\nloan_amount outliers (≥500k): {outliers}")

# Credit < 600 AND status = APPROVED — the cross-column quirk
credit = df["credit_score"].astype(int)
quirk = ((credit < 600) & (df["loan_status"] == "APPROVED")).sum()
assert quirk == 2, f"expected 2 low-credit-approved rows, got {quirk}"
print(f"low-credit (<600) AND APPROVED: {quirk}")

# Duplicate (name, email) pairs — drop empty emails first so missing-email rows
# don't collide as duplicates.
non_empty = df[df["email"] != ""]
dup_mask = non_empty.duplicated(subset=["applicant_name", "email"], keep=False)
n_dup = dup_mask.sum()
print(f"duplicate (name, email) rows: {n_dup}")
assert n_dup >= 8, f"expected ≥8 duplicate rows (5 pairs = 10, minus possible drops), got {n_dup}"

# Invalid-format emails (no '@')
invalid_emails = ((df["email"] != "") & (~df["email"].str.contains("@"))).sum()
print(f"invalid-format emails (no @): {invalid_emails}")
assert invalid_emails == 6, f"expected 6 invalid emails, got {invalid_emails}"

# Mixed phone formats — at least 3 distinct format families present
phones = df.loc[df["phone"] != "", "phone"]
has_paren = phones.str.startswith("(").any()
has_dot = phones.str.contains(r"\.").any()
has_plus = phones.str.startswith("+").any()
assert has_paren and has_dot and has_plus, "expected paren, dot, and plus phone formats"
print("phone formats: paren ✓ dot ✓ plus ✓")

print("\nAll engineered anomaly counts verified.")
EOF
```

Expected: prints all the counts, every `assert` passes, last line is `All engineered anomaly counts verified.`

- [ ] **Step 2: Verify determinism — regenerate and diff**

```bash
cp samples/loan_applications.csv /tmp/loan_applications.first.csv
python samples/_generate_loan_applications.py
diff samples/loan_applications.csv /tmp/loan_applications.first.csv
echo "exit=$?"
```

Expected: `diff` produces no output, exit code 0. Re-running is byte-identical.

### Task 1.4: Commit Phase 1

- [ ] **Step 1: Stage and commit both files**

```bash
git add samples/_generate_loan_applications.py samples/loan_applications.csv
git commit -m "$(cat <<'EOF'
feat(samples): add loan-applications mock dataset + generator

200-row × 12-column synthetic loan-origination CSV at
samples/loan_applications.csv plus a deterministic generator at
samples/_generate_loan_applications.py (random.seed(42), regenerates
byte-identically).

Engineered to exercise the full DQ pipeline when uploaded:
- Warning chips: Missing on email (14), phone (10), co_signer_ssn (82),
  notes (170); Constant on state_code (all VA).
- Info chips: High Cardinality on application_id (200 unique);
  Skewness on loan_amount (5 outliers $500k–$2M); Duplicates on
  (name, email) pairs (5 pairs).
- Danger chips: 6 invalid-format emails (no @), mixed phone formats,
  3 future application_dates (2030).
- Cross-column quirk: 2 rows with credit_score < 600 AND
  loan_status = APPROVED for the investigation agent to surface.

PII shape only — names, SSN-formatted strings, phones are all
generated. None are real.
EOF
)"
```

---

## Phase 2 — README pointer

Single-line edit so a fresh user finds the sample data without having to grep the repo.

### Task 2.1: Append the pointer

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Locate the right section**

```bash
grep -n "^## " README.md
```

Read the section list. The pointer belongs near the top of whichever section first explains how to upload a file — likely `## Quick Start`, `## Usage`, or `## Try it`. If none of those exist, append at the end of the first paragraph under the top-level `# AI DQ Accelerator` heading.

- [ ] **Step 2: Pick the insertion point and add the pointer**

Read the README around the chosen section to confirm formatting. Then add a single line that reads:

```md
**Try it:** upload [`samples/loan_applications.csv`](samples/loan_applications.csv) to walk the full pipeline against engineered data-quality issues (200 rows, all three Profile alert buckets, 8–10 proposed rules with failing samples).
```

Use the Edit tool to insert this line in the most-fitting location. Preserve surrounding markdown style (blank lines around block-level elements).

- [ ] **Step 3: Verify the edit**

```bash
grep -n "samples/loan_applications.csv" README.md
```

Expected: one line returned, in the section you chose.

### Task 2.2: Commit Phase 2

- [ ] **Step 1: Stage and commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): point users at samples/loan_applications.csv for walkthroughs

Single-line "Try it" pointer so a fresh user finds the canonical
sample dataset without grepping. Replaces the disposable
/preview/{stage} pattern as the way to walk the live app.
EOF
)"
```

---

## Phase 3 — Smoke test + tag

Manual walkthrough of the live app against the new CSV. No code changes. Optional tag at the end.

### Task 3.1: Live walkthrough

- [ ] **Step 1: Pull the branch into the primary checkout and start the stack**

The user typically runs Docker + the dev server from `~/Downloads/GitHub/ai-dq-accelerator`:

```bash
cd ~/Downloads/GitHub/ai-dq-accelerator
git pull /Users/anjani.dabkara/ai-dq-accelerator claude/kind-brattain-7675b4 --ff-only
docker compose up -d
npm --prefix frontend run dev
```

Then open `http://localhost:3000` and create a new session.

- [ ] **Step 2: Walk every stage**

Upload `samples/loan_applications.csv` and watch each stage land:

1. **LOAD** — 200 rows × 12 columns confirmed in <1 s.
2. **PROFILE** — AI summary card narrates the loan-origination dataset; the Alerts grid shows ≥6 chips covering all three buckets (warning + info + danger). Click into the alerts list.
3. **EXPLORE** — Notebook iframe loads. Open Questions card surfaces the cross-column credit/APPROVED quirk and/or the `co_signer_ssn` optionality question. Round chip reads `Round 1 of 3`. Try both Approve and Re-investigate (re-investigate with a targeted question, then Approve on Round 2).
4. **RULES** — 8–10 proposed rules: uniqueness on `application_id`, completeness on key columns, range on `credit_score` and `application_date`, regex on `email`. Approve a subset.
5. **VALIDATE** — Each rule has 0–14 failing rows. Sample failing rows render and are inspectable.
6. **TRANSFORM** — Planner proposes phone-format normalization, future-date clipping, log-transform or winsorize on `loan_amount`. Walk one or two decisions.
7. **PIPELINE / GENERATE / COMPLETE** — Quality scorecard renders, generated artifacts ship.

If any stage chokes on the data, file the bug and decide whether to fix in this branch or punt to a separate task.

- [ ] **Step 3: (Optional) Tag**

There's no established tag for sample-data artifacts — Stage tags so far have all been frontend redesign milestones. Skip the tag unless the user explicitly wants one.

---

## Self-review notes

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| File at `samples/loan_applications.csv`, 200 rows × 12 columns | Task 1.1 (`N_ROWS = 200`, 12-column header list) + Task 1.2 (`wc -l` verification) + Task 1.3 (`assert df.shape == (200, 12)`) |
| Generator at `samples/_generate_loan_applications.py`, `random.seed(42)`, byte-identical regeneration | Task 1.1 (`random.seed(42)` at module load, anomaly index sets pre-picked) + Task 1.3 Step 2 (diff after regenerate) |
| Schema: 12 columns with engineered distributions per spec table | Task 1.1 — every column generated per the spec's distributions (skim `for i in range(N_ROWS)` loop) |
| Warning chips: Missing × 3 (email, co_signer_ssn, notes) + Constant × 1 (state_code) | Task 1.1 + Task 1.3 assertions (`empties["email"] == 14`, `empties["co_signer_ssn"] == 82`, `empties["notes"] == 170`, `state_code == "VA"`) |
| Info chips: High Cardinality (application_id), Skewness (loan_amount), Duplicates ((name, email) pairs) | Task 1.1 (`application_id` formatted unique, outlier_loan_idx, dup_map) + Task 1.3 (`is_unique`, outliers count, duplicated mask) |
| Danger chips: invalid emails, mixed phones, future dates | Task 1.1 (`invalid_email_idx`, phone format choice, `future_date_idx`) + Task 1.3 (asserts on each) |
| Cross-column quirk: credit_score < 600 AND loan_status = APPROVED for 2 rows | Task 1.1 (`low_credit_approved_idx`, sets credit and status together) + Task 1.3 assertion |
| PII shape only, synthetic | Generator docstring + commit message — explicit |
| README pointer | Phase 2 |
| Live walkthrough confirms all 7 success criteria from spec | Task 3.1 Step 2 (each stage walked, criteria mapped) |

**Placeholder scan:** every step has executable code or a concrete command + expected outcome. No TBDs, no "similar to Task N", no references to undefined symbols. The README insertion point is described as a runtime decision (grep first, pick fitting section) rather than a literal line number — that's correct, the README structure isn't worth predicting.

**Type consistency:**
- `dup_map` is `dict[int, int]` (target → source row index). Used identically in the names loop and in `_email_for`. Single source of truth.
- All anomaly index sets are `set[int]`. Membership-test (`if i in …`) usage throughout.
- `N_ROWS = 200` is a single constant; `.shape == (200, 12)` and `wc -l == 201` both derive from it.
- Generator emits strings for all columns at the CSV layer (csv.writer auto-stringifies ints); verification reads with `dtype=str` then casts numeric columns explicitly (`df["loan_amount"].astype(int)`, `df["credit_score"].astype(int)`). Consistent.

**Commit count:** two `feat` / `docs` commits + a tag-optional smoke test. Matches recent project cadence.

**Out-of-scope reminders for the implementer:**
- Do **not** add a `Faker` or `pandas` dependency to the generator — stdlib only. Pandas is fine in the verification step (Task 1.3) because it's a one-shot script, not imported by the generator.
- Do **not** add tests under `tests/`. The verification in Task 1.3 is one-shot; the determinism is the contract once committed.
- Do **not** add the file under `data/` (Docker volume, gitignored) or `tests/fixtures/` (test-only convention). `samples/` is the correct location per the spec.
- Do **not** introduce a second domain dataset. If a Clayton brand-swap demo needs one later, that's a separate spec.
