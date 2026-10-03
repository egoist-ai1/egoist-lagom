param([Parameter(Mandatory=$true)][string]$TestDirectory,[string]$CleanupScript,[switch]$RedBaseline)
$ErrorActionPreference='Stop';Set-StrictMode -Version 2.0
$project=Split-Path -Parent $PSScriptRoot
if(-not $CleanupScript){$CleanupScript=Join-Path $project 'src\installer\owned-cleanup.ps1'}
$root=[IO.Path]::GetFullPath($TestDirectory).TrimEnd('\')
if(-not (Split-Path -Leaf $root).StartsWith('lagom-transaction-')){throw 'Dedicated own transaction fixture required.'}
[void][IO.Directory]::CreateDirectory($root)
$sourceBefore=(Get-FileHash -LiteralPath $CleanupScript -Algorithm SHA256).Hash.ToLowerInvariant()
$shared=Join-Path $project 'src\installer\service-maintenance.ps1';$boot=Join-Path $project 'src\installer\maintenance-boot-recovery.ps1';$workerSource=Join-Path $project 'scripts\invoke-final-silent-reinstall.ps1'
function Find-Function([string]$Path,[string]$Name){$t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$t,[ref]$e);if($e.Count){throw 'Source parser failure.'};$f=$a.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $Name},$true);if(-not $f){throw ('Missing actual AST: '+$Name)};return $f}
function Check([bool]$Value,[string]$Reason){if(-not $Value){throw $Reason};[void]($script:checks++)}
$script:checks=0;$script:positive=0;$script:negative=0;$script:refusals=0
$sharedBodies=@{}
foreach($name in @('ConvertTo-InstallerDiagnosticMessage','New-InstallerFailureDiagnostic','Read-InstallerFailureDiagnostic')){$f=Find-Function $shared $name;$sharedBodies[$name]=$f.Extent.Text;. ([scriptblock]::Create($f.Extent.Text))}
foreach($name in @('Write-Journal','Write-InstallerPhaseFailure','Assert-ProtectedSystemDohPayloadLease')){$f=Find-Function $CleanupScript $name;. ([scriptblock]::Create(("`r`n"*($f.Extent.StartLineNumber-1))+$f.Extent.Text))}
$Phase='PreInstall';$installRoot=$root;$upgradeStateDirectory=Join-Path $root 'journal';$upgradeJournalPath=Join-Path $upgradeStateDirectory 'events.jsonl'
$fixedReason='Private DNS continuity transaction lease changed.'
if($RedBaseline){
  $failure=$null;try{Assert-ProtectedSystemDohPayloadLease -Lease $null}catch{$failure=$_}
  Check ([bool]$failure) 'Legacy actual null-lease refusal did not throw.'
  Check (-not $failure.Exception.Data.Contains('InstallerFailureDiagnostic')) 'Legacy unexpectedly contained structured diagnostics.'
  Write-InstallerPhaseFailure -Failure $failure -ExitCode 1
  $old=@(Get-Content -LiteralPath $upgradeJournalPath -Encoding UTF8|ForEach-Object {$_|ConvertFrom-Json})[-1]
  Check ($old.substage -eq 'phase-dispatch') 'Legacy generic phase substage changed.'
  Write-Output ('RED actual legacy refusal: no Exception.Data diagnostic; phase substage phase-dispatch; native '+$PSVersionTable.PSVersion)
  exit 24
}
$names=@('Initialize-ProtectedInstallerHeartbeatNative','Assert-ProtectedInstallerHeartbeatSecurity','Open-ProtectedInstallerHeartbeatFile','Close-ProtectedInstallerHeartbeatSnapshot','Open-ProtectedInstallerHeartbeatSnapshot','Read-ProtectedInstallerHeartbeatSnapshot','Set-ProtectedReinstallFailureDiagnostic','Throw-ProtectedSystemDohTransactionRefusal','Test-VerifiedProtectedReinstall','Get-ProtectedSystemDohPayloadContinuity','Get-FileSha256')
foreach($name in $names){$f=Find-Function $CleanupScript $name;. ([scriptblock]::Create(("`r`n"*($f.Extent.StartLineNumber-1))+$f.Extent.Text))}
foreach($name in @('Assert-InstallerBootRecoveryPlainPath','Assert-InstallerBootRecoveryFileProtection')){$f=Find-Function $boot $name;. ([scriptblock]::Create($f.Extent.Text))}
foreach($name in @('New-InstallerProtectedFileSecurity','Write-JsonAtomic','Write-Heartbeat')){$f=Find-Function $workerSource $name;. ([scriptblock]::Create($f.Extent.Text))}
function New-OwnSecurity([switch]$Directory){
  $s=if($Directory){New-Object Security.AccessControl.DirectorySecurity}else{New-Object Security.AccessControl.FileSecurity}
  $own=[Security.Principal.WindowsIdentity]::GetCurrent().User;$s.SetOwner($own);$s.SetAccessRuleProtection($true,$false)
  foreach($value in @($own.Value,'S-1-5-18','S-1-5-32-544')){$rule=New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($value)),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow);$s.AddAccessRule($rule)}
  return $s
}
# Controlled own-user ACL authority; original ACL predicates and real held native reads remain.
$ownPolicy=(Find-Function $CleanupScript 'Assert-ProtectedInstallerHeartbeatSecurity').Extent.Text.Replace("`$trusted = @('S-1-5-18','S-1-5-32-544')","`$trusted = @('S-1-5-18','S-1-5-32-544',[Security.Principal.WindowsIdentity]::GetCurrent().User.Value)")
. ([scriptblock]::Create($ownPolicy))
function New-InstallerProtectedFileSecurity {return New-OwnSecurity}
function Assert-InstallerBootRecoveryFileProtection {param([string]$Path,[switch]$Directory);if(-not [IO.Path]::GetFullPath($Path).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Protection escaped own fixture.'};Assert-ProtectedInstallerHeartbeatSecurity -Acl (Get-Acl -LiteralPath $Path) -Directory:$Directory}
$stage=Join-Path $root 'stage';[void][IO.Directory]::CreateDirectory($stage);[IO.Directory]::SetAccessControl($stage,(New-OwnSecurity -Directory))
$script:bootBad=$false;$script:bootError='';$script:wrongImage=$false
function Assert-InstallerMaintenanceBootRecovery {param([string]$StageDirectory);if($script:bootError){throw [IO.IOException]::new($script:bootError)};if($StageDirectory -cne $stage){throw 'Controlled task prerequisite escaped own stage.'};return [pscustomobject]@{verified=(-not $script:bootBad);owner='EgoistShield';schemaVersion=1;stage=$stage}}
function Get-InstallerBootRecoveryContext {param([string]$StageDirectory,[switch]$AllowLegacyInventory);return [pscustomobject]@{maintenanceMarker=(Join-Path $root 'marker.json');powerShell=$(if($script:wrongImage){Join-Path $root 'foreign.exe'}else{Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'})}}
function Write-OwnJson([string]$Path,[object]$Object){[IO.File]::WriteAllText($Path,($Object|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)));[IO.File]::SetAccessControl($Path,(New-OwnSecurity))}
$installer=Join-Path $stage 'inert.bin';[IO.File]::WriteAllBytes($installer,[byte[]](1..32));[IO.File]::SetAccessControl($installer,(New-OwnSecurity))
$statePath=Join-Path $stage 'state.json';$marker=Join-Path $root 'marker.json';$heartbeat=Join-Path $stage 'heartbeat.json'
Write-OwnJson $statePath ([ordered]@{owner='EgoistShield';schemaVersion=1;handoffStarted=$true;installer=$installer;sha256=(Get-FileSha256 $installer);receiptBase=$root})
Write-OwnJson (Join-Path $stage 'backup-ready.flag') ([ordered]@{ready=$true})
Write-OwnJson $marker ([ordered]@{owner='EgoistShield';schemaVersion=1;stage=$stage})
Write-Heartbeat -Stage $stage -Phase 'own-fixture'
$stateBytes=[IO.File]::ReadAllText($statePath);$markerBytes=[IO.File]::ReadAllText($marker);$heartBytes=[IO.File]::ReadAllText($heartbeat)
$oldStage=$env:EGOIST_PROTECTED_REINSTALL_STAGE;$oldTemp=$env:TEMP;$oldTmp=$env:TMP
$compiler=Join-Path $root 'compiler';[void][IO.Directory]::CreateDirectory($compiler);$env:TEMP=$compiler;$env:TMP=$compiler
function Boolean-Result([bool]$Expected){$values=@(Test-VerifiedProtectedReinstall);Check ($values.Count -eq 1 -and $values[0] -is [bool]) 'Verifier success stream is not exactly one Boolean.';Check ($values[0] -eq $Expected) 'Actual verifier Boolean guard changed.';if($Expected){[void]($script:positive++)}else{[void]($script:negative++)}}
function Refusal-Record([object]$Lease,[string]$Substage,[switch]$NoData){
  $caught=$null;try{Assert-ProtectedSystemDohPayloadLease -Lease $Lease}catch{$caught=$_}
  Check ([bool]$caught) 'Actual lease refusal did not throw.';Check ($caught.Exception -is [InvalidOperationException]) 'Refusal exception type changed.';Check ($caught.Exception.Message -ceq $fixedReason) 'Fixed refusal reason changed.'
  if(-not $NoData){Check ($caught.Exception.Data.Contains('InstallerFailureDiagnostic')) 'Structured diagnostic was not attached to actual Exception.Data.';$dto=Read-InstallerFailureDiagnostic ([string]$caught.Exception.Data['InstallerFailureDiagnostic']);Check ([bool]$dto -and $dto.substage -ceq $Substage) 'Attached diagnostic substage changed.'}
  $rowsBefore=if(Test-Path -LiteralPath $upgradeJournalPath){@(Get-Content -LiteralPath $upgradeJournalPath -Encoding UTF8).Count}else{0}
  Write-InstallerPhaseFailure -Failure $caught -ExitCode 1
  $rows=@(Get-Content -LiteralPath $upgradeJournalPath -Encoding UTF8|ForEach-Object {$_|ConvertFrom-Json})
  Check ($rows.Count -eq $rowsBefore+1) 'Actual phase writer did not append exactly one new journal record.'
  $record=$rows[-1]
  Check ($record.stage -eq 'phase-failed' -and $record.exitCode -eq 1) 'Actual phase writer did not append local failure record.'
  if(-not $NoData){Check ($record.substage -ceq $Substage) 'Nested diagnostic did not propagate into actual journal.'}
  [void]($script:refusals++);return $record
}
try{
  $env:EGOIST_PROTECTED_REINSTALL_STAGE=$stage
  $init=@(Initialize-ProtectedInstallerHeartbeatNative);Check ($init.Count -eq 0) 'Compiled initializer polluted success output.'
  $type='LagomInstallerHeartbeatSnapshotNative' -as [type];Check ([bool]$type) 'Actual native initializer did not compile.'
  Check ($type.GetMethod('ReadAcl').ReturnType -eq [Security.AccessControl.FileSecurity]) 'Native ACL return contract changed.'
  $initializer=(Find-Function $CleanupScript 'Initialize-ProtectedInstallerHeartbeatNative').Extent.Text
  $parity=Join-Path $project 'docs\dns-repeat-1702-2026-10-02\installer-refresh\protected-transaction-auth-race\v3.2-runner\heartbeat-native-v3.cs'
  if(Test-Path -LiteralPath $parity){
    function Acl-Method([string]$Text){$start=$Text.IndexOf('public static System.Security.AccessControl.FileSecurity ReadAcl(');Check ($start -ge 0) 'ReadAcl parity method missing.';$open=$Text.IndexOf('{',$start);$depth=1;$end=$open+1;while($depth -gt 0){if($Text[$end] -eq '{'){$depth++};if($Text[$end] -eq '}'){$depth--};$end++};return (($Text.Substring($start,$end-$start).Replace('Protected ','Own ')) -replace '\s+','')}
    Check ((Acl-Method $initializer) -ceq (Acl-Method ([IO.File]::ReadAllText($parity)))) 'Native ReadAcl differs from the tested frozen method.'
  }
  $leases=@(Open-ProtectedInstallerHeartbeatSnapshot -Stage $stage);Check ($leases.Count -eq 1) 'Native reader returned a polluted lease stream.'
  try{$words=@(Read-ProtectedInstallerHeartbeatSnapshot -Lease $leases[0]);Check ($words.Count -eq 1 -and $words[0] -is [string]) 'Snapshot read shape changed.';Check (($words[0]|ConvertFrom-Json).workerPid -eq $PID) 'Snapshot did not use actual own native process metadata.'}
  finally{Check (@(Close-ProtectedInstallerHeartbeatSnapshot -Lease $leases[0]).Count -eq 0) 'Snapshot close polluted success output.'}
  Boolean-Result $true
  $null=Refusal-Record $null 'continuity-lease-missing'
  $null=Refusal-Record ([pscustomobject]@{stage=($stage+'-other')}) 'continuity-stage-mismatch'
  foreach($case in @('boot','state','marker','birth','image','json')){
    try{
      switch($case){
        'boot'{$script:bootBad=$true;$sub='boot-recovery-identity'}
        'state'{$v=$stateBytes|ConvertFrom-Json;$v.owner='fixture-foreign';Write-OwnJson $statePath $v;$sub='protected-state-installer-binding'}
        'marker'{$v=$markerBytes|ConvertFrom-Json;$v.owner='fixture-foreign';Write-OwnJson $marker $v;$sub='maintenance-marker-identity'}
        'birth'{$v=$heartBytes|ConvertFrom-Json;$v.workerStartTicks=[long]$v.workerStartTicks+1;Write-OwnJson $heartbeat $v;$sub='heartbeat-worker-identity'}
        'image'{$script:wrongImage=$true;$sub='heartbeat-worker-identity'}
        'json'{[IO.File]::WriteAllText($heartbeat,'{');$sub='heartbeat-read'}
      }
      Boolean-Result $false;$null=Refusal-Record ([pscustomobject]@{stage=$stage}) $sub
    }finally{$script:bootBad=$false;$script:wrongImage=$false;[IO.File]::WriteAllText($statePath,$stateBytes);[IO.File]::WriteAllText($marker,$markerBytes);[IO.File]::WriteAllText($heartbeat,$heartBytes)}
    Boolean-Result $true;Check ($null -eq $script:protectedReinstallFailureDiagnostic) 'Positive verifier left stale refusal diagnostic.'
  }
  $script:bootError='проверка https:\/\/fixture.invalid/fixture-secret Authorization: Custom fixture-secret {"argv":["--token","fixture-secret"]}'
  Boolean-Result $false;$privacy=Refusal-Record ([pscustomobject]@{stage=$stage}) 'boot-recovery-auth'
  $direct=$null;try{Get-ProtectedSystemDohPayloadContinuity}catch{$direct=$_}
  Check ([bool]$direct -and $direct.Exception.Message -ceq 'Private DNS continuity stage is unverified.') 'Direct continuity getter did not retain refusal.'
  $beforeRows=@(Get-Content -LiteralPath $upgradeJournalPath -Encoding UTF8).Count
  Write-InstallerPhaseFailure -Failure $direct -ExitCode 43
  $directRows=@(Get-Content -LiteralPath $upgradeJournalPath -Encoding UTF8 | ForEach-Object {$_|ConvertFrom-Json})
  Check ($directRows.Count -eq $beforeRows+1 -and $directRows[-1].exitCode -eq 43 -and $directRows[-1].substage -ceq 'boot-recovery-auth') 'Actual getter swallowed authorization diagnostic before phase43.'
  Check (-not ($directRows[-1]|ConvertTo-Json -Compress).Contains('fixture-secret')) 'Direct getter phase leaked private canary.'
  Check ($privacy.errorMessage.Contains('проверка')) 'Nonsensitive Cyrillic diagnostic marker was lost.'
  Check (-not ($privacy|ConvertTo-Json -Compress).Contains('fixture-secret')) 'Secret canary escaped the actual Exception.Data/journal sanitizer.'
  $script:bootError=''
  foreach($fault in @('New-InstallerFailureDiagnostic','Read-InstallerFailureDiagnostic')){
    try{
      . ([scriptblock]::Create('function '+$fault+' {throw ''controlled formatter failure''}'))
      $script:bootError='controlled diagnostic failure';Boolean-Result $false
      $script:bootError='';$null=Refusal-Record $null '' -NoData
    }finally{$script:bootError='';. ([scriptblock]::Create($sharedBodies[$fault]))}
    Boolean-Result $true
  }
  Check ((Get-FileHash -LiteralPath $CleanupScript -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $sourceBefore) 'Production source changed during fixture.'
  Write-Output ('Installer protected transaction diagnostics: '+$script:positive+' positives, '+$script:negative+' negatives, '+$script:refusals+' actual nested journal refusals; '+$script:checks+' checks passed')
  Write-Output ('actual Native5 compiled initializer/ReadAcl; strict Boolean singleton; controlled boot/task and own-user ACL authority; actual own PID/birth/image; product operations 0; native '+$PSVersionTable.PSVersion)
}finally{$env:EGOIST_PROTECTED_REINSTALL_STAGE=$oldStage;$env:TEMP=$oldTemp;$env:TMP=$oldTmp}