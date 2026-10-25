"""Feedback on a check: "was this right?" - a yes/no and an enum reason, never text.

Open like /check (no sign-in), guarded like /report: a limited-use App Check token, consumed here, so a script cannot
stuff the numbers. Stored once per reporter and verdict (the last press wins) without any link to the checked text.
"""
from __future__ import annotations
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from input_layer import phone_hmac

from . import appcheck
from .analytics import log_event
from .storage import STORE, _today

router = APIRouter()


class Feedback(BaseModel):
    verdict_id: str = Field(pattern=r"^[0-9a-f]{16}$")
    correct: bool
    reason: Literal["not_scam", "wrong_type", "too_weak", "too_strong", "missed"] | None = None
    lang: Literal["ja", "vi"]
    reporter_id: str | None = Field(default=None, max_length=64)


@router.post("/feedback")
def feedback(body: Feedback, request: Request):
    if appcheck.mode() != "off":
        ac = appcheck.status(request.headers.get(appcheck.HEADER), consume=True)
        appcheck.log.info("POST /feedback ac=%s", ac)
        if appcheck.mode() == "enforce" and ac != "valid":
            raise HTTPException(403, "This answer could not be confirmed as sent from the app. Reload the page and try again.")
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    origin = body.reporter_id or f"{forwarded or (request.client.host if request.client else '')}:{_today()}"
    STORE.save_feedback("check", body.verdict_id, phone_hmac("reporter:" + origin), body.correct, body.reason, body.lang)
    log_event("feedback", lang=body.lang, feedback_correct=body.correct)
    return {"ok": True}
