# Budget alert for the project (PLAN P5: "budget alert on the billing account"). The rate limit in app/guard.py is an
# abuse brake, not a billing guarantee: every /check and Live Guard look is a paid Gemini call, so the billing account
# emails its admins at 50 / 90 / 100 % of a monthly amount. Idempotent: an existing budget with the same name is updated.
#
#   pwsh infra/setup_budget.ps1                          # ¥5,000 / month on the project's billing account
#   pwsh infra/setup_budget.ps1 -Amount 20000            # demo week
#
# Needs the Cloud Billing Budget API on the project (enabled here) and Billing Account Administrator / Costs Manager
# on the billing account. Alerts go to the billing account's admins and users by default (no Pub/Sub topic needed).
param(
    [string]$Project = "sagi-shield-560661",
    [int]$Amount = 5000,
    [string]$Name = "sagi-shield monthly"
)
$ErrorActionPreference = "Stop"

$billing = gcloud billing projects describe $Project --format="value(billingAccountName)"
if (-not $billing) { throw "project $Project has no billing account" }
$account = $billing -replace "^billingAccounts/", ""
$currency = gcloud billing accounts describe $account --format="value(currencyCode)"
$projectNumber = gcloud projects describe $Project --format="value(projectNumber)"

gcloud services enable billingbudgets.googleapis.com --project $Project | Out-Null

$existing = gcloud billing budgets list --billing-account=$account --filter="displayName='$Name'" --format="value(name)"
$common = @(
    "--billing-account=$account",
    "--display-name=$Name",
    "--budget-amount=$Amount$currency",
    "--filter-projects=projects/$projectNumber",
    "--threshold-rule=percent=0.5",
    "--threshold-rule=percent=0.9",
    "--threshold-rule=percent=1.0"
)
if ($existing) {
    Write-Host "Updating budget '$Name' ($existing)"
    gcloud billing budgets update $existing @common
} else {
    Write-Host "Creating budget '$Name'"
    gcloud billing budgets create @common
}
gcloud billing budgets list --billing-account=$account --format="table(displayName,amount.specifiedAmount.units,amount.specifiedAmount.currencyCode,thresholdRules.thresholdPercent.list())"
