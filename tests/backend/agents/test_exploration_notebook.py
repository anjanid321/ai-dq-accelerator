# tests/backend/agents/test_exploration_notebook.py
import uuid
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


SAMPLE_FINDINGS = {
    "column_findings": [
        {
            "column": "Email",
            "semantic_meaning": "Customer contact email",
            "data_type_actual": "text",
            "stats": {"null_count": 10, "null_pct": 1.0, "distinct_count": 990, "total_rows": 1000},
            "full_analysis": "Email column analysis: 30 values fail format check.",
            "issues": [
                {
                    "description": "30 values fail email format",
                    "severity": "warning",
                    "count": 30,
                    "pct": 3.0,
                    "sample_values": ["noemail"],
                    "where_clause": "email NOT LIKE '%@%'",
                }
            ],
            "assumptions": ["Nulls assumed to be missing data"],
            "rule_implications": ["Validity rule: email format regex"],
        }
    ],
    "cross_column_findings": [
        {
            "columns": ["EmployeeGroup", "HireDate"],
            "full_analysis": "Group rename detected at 2022-04.",
            "pattern": "Field-Ops → FieldOperations rename at boundary",
            "severity": "critical",
            "investigation_sql": "SELECT EmployeeGroup, COUNT(*) FROM working_data GROUP BY 1",
            "rule_implications": ["Standardize EmployeeGroup before aggregation"],
        }
    ],
    "open_questions": ["Are Email nulls intentional for online accounts?"],
    "readiness_assessment": "moderate",
    "key_risks": ["EmployeeGroup inconsistency will corrupt group-level analysis"],
}


@pytest.fixture
def session_id(tmp_path, monkeypatch):
    """Minimal DuckDB session for notebook generation tests."""
    import duckdb
    import pandas as pd

    sid = str(uuid.uuid4())

    import backend.agents.graphs.exploration_notebook as nb_mod
    monkeypatch.setattr(nb_mod, "_find_project_root", lambda: tmp_path)

    session_dir = tmp_path / "data" / "sessions" / sid
    session_dir.mkdir(parents=True)
    db_path = session_dir / "working.duckdb"
    df = pd.DataFrame({
        "Email": [f"u{i}@x.com" for i in range(95)] + [None] * 5,
        "EmployeeGroup": ["Field-Ops"] * 50 + ["FieldOperations"] * 50,
        "Salary": list(range(1000, 2000, 10)),
    })
    con = duckdb.connect(str(db_path))
    con.execute("CREATE TABLE working_data AS SELECT * FROM df")
    con.close()

    output_dir = tmp_path / "output" / "sessions" / sid
    output_dir.mkdir(parents=True)
    return sid


def test_build_notebook_returns_valid_notebook(session_id):
    import nbformat
    from backend.agents.graphs.exploration_notebook import _build_notebook

    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "raw investigation text")
    assert isinstance(nb, nbformat.NotebookNode)
    assert len(nb.cells) > 0


def test_build_notebook_contains_open_questions(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "raw text")
    all_text = " ".join(c.source for c in nb.cells if c.cell_type == "markdown")
    assert "Are Email nulls intentional" in all_text


def test_build_notebook_contains_column_section(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "raw text")
    all_text = " ".join(c.source for c in nb.cells if c.cell_type == "markdown")
    assert "Email" in all_text
    assert "Customer contact email" in all_text


def test_build_notebook_contains_cross_column_section(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "raw text")
    all_text = " ".join(c.source for c in nb.cells if c.cell_type == "markdown")
    assert "Cross-Column" in all_text
    assert "EmployeeGroup" in all_text


def test_build_notebook_contains_raw_appendix(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "MY RAW INVESTIGATION TEXT MARKER")
    all_text = " ".join(c.source for c in nb.cells if c.cell_type == "markdown")
    assert "MY RAW INVESTIGATION TEXT MARKER" in all_text


def test_build_notebook_contains_rule_implications(session_id):
    from backend.agents.graphs.exploration_notebook import _build_notebook

    nb = _build_notebook(session_id, SAMPLE_FINDINGS, "raw text")
    all_text = " ".join(c.source for c in nb.cells if c.cell_type == "markdown")
    assert "Preliminary Rule Implications" in all_text
    assert "Validity rule: email format regex" in all_text


def test_generate_exploration_notebook_writes_files(session_id, tmp_path):
    from backend.agents.graphs.exploration_notebook import generate_exploration_notebook

    # Mock ExecutePreprocessor to avoid running a real kernel in tests
    with patch("backend.agents.graphs.exploration_notebook.ExecutePreprocessor") as mock_ep:
        mock_ep.return_value.preprocess = MagicMock()
        ipynb_path, html_path = generate_exploration_notebook(
            session_id, SAMPLE_FINDINGS, "raw investigation text"
        )

    assert Path(ipynb_path).exists()
    assert Path(html_path).exists()
    assert ipynb_path.endswith(".ipynb")
    assert html_path.endswith(".html")
