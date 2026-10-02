function Initialize-InstallerFileLockApi {
  if ('LagomInstallerFileLocks.Native' -as [type]) { return }
  Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
namespace LagomInstallerFileLocks {
 [StructLayout(LayoutKind.Sequential)] public struct FileTime { public uint Low,High; public ulong Value {get{return ((ulong)High<<32)|Low;}} public static FileTime From(ulong v){return new FileTime{Low=(uint)v,High=(uint)(v>>32)};} }
 [StructLayout(LayoutKind.Sequential)] public struct Unique {public uint Pid;public FileTime Birth;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct Info {
  public Unique Process;
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string AppName;
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=64)] public string ServiceName;
  public int AppType; public uint Status,Session;
  [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
 }
 public sealed class Locker {public uint Pid;public ulong Birth;public int AppType;public string ServiceName,Executable,Verification;public uint Session,Protection;public bool Restartable,Critical;}
 public sealed class Report {public Locker[] Processes;public uint RebootReasons;}
 [StructLayout(LayoutKind.Sequential)] public struct FileInfo {public uint Attributes;public FileTime Creation,Access,Write;public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;}
 public static class Native {
  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern uint RmStartSession(out uint h,uint flags,StringBuilder key);
  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern uint RmRegisterResources(uint h,uint count,string[] files,uint apps,Unique[] processes,uint services,string[] names);
  [DllImport("rstrtmgr.dll")] static extern uint RmGetList(uint h,out uint needed,ref uint count,[In,Out]Info[] infos,ref uint reboot);
  [DllImport("rstrtmgr.dll")] static extern uint RmShutdown(uint h,uint flags,IntPtr callback);
  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern uint RmAddFilter(uint h,string module,IntPtr process,string service,uint action);
  [DllImport("rstrtmgr.dll")] static extern uint RmEndSession(uint h);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out FileTime birth,out FileTime exit,out FileTime kernel,out FileTime user);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessCritical(IntPtr h,[MarshalAs(UnmanagedType.Bool)]out bool critical);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessInformation(IntPtr h,int kind,out uint protection,uint size);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder path,ref uint size);
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(IntPtr h,out FileInfo info);
  static void Check(uint code,string operation){if(code!=0)throw new Win32Exception((int)code,"FILE_LOCK_"+operation+" ("+code+")");}
  static uint Start(){uint h;Check(RmStartSession(out h,0,new StringBuilder(33)),"START");return h;}
  static Info[] List(uint h,out uint reboot){uint count=0,needed=0;reboot=0;uint code=RmGetList(h,out needed,ref count,null,ref reboot);if(code==0)return new Info[0];if(code!=234)Check(code,"QUERY");
   for(int attempt=0;attempt<4;attempt++){if(needed>256)throw new InvalidOperationException("FILE_LOCK_PROCESS_BOUND: more than256 processes.");var infos=new Info[needed];count=needed;code=RmGetList(h,out needed,ref count,infos,ref reboot);if(code==0){Array.Resize(ref infos,(int)count);return infos;}if(code!=234)Check(code,"QUERY");}
   throw new InvalidOperationException("FILE_LOCK_QUERY_CHANGED: process list did not stabilize.");}
  public static Report Query(string[] files){if(files==null||files.Length<1||files.Length>2048)throw new ArgumentException("FILE_LOCK_FILE_BOUND");uint h=Start();try{Check(RmRegisterResources(h,(uint)files.Length,files,0,null,0,null),"REGISTER_FILES");uint reboot;var infos=List(h,out reboot);var result=new List<Locker>();foreach(var x in infos)result.Add(new Locker{Pid=x.Process.Pid,Birth=x.Process.Birth.Value,AppType=x.AppType,ServiceName=x.ServiceName,Session=x.Session,Restartable=x.Restartable});return new Report{Processes=result.ToArray(),RebootReasons=reboot};}finally{RmEndSession(h);}}
  public static bool SingleLink(string path){using(var file=File.Open(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){FileInfo info;if(!GetFileInformationByHandle(file.SafeFileHandle.DangerousGetHandle(),out info))throw new Win32Exception(Marshal.GetLastWin32Error(),"FILE_LOCK_FILE_ID");return info.Links==1;}}
  public static Locker Verify(Locker item){if(item.Pid<=4||item.Pid==GetCurrentProcessId()||item.AppType==1000)throw new InvalidOperationException("FILE_LOCK_SYSTEM_OR_SELF: PID "+item.Pid);
   IntPtr h=OpenProcess(0x1000,false,item.Pid);if(h==IntPtr.Zero){int code=Marshal.GetLastWin32Error();if(code==87)return null;throw new Win32Exception(code,"FILE_LOCK_PROCESS_UNVERIFIABLE: PID "+item.Pid);}
   try{FileTime birth,exit,kernel,user;if(!GetProcessTimes(h,out birth,out exit,out kernel,out user))throw new Win32Exception(Marshal.GetLastWin32Error(),"FILE_LOCK_BIRTH_QUERY");if(birth.Value!=item.Birth)throw new InvalidOperationException("FILE_LOCK_PID_REUSED: PID "+item.Pid);
    bool critical;if(!IsProcessCritical(h,out critical))throw new Win32Exception(Marshal.GetLastWin32Error(),"FILE_LOCK_CRITICAL_QUERY");uint protection;if(!GetProcessInformation(h,7,out protection,4))throw new Win32Exception(Marshal.GetLastWin32Error(),"FILE_LOCK_PROTECTION_QUERY");
    if(critical||protection!=0xfffffffe)throw new InvalidOperationException("FILE_LOCK_PROTECTED_PROCESS: PID "+item.Pid);
    uint size=32768;var path=new StringBuilder((int)size);if(!QueryFullProcessImageName(h,0,path,ref size))throw new Win32Exception(Marshal.GetLastWin32Error(),"FILE_LOCK_IMAGE_QUERY");
    return new Locker{Pid=item.Pid,Birth=item.Birth,AppType=item.AppType,ServiceName=item.ServiceName,Session=item.Session,Restartable=item.Restartable,Executable=path.ToString(),Critical=critical,Protection=protection,Verification="pid-birth-critical-protection-image"};
   }finally{CloseHandle(h);}}
  public static uint Shutdown(Locker[] selected,bool force,string ownGui){if(selected==null||selected.Length<1||selected.Length>256)throw new ArgumentException("FILE_LOCK_TARGET_BOUND");var ids=new List<Unique>();var approved=new HashSet<string>(StringComparer.Ordinal);
   foreach(var item in selected){var live=Verify(item);if(live==null||!String.Equals(live.Executable,item.Executable,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("FILE_LOCK_TARGET_CHANGED");string key=item.Pid+":"+item.Birth;if(!approved.Add(key))throw new InvalidOperationException("FILE_LOCK_DUPLICATE_PROCESS");ids.Add(new Unique{Pid=item.Pid,Birth=FileTime.From(item.Birth)});}
   uint h=Start();try{
    // This action session has no filenames: a newly arriving file locker cannot
    // enter RmShutdown's automatic refresh of the resource list.
    Check(RmRegisterResources(h,0,null,(uint)ids.Count,ids.ToArray(),0,null),"REGISTER_VERIFIED_PROCESSES");
    Check(RmAddFilter(h,ownGui,IntPtr.Zero,null,1),"NO_GUI_RESTART");uint reboot;foreach(var item in List(h,out reboot))if(!approved.Contains(item.Process.Pid+":"+item.Process.Birth.Value))throw new InvalidOperationException("FILE_LOCK_TARGET_SET_CHANGED");if(reboot!=0)throw new InvalidOperationException("FILE_LOCK_REBOOT_REQUIRED: "+reboot);
    return RmShutdown(h,force?1u:0u,IntPtr.Zero);
   }finally{RmEndSession(h);}
  }
 }
}
"@ -ErrorAction Stop
}

function Get-InstallerFileLockRoots {
  $programFiles=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
  if ([Environment]::Is64BitOperatingSystem) {
    $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64)
    try {$key=$base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion');try{$programFiles=[string]$key.GetValue('ProgramFilesDir')}finally{$key.Dispose()}}finally{$base.Dispose()}
  }
  return @([IO.Path]::GetFullPath((Join-Path $programFiles 'EgoistShield')).TrimEnd('\'),[IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)) 'EgoistShield\Runtime')).TrimEnd('\'))
}

function Invoke-InstallerFileLockNative {
  param([ValidateSet('Query','Verify','Shutdown','SingleLink')][string]$Operation,[string[]]$Files,[object]$Process,[object[]]$Processes,[bool]$Force=$false,[string]$OwnGui)
  Initialize-InstallerFileLockApi
  switch($Operation){
    'Query'{return [LagomInstallerFileLocks.Native]::Query($Files)}
    'Verify'{return [LagomInstallerFileLocks.Native]::Verify($Process)}
    'Shutdown'{return [LagomInstallerFileLocks.Native]::Shutdown([LagomInstallerFileLocks.Locker[]]$Processes,$Force,$OwnGui)}
    'SingleLink'{return [LagomInstallerFileLocks.Native]::SingleLink($Files[0])}
  }
}

function Get-ValidatedInstallerFileLockPaths {
  param([Parameter(Mandatory=$true)][string[]]$Files)
  if($Files.Count -lt 1 -or $Files.Count -gt 2048){throw 'FILE_LOCK_FILE_BOUND: expected1..2048 precise payload files.'}
  $roots=@(Get-InstallerFileLockRoots);$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase);$result=[Collections.Generic.List[string]]::new()
  foreach($file in $Files){
    if(-not $file -or -not [IO.Path]::IsPathRooted($file) -or $file.Length -gt 32767){throw 'FILE_LOCK_INVALID_PATH'}
    if($file -notmatch '^[A-Za-z]:\\' -or $file.Substring(3).Contains(':')){throw 'FILE_LOCK_FOREIGN_PATH: canonical local payload paths only.'}
    try{$full=[IO.Path]::GetFullPath($file)}catch{throw 'FILE_LOCK_INVALID_PATH'}
    if($full -notmatch '^[A-Za-z]:\\' -or $full.Substring(3).Contains(':') -or -not @($roots|Where-Object {$full.StartsWith($_+'\',[StringComparison]::OrdinalIgnoreCase)}).Count){throw 'FILE_LOCK_FOREIGN_PATH: only canonical own install/runtime payload files are allowed.'}
    $item=Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if($item.PSIsContainer){throw 'FILE_LOCK_DIRECTORY: register exact files, never directories.'}
    $current=$full
    while($current){$part=Get-Item -LiteralPath $current -Force -ErrorAction Stop;if(($part.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'FILE_LOCK_REPARSE_PATH'};$current=[IO.Path]::GetDirectoryName($current)}
    if(-not (Invoke-InstallerFileLockNative -Operation SingleLink -Files @($full))){throw 'FILE_LOCK_HARDLINK_ALIAS'}
    if($seen.Add($full)){$result.Add($full)}
  }
  return $result.ToArray()
}

function Get-InstallerFileLockProcessPolicy {
  param([object]$Process)
  if(-not $Process -or $Process.Verification -cne 'pid-birth-critical-protection-image' -or $Process.Critical -or [uint32]$Process.Protection -ne [uint32]4294967294){throw 'FILE_LOCK_PROCESS_UNVERIFIABLE'}
  $image=[IO.Path]::GetFullPath([string]$Process.Executable)
  $windows=[IO.Path]::GetFullPath([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)).TrimEnd('\')
  $signature=Get-AuthenticodeSignature -LiteralPath $image -ErrorAction Stop
  $subject=if($signature.SignerCertificate){[string]$signature.SignerCertificate.Subject}else{''}
  if($subject -match '(?:^|,\s*)CN=Microsoft Windows(?:\s|,|$)'){throw ('FILE_LOCK_WINDOWS_SIGNER: PID '+$Process.Pid)}
  $validVendor=$signature.Status -eq 'Valid' -and $subject -and $subject -notmatch '(?i)Microsoft'
  $services=@(Get-CimInstance Win32_Service -Filter ('ProcessId='+[uint32]$Process.Pid) -ErrorAction Stop -OperationTimeoutSec 3)
  if($services.Count -gt 1){throw ('FILE_LOCK_SHARED_SERVICE_HOST: PID '+$Process.Pid)}
  $dedicated=$false
  if($services.Count -eq 1){
    $service=$services[0];$name=[string]$service.Name
    if([uint32]$service.ProcessId -ne [uint32]$Process.Pid -or $name -notmatch '^[^/\\\x00-\x1f]{1,256}$' -or $Process.ServiceName -cne $name){throw 'FILE_LOCK_SERVICE_IDENTITY_CHANGED'}
    $key=Get-Item -LiteralPath ('Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\'+$name) -ErrorAction Stop
    if([int]$key.GetValue('Type',-1) -ne 16){throw 'FILE_LOCK_SHARED_SERVICE_TYPE'}
    $command=[string]$service.PathName;$raw=[string]$key.GetValue('ImagePath','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if([Environment]::ExpandEnvironmentVariables($raw) -cne $command){throw 'FILE_LOCK_SERVICE_REGISTRY_CHANGED'}
    $executable=if($command.StartsWith('"')){$end=$command.IndexOf('"',1);if($end -le 1){throw 'FILE_LOCK_SERVICE_COMMAND'};$command.Substring(1,$end-1)}else{$match=[regex]::Match($command,'^(\S+\.exe)(?:\s|$)','IgnoreCase');if(-not $match.Success){throw 'FILE_LOCK_SERVICE_COMMAND'};$match.Groups[1].Value}
    if(-not [IO.Path]::GetFullPath($executable).Equals($image,[StringComparison]::OrdinalIgnoreCase)){throw 'FILE_LOCK_SERVICE_IMAGE_CHANGED'}
    $dedicated=$true
  }elseif($Process.AppType -eq 3 -or $Process.ServiceName){throw 'FILE_LOCK_SERVICE_IDENTITY_MISSING'}
  if($image.StartsWith($windows+'\',[StringComparison]::OrdinalIgnoreCase) -and -not ($dedicated -and $validVendor)){throw ('FILE_LOCK_WINDOWS_IMAGE: PID '+$Process.Pid)}
  # Copies of signed OS binaries outside Windows remain OS processes.
  if($signature.Status -eq 'Valid' -and $subject -match '(?i)Microsoft' -and (Get-Item -LiteralPath $image -ErrorAction Stop).VersionInfo.ProductName -match '(?i)Windows.*Operating System'){throw 'FILE_LOCK_WINDOWS_PRODUCT'}
  return $Process
}

function Test-InstallerPayloadFilesReleased {
  param([string[]]$Files)
  foreach($file in $Files){try{$stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None);$stream.Dispose()}catch [IO.IOException]{return $false}}
  return $true
}

function Resolve-InstallerPayloadFileLocks {
  param([Parameter(Mandatory=$true)][string[]]$Files,[switch]$Force)
  $files=@(Get-ValidatedInstallerFileLockPaths $Files);$roots=@(Get-InstallerFileLockRoots);$ownGui=Join-Path $roots[0] 'EgoistShield.exe'
  $actions=[Collections.Generic.List[object]]::new();$blocked=[Collections.Generic.List[object]]::new()
  for($attempt=0;$attempt -lt 2;$attempt++){
    $report=Invoke-InstallerFileLockNative -Operation Query -Files $files
    if($report.RebootReasons -ne 0){$blocked.Add([pscustomobject]@{pid=0;birth=0;reason=('FILE_LOCK_REBOOT_REQUIRED: '+$report.RebootReasons)});break}
    if(@($report.Processes).Count -eq 0){break}
    $selected=[Collections.Generic.List[object]]::new()
    foreach($process in @($report.Processes)){
      try{$verified=Invoke-InstallerFileLockNative -Operation Verify -Process $process;if($verified){$selected.Add((Get-InstallerFileLockProcessPolicy $verified))}}
      catch{$blocked.Add([pscustomobject]@{pid=$process.Pid;birth=$process.Birth;reason=$_.Exception.Message})}
    }
    if($blocked.Count -or -not $selected.Count){break}
    foreach($process in $selected){[void](Get-InstallerFileLockProcessPolicy $process)}
    $code=Invoke-InstallerFileLockNative -Operation Shutdown -Processes $selected.ToArray() -OwnGui $ownGui
    $actions.Add([pscustomobject]@{attempt=$attempt+1;forced=$false;code=$code;processes=@($selected|ForEach-Object {[pscustomobject]@{pid=$_.Pid;birth=$_.Birth;image=$_.Executable}})})
    if($code -notin @(0,351)){throw ('FILE_LOCK_SHUTDOWN_FAILED: '+$code)}
    $after=Invoke-InstallerFileLockNative -Operation Query -Files $files
    if($after.RebootReasons -ne 0){$blocked.Add([pscustomobject]@{pid=0;birth=0;reason=('FILE_LOCK_REBOOT_REQUIRED: '+$after.RebootReasons)});break}
    if(@($after.Processes).Count -eq 0){break}
    if(-not $Force){break}
    # A force action is rebuilt from fresh file discovery and PID/birth proof.
    $forced=[Collections.Generic.List[object]]::new()
    foreach($process in @($after.Processes)){try{$verified=Invoke-InstallerFileLockNative -Operation Verify -Process $process;if($verified){$forced.Add((Get-InstallerFileLockProcessPolicy $verified))}}catch{$blocked.Add([pscustomobject]@{pid=$process.Pid;birth=$process.Birth;reason=$_.Exception.Message})}}
    if($blocked.Count -or -not $forced.Count){break}
    foreach($process in $forced){[void](Get-InstallerFileLockProcessPolicy $process)}
    $code=Invoke-InstallerFileLockNative -Operation Shutdown -Processes $forced.ToArray() -Force $true -OwnGui $ownGui
    $actions.Add([pscustomobject]@{attempt=$attempt+1;forced=$true;code=$code;processes=@($forced|ForEach-Object {[pscustomobject]@{pid=$_.Pid;birth=$_.Birth;image=$_.Executable}})})
    if($code -notin @(0,351)){throw ('FILE_LOCK_FORCE_FAILED: '+$code)}
  }
  $final=Invoke-InstallerFileLockNative -Operation Query -Files $files
  foreach($process in @($final.Processes)){$blocked.Add([pscustomobject]@{pid=$process.Pid;birth=$process.Birth;reason='FILE_LOCK_STILL_PRESENT'})}
  $released=$blocked.Count -eq 0 -and $final.RebootReasons -eq 0 -and (Test-InstallerPayloadFilesReleased $files)
  return [pscustomobject]@{schemaVersion=1;owner='EgoistShield';resolved=$released;fileCount=$files.Count;actions=$actions.ToArray();blockers=$blocked.ToArray();restartPolicy='No automatic restart before payload replacement; GUI launch remains installer-controlled.'}
}
