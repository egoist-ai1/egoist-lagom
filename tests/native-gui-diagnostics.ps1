[CmdletBinding()]
param([switch]$LibraryOnly,[string]$TestDirectory='')

function Get-NativeGuiProcessDiagnostics {
  param([Diagnostics.Process]$Process,[string]$ExpectedImage='')
  $record=[ordered]@{status='missing';processId=$null;birthUtc=$null;sessionId=$null;imageMatchesExpected=$null;readbackErrorType=$null}
  if(-not $Process){return $record}
  try{
    $record.processId=$Process.Id;$record.birthUtc=$Process.StartTime.ToUniversalTime().ToString('o');$record.sessionId=$Process.SessionId
    if($ExpectedImage){$record.imageMatchesExpected=($Process.MainModule.FileName -ieq $ExpectedImage)}
    $record.status='complete'
  }catch{$record.status='fault';$record.readbackErrorType=$_.Exception.GetType().FullName}
  return $record
}
function Get-NativeGuiParentWindowStation {
  $record=[ordered]@{observed=$false;visible=$null;errorCode=$null;errorType=$null}
  try{
    if(-not ('LagomNativeGuiWindowStation' -as [type])){
      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LagomNativeGuiWindowStation {
  [StructLayout(LayoutKind.Sequential)] struct Flags { public int inherit; public int reserved; public uint flags; }
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll", EntryPoint="GetUserObjectInformationW", SetLastError=true)]
  static extern bool GetUserObjectInformation(IntPtr handle, int index, out Flags flags, int length, out int needed);
  public static int Visible() {
    Flags flags; int needed; IntPtr handle=GetProcessWindowStation();
    if(handle==IntPtr.Zero || !GetUserObjectInformation(handle,1,out flags,Marshal.SizeOf(typeof(Flags)),out needed))
      return -Math.Max(1,Marshal.GetLastWin32Error());
    return (flags.flags & 1)==1 ? 1 : 0;
  }
}
"@
    }
    $value=[LagomNativeGuiWindowStation]::Visible()
    if($value -ge 0){$record.observed=$true;$record.visible=($value -eq 1)}else{$record.errorCode=-$value}
  }catch{$record.errorType=$_.Exception.GetType().FullName}
  return $record
}
function New-NativeGuiLaunchDiagnostics {
  param([Diagnostics.ProcessStartInfo]$StartInfo,[string]$Work,[ValidatePattern('^[a-z0-9-]+$')][string]$Label)
  Assert-NativeOrdinaryPath -Path $Work
  $rawDirectory=Assert-NativePathWithin (Join-Path $Work 'gui-diagnostic-raw') $Work
  if(-not [IO.Directory]::Exists($rawDirectory)){[void][IO.Directory]::CreateDirectory($rawDirectory)}
  Assert-NativeOrdinaryPath -Path $rawDirectory
  $raw=Assert-NativePathWithin (Join-Path $rawDirectory ($Label+'.chromium.log')) $Work
  $file=[IO.File]::Open($raw,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite);$file.Dispose()
  # These documented Electron settings affect only this owned child's logging.
  $StartInfo.EnvironmentVariables['ELECTRON_ENABLE_LOGGING']='1'
  $StartInfo.EnvironmentVariables['ELECTRON_LOG_FILE']=$raw
  $StartInfo.EnvironmentVariables['ELECTRON_ENABLE_STACK_DUMPING']='1'
  $parent=[Diagnostics.Process]::GetCurrentProcess()
  try{$parentRecord=Get-NativeGuiProcessDiagnostics $parent}finally{$parent.Dispose()}
  $empty=([string]$StartInfo.Arguments -eq '')
  if($StartInfo.PSObject.Properties['ArgumentList']){$empty=$empty -and $StartInfo.ArgumentList.Count -eq 0}
  $argumentProof=@();if(-not $empty){$argumentProof=$null}
  $forbidden=@($StartInfo.EnvironmentVariables.Keys | Where-Object {$_ -match '^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH|LAGOM_TEST_USER_DATA_DIR|SHIELD_.*|EGOIST_.*)$'})
  return [ordered]@{schemaVersion=1;label=$Label;parent=$parentRecord;parentWindowStation=(Get-NativeGuiParentWindowStation);child=$null;childWindowStationObserved=$false;sessionMatchesParent=$null;launch=[ordered]@{executable=$StartInfo.FileName;workingDirectory=$StartInfo.WorkingDirectory;emptyArguments=$empty;arguments=$argumentProof;useShellExecute=$StartInfo.UseShellExecute;createNoWindow=$StartInfo.CreateNoWindow};environmentPolicy=[ordered]@{forbiddenVariableCount=$forbidden.Count;nodeEnvironmentIsProduction=($StartInfo.EnvironmentVariables['NODE_ENV'] -ceq 'production');appDataIsAbsolute=[IO.Path]::IsPathRooted([string]$StartInfo.EnvironmentVariables['APPDATA']);tempIsAbsolute=[IO.Path]::IsPathRooted([string]$StartInfo.EnvironmentVariables['TEMP']);loggingEnabled=$true;stackDumpingEnabled=$true;loggingPathWithinWork=$true};chromiumRawPath=$raw}
}
function Write-NativeGuiDiagnosticTail {
  param([byte[]]$Bytes,[long]$SourceBytes,[string]$Path,[string]$Work)
  $path=Assert-NativePathWithin $Path $Work;Assert-NativeOrdinaryPath -Path ([IO.Path]::GetDirectoryName($path))
  $offset=[Math]::Max(0,$Bytes.Length-1048576)
  # Keep the exported UTF-8 tail within its byte limit without starting mid-codepoint.
  while($offset -lt $Bytes.Length -and ($Bytes[$offset] -band 192) -eq 128){$offset++}
  $length=$Bytes.Length-$offset
  $file=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try{$file.Write($Bytes,$offset,$length)}finally{$file.Dispose()}
  $sha=[Security.Cryptography.SHA256]::Create();$file=[IO.File]::OpenRead($path)
  try{$hash=[BitConverter]::ToString($sha.ComputeHash($file)).Replace('-','').ToLowerInvariant()}finally{$file.Dispose();$sha.Dispose()}
  return [ordered]@{status='complete';bytes=$length;sourceBytes=$SourceBytes;truncated=($SourceBytes -gt $length);sha256=$hash}
}
function Complete-NativeGuiDiagnostics {
  param([Threading.Tasks.Task]$Stdout,[Threading.Tasks.Task]$Stderr,[Collections.IDictionary]$Launch,[string]$Work,[ValidatePattern('^[a-z0-9-]+$')][string]$Label)
  # This function never throws: diagnostics must preserve the original native failure.
  $record=[ordered]@{schemaVersion=1;label=$Label;launch=$Launch;drainLimitMilliseconds=2000;drainElapsedMilliseconds=0;streams=@();chromium=[ordered]@{status='missing'};writeStatus='missing';errorType=$null}
  try{
    $tasks=@();if($Stdout){$tasks+=$Stdout};if($Stderr){$tasks+=$Stderr}
    $watch=[Diagnostics.Stopwatch]::StartNew()
    if($tasks.Count){
      $all=[Threading.Tasks.Task]::WhenAll([Threading.Tasks.Task[]]$tasks)
      while(-not $all.IsCompleted -and $watch.ElapsedMilliseconds -lt 2000){[Threading.Thread]::Sleep(10)}
    }
    $record.drainElapsedMilliseconds=$watch.ElapsedMilliseconds
    foreach($entry in @(@{name='stdout';task=$Stdout},@{name='stderr';task=$Stderr})){
      $stream=[ordered]@{name=$entry.name;status='missing';taskStatus=$null;capture=$null;errorType=$null}
      if($entry.task){
        $stream.taskStatus=[string]$entry.task.Status
        if($entry.task.Status -eq [Threading.Tasks.TaskStatus]::RanToCompletion){
          $stream.status='complete'
          try{
            $text=[string]$entry.task.GetAwaiter().GetResult();$utf8=[Text.UTF8Encoding]::new($false)
            $sourceBytes=$utf8.GetByteCount($text);$tail=$text.Substring([Math]::Max(0,$text.Length-1048576))
            $stream.capture=Write-NativeGuiDiagnosticTail -Bytes $utf8.GetBytes($tail) -SourceBytes $sourceBytes -Path (Join-Path $Work ($Label+'.'+$entry.name+'.txt')) -Work $Work
          }catch{$stream.capture=[ordered]@{status='fault';errorType=$_.Exception.GetType().FullName}}
        }elseif($entry.task.IsFaulted -or $entry.task.IsCanceled){
          $stream.status='fault';if($entry.task.Exception){$stream.errorType=$entry.task.Exception.GetBaseException().GetType().FullName}
        }else{$stream.status='timeout'}
      }
      $record.streams+=$stream
    }
    if($Launch -and $Launch['chromiumRawPath']){
      try{
        $raw=Assert-NativePathWithin ([string]$Launch['chromiumRawPath']) $Work;Assert-NativeOrdinaryPath -Path $raw -Leaf
        $file=[IO.File]::Open($raw,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
        try{
          $size=$file.Length;$count=[int][Math]::Min($size,1048576);$buffer=[byte[]]::new($count);[void]$file.Seek($size-$count,[IO.SeekOrigin]::Begin)
          $read=0;while($read -lt $count){$n=$file.Read($buffer,$read,$count-$read);if($n -eq 0){break};$read+=$n}
          if($read -ne $count){throw 'Owned Chromium log changed while reading its bounded tail.'}
        }finally{$file.Dispose()}
        $record.chromium=Write-NativeGuiDiagnosticTail -Bytes $buffer -SourceBytes $size -Path (Join-Path $Work ($Label+'.chromium.txt')) -Work $Work
      }catch{$record.chromium=[ordered]@{status='fault';errorType=$_.Exception.GetType().FullName}}
    }
    $path=Assert-NativePathWithin (Join-Path $Work ($Label+'.diagnostics.json')) $Work;Assert-NativeOrdinaryPath -Path $Work
    $record.writeStatus='complete';$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record|ConvertTo-Json -Depth 12))
    if($bytes.Length -gt 32768){throw 'Fixed-schema GUI diagnostics exceeded 32 KiB.'}
    $file=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$file.Write($bytes,0,$bytes.Length)}finally{$file.Dispose()}
  }catch{$record.writeStatus='fault';$record.errorType=$_.Exception.GetType().FullName}
  return $record
}

if($LibraryOnly){return}
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-production-acceptance.ps1') -LibraryOnly
if(-not $TestDirectory -or -not [IO.Path]::IsPathRooted($TestDirectory)){throw 'Fixture requires an absolute own TestDirectory.'}
Assert-NativeOrdinaryPath -Path $TestDirectory
Add-Type -TypeDefinition @"
using System;
using System.Threading.Tasks;
public static class LagomNativeGuiFixtureTasks {
  public static Task<string> Now(string text) { return Task.FromResult(text); }
  public static Task<string> Later(int milliseconds,string text) { return Task.Delay(milliseconds).ContinueWith(_ => text); }
  public static Task<string> Fault() { var task=new TaskCompletionSource<string>();task.SetException(new InvalidOperationException("fixture fault"));return task.Task; }
  public static Task<string> Never() { return new TaskCompletionSource<string>().Task; }
}
"@
$groups=[Collections.Generic.List[string]]::new()
function Assert-DiagnosticFixture { param([bool]$Condition,[string]$Message) if(-not $Condition){throw $Message} }
$immediate=Complete-NativeGuiDiagnostics -Stdout ([LagomNativeGuiFixtureTasks]::Now('immediate out')) -Stderr ([LagomNativeGuiFixtureTasks]::Now('immediate err')) -Work $TestDirectory -Label 'immediate'
Assert-DiagnosticFixture ($immediate.streams[0].status -eq 'complete' -and $immediate.streams[1].status -eq 'complete') 'Immediate completed streams were lost.'
Assert-DiagnosticFixture ([IO.File]::ReadAllText((Join-Path $TestDirectory 'immediate.stdout.txt')) -eq 'immediate out') 'Immediate stdout bytes changed.'
$groups.Add('immediate completion')
$delayed=Complete-NativeGuiDiagnostics -Stdout ([LagomNativeGuiFixtureTasks]::Later(120,'delayed out')) -Stderr ([LagomNativeGuiFixtureTasks]::Later(300,'delayed err')) -Work $TestDirectory -Label 'delayed'
Assert-DiagnosticFixture ($delayed.streams[0].status -eq 'complete' -and $delayed.streams[1].status -eq 'complete' -and $delayed.drainElapsedMilliseconds -ge 200) 'Common drain did not retain delayed streams.'
$groups.Add('delayed completion')
$timeout=Complete-NativeGuiDiagnostics -Stdout ([LagomNativeGuiFixtureTasks]::Never()) -Stderr ([LagomNativeGuiFixtureTasks]::Never()) -Work $TestDirectory -Label 'timeout'
Assert-DiagnosticFixture ($timeout.streams[0].status -eq 'timeout' -and $timeout.streams[1].status -eq 'timeout' -and $timeout.drainElapsedMilliseconds -ge 1900 -and $timeout.drainElapsedMilliseconds -lt 5000) 'Streams did not share one bounded two-second timeout.'
$groups.Add('common timeout')
$fault=Complete-NativeGuiDiagnostics -Stdout ([LagomNativeGuiFixtureTasks]::Fault()) -Stderr ([LagomNativeGuiFixtureTasks]::Later(300,'surviving stderr')) -Work $TestDirectory -Label 'fault'
Assert-DiagnosticFixture ($fault.streams[0].status -eq 'fault' -and $fault.streams[1].status -eq 'complete' -and $fault.drainElapsedMilliseconds -ge 200) 'Fault masked a delayed surviving stream.'
$missing=Complete-NativeGuiDiagnostics -Work $TestDirectory -Label 'missing'
Assert-DiagnosticFixture ($missing.streams[0].status -eq 'missing' -and $missing.streams[1].status -eq 'missing') 'Absent streams were misreported.'
$groups.Add('fault and missing')
$long='discarded head'+([string][char]0x0436)*600000+' retained tail'
$tail=Complete-NativeGuiDiagnostics -Stdout ([LagomNativeGuiFixtureTasks]::Now($long)) -Work $TestDirectory -Label 'tail'
$tailPath=Join-Path $TestDirectory 'tail.stdout.txt';$tailText=[Text.UTF8Encoding]::new($false,$true).GetString([IO.File]::ReadAllBytes($tailPath))
Assert-DiagnosticFixture ($tail.streams[0].capture.truncated -and (Get-Item -LiteralPath $tailPath).Length -le 1048576 -and $tailText.EndsWith(' retained tail') -and -not $tailText.Contains('discarded head')) 'Bounded UTF-8 tail did not retain the final marker.'
$groups.Add('UTF8 tail truncation')
$names=@('ELECTRON_ENABLE_LOGGING','ELECTRON_LOG_FILE','ELECTRON_ENABLE_STACK_DUMPING','NODE_ENV','TEMP','APPDATA','SHIELD_FIXTURE_ONLY','EGOIST_FIXTURE_ONLY')
$before=@{};foreach($name in $names){$before[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
$info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe';$info.WorkingDirectory=$TestDirectory;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
$info.EnvironmentVariables['SHIELD_FIXTURE_ONLY']='own fixture';$info.EnvironmentVariables['EGOIST_FIXTURE_ONLY']='own fixture';$info.EnvironmentVariables['ELECTRON_RUN_AS_NODE']='1'
foreach($name in @($info.EnvironmentVariables.Keys)){if($name -match '^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH|LAGOM_TEST_USER_DATA_DIR|SHIELD_.*|EGOIST_.*)$'){[void]$info.EnvironmentVariables.Remove($name)}}
$info.EnvironmentVariables['NODE_ENV']='production'
$launch=New-NativeGuiLaunchDiagnostics -StartInfo $info -Work $TestDirectory -Label 'owned-child'
Assert-DiagnosticFixture ($launch.launch.emptyArguments -and $launch.environmentPolicy.forbiddenVariableCount -eq 0 -and $launch.childWindowStationObserved -eq $false) 'Empty launch or environment proof changed.'
foreach($name in $names){Assert-DiagnosticFixture ($before[$name] -ceq [Environment]::GetEnvironmentVariable($name,'Process')) 'Diagnostic setup mutated the parent environment.'}
[IO.File]::WriteAllText($launch.chromiumRawPath,('discarded chromium'+('x'*1100000)+' chromium tail'),[Text.UTF8Encoding]::new($false))
$info.Arguments='-NoLogo -NoProfile -NonInteractive -Command "[Console]::Out.Write(''owned child stdout'');[Console]::Error.Write(''owned child stderr'');[Threading.Thread]::Sleep(100)"'
$child=[Diagnostics.Process]::new();$child.StartInfo=$info
try{
  Assert-DiagnosticFixture ($child.Start()) 'Owned fixture child did not start.'
  $launch.child=Get-NativeGuiProcessDiagnostics -Process $child -ExpectedImage $info.FileName
  $launch.sessionMatchesParent=($launch.child.sessionId -eq $launch.parent.sessionId)
  $stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
  Assert-DiagnosticFixture ($child.WaitForExit(10000) -and $child.ExitCode -eq 0) 'Owned fixture child did not exit zero.'
  $actual=Complete-NativeGuiDiagnostics -Stdout $stdout -Stderr $stderr -Launch $launch -Work $TestDirectory -Label 'owned-child'
  Assert-DiagnosticFixture ($launch.child.status -eq 'complete' -and $launch.child.processId -eq $child.Id -and $launch.child.birthUtc -and $launch.child.imageMatchesExpected -and $launch.sessionMatchesParent) 'Own child PID/birth/session/image proof unavailable.'
  Assert-DiagnosticFixture ($actual.streams[0].status -eq 'complete' -and $actual.streams[1].status -eq 'complete' -and $actual.chromium.truncated -and $actual.chromium.bytes -le 1048576) 'Actual child streams or bounded Chromium tail were lost.'
}finally{if(-not $child.HasExited){$child.Kill();[void]$child.WaitForExit(5000)};$child.Dispose()}
$groups.Add('owned child and Chromium tail')
$groups.Add('parent environment unchanged and fixed identity schema')
$original=$null
try{try{throw 'original native fixture failure'}finally{$result=Complete-NativeGuiDiagnostics -Stdout ([LagomNativeGuiFixtureTasks]::Now('later diagnostic')) -Work (Join-Path $TestDirectory 'missing-directory') -Label 'cannot-write';Assert-DiagnosticFixture ($result.writeStatus -eq 'fault') 'Diagnostic write failure was not recorded.'}}catch{$original=$_.Exception.Message}
Assert-DiagnosticFixture ($original -eq 'original native fixture failure') 'Finally diagnostics masked the original failure.'
$refused=$false;try{[void](Write-NativeGuiDiagnosticTail -Bytes ([byte[]](65)) -SourceBytes 1 -Path (Join-Path $TestDirectory '..\outside.txt') -Work $TestDirectory)}catch{$refused=$true}
Assert-DiagnosticFixture $refused 'Diagnostic export accepted a path outside its own work.'
$groups.Add('failure-preserving finally and path refusal')
[ordered]@{groups=$groups.Count;cases=$groups.ToArray();commonDrainMilliseconds=$timeout.drainElapsedMilliseconds;parentEnvironmentUnchanged=$true;childIdentityObserved=$true;childWindowStationObserved=$false;parentWindowStationObserved=$launch.parentWindowStation.observed;liveGuiLaunches=0;liveServiceMutations=0;liveNetworkMutations=0;liveRegistryMutations=0}|ConvertTo-Json -Depth 6 -Compress
