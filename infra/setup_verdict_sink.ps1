# Verdict log -> BigQuery. app/verdict_log.py prints one JSON record per check / precheck / live look to stdout; Cloud Run
# turns each line into a log entry with jsonPayload.<field>. A Cloud Logging sink copies the entries that carry
# jsonPayload.kind into a day-partitioned BigQuery table, which the admin page (VERDICT_TABLE) reads. Idempotent.
#
#   pwsh infra/setup_verdict_sink.ps1                                                    # pilot: sagi-shield-pilot -> dataset sagi_pilot
#   pwsh infra/setup_verdict_sink.ps1 -Service sagi-shield-api -Dataset sagi_verdicts    # judged service, only after the freeze
#
# Retention: the dataset default only reaches tables created later, so the script also sets the expiry on the table the sink
# already created (400 days, same as sagi.events).
#
# The sink creates its table lazily: `run_googleapis_com_stdout` appears after the FIRST matching record. Only then set
# the pilot variable PILOT_VERDICT_TABLE (see the closing message) to <project>.<dataset>.run_googleapis_com_stdout and redeploy.
param(
    [string]$Project = "sagi-shield-560661",
    [string]$Region = "asia-northeast1",
    [string]$Service = "sagi-shield-pilot",
    [string]$Dataset = "sagi_pilot"
)
$ErrorActionPreference = "Stop"
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

gcloud services enable bigquery.googleapis.com logging.googleapis.com --project $Project | Out-Null; Check "enable APIs"

# bq wants --flag=value; "already exists" is handled by asking first
bq --project_id=$Project show --format=none "${Project}:$Dataset" *> $null
if ($LASTEXITCODE -ne 0) {
    bq --project_id=$Project --location=$Region mk --dataset "--description=Structured verdict log of $Service (no text, numbers or ids)" "${Project}:$Dataset"
    Check "create the dataset"
    Write-Host "Created dataset ${Project}:$Dataset ($Region)"
} else {
    Write-Host "Dataset ${Project}:$Dataset exists"
}
# retention: partitions expire after 400 days (seconds), same as sagi.events
$PartitionExpirySeconds = 34560000
bq --project_id=$Project update "--default_partition_expiration=$PartitionExpirySeconds" "${Project}:$Dataset" | Out-Null
Check "set the partition expiry"
# the dataset default applies only to tables created later: set it on the sink's table too once it exists
$table = "${Project}:$Dataset.run_googleapis_com_stdout"
bq --project_id=$Project show --format=none $table *> $null
if ($LASTEXITCODE -eq 0) {
    bq --project_id=$Project update "--time_partitioning_expiration=$PartitionExpirySeconds" $table | Out-Null
    Check "set the partition expiry on the verdict table"
    Write-Host "Partition expiry on $table = $PartitionExpirySeconds s"
} else {
    Write-Host "Table $table does not exist yet: run this script again after the first record to set its expiry"
}

$sink = "sagi-verdicts-$Service"
$dest = "bigquery.googleapis.com/projects/$Project/datasets/$Dataset"
$filter = "resource.type=`"cloud_run_revision`" AND resource.labels.service_name=`"$Service`" AND jsonPayload.kind:*"
# the filter has spaces and double quotes, which the gcloud.cmd shim on Windows can split or strip: pass it in a flags file
$flags = [IO.Path]::GetTempFileName()
try {
    $quoted = $filter -replace "'", "''"
    [IO.File]::WriteAllText($flags, "--log-filter: '$quoted'`n", (New-Object Text.UTF8Encoding($false)))
    gcloud logging sinks describe $sink --project $Project 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        gcloud logging sinks update $sink $dest --project $Project "--flags-file=$flags" --use-partitioned-tables --quiet
        Check "update the sink"
        Write-Host "Updated sink $sink"
    } else {
        gcloud logging sinks create $sink $dest --project $Project "--flags-file=$flags" --use-partitioned-tables
        Check "create the sink"
        Write-Host "Created sink $sink"
    }
} finally { Remove-Item $flags -ErrorAction SilentlyContinue }
# read it back: a mangled filter would copy every log line (or none) into BigQuery
$stored = gcloud logging sinks describe $sink --project $Project --format="value(filter)" | Out-String
Check "read the sink filter"
if (-not ($stored.Contains("jsonPayload.kind:*") -and $stored.Contains("service_name=`"$Service`""))) {
    throw "sink $sink has an unexpected filter: $stored"
}

# the admin page queries the table as the runtime account: dataEditor reads rows but cannot start a query job
$runtime = "sagi-api@$Project.iam.gserviceaccount.com"
Write-Host "Granting roles/bigquery.jobUser to $runtime (admin page queries)"
gcloud projects add-iam-policy-binding $Project --member="serviceAccount:$runtime" --role=roles/bigquery.jobUser --condition None --quiet | Out-Null
Check "grant roles/bigquery.jobUser to $runtime"

# the sink writes with its own identity: give it editor rights on this dataset only
$writer = gcloud logging sinks describe $sink --project $Project --format="value(writerIdentity)"
Check "read the sink writer identity"
if (-not $writer) { throw "sink $sink has no writerIdentity" }
$member = $writer -replace '^serviceAccount:', ''
$tmp = [IO.Path]::GetTempFileName()
try {
    bq --project_id=$Project show --format=prettyjson "${Project}:$Dataset" | Set-Content -Path $tmp -Encoding utf8
    Check "read the dataset"
    $ds = Get-Content -Raw $tmp | ConvertFrom-Json
    $has = @($ds.access | Where-Object { $_.userByEmail -eq $member -and $_.role -eq "WRITER" }).Count -gt 0
    if ($has) {
        Write-Host "$member already has dataEditor (WRITER) on $Dataset"
    } else {
        $access = @($ds.access) + [pscustomobject]@{ role = "WRITER"; userByEmail = $member }
        # bq update --source takes a (partial) dataset resource; only the access list changes
        $body = [pscustomobject]@{ access = $access } | ConvertTo-Json -Depth 10
        [IO.File]::WriteAllText($tmp, $body, (New-Object Text.UTF8Encoding($false)))
        bq --project_id=$Project update --source=$tmp "${Project}:$Dataset" | Out-Null
        Check "grant the sink writer access"
        Write-Host "Granted $member dataEditor (WRITER) on $Dataset"
    }
} finally { Remove-Item $tmp -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "Sink $sink -> ${Project}:$Dataset (day-partitioned; filter: jsonPayload.kind present)."
Write-Host "The table is created by the first record: after a check on $Service, run"
Write-Host "  bq --project_id=$Project ls --format=pretty ${Project}:$Dataset"
Write-Host "and expect run_googleapis_com_stdout. Then use the table name $Project.$Dataset.run_googleapis_com_stdout:"
Write-Host "pilot: set the GitHub repository variable PILOT_VERDICT_TABLE to that name and redeploy:"
Write-Host "  gh variable set PILOT_VERDICT_TABLE --body `"$Project.$Dataset.run_googleapis_com_stdout`""
Write-Host "local infra/deploy.sh run: export VERDICT_TABLE=$Project.$Dataset.run_googleapis_com_stdout"
