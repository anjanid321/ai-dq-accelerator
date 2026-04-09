"""Explorer tools for agent-driven dataset investigation.

Read-only query functions called by the ProfileAnalyzerGraph during its
investigation loop. Each function accepts a session_id and operates on
that session's working DuckDB database, returning JSON-serialisable results.

The EXPLORER_TOOLS list at the bottom of this file contains the Anthropic
API tool schemas used when registering these functions with Claude.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from dq_tools.db import duckdb_connect, session_db_lock


def _find_project_root() -> Path:
    p = Path(__file__).resolve().parent
    while p != p.parent:
        if (p / "pyproject.toml").exists():
            return p
        p = p.parent
    return Path(".")


def _db_path(session_id: str) -> Path:
    return _find_project_root() / "data" / "sessions" / session_id / "working.duckdb"


def _profile_path(session_id: str) -> Path:
    return _find_project_root() / "data" / "sessions" / session_id / "profile.json"


def _load_df(session_id: str):
    """Load working_data as a pandas DataFrame (read-only connection)."""

    with session_db_lock(session_id):
        con = duckdb_connect(str(_db_path(session_id)), read_only=True)
        try:
            return con.execute("SELECT * FROM working_data").df()
        finally:
            con.close()


_FORBIDDEN_SQL = re.compile(
    r"\b(insert|update|delete|drop|create|alter|truncate|replace|merge|copy)\b",
    re.IGNORECASE,
)


def run_sql(session_id: str, sql: str) -> list[dict] | dict:
    """Run a read-only SQL SELECT query against working_data.

    Returns up to 200 rows as a list of dicts.
    Raises a descriptive error dict if the query contains mutation keywords.
    """

    if _FORBIDDEN_SQL.search(sql):
        return {"error": "Only SELECT queries are allowed. Mutation keywords detected."}

    with session_db_lock(session_id):
        con = duckdb_connect(str(_db_path(session_id)), read_only=True)
        try:
            result_df = con.execute(sql).df()
            return json.loads(
                result_df.head(200).to_json(
                    orient="records", date_format="iso", default_handler=str
                )
            )
        except Exception as e:
            return {"error": str(e)}
        finally:
            con.close()


def get_value_counts(session_id: str, column: str, top_n: int = 20) -> dict:
    """Return the top-N frequency distribution of values in a column.

    Includes null count. Useful for understanding categoricals, spotting
    invalid codes, and checking low-cardinality columns.
    """
    df = _load_df(session_id)
    if column not in df.columns:
        return {"error": f"Column '{column}' not found. Available: {list(df.columns)}"}

    total = len(df)
    null_count = int(df[column].isna().sum())
    counts = df[column].value_counts(dropna=True).head(top_n)

    return {
        "column": column,
        "total_rows": total,
        "null_count": null_count,
        "null_pct": round(null_count / total * 100, 2) if total else 0,
        "distinct_non_null": int(df[column].nunique()),
        "top_values": [
            {"value": str(k), "count": int(v), "pct": round(v / total * 100, 2)}
            for k, v in counts.items()
        ],
        "note": f"Showing top {min(top_n, len(counts))} of {int(df[column].nunique())} distinct values",
    }


def check_regex_pattern(session_id: str, column: str, pattern: str) -> dict:
    """Check what percentage of non-null values match a regex pattern.

    Returns match rate and up to 10 sample non-matching values (with counts).
    Use for: detecting format inconsistencies in emails, dates, IDs, etc.
    """
    df = _load_df(session_id)
    if column not in df.columns:
        return {"error": f"Column '{column}' not found"}

    series = df[column].dropna().astype(str)
    total_non_null = len(series)

    if total_non_null == 0:
        return {
            "column": column,
            "pattern": pattern,
            "total_non_null": 0,
            "match_rate": None,
            "note": "All values are null — nothing to match against",
        }

    try:
        compiled = re.compile(pattern)
    except re.error as e:
        return {"error": f"Invalid regex pattern: {e}"}

    matches = series.apply(lambda x: bool(compiled.match(x)))
    match_count = int(matches.sum())
    non_matching = series[~matches]
    non_match_counts = non_matching.value_counts().head(10)

    return {
        "column": column,
        "pattern": pattern,
        "total_non_null": total_non_null,
        "match_count": match_count,
        "non_match_count": total_non_null - match_count,
        "match_rate": round(match_count / total_non_null, 4),
        "match_pct": round(match_count / total_non_null * 100, 2),
        "non_matching_samples": [
            {"value": str(k), "count": int(v)} for k, v in non_match_counts.items()
        ],
    }


def get_sample_rows(
    session_id: str,
    n: int = 10,
    where_clause: str | None = None,
) -> list[dict] | dict:
    """Return sample rows from working_data, optionally filtered.

    Args:
        n: Number of rows to return (capped at 50).
        where_clause: SQL WHERE condition *without* the WHERE keyword.
                      Example: "email NOT LIKE '%@%'"
    """

    n = min(int(n), 50)

    if where_clause and _FORBIDDEN_SQL.search(where_clause):
        return {"error": "Mutation keywords not allowed in WHERE clause"}

    with session_db_lock(session_id):
        con = duckdb_connect(str(_db_path(session_id)), read_only=True)
        try:
            if where_clause:
                sql = f"SELECT * FROM working_data WHERE {where_clause} LIMIT {n}"
            else:
                sql = f"SELECT * FROM working_data USING SAMPLE {n} ROWS"
            result_df = con.execute(sql).df()
            return json.loads(
                result_df.to_json(orient="records", date_format="iso", default_handler=str)
            )
        except Exception as e:
            return {"error": str(e)}
        finally:
            con.close()


def get_column_detail(session_id: str, column: str) -> dict:
    """Return the full ydata-profiling statistics for a specific column.

    Reads from profile.json on disk. Returns all stats for that column
    with large histogram/character-count arrays stripped for readability.
    """
    path = _profile_path(session_id)
    if not path.exists():
        return {"error": "profile.json not found — run profile_dataset() first"}

    try:
        profile = json.loads(path.read_text())
        variables = profile.get("variables", {})
        if column not in variables:
            return {
                "error": f"Column '{column}' not in profile",
                "available_columns": list(variables.keys()),
            }
        # Return full stats but strip large array fields to keep response readable
        info = dict(variables[column])
        for key in (
            "histogram",
            "value_counts_without_nan",
            "value_counts_index_sorted",
            "character_counts",
            "unicode_scripts",
            "block_alias_counts",
            "category_alias_counts",
            "word_counts",
        ):
            info.pop(key, None)
        return info
    except Exception as e:
        return {"error": str(e)}


EXPLORER_TOOLS = [
    {
        "name": "run_sql",
        "description": (
            "Run a read-only SQL SELECT query against the dataset. "
            "The table name is 'working_data'. Returns up to 200 rows. "
            "Use for: counting values matching a condition, cross-column checks, "
            "groupBy aggregations, date range checks, spotting impossible value combinations."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sql": {
                    "type": "string",
                    "description": "A SQL SELECT statement. Only SELECT is allowed. Table: working_data.",
                }
            },
            "required": ["sql"],
        },
    },
    {
        "name": "get_value_counts",
        "description": (
            "Get the frequency distribution of values in a column. "
            "Includes null count and percentage. Shows top-N most common values with counts and percentages. "
            "Use for: understanding what values actually exist, finding typos/inconsistencies in categoricals, "
            "checking whether an ID column is truly unique, spotting invalid codes."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "column": {"type": "string", "description": "Column name to analyze"},
                "top_n": {
                    "type": "integer",
                    "description": "Number of top values to return (default 20)",
                    "default": 20,
                },
            },
            "required": ["column"],
        },
    },
    {
        "name": "check_regex_pattern",
        "description": (
            "Check what percentage of non-null values in a column match a regex pattern. "
            "Returns match rate and sample non-matching values with counts. "
            "Use for: verifying email format consistency, checking date format patterns, "
            "validating phone numbers, ID formats, postal codes, or any structured text field."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "column": {"type": "string", "description": "Column name"},
                "pattern": {
                    "type": "string",
                    "description": (
                        "Python regex pattern. Anchor with ^ and $ for full-string match. "
                        "Example: r'^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$' for email"
                    ),
                },
            },
            "required": ["column", "pattern"],
        },
    },
    {
        "name": "get_sample_rows",
        "description": (
            "Get sample rows from the dataset, optionally filtered by a condition. "
            "Use for: seeing what bad data actually looks like, checking cross-column consistency, "
            "understanding edge cases, examining rows that meet specific criteria."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "n": {
                    "type": "integer",
                    "description": "Number of rows to return (default 10, max 50)",
                    "default": 10,
                },
                "where_clause": {
                    "type": "string",
                    "description": (
                        "Optional SQL WHERE condition without the WHERE keyword. "
                        'Example: "signup_date > last_purchase_date" '
                        'or "annual_revenue > 2500000"'
                    ),
                },
            },
        },
    },
    {
        "name": "get_column_detail",
        "description": (
            "Get the full ydata-profiling statistics for a specific column — "
            "quantiles, kurtosis, skewness, median, IQR, length distributions for text. "
            "Use when the overview summary doesn't provide enough detail for a column "
            "you want to understand more deeply."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "column": {"type": "string", "description": "Column name"},
            },
            "required": ["column"],
        },
    },
]
