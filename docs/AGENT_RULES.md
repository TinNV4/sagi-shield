# Rules for the Antigravity agent

Paste into Antigravity workspace rules, or reference this file in each task.

- Source of truth: `docs/PLAN.md`. Work one phase at a time; tick its checkboxes when done.
- Follow the API contract in PLAN section 9 exactly; frontend types must match.
- Reuse `backend/core/*` — do not rewrite `risk_engine.py` / `input_layer.py`; extend them.
- Model names, project IDs, keys: only via `.env` / env vars. Never hard-code or commit secrets.
- Google stack only for infra: Gemini on Agent Platform (formerly Vertex AI), Gemini transcribe-live / Chirp 3 STT, Cloud Run, Firestore, Web Risk, FCM, Firebase Hosting.
- **Contest rules (PLAN section 0):** fresh code only — never paste code from older projects; respect OSS licences; no third-party copyrighted assets (incl. police audio) in the repo; **all code, comments, docs and commit messages in English** (UI strings may be ja/vi/en).
- **SDK currency — your training data is probably stale.** Before writing Gemini or ADK code, load the official Gemini API skills / ADK 2.x docs. Known traps:
  - `google-genai` 2.x: env var `GOOGLE_GENAI_USE_ENTERPRISE` (not `..._USE_VERTEXAI`); Live API uses `session.send_realtime_input(...)` (`Live.send` is being removed); prefer `response_json_schema=Model.model_json_schema()`; Gemini 3.x uses `thinking_level` (`"low"` on the live path), not `thinking_budget`.
  - `google-adk` 2.x is graph/workflow based; 1.x examples do not run.
  - `gemini-3.5-transcribe-live` sessions end after 10 minutes — always implement rotation.
- Privacy: never store raw audio; HMAC phone numbers (key from Secret Manager); mask PII before logging.
- Every phase ends with: tests pass → `infra/deploy.sh` → smoke test on a phone.
- Keep user-facing text short and calm; never output "100% safe".
- Prefer small, reusable modules and CLI entry points so each part can be tested alone.
- Commit small and often — the git history is our proof of work done inside the hackathon window.

Task template:
> Implement P<n> from docs/PLAN.md. Follow section 9 contracts. Reuse backend/core. Write tests. Tick checkboxes when done. Summarize what changed and how to run it.
