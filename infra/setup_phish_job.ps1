# Monthly reload of the JPCERT/CC phishing URL list (replaces running tools/load_phish_list.py by hand).
# A Cloud Run Job runs `python -m app.phish_list --months 2` in the API image as sagi-api (Firestore access);
# Cloud Scheduler starts it on the 15th of every month (JPCERT/CC publishes the previous month's CSV in its first
# days). Reloads are idempotent: URLs already stored are skipped. Idempotent script: re-running updates both jobs.
#
#   pwsh infra/setup_phish_job.ps1                 # create / update, image = what the API service runs now
#   pwsh infra/setup_phish_job.ps1 -RunNow         # ... and run the job once, waiting for the result
#
# Afterwards every deploy (deploy.yml, infra/deploy.sh) points the job at the new image.
# The scheduler signs in as sagi-scheduler, whose only role is run.invoker on this one job.
param(
    [string]$Project = "sagi-shield-560661",
    [string]$Region = "asia-northeast1",
    [string]$Service = "sagi-shield-api",
    [string]$Job = "sagi-phish-loader",
    [string]$Schedule = "0 6 15 * *",   # 06:00 Asia/Tokyo on the 15th
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
Write-Host "Job image: $Image"

$runtime = "sagi-api@$Project.iam.gserviceaccount.com"
gcloud run jobs deploy $Job --project $Project --region $Region --image $Image --service-account $runtime `
    --command python --args="-m,app.phish_list,--months,2" `
    --set-env-vars "STORE=firestore,GOOGLE_CLOUD_PROJECT=$Project" `
    --tasks 1 --max-retries 1 --task-timeout 15m --cpu 1 --memory 512Mi --quiet
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
    gcloud scheduler jobs create http $Job @common --description "Monthly reload of the JPCERT/CC phishing URL list"
    Check "create the scheduler job"
}

if ($RunNow) {
    gcloud run jobs execute $Job --project $Project --region $Region --wait; Check "run the job"
    Write-Host "Logs: gcloud logging read 'resource.type=cloud_run_job AND resource.labels.job_name=$Job' --project $Project --limit 20 --format 'value(textPayload)'"
}
