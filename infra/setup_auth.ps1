# Firebase Authentication for the PWA (backend/app/auth.py): anonymous sign-in for the protected person's device,
# Google and phone sign-in for guardians. Run once; re-running is safe.
#
#   pwsh infra/setup_auth.ps1                                          # anonymous + phone, SMS regions, authorized domains
#   pwsh infra/setup_auth.ps1 -GoogleClientId <id> -GoogleClientSecret <secret>   # ... and the Google provider
#   pwsh infra/setup_auth.ps1 -SmsRegions JP,VN,KR                     # SMS codes may go to these countries only
#
# The Google provider needs an OAuth 2.0 web client (Cloud console > APIs & Services > Credentials) whose authorized
# redirect URIs include https://<project>.firebaseapp.com/__/auth/handler (the PWA's authDomain, frontend/src/lib/
# firebaseApp.ts). The Firebase console's "Google" toggle (Authentication > Sign-in method) creates that client with
# the redirect URI already set; without the two parameters this script skips the provider and leaves it to the console.
# Phone sign-in sends SMS only to -SmsRegions (ISO country codes, default JP and VN): a project whose region policy is
# "allow list" with an empty list sends no SMS anywhere, so the policy is always written.
# Run infra/setup_appcheck.ps1 first: it adds Firebase to the project. Run this script again after the service gets a
# new host (a custom domain: -Domains).
#
# Steps: enable Identity Toolkit -> turn on anonymous + phone sign-in -> SMS region allow list -> Google provider ->
# authorized domains (the Cloud Run hosts of -Service + localhost + -Domains, merged with the existing list).
# No IAM grant: nothing on Cloud Run manages users. backend/tools/grant_admin.py runs on an operator's laptop with
# their own credentials (gcloud auth application-default login; they need Firebase Authentication Admin themselves).
# Check afterwards: python backend/tools/grant_admin.py --list   (no admin yet), then grant_admin.py --email <you>.
param(
    [string]$Project = "sagi-shield-560661",
    [string]$Region = "asia-northeast1",
    [string]$Service = "sagi-shield-pilot",
    [string[]]$Domains = @(),            # extra hosts (a custom domain)
    [string]$GoogleClientId = "",
    [string]$GoogleClientSecret = "",
    [string[]]$SmsRegions = @("JP", "VN") # where phone sign-in may send its SMS code
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

# 0. Identity Platform must be initialized once per project, or every config call answers 404 CONFIGURATION_NOT_FOUND
try {
    Api POST "https://identitytoolkit.googleapis.com/v2/projects/$Project/identityPlatform:initializeAuth" @{} | Out-Null
    Write-Host "Identity Platform: initialized"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $msg = "$($_.ErrorDetails.Message)"
    if ($code -in 400, 409 -and $msg -match "(?i)already") { Write-Host "Identity Platform: already initialized" }
    else { throw }
}

# 1. anonymous (the protected device) and phone (guardians without a Google account)
Api PATCH "$idt/config?updateMask=signIn.anonymous.enabled,signIn.phoneNumber.enabled" @{
    signIn = @{ anonymous = @{ enabled = $true }; phoneNumber = @{ enabled = $true } }
} | Out-Null
Write-Host "Sign-in: anonymous and phone enabled"

# 1b. SMS region policy: an allow list of the markets. An empty allow list (what the project had) blocks every SMS.
$regions = @($SmsRegions | ForEach-Object { "$_".Trim().ToUpperInvariant() } | Where-Object { $_ } | Select-Object -Unique)
if ($regions.Count -eq 0) { throw "-SmsRegions is empty: phone sign-in could send no SMS anywhere" }
Api PATCH "$idt/config?updateMask=smsRegionConfig" @{
    smsRegionConfig = @{ allowlistOnly = @{ allowedRegions = $regions } }
} | Out-Null
Write-Host "SMS regions: allow list $($regions -join ', ')"

# 2. Google provider (guardians); needs an OAuth web client
if ($GoogleClientId -and $GoogleClientSecret) {
    $idp = @{ enabled = $true; clientId = $GoogleClientId; clientSecret = $GoogleClientSecret }
    $exists = $true
    try { Api GET "$idt/defaultSupportedIdpConfigs/google.com" | Out-Null }
    catch {
        # not there yet: 404, or 400 CONFIGURATION_NOT_FOUND
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -ne 404 -and -not ($code -eq 400 -and "$($_.ErrorDetails.Message)" -match "CONFIGURATION_NOT_FOUND")) { throw }
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

Write-Host "`nDone. Verify: python backend/tools/grant_admin.py --list   (expect '0 admin(s)'), then --email <your Google account> to become admin."
