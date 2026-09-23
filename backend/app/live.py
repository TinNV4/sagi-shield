"""
Sagi Shield - Live Guard over WebSocket, TEXT mode (privacy tiers, PLAN section 6.9).

Speech-to-text runs ON THE DEVICE (Web Speech API on-device mode); audio never leaves it. The client
sends finalized transcript lines only:

  -> {"type": "transcript", "text": "...", "final": true}     interim (final=false) lines are ignored
  -> {"type": "reset"}                                         user tapped "I am safe now"
  <- {"risk_score", "risk_level", "stage", "trigger_phrase", "transcript_tail", "advice", "speak"?, "session_id"}
  <- {"event": "session_reset"}                                silence timeout = the call ended
  <- ..., "precursor": true                                    this call looks like the set-up call of a two-call scam

Cross-call memory: a set-up call ("my number changed, I have a cold") asks for nothing, the money request comes a day
later. The server remembers nothing between sockets; the DEVICE keeps a flag + timestamp (no text) for 48 h and
reconnects with ?prior=precursor. Inside one long-lived kiosk socket the tracker carries the flag across calls.

Tier 0: rules on every line, on the device's text only. Tier 1: the rolling window (phone / account numbers masked)
goes to Gemini. Two gates (?gate=, default LIVE_LLM_GATE or "periodic"):
  periodic  after the first few lines, at most every LIVE_PERIODIC_S seconds, whatever the rules say. Measured on
            real police recordings (2026-09-21): natural speech rarely matches the rule patterns - a call the model
            scores 97 got 50 from the rules, another 0 - so a rules-only gate never consults the judge on real calls.
  rules     strict privacy: only once the rules reach MEDIUM (20 after a set-up call), at most every LIVE_LLM_EVERY_S s.
Audio never leaves the device in either mode.
What the judge sees: the last WINDOW_LINES lines (~30 s), with the first PIN_LINES lines of the call pinned on top once
they have rolled out (the authority claim is said once, in minute 1), plus a text-free <call_state> block from the
tracker (stages reached so far, playbook, minutes, set-up call remembered). Without both, minute 6 of a fake-police
call ("transfer before 3 pm") reads like a bank calling. About 30 extra tokens per look.
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

from .analytics import log_event
from .notifier import alert_family
from .verdict_log import log_verdict

router = APIRouter()
WINDOW_LINES, MAX_LINE = 12, 500   # ~30 s of speech
PIN_LINES, OPENING_GAP = 3, "[...]"  # the opening of the call stays in every window: "this is the police" is said once


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
    periodic_s = float(os.getenv("LIVE_PERIODIC_S", "20"))
    periodic_lines = int(os.getenv("LIVE_PERIODIC_LINES", "6"))  # half a window: no line is ever dropped unjudged
    periodic = (ws.query_params.get("gate") or os.getenv("LIVE_LLM_GATE", "periodic")) == "periodic"
    # ?context=off / LIVE_CONTEXT=0: the judge reads the bare window (A/B runs in tools/replay_live.py); on by default
    with_context = (ws.query_params.get("context") or os.getenv("LIVE_CONTEXT", "on")) not in ("off", "0")
    pack = engine.LANG_PACKS[lang]
    tracker, window = engine.LiveTracker(), deque(maxlen=WINDOW_LINES)
    tracker.prior_precursor = ws.query_params.get("prior") == "precursor"
    family_id = ws.query_params.get("family_id")
    state = {"session": uuid.uuid4().hex[:12], "spoken": False, "last_llm": float("-inf"), "task": None,  # -inf = never: monotonic() is small on a freshly booted machine
             "scam_type": "unknown", "reasons": [], "unseen": 0, "started": time.monotonic(), "opening": [], "lines": 0, "looks": 0}

    def reset():
        tracker.reset()
        window.clear()
        if state["task"]:
            state["task"].cancel()
        state.update(session=uuid.uuid4().hex[:12], spoken=False, last_llm=float("-inf"), task=None, scam_type="unknown", reasons=[],
                     unseen=0, started=time.monotonic(), opening=[], lines=0, looks=0)

    def judge_text() -> str:
        # once the first lines have rolled out of the window they come back on top: the kill chain starts with the
        # authority claim, and a window from minute 6 read without it looks like a bank calling
        if with_context and state["lines"] > WINDOW_LINES:
            return "\n".join([*state["opening"], OPENING_GAP, *window])
        return "\n".join(window)

    def call_state() -> str | None:
        if not with_context:
            return None
        return tracker.call_state((time.monotonic() - state["started"]) / 60, state["scam_type"])

    async def send(score: float, trigger: str = ""):
        # HIGH is only announced once latched (2 consecutive windows) - no one-window red flashes
        score = round(score if tracker.latched else min(score, 69))
        lv = engine.level(score)
        msg = {"risk_score": score, "risk_level": lv, "stage": tracker.max_stage, "trigger_phrase": trigger,
               "transcript_tail": window[-1] if window else "", "advice": pack["advice"][lv],
               "session_id": state["session"]}
        if tracker.precursor:
            # the device stores the flag; nothing about the call is kept here. False = this call became an alarm:
            # it was the scam itself, not a set-up call - the device drops the flag it stored a minute ago
            msg["precursor"] = not tracker.latched
        first_high = lv == "HIGH" and not state["spoken"]
        if first_high:
            state["spoken"], msg["speak"] = True, pack["speak"]
        await ws.send_json(msg)  # the person on the phone is warned first; the family push must never delay it
        if first_high:
            log_event("live_alarm", lang=lang, source="live", risk_level=lv, risk_score=score, scam_type=state["scam_type"], stage=tracker.max_stage)
        if first_high and family_id:
            reasons = state["reasons"] or engine.rule_reasons(tracker.hits, lang)
            await asyncio.to_thread(alert_family, family_id, {**msg, "scam_type": state["scam_type"], "reasons": reasons}, lang)

    async def ask_llm(text: str, session: str, trigger: str):
        # during a call every second counts: flash-lite scored 15/15 on tools/compare_llm.py at ~2.3 s median,
        # against ~6.9 s for the Quick Check model (2026-09-21)
        ctx = call_state()  # what the rest of the call already showed: stages, playbook, minutes - never its words
        model = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.5-flash-lite")
        t0 = time.monotonic()
        v = await asyncio.to_thread(engine.llm_verdict, text, lang, None, model, ctx)
        look = {"session": session, "lang": lang, "look": state["looks"], "trigger": trigger, "gate": "periodic" if periodic else "rules",
                "window_lines": len(window), "pinned": with_context and state["lines"] > WINDOW_LINES, "call_state": ctx,
                "rules": {"score": engine.rule_score(tracker.hits, tracker.reporting, combos=False),
                          "hits": {engine.Stage(s).name: m for s, m in tracker.hits.items() if m},
                          "hard": bool(engine.hard_floor(tracker.hits)), "reporting": tracker.reporting},
                "llm": {"model": model, **v.model_dump()} if v else None, "second": None, "text": text}
        state["looks"] += 1
        if v is None:
            log_verdict("live_look", **look, llm_error="no verdict", latency_ms=round((time.monotonic() - t0) * 1000))
        if v and session == state["session"]:  # the call may have been reset while we waited
            state["scam_type"], state["reasons"] = v.scam_type, v.reasons
            tracker.precursor = tracker.precursor or engine.is_setup_call(v)  # the model hears what regexes miss

            def second_opinion():
                s = engine.second_opinion(text, lang, ctx)
                look["second"] = {"model": os.getenv("GEMINI_CONFIRM_MODEL", "gemini-3.8-flash"), **s.model_dump()} if s else {"error": "no verdict"}
                return s

            if engine.calm(v) and engine.hard_floor(tracker.hits) and not engine.hard_floor(tracker.hits, reviewable=False):
                # authority + fear + money, and the fast judge says legitimate (a bank's fraud desk sounds like this):
                # only a second, different model may lift the floor
                second = await asyncio.to_thread(second_opinion)
                tracker.review_veto = engine.calm(second)
            rules_now = engine.rule_score(tracker.hits, tracker.reporting, combos=False)
            # one flaky verdict would stay in the EMA and latch: an uncorroborated alarm needs a second model to agree
            llm = await asyncio.to_thread(engine.llm_score_confirmed, v, rules_now, second_opinion)
            if session == state["session"]:
                fused = tracker.update({}, llm, v.stage, v.confidence)
                log_verdict("live_look", **look, llm_score=llm, score=round(fused), level=engine.level(fused),
                            latched=tracker.latched, review_veto=tracker.review_veto, precursor=tracker.precursor,
                            latency_ms=round((time.monotonic() - t0) * 1000))
                await send(fused)

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
            state["lines"] += 1
            if len(state["opening"]) < PIN_LINES:
                state["opening"].append(text)
            hits = engine.rule_stages(text, lang)
            tracker.note_precursor(engine.precursor_hits(text, lang))
            score = tracker.update(hits, reporting=engine.is_reporting(text, lang))
            await send(score, next((m[-1] for _, m in sorted(hits.items(), reverse=True)), ""))

            idle = state["task"] is None or state["task"].done()
            state["unseen"] += 1
            since = time.monotonic() - state["last_llm"]
            ask_from = 20 if tracker.prior_precursor else 40  # after a set-up call the model is consulted earlier
            by_rules = score >= ask_from and since >= llm_every_s
            # the clock alone leaves holes: a fast talker says more than one window in periodic_s, and a short call ends
            # before the second look - so a batch of unseen lines also triggers a look
            by_clock = periodic and len(window) >= 4 and since >= llm_every_s and (
                (state["unseen"] >= 3 and since >= periodic_s) or state["unseen"] >= periodic_lines)
            if _use_llm() and idle and (by_rules or by_clock):
                trigger = "rules" if by_rules else ("lines" if state["unseen"] >= periodic_lines else "clock")
                state["last_llm"], state["unseen"] = time.monotonic(), 0
                state["task"] = asyncio.create_task(ask_llm(judge_text(), state["session"], trigger))
    except WebSocketDisconnect:
        pass
    finally:
        if state["task"]:
            state["task"].cancel()
