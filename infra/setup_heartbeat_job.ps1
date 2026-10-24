# Hourly sweep for silent Live Guard devices: a guardian is told when a protected phone has not sent a heartbeat for 24 h.
# A Cloud Run Job runs `python -m app.heartbeat_sweep` in the service's image as sagi-api (Firestore + FCM through the
# runtime account); Cloud Scheduler starts it every hour (Asia/Tokyo). The job reads and writes ONE Firestore database,
# so the pilot service and the judged service each need their own job; this script is for the pilot. Idempotent.
#
#   pwsh infra/setup_heartbeat_job.ps1                          # pilot: image of sagi-shield-pilot, database "pilot"
#   pwsh infra/setup_heartbeat_job.ps1 -RunNow                  # ... and run the job once, waiting for the result
#
# Afterwards every pilot deploy (deploy-pilot.yml) points the job at the new image.
# The scheduler signs in as sagi-scheduler, whose only role is run.invoker on the jobs.
param(
    [string]$Project = "sagi-shield-560661",
    [string]$Region = "asia-northeast1",
    [string]$Service = "sagi-shield-pilot",
    [string]$Database = "pilot",
    [string]$Job = "sagi-heartbeat-sweep",
    [string]$Schedule = "0 * * * *",   # every hour, on the hour
    [string]$Image = "",
    [switch]$RunNow
)
$ErrorActionPreference = "Stop"
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

gcloud services enable run.googleapis.com cloudscheduler.googleapis.com --project $Project | Out-Null; Check "enable APIs"
if (-not $Image) {
    $Image = gcloud run services describe $Service --project $Project --region $Region --format="value(spec.template.spec.containers[0].image)"
    Check "read the service image"
}
Write-Host "Job image: $Image (database: $Database)"

$runtime = "sagi-api@$Project.iam.gserviceaccount.com"
gcloud run jobs deploy $Job --project $Project --region $Region --image $Image --service-account $runtime `
    --command python --args="-m,app.heartbeat_sweep" `
    --set-env-vars "STORE=firestore,GOOGLE_CLOUD_PROJECT=$Project,FIRESTORE_DB=$Database" `
    --set-secrets "HASH_KEY=sagi-hash-key:latest" `
    --tasks 1 --max-retries 1 --task-timeout 5m --cpu 1 --memory 512Mi --quiet
Check "deploy the Cloud Run job"

$caller = "sagi-scheduler@$Project.iam.gserviceaccount.com"
gcloud iam service-accounts describe $caller --project $Project 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    gcloud iam service-accounts create sagi-scheduler --project $Project --display-name "Sagi Shield scheduler"; Check "create sagi-scheduler"
}
gcloud run jobs add-iam-policy-binding $Job --project $Project --region $Region `
    --member "serviceAccount:$caller" --role roles/run.invoker --quiet | Out-Null
Check "grant run.invoker on the job"

$uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/${Job}:run"
$common = @("--project", $Project, "--location", $Region, "--schedule", $Schedule, "--time-zone", "Asia/Tokyo",
            "--uri", $uri, "--http-method", "POST", "--oauth-service-account-email", $caller)
gcloud scheduler jobs describe $Job --project $Project --location $Region 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    gcloud scheduler jobs update http $Job @common --quiet; Check "update the scheduler job"
} else {
    gcloud scheduler jobs create http $Job @common --description "Hourly check for Live Guard devices that stopped sending heartbeats"
    Check "create the scheduler job"
}

if ($RunNow) {
    gcloud run jobs execute $Job --project $Project --region $Region --wait; Check "run the job"
    Write-Host "Logs: gcloud logging read 'resource.type=cloud_run_job AND resource.labels.job_name=$Job' --project $Project --limit 20 --format 'value(textPayload)'"
}
