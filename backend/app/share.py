"""Web Share Target fallback.

The PWA's service worker (frontend/public/share-sw.js) takes the shared content before it reaches the server. If a
share arrives here anyway (no worker yet), nothing is read, kept or logged: the app just opens.
"""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

router = APIRouter()


@router.post("/share-target", include_in_schema=False)
def share_target() -> RedirectResponse:
    return RedirectResponse("/#share", status_code=303)
