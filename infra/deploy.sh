#!/usr/bin/env bash
# Deploy the API to Cloud Run from source (Cloud Build builds backend/Dockerfile).
#   PROJECT=my-project ./infra/deploy.sh            one-time project setup first: infra/setup.ps1
#   MIN_INSTANCES=1 for the demo (no cold start, WebSocket stays warm); 0 the rest of the time (no idle cost)
set -euo pipefail
: "${PROJECT:?set PROJECT to your GCP project id}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-sagi-shield-api}"
cd "$(dirname "$0")/../frontend"
if [ -z "${SKIP_FRONTEND:-}" ]; then               # SKIP_FRONTEND=1: backend-only change, keep backend/static as built
  # the PWA is served by the API itself (one URL, same origin); App Check values (infra/setup_appcheck.ps1), if
  # exported as VITE_FIREBASE_API_KEY / VITE_FIREBASE_APP_ID / VITE_RECAPTCHA_SITE_KEY (+ VITE_FIREBASE_VAPID_KEY
  # for guardian push), are baked into the build
  VITE_API_BASE=same-origin VITE_FIREBASE_PROJECT_ID="${VITE_FIREBASE_PROJECT_ID:-$PROJECT}" npm run build
  rm -rf ../backend/static && cp -r dist ../backend/static
fi
cd ../backend

# one --set-env-vars only: gcloud keeps the last one when the flag is repeated. "^@^" = use @ as the separator,
# so CORS_ORIGINS may contain commas.
ENV="GOOGLE_GENAI_USE_ENTERPRISE=true@GOOGLE_CLOUD_PROJECT=$PROJECT@GOOGLE_CLOUD_LOCATION=global"
ENV="$ENV@STORE=firestore@USE_WEBRISK=1@USE_LLM=1@CORS_ORIGINS=${CORS_ORIGINS:-*}"
# Models: backend/core/model_ids.py holds the defaults Cloud Run runs; a job's env var set in this shell overrides it
# APPCHECK (off | monitor | enforce) and RATE_LIMIT_UNVERIFIED_PER_MIN travel the same way
for job in GEMINI_MODEL GEMINI_VISION_MODEL GEMINI_LIVE_MODEL GEMINI_CONFIRM_MODEL GEMINI_DEEP_MODEL STT_BATCH_MODEL            APPCHECK RATE_LIMIT_UNVERIFIED_PER_MIN; do
  if [ -n "${!job:-}" ]; then ENV="$ENV@$job=${!job}"; fi
done

# Optional: gemini-3.5-transcribe is served by the Gemini Developer API only (not Agent Platform, 2026-09-21).
# Create the secret yourself (the key never goes through this script):
#   gcloud secrets create sagi-stt-api-key --data-file=-     then paste the key, Ctrl+Z / Ctrl+D
#   gcloud secrets add-iam-policy-binding sagi-stt-api-key --member="serviceAccount:sagi-api@$PROJECT.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
SECRETS="HASH_KEY=sagi-hash-key:latest"
if gcloud secrets describe sagi-stt-api-key --project "$PROJECT" >/dev/null 2>&1; then
  SECRETS="$SECRETS,STT_API_KEY=sagi-stt-api-key:latest"
fi

gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --source . \
  --service-account "sagi-api@$PROJECT.iam.gserviceaccount.com" --allow-unauthenticated \
  --timeout 3600 --session-affinity --min-instances "${MIN_INSTANCES:-0}" --max-instances 3 \
  --concurrency 40 --cpu 1 --memory 1Gi --no-use-http2 \
  --set-env-vars "^@^$ENV" --set-secrets "$SECRETS"

# the monthly phishing-list reload (infra/setup_phish_job.ps1) runs from the same image: keep it current
if gcloud run jobs describe sagi-phish-loader --project "$PROJECT" --region "$REGION" >/dev/null 2>&1; then
  IMAGE="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(spec.template.spec.containers[0].image)')"
  gcloud run jobs update sagi-phish-loader --project "$PROJECT" --region "$REGION" --image "$IMAGE" --quiet
fi

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
echo "Deployed: $URL"
curl -fsS "$URL/health" && echo
