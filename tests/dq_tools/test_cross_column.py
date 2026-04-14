# tests/dq_tools/test_cross_column.py
import uuid
import duckdb
import pandas as pd
import pytest
from datetime import datetime, timedelta
from pathlib import Path


@pytest.fixture
def session_id(tmp_path, monkeypatch):
    """DuckDB session with known cross-column patterns."""
    sid = str(uuid.uuid4())
    n = 100
    dates = [datetime(2023, 1, 1) + timedelta(days=i * 3) for i in range(n)]
    employee_groups = ["Field-Ops"] * 50 + ["FieldOperations"] * 50
    departments = (["Office"] * 30 + ["Remote"] * 20) * 2
    emails = [None if departments[i] == "Remote" else f"u{i}@x.com" for i in range(n)]
    salaries = [30000 + i * 500 for i in range(n)]
    ages = [22 + i // 3 for i in range(n)]

    df = pd.DataFrame({
        "HireDate": dates,
        "EmployeeGroup": employee_groups,
        "Department": departments,
        "Email": emails,
        "Salary": salaries,
        "Age": ages,
    })

    # Patch _find_project_root to point at tmp_path
    from dq_tools import explorer as explorer_mod
    monkeypatch.setattr(explorer_mod, "_find_project_root", lambda: tmp_path)

    import dq_tools.cross_column as cc_mod
    monkeypatch.setattr(cc_mod, "_find_project_root", lambda: tmp_path)

    session_dir = tmp_path / "data" / "sessions" / sid
    session_dir.mkdir(parents=True)
    db_path = session_dir / "working.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute("CREATE TABLE working_data AS SELECT * FROM df")
    con.close()
    return sid


class TestGroupOverTime:
    def test_detects_value_set_change(self, session_id):
        from dq_tools.cross_column import group_over_time
        result = group_over_time(session_id, "EmployeeGroup", "HireDate", bins=4)
        assert "distribution" in result
        bins = list(result["distribution"].items())
        early_vals = {item["value"] for item in bins[0][1]}
        late_vals = {item["value"] for item in bins[-1][1]}
        assert "Field-Ops" in early_vals
        assert "FieldOperations" in late_vals

    def test_missing_column_returns_error(self, session_id):
        from dq_tools.cross_column import group_over_time
        result = group_over_time(session_id, "NoSuchCol", "HireDate")
        assert "error" in result

    def test_non_datetime_column_returns_error(self, session_id):
        from dq_tools.cross_column import group_over_time
        result = group_over_time(session_id, "EmployeeGroup", "Department")
        assert "error" in result


class TestFindCorrelatedNulls:
    def test_finds_pairs(self, session_id):
        from dq_tools.cross_column import find_correlated_nulls
        result = find_correlated_nulls(session_id, threshold=0.0)
        assert "pairs" in result
        assert isinstance(result["pairs"], list)

    def test_phi_in_range(self, session_id):
        from dq_tools.cross_column import find_correlated_nulls
        result = find_correlated_nulls(session_id, threshold=0.0)
        for pair in result["pairs"]:
            assert -1.0 <= pair["phi"] <= 1.0

    def test_threshold_filters(self, session_id):
        from dq_tools.cross_column import find_correlated_nulls
        low = find_correlated_nulls(session_id, threshold=0.0)
        high = find_correlated_nulls(session_id, threshold=0.99)
        assert len(low["pairs"]) >= len(high["pairs"])


class TestPairwiseProfile:
    def test_numeric_vs_numeric(self, session_id):
        from dq_tools.cross_column import pairwise_profile
        result = pairwise_profile(session_id, "Salary", "Age")
        assert result["type"] == "numeric_vs_numeric"
        assert result["correlation"] > 0

    def test_categorical_vs_categorical(self, session_id):
        from dq_tools.cross_column import pairwise_profile
        result = pairwise_profile(session_id, "EmployeeGroup", "Department")
        assert result["type"] == "categorical_vs_categorical"
        assert "crosstab" in result

    def test_mixed(self, session_id):
        from dq_tools.cross_column import pairwise_profile
        result = pairwise_profile(session_id, "Department", "Salary")
        assert result["type"] == "categorical_vs_numeric"
        assert len(result["group_stats"]) > 0

    def test_missing_column_error(self, session_id):
        from dq_tools.cross_column import pairwise_profile
        result = pairwise_profile(session_id, "NoCol", "Salary")
        assert "error" in result


class TestComputeCorrelationMatrix:
    def test_returns_matrix(self, session_id):
        from dq_tools.cross_column import compute_correlation_matrix
        result = compute_correlation_matrix(session_id)
        assert "matrix" in result
        assert "Salary" in result["matrix"]
        assert "Age" in result["matrix"]["Salary"]

    def test_salary_age_positive(self, session_id):
        from dq_tools.cross_column import compute_correlation_matrix
        result = compute_correlation_matrix(session_id, columns=["Salary", "Age"])
        assert result["matrix"]["Salary"]["Age"] > 0

    def test_specific_columns(self, session_id):
        from dq_tools.cross_column import compute_correlation_matrix
        result = compute_correlation_matrix(session_id, columns=["Salary", "Age"])
        assert set(result["columns"]) == {"Salary", "Age"}

    def test_missing_column_error(self, session_id):
        from dq_tools.cross_column import compute_correlation_matrix
        result = compute_correlation_matrix(session_id, columns=["NoCol"])
        assert "error" in result
