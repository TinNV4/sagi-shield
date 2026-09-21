# Gives the Cloud Run service access to gemini-3.5-transcribe, which is served by the Gemini Developer API only
# (not by Agent Platform, 2026-09-21). Run it yourself, once:
#   pwsh infra/setup_stt_key.ps1 -Project sagi-shield-123456
#
# It creates an API key INSIDE the billed project (so it is not a 20-requests-a-day free-tier key), restricted to
# the Generative Language API, and pipes it straight into Secret Manager. The key is never printed, never written
# to disk and never read from .env. infra/deploy.sh mounts the secret as STT_API_KEY when it exists.
param([Parameter(Mandatory)][string]$Project, [string]$Secret = "sagi-stt-api-key")
$ErrorActionPreference = "Stop"
$sa = "sagi-api@$Project.iam.gserviceaccount.com"

gcloud services enable generativelanguage.googleapis.com apikeys.googleapis.com --project $Project

if (gcloud secrets describe $Secret --project $Project --format="value(name)" 2>$null) {
    "Secret $Secret already exists - nothing to do. To rotate: delete the old key and secret, then run this again."
    exit 0
}

$keyName = gcloud services api-keys create --display-name="Sagi Shield STT" `
    --api-target=service=generativelanguage.googleapis.com --project $Project --format="value(response.name)"
if (-not $keyName) { throw "API key creation failed" }

# key string -> secret, through the pipe only
gcloud services api-keys get-key-string $keyName --project $Project --format="value(keyString)" |
    gcloud secrets create $Secret --data-file=- --project $Project
gcloud secrets add-iam-policy-binding $Secret --member="serviceAccount:$sa" `
    --role="roles/secretmanager.secretAccessor" --project $Project --format=none

"Done. Redeploy so the service picks it up:  PROJECT=$Project ./infra/deploy.sh"
"(or: gcloud run services update sagi-shield-api --region asia-northeast1 --project $Project --update-secrets STT_API_KEY=${Secret}:latest)"
