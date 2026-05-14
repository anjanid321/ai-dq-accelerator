"""Root conftest: stub out optional/missing packages so unit tests can run
without the full production dependency set (e.g. deepagents requires Python ≥ 3.11)."""
import sys
import types

# ---------------------------------------------------------------------------
# deepagents stub — create_deep_agent is the only symbol used in production code
# ---------------------------------------------------------------------------
if "deepagents" not in sys.modules:
    _deepagents = types.ModuleType("deepagents")
    _deepagents_graph = types.ModuleType("deepagents.graph")
    _deepagents_graph.create_deep_agent = lambda *a, **kw: None  # noqa: E731
    sys.modules["deepagents"] = _deepagents
    sys.modules["deepagents.graph"] = _deepagents_graph
