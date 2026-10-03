param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$project=Split-Path -Parent $PSScriptRoot
$temporary=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\'
$testRoot=[IO.Path]::GetFullPath($TestDirectory)
if(-not $testRoot.StartsWith($temporary,[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $testRoot -PathType Container)){throw 'Use a task-owned temporary fixture.'}
function Require([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function Enter-DeferredReinstallRecoveryLease {
  $lease=New-Object psobject
  $lease|Add-Member ScriptMethod ReleaseMutex {}
  $lease|Add-Member ScriptMethod Dispose {}
  return $lease
}
function Get-InstallerServiceMaintenanceStatus {return 'owned'}
function Stop-OwnedServiceForInstall {param($Name)$script:events.Add('stop-core')}
function Stop-PreservedWrappersForRecovery {param($State)$script:events.Add('stop-wrappers')}
function Restore-PreservedState {
  param($State)
  $script:events.Add('restore-private-state')
  Copy-Item -LiteralPath $script:backupConfig -Destination $script:restoredConfig -Force
  Copy-Item -LiteralPath $script:backupIntent -Destination $script:restoredIntent -Force
}
function Reconcile-PreservedZapretProfile {param($State)}
function Restore-InstalledIdentity {param($State)}
function Test-PayloadRollbackPending {return $false}
function Restore-PreservedServiceStartModes {param($State)}
# Core configure is an inert native boundary in this recovery-ordering fixture.
function Refresh-OwnedCoreProtectedConfiguration {$script:events.Add('configure-core')}
function Start-PreservedServices {
  param($State)
  Require ((Get-FileHash -LiteralPath $script:backupConfig).Hash -eq (Get-FileHash -LiteralPath $script:restoredConfig).Hash) 'Services started before exact private configuration restoration.'
  Require ((Get-FileHash -LiteralPath $script:backupIntent).Hash -eq (Get-FileHash -LiteralPath $script:restoredIntent).Hash) 'Private activation intent was lost before service restart.'
  $script:events.Add('start-private-services')
}
function Test-LoopbackDnsReady {param($State)$script:events.Add('probe-private');return $script:ready}
function Test-OwnedSystemDohRecoveryRuntime {param($State,[switch]$PreservedRuntimeRecovery)return $script:localProof}
function Restore-CriticalAdapterDns {param($State)$script:adapterWrites++;$script:dns=@('127.0.0.1','::1');$script:events.Add('restore-owned-loopback')}
function Restore-CriticalOwnedDnsBaseline {param($State)$script:baselineWrites++;$script:dns=@('192.0.2.53');$script:events.Add('baseline-fallback')}
function Start-InstalledDesktop {throw 'A private DNS recovery fixture must not launch the GUI.'}
function Complete-InstallerServiceMaintenance {$script:completions++;$script:events.Add('complete')}
function Add-ReceiptEvent {param($Stage,$Status,$Message)$script:lastStatus=$Status;$script:lastMessage=$Message}
function Resume-OwnedGuiLoginStartup {throw 'An active recovery fixture must not resume closed maintenance.'}
function Set-DnsClientServerAddress {throw 'Forbidden native adapter mutation.'}
function Clear-DnsClientCache {throw 'Forbidden native DNS cache mutation.'}
function sc.exe {throw 'Forbidden native SCM mutation.'}
function reg.exe {throw 'Forbidden native registry mutation.'}

$sources=@('scripts\invoke-final-silent-reinstall.ps1')
$cases=0
foreach($relative in $sources){
  $source=Join-Path $project $relative
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
  Require ($errors.Count -eq 0) 'Production handoff did not parse in Windows PowerShell.'
  $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-Recovery'},$true)
  Require ($null -ne $fn) 'Missing production Invoke-Recovery.'
  . ([scriptblock]::Create($fn.Extent.Text))
  foreach($scenario in @('private-down-owned-dns','private-down-external-dns','private-down-local-restored','private-down-generation-unverified','private-ready','private-ready-local-unverified','private-ready-no-adapters-unverified','private-ready-no-adapters-verified')){
    $fixture=Join-Path $testRoot ([Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $fixture|Out-Null
    $script:backupConfig=Join-Path $fixture 'config-backup.json';$script:restoredConfig=Join-Path $fixture 'config.json'
    $script:backupIntent=Join-Path $fixture 'intent-backup.json';$script:restoredIntent=Join-Path $fixture 'intent.json'
    [IO.File]::WriteAllText($script:backupConfig,'{"dns":{"servers":["https://private.example.invalid:8443/dns-query/fixture-only"]},"inbounds":[{"listen":"127.0.0.1","port":53}]}')
    [IO.File]::WriteAllText($script:backupIntent,'{"systemDohEnabled":true,"systemDohUrl":"https://private.example.invalid:8443/dns-query/fixture-only"}')
    [IO.File]::WriteAllText($script:restoredConfig,'incomplete-new-config')
    [IO.File]::WriteAllText($script:restoredIntent,'incomplete-new-intent')
    $script:events=New-Object 'Collections.Generic.List[string]'
    $script:adapterWrites=0;$script:baselineWrites=0;$script:completions=0;$script:lastStatus='';$script:lastMessage=''
    $script:ready=$scenario -like 'private-ready*'
    $script:localProof=$scenario -in @('private-down-local-restored','private-down-external-dns','private-ready','private-ready-no-adapters-verified')
    $script:dns=if($scenario -eq 'private-down-external-dns'){@('198.51.100.53')}else{@('127.0.0.1','::1')}
    $beforeDns=$script:dns -join '|'
    $state=[pscustomobject]@{handoffStarted=$true;runAfter=$false;wrapperMigrationPending=$false;services=@([pscustomobject]@{name='EgoistShieldSystemDoH';wasRunning=$true});criticalDns=@([pscustomobject]@{interfaceGuid='00000000-0000-0000-0000-000000000015';servers=@('127.0.0.1','::1')})}
    if($scenario -like '*no-adapters*'){$state.criticalDns=@()}
    $outcome=Invoke-Recovery -State $state -Reason 'controlled interrupted upgrade'
    Require ($script:events.IndexOf('restore-private-state') -lt $script:events.IndexOf('start-private-services')) ('Private state was not restored before service restart: '+($script:events -join ',')+'; '+$script:lastMessage)
    Require ($script:baselineWrites -eq 0) 'Automatic installer recovery changed the operator to the recorded baseline DNS.'
    if($script:ready -and $script:localProof){
      Require ($outcome -eq $true -and $script:lastStatus -eq 'recovered' -and $script:completions -eq 1) 'Healthy private rollback did not become verified recovery.'
      $expectedWrites=if($state.criticalDns.Count -gt 0){1}else{0}
      Require ($script:adapterWrites -eq $expectedWrites -and ($script:dns -join '|') -eq '127.0.0.1|::1') 'Healthy recovery did not respect its owned adapter snapshots.'
    }elseif($script:localProof){
      Require ($outcome -eq $true -and $script:lastStatus -eq 'recovered' -and $script:completions -eq 1) 'Locally verified private restoration did not release maintenance for Core recovery.'
      Require ($script:adapterWrites -eq 0 -and ($script:dns -join '|') -eq $beforeDns) 'Degraded private restoration overwrote adapter DNS.'
    }else{
      Require ($outcome -eq $false -and $script:lastStatus -eq 'recovery-warning' -and $script:completions -eq 0) 'Unavailable private DoH incorrectly completed maintenance.'
      Require ($script:adapterWrites -eq 0 -and ($script:dns -join '|') -eq $beforeDns) 'Unavailable private DoH rewrote current or externally changed adapter DNS.'
      Require ($script:lastMessage -like '*dns-private-degraded*') 'Degraded private DNS was not clearly recorded.'
    }
    $cases++
  }
}
Write-Output ('Private DNS installer recovery checks: '+$cases+' passed; latest source handoff; native SCM/registry/network mutations0')
