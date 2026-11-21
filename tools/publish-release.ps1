# Publish a GitHub release for this repo.
# Credentials come from the local Windows credential manager via `git credential fill`;
# no token is stored in this file and nothing sensitive is printed.
#
# Usage (run with PowerShell 7):
#   pwsh -NoProfile -File tools/publish-release.ps1 `
#     -Tag v1.1.0 -Title "..." -NotesFile docs/release-notes-1.1.0.md `
#     -Files @("E:\path\a.apk")
param(
  [string]$Repo = 'Neutron-Fair/Margin',
  [Parameter(Mandatory = $true)][string]$Tag,
  [string]$Title = '',
  [string]$NotesFile = '',
  [string[]]$Files = @(),
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$raw = "protocol=https`nhost=github.com`n`n" | git credential fill 2>$null
$token = (($raw -split "`n") | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
$token = $token.Trim()
if (-not $token) { throw 'No GitHub credential found via git credential fill.' }

$headers = @{
  Authorization  = "token $token"
  'User-Agent'   = 'margin-release'
  Accept         = 'application/vnd.github+json'
  'Content-Type' = 'application/json'
}

$me = Invoke-RestMethod 'https://api.github.com/user' -Headers $headers -TimeoutSec 30
Write-Output ("AUTH login={0}" -f $me.login)

if ($DryRun) {
  Write-Output ("DRYRUN tag={0} files={1}" -f $Tag, ($Files -join ', '))
  return
}

$notes = ''
if ($NotesFile -and (Test-Path $NotesFile)) {
  $notes = [System.IO.File]::ReadAllText((Resolve-Path $NotesFile), [System.Text.Encoding]::UTF8)
}
if (-not $Title) { $Title = "$Tag" }

$existing = $null
try {
  $list = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases?per_page=20" -Headers $headers -TimeoutSec 30
  $existing = $list | Where-Object { $_.tag_name -eq $Tag } | Select-Object -First 1
} catch { }

if ($existing) {
  Write-Output ("RELEASE_EXISTS id={0}" -f $existing.id)
  $release = $existing
  # keep the notes in sync with the file
  if ($notes) {
    $patch = @{ body = $notes } | ConvertTo-Json -Depth 3
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/$($release.id)" -Method Patch `
      -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($patch)) -TimeoutSec 60
    Write-Output 'RELEASE_BODY_UPDATED'
  }
} else {
  $payload = @{
    tag_name         = $Tag
    target_commitish = 'main'
    name             = $Title
    body             = $notes
    draft            = $false
    prerelease       = $false
  } | ConvertTo-Json -Depth 4
  $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases" -Method Post -Headers $headers `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 60
  Write-Output ("RELEASE_CREATED id={0} tag={1}" -f $release.id, $release.tag_name)
}

$uploadBase = ($release.upload_url -replace '\{\?name,label\}', '')

foreach ($f in $Files) {
  if (-not (Test-Path -LiteralPath $f)) { Write-Output "MISSING $f"; continue }
  $name = Split-Path -Leaf $f
  $sizeMb = [math]::Round((Get-Item -LiteralPath $f).Length / 1MB, 2)
  Write-Output "UPLOAD_START $name ($sizeMb MB)"

  try {
    $assets = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/$($release.id)/assets" -Headers $headers -TimeoutSec 30
    $dup = $assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if ($dup) {
      Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/assets/$($dup.id)" -Method Delete -Headers $headers -TimeoutSec 30
      Write-Output "UPLOAD_REPLACED deleted old $name"
    }
  } catch { }

  $url = "$uploadBase" + '?name=' + [uri]::EscapeDataString($name)
  $resp = & curl.exe -sS --ssl-no-revoke --fail-with-body -X POST `
    -H "Authorization: token $token" `
    -H 'Content-Type: application/octet-stream' `
    -H 'User-Agent: margin-release' `
    --data-binary "@$f" $url 2>&1

  if ($LASTEXITCODE -ne 0) {
    Write-Output "UPLOAD_FAILED $name :: $resp"
  } else {
    try {
      $j = $resp | ConvertFrom-Json
      Write-Output ("UPLOAD_OK {0} {1} MB state={2} url={3}" -f $j.name, [math]::Round($j.size / 1MB, 2), $j.state, $j.browser_download_url)
    } catch {
      Write-Output "UPLOAD_OK(unparsed) $name"
    }
  }
}

Write-Output 'DONE'
