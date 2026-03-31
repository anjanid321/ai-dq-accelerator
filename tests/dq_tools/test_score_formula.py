"""Tests for binary pass/fail score formula in rule_engine and transformation_executor."""
import duckdb
import pytest


def _make_rules(checks: list[dict]) -> list[dict]:
    """Minimal approved-rules list for testing."""
    return [
        {
            "id": f"r{i}",
            "category": r["category"],
            "check": r["check"],
            "column": r.get("column"),
            "threshold": 0.0,
            **{k: v for k, v in r.items() if k not in ("category", "check", "column")},
        }
        for i, r in enumerate(checks, 1)
    ]


def _setup_session_db(tmp_path, session_id: str, sql: str) -> tuple:
    """Create a tmp session dir + DuckDB, return (db_path, session_dir)."""
    session_dir = tmp_path / "sessions" / session_id
    session_dir.mkdir(parents=True)
    db_path = session_dir / "working.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(sql)
    con.close()
    return db_path, session_dir


def test_score_is_fraction_of_passing_rules(tmp_path, monkeypatch):
    """Score should be fraction of rules passing, not 1 - avg(failure_rate)."""
    import dq_tools.rule_engine as re_mod
    from dq_tools.rule_engine import run_rules

    session_id = "test-score-001"
    db_path, session_dir = _setup_session_db(
        tmp_path, session_id,
        "CREATE TABLE working_data AS SELECT range AS id, "
        "CASE WHEN range < 5000 THEN NULL ELSE 'val' END AS col_a, "
        "'ok' AS col_b FROM range(10000)",
    )
    monkeypatch.setattr(re_mod, "_session_dir", lambda sid: session_dir)
    monkeypatch.setattr(re_mod, "_db_path", lambda sid: db_path)

    rules = _make_rules([
        {"category": "completeness", "check": "not_null", "column": "col_a"},
        {"category": "completeness", "check": "not_null", "column": "col_b"},
    ])
    results = run_rules(session_id, rules)
    score = results["baseline_quality_score"]
    # With binary scoring: 1/2 completeness rules pass → completeness=0.5
    # Overall = 0.5*0.4 + 1.0*0.4 + 1.0*0.2 = 0.8
    # Old formula: completeness = 1 - avg(0.5, 0.0) = 0.75 → overall = 0.75*0.4 + 0.4 + 0.2 = 0.9
    assert 0.79 < score < 0.81, f"Expected ~0.80, got {score}"


def test_large_dataset_low_failure_rate_penalises_score(tmp_path, monkeypatch):
    """On 70k rows, 54 failures should NOT give 99%+ score if the rule fails."""
    import dq_tools.rule_engine as re_mod
    from dq_tools.rule_engine import run_rules

    session_id = "test-score-002"
    db_path, session_dir = _setup_session_db(
        tmp_path, session_id,
        "CREATE TABLE working_data AS SELECT range AS id, "
        "CASE WHEN range < 54 THEN NULL ELSE 'val' END AS col_a "
        "FROM range(70000)",
    )
    monkeypatch.setattr(re_mod, "_session_dir", lambda sid: session_dir)
    monkeypatch.setattr(re_mod, "_db_path", lambda sid: db_path)

    rules = _make_rules([
        {"category": "completeness", "check": "not_null", "column": "col_a"},
    ])
    results = run_rules(session_id, rules)
    score = results["baseline_quality_score"]
    # Old formula: 1 - 54/70000 ≈ 0.9992 → ~99.9%
    # New formula: 0/1 completeness rules pass → completeness=0.0
    # Overall = 0.0*0.4 + 1.0*0.4 + 1.0*0.2 = 0.6
    assert score < 0.65, f"Single failing rule on large dataset should score <65%, got {score:.4f}"


def test_preview_score_matches_engine_formula():
    """_score_df_with_rules must use binary pass/fail to match rule_engine."""
    import pandas as pd
    from dq_tools.transformation_executor import _score_df_with_rules

    df = pd.DataFrame({"col_a": [None] * 54 + ["val"] * 69946})
    rules = [{"id": "r1", "category": "completeness", "check": "not_null",
              "column": "col_a", "threshold": 0.0}]
    score = _score_df_with_rules(df, rules)
    # 1 completeness rule, failing → completeness = 0/1 = 0.0
    # Overall = 0.0*0.4 + 1.0*0.4 + 1.0*0.2 = 0.6
    assert score < 0.65, f"Preview score should match engine: expected ~0.6, got {score:.4f}"
