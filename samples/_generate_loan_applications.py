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
