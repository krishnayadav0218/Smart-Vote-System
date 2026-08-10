"""
Minimal in-memory rate limiter — good enough for a single-process, small-scale
deployment. If you run multiple backend workers/instances, replace this with
a shared store (Redis) since each process would otherwise track its own count.
"""
import time
from collections import defaultdict, deque
from fastapi import HTTPException, Request

# key -> deque of attempt timestamps
_attempts = defaultdict(deque)


def rate_limit(request: Request, key_suffix: str, max_attempts: int = 5, window_seconds: int = 300):
    """Raise 429 if `max_attempts` have been made for this client+key within `window_seconds`."""
    client_ip = request.client.host if request.client else "unknown"
    key = f"{client_ip}:{key_suffix}"
    now = time.time()
    q = _attempts[key]
    while q and now - q[0] > window_seconds:
        q.popleft()
    if len(q) >= max_attempts:
        retry_after = int(window_seconds - (now - q[0]))
        raise HTTPException(
            status_code=429,
            detail=f"Too many attempts. Try again in {max(retry_after, 1)} seconds.",
        )
    q.append(now)


def clear_attempts(request: Request, key_suffix: str):
    client_ip = request.client.host if request.client else "unknown"
    key = f"{client_ip}:{key_suffix}"
    _attempts.pop(key, None)
