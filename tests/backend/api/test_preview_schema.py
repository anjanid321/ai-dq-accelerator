"""Tests for TransformationPreview error field."""
from backend.api.schemas import TransformationPreview


def test_error_field_is_none_by_default():
    preview = TransformationPreview()
    assert preview.error is None


def test_error_field_is_included_when_set():
    preview = TransformationPreview(error="type_cast failed: invalid type")
    assert preview.error == "type_cast failed: invalid type"


def test_error_field_preserved_when_constructing_from_dict():
    """When preview() returns an error key it should survive TransformationPreview(**raw)."""
    raw = {
        "before_sample": [],
        "after_sample": [],
        "affected_row_count": 0,
        "projected_score": None,
        "projected_score_delta": None,
        "error": "Column 'nonexistent' not found",
    }
    preview = TransformationPreview(**raw)
    assert preview.error == "Column 'nonexistent' not found"


def test_error_field_absent_in_valid_preview():
    """A successful preview result has no error."""
    raw = {
        "before_sample": [{"id": 1}],
        "after_sample": [{"id": 1}],
        "affected_row_count": 1,
        "projected_score": 0.9,
        "projected_score_delta": 0.1,
    }
    preview = TransformationPreview(**raw)
    assert preview.error is None
