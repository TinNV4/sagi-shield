# Sagi Shield（サギシールド）

AI guard against phone scams (オレオレ詐欺 / ニセ警察詐欺, and Vietnamese fake-police scams).
Google AI Builder Cup 2026 · Track: BFSI.

- Plan & decisions: [docs/PLAN.md](docs/PLAN.md)
- UI prompt for AI Studio Build: [docs/AI_STUDIO_UI_PROMPT.md](docs/AI_STUDIO_UI_PROMPT.md)
- Rules for the Antigravity agent: [docs/AGENT_RULES.md](docs/AGENT_RULES.md)

## Quick start (backend core)

```bash
cd backend
pip install -r requirements.txt
cp ../.env.example ../.env   # fill in project / key

# rules-only smoke test
python core/risk_engine.py --lang ja --no-llm --text "警察です。口座が犯罪に使われています。LINEで逮捕状を送ります"
python core/input_layer.py --lang vi --text "Công an đây, gọi lại +85598765432, vào https://vneid-xacminh.top"

# rules regression tests (no network)
python -m pytest tests -q

# run the API locally (rules only, in-memory store)
USE_LLM=0 uvicorn app.main:app --port 8080

# dataset + eval
python core/gen_dataset.py seed --lang ja --out eval/ja_seed.jsonl
python core/gen_dataset.py eval --data eval/ja_seed.jsonl --lang ja --no-llm
python core/gen_dataset.py gen  --lang vi --n 100 --out eval/vi.jsonl   # needs Gemini access
```

## Structure

```
docs/       plan, UI prompt, agent rules
backend/    core engine + FastAPI app (app/), tests, Dockerfile
infra/      Cloud Run deploy script
frontend/   AI Studio Build export goes here; lib/audioCapture.js ready
```
