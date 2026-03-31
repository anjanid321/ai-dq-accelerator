"""Shared retry helper for Anthropic API calls."""
from __future__ import annotations

import time
import anthropic

_RETRY_WAIT_SECONDS = 30
_RETRY_MAX_ATTEMPTS = 4


def call_claude_with_retry(client: anthropic.Anthropic, **kwargs):
    """Retry client.messages.create up to 4 times on RateLimitError (30s wait).
    All other exceptions propagate immediately.
    """
    last_exc = None
    for attempt in range(_RETRY_MAX_ATTEMPTS):
        try:
            return client.messages.create(**kwargs)
        except anthropic.RateLimitError as e:
            last_exc = e
            if attempt < _RETRY_MAX_ATTEMPTS - 1:
                time.sleep(_RETRY_WAIT_SECONDS)
    raise last_exc
