param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$root=[IO.Path]::GetFullPath($TestDirectory)
if (-not $root.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Use task-owned temporary files.' }
$source=Join-Path (Split-Path -Parent $PSScriptRoot) 'src\installer\owned-cleanup.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Production cleanup did not parse.' }
$name='Local\LagomUninstallMaintenanceFixture.'+[Guid]::NewGuid().ToString('N')
$fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Enter-UninstallMaintenanceLease'},$true)
. ([scriptblock]::Create($fn.Extent.Text.Replace('Global\EgoistShield.DeferredReinstall',$name)))
$switch=$ast.Find({param($n)$n -is [Management.Automation.Language.SwitchStatementAst] -and $n.Condition.Extent.Text -eq '$Phase'},$true)
$clause=@($switch.Clauses | Where-Object {$_.Item1.Value -eq 'Uninstall'})[0].Item2.Extent.Text
$clause=$clause.Substring(1,$clause.Length-2)
# Only the process exit boundary is replaced; the actual production clause,
# terminating guard and mutation ordering run with harmless leaf counters.
$body=[scriptblock]::Create(($clause -replace 'exit 59','throw "Fixture uninstall refusal 59"'))
$script:serviceBackupManifestPath=Join-Path $root 'service-backup\manifest.json'
function Get-InstallerBootRecoveryCommonDataRoot { return $root }
function Require([bool]$Value,[string]$Message) { if (-not $Value) { throw $Message } }
$script:leaves=New-Object 'Collections.Generic.List[string]'
foreach ($leaf in @('Stop-AllOwnedRuntimes','Invoke-CoreServiceOfflineRecovery','Invoke-CoreNativeDohCleanup','Invoke-CoreOwnedDnsCleanup','Unload-OwnedWinDivertDriver','Stop-OwnedService','Remove-OrphanedOwnedServices','Reset-WindowsNetworkBaseline','Remove-OwnedFirewallRules','Discard-OwnedNetworkArtifacts','Remove-OwnedStartupArtifacts','Remove-OwnedShortcuts','Remove-OwnedRuntimeDirectories')) {
  . ([scriptblock]::Create(('function '+$leaf+' { $script:leaves.Add("'+$leaf+'") }')))
}
$ownedServices=@('EgoistShieldCore')
function Refused-Uninstall {
  $script:leaves.Clear();$message=$null
  try { & $body 2>$null } catch { $message=$_.Exception.Message }
  Require ($message -eq 'Fixture uninstall refusal 59') 'Actual Uninstall clause did not explicitly terminate its refusal.'
  Require ($script:leaves.Count -eq 0) 'Uninstall mutated runtime/services before the maintenance refusal.'
}
$marker=Join-Path $root 'EgoistShield\installer\service-maintenance.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $marker) -Force | Out-Null
[IO.File]::WriteAllText($marker,'{"owner":"EgoistShield","schemaVersion":1}')
Refused-Uninstall
Remove-Item -LiteralPath $marker -Force
Write-Output 'PASS: actual uninstall clause refuses pending boot recovery before every destructive leaf'
New-Item -ItemType Directory -Path (Split-Path -Parent $serviceBackupManifestPath) -Force | Out-Null
[IO.File]::WriteAllText($serviceBackupManifestPath,'[]')
Refused-Uninstall
Remove-Item -LiteralPath $serviceBackupManifestPath -Force
Write-Output 'PASS: interrupted service-policy backup also prevents uninstall resurrection'
Add-Type -TypeDefinition @'
using System;
using System.Threading;
public sealed class UninstallMutexHolder : IDisposable {
 private ManualResetEventSlim ready=new ManualResetEventSlim(false);
 private ManualResetEventSlim release=new ManualResetEventSlim(false);
 private Thread thread;
 public UninstallMutexHolder(string name) {
  thread=new Thread(()=>{using(var mutex=new Mutex(false,name)){mutex.WaitOne();ready.Set();release.Wait();mutex.ReleaseMutex();}});
  thread.IsBackground=true;thread.Start();if(!ready.Wait(5000))throw new Exception("Fixture holder timed out.");
 }
 public void Dispose(){release.Set();if(!thread.Join(5000))throw new Exception("Fixture holder did not exit.");ready.Dispose();release.Dispose();}
}
'@
$holder=New-Object UninstallMutexHolder($name)
try { Refused-Uninstall } finally { $holder.Dispose() }
Write-Output 'PASS: actual isolated mutex contention blocks uninstall without service or task changes'
$script:leaves.Clear(); & $body
Require ($script:leaves.Count -eq 13 -and $script:leaves[0] -eq 'Stop-AllOwnedRuntimes' -and $script:leaves[-1] -eq 'Remove-OwnedRuntimeDirectories') 'Ordinary uninstall lost its established cleanup ordering.'
$lease=Enter-UninstallMaintenanceLease;$lease.ReleaseMutex();$lease.Dispose()
Write-Output 'PASS: uncontended uninstall runs existing harmless leaves and releases its shared lease'
Write-Output 'Installer uninstall maintenance: 4 groups passed; real owned files/mutex; live SCM/registry/DNS/tasks/process kills 0; mutation leaves and process exit are explicit fixtures.'
