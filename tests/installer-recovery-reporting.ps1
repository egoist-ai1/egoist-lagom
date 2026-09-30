param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
$testRoot=[IO.Path]::GetFullPath($TestDirectory)
$temporary=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
if(-not $testRoot.StartsWith($temporary,[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $testRoot -PathType Container)){throw 'Use an existing task-owned temporary fixture directory.'}
$source=[IO.File]::ReadAllText((Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\invoke-final-silent-reinstall.ps1'))
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Installer source failed parsing.'}
foreach($name in @('Test-PayloadRollbackPending','Stop-PreservedWrappersForRecovery','Invoke-Recovery')){
  $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if(-not $fn){throw 'Missing production recovery function.'}
  . ([scriptblock]::Create($fn.Extent.Text))
}
$script:RuntimeRoot=Join-Path $testRoot 'Runtime'
$stateDirectory=Join-Path $testRoot 'installer'
New-Item -ItemType Directory -Path $stateDirectory -Force|Out-Null
$marker=Join-Path $stateDirectory 'pending-upgrade-quarantine.txt'
function Add-ReceiptEvent {param($Stage,$Status,$Message) $script:lastStatus=$Status}
function Stop-OwnedServiceForInstall {param($Name)$script:stopCount++}
function Restore-PreservedState {param($State)}
function Reconcile-PreservedZapretProfile {param($State)}
function Restore-InstalledIdentity {param($State)}
function Restore-PreservedServiceStartModes {param($State)}
$script:ownsMaintenance=$false
function Test-InstallerServiceMaintenanceOwner {return $script:ownsMaintenance}
function Get-InstallerServiceMaintenanceStatus {if($script:ownsMaintenance){return 'owned'};return 'absent'}
function Enter-DeferredReinstallRecoveryLease {
  $lease=New-Object psobject
  $lease|Add-Member ScriptMethod ReleaseMutex {}
  $lease|Add-Member ScriptMethod Dispose {}
  return $lease
}
function Complete-InstallerServiceMaintenance { $script:ownsMaintenance=$false }
function Start-PreservedServices {param($State)}
function Test-LoopbackDnsReady {param($State)return $true}
function Restore-CriticalAdapterDns {param($State)}
function Start-InstalledDesktop {param($State)$script:launchCount++}
foreach($case in @('none','pending','empty','committed')){
  if($case -eq 'none'){if(Test-Path -LiteralPath $marker){Remove-Item -LiteralPath $marker}}
  else{[IO.File]::WriteAllText($marker, $(if($case -eq 'pending'){'C:\fixture\old'}elseif($case -eq 'empty'){''}else{'COMMITTED|C:\fixture\old'}))}
  $script:ownsMaintenance=$true;$script:launchCount=0;$script:lastStatus=$null;$script:stopCount=0
  $outcome=Invoke-Recovery -State ([pscustomobject]@{runAfter=$true;handoffStarted=$true;wrapperMigrationPending=$false}) -Reason 'controlled fixture'
  $pending=$case -in @('pending','empty')
  if($script:lastStatus -ne $(if($pending){'recovery-warning'}else{'recovered'})){throw 'An uncommitted rollback was reported as fully recovered.'}
  if($script:launchCount -ne $(if($pending){0}else{1})){throw 'Unverified application payload was launched after recovery.'}
  if($outcome -ne (-not $pending)){throw 'Recovery outcome did not distinguish pending payload rollback from verified restoration.'}
}
$script:stopCount=0;$script:launchCount=0;$script:lastStatus=$null
$script:ownsMaintenance=$false
Invoke-Recovery -State ([pscustomobject]@{runAfter=$true;handoffStarted=$false;wrapperMigrationPending=$false}) -Reason 'pre-handoff failure'
if($script:stopCount -ne 0 -or $script:launchCount -ne 0 -or $script:lastStatus -ne 'recovery-not-needed'){throw 'Pre-handoff failure mutated services or launched the desktop.'}
Write-Output 'PASS: a pre-handoff failure does not stop services or launch the desktop'
$script:stopCount=0;$script:launchCount=0;$script:lastStatus=$null
[IO.File]::WriteAllText($marker,'COMMITTED|C:\fixture\old')
Invoke-Recovery -State ([pscustomobject]@{runAfter=$true}) -Reason 'legacy state without handoff marker'
if($script:stopCount -ne 1 -or $script:launchCount -ne 1 -or $script:lastStatus -ne 'recovered'){throw 'Legacy recovery state without the new handoff marker was blocked.'}
Write-Output 'PASS: legacy state without the handoff marker still runs recovery'
$script:ownsMaintenance=$true;$script:stopCount=0;$script:launchCount=0;$script:lastStatus=$null
Invoke-Recovery -State ([pscustomobject]@{runAfter=$false;handoffStarted=$false}) -Reason 'owned marker persisted before handoff flag'
if($script:stopCount -ne 1 -or $script:launchCount -ne 0 -or $script:lastStatus -ne 'recovered'){throw 'An acquired marker could not recover a crash before the handoff state write.'}
Write-Output 'PASS: owned marker recovers a crash before handoff flag without launching GUI'
Write-Output 'PASS: recovery does not claim payload rollback or start the desktop while its marker remains pending'
