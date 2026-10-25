# Uptime check on /health + email alert when the service is down. Idempotent by display name.
#   pwsh infra/setup_monitoring.ps1 -Email you@example.com                # pilot
#   pwsh infra/setup_monitoring.ps1 -Service sagi-shield-api -Email ...   # judged service, only after the freeze
# Alert: the check fails from 2 or more regions for 5 minutes (one flaky region does not page anyone).
param(
    [string]$Project = "sagi-shield-560661",
    [string]$Region = "asia-northeast1",
    [string]$Service = "sagi-shield-pilot",
    [Parameter(Mandatory)][string]$Email
)
$ErrorActionPreference = "Stop"
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }
function Find-ByName($json, $name) { @($json | ConvertFrom-Json | Where-Object { $_.displayName -eq $name }) | Select-Object -First 1 }

gcloud services enable monitoring.googleapis.com --project $Project | Out-Null; Check "enable monitoring"

$url = gcloud run services describe $Service --project $Project --region $Region --format="value(status.url)"
Check "read the service URL"
$hostName = $url -replace '^https://', ''
Write-Host "Service host: $hostName"

# --- uptime check
$checkName = "$Service health"
$check = Find-ByName (gcloud monitoring uptime list-configs --project $Project --format=json | Out-String) $checkName
Check "list uptime checks"
if ($check) {
    Write-Host "Uptime check '$checkName' exists"
} else {
    gcloud monitoring uptime create $checkName --project $Project --resource-type=uptime-url `
        "--resource-labels=host=$hostName,project_id=$Project" --path=/health --protocol=https --port=443 `
        --period=5 --timeout=10 --validate-ssl=true
    Check "create the uptime check"
    $check = Find-ByName (gcloud monitoring uptime list-configs --project $Project --format=json | Out-String) $checkName
    Check "list uptime checks"
    Write-Host "Created uptime check '$checkName'"
}
if (-not $check) { throw "uptime check '$checkName' not found after creating it" }
$checkId = ($check.name -split '/')[-1]

# --- email notification channel
$chanName = "$Service alerts"
$chan = Find-ByName (gcloud beta monitoring channels list --project $Project --format=json | Out-String) $chanName
Check "list channels"
if ($chan) {
    if ($chan.labels.email_address -ne $Email) {
        gcloud beta monitoring channels update $chan.name --project $Project "--channel-labels=email_address=$Email"
        Check "update the channel"
        Write-Host "Channel '$chanName' now mails $Email"
    } else { Write-Host "Channel '$chanName' exists ($Email)" }
} else {
    gcloud beta monitoring channels create --project $Project "--display-name=$chanName" --type=email "--channel-labels=email_address=$Email"
    Check "create the channel"
    $chan = Find-ByName (gcloud beta monitoring channels list --project $Project --format=json | Out-String) $chanName
    Check "list channels"
    Write-Host "Created channel '$chanName' ($Email)"
}
if (-not $chan) { throw "channel '$chanName' not found after creating it" }

# --- alert policy
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
$tmp = [IO.Path]::GetTempFileName()
try {
    [IO.File]::WriteAllText($tmp, ($policy | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
    $existing = Find-ByName (gcloud monitoring policies list --project $Project --format=json | Out-String) $policyName
    Check "list policies"
    if ($existing) {
        gcloud monitoring policies update $existing.name --project $Project "--policy-from-file=$tmp" --quiet
        Check "update the policy"
        Write-Host "Updated alert policy '$policyName'"
    } else {
        gcloud monitoring policies create --project $Project "--policy-from-file=$tmp" --quiet
        Check "create the policy"
        Write-Host "Created alert policy '$policyName'"
    }
} finally { Remove-Item $tmp -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "Done: https://$hostName/health is checked every 5 min; '$policyName' mails $Email after 5 min of failures from 2+ regions."
Write-Host "A new email channel sends a verification mail first: check the inbox of $Email."
