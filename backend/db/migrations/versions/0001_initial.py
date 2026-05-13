"""Initial schema: dq_app.sessions + dq_app.stage_snapshots.

Revision ID: 0001
Revises:
Create Date: 2026-05-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS dq_app")

    op.create_table(
        "sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("filename", sa.Text, nullable=False),
        sa.Column("file_ext", sa.Text, nullable=False),
        sa.Column("use_case", sa.Text),
        sa.Column("target_column", sa.Text),
        sa.Column("description", sa.Text),
        sa.Column("stage", sa.String, nullable=False),
        sa.Column("current_score", sa.Float),
        sa.Column("baseline_score", sa.Float),
        sa.Column("output_dir", sa.Text),
        sa.Column("zip_path", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        schema="dq_app",
    )
    op.create_index(
        "ix_sessions_active",
        "sessions",
        ["created_at"],
        schema="dq_app",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "stage_snapshots",
        sa.Column("session_id", UUID(as_uuid=True),
                  sa.ForeignKey("dq_app.sessions.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("stage", sa.String, primary_key=True),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        schema="dq_app",
    )


def downgrade() -> None:
    op.drop_table("stage_snapshots", schema="dq_app")
    op.drop_index("ix_sessions_active", table_name="sessions", schema="dq_app")
    op.drop_table("sessions", schema="dq_app")
    # NOTE: we intentionally do NOT drop the dq_app schema here.
    # Alembic's alembic_version table lives in dq_app (version_table_schema="dq_app")
    # and must still exist after this function returns so that Alembic can
    # delete the version row.  The schema is therefore left empty after downgrade.
    # To fully remove the schema, run: DROP SCHEMA dq_app CASCADE manually.
