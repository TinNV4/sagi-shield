#!/usr/bin/env bash
# One-time: let GitHub Actions deploy to Cloud Run without any stored key (Workload Identity Federation).
#   PROJECT=sagi-shield-560661 REPO=TinNV4/sagi-shield ./infra/setup_cd.sh
# Creates: service account github-deployer, an Artifact Registry repo "sagi", a WIF pool + GitHub OIDC provider
# restricted to REPO, and the IAM bindings the deploy workflow (.github/workflows/deploy.yml) needs. Prints the three
# values to store as GitHub Actions *variables* (not secrets - none of them is secret).
set -euo pipefail
: "${PROJECT:?}" "${REPO:?}"
REGION="${REGION:-asia-northeast1}"
NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA="github-deployer@$PROJECT.iam.gserviceaccount.com"

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com artifactregistry.googleapis.com run.googleapis.com --project "$PROJECT"

gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud iam service-accounts create github-deployer --project "$PROJECT" --display-name "GitHub Actions deployer"

gcloud artifacts repositories describe sagi --project "$PROJECT" --location "$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create sagi --project "$PROJECT" --location "$REGION" --repository-format docker \
    --description "Sagi Shield images built by GitHub Actions"

# Least privilege for "push an image, roll the service": no Cloud Build, no Secret Manager access needed
# (the runtime service account sagi-api already reads its secrets).
for role in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role "$role" --condition=None >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "sagi-api@$PROJECT.iam.gserviceaccount.com" --project "$PROJECT" \
  --member "serviceAccount:$SA" --role roles/iam.serviceAccountUser >/dev/null   # deploy *as* sagi-api

gcloud iam workload-identity-pools describe github --project "$PROJECT" --location global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create github --project "$PROJECT" --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers describe github --project "$PROJECT" --location global --workload-identity-pool github >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc github --project "$PROJECT" --location global \
    --workload-identity-pool github --display-name "GitHub" --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository == '$REPO'"
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" >/dev/null

cat <<EOF

GitHub Actions variables to set (gh variable set NAME --body VALUE):
  GCP_PROJECT=$PROJECT
  GCP_DEPLOYER_SA=$SA
  GCP_WIF_PROVIDER=projects/$NUM/locations/global/workloadIdentityPools/github/providers/github
EOF
