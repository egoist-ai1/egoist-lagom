param(
  [Parameter(Mandatory=$true)][string]$TestDirectory,
  [string]$SourcePath='',
  [switch]$ExpectBaselineFailure
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
function Require([bool]$Value,[string]$Message) { if(-not $Value){throw $Message} }
$root=[IO.Path]::GetFullPath($TestDirectory).TrimEnd('\')
Require ((Split-Path -Leaf $root) -like 'lagom-continuity-process-birth-*') 'Use a task-owned process-birth fixture directory.'
if(-not $SourcePath){$SourcePath=Join-Path (Split-Path -Parent $PSScriptRoot) 'src\installer\owned-cleanup.ps1'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($SourcePath,[ref]$tokens,[ref]$errors)
Require ($errors.Count -eq 0) 'Source failed native PowerShell parsing.'
$fn=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-ProtectedSystemDohPayloadProcess'},$true)
Require ([bool]$fn) 'Actual process-identity function missing.'
. ([scriptblock]::Create(("`r`n"*($fn.Extent.StartLineNumber-1))+$fn.Extent.Text))
$script:liveMutations=0
foreach($name in @('Start-Process','Stop-Process','Start-Service','Stop-Service','Set-Service','Get-Service','Set-DnsClientServerAddress','Resolve-DnsName','New-ItemProperty','Set-ItemProperty','Remove-ItemProperty','Register-ScheduledTask','Unregister-ScheduledTask','sc.exe','reg.exe','takeown.exe','netsh.exe')){
  Set-Item -Path ('Function:\'+$name) -Value ([scriptblock]::Create('$script:liveMutations++;throw ''Forbidden live boundary.'''))
}
# Both OS reads are explicitly confined to this newly started test process.
$held=Microsoft.PowerShell.Management\Get-Process -Id $PID -ErrorAction Stop
$row=CimCmdlets\Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId='+$PID) -Property ProcessId,ExecutablePath,CreationDate -OperationTimeoutSec 3 -ErrorAction Stop
$script:positive=0;$script:negative=0;$script:branches=0
function New-IdentityCase([int]$Index,[long]$Ticks,[string]$Image) {
  $ownId=12345;$otherId=12346
  $process=[pscustomobject]@{Id=$ownId;HasExited=$false;Handle=[IntPtr]1;StartTime=(New-Object DateTime($Ticks,[DateTimeKind]::Utc));MainModule=[pscustomobject]@{FileName=$Image}}
  $other=[pscustomobject]@{Id=$otherId;HasExited=$false;Handle=[IntPtr]1;StartTime=$process.StartTime;MainModule=[pscustomobject]@{FileName=$Image}}
  $wrapperId=if($Index -eq 0){$ownId}else{$otherId}
  $engineId=if($Index -eq 1){$ownId}else{$otherId}
  $processes=if($Index -eq 0){@($process,$other)}else{@($other,$process)}
  $proof=[pscustomobject]@{root=$root;wrapperPid=$wrapperId;enginePid=$engineId;wrapper=$Image;engine=$Image;wrapperStartTicks=[string]$Ticks;engineStartTicks=[string]$Ticks}
  $script:lease=[pscustomobject]@{proof=$proof;processes=$processes}
  $script:cim=[pscustomobject]@{ProcessId=$ownId;ExecutablePath=$Image;CreationDate=(New-Object DateTime(($Ticks-($Ticks%[long]10)),[DateTimeKind]::Utc))}
}
function Accept([string]$Name){
  Require (Test-ProtectedSystemDohPayloadProcess -Process $script:cim -Lease $script:lease) ('Rejected valid '+$Name)
  $script:positive++
}
function Reject([string]$Name,[int]$Index,[scriptblock]$Change){
  New-IdentityCase $Index ($script:bucket+[long]5) $script:image
  & $Change
  $rejected=$false
  try {[void](Test-ProtectedSystemDohPayloadProcess -Process $script:cim -Lease $script:lease)}
  catch {Require ($_.Exception.Message -eq 'Private DNS continuity process identity changed.') ('Unexpected rejection for '+$Name);$rejected=$true}
  Require $rejected ('Accepted invalid '+$Name)
  $script:negative++
}
try {
  Require ($held.Id -eq $PID -and $row.ProcessId -eq $PID -and -not $held.HasExited) 'Own real process identity changed.'
  Require ($held.Handle -ne [IntPtr]::Zero) 'Own native process handle is unavailable.'
  $nativeTicks=[long]$held.StartTime.ToUniversalTime().Ticks
  $cimTicks=[long]([DateTime]$row.CreationDate).ToUniversalTime().Ticks
  $delta=$nativeTicks-$cimTicks
  Require ([string]::Equals([string]$row.ExecutablePath,[string]$held.MainModule.FileName,[StringComparison]::OrdinalIgnoreCase)) 'Own real process images disagree.'
  Require ($delta -ge 0 -and $delta -le 9 -and $cimTicks%[long]10 -eq 0) 'Own OS timestamp representations are outside the microsecond contract.'
  if($nativeTicks%[long]10 -eq 0){
    Write-Output 'PRECISION_SAMPLE_ZERO: own native timestamp has no submicrosecond residue; retry an own host at most eight times.'
    exit 23
  }
  $realProof=[pscustomobject]@{root=$root;wrapperPid=$PID;enginePid=0;wrapper=$held.MainModule.FileName;engine='';wrapperStartTicks=[string]$nativeTicks;engineStartTicks=''}
  $realLease=[pscustomobject]@{proof=$realProof;processes=@($held,$null)}
  if($ExpectBaselineFailure){
    $red=$false
    try {[void](Test-ProtectedSystemDohPayloadProcess -Process $row -Lease $realLease)}
    catch {
      Require ($_.Exception.Message -eq 'Private DNS continuity process identity changed.' -and $_.InvocationInfo.ScriptLineNumber -eq 899) 'Baseline failed outside the proven line899 boundary.'
      $red=$true
    }
    Require $red 'Baseline unexpectedly accepted the real nonzero precision boundary.'
    Require ($script:liveMutations -eq 0) 'Baseline reached a live boundary.'
    Write-Output ('EXPECTED RED: actual own PID/image/handle match; native-CIM '+$delta+' ticks; exact production refusal line899; product queries 0; live mutations 0; native '+$PSVersionTable.PSVersion)
    exit 0
  }
  Require (Test-ProtectedSystemDohPayloadProcess -Process $row -Lease $realLease) 'Real own wrapper process was rejected.'
  $script:positive++
  $realProof.wrapperPid=0;$realProof.enginePid=$PID;$realProof.engine=$held.MainModule.FileName;$realProof.engineStartTicks=[string]$nativeTicks
  $realLease.processes=@($null,$held)
  Require (Test-ProtectedSystemDohPayloadProcess -Process $row -Lease $realLease) 'Real own engine process was rejected.'
  $script:positive++
  $script:image=Join-Path $root 'inert-process-image.exe'
  $script:bucket=[DateTime]::SpecifyKind([DateTime]'2026-01-01T00:00:00',[DateTimeKind]::Utc).Ticks
  foreach($index in @(0,1)){
    foreach($residue in 0..9){New-IdentityCase $index ($script:bucket+[long]$residue) $script:image;Accept ('index'+$index+' residue'+$residue)}
    Write-Output ('PASS all residues 0..9 index '+$index)
    foreach($shift in @(-10,10)){Reject ('adjacent microsecond '+$shift) $index {$script:cim.CreationDate=$script:cim.CreationDate.AddTicks($shift)}}
    Reject 'nonmicrosecond CIM' $index {$script:cim.CreationDate=$script:cim.CreationDate.AddTicks(1)}
    Reject 'held native birth plus one tick in same bucket' $index {$script:lease.processes[$index].StartTime=$script:lease.processes[$index].StartTime.AddTicks(1)}
    foreach($shift in @(-1,1)){
      Reject ('proof native tick shift '+$shift) $index {$field=if($index -eq 0){'wrapperStartTicks'}else{'engineStartTicks'};$script:lease.proof.$field=[string]($script:bucket+5+$shift)}
    }
    Reject 'proof leading zero' $index {$field=if($index -eq 0){'wrapperStartTicks'}else{'engineStartTicks'};$script:lease.proof.$field='0'+$script:lease.proof.$field}
    Reject 'proof missing birth' $index {$field=if($index -eq 0){'wrapperStartTicks'}else{'engineStartTicks'};$script:lease.proof.$field=$null}
    Reject 'held PID reuse' $index {$script:lease.processes[$index].Id++}
    Reject 'held exited' $index {$script:lease.processes[$index].HasExited=$true}
    Reject 'held zero handle' $index {$script:lease.processes[$index].Handle=[IntPtr]::Zero}
    Reject 'held foreign image same basename' $index {$script:lease.processes[$index].MainModule.FileName=Join-Path (Join-Path $root 'foreign') (Split-Path -Leaf $script:image)}
    Reject 'held missing process' $index {$script:lease.processes[$index]=$null}
    Reject 'CIM foreign image same basename' $index {$script:cim.ExecutablePath=Join-Path (Join-Path $root 'foreign') (Split-Path -Leaf $script:image)}
    Reject 'CIM missing image' $index {$script:cim.ExecutablePath=$null}
    Reject 'CIM missing creation date' $index {$script:cim.CreationDate=$null}
    Write-Output ('PASS sixteen exact identity refusals index '+$index)
  }
  New-IdentityCase 0 ($script:bucket+5) $script:image
  $script:cim.ExecutablePath=$script:image.ToUpperInvariant();$script:lease.processes[0].MainModule.FileName=$script:image.ToUpperInvariant();Accept 'full image path case'
  Require (-not (Test-ProtectedSystemDohPayloadProcess -Process $script:cim -Lease $null)) 'Null lease branch changed.';$script:branches++
  $script:cim.ProcessId=99999;$script:cim.ExecutablePath=Join-Path (Split-Path -Parent $root) 'outside-inert.exe'
  Require (-not (Test-ProtectedSystemDohPayloadProcess -Process $script:cim -Lease $script:lease)) 'Unrelated outside process branch changed.';$script:branches++
  $script:cim.ExecutablePath=$null
  Require (-not (Test-ProtectedSystemDohPayloadProcess -Process $script:cim -Lease $script:lease)) 'Unrelated missing-image branch changed.';$script:branches++
  $script:cim.ExecutablePath=$script:image
  $extraRejected=$false
  try {[void](Test-ProtectedSystemDohPayloadProcess -Process $script:cim -Lease $script:lease)}
  catch {Require ($_.Exception.Message -eq 'An extra process in the private DNS generation prevents cleanup.') 'Extra generation process failed for wrong reason.';$extraRejected=$true}
  Require $extraRejected 'Extra generation process was accepted.';$script:negative++
  Require ($script:liveMutations -eq 0) 'Fixture reached a live boundary.'
  Write-Output ('Installer continuity process birth: '+$script:positive+' positives, '+$script:negative+' negatives, '+$script:branches+' unchanged false branches passed; actual own native handle and CIM row; native-CIM '+$delta+' ticks; exact held100ns authority; product queries 0; live mutations 0; native '+$PSVersionTable.PSVersion)
} finally {$held.Dispose()}
