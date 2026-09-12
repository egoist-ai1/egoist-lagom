[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$EvidenceDirectory,
  [string]$PlaywrightModule
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not [IO.Path]::IsPathRooted($EvidenceDirectory)) {
  throw 'EvidenceDirectory must be an absolute path.'
}
$evidenceRoot = [IO.Path]::GetFullPath($EvidenceDirectory)
if ($evidenceRoot.Equals($projectRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $projectRoot.StartsWith($evidenceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'EvidenceDirectory must not contain the project.'
}
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$sandbox = Join-Path (Split-Path -Parent $evidenceRoot) ('fv-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $sandbox -Force | Out-Null

function Get-TextHash([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
  } finally {
    $sha.Dispose()
  }
}

function Get-SystemSnapshot([string]$Label) {
  $dns = @(Get-DnsClientServerAddress -ErrorAction Stop |
    Sort-Object InterfaceIndex, AddressFamily |
    ForEach-Object {
      [ordered]@{
        interfaceIndex = [int]$_.InterfaceIndex
        addressFamily = [int]$_.AddressFamily
        servers = @($_.ServerAddresses)
      }
    })
  $proxyKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  $proxy = Get-ItemProperty -LiteralPath $proxyKey -ErrorAction Stop
  $services = @(Get-Service -ErrorAction Stop |
    Where-Object { $_.Name -like 'EgoistShield*' -or $_.Name -like 'WinDivert*' } |
    Sort-Object Name |
    ForEach-Object {
      $registration = Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Services\' + $_.Name) -ErrorAction SilentlyContinue
      [ordered]@{
        name = $_.Name
        status = $_.Status.ToString()
        start = if ($null -ne $registration) { $registration.Start } else { $null }
        objectName = if ($null -ne $registration) { $registration.ObjectName } else { $null }
      }
    })
  $processes = @(foreach ($name in 'EgoistShield', 'winws', 'dnscrypt-proxy', 'tg-ws-proxy') {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      $image = ''
      try { $image = [string]$_.Path } catch { $image = '' }
      [ordered]@{ name = $_.ProcessName; id = [int]$_.Id; pathHash = Get-TextHash $image }
    }
  })
  $processes = @($processes | Sort-Object name, id)
  $exactState = [ordered]@{
    dns = $dns
    proxy = [ordered]@{
      enabled = [int]$proxy.ProxyEnable
      server = [string]$proxy.ProxyServer
      override = [string]$proxy.ProxyOverride
      autoConfigUrl = [string]$proxy.AutoConfigURL
    }
    services = $services
    processes = $processes
  }
  $exactJson = $exactState | ConvertTo-Json -Depth 8 -Compress
  $os = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  $snapshot = [ordered]@{
    label = $Label
    capturedAt = [DateTime]::UtcNow.ToString('o')
    computer = $env:COMPUTERNAME
    windows = [ordered]@{ productName = $os.ProductName; displayVersion = $os.DisplayVersion; build = $os.CurrentBuildNumber }
    powershell = $PSVersionTable.PSVersion.ToString()
    stateSha256 = Get-TextHash $exactJson
    dns = $dns
    proxy = [ordered]@{
      enabled = [int]$proxy.ProxyEnable
      serverSha256 = Get-TextHash ([string]$proxy.ProxyServer)
      overrideSha256 = Get-TextHash ([string]$proxy.ProxyOverride)
      autoConfigUrlSha256 = Get-TextHash ([string]$proxy.AutoConfigURL)
    }
    services = $services
    processes = $processes
  }
  $path = Join-Path $evidenceRoot ("system-$Label.json")
  [IO.File]::WriteAllText($path, (($snapshot | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  return $snapshot
}

$steps = @()
function Invoke-ValidationStep([string]$Name, [string]$FilePath, [string[]]$Arguments) {
  $safeName = $Name -replace '[^a-zA-Z0-9_-]', '-'
  $stdout = Join-Path $evidenceRoot ($safeName + '.stdout.txt')
  $stderr = Join-Path $evidenceRoot ($safeName + '.stderr.txt')
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $global:LASTEXITCODE = 0
  & $FilePath @Arguments 1> $stdout 2> $stderr
  $exitCode = $LASTEXITCODE
  $timer.Stop()
  $script:steps += [pscustomobject][ordered]@{ name = $Name; exitCode = $exitCode; elapsedMs = $timer.ElapsedMilliseconds; stdout = $stdout; stderr = $stderr }
  if ($exitCode -ne 0) {
    throw "$Name failed with exit code $exitCode."
  }
}

$oldEnvironment = [ordered]@{
  TEMP = $env:TEMP
  TMP = $env:TMP
  LAGOM_TEST_TEMP = $env:LAGOM_TEST_TEMP
  EGOIST_RELEASE_TEST_DIR = $env:EGOIST_RELEASE_TEST_DIR
  EGOIST_RELEASE_PYTHON = $env:EGOIST_RELEASE_PYTHON
  PLAYWRIGHT_MODULE = $env:PLAYWRIGHT_MODULE
}
$before = Get-SystemSnapshot 'before'
$failure = $null
try {
  $env:TEMP = $sandbox
  $env:TMP = $sandbox
  $env:LAGOM_TEST_TEMP = $sandbox
  $env:EGOIST_RELEASE_TEST_DIR = $sandbox
  $python = (Get-Command python.exe -ErrorAction Stop).Source
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $env:EGOIST_RELEASE_PYTHON = $python
  if ($PlaywrightModule) {
    if (-not [IO.Path]::IsPathRooted($PlaywrightModule) -or -not (Test-Path -LiteralPath $PlaywrightModule -PathType Leaf)) {
      throw 'PlaywrightModule must be an existing absolute file.'
    }
    $env:PLAYWRIGHT_MODULE = [IO.Path]::GetFullPath($PlaywrightModule)
  }
  Push-Location $projectRoot
  try {
    Invoke-ValidationStep 'build' $npm @('run', 'build')
    Invoke-ValidationStep 'tests' $npm @('test')
    Invoke-ValidationStep 'core-self-test' (Join-Path $projectRoot 'out\EgoistShield-3.7.1-win-x64\resources\core-service\win-x64\EgoistShield.Service.exe') @('--self-test')
    Invoke-ValidationStep 'release-preflight' $node @('scripts/prepare-release-assets.mjs', '--verify-only', 'true')
    if ($PlaywrightModule) {
      Invoke-ValidationStep 'ui-compact' $node @('scripts/check-compact-ui.mjs', (Join-Path $sandbox 'ui-compact'))
      Invoke-ValidationStep 'ui-widget' $node @('scripts/check-shield-widget.mjs', (Join-Path $sandbox 'ui-widget'))
      Invoke-ValidationStep 'ui-actions' $node @('scripts/check-renderer-actions.mjs', (Join-Path $sandbox 'ui-actions'))
      Invoke-ValidationStep 'ui-profiles' $node @('scripts/check-profile-layout.mjs', (Join-Path $sandbox 'ui-profiles'))
    }
  } finally {
    Pop-Location
  }
} catch {
  $failure = $_.Exception.Message
} finally {
  foreach ($name in $oldEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], 'Process')
  }
}
$after = Get-SystemSnapshot 'after'
$unchanged = $before.stateSha256 -eq $after.stateSha256
$report = [ordered]@{
  schemaVersion = 1
  startedAt = $before.capturedAt
  finishedAt = $after.capturedAt
  project = $projectRoot
  sandbox = $sandbox
  hostStateUnchanged = $unchanged
  beforeSha256 = $before.stateSha256
  afterSha256 = $after.stateSha256
  steps = $steps
  ok = $null -eq $failure -and $unchanged
  error = $failure
}
$reportPath = Join-Path $evidenceRoot 'fast-validation-report.json'
[IO.File]::WriteAllText($reportPath, (($report | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
if (-not $unchanged) { throw "Host system state changed during isolated validation. See $reportPath" }
if ($failure) { throw "$failure See $reportPath" }
Write-Output $reportPath
