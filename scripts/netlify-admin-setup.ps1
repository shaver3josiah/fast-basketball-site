#Requires -Version 5.1
<#
.SYNOPSIS
  Make /admin work on the live Netlify site: set the environment variables it needs,
  redeploy so the functions pick them up, and prove the login before you touch the panel.

.DESCRIPTION
  This is LAUNCH.md Step 2, Step 3 and the two stray-site deletions as one script.
  Every secret is typed by you at a masked prompt and goes straight to Netlify's API;
  nothing is written to disk or to your shell history. Run it from anywhere:

    powershell -ExecutionPolicy Bypass -File .\scripts\netlify-admin-setup.ps1

  Needs Node (npx) and a browser for the one-time Netlify login. Re-running is safe:
  env:set overwrites, and every destructive step asks first.

.PARAMETER SiteName
  The Netlify project that serves the site. Defaults to the one behind
  https://fast-basketball.netlify.app.

.PARAMETER SkipVars
  The variables are already on Netlify; go straight to the deploy and the login proof.

.PARAMETER SkipDeploy
  Set the variables but do not trigger a build. Nothing takes effect until a deploy, so
  only use this if you are about to push a commit anyway.
#>
param(
  [string]$SiteName = "fast-basketball",
  [string]$Repo = "shaver3josiah/fast-basketball-site",
  [string[]]$StraySites = @("fast-basketball-site", "fastbasketball"),
  [switch]$SkipDeploy,
  [switch]$SkipVars
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Text) { Write-Host ""; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host "   $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text){ Write-Host "   $Text" -ForegroundColor Yellow }

# The CLI is run through npx so nothing has to be installed globally. Its stderr is left
# alone on purpose: redirecting a native command's stderr in PowerShell 5.1 turns npm's
# harmless warnings into terminating errors.
function Invoke-Netlify {
  param([string[]]$CliArgs)
  $out = & npx --yes netlify-cli@latest @CliArgs
  if ($LASTEXITCODE -ne 0) { throw "netlify $($CliArgs -join ' ') failed with exit code $LASTEXITCODE" }
  return $out
}

function ConvertFrom-Secure([System.Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Read-Secret([string]$Prompt, [switch]$Confirm) {
  while ($true) {
    $a = ConvertFrom-Secure (Read-Host -AsSecureString $Prompt)
    if ($a.Trim() -ne $a) { Write-Warn2 "That has a space at the start or end. Type it again."; continue }
    if (-not $Confirm) { return $a }
    $b = ConvertFrom-Secure (Read-Host -AsSecureString "Type it once more to confirm")
    if ($a -eq $b) { return $a }
    Write-Warn2 "They did not match. Try again."
  }
}

# Netlify hides a variable in the dashboard when it is marked secret, but only accepts the
# flag for a named non-development context. Production is where the functions run, so a
# secret is set there; anything else falls back to a plain variable across all contexts
# rather than failing the run.
function Set-NetlifyVar([string]$SiteId, [string]$Key, [string]$Value, [bool]$Secret) {
  $base = @("env:set", $Key, $Value, "--site", $SiteId, "--scope", "functions", "--force")
  if ($Secret) {
    & npx --yes netlify-cli@latest @($base + @("--secret", "--context", "production")) | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok "$Key set (secret, production)"; return }
    Write-Warn2 "$Key : --secret was refused, storing it as a normal variable"
  }
  & npx --yes netlify-cli@latest @base | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "could not set $Key" }
  Write-Ok "$Key set"
}

function Get-Status([string]$Url, [string]$Method = "GET", [string]$Body = $null) {
  try {
    $p = @{ Uri = $Url; Method = $Method; UseBasicParsing = $true; TimeoutSec = 30 }
    if ($Body) { $p.Body = $Body; $p.ContentType = "application/json" }
    $r = Invoke-WebRequest @p
    return [int]$r.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw
  }
}

# ---------------------------------------------------------------- 0. tools
Write-Step "Checking tools"
$null = Get-Command node -ErrorAction Stop
Write-Ok "node $(node --version)"

# ---------------------------------------------------------------- 1. login
Write-Step "Netlify login (opens a browser the first time; says 'Already logged in' after that)"
Invoke-Netlify @("login") | Out-Null

# ---------------------------------------------------------------- 2. find the site
Write-Step "Finding the site '$SiteName'"
$sites = (Invoke-Netlify @("sites:list", "--json")) -join "`n" | ConvertFrom-Json
$site = $sites | Where-Object { $_.name -eq $SiteName } | Select-Object -First 1
if (-not $site) {
  Write-Warn2 "No site named '$SiteName'. Sites on this account:"
  $sites | ForEach-Object { Write-Host "     $($_.name)  $($_.ssl_url)" }
  throw "rerun with -SiteName <one of the above>"
}
$siteId = $site.id
$siteUrl = $site.ssl_url
if (-not $siteUrl) { $siteUrl = $site.url }
Write-Ok "$($site.name)  $siteUrl  ($siteId)"

# ---------------------------------------------------------------- 3. the values
$adminPassword = $null
if ($SkipVars) {
  Write-Step "Skipping the variables (-SkipVars)"
} else {
Write-Step "The four variables /admin needs"
Write-Host @"
   ADMIN_PASSWORD       the password you will type at /admin
   ADMIN_SESSION_SECRET generated here, 48 random characters, used nowhere else
   GITHUB_TOKEN         lets the panel commit content. Make it now, then come back:
                          github.com -> Settings -> Developer settings -> Personal access
                          tokens -> Fine-grained -> Generate. Repository access: ONLY
                          $Repo. Permissions: Contents = Read and write. Nothing else.
   GITHUB_REPO          $Repo
"@

$adminPassword = Read-Secret "ADMIN_PASSWORD (typed blind)" -Confirm
$githubToken   = Read-Secret "GITHUB_TOKEN (paste, typed blind)"
$sessionSecret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })

Write-Host ""
Write-Host "   Optional now, required before Stripe goes live: enrollment alert emails."
$resendKey = ConvertFrom-Secure (Read-Host -AsSecureString "RESEND_API_KEY (Enter to skip)")
$fromEmail = ""
if ($resendKey) { $fromEmail = Read-Host "PLAYBOOK_FROM_EMAIL, a sender verified in Resend (e.g. coach@fast-basketball.com)" }

# ---------------------------------------------------------------- 4. set them
Write-Step "Writing variables to Netlify (scope: functions, all contexts)"
Set-NetlifyVar $siteId "ADMIN_PASSWORD"       $adminPassword $true
Set-NetlifyVar $siteId "ADMIN_SESSION_SECRET" $sessionSecret $true
Set-NetlifyVar $siteId "GITHUB_TOKEN"         $githubToken   $true
Set-NetlifyVar $siteId "GITHUB_REPO"          $Repo          $false
if ($resendKey -and $fromEmail) {
  Set-NetlifyVar $siteId "RESEND_API_KEY"      $resendKey $true
  Set-NetlifyVar $siteId "PLAYBOOK_FROM_EMAIL" $fromEmail $false
}
$githubToken = $null; $resendKey = $null; $sessionSecret = $null
}

# ---------------------------------------------------------------- 5. redeploy
if ($SkipDeploy) {
  Write-Warn2 "Skipping the deploy. The functions will not see these values until one runs."
} else {
  Write-Step "Triggering a deploy (variables only reach the functions on a fresh build)"
  # PowerShell 5.1 hands {"site_id":"x"} to a native exe as {site_id:x}; escaping every
  # quote as \" is what survives the trip. The CLI then sees valid JSON.
  $data = (@{ site_id = $siteId } | ConvertTo-Json -Compress) -replace '"', '\"'
  $build = (Invoke-Netlify @("api", "createSiteBuild", "--data", $data)) -join "`n" | ConvertFrom-Json
  $deployId = $build.deploy_id
  if (-not $deployId) { throw "Netlify accepted the build request but returned no deploy id" }
  Write-Ok "build queued as deploy $deployId; waiting for it to publish"
  # Poll the deploy that was just created, never "the newest one": the previous production
  # deploy is also in state ready, and reading that would end the wait before the new
  # build has even started.
  $dq = (@{ deploy_id = $deployId } | ConvertTo-Json -Compress) -replace '"', '\"'
  $deadline = (Get-Date).AddMinutes(15)
  $state = ""
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 15
    $d = (Invoke-Netlify @("api", "getDeploy", "--data", $dq)) -join "`n" | ConvertFrom-Json
    $state = $d.state
    Write-Host "   $((Get-Date).ToString('HH:mm:ss'))  $state"
    if ($state -eq "ready") { break }
    if ($state -eq "error") { throw "the deploy failed; open $($d.admin_url) to read the log" }
  }
  if ($state -ne "ready") { throw "still not published after 15 minutes; check the Deploys tab" }
  Write-Ok "published"
}

# ---------------------------------------------------------------- 6. prove it
Write-Step "Proving the login against $siteUrl"
$code = Get-Status "$siteUrl/admin/"
if ($code -ne 200) { throw "/admin/ answered $code" }
Write-Ok "/admin/ loads"

if (-not $adminPassword) { $adminPassword = Read-Secret "ADMIN_PASSWORD, to prove the login (typed blind)" }
$body = @{ password = $adminPassword } | ConvertTo-Json -Compress
$code = Get-Status "$siteUrl/.netlify/functions/admin-login" "POST" $body
$adminPassword = $null
switch ($code) {
  200 { Write-Ok "login accepted. The password you typed is the one to use." }
  401 { throw "still 'wrong password'. The value on Netlify and the one you just typed differ; open Site configuration -> Environment variables and look at ADMIN_PASSWORD." }
  429 { Write-Warn2 "rate limited: ten failed attempts in 15 minutes from this address. Wait 15 minutes, then try the login page." }
  default { throw "admin-login answered $code" }
}

# ---------------------------------------------------------------- 7. strays
Write-Step "Stray Netlify sites"
foreach ($name in $StraySites) {
  $s = $sites | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if (-not $s) { Write-Ok "$name : not on this account, nothing to do"; continue }
  Write-Host "   $name  $($s.ssl_url)"
  $answer = Read-Host "   Delete it? This cannot be undone. Type DELETE to confirm, anything else to keep"
  if ($answer -ceq "DELETE") {
    Invoke-Netlify @("sites:delete", $s.id, "--force") | Out-Null
    Write-Ok "$name deleted"
  } else {
    Write-Warn2 "$name kept"
  }
}

# ---------------------------------------------------------------- 8. what is left
Write-Step "Done. What is left is yours to click"
Write-Host @"
   1. $siteUrl/admin/           log in with the password you chose
   2. $siteUrl/admin/editor.html   the Photos panel should list the site's photos
   3. change one word, Save, then Publish. One commit prefixed 'admin:' should land on
      main and one deploy should run. That proves the token can write.
   4. Before Stripe goes live: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, LAUNCH.md Step 5.
"@
