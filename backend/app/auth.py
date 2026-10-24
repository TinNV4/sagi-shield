"""Firebase-authenticated principals: ID token -> device / guardian / admin."""
from __future__ import annotations
import logging
import os
from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, HTTPException, Request

from app import appcheck

log = logging.getLogger("sagi.auth")

EXPIRED = "sign-in expired, please sign in again"
REQUIRED = "sign-in required"
FAKE_PROVIDERS = ("anonymous", "google.com", "phone")


@dataclass(frozen=True)
class Principal:
    uid: str
    role: Literal["device", "guardian", "admin"]   # anonymous -> device; google.com / phone -> guardian; claim admin=True -> admin
    name: str = ""                                  # token `name` claim, <= 40, may be empty


class AuthError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def mode() -> Literal["firebase", "fake", "off"]:
    m = os.getenv("AUTH", "firebase").strip().lower()
    if m == "fake" and os.getenv("STORE", "memory") == "firestore":
        log.warning("AUTH=fake is refused with STORE=firestore; using firebase")
        return "firebase"
    return m if m in ("fake", "off") else "firebase"


def _verify_fake(token: str) -> Principal:
    parts = token.split(":")
    if parts[0] != "fake" or len(parts) not in (3, 4) or not parts[1] or parts[2] not in FAKE_PROVIDERS:
        raise AuthError(401, EXPIRED)
    if len(parts) == 4:
        if parts[3] != "admin" or parts[2] == "anonymous":
            raise AuthError(401, EXPIRED)
        return Principal(parts[1], "admin")
    return Principal(parts[1], "device" if parts[2] == "anonymous" else "guardian")


def _verify_firebase(token: str) -> dict:
    from firebase_admin import auth as fb
    try:
        return fb.verify_id_token(token, app=appcheck._app(), check_revoked=False)
    except (ValueError, fb.ExpiredIdTokenError, fb.RevokedIdTokenError, fb.InvalidIdTokenError):
        raise AuthError(401, EXPIRED)
    except Exception:
        log.exception("sign-in check failed")
        raise AuthError(503, "sign-in could not be checked, try again")


def verify(token: str) -> Principal:
    if not token:
        raise AuthError(401, REQUIRED)
    if mode() == "fake":
        return _verify_fake(token)
    claims = _verify_firebase(token)
    provider = (claims.get("firebase") or {}).get("sign_in_provider", "")
    name = (claims.get("name") or "")[:40]
    if provider == "anonymous":
        return Principal(claims["uid"], "device", name)
    role = "admin" if claims.get("admin") is True else "guardian"
    return Principal(claims["uid"], role, name)


def _bearer(request: Request) -> str:
    h = request.headers.get("authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else ""


def principal(request: Request) -> Principal:
    try:
        return verify(_bearer(request))
    except AuthError as e:
        raise HTTPException(e.status, e.detail)


def guardian_or_admin(p: Principal = Depends(principal)) -> Principal:
    if p.role == "device":
        raise HTTPException(403, "a signed-in guardian is needed here")
    return p


def admin_only(p: Principal = Depends(principal)) -> Principal:
    if p.role != "admin":
        raise HTTPException(403, "an administrator is needed here")
    return p


def principal_from_query(token: str | None) -> Principal | None:
    """For the WebSocket: never raises, so a scared caller is never refused."""
    if not token:
        return None
    try:
        return verify(token)
    except AuthError:
        return None
