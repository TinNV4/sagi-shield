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
                seen["precursor"] = seen["precursor"] or bool(m.get("precursor"))
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
    a = ap.parse_args()
    import risk_engine  # noqa: F401  (.env)
    from app import services
    prior = False
    for name in a.files:
        path = pathlib.Path(a.dir) / name
        heard = services.transcribe_audio(path.read_bytes(), "audio/mpeg" if name.endswith(".mp3") else "audio/wav", "ja") or ""
        t = time.time()
        r = asyncio.run(replay(a.url, name, sentences(heard), prior and not a.no_memory, a.pace, a.gate))
        level = "HIGH" if r["high_at_line"] is not None else "MEDIUM" if r["max"] >= 40 else "LOW"
        print(f"{name:12} lines={r['lines']:3} prior={str(prior and not a.no_memory):5} -> {level:6} max={r['max']:3} "
              f"alarm_at_line={r['high_at_line']} spoken={r['speak']} setup_call={r['precursor']} ({time.time() - t:.0f}s)")
        prior = prior or r["precursor"]


if __name__ == "__main__":
    main()
