"""Give the Looker Studio dashboard something to draw. Two parts, both through the public API of a deployed service:

  checks   every call of the committed evaluation sets goes through POST /check. Synthetic input, REAL verdicts.
  reports  SIMULATED community reports (no phone number, keyword "demo-seed" so they can be found and deleted).
           Any slide or video frame that shows the map must say "simulated data".

  python tools/seed_dashboard.py https://<service-url> checks
  python tools/seed_dashboard.py https://<service-url> reports
"""
import json, pathlib, random, sys, time, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SETS = ["ja_final", "vi_final", "ja_hardneg", "vi_hardneg"]
# rough weights by population, so the map is not uniform
PREFECTURES = {"Tokyo": 14, "Kanagawa": 9, "Osaka": 9, "Aichi": 7, "Saitama": 7, "Chiba": 6, "Hyogo": 5, "Hokkaido": 5,
               "Fukuoka": 5, "Shizuoka": 4, "Ibaraki": 3, "Hiroshima": 3, "Kyoto": 3, "Miyagi": 2, "Niigata": 2, "Nagano": 2,
               "Gifu": 2, "Okayama": 2, "Kumamoto": 2, "Okinawa": 1}
TYPES = {"fake_police": 40, "family_impersonation": 20, "fake_billing": 15, "refund": 15, "investment": 10}


def post(url: str, body: dict) -> dict | None:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json"})
    for attempt in (1, 2, 3):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=120).read())
        except urllib.error.HTTPError as e:
            if e.code != 429:
                print(f"  HTTP {e.code}")
                return None
            time.sleep(20 * attempt)  # the per-client rate limit (30 / min)
        except Exception as e:
            print(f"  {type(e).__name__}")
            time.sleep(5)
    return None


def checks(base: str) -> None:
    levels: dict[str, int] = {}
    for name in SETS:
        path = ROOT / "backend" / "eval" / f"{name}.jsonl"
        for line in path.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            out = post(base + "/check", {"text": row["text"], "lang": name[:2]})
            if out:
                levels[out["risk_level"]] = levels.get(out["risk_level"], 0) + 1
            time.sleep(2.2)  # stay under the rate limit
        print(name, levels)


def reports(base: str, n: int = 60) -> None:
    rng = random.Random(11)
    for i in range(n):
        body = {"scam_type": rng.choices(list(TYPES), TYPES.values())[0], "keywords": ["demo-seed"], "consent": True, "lang": "ja",
                "prefecture": rng.choices(list(PREFECTURES), PREFECTURES.values())[0], "reporter_id": f"demo-seed-{i:03}-padding-16"}
        print(i, body["prefecture"], body["scam_type"], post(base + "/report", body))
        time.sleep(2.2)


if __name__ == "__main__":
    {"checks": checks, "reports": reports}[sys.argv[2]](sys.argv[1].rstrip("/"))
