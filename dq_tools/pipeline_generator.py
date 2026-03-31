"""Pipeline generator for the AI Data Quality Accelerator.

Produces ready-to-use dbt models, Airflow DAG, Pandera data contract,
Python pipeline, and a README from session artefacts.
"""

from __future__ import annotations

import json
import shutil
import textwrap
from datetime import datetime, timezone
from pathlib import Path

import yaml

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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


def _output_dir(session_id: str) -> Path:
    return _find_project_root() / "output" / "sessions" / session_id


def _jinja_env():
    """Build a Jinja2 Environment pointed at the ``templates/`` directory."""
    from jinja2 import Environment, FileSystemLoader, StrictUndefined

    templates_dir = _find_project_root() / "templates"
    env = Environment(
        loader=FileSystemLoader(str(templates_dir)),
        autoescape=False,
        undefined=StrictUndefined,
        keep_trailing_newline=True,
    )
    # Custom filter used in dag.py.j2
    env.filters["tojson"] = json.dumps
    return env


# Map transformation type to template path relative to templates/dbt/
_DBT_TEMPLATE_MAP: dict[str, str] = {
    "date_format_cast": "dbt/date_cast.sql.j2",
    "null_invalid": "dbt/email_null.sql.j2",
    "filter_rows": "dbt/filter_rows.sql.j2",
    "winsorize": "dbt/winsorize.sql.j2",
    "impute_constant": "dbt/impute.sql.j2",
    "impute_mode": "dbt/impute.sql.j2",
}


def _render_dbt_model(
    env,
    transform: dict,
    source_table: str,
    all_columns: list[str],
    out_dir: Path,
) -> None:
    """Render a dbt SQL model for a single transformation (if a template exists)."""
    t_type = transform.get("type", "")
    template_path = _DBT_TEMPLATE_MAP.get(t_type)
    if template_path is None:
        return  # no dbt model for this type

    templates_dir = _find_project_root() / "templates"
    if not (templates_dir / template_path).exists():
        return  # template file missing — skip gracefully

    try:
        tmpl = env.get_template(template_path)
        params = transform.get("params", {})
        # impute template needs fill_value key
        if t_type == "impute_constant":
            params = dict(params, fill_value=params.get("value"))
        elif t_type == "impute_mode":
            params = dict(params, fill_value=None)

        sql = tmpl.render(
            transformation_id=transform.get("id", "unknown"),
            source_table=source_table,
            all_columns=all_columns,
            params=params,
        )
    except Exception:
        return  # rendering error — skip gracefully

    t_id = transform.get("id", "unknown")
    model_name = f"stg_{t_id}_{t_type}.sql"
    model_path = out_dir / model_name
    model_path.write_text(sql)


def _generate_dbt_project_yml(session_id: str, out_dir: Path) -> None:
    """Write a minimal dbt_project.yml."""
    content = yaml.dump(
        {
            "name": f"dq_{session_id[:8]}",
            "version": "1.0.0",
            "config-version": 2,
            "profile": "default",
            "model-paths": ["models"],
            "test-paths": ["tests"],
            "models": {
                f"dq_{session_id[:8]}": {
                    "staging": {
                        "+materialized": "table",
                    }
                }
            },
        },
        default_flow_style=False,
        sort_keys=False,
    )
    (out_dir / "dbt_project.yml").write_text(content)


def _generate_dbt_tests(rules: list[dict], tests_dir: Path) -> None:
    """Write one dbt schema.yml per approved rule."""
    tests_dir.mkdir(parents=True, exist_ok=True)
    for rule in rules:
        rule_id = rule.get("id", "unknown")
        check = rule.get("check", "unknown")
        col = rule.get("column")

        tests_entry: dict = {}
        if check == "not_null" and col:
            tests_entry = {
                "name": col,
                "tests": ["not_null"],
            }
        elif check == "unique" and col:
            tests_entry = {
                "name": col,
                "tests": ["unique"],
            }
        elif check == "value_in_set" and col:
            tests_entry = {
                "name": col,
                "tests": [{"accepted_values": {"values": rule.get("values", [])}}],
            }
        elif check == "regex_match" and col:
            tests_entry = {
                "name": col,
                "tests": [
                    {
                        "dbt_utils.expression_is_true": {
                            "expression": f"regexp_matches(CAST({col} AS VARCHAR), '{rule.get('pattern', '')}') OR {col} IS NULL"
                        }
                    }
                ],
            }
        elif check == "range" and col:
            expr_parts = []
            if rule.get("min") is not None:
                expr_parts.append(f"{col} >= {rule['min']}")
            if rule.get("max") is not None:
                expr_parts.append(f"{col} <= {rule['max']}")
            if expr_parts:
                tests_entry = {
                    "name": col,
                    "tests": [
                        {"dbt_utils.expression_is_true": {"expression": " AND ".join(expr_parts)}}
                    ],
                }

        if not tests_entry:
            continue

        schema = {
            "version": 2,
            "models": [
                {
                    "name": "working_data",
                    "columns": [tests_entry],
                }
            ],
        }
        (tests_dir / f"schema_{rule_id}.yml").write_text(
            yaml.dump(schema, default_flow_style=False, sort_keys=False)
        )


def _generate_pandera_schema(rules: list[dict], out_path: Path) -> None:
    """Generate a Pandera schema from approved rules."""
    checks_by_col: dict[str, list[str]] = {}
    for rule in rules:
        col = rule.get("column")
        if not col:
            continue
        check = rule.get("check", "")
        if col not in checks_by_col:
            checks_by_col[col] = []
        if check == "not_null":
            checks_by_col[col].append("nullable=False")
        elif check == "unique":
            checks_by_col[col].append("unique=True")
        elif check == "range":
            parts = []
            if rule.get("min") is not None:
                parts.append(f"pa.Check.ge({rule['min']})")
            if rule.get("max") is not None:
                parts.append(f"pa.Check.le({rule['max']})")
            if parts:
                checks_by_col[col].append(f"checks=[{', '.join(parts)}]")
        elif check == "regex_match":
            pattern = rule.get("pattern", "").replace("\\", "\\\\")
            checks_by_col[col].append(f'checks=[pa.Check.str_matches(r"{pattern}")]')
        elif check == "value_in_set":
            values = rule.get("values", [])
            checks_by_col[col].append(f"checks=[pa.Check.isin({values!r})]")

    col_lines: list[str] = []
    for col, checks in checks_by_col.items():
        # Combine nullable/unique flags and check list
        nullable = "nullable=True"
        unique = "unique=False"
        check_args: list[str] = []
        for c in checks:
            if c.startswith("nullable"):
                nullable = c
            elif c.startswith("unique"):
                unique = c
            elif c.startswith("checks"):
                check_args.append(c)
        all_checks = ", ".join(check_args) if check_args else ""
        if all_checks:
            col_lines.append(f'    "{col}": pa.Column({nullable}, {unique}, {all_checks}),')
        else:
            col_lines.append(f'    "{col}": pa.Column({nullable}, {unique}),')

    code = textwrap.dedent(
        f"""\
        \"\"\"Auto-generated Pandera data contract.

        Generated by AI DQ Accelerator.
        \"\"\"
        import pandera as pa

        schema = pa.DataFrameSchema(
            {{
        {chr(10).join(col_lines)}
            }},
            coerce=True,
        )


        def validate(df):
            \"\"\"Validate a pandas DataFrame against the DQ schema.\"\"\"
            return schema.validate(df)
        """
    )
    out_path.write_text(code)


def _generate_python_pipeline(
    transformation_log: list[dict],
    session_id: str,
    out_dir: Path,
) -> None:
    """Generate a self-contained pandas transform.py pipeline script."""
    applied = [t for t in transformation_log if t.get("status") == "applied"]

    blocks: list[str] = [
        textwrap.dedent(
            f'''\
            """Auto-generated Python data quality pipeline.

            Session: {session_id}
            Generated by AI DQ Accelerator.

            Usage:
                python transform.py input.parquet output.parquet
            """
            from __future__ import annotations

            import sys
            import re
            import numpy as np
            import pandas as pd


            def run_pipeline(df: pd.DataFrame) -> pd.DataFrame:
                """Apply all approved transformations in order."""
            '''
        )
    ]

    if not applied:
        blocks.append("    return df")
    else:
        for t in applied:
            t_type = t.get("type", "")
            params = t.get("params", {})
            t_id = t.get("id", "")
            blocks.append(f"    # Transformation: {t_id} ({t_type})")

            if t_type == "date_format_cast":
                cols = params.get("columns", [])
                fmt = params.get("from_format", "%Y-%m-%d")
                blocks.append(f"    for col in {cols!r}:")
                blocks.append(
                    f"        df[col] = pd.to_datetime(df[col], format={fmt!r}, errors='coerce').dt.date"
                )

            elif t_type == "null_invalid":
                col = params.get("column", "")
                pattern = params.get("pattern", "")
                blocks.append(
                    f"    mask = df[{col!r}].notna() & ~df[{col!r}].astype(str).str.match(r{pattern!r}, na=False)"
                )
                blocks.append(f"    df.loc[mask, {col!r}] = None")

            elif t_type == "filter_rows":
                col = params.get("column", "")
                op = params.get("operator", "eq")
                val = params.get("value")
                op_map = {
                    "eq": f"df[{col!r}] != {val!r}",
                    "ne": f"df[{col!r}] == {val!r}",
                    "lt": f"df[{col!r}] >= {val!r}",
                    "gt": f"df[{col!r}] <= {val!r}",
                    "lte": f"df[{col!r}] > {val!r}",
                    "gte": f"df[{col!r}] < {val!r}",
                    "in": f"~df[{col!r}].isin({val!r})",
                    "not_in": f"df[{col!r}].isin({val!r})",
                }
                expr = op_map.get(op, "True")
                blocks.append(f"    df = df[{expr}].reset_index(drop=True)")

            elif t_type == "winsorize":
                col = params.get("column", "")
                cap = params.get("cap_value")
                pct = params.get("percentile")
                if pct is not None:
                    blocks.append(f"    cap_{t_id} = df[{col!r}].quantile({pct})")
                    blocks.append(f"    df[{col!r}] = df[{col!r}].clip(upper=cap_{t_id})")
                else:
                    blocks.append(f"    df[{col!r}] = df[{col!r}].clip(upper={cap!r})")

            elif t_type == "impute_constant":
                col = params.get("column", "")
                val = params.get("value")
                blocks.append(f"    df[{col!r}] = df[{col!r}].fillna({val!r})")

            elif t_type == "impute_mode":
                col = params.get("column", "")
                blocks.append(f"    _mode_{t_id} = df[{col!r}].mode()")
                blocks.append(f"    if not _mode_{t_id}.empty:")
                blocks.append(f"        df[{col!r}] = df[{col!r}].fillna(_mode_{t_id}.iloc[0])")

            elif t_type == "deduplicate":
                subset = params.get("subset_columns")
                blocks.append(
                    f"    df = df.drop_duplicates(subset={subset!r}).reset_index(drop=True)"
                )

            elif t_type == "type_cast":
                col = params.get("column", "")
                to_type = params.get("to_type", "str")
                blocks.append(
                    f"    df[{col!r}] = pd.to_numeric(df[{col!r}], errors='coerce') "
                    f"if {to_type!r} in ('int', 'float', 'integer', 'double') "
                    f"else df[{col!r}].astype({to_type!r}, errors='ignore')"
                )

            elif t_type == "standardize_string":
                col = params.get("column", "")
                lc = params.get("lowercase", False)
                strip = params.get("strip", True)
                replace_pattern = params.get("replace_pattern")
                replace_with = params.get("replace_with", "")
                blocks.append(f"    _s_{t_id} = df[{col!r}].astype(str)")
                if strip:
                    blocks.append(f"    _s_{t_id} = _s_{t_id}.str.strip()")
                if lc:
                    blocks.append(f"    _s_{t_id} = _s_{t_id}.str.lower()")
                if replace_pattern:
                    blocks.append(
                        f"    _s_{t_id} = _s_{t_id}.str.replace(r{replace_pattern!r}, {replace_with!r}, regex=True)"
                    )
                blocks.append(f"    df[{col!r}] = _s_{t_id}")

            elif t_type == "custom":
                code_str = params.get("code", "")
                desc = params.get("description", "custom transformation")
                # Embed the custom code inline as a nested function
                blocks.append(f"    # Custom: {desc}")
                indented_code = textwrap.indent(code_str, "    ")
                blocks.append(indented_code)
                blocks.append("    df = transform(df)")

            blocks.append("")

        blocks.append("    return df")

    # Entry-point
    blocks.append(
        textwrap.dedent(
            """

            if __name__ == "__main__":
                if len(sys.argv) < 3:
                    print("Usage: python transform.py <input_path> <output_path>")
                    sys.exit(1)
                input_path, output_path = sys.argv[1], sys.argv[2]
                if input_path.endswith(".parquet"):
                    df_in = pd.read_parquet(input_path)
                elif input_path.endswith(".csv"):
                    df_in = pd.read_csv(input_path)
                elif input_path.endswith(".json"):
                    df_in = pd.read_json(input_path)
                else:
                    raise ValueError(f"Unsupported input format: {input_path}")

                df_out = run_pipeline(df_in)
                df_out.to_parquet(output_path, index=False)
                print(f"Pipeline complete. {len(df_out)} rows written to {output_path}")
            """
        )
    )

    (out_dir / "transform.py").write_text("\n".join(blocks))

    # requirements.txt
    (out_dir / "requirements.txt").write_text(
        "pandas>=2.2.0\npyarrow>=17.0.0\nnumpy>=1.26.0\nscikit-learn>=1.5.0\n"
    )


def _generate_readme(
    session_id: str,
    transformation_log: list[dict],
    approved_rules: list[dict],
    target_env: dict,
    out_dir: Path,
) -> None:
    applied = [t for t in transformation_log if t.get("status") == "applied"]
    lines = [
        f"# DQ Pipeline — Session {session_id[:8]}",
        "",
        f"Generated by **AI DQ Accelerator** on {datetime.now(timezone.utc).strftime('%Y-%m-%d')}.",
        "",
        "## Overview",
        "",
        f"- **Session ID**: `{session_id}`",
        f"- **Transformations applied**: {len(applied)}",
        f"- **Approved rules**: {len(approved_rules)}",
        f"- **Target environment**: `{target_env.get('type', 'unknown')}`",
        "",
        "## Directory structure",
        "",
        "```",
        "dbt_project/",
        "  models/staging/      ← dbt SQL models (one per transformation)",
        "  tests/               ← dbt schema tests (one per approved rule)",
        "  dbt_project.yml",
        "orchestration/",
        "  dag.py               ← Airflow DAG",
        "data_contract/",
        "  schema.py            ← Pandera data contract",
        "python_pipeline/",
        "  transform.py         ← Self-contained pandas pipeline",
        "  requirements.txt",
        "quality_report/",
        "  scorecard.json       ← Final DQ scorecard",
        "checks.yml             ← SodaCL monitoring checks (run with: soda scan -d <datasource> checks.yml)",
        "```",
        "",
        "## Transformations",
        "",
    ]
    for t in applied:
        lines.append(
            f"- **{t.get('type')}** (`{t.get('id', '')[:8]}`): {t.get('affected_rows', 0)} rows affected"
        )

    lines += [
        "",
        "## Approved rules",
        "",
    ]
    for rule in approved_rules:
        lines.append(
            f"- `{rule.get('id')}` [{rule.get('category')}] "
            f"{rule.get('check')} on `{rule.get('column', 'cross-column')}`"
        )

    (out_dir / "README.md").write_text("\n".join(lines) + "\n")


def generate(
    session_id: str,
    transformation_log: list[dict],
    approved_rules: list[dict],
    target_env: dict,
) -> str:
    """Generate the full output pipeline artefacts for a session.

    Creates the following under ``output/sessions/{session_id}/``:

    - ``dbt_project/models/staging/stg_{id}_{type}.sql`` — one per applied transform
    - ``dbt_project/dbt_project.yml``
    - ``dbt_project/tests/schema_{rule_id}.yml`` — one per approved rule
    - ``orchestration/dag.py`` — Airflow DAG
    - ``data_contract/schema.py`` — Pandera schema
    - ``python_pipeline/transform.py`` — pandas pipeline
    - ``python_pipeline/requirements.txt``
    - ``quality_report/scorecard.json`` — copy of the stored scorecard
    - ``README.md``

    Parameters
    ----------
    session_id:
        Unique identifier for the data-quality session.
    transformation_log:
        List of transformation log entries (from ``load_transformation_log``).
    approved_rules:
        List of approved rule dictionaries.
    target_env:
        Deployment target metadata (e.g. ``{"type": "airflow", "schedule": "@daily"}``).

    Returns
    -------
    str
        Absolute path to the output directory.
    """
    out_root = _output_dir(session_id)
    out_root.mkdir(parents=True, exist_ok=True)

    # Jinja2 env
    env = _jinja_env()

    # Determine column list from profile (best-effort)
    all_columns: list[str] = []
    profile_path = _session_dir(session_id) / "profile.json"
    if profile_path.exists():
        try:
            profile = json.loads(profile_path.read_text())
            all_columns = list(profile.get("columns", {}).keys())
        except Exception:
            pass

    applied_transforms = [t for t in transformation_log if t.get("status") == "applied"]

    # ------------------------------------------------------------------
    # dbt project
    # ------------------------------------------------------------------
    dbt_root = out_root / "dbt_project"
    staging_dir = dbt_root / "models" / "staging"
    staging_dir.mkdir(parents=True, exist_ok=True)

    source_table = "working_data"
    for transform in applied_transforms:
        t_type = transform.get("type", "")
        if t_type == "custom":
            # Render the custom_node Airflow template instead of a dbt model
            tmpl_path = "airflow/custom_node.py.j2"
            templates_dir = _find_project_root() / "templates"
            if (templates_dir / tmpl_path).exists():
                try:
                    tmpl = env.get_template(tmpl_path)
                    rendered = tmpl.render(
                        task_id=f"{transform.get('id', 'custom')}_transform",
                        code=transform.get("params", {}).get("code", ""),
                        description=transform.get("params", {}).get(
                            "description", "Custom transformation"
                        ),
                        use_case=target_env.get("use_case", session_id),
                        generated_at=datetime.now(timezone.utc).isoformat(),
                    )
                    custom_path = staging_dir / f"custom_{transform.get('id', 'node')}.py"
                    custom_path.write_text(rendered)
                except Exception:
                    pass
        else:
            _render_dbt_model(env, transform, source_table, all_columns, staging_dir)

    _generate_dbt_project_yml(session_id, dbt_root)
    _generate_dbt_tests(approved_rules, dbt_root / "tests")

    # ------------------------------------------------------------------
    # Airflow DAG
    # ------------------------------------------------------------------
    orch_dir = out_root / "orchestration"
    orch_dir.mkdir(parents=True, exist_ok=True)

    tmpl_path = "airflow/dag.py.j2"
    templates_dir = _find_project_root() / "templates"
    if (templates_dir / tmpl_path).exists():
        try:
            tmpl = env.get_template(tmpl_path)
            generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            dag_code = tmpl.render(
                session_id=session_id,
                generated_at=generated_at,
                use_case=target_env.get("use_case", session_id),
                transformation_log=transformation_log,
                target_env=target_env,
                baseline_score=target_env.get("baseline_score", "N/A"),
                final_score=target_env.get("final_score", "N/A"),
            )
            (orch_dir / "dag.py").write_text(dag_code)
        except Exception:
            # Write a minimal stub if rendering fails
            (orch_dir / "dag.py").write_text(
                f"# Airflow DAG stub for session {session_id}\n"
                "# Template rendering failed — please review transformation log.\n"
            )
    else:
        (orch_dir / "dag.py").write_text(f"# Airflow DAG stub for session {session_id}\n")

    # ------------------------------------------------------------------
    # Pandera data contract
    # ------------------------------------------------------------------
    contract_dir = out_root / "data_contract"
    contract_dir.mkdir(parents=True, exist_ok=True)
    _generate_pandera_schema(approved_rules, contract_dir / "schema.py")

    # ------------------------------------------------------------------
    # Python pipeline
    # ------------------------------------------------------------------
    pipeline_dir = out_root / "python_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    _generate_python_pipeline(transformation_log, session_id, pipeline_dir)

    # ------------------------------------------------------------------
    # Quality report — copy scorecard if it exists
    # ------------------------------------------------------------------
    report_dir = out_root / "quality_report"
    report_dir.mkdir(parents=True, exist_ok=True)
    scorecard_src = out_root / "scorecard.json"
    if scorecard_src.exists():
        shutil.copy2(str(scorecard_src), str(report_dir / "scorecard.json"))
    else:
        # Write a minimal placeholder
        (report_dir / "scorecard.json").write_text(
            json.dumps(
                {"session_id": session_id, "note": "Run compute_full() to generate scorecard."},
                indent=2,
            )
        )

    # ------------------------------------------------------------------
    # SodaCL monitoring checks — copy to output for production use
    # ------------------------------------------------------------------
    checks_src = _session_dir(session_id) / "checks.yml"
    if checks_src.exists():
        shutil.copy2(str(checks_src), str(out_root / "checks.yml"))

    # ------------------------------------------------------------------
    # README
    # ------------------------------------------------------------------
    _generate_readme(session_id, transformation_log, approved_rules, target_env, out_root)

    return str(out_root)
