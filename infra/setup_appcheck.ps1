# Firebase App Check with reCAPTCHA Enterprise for the PWA (backend/app/appcheck.py). Run once; re-running is safe.
#
#   pwsh infra/setup_appcheck.ps1                        # set everything up, print the build values
#   pwsh infra/setup_appcheck.ps1 -SetGitHubVariables    # ... and store them as repository variables (gh CLI)
#   pwsh infra/setup_appcheck.ps1 -SetGitHubVariables -VapidKey <public Web Push key>   # ... and guardian push
#
# Guardian push (FCM web push, backend/app/notifier.py) rides on the same Firebase project: the script also enables
# the FCM API and lets sagi-api send. The Web Push key pair itself can only be generated in the Firebase console
# (Project settings > Cloud Messaging > Web configuration); its PUBLIC key goes to -VapidKey.
#
# Steps: enable the APIs -> add Firebase to the project (if it is not a Firebase project yet) -> register the web app
# "Sagi Shield PWA" -> a score-based reCAPTCHA Enterprise key for the Cloud Run host (+ -Domains) -> register the key
# with App Check (token TTL 4 h: the SDK refreshes at half the TTL, one reCAPTCHA assessment each) -> let sagi-api
# consume limited-use tokens (Firebase App Check Token Verifier).
#
# Then roll out in two steps (APPCHECK is a repository variable read by deploy.yml):
#   1. APPCHECK=monitor, deploy, and watch `ac=` in the access log until real traffic shows ac=valid;
#   2. APPCHECK=enforce: unverified checks get RATE_LIMIT_UNVERIFIED_PER_MIN (default 5), unverified reports a 403.
# Undo: APPCHECK=off and redeploy (or gcloud run services update ... --update-env-vars APPCHECK=off).
param(
    [string]$Project = "sagi-shield-560661",
    [string]$Region = "asia-northeast1",
    [string]$Service = "sagi-shield-api",
    [string[]]$Domains = @(),            # extra hosts (a custom domain); the Cloud Run host is always included
    [string]$AppName = "Sagi Shield PWA",
    [string]$KeyName = "sagi-shield-appcheck",
    [int]$TokenTtlHours = 4,
    [string]$VapidKey = "",           # public Web Push key (Firebase console) -> VITE_FIREBASE_VAPID_KEY
    [switch]$SetGitHubVariables
)
$ErrorActionPreference = "Stop"
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

gcloud services enable firebase.googleapis.com firebaseappcheck.googleapis.com recaptchaenterprise.googleapis.com fcm.googleapis.com `
    --project $Project | Out-Null; Check "enable APIs"

$token = gcloud auth print-access-token; Check "gcloud auth print-access-token"
$headers = @{ Authorization = "Bearer $token"; "x-goog-user-project" = $Project }
$fb = "https://firebase.googleapis.com/v1beta1"
function Api($method, $uri, $body = $null) {
    $req = @{ Method = $method; Uri = $uri; Headers = $headers; ContentType = "application/json" }
    if ($null -ne $body) { $req.Body = ($body | ConvertTo-Json -Depth 5) }
    Invoke-RestMethod @req
}
function Wait-Operation($op) {
    while (-not $op.done) { Start-Sleep 3; $op = Api GET "$fb/$($op.name)" }
    if ($op.error) { throw "operation $($op.name) failed: $($op.error.message)" }
    $op.response
}

# 1. Firebase on the existing Cloud project (same project id; Firestore and billing stay as they are)
try { Api GET "$fb/projects/$Project" | Out-Null; Write-Host "Firebase: already enabled on $Project" }
catch {
    if ($_.Exception.Response.StatusCode.value__ -notin 403, 404) { throw }
    Write-Host "Firebase: adding to $Project"
    Wait-Operation (Api POST "$fb/projects/${Project}:addFirebase" @{}) | Out-Null
}

# 2. the web app whose config the PWA is built with
$app = (Api GET "$fb/projects/$Project/webApps").apps | Where-Object { $_.displayName -eq $AppName } | Select-Object -First 1
if (-not $app) {
    Write-Host "Web app: creating '$AppName'"
    $app = Wait-Operation (Api POST "$fb/projects/$Project/webApps" @{ displayName = $AppName })
}
$config = Api GET "$fb/projects/$Project/webApps/$($app.appId)/config"
Write-Host "Web app: $($config.appId)"

# 3. score-based reCAPTCHA Enterprise key (App Check refuses checkbox keys); never localhost on a production key
# every URL the service answers on: the project-number one (run.googleapis.com/urls) is the one people are given,
# status.url only holds the older hash-style host - a key without the visited host yields no token there
$svc = gcloud run services describe $Service --project $Project --region $Region --format json | ConvertFrom-Json
Check "read the service URLs"
$urls = $svc.metadata.annotations.'run.googleapis.com/urls'
$urls = if ($urls) { @($urls | ConvertFrom-Json) } else { @($svc.status.url) }
$hosts = @($urls | ForEach-Object { ([Uri]$_).Host }) + $Domains | Select-Object -Unique
$key = gcloud recaptcha keys list --project $Project --format json | ConvertFrom-Json |
    Where-Object { $_.displayName -eq $KeyName } | Select-Object -First 1
if ($key) {
    $siteKey = ($key.name -split "/")[-1]
    gcloud recaptcha keys update $siteKey --project $Project --web --domains ($hosts -join ",") --quiet | Out-Null
    Check "update the reCAPTCHA key"
} else {
    $created = gcloud recaptcha keys create --project $Project --display-name $KeyName --web `
        --domains ($hosts -join ",") --integration-type score --format json | ConvertFrom-Json
    Check "create the reCAPTCHA key"
    $siteKey = ($created.name -split "/")[-1]
}
Write-Host "reCAPTCHA key: $siteKey for $($hosts -join ', ')"

# 4. App Check: this web app attests with that key
$ttl = "$($TokenTtlHours * 3600)s"
Api PATCH ("https://firebaseappcheck.googleapis.com/v1/projects/$Project/apps/$($config.appId)/recaptchaEnterpriseConfig" +
    "?updateMask=siteKey,tokenTtl") @{ siteKey = $siteKey; tokenTtl = $ttl } | Out-Null
Write-Host "App Check: reCAPTCHA Enterprise, token TTL $ttl"

# 5. the API consumes limited-use tokens on /report (a network call that needs this role)
gcloud projects add-iam-policy-binding $Project --member "serviceAccount:sagi-api@$Project.iam.gserviceaccount.com" `
    --role roles/firebaseappcheck.tokenVerifier --condition None --quiet | Out-Null
Check "grant Firebase App Check Token Verifier to sagi-api"

# 6. guardian push: the API sends HIGH alerts through FCM (HTTP v1 needs this role on the runtime account)
gcloud projects add-iam-policy-binding $Project --member "serviceAccount:sagi-api@$Project.iam.gserviceaccount.com" `
    --role roles/firebasecloudmessaging.admin --condition None --quiet | Out-Null
Check "grant Firebase Cloud Messaging API Admin to sagi-api"

$vars = [ordered]@{
    VITE_FIREBASE_API_KEY   = $config.apiKey
    VITE_FIREBASE_APP_ID    = $config.appId
    VITE_RECAPTCHA_SITE_KEY = $siteKey
}
if ($VapidKey) { $vars.VITE_FIREBASE_VAPID_KEY = $VapidKey }
Write-Host "`nBuild values (public; deploy.yml reads them as repository variables, VITE_FIREBASE_PROJECT_ID = GCP_PROJECT):"
$vars.GetEnumerator() | ForEach-Object { Write-Host ("  {0}={1}" -f $_.Key, $_.Value) }
if ($SetGitHubVariables) {
    $vars.GetEnumerator() | ForEach-Object { gh variable set $_.Key --body $_.Value; Check "gh variable set $($_.Key)" }
    if (@(gh variable list --json name --jq '.[].name') -notcontains "APPCHECK") {  # never downgrade enforce
        gh variable set APPCHECK --body monitor; Check "gh variable set APPCHECK"
    }
    Write-Host "Repository variables set. The next deploy builds the PWA with App Check (APPCHECK=$(gh variable get APPCHECK))."
} else {
    Write-Host "Set them with: pwsh infra/setup_appcheck.ps1 -SetGitHubVariables   (APPCHECK starts at monitor)"
}
