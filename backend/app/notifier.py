"""
Sagi Shield - guardian alerts. The alert is always written to the store (the Guardian view reads it,
so it works even when push does not); FCM web push (the guardian's PWA, frontend public/push-sw.js) is best effort on top.
"""
from __future__ import annotations
import sys
from datetime import datetime, timezone
from functools import lru_cache

from .storage import STORE

TITLE = {"ja": "\u8a50\u6b3a\u306e\u7591\u3044\u306e\u3042\u308b\u96fb\u8a71\u3092\u691c\u77e5\u3057\u307e\u3057\u305f", "vi": "Ph\u00e1t hi\u1ec7n cu\u1ed9c g\u1ecdi nghi l\u1eeba \u0111\u1ea3o"}
OFFLINE_TITLE = {"ja": "見守り端末から応答がありません", "vi": "Thiết bị bảo vệ không phản hồi"}
OFFLINE_TEXT = {"ja": "見守り端末から{hours}時間以上応答がありません。電源と Wi-Fi を確認してください。",
                "vi": "Thiết bị bảo vệ không phản hồi hơn {hours} giờ. Hãy kiểm tra nguồn và Wi-Fi."}


@lru_cache(maxsize=1)
def _messaging():
    import firebase_admin
    from firebase_admin import messaging
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return messaging


FALLBACK_SUMMARY = {"ja": "危険度の高い通話が検知されました。", "vi": "Đã phát hiện một cuộc gọi có nguy cơ cao."}


def _summary(result: dict, lang: str) -> str:
    """First reason, else the advice, else a fixed sentence - an alert never reaches a guardian empty."""
    return (next((r for r in result.get("reasons") or [] if r), None) or result.get("advice")
            or FALLBACK_SUMMARY.get(lang, FALLBACK_SUMMARY["ja"]))


def alert_family(family_id: str | None, result: dict, lang: str) -> dict | None:
    """result: a /check-shaped dict. Stores a summary sentence only - never the transcript."""
    if not family_id:
        return None
    summary = _summary(result, lang)
    alert = STORE.add_alert(family_id, result["risk_level"], result.get("scam_type", "unknown"),
                            int(result.get("stage", 0)), summary)
    if not alert:
        return None
    fam = STORE.get_family(family_id) or {}
    # tokens given at pairing plus those registered later (/family/push), each once
    _push(_tokens(fam), lang, summary, alert)
    return alert


def _tokens(group: dict) -> list[str]:
    return list(dict.fromkeys([g["fcm_token"] for g in group.get("guardians", []) if g.get("fcm_token")]
                              + group.get("push_tokens", [])))


def _push(tokens: list[str], lang: str, summary: str, alert: dict, urgency: str = "high",
          titles: dict[str, str] = TITLE) -> None:
    if not tokens:
        return
    try:
        m = _messaging()
        resp = m.send_each_for_multicast(m.MulticastMessage(
            tokens=tokens, notification=m.Notification(title=titles.get(lang, titles["ja"]), body=summary),
            data={"alert_id": alert["id"], "risk_level": alert["risk_level"]},
            # high urgency: delivered at once to a phone in battery saving; useless after an hour
            webpush=m.WebpushConfig(headers={"Urgency": urgency, "TTL": "3600"})))
        failed = getattr(resp, "failure_count", 0)
        if isinstance(failed, int) and failed > 0:  # counts only: a dead token is otherwise invisible
            print(f"[notifier] push sent={getattr(resp, 'success_count', 0)} failed={failed}", file=sys.stderr)
    except Exception as e:
        print(f"[notifier] push unavailable: {type(e).__name__}: {str(e)[:120]}", file=sys.stderr)


def alert_household(household_id: str | None, result: dict, lang: str) -> dict | None:
    """Same as alert_family over a household: a summary sentence only, FCM best effort on top."""
    if not household_id:
        return None
    summary = _summary(result, lang)
    alert = STORE.add_household_alert(household_id, result["risk_level"], result.get("scam_type", "unknown"),
                                      int(result.get("stage", 0)), summary)
    if not alert:
        return None
    _push(_household_tokens(STORE.get_household(household_id) or {}), lang, summary, alert)
    return alert


def _household_tokens(hh: dict) -> list[str]:
    guardians = hh.get("guardians", [])
    uids = {g["uid"] for g in guardians}  # a removed guardian's push tokens are ignored
    own = [t["token"] for t in hh.get("push_tokens", []) if t.get("uid") in uids]
    return _tokens({"guardians": guardians, "push_tokens": own})


def notify_offline(household: dict, since_iso: str, lang: str) -> dict | None:
    """Tell the guardians the Live Guard device has been silent since `since_iso`. Normal urgency: nothing is on fire."""
    hours = max(1, int((datetime.now(timezone.utc) - datetime.fromisoformat(since_iso)).total_seconds() // 3600))
    summary = OFFLINE_TEXT.get(lang, OFFLINE_TEXT["ja"]).format(hours=hours)
    alert = STORE.add_household_alert(household["household_id"], "LOW", "device_offline", 0, summary)
    if alert:
        _push(_household_tokens(household), lang, summary, alert, urgency="normal", titles=OFFLINE_TITLE)
    return alert
