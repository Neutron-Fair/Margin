# 发布到 Gitee：切分大安装包（Gitee 附件上限 100MB）+ 建/更新 Release + 上传附件
#
# 用法（用 pwsh 7 跑）：
#   pwsh -File tools/publish-gitee.ps1 -Tag v1.2.4 `
#        -NotesFile docs/release-notes-1.2.4.md `
#        -Apk '交付\CoilBookCost-1.2.4.apk' `
#        -Exe '交付\CoilBookCost-Setup-1.2.4.exe'
#
# 凭据：从本机凭据管理器取 host=gitee.com（git credential fill），不落盘、不打印。
# 幂等：同名附件先删后传；分片文件已存在且大小匹配时复用，不重复切分。

param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [Parameter(Mandatory = $true)][string]$NotesFile,
  [string]$Apk,
  [string]$Exe,
  [string]$Title,
  [string]$Owner = 'neutronfair',
  [string]$Repo = 'Margin',
  [int]$PartSizeMB = 90,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$UA = @{ 'User-Agent' = 'Mozilla/5.0 (CoilBookCost publisher)' }
$Api = "https://gitee.com/api/v5/repos/$Owner/$Repo"

function Get-Token {
  $raw = "protocol=https`nhost=gitee.com`n`n" | git credential fill 2>$null
  $line = ($raw -split "`n") | Where-Object { $_ -match '^password=' } | Select-Object -First 1
  if (-not $line) { throw '未找到 Gitee 凭据（git credential fill host=gitee.com）' }
  return ($line -replace '^password=', '').Trim()
}

function Invoke-Gitee {
  param(
    [string]$Method,
    [string]$Path,
    $Body,
    [string]$Token
  )
  $uri = if ($Path.StartsWith('http')) { $Path } else { "$Api$Path" }
  $params = @{ Uri = $uri; Method = $Method; Headers = $UA; TimeoutSec = 60 }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 8)
    $params.ContentType = 'application/json; charset=utf-8'
  }
  return Invoke-RestMethod @params
}

function Get-ReleaseId {
  param([string]$Token)
  try {
    $rel = Invoke-Gitee -Method Get -Path "/releases/tags/$Tag?access_token=$Token" -Token $Token
    return $rel.id
  } catch {
    return $null
  }
}

function Split-Installer {
  param([string]$Source)
  $size = (Get-Item $Source).Length
  $partBytes = [int64]$PartSizeMB * 1024 * 1024
  $count = [int][math]::Ceiling($size / $partBytes)
  $parts = @()
  $in = [System.IO.File]::OpenRead($Source)
  try {
    for ($i = 1; $i -le $count; $i++) {
      $start = [int64]($i - 1) * $partBytes
      $len = [int64][math]::Min($partBytes, $size - $start)
      $outPath = "$Source.part$i"
      $existing = Get-Item $outPath -ErrorAction SilentlyContinue
      if ($existing -and $existing.Length -eq $len) {
        Write-Output ("  part{0} 复用（{1:N0} 字节）" -f $i, $len)
      } else {
        $in.Position = $start
        $out = [System.IO.File]::Create($outPath)
        try {
          $buf = New-Object byte[] 1048576
          $remaining = $len
          while ($remaining -gt 0) {
            $want = [int][math]::Min($buf.Length, $remaining)
            $read = $in.Read($buf, 0, $want)
            if ($read -le 0) { break }
            $out.Write($buf, 0, $read)
            $remaining -= $read
          }
        } finally { $out.Close() }
        Write-Output ("  part{0} 写入（{1:N0} 字节）" -f $i, $len)
      }
      $parts += [ordered]@{ name = [System.IO.Path]::GetFileName($outPath); size = $len }
    }
  } finally { $in.Close() }
  return $parts
}

$token = Get-Token
Write-Output "AUTH ok（token $($token.Length) 字符）"

if (-not $Title) { $Title = "$Tag" }

# ---- 1. Release ----
$relId = Get-ReleaseId -Token $token
$notes = [System.IO.File]::ReadAllText((Resolve-Path $NotesFile))
if ($relId) {
  Write-Output "RELEASE_EXISTS id=$relId"
  if (-not $DryRun) {
    $null = Invoke-Gitee -Method Patch -Path "/releases/$relId" -Token $token -Body @{
      access_token = $token; tag_name = $Tag; name = $Title; body = $notes
    }
    Write-Output 'RELEASE_BODY_UPDATED'
  }
} else {
  if ($DryRun) { Write-Output 'DRYRUN would create release'; exit 0 }
  $rel = Invoke-Gitee -Method Post -Path '/releases' -Token $token -Body @{
    access_token = $token; tag_name = $Tag; name = $Title; body = $notes; target_commitish = 'main'; prerelease = $false
  }
  $relId = $rel.id
  Write-Output "RELEASE_CREATED id=$relId"
}

# ---- 2. 收集要传的文件 ----
$uploads = [System.Collections.Generic.List[string]]::new()

if ($Apk) {
  if (-not (Test-Path $Apk)) { throw "找不到 APK：$Apk" }
  $uploads.Add((Resolve-Path $Apk).Path)
}

if ($Exe) {
  if (-not (Test-Path $Exe)) { throw "找不到安装包：$Exe" }
  $exePath = (Resolve-Path $Exe).Path
  $exeSize = (Get-Item $exePath).Length
  $partBytes = [int64]$PartSizeMB * 1024 * 1024

  if ($exeSize -le $partBytes) {
    # 没超限就直接传整包
    $uploads.Add($exePath)
    Write-Output ("EXE {0:N0} 字节，未超 {1}MB，整包上传" -f $exeSize, $PartSizeMB)
  } else {
    Write-Output ("EXE {0:N0} 字节，超过单附件上限，按 {1}MB 切片" -f $exeSize, $PartSizeMB)
    $parts = Split-Installer -Source $exePath
    $manifest = [ordered]@{
      name          = [System.IO.Path]::GetFileName($exePath)
      size          = $exeSize
      sha256        = (Get-FileHash $exePath -Algorithm SHA256).Hash
      parts         = $parts
      partSizeBytes = $partBytes
    }
    $manifestPath = "$exePath.parts.json"
    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Write-Output ("  manifest 写入 {0}" -f [System.IO.Path]::GetFileName($manifestPath))
    $uploads.Add($manifestPath)
    foreach ($p in $parts) { $uploads.Add((Join-Path (Split-Path $exePath) $p.name)) }
  }
}

if ($DryRun) {
  Write-Output 'DRYRUN files:'
  $uploads | ForEach-Object { Write-Output ("  {0}  {1:N0}" -f [System.IO.Path]::GetFileName($_), (Get-Item $_).Length) }
  exit 0
}

# ---- 3. 清掉同名旧附件（幂等重传） ----
$existing = Invoke-Gitee -Method Get -Path "/releases/$relId/attach_files?access_token=$token" -Token $token
$existingNames = @()
if ($existing) { $existingNames = @($existing | ForEach-Object { $_.name }) }

foreach ($f in $uploads) {
  $name = [System.IO.Path]::GetFileName($f)
  $hit = @($existing | Where-Object { $_.name -eq $name })
  foreach ($h in $hit) {
    $null = Invoke-Gitee -Method Delete -Path "/releases/$relId/attach_files/$($h.id)?access_token=$token" -Token $token
    Write-Output "  DELETED old $name"
  }
  $mb = [math]::Round((Get-Item $f).Length / 1MB, 1)
  Write-Output "UPLOAD_START $name ($mb MB)"
  $out = & curl.exe -sS --ssl-no-revoke --max-time 3600 -X POST `
    "$Api/releases/$relId/attach_files" `
    -F "access_token=$token" -F "file=@$f" 2>&1 | Out-String
  if ($out -match '"browser_download_url"') {
    Write-Output "UPLOAD_OK $name"
  } else {
    Write-Output ("UPLOAD_ERR {0} :: {1}" -f $name, $out.Trim())
    throw "上传失败：$name"
  }
}

Write-Output 'DONE'
