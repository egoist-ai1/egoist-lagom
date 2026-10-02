$ErrorActionPreference='Stop'
if (-not $env:LAGOM_TEST_TEMP) { throw 'Set task-scoped LAGOM_TEST_TEMP.' }
$fixtureRoot=Join-Path $env:LAGOM_TEST_TEMP ('u [x]-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
$programDataRoot=Join-Path $fixtureRoot 'ProgramData'
$installRoot=Join-Path $fixtureRoot 'installed'
$installIdentityRequiredFiles=@('EgoistShield.exe','resources\app.asar')
$null=New-Item -ItemType Directory -Path (Join-Path $installRoot 'resources') -Force
[IO.File]::WriteAllBytes((Join-Path $installRoot 'EgoistShield.exe'),(New-Object byte[] 1048576))
[IO.File]::WriteAllText((Join-Path $installRoot 'resources\app.asar'),'fixture')
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\src\installer\owned-cleanup.ps1'))
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('Get-FileSha256','Test-InstallRootIdentified','Test-VerifiedProtectedReinstall','Test-InstallMayStopOwnedRuntimes')) {
  $fn=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
  if (-not $fn) { throw "Missing $name" }
  . ([scriptblock]::Create($fn.Extent.Text))
}
function Test-RunningOwnedSystemDoh { return $false }
function Test-CanonicalInstallerTarget { param($Root) return $true }
function Test-EmptyPlainDirectory { param($Root) return $false }
function Test-VerifiedCanonicalInstalledApplication { param($Root) return (Test-InstallRootIdentified $Root) }
function Assert-InstallerMaintenanceBootRecovery {
  param($StageDirectory)
  if ($script:bootMissing) { throw 'Fixture protected boot registration is missing.' }
  return [pscustomobject]@{verified=$true;owner='EgoistShield';schemaVersion=1;stage=$StageDirectory}
}
function Get-InstallerBootRecoveryContext {
  param($Stage,[switch]$AllowLegacyInventory)
  return [pscustomobject]@{maintenanceMarker=(Join-Path $Stage 'service-maintenance.json');powerShell=(Get-Process -Id $PID).MainModule.FileName}
}
function Assert-InstallerBootRecoveryPlainPath {param($Path,[switch]$Leaf)}
function Assert-InstallerBootRecoveryFileProtection {param($Path,[switch]$Directory)}
function Require {param([bool]$Value,[string]$Message)if(-not $Value){throw $Message}}
$previousStage=$env:EGOIST_PROTECTED_REINSTALL_STAGE
try {
  $env:EGOIST_PROTECTED_REINSTALL_STAGE=''
  Require (-not (Test-InstallMayStopOwnedRuntimes 2>$null)) 'Unprotected upgrade without active DoH was allowed.'
  Write-Output 'PASS: installed upgrade requires protected handoff even when DoH is inactive'
  $savedRoot=$installRoot;$installRoot=Join-Path $fixtureRoot 'fresh'
  Require (Test-InstallMayStopOwnedRuntimes) 'Fresh installation was blocked.'
  $installRoot=$savedRoot
  Write-Output 'PASS: a fresh install retains its direct path'
  $stage=Join-Path $programDataRoot 'EgoistShieldInstaller\DeferredRuns\fixture'
  $null=New-Item -ItemType Directory -Path $stage -Force
  $installer=Join-Path $stage 'candidate.exe'
  [IO.File]::WriteAllText($installer,'controlled candidate bytes')
  [IO.File]::WriteAllText((Join-Path $stage 'backup-ready.flag'),'ready')
  $state=@{schemaVersion=1;owner='EgoistShield';installer=$installer;sha256=Get-FileSha256 $installer;handoffStarted=$true}
  $state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'state.json') -Encoding utf8
  $worker=Get-Process -Id $PID
  $heartbeat=@{workerPid=$PID;workerStartTicks=$worker.StartTime.Ticks}
  $heartbeat | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'heartbeat.json') -Encoding utf8
  @{schemaVersion=1;owner='EgoistShield';stage=$stage} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'service-maintenance.json') -Encoding utf8
  $env:EGOIST_PROTECTED_REINSTALL_STAGE=$stage
  $script:bootMissing=$true
  Require (-not (Test-VerifiedProtectedReinstall)) 'An old worker stage without verified boot recovery bypassed the new installer.'
  $script:bootMissing=$false
  Write-Output 'PASS: legacy worker without protected boot recovery cannot bypass the new installer'
  Require (Test-VerifiedProtectedReinstall) 'Exact live protected-stage evidence was rejected.'
  Require (Test-InstallMayStopOwnedRuntimes) 'Protected upgrade was blocked.'
  Write-Output 'PASS: exact installer hash, backup marker and live worker evidence permit protected upgrade'
  $heartbeat.workerStartTicks=1
  $heartbeat | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'heartbeat.json') -Encoding utf8
  Require (-not (Test-VerifiedProtectedReinstall)) 'Stale/reused worker identity was accepted.'
  Write-Output 'PASS: stale worker identity cannot bypass protected-upgrade guard'
  $heartbeat.workerStartTicks=$worker.StartTime.Ticks
  $heartbeat | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'heartbeat.json') -Encoding utf8
  [IO.File]::WriteAllText($installer,'changed candidate')
  Require (-not (Test-VerifiedProtectedReinstall)) 'Changed installer hash was accepted.'
  Write-Output 'PASS: changed installer content cannot bypass protected-upgrade guard'
  Write-Output 'Protected upgrade checks: 6 passed; no service/registry/network writes; boot registration proof is a controlled boundary'
} finally {$env:EGOIST_PROTECTED_REINSTALL_STAGE=$previousStage}
