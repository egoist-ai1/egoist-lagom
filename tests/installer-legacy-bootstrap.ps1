param([Parameter(Mandatory=$true)][string]$TempRoot, [string]$BeforeSource = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$project = Split-Path -Parent $PSScriptRoot
$workerPath = Join-Path $project 'scripts\invoke-final-silent-reinstall.ps1'
$source = [IO.File]::ReadAllText($workerPath)
$caseRoot = Join-Path ([IO.Path]::GetFullPath($TempRoot)) ('b' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $caseRoot -Force | Out-Null
$groups = New-Object 'Collections.Generic.List[string]'
function Assert([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Read-Function([string]$Text,[string]$Name) {
  $tokens=$null; $parseErrors=$null
  $ast=[Management.Automation.Language.Parser]::ParseInput($Text,[ref]$tokens,[ref]$parseErrors)
  if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
  $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $Name},$true)
  if (-not $function) { throw "Production function missing: $Name" }
  return $function
}
foreach ($name in @('Enter-InstallerWorkerLease','Resolve-PreviousReinstallStage','Test-PreviousReinstallProcess',
  'Wait-PreviousReinstallProcesses','Assert-PreviousReinstallRestored','Assert-PlainWrapperMigrationPath','Get-NativePowerShellPath')) {
  Invoke-Expression (Read-Function $source $name).Extent.Text
}
function Assert-InstallerNotCancelled { if ($script:cancelled) { throw 'test cancellation' } }
function Get-InstallerCommonDataRoot { return $caseRoot }
$script:cancelled=$false
$powerShell=Get-NativePowerShellPath
$ownedChildren=New-Object 'Collections.Generic.List[Diagnostics.Process]'
function Start-LeaseHolder([string]$Name,[int]$Hold=500,[switch]$Abandon) {
  $flag=Join-Path $caseRoot ([Guid]::NewGuid().ToString('N')+'.flag')
  $code='$m=New-Object Threading.Mutex($false,''' + $Name + '''); [void]$m.WaitOne(); [IO.File]::WriteAllText(''' + $flag.Replace("'","''") + ''',''held''); Start-Sleep -Milliseconds '+$Hold+';'
  if (-not $Abandon) { $code+=' $m.ReleaseMutex(); $m.Dispose();' }
  $arguments='-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
  $info=New-Object Diagnostics.ProcessStartInfo($powerShell,$arguments)
  $info.UseShellExecute=$false; $info.CreateNoWindow=$true
  $child=[Diagnostics.Process]::Start($info); $ownedChildren.Add($child)
  $timer=[Diagnostics.Stopwatch]::StartNew()
  while (-not [IO.File]::Exists($flag)) {
    if ($child.HasExited -or $timer.ElapsedMilliseconds -gt 5000) { throw 'Own lease holder failed to start.' }
    Start-Sleep -Milliseconds 20
  }
  return $child
}
try {
  $name='Local\LagomBootstrap-'+[Guid]::NewGuid().ToString('N')
  $mutex=New-Object Threading.Mutex($false,$name)
  Assert (Enter-InstallerWorkerLease -Mutex $mutex) 'Immediate lease acquisition failed.'
  $mutex.ReleaseMutex(); $mutex.Dispose(); $groups.Add('free lease')

  $name='Local\LagomBootstrap-'+[Guid]::NewGuid().ToString('N')
  $child=Start-LeaseHolder $name 600
  $mutex=New-Object Threading.Mutex($false,$name); $timer=[Diagnostics.Stopwatch]::StartNew()
  Assert (-not (Enter-InstallerWorkerLease -Mutex $mutex -WaitMilliseconds 100)) 'Busy lease exceeded its bounded refusal contract.'
  Assert ($timer.ElapsedMilliseconds -lt 450) 'Busy refusal did not respect its time budget.'
  Assert (Enter-InstallerWorkerLease -Mutex $mutex -WaitMilliseconds 1500) 'Waiting bridge did not acquire after the old owner released.'
  $mutex.ReleaseMutex(); $mutex.Dispose(); Assert ($child.WaitForExit(5000)) 'Own child did not exit.'
  $groups.Add('bounded busy refusal and sequential handoff')

  $name='Local\LagomBootstrap-'+[Guid]::NewGuid().ToString('N')
  $child=Start-LeaseHolder $name 400 -Abandon
  $mutex=New-Object Threading.Mutex($false,$name)
  Assert (Enter-InstallerWorkerLease -Mutex $mutex -WaitMilliseconds 1500) 'Abandoned lease did not transfer ownership.'
  $mutex.ReleaseMutex(); $mutex.Dispose(); Assert ($child.WaitForExit(5000)) 'Own abandoned holder did not exit.'
  $groups.Add('abandoned lease')

  $mutex=New-Object Threading.Mutex($false,('Local\LagomBootstrap-'+[Guid]::NewGuid().ToString('N')))
  $script:cancelled=$true; $failed=$false
  try { [void](Enter-InstallerWorkerLease -Mutex $mutex -WaitMilliseconds 1000) } catch { $failed=$_.Exception.Message -eq 'test cancellation' }
  $script:cancelled=$false; Assert $failed 'Cancellation was ignored.'
  Assert ($mutex.WaitOne(0)) 'Cancelled wait retained a lease.'; $mutex.ReleaseMutex(); $mutex.Dispose()
  $groups.Add('cancellation before acquiring')

  $stage=Join-Path (Join-Path $caseRoot 'EgoistShieldInstaller\DeferredRuns') ([Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  Assert ((Resolve-PreviousReinstallStage $stage) -eq $stage) 'Canonical observer stage rejected.'
  foreach ($bad in @((Join-Path $caseRoot 'foreign'),($stage+'-extra'),(Join-Path $stage 'nested'))) {
    $failed=$false; try { [void](Resolve-PreviousReinstallStage $bad) } catch { $failed=$true }
    Assert $failed 'Noncanonical observer stage accepted.'
  }
  $scriptPath=Join-Path $stage 'invoke-final-silent-reinstall.ps1'
  $command='powershell.exe -File "'+$scriptPath+'" -Watchdog -StageDirectory "'+$stage+'"'
  Assert (Test-PreviousReinstallProcess ([pscustomobject]@{ExecutablePath=$powerShell;CommandLine=$command}) $stage $powerShell) 'Exact watchdog observer rejected.'
  foreach ($bad in @($command.Replace('-Watchdog','-WatchdogExtra'),$command.Replace($stage,$stage+'-other'),$command.Replace('-File','-Command'))) {
    Assert (-not (Test-PreviousReinstallProcess ([pscustomobject]@{ExecutablePath=$powerShell;CommandLine=$bad}) $stage $powerShell)) 'Foreign command matched observer.'
  }
  Assert (-not (Test-PreviousReinstallProcess ([pscustomobject]@{ExecutablePath='C:\foreign.exe';CommandLine=$command}) $stage $powerShell)) 'Foreign image matched observer.'
  $groups.Add('literal process and canonical stage scope')

  [IO.File]::WriteAllText($scriptPath,'param([switch]$Watchdog,[string]$StageDirectory) Start-Sleep -Milliseconds 650',[Text.UTF8Encoding]::new($true))
  $child=Start-Process -FilePath $powerShell -ArgumentList ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "'+$scriptPath+'" -Watchdog -StageDirectory "'+$stage+'"') -PassThru -WindowStyle Hidden
  $ownedChildren.Add($child)
  Start-Sleep -Milliseconds 130
  $timer=[Diagnostics.Stopwatch]::StartNew()
  Wait-PreviousReinstallProcesses -Stage $stage -WaitMilliseconds 5000
  Assert ($child.WaitForExit(5000)) 'Quiescence returned before the actual own watchdog exited.'
  $groups.Add('actual own watchdog process quiescence')

  function Test-LoopbackDnsReady { param($State) return $script:dnsReady }
  $script:dnsReady=$true
  Assert-PreviousReinstallRestored ([pscustomobject]@{services=@([pscustomobject]@{name='Owned';startMode='Auto';wasRunning=$true})})
  foreach ($state in @([pscustomobject]@{services=@([pscustomobject]@{name='Owned';startMode='Auto';wasRunning=$false})},[pscustomobject]@{services=@()})) {
    $script:dnsReady=$state.services.Count -gt 0; $failed=$false
    try { Assert-PreviousReinstallRestored $state } catch { $failed=$true }
    Assert $failed 'Incomplete prior service/DNS recovery was accepted.'
  }
  $groups.Add('fresh native observation preflight refusal')

  if ($BeforeSource) {
    $stateFile=Join-Path $caseRoot 'state.json'; $script:StageDirectory=$caseRoot
    [IO.File]::WriteAllText($stateFile,'{"installer":"fixture","manifest":"fixture","version":"3.8.0","sha256":"fixture","previousReinstallWaitMilliseconds":1500}')
    function Test-IsAdministrator { return $true }
    function Assert-SupportedServiceFramework {}
    function Get-ValidatedRelease { param($Installer,$Manifest,$Version,$Sha256,[switch]$AllowStagedPair) return @{} }
    function Add-ReceiptEvent { param($Stage,$Status,$Message) }
    foreach ($item in @(@{text=[IO.File]::ReadAllText($BeforeSource);expected=$false},@{text=$source;expected=$true})) {
      $body=(Read-Function $item.text 'Invoke-WorkerMode').Body.Extent.Text
      $boundary=$body.IndexOf('    Add-ReceiptEvent -Stage "worker" -Status "waiting"')
      Assert ($boundary -gt 0) 'Worker lease boundary missing.'
      $prefix=$body.Substring(1,$boundary-1); $prefix=$prefix.Substring(0,$prefix.LastIndexOf('  try {'))
      $name='Local\LagomBootstrap-'+[Guid]::NewGuid().ToString('N')
      $prefix=$prefix.Replace('Global\EgoistShield.DeferredReinstall',$name)
      $child=Start-LeaseHolder $name 500; $succeeded=$false
      try { & ([scriptblock]::Create($prefix+' $mutex.ReleaseMutex(); $mutex.Dispose();')); $succeeded=$true } catch { if ($item.expected) { throw } }
      Assert ($succeeded -eq $item.expected) 'Actual before/after worker prefix did not distinguish the handoff.'
      Assert ($child.WaitForExit(5000)) 'Own worker-prefix holder did not exit.'
    }
    $groups.Add('actual worker lease prefix before busy failure and after successful wait')
  }
  [pscustomobject]@{groups=$groups.Count;passed=@($groups);liveServiceMutations=0;liveDnsMutations=0;taskRegistrations=0;scope='actual production lease/observer/prefix; own Local mutex, own hidden children, controlled DNS preflight leaf; no installer execution'} | ConvertTo-Json -Depth 4
} finally {
  foreach ($child in $ownedChildren) {
    try { if (-not $child.WaitForExit(5000)) { $child.Kill(); [void]$child.WaitForExit(5000) } } finally { $child.Dispose() }
  }
}
