from backend.api.schemas import SessionListItem, StageSnapshotResponse, WorkflowStage


def test_session_list_item_fields():
    item = SessionListItem(
        id="00000000-0000-0000-0000-000000000001",
        filename="a.csv",
        stage=WorkflowStage.LOADING,
        current_score=0.0,
        baseline_score=0.0,
        created_at="2026-05-11T00:00:00Z",
        updated_at="2026-05-11T00:00:00Z",
    )
    assert item.filename == "a.csv"
    assert item.stage == WorkflowStage.LOADING


def test_stage_snapshot_response_fields():
    r = StageSnapshotResponse(stage="profile", payload={"x": 1},
                              created_at="2026-05-11T00:00:00Z")
    assert r.stage == "profile"
    assert r.payload == {"x": 1}
