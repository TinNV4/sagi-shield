# Uptime check on /health + email alerts when the service is down or answers with 5xx. Idempotent by display name.
#   pwsh infra/setup_monitoring.ps1 -Email you@example.com                # pilot
#   pwsh infra/setup_monitoring.ps1 -Service sagi-shield-api -Email ...   # judged service, only after the freeze
# Alerts: the check fails from 2 or more regions for 5 minutes (one flaky region does not page anyone), and more than
# 3 requests end in a 5xx within 10 minutes. infra/terraform/main.tf mirrors both policies.
# Everything goes through the Cloud Monitoring REST API (like setup_appcheck.ps1), so no gcloud beta component is needed.
param(
    [string]$Project = "sagi-shield-560661",
    [string]$Region = "asia-northeast1",
    [string]$Service = "sagi-shield-pilot",
    [Parameter(Mandatory)][string]$Email
)
$ErrorActionPreference = "Stop"
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

gcloud services enable monitoring.googleapis.com --project $Project | Out-Null; Check "enable monitoring"

$url = gcloud run services describe $Service --project $Project --region $Region --format="value(status.url)"
Check "read the service URL"
$hostName = $url -replace '^https://', ''
Write-Host "Service host: $hostName"

$token = gcloud auth print-access-token; Check "gcloud auth print-access-token"
$headers = @{ Authorization = "Bearer $token"; "x-goog-user-project" = $Project }
$mon = "https://monitoring.googleapis.com/v3/projects/$Project"
function Api($method, $uri, $body = $null) {
    $req = @{ Method = $method; Uri = $uri; Headers = $headers; ContentType = "application/json" }
    if ($null -ne $body) { $req.Body = ($body | ConvertTo-Json -Depth 10) }
    Invoke-RestMethod @req
}

# --- uptime check
$checkName = "$Service health"
$check = @((Api GET "$mon/uptimeCheckConfigs").uptimeCheckConfigs) | Where-Object { $_.displayName -eq $checkName } | Select-Object -First 1
if ($check) {
    Write-Host "Uptime check '$checkName' exists"
} else {
    $check = Api POST "$mon/uptimeCheckConfigs" ([ordered]@{
        displayName       = $checkName
        monitoredResource = [ordered]@{ type = "uptime_url"; labels = [ordered]@{ project_id = $Project; host = $hostName } }
        httpCheck         = [ordered]@{ path = "/health"; port = 443; useSsl = $true; validateSsl = $true; requestMethod = "GET" }
        period            = "300s"
        timeout           = "10s"
    })
    Write-Host "Created uptime check '$checkName'"
}
$checkId = ($check.name -split '/')[-1]
if (-not $checkId) { throw "could not read the uptime check id" }

# --- email notification channel
$chanName = "$Service alerts"
$chan = @((Api GET "$mon/notificationChannels").notificationChannels) | Where-Object { $_.displayName -eq $chanName } | Select-Object -First 1
if ($chan) {
    if ($chan.labels.email_address -ne $Email) {
        Api PATCH "https://monitoring.googleapis.com/v3/$($chan.name)?updateMask=labels" @{ labels = @{ email_address = $Email } } | Out-Null
        Write-Host "Channel '$chanName' now mails $Email"
    } else { Write-Host "Channel '$chanName' exists ($Email)" }
} else {
    $chan = Api POST "$mon/notificationChannels" ([ordered]@{
        type        = "email"
        displayName = $chanName
        labels      = [ordered]@{ email_address = $Email }
    })
    Write-Host "Created channel '$chanName' ($Email)"
}

# --- alert policies (created once; an existing policy is left as it is)
function Ensure-Policy($policy) {
    $name = $policy.displayName
    $existing = @((Api GET "$mon/alertPolicies").alertPolicies) | Where-Object { $_.displayName -eq $name } | Select-Object -First 1
    if ($existing) {
        Write-Host "Alert policy '$name' exists - left as it is (delete it in the console to recreate with new settings)"
    } else {
        Api POST "$mon/alertPolicies" $policy | Out-Null
        Write-Host "Created alert policy '$name'"
    }
}

$policyName = "$Service down"
$policy = [ordered]@{
    displayName          = $policyName
    combiner             = "OR"
    conditions           = @([ordered]@{
        displayName        = "/health fails from 2 or more regions"
        conditionThreshold = [ordered]@{
            filter         = "metric.type=`"monitoring.googleapis.com/uptime_check/check_passed`" AND metric.labels.check_id=`"$checkId`" AND resource.type=`"uptime_url`""
            comparison     = "COMPARISON_GT"
            thresholdValue = 1
            duration       = "300s"
            aggregations   = @([ordered]@{
                alignmentPeriod    = "1200s"
                perSeriesAligner   = "ALIGN_NEXT_OLDER"
                crossSeriesReducer = "REDUCE_COUNT_FALSE"
                groupByFields      = @("resource.label.*")
            })
            trigger        = [ordered]@{ count = 1 }
        }
    })
    notificationChannels = @($chan.name)
}
Ensure-Policy $policy

$errorsName = "$Service 5xx"
Ensure-Policy ([ordered]@{
    displayName          = $errorsName
    combiner             = "OR"
    conditions           = @([ordered]@{
        displayName        = "more than 3 responses with a 5xx in 10 minutes"
        conditionThreshold = [ordered]@{
            filter         = "metric.type=`"run.googleapis.com/request_count`" AND resource.type=`"cloud_run_revision`" AND resource.label.service_name=`"$Service`" AND metric.label.response_code_class=`"5xx`""
            comparison     = "COMPARISON_GT"
            thresholdValue = 3
            duration       = "0s"
            aggregations   = @([ordered]@{
                alignmentPeriod    = "600s"
                perSeriesAligner   = "ALIGN_SUM"
                crossSeriesReducer = "REDUCE_SUM"
            })
            trigger        = [ordered]@{ count = 1 }
        }
    })
    notificationChannels = @($chan.name)
})

Write-Host ""
Write-Host "Done: https://$hostName/health is checked every 5 min; '$policyName' mails $Email after 5 min of failures from 2+ regions."
Write-Host "'$errorsName' mails $Email when more than 3 requests end in a 5xx within 10 minutes."
Write-Host "A new email channel may send a verification mail first: check the inbox of $Email."
