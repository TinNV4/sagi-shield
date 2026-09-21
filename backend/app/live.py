"""
Sagi Shield - Live Guard over WebSocket, TEXT mode (privacy tiers, PLAN section 6.9).

Speech-to-text runs ON THE DEVICE (Web Speech API on-device mode); audio never leaves it. The client
sends finalized transcript lines only:

  -> {"type": "transcript", "text": "...", "final": true}     interim (final=false) lines are ignored
  -> {"type": "reset"}                                         user tapped "I am safe now"
  <- {"risk_score", "risk_level", "stage", "trigger_phrase", "transcript_tail", "advice", "speak"?, "session_id"}
  <- {"event": "session_reset"}                                silence timeout = the call ended

Tier 0: rules on every line, nothing else. Tier 1: only once the rules reach MEDIUM is the rolling
window (phone / account numbers masked) sent to Gemini, at most every LIVE_LLM_EVERY_S seconds.
Nothing is stored; the window lives in this coroutine's memory and dies with the socket.
"""
from __future__ import annotations
import asyncio
import os
import time
import uuid
from collections import deque

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import risk_engine as engine  # app.main put backend/core on sys.path
from input_layer import build_evidence

from .notifier import alert_family

router = APIRouter()
WINDOW_LINES, MAX_LINE = 12, 500   # ~30 s of speech


def _use_llm() -> bool:
    return os.getenv("USE_LLM", "1") == "1"


@router.websocket("/ws/live")
async def live(ws: WebSocket):
    lang = ws.query_params.get("lang", "ja")
    if lang not in engine.LANG_PACKS or ws.query_params.get("input", "text") != "text":
        await ws.close(code=1008)  # audio input (server-side STT) is not implemented
        return
    await ws.accept()
    silence_s = float(os.getenv("LIVE_SILENCE_S", "45"))
    llm_every_s = float(os.getenv("LIVE_LLM_EVERY_S", "5"))
    pack = engine.LANG_PACKS[lang]
    tracker, window = engine.LiveTracker(), deque(maxlen=WINDOW_LINES)
    family_id = ws.query_params.get("family_id")
    state = {"session": uuid.uuid4().hex[:12], "spoken": False, "last_llm": 0.0, "task": None,
             "scam_type": "unknown", "reasons": []}

    def reset():
        tracker.reset()
        window.clear()
        if state["task"]:
            state["task"].cancel()
        state.update(session=uuid.uuid4().hex[:12], spoken=False, last_llm=0.0, task=None, scam_type="unknown", reasons=[])

    async def send(score: float, trigger: str = ""):
        # HIGH is only announced once latched (2 consecutive windows) - no one-window red flashes
        score = round(score if tracker.latched else min(score, 69))
        lv = engine.level(score)
        msg = {"risk_score": score, "risk_level": lv, "stage": tracker.max_stage, "trigger_phrase": trigger,
               "transcript_tail": window[-1] if window else "", "advice": pack["advice"][lv],
               "session_id": state["session"]}
        first_high = lv == "HIGH" and not state["spoken"]
        if first_high:
            state["spoken"], msg["speak"] = True, pack["speak"]
        await ws.send_json(msg)  # the person on the phone is warned first; the family push must never delay it
        if first_high and family_id:
            reasons = state["reasons"] or engine.rule_reasons(tracker.hits, lang)
            await asyncio.to_thread(alert_family, family_id, {**msg, "scam_type": state["scam_type"], "reasons": reasons}, lang)

    async def ask_llm(text: str, session: str):
        # during a call every second counts: flash-lite scored 15/15 on tools/compare_llm.py at ~2.3 s median,
        # against ~6.9 s for the Quick Check model (2026-09-21)
        v = await asyncio.to_thread(engine.llm_verdict, text, lang, None, os.getenv("GEMINI_LIVE_MODEL", "gemini-3.5-flash-lite"))
        if v and session == state["session"]:  # the call may have been reset while we waited
            state["scam_type"], state["reasons"] = v.scam_type, v.reasons
            rules_now = engine.rule_score(tracker.hits, tracker.reporting, combos=False)
            await send(tracker.update({}, engine.llm_score(v, corroborated=rules_now >= 40), v.stage, v.confidence))

    try:
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=silence_s)
            except asyncio.TimeoutError:
                if tracker.history:  # only announce the end of a call that actually had speech
                    reset()
                    await ws.send_json({"event": "session_reset"})
                continue
            except ValueError:
                continue  # not JSON: ignore, keep the socket
            if not isinstance(msg, dict):
                continue
            if msg.get("type") == "reset":
                reset()
                await ws.send_json({"event": "session_reset"})
                continue
            text = str(msg.get("text") or "")[:MAX_LINE].strip()
            if msg.get("type") != "transcript" or not msg.get("final", True) or not text:
                continue
            text = build_evidence(lang=lang, text=text).text  # numbers masked before anything else sees them
            window.append(text)
            hits = engine.rule_stages(text, lang)
            score = tracker.update(hits, reporting=engine.is_reporting(text, lang))
            await send(score, next((m[-1] for _, m in sorted(hits.items(), reverse=True)), ""))

            idle = state["task"] is None or state["task"].done()
            if _use_llm() and score >= 40 and idle and time.monotonic() - state["last_llm"] >= llm_every_s:
                state["last_llm"] = time.monotonic()
                state["task"] = asyncio.create_task(ask_llm("\n".join(window), state["session"]))
    except WebSocketDisconnect:
        pass
    finally:
        if state["task"]:
            state["task"].cancel()
