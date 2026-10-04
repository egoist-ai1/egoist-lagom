[CmdletBinding()]
param(
  [switch]$LibraryOnly,
  [string]$Image,
  [string]$ImageSha256,
  [ValidateSet('requireAdministrator','asInvoker')][string]$SourceExecutionLevel='requireAdministrator',
  [string]$Rcedit,
  [string]$RceditSha256,
  [string]$Work
)
if($PSVersionTable.PSEdition -eq 'Desktop') { $env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules') }
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Initialize-SandboxImageProbeNative {
  param([Parameter(Mandatory)][string]$TemporaryDirectory)
  if ('LagomSandboxImageProbe' -as [type]) { return }
  $nativeSource = @"
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
public static class LagomSandboxImageProbe {
  [StructLayout(LayoutKind.Sequential)] struct SID_ATTR { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct GROUPS { public uint Count; public SID_ATTR First; }
  [StructLayout(LayoutKind.Sequential)] struct LUID_ATTR { public uint Low; public int High; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct PRIVILEGES { public uint Count; public LUID_ATTR First; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUP {
    public uint cb; public string reserved, desktop, title; public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
    public ushort show,reserved2; public IntPtr reservedPtr,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct FILE_INFO {
    public uint attrs,createLow,createHigh,accessLow,accessHigh,writeLow,writeHigh,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;
  }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct ENTRY {
    public uint size,usage,pid; public UIntPtr heap; public uint module,threads,parent; public int priority; public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string exe;
  }
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool DuplicateTokenEx(IntPtr token,uint access,IntPtr security,int impersonation,int type,out IntPtr duplicate);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr data,int bytes,out int needed);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetTokenInformation(IntPtr token,int kind,IntPtr data,int bytes);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr token,uint flags,uint disableCount,IntPtr disable,uint deleteCount,IntPtr delete,uint restrictCount,IntPtr restrict,out IntPtr result);
  [DllImport("advapi32.dll")] static extern bool IsTokenRestricted(IntPtr token);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSidToSid(string sid,out IntPtr pointer);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessAsUserW(IntPtr token,string image,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string directory,ref STARTUP startup,out PROCESS result);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectoryW(string path,IntPtr security);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out FILE_INFO information);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,StringBuilder path,uint size,uint flags);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32FirstW(IntPtr snapshot,ref ENTRY entry);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32NextW(IntPtr snapshot,ref ENTRY entry);
  delegate bool TypeCallback(IntPtr module,IntPtr type,IntPtr parameter);
  delegate bool NameCallback(IntPtr module,IntPtr type,IntPtr name,IntPtr parameter);
  delegate bool LanguageCallback(IntPtr module,IntPtr type,IntPtr name,ushort language,IntPtr parameter);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryExW(string path,IntPtr file,uint flags);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool FreeLibrary(IntPtr module);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool EnumResourceTypesW(IntPtr module,TypeCallback callback,IntPtr parameter);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool EnumResourceNamesW(IntPtr module,IntPtr type,NameCallback callback,IntPtr parameter);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool EnumResourceLanguagesW(IntPtr module,IntPtr type,IntPtr name,LanguageCallback callback,IntPtr parameter);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr FindResourceExW(IntPtr module,IntPtr type,IntPtr name,ushort language);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint SizeofResource(IntPtr module,IntPtr resource);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr LoadResource(IntPtr module,IntPtr resource);
  [DllImport("kernel32.dll")] static extern IntPtr LockResource(IntPtr resource);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr BeginUpdateResourceW(string path,bool deleteExisting);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool UpdateResourceW(IntPtr update,IntPtr type,IntPtr name,ushort language,byte[] bytes,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool EndUpdateResourceW(IntPtr update,bool discard);
  static Exception Error(string operation) { return new Win32Exception(Marshal.GetLastWin32Error(),operation); }
  static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant(); }
  static string Hash(byte[] bytes) { using(var sha=SHA256.Create())return Hex(sha.ComputeHash(bytes)); }
  static IntPtr Info(IntPtr token,int kind) {
    int needed; GetTokenInformation(token,kind,IntPtr.Zero,0,out needed);
    if(needed<1||needed>1048576)throw Error("GetTokenInformation size kind="+kind+" bytes="+needed);
    var memory=Marshal.AllocHGlobal(needed);
    if(!GetTokenInformation(token,kind,memory,needed,out needed)){Marshal.FreeHGlobal(memory);throw Error("GetTokenInformation");}
    return memory;
  }
  static uint Scalar(IntPtr token,int kind) { var memory=Info(token,kind);try{return kind==21?(uint)Marshal.ReadByte(memory):unchecked((uint)Marshal.ReadInt32(memory));}finally{Marshal.FreeHGlobal(memory);} }
  static bool Administrative(string sid) {
    return new[]{"S-1-5-32-544","S-1-5-32-548","S-1-5-32-549","S-1-5-32-550","S-1-5-32-551","S-1-5-32-556","S-1-5-32-578"}.Contains(sid) ||
      (sid.StartsWith("S-1-5-21-",StringComparison.Ordinal) && new[]{"512","518","519"}.Contains(sid.Substring(sid.LastIndexOf('-')+1)));
  }
  public static Dictionary<string,object> TokenMetadata(IntPtr token) {
    var metadata=new Dictionary<string,object>();metadata["tokenType"]=Scalar(token,8);metadata["sessionId"]=Scalar(token,12);
    metadata["elevationType"]=Scalar(token,18);metadata["elevated"]=Scalar(token,20)!=0;metadata["isRestricted"]=IsTokenRestricted(token);
    metadata["hasRestrictions"]=Scalar(token,21)!=0;metadata["isAppContainer"]=Scalar(token,29)!=0;
    var restrictions=Info(token,11);try{
      uint count=unchecked((uint)Marshal.ReadInt32(restrictions));metadata["restrictingSidCount"]=count;
      if(count==1){var group=(SID_ATTR)Marshal.PtrToStructure(IntPtr.Add(restrictions,Marshal.OffsetOf(typeof(GROUPS),"First").ToInt32()),typeof(SID_ATTR));
        var user=Info(token,1);try{bool same=new SecurityIdentifier(group.Sid).Equals(new SecurityIdentifier(Marshal.ReadIntPtr(user)));
          metadata["restrictingSidProfile"]=same?"own-token-user":"other";metadata["restrictingSidSha256"]=Hash(Encoding.UTF8.GetBytes(new SecurityIdentifier(group.Sid).Value));
        }finally{Marshal.FreeHGlobal(user);}}
      else metadata["restrictingSidProfile"]=count==0?"none":"multiple";
    }finally{Marshal.FreeHGlobal(restrictions);}
    var label=Info(token,25);try{
      var sid=new SecurityIdentifier(Marshal.ReadIntPtr(label));var text=sid.Value;
      metadata["integrityRid"]=UInt32.Parse(text.Substring(text.LastIndexOf('-')+1));
    }finally{Marshal.FreeHGlobal(label);}
    var groups=Info(token,2);try{
      int count=Marshal.ReadInt32(groups),offset=Marshal.OffsetOf(typeof(GROUPS),"First").ToInt32(),stride=Marshal.SizeOf(typeof(SID_ATTR));
      int enabled=0,deny=0;for(int i=0;i<count;i++){var group=(SID_ATTR)Marshal.PtrToStructure(IntPtr.Add(groups,offset+i*stride),typeof(SID_ATTR));
        if(Administrative(new SecurityIdentifier(group.Sid).Value)){if((group.Attributes&4)!=0)enabled++;if((group.Attributes&16)!=0)deny++;}}
      metadata["administrativeEnabledSidCount"]=enabled;metadata["administrativeDenyOnlySidCount"]=deny;
    }finally{Marshal.FreeHGlobal(groups);}
    var privileges=Info(token,3);try{metadata["privilegeCount"]=unchecked((uint)Marshal.ReadInt32(privileges));}finally{Marshal.FreeHGlobal(privileges);}
    return metadata;
  }
  public static IntPtr CurrentPrimary() {
    IntPtr original=IntPtr.Zero,result=IntPtr.Zero;
    if(!OpenProcessToken(GetCurrentProcess(),0x000B,out original))throw Error("OpenProcessToken");
    try{if(!DuplicateTokenEx(original,0x000F01FF,IntPtr.Zero,2,1,out result))throw Error("DuplicateTokenEx");return result;}
    finally{CloseHandle(original);}
  }
  public static IntPtr RestrictedLow(IntPtr primary) {
    IntPtr groups=Info(primary,2),privileges=Info(primary,3),user=Info(primary,1),restriction=IntPtr.Zero,disabled=IntPtr.Zero,result=IntPtr.Zero,lowSid=IntPtr.Zero,label=IntPtr.Zero;
    try{
      int count=Marshal.ReadInt32(groups),offset=Marshal.OffsetOf(typeof(GROUPS),"First").ToInt32(),stride=Marshal.SizeOf(typeof(SID_ATTR));
      var selected=new List<SID_ATTR>();for(int i=0;i<count;i++){var group=(SID_ATTR)Marshal.PtrToStructure(IntPtr.Add(groups,offset+i*stride),typeof(SID_ATTR));
        if((group.Attributes&4)!=0 && Administrative(new SecurityIdentifier(group.Sid).Value))selected.Add(group);}
      if(selected.Count>0){disabled=Marshal.AllocHGlobal(stride*selected.Count);for(int i=0;i<selected.Count;i++)Marshal.StructureToPtr(selected[i],IntPtr.Add(disabled,stride*i),false);}
      uint deleteCount=unchecked((uint)Marshal.ReadInt32(privileges));int privOffset=Marshal.OffsetOf(typeof(PRIVILEGES),"First").ToInt32();
      restriction=Marshal.AllocHGlobal(stride);Marshal.StructureToPtr(new SID_ATTR{Sid=Marshal.ReadIntPtr(user),Attributes=0},restriction,false);
      if(!CreateRestrictedToken(primary,0,(uint)selected.Count,disabled,deleteCount,deleteCount==0?IntPtr.Zero:IntPtr.Add(privileges,privOffset),1,restriction,out result))throw Error("CreateRestrictedToken");
      if(!ConvertStringSidToSid("S-1-16-4096",out lowSid))throw Error("ConvertStringSidToSid");
      int sidBytes=new SecurityIdentifier("S-1-16-4096").BinaryLength;
      label=Marshal.AllocHGlobal(stride+sidBytes);Marshal.StructureToPtr(new SID_ATTR{Sid=lowSid,Attributes=0x20},label,false);
      if(!SetTokenInformation(result,25,label,stride+sidBytes))throw Error("SetTokenInformation Low");
      return result;
    }catch{if(result!=IntPtr.Zero)CloseHandle(result);throw;}
    finally{if(restriction!=IntPtr.Zero)Marshal.FreeHGlobal(restriction);Marshal.FreeHGlobal(user);if(label!=IntPtr.Zero)Marshal.FreeHGlobal(label);if(lowSid!=IntPtr.Zero)LocalFree(lowSid);if(disabled!=IntPtr.Zero)Marshal.FreeHGlobal(disabled);Marshal.FreeHGlobal(groups);Marshal.FreeHGlobal(privileges);}
  }
  public static void CloseToken(IntPtr token) { if(token!=IntPtr.Zero&&!CloseHandle(token))throw Error("CloseHandle token"); }
  public static void NewDirectory(string path) { if(!CreateDirectoryW(path,IntPtr.Zero))throw Error("CreateDirectoryW fresh work"); }
  public static void AssertPinnedFile(FileStream stream,string expected) {
    FILE_INFO information;if(!GetFileInformationByHandle(stream.SafeFileHandle,out information))throw Error("GetFileInformationByHandle");
    var path=new StringBuilder(32768);uint length=GetFinalPathNameByHandleW(stream.SafeFileHandle,path,(uint)path.Capacity,0);
    if(length==0||length>=path.Capacity)throw Error("GetFinalPathNameByHandleW");
    if(information.links!=1||(information.attrs&0x400)!=0||!path.ToString().Equals(@"\\?\"+Path.GetFullPath(expected),StringComparison.OrdinalIgnoreCase))
      throw new IOException("Input handle is linked, reparse or points to a different path.");
  }
  static int OwnChildren(uint pid) {
    var snapshot=CreateToolhelp32Snapshot(2,0);if(snapshot==new IntPtr(-1))throw Error("CreateToolhelp32Snapshot");
    try{var entry=new ENTRY{size=(uint)Marshal.SizeOf(typeof(ENTRY))};if(!Process32FirstW(snapshot,ref entry))throw Error("Process32FirstW");
      int observed=0,items=0;do{if(++items>65536)throw new IOException("Process snapshot limit.");if(entry.parent==pid)observed++;}while(Process32NextW(snapshot,ref entry));
      int last=Marshal.GetLastWin32Error();if(last!=18)throw new Win32Exception(last,"Process32NextW");return observed;
    }finally{CloseHandle(snapshot);}
  }
  public static Dictionary<string,object> SuspendedLaunch(IntPtr token,string image) {
    var row=new Dictionary<string,object>();row["creationFlags"]="0x08000004";row["inheritHandles"]=false;row["resumeThreadCalls"]=0;
    row["commandArgumentsCount"]=0;row["environmentPolicy"]="inherit, never exported";row["desktopPolicy"]="null/inherit";
    var startup=new STARTUP{cb=(uint)Marshal.SizeOf(typeof(STARTUP)),flags=1,show=0};PROCESS process;
    bool created=CreateProcessAsUserW(token,image,new StringBuilder("\""+image+"\""),IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,Path.GetDirectoryName(image),ref startup,out process);
    int lastError=Marshal.GetLastWin32Error(); // MUST be the first managed/native observation after the launch call.
    row["created"]=created;row["win32Error"]=created?(object)null:lastError;row["lastErrorMeaningful"]=!created;
    if(!created){row["ownChildrenObserved"]=0;row["ownChildrenObservation"]="no process was created";row["handlesClosed"]=true;return row;}
    try{
      row["pid"]=process.pid;row["ownChildrenObserved"]=OwnChildren(process.pid);row["ownChildrenObservation"]="Toolhelp while initial thread remained suspended";
      if(!TerminateProcess(process.process,0xE001))throw Error("TerminateProcess suspended own handle");
      uint wait=WaitForSingleObject(process.process,5000);row["retireWait"]=wait;if(wait!=0)throw new IOException("Suspended process did not retire within 5000ms.");
      uint code;if(!GetExitCodeProcess(process.process,out code))throw Error("GetExitCodeProcess");row["exitCode"]=code;
    }finally{
      uint wait=WaitForSingleObject(process.process,0);
      if(wait!=0){TerminateProcess(process.process,0xE001);wait=WaitForSingleObject(process.process,5000);}
      bool threadClosed=CloseHandle(process.thread),processClosed=CloseHandle(process.process);
      row["handlesClosed"]=threadClosed&&processClosed;
      if(wait!=0||!threadClosed||!processClosed)throw new IOException("Suspended own-process cleanup failed.");
    }
    return row;
  }
  public static void RestoreOriginalVersionResource(string original,string target) {
    var versions=new Dictionary<ushort,byte[]>();string callbackError=null;var module=LoadLibraryExW(original,IntPtr.Zero,0x60);
    if(module==IntPtr.Zero)throw Error("LoadLibraryExW original version only");
    try {
      LanguageCallback callback=(m,type,name,language,p)=>{
        try {var resource=FindResourceExW(module,type,name,language);uint size=SizeofResource(module,resource);
          if(resource==IntPtr.Zero||size==0||size>1048576||versions.Count>=16)throw new IOException("Expected bounded RT_VERSION #16/#1 languages.");
          var data=LockResource(LoadResource(module,resource));if(data==IntPtr.Zero)throw Error("LoadResource original version");
          var bytes=new byte[size];Marshal.Copy(data,bytes,0,bytes.Length);versions.Add(language,bytes);return true;
        }catch(Exception e){callbackError=e.GetType().Name+":"+e.Message;return false;}};
      if(!EnumResourceLanguagesW(module,new IntPtr(16),new IntPtr(1),callback,IntPtr.Zero)||callbackError!=null)throw new IOException(callbackError??"Original version enumeration failed.");
    }finally{if(!FreeLibrary(module))throw Error("FreeLibrary original version");}
    var update=BeginUpdateResourceW(target,false);if(update==IntPtr.Zero)throw Error("BeginUpdateResourceW own copy");
    bool ended=false;
    try {
      foreach(var version in versions)if(!UpdateResourceW(update,new IntPtr(16),new IntPtr(1),version.Key,version.Value,(uint)version.Value.Length))throw Error("UpdateResourceW original version");
      if(!EndUpdateResourceW(update,false))throw Error("EndUpdateResourceW original version");
      ended=true;
    }finally{if(!ended)EndUpdateResourceW(update,true);}
  }
  static string ResourceName(IntPtr name) { long value=name.ToInt64();return value>=0&&value<=65535?"#"+value:Marshal.PtrToStringUni(name); }
  public static Dictionary<string,object> ImageInventory(string image) {
    var resources=new SortedDictionary<string,string>(StringComparer.Ordinal);string manifest=null,manifestKey=null,callbackError=null;long total=0;
    var module=LoadLibraryExW(image,IntPtr.Zero,0x60);if(module==IntPtr.Zero)throw Error("LoadLibraryExW data/image resource only");
    try{
      TypeCallback typeCallback=(m,type,p)=>{
        try{NameCallback nameCallback=(n,t,name,q)=>{
          try{LanguageCallback languageCallback=(l,lt,ln,language,r)=>{
            try{var resource=FindResourceExW(module,lt,ln,language);uint size=SizeofResource(module,resource);
              if(resource==IntPtr.Zero||size>16777216||resources.Count>=512||(total+=size)>67108864)throw new IOException("Resource inventory bounds.");
              var data=LockResource(LoadResource(module,resource));if(data==IntPtr.Zero)throw Error("LoadResource");
              var bytes=new byte[size];Marshal.Copy(data,bytes,0,bytes.Length);string key=ResourceName(lt)+"/"+ResourceName(ln)+"/"+language;
              resources.Add(key,Hash(bytes));if(ResourceName(lt)=="#24"){if(manifest!=null)throw new IOException("Ambiguous manifest resources.");manifest=new UTF8Encoding(false,true).GetString(bytes);manifestKey=key;}return true;
            }catch(Exception e){callbackError=e.GetType().Name+":"+e.Message;return false;}};
            return EnumResourceLanguagesW(module,t,name,languageCallback,IntPtr.Zero);
          }catch(Exception e){callbackError=e.GetType().Name+":"+e.Message;return false;}};
          return EnumResourceNamesW(module,type,nameCallback,IntPtr.Zero);
        }catch(Exception e){callbackError=e.GetType().Name+":"+e.Message;return false;}};
      if(!EnumResourceTypesW(module,typeCallback,IntPtr.Zero))throw new IOException(callbackError??"Resource enumeration failed.");
      if(callbackError!=null||manifest==null)throw new IOException(callbackError??"Missing manifest.");
    }finally{if(!FreeLibrary(module))throw Error("FreeLibrary resource-only mapping");}
    var sections=new SortedDictionary<string,string>(StringComparer.Ordinal);
    using(var file=new FileStream(image,FileMode.Open,FileAccess.Read,FileShare.Read))
    using(var reader=new BinaryReader(file)){
      if(file.Length<1024||file.Length>268435456)throw new IOException("Image bounds.");
      file.Position=0x3c;int pe=reader.ReadInt32();if(pe<64||pe>1048576)throw new IOException("PE offset.");
      file.Position=pe;if(reader.ReadUInt32()!=0x4550)throw new IOException("PE signature.");
      reader.ReadUInt16();ushort count=reader.ReadUInt16();file.Position=pe+20;ushort optionalSize=reader.ReadUInt16();file.Position=pe+24;
      ushort magic=reader.ReadUInt16();if(magic!=0x20b||count==0||count>32||optionalSize<240)throw new IOException("Expected bounded PE64 image.");
      file.Position=pe+24+112+32;uint certificateOffset=reader.ReadUInt32(),certificateSize=reader.ReadUInt32();
      if(certificateOffset!=0||certificateSize!=0)throw new IOException("Probe only accepts unsigned images; mutation would invalidate an existing signature.");
      for(int i=0;i<count;i++){
        file.Position=pe+24+optionalSize+i*40;string name=Encoding.ASCII.GetString(reader.ReadBytes(8)).TrimEnd('\0');
        reader.ReadUInt32();reader.ReadUInt32();uint size=reader.ReadUInt32(),offset=reader.ReadUInt32();
        if((long)offset+size>file.Length)throw new IOException("PE section range.");
        if(name==".rsrc")continue;
        using(var sha=SHA256.Create()){file.Position=offset;var buffer=new byte[65536];long remaining=size;
          while(remaining>0){int read=file.Read(buffer,0,(int)Math.Min(remaining,buffer.Length));if(read==0)throw new EndOfStreamException();sha.TransformBlock(buffer,0,read,null,0);remaining-=read;}
          sha.TransformFinalBlock(new byte[0],0,0);sections.Add(name,Hex(sha.Hash));}
      }
    }
    return new Dictionary<string,object>{{"resources",resources},{"nonResourceSections",sections},{"manifest",manifest},{"manifestKey",manifestKey}};
  }
}
"@
  if($PSVersionTable.PSEdition -eq 'Desktop') {
    $compiler=[CodeDom.Compiler.CompilerParameters]::new()
    $compiler.GenerateInMemory=$true;$compiler.TempFiles=[CodeDom.Compiler.TempFileCollection]::new($TemporaryDirectory,$false)
    [void]$compiler.ReferencedAssemblies.Add('System.dll');[void]$compiler.ReferencedAssemblies.Add('System.Core.dll')
    Add-Type -TypeDefinition $nativeSource -CompilerParameters $compiler
  } else { Add-Type -TypeDefinition $nativeSource }
}

function Assert-SandboxProbePlainPath {
  param([string]$Path,[switch]$Directory)
  $full=[IO.Path]::GetFullPath($Path)
  if ($full -notmatch '^[A-Za-z]:\\' -or $full -match '["\x00-\x1f]') { throw 'Probe accepts ordinary absolute local paths.' }
  $current=$full
  while($current) {
    $item=Get-Item -LiteralPath $current -Force -ErrorAction Stop
    if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Probe path contains a reparse point.' }
    if($current -eq $full -and [bool]$item.PSIsContainer -ne [bool]$Directory) { throw 'Probe path has an unexpected kind.' }
    $parent=[IO.Path]::GetDirectoryName($current)
    if(-not $parent -or $parent -eq $current) { break }
    $current=$parent
  }
  return $full
}
function Open-SandboxProbeInput {
  param([string]$Path,[string]$ExpectedHash)
  if($ExpectedHash -cnotmatch '^[a-fA-F0-9]{64}$') { throw 'An exact input SHA256 is required.' }
  $full=Assert-SandboxProbePlainPath $Path
  $stream=[IO.FileStream]::new($full,'Open','Read','Read')
  try {
    [LagomSandboxImageProbe]::AssertPinnedFile($stream,$full)
    if($stream.Length -lt 1024 -or $stream.Length -gt 268435456) { throw 'Probe input exceeds the 256MiB bound.' }
    $sha=[Security.Cryptography.SHA256]::Create()
    try {$observed=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
    if($observed -ine $ExpectedHash) { throw 'Probe input SHA256 differs from its explicit selection.' }
    $stream.Position=0
    return $stream
  } catch { $stream.Dispose(); throw }
}
function Get-SandboxProbeHash {
  param([IO.FileStream]$Stream)
  $Stream.Position=0;$sha=[Security.Cryptography.SHA256]::Create()
  try {return [BitConverter]::ToString($sha.ComputeHash($Stream)).Replace('-','').ToLowerInvariant()}
  finally {$sha.Dispose();$Stream.Position=0}
}
function Get-SandboxProbeManifest {
  param([string]$Text,[string]$ExpectedLevel)
  $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null;$settings.IgnoreComments=$true
  $reader=[Xml.XmlReader]::Create([IO.StringReader]::new($Text.TrimStart([char]0xfeff)),$settings)
  try {$document=[Xml.XmlDocument]::new();$document.XmlResolver=$null;$document.Load($reader)}finally{$reader.Dispose()}
  $nodes=$document.SelectNodes('//*[local-name()="requestedExecutionLevel"]')
  if($nodes.Count -ne 1 -or $nodes[0].GetAttribute('level') -cne $ExpectedLevel -or $nodes[0].GetAttribute('uiAccess') -cne 'false') { throw 'Unexpected GUI manifest execution level or UIAccess.' }
  $nodes[0].SetAttribute('level','requireAdministrator')
  return $document.OuterXml
}
function Invoke-SandboxImageLaunchProbe {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Image,[Parameter(Mandatory)][string]$ImageSha256,
    [ValidateSet('requireAdministrator','asInvoker')][string]$SourceExecutionLevel='requireAdministrator',
    [Parameter(Mandatory)][string]$Rcedit,[Parameter(Mandatory)][string]$RceditSha256,[Parameter(Mandatory)][string]$Work)
  $base=Assert-SandboxProbePlainPath $Work -Directory
  Initialize-SandboxImageProbeNative -TemporaryDirectory $base
  $source=Open-SandboxProbeInput $Image $ImageSha256
  $tool=$null;$primary=[IntPtr]::Zero;$restricted=[IntPtr]::Zero;$copies=@();$result=$null
  try {
    $tool=Open-SandboxProbeInput $Rcedit $RceditSha256
    if([IO.Path]::GetFileName($Rcedit) -cne 'rcedit-x64.exe') { throw 'The fixed project rcedit-x64.exe is required.' }
    $toolInventory=[LagomSandboxImageProbe]::ImageInventory($Rcedit)
    [void](Get-SandboxProbeManifest $toolInventory['manifest'] 'asInvoker')
    $directory=Join-Path $base ('sandbox-image-'+[Guid]::NewGuid().ToString('N'))
    [LagomSandboxImageProbe]::NewDirectory($directory)
    $adminImage=Join-Path $directory 'requireAdministrator.exe';$invokerImage=Join-Path $directory 'asInvoker.exe'
    foreach($copyPath in @($adminImage,$invokerImage)) {
      $target=[IO.FileStream]::new($copyPath,'CreateNew','Write','None')
      try {$source.Position=0;$source.CopyTo($target,65536);$target.Flush($true)}finally{$target.Dispose()}
    }
    $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=[IO.Path]::GetFullPath($Rcedit)
    $editedImage=if($SourceExecutionLevel -ceq 'requireAdministrator'){$invokerImage}else{$adminImage}
    $editedLevel=if($SourceExecutionLevel -ceq 'requireAdministrator'){'asInvoker'}else{'requireAdministrator'}
    $originalCopy=if($SourceExecutionLevel -ceq 'requireAdministrator'){$adminImage}else{$invokerImage}
    [void](Get-SandboxProbeManifest ([LagomSandboxImageProbe]::ImageInventory($originalCopy))['manifest'] $SourceExecutionLevel)
    $info.Arguments='"'+$editedImage+'" --set-requested-execution-level '+$editedLevel
    $info.WorkingDirectory=$directory;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
    $edit=[Diagnostics.Process]::new();$edit.StartInfo=$info;$started=$false
    try {
      $started=$edit.Start();if(-not $started){throw 'rcedit did not start.'}
      if(-not $edit.WaitForExit(15000)){throw 'Own rcedit exceeded 15000ms.'}
      if($edit.ExitCode -ne 0){throw 'rcedit exited nonzero.'}
    } finally {if($started -and -not $edit.HasExited){$edit.Kill();if(-not $edit.WaitForExit(5000)){throw 'Own rcedit did not retire.'}};$edit.Dispose()}
    # rcedit regenerates RT_VERSION even when only the manifest was requested.
    # Restore its exact original bytes; every nonmanifest resource is compared below.
    [LagomSandboxImageProbe]::RestoreOriginalVersionResource($originalCopy,$editedImage)
    $adminHash=if($SourceExecutionLevel -ceq 'requireAdministrator'){$ImageSha256}else{(Get-FileHash -LiteralPath $adminImage -Algorithm SHA256).Hash}
    $adminHold=Open-SandboxProbeInput $adminImage $adminHash;$copies+=,$adminHold
    $invokerHash=if($SourceExecutionLevel -ceq 'asInvoker'){$ImageSha256}else{(Get-FileHash -LiteralPath $invokerImage -Algorithm SHA256).Hash}
    $invokerHold=Open-SandboxProbeInput $invokerImage $invokerHash;$copies+=,$invokerHold
    $adminInventory=[LagomSandboxImageProbe]::ImageInventory($adminImage)
    $invokerInventory=[LagomSandboxImageProbe]::ImageInventory($invokerImage)
    $adminManifest=Get-SandboxProbeManifest $adminInventory['manifest'] 'requireAdministrator'
    $invokerManifest=Get-SandboxProbeManifest $invokerInventory['manifest'] 'asInvoker'
    if($adminManifest -cne $invokerManifest -or $adminInventory['manifestKey'] -cne $invokerInventory['manifestKey']){throw 'Manifest changed beyond requestedExecutionLevel.'}
    foreach($kind in @('resources','nonResourceSections')) {
      $left=$adminInventory[$kind];$right=$invokerInventory[$kind]
      if($left.Count -ne $right.Count){throw 'PE inventory keys changed.'}
      foreach($key in $left.Keys){if(-not $right.ContainsKey($key)){throw 'PE inventory key changed.'};if($kind -eq 'resources' -and $key -eq $adminInventory['manifestKey']){continue};if($left[$key] -cne $right[$key]){throw 'PE content changed outside manifest.'}}
    }
    $primary=[LagomSandboxImageProbe]::CurrentPrimary();$restricted=[LagomSandboxImageProbe]::RestrictedLow($primary)
    $primaryMetadata=[LagomSandboxImageProbe]::TokenMetadata($primary);$restrictedMetadata=[LagomSandboxImageProbe]::TokenMetadata($restricted)
    if($primaryMetadata['tokenType'] -ne 1 -or $restrictedMetadata['tokenType'] -ne 1 -or $restrictedMetadata['integrityRid'] -ne 4096 -or $restrictedMetadata['administrativeEnabledSidCount'] -ne 0 -or $restrictedMetadata['privilegeCount'] -ne 0 -or $restrictedMetadata['isAppContainer'] -or -not $restrictedMetadata['isRestricted'] -or $restrictedMetadata['restrictingSidCount'] -ne 1 -or $restrictedMetadata['restrictingSidProfile'] -cne 'own-token-user'){throw 'Restricted token readback differs from the probe contract.'}
    $cases=@()
    foreach($tokenCase in @(@{name='currentPrimary';handle=$primary;metadata=$primaryMetadata},@{name='restrictedLow';handle=$restricted;metadata=$restrictedMetadata})) {
      foreach($imageCase in @(@{level='requireAdministrator';path=$adminImage},@{level='asInvoker';path=$invokerImage})) {
        $launch=[LagomSandboxImageProbe]::SuspendedLaunch($tokenCase.handle,$imageCase.path)
        if(-not $launch['handlesClosed'] -or $launch['ownChildrenObserved'] -ne 0 -or $launch['resumeThreadCalls'] -ne 0){throw 'Own suspended launch cleanup/child invariants failed.'}
        $cases+=[ordered]@{tokenCase=$tokenCase.name;requestedExecutionLevel=$imageCase.level;token=$tokenCase.metadata;launch=$launch}
      }
    }
    $afterHash=Get-SandboxProbeHash $source
    if($afterHash -ine $ImageSha256 -or (Get-SandboxProbeHash $tool) -ine $RceditSha256){throw 'Pinned original/tool input changed.'}
    $result=[ordered]@{
      schemaVersion=1;kind='suspended-same-image-manifest-counterfactual';observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
      sourceSha256=$afterHash;sourceBytes=$source.Length;sourceExecutionLevel=$SourceExecutionLevel;rceditSha256=$RceditSha256.ToLowerInvariant()
      requireAdministratorSha256=(Get-SandboxProbeHash $adminHold);asInvokerSha256=(Get-SandboxProbeHash $invokerHold)
      sourcePreserved=$true;copyInvariants=[ordered]@{originalCopyByteIdentical=$true;manifestOnlySemanticChange=$true;nonManifestResourceBytesEqual=$true;nonResourceSectionBytesEqual=$true;peResourceLayoutAndHeadersMayDiffer=$true;rceditVersionResourceRestoredByteExactly=$true}
      cases=$cases;allCapturedHandlesClosed=$true;targetThreadEverResumed=$false;targetApplicationCodeExecuted=$false
      mutationScope='fresh own work directory; two temporary EXE copies, one result JSON; current token and installed bytes untouched'
      limits=@('Narrow CreateProcessAsUserW comparison, not Chromium sandbox emulation.','One minimum own TokenUser restricting SID, not Chromium USER_LOCKDOWN; no AppContainer, mitigations, special desktop, inherited handle list, job or broker policy.','Original environment is inherited without export; application arguments are empty.','Current local token/Windows version and temporary-copy ACL differ from elevated CI and ProgramFiles.','All token privileges are deleted; known enabled administrative/operator group SIDs become deny-only.','Creation success proves no startup or GUI functionality: the initial thread never resumes.','Native API call itself has no hard timeout; rcedit wait15s and own child retirement waits5s are bounded.','Execution/resource bytes outside manifest are equal; PE resource layout/header bytes and nonsemantic XML padding comments may differ.')
    }
    $receipt=Join-Path $directory 'probe-result.json';$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($result|ConvertTo-Json -Depth 12))
    $output=[IO.FileStream]::new($receipt,'CreateNew','Write','None')
    try {$output.Write($bytes,0,$bytes.Length);$output.Flush($true)}finally{$output.Dispose()}
    return [ordered]@{receipt=$receipt;result=$result}
  } finally {
    foreach($copy in $copies){$copy.Dispose()}
    [LagomSandboxImageProbe]::CloseToken($restricted);[LagomSandboxImageProbe]::CloseToken($primary)
    if($tool){$tool.Dispose()};$source.Dispose()
  }
}
if(-not $LibraryOnly) {
  $observed=Invoke-SandboxImageLaunchProbe -Image $Image -ImageSha256 $ImageSha256 -SourceExecutionLevel $SourceExecutionLevel -Rcedit $Rcedit -RceditSha256 $RceditSha256 -Work $Work
  [ordered]@{receipt=$observed.receipt;caseCount=$observed.result.cases.Count;sourcePreserved=$observed.result.sourcePreserved;targetThreadEverResumed=$false}|ConvertTo-Json -Compress
}
