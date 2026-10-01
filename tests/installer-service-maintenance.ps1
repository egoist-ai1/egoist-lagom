param(
  [string]$SourceScript = (Join-Path $PSScriptRoot '..\src\installer\service-maintenance.ps1'),
  [string]$ReceiptPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.ServiceProcess
if (-not $env:LAGOM_TEST_TEMP -or -not [IO.Path]::IsPathRooted($env:LAGOM_TEST_TEMP)) {
  throw 'Set task-scoped LAGOM_TEST_TEMP.'
}
$taskTestRoot = [IO.Path]::GetFullPath($env:LAGOM_TEST_TEMP).TrimEnd('\')
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
if ($taskTestRoot.Equals($projectRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $taskTestRoot.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Test fixtures must stay outside the product checkout.'
}
$fixtureRoot = Join-Path $taskTestRoot ('maintenance [x]-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
[void][IO.Directory]::CreateDirectory($fixtureRoot)
$previousCompilerTemp=$env:TEMP; $previousCompilerTmp=$env:TMP
try {
  $env:TEMP=$fixtureRoot; $env:TMP=$fixtureRoot
  Add-Type -TypeDefinition @'
using System;
public sealed class InstallerMaintenanceProcessFixture {
    public DateTime StartTime { get; set; }
    public string Path { get; set; }
    public bool HandleUnavailable { get; set; }
    public bool ZeroHandle { get; set; }
    public bool ExitSuccessful { get; set; }
    public Action OnKill { get; set; }
    public Action OnDispose { get; set; }
    public IntPtr Handle { get {
        if (HandleUnavailable) throw new InvalidOperationException("Fixture process handle denied.");
        if (ZeroHandle) return IntPtr.Zero;
        return new IntPtr(42);
    } }
    public void Kill() { if (OnKill != null) OnKill(); }
    public bool WaitForExit(int milliseconds) {
        if (milliseconds != 5000) throw new InvalidOperationException("Unexpected process exit budget.");
        return ExitSuccessful;
    }
    public void Dispose() { if (OnDispose != null) OnDispose(); }
}
'@
} finally { $env:TEMP=$previousCompilerTemp; $env:TMP=$previousCompilerTmp }
$snapshotPath = Join-Path $fixtureRoot 'original services.json'
if (-not $ReceiptPath) { $ReceiptPath = Join-Path $fixtureRoot 'receipt.json' }
$ReceiptPath = [IO.Path]::GetFullPath($ReceiptPath)
if (-not $ReceiptPath.StartsWith($taskTestRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'ReceiptPath must stay inside task-scoped LAGOM_TEST_TEMP.'
}
$sourceBytes = [IO.File]::ReadAllBytes([IO.Path]::GetFullPath($SourceScript))
$source = [Text.Encoding]::UTF8.GetString($sourceBytes).TrimStart([char]0xfeff)
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
try { $sourceHash = ([BitConverter]::ToString($hashAlgorithm.ComputeHash($sourceBytes))).Replace('-', '') }
finally { $hashAlgorithm.Dispose() }
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Maintenance production source failed parsing.' }
$productionFunctions = @(
  'Get-InstallerServicePolicy', 'Set-InstallerServiceStartMode',
  'Get-InstallerServiceState', 'Stop-InstallerOwnedService',
  'Suspend-InstallerServiceRestarts', 'Restore-InstallerServiceStartModes'
)
$allowedCommands = @($productionFunctions + @(
  'Invoke-InstallerSc', 'Get-Item', 'Test-Path', 'Get-Content', 'Get-Service',
  'Get-CimInstance', 'Get-Process', 'Get-Date', 'Start-Sleep', 'Where-Object', 'ConvertFrom-Json'
))
$definitions = foreach ($name in $productionFunctions) {
  $function = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  if (-not $function) { throw "Production function missing: $name" }
  foreach ($command in $function.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] }, $true)) {
    $commandName = $command.GetCommandName()
    if ($commandName) {
      if ($allowedCommands -notcontains $commandName) { throw "Unsafe or unknown harness boundary: $commandName" }
    } elseif ($command.CommandElements[0].Extent.Text -notin @('$OwnPath', '$StopCore')) {
      throw 'Native/dynamic invocation must use the stubbed Invoke-InstallerSc leaf.'
    }
  }
  $function.Extent.Text
}

# Import only inspected production functions. The native SCM leaf and product
# top-level script are deliberately never imported or executed.
. ([scriptblock]::Create($definitions -join [Environment]::NewLine))
$script:cases = [Collections.Generic.List[object]]::new()
$script:forbiddenCalls = [Collections.Generic.List[string]]::new()
$script:birth = [DateTime]::Parse('2026-09-30T10:00:00Z').ToUniversalTime()
$script:OwnedPath = {
  param([string]$Path)
  if (-not $Path) { return $false }
  $candidate = $Path.Trim()
  if ($candidate.StartsWith('"')) { $candidate = ($candidate -split '"')[1] }
  return $candidate.StartsWith($fixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Require { param([bool]$Condition, [string]$Message) if (-not $Condition) { throw $Message } }
function Refused {
  param([scriptblock]$Action, [string]$Pattern)
  $failure = $null
  try { & $Action } catch { $failure = $_.Exception.Message }
  Require ($null -ne $failure -and $failure -like $Pattern) ("Expected refusal: $Pattern; received: $failure")
}
function Run-Case {
  param([string]$Name, [scriptblock]$Action)
  Reset-Fixture
  $errorText = $null
  try { & $Action } catch { $errorText = $_.Exception.Message }
  $script:cases.Add([pscustomobject]@{name=$Name;passed=($null -eq $errorText);error=$errorText})
}
function Add-ServiceFixture {
  param([string]$Name, [string]$Mode='Auto', [bool]$Delayed=$false, [string]$Status='Running', [string]$Path)
  if (-not $Path) {
    $fileName = if ($Name -eq 'EgoistShieldCore' -or $Name -eq 'LegacyCoreAlias') { 'EgoistShield.Service.exe' } else { 'wrapper.exe' }
    $Path = Join-Path (Join-Path $fixtureRoot $Name) $fileName
  }
  $start = switch ($Mode) { 'Auto' {2}; 'Manual' {3}; 'Disabled' {4}; default {throw 'Fixture start mode invalid.'} }
  $script:services[$Name] = @{
    Name=$Name; ImagePath=$Path; Start=$start; DelayedAutoStart=[int]$Delayed;
    Status=$Status; ProcessId=99001; CreationDate=$script:birth;
    FailureActions=[byte[]]@(1,3,7,15); FailureActionsOnNonCrashFailures=1
  }
}
function Reset-Fixture {
  $script:services = @{}
  $script:trace = [Collections.Generic.List[string]]::new()
  $script:clock = $script:birth
  $script:queuedRestarts = [Collections.Generic.List[object]]::new()
  $script:blockedRestarts=0; $script:completedRestarts=0
  $script:stopDisposition='graceful'; $script:configFailureFor=''; $script:skipConfigWrite=$false
  $script:substituteOnConfig=$false; $script:cimFailure=$false; $script:missingCimRecord=$false
  $script:foreignCimService=$false; $script:foreignCimProcess=$false; $script:foreignSharedService=$false
  $script:missingProcess=$false; $script:reusedPid=$false; $script:processPathMismatch=$false
  $script:handleFailure=$false; $script:zeroHandle=$false; $script:processExitFailure=$false; $script:missingCreationDate=$false
  $script:killCount=0; $script:disposeCount=0; $script:stateReadCount=0
  $script:lastServicePattern=$null
  $script:registryFailure=$false; $script:stateFailure=$false
  $script:stateQueues=@{}; $script:serviceAbsence=$false
  if ([IO.File]::Exists($snapshotPath)) { [IO.File]::Delete($snapshotPath) }
}
function Save-OriginalFixture {
  param([object[]]$Records, [switch]$Envelope)
  $value = if ($Envelope) { [pscustomobject]@{schemaVersion=1;services=@($Records)} } else { @($Records) }
  [IO.File]::WriteAllText($snapshotPath, (ConvertTo-Json -InputObject $value -Depth 8), [Text.UTF8Encoding]::new($false))
  $script:trace.Add('snapshot-durable')
}
function Get-OriginalRecords {
  $records = foreach ($name in @($script:services.Keys | Sort-Object)) {
    $policy = Get-InstallerServicePolicy $name
    $policy | Add-Member NoteProperty wasRunning ($script:services[$name].Status -eq 'Running')
    $policy
  }
  return @($records)
}
function Assert-TaskFile {
  param([string]$Path)
  $full = [IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($taskTestRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected filesystem boundary.' }
}
function Get-ServiceNameFromRegistryPath {
  param([string]$Path)
  $prefix = 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\'
  if (-not $Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected registry boundary.' }
  return $Path.Substring($prefix.Length)
}
function Test-Path {
  param([string]$LiteralPath, [string]$PathType)
  if ($LiteralPath.StartsWith('Registry::', [StringComparison]::OrdinalIgnoreCase)) {
    $name = Get-ServiceNameFromRegistryPath $LiteralPath
    if ($script:registryFailure) { throw 'Fixture registry unavailable.' }
    return $script:services.ContainsKey($name)
  }
  Assert-TaskFile $LiteralPath
  if ($PathType -eq 'Leaf') { return [IO.File]::Exists($LiteralPath) }
  return [IO.File]::Exists($LiteralPath) -or [IO.Directory]::Exists($LiteralPath)
}
function Get-Item {
  param([string]$LiteralPath, $ErrorAction)
  $name = Get-ServiceNameFromRegistryPath $LiteralPath
  if ($script:registryFailure) { throw 'Fixture registry unavailable.' }
  if (-not $script:services.ContainsKey($name)) { throw 'Unexpected registry item lookup.' }
  $key = [pscustomobject]@{FixtureName=$name}
  $key | Add-Member ScriptMethod GetValue {
    param($Field, $Default)
    $values = $script:services[$this.FixtureName]
    if ($values.ContainsKey($Field)) { return $values[$Field] }
    return $Default
  }
  return $key
}
function Get-Content {
  param([string]$LiteralPath, [switch]$Raw, $ErrorAction)
  Assert-TaskFile $LiteralPath
  return [IO.File]::ReadAllText($LiteralPath)
}
function Invoke-InstallerSc {
  param([string[]]$Arguments, [int[]]$AllowedExitCodes=@(0))
  if ($Arguments.Count -lt 2 -or -not $script:services.ContainsKey($Arguments[1])) { throw 'Unexpected SCM fixture command.' }
  $name = $Arguments[1]
  $script:trace.Add(($Arguments -join ':'))
  switch ($Arguments[0]) {
    'config' {
      Require ($Arguments.Count -eq 4 -and $Arguments[2] -eq 'start=') 'SCM fixture allows startup changes only.'
      if ($name -eq $script:configFailureFor) { throw 'Fixture SCM configuration denied.' }
      if (-not $script:skipConfigWrite) {
        switch ($Arguments[3]) {
          'auto' {$script:services[$name].Start=2; $script:services[$name].DelayedAutoStart=0}
          'delayed-auto' {$script:services[$name].Start=2; $script:services[$name].DelayedAutoStart=1}
          'demand' {$script:services[$name].Start=3; $script:services[$name].DelayedAutoStart=0}
          'disabled' {$script:services[$name].Start=4; $script:services[$name].DelayedAutoStart=0}
          default {throw 'Unexpected SCM startup value.'}
        }
      }
      if ($script:substituteOnConfig) { $script:services[$name].ImagePath='C:\Foreign\replacement.exe' }
    }
    'stop' {
      Require ($Arguments.Count -eq 2 -and $AllowedExitCodes -contains 1062) 'Stop must tolerate already stopped status only explicitly.'
      Require ($script:services[$name].Start -eq 4) 'Service stop happened before Disabled readback.'
      if ($script:stopDisposition -eq 'graceful') { $script:services[$name].Status='Stopped' }
    }
    default {throw 'Unexpected SCM operation: actual SCM is unavailable to this harness.'}
  }
}
function Get-Date { return $script:clock }
function Start-Sleep {
  param([int]$Milliseconds, [int]$Seconds)
  $script:clock = $script:clock.AddMilliseconds($Milliseconds + 1000*$Seconds)
  foreach ($queued in @($script:queuedRestarts.ToArray())) {
    if (-not $queued.attempted -and $queued.at -le $script:clock) {
      $queued.attempted=$true
      # A previously queued recovery is independent of current FailureActions.
      if ($script:services[$queued.name].Start -eq 4) {
        $script:blockedRestarts++; $script:trace.Add('queued-restart-blocked:'+$queued.name)
      } else {
        $script:completedRestarts++; $script:services[$queued.name].Status='Running'
        $script:trace.Add('queued-restart-ran:'+$queued.name)
      }
    }
  }
}
function Get-Service {
  param([string]$Name, $ErrorAction)
  $script:lastServicePattern=$Name
  $Name=[regex]::Replace($Name, '`(.)', '$1')
  $script:stateReadCount++
  if ($script:stateFailure) { throw 'Fixture SCM state unavailable.' }
  if ($script:serviceAbsence -or -not $script:services.ContainsKey($Name)) {
    $record = [Management.Automation.ErrorRecord]::new([Exception]::new('No fixture service.'), 'NoServiceFoundForGivenName', [Management.Automation.ErrorCategory]::ObjectNotFound, $Name)
    throw $record
  }
  if ($script:stateQueues.ContainsKey($Name) -and $script:stateQueues[$Name].Count -gt 0) {
    $script:services[$Name].Status = $script:stateQueues[$Name].Dequeue()
  }
  return [pscustomobject]@{Status=[System.ServiceProcess.ServiceControllerStatus]::$($script:services[$Name].Status)}
}
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter, [int]$OperationTimeoutSec, $ErrorAction)
  Require ($OperationTimeoutSec -eq 3) 'CIM must carry its bounded production timeout.'
  if ($script:cimFailure) { throw 'Fixture CIM unavailable.' }
  if ($script:missingCimRecord) { return $null }
  if ($ClassName -eq 'Win32_Service' -and $Filter.StartsWith("Name='")) {
    $name = $Filter.Substring(6, $Filter.Length-7)
    if (-not $script:services.ContainsKey($name)) { throw 'Unexpected service CIM filter.' }
    $record = $script:services[$name]
    return [pscustomobject]@{Name=$name;PathName=$(if($script:foreignCimService){'C:\Foreign\wrapper.exe'}else{$record.ImagePath});ProcessId=$record.ProcessId}
  }
  if ($ClassName -eq 'Win32_Service' -and $Filter -eq 'ProcessId=99001') {
    if ($script:foreignSharedService) { return [pscustomobject]@{Name='ForeignShared';PathName='C:\Foreign\shared.exe';ProcessId=99001} }
    return @()
  }
  if ($ClassName -eq 'Win32_Process' -and $Filter -eq 'ProcessId=99001') {
    $record = @($script:services.Values)[0]
    return [pscustomobject]@{ExecutablePath=$(if($script:foreignCimProcess){'C:\Foreign\process.exe'}else{$record.ImagePath});CreationDate=$(if($script:missingCreationDate){$null}else{$record.CreationDate})}
  }
  throw 'Unexpected CIM boundary.'
}
function Get-Process {
  param([int]$Id, $ErrorAction)
  Require ($Id -eq 99001) 'Unexpected process fixture PID.'
  if ($script:missingProcess) { return $null }
  $record = @($script:services.Values)[0]
  $process = [InstallerMaintenanceProcessFixture]::new()
  $process.StartTime=if($script:reusedPid){$script:birth.AddSeconds(1)}else{$script:birth}
  $process.Path=if($script:processPathMismatch){Join-Path $fixtureRoot 'another.exe'}else{$record.ImagePath}
  $process.HandleUnavailable=$script:handleFailure
  $process.ZeroHandle=$script:zeroHandle
  $process.ExitSuccessful=-not $script:processExitFailure
  $process.OnKill=[Action]{
    $script:killCount++; $script:trace.Add('owned-handle-kill')
    foreach ($record in $script:services.Values) { $record.Status='Stopped' }
  }
  $process.OnDispose=[Action]{$script:disposeCount++}
  return $process
}
function Forbidden-HostCall {param([string]$Name) $script:forbiddenCalls.Add($Name); throw ('UNSAFE_HOST_BOUNDARY:'+ $Name)}
function Start-Process { Forbidden-HostCall 'Start-Process' }
function Stop-Process { Forbidden-HostCall 'Stop-Process' }
function Stop-Service { Forbidden-HostCall 'Stop-Service' }
function Start-Service { Forbidden-HostCall 'Start-Service' }
function Set-Service { Forbidden-HostCall 'Set-Service' }
function New-ItemProperty { Forbidden-HostCall 'New-ItemProperty' }
function Set-ItemProperty { Forbidden-HostCall 'Set-ItemProperty' }
function Remove-ItemProperty { Forbidden-HostCall 'Remove-ItemProperty' }
function sc.exe { Forbidden-HostCall 'sc.exe' }
function reg.exe { Forbidden-HostCall 'reg.exe' }

Run-Case 'durable snapshot required before any mutation' {
  Add-ServiceFixture 'EgoistShieldCore'
  $records=Get-OriginalRecords
  Refused {Suspend-InstallerServiceRestarts $records $snapshotPath $script:OwnedPath {throw 'Stop was reached.'}} '*must be durable*'
  Require ($script:trace.Count -eq 0) 'Missing snapshot changed SCM.'
}
Run-Case 'snapshot mismatch rejects entire set before partial mutation' {
  Add-ServiceFixture 'EgoistShieldCore'; Add-ServiceFixture 'EgoistShieldZapret'
  $records=Get-OriginalRecords; Save-OriginalFixture $records
  $records[1].startMode='Manual'
  Refused {Suspend-InstallerServiceRestarts $records $snapshotPath $script:OwnedPath {throw 'Stop was reached.'}} '*snapshot mismatch*'
  Require ($script:trace.Count -eq 1) 'Mismatch allowed early Core disable.'
}
Run-Case 'snapshot delayed-auto mismatch rejects before mutation' {
  Add-ServiceFixture 'EgoistShieldCore' -Delayed $true
  $records=Get-OriginalRecords; Save-OriginalFixture $records
  $records[0].delayedAutoStart=$false
  Refused {Suspend-InstallerServiceRestarts $records $snapshotPath $script:OwnedPath {throw 'Stop was reached.'}} '*snapshot mismatch*'
  Require ($script:trace.Count -eq 1) 'Delayed mismatch mutated policy.'
}
Run-Case 'duplicate saved registration refuses before mutation' {
  Add-ServiceFixture 'EgoistShieldCore'
  $records=Get-OriginalRecords; Save-OriginalFixture @($records[0],$records[0])
  Refused {Suspend-InstallerServiceRestarts $records $snapshotPath $script:OwnedPath {throw 'Stop was reached.'}} '*snapshot mismatch*'
  Require ($script:trace.Count -eq 1) 'Duplicate durable registration mutated policy.'
}
Run-Case 'malformed durable snapshot does not authorize quiescence' {
  Add-ServiceFixture 'EgoistShieldCore'
  $records=Get-OriginalRecords
  [IO.File]::WriteAllText($snapshotPath, '{"services":[')
  Refused {Suspend-InstallerServiceRestarts $records $snapshotPath $script:OwnedPath {throw 'Stop was reached.'}} '*'
  Require ($script:trace.Count -eq 0) 'Malformed snapshot allowed a policy change.'
}
Run-Case 'foreign record invalidates the complete suspend set' {
  Add-ServiceFixture 'EgoistShieldCore'; Add-ServiceFixture 'dnscrypt-proxy' -Path 'C:\Foreign\dnscrypt-proxy.exe'
  $records=Get-OriginalRecords; Save-OriginalFixture $records
  Refused {Suspend-InstallerServiceRestarts $records $snapshotPath $script:OwnedPath {throw 'Stop was reached.'}} '*Unverified service maintenance record*'
  Require ($script:trace.Count -eq 1) 'Foreign record allowed prior mutation.'
}
Run-Case 'Core disabled and stopped before component policy changes' {
  Add-ServiceFixture 'EgoistShieldCore'; Add-ServiceFixture 'EgoistShieldZapret'; Add-ServiceFixture 'EgoistShieldSystemDoH'
  $records=Get-OriginalRecords; Save-OriginalFixture $records -Envelope
  Suspend-InstallerServiceRestarts $records $snapshotPath $script:OwnedPath {
    param($Name)
    Require ($script:services[$Name].Start -eq 4) 'Core not Disabled before stop callback.'
    $script:trace.Add('core-stop:'+ $Name); $script:services[$Name].Status='Stopped'
  }
  $stopIndex=$script:trace.IndexOf('core-stop:EgoistShieldCore')
  Require ($stopIndex -gt 1) 'Core stop preceded durable Disabled policy.'
  foreach($name in @('EgoistShieldZapret','EgoistShieldSystemDoH')) {
    Require ($script:trace.IndexOf('config:'+ $name +':start=:disabled') -gt $stopIndex) 'Component policy changed while Core still supervised it.'
  }
}
Run-Case 'legacy Core alias recognized by executable identity' {
  Add-ServiceFixture 'LegacyCoreAlias'; Add-ServiceFixture 'OldProxyAlias'
  $records=Get-OriginalRecords; Save-OriginalFixture $records
  Suspend-InstallerServiceRestarts $records $snapshotPath $script:OwnedPath {param($Name)$script:trace.Add('core-stop:'+ $Name)}
  Require ($script:trace.Contains('core-stop:LegacyCoreAlias')) 'Legacy Core was not paused.'
  Require ($script:trace.IndexOf('core-stop:LegacyCoreAlias') -lt $script:trace.IndexOf('config:OldProxyAlias:start=:disabled')) 'Alias supervisor remained active during component disable.'
}
Run-Case 'queued restart independent of recovery array is blocked by Disabled' {
  Add-ServiceFixture 'EgoistShieldZapret'
  $script:queuedRestarts.Add(@{name='EgoistShieldZapret';at=$script:clock.AddMilliseconds(200);attempted=$false})
  Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath
  Require ($script:blockedRestarts -eq 1 -and $script:completedRestarts -eq 0) 'Queued recovery restarted a paused service.'
  Require ($script:services['EgoistShieldZapret'].Status -eq 'Stopped') 'Queued restart broke stopped state.'
}
Run-Case 'queued restart fixture detects failure-actions-only suppression' {
  Add-ServiceFixture 'EgoistShieldZapret'
  $script:services['EgoistShieldZapret'].FailureActions=[byte[]]@()
  $script:queuedRestarts.Add(@{name='EgoistShieldZapret';at=$script:clock.AddMilliseconds(200);attempted=$false})
  Start-Sleep -Milliseconds 250
  Require ($script:completedRestarts -eq 1 -and $script:blockedRestarts -eq 0) 'Queue fixture incorrectly erased an already queued action.'
}
Run-Case 'original policy survives suspend and mixed-mode restoration' {
  Add-ServiceFixture 'EgoistShieldCore' -Mode Auto -Delayed $true
  Add-ServiceFixture 'OldProxyAlias' -Mode Manual -Status Stopped
  Add-ServiceFixture 'EgoistShieldGravitylessDNS' -Mode Disabled -Status Stopped
  $records=Get-OriginalRecords; Save-OriginalFixture $records
  $originalBytes=[IO.File]::ReadAllText($snapshotPath)
  Suspend-InstallerServiceRestarts $records $snapshotPath $script:OwnedPath {param($Name)$script:services[$Name].Status='Stopped'}
  Restore-InstallerServiceStartModes $records $script:OwnedPath
  Require ($script:services['EgoistShieldCore'].Start -eq 2 -and $script:services['EgoistShieldCore'].DelayedAutoStart -eq 1) 'Delayed Auto was lost.'
  Require ($script:services['OldProxyAlias'].Start -eq 3 -and $script:services['OldProxyAlias'].Status -eq 'Stopped') 'Manual stopped intent changed.'
  Require ($script:services['EgoistShieldGravitylessDNS'].Start -eq 4 -and $script:services['EgoistShieldGravitylessDNS'].Status -eq 'Stopped') 'Disabled intent changed.'
  Require ([IO.File]::ReadAllText($snapshotPath) -ceq $originalBytes) 'Original durable snapshot was overwritten.'
}
Run-Case 'original recovery settings remain intact during temporary startup pause' {
  Add-ServiceFixture 'EgoistShieldZapret'
  $before=[Convert]::ToBase64String($script:services['EgoistShieldZapret'].FailureActions)
  Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath
  Require ([Convert]::ToBase64String($script:services['EgoistShieldZapret'].FailureActions) -ceq $before) 'Temporary pause destroyed recovery bytes.'
  Require ($script:services['EgoistShieldZapret'].FailureActionsOnNonCrashFailures -eq 1) 'Temporary pause changed non-crash recovery flag.'
}
Run-Case 'partial suspend failure can restore all original startup modes' {
  Add-ServiceFixture 'EgoistShieldCore' -Delayed $true; Add-ServiceFixture 'ComponentA' -Mode Manual; Add-ServiceFixture 'ComponentB' -Mode Auto
  $records=Get-OriginalRecords; Save-OriginalFixture $records
  $script:configFailureFor='ComponentB'
  Refused {Suspend-InstallerServiceRestarts $records $snapshotPath $script:OwnedPath {param($Name)$script:services[$Name].Status='Stopped'}} '*configuration denied*'
  Require ($script:services['EgoistShieldCore'].Start -eq 4 -and $script:services['ComponentA'].Start -eq 4) 'Fixture did not reach a genuine partial pause.'
  $script:configFailureFor=''; Restore-InstallerServiceStartModes $records $script:OwnedPath
  Require ($script:services['EgoistShieldCore'].Start -eq 2 -and $script:services['EgoistShieldCore'].DelayedAutoStart -eq 1 -and $script:services['ComponentA'].Start -eq 3 -and $script:services['ComponentB'].Start -eq 2) 'Original partial-failure policy could not be restored.'
}
Run-Case 'startup readback failure prevents stop or Core callback' {
  Add-ServiceFixture 'EgoistShieldCore'
  $records=Get-OriginalRecords; Save-OriginalFixture $records
  $script:skipConfigWrite=$true
  Refused {Suspend-InstallerServiceRestarts $records $snapshotPath $script:OwnedPath {throw 'Core callback was incorrectly reached.'}} '*startup readback failed*'
  Require ($script:trace.Count -eq 2) 'Readback failure proceeded past config.'
}
Run-Case 'foreign exclusive service is never configured or stopped' {
  Add-ServiceFixture 'EgoistShieldCore' -Path 'C:\Foreign\EgoistShield.Service.exe'
  Refused {Stop-InstallerOwnedService 'EgoistShieldCore' $script:OwnedPath} '*non-owned service*'
  Require ($script:trace.Count -eq 0 -and $script:killCount -eq 0) 'Foreign exclusive service was changed.'
}
Run-Case 'foreign shared basename service is never configured' {
  Add-ServiceFixture 'dnscrypt-proxy' -Path 'C:\Foreign\dnscrypt-proxy.exe'
  Refused {Set-InstallerServiceStartMode 'dnscrypt-proxy' Disabled $false $script:OwnedPath} '*non-owned service*'
  Require ($script:trace.Count -eq 0) 'Third-party resolver startup changed.'
}
Run-Case 'arbitrary owned alias can be paused and restored' {
  Add-ServiceFixture 'OldXrayProxyAlias' -Mode Manual -Status Stopped
  $records=Get-OriginalRecords; Save-OriginalFixture $records
  Suspend-InstallerServiceRestarts $records $snapshotPath $script:OwnedPath {throw 'Unexpected Core alias.'}
  Require ($script:services['OldXrayProxyAlias'].Start -eq 4) 'Owned alias was skipped.'
  Restore-InstallerServiceStartModes $records $script:OwnedPath
  Require ($script:services['OldXrayProxyAlias'].Start -eq 3) 'Owned alias mode was not restored.'
}
Run-Case 'legacy alias with wildcard brackets is queried as a literal service name' {
  Add-ServiceFixture 'OldProxy[x]' -Mode Manual -Status Stopped
  $records=Get-OriginalRecords
  Stop-InstallerOwnedService 'OldProxy[x]' $script:OwnedPath
  Require ($script:lastServicePattern -ceq [Management.Automation.WildcardPattern]::Escape('OldProxy[x]')) 'Bracket alias was queried as a wildcard pattern.'
  Restore-InstallerServiceStartModes $records $script:OwnedPath
  Require ($script:services['OldProxy[x]'].Start -eq 3) 'Literal legacy alias policy was not restored.'
}
Run-Case 'policy resume preserves newly migrated ImagePath' {
  Add-ServiceFixture 'EgoistShieldZapret'
  $records=Get-OriginalRecords
  $newPath=Join-Path $fixtureRoot 'new-version\wrapper.exe'
  $script:services['EgoistShieldZapret'].ImagePath=$newPath
  $script:services['EgoistShieldZapret'].Start=4
  Restore-InstallerServiceStartModes $records $script:OwnedPath
  Require ($script:services['EgoistShieldZapret'].ImagePath -ceq $newPath) 'Resume reverted the new ImagePath.'
}
Run-Case 'policy resume rejects registration replaced by foreign executable' {
  Add-ServiceFixture 'EgoistShieldZapret'
  $records=Get-OriginalRecords
  $script:services['EgoistShieldZapret'].ImagePath='C:\Foreign\substituted.exe'
  Refused {Restore-InstallerServiceStartModes $records $script:OwnedPath} '*non-owned service*'
  Require ($script:trace.Count -eq 0) 'Resume configured a foreign registration.'
}
Run-Case 'post-change foreign registration fails policy readback' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:substituteOnConfig=$true
  Refused {Set-InstallerServiceStartMode 'EgoistShieldZapret' Disabled $false $script:OwnedPath} '*startup readback failed*'
}
Run-Case 'surviving verified process is killed by its held handle and disposed' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'
  $script:queuedRestarts.Add(@{name='EgoistShieldZapret';at=$script:clock.AddSeconds(16);attempted=$false})
  Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath
  Start-Sleep -Seconds 2
  Require ($script:killCount -eq 1 -and $script:disposeCount -eq 1) 'Held process was not terminated and disposed exactly once.'
  Require ($script:blockedRestarts -eq 1 -and $script:completedRestarts -eq 0) 'Kill allowed queued service recovery.'
  Require ($script:trace.IndexOf('config:EgoistShieldZapret:start=:disabled') -lt $script:trace.IndexOf('owned-handle-kill')) 'Kill preceded startup pause.'
}
Run-Case 'reused PID birth cannot authorize termination' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'; $script:reusedPid=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*identity changed*'
  Require ($script:killCount -eq 0 -and $script:disposeCount -eq 1) 'Reused PID was terminated or handle leaked.'
}
Run-Case 'CIM process with foreign executable cannot be killed' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'; $script:foreignCimProcess=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*unverified process*'
  Require ($script:killCount -eq 0) 'Foreign process was terminated.'
}
Run-Case 'fresh process path mismatch rejects even another owned executable' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'; $script:processPathMismatch=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*identity changed*'
  Require ($script:killCount -eq 0 -and $script:disposeCount -eq 1) 'Mismatched PID executable was killed.'
}
Run-Case 'foreign cohosted service prevents process kill' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'; $script:foreignSharedService=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*shared with a foreign service*'
  Require ($script:killCount -eq 0) 'Foreign shared service process was terminated.'
}
Run-Case 'CIM ownership unavailable fails closed before process kill' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'; $script:cimFailure=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*CIM unavailable*'
  Require ($script:killCount -eq 0) 'Unknown CIM ownership allowed a kill.'
}
Run-Case 'missing surviving CIM record is not successful drain' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'; $script:missingCimRecord=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*Cannot prove a surviving*'
  Require ($script:killCount -eq 0) 'Missing CIM ownership allowed a kill.'
}
Run-Case 'changed surviving service registration prevents process kill' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'; $script:foreignCimService=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*Cannot prove a surviving*'
  Require ($script:killCount -eq 0) 'Changed service registration allowed a kill.'
}
Run-Case 'missing process creation evidence prevents termination' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'; $script:missingCreationDate=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*identity changed*'
  Require ($script:killCount -eq 0 -and $script:disposeCount -eq 1) 'Unknown process birth authorized a kill.'
}
Run-Case 'process exit timeout is not successful stop' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'; $script:processExitFailure=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*did not exit*'
  Require ($script:killCount -eq 1 -and $script:disposeCount -eq 1) 'Exit timeout did not dispose its held handle.'
}
Run-Case 'process handle access failure cannot authorize termination' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'; $script:handleFailure=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*handle*'
  Require ($script:killCount -eq 0 -and $script:disposeCount -eq 1) 'Handle acquisition failure allowed a kill or leaked its object.'
}
Run-Case 'zero process handle cannot authorize termination' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'; $script:zeroHandle=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*handle*'
  Require ($script:killCount -eq 0 -and $script:disposeCount -eq 1) 'Zero handle allowed a kill or leaked its object.'
}
Run-Case 'missing native process cannot mask a still-running registration' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stopDisposition='stubborn'; $script:missingProcess=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*did not remain stopped*'
  Require ($script:killCount -eq 0) 'Missing process caused unexpected termination.'
}
Run-Case 'transient stopped sample does not satisfy stable stop' {
  Add-ServiceFixture 'EgoistShieldZapret'
  $queue=[Collections.Generic.Queue[string]]::new(); $queue.Enqueue('Stopped')
  1..12 | ForEach-Object {$queue.Enqueue('Running');$queue.Enqueue('Stopped')}
  $script:stateQueues['EgoistShieldZapret']=$queue
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*did not remain stopped*'
}
Run-Case 'graceful stopped service is confirmed twice without process kill' {
  Add-ServiceFixture 'EgoistShieldZapret'
  Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath
  Require ($script:stateReadCount -ge 3 -and $script:killCount -eq 0) 'Stopped service was not independently confirmed.'
}
Run-Case 'SCM state query unavailable is not absence' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:stateFailure=$true
  Refused {Get-InstallerServiceState 'EgoistShieldZapret'} '*state unavailable*'
}
Run-Case 'specific service-not-found state is accepted as absence' {
  $script:serviceAbsence=$true
  Require ($null -eq (Get-InstallerServiceState 'MissingAlias')) 'Specific missing service was not absence.'
}
Run-Case 'registry query unavailable does not silently skip service' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:registryFailure=$true
  Refused {Stop-InstallerOwnedService 'EgoistShieldZapret' $script:OwnedPath} '*registry unavailable*'
  Require ($script:trace.Count -eq 0) 'Registry uncertainty changed SCM.'
}
Run-Case 'missing registry service causes no SCM mutation' {
  Stop-InstallerOwnedService 'MissingAlias' $script:OwnedPath
  Require ($script:trace.Count -eq 0) 'Missing registration caused an SCM command.'
}
Run-Case 'invalid preserved mode rejects before configuration' {
  Add-ServiceFixture 'EgoistShieldZapret'
  Refused {Set-InstallerServiceStartMode 'EgoistShieldZapret' 'Boot' $false $script:OwnedPath} '*Invalid preserved service start mode*'
  Require ($script:trace.Count -eq 0) 'Invalid mode changed SCM.'
}
Run-Case 'Automatic synonym restores Auto with delayed startup' {
  Add-ServiceFixture 'EgoistShieldZapret' -Mode Disabled
  Set-InstallerServiceStartMode 'EgoistShieldZapret' Automatic $true $script:OwnedPath
  Require ($script:services['EgoistShieldZapret'].Start -eq 2 -and $script:services['EgoistShieldZapret'].DelayedAutoStart -eq 1) 'Automatic delayed synonym did not round-trip.'
}
Run-Case 'unsupported driver start mode rejects policy read' {
  Add-ServiceFixture 'EgoistShieldZapret'; $script:services['EgoistShieldZapret'].Start=0
  Refused {Get-InstallerServicePolicy 'EgoistShieldZapret'} '*Unsupported service start mode*'
}

$passed=@($script:cases | Where-Object {$_.passed}).Count
$receipt=[ordered]@{
  schemaVersion=1; suite='installer-service-maintenance'; caseCount=$script:cases.Count; passed=$passed;
  failed=($script:cases.Count-$passed); productionSourceSha256=$sourceHash;
  productionFunctions=$productionFunctions; powerShellVersion=$PSVersionTable.PSVersion.ToString();
  boundary='Actual production functions, in-memory SCM/registry/process identity and virtual time, actual task-owned JSON snapshots';
  forbiddenHostCallAttempts=$script:forbiddenCalls.Count;
  realOsMutations=[ordered]@{scm=0;registry=0;network=0;processKills=0};
  unverified=@('Native Windows SCM queued recovery behavior','Real installer upgrade/rollback','Power interruption/reboot recovery','Multi-process installer watchdog','Long duration service availability');
  cases=@($script:cases.ToArray())
}
[IO.File]::WriteAllText($ReceiptPath, ($receipt|ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
Write-Output ($receipt|ConvertTo-Json -Depth 8)
if ($receipt.failed -ne 0 -or $receipt.forbiddenHostCallAttempts -ne 0) { exit 1 }
