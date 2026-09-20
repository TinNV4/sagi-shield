#!/usr/bin/env bash
# Deploy the API to Cloud Run (PLAN P0 / P2).  NOT YET RUN - written 2026-09-21 without gcloud access.
#   PROJECT=my-project ./infra/deploy.sh
# One-time setup:
#   gcloud services enable run.googleapis.com aiplatform.googleapis.com firestore.googleapis.com \
#       webrisk.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com
#   printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create sagi-hash-key --data-file=-
#   grant the Cloud Run service account: roles/aiplatform.user, roles/datastore.user,
#       roles/secretmanager.secretAccessor (on sagi-hash-key), roles/webrisk.user
set -euo pipefail
: "${PROJECT:?set PROJECT to your GCP project id}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-sagi-shield-api}"
cd "$(dirname "$0")/../backend"

gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --source . \
  --allow-unauthenticated \
  --timeout 3600 --session-affinity --min-instances 1 --max-instances 3 \
  --concurrency 40 --cpu 1 --memory 1Gi --no-use-http2 \
  --set-env-vars "GOOGLE_GENAI_USE_ENTERPRISE=true,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=global" \
  --set-env-vars "GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.8-flash},STORE=firestore,USE_WEBRISK=1,USE_LLM=1" \
  --set-env-vars "CORS_ORIGINS=${CORS_ORIGINS:-*}" \
  --set-secrets "HASH_KEY=sagi-hash-key:latest"

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
echo "Deployed: $URL"
curl -fsS "$URL/healthz" && echo
