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


def duckdb_connect(db_path: str, retries: int = 15, delay: float = 0.25, **kwargs):
    """Open a DuckDB connection, retrying on OS-level lock conflicts.

    DuckDB's WAL does not release the OS file lock synchronously on
    ``con.close()``.  A brief delay + retry handles the window between the
    Python-level lock releasing and the file-system lock clearing.
    """
    import time

    import duckdb

    last_exc: Exception | None = None
    for _ in range(retries):
        try:
            return duckdb.connect(db_path, **kwargs)
        except Exception as exc:
            if "Could not set lock" in str(exc):
                last_exc = exc
                time.sleep(delay)
                continue
            raise
    raise RuntimeError(
        f"DuckDB lock not released after {retries} retries ({retries * delay:.1f}s): {last_exc}"
    ) from last_exc
