"""
Sagi Shield - guardian alerts. The alert is always written to the store (the Guardian view reads it,
so it works even when push does not); FCM push is best effort on top. NOT YET RUN against FCM.
"""
from __future__ import annotations
import sys
from functools import lru_cache

from .storage import STORE

TITLE = {"ja": "\u8a50\u6b3a\u306e\u7591\u3044\u306e\u3042\u308b\u96fb\u8a71\u3092\u691c\u77e5\u3057\u307e\u3057\u305f", "vi": "Ph\u00e1t hi\u1ec7n cu\u1ed9c g\u1ecdi nghi l\u1eeba \u0111\u1ea3o"}


@lru_cache(maxsize=1)
def _messaging():
    import firebase_admin
    from firebase_admin import messaging
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return messaging


def alert_family(family_id: str | None, result: dict, lang: str) -> dict | None:
    """result: a /check-shaped dict. Stores a summary sentence only - never the transcript."""
    if not family_id:
        return None
    summary = (result.get("reasons") or [result.get("advice", "")])[0]
    alert = STORE.add_alert(family_id, result["risk_level"], result.get("scam_type", "unknown"),
                            int(result.get("stage", 0)), summary)
    if not alert:
        return None
    tokens = [g["fcm_token"] for g in (STORE.get_family(family_id) or {}).get("guardians", []) if g.get("fcm_token")]
    if tokens:
        try:
            m = _messaging()
            m.send_each_for_multicast(m.MulticastMessage(
                tokens=tokens, notification=m.Notification(title=TITLE.get(lang, TITLE["ja"]), body=summary),
                data={"alert_id": alert["id"], "risk_level": alert["risk_level"]}))
        except Exception as e:
            print(f"[notifier] push unavailable: {type(e).__name__}: {str(e)[:120]}", file=sys.stderr)
    return alert
