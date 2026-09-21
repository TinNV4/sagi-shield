# One-time project setup for Sagi Shield (run once per GCP project; safe to re-run).
#   pwsh infra/setup.ps1 -Project sagi-shield-123456
# Prerequisites: `gcloud auth login`, a project with billing linked.
param([Parameter(Mandatory)][string]$Project, [string]$Region = "asia-northeast1")
$ErrorActionPreference = "Continue"
$sa = "sagi-api@$Project.iam.gserviceaccount.com"

gcloud services enable run.googleapis.com aiplatform.googleapis.com firestore.googleapis.com webrisk.googleapis.com `
    secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com speech.googleapis.com --project $Project

# Firestore (native) next to Cloud Run; recovery chats are deleted for real by a TTL policy
if (-not (gcloud firestore databases describe --project $Project --format="value(name)" 2>$null)) {
    gcloud firestore databases create --location=$Region --type=firestore-native --project $Project
}
gcloud firestore fields ttls update expires_at --collection-group=recovery_sessions --enable-ttl --async --project $Project

# HMAC key for phone-number hashes: generated here, never printed, never on disk
if (-not (gcloud secrets describe sagi-hash-key --project $Project --format="value(name)" 2>$null)) {
    $bytes = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    [Convert]::ToHexString($bytes) | gcloud secrets create sagi-hash-key --data-file=- --project $Project
}

# Least-privilege runtime identity for the Cloud Run service
if (-not (gcloud iam service-accounts describe $sa --project $Project --format="value(email)" 2>$null)) {
    gcloud iam service-accounts create sagi-api --display-name="Sagi Shield API" --project $Project
}
# Web Risk has no IAM role of its own: a service account of the project may call it once the API is enabled
foreach ($role in "roles/aiplatform.user", "roles/datastore.user", "roles/speech.client") {
    gcloud projects add-iam-policy-binding $Project --member="serviceAccount:$sa" --role=$role --condition=None --format=none
}
gcloud secrets add-iam-policy-binding sagi-hash-key --member="serviceAccount:$sa" --role="roles/secretmanager.secretAccessor" --project $Project --format=none
"setup done for $Project"
