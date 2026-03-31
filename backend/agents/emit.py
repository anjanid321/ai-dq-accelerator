import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


def _find_project_root() -> Path:
    p = Path(__file__).resolve()
    while p != p.parent:
        if (p / "pyproject.toml").exists():
            return p
        p = p.parent
    return Path(".")


def emit(session_id: str, event: str, **kwargs) -> None:
    """Append a progress event to data/sessions/{session_id}/investigation_progress.jsonl."""
    payload = {"ts": datetime.now(timezone.utc).isoformat(), "event": event, **kwargs}
    try:
        path = _find_project_root() / "data" / "sessions" / session_id / "investigation_progress.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(json.dumps(payload, default=str) + "\n")
    except Exception:
        pass
