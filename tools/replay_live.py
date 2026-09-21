"""Replay recorded calls through the LIVE path (WS /ws/live) the way a device would: transcript lines arrive one by
one, and the "set-up call heard" flag is carried from one call to the next like the app's localStorage does.

  python tools/replay_live.py https://<service-url> n1-1.mp3 n1-2.mp3 ...      # files in backend/eval/real_heldout/
  python tools/replay_live.py https://<service-url> --dir tools/test_audio ja_scam_ore_ore.wav

Transcription happens here with the product's chain (stand-in for on-device STT); only text goes over the socket.
Prints levels and flags only - never the transcript. Private recordings stay private (see tools/eval_real_audio.py).
"""
import argparse, asyncio, json, pathlib, re, sys, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend")); sys.path.insert(0, str(ROOT / "backend" / "core"))


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[。？！?!])|\n", text) if s and s.strip()]


async def replay(url: str, name: str, lines: list[str], prior: bool, pace: float, gate: str) -> dict:
    import websockets
    ws_url = url.replace("https://", "wss://").replace("http://", "ws://").rstrip("/") + f"/ws/live?lang=ja&input=text&gate={gate}" + ("&prior=precursor" if prior else "")
    seen = {"max": 0, "high_at_line": None, "precursor": False, "speak": False, "msgs": 0}
    order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
    async with websockets.connect(ws_url) as ws:
        sent = {"n": 0}

        async def reader():
            async for raw in ws:
                m = json.loads(raw)
                if "risk_level" not in m:
                    continue
                seen["msgs"] += 1
                seen["max"] = max(seen["max"], m["risk_score"])
                if "precursor" in m:
                    seen["precursor"] = bool(m["precursor"])  # the last word counts: false once the call became an alarm
                seen["speak"] = seen["speak"] or bool(m.get("speak"))
                if order[m["risk_level"]] == 2 and seen["high_at_line"] is None:
                    seen["high_at_line"] = sent["n"]
        task = asyncio.create_task(reader())
        for line in lines:
            await ws.send(json.dumps({"type": "transcript", "text": line[:500], "final": True}))
            sent["n"] += 1
            await asyncio.sleep(pace)
        await asyncio.sleep(8)  # let the last background verdict arrive
        task.cancel()
    return {"file": name, "lines": len(lines), **seen}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("url"); ap.add_argument("files", nargs="+")
    ap.add_argument("--dir", default=str(ROOT / "backend" / "eval" / "real_heldout"))
    ap.add_argument("--pace", type=float, default=2.5, help="seconds between lines (speech is ~1 sentence / 3-4 s)")
    ap.add_argument("--gate", default="periodic", choices=["periodic", "rules"])
    ap.add_argument("--no-memory", action="store_true", help="do not carry the set-up-call flag between calls")
    ap.add_argument("--by-case", action="store_true", help="files named case-N.ext belong to one scam: memory is reset when the case changes")
    ap.add_argument("--out", help="write one JSON row per call (levels and flags only)")
    a = ap.parse_args()
    import risk_engine  # noqa: F401  (.env)
    from app import services
    prior, last_case, rows = False, None, []
    if a.out and pathlib.Path(a.out).exists():  # resume: a long run must survive one bad handshake
        rows = json.loads(pathlib.Path(a.out).read_text(encoding="utf-8"))
    done = {r["file"]: r for r in rows}
    for name in a.files:
        # n1-1 ... n1-7 are successive calls of ONE scam; k1-1 ... k1-4 are four unrelated fake-police calls
        case = name if name.startswith("k") else re.sub(r"-\d+\.\w+$", "", name)
        if a.by_case and case != last_case:
            prior, last_case = False, case  # a different victim / device
        if name in done:
            prior = prior or done[name]["setup_call"]
            continue
        path = pathlib.Path(a.dir) / name
        heard = services.transcribe_audio(path.read_bytes(), "audio/mpeg" if name.endswith(".mp3") else "audio/wav", "ja") or ""
        t = time.time()
        for attempt in (1, 2, 3):
            try:
                r = asyncio.run(replay(a.url, name, sentences(heard), prior and not a.no_memory, a.pace, a.gate))
                break
            except Exception as e:  # cold start / handshake timeout on Cloud Run
                print(f"  {name}: {type(e).__name__}, retry {attempt}")
                time.sleep(10 * attempt)
        else:
            continue
        level = "HIGH" if r["high_at_line"] is not None else "MEDIUM" if r["max"] >= 40 else "LOW"
        print(f"{name:12} lines={r['lines']:3} prior={str(prior and not a.no_memory):5} -> {level:6} max={r['max']:3} "
              f"alarm_at_line={r['high_at_line']} spoken={r['speak']} setup_call={r['precursor']} ({time.time() - t:.0f}s)")
        prior = prior or r["precursor"]
        rows.append({"file": name, "case": case, "level": level, "max": r["max"], "alarm_at_line": r["high_at_line"], "lines": r["lines"], "setup_call": r["precursor"]})
        if a.out:
            pathlib.Path(a.out).write_text(json.dumps(rows, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
