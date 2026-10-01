param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$root=[IO.Path]::GetFullPath($TestDirectory)
if (-not $root.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Use task-owned temporary files.' }
$source=Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\invoke-final-silent-reinstall.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Production source does not parse in WinPS5.1.' }
$mutexName='Local\LagomRecoveryTimeoutFixture.'+[Guid]::NewGuid().ToString('N')
foreach ($name in @('Invoke-Recovery','Invoke-WatchdogMode','Get-InstallerWatchdogWaitMilliseconds','Invoke-InstallerRecoveryAttempts','Write-PendingInstallerRecovery','Stop-VerifiedInstallerTransactionProcess','Assert-InstallerNotCancelled','Test-InstallerTransactionComplete','New-InstallerProtectedFileSecurity','Write-JsonAtomic','ConvertTo-InstallerWindowsArgument','Enter-DeferredReinstallRecoveryLease')) {
  $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if (-not $fn) { throw "Missing production function $name." }
  . ([scriptblock]::Create($fn.Extent.Text.Replace('Global\EgoistShield.DeferredReinstall',$mutexName)))
}
function Require([bool]$Value,[string]$Message) { if (-not $Value) { throw $Message } }
function Expect-Refused([scriptblock]$Action,[string]$Pattern) {
  $reason=$null;try { & $Action } catch { $reason=$_.Exception.Message }
  Require ($reason -and $reason -like $Pattern) ("Expected refusal $Pattern; actual $reason")
}
$productionSecurity=(Get-Command New-InstallerProtectedFileSecurity -CommandType Function).ScriptBlock
$security=& $productionSecurity
Require ($security.AreAccessRulesProtected -and $security.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-32-544') 'Production file security lacks protected Administrators ownership.'
$allowed=@($security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object {$_.IdentityReference.Value})
Require ($allowed.Count -eq 2 -and $allowed -contains 'S-1-5-18' -and $allowed -contains 'S-1-5-32-544') 'Production file security grants an untrusted identity.'
Write-Output 'PASS: production file ACL object uses protected SYSTEM and Administrators grants and owner'
function New-InstallerProtectedFileSecurity {
  # The limited test token cannot assign BA ownership on disk. The production
  # ACL object above is checked unchanged; actual file I/O below uses this SID.
  $security=New-Object Security.AccessControl.FileSecurity
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $security.SetOwner($identity);$security.SetAccessRuleProtection($true,$false)
  $security.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')))
  return $security
}
function Invoke-InstallerSc { throw 'Forbidden host SCM mutation.' }
function sc.exe { throw 'Forbidden host SCM mutation.' }
function reg.exe { throw 'Forbidden host registry mutation.' }
function Start-Service { throw 'Forbidden host service start.' }
function Stop-Service { throw 'Forbidden host service stop.' }
function Set-DnsClientServerAddress { throw 'Forbidden host DNS mutation.' }
function Stop-Process { throw 'Forbidden PID-only termination.' }
function Add-ReceiptEvent {param($Stage,$Status,$Message,$Data) $script:statuses.Add([string]$Status)}
function Test-InstallerServiceMaintenanceOwner { return Test-Path -LiteralPath (Join-Path $StageDirectory 'maintenance-marker.json') -PathType Leaf }
function Get-InstallerServiceMaintenanceStatus { if (Test-InstallerServiceMaintenanceOwner) { return 'owned' };return 'absent' }
function Complete-InstallerServiceMaintenance { Remove-Item -LiteralPath (Join-Path $StageDirectory 'maintenance-marker.json') -Force -ErrorAction Stop }
function Assert-InstallerMaintenanceBootRecovery {param($StageDirectory) $script:bootAssertions++}
function Unregister-InstallerMaintenanceBootRecovery {param($StageDirectory,$RestorationVerified) Require ($RestorationVerified -and -not (Test-InstallerServiceMaintenanceOwner)) 'Boot recovery retired before restoration.'; $script:retirements++}
function Get-ValidatedMaintenanceRecoveryState {param($Stage) return Get-Content -LiteralPath (Join-Path $Stage 'state.json') -Raw | ConvertFrom-Json}
function Stop-OwnedServiceForInstall {param($Name) $script:recoveryAttempts++; if ($script:failUntil -ge $script:recoveryAttempts) { throw 'Fixture transient stop failure' }}
function Stop-PreservedWrappersForRecovery {param($State)}
function Restore-PreservedState {param($State)}
function Reconcile-PreservedZapretProfile {param($State)}
function Restore-InstalledIdentity {param($State)}
function Restore-PreservedServiceStartModes {param($State)}
function Start-PreservedServices {param($State)}
function Test-PayloadRollbackPending { return $false }
function Test-LoopbackDnsReady {param($State) return $true}
function Restore-CriticalAdapterDns {param($State)}
function Restore-CriticalOwnedDnsBaseline { throw 'Unexpected DNS mutation boundary.' }
function Start-InstalledDesktop { throw 'Watchdog must not launch the GUI.' }
function Write-DesktopUpdateResult {param($State,$Ok,$Message) Require (-not $Ok) 'Interrupted update reported installation success.'}
function Start-Sleep {param($Seconds,$Milliseconds) [Threading.Thread]::Sleep(10)}
function New-Case([string]$Name) {
  $script:StageDirectory=Join-Path $root $Name
  New-Item -ItemType Directory -Path $script:StageDirectory -Force | Out-Null
  $script:statuses=New-Object 'Collections.Generic.List[string]'
  $script:recoveryAttempts=0;$script:failUntil=0;$script:retirements=0;$script:bootAssertions=0
  $script:state=[pscustomobject]@{schemaVersion=1;owner='EgoistShield';handoffStarted=$true;runAfter=$false;installer=(Join-Path $script:StageDirectory 'unused.exe');services=@()}
  Write-JsonAtomic -Path (Join-Path $script:StageDirectory 'state.json') -Value $script:state
  Write-JsonAtomic -Path (Join-Path $script:StageDirectory 'maintenance-marker.json') -Value @{owner='EgoistShield'}
  [IO.File]::WriteAllText((Join-Path $script:StageDirectory 'watchdog-deadline.txt'),[DateTime]::UtcNow.AddSeconds(-1).ToString('o'))
}

New-Case 'pre-fix-terminal'
$before=Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\product-review-2026-09-30\installer\terminal-recovery-before.ps1'
$beforeAst=[Management.Automation.Language.Parser]::ParseFile($before,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Pre-fix evidence did not parse.' }
foreach ($name in @('Invoke-Recovery','Invoke-WatchdogMode')) {
  $fn=$beforeAst.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if (-not $fn) { throw 'Pre-fix behavior evidence is missing.' }
  . ([scriptblock]::Create($fn.Extent.Text))
}
$script:failUntil=1
[void](Invoke-WatchdogMode)
Require ((Test-InstallerServiceMaintenanceOwner) -and $script:statuses[-1] -eq 'recovery-warning') 'Pre-fix probe did not reach the actual incomplete recovery.'
Require (([IO.File]::ReadAllText((Join-Path $StageDirectory 'complete.flag'))).Trim() -eq 'watchdog-recovered') 'Pre-fix false terminal behavior was not reproduced.'
[void](Invoke-WatchdogMode)
Require ($script:recoveryAttempts -eq 1) 'Pre-fix probe did not reproduce the terminal retry suppression.'
foreach ($name in @('Invoke-Recovery','Invoke-WatchdogMode')) {
  $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  . ([scriptblock]::Create($fn.Extent.Text))
}
Write-Output 'PASS: exact pre-fix production AST reproduces warning plus false terminal and suppressed retry'

New-Case 'transient'
$script:failUntil=1
$outcome=Invoke-WatchdogMode
Require ($outcome -eq $true -and $script:recoveryAttempts -eq 2) 'Transient failure stopped the recovery retry loop.'
Require ($script:statuses -contains 'recovery-warning' -and $script:statuses[-1] -eq 'recovered') 'Transient recovery error was not retained before verified recovery.'
Require (-not (Test-InstallerServiceMaintenanceOwner) -and $script:retirements -eq 1) 'Successful retry did not retire its own recovery registration.'
Require (([IO.File]::ReadAllText((Join-Path $StageDirectory 'complete.flag'))).Trim() -eq 'watchdog-recovered') 'Verified recovery did not become terminal.'
Write-Output 'PASS: transient warning retries and becomes terminal only after verified restoration'

New-Case 'permanent'
$script:failUntil=100
Require ((Invoke-WatchdogMode) -eq $false -and $script:recoveryAttempts -eq 6) 'Recovery retry exceeded or fell short of its bound.'
Require ((Test-InstallerServiceMaintenanceOwner) -and -not (Test-Path -LiteralPath (Join-Path $StageDirectory 'complete.flag'))) 'Unresolved recovery incorrectly wrote a terminal flag.'
Require ($script:retirements -eq 0 -and (Test-Path -LiteralPath (Join-Path $StageDirectory 'recovery-pending.json'))) 'Failed recovery lost its retry registration or diagnostics.'
$falseTerminal=Join-Path $StageDirectory 'complete.flag'
[IO.File]::WriteAllText($falseTerminal,'failed-recovered')
$script:failUntil=0
Require ((Invoke-WatchdogMode) -eq $true -and $script:recoveryAttempts -eq 7) 'A later recovery run was blocked by a false terminal flag.'
Write-Output 'PASS: exhausted retries preserve marker and pending diagnostics; a later run can recover'

New-Case 'atomic-write'
$journal=Join-Path $StageDirectory 'journal.json'
Write-JsonAtomic -Path $journal -Value @{generation=1}
$held=[IO.File]::Open($journal,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
  $sharingViolation=$false
  try { Write-JsonAtomic -Path $journal -Value @{generation=2} } catch {
    $failure=$_.Exception;while($failure.InnerException){$failure=$failure.InnerException}
    $sharingViolation=($failure.HResult -band 0xFFFF) -in @(32,33)
  }
  Require $sharingViolation 'Locked journal did not fail with an actual Windows sharing violation.'
} finally { $held.Dispose() }
Require ((Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json).generation -eq 1) 'Failed atomic replacement destroyed the preserved journal.'
Write-JsonAtomic -Path $journal -Value @{generation=3}
Require ((Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json).generation -eq 3) 'Unlocked atomic replacement did not commit.'
Require (@(Get-ChildItem -LiteralPath $StageDirectory -Filter 'journal.json.*.tmp').Count -eq 0) 'Failed write left a temporary journal.'
Write-Output 'PASS: actual WinPS atomic journal preserves old state on sharing violation and cleans temporary files'

$powerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$children=New-Object 'Collections.Generic.List[Diagnostics.Process]'
function New-OwnedChild([string]$ScriptPath,[string[]]$Arguments) {
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=$powerShell;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $parts=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$ScriptPath)+$Arguments
  $info.Arguments=($parts | ForEach-Object { ConvertTo-InstallerWindowsArgument ([string]$_) }) -join ' '
  $process=New-Object Diagnostics.Process;$process.StartInfo=$info
  Require ($process.Start()) 'Owned child did not start.'
  $null=$process.Handle;$children.Add($process)
  return $process
}
try {
  $childScript=Join-Path $root 'harmless child [x].ps1'
  [IO.File]::WriteAllText($childScript,'Start-Sleep -Seconds 120')
  $foreign=New-OwnedChild $childScript @()
  $ticks=[int64]$foreign.StartTime.Ticks
  Require ((Stop-VerifiedInstallerTransactionProcess -ProcessId $foreign.Id -StartTicks ($ticks+1) -Executable $powerShell) -eq $true) 'Reused PID identity was not treated as an exited recorded process.'
  Require (-not $foreign.HasExited) 'Mismatched creation time terminated a process.'
  Expect-Refused { Stop-VerifiedInstallerTransactionProcess -ProcessId $foreign.Id -StartTicks $ticks -Executable (Join-Path $root 'foreign.exe') } '*identity changed*'
  Require (-not $foreign.HasExited) 'Foreign executable identity was terminated.'
  Expect-Refused { Stop-VerifiedInstallerTransactionProcess -ProcessId $PID -StartTicks 1 -Executable $powerShell } '*itself*'
  Require ((Stop-VerifiedInstallerTransactionProcess -ProcessId $foreign.Id -StartTicks $ticks -Executable $powerShell) -eq $true) 'Exact owned child did not stop.'
  Require ($foreign.WaitForExit(5000)) 'Owned child remained after Kill/Wait.'
  Write-Output 'PASS: pinned handles terminate only exact owned identity; creation-time executable and self mismatches are refused'

  New-Case 'hung-worker'
  $ready=Join-Path $StageDirectory 'lease-ready.txt'
  $holderScript=Join-Path $StageDirectory 'harmless mutex holder.ps1'
  [IO.File]::WriteAllText($holderScript,"param([string]`$MutexName,[string]`$ReadyPath)`n`$mutex=New-Object Threading.Mutex(`$false,`$MutexName)`n[void]`$mutex.WaitOne()`n[IO.File]::WriteAllText(`$ReadyPath,'ready')`nStart-Sleep -Seconds 120")
  $holder=New-OwnedChild $holderScript @('-MutexName',$mutexName,'-ReadyPath',$ready)
  $timer=[Diagnostics.Stopwatch]::StartNew()
  while (-not (Test-Path -LiteralPath $ready -PathType Leaf)) { if($timer.ElapsedMilliseconds -gt 5000){throw 'Owned mutex holder did not become ready.'};[Threading.Thread]::Sleep(10) }
  Expect-Refused { Enter-DeferredReinstallRecoveryLease } '*still active*'
  Write-JsonAtomic -Path (Join-Path $StageDirectory 'heartbeat.json') -Value @{owner='EgoistShield';workerPid=$holder.Id;workerStartTicks=[int64]$holder.StartTime.Ticks;workerExecutable=$powerShell;installerPid=0;installerStartTicks=0}
  Require ((Invoke-WatchdogMode) -eq $true) 'Expired watchdog did not stop its exact hung worker and acquire the released lease.'
  Require ($holder.WaitForExit(5000) -and $script:recoveryAttempts -eq 1) 'Hung holder was not terminated before the serialized recovery.'
  Require (-not (Test-InstallerServiceMaintenanceOwner)) 'Hung worker left maintenance Disabled after recovery.'
  Write-Output 'PASS: actual harmless hung worker holds mutex; watchdog cancels stops exact holder and recovers under released lease'

  New-Case 'untrusted-heartbeat'
  $holder=New-OwnedChild $childScript @()
  Write-JsonAtomic -Path (Join-Path $StageDirectory 'heartbeat.json') -Value @{owner='foreign';workerPid=$holder.Id;workerStartTicks=[int64]$holder.StartTime.Ticks;workerExecutable=$powerShell;installerPid=0;installerStartTicks=0}
  Require ((Invoke-WatchdogMode) -eq $false -and -not $holder.HasExited -and $script:recoveryAttempts -eq 0) 'Unverified heartbeat allowed process termination or recovery.'
  Require (-not (Test-Path -LiteralPath (Join-Path $StageDirectory 'complete.flag'))) 'Unverified heartbeat produced a recovered terminal flag.'
  Write-Output 'PASS: untrusted heartbeat preserves live owned fixture and cannot enter recovery'
} finally {
  foreach ($child in $children) {
    try { if (-not $child.HasExited) { $child.Kill();[void]$child.WaitForExit(5000) } } finally { $child.Dispose() }
  }
}
Write-Output 'Installer timeout recovery: 8 groups passed; owned harmless process/real mutex and files; live SCM/registry/DNS/tasks 0; grace/retry delays shortened and ACL boundary uses test SID.'
