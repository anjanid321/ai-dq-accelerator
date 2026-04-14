"""Exploration notebook generator.

Builds a pre-executed .ipynb and a self-contained HTML export from
ExplorationFindings JSON + raw investigation_findings text.

Public API:
    generate_exploration_notebook(session_id, exploration_findings, investigation_findings)
        -> tuple[str, str]  # (ipynb_path, html_path)
"""
from __future__ import annotations

import logging

import nbformat
from nbformat.v4 import new_notebook, new_markdown_cell, new_code_cell
from nbconvert.preprocessors import ExecutePreprocessor
from nbconvert import HTMLExporter

from backend.agents.emit import _find_project_root

logger = logging.getLogger(__name__)


def _db_path_str(session_id: str) -> str:
    return str(_find_project_root() / "data" / "sessions" / session_id / "working.duckdb")


def _setup_cell(session_id: str) -> str:
    db_path = _db_path_str(session_id)
    return f"""import duckdb
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np

SESSION_DB = {db_path!r}
con = duckdb.connect(SESSION_DB, read_only=True)
df = con.execute("SELECT * FROM working_data").df()
print(f"Dataset: {{len(df):,}} rows x {{len(df.columns)}} columns")
print(f"Columns: {{', '.join(df.columns)}}")""".strip()


def _distribution_cell(column: str, data_type: str, issues: list) -> str:
    issue_sample_vals = repr(
        [str(s) for issue in issues for s in issue.get("sample_values", [])][:10]
    )
    if data_type in ("numeric", "int", "float", "integer"):
        return f"""col = df[{column!r}].dropna()
if len(col) > 0:
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.hist(col, bins=min(50, max(10, col.nunique())), color='steelblue', alpha=0.7, edgecolor='white')
    for stat, fn, color, ls in [
        ('mean', lambda s: s.mean(), 'red', '--'),
        ('median', lambda s: s.median(), 'orange', '-'),
        ('p5', lambda s: s.quantile(0.05), 'green', ':'),
        ('p95', lambda s: s.quantile(0.95), 'green', ':'),
    ]:
        val = fn(col)
        ax.axvline(val, color=color, linestyle=ls, linewidth=1.5, label=f'{{stat}}={{val:.2f}}')
    ax.set_title(f{repr(column + " — Distribution (n={:,})")}.format(len(col)))
    ax.set_xlabel({column!r})
    ax.set_ylabel('Count')
    ax.legend(fontsize=8)
    plt.tight_layout()
    plt.show()""".strip()
    else:
        return f"""vc = df[{column!r}].value_counts(dropna=False).head(25)
issue_vals = {issue_sample_vals}
colors = ['#e07b39' if str(v) in issue_vals else 'steelblue' for v in vc.index]
fig, ax = plt.subplots(figsize=(10, max(4, len(vc) * 0.35)))
ax.barh([str(v) for v in vc.index], vc.values, color=colors)
ax.set_title({repr(column + " — Top value counts  (orange = flagged values)")!r})
ax.set_xlabel('Count')
ax.invert_yaxis()
for i, (lbl, val) in enumerate(zip([str(v) for v in vc.index], vc.values)):
    ax.text(val * 1.005, i, f'{{val:,}}', va='center', fontsize=8)
plt.tight_layout()
plt.show()
print(f"Showing top 25 of {{df[{column!r}].nunique()}} distinct values | Nulls: {{df[{column!r}].isnull().sum():,}}")""".strip()


def _failing_rows_cell(column: str, issue_desc: str, where_clause: str, count) -> str:
    count_str = f"~{count:,}" if isinstance(count, int) else "?"
    return f"""# Failing rows: {issue_desc[:60]}
try:
    failing = con.execute("SELECT * FROM working_data WHERE {where_clause} LIMIT 25").df()
    print(f"{{len(failing)}} sample rows shown (total: {count_str})")
    display(failing)
except Exception as e:
    print(f"Could not run filter: {{e}}")""".strip()


def _cross_column_viz_cell(finding_idx: int, cols: list, sql: str) -> str:
    title = f"Cross-column finding {finding_idx}: {' x '.join(cols)}"
    return f"""try:
    result = con.execute({sql!r}).df()
    print(result.to_string())
    if len(result.columns) >= 2 and len(result) > 1:
        fig, ax = plt.subplots(figsize=(12, 5))
        x_col, y_col = result.columns[0], result.columns[1]
        if pd.api.types.is_numeric_dtype(result[y_col]):
            ax.bar(result[x_col].astype(str), result[y_col])
            ax.set_ylabel(str(y_col))
        else:
            result[y_col].value_counts().head(20).plot(kind='bar', ax=ax)
        ax.set_title({title!r})
        ax.set_xlabel(str(x_col))
        plt.xticks(rotation=45, ha='right')
        plt.tight_layout()
        plt.show()
except Exception as e:
    print(f"Visualization error: {{e}}")""".strip()


def _build_notebook(
    session_id: str,
    exploration_findings: dict,
    investigation_findings: str,
) -> nbformat.NotebookNode:
    nb = new_notebook()
    cells = []

    # Title + setup
    cells.append(new_markdown_cell(f"# Data Exploration Report\n\n**Session:** `{session_id}`"))
    cells.append(new_code_cell(_setup_cell(session_id)))

    # Open questions — pinned at top
    open_questions = exploration_findings.get("open_questions", [])
    if open_questions:
        oq_lines = "\n".join(f"{i}. {q}" for i, q in enumerate(open_questions, 1))
        cells.append(new_markdown_cell(
            f"## Open Questions for Review\n\n"
            f"> **Answer these before approving — the agent could not resolve them from data alone.**\n\n"
            f"{oq_lines}"
        ))

    # Key risks + readiness
    key_risks = exploration_findings.get("key_risks", [])
    readiness = exploration_findings.get("readiness_assessment", "unknown")
    if key_risks or readiness != "unknown":
        risk_lines = "".join(f"- {r}\n" for r in key_risks)
        risks_section = ("**Key risks:**\n\n" + risk_lines) if key_risks else ""
        cells.append(new_markdown_cell(
            f"## Dataset Readiness: **{readiness.upper()}**\n\n"
            f"{risks_section}"
        ))

    # Per-column sections
    cells.append(new_markdown_cell("---\n\n## Per-Column Findings"))
    for cf in exploration_findings.get("column_findings", []):
        column = cf.get("column", "unknown")
        if column == "__raw__":
            cells.append(new_markdown_cell(
                f"## Raw Investigation Findings\n\n{cf.get('full_analysis', '')}"
            ))
            continue

        stats = cf.get("stats", {})
        issues = cf.get("issues", [])
        assumptions = cf.get("assumptions", [])
        rule_implications = cf.get("rule_implications", [])

        # Stats table
        if stats.get("total_rows"):
            stats_md = (
                f"\n\n| Metric | Value |\n|--------|-------|\n"
                f"| Total rows | {stats['total_rows']:,} |\n"
                f"| Null count | {stats.get('null_count', '?')} ({stats.get('null_pct', '?')}%) |\n"
                f"| Distinct values | {stats.get('distinct_count', '?')} |"
            )
        else:
            stats_md = ""

        # Issues
        issues_md = ""
        if issues:
            icon = {"critical": "🔴", "warning": "🟡", "info": "🔵"}
            issues_md = "\n\n**Issues found:**\n\n"
            for issue in issues:
                ic = icon.get(issue.get("severity", "info"), "⚪")
                count = issue.get("count")
                pct = issue.get("pct")
                count_str = f" ({count:,} rows, {pct}%)" if count is not None else ""
                issues_md += f"{ic} {issue['description']}{count_str}\n"
                samples = issue.get("sample_values", [])
                if samples:
                    issues_md += f"   Sample values: `{'`, `'.join(str(s) for s in samples[:5])}`\n"

        assumptions_md = ""
        if assumptions:
            assumptions_md = "\n\n> **Assumptions (verify with business context):**\n"
            for a in assumptions:
                assumptions_md += f"> - {a}\n"

        rule_md = ""
        if rule_implications:
            rule_md = "\n\n**Rule implications:**\n" + "".join(f"- {r}\n" for r in rule_implications)

        cells.append(new_markdown_cell(
            f"### {column}\n\n"
            f"**Semantic meaning:** {cf.get('semantic_meaning', '')}\n\n"
            f"**Data type:** {cf.get('data_type_actual', '')}"
            f"{stats_md}\n\n"
            f"{cf.get('full_analysis', '')}"
            f"{issues_md}{assumptions_md}{rule_md}"
        ))

        # Distribution plot
        cells.append(new_code_cell(
            _distribution_cell(column, cf.get("data_type_actual", "text"), issues)
        ))

        # Failing rows tables
        for issue in issues:
            wc = issue.get("where_clause")
            if wc:
                cells.append(new_code_cell(
                    _failing_rows_cell(column, issue["description"], wc, issue.get("count"))
                ))

    # Cross-column findings
    cross = exploration_findings.get("cross_column_findings", [])
    if cross:
        cells.append(new_markdown_cell("---\n\n## Cross-Column Findings"))
        for i, finding in enumerate(cross, 1):
            cols = finding.get("columns", [])
            severity = finding.get("severity", "info")
            label = {"critical": "[CRITICAL]", "warning": "[WARNING]", "info": "[INFO]"}.get(severity, "")
            rule_md = ""
            if finding.get("rule_implications"):
                rule_md = "\n\n**Rule implications:**\n" + "".join(
                    f"- {r}\n" for r in finding["rule_implications"]
                )
            cells.append(new_markdown_cell(
                f"### Finding {i} — {' × '.join(cols)} {label}\n\n"
                f"{finding.get('full_analysis', '')}\n\n"
                f"**Pattern:** {finding.get('pattern', '')}"
                f"{rule_md}"
            ))
            sql = finding.get("investigation_sql")
            if sql:
                cells.append(new_code_cell(_cross_column_viz_cell(i, cols, sql)))

    # Preliminary rule implications
    all_implications = []
    for cf in exploration_findings.get("column_findings", []):
        for r in cf.get("rule_implications", []):
            all_implications.append({
                "label": cf["column"],
                "implication": r,
                "assumptions": cf.get("assumptions", []),
            })
    for cf in exploration_findings.get("cross_column_findings", []):
        for r in cf.get("rule_implications", []):
            all_implications.append({
                "label": " × ".join(cf.get("columns", [])),
                "implication": r,
                "assumptions": [],
            })
    if all_implications:
        cells.append(new_markdown_cell(
            "---\n\n## Preliminary Rule Implications\n\n"
            "> **These are directions for review — not the final rule set. "
            "Formal rules are proposed after you approve this notebook.**"
        ))
        for item in all_implications:
            assumption_md = ""
            if item["assumptions"]:
                assumption_md = "\n\n" + "".join(f"> Assumption: {a}\n" for a in item["assumptions"])
            cells.append(new_markdown_cell(
                f"**{item['label']}:** {item['implication']}{assumption_md}"
            ))

    # Appendix: raw investigation notes
    cells.append(new_markdown_cell(
        "---\n\n## Appendix: Raw Investigation Notes\n\n"
        "> **This is the agent's unstructured output before structured extraction. "
        "If anything in the sections above seems incomplete, check here.**\n\n"
        f"{investigation_findings}"
    ))

    nb.cells = cells
    return nb


def generate_exploration_notebook(
    session_id: str,
    exploration_findings: dict,
    investigation_findings: str,
) -> tuple[str, str]:
    """Generate a pre-executed exploration notebook.

    Writes exploration_notebook.ipynb and exploration_notebook.html to
    output/sessions/{session_id}/. Returns (ipynb_path, html_path).
    The HTML is self-contained (base64 plots, embedded CSS) for browser viewing.
    """
    project_root = _find_project_root()
    output_dir = project_root / "output" / "sessions" / session_id
    output_dir.mkdir(parents=True, exist_ok=True)

    nb = _build_notebook(session_id, exploration_findings, investigation_findings)

    ep = ExecutePreprocessor(timeout=300, kernel_name="python3")
    try:
        ep.preprocess(nb, {"metadata": {"path": str(project_root)}})
    except Exception as e:
        logger.warning(
            "[exploration_notebook:%s] Execution errors (partial output preserved): %s",
            session_id[:8], e,
        )

    ipynb_path = output_dir / "exploration_notebook.ipynb"
    with open(ipynb_path, "w", encoding="utf-8") as f:
        nbformat.write(nb, f)

    exporter = HTMLExporter()
    exporter.theme = "light"
    body, _ = exporter.from_notebook_node(nb)
    html_path = output_dir / "exploration_notebook.html"
    html_path.write_text(body, encoding="utf-8")

    logger.info("[exploration_notebook:%s] Written to %s", session_id[:8], output_dir)
    return str(ipynb_path), str(html_path)
