"""Tests for targeted preview sampling in transformation_executor.preview()."""
import pandas as pd
import pytest
from unittest.mock import patch

# We test the internal helper directly to avoid needing a real DuckDB session.
from dq_tools.transformation_executor import _get_preview_indices


@pytest.fixture()
def sample_df():
    return pd.DataFrame({
        "email": ["good@example.com", "bad-email", "INVALID", "ok@test.com", "x@y.com"],
        "age":   [25, 30, -1, 40, 22],
        "name":  ["Alice", "Bob", "Charlie", "Dan", "Eve"],
    })


@pytest.fixture()
def email_rule():
    return {
        "id": "r1",
        "category": "validity",
        "column": "email",
        "check": "regex_match",
        "pattern": r"^[^@]+@[^@]+\.[^@]+$",
        "threshold": 0.0,
    }


def test_returns_failing_rows_first(sample_df, email_rule):
    """Failing rows should appear before passing rows in the index list."""
    spec = {"type": "null_invalid", "params": {"column": "email", "pattern": r"^[^@]+@[^@]+\.[^@]+$"}}
    indices = _get_preview_indices(sample_df, spec, [email_rule])
    # rows 1 ("bad-email") and 2 ("INVALID") fail the regex
    failing_indices = [i for i in indices if sample_df.loc[i, "email"] in ("bad-email", "INVALID")]
    passing_indices = [i for i in indices if sample_df.loc[i, "email"] not in ("bad-email", "INVALID")]
    assert len(failing_indices) >= 1, "Expected at least one failing row"
    assert len(passing_indices) >= 1, "Expected at least one passing row for contrast"
    # Failing indices come first
    assert indices.index(failing_indices[0]) < indices.index(passing_indices[0])


def test_deduplicates_failing_values(sample_df, email_rule):
    """Duplicate failure values should only appear once."""
    df_with_dupes = pd.DataFrame({
        "email": ["bad-email", "bad-email", "bad-email", "good@x.com", "ok@y.com"],
    })
    spec = {"type": "null_invalid", "params": {"column": "email", "pattern": r"^[^@]+@[^@]+\.[^@]+$"}}
    indices = _get_preview_indices(df_with_dupes, spec, [email_rule])
    # "bad-email" should appear only once after dedup
    email_values = [df_with_dupes.loc[i, "email"] for i in indices]
    assert email_values.count("bad-email") == 1


def test_falls_back_to_head5_when_no_rules(sample_df):
    """No approved_rules → first 5 rows."""
    spec = {"type": "null_invalid", "params": {"column": "email"}}
    indices = _get_preview_indices(sample_df, spec, None)
    assert indices == list(sample_df.head(5).index)


def test_falls_back_to_head5_when_no_relevant_rules(sample_df, email_rule):
    """Transform targets a different column than the rule → first 5 rows."""
    spec = {"type": "impute_constant", "params": {"column": "age", "value": 0}}
    # email_rule is for "email", not "age"
    indices = _get_preview_indices(sample_df, spec, [email_rule])
    assert indices == list(sample_df.head(5).index)


def test_falls_back_to_head5_when_all_pass(sample_df):
    """All rows pass the rule → first 5 rows."""
    all_good = pd.DataFrame({"email": ["a@b.com", "c@d.com", "e@f.com"]})
    spec = {"type": "null_invalid", "params": {"column": "email", "pattern": r"^[^@]+@[^@]+\.[^@]+$"}}
    rule = {
        "id": "r1", "category": "validity", "column": "email",
        "check": "regex_match", "pattern": r"^[^@]+@[^@]+\.[^@]+$", "threshold": 0.0,
    }
    indices = _get_preview_indices(all_good, spec, [rule])
    assert indices == list(all_good.head(5).index)


def test_not_null_rule_surfaces_null_rows():
    """not_null check should surface rows where the column is null."""
    df = pd.DataFrame({"score": [None, None, 10.0, 20.0, 30.0]})
    rule = {"id": "r1", "category": "completeness", "column": "score", "check": "not_null", "threshold": 0.0}
    spec = {"type": "impute_constant", "params": {"column": "score", "value": 0}}
    indices = _get_preview_indices(df, spec, [rule])
    null_indices = [i for i in indices if pd.isna(df.loc[i, "score"])]
    assert len(null_indices) >= 1


def test_range_rule_surfaces_out_of_range_rows():
    """range check should surface rows outside min/max."""
    df = pd.DataFrame({"age": [-5, 200, 25, 30, 40]})
    rule = {"id": "r1", "category": "validity", "column": "age", "check": "range",
            "min": 0, "max": 120, "threshold": 0.0}
    spec = {"type": "winsorize", "params": {"column": "age", "cap_value": 120}}
    indices = _get_preview_indices(df, spec, [rule])
    bad_indices = [i for i in indices if df.loc[i, "age"] in (-5, 200)]
    assert len(bad_indices) >= 1


def test_at_most_3_failing_and_2_passing_rows(sample_df, email_rule):
    """Result should have at most 3 failing rows and at most 2 passing rows."""
    # Use distinct bad values so dedup doesn't collapse them — this actually
    # exercises the head(3) cap, not just the dedup step.
    bad_emails = [f"bad{i}@" for i in range(10)]   # distinct, all fail regex (no domain TLD)
    good_emails = ["good@x.com"] * 10
    big_df = pd.DataFrame({"email": bad_emails + good_emails})
    spec = {"type": "null_invalid", "params": {"column": "email", "pattern": r"^[^@]+@[^@]+\.[^@]+$"}}
    indices = _get_preview_indices(big_df, spec, [email_rule])
    bad = [i for i in indices if not big_df.loc[i, "email"].startswith("good")]
    good = [i for i in indices if big_df.loc[i, "email"].startswith("good")]
    assert len(bad) <= 3
    assert len(good) <= 2
    # Must have selected some failing rows (not degenerate fallback)
    assert len(bad) >= 1
