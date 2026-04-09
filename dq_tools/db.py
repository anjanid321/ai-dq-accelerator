"""Per-session DuckDB connection serialization.

DuckDB's file-level locking prevents multiple concurrent read-write connections
to the same database file, even from threads within the same process. All
dq_tools modules that open a DuckDB connection should acquire the per-session
lock before connecting and release it after closing.

Usage
-----
    from dq_tools.db import session_db_lock

    with session_db_lock(session_id):
        con = duckdb.connect(str(db_path))
        try:
            ...
        finally:
            con.close()
"""

from __future__ import annotations

import threading
from contextlib import contextmanager

_locks: dict[str, threading.RLock] = {}
_registry_lock = threading.Lock()


def _get_lock(session_id: str) -> threading.RLock:
    with _registry_lock:
        if session_id not in _locks:
            _locks[session_id] = threading.RLock()
        return _locks[session_id]


@contextmanager
def session_db_lock(session_id: str):
    """Context manager that holds the per-session DuckDB serialization lock."""
    lock = _get_lock(session_id)
    lock.acquire()
    try:
        yield
    finally:
        lock.release()
