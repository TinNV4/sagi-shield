#!/usr/bin/env bash
# Deploy the API to Cloud Run from source (Cloud Build builds backend/Dockerfile).
#   PROJECT=my-project ./infra/deploy.sh            one-time project setup first: infra/setup.ps1
#   MIN_INSTANCES=1 for the demo (no cold start, WebSocket stays warm); 0 the rest of the time (no idle cost)
set -euo pipefail
: "${PROJECT:?set PROJECT to your GCP project id}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-sagi-shield-api}"
cd "$(dirname "$0")/../backend"

# one --set-env-vars only: gcloud keeps the last one when the flag is repeated. "^@^" = use @ as the separator,
# so CORS_ORIGINS may contain commas.
ENV="GOOGLE_GENAI_USE_ENTERPRISE=true@GOOGLE_CLOUD_PROJECT=$PROJECT@GOOGLE_CLOUD_LOCATION=global"
ENV="$ENV@GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.8-flash}@STORE=firestore@USE_WEBRISK=1@USE_LLM=1@CORS_ORIGINS=${CORS_ORIGINS:-*}"

gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --source . \
  --service-account "sagi-api@$PROJECT.iam.gserviceaccount.com" --allow-unauthenticated \
  --timeout 3600 --session-affinity --min-instances "${MIN_INSTANCES:-0}" --max-instances 3 \
  --concurrency 40 --cpu 1 --memory 1Gi --no-use-http2 \
  --set-env-vars "^@^$ENV" --set-secrets "HASH_KEY=sagi-hash-key:latest"

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
echo "Deployed: $URL"
curl -fsS "$URL/healthz" && echo
