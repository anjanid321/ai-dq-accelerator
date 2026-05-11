import uuid
from backend.db.models import Base, Session as SessionRow, StageSnapshot


def test_session_table_uses_dq_app_schema():
    assert SessionRow.__table__.schema == "dq_app"
    assert SessionRow.__tablename__ == "sessions"


def test_stage_snapshot_table_uses_dq_app_schema():
    assert StageSnapshot.__table__.schema == "dq_app"
    assert StageSnapshot.__tablename__ == "stage_snapshots"


def test_session_columns():
    cols = {c.name for c in SessionRow.__table__.columns}
    assert cols == {
        "id", "filename", "file_ext", "use_case", "target_column", "description",
        "stage", "current_score", "baseline_score", "output_dir", "zip_path",
        "created_at", "updated_at", "deleted_at",
    }


def test_stage_snapshot_columns_and_pk():
    cols = {c.name for c in StageSnapshot.__table__.columns}
    assert cols == {"session_id", "stage", "payload", "created_at"}
    pk = {c.name for c in StageSnapshot.__table__.primary_key.columns}
    assert pk == {"session_id", "stage"}


def test_session_round_trip_in_memory():
    """Smoke test: instances populate fields without touching a DB."""
    sid = uuid.uuid4()
    row = SessionRow(
        id=sid, filename="orders.csv", file_ext="csv",
        stage="LOADING",
    )
    assert row.id == sid
    assert row.filename == "orders.csv"
    assert row.deleted_at is None
