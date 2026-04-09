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

import re
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


_EXTERNAL_LOCK_RE = re.compile(
    r"Conflicting lock is held in (?P<binary>\S+)\s+\(PID (?P<pid>\d+)\)",
    re.IGNORECASE,
)


def duckdb_connect(db_path: str, retries: int = 15, delay: float = 0.25, **kwargs):
    """Open a DuckDB connection, retrying on OS-level lock conflicts.

    DuckDB's WAL does not release the OS file lock synchronously on
    ``con.close()``.  A brief delay + retry handles the window between the
    Python-level lock releasing and the file-system lock clearing.

    If the lock is held by a *different* long-lived process (e.g. a Jupyter
    notebook or interactive Python session), we fail fast after a single
    attempt so the caller gets a clear error immediately instead of waiting
    the full retry budget.
    """
    import sys
    import time

    import duckdb

    last_exc: Exception | None = None
    for _ in range(retries):
        try:
            return duckdb.connect(db_path, **kwargs)
        except Exception as exc:
            err_str = str(exc)
            if "Could not set lock" not in err_str:
                raise

            # Check whether the lock is held by a different process/binary.
            # WAL timing races involve the same process; external holders don't.
            m = _EXTERNAL_LOCK_RE.search(err_str)
            if m:
                binary = m.group("binary")
                pid = m.group("pid")
                # If the binary isn't our own executable, it's external — fail fast.
                if binary != sys.executable:
                    raise RuntimeError(
                        f"DuckDB file is locked by an external process: {binary} (PID {pid}). "
                        "Please close any Jupyter notebooks, Python sessions, or database tools "
                        f"that have this file open, then retry. File: {db_path}"
                    ) from exc

            last_exc = exc
            time.sleep(delay)

    raise RuntimeError(
        f"DuckDB lock not released after {retries} retries ({retries * delay:.1f}s): {last_exc}"
    ) from last_exc
