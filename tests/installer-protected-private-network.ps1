param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$project=Split-Path -Parent $PSScriptRoot
$root=[IO.Path]::GetFullPath($TestDirectory)
if(-not $root.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Use task-owned fixtures.'}
function Require([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $project 'src\installer\owned-cleanup.ps1'),[ref]$tokens,[ref]$errors)
Require ($errors.Count -eq 0) 'Production cleanup does not parse in Windows PowerShell.'
$sharedTokens=$null;$sharedErrors=$null
$sharedAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path (Split-Path -Parent $PSScriptRoot) 'src\installer\service-maintenance.ps1'),[ref]$sharedTokens,[ref]$sharedErrors)
if($sharedErrors.Count){throw 'Shared diagnostic helpers failed parsing.'}
foreach($name in @('ConvertTo-InstallerDiagnosticMessage','New-InstallerFailureDiagnostic','Read-InstallerFailureDiagnostic')){
  $fn=$sharedAst.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if(-not $fn){throw ('Missing shared helper '+$name)}
  . ([scriptblock]::Create($fn.Extent.Text))
}
foreach($name in @('Set-ProtectedReinstallFailureDiagnostic','Throw-ProtectedSystemDohTransactionRefusal','Initialize-ProtectedInstallerHeartbeatNative','Assert-ProtectedInstallerHeartbeatSecurity','Open-ProtectedInstallerHeartbeatFile','Open-ProtectedInstallerHeartbeatSnapshot','Read-ProtectedInstallerHeartbeatSnapshot','Close-ProtectedInstallerHeartbeatSnapshot','Get-FileSha256','Test-VerifiedProtectedReinstall','Test-PreserveProtectedInstallerNetwork','Test-InstallMayStopOwnedRuntimes','Invoke-CoreServiceOfflineRecovery','Invoke-CoreOwnedDnsCleanup','Invoke-CoreNativeDohCleanup','Reset-WindowsNetworkBaseline','Restore-SystemNetworkBaseline','Backup-AndResetPersistedNetworkActivation','Discard-OwnedNetworkArtifacts','Reconcile-OrphanedExternalBaseline')){
  $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  Require ($null -ne $fn) ('Missing function '+$name)
  . ([scriptblock]::Create($fn.Extent.Text))
}
$dispatch=$ast.Find({param($n)$n -is [Management.Automation.Language.SwitchStatementAst] -and $n.Condition.Extent.Text -eq '$Phase'},$true)
$pre=@($dispatch.Clauses|Where-Object {$_.Item1.Value -eq 'PreInstall'})[0].Item2
$post=@($dispatch.Clauses|Where-Object {$_.Item1.Value -eq 'PostInstall'})[0].Item2
$script:stage=Join-Path $root 'DeferredRuns\00000000000000000000000000000038'
$script:marker=Join-Path $root 'EgoistShield\installer\service-maintenance.json'
$installRoot=Join-Path $root 'Install'
$Services=@()
foreach($directory in @($script:stage,(Split-Path -Parent $script:marker),$installRoot)){New-Item -ItemType Directory -Path $directory -Force|Out-Null}
$script:birth=[DateTime]::Now.AddMinutes(-1)
$script:engine=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script:installer=Join-Path $script:stage 'installer.exe';[IO.File]::WriteAllText($script:installer,'Controlled installer identity; never executed.')
$script:state=[pscustomobject]@{schemaVersion=1;owner='EgoistShield';handoffStarted=$true;installer=$script:installer;sha256=(Get-FileSha256 $script:installer)}
function Write-FixtureJson($Path,$Value){[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))}
function Reset-Stage {
  $script:bootVerified=$true;$script:unsafeAcl=$false;$script:wrongBirth=$false;$script:wrongImage=$false;$script:exited=$false
  Write-FixtureJson (Join-Path $script:stage 'state.json') $script:state
  Write-FixtureJson (Join-Path $script:stage 'heartbeat.json') @{workerPid=138;workerStartTicks=$script:birth.Ticks}
  Write-FixtureJson $script:marker @{schemaVersion=1;owner='EgoistShield';stage=$script:stage}
  [IO.File]::WriteAllText((Join-Path $script:stage 'backup-ready.flag'),'ready')
}
function Assert-InstallerMaintenanceBootRecovery {param($StageDirectory)return [pscustomobject]@{verified=$script:bootVerified;owner='EgoistShield';schemaVersion=1;stage=$StageDirectory}}
function Get-InstallerBootRecoveryContext {param($StageDirectory,[switch]$AllowLegacyInventory)return [pscustomobject]@{maintenanceMarker=$script:marker;powerShell=$script:engine}}
function Assert-InstallerBootRecoveryPlainPath {param($Path,[switch]$Leaf)Require ([IO.Path]::GetFullPath($Path).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) 'Protection escaped fixture root.';Require (Test-Path -LiteralPath $Path) 'Protected file is missing.'}
function Assert-InstallerBootRecoveryFileProtection {param($Path)if($script:unsafeAcl){throw 'Controlled unsafe ACL boundary'}}
# ACL/boot/process authority remain the fixture's controlled boundaries.
# Real native open/pins/attributes/read/close execute; the held ACL policy remains controlled here.
function Assert-ProtectedInstallerHeartbeatSecurity {
  param([Security.AccessControl.FileSecurity]$Acl,[switch]$Directory)
  if(-not $Acl){throw 'Held heartbeat ACL is missing.'}
  $path=if($Directory){$env:EGOIST_PROTECTED_REINSTALL_STAGE}else{Join-Path $env:EGOIST_PROTECTED_REINSTALL_STAGE 'heartbeat.json'}
  Assert-InstallerBootRecoveryFileProtection -Path $path
}
function Get-Process {param($Id,$ErrorAction)Require ($Id -eq 138) 'Wrong worker PID.';$held=[pscustomobject]@{Handle=1;HasExited=$script:exited;StartTime=if($script:wrongBirth){$script:birth.AddSeconds(1)}else{$script:birth};MainModule=[pscustomobject]@{FileName=if($script:wrongImage){'C:\foreign.exe'}else{$script:engine}}};$held|Add-Member ScriptMethod Dispose {};return $held}
function Write-Journal {param($Event,$Data)$script:journal.Add([string]$Event)}
function Test-CanonicalInstallerTarget {param($Root)return $true}
function Test-EmptyPlainDirectory {param($Root)return $false}
function Test-VerifiedCanonicalInstalledApplication {param($Root)return $true}
function Test-InstallRootUnderProgramFiles {param($Root)return $true}
function Test-RunningOwnedSystemDoh {return $true}
function Get-CriticalLoopbackDnsInterfaces {return @([pscustomobject]@{interfaceIndex=38;interfaceAlias='Controlled critical adapter'})}
function Test-InstallRootHealthy {param($Root)return $true}
function Get-ValidatedUpgradeQuarantine {return $null}
function Wait-OwnedFilesReleased {param($Seconds)return $true}
function Get-ValidatedInstalledProductVersion {param($Root)return '3.8.0'}
function Start-Sleep {param($Seconds,$Milliseconds)}
foreach($name in @('Backup-OwnedServiceRegistrations','Save-SystemNetworkBaseline','Stop-AllOwnedRuntimes','Unload-OwnedWinDivertDriver','Remove-IncompatibleOwnedServices','New-OwnedRuntimeQuarantine','Remove-OwnedFirewallRules','Remove-OwnedShortcuts','Remove-OrphanedOwnedServices','Backup-OwnedInstallRegistration','New-UpgradeQuarantine','Remove-OptionalOwnedServices','Write-ValidatedInstallationIdentity','Assert-InstalledCandidateRuntime','Remove-OwnedGuiElevationCompatibility','Complete-UpgradeQuarantine','Remove-OwnedStartupArtifacts','Update-ShellIconCache')){
  Set-Item -Path ('Function:\'+$name) -Value ([scriptblock]::Create('param($Root,[switch]$BeforeCommit)'))
}
function Reset-OwnedNetworkState {$script:ordinaryResets++}
function Restore-OwnedDnsTransaction {$script:dns='192.0.2.53';$script:ordinaryResets++}
function Remove-OwnedTunnelAdapters {$script:ordinaryResets++}
function Set-DnsClientServerAddress {throw 'Forbidden live DNS mutation.'}
function sc.exe {throw 'Forbidden live SCM mutation.'}
function reg.exe {throw 'Forbidden live registry mutation.'}
$script:journal=New-Object 'Collections.Generic.List[string]'
$script:ordinaryResets=0;$script:count=0
$previousStage=$env:EGOIST_PROTECTED_REINSTALL_STAGE
try {
  $env:EGOIST_PROTECTED_REINSTALL_STAGE=$script:stage
  $Phase='PreInstall';Reset-Stage
  Require (Test-VerifiedProtectedReinstall) 'Valid controlled protected stage was refused.'
  Require (Test-InstallMayStopOwnedRuntimes) 'Verified protected handoff was refused because critical loopback is active.'
  $script:count++
  foreach($change in @('boot','acl','birth','image','exit','marker','installer','handoff')){
    Reset-Stage
    switch($change){
      'boot' {$script:bootVerified=$false}
      'acl' {$script:unsafeAcl=$true}
      'birth' {$script:wrongBirth=$true}
      'image' {$script:wrongImage=$true}
      'exit' {$script:exited=$true}
      'marker' {Write-FixtureJson $script:marker @{schemaVersion=1;owner='Foreign';stage=$script:stage}}
      'installer' {$value=$script:state|ConvertTo-Json|ConvertFrom-Json;$value.sha256='0'*64;Write-FixtureJson (Join-Path $script:stage 'state.json') $value}
      'handoff' {$value=$script:state|ConvertTo-Json|ConvertFrom-Json;$value.handoffStarted=$false;Write-FixtureJson (Join-Path $script:stage 'state.json') $value}
    }
    Require (-not (Test-VerifiedProtectedReinstall)) ('Unverified protected '+$change+' passed.')
    $refused=$false;try{Reset-WindowsNetworkBaseline}catch{$refused=$_.Exception.Message -like 'PROTECTED_HANDOFF_UNVERIFIED:*'}
    Require ($refused -and $script:ordinaryResets -eq 0) ('Invalid '+$change+' reached network cleanup.')
    $script:count++
  }
  foreach($enabled in @($true,$false)){
    Reset-Stage;$script:dns='127.0.0.1|::1'
    $intent=Join-Path $root 'intent.json';$journalFile=Join-Path $root 'owned-dns.json'
    Write-FixtureJson $intent @{settings=@{systemDohEnabled=$enabled;systemDohUrl='https://private.example.invalid/dns-query/fixture-only'}}
    Write-FixtureJson $journalFile @{owner='EgoistShield';servers=@('127.0.0.1','::1')}
    $intentHash=Get-FileSha256 $intent;$journalHash=Get-FileSha256 $journalFile
    $Phase='PreInstall';& ([scriptblock]::Create($pre.Extent.Text.Substring(1,$pre.Extent.Text.Length-2)))
    $Phase='PostInstall';& ([scriptblock]::Create($post.Extent.Text.Substring(1,$post.Extent.Text.Length-2)))
    $Phase='RollbackUpgrade';Restore-SystemNetworkBaseline
    Require ($script:ordinaryResets -eq 0 -and $script:dns -eq '127.0.0.1|::1') 'Actual NSIS phase command tree reset private adapter DNS during protected handoff.'
    Require ((Get-FileSha256 $intent) -eq $intentHash -and (Get-FileSha256 $journalFile) -eq $journalHash) 'Protected phase destroyed selected private intent or DNS journal.'
    $script:count++
  }
  Reset-Stage;$Phase='PreInstall';$env:EGOIST_PROTECTED_REINSTALL_STAGE=''
  Require (-not (Test-VerifiedProtectedReinstall)) 'A missing stage authorized the protected path.'
  Reset-WindowsNetworkBaseline
  Require ($script:ordinaryResets -eq 3 -and $script:dns -eq '192.0.2.53') 'Ordinary deliberate baseline reset stopped functioning.'
  $script:count++
  $env:EGOIST_PROTECTED_REINSTALL_STAGE=$script:stage;$Phase='Uninstall';$script:bootVerified=$false
  Reset-WindowsNetworkBaseline
  Require ($script:ordinaryResets -eq 6) 'Explicit uninstall accidentally inherited a protected preservation bypass.'
  $script:count++
  Write-Output ('Protected private network integration: '+$script:count+' groups passed; actual PreInstall/PostInstall command trees and guarded cleanup functions; controlled boot/ACL/process/product boundaries; live service/network/registry mutations0')
} finally {$env:EGOIST_PROTECTED_REINSTALL_STAGE=$previousStage}
