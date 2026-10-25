"""Households: the protected person's devices and their guardians, behind Firebase sign-in.

Access is by uid (`devices` / `guardians`), never by knowing the household id. The 6-digit code only joins.
"""
from __future__ import annotations
from dataclasses import replace
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from input_layer import phone_hmac

from . import auth
from .analytics import log_event
from .auth import Principal
from .notifier import alert_household
from .storage import STORE, device_status

router = APIRouter()
NOT_MEMBER = "not a member of this household"
OWNER_STAYS = "the owner cannot leave; hand the household to another guardian first"


def _digits(code: str) -> str:
    return "".join(c for c in code if c.isdigit())


def public(hh: dict, p: Principal) -> dict:
    """What a member may see: counts and names, never uids or tokens (copies: the memory store hands out live dicts)."""
    return {"household_id": hh["household_id"], "name": hh["name"], "member_name": hh["member_name"],
            "market": hh["market"], "live_guard_enabled": hh["live_guard_enabled"], "devices": len(hh["devices"]),
            "guardians": [{"name": g["name"], "owner": g["owner"], "me": g["uid"] == p.uid} for g in hh["guardians"]],
            "device_status": device_status(hh), "created_at": hh["created_at"]}


def resolve_household(principal: Principal | None) -> str | None:
    """The household a device belongs to (the first one), or None. A guardian or admin has no single household."""
    if principal is None or principal.role != "device":
        return None
    found = [h for h in STORE.households_for(principal.uid) if principal.uid in h["devices"]]
    return found[0]["household_id"] if found else None


def _household(hid: str) -> dict:
    hh = STORE.get_household(hid)
    if not hh:
        raise HTTPException(404, "unknown household")
    return hh


def _is_guardian(hh: dict, p: Principal) -> bool:
    return any(g["uid"] == p.uid for g in hh["guardians"])


def _member(hid: str, p: Principal, guardian_only: bool = False) -> dict:
    hh = _household(hid)
    if not (_is_guardian(hh, p) or (not guardian_only and p.uid in hh["devices"])):
        raise HTTPException(403, NOT_MEMBER)
    return hh


def _is_owner(hh: dict, p: Principal) -> bool:
    return any(g["uid"] == p.uid and g["owner"] for g in hh["guardians"])


def _owner(hid: str, p: Principal) -> dict:
    hh = _member(hid, p, guardian_only=True)
    if not _is_owner(hh, p):
        raise HTTPException(403, "only the owner can do this")
    return hh


class HouseholdCreate(BaseModel):
    name: str = Field(default="", max_length=40)
    member_name: str = Field(default="", max_length=40)
    market: Literal["ja", "vi"]


class HouseholdUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=40)
    member_name: str | None = Field(default=None, max_length=40)
    live_guard_enabled: bool | None = None

    @model_validator(mode="after")
    def _something_set(self):
        if not self.model_fields_set:
            raise ValueError("nothing to change")
        return self


class Heartbeat(BaseModel):
    listening: bool


class Empty(BaseModel):
    pass


class HouseholdJoin(BaseModel):
    pair_code: str = Field(max_length=12)
    name: str = Field(default="", max_length=40)
    fcm_token: str | None = Field(default=None, max_length=4096)


class PushToken(BaseModel):
    fcm_token: str = Field(min_length=1, max_length=4096)


class AlertFeedback(BaseModel):
    correct: bool
    reason: Literal["not_scam", "wrong_type", "too_weak", "too_strong", "missed"] | None = None


class HouseholdNotify(BaseModel):
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    scam_type: str = Field(default="unknown", max_length=40)
    stage: int = Field(default=0, ge=0, le=5)
    reasons: list[str] = Field(default_factory=list, max_length=2)
    lang: Literal["ja", "vi"]


@router.post("/household")
def household_create(body: HouseholdCreate, p: Principal = Depends(auth.principal)):
    hh = STORE.create_household(body.name, body.member_name, body.market, p)
    return {"household_id": hh["household_id"], "pair_code": hh["pair_code"], "expires_in": 900,
            "household": public(hh, p)}


@router.post("/household/join")
def household_join(body: HouseholdJoin, p: Principal = Depends(auth.principal)):
    who = replace(p, name=body.name[:40]) if body.name else p
    hh = STORE.join_household(_digits(body.pair_code), who, body.fcm_token)
    if not hh:
        raise HTTPException(404, "pair code is wrong or expired")
    return {"household": public(hh, p)}


@router.get("/household")
def household_list(p: Principal = Depends(auth.principal)):
    return [public(h, p) for h in STORE.households_for(p.uid)]


@router.post("/household/{hid}/code")
def household_code(hid: str, body: Empty, p: Principal = Depends(auth.principal)):
    _member(hid, p)
    hh = STORE.refresh_household_code(hid)
    return {"pair_code": hh["pair_code"], "expires_in": 900}


@router.get("/household/{hid}")
def household_detail(hid: str, p: Principal = Depends(auth.principal)):
    """One household; guardians of it also get each guardian's uid (needed to pick a new owner)."""
    hh = _member(hid, p)
    out = public(hh, p)
    if _is_guardian(hh, p):
        out["guardians"] = [{"uid": g["uid"], **shown} for g, shown in zip(hh["guardians"], out["guardians"])]
    return out


@router.patch("/household/{hid}")
def household_update(hid: str, body: HouseholdUpdate, p: Principal = Depends(auth.principal)):
    """Owner only: the household's names and whether Live Guard is on for the protected person."""
    _owner(hid, p)
    hh = STORE.update_household(hid, body.model_dump(exclude_unset=True))
    return {"household": public(hh, p)}


@router.post("/household/{hid}/heartbeat")
def household_heartbeat(hid: str, body: Heartbeat, p: Principal = Depends(auth.principal)):
    """Devices only: "I am alive, and listening or not". No text, no numbers; guardians have no heartbeat."""
    hh = _member(hid, p)
    if p.uid not in hh["devices"]:
        raise HTTPException(403, NOT_MEMBER)
    STORE.record_heartbeat(hid, p.uid, body.listening)
    return {"ok": True}


@router.get("/household/{hid}/alerts")
def household_alerts(hid: str, p: Principal = Depends(auth.principal)):
    """Guardians only: the device raises alerts but never lists them (a borrowed or stolen phone shows no history)."""
    _member(hid, p, guardian_only=True)
    return STORE.list_household_alerts(hid)


@router.post("/household/{hid}/alerts/{aid}/feedback")
def household_alert_feedback(hid: str, aid: str, body: AlertFeedback, p: Principal = Depends(auth.principal)):
    """Guardians only: "was this alert right?" - a yes/no and an optional enum reason, never text. Last press wins."""
    hh = _member(hid, p, guardian_only=True)
    if not STORE.alert_exists(hid, aid):
        raise HTTPException(404, "unknown alert")
    who = phone_hmac("guardian:" + p.uid)  # one answer per guardian and alert, without storing the uid
    STORE.save_feedback("alert", aid, who, body.correct, body.reason, hh["market"])
    return {"ok": True}


@router.delete("/household/{hid}/devices")
def household_reset_devices(hid: str, p: Principal = Depends(auth.principal)):
    """Owner only: unpair every device (a lost or replaced phone). The protected person pairs again with a new code."""
    _owner(hid, p)
    return {"ok": True, "removed": STORE.clear_household_devices(hid)}


@router.post("/household/{hid}/push")
def household_push(hid: str, body: PushToken, p: Principal = Depends(auth.principal)):
    _member(hid, p, guardian_only=True)
    STORE.add_household_push_token(hid, p.uid, body.fcm_token)
    return {"ok": True}


@router.delete("/household/{hid}/push")
def household_push_remove(hid: str, body: PushToken, p: Principal = Depends(auth.principal)):
    """Sign-out: this browser's token stops receiving this household's alerts. Absent token is fine (200)."""
    _member(hid, p, guardian_only=True)
    STORE.remove_household_push_token(hid, p.uid, body.fcm_token)
    return {"ok": True}


@router.post("/household/{hid}/notify")
def household_notify(hid: str, body: HouseholdNotify, p: Principal = Depends(auth.principal)):
    _member(hid, p)
    alert = alert_household(hid, body.model_dump(), body.lang)
    if not alert:
        raise HTTPException(404, "unknown household")
    log_event("notify", lang=body.lang, source="household", risk_level=body.risk_level, scam_type=body.scam_type[:40])
    return {"ok": True, "id": alert["id"]}


@router.delete("/household/{hid}/guardians/{uid}")
def household_remove_guardian(hid: str, uid: str, p: Principal = Depends(auth.principal)):
    hh = _member(hid, p, guardian_only=True)
    if not _is_owner(hh, p) and uid != p.uid:
        raise HTTPException(403, "only the owner can remove another guardian")
    target = next((g for g in hh["guardians"] if g["uid"] == uid), None)
    if not target:
        raise HTTPException(404, "unknown guardian")
    if target["owner"]:
        raise HTTPException(409, OWNER_STAYS)
    STORE.remove_guardian(hid, uid)
    return {"ok": True}


@router.delete("/household/{hid}")
def household_delete(hid: str, p: Principal = Depends(auth.principal)):
    _owner(hid, p)
    STORE.delete_household(hid)
    return {"ok": True}


class OwnerChange(BaseModel):
    uid: str = Field(min_length=1, max_length=128)


def _hand_over(hid: str, uid: str) -> dict:
    if not STORE.set_owner(hid, uid):
        raise HTTPException(404, "unknown guardian")
    return {"ok": True}


@router.post("/household/{hid}/owner")
def household_owner(hid: str, body: OwnerChange, p: Principal = Depends(auth.principal)):
    _owner(hid, p)
    return _hand_over(hid, body.uid)


@router.post("/admin/household/{hid}/owner")
def admin_household_owner(hid: str, body: OwnerChange, p: Principal = Depends(auth.admin_only)):
    """The one admin route that crosses households: it changes ownership and reveals nothing."""
    _household(hid)
    return _hand_over(hid, body.uid)
