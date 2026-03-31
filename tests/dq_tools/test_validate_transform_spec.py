"""Tests for validate_transform_spec in transformation_executor."""
import pandas as pd
import pytest
from dq_tools.transformation_executor import validate_transform_spec


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
