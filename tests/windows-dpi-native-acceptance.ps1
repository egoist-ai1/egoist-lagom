# Driver-backed acceptance is restricted to a fresh disposable GitHub Windows VM.
# This script never opens a NETWORK capture handle. Only the unchanged production
# Worker may start winws; our REFLECT handle is SNIFF | RECV_ONLY | NO_INSTALL.
[CmdletBinding()]
param(
  [ValidateSet('Run','GuardOnly')][string]$Mode='Run',
  [string]$IntegrityManifestPath='',
  [string]$CandidateAssetsDirectory='',
  [string]$ExpectedSourceCommit='',
  [string]$EvidenceDirectory='',
  [switch]$LibraryOnly
)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
# Keep caller arguments: the shared library has its own parameter block.
$parameters=@{};foreach($name in @('Mode','IntegrityManifestPath','CandidateAssetsDirectory','ExpectedSourceCommit','EvidenceDirectory','LibraryOnly')){$parameters[$name]=Get-Variable -Name $name -ValueOnly}
. (Join-Path $PSScriptRoot 'windows-production-acceptance.ps1') -LibraryOnly
foreach($name in $parameters.Keys){Set-Variable -Name $name -Value $parameters[$name]}
Remove-Variable parameters

function Initialize-DpiNativeTypes {
  if('LagomDpiAcceptance.Probe' -as [type]){return}
  Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
namespace LagomDpiAcceptance {
  public static class Probe {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool QueryFullProcessImageNameW(IntPtr h, uint flags, StringBuilder path, ref uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetProcessTimes(IntPtr h, out long created, out long exited, out long kernel, out long user);
    public static string Image(IntPtr held) {
      uint size=32768; var b=new StringBuilder((int)size);
      if(!QueryFullProcessImageNameW(held,0,b,ref size)) throw new Win32Exception(Marshal.GetLastWin32Error(),"Held process image query failed");
      return b.ToString();
    }
    public static long BirthTicks(IntPtr held) {
      long born, exited, kernel, user;
      if(!GetProcessTimes(held,out born,out exited,out kernel,out user)) throw new Win32Exception(Marshal.GetLastWin32Error(),"Held process birth query failed");
      return DateTime.FromFileTimeUtc(born).Ticks;
    }
  }
  public sealed class ReflectionRecord {
    public uint Event, ProcessId, Layer;
    public ulong Flags;
    public short Priority;
    public long OpenedTimestamp;
    public string Filter;
  }
  public sealed class FilterProbe : IDisposable {
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern IntPtr LoadLibraryExW(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Ansi,SetLastError=true)]
    static extern IntPtr GetProcAddress(IntPtr module, string name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool FreeLibrary(IntPtr module);
    [UnmanagedFunctionPointer(CallingConvention.Winapi,CharSet=CharSet.Ansi,SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    delegate bool CompileFn(string filter,int layer,StringBuilder output,uint length,out IntPtr error,out uint position);
    [UnmanagedFunctionPointer(CallingConvention.Winapi,CharSet=CharSet.Ansi,SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    delegate bool FormatFn(string filter,int layer,StringBuilder output,uint length);
    [UnmanagedFunctionPointer(CallingConvention.Winapi,CharSet=CharSet.Ansi,SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    delegate bool EvalFn(string filter,[In]byte[] packet,uint length,[In]byte[] address);
    [UnmanagedFunctionPointer(CallingConvention.Winapi,CharSet=CharSet.Ansi,SetLastError=true)]
    delegate IntPtr OpenFn(string filter,int layer,short priority,ulong flags);
    [UnmanagedFunctionPointer(CallingConvention.Winapi,SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    delegate bool ReceiveFn(IntPtr handle,[Out]byte[] packet,uint length,out uint received,ulong flags,[Out]byte[] address,ref uint addressLength,IntPtr overlapped);
    [UnmanagedFunctionPointer(CallingConvention.Winapi,SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    delegate bool CloseFn(IntPtr handle);
    IntPtr module, reflection;
    CompileFn compile; FormatFn format; EvalFn eval; OpenFn open; ReceiveFn receive; CloseFn close;
    Task<ReflectionRecord> pending;
    bool retained;
    T Function<T>(string name) where T:class {
      IntPtr address=GetProcAddress(module,name);
      if(address==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),name);
      return Marshal.GetDelegateForFunctionPointer(address,typeof(T)) as T;
    }
    // Loading/compiling is a userspace operation. Constructor does not open a driver.
    public FilterProbe(string pinnedDll) {
      module=LoadLibraryExW(pinnedDll,IntPtr.Zero,0x100|0x800);
      if(module==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"Pinned WinDivert DLL load failed");
      try {
        compile=Function<CompileFn>("WinDivertHelperCompileFilter"); format=Function<FormatFn>("WinDivertHelperFormatFilter");
        eval=Function<EvalFn>("WinDivertHelperEvalFilter"); open=Function<OpenFn>("WinDivertOpen");
        receive=Function<ReceiveFn>("WinDivertRecvEx"); close=Function<CloseFn>("WinDivertClose");
      } catch { FreeLibrary(module); module=IntPtr.Zero; throw; }
    }
    public string Canonical(string filter) {
      var compiled=new StringBuilder(8192); IntPtr error; uint position;
      if(!compile(filter,0,compiled,8192,out error,out position))
        throw new InvalidOperationException("Filter compilation failed at "+position+": "+Marshal.PtrToStringAnsi(error));
      var canonical=new StringBuilder(8192);
      if(!format(compiled.ToString(),0,canonical,8192)) throw new Win32Exception(Marshal.GetLastWin32Error(),"Filter format failed");
      return canonical.ToString();
    }
    public bool Evaluate(string filter, byte[] packet, uint flags) {
      var address=new byte[80]; Buffer.BlockCopy(BitConverter.GetBytes(flags),0,address,8,4);
      bool matched=eval(filter,packet,(uint)packet.Length,address);
      int error=Marshal.GetLastWin32Error();
      if(!matched && error!=0) throw new Win32Exception(error,"Filter evaluation error is not a negative match");
      return matched;
    }
    public void StartReflection() {
      if(reflection!=IntPtr.Zero) throw new InvalidOperationException("Reflection already started");
      // Observe ALL non-REFLECT handles: any foreign or extra layer is a failure.
      reflection=open("true",4,0,1UL|4UL|16UL);
      if(reflection==new IntPtr(-1) || reflection==IntPtr.Zero) {
        reflection=IntPtr.Zero; throw new Win32Exception(Marshal.GetLastWin32Error(),"REFLECT NO_INSTALL failed");
      }
    }
    ReflectionRecord Read(IntPtr held) {
      var packet=new byte[65535]; var address=new byte[80]; uint size=80, received;
      if(!receive(held,packet,(uint)packet.Length,out received,0,address,ref size,IntPtr.Zero))
        throw new Win32Exception(Marshal.GetLastWin32Error(),"REFLECT read failed");
      if(size!=80 || received>8192 || (BitConverter.ToUInt32(address,8)&255)!=4)
        throw new InvalidOperationException("Unexpected WinDivert 2.2 address/object ABI");
      uint bits=BitConverter.ToUInt32(address,8);
      var result=new ReflectionRecord {Event=(bits>>8)&255,ProcessId=BitConverter.ToUInt32(address,24),
        Layer=BitConverter.ToUInt32(address,28),Flags=BitConverter.ToUInt64(address,32),
        Priority=BitConverter.ToInt16(address,40),OpenedTimestamp=BitConverter.ToInt64(address,16)};
      if(result.Event==8) result.Filter=Canonical(Encoding.ASCII.GetString(packet,0,(int)received).TrimEnd('\0'));
      return result;
    }
    public ReflectionRecord Poll(int milliseconds) {
      if(reflection==IntPtr.Zero) throw new InvalidOperationException("No owned reflection handle");
      if(pending==null) { IntPtr held=reflection; pending=Task.Run(() => Read(held)); }
      if(!pending.Wait(milliseconds)) return null; // Managed arrays remain held by the pending call.
      var result=pending.GetAwaiter().GetResult(); pending=null; return result;
    }
    public void Dispose() {
      if(reflection!=IntPtr.Zero) {
        IntPtr held=reflection; reflection=IntPtr.Zero;
        if(!close(held)) retained=true;
        if(pending!=null) { try { if(!pending.Wait(5000)) retained=true; } catch(AggregateException) { if(!pending.IsCompleted) retained=true; } }
      }
      // Never unload delegate code while an unconfirmed native read could use it.
      if(!retained && module!=IntPtr.Zero){FreeLibrary(module);module=IntPtr.Zero;}
      if(retained) throw new InvalidOperationException("Reflection retirement unconfirmed; module retained until disposable VM exit");
    }
  }
}
"@
}
function Get-DpiEnvironmentErrors {
  param([hashtable]$Environment,[bool]$Administrator,[bool]$Windows,[int]$PowerShellMajor,[bool]$X64)
  $errors=@(Get-NativeAcceptanceEnvironmentErrors $Environment $Administrator $Windows)
  if($PowerShellMajor -lt 7){$errors+='PowerShell7'};if(-not $X64){$errors+='X64'}
  return $errors
}
function Assert-DpiDeadline {
  if($script:DpiClock.Elapsed.TotalSeconds -ge $script:DpiBudget){throw 'DPI acceptance global deadline reached; further admission refused.'}
}
function Open-DpiFileLease {
  param([string]$Path,[string]$ExpectedHash='',[long]$ExpectedBytes=-1)
  Assert-NativeOrdinaryPath $Path -Leaf
  $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try{
    $hash=[Security.Cryptography.SHA256]::Create()
    try{$actual=[Convert]::ToHexString($hash.ComputeHash($stream)).ToLowerInvariant()}finally{$hash.Dispose()}
    if($ExpectedHash -and $actual -ine $ExpectedHash){throw "Pinned file hash differs: $Path"}
    if($ExpectedBytes -ge 0 -and $stream.Length -ne $ExpectedBytes){throw "Pinned file bytes differ: $Path"}
    $stream.Position=0
    return [pscustomobject]@{path=[IO.Path]::GetFullPath($Path);sha256=$actual;bytes=$stream.Length;stream=$stream}
  }catch{$stream.Dispose();throw}
}
function Assert-DpiHeldProcess {
  param($Owner,[switch]$MayExit)
  if($Owner.process.HasExited){if($MayExit){return $false};throw "Owned child exited: $($Owner.label)"}
  if([LagomDpiAcceptance.Probe]::Image($Owner.handle) -ine $Owner.executable -or [LagomDpiAcceptance.Probe]::BirthTicks($Owner.handle) -ne $Owner.birthTicks){throw "Held child identity differs: $($Owner.label)"}
  return $true
}
function Start-DpiChild {
  param([string]$Executable,[string[]]$Arguments,[string]$Label,[switch]$Worker)
  Assert-DpiDeadline;Assert-NativeOrdinaryPath $Executable -Leaf
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Executable;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.RedirectStandardInput=$true
  $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false);$info.StandardErrorEncoding=[Text.UTF8Encoding]::new($false);$info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
  $info.WorkingDirectory=if($Worker){$script:InstallRoot}else{$env:GITHUB_WORKSPACE}
  $info.Environment.Clear()
  foreach($name in @('SystemRoot','ProgramData','ProgramFiles','RUNNER_TEMP','GITHUB_WORKSPACE','GITHUB_ACTIONS','CI','RUNNER_ENVIRONMENT','RUNNER_OS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA')){
    $value=[Environment]::GetEnvironmentVariable($name);if($null -ne $value){$info.Environment[$name]=$value}
  }
  $windows=[Environment]::GetFolderPath('Windows')
  $info.Environment['PATH']=(Join-Path $windows 'System32')+';'+$windows
  $info.Environment['COMSPEC']=Join-Path $windows 'System32\cmd.exe'
  $info.Environment['TEMP']=$script:Work;$info.Environment['TMP']=$script:Work
  if(-not $Worker){Set-NativeWindowsPowerShellChildEnvironment -StartInfo $info}
  if($Worker){
    # Exact existing production ComponentWorker.cs launch contract; GUI fuses untouched.
    $info.Environment.Clear()
    $info.Environment['ELECTRON_RUN_AS_NODE']='1';$info.Environment['NODE_ENV']='production'
    $info.Environment['ProgramData']=[Environment]::GetFolderPath('CommonApplicationData')
    $info.Environment['SystemRoot']=$windows;$info.Environment['PATH']=(Join-Path $windows 'System32')+';'+$windows
    $info.Environment['COMSPEC']=Join-Path $windows 'System32\cmd.exe'
    $workerTemp=Join-Path $script:DataRoot 'Service\ComponentWorker\Temp'
    New-Item -ItemType Directory -Path $workerTemp -Force | Out-Null
    $info.Environment['TEMP']=$workerTemp;$info.Environment['TMP']=$workerTemp
    if($Arguments.Count -ne 1 -or $Arguments[0] -ine (Join-Path $script:InstallRoot 'resources\component-worker.cjs')){throw 'Exact production Worker argv required.'}
  }
  foreach($argument in $Arguments){$info.ArgumentList.Add($argument)}
  $child=[Diagnostics.Process]::new();$child.StartInfo=$info
  $started=$false;$handle=[IntPtr]::Zero;$owner=$null;$launchTicks=[DateTime]::UtcNow.Ticks
  try{
    $started=$child.Start()
    if(-not $started){throw "Child launch failed: $Label"}
    $handle=$child.Handle
    $owner=[pscustomobject]@{label=$Label;process=$child;handle=$handle;executable=[IO.Path]::GetFullPath($Executable);birthTicks=[LagomDpiAcceptance.Probe]::BirthTicks($handle);stderr=$child.StandardError.ReadToEndAsync();read=$null}
    if([LagomDpiAcceptance.Probe]::Image($handle) -ine $owner.executable){throw "Started child image differs: $Label"}
    return $owner
  }catch{
    $original=$_
    if($started){
      try{
        # Closing our own pipe requires no process identity claim and asks an
        # unadmitted actor to exit without issuing any production mutation.
        $child.StandardInput.Close()
        if(-not $child.WaitForExit(5000)){
          if($handle -eq [IntPtr]::Zero){throw 'No held handle for failed-start retirement.'}
          $image=[LagomDpiAcceptance.Probe]::Image($handle)
          $birth=[LagomDpiAcceptance.Probe]::BirthTicks($handle)
          if($image -ine [IO.Path]::GetFullPath($Executable) -or $birth -lt $launchTicks){throw 'Failed-start child identity is unconfirmed; no kill issued.'}
          if($owner -and $birth -ne $owner.birthTicks){throw 'Failed-start child birth changed; no kill issued.'}
          $child.Kill()
          if(-not $child.WaitForExit(5000)){throw 'Failed-start owned retirement unconfirmed.'}
        }
      }catch{$original.Exception.Data['ownedRetirementDiagnostic']=$_.Exception.Message}
    }
    $child.Dispose()
    throw $original
  }
}
function Stop-DpiOwnedChild {
  param($Owner)
  if(-not $Owner){return}
  try{
    if(Assert-DpiHeldProcess $Owner -MayExit){
      $Owner.process.StandardInput.Close()
      if(-not $Owner.process.WaitForExit(5000)){
        [void](Assert-DpiHeldProcess $Owner);$Owner.process.Kill()
        if(-not $Owner.process.WaitForExit(5000)){throw "Owned child retirement unconfirmed: $($Owner.label)"}
        throw "Forced owned child retirement was necessary: $($Owner.label)"
      }
    }
  }finally{$Owner.process.Dispose()}
}
function Wait-DpiTask {
  param($Task,[int]$Seconds,[string]$Label)
  $clock=[Diagnostics.Stopwatch]::StartNew()
  while(-not $Task.IsCompleted){
    Assert-DpiDeadline
    if($clock.Elapsed.TotalSeconds -ge $Seconds){throw "Bounded child operation timed out: $Label"}
    [void]$Task.Wait(100)
  }
  return $Task.GetAwaiter().GetResult()
}
function Invoke-DpiTool {
  param([string]$Executable,[string[]]$Arguments,[string]$Label,[int]$Seconds=60,[string]$InputText='')
  $child=Start-DpiChild $Executable $Arguments $Label
  try{
    if($InputText){$child.process.StandardInput.Write($InputText)}
    $child.process.StandardInput.Close()
    $stdout=$child.process.StandardOutput.ReadToEndAsync()
    $output=Wait-DpiTask $stdout $Seconds $Label
    $err=Wait-DpiTask $child.stderr 5 ($Label+' stderr')
    if(-not $child.process.WaitForExit(5000)){throw "Child exit timed out: $Label"}
    if($child.process.ExitCode -ne 0){throw "Child failed ($($child.process.ExitCode)): $Label; $err"}
    if([Text.Encoding]::UTF8.GetByteCount($output) -gt 4MB){throw "Tool output bound exceeded: $Label"}
    return $output.Trim()
  }finally{Stop-DpiOwnedChild $child}
}
function Read-DpiLine {
  param($Owner,[int]$Seconds=60)
  [void](Assert-DpiHeldProcess $Owner)
  if(-not $Owner.read){$Owner.read=$Owner.process.StandardOutput.ReadLineAsync()}
  $line=Wait-DpiTask $Owner.read $Seconds $Owner.label;$Owner.read=$null
  if(-not $line -or [Text.Encoding]::UTF8.GetByteCount($line) -gt 4MB){
    $diagnostic='stderr still pending'
    if($Owner.stderr.IsCompleted){$diagnostic=[string]$Owner.stderr.GetAwaiter().GetResult();if($diagnostic.Length -gt 4000){$diagnostic=$diagnostic.Substring(0,4000)}}
    throw "Invalid bounded child line: $($Owner.label); $diagnostic"
  }
  return $line | ConvertFrom-Json
}
function Invoke-DpiWorker {
  param([string]$Method,[object[]]$Arguments=@(),[switch]$Query)
  Assert-DpiDeadline;[void](Assert-DpiHeldProcess $script:DpiWorker)
  $id=[Guid]::NewGuid().ToString('N')
  $request=[ordered]@{id=$id;requestId=$id;component='Zapret';method=$Method;args=@($Arguments);query=[bool]$Query}
  $script:DpiWorker.process.StandardInput.WriteLine(($request | ConvertTo-Json -Depth 8 -Compress));$script:DpiWorker.process.StandardInput.Flush()
  $reply=Read-DpiLine $script:DpiWorker 70
  if($reply.id -cne $id -or $reply.requestId -cne $id -or $reply.ok -ne $true){throw "Production Worker $Method failed: $($reply | ConvertTo-Json -Depth 4 -Compress)"}
  return $reply.result
}
function Save-DpiReceipt {$script:DpiReceipt | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $script:DpiReceiptPath -Encoding utf8}
function Get-DpiGlobalWinws {
  return @(Get-CimInstance -ClassName Win32_Process -Filter "Name='winws.exe'" -OperationTimeoutSec 10 -ErrorAction Stop)
}
function Get-DpiDrivers {
  return @(Get-CimInstance -ClassName Win32_SystemDriver -OperationTimeoutSec 10 -ErrorAction Stop |
    Where-Object {$_.Name -match '(?i)windivert' -or $_.PathName -match '(?i)windivert'} |
    Select-Object Name,State,PathName,StartMode)
}
function Save-DpiInstallerDiagnostics {
  param([ValidateSet('before-retirement','after-retirement')][string]$Stage)
  if(-not $script:DpiReceipt.Contains('installerDiagnosticsReadbacks')){$script:DpiReceipt.installerDiagnosticsReadbacks=@()}
  $records=@()
  try{
    $records=@(Copy-NativeInstallerDiagnostics)
    foreach($record in $records){
      if($record.status -ne 'captured'){continue}
      try{
        # Keep both phase snapshots when ordinary uninstall removes its journal.
        $source=Assert-NativePathWithin (Join-Path $script:Work $record.name) $script:Work
        Assert-NativeOrdinaryPath $source -Leaf
        $record.file=$Stage+'.'+$record.name
        $destination=Assert-NativePathWithin (Join-Path $script:Work $record.file) $script:Work
        Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
        $record.sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
      }catch{$record.status='stage-copy-unavailable';$record.error=$_.Exception.Message}
    }
  }catch{$records=@([ordered]@{status='unavailable';error=$_.Exception.Message;errorType=$_.Exception.GetType().FullName})}
  $script:DpiReceipt.installerDiagnosticsReadbacks+=@([ordered]@{stage=$Stage;atUtc=[DateTimeOffset]::UtcNow.ToString('o');files=$records})
}
function Invoke-DpiReadonlySnapshot {
  param([ValidateSet('services','tasks','drivers','winws','network')][string]$Name,[int]$Seconds)
  $query=switch($Name){
    'services' {'@(Get-NativeProductServices)'}
    'tasks' {'@(Get-NativeProductTasks)'}
    'drivers' {'@(Get-DpiDrivers)'}
    'winws' {'@(Get-DpiGlobalWinws | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath)'}
    'network' {'Get-NativeNetworkFingerprint'}
  }
  # Read the actual controllers in an owned child, so even a stuck readonly
  # Get-Net*/ScheduledTask call cannot hold the acceptance finalizer indefinitely.
  # Partial installation is never permission to execute an unverified Core binary.
  $source=Join-Path $PSScriptRoot 'windows-dpi-native-acceptance.ps1'
  $commands=@(
    '$ErrorActionPreference=''Stop''',
    ('. '''+$source.Replace("'","''")+''' -LibraryOnly'),
    ('$value='+$query),
    ('ConvertTo-Json -InputObject ([ordered]@{schemaVersion=1;kind=''readonly-final-state'';name='''+$Name+''';value=$value}) -Depth 16 -Compress')
  )
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes(($commands -join [Environment]::NewLine)))
  $powershell=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $text=Invoke-DpiTool $powershell @('-NoLogo','-NoProfile','-NonInteractive','-OutputFormat','Text','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded) ('final-readonly-'+$Name) $Seconds
  $snapshot=$text | ConvertFrom-Json
  if($snapshot.schemaVersion -ne 1 -or $snapshot.kind -cne 'readonly-final-state' -or $snapshot.name -cne $Name -or $null -eq $snapshot.value){throw "Invalid final readonly snapshot: $Name"}
  return ,$snapshot.value
}
function Save-DpiFinalStateReadbacks {
  $state=[ordered]@{};$failures=@()
  foreach($entry in @(@{name='services';seconds=70},@{name='tasks';seconds=20},@{name='drivers';seconds=15},@{name='winws';seconds=15},@{name='network';seconds=20})){
    try{
      $value=Invoke-DpiReadonlySnapshot $entry.name $entry.seconds
      $record=[ordered]@{status='observed';atUtc=[DateTimeOffset]::UtcNow.ToString('o');value=$value}
      if($entry.name -eq 'network'){
        $record.preserved=($value | ConvertTo-Json -Depth 12 -Compress) -ceq ($script:DpiReceipt.beforeNetwork | ConvertTo-Json -Depth 12 -Compress)
        if(-not $record.preserved){$failures+='Final DNS/default routes/proxy/IPv6 differs from the observed clean baseline; no repair issued.'}
      }
      $state[$entry.name]=$record
    }catch{
      $state[$entry.name]=[ordered]@{status='unavailable';error=$_.Exception.Message;errorType=$_.Exception.GetType().FullName}
      $failures+=('Final readonly '+$entry.name+' unavailable: '+$_.Exception.Message)
    }
  }
  if($state.services.status -eq 'observed'){
    $core=@($state.services.value | Where-Object {$_.Name -ceq 'EgoistShieldCore'})
    $state.core=[ordered]@{status=$(if($core.Count){'present'}else{'absent'});source='readonly-SCM';expectedExecutable=$script:Core;services=$core;binaryExecuted=$false}
  }else{$state.core=[ordered]@{status='unknown';source='readonly-SCM';expectedExecutable=$script:Core;binaryExecuted=$false;error=$state.services.error}}
  # SCM metadata is evidence of presence/state, not public Core identity coverage.
  $script:DpiReceipt.finalStateReadbacks=$state
  if($state.drivers.status -eq 'observed'){$script:DpiReceipt.finalDrivers=@($state.drivers.value)}else{$script:DpiReceipt.finalDriverReadbackError=$state.drivers.error}
  return $failures
}
function Get-DpiWinws {
  $text=Invoke-DpiTool $script:Core @('--winws-process-snapshot') 'authoritative-winws-snapshot' 15
  $snapshot=$text | ConvertFrom-Json
  if($snapshot.schemaVersion -ne 1 -or $snapshot.operation -cne 'winws-process-snapshot' -or $snapshot.processName -cne 'winws.exe' -or $snapshot.snapshotAvailable -ne $true -or $snapshot.identityComplete -ne $true){throw 'Actual Core winws identity snapshot unavailable.'}
  $rows=@($snapshot.processes)
  if($rows.Count -gt 1){throw 'Unexpected extra winws processes; exclusive acceptance refused.'}
  $script:DpiReceipt.boundaries.corePublicIdentitySnapshot=$true
  return $rows
}
function Get-DpiScm {
  $rows=@(Get-CimInstance -ClassName Win32_Service -Filter "Name='EgoistShieldZapret'" -OperationTimeoutSec 10 -ErrorAction Stop)
  if($rows.Count -gt 1){throw 'Duplicate owned SCM identity.'}
  if($rows.Count -eq 0){return $null}
  $service=$rows[0]
  if($service.PathName.Trim().Trim('"') -ine $script:DpiWrapper -or $service.StartName -notin @('LocalSystem','NT AUTHORITY\SYSTEM')){throw 'Owned Zapret SCM path/account changed.'}
  return $service
}
function Open-DpiObservedProcess {
  param([int]$ProcessId,[string]$Executable,[string]$Label,[string]$ExpectedBorn='')
  $process=[Diagnostics.Process]::GetProcessById($ProcessId)
  try{
    $held=$process.Handle
    $owner=[pscustomobject]@{label=$Label;process=$process;handle=$held;executable=[IO.Path]::GetFullPath($Executable);birthTicks=[LagomDpiAcceptance.Probe]::BirthTicks($held)}
    [void](Assert-DpiHeldProcess $owner)
    if($ExpectedBorn){
      $ticks=([DateTimeOffset]::Parse($ExpectedBorn)).UtcTicks
      # CIM serializes microseconds; verify the same microsecond against GetProcessTimes.
      if([Math]::Abs($owner.birthTicks-$ticks) -ge 10){throw 'Core snapshot birth differs from the held process.'}
    }
    return $owner
  }catch{$process.Dispose();throw}
}
function Test-DpiPreview {
  param([string]$Preview,[string]$Executable='')
  $options=[ordered]@{preview=$Preview;expected=$script:DpiScope}
  if($Executable){$options.executable=$Executable}
  $result=Invoke-DpiTool $script:Node @($script:DpiHelper,'Verify') 'sealed-production-argv' 15 ($options | ConvertTo-Json -Depth 8 -Compress)
  if(($result | ConvertFrom-Json).ok -ne $true){throw 'Actual production command scope verification failed.'}
}
function Assert-DpiSeals {
  foreach($lease in $script:DpiSeals){
    Assert-NativeOrdinaryPath $lease.path -Leaf
    if((Get-FileHash -LiteralPath $lease.path -Algorithm SHA256).Hash -ine $lease.sha256 -or (Get-Item -LiteralPath $lease.path).Length -ne $lease.bytes){throw "Sealed runtime or profile changed: $($lease.path)"}
  }
}
function Assert-DpiWrapperConfiguration {
  $xmlPath=Join-Path $script:DpiRoot 'service-wrapper\egoistshield-zapret-service.xml'
  Assert-NativeOrdinaryPath $xmlPath -Leaf
  $raw=Get-Content -LiteralPath $xmlPath -Raw
  if($raw.Length -gt 65536 -or $raw -match '<!DOCTYPE|<!ENTITY'){throw 'Unexpected wrapper XML.'}
  [xml]$xml=$raw
  if($xml.service.id -cne 'EgoistShieldZapret' -or [IO.Path]::GetFullPath([string]$xml.service.executable) -ine $script:DpiWinwsPath -or [IO.Path]::GetFullPath([string]$xml.service.workingdirectory) -ine (Join-Path $script:DpiRoot 'core')){throw 'Production wrapper executable/id/directory differs.'}
  Test-DpiPreview ('winws.exe '+[string]$xml.service.arguments)
  return Open-DpiFileLease $xmlPath
}
function Assert-DpiDriverIdentity {
  $drivers=@(Get-DpiDrivers)
  if($drivers.Count -ne 1 -or $drivers[0].State -ne 'Running'){throw 'Expected one newly created running WinDivert driver.'}
  $image=[string]$drivers[0].PathName
  if($image.StartsWith('\??\')){$image=$image.Substring(4)}
  if($image.StartsWith('\\?\')){$image=$image.Substring(4)}
  $image=$image.Trim('"')
  if(-not [IO.Path]::IsPathRooted($image) -or [IO.Path]::GetFullPath($image) -ine $script:DpiSysPath){throw 'New driver image is outside the sealed candidate runtime.'}
  return [ordered]@{name=$drivers[0].Name;state=$drivers[0].State;image=$image;sha256=$script:DpiSysHash;preExisting=$false;stopDeleteIssuedByHarness=$false}
}
function Assert-DpiOn {
  Assert-DpiSeals
  $scm=Get-DpiScm
  $status=Invoke-DpiWorker 'status' @([ordered]@{force=$true}) -Query
  if(-not $scm -or $scm.State -ne 'Running' -or $scm.StartMode -ne 'Auto' -or $status.serviceRunning -ne $true -or $status.serviceReady -ne $true -or $status.winwsRunning -ne $true -or $status.serviceProfile -cne $script:DpiProfileName){throw 'Production Worker / SCM did not confirm ON.'}
  $script:DpiReceipt.boundaries.actualSCM=$true
  $rows=@(Get-DpiWinws)
  if($rows.Count -ne 1 -or $rows[0].executablePath -ine $script:DpiWinwsPath -or [int]$rows[0].parentProcessId -ne [int]$scm.ProcessId){throw 'ON runtime is not the exact child of the owned wrapper.'}
  $wrapper=$null;$runtime=$null
  try{
    $wrapper=Open-DpiObservedProcess ([int]$scm.ProcessId) $script:DpiWrapper 'owned-Zapret-wrapper'
    $runtime=Open-DpiObservedProcess ([int]$rows[0].processId) $script:DpiWinwsPath 'owned-winws' ([string]$rows[0].createdAt)
    $process=Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId="+$runtime.process.Id) -OperationTimeoutSec 10 -ErrorAction Stop
    if(-not $process -or -not $process.CommandLine -or [int]$process.ParentProcessId -ne $wrapper.process.Id){throw 'Actual runtime command line/parent unavailable.'}
    Test-DpiPreview ([string]$process.CommandLine) $script:DpiWinwsPath
    [void](Assert-DpiHeldProcess $runtime);[void](Assert-DpiHeldProcess $wrapper)
    $driver=Assert-DpiDriverIdentity
    return [pscustomobject]@{runtime=$runtime;wrapper=$wrapper;driver=$driver;serviceState=$scm.State;startMode=$scm.StartMode}
  }catch{if($runtime){$runtime.process.Dispose()};if($wrapper){$wrapper.process.Dispose()};throw}
}
function Assert-DpiOff {
  param($On)
  $scm=Get-DpiScm
  $status=Invoke-DpiWorker 'status' @([ordered]@{force=$true}) -Query
  if(-not $scm -or $scm.State -ne 'Stopped' -or $scm.StartMode -ne 'Disabled' -or $status.serviceRunning -ne $false -or $status.winwsRunning -ne $false -or @(Get-DpiWinws).Count -ne 0){throw 'Production Worker / SCM did not confirm persistent OFF.'}
  foreach($owner in @($On.runtime,$On.wrapper)){
    if(-not $owner.process.WaitForExit(5000)){[void](Assert-DpiHeldProcess $owner);throw 'Owned service/runtime retirement was not confirmed.'}
  }
}
function Invoke-DpiNonceProbe {
  $id=[Guid]::NewGuid().ToString('N');$nonce=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
  [void](Assert-DpiHeldProcess $script:DpiFixture)
  $script:DpiFixture.process.StandardInput.WriteLine(([ordered]@{id=$id;operation='probe';nonce=$nonce} | ConvertTo-Json -Compress));$script:DpiFixture.process.StandardInput.Flush()
  $reply=Read-DpiLine $script:DpiFixture 8
  if($reply.id -cne $id -or $reply.ok -ne $true -or $reply.nonce -cne $nonce -or $reply.port -ne $script:DpiScope.port){throw 'Actual held loopback fixture probe failed.'}
  return [ordered]@{ok=$true;nonce=$nonce;port=$reply.port;fixtureProcessId=$script:DpiFixture.process.Id}
}
function Assert-DpiControlNetwork {
  param([string]$Stage)
  Assert-DpiDeadline
  $actual=Get-NativeNetworkFingerprint
  if(($actual | ConvertTo-Json -Depth 12 -Compress) -cne ($script:DpiReceipt.beforeNetwork | ConvertTo-Json -Depth 12 -Compress)){throw "Host DNS/default routes/proxy/IPv6 changed: $Stage"}
  # An independent external control must remain available; it is excluded by the kernel scope.
  $client=[Net.Http.HttpClient]::new();$client.Timeout=[TimeSpan]::FromSeconds(6)
  $request=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Head,'https://github.com/')
  try{
    $response=Wait-DpiTask ($client.SendAsync($request)) 8 ('independent-HTTPS-'+$Stage)
    try{if([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 400){throw "Independent control HTTP status: $([int]$response.StatusCode)"}}finally{$response.Dispose()}
  }finally{$request.Dispose();$client.Dispose()}
  $script:DpiReceipt.networkReadbacks+=[ordered]@{stage=$Stage;ok=$true;atUtc=[DateTimeOffset]::UtcNow.ToString('o');httpControl='https://github.com/';fingerprint=$actual}
}
function Wait-DpiReflection {
  param([uint32]$ExpectedEvent,[int]$ProcessId,$Opened=$null)
  $clock=[Diagnostics.Stopwatch]::StartNew()
  while($clock.Elapsed.TotalSeconds -lt 15){
    Assert-DpiDeadline
    $event=$script:DpiFilter.Poll(250)
    if(-not $event){continue}
    if($event.Event -ne $ExpectedEvent -or $event.ProcessId -ne $ProcessId -or $event.Layer -ne 0){throw 'Foreign, extra-layer or out-of-order WinDivert handle observed; exclusive acceptance refused.'}
    if($ExpectedEvent -eq 8 -and ($event.Filter -cne $script:DpiCanonicalFilter -or $event.Flags -ne 0)){throw 'Actual driver filter or forwarding flags differ from sealed production scope.'}
    if($ExpectedEvent -eq 9 -and ($event.OpenedTimestamp -ne $Opened.OpenedTimestamp -or $event.Flags -ne $Opened.Flags -or $event.Priority -ne $Opened.Priority)){throw 'CLOSE event does not belong to the verified OPEN handle.'}
    return $event
  }
  throw 'Actual driver OPEN/CLOSE readback deadline exceeded.'
}
function Invoke-DpiEmergencyStop {
  # Failure never becomes a pass. Stop the actor first so a late request cannot restart SCM.
  $script:DpiReceipt.emergencyCleanupUsed=$true
  $failures=@()
  try{Stop-DpiOwnedChild $script:DpiWorker;$script:DpiWorker=$null}catch{$failures+=$_.Exception.Message}
  try{
    Assert-DpiSeals
    $scm=Get-DpiScm
    if($scm){
      $temporaryXml=Assert-DpiWrapperConfiguration;$temporaryXml.stream.Dispose()
      $sc=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\sc.exe'
      [void](Invoke-DpiTool $sc @('config','EgoistShieldZapret','start=','disabled') 'emergency-disable-owned-SCM' 15)
      if($scm.State -ne 'Stopped'){
        [void](Invoke-DpiTool $sc @('stop','EgoistShieldZapret') 'emergency-stop-owned-SCM' 20)
      }
      $limit=[Diagnostics.Stopwatch]::StartNew()
      do{
        $state=Get-DpiScm
        if($state -and $state.State -eq 'Stopped' -and @(Get-DpiWinws).Count -eq 0){break}
        if($limit.Elapsed.TotalSeconds -ge 40){throw 'Owned SCM/runtime emergency retirement unconfirmed.'}
        Start-Sleep -Milliseconds 250
      }while($true)
    }
  }catch{$failures+=$_.Exception.Message}
  $script:DpiReceipt.emergencyCleanupErrors=$failures
  # Never stop/delete stock WinDivert services or kill by basename.
}
function Invoke-DpiAcceptance {
  $environment=@{}
  foreach($name in @('GITHUB_ACTIONS','CI','RUNNER_ENVIRONMENT','RUNNER_OS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA')){$environment[$name]=[Environment]::GetEnvironmentVariable($name)}
  $windows=[Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
  $administrator=$windows -and ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $errors=@(Get-DpiEnvironmentErrors $environment $administrator $windows $PSVersionTable.PSVersion.Major ([Environment]::Is64BitProcess))
  if($errors.Count){throw ('DPI host guard refused before any file/native action: '+($errors -join ', '))}
  if($Mode -eq 'GuardOnly'){Write-Output 'Hosted DPI guards passed; nativeActions=0.';return}
  if($ExpectedSourceCommit -cne $env:GITHUB_SHA){throw 'Candidate must equal the actual hosted source commit.'}
  Assert-NativeOrdinaryPath $env:RUNNER_TEMP;Assert-NativeOrdinaryPath $env:GITHUB_WORKSPACE
  $assets=Assert-NativePathWithin $CandidateAssetsDirectory $env:GITHUB_WORKSPACE;Assert-NativeOrdinaryPath $assets
  $script:ManifestPath=Assert-NativePathWithin $IntegrityManifestPath $assets
  $manifestLease=Open-DpiFileLease $script:ManifestPath
  $manifest=Get-Content -LiteralPath $script:ManifestPath -Raw | ConvertFrom-Json
  if($manifest.product -cne 'Egoist Lagom' -or [string]$manifest.version -cnotmatch '^\d+\.\d+\.\d+$' -or [string]$manifest.source.commit -cne $ExpectedSourceCommit -or [string]$manifest.installer.path -cnotmatch '^dist/(?:[a-zA-Z0-9_-]+/)*EgoistShield-Setup-\d+\.\d+\.\d+\.exe$' -or [string]$manifest.installer.sha256 -cnotmatch '^[a-fA-F0-9]{64}$' -or [long]$manifest.installer.bytes -le 0){$manifestLease.stream.Dispose();throw 'Invalid immutable candidate identity.'}
  $script:Installer=Assert-NativePathWithin (Join-Path $assets ([IO.Path]::GetFileName([string]$manifest.installer.path))) $assets
  $installerLease=Open-DpiFileLease $script:Installer ([string]$manifest.installer.sha256) ([long]$manifest.installer.bytes)
  $script:Version=[string]$manifest.version
  $script:InstallRoot=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield'
  $script:DataRoot=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShield'
  $script:InstallerDataRoot=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShieldInstaller'
  $script:Core=Join-Path $script:InstallRoot 'resources\core-service\win-x64\EgoistShield.Service.exe'
  $script:DpiRoot=Join-Path $script:DataRoot 'Runtime\Zapret'
  $script:DpiWrapper=Join-Path $script:DpiRoot 'service-wrapper\egoistshield-zapret-service.exe'
  $script:DpiWinwsPath=Join-Path $script:DpiRoot 'core\bin\winws.exe'
  $script:DpiSysPath=Join-Path $script:DpiRoot 'core\bin\WinDivert64.sys'
  $script:DpiWorker=$null;$script:DpiFixture=$null;$script:DpiFilter=$null;$script:DpiSeals=@()
  $script:Work=Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) ('lagom-native-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT)
  Assert-NativeCleanStart
  if(@(Get-DpiDrivers).Count -ne 0 -or @(Get-CimInstance -ClassName Win32_Process -Filter "Name='winws.exe'" -OperationTimeoutSec 10 -ErrorAction Stop).Count -ne 0){throw 'An existing WinDivert driver/winws makes this VM unsafe; no existing driver is stopped or deleted.'}
  if(Test-Path -LiteralPath $script:Work){throw 'DPI work already exists; inspect the prior attempt.'}
  if(-not $EvidenceDirectory){$EvidenceDirectory=Join-Path $script:Work 'evidence'}
  $script:Evidence=Assert-NativePathWithin $EvidenceDirectory $env:RUNNER_TEMP
  $ancestor=$script:Evidence;while(-not (Test-Path -LiteralPath $ancestor)){$ancestor=[IO.Path]::GetDirectoryName($ancestor)}
  Assert-NativeOrdinaryPath $ancestor
  New-Item -ItemType Directory -Path $script:Work,$script:Evidence -Force | Out-Null
  $script:DpiClock=[Diagnostics.Stopwatch]::StartNew()
  $script:DpiBudget=1680 # 28m admission budget plus at most 8m failure/uninstall retirement.
  Initialize-DpiNativeTypes
  $script:Node=Resolve-NativeApplication 'node'
  $script:DpiHelper=Join-Path $PSScriptRoot 'windows-dpi-native-acceptance.mjs'
  $script:DpiReceiptPath=Join-Path $script:Work 'windows-dpi-native-acceptance.json'
  $script:DpiReceipt=[ordered]@{
    schemaVersion=1;kind='actual-protected-production-DPI-lifecycle';sourceCommit=$ExpectedSourceCommit;candidateVersion=$script:Version
    candidateIntegritySha256=$manifestLease.sha256;installer=[ordered]@{path=$script:Installer;sha256=$installerLease.sha256;bytes=$installerLease.bytes}
    host=[ordered]@{os=[Environment]::OSVersion.VersionString;powershell=$PSVersionTable.PSVersion.ToString();runnerEnvironment=$env:RUNNER_ENVIRONMENT;githubRunId=$env:GITHUB_RUN_ID;githubRunAttempt=$env:GITHUB_RUN_ATTEMPT;administrator=$administrator}
    actor=[ordered]@{kind='unchanged-protected-production-Worker';argv=@(Join-Path $script:InstallRoot 'resources\component-worker.cjs');guiFusesChanged=$false;workerFusesChanged=$false;allowlistsChanged=$false;usesExistingRunAsNodeWorkerContract=$true}
    boundaries=[ordered]@{actualZapretManager=$false;actualSCM=$false;actualDriver=$false;corePublicIdentitySnapshot=$false;coreRpc=$false;coreCancellation=$false;coreTransactionJournal=$false;blockedSiteBypass=$false;Win10=$false;ordinaryInteractiveGui=$false}
    startedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');result='running';cleanStartVerified=$true;existingWinDivertAbsent=$true
    beforeNetwork=(Get-NativeNetworkFingerprint);networkReadbacks=@();checks=@();cycles=@();requestedPairs=20;completedPairs=0
    nativeActions=0;nativeActionsDefinition="Mutation admission requests (Setup/start/stop/remove/uninstall), not a syscall counter";productionStartRequests=0;productionStopRequests=0;observedDriverOpen=0;observedDriverClose=0;auditorNetworkHandles=0;auditorReflectionFlags=21
    emergencyCleanupUsed=$false;emergencyCleanupErrors=@();actualCleanInstallCompleted=$false;actualRemoveCompleted=$false;actualUninstallCompleted=$false
    deadlines=[ordered]@{admissionSeconds=1680;retirementReserveSeconds=480;jobTimeoutMinutes=45;workerReplySeconds=70;reflectionSeconds=15}
    limitations=@('Bounded isolated lifecycle: no real blocked-site desync effectiveness or Core RPC/cancellation/journal coverage.','Any unavailable filter export/REFLECT/identity readback fails; it is never counted as native PASS.')
  }
  Save-DpiReceipt
  $installed=$false;$on=$null;$xmlSeal=$null;$primaryError=$null;$retirementErrors=@();$productSeals=@()
  try{
    $git=Resolve-NativeApplication 'git'
    if((Invoke-DpiTool $git @('rev-parse','HEAD') 'checkout-source-identity' 15) -cne $ExpectedSourceCommit){throw 'Checkout and immutable candidate source identity differ.'}
    if(Invoke-DpiTool $git @('diff','--name-only','HEAD','--','src','scripts','tests/windows-dpi-native-acceptance.ps1','tests/windows-dpi-native-acceptance.mjs','tests/windows-production-acceptance.ps1','tests/windows-production-acceptance.mjs','package.json') 'checkout-source-integrity' 15){throw 'Native source/helpers contain uncommitted tracked changes.'}
    $sourceLease=Open-DpiFileLease $script:DpiHelper;$productSeals+=$sourceLease
    Assert-DpiControlNetwork 'before-install'
    $script:DpiReceipt.nativeActions++;Save-DpiReceipt
    [void](Invoke-DpiTool $script:Installer @('/S') 'actual-clean-candidate-install' 600)
    $installed=$true;$script:DpiReceipt.actualCleanInstallCompleted=$true;Save-DpiReceipt
    foreach($relative in @('','EgoistShield.Worker.exe','resources','resources\component-worker.cjs','resources\worker-host-integrity.json','resources\runtime\manifest.json','resources\core-service\win-x64\EgoistShield.Service.exe')){[void](Assert-NativeAdministratorOwned (Join-Path $script:InstallRoot $relative) -InstallationPath)}
    $options=[ordered]@{installRoot=$script:InstallRoot;integrity=$script:ManifestPath;sourceCommit=$ExpectedSourceCommit;version=$script:Version;output=(Join-Path $script:Work 'dpi-installed-payload.json')}
    $optionsPath=Join-Path $script:Work 'dpi-installed-payload.options.json';$options | ConvertTo-Json | Set-Content -LiteralPath $optionsPath -Encoding utf8
    [void](Invoke-DpiTool $script:Node @((Join-Path $PSScriptRoot 'windows-production-acceptance.mjs'),'verify-payload',$optionsPath) 'source-bound-installed-payload' 180)
    $script:DpiReceipt.checks+=[ordered]@{name='actual-all-payload-fuses-worker-inventory-and-asar';ok=$true;receipt='dpi-installed-payload.json'}
    $script:DpiReceipt.core=Assert-NativeService 'EgoistShieldCore' $script:Core -Running
    foreach($relative in @('EgoistShield.Worker.exe','resources\component-worker.cjs','resources\worker-host-integrity.json','resources\runtime\manifest.json','resources\core-service\win-x64\EgoistShield.Service.exe')){
      $entry=@($manifest.payload | Where-Object {$_.path -ceq $relative.Replace('\','/')})
      if($entry.Count -ne 1){throw "Missing source-bound product identity: $relative"}
      $productSeals+=Open-DpiFileLease (Join-Path $script:InstallRoot $relative) ([string]$entry[0].sha256) ([long]$entry[0].bytes)
    }
    $runtimeManifest=Get-Content -LiteralPath (Join-Path $script:InstallRoot 'resources\runtime\manifest.json') -Raw | ConvertFrom-Json
    $component=@($runtimeManifest.components | Where-Object {$_.name -ceq 'zapret' -and $_.present -eq $true})
    if($component.Count -ne 1){throw 'No self-contained pinned Zapret runtime in this candidate.'}
    # Full bundled inventory is required before any provisioning request: no downloader fallback.
    foreach($entry in $component[0].files){
      if([string]$entry.path -cnotmatch '^zapret/[a-zA-Z0-9_ ./()-]+$' -or [string]$entry.path -match '(^|/)\.\.(/|$)' -or [string]$entry.sha256 -cnotmatch '^[a-fA-F0-9]{64}$'){throw 'Invalid runtime inventory path/hash.'}
      $file=Assert-NativePathWithin (Join-Path $script:InstallRoot ('resources\runtime\'+[string]$entry.path)) $script:InstallRoot
      $seed=Open-DpiFileLease $file ([string]$entry.sha256) ([long]$entry.size);$seed.stream.Dispose()
    }
    Assert-NativeNoGui;Assert-DpiControlNetwork 'installed-payload'
    $script:DpiWorker=Start-DpiChild (Join-Path $script:InstallRoot 'EgoistShield.Worker.exe') @((Join-Path $script:InstallRoot 'resources\component-worker.cjs')) 'protected-production-Worker' -Worker
    [void](Invoke-DpiWorker 'listProfiles') # actual provisioning from the already verified self-contained bundle
    $script:DpiReceipt.boundaries.actualZapretManager=$true
    if(@(Get-DpiDrivers).Count -ne 0 -or @(Get-DpiWinws).Count -ne 0){throw 'Provisioning unexpectedly activated native DPI.'}
    $script:DpiFixture=Start-DpiChild $script:Node @($script:DpiHelper,'Fixture') 'held-exclusive-loopback-fixture'
    $ready=Read-DpiLine $script:DpiFixture 10
    if($ready.ready -ne $true -or [int]$ready.processId -ne $script:DpiFixture.process.Id){throw 'Fixture readiness identity differs.'}
    $script:DpiScope=Invoke-DpiTool $script:Node @($script:DpiHelper,'Scope',[string]$ready.port,$script:DpiRoot) 'actual-production-scope-compiler' 15 | ConvertFrom-Json
    $script:DpiProfileName='lagom-ci-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT
    $acceptanceProfile=Assert-NativePathWithin (Join-Path $script:DpiRoot ('core\'+$script:DpiProfileName+'.bat')) $script:DpiRoot
    if(Test-Path -LiteralPath $acceptanceProfile){throw 'Acceptance profile must be new.'}
    [IO.File]::WriteAllText($acceptanceProfile,[string]$script:DpiScope.profile,[Text.UTF8Encoding]::new($false))
    [void](Assert-NativeAdministratorOwned $acceptanceProfile -InstallationPath)
    $script:DpiSeals+=Open-DpiFileLease $acceptanceProfile
    foreach($entry in $component[0].files){
      $relative=([string]$entry.path).Substring(7)
      if($relative -notlike 'core/bin/*' -and $relative -cne 'service-wrapper/egoistshield-zapret-service.exe'){continue}
      $script:DpiSeals+=Open-DpiFileLease (Join-Path $script:DpiRoot $relative) ([string]$entry.sha256) ([long]$entry.size)
    }
    foreach($name in @('ipset-exclude.txt','ipset-exclude-user.txt')){$script:DpiSeals+=Open-DpiFileLease (Join-Path $script:DpiRoot ('core\lists\'+$name))}
    $script:DpiSysHash=($script:DpiSeals | Where-Object {$_.path -ieq $script:DpiSysPath}).sha256
    $preview=Invoke-DpiWorker 'dryRunProfile' @($script:DpiProfileName)
    Test-DpiPreview ([string]$preview.commandPreview)
    $script:DpiReceipt.scope=[ordered]@{port=$script:DpiScope.port;fixtureProcessId=$script:DpiFixture.process.Id;fixtureBirthTicks=$script:DpiFixture.birthTicks;kernel=$script:DpiScope.kernel;profile=$acceptanceProfile;sealedFiles=@($script:DpiSeals | Select-Object path,sha256,bytes);productionPreview=$preview.commandPreview}
    # wf-save is the pinned winws public userspace filter export and exits before win_main/Open.
    $dump=Join-Path $script:Work 'actual-winws-filter.txt'
    $arguments=@($script:DpiScope.argv)+@('--wf-save='+$dump)
    [void](Invoke-DpiTool $script:DpiWinwsPath $arguments 'actual-pinned-winws-filter-export-no-open' 20)
    if(@(Get-DpiDrivers).Count -ne 0 -or @(Get-DpiWinws).Count -ne 0){throw 'Userspace filter preflight unexpectedly opened native DPI.'}
    Assert-NativeOrdinaryPath $dump -Leaf
    $export=Get-Content -LiteralPath $dump -Raw
    if($export.Length -gt 8192){throw 'Unexpected filter export length.'}
    $script:DpiFilter=[LagomDpiAcceptance.FilterProbe]::new((Join-Path $script:DpiRoot 'core\bin\WinDivert.dll'))
    $script:DpiCanonicalFilter=$script:DpiFilter.Canonical([string]$script:DpiScope.kernel)
    if($script:DpiFilter.Canonical($export) -cne $script:DpiCanonicalFilter){throw 'Actual pinned winws kernel filter exceeds the sealed scope BEFORE driver start.'}
    $evaluations=@()
    foreach($packet in $script:DpiScope.packets){
      $actual=$script:DpiFilter.Evaluate($export,[Convert]::FromBase64String([string]$packet.packet),[uint32]$packet.flags)
      if($actual -ne [bool]$packet.expected){throw "Pinned filter evaluation differs: $($packet.name)"}
      $evaluations+=[ordered]@{name=$packet.name;expected=[bool]$packet.expected;actual=$actual}
    }
    $script:DpiReceipt.filterPreflight=[ordered]@{actualWinwsExport=$export;canonical=$script:DpiCanonicalFilter;packetEvaluations=$evaluations;driverStillAbsent=$true;userspaceOnly=$true}
    [void](Invoke-DpiNonceProbe);Assert-DpiControlNetwork 'before-native-admission';Assert-DpiSeals;Save-DpiReceipt
    for($cycle=1;$cycle -le 20;$cycle++){
      Assert-DpiDeadline;Assert-DpiSeals
      [void](Assert-DpiHeldProcess $script:DpiFixture)
      $preOnProbe=Invoke-DpiNonceProbe
      Assert-DpiDeadline
      [void](Assert-DpiHeldProcess $script:DpiFixture)
      $watch=[Diagnostics.Stopwatch]::StartNew()
      $script:DpiReceipt.productionStartRequests++;$script:DpiReceipt.nativeActions++;Save-DpiReceipt
      if($cycle -eq 1){
        [void](Invoke-DpiWorker 'installService' @($script:DpiProfileName))
        $xmlSeal=Assert-DpiWrapperConfiguration
      }else{
        [void](Invoke-DpiWorker 'startService')
        if((Get-FileHash -LiteralPath $xmlSeal.path -Algorithm SHA256).Hash -ine $xmlSeal.sha256){throw 'Sealed production service XML changed between cycles.'}
      }
      $on=Assert-DpiOn
      if($cycle -eq 1){$script:DpiFilter.StartReflection()}
      $opened=Wait-DpiReflection 8 $on.runtime.process.Id
      $script:DpiReceipt.observedDriverOpen++;$script:DpiReceipt.boundaries.actualDriver=$true
      $probeOn=Invoke-DpiNonceProbe
      Assert-DpiControlNetwork ('cycle-'+$cycle+'-on')
      [void](Assert-DpiHeldProcess $on.runtime);[void](Assert-DpiHeldProcess $on.wrapper)
      if($script:DpiFilter.Poll(100)){throw 'Unexpected extra WinDivert handle while ON.'}
      $startMs=$watch.ElapsedMilliseconds;$watch.Restart()
      $script:DpiReceipt.productionStopRequests++;$script:DpiReceipt.nativeActions++;Save-DpiReceipt
      [void](Invoke-DpiWorker 'stopService')
      $closed=Wait-DpiReflection 9 $on.runtime.process.Id $opened
      $script:DpiReceipt.observedDriverClose++
      Assert-DpiOff $on
      $probeOff=Invoke-DpiNonceProbe
      Assert-DpiControlNetwork ('cycle-'+$cycle+'-off')
      if($script:DpiFilter.Poll(100)){throw 'Unexpected WinDivert handle after persistent OFF.'}
      $script:DpiReceipt.cycles+=[ordered]@{pair=$cycle;onVerified=$true;offVerified=$true;startMilliseconds=$startMs;stopMilliseconds=$watch.ElapsedMilliseconds;processId=$on.runtime.process.Id;birthTicks=$on.runtime.birthTicks;driver=$on.driver;open=$opened;close=$closed;probeBeforeAdmission=$preOnProbe;probeOn=$probeOn;probeOff=$probeOff}
      $script:DpiReceipt.completedPairs=$cycle;Save-DpiReceipt
      $on.runtime.process.Dispose();$on.wrapper.process.Dispose();$on=$null
    }
    $script:DpiFilter.Dispose();$script:DpiFilter=$null
    $xmlSeal.stream.Dispose();$xmlSeal=$null
    $script:DpiReceipt.nativeActions++;Save-DpiReceipt
    [void](Invoke-DpiWorker 'removeService')
    $removed=Invoke-DpiWorker 'status' @([ordered]@{force=$true}) -Query
    if((Get-DpiScm) -or $removed.serviceInstalled -ne $false -or @(Get-DpiWinws).Count -ne 0){throw 'Actual production remove did not remove owned SCM/runtime.'}
    $script:DpiReceipt.actualRemoveCompleted=$true;Save-DpiReceipt
  }catch{$primaryError=$_;$script:DpiReceipt.result='failed';$script:DpiReceipt.error=$_.Exception.Message}
  finally{
    # Reserve 8 minutes after the admission clock for owned retirement and ordinary uninstall.
    $script:DpiBudget=2160
    try{Save-DpiInstallerDiagnostics 'before-retirement'}catch{$retirementErrors+=('Initial installer diagnostics unavailable: '+$_.Exception.Message)}
    try{
    if($primaryError -and $installed){try{Invoke-DpiEmergencyStop}catch{$retirementErrors+=$_.Exception.Message}}
    if($on){foreach($owner in @($on.runtime,$on.wrapper)){$owner.process.Dispose()}}
    foreach($child in @($script:DpiWorker,$script:DpiFixture)){try{Stop-DpiOwnedChild $child}catch{$retirementErrors+=$_.Exception.Message}}
    $script:DpiWorker=$null;$script:DpiFixture=$null
    if($script:DpiFilter){try{$script:DpiFilter.Dispose()}catch{$retirementErrors+=$_.Exception.Message}}
    if($xmlSeal){$xmlSeal.stream.Dispose()}
    foreach($lease in @($script:DpiSeals)+@($productSeals)){$lease.stream.Dispose()}
    if($installed -and $retirementErrors.Count -eq 0 -and @($script:DpiReceipt.emergencyCleanupErrors).Count -eq 0){
      try{
        if(@(Get-DpiWinws).Count -ne 0){throw 'Uninstall refused while an unconfirmed winws remains.'}
        $uninstaller=Join-Path $script:InstallRoot 'Uninstall Egoist Shield.exe'
        [void](Assert-NativeAdministratorOwned $uninstaller -InstallationPath)
        $script:DpiReceipt.nativeActions++;Save-DpiReceipt
        [void](Invoke-DpiTool $uninstaller @('/S') 'ordinary-owned-candidate-uninstall' 300)
        $wait=[Diagnostics.Stopwatch]::StartNew()
        while(Test-Path -LiteralPath $script:InstallRoot){Assert-DpiDeadline;if($wait.Elapsed.TotalSeconds -ge 60){throw 'Ordinary uninstall completion unconfirmed.'};Start-Sleep -Milliseconds 250}
        if(@(Get-NativeProductServices).Count -ne 0 -or @(Get-NativeProductTasks).Count -ne 0 -or @(Get-DpiDrivers).Count -ne 0 -or @(Get-DpiGlobalWinws).Count -ne 0){throw 'Owned product/driver/task residue after actual ordinary uninstall.'}
        if(Test-Path -LiteralPath $acceptanceProfile){throw 'Ordinary uninstall retained the owned acceptance profile.'}
        Assert-NativeNoGui;Assert-DpiControlNetwork 'ordinary-uninstall'
        $script:DpiReceipt.actualUninstallCompleted=$true
      }catch{$retirementErrors+=$_.Exception.Message}
    }
    }catch{$retirementErrors+=('Owned retirement failed: '+$_.Exception.Message)}
    finally{
    try{Save-DpiInstallerDiagnostics 'after-retirement'}catch{$retirementErrors+=('Final installer diagnostics unavailable: '+$_.Exception.Message)}
    try{$retirementErrors+=@(Save-DpiFinalStateReadbacks)}catch{$retirementErrors+=('Final readonly evidence unavailable: '+$_.Exception.Message)}
    $script:DpiReceipt.retirementErrors=$retirementErrors
    $script:DpiReceipt.finishedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    $script:DpiReceipt.elapsedSeconds=[Math]::Round($script:DpiClock.Elapsed.TotalSeconds,3)
    if(-not $primaryError -and $retirementErrors.Count -eq 0 -and $script:DpiReceipt.completedPairs -eq 20 -and $script:DpiReceipt.observedDriverOpen -eq 20 -and $script:DpiReceipt.observedDriverClose -eq 20 -and $script:DpiReceipt.actualRemoveCompleted -and $script:DpiReceipt.actualUninstallCompleted){$script:DpiReceipt.result='passed-20-bounded-production-DPI-pairs'}else{$script:DpiReceipt.result='failed'}
    try{
      Save-DpiReceipt
      foreach($file in @(Get-ChildItem -LiteralPath $script:Work -File)){
        $destination=Join-Path $script:Evidence $file.Name
        if($destination -ine $file.FullName){try{Copy-Item -LiteralPath $file.FullName -Destination $destination -Force -ErrorAction Stop}catch{$retirementErrors+=('Evidence file unavailable ('+$file.Name+'): '+$_.Exception.Message)}}
      }
    }catch{
      $retirementErrors+=('Final evidence export failed: '+$_.Exception.Message)
      $script:DpiReceipt.retirementErrors=$retirementErrors;$script:DpiReceipt.result='failed'
      try{Save-DpiReceipt}catch{Write-Warning ('Receipt write unavailable: '+$_.Exception.Message)}
    }finally{
      foreach($lease in @($installerLease,$manifestLease)){try{$lease.stream.Dispose()}catch{$retirementErrors+=('Candidate lease release failed: '+$_.Exception.Message)}}
    }
    if($retirementErrors.Count -ne @($script:DpiReceipt.retirementErrors).Count){
      $script:DpiReceipt.retirementErrors=$retirementErrors;$script:DpiReceipt.result='failed'
      try{Save-DpiReceipt;Copy-Item -LiteralPath $script:DpiReceiptPath -Destination (Join-Path $script:Evidence ([IO.Path]::GetFileName($script:DpiReceiptPath))) -Force -ErrorAction Stop}catch{Write-Warning ('Final receipt export unavailable: '+$_.Exception.Message)}
    }
    }
  }
  if($primaryError){throw $primaryError}
  if($script:DpiReceipt.result -ne 'passed-20-bounded-production-DPI-pairs'){throw ('DPI acceptance did not complete: '+($retirementErrors -join '; '))}
  Write-Output ('Actual protected-production DPI 20 pairs passed. Receipt: '+$script:DpiReceiptPath+'; Core RPC/cancellation/journal not covered.')
}
if($LibraryOnly){return}
Invoke-DpiAcceptance
