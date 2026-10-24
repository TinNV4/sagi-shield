# One-time setup for the pilot environment: the second Cloud Run service sagi-shield-pilot, deployed by
# .github/workflows/deploy-pilot.yml from the pilot branch while main (and the judged service sagi-shield-api) stays
# frozen. Same project, region, runtime account, secrets and image repository; its own Firestore database, so a pilot
# family's reports, stats and households never change what the judged service shows. Idempotent: re-run freely.
#
#   pwsh infra/setup_pilot.ps1                 # database + TTL + phishing list; App Check domain once the service exists
#   pwsh infra/setup_pilot.ps1 -SkipPhishList  # database only (the list takes a few minutes)
#
# Order with the workflow: run this first (the service refuses to start without its database, app/storage.py), then
# push the pilot branch; run it again after the first deploy so the pilot host is added to the App Check key.
# Not done here: the Firebase Authentication authorized domain for the pilot host (the households plan adds sign-in).
param(
    [string]$Project = "sagi-shield-560661",
    [string]$Region = "asia-northeast1",
    [string]$Service = "sagi-shield-pilot",
    [string]$Database = "pilot",
    [int]$PhishMonths = 2,
    [switch]$SkipPhishList
)
$ErrorActionPreference = "Stop"
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

# 1. the database (Firestore native, same region as Cloud Run)
$existing = gcloud firestore databases list --project $Project --format "value(name)" ; Check "list databases"
if ($existing -match "/databases/$Database$") {
    Write-Host "Firestore: database '$Database' exists"
} else {
    Write-Host "Firestore: creating database '$Database' in $Region"
    gcloud firestore databases create --database $Database --location $Region --type firestore-native --project $Project | Out-Null
    Check "create database"
}
# recovery chats expire for real, as in the default database (infra/setup.ps1)
gcloud firestore fields ttls update expires_at --collection-group recovery_sessions --database $Database --enable-ttl --async `
    --project $Project 2>$null | Out-Null
Write-Host "Firestore: TTL on recovery_sessions.expires_at requested"

# 2. the published phishing list: the pilot has no scheduled reload (that job belongs to the judged service), so load
#    it by hand now and again when it matters (tools/load_phish_list.py, FIRESTORE_DB=$Database)
if (-not $SkipPhishList) {
    $env:FIRESTORE_DB = $Database
    $env:GOOGLE_CLOUD_PROJECT = $Project
    Push-Location (Join-Path $PSScriptRoot "..")
    try {
        python tools/load_phish_list.py --months $PhishMonths --gcloud-token --project $Project
        Check "load phishing list"
    } finally { Pop-Location; Remove-Item Env:FIRESTORE_DB -ErrorAction SilentlyContinue }
}

# 3. once the service exists: its host joins the reCAPTCHA Enterprise key, so App Check tokens verify on the pilot URL
#    (without it every pilot request runs on the unverified budget, RATE_LIMIT_UNVERIFIED_PER_MIN)
$url = gcloud run services describe $Service --project $Project --region $Region --format "value(status.url)" 2>$null
if ($LASTEXITCODE -eq 0 -and $url) {
    $pilotHost = ([Uri]$url).Host
    Write-Host "Pilot URL: $url"
    & (Join-Path $PSScriptRoot "setup_appcheck.ps1") -Project $Project -Region $Region -Domains @($pilotHost)
    Write-Host ""
    Write-Host "Done. By hand: bookmark $url as the pilot URL; install it on the pilot phones from this address."
} else {
    Write-Host "Service $Service does not exist yet: push the pilot branch (deploy-pilot.yml), then re-run this script"
    Write-Host "so the pilot host is added to the App Check key."
}
