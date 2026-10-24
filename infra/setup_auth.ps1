# Firebase Authentication for the PWA (backend/app/auth.py): anonymous sign-in for the protected person's device,
# Google and phone sign-in for guardians. Run once; re-running is safe.
#
#   pwsh infra/setup_auth.ps1                                          # anonymous + phone, authorized domains, IAM
#   pwsh infra/setup_auth.ps1 -GoogleClientId <id> -GoogleClientSecret <secret>   # ... and the Google provider
#
# The Google provider needs an OAuth 2.0 web client (Cloud console > APIs & Services > Credentials). Without the two
# parameters the provider is skipped (the Firebase console can add it as well: Authentication > Sign-in method).
# Run infra/setup_appcheck.ps1 first: it adds Firebase to the project. Run this script again after the service gets a
# new host (a custom domain: -Domains).
#
# Steps: enable Identity Toolkit -> turn on anonymous + phone sign-in -> Google provider -> authorized domains (the
# Cloud Run hosts of -Service + localhost + -Domains, merged with the existing list) -> let sagi-api manage users.
# Check afterwards: python backend/tools/grant_admin.py --list   (no admin yet), then grant_admin.py --email <you>.
param(
    [string]$Project = "sagi-shield-560661",
    [string]$Region = "asia-northeast1",
    [string]$Service = "sagi-shield-pilot",
    [string[]]$Domains = @(),            # extra hosts (a custom domain)
    [string]$GoogleClientId = "",
    [string]$GoogleClientSecret = ""
)
$ErrorActionPreference = "Stop"
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

gcloud services enable identitytoolkit.googleapis.com --project $Project | Out-Null; Check "enable Identity Toolkit"

$token = gcloud auth print-access-token; Check "gcloud auth print-access-token"
$headers = @{ Authorization = "Bearer $token"; "x-goog-user-project" = $Project }
$idt = "https://identitytoolkit.googleapis.com/admin/v2/projects/$Project"
function Api($method, $uri, $body = $null) {
    $req = @{ Method = $method; Uri = $uri; Headers = $headers; ContentType = "application/json" }
    if ($null -ne $body) { $req.Body = ($body | ConvertTo-Json -Depth 6) }
    Invoke-RestMethod @req
}

# 1. anonymous (the protected device) and phone (guardians without a Google account)
Api PATCH "$idt/config?updateMask=signIn.anonymous.enabled,signIn.phoneNumber.enabled" @{
    signIn = @{ anonymous = @{ enabled = $true }; phoneNumber = @{ enabled = $true } }
} | Out-Null
Write-Host "Sign-in: anonymous and phone enabled"

# 2. Google provider (guardians); needs an OAuth web client
if ($GoogleClientId -and $GoogleClientSecret) {
    $idp = @{ enabled = $true; clientId = $GoogleClientId; clientSecret = $GoogleClientSecret }
    $exists = $true
    try { Api GET "$idt/defaultSupportedIdpConfigs/google.com" | Out-Null }
    catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
        $exists = $false
    }
    if ($exists) {
        Api PATCH "$idt/defaultSupportedIdpConfigs/google.com?updateMask=enabled,clientId,clientSecret" $idp | Out-Null
    } else {
        Api POST "$idt/defaultSupportedIdpConfigs?idpId=google.com" $idp | Out-Null
    }
    Write-Host "Sign-in: Google provider $(if ($exists) { 'updated' } else { 'created' })"
} else {
    Write-Host "Sign-in: Google provider skipped (pass -GoogleClientId and -GoogleClientSecret, or add it in the Firebase console)"
}

# 3. authorized domains: every host the service answers on (the project-number URL is the one people are given), localhost,
#    -Domains; merged into the current list so nothing is ever dropped
$svc = gcloud run services describe $Service --project $Project --region $Region --format json | ConvertFrom-Json
Check "read the service URLs"
$urls = $svc.metadata.annotations.'run.googleapis.com/urls'
$urls = if ($urls) { @($urls | ConvertFrom-Json) } else { @($svc.status.url) }
$wanted = @($urls | ForEach-Object { ([Uri]$_).Host }) + "localhost" + $Domains
$current = @((Api GET "$idt/config").authorizedDomains)
$merged = @($current + $wanted | Where-Object { $_ } | Select-Object -Unique)
$added = @($merged | Where-Object { $current -notcontains $_ })
if ($added.Count -gt 0) {
    Api PATCH "$idt/config?updateMask=authorizedDomains" @{ authorizedDomains = $merged } | Out-Null
}
Write-Host "Authorized domains: added $(if ($added.Count) { $added -join ', ' } else { 'nothing (already listed)' })"

# 4. the runtime account manages users (set_custom_user_claims when grant_admin.py runs on Cloud Run; locally it uses your ADC)
gcloud projects add-iam-policy-binding $Project --member "serviceAccount:sagi-api@$Project.iam.gserviceaccount.com" `
    --role roles/firebaseauth.admin --condition None --quiet | Out-Null
Check "grant Firebase Authentication Admin to sagi-api"
Write-Host "IAM: roles/firebaseauth.admin on sagi-api@$Project.iam.gserviceaccount.com"

Write-Host "`nDone. Verify: python backend/tools/grant_admin.py --list   (expect '0 admin(s)'), then --email <your Google account> to become admin."
