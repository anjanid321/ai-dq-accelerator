"""Tests for validate_transform_spec and _apply_transform in transformation_executor."""
import pandas as pd
import numpy as np
import pytest
from dq_tools.transformation_executor import validate_transform_spec, _apply_transform, _to_safe_records


@pytest.fixture()
def sample_df():
    return pd.DataFrame({
        "email": ["a@b.com", "bad", None],
        "age": [25, 30.0, None],
        "created_at": pd.to_datetime(["2024-01-01", "2024-01-02", None]),
    })


def test_valid_single_column_spec(sample_df):
    spec = {"type": "impute_constant", "params": {"column": "age", "value": 0}}
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is True
    assert error is None


def test_missing_column_returns_error(sample_df):
    spec = {"type": "impute_constant", "params": {"column": "nonexistent", "value": 0}}
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is False
    assert "nonexistent" in error
    assert "Available" in error


def test_missing_multi_column_returns_error(sample_df):
    """date_format_cast uses params.columns (a list)."""
    spec = {
        "type": "date_format_cast",
        "params": {"columns": ["created_at", "missing_col"], "from_format": "%Y-%m-%d"},
    }
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is False
    assert "missing_col" in error


def test_unknown_transform_type_returns_error(sample_df):
    spec = {"type": "made_up_transform", "params": {}}
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is False
    assert error is not None


def test_valid_deduplicate_with_subset(sample_df):
    spec = {"type": "deduplicate", "params": {"subset_columns": ["email"]}}
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is True
    assert error is None


def test_null_invalid_with_pattern_is_valid(sample_df):
    spec = {"type": "null_invalid", "params": {"column": "email", "pattern": r"^[^@]+@[^@]+\.[^@]+$"}}
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is True
    assert error is None


def test_null_invalid_with_sentinel_values_is_valid(sample_df):
    spec = {"type": "null_invalid", "params": {"column": "email", "sentinel_values": ["nan", "N/A"]}}
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is True
    assert error is None


def test_null_invalid_with_both_pattern_and_sentinels_is_valid(sample_df):
    spec = {
        "type": "null_invalid",
        "params": {"column": "email", "pattern": r"^[^@]+@[^@]+\.[^@]+$", "sentinel_values": ["nan"]},
    }
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is True
    assert error is None


def test_null_invalid_without_pattern_or_sentinels_is_invalid(sample_df):
    """null_invalid with no actionable params should fail validation, not silently no-op."""
    spec = {"type": "null_invalid", "params": {"column": "email"}}
    valid, error = validate_transform_spec(spec, sample_df)
    assert valid is False
    assert error is not None
    assert "pattern" in (error or "") or "sentinel_values" in (error or "")


# ---------------------------------------------------------------------------
# _apply_transform behaviour tests
# ---------------------------------------------------------------------------

@pytest.fixture()
def email_df():
    return pd.DataFrame({
        "email": ["user@example.com", "nan", None, "bad@domain.com", "nan", "N/A"],
    })


def test_null_invalid_sentinel_values_nulls_matching_strings(email_df):
    """String 'nan' and 'N/A' should become NULL; real NULLs and valid emails unchanged."""
    spec = {"type": "null_invalid", "params": {"column": "email", "sentinel_values": ["nan", "N/A"]}}
    new_df, affected = _apply_transform(email_df, spec)
    assert affected == 3, "Expected 2x 'nan' + 1x 'N/A' = 3 affected rows"
    assert new_df["email"].isna().sum() == 4  # original 1 NULL + 3 newly nulled
    assert "nan" not in new_df["email"].dropna().values
    assert "N/A" not in new_df["email"].dropna().values


def test_null_invalid_pattern_and_sentinels_combined(email_df):
    """Rows not matching the valid pattern AND sentinel strings should all be nulled."""
    spec = {
        "type": "null_invalid",
        "params": {
            "column": "email",
            "pattern": r"^[^@]+@[^@]+\.[^@]+$",
            "sentinel_values": ["nan"],
        },
    }
    new_df, affected = _apply_transform(email_df, spec)
    # "nan" (2 rows) + "N/A" (1 row, doesn't match pattern) = 3 invalid
    assert affected == 3
    assert new_df["email"].isna().sum() == 4  # 1 original + 3 newly nulled


def test_standardize_string_preserves_null_values(email_df):
    """standardize_string must not convert NULL → 'nan' string."""
    null_before = email_df["email"].isna().sum()
    spec = {"type": "standardize_string", "params": {"column": "email", "strip": True, "lowercase": True}}
    new_df, affected = _apply_transform(email_df, spec)
    assert new_df["email"].isna().sum() == null_before, "NULLs must not be converted to 'nan' string"
    # Valid emails should be lowercased
    assert "user@example.com" in new_df["email"].values


def test_standardize_string_affected_count_excludes_nulls(email_df):
    """affected count should only reflect rows where non-null values actually changed."""
    df = pd.DataFrame({"name": ["  Alice  ", "BOB", None, "  charlie"]})
    spec = {"type": "standardize_string", "params": {"column": "name", "strip": True, "lowercase": True}}
    new_df, affected = _apply_transform(df, spec)
    # "  Alice  " → "alice" (changed), "BOB" → "bob" (changed), None stays None, "  charlie" → "charlie" (changed)
    assert affected == 3
    assert new_df["name"].isna().sum() == 1


# ---------------------------------------------------------------------------
# date_format_cast: source_formats support
# ---------------------------------------------------------------------------

@pytest.fixture()
def mixed_dates_df():
    return pd.DataFrame({
        "join_date": ["2020/02/20", "2019.12.01", "01/15/2020", "April 5, 2018", "03-25-2019"],
    })


def test_date_format_cast_source_formats_parses_all_rows(mixed_dates_df):
    """source_formats (list) should parse all rows across multiple date formats."""
    spec = {
        "type": "date_format_cast",
        "params": {
            "columns": ["join_date"],
            "source_formats": ["%Y/%m/%d", "%Y.%m.%d", "%m/%d/%Y", "%B %d, %Y", "%m-%d-%Y"],
            "target_format": "%Y-%m-%d",
        },
    }
    new_df, affected = _apply_transform(mixed_dates_df, spec)
    assert affected == 5
    assert new_df["join_date"].isna().sum() == 0
    assert new_df["join_date"].iloc[0] == "2020-02-20"
    assert new_df["join_date"].iloc[3] == "2018-04-05"


def test_date_format_cast_wrong_format_does_not_null_all_rows(mixed_dates_df):
    """A single from_format that only matches some rows should leave others as NaT/None."""
    spec = {
        "type": "date_format_cast",
        "params": {"columns": ["join_date"], "from_format": "%Y/%m/%d"},
    }
    new_df, affected = _apply_transform(mixed_dates_df, spec)
    # Only the first row matches %Y/%m/%d
    assert affected == 1
    assert new_df["join_date"].iloc[0] == "2020-02-20"
    assert new_df["join_date"].iloc[1] is None  # didn't match, coerced to NaT → None


def test_date_format_cast_missing_format_fails_validation(mixed_dates_df):
    """date_format_cast with neither from_format nor source_formats should fail validation."""
    spec = {"type": "date_format_cast", "params": {"columns": ["join_date"]}}
    valid, error = validate_transform_spec(spec, mixed_dates_df)
    assert valid is False
    assert error is not None
    assert "source_formats" in (error or "")


def test_date_format_cast_result_is_json_safe_string(mixed_dates_df):
    """Output dates should be plain strings, not datetime.date objects (JSON-safe)."""
    import json
    spec = {
        "type": "date_format_cast",
        "params": {"columns": ["join_date"], "from_format": "%Y/%m/%d"},
    }
    new_df, _ = _apply_transform(mixed_dates_df, spec)
    # Should be serialisable without a custom encoder
    records = new_df.to_dict(orient="records")
    json.dumps(records)  # raises if not JSON-safe


# ---------------------------------------------------------------------------
# _to_safe_records: NaT / NaN → None
# ---------------------------------------------------------------------------

def test_to_safe_records_converts_nat_to_none():
    """pd.NaT must become None so the result is JSON-serialisable."""
    df = pd.DataFrame({"ts": pd.to_datetime(["2024-01-01", None])})
    records = _to_safe_records(df)
    assert records[0]["ts"] == pd.Timestamp("2024-01-01")
    assert records[1]["ts"] is None


def test_to_safe_records_converts_nan_to_none():
    df = pd.DataFrame({"val": [1.0, np.nan, 3.0]})
    records = _to_safe_records(df)
    assert records[1]["val"] is None


def test_to_safe_records_all_nat_column():
    """All-NaT column (e.g. after a failed date_format_cast) must not raise."""
    import json
    df = pd.DataFrame({"date": pd.to_datetime(["nope", "also_nope"], errors="coerce")})
    assert df["date"].isna().all()
    records = _to_safe_records(df)
    json.dumps(records)  # must be JSON-serialisable
