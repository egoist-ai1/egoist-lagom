[CmdletBinding()]
param([Parameter(Mandatory)][string]$DnsSource,[Parameter(Mandatory)][string]$VpnSource,[Parameter(Mandatory)][string]$Output,[switch]$ExpectOriginal)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
# Import trusted built-ins before mocks; never dot-source a native acceptance entry point.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -ErrorAction Stop
function Read-ExactFunction([string]$Path,[string]$Name){
  $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($Path,[Text.Encoding]::UTF8),[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'Fixture source has parse errors.'}
  $found=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name},$true))
  if($found.Count -ne 1){throw 'Fixture function cardinality changed.'}
  return $found[0].Extent.Text
}
$dns=Read-ExactFunction $DnsSource 'Invoke-DnsElevatedGui'
$vpn=Read-ExactFunction $VpnSource 'Close-VpnElevatedGui'
$closeInvocation='    ([Windows.Automation.WindowPattern]$pattern).Close()'
$dnsStart=$dns.IndexOf('    $closeDiagnostics=[ordered]@{',[StringComparison]::Ordinal)
if($dnsStart -lt 0){$dnsStart=$dns.IndexOf($closeInvocation,[StringComparison]::Ordinal)}
if($dnsStart -lt 0 -or $dns.IndexOf($closeInvocation,[StringComparison]::Ordinal) -lt 0){throw 'Actual DNS close boundary was not found.'}
$hold='';if($dns.Contains('$heldGuiProcessHandle=$child.Handle')){$hold='$heldGuiProcessHandle=$child.Handle'}
# Only the UIAutomation type cast is replaced with the inert pattern adapter. The actual
# wait, exit-code gate, catch, closed flag, finally cleanup and error rethrow remain intact.
$dnsTail=$dns.Substring($dnsStart).Replace('([Windows.Automation.WindowPattern]$pattern).Close()','$pattern.Close()').Replace('$child.ExitCode','(Get-FixtureExitCode $child)').Replace('$child.HasExited','(Get-FixtureHasExited $child)')
$dnsBody='function Invoke-FixtureDns { param([string]$Operation) '+
  '$lease=$script:FixtureLease;$child=Get-FixtureProcess;$closed=$false;$operationError=$null;$cleanup=$null;$resetWaitFailed=$false;'+
  '$proof=$script:FixtureLease.Receipt;$identity=[ordered]@{processId=42};$pattern=$script:FixturePattern;'+$hold+';try{'+$dnsTail
Invoke-Expression $dnsBody
$vpnFactory='[Diagnostics.Process]::GetProcessById([int]$script:VpnGuiLease.Receipt.processId)'
if(($vpn.Split(@($vpnFactory),[StringSplitOptions]::None)).Count -ne 2){throw 'Actual VPN process acquisition boundary changed.'}
# This is the sole native process adapter replacement; all close-function consumers run unchanged.
Invoke-Expression ($vpn.Replace($vpnFactory,'(Get-FixtureProcess)').Replace('$child.ExitCode','(Get-FixtureExitCode $child)').Replace('$child.HasExited','(Get-FixtureHasExited $child)'))
function Get-FixtureProcess {return $script:FixtureProcess}
# Explicit property adapters faithfully propagate getter exceptions; PowerShell ScriptProperty
# adapters otherwise swallow a thrown getter and return null, which is not native .NET behavior.
function Get-FixtureExitCode($Process){if($script:Config.exitThrow){throw 'fixture-exit-code-failure'};return $Process.ExitCode}
function Get-FixtureHasExited($Process){if($script:Config.readbackThrow){throw 'fixture-readback-failure'};return $Process.HasExited}
function Invoke-VpnUiButton {param([string]$Name) if($Name -cne 'Закрыть приложение'){throw 'Unexpected UI adapter action.'};$script:FixturePattern.Close()}
function Assert-NativeNoGui {$script:NoGuiChecks++}
function Stop-ElevatedGuiLease {param($Lease)
  $script:Events.Add('cleanup')
  if($script:Config.cleanupThrow){throw 'fixture-cleanup-failure'}
  return [ordered]@{exitedNormally=$script:Config.cleanupNormal;exitCode=$script:Config.cleanupExit;cleanup=[ordered]@{noOrphans=$true;activeProcesses=0}}
}
function Save-FixtureReceipt($Receipt){
  $script:SaveCalls++
  if($script:Config.saveThrowAt -eq $script:SaveCalls){throw 'fixture-diagnostic-persistence-failure'}
  $script:Snapshots.Add(($Receipt | ConvertTo-Json -Depth 12 -Compress))
}
function Save-NativeReceipt {Save-FixtureReceipt $script:Receipt}
function Save-VpnReceipt {Save-FixtureReceipt $script:VpnReceipt}
function Add-VpnEvidence {param([string]$Name,$Observation) $script:VpnReceipt.checks.Add([ordered]@{name=$Name;evidence=$Observation});Save-VpnReceipt}
function Save-DnsFailedBaselineInventory {throw 'Reset inventory capture is outside this inert close boundary.'}
function Initialize-Fixture($Control){
  $script:Config=@{wait=$true;exit=0;closeThrow=$false;waitThrow=$false;exitThrow=$false;readbackThrow=$false;saveThrowAt=0;cleanupThrow=$false;cleanupNormal=$true;cleanupExit=0}
  foreach($k in $Control.Keys){$script:Config[$k]=$Control[$k]}
  $script:Events=[Collections.Generic.List[string]]::new();$script:Budgets=[Collections.Generic.List[int]]::new();$script:Snapshots=[Collections.Generic.List[string]]::new();$script:SaveCalls=0;$script:NoGuiChecks=0
  $script:DnsLastFailedBaselineObservation=$null
  $script:FixtureLease=[pscustomobject]@{Receipt=[ordered]@{processId=42;startTimeUtc='2026-10-05T00:00:00Z'}}
  $script:VpnGuiLease=$script:FixtureLease;$script:VpnGuiOperation='fixture';$script:Receipt=[ordered]@{gui=@()};$script:VpnReceipt=[ordered]@{gui=@();checks=[Collections.Generic.List[object]]::new()}
  $script:FixtureProcess=[pscustomobject]@{Id=42;Disposed=$false}
  $script:FixtureProcess | Add-Member ScriptProperty Handle {$script:Events.Add('hold');return [IntPtr]42}
  $script:FixtureProcess | Add-Member ScriptMethod WaitForExit {param([int]$Milliseconds) $script:Events.Add('wait');$script:Budgets.Add($Milliseconds);if($script:Config.waitThrow){throw 'fixture-wait-failure'};return [bool]$script:Config.wait}
  $script:FixtureProcess | Add-Member ScriptProperty ExitCode {$script:Events.Add('exit-code');if($script:Config.exitThrow){throw 'fixture-exit-code-failure'};return [int]$script:Config.exit}
  $script:FixtureProcess | Add-Member ScriptProperty HasExited {$script:Events.Add('readback');if($script:Config.readbackThrow){throw 'fixture-readback-failure'};return $true}
  $script:FixtureProcess | Add-Member ScriptProperty ExitTime {return [DateTime]::Parse('2026-10-05T00:00:01Z')}
  $script:FixtureProcess | Add-Member ScriptMethod Dispose {$this.Disposed=$true;$script:Events.Add('dispose')}
  $script:FixturePattern=[pscustomobject]@{}
  $script:FixturePattern | Add-Member ScriptMethod Close {$script:Events.Add('close');if($script:Config.closeThrow){throw 'fixture-close-failure'}}
}
$cases=[Collections.Generic.List[object]]::new()
function Run-Control([string]$Kind,[string]$Name,$Control,[bool]$ExpectedSuccess,[string]$ErrorMarker='',[switch]$RequireDiagnostic,[switch]$RequireHold){
  Initialize-Fixture $Control;$errorRecord=$null
  try{if($Kind -ceq 'dns'){Invoke-FixtureDns 'Apply'}else{Close-VpnElevatedGui}}catch{$errorRecord=$_}
  $success=$null -eq $errorRecord;$passed=$success -eq $ExpectedSuccess
  if($ErrorMarker){$passed=$passed -and $errorRecord -and $errorRecord.Exception.ToString().Contains($ErrorMarker)}
  if($script:Events.Contains('wait')){$passed=$passed -and $script:Budgets.Count -eq 1 -and $script:Budgets[0] -eq 30000}
  $passed=$passed -and $script:FixtureProcess.Disposed
  $receipt=if($Kind -ceq 'dns'){$script:Receipt}else{$script:VpnReceipt}
  $diagnostic=@($receipt.gui | Where-Object {$_.Contains('phase') -and $_.phase -ceq 'close-observation'})
  if($RequireHold){$passed=$passed -and $script:Events.IndexOf('hold') -ge 0 -and $script:Events.IndexOf('hold') -lt $script:Events.IndexOf('close')}
  if($RequireDiagnostic){
    $passed=$passed -and $diagnostic.Count -eq 1
    if($diagnostic.Count -eq 1){
      $diag=$diagnostic[0].closeDiagnostics
      $required=@('schemaVersion','processId','startTimeUtc','callerProcessHandleHeld','powershellVersion','runtimeVersion','closeRequestedAtUtc','closeReturnedAtUtc','closeElapsedMilliseconds','waitBudgetMilliseconds','waitStartedAtUtc','waitFinishedAtUtc','waitElapsedMilliseconds','waitReturned','exitCodeAtWait','hasExitedBeforeCleanup','exitCodeBeforeCleanup','processExitUtcBeforeCleanup','readbackErrorType','readbackHresult','readbackStartedAtUtc','readbackFinishedAtUtc')
      $passed=$passed -and $diag.Count -eq $required.Count -and $diag.waitBudgetMilliseconds -eq 30000 -and $diag.callerProcessHandleHeld
      foreach($key in $required){$passed=$passed -and $diag.Contains($key)}
      if(-not $Control.ContainsKey('closeThrow') -and -not $Control.ContainsKey('waitThrow')){$passed=$passed -and $diag.waitReturned -eq [bool]$script:Config.wait}
      if($script:Config.readbackThrow){$passed=$passed -and $null -ne $diag.readbackErrorType -and $null -ne $diag.readbackHresult}
      if($script:Config.wait -and -not $script:Config.exitThrow -and -not $script:Config.closeThrow -and -not $script:Config.waitThrow){$passed=$passed -and $diag.exitCodeAtWait -eq [int]$script:Config.exit}
      # The before-cleanup diagnostic must be persisted before the original cleanup call.
      if(-not $script:Config.closeThrow -and -not $script:Config.waitThrow -and -not $script:Config.exitThrow -and $script:Config.saveThrowAt -eq 0){
        $snap=@($script:Snapshots | ForEach-Object {$_ | ConvertFrom-Json} | ForEach-Object {$_.gui} | Where-Object {$_.PSObject.Properties['closeDiagnostics'] -and $null -ne $_.closeDiagnostics.waitFinishedAtUtc})
        $passed=$passed -and $snap.Count -ge 1
      }
    }
  }
  $gateErrors=@($receipt.gui | Where-Object {$_.Contains('normalExit') -and $_.normalExit})
  $failedAtClose=(-not $script:Config.wait) -or $script:Config.exit -ne 0 -or $script:Config.closeThrow -or $script:Config.waitThrow -or $script:Config.exitThrow
  if($failedAtClose){$passed=$passed -and $gateErrors.Count -eq 0 -and $script:NoGuiChecks -eq 0}
  $cases.Add([ordered]@{name=$Kind+':'+$Name;passed=[bool]$passed;accepted=$success;expectedAccepted=$ExpectedSuccess;errorClass=$(if($errorRecord){$errorRecord.Exception.GetType().Name}else{$null});waitBudgetMilliseconds=$(if($script:Budgets.Count){$script:Budgets[0]}else{$null});diagnosticRows=$diagnostic.Count})
}
foreach($kind in @('dns','vpn')){
  $gate=if($kind -ceq 'dns'){'DNS elevated GUI did not exit normally.'}else{'The actual normal GUI close did not terminate successfully.'}
  Run-Control $kind 'normal-exit-zero' @{} $true
  Run-Control $kind 'original-false-wait-late-cleanup-zero' @{wait=$false} $false $gate
  Run-Control $kind 'original-signaled-259-late-cleanup-zero' @{exit=259} $false $gate
  Run-Control $kind 'original-signaled-nonzero-late-cleanup-zero' @{exit=17} $false $gate
  Run-Control $kind 'original-close-exception' @{closeThrow=$true} $false 'fixture-close-failure'
  Run-Control $kind 'original-wait-exception' @{waitThrow=$true} $false 'fixture-wait-failure'
  Run-Control $kind 'original-exit-code-exception' @{exitThrow=$true} $false 'fixture-exit-code-failure'
  Run-Control $kind 'original-failure-retained-over-cleanup-failure' @{wait=$false;cleanupThrow=$true} $false $gate
  Run-Control $kind 'successful-boundary-failed-cleanup-stays-failed' @{cleanupNormal=$false} $false
  Run-Control $kind 'held-handle-before-original-close' @{} $true -RequireHold
  Run-Control $kind 'canonical-original-close-observation' @{} $true -RequireDiagnostic
  if(-not $ExpectOriginal){
    Run-Control $kind 'false-wait-diagnostic-save-before-fails' @{wait=$false;saveThrowAt=1} $false $gate -RequireDiagnostic
    Run-Control $kind 'false-wait-diagnostic-save-after-fails' @{wait=$false;saveThrowAt=2} $false $gate -RequireDiagnostic
    Run-Control $kind 'zero-diagnostic-save-before-fails' @{saveThrowAt=1} $true -RequireDiagnostic
    Run-Control $kind 'zero-diagnostic-save-after-fails' @{saveThrowAt=2} $true -RequireDiagnostic
    Run-Control $kind 'false-wait-readback-fails' @{wait=$false;readbackThrow=$true} $false $gate -RequireDiagnostic
    Run-Control $kind 'zero-readback-fails' @{readbackThrow=$true} $true -RequireDiagnostic
  }
}
$failed=@($cases | Where-Object {-not $_.passed});$result=[ordered]@{schemaVersion=1;kind='actual-native-gui-close-boundary-inert-regression';powershellVersion=$PSVersionTable.PSVersion.ToString();expectedOriginal=[bool]$ExpectOriginal;caseCount=$cases.Count;passedCaseCount=$cases.Count-$failed.Count;allPassed=($failed.Count -eq 0);cases=$cases;actualNativeProcessQueries=0;actualGuiCalls=0;networkCalls=0;serviceMutations=0;registryWrites=0;sourceWrites=0;limitations=@('Controlled process and close adapters prove caller gate/telemetry behavior, not a .NET or native GUI race.','No original Apply WaitForExit result or exit code was recorded by Source4d; native causality remains unknown.')}
[IO.File]::WriteAllText($Output,($result | ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
Write-Output ('inert-close-boundary '+$result.passedCaseCount+'/'+$result.caseCount)
if($failed.Count){exit 1}