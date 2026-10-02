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
function Restore-PreservedState {param($State) if($script:restoreFault -eq 'state'){throw 'Inert state restoration failure.'}}
function Reconcile-PreservedZapretProfile {param($State)}
function Restore-InstalledIdentity {param($State)}
function Restore-PreservedServiceStartModes {param($State)}
$script:ownsMaintenance=$false
$script:restoreFault=''
$script:guiStartupSuspended=$false
$script:startupEvents=New-Object 'Collections.Generic.List[string]'
# The AST fixture never invokes the real scheduler. Explicit adapters record
# whether the production recovery function may restore startup intent.
function Suspend-OwnedGuiLoginStartup {
  if(-not $script:ownsMaintenance){throw 'Startup suspension without an owned fixture marker.'}
  $script:guiStartupSuspended=$true
  $script:startupEvents.Add('suspend')
}
function Resume-OwnedGuiLoginStartup {
  if($script:ownsMaintenance){throw 'Startup resumed before marker closure.'}
  $script:guiStartupSuspended=$false
  $script:startupEvents.Add('resume')
}
function Test-InstallerServiceMaintenanceOwner {return $script:ownsMaintenance}
function Get-InstallerServiceMaintenanceStatus {if($script:ownsMaintenance){return 'owned'};return 'absent'}
function Enter-DeferredReinstallRecoveryLease {
  $lease=New-Object psobject
  $lease|Add-Member ScriptMethod ReleaseMutex {}
  $lease|Add-Member ScriptMethod Dispose {}
  return $lease
}
function Complete-InstallerServiceMaintenance {
  if($script:startupEvents.IndexOf('services-restored') -lt 0 -or $script:startupEvents.IndexOf('dns-restored') -lt 0){throw 'Completion preceded fixture services/DNS restoration.'}
  $script:ownsMaintenance=$false
  $script:startupEvents.Add('marker-closed')
  Resume-OwnedGuiLoginStartup
}
function Start-PreservedServices {
  param($State)
  if($script:restoreFault -eq 'services'){throw 'Inert service restoration failure.'}
  $script:startupEvents.Add('services-restored')
}
function Test-LoopbackDnsReady {param($State)return $true}
function Restore-CriticalAdapterDns {
  param($State)
  if($script:restoreFault -eq 'dns'){throw 'Inert DNS restoration failure.'}
  $script:startupEvents.Add('dns-restored')
}
function Start-InstalledDesktop {param($State)$script:launchCount++}
foreach($case in @('none','pending','empty','committed')){
  if($case -eq 'none'){if(Test-Path -LiteralPath $marker){Remove-Item -LiteralPath $marker}}
  else{[IO.File]::WriteAllText($marker, $(if($case -eq 'pending'){'C:\fixture\old'}elseif($case -eq 'empty'){''}else{'COMMITTED|C:\fixture\old'}))}
  $script:ownsMaintenance=$true;$script:launchCount=0;$script:lastStatus=$null;$script:stopCount=0
  $script:guiStartupSuspended=$true;$script:startupEvents.Clear()
  $outcome=Invoke-Recovery -State ([pscustomobject]@{runAfter=$true;handoffStarted=$true;wrapperMigrationPending=$false;services=@();criticalDns=@([pscustomobject]@{interfaceIndex=17;servers=@('127.0.0.1')})}) -Reason 'controlled fixture'
  $pending=$case -in @('pending','empty')
  if($script:lastStatus -ne $(if($pending){'recovery-warning'}else{'recovered'})){throw 'An uncommitted rollback was reported as fully recovered.'}
  if($script:launchCount -ne $(if($pending){0}else{1})){throw 'Unverified application payload was launched after recovery.'}
  if($outcome -ne (-not $pending)){throw 'Recovery outcome did not distinguish pending payload rollback from verified restoration.'}
  if($pending){
    if(-not $script:ownsMaintenance -or -not $script:guiStartupSuspended -or $script:startupEvents.Contains('resume') -or $script:startupEvents.Contains('marker-closed')){throw 'Pending payload rollback resumed startup or closed its marker.'}
  }elseif($script:ownsMaintenance -or $script:guiStartupSuspended -or ($script:startupEvents -join ',') -ne 'services-restored,dns-restored,marker-closed,resume'){
    throw 'Verified recovery did not restore services/DNS before marker closure and startup resume.'
  }
}
$script:stopCount=0;$script:launchCount=0;$script:lastStatus=$null
$script:ownsMaintenance=$false;$script:startupEvents.Clear();$script:guiStartupSuspended=$true
Invoke-Recovery -State ([pscustomobject]@{runAfter=$true;handoffStarted=$false;wrapperMigrationPending=$false}) -Reason 'pre-handoff failure'
if($script:stopCount -ne 0 -or $script:launchCount -ne 0 -or $script:lastStatus -ne 'recovery-not-needed'){throw 'Pre-handoff failure mutated services or launched the desktop.'}
if(($script:startupEvents -join ',') -ne 'resume' -or $script:guiStartupSuspended){throw 'Authenticated absent-marker recovery did not retry startup intent without service handoff.'}
Write-Output 'PASS: a pre-handoff failure does not stop services or launch the desktop'
$script:stopCount=0;$script:launchCount=0;$script:lastStatus=$null
[IO.File]::WriteAllText($marker,'COMMITTED|C:\fixture\old')
$script:startupEvents.Clear();$script:guiStartupSuspended=$true
Invoke-Recovery -State ([pscustomobject]@{runAfter=$true;services=@();criticalDns=@([pscustomobject]@{interfaceIndex=17;servers=@('127.0.0.1')})}) -Reason 'legacy state without handoff marker'
if($script:stopCount -ne 1 -or $script:launchCount -ne 1 -or $script:lastStatus -ne 'recovered'){throw 'Legacy recovery state without the new handoff marker was blocked.'}
if(($script:startupEvents -join ',') -ne 'services-restored,dns-restored,marker-closed,resume' -or $script:guiStartupSuspended){throw 'Legacy restoration bypassed startup closure ordering.'}
Write-Output 'PASS: legacy state without the handoff marker still runs recovery'
$script:ownsMaintenance=$true;$script:stopCount=0;$script:launchCount=0;$script:lastStatus=$null
$script:startupEvents.Clear();$script:guiStartupSuspended=$true
Invoke-Recovery -State ([pscustomobject]@{runAfter=$false;handoffStarted=$false;services=@();criticalDns=@([pscustomobject]@{interfaceIndex=17;servers=@('127.0.0.1')})}) -Reason 'owned marker persisted before handoff flag'
if($script:stopCount -ne 1 -or $script:launchCount -ne 0 -or $script:lastStatus -ne 'recovered'){throw 'An acquired marker could not recover a crash before the handoff state write.'}
Write-Output 'PASS: owned marker recovers a crash before handoff flag without launching GUI'
Write-Output 'PASS: recovery does not claim payload rollback or start the desktop while its marker remains pending'
foreach($fault in @('state','services','dns')){
  $script:restoreFault=$fault;$script:ownsMaintenance=$true;$script:guiStartupSuspended=$true
  $script:startupEvents.Clear();$script:launchCount=0;$script:lastStatus=$null;$script:stopCount=0
  $outcome=Invoke-Recovery -State ([pscustomobject]@{runAfter=$false;handoffStarted=$true;wrapperMigrationPending=$false;services=@();criticalDns=@([pscustomobject]@{interfaceIndex=17;servers=@('127.0.0.1')})}) -Reason 'explicit inert restoration fault'
  if($outcome -ne $false -or $script:lastStatus -ne 'recovery-warning' -or -not $script:ownsMaintenance -or -not $script:guiStartupSuspended -or $script:launchCount -ne 0 -or $script:startupEvents.Contains('resume') -or $script:startupEvents.Contains('marker-closed')){throw ('Failed '+$fault+' restoration resumed GUI startup or claimed full recovery.')}
}
$script:restoreFault=''
Write-Output 'PASS: state, service and DNS failures retain suspension and owned marker; verified restoration resumes only after closure'
Write-Output 'Recovery startup adapters: native Task Scheduler/SCM/DNS mutations 0; boundaries are inert fixtures.'

# Execute the actual worker catch body with inert boundaries; no worker lifecycle
# or native service/process/task operations are invoked by this focused fixture.
$worker=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-WorkerMode'},$true)
$workerTry=@($worker.Body.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.TryStatementAst] -and $_.Body.Extent.Text.Contains('Get-OwnedServiceSnapshot')})[0]
$catchText=$workerTry.CatchClauses[0].Body.Extent.Text
$workerHarness=[scriptblock]::Create("try { throw 'PRIMARY exact boot-registration refusal' } catch "+$catchText)
$statePath=Join-Path $testRoot 'worker-catch-state.json';$StageDirectory=$testRoot
[IO.File]::WriteAllText($statePath,'{"handoffStarted":true}')
$release=[pscustomobject]@{installer='inert.exe'}
function Add-ReceiptEvent {param($Stage,$Status,$Message,$Data) if($script:workerFault -eq 'receipt'){throw 'SECONDARY receipt unavailable'};$script:workerEvents.Add([pscustomobject]@{stage=$Stage;status=$Status;message=$Message;data=$Data})}
function Invoke-InstallerRecoveryAttempts {param($State,$Reason,$Attempts,$RetrySeconds) $script:recoveryReason=$Reason;$script:eventCountAtRecovery=$script:workerEvents.Count;if($script:workerFault -eq 'recovery'){throw 'SECONDARY recovery failure'};return ($script:workerFault -ne 'pending')}
function Write-DesktopUpdateResult {param($State,$Ok,$Message)}
function Unregister-InstallerMaintenanceBootRecovery {param($StageDirectory,$RestorationVerified) if($script:workerFault -eq 'retirement'){throw 'SECONDARY retirement failure'}}
function Write-PendingInstallerRecovery {param($Reason,$Attempts) throw 'SECONDARY pending receipt failure'}
function Test-InstallerServiceMaintenanceOwner {return $false}
$script:workerEvents=New-Object 'Collections.Generic.List[object]'
foreach($fault in @('none','recovery','retirement','receipt','pending')){
  $script:workerFault=$fault;$script:workerEvents.Clear();$script:recoveryReason='';$script:eventCountAtRecovery=0;$primary='PRIMARY exact boot-registration refusal'
  $caught='';try {& $workerHarness}catch{$caught=$_.Exception.Message}
  if($caught -cne $primary){throw ('Worker lost original failure after '+$fault+': '+$caught)}
  if($script:recoveryReason -cne $primary){throw 'Worker recovery did not receive saved original reason.'}
  if($fault -ne 'receipt' -and ($script:eventCountAtRecovery -lt 1 -or $script:workerEvents[0].message -cne $primary -or $script:workerEvents[0].stage -cne 'worker')){throw 'Original failure was not recorded before recovery.'}
}
Write-Output 'PASS: actual worker catch preserves primary failure before recovery, receipt failure, recovery failure and task retirement failure; native mutations0'
