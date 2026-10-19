"""
Sagi Shield - Firebase App Check (reCAPTCHA Enterprise): tells requests from the real PWA apart from scripts.

    APPCHECK=off       default; nothing is verified (local dev, tests)
    APPCHECK=monitor   verify and log `ac=` on every costly request; nobody is limited or refused
    APPCHECK=enforce   a check without a valid token still gets its answer, on a tighter budget
                       (RATE_LIMIT_UNVERIFIED_PER_MIN, default 5); a report without a fresh limited-use token is refused

Checks are never refused: a person whose browser cannot produce a token (old phone, blocked reCAPTCHA) may be the
one with a scammer on the line. Reports are different - a scripted wave of them would flag an honest number - so
they need a limited-use token, consumed here (replay protection, a network call; needs the
"Firebase App Check Token Verifier" role on the runtime account). The PWA sends the token in X-Firebase-AppCheck;
the Live Guard socket, which cannot set headers, as ?appcheck=.
"""
from __future__ import annotations

import logging
import os
from functools import lru_cache

log = logging.getLogger("sagi.appcheck")
HEADER = "x-firebase-appcheck"
MODES = ("off", "monitor", "enforce")


def mode() -> str:
    value = os.getenv("APPCHECK", "off").strip().lower()
    return value if value in MODES else "off"


@lru_cache(maxsize=1)
def _app():
    import firebase_admin
    try:
        return firebase_admin.get_app()
    except ValueError:  # the default app may already exist (notifier.py initialises it for FCM)
        return firebase_admin.initialize_app(options={"projectId": os.getenv("GOOGLE_CLOUD_PROJECT")})


def status(token: str | None, consume: bool = False) -> str:
    """"missing" | "valid" | "invalid" | "replayed" (a limited-use token seen before) | "error" (could not verify)."""
    if not token:
        return "missing"
    from firebase_admin import app_check
    try:
        app = _app()
    except Exception as e:  # noqa: BLE001 - no project id: a deployment fault, not the client's
        log.warning("app check not configured: %s", e)
        return "error"
    try:
        claims = app_check.verify_token(token, app=app, consume=consume)
    except ValueError:  # bad signature, expired, wrong project, not a JWT
        return "invalid"
    except Exception as e:  # noqa: BLE001 - JWKS fetch or the consume call failed
        log.warning("app check unavailable: %s", type(e).__name__)
        return "error"
    return "replayed" if consume and claims.get("already_consumed") else "valid"
