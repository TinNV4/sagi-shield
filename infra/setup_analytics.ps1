# BigQuery side of the community scam map (run once, safe to re-run):
#   pwsh infra/setup_analytics.ps1 -Project sagi-shield-123456
# Creates dataset `sagi`, table `events` (one anonymous row per verdict - see backend/app/analytics.py for what is
# and is not stored), two views for Looker Studio, lets the API's service account insert rows, and points the
# Cloud Run service at the table (BQ_TABLE). Day-partitioned, rows expire after 400 days.
param([Parameter(Mandatory)][string]$Project, [string]$Region = "asia-northeast1", [string]$Service = "sagi-shield-api")
$sa = "sagi-api@$Project.iam.gserviceaccount.com"

gcloud services enable bigquery.googleapis.com --project $Project
# bq wants --flag=value; "already exists" is handled by asking first
bq --project_id=$Project show --format=none sagi *> $null
if ($LASTEXITCODE -ne 0) {
    bq --project_id=$Project --location=$Region mk --dataset --description="Sagi Shield anonymous verdict events" sagi
}
$schema = "ts:TIMESTAMP,kind:STRING,lang:STRING,source:STRING,risk_level:STRING,risk_score:INTEGER,scam_type:STRING,stage:INTEGER,prefecture:STRING,llm_used:BOOLEAN,latency_ms:INTEGER"
bq --project_id=$Project show --format=none sagi.events *> $null
if ($LASTEXITCODE -ne 0) {
    bq --project_id=$Project mk --table --time_partitioning_field=ts --time_partitioning_type=DAY --time_partitioning_expiration=34560000 sagi.events $schema
}
$daily = "SELECT DATE(ts, 'Asia/Tokyo') AS day, lang, kind, source, scam_type, risk_level, COUNT(*) AS events FROM ``$Project.sagi.events`` GROUP BY 1,2,3,4,5,6"
$map = "SELECT prefecture, scam_type, DATE_TRUNC(DATE(ts, 'Asia/Tokyo'), WEEK) AS week, COUNT(*) AS reports FROM ``$Project.sagi.events`` WHERE kind = 'report' AND prefecture IS NOT NULL GROUP BY 1,2,3"
bq --project_id=$Project mk --use_legacy_sql=false --force=true --view="$daily" sagi.daily_verdicts
bq --project_id=$Project mk --use_legacy_sql=false --force=true --view="$map" sagi.reports_by_prefecture

gcloud projects add-iam-policy-binding $Project --member="serviceAccount:$sa" --role="roles/bigquery.dataEditor" --condition=None --format=none
gcloud run services update $Service --region $Region --project $Project --update-env-vars "BQ_TABLE=$Project.sagi.events" --quiet 2>&1 | Select-Object -Last 1

"Looker Studio: https://lookerstudio.google.com/reporting/create?c.mode=edit&ds.connector=bigQuery&ds.type=TABLE&ds.projectId=$Project&ds.datasetId=sagi&ds.tableId=daily_verdicts"
"  add a second source: sagi.reports_by_prefecture -> Geo chart (Japan, prefecture) + time series by scam_type"
