param([Parameter(Mandatory=$true)][string]$TempRoot, [string]$BeforeSource = '', [string]$BeforeLaunchSource = '')
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
  'Wait-PreviousReinstallProcesses','Assert-PreviousReinstallRestored','Assert-PlainWrapperMigrationPath','Get-NativePowerShellPath',
  'ConvertFrom-PreviousReinstallLaunchPreference','Get-PreviousReinstallLaunchPreference')) {
  Invoke-Expression (Read-Function $source $name).Extent.Text
}
$bootSource=[IO.File]::ReadAllText((Join-Path $project 'src\installer\maintenance-boot-recovery.ps1'))
Invoke-Expression (Read-Function $bootSource 'Assert-InstallerBootRecoveryFileProtection').Extent.Text
function Get-LaunchAssignmentBlock([string]$Text) {
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseInput($Text,[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'Launch assignment AST did not parse.'}
  $statements=@($ast.EndBlock.Statements)
  $first=@($statements | Where-Object {$_.Extent.Text.Trim() -ceq '$runAfter = $true'})
  $last=@($statements | Where-Object {$_.Extent.Text.Trim() -ceq 'if ($NoRunAfter) { $runAfter = $false }'})
  if($first.Count -ne 1 -or $last.Count -ne 1){throw 'Exact production launch-assignment boundary missing.'}
  return $Text.Substring($first[0].Extent.StartOffset,$last[0].Extent.EndOffset-$first[0].Extent.StartOffset)
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

  $launchStateFile=Join-Path $stage 'state.json'
  $validState='{"schemaVersion":1,"owner":"EgoistShield","runAfter":false,"minimizedAfter":true,"installer":"C:\\foreign.exe","services":[{"name":"foreign"}],"userState":["never import"]}'
  [IO.File]::WriteAllText($launchStateFile,$validState,[Text.UTF8Encoding]::new($true))
  $projection=ConvertFrom-PreviousReinstallLaunchPreference ([IO.File]::ReadAllText($launchStateFile))
  Assert ($projection.runAfter -eq $false -and $projection.minimizedAfter -eq $true) 'Original bool launch fields were not preserved.'
  Assert (@($projection.PSObject.Properties).Count -eq 2) 'Legacy snapshots or unrelated state were imported.'
  foreach($invalid in @('{}','[]','null','{','{"schemaVersion":"1","owner":"EgoistShield","runAfter":false,"minimizedAfter":false}',
    '{"schemaVersion":1,"owner":"foreign","runAfter":false,"minimizedAfter":false}',
    '{"schemaVersion":1,"owner":"EgoistShield","runAfter":"false","minimizedAfter":false}',
    '{"schemaVersion":1,"owner":"EgoistShield","runAfter":0,"minimizedAfter":false}',
    '{"schemaVersion":1,"owner":"EgoistShield","runAfter":false,"minimizedAfter":null}',
    '{"schemaVersion":1,"owner":"EgoistShield","runAfter":false,"minimizedAfter":"false"}',
    '{"schemaVersion":1,"owner":"EgoistShield","minimizedAfter":false}')) {
    [IO.File]::WriteAllText($launchStateFile,$invalid)
    $refused=$false;try{[void](ConvertFrom-PreviousReinstallLaunchPreference ([IO.File]::ReadAllText($launchStateFile)))}catch{$refused=$true}
    Assert $refused 'Malformed legacy bool preferences were accepted.'
  }
  [IO.File]::WriteAllText($launchStateFile,$validState,[Text.UTF8Encoding]::new($true))
  $groups.Add('real own JSON files: exact bool projection and malformed/type/owner rejection')

  foreach($legacyRunAfter in @($false,$true)) {
    $legacy378=@{schemaVersion=1;owner='EgoistShield';runAfter=$legacyRunAfter;services=@(@{name='never import'})}|ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText($launchStateFile,$legacy378,[Text.UTF8Encoding]::new($false))
    $projection=ConvertFrom-PreviousReinstallLaunchPreference ([IO.File]::ReadAllText($launchStateFile))
    Assert ($projection.runAfter -eq $legacyRunAfter -and $projection.minimizedAfter -eq $false) 'Original 3.7.8 state without minimizedAfter was rejected or its launch choice changed.'
    Assert (@($projection.PSObject.Properties).Count -eq 2) 'Legacy 3.7.8 state imported unrelated fields.'
  }
  [IO.File]::WriteAllText($launchStateFile,$validState,[Text.UTF8Encoding]::new($true))
  $groups.Add('original 3.7.8 schema: absent minimizedAfter defaults false and preserves exact runAfter')

  # Actual Windows ACL objects exercise the unchanged production policy. A
  # scoped Get-Acl leaf supplies only these owned-fixture descriptors; it does
  # not alter native ACLs or assert ownership of this nonadmin fixture.
  $directorySecurity=[Security.AccessControl.DirectorySecurity]::new()
  $directorySecurity.SetSecurityDescriptorSddlForm('O:BAG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
  $fileSecurity=[Security.AccessControl.FileSecurity]::new()
  $fileSecurity.SetSecurityDescriptorSddlForm('O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)')
  $actualProjection=& {
    function Get-Acl {param([string]$LiteralPath)
      if($LiteralPath -ceq $stage){return $directorySecurity}
      if($LiteralPath -ceq $launchStateFile){return $fileSecurity}
      throw 'ACL fixture leaf refused an unrelated host path.'
    }
    $validated=Get-PreviousReinstallLaunchPreference -Stage $stage
    Assert ($validated.runAfter -eq $false -and $validated.minimizedAfter -eq $true) 'Bounded production reader lost exact bool values.'
    foreach($sddl in @('O:S-1-5-32-545G:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)',
      'O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FW;;;BU)',
      'O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x00000040;;;BU)',
      'O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x00040000;;;BU)',
      'O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;WO;;;BU)',
      'O:BAG:SYD:P(A;;FA;;;BA)')){
      $fileSecurity.SetSecurityDescriptorSddlForm($sddl);$refused=$false
      try{[void](Get-PreviousReinstallLaunchPreference -Stage $stage)}catch{$refused=$true}
      Assert $refused 'Untrusted owner/write/delete/DACL/owner or missing SYSTEM control was accepted.'
    }
    $fileSecurity.SetSecurityDescriptorSddlForm('O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)')
    $directorySecurity.SetSecurityDescriptorSddlForm('O:BAG:SYD:(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
    $refused=$false;try{[void](Get-PreviousReinstallLaunchPreference -Stage $stage)}catch{$refused=$true}
    Assert $refused 'Unprotected old stage directory was accepted.'
    $directorySecurity.SetSecurityDescriptorSddlForm('O:BAG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
    return $validated
  }
  $groups.Add('real in-memory Windows DACL policy; exact own-file bounded reader; no native ACL changes')
  [IO.File]::WriteAllText($launchStateFile,(' ' * 4194305))
  $refused=$false;try{[void](Get-PreviousReinstallLaunchPreference -Stage $stage)}catch{$refused=$_.Exception.Message -match 'exceeds 4 MiB'}
  Assert $refused 'Oversized own state was not refused before reading/ACL trust.'
  [IO.File]::WriteAllText($launchStateFile,$validState,[Text.UTF8Encoding]::new($true))
  $actualAcl=Microsoft.PowerShell.Security\Get-Acl -LiteralPath $launchStateFile
  if($actualAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){
    $refused=$false;try{[void](Get-PreviousReinstallLaunchPreference -Stage $stage)}catch{$refused=$_.Exception.Message -match 'owner is not SYSTEM or Administrators'}
    Assert $refused 'Actual untrusted nonadmin fixture owner was accepted.'
  }
  $groups.Add('actual own-file oversize/native untrusted-owner refusal')

  $junctionPath=Join-Path (Split-Path -Parent $stage) ([Guid]::NewGuid().ToString('N'))
  try{
    [void](New-Item -ItemType Junction -Path $junctionPath -Target $stage)
    $refused=$false;try{[void](Get-PreviousReinstallLaunchPreference -Stage $junctionPath)}catch{$refused=$_.Exception.Message -match 'reparse'}
    Assert $refused 'Actual own canonical-looking junction stage was accepted.'
  }finally{
    $resolvedJunction=[IO.Path]::GetFullPath($junctionPath)
    Assert ($resolvedJunction.StartsWith([IO.Path]::GetFullPath($caseRoot)+'\',[StringComparison]::OrdinalIgnoreCase)) 'Own junction cleanup escaped the fixture.'
    if(Test-Path -LiteralPath $resolvedJunction){
      $junctionItem=Get-Item -LiteralPath $resolvedJunction -Force
      Assert (($junctionItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) 'Own cleanup target is no longer a junction.'
      [IO.Directory]::Delete($resolvedJunction,$false)
      Assert ([IO.File]::Exists($launchStateFile)) 'Junction cleanup changed its own target contents.'
    }
  }
  $groups.Add('actual own canonical-looking junction refused; scoped nonrecursive cleanup')

  $preferenceStart=$source.IndexOf('$previousReinstallStage = ')
  $preferenceEnd=$source.IndexOf('$brandedUi = ',$preferenceStart)
  Assert ($preferenceStart -ge 0 -and $preferenceEnd -gt $preferenceStart) 'Dispatch preference validation boundary missing.'
  $dispatchPreferencePrefix=$source.Substring($preferenceStart,$preferenceEnd-$preferenceStart)
  [IO.File]::WriteAllText($launchStateFile,'{"schemaVersion":1,"owner":"EgoistShield","runAfter":"false","minimizedAfter":false}')
  & {
    function Get-Acl {param([string]$LiteralPath)
      if($LiteralPath -ceq $stage){return $directorySecurity}
      if($LiteralPath -ceq $launchStateFile){return $fileSecurity}
      throw 'ACL fixture leaf refused an unrelated host path.'
    }
    function New-Object {throw 'Invalid preferences reached the deferred lease or mutation preparation.'}
    $savedInheritedStage=$env:EGOIST_PROTECTED_REINSTALL_STAGE
    try{
      $env:EGOIST_PROTECTED_REINSTALL_STAGE=$stage;$WaitForPreviousReinstall=$true
      $refused=$false;try{. ([scriptblock]::Create($dispatchPreferencePrefix))}catch{$refused=$_.Exception.Message -match 'runAfter boolean'}
      Assert $refused 'Actual dispatch prefix did not reject malformed preferences before lease/preparation.'
    }finally{$env:EGOIST_PROTECTED_REINSTALL_STAGE=$savedInheritedStage}
  }
  [IO.File]::WriteAllText($launchStateFile,$validState,[Text.UTF8Encoding]::new($true))
  $groups.Add('actual dispatch prefix refuses malformed bool state before lease/staging mutation')

  $launchAssignments=Get-LaunchAssignmentBlock $source
  foreach($row in @(@{run=$false;minimized=$false;noRun=$false;explicitMinimized=$false},
    @{run=$false;minimized=$true;noRun=$false;explicitMinimized=$false},
    @{run=$true;minimized=$true;noRun=$false;explicitMinimized=$false},
    @{run=$true;minimized=$false;noRun=$true;explicitMinimized=$false},
    @{run=$true;minimized=$false;noRun=$false;explicitMinimized=$true})){
    & {
      $WaitForPreviousReinstall=$true;$previousLaunchPreferences=[pscustomobject]@{runAfter=$row.run;minimizedAfter=$row.minimized}
      $NoRunAfter=$row.noRun;$MinimizedAfter=$row.explicitMinimized;$RunAfterPath='';$brandedUi=$false
      . ([scriptblock]::Create($launchAssignments))
      Assert ($runAfter -eq ($row.run -and -not $row.noRun)) 'Actual dispatch assignments lost inherited/explicit no-launch intent.'
      Assert ($minimizedAfterValue -eq ($row.minimized -or $row.explicitMinimized)) 'Actual dispatch assignments lost minimized launch intent.'
    }
  }
  & {
    $uiDirectory=Join-Path $caseRoot 'own-ui';New-Item -ItemType Directory -Path $uiDirectory | Out-Null
    $RunAfterPath=Join-Path $uiDirectory 'run_after.txt';[IO.File]::WriteAllText($RunAfterPath,'1')
    $HandoffSignalPath=Join-Path $uiDirectory 'handoff-started.flag';$brandedUi=$true
    Invoke-Expression (Read-Function $source 'Resolve-FullPath').Extent.Text
    $WaitForPreviousReinstall=$true;$previousLaunchPreferences=$actualProjection;$NoRunAfter=$false;$MinimizedAfter=$false
    . ([scriptblock]::Create($launchAssignments))
    Assert ($runAfter -eq $false) 'Branded launch choice re-enabled inherited false.'
    $WaitForPreviousReinstall=$false
    . ([scriptblock]::Create($launchAssignments))
    Assert ($runAfter -eq $true -and $minimizedAfterValue -eq $false) 'Ordinary branded installer launch behavior changed.'
  }
  $groups.Add('actual dispatch AST: inherited false/true/minimized, explicit NoRunAfter priority, branded restriction')
  if($BeforeLaunchSource){
    $beforeLaunch=Get-LaunchAssignmentBlock ([IO.File]::ReadAllText($BeforeLaunchSource))
    foreach($version in @(@{block=$beforeLaunch;expected=$true},@{block=$launchAssignments;expected=$false})){
      & {
        $WaitForPreviousReinstall=$true;$previousLaunchPreferences=$actualProjection;$NoRunAfter=$false;$MinimizedAfter=$false;$RunAfterPath='';$brandedUi=$false
        . ([scriptblock]::Create($version.block))
        Assert ($runAfter -eq $version.expected) 'Actual before/after dispatch AST did not reproduce/fix legacy relaunch.'
      }
    }
    $groups.Add('actual saved-before dispatch AST reproduces false-to-true defect; fixed AST preserves false')
  }

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
  [pscustomobject]@{groups=$groups.Count;passed=@($groups);liveServiceMutations=0;liveDnsMutations=0;taskRegistrations=0;hostAclMutations=0;nativeRegistryMutations=0;launchBeforeAfterChecked=[bool]$BeforeLaunchSource;aclTestScope='real in-memory Windows security descriptors supplied by a scoped fixture leaf; actual nonadmin own-file owner is rejected';scope='actual production lease/observer/dispatch AST; own files/Local mutex/hidden children; controlled DNS and ACL leaves; no installer execution or host ACL writes'} | ConvertTo-Json -Depth 4
} finally {
  foreach ($child in $ownedChildren) {
    try { if (-not $child.WaitForExit(5000)) { $child.Kill(); [void]$child.WaitForExit(5000) } } finally { $child.Dispose() }
  }
}
