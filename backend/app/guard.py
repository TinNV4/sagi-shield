"""
Sagi Shield - request guard: per-client rate limit + access log without personal data.

The API is public and unauthenticated, and most routes can trigger a paid Gemini call, so every client
gets a small budget per minute (RATE_LIMIT_PER_MIN, 0 = off). The window lives in process memory: with
max-instances 3 the real ceiling is 3x, which is fine for an abuse brake (it is not a billing guarantee -
set a budget alert on the project as well).

With APPCHECK=enforce (app/appcheck.py) a client without a valid App Check token gets the smaller budget
RATE_LIMIT_UNVERIFIED_PER_MIN instead of being refused: scripts are throttled, a real browser that failed to get a
token still gets its answer.

The access log holds method, path, status and latency only - never bodies, query strings (family_id is a
secret), IP addresses or phone numbers - plus `ac=` (App Check result) unless APPCHECK=off. The client key is a
salted hash that changes every process start.
"""
from __future__ import annotations
import hashlib
import logging
import os
import secrets
import time
from collections import defaultdict, deque
from urllib.parse import parse_qs

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from . import appcheck

log = logging.getLogger("sagi.access")
WINDOW_S, MAX_CLIENTS = 60, 10_000
FREE_PATHS = ("/health", "/stats", "/family/alerts", "/spike")  # cheap reads: polled by the UI, no model behind them
_SALT = secrets.token_bytes(16)
_hits: dict[str, deque] = defaultdict(deque)


def limit_per_min() -> int:
    return int(os.getenv("RATE_LIMIT_PER_MIN", "30"))


def unverified_limit_per_min() -> int:
    return int(os.getenv("RATE_LIMIT_UNVERIFIED_PER_MIN", "5"))


def client_key(scope) -> str:
    headers = dict(scope.get("headers") or [])
    forwarded = headers.get(b"x-forwarded-for", b"").decode("latin-1").split(",")[0].strip()  # set by Cloud Run
    ip = forwarded or (scope.get("client") or ("unknown",))[0]
    return hashlib.sha256(_SALT + ip.encode()).hexdigest()[:12]


def allow(key: str, now: float | None = None, limit: int | None = None) -> bool:
    limit = limit_per_min() if limit is None else limit
    if limit <= 0:
        return True
    now = time.monotonic() if now is None else now
    if len(_hits) > MAX_CLIENTS:  # never let the table itself become the attack
        _hits.clear()
    q = _hits[key]
    while q and now - q[0] > WINDOW_S:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


def app_check_token(scope) -> str | None:
    """X-Firebase-AppCheck, or ?appcheck= on the Live Guard socket (a browser WebSocket cannot set headers)."""
    token = dict(scope.get("headers") or []).get(appcheck.HEADER.encode(), b"").decode("latin-1")
    if not token and scope["type"] == "websocket":
        token = (parse_qs(scope.get("query_string", b"").decode("latin-1")).get("appcheck") or [""])[0]
    return token or None


class GuardMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware) so that WebSocket handshakes are limited too."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        path, key, start = scope.get("path", ""), client_key(scope), time.monotonic()
        costly = scope["type"] == "websocket" or scope.get("method") == "POST"  # GETs are static files and cheap reads
        costly = costly and not path.startswith(FREE_PATHS)
        ac, limit = "", None
        if costly and appcheck.mode() != "off":
            ac = await run_in_threadpool(appcheck.status, app_check_token(scope))  # JWKS may be fetched once
            if appcheck.mode() == "enforce" and ac != "valid":
                limit = unverified_limit_per_min()
        tag = f" ac={ac}" if ac else ""
        limited = costly and not allow(key, limit=limit)
        if limited and scope["type"] == "websocket":
            await receive()  # websocket.connect
            await send({"type": "websocket.close", "code": 1013})  # try again later
            return log.info("WS %s 429 client=%s%s", path, key, tag)
        if limited:
            res = JSONResponse({"detail": "Too many requests. Please wait a minute."}, 429, {"Retry-After": str(WINDOW_S)})
            await res(scope, receive, send)
            return log.info("%s %s 429 client=%s%s", scope["method"], path, key, tag)

        status = {"code": 0}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            log.info("%s %s %s %dms client=%s%s", scope.get("method", "WS"), path, status["code"] or "-",
                     (time.monotonic() - start) * 1000, key, tag)
