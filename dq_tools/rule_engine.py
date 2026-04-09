"""Rule engine for the AI Data Quality Accelerator.

Executes declarative data-quality rules against the session DuckDB and
produces per-rule results, category scores, and a composite quality score.

Each rule carries a SodaCL YAML block (``sodacl`` field) that is assembled
into ``checks.yml`` — a portable monitoring artifact runnable with
``soda scan`` against any warehouse.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

import yaml
from dq_tools.db import duckdb_connect, session_db_lock

logger = logging.getLogger(__name__)


def _find_project_root() -> Path:
    """Walk up from this file until ``pyproject.toml`` is found."""
    current = Path(__file__).resolve().parent
    while current != current.parent:
        if (current / "pyproject.toml").exists():
            return current
        current = current.parent
    raise FileNotFoundError("Could not locate project root (pyproject.toml not found).")


def _session_dir(session_id: str) -> Path:
    return _find_project_root() / "data" / "sessions" / session_id


def _db_path(session_id: str) -> Path:
    return _session_dir(session_id) / "working.duckdb"


def _dq_fmt_to_strptime(fmt: str) -> str:
    """Convert a loose date-format string (YYYY-MM-DD) to strptime format (%Y-%m-%d)."""
    return (
        fmt.replace("YYYY", "%Y")
        .replace("MM", "%m")
        .replace("DD", "%d")
        .replace("HH", "%H")
        .replace("hh", "%H")
        .replace("mm", "%M")
        .replace("SS", "%S")
        .replace("ss", "%S")
    )


def _build_failing_condition(rule: dict) -> str | None:
    """Return a SQL WHERE expression that selects *failing* rows, or None to skip."""
    check = rule.get("check")
    col = rule.get("column")
    safe_col = f'"{col}"' if col else None

    if check == "not_null":
        return f"{safe_col} IS NULL"

    if check == "regex_match":
        pattern = rule.get("pattern", "")
        escaped = pattern.replace("'", "''")
        return f"NOT regexp_matches(CAST({safe_col} AS VARCHAR), '{escaped}')"

    if check == "unique":
        return (
            f"{safe_col} IN ("
            f"  SELECT {safe_col} FROM working_data "
            f"  GROUP BY {safe_col} HAVING COUNT(*) > 1"
            f")"
        )

    if check == "value_in_set":
        values = rule.get("values", [])
        if not values:
            return None
        literals = ", ".join(
            f"'{str(v).replace(chr(39), chr(39) * 2)}'" if isinstance(v, str) else str(v)
            for v in values
        )
        return f"CAST({safe_col} AS VARCHAR) NOT IN ({literals})"

    if check == "range":
        min_v = rule.get("min")
        max_v = rule.get("max")
        parts = []
        if min_v is not None:
            parts.append(f"TRY_CAST({safe_col} AS DOUBLE) < {min_v}")
        if max_v is not None:
            parts.append(f"TRY_CAST({safe_col} AS DOUBLE) > {max_v}")
        return f"({' OR '.join(parts)})" if parts else None

    if check == "date_format":
        fmt = rule.get("format", "YYYY-MM-DD")
        strptime_fmt = _dq_fmt_to_strptime(fmt)
        escaped_fmt = strptime_fmt.replace("'", "''")
        return (
            f"TRY_STRPTIME(CAST({safe_col} AS VARCHAR), '{escaped_fmt}') IS NULL "
            f"AND {safe_col} IS NOT NULL"
        )

    if check == "cross_column_order":
        col_a = rule.get("col_a")
        col_b = rule.get("col_b")
        if not col_a or not col_b:
            return None
        return f'"{col_a}" > "{col_b}"'

    if check == "custom_sql":
        condition = rule.get("condition", "")
        return condition if condition else None

    return None


def _yaml_scalar(s: str) -> str:
    """Return a YAML single-quoted scalar for *s*, safe for arbitrary SQL content.

    YAML single-quoted strings require only that internal ``'`` be doubled.
    This avoids parsing issues caused by SQL double-quote identifiers, colons,
    and other characters that confuse the YAML plain-scalar parser.
    """
    return "'" + s.replace("'", "''") + "'"


def rule_to_sodacl_check(rule: dict) -> str | None:
    """Return the indented SodaCL check block for this rule.

    The returned string is a 2-space-indented YAML block ready to be embedded
    directly under a ``checks for working_data:`` SodaCL header.

    Returns ``None`` if the rule type is unsupported.
    """
    check = rule.get("check")
    col = rule.get("column")
    rule_id = rule.get("id", "unknown")
    threshold = float(rule.get("threshold", 0.0))

    def _q(c: str) -> str:
        return f'"{c}"'

    if check == "not_null":
        if not col:
            return None
        expr = (
            f"missing_count({_q(col)}) = 0"
            if threshold == 0.0
            else f"missing_percent({_q(col)}) < {threshold * 100}"
        )
        return f"  - {expr}:\n      name: {rule_id}"

    if check == "unique":
        if not col:
            return None
        expr = (
            f"duplicate_count({_q(col)}) = 0"
            if threshold == 0.0
            else f"duplicate_percent({_q(col)}) < {threshold * 100}"
        )
        return f"  - {expr}:\n      name: {rule_id}"

    if check == "regex_match":
        if not col:
            return None
        pattern = rule.get("pattern", "")
        expr = (
            f"invalid_count({_q(col)}) = 0"
            if threshold == 0.0
            else f"invalid_percent({_q(col)}) < {threshold * 100}"
        )
        return f"  - {expr}:\n      name: {rule_id}\n      valid regex: {pattern}"

    if check == "value_in_set":
        if not col:
            return None
        values = rule.get("values", [])
        if not values:
            return None
        expr = (
            f"invalid_count({_q(col)}) = 0"
            if threshold == 0.0
            else f"invalid_percent({_q(col)}) < {threshold * 100}"
        )
        values_yaml = "\n".join(f"        - {v}" for v in values)
        return f"  - {expr}:\n      name: {rule_id}\n      valid values:\n{values_yaml}"

    if check == "range":
        if not col:
            return None
        min_v = rule.get("min")
        max_v = rule.get("max")
        parts = []
        if min_v is not None:
            parts.append(f"CAST({_q(col)} AS DOUBLE) < {min_v}")
        if max_v is not None:
            parts.append(f"CAST({_q(col)} AS DOUBLE) > {max_v}")
        if not parts:
            return None
        fail_cond = " OR ".join(parts)
        return f"  - failed rows:\n      name: {rule_id}\n      fail condition: {_yaml_scalar(fail_cond)}"

    if check == "date_format":
        if not col:
            return None
        fmt = rule.get("format", "%Y-%m-%d")
        strptime_fmt = _dq_fmt_to_strptime(fmt)
        escaped_fmt = strptime_fmt.replace("'", "''")
        fail_cond = (
            f"TRY_STRPTIME(CAST({_q(col)} AS VARCHAR), '{escaped_fmt}') IS NULL "
            f"AND {_q(col)} IS NOT NULL"
        )
        return f"  - failed rows:\n      name: {rule_id}\n      fail condition: {_yaml_scalar(fail_cond)}"

    if check == "cross_column_order":
        col_a = rule.get("col_a")
        col_b = rule.get("col_b")
        if not col_a or not col_b:
            return None
        fail_cond = f'"{col_a}" > "{col_b}"'
        return f"  - failed rows:\n      name: {rule_id}\n      fail condition: {_yaml_scalar(fail_cond)}"

    if check == "custom_sql":
        condition = rule.get("condition", "")
        if not condition:
            return None
        return f"  - failed rows:\n      name: {rule_id}\n      fail condition: {_yaml_scalar(condition)}"

    return None


def _rules_to_sodacl_yaml(rules: list[dict]) -> str:
    """Assemble a complete SodaCL document from all rule blocks."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    header = f"# AI DQ Accelerator — auto-generated SodaCL checks\n# Generated: {ts}\n"

    check_blocks = []
    for rule in rules:
        block = rule.get("sodacl") or rule_to_sodacl_check(rule)
        if block:
            check_blocks.append(block)

    if not check_blocks:
        return header + "\n# No checks defined\n"

    checks_section = "checks for working_data:\n" + "\n".join(check_blocks)
    return header + "\n" + checks_section + "\n"


def run_rules(session_id: str, rules: list[dict]) -> dict:
    """Execute a list of data-quality rules against the session dataset.

    Generates SodaCL checks, writes ``checks.yml`` to the session directory,
    attempts Soda scan execution for authoritative pass/fail outcomes, then
    uses DuckDB SQL for failure counts and sample rows.

    Parameters
    ----------
    session_id:
        Unique identifier for the data-quality session.
    rules:
        List of rule dictionaries following the DQ rule schema.

    Returns
    -------
    dict
        ``{per_rule, category_scores, baseline_quality_score}``
    """
    db = _db_path(session_id)
    sdir = _session_dir(session_id)

    # Ensure each rule has its SodaCL block (preserve user-edited value if present)
    enriched: list[dict] = []
    for rule in rules:
        r = dict(rule)
        if not r.get("sodacl"):
            r["sodacl"] = rule_to_sodacl_check(r)
        enriched.append(r)

    # Write checks.yml — the portable monitoring artifact
    sodacl_yaml = _rules_to_sodacl_yaml(enriched)
    checks_path = sdir / "checks.yml"
    checks_path.parent.mkdir(parents=True, exist_ok=True)
    checks_path.write_text(sodacl_yaml)
    logger.info("[run_rules:%s] Wrote checks.yml (%d rules)", session_id[:8], len(enriched))

    # DuckDB SQL for failure counts, rates, and sample rows
    # (checks.yml above is the portable Soda artifact; we use SQL for live scoring)
    with session_db_lock(session_id):
        con = duckdb_connect(str(db))
        try:
            total_rows_row = con.execute("SELECT COUNT(*) FROM working_data").fetchone()
            total_rows = total_rows_row[0] if total_rows_row else 0
            per_rule: list[dict] = []

            for rule in enriched:
                rule_id = rule.get("id", "unknown")
                category = rule.get("category", "validity")
                threshold = float(rule.get("threshold", 0.0))

                condition = _build_failing_condition(rule)
                # Sanitise LLM-generated subqueries that reference the wrong table name
                if condition is not None:
                    condition = re.sub(
                        r"\bFROM\s+df\b", "FROM working_data", condition, flags=re.IGNORECASE
                    )
                if condition is None:
                    per_rule.append(
                        {
                            "id": rule_id,
                            "category": category,
                            "check": rule.get("check"),
                            "column": rule.get("column"),
                            "passed": True,
                            "failure_count": 0,
                            "failure_rate": 0.0,
                            "sample_failing_rows": [],
                            "rationale": rule.get("rationale", ""),
                            "error": None,
                        }
                    )
                    continue

                try:
                    row = con.execute(
                        f"SELECT COUNT(*) FROM working_data WHERE {condition}"
                    ).fetchone()
                    failure_count = row[0] if row else 0
                    failure_rate = failure_count / total_rows if total_rows > 0 else 0.0

                    sample_df = con.execute(
                        f"SELECT * FROM working_data WHERE {condition} LIMIT 50"
                    ).fetchdf()
                    sample_failing_rows = sample_df.to_dict(orient="records")

                    passed = failure_rate <= threshold
                    rule_error = None

                except Exception as exc:
                    logger.warning(
                        "[run_rules:%s] Rule %s eval error: %s", session_id[:8], rule_id, exc
                    )
                    failure_count = 0
                    failure_rate = 0.0
                    sample_failing_rows = []
                    passed = False
                    rule_error = str(exc)

                per_rule.append(
                    {
                        "id": rule_id,
                        "category": category,
                        "check": rule.get("check"),
                        "column": rule.get("column"),
                        "passed": passed,
                        "failure_count": failure_count,
                        "failure_rate": failure_rate,
                        "sample_failing_rows": sample_failing_rows,
                        "rationale": rule.get("rationale", ""),
                        "error": rule_error,
                    }
                )
        finally:
            con.close()

    # Category scores — binary pass/fail per rule
    category_names = ["validity", "completeness", "uniqueness"]
    category_scores: dict[str, float] = {}
    for cat in category_names:
        cat_rules = [r for r in per_rule if r["category"] == cat]
        if cat_rules:
            passed = sum(1 for r in cat_rules if r.get("passed", True))
            category_scores[cat] = passed / len(cat_rules)
        else:
            category_scores[cat] = 1.0

    # Composite score (weighted)
    weights = {"validity": 0.4, "completeness": 0.4, "uniqueness": 0.2}
    baseline_quality_score = sum(category_scores.get(cat, 1.0) * w for cat, w in weights.items())

    result = {
        "per_rule": per_rule,
        "category_scores": category_scores,
        "baseline_quality_score": round(baseline_quality_score, 6),
    }

    # Persist results
    out_path = sdir / "validation_results.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2, default=str))

    return result


def save_approved_rules(session_id: str, rules: list[dict]) -> str:
    """Persist the approved rule set for a session as YAML.

    Parameters
    ----------
    session_id:
        Unique identifier for the data-quality session.
    rules:
        List of approved rule dictionaries.

    Returns
    -------
    str
        Absolute path to the written YAML file.
    """
    out_path = _session_dir(session_id) / "approved_rules.yaml"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(yaml.dump(rules, allow_unicode=True, sort_keys=False))
    return str(out_path)


def load_approved_rules(session_id: str) -> list[dict]:
    """Load the approved rule set for a session from YAML.

    Parameters
    ----------
    session_id:
        Unique identifier for the data-quality session.

    Returns
    -------
    list[dict]
        List of rule dictionaries, or an empty list if the file does not exist.
    """
    rules_path = _session_dir(session_id) / "approved_rules.yaml"
    if not rules_path.exists():
        return []
    raw = yaml.safe_load(rules_path.read_text())
    if isinstance(raw, list):
        return raw
    return []
