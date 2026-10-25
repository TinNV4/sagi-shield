#!/usr/bin/env bash
# Deploy the API to Cloud Run from source (Cloud Build builds backend/Dockerfile).
#   PROJECT=my-project ./infra/deploy.sh            one-time project setup first: infra/setup.ps1
#   MIN_INSTANCES=1 for the demo (no cold start, WebSocket stays warm); 0 the rest of the time (no idle cost)
#   The pilot service, by hand (deploy-pilot.yml does the same on every push to the pilot branch):
#   SERVICE=sagi-shield-pilot FIRESTORE_DB=pilot NO_ANALYTICS=1 VITE_ENV_LABEL=PILOT PROJECT=... ./infra/deploy.sh
set -euo pipefail
: "${PROJECT:?set PROJECT to your GCP project id}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-sagi-shield-api}"
FIRESTORE_DB="${FIRESTORE_DB:-(default)}"   # one Firestore database per environment (app/storage.py)
export VITE_ENV_LABEL="${VITE_ENV_LABEL:-}"  # PILOT: badge + distinct PWA name (frontend/src/lib/envLabel.ts)
cd "$(dirname "$0")/../frontend"
if [ -z "${SKIP_FRONTEND:-}" ]; then               # SKIP_FRONTEND=1: backend-only change, keep backend/static as built
  # the PWA is served by the API itself (one URL, same origin); App Check values (infra/setup_appcheck.ps1), if
  # exported as VITE_FIREBASE_API_KEY / VITE_FIREBASE_APP_ID / VITE_RECAPTCHA_SITE_KEY (+ VITE_FIREBASE_VAPID_KEY
  # for guardian push), are baked into the build. VITE_FIREBASE_AUTH_DOMAIN (Google sign-in popup host) is optional:
  # unset -> <project>.firebaseapp.com
  VITE_API_BASE=same-origin VITE_FIREBASE_PROJECT_ID="${VITE_FIREBASE_PROJECT_ID:-$PROJECT}" npm run build
  rm -rf ../backend/static && cp -r dist ../backend/static
fi
cd ../backend

# one --set-env-vars only: gcloud keeps the last one when the flag is repeated. "^@^" = use @ as the separator,
# so CORS_ORIGINS may contain commas.
ENV="GOOGLE_GENAI_USE_ENTERPRISE=true@GOOGLE_CLOUD_PROJECT=$PROJECT@GOOGLE_CLOUD_LOCATION=global"
ENV="$ENV@STORE=firestore@FIRESTORE_DB=$FIRESTORE_DB@USE_WEBRISK=1@USE_LLM=1@CORS_ORIGINS=${CORS_ORIGINS:-*}"
if [ -z "${NO_ANALYTICS:-}" ]; then                 # analytics stream (app/analytics.py); the pilot runs without one
  ENV="$ENV@BQ_TABLE=$PROJECT.sagi.events"
fi
# Models: backend/core/model_ids.py holds the defaults Cloud Run runs; a job's env var set in this shell overrides it
# APPCHECK (off | monitor | enforce), RATE_LIMIT_UNVERIFIED_PER_MIN, AUTH (firebase | off; unset = firebase) and
# LEGACY_FAMILY (0 = /family/* answers 410; unset = on) travel the same way
for job in GEMINI_MODEL GEMINI_VISION_MODEL GEMINI_LIVE_MODEL GEMINI_CONFIRM_MODEL GEMINI_DEEP_MODEL STT_BATCH_MODEL            APPCHECK RATE_LIMIT_UNVERIFIED_PER_MIN AUTH LEGACY_FAMILY VERDICT_TABLE; do
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

# the monthly phishing-list reload (infra/setup_phish_job.ps1) runs from the production image: keep it current
if [ "$SERVICE" = "sagi-shield-api" ] && gcloud run jobs describe sagi-phish-loader --project "$PROJECT" --region "$REGION" >/dev/null 2>&1; then
  IMAGE="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(spec.template.spec.containers[0].image)')"
  gcloud run jobs update sagi-phish-loader --project "$PROJECT" --region "$REGION" --image "$IMAGE" --quiet
fi

# the hourly heartbeat sweep (infra/setup_heartbeat_job.ps1) runs from the pilot image (it reads the pilot database)
if [ "$SERVICE" = "sagi-shield-pilot" ] && gcloud run jobs describe sagi-heartbeat-sweep --project "$PROJECT" --region "$REGION" >/dev/null 2>&1; then
  IMAGE="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(spec.template.spec.containers[0].image)')"
  gcloud run jobs update sagi-heartbeat-sweep --project "$PROJECT" --region "$REGION" --image "$IMAGE" --quiet
fi

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
echo "Deployed: $URL"
curl -fsS "$URL/health" && echo
