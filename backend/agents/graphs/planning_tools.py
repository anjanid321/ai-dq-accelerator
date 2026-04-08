"""Investigation tool schemas and execution for TransformPlanner and CustomCodeGenerator."""
from __future__ import annotations
import json
from dq_tools.profiler import _find_project_root


def get_planning_tools_schema() -> list[dict]:
    """Return Anthropic tool definitions for the four investigation tools."""
    return [
        {
            "name": "run_sql",
            "description": "Run a read-only SQL query against the session DuckDB. Table name is 'working_data'.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "SELECT query to execute against working_data"}
                },
                "required": ["query"],
            },
        },
        {
            "name": "get_value_counts",
            "description": "Get frequency table for a column.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "Column name"},
                    "limit": {"type": "integer", "description": "Max rows to return", "default": 20},
                },
                "required": ["column"],
            },
        },
        {
            "name": "get_sample_rows",
            "description": "Get sample rows, optionally filtered.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "filter_sql": {"type": "string", "description": "WHERE clause (without WHERE keyword), or empty for no filter"},
                    "limit": {"type": "integer", "description": "Max rows to return", "default": 10},
                },
                "required": [],
            },
        },
        {
            "name": "get_column_stats",
            "description": "Get statistics for a column: min, max, mean, null_count, distinct_count, dtype.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "Column name"}
                },
                "required": ["column"],
            },
        },
    ]


def execute_planning_tool(tool_name: str, tool_input: dict, session_id: str) -> str:
    """Execute a planning tool and return result as a JSON string."""
    db_path = _find_project_root() / "data" / "sessions" / session_id / "working.duckdb"

    try:
        if tool_name == "run_sql":
            return _run_sql(str(db_path), tool_input.get("query", ""))
        elif tool_name == "get_value_counts":
            return _get_value_counts(str(db_path), tool_input.get("column", ""), tool_input.get("limit", 20))
        elif tool_name == "get_sample_rows":
            return _get_sample_rows(str(db_path), tool_input.get("filter_sql", ""), tool_input.get("limit", 10))
        elif tool_name == "get_column_stats":
            return _get_column_stats(str(db_path), tool_input.get("column", ""))
        else:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def _run_sql(db_path: str, query: str) -> str:
    import duckdb
    if not query.strip().upper().startswith("SELECT"):
        return json.dumps({"error": "Only SELECT queries are allowed"})
    with duckdb.connect(db_path, read_only=True) as conn:
        result = conn.execute(query)
        cols = [d[0] for d in result.description]
        rows = result.fetchmany(100)
        return json.dumps({"columns": cols, "rows": [dict(zip(cols, r)) for r in rows]}, default=str)


def _get_value_counts(db_path: str, column: str, limit: int) -> str:
    import duckdb
    with duckdb.connect(db_path, read_only=True) as conn:
        rows = conn.execute(
            f'SELECT "{column}", COUNT(*) as count FROM working_data GROUP BY "{column}" ORDER BY count DESC LIMIT ?',
            [limit],
        ).fetchall()
        return json.dumps({"column": column, "value_counts": [{"value": r[0], "count": r[1]} for r in rows]}, default=str)


def _get_sample_rows(db_path: str, filter_sql: str, limit: int) -> str:
    import duckdb
    where = f"WHERE {filter_sql}" if filter_sql.strip() else ""
    with duckdb.connect(db_path, read_only=True) as conn:
        result = conn.execute(f"SELECT * FROM working_data {where} LIMIT ?", [limit])
        cols = [d[0] for d in result.description]
        rows = result.fetchall()
        return json.dumps({"rows": [dict(zip(cols, r)) for r in rows]}, default=str)


def _get_column_stats(db_path: str, column: str) -> str:
    import duckdb
    with duckdb.connect(db_path, read_only=True) as conn:
        row = conn.execute(
            f'SELECT MIN("{column}"), MAX("{column}"), AVG(CAST("{column}" AS DOUBLE)), '
            f'COUNT(*) - COUNT("{column}"), COUNT(DISTINCT "{column}"), '
            f'typeof("{column}") FROM working_data LIMIT 1'
        ).fetchone()
        return json.dumps({
            "column": column,
            "min": row[0], "max": row[1], "mean": row[2],
            "null_count": row[3], "distinct_count": row[4], "dtype": row[5],
        }, default=str)
