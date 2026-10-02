param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
Add-Type -AssemblyName System.ServiceProcess
$root=[IO.Path]::GetFullPath($TestDirectory)
if (-not $root.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Use task-owned temporary files.' }
$project=Split-Path -Parent $PSScriptRoot
function Load-Functions([string]$File,[string[]]$Names) {
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $project $File),[ref]$tokens,[ref]$errors)
  if ($errors.Count) { throw 'Production source does not parse in Windows PowerShell 5.1.' }
  foreach ($name in $Names) {
    $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    if (-not $fn) { throw "Missing production function: $name" }
    . ([scriptblock]::Create(($fn.Extent.Text -replace '^function ', 'function script:')))
  }
}
Load-Functions 'scripts\invoke-final-silent-reinstall.ps1' @('Restore-PreservedServiceStartModes','Start-PreservedServices','Assert-CurrentPreservedServiceOwnership','Enter-InstallerServiceMaintenance','Complete-InstallerServiceMaintenance','Get-InstallerServiceMaintenanceStatus','Test-InstallerServiceMaintenanceOwner','Test-InstallerTransactionComplete','Get-ValidatedMaintenanceRecoveryState','Resume-InterruptedServiceMaintenance','Write-JsonAtomic','Assert-InstallerNotCancelled','Enter-InstallerWorkerLease','Invoke-InstallerRecoveryAttempts','Write-PendingInstallerRecovery','ConvertTo-InstallerWindowsArgument')
Load-Functions 'src\installer\owned-cleanup.ps1' @('Get-VerifiedOwnedServiceRecords')
Load-Functions 'src\installer\service-maintenance.ps1' @('Get-InstallerServiceState')
$script:OwnedDataRoot=Join-Path $root 'Product'
$script:RuntimeRoot=Join-Path $script:OwnedDataRoot 'Runtime'
$script:StageDirectory=Join-Path $root 'new-stage'
$script:events=New-Object 'Collections.Generic.List[string]'
$script:starts=New-Object 'Collections.Generic.List[string]'
$script:ownedServices=@('EgoistShieldCore','EgoistShieldTelegramProxy')
$script:legacyOwnedServices=@()
$script:sharedNameServices=@('Proxy')
$script:telegramProxyServiceName='EgoistShieldTelegramProxy'
$script:readbackFails=$false
$script:customAccount=$false
$script:guiStartupEvents=New-Object 'Collections.Generic.List[string]'
$script:guiStartupSuspended=$false
function Require([bool]$Value,[string]$Message) { if (-not $Value) { throw $Message } }
function Expect-Refused([scriptblock]$Action,[string]$Pattern) {
  $message=$null;try { & $Action } catch { $message=$_.Exception.Message }
  Require ($message -and $message -like $Pattern) ('Expected refusal: '+$Pattern+'; actual '+$message)
}
# OS mutation boundaries are replaced explicitly, never allowed to fall through.
function Invoke-InstallerSc { throw 'Forbidden native SCM boundary.' }
function sc.exe { throw 'Forbidden native SCM boundary.' }
function reg.exe { throw 'Forbidden registry write.' }
function Stop-Process { throw 'Forbidden host process termination.' }
function Protect-StageDirectory {param($Path) $script:events.Add('protect')}
# Startup-task adapters are inert boundaries. The real helper import/ownership
# behavior is tested separately; this fixture records production hook ordering.
function Suspend-OwnedGuiLoginStartup {
  Require (Test-InstallerServiceMaintenanceOwner) 'GUI startup suspension must follow this trusted maintenance marker.'
  $script:guiStartupSuspended=$true
  $script:guiStartupEvents.Add('suspend:'+([IO.Path]::GetFileName($StageDirectory)))
}
function Resume-OwnedGuiLoginStartup {
  Require ((Get-InstallerServiceMaintenanceStatus) -eq 'absent') 'GUI startup resumed before the maintenance marker was removed.'
  $script:guiStartupSuspended=$false
  $script:guiStartupEvents.Add('resume:'+([IO.Path]::GetFileName($StageDirectory)))
}
function New-InstallerProtectedFileSecurity {
  # A limited test token cannot assign Administrators ownership. The actual
  # protected-file constructor is verified separately; only this ACL boundary
  # uses the current test SID while the production atomic writer runs unchanged.
  $security=New-Object Security.AccessControl.FileSecurity
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $security.SetOwner($identity);$security.SetAccessRuleProtection($true,$false)
  $security.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')))
  return $security
}
function Unregister-InstallerMaintenanceBootRecovery {
  param($StageDirectory,$RestorationVerified)
  Require ([bool]$RestorationVerified) 'Boot recovery may only retire after verified restoration.'
  Require (-not $script:guiStartupSuspended) 'Boot recovery retired before GUI startup intent was restored.'
  $script:guiStartupEvents.Add('boot-retire:'+([IO.Path]::GetFileName($StageDirectory)))
}
function Register-InstallerMaintenanceBootRecovery {param($StageDirectory)}
  function Protect-InstallerStageTree {param($Stage)}
function Assert-PlainWrapperMigrationPath {
  param($Path,$Root)
  $full=[IO.Path]::GetFullPath($Path)
  Require ($full.StartsWith([IO.Path]::GetFullPath($Root).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) 'Path escaped isolated owned root.'
  return $full
}
function Test-OwnedServicePath {param($Path) return [string]$Path -like 'C:\Owned\*'}
function Test-OwnedPath {param($Path) return Test-OwnedServicePath $Path}
function Get-ExecutableFromCommandLine {param($Path) return [string]$Path}
function Test-ExclusiveOwnedServiceName {param($Name) return [string]$Name -like 'EgoistShield*'}
function Restore-InstallerServiceStartModes {param($Records,$OwnPath) $script:events.Add('restore-original')}
function Set-InstallerServiceStartMode {param($Name,$Mode,$DelayedAutoStart,$OwnPath) $script:events.Add('mode:'+$Name+':'+$Mode)}
function Start-Service {param($Name,$ErrorAction) $script:starts.Add([string]$Name)}
function Get-Service {
  param($Name,$ErrorAction)
  $result=[pscustomobject]@{Status='Stopped';ServiceName=[string]$Name}
  $result|Add-Member ScriptMethod WaitForStatus {param($Status,$Timeout) $this.Status='Running'}
  return $result
}
function Start-Sleep {param($Seconds,$Milliseconds)}
function Test-LoopbackDnsReady {param($State) return $true}
# Local DNS identity has its own file/process/listener fixtures. This fixture
# isolates policy restoration and transaction ownership/start ordering.
function Test-OwnedSystemDohRecoveryRuntime {param($State,[switch]$PreservedRuntimeRecovery)return $true}
function Wait-OwnedTelegramProxyReady { throw 'Unexpected Telegram readiness fixture boundary.' }
function Get-CimInstance {
  param($ClassName,$ErrorAction,$OperationTimeoutSec)
  if ($script:readbackFails) { throw 'Fixture CIM unavailable' }
  if ($script:customAccount) {
    return [pscustomobject]@{Name='OldCustom';DisplayName='Custom';PathName='C:\Owned\proxy.exe';StartName='DOMAIN\Custom';ServiceType='Own Process';State='Running'}
  }
  return @(
    [pscustomobject]@{Name='Legacy Proxy [v1]';DisplayName='Legacy';PathName='C:\Owned\proxy.exe';StartName='LocalSystem';ServiceType='Own Process';State='Running'},
    [pscustomobject]@{Name='Proxy';DisplayName='Foreign';PathName='C:\Foreign\proxy.exe';StartName='LocalSystem';ServiceType='Own Process';State='Running'},
    [pscustomobject]@{Name='EgoistShieldCore';DisplayName='Core';PathName='C:\Foreign\core.exe';StartName='LocalSystem';ServiceType='Own Process';State='Running'}
  )
}
function Get-InstallerServicePolicy {param($Name) return [pscustomobject]@{pathName='C:\Owned\fixture.exe';startMode='Manual';delayedAutoStart=$true}}
function Get-ServiceRecordFromRegistry {param($Name) return $null}

Restore-PreservedServiceStartModes ([pscustomobject]@{services=@()})
Require (($script:events -join ',') -eq 'restore-original,mode:EgoistShieldCore:Auto') 'Missing old Core left the newly installed Core Disabled.'
$script:events.Clear()
Restore-PreservedServiceStartModes ([pscustomobject]@{services=@([pscustomobject]@{name='EgoistShieldCore';startMode='Disabled'})})
Require (($script:events -join ',') -eq 'restore-original') 'Previously disabled Core was forced to Auto.'
Write-Output 'PASS: missing Core receives Auto; existing Core policy is preserved'

$state=[pscustomobject]@{services=@(
  [pscustomobject]@{name='EgoistShieldCore';wasRunning=$true;startMode='Auto'},
  [pscustomobject]@{name='Legacy Alias';wasRunning=$true;startMode='Manual'},
  [pscustomobject]@{name='EgoistShieldSystemDoH';wasRunning=$true;startMode='Auto'},
  [pscustomobject]@{name='UserStopped';wasRunning=$false;startMode='Auto'},
  [pscustomobject]@{name='Disabled';wasRunning=$true;startMode='Disabled'}
);criticalDns=@()}
Start-PreservedServices $state
Require (($script:starts -join ',') -eq 'EgoistShieldSystemDoH,Legacy Alias,EgoistShieldCore') 'Start ordering or stopped/disabled intent changed.'
$script:starts.Clear()
$state.services[0].wasRunning=$false
Start-PreservedServices $state
Require (($script:starts -join ',') -eq 'EgoistShieldSystemDoH,Legacy Alias') 'Stopped Core was started just because it exists.'
Write-Output 'PASS: DNS first, Core last, aliases included, stopped/disabled services left off'

$discovered=@(Get-VerifiedOwnedServiceRecords 3>$null)
Require ($discovered.Count -eq 1 -and $discovered[0].name -eq 'Legacy Proxy [v1]') 'Discovery lost an owned alias or captured a foreign same-name service.'
Require ($discovered[0].startMode -eq 'Manual' -and $discovered[0].delayedAutoStart) 'Discovery lost startup policy.'
$script:readbackFails=$true
Expect-Refused { Get-VerifiedOwnedServiceRecords } '*CIM unavailable*'
$script:readbackFails=$false;$script:customAccount=$true
Expect-Refused { Get-VerifiedOwnedServiceRecords } '*SERVICE_ACCOUNT_UNSUPPORTED*'
Write-Output 'PASS: owned arbitrary alias backed up, foreign names excluded, failed enumeration not treated as empty'
Write-Output 'PASS: custom credentials are rejected before destructive service recreation'

$script:guiStartupEvents.Clear()
Enter-InstallerServiceMaintenance
Require (Test-InstallerServiceMaintenanceOwner) 'Created marker is not bound to this stage.'
Enter-InstallerServiceMaintenance
Require (Test-InstallerServiceMaintenanceOwner) 'Repeated entry lost the original lease.'
Require (($script:guiStartupEvents -join ',') -eq 'suspend:new-stage,suspend:new-stage' -and $script:guiStartupSuspended) 'Repeated entry did not suspend after the trusted marker.'
$originalStage=$script:StageDirectory
$script:StageDirectory=Join-Path $root 'other-stage'
Expect-Refused { Enter-InstallerServiceMaintenance } '*requires recovery*'
Expect-Refused { Complete-InstallerServiceMaintenance } '*another service maintenance*'
Require ($script:guiStartupEvents.Count -eq 2 -and $script:guiStartupSuspended) 'Foreign stage changed GUI startup intent.'
$script:StageDirectory=$originalStage
Complete-InstallerServiceMaintenance
Require (-not (Test-InstallerServiceMaintenanceOwner)) 'Committed marker remained.'
Require (($script:guiStartupEvents -join ',') -eq 'suspend:new-stage,suspend:new-stage,resume:new-stage' -and -not $script:guiStartupSuspended) 'Completion did not remove the marker before resuming GUI startup.'
Complete-InstallerServiceMaintenance
Require (($script:guiStartupEvents -join ',') -eq 'suspend:new-stage,suspend:new-stage,resume:new-stage,resume:new-stage') 'Already-closed completion did not retry restored startup intent.'
Write-Output 'PASS: marker entry is idempotent; another stage cannot acquire or remove it'

$markerPath=Join-Path $script:OwnedDataRoot 'installer\service-maintenance.json'
New-Item -ItemType Directory -Path $script:StageDirectory -Force | Out-Null
$terminalPath=Join-Path $script:StageDirectory 'complete.flag'
[IO.File]::WriteAllText($terminalPath,'failed-recovered')
[IO.File]::WriteAllText($markerPath,'{broken json')
Expect-Refused { Test-InstallerServiceMaintenanceOwner } '*'
Expect-Refused { Test-InstallerTransactionComplete } '*'
Write-JsonAtomic -Path $markerPath -Value @{schemaVersion=1;owner='EgoistShield';stage=(Join-Path $root 'foreign-stage')}
Require ((Get-InstallerServiceMaintenanceStatus) -eq 'foreign' -and -not (Test-InstallerTransactionComplete)) 'Foreign maintenance was misreported as a closed transaction.'
Remove-Item -LiteralPath $markerPath -Force
Require ((Get-InstallerServiceMaintenanceStatus) -eq 'absent' -and (Test-InstallerTransactionComplete)) 'Verified absent marker did not allow the terminal result.'
Remove-Item -LiteralPath $terminalPath -Force
Write-Output 'PASS: malformed marker terminates; foreign marker is distinct; terminal requires verified absence'

$tokens=$null;$errors=$null
$leaseAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $project 'scripts\invoke-final-silent-reinstall.ps1'),[ref]$tokens,[ref]$errors)
$leaseFn=$leaseAst.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Enter-DeferredReinstallRecoveryLease'},$true)
$mutexName='Local\LagomMaintenanceFixture.'+[Guid]::NewGuid().ToString('N')
# Only the mutex namespace is substituted; the actual lease function and .NET
# contention behavior run unchanged. This mutex belongs exclusively to the test.
. ([scriptblock]::Create($leaseFn.Extent.Text.Replace('Global\EgoistShield.DeferredReinstall',$mutexName)))
Add-Type -TypeDefinition @'
using System;
using System.Threading;
public sealed class LifecycleMutexFixture {
  private readonly ManualResetEventSlim ready = new ManualResetEventSlim(false);
  private readonly ManualResetEventSlim release = new ManualResetEventSlim(false);
  private readonly Thread thread;
  public LifecycleMutexFixture(string name) {
    thread = new Thread(() => {
      using (var mutex = new Mutex(false, name)) {
        mutex.WaitOne();
        ready.Set();
        release.Wait();
        mutex.ReleaseMutex();
      }
    });
    thread.IsBackground = true;
    thread.Start();
    if (!ready.Wait(5000)) throw new InvalidOperationException("Fixture holder timed out.");
  }
  public void Stop() {
    release.Set();
    if (!thread.Join(5000)) throw new InvalidOperationException("Fixture holder did not release.");
    ready.Dispose(); release.Dispose();
  }
}
'@
$holder=New-Object LifecycleMutexFixture($mutexName)
try { Expect-Refused { Enter-DeferredReinstallRecoveryLease } '*still active*' }
finally { $holder.Stop() }
$lease=Enter-DeferredReinstallRecoveryLease
try {
  $nested=Enter-DeferredReinstallRecoveryLease
  $nested.ReleaseMutex();$nested.Dispose()
} finally { $lease.ReleaseMutex();$lease.Dispose() }
Write-Output 'PASS: actual isolated mutex rejects another thread and permits nested worker recovery'

$previousProgramData=$env:ProgramData
try {
  $env:ProgramData=Join-Path $root 'ProgramData'
  function Get-InstallerCommonDataRoot { return $env:ProgramData }
  $previousStage=Join-Path $env:ProgramData 'EgoistShieldInstaller\DeferredRuns\previous'
  $null=New-Item -ItemType Directory -Path $previousStage -Force
  $script:StageDirectory=$previousStage
  $previous=[pscustomobject]@{schemaVersion=1;owner='EgoistShield';installer=(Join-Path $previousStage 'candidate.exe');manifest=(Join-Path $previousStage 'integrity.json');version='3.8.0';sha256=('A'*64);services=@();runAfter=$true;handoffStarted=$true}
  Write-JsonAtomic -Path (Join-Path $previousStage 'state.json') -Value $previous
  Enter-InstallerServiceMaintenance
  $script:StageDirectory=$originalStage
  $script:resumeClears=$false;$script:resumeCalls=0
  function Get-ValidatedRelease {param($Installer,$Manifest,$Version,$Sha256,[switch]$AllowStagedPair) $script:events.Add('validate-old-release')}
  function Invoke-Recovery {
    param($State,$Reason)
    Require (Test-InstallerServiceMaintenanceOwner) 'Recovery was not scoped to the original marker stage.'
    Require (-not $State.runAfter) 'Old recovery would launch GUI during a new update.'
    $script:resumeCalls++
    if ($script:resumeClears) { Complete-InstallerServiceMaintenance; return $true }
    return $false
  }
  $startupCallsBeforeFailure=$script:guiStartupEvents.Count
  Expect-Refused { Resume-InterruptedServiceMaintenance } '*still requires recovery*'
  Require ($script:resumeCalls -eq 1 -and $script:StageDirectory -eq $originalStage) 'Failed old-stage recovery changed the new stage or was skipped.'
  Require ($script:guiStartupEvents.Count -eq $startupCallsBeforeFailure -and $script:guiStartupSuspended) 'Failed old-stage recovery resumed startup or retired boot recovery.'
  $script:resumeClears=$true
  Resume-InterruptedServiceMaintenance
  Require ($script:resumeCalls -eq 2 -and $script:StageDirectory -eq $originalStage) 'Retry did not finish old-stage recovery before new snapshots.'
  Require (($script:guiStartupEvents[$script:guiStartupEvents.Count-2]+','+$script:guiStartupEvents[$script:guiStartupEvents.Count-1]) -eq 'resume:previous,boot-retire:previous' -and -not $script:guiStartupSuspended) 'Validated retry did not resume before retiring its boot recovery.'
  Resume-InterruptedServiceMaintenance
  Require ($script:resumeCalls -eq 2) 'Completed old-stage recovery was replayed unnecessarily.'
  Write-Output 'PASS: failed recovery preserves marker; later validated retry resumes original stage without GUI'
} finally { $env:ProgramData=$previousProgramData }
& {
  $script:StageDirectory=Join-Path $root 'marker-write-failure'
  $null=New-Item -ItemType Directory -Path $script:StageDirectory -Force
  $workerState=[pscustomobject]@{
    installer='fixture.exe';manifest='fixture.json';version='3.8.0';sha256=('A'*64);
    delaySeconds=0;watchdogTimeoutSeconds=120;handoffStarted=$false;
    services=@();userState=@();criticalDns=@();installationId='';zapretProfile='';runAfter=$false
  }
  $workerStatePath=Join-Path $script:StageDirectory 'state.json'
  Write-JsonAtomic -Path $workerStatePath -Value $workerState
  $realWrite=(Get-Command Write-JsonAtomic -CommandType Function).ScriptBlock
  $workerFn=$leaseAst.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-WorkerMode'},$true)
  . ([scriptblock]::Create($workerFn.Extent.Text.Replace('Global\EgoistShield.DeferredReinstall',$mutexName)))
  $script:writeFault=$false;$script:workerRecoveryCalls=0;$script:watchdogLaunches=0
  function Test-IsAdministrator { return $true }
  function Assert-SupportedServiceFramework {}
  function Add-ReceiptEvent {param($Stage,$Status,$Message,$Data)}
  function Get-ValidatedRelease {param($Installer,$Manifest,$Version,$Sha256,[switch]$AllowStagedPair) return [pscustomobject]@{installer='fixture.exe'}}
  function Resume-InterruptedServiceMaintenance {}
  function Get-OwnedServiceSnapshot {param($Stage) return @()}
  function Backup-UserActivationState {param($Stage) return @()}
  function Backup-CriticalDnsState {param($Stage) return @()}
  function Get-InstalledIdentity { return 'fixture' }
  function Get-ItemProperty {param($LiteralPath,$Name,$ErrorAction) return [pscustomobject]@{EgoistShieldProfile=''}}
  function Invoke-RobocopyDirectory {param($Source,$Destination)}
  function Write-Heartbeat {param($Stage,$Phase,$InstallerPid)}
  function Get-NativePowerShellPath { return 'unused-powershell.exe' }
  function Start-Process {param($FilePath,$ArgumentList,$WindowStyle) $script:watchdogLaunches++}
  function Stop-OwnedProcesses { throw 'Service handoff must not occur after the injected state write failure.' }
  function Write-JsonAtomic {
    param($Path,$Value)
    if ($Path -eq $workerStatePath -and $Value.handoffStarted -eq $true) {
      $script:writeFault=$true
      throw 'Fixture handoff state write failed after acquiring maintenance marker'
    }
    & $realWrite -Path $Path -Value $Value
  }
  function Invoke-Recovery {
    param($State,$Reason)
    Require (-not $State.handoffStarted) 'Fixture did not retain the original false durable handoff flag.'
    Require (Test-InstallerServiceMaintenanceOwner) 'Worker recovery must own the persisted marker.'
    $script:workerRecoveryCalls++
    Complete-InstallerServiceMaintenance
    return $true
  }
  function Write-DesktopUpdateResult {param($State,$Ok,$Message) Require (-not $Ok) 'Failed state write reported success.'}
  Expect-Refused { Invoke-WorkerMode } '*Fixture handoff state write failed*'
  Require ($script:writeFault -and $script:watchdogLaunches -eq 1) 'Fixture did not reach marker-before-state-write ordering.'
  Require ($script:workerRecoveryCalls -eq 1 -and -not (Test-InstallerServiceMaintenanceOwner)) 'Worker stranded its own marker before durable handoff.'
  Require (($script:guiStartupEvents[$script:guiStartupEvents.Count-2]+','+$script:guiStartupEvents[$script:guiStartupEvents.Count-1]) -eq 'resume:marker-write-failure,boot-retire:marker-write-failure' -and -not $script:guiStartupSuspended) 'Recovered durable-write failure lost GUI startup/boot retirement ordering.'
  Require (Test-Path -LiteralPath (Join-Path $script:StageDirectory 'complete.flag')) 'Recovered failure was not recorded.'
}
Write-Output 'PASS: actual worker recovers its acquired marker when durable handoff state writing fails'
Write-Output 'Installer maintenance lifecycle: 9 groups passed; native SCM/registry/network/kills 0; OS boundaries are fixtures.'
