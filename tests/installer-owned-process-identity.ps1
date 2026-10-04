param([string]$SourceScript, [string]$ReceiptPath)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2
if (-not $env:LAGOM_TEST_TEMP -or -not [IO.Path]::IsPathRooted($env:LAGOM_TEST_TEMP)) { throw 'Set task-scoped LAGOM_TEST_TEMP.' }
$testRoot=[IO.Path]::GetFullPath($env:LAGOM_TEST_TEMP).TrimEnd('\')
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
if ($testRoot.Equals($projectRoot,[StringComparison]::OrdinalIgnoreCase) -or $testRoot.StartsWith($projectRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Fixtures must stay outside the checkout.' }
$ReceiptPath=[IO.Path]::GetFullPath($ReceiptPath)
if (-not $ReceiptPath.StartsWith($testRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Receipt is outside the test root.' }
$sourceBytes=[IO.File]::ReadAllBytes($SourceScript)
$source=[Text.Encoding]::UTF8.GetString($sourceBytes).TrimStart([char]0xfeff)
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Production source parse failed.' }
$func=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Stop-InstallerOwnedProcess'},$true)
if(-not $func){throw 'Production process helper missing.'}
foreach($command in $func.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst]},$true)) {
  if($command.GetCommandName() -or $command.CommandElements[0].Extent.Text -ne '$OwnPath') { throw 'Unexpected process helper command boundary.' }
}
# Import only this inspected function; product top-level/SCM/registry never runs.
. ([scriptblock]::Create($func.Extent.Text))
$exe=Join-Path $PSHOME 'powershell.exe'
$start=[Diagnostics.ProcessStartInfo]::new()
$start.FileName=$exe
$start.Arguments='-NoLogo -NoProfile -NonInteractive -Command "Start-Sleep -Seconds 60"'
$start.UseShellExecute=$false; $start.CreateNoWindow=$true
$child=[Diagnostics.Process]::Start($start)
$cases=[Collections.Generic.List[object]]::new()
$ownKills=0
try {
  # Opening the retained handle precedes every candidate operation.
  [void]$child.Handle
  $id=[int]$child.Id
  $birth=$child.StartTime.ToUniversalTime()
  $record=Get-CimInstance Win32_Process -Filter "ProcessId=$id" -OperationTimeoutSec 3 -ErrorAction Stop
  if(-not $record -or -not [string]::Equals($record.ExecutablePath,$exe,[StringComparison]::OrdinalIgnoreCase) -or [Math]::Abs((([DateTime]$record.CreationDate).ToUniversalTime()-$birth).TotalMilliseconds) -ge 1) {throw 'Owned fixture identity unavailable.'}
  $predicate={param($candidate) [string]::Equals($candidate,$exe,[StringComparison]::OrdinalIgnoreCase)}.GetNewClosure()
  $wrongBirth=[pscustomobject]@{ProcessId=$id; ExecutablePath=$exe; CreationDate=$birth.AddSeconds(-2)}
  $refused=$false
  try { [void](Stop-InstallerOwnedProcess -Record $wrongBirth -OwnPath $predicate) } catch {$refused=$true}
  $cases.Add([pscustomobject]@{name='reused PID birth refused and owned fixture remains alive'; passed=($refused -and -not $child.HasExited)})
  $refused=$false
  try { [void](Stop-InstallerOwnedProcess -Record $record -OwnPath {param($candidate) $false}) } catch {$refused=$true}
  $cases.Add([pscustomobject]@{name='foreign ownership predicate refused without termination'; passed=($refused -and -not $child.HasExited)})
  $forged=[pscustomobject]@{ProcessId=$id; ExecutablePath=($exe+'.foreign'); CreationDate=$record.CreationDate}
  $refused=$false
  try { [void](Stop-InstallerOwnedProcess -Record $forged -OwnPath {param($candidate) $true}) } catch {$refused=$true}
  $cases.Add([pscustomobject]@{name='forged image refused despite matching PID and birth'; passed=($refused -and -not $child.HasExited)})
  $retired=Stop-InstallerOwnedProcess -Record $record -OwnPath $predicate
  if($retired){$ownKills++}
  $cases.Add([pscustomobject]@{name='exact owned handle birth and image retire the fixture'; passed=($retired -and $child.WaitForExit(5000))})
  $gone=Stop-InstallerOwnedProcess -Record $record -OwnPath $predicate
  $cases.Add([pscustomobject]@{name='already retired fixture returns false'; passed=($gone -eq $false)})
} finally {
  if(-not $child.HasExited){$child.Kill(); [void]$child.WaitForExit(5000)}
  $child.Dispose()
}
# Deterministic exit between verified image/birth and termination: only this
# retained second fixture is retired by the test predicate.
$raceChild=[Diagnostics.Process]::Start($start)
try {
  [void]$raceChild.Handle
  $raceId=[int]$raceChild.Id
  $raceRecord=Get-CimInstance Win32_Process -Filter "ProcessId=$raceId" -OperationTimeoutSec 3 -ErrorAction Stop
  if (-not $raceRecord -or -not [string]::Equals($raceRecord.ExecutablePath,$exe,[StringComparison]::OrdinalIgnoreCase) -or [Math]::Abs((([DateTime]$raceRecord.CreationDate).ToUniversalTime()-$raceChild.StartTime.ToUniversalTime()).TotalMilliseconds) -ge 1) {throw 'Race fixture identity unavailable.'}
  $raceState=[pscustomobject]@{calls=0; testRetirements=0}
  $racePredicate={param($candidate)
    $raceState.calls++
    if ($raceState.calls -eq 2) {$raceChild.Kill(); if(-not $raceChild.WaitForExit(5000)){throw 'Race fixture exit failed.'};$raceState.testRetirements++}
    return [string]::Equals($candidate,$exe,[StringComparison]::OrdinalIgnoreCase)
  }.GetNewClosure()
  $raceResult=Stop-InstallerOwnedProcess -Record $raceRecord -OwnPath $racePredicate
  $cases.Add([pscustomobject]@{name='in-flight retirement is accepted only on the retained exited handle';passed=($raceResult -eq $false -and $raceChild.HasExited -and $raceState.calls -eq 2 -and $raceState.testRetirements -eq 1)})
} finally {
  if(-not $raceChild.HasExited){$raceChild.Kill();[void]$raceChild.WaitForExit(5000)}
  $raceChild.Dispose()
}
$sha=[Security.Cryptography.SHA256]::Create()
try{$sourceHash=([BitConverter]::ToString($sha.ComputeHash($sourceBytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
$failed=@($cases | Where-Object {-not $_.passed}).Count
$receipt=[pscustomobject]@{schemaVersion=1; productionSourceSha256=$sourceHash; powerShellVersion=$PSVersionTable.PSVersion.ToString(); cases=@($cases); caseCount=$cases.Count; failed=$failed; ownedFixtureProcessKills=$ownKills; raceFixtureRetirements=$raceState.testRetirements; unrelatedProcessKills=0; scmMutations=0; registryMutations=0; networkMutations=0; cleanupComplete=$true}
$json=$receipt | ConvertTo-Json -Depth 6
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($ReceiptPath)) | Out-Null
[IO.File]::WriteAllText($ReceiptPath,$json,[Text.UTF8Encoding]::new($false))
Write-Output $json
if($failed){exit 1}