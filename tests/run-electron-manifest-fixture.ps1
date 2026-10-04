# CI-only real Electron comparison. Preparation/declaration modes never run target code.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$Project,
 [Parameter(Mandatory=$true)][string]$Work,
 [string]$Fixture,
 [Parameter(Mandatory=$true)][string]$Library,
 [ValidateSet('Run','PrepareOnly','NativeDeclarationsOnly')][string]$Mode='Run'
)
if ($PSVersionTable.PSVersion.Major -eq 5) { $env:PSModulePath=Join-Path $PSHOME 'Modules' }
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$allowedLibraryHashes=@('b1abfb2359b4997a79cbf6aa9f57281f13b32ee240b6a624bfd7b5c7dcb436af','130b74997b48cd7b20f07c6dc00f0c178bf3f591ebdc907aaf367a6912461a06','7dcda8197eefb639d2ca341e6c00d5ec45f33390a5dd89f5d0a73b857819844c','5c4f5ed526b6c663ab8681a694d949c80e3b4b93baed24eadbf6126ceb75301b')
$libraryHash=(Get-FileHash -LiteralPath $Library -Algorithm SHA256).Hash.ToLowerInvariant()
if ($libraryHash -notin $allowedLibraryHashes) { throw 'Accepted native library hash mismatch' }
. $Library -LibraryOnly -Work $Work
[void](Assert-SandboxProbePlainPath $Library)
[void](Assert-SandboxProbePlainPath $Project -Directory)
[void](Assert-SandboxProbePlainPath $Work -Directory)
if ($Mode -eq 'Run') {
 & (Join-Path $Project 'tests\windows-production-acceptance.ps1') -Mode GuardOnly | Out-Null
 if ($env:GITHUB_ACTIONS -ne 'true' -or $env:CI -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or $env:GITHUB_REPOSITORY -ne 'egoist-ai1/egoist-lagom') { throw 'Real hosted CI guard required' }
}
Initialize-SandboxImageProbeNative -TemporaryDirectory $Work
$nativeSource=@'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class LagomEngineJob {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUP {public uint cb;public string reserved,desktop,title;public uint x,y,xSize,ySize,xChars,yChars,fill,flags;public ushort show,reserved2;public IntPtr reservedPtr,input,output,error;}
 [StructLayout(LayoutKind.Sequential)] struct PI {public IntPtr process,thread;public uint pid,tid;}
 [StructLayout(LayoutKind.Sequential)] struct BASIC {public long processTime,jobTime;public uint flags;public UIntPtr min,max;public uint count;public UIntPtr affinity;public uint priority,scheduling;}
 [StructLayout(LayoutKind.Sequential)] struct IO {public ulong ro,wo,oo,rb,wb,ob;}
 [StructLayout(LayoutKind.Sequential)] struct EXTENDED {public BASIC basic;public IO io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
 [StructLayout(LayoutKind.Sequential)] struct FT {public uint low,high;}
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr sa,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED value,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr value,uint length,out uint returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr h,uint ms);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern uint ResumeThread(IntPtr h);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr h,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr h,IntPtr job,out bool result);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint rights,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetProcessId(IntPtr h);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out FT birth,out FT exit,out FT kernel,out FT user);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool ProcessIdToSessionId(uint pid,out uint session);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr h,uint flags,StringBuilder text,ref uint count);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint rights,out IntPtr token);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUP startup,out PI info);
 static Exception Error(int e){return new Win32Exception(e);}
 public static IntPtr NewJob(){
  IntPtr h=CreateJobObjectW(IntPtr.Zero,null);int e=Marshal.GetLastWin32Error();if(h==IntPtr.Zero)throw Error(e);
  try{EXTENDED v=new EXTENDED();v.basic.flags=0x2000|0x8;v.basic.count=16;if(!SetInformationJobObject(h,9,ref v,(uint)Marshal.SizeOf(v))){e=Marshal.GetLastWin32Error();throw Error(e);}return h;}catch{CloseHandle(h);throw;}
 }
 public static Dictionary<string,object> CreateSuspended(IntPtr job,string image,string cwd,string environment){
  IntPtr env=Marshal.StringToHGlobalUni(environment);PI pi;STARTUP si=new STARTUP();si.cb=(uint)Marshal.SizeOf(si);si.flags=1;si.show=0;
  try{
   bool ok=CreateProcessW(image,new StringBuilder("\""+image+"\""),IntPtr.Zero,IntPtr.Zero,false,0x4|0x400|0x08000000,env,cwd,ref si,out pi);int error=Marshal.GetLastWin32Error();
   if(!ok)return new Dictionary<string,object>{{"created",false},{"win32Error",error}};
   if(!AssignProcessToJobObject(job,pi.process)){error=Marshal.GetLastWin32Error();return new Dictionary<string,object>{{"created",true},{"assigned",false},{"win32Error",error},{"process",pi.process},{"thread",pi.thread},{"pid",pi.pid}};}
   return new Dictionary<string,object>{{"created",true},{"assigned",true},{"process",pi.process},{"thread",pi.thread},{"pid",pi.pid}};
  }finally{Marshal.FreeHGlobal(env);}
 }
 public static uint ExitCode(IntPtr process){uint c;if(!GetExitCodeProcess(process,out c)){int e=Marshal.GetLastWin32Error();throw Error(e);}return c;}
 public static uint[] Members(IntPtr job){
  IntPtr p=Marshal.AllocHGlobal(8+16*IntPtr.Size);
  try{uint n;if(!QueryInformationJobObject(job,3,p,(uint)(8+16*IntPtr.Size),out n)){int e=Marshal.GetLastWin32Error();throw Error(e);}int count=Marshal.ReadInt32(p,4);if(count<0||count>16)throw new Exception("Own job member count bound");uint[] ids=new uint[count];for(int i=0;i<count;i++)ids[i]=(uint)(ulong)Marshal.ReadIntPtr(p,8+i*IntPtr.Size).ToInt64();return ids;}finally{Marshal.FreeHGlobal(p);}
 }
 public static IntPtr OpenOwned(IntPtr job,uint pid){IntPtr p=OpenProcess(0x1000|0x100000,false,pid);int e=Marshal.GetLastWin32Error();if(p==IntPtr.Zero)throw Error(e);bool owns;if(!IsProcessInJob(p,job,out owns)){e=Marshal.GetLastWin32Error();CloseHandle(p);throw Error(e);}if(!owns){CloseHandle(p);throw new Exception("PID is no longer a member of the owned job");}return p;}
 public static Dictionary<string,object> Identity(IntPtr process){
  uint pid=GetProcessId(process);if(pid==0){int e=Marshal.GetLastWin32Error();throw Error(e);}
  FT b,x,k,u;if(!GetProcessTimes(process,out b,out x,out k,out u)){int e=Marshal.GetLastWin32Error();throw Error(e);}
  long born=((long)b.high<<32)|b.low;uint session;if(!ProcessIdToSessionId(pid,out session)){int e=Marshal.GetLastWin32Error();throw Error(e);}
  StringBuilder text=new StringBuilder(32768);uint size=32768;if(!QueryFullProcessImageNameW(process,0,text,ref size)){int e=Marshal.GetLastWin32Error();throw Error(e);}
  return new Dictionary<string,object>{{"pid",pid},{"birthUtc",DateTime.FromFileTimeUtc(born).ToString("o")},{"birthFileTime",born},{"sessionId",session},{"image",text.ToString()}};
 }
 public static IntPtr Token(IntPtr process){IntPtr t;if(!OpenProcessToken(process,8,out t)){int e=Marshal.GetLastWin32Error();throw Error(e);}return t;}
 public static IntPtr CurrentToken(){return Token(GetCurrentProcess());}
 public static int LastError(){return Marshal.GetLastWin32Error();}
}

'@
if (-not ('LagomEngineJob' -as [type])) {
 if ($PSVersionTable.PSVersion.Major -eq 5) {
  $cp=[CodeDom.Compiler.CompilerParameters]::new();$cp.GenerateInMemory=$true
  $cp.TempFiles=[CodeDom.Compiler.TempFileCollection]::new($Work,$false)
  [void]$cp.ReferencedAssemblies.Add('System.dll')
  Add-Type -TypeDefinition $nativeSource -CompilerParameters $cp
 } else { Add-Type -TypeDefinition $nativeSource }
}
if ($Mode -eq 'NativeDeclarationsOnly') { '{"schemaVersion":1,"nativeDeclarationsCompiled":true,"targetExecutions":0}';return }
function Hash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Under([string]$Path,[string]$Root) {
 $full=[IO.Path]::GetFullPath($Path);$prefix=[IO.Path]::GetFullPath($Root).TrimEnd('\')+'\'
 if (-not $full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped selected fixture/work root' }
 return $full
}
function Read-Json([string]$Path,[int]$Bound=1048576) {
 [void](Assert-SandboxProbePlainPath $Path)
 if ((Get-Item -LiteralPath $Path).Length -gt $Bound) { throw 'JSON bound exceeded' }
 return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Write-OwnJson([string]$Path,$Value,[string]$Root) {
 [void](Under $Path $Root);[void](Assert-SandboxProbePlainPath ([IO.Path]::GetDirectoryName($Path)) -Directory)
 $text=ConvertTo-Json -InputObject $Value -Depth 20
 if ([Text.Encoding]::UTF8.GetByteCount($text) -gt 1048576) { throw 'Report byte bound exceeded' }
 $temp=$Path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
 $stream=[IO.FileStream]::new($temp,'CreateNew','Write','None')
 try {$b=[Text.UTF8Encoding]::new($false).GetBytes($text);$stream.Write($b,0,$b.Length);$stream.Flush($true)} finally {$stream.Dispose()}
 if ([IO.File]::Exists($Path)) {[IO.File]::Replace($temp,$Path,[NullString]::Value)} else {[IO.File]::Move($temp,$Path)}
}
function Error-Metadata($ErrorRecord) {
 $ex=$ErrorRecord.Exception
 while ($ex.InnerException) { $ex=$ex.InnerException }
 $code=if ($ex -is [ComponentModel.Win32Exception]) {$ex.NativeErrorCode} else {$null}
 return @{errorClass=$ex.GetType().Name;win32Error=$code}
}
function Read-Identity([IntPtr]$Handle,[string]$Root,[string]$ExpectedImage,[string]$AllowedAuxiliaryImage=$null) {
 $id=[LagomEngineJob]::Identity($Handle)
 $actual=[IO.Path]::GetFullPath([string]$id['image'])
 if ($actual -ine $ExpectedImage -and $actual -ine $AllowedAuxiliaryImage) { throw 'Owned process image differs from the selected case' }
 $token=[LagomEngineJob]::Token($Handle)
 try {$metadata=[LagomSandboxImageProbe]::TokenMetadata($token)} finally {[void][LagomEngineJob]::CloseHandle($token)}
 return @{pid=$id['pid'];birthUtc=$id['birthUtc'];birthFileTime=$id['birthFileTime'];sessionId=$id['sessionId'];imageRelative=$actual.Substring($Root.TrimEnd('\').Length+1);imageMatchesCase=$actual -ieq $ExpectedImage;token=$metadata}
}
function Assert-Fixture($f) {
 if ($f.schemaVersion -ne 1 -or $f.version -cne '44.5.1' -or $f.librarySha -cne $libraryHash -or $f.project -ine [IO.Path]::GetFullPath($Project) -or $f.work -ine [IO.Path]::GetFullPath($Work) -or $f.images.Count -ne 2) { throw 'Fixture selection mismatch' }
 [void](Under $f.root $Work);[void](Assert-SandboxProbePlainPath $f.root -Directory)
 if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Fixture)) -ine $f.root -or [IO.Path]::GetFileName($Fixture) -cne 'fixture.json') { throw 'Fixture receipt location mismatch' }
 if ((Hash $PSCommandPath) -cne $f.runnerSha -or (Hash $f.sourceImage) -cne $f.sourceImageSha) { throw 'Runner/source checksum mismatch' }
 if ($f.runtimeFiles.Count -gt 512) { throw 'Runtime inventory bound' }
 foreach ($e in $f.runtimeFiles) {
  if ($e.path -notmatch '^[a-zA-Z0-9_./-]+$' -or $e.path -match '(^|/)\.\.?(/|$)' -or $e.path.StartsWith('/')) { throw 'Runtime path rejected' }
  $p=Under (Join-Path $f.root $e.path) $f.root;[void](Assert-SandboxProbePlainPath $p)
  if ((Get-Item -LiteralPath $p).Length -ne $e.bytes -or (Hash $p) -cne $e.sha256) { throw 'Runtime copy checksum mismatch' }
 }
 $asar=Under (Join-Path $f.root 'resources\app.asar') $f.root;[void](Assert-SandboxProbePlainPath $asar)
 if ((Get-Item -LiteralPath $asar).Length -ne $f.asar.bytes -or (Hash $asar) -cne $f.asar.sha256) { throw 'Controlled ASAR checksum mismatch' }
 if ($f.images[0].level -cne 'requireAdministrator' -or $f.images[1].level -cne 'asInvoker') { throw 'Manifest case ordering mismatch' }
 foreach ($e in $f.images) {if ($e.name -cne ($e.level+'.exe') -or $e.fuses -cne '000011011') { throw 'Unexpected image/fuses selection' }}
}
$f=Read-Json $Fixture
Assert-Fixture $f
if ($Mode -eq 'PrepareOnly') {
 if ($f.prepared -ne $false -or $f.applicationTargetExecutions -ne 0) { throw 'Only a fresh provisional fixture can be prepared' }
 foreach ($e in $f.images) {[LagomSandboxImageProbe]::RestoreOriginalVersionResource($f.sourceImage,(Join-Path $f.root $e.name))}
 $left=[LagomSandboxImageProbe]::ImageInventory((Join-Path $f.root $f.images[0].name))
 $right=[LagomSandboxImageProbe]::ImageInventory((Join-Path $f.root $f.images[1].name))
 $lm=Get-SandboxProbeManifest $left['manifest'] 'requireAdministrator'
 $rm=Get-SandboxProbeManifest $right['manifest'] 'asInvoker'
 if ($lm -cne $rm -or $left['manifestKey'] -cne $right['manifestKey']) { throw 'Manifest changed beyond requestedExecutionLevel' }
 foreach ($kind in @('resources','nonResourceSections')) {
  $a=$left[$kind];$b=$right[$kind]
  if ($a.Count -ne $b.Count) { throw 'PE inventory keys differ' }
  foreach ($key in $a.Keys) {
   if (-not $b.ContainsKey($key)) { throw 'PE inventory key missing' }
   if ($kind -ceq 'resources' -and $key -ceq $left['manifestKey']) { continue }
   if ($a[$key] -cne $b[$key]) { throw 'Nonmanifest PE resource/code/data differs' }
  }
 }
 $original=[LagomSandboxImageProbe]::ImageInventory($f.sourceImage)
 foreach ($key in $original['resources'].Keys) {
  if ($key -ceq $original['manifestKey']) { continue }
  if (-not $left['resources'].ContainsKey($key) -or $left['resources'][$key] -cne $original['resources'][$key]) { throw 'Original nonmanifest resource changed' }
 }
 foreach ($e in $f.images) {
  $p=Join-Path $f.root $e.name
  $e | Add-Member -NotePropertyName sha256 -NotePropertyValue (Hash $p)
  $e | Add-Member -NotePropertyName bytes -NotePropertyValue (Get-Item -LiteralPath $p).Length
 }
 $f | Add-Member -NotePropertyName pairComparison -NotePropertyValue @{nonManifestResourcesEqual=$true;codeDataSectionsEqual=$true;semanticManifestDifference='requestedExecutionLevel';sourceVersionResourcesPreserved=$true;xmlPaddingCommentsIgnored=$true;resourceOffsetsNotCompared=$true}
 $f.prepared=$true
 Write-OwnJson $Fixture $f $f.root
 '{"schemaVersion":1,"prepared":true,"targetExecutions":0}'
 return
}
if (-not $f.prepared -or -not $f.pairComparison.nonManifestResourcesEqual -or -not $f.pairComparison.codeDataSectionsEqual) { throw 'Prepared manifest fixture required' }
$callerToken=[LagomEngineJob]::CurrentToken()
try {$caller=[LagomSandboxImageProbe]::TokenMetadata($callerToken)} finally {[void][LagomEngineJob]::CloseHandle($callerToken)}
if (-not $caller['elevated'] -or $caller['integrityRid'] -lt 12288 -or $caller['administrativeEnabledSidCount'] -lt 1) { throw 'Actual elevated high administrator token required' }
$cases=@();$holds=@();$supervisorFatal=$null
try {
 foreach ($e in $f.images) {$holds+=,(Open-SandboxProbeInput (Join-Path $f.root $e.name) $e.sha256)}
 $engineCases=@(foreach ($image in $f.images) {@{name=$image.level;image=$image;child=$null}})
 $engineCases+=@{name='requireAdministrator-routed';image=$f.images[0];child=$f.images[1]}
 foreach ($selection in $engineCases) {
  $e=$selection.image
  $caseRoot=Join-Path $Work ('engine-case-'+$selection.name+'-'+[Guid]::NewGuid().ToString('N'))
  [LagomSandboxImageProbe]::NewDirectory($caseRoot)
  $private=Join-Path $caseRoot 'private';[LagomSandboxImageProbe]::NewDirectory($private)
  $log=Join-Path $private 'chromium.raw.log'
  $expected=Join-Path $f.root $e.name
  $expectedChild=if ($selection.child) {Join-Path $f.root $selection.child.name} else {$expected}
  $expectedChildName=[IO.Path]::GetFileName($expectedChild)
  $result=[ordered]@{caseName=$selection.name;level=$e.level;childImageName=$expectedChildName;childRoutingSelected=[bool]$selection.child;imageSha256=$e.sha256;asarSha256=$f.asar.sha256;asarHeaderSha256=$f.asar.headerSha256;fuses=$e.fuses;created=$false;assigned=$false;resumed=$false;timedOut=$false;logBudgetExceeded=$false;exitCode=$null;exitHex=$null;processes=@();observationErrors=@();appProof=$null;casePassed=$false;cleanup=@{jobEmpty=$false;parentRetired=$false;handlesClosed=$false}}
  $job=[IntPtr]::Zero;$parent=[IntPtr]::Zero;$thread=[IntPtr]::Zero;$observed=@{};$observationErrors=@();$clock=[Diagnostics.Stopwatch]::StartNew()
  try {
   $job=[LagomEngineJob]::NewJob()
   $vars=[ordered]@{SystemRoot=$env:SystemRoot;windir=$env:SystemRoot;TEMP=$caseRoot;TMP=$caseRoot;NODE_ENV='production';LAGOM_ENGINE_WORK=$caseRoot;ELECTRON_ENABLE_LOGGING='1';ELECTRON_LOG_FILE=$log;ELECTRON_ENABLE_STACK_DUMPING='1'}
   if ($selection.child) {$vars['LAGOM_ENGINE_CHILD_PATH']=$expectedChild}
   $environment=(($vars.GetEnumerator()|Sort-Object Key|ForEach-Object {$_.Key+'='+$_.Value}) -join [char]0)+[char]0+[char]0
   $launch=[LagomEngineJob]::CreateSuspended($job,$expected,$f.root,$environment)
   $result.created=[bool]$launch['created']
   if (-not $result.created) {$result['launchError']=$launch['win32Error'];continue}
   $parent=[IntPtr]$launch['process'];$thread=[IntPtr]$launch['thread']
   $result.assigned=[bool]$launch['assigned']
   if (-not $result.assigned) {$result['assignmentError']=$launch['win32Error'];continue}
   $result['parent']=Read-Identity $parent $f.root $expected
   if ([LagomEngineJob]::ResumeThread($thread) -eq [uint32]::MaxValue) { $result['resumeError']=[LagomEngineJob]::LastError();continue }
   $result.resumed=$true
   while ($clock.ElapsedMilliseconds -lt 25000) {
    foreach ($id in [LagomEngineJob]::Members($job)) {
     $h=[IntPtr]::Zero
     try {
      $h=[LagomEngineJob]::OpenOwned($job,$id)
      $selectedImage=if ($id -eq $launch['pid']) {$expected} else {$expectedChild}
      $info=Read-Identity $h $f.root $selectedImage $expected
      $key=([string]$info.pid)+'/'+([string]$info.birthFileTime)
      if (-not $observed.ContainsKey($key) -and $observed.Count -lt 64) { $observed[$key]=$info }
     } catch {if ($observationErrors.Count -lt 16) {$observationErrors+=,(Error-Metadata $_)}}
     finally {if ($h -ne [IntPtr]::Zero) {[void][LagomEngineJob]::CloseHandle($h)}}
    }
    if ([IO.File]::Exists($log)) {[void](Assert-SandboxProbePlainPath $log);if ((Get-Item -LiteralPath $log).Length -gt 1048576) {$result.logBudgetExceeded=$true;break}}
    $wait=[LagomEngineJob]::WaitForSingleObject($parent,100)
    if ($wait -eq 0) {$result.exitCode=[LagomEngineJob]::ExitCode($parent);$result.exitHex=('0x{0:X8}' -f [uint32]$result.exitCode);break}
    if ($wait -ne 258) {throw 'Captured parent wait failed'}
   }
   if ($null -eq $result.exitCode -and -not $result.logBudgetExceeded) { $result.timedOut=$true }
  } catch {$result['supervisorError']=Error-Metadata $_}
  finally {
   $clock.Stop()
   if ($job -ne [IntPtr]::Zero) {
    try {
     [void][LagomEngineJob]::TerminateJobObject($job,0xE002)
     $drain=[Diagnostics.Stopwatch]::StartNew()
     while ($drain.ElapsedMilliseconds -lt 5000 -and ([LagomEngineJob]::Members($job)).Length -ne 0) {[Threading.Thread]::Sleep(50)}
     $result.cleanup.jobEmpty=([LagomEngineJob]::Members($job)).Length -eq 0
    } catch {$result.cleanup['error']=Error-Metadata $_}
   }
   try {
    if ($parent -ne [IntPtr]::Zero) {
     if ([LagomEngineJob]::WaitForSingleObject($parent,0) -ne 0) {[void][LagomEngineJob]::TerminateProcess($parent,0xE003)}
     $result.cleanup.parentRetired=[LagomEngineJob]::WaitForSingleObject($parent,5000) -eq 0
     if ($null -eq $result.exitCode -and $result.cleanup.parentRetired) {$result.exitCode=[LagomEngineJob]::ExitCode($parent);$result.exitHex=('0x{0:X8}' -f [uint32]$result.exitCode)}
    }
   } catch {$result.cleanup['parentError']=Error-Metadata $_}
   $closed=$true
   foreach ($h in @($thread,$parent,$job)) {if ($h -ne [IntPtr]::Zero) {$closed=[LagomEngineJob]::CloseHandle($h) -and $closed}}
   $result.cleanup.handlesClosed=$closed
   $result['elapsedMilliseconds']=$clock.ElapsedMilliseconds
   $result.processes=@($observed.Values|Sort-Object pid)
   $result.observationErrors=$observationErrors
   $proofPath=Join-Path $caseRoot 'app-proof.json'
   if ([IO.File]::Exists($proofPath)) {
    try {
     $proof=Read-Json $proofPath 16384
     # Only fixed-schema proof fields; no URLs, environment, messages, or GPU driver metadata.
     $safe=[ordered]@{}
     foreach ($name in @('schemaVersion','level','pid','electron','chrome','phase','childImageSelected','visible','focusObserved','networkRequestsBlocked','childFailures','result','rendererPid','gpuInfoResolved','metrics','gpuMetricPresent','ok','rendererFailure','errorClass')) {
      if ($proof.PSObject.Properties.Name -contains $name) {$safe[$name]=$proof.$name}
     }
     $result.appProof=$safe
     $rendererRecords=@(if($safe.Contains('rendererPid')){$result.processes|Where-Object {$_.pid -eq $safe.rendererPid}})
     $rendererObserved=@($rendererRecords).Count -gt 0
     $rendererSandboxObserved=@($rendererRecords|Where-Object {$_.token['isRestricted'] -eq $true -and $_.token['integrityRid'] -le 4096 -and $_.token['elevated'] -eq $false -and $_.imageRelative -ceq $expectedChildName}).Count -gt 0
     $gpuObserved=$false;$gpuSandboxObserved=$false
     if ($safe.Contains('metrics')) {
      foreach ($metric in $safe.metrics) {
       if ($metric.type -cne 'GPU') {continue}
       $gpuRecords=@($result.processes|Where-Object {$_.pid -eq $metric.pid -and $_.imageRelative -ceq $expectedChildName})
       if ($gpuRecords.Count -gt 0) {$gpuObserved=$true}
       if (@($gpuRecords|Where-Object {$_.token['isRestricted'] -eq $true -and $_.token['integrityRid'] -le 4096 -and $_.token['elevated'] -eq $false}).Count -gt 0) {$gpuSandboxObserved=$true}
      }
     }
     $result['rendererOwnedReadback']=$rendererObserved;$result['rendererRestrictedLowTokenReadback']=$rendererSandboxObserved;$result['gpuOwnedReadback']=$gpuObserved;$result['gpuRestrictedLowTokenReadback']=$gpuSandboxObserved
     $result.casePassed=$result.resumed -and $result.exitCode -eq 0 -and -not $result.timedOut -and -not $result.logBudgetExceeded -and $safe.Contains('ok') -and $safe.ok -eq $true -and $safe.childImageSelected -eq [bool]$selection.child -and $safe.phase -ceq 'engine-complete' -and $safe.pid -eq $result.parent.pid -and $rendererObserved -and $rendererSandboxObserved -and $gpuObserved -and $gpuSandboxObserved -and $result.parent.token['elevated'] -eq $true -and $result.parent.token['integrityRid'] -ge 12288 -and $result.cleanup.jobEmpty -and $result.cleanup.parentRetired -and $result.cleanup.handlesClosed -and -not $result.Contains('supervisorError') -and -not $result.cleanup.ContainsKey('error') -and -not $result.cleanup.ContainsKey('parentError')
    } catch {$result['proofError']=Error-Metadata $_}
   }
   if ([IO.File]::Exists($log)) {
    try {
     [void](Assert-SandboxProbePlainPath $log)
     $s=[IO.FileStream]::new($log,'Open','Read','ReadWrite')
     try {
      [LagomSandboxImageProbe]::AssertPinnedFile($s,$log)
      $producerBytes=$s.Length;$count=[int][Math]::Min(1048576,$producerBytes);$s.Position=$producerBytes-$count
      $bytes=New-Object byte[] $count;$read=0
      while ($read -lt $count) {$n=$s.Read($bytes,$read,$count-$read);if ($n -eq 0) {break};$read+=$n}
      if ($read -ne $count) {throw 'Private log changed after owned process retirement'}
     } finally {$s.Dispose()}
     $tail=Join-Path $private 'chromium.export-tail.log'
     $out=[IO.FileStream]::new($tail,'CreateNew','Write','None');try {$out.Write($bytes,0,$count);$out.Flush($true)} finally {$out.Dispose()}
     $text=[Text.Encoding]::UTF8.GetString($bytes)
     $result['log']=@{producerBytes=$producerBytes;exportBytes=$count;exportSha256=(Hash $tail);truncated=$producerBytes -gt $count;gpuLaunchFailureCount=([regex]::Matches($text,'GPU process launch failed')).Count;error18Count=([regex]::Matches($text,'error_code=18\b')).Count;fatalCount=([regex]::Matches($text,'FATAL')).Count;exportIsTail=$true;rawPublicArtifact=$false;producerPollingOvershootPossible=$true}
    } catch {$result['logError']=Error-Metadata $_}
   }
   $cases+=,$result
   # A failed cleanup stops further target execution; it cannot be relabelled as a case pass.
   if (-not $result.cleanup.jobEmpty -or -not $result.cleanup.handlesClosed -or ($result.created -and -not $result.cleanup.parentRetired)) {throw 'Owned fixture cleanup incomplete'}
  }
 }
 Assert-Fixture $f
 foreach ($i in 0..1) {if ((Get-SandboxProbeHash $holds[$i]) -cne $f.images[$i].sha256) {throw 'Pinned target changed'}}
} catch {$supervisorFatal=Error-Metadata $_} finally {foreach ($hold in $holds) {$hold.Dispose()}}
$report=[ordered]@{schemaVersion=1;diagnosticComplete=$cases.Count -eq 3 -and $null -eq $supervisorFatal;allCasesPassed=$cases.Count -eq 3 -and $null -eq $supervisorFatal -and @($cases|Where-Object {-not $_.casePassed}).Count -eq 0;supervisorFatal=$supervisorFatal;sourceVersion=$f.version;sourceImageSha256=$f.sourceImageSha;fixtureReceiptSha256=(Hash $Fixture);librarySha256=$libraryHash;runnerSha256=(Hash $PSCommandPath);callerToken=$caller;pairComparison=$f.pairComparison;cases=$cases;limits=@('Real execution is hosted CI only; no local GUI was executed during preparation.','This fixture tests the engine and manifest boundary, not product IPC/services/installer.','Parent station and child station are not measured.','Owned job active-process cap16; engine25s and cleanup5s per phase; OS native calls are synchronous.','Raw log producer may overshoot1MiB between100ms polls; private exported tail is at most1MiB.','Polling can miss short-lived children; absent owned renderer/GPU readback makes casePassed false.')}
$reportPath=Join-Path $Work 'electron-manifest-engine.json'
Write-OwnJson $reportPath $report $Work
[ordered]@{schemaVersion=1;report=$reportPath;reportSha256=(Hash $reportPath);diagnosticComplete=$report.diagnosticComplete;allCasesPassed=$report.allCasesPassed}|ConvertTo-Json -Compress

