[CmdletBinding()]
param(
  [ValidateSet('Probe','GuardOnly','Snapshot')][string]$Mode='Probe',
  [ValidateSet('both','v2rayN','cvr')][string]$Product='both',
  [string]$EvidenceDirectory='',
  [ValidatePattern('^$|^[a-f0-9]{40}$')][string]$ExpectedSourceCommit='',
  [int]$ObservationProcessId=0,[string]$ObservedImage='',[string]$SnapshotPath=''
)
Set-StrictMode -Version 2
$ErrorActionPreference='Stop'

# Every mutation and native observation is hosted-only. Never spoof this contract locally.
function Assert-ResearchHost {
  $required=@{CI='true';GITHUB_ACTIONS='true';RUNNER_ENVIRONMENT='github-hosted';RUNNER_OS='Windows';GITHUB_REPOSITORY='egoist-ai1/egoist-lagom'}
  $errors=@();foreach($name in $required.Keys){if([Environment]::GetEnvironmentVariable($name) -cne $required[$name]){$errors+=$name}}
  foreach($name in @('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT')){if([Environment]::GetEnvironmentVariable($name) -cnotmatch '^[1-9][0-9]*$'){$errors+=$name}}
  if($env:GITHUB_SHA -cnotmatch '^[a-f0-9]{40}$'){$errors+='GITHUB_SHA'}
  if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){$errors+='actual-Windows'}
  if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){$errors+='actual-administrator'}
  if($errors.Count){throw ('Hosted research guard refused before any write: '+($errors -join ', '))}
  if(-not [IO.Path]::IsPathRooted($env:RUNNER_TEMP) -or -not [IO.Path]::IsPathRooted($env:GITHUB_WORKSPACE)){throw 'Actual absolute runner roots required.'}
}
function Assert-Within([string]$Path,[string]$Root){
  $full=[IO.Path]::GetFullPath($Path);$base=[IO.Path]::GetFullPath($Root).TrimEnd('\')
  if(-not $full.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Path escaped the allowed research root.'}
  $cursor=$full;while($cursor -and $cursor.Length -ge $base.Length){if(Test-Path -LiteralPath $cursor){if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Research path has a reparse point.'}};$cursor=[IO.Path]::GetDirectoryName($cursor)}
  return $full
}
function Write-ResearchJson([string]$Path,$Value){[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 14),[Text.UTF8Encoding]::new($false))}
Assert-ResearchHost
if($Mode -eq 'GuardOnly'){Write-Output 'Hosted research guards passed; no write performed.';return}
if($ExpectedSourceCommit -cne $env:GITHUB_SHA){throw 'Research source identity must equal actual hosted GITHUB_SHA.'}
$work=Join-Path $env:RUNNER_TEMP ('lagom-competitor-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT)
[void](Assert-Within $work $env:RUNNER_TEMP)

if($Mode -eq 'Snapshot'){
  $ObservedImage=Assert-Within $ObservedImage $work;$SnapshotPath=Assert-Within $SnapshotPath $env:RUNNER_TEMP
  if([IO.Path]::GetFileName($ObservedImage) -cnotin @('v2rayN.exe','clash-verge.exe')){throw 'Observer accepts only exact competitor main image names.'}
  $target=[Diagnostics.Process]::GetProcessById($ObservationProcessId)
  if($target.MainModule.FileName -ine $ObservedImage){throw 'Observed PID/image mismatch.'}
  $birth=$target.StartTime.ToUniversalTime().ToString('o')
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Text;using System.Drawing;using System.Drawing.Imaging;
public static class LagomCompetitorWindow {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
 public delegate bool Callback(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback c,IntPtr p);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll",SetLastError=true)] static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
 [DllImport("user32.dll",EntryPoint="GetUserObjectInformationW",SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr h,int i,IntPtr b,int n,out int needed);
 public static bool VisibleStation(){IntPtr b=Marshal.AllocHGlobal(12);try{int needed;return GetUserObjectInformation(GetProcessWindowStation(),1,b,12,out needed)&&(Marshal.ReadInt32(b,8)&1)!=0;}finally{Marshal.FreeHGlobal(b);}}
 public static long[] Windows(int pid){var a=new List<long>();EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid&&IsWindowVisible(h))a.Add(h.ToInt64());return true;},IntPtr.Zero);return a.ToArray();}
 public static string Title(long hwnd){var b=new StringBuilder(2048);GetWindowText(new IntPtr(hwnd),b,b.Capacity);return b.ToString();}
 public static int[] Capture(long hwnd,string path){Rect r;if(!GetWindowRect(new IntPtr(hwnd),out r))return new[]{0,0,0,0,0};int w=r.right-r.left,h=r.bottom-r.top;if(w<1||h<1||w>8192||h>8192)return new[]{0,w,h,0,0};using(var bitmap=new Bitmap(w,h))using(var graphics=Graphics.FromImage(bitmap)){graphics.Clear(Color.Black);var dc=graphics.GetHdc();bool ok;try{ok=PrintWindow(new IntPtr(hwnd),dc,2);}finally{graphics.ReleaseHdc(dc);}int lo=255,hi=0;for(int y=0;y<h;y+=Math.Max(1,h/40))for(int x=0;x<w;x+=Math.Max(1,w/40)){var c=bitmap.GetPixel(x,y);int v=(c.R+c.G+c.B)/3;lo=Math.Min(lo,v);hi=Math.Max(hi,v);}bitmap.Save(path,ImageFormat.Png);return new[]{ok?1:0,w,h,lo,hi};}}
}
"@
  $result=[ordered]@{kind='actual-target-window-observation';processId=$target.Id;image=$ObservedImage;birthUtc=$birth;sessionId=$target.SessionId;visibleWindowStation=[LagomCompetitorWindow]::VisibleStation();windows=@();capturedAt=[DateTimeOffset]::UtcNow.ToString('o');desktopScreenshotTaken=$false}
  foreach($handle in [LagomCompetitorWindow]::Windows($target.Id)){
    $window=[ordered]@{hwnd=$handle;title=[LagomCompetitorWindow]::Title($handle);screenshot=$null;uiaStatus='not-attempted';elements=@();error=$null}
    $png=$SnapshotPath+'.'+$handle+'.png';$capture=[LagomCompetitorWindow]::Capture($handle,$png)
    $window.screenshot=[ordered]@{file=[IO.Path]::GetFileName($png);printWindowReturned=($capture[0] -eq 1);width=$capture[1];height=$capture[2];sampleMinLuma=$capture[3];sampleMaxLuma=$capture[4];uniformOrBlack=($capture[3] -eq $capture[4]);pixelContentConfirmed=$false}
    try{
      $root=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle)
      $nodes=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
      $window.uiaStatus='enumerated';$window.totalElements=$nodes.Count;$window.truncated=($nodes.Count -gt 1200)
      for($i=0;$i -lt [Math]::Min(1200,$nodes.Count);$i++){
        $node=$nodes[$i];$current=$node.Current;$patterns=@($node.GetSupportedPatterns()|ForEach-Object {$_.ProgrammaticName})
        $row=[ordered]@{name=$current.Name;automationId=$current.AutomationId;controlType=$current.ControlType.ProgrammaticName;className=$current.ClassName;enabled=$current.IsEnabled;offscreen=$current.IsOffscreen;patterns=$patterns;value=$null;toggleState=$null}
        $pattern=$null;if($node.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$value=([Windows.Automation.ValuePattern]$pattern).Current.Value;$row.value=$value.Substring(0,[Math]::Min(2048,$value.Length))}
        $pattern=$null;if($node.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)){$row.toggleState=[string]([Windows.Automation.TogglePattern]$pattern).Current.ToggleState}
        $window.elements+=$row
      }
    }catch{$window.uiaStatus='provider-error';$window.error=$_.Exception.GetType().FullName+': '+$_.Exception.Message}
    $result.windows+=$window
  }
  if($target.HasExited -or $target.StartTime.ToUniversalTime().ToString('o') -cne $birth){throw 'Target process generation changed during observation.'}
  Write-ResearchJson $SnapshotPath $result;return
}
if($PSVersionTable.PSVersion.Major -lt 7){throw 'Coordinator requires PowerShell7.'}
$evidence=if($EvidenceDirectory){Assert-Within $EvidenceDirectory $env:RUNNER_TEMP}else{Join-Path $env:RUNNER_TEMP 'lagom-competitor-evidence'}
if((Test-Path -LiteralPath $work) -or (Test-Path -LiteralPath $evidence)){throw 'Fresh research directories required.'}
[void][IO.Directory]::CreateDirectory($work);[void][IO.Directory]::CreateDirectory($evidence)
$script:Receipt=[ordered]@{schemaVersion=1;kind='official-competitor-hosted-observation';sourceCommit=$env:GITHUB_SHA;runId=$env:GITHUB_RUN_ID;runAttempt=$env:GITHUB_RUN_ATTEMPT;startedAt=[DateTimeOffset]::UtcNow.ToString('o');phase='first-launch-probe';result='running';functionalAcceptance=$false;realUserDataUsed=$false;products=@();host=[ordered]@{os=[Environment]::OSVersion.VersionString;runnerImage=$env:ImageOS;imageVersion=$env:ImageVersion;ps=$PSVersionTable.PSVersion.ToString();userInteractive=[Environment]::UserInteractive;sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId;locale=[Globalization.CultureInfo]::CurrentCulture.Name};limitations=@('A first-launch observation is not VPN/TUN correctness or desktop Windows10/11 acceptance.','No offline/GUI OFF/recovery claim follows from owned emergency cleanup.');cleanup=@()}
function Save-Receipt {Write-ResearchJson (Join-Path $evidence 'competitor-observation.json') $script:Receipt}
function Network-State {
  $proxyPath='HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings';$proxy=Get-ItemProperty -LiteralPath $proxyPath
  return [ordered]@{dns=@(Get-DnsClientServerAddress|Sort-Object InterfaceIndex,AddressFamily|ForEach-Object {[ordered]@{index=$_.InterfaceIndex;family=[string]$_.AddressFamily;servers=@($_.ServerAddresses)}});routes=@(Get-NetRoute|Where-Object {$_.DestinationPrefix -in @('0.0.0.0/0','::/0')}|Sort-Object InterfaceIndex,DestinationPrefix,NextHop|Select-Object InterfaceIndex,DestinationPrefix,NextHop,RouteMetric);proxy=@{enable=if($proxy.PSObject.Properties['ProxyEnable']){$proxy.ProxyEnable}else{$null};server=if($proxy.PSObject.Properties['ProxyServer']){$proxy.ProxyServer}else{$null};autoUrl=if($proxy.PSObject.Properties['AutoConfigURL']){$proxy.AutoConfigURL}else{$null}};ipv6=@(Get-NetAdapterBinding -ComponentID ms_tcpip6|Sort-Object Name|Select-Object Name,Enabled);winHttp=((& netsh.exe winhttp show proxy)|Out-String).Trim()}
}
function Owned-Processes([string]$Root){return @(Get-CimInstance Win32_Process -OperationTimeoutSec 5|Where-Object {$_.ExecutablePath -and ([string]$_.ExecutablePath).StartsWith($Root+'\',[StringComparison]::OrdinalIgnoreCase)})}
function Stop-OwnedProcesses([string]$Root){
  $stopped=@();foreach($row in (Owned-Processes $Root)){$p=$null;try{$p=[Diagnostics.Process]::GetProcessById([int]$row.ProcessId);[void]$p.Handle;if($p.HasExited){continue};$birth=$p.StartTime.ToUniversalTime();$expectedBirth=([DateTime]$row.CreationDate).ToUniversalTime();$birthDelta=[Math]::Abs([long]($birth.Ticks-$expectedBirth.Ticks));if($p.MainModule.FileName -ine $row.ExecutablePath -or $birthDelta -gt 10){throw 'Owned held-handle PID/image/CIM-birth lease mismatch.'};$p.Kill();if(-not $p.WaitForExit(15000)){throw 'Owned leased process did not terminate.'};$stopped+=[ordered]@{pid=$p.Id;birthUtc=$birth.ToString('o');cimBirthUtc=$expectedBirth.ToString('o');birthDeltaTicks=$birthDelta;heldHandle=$true;image=$row.ExecutablePath;kind='owned-emergency-cleanup-not-GUI-OFF'}}catch [ArgumentException]{}finally{if($p){$p.Dispose()}}};return $stopped
}
function Invoke-Bounded([string]$Executable,[string[]]$Arguments,[int]$TimeoutSeconds,[string]$Label){
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Executable;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.WorkingDirectory=[IO.Path]::GetDirectoryName($Executable);$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;foreach($arg in $Arguments){$info.ArgumentList.Add($arg)}
  $watch=[Diagnostics.Stopwatch]::StartNew();$p=[Diagnostics.Process]::Start($info);$birth=$p.StartTime.ToUniversalTime();$stdout=$p.StandardOutput.ReadToEndAsync();$stderr=$p.StandardError.ReadToEndAsync();$timedOut=-not $p.WaitForExit($TimeoutSeconds*1000)
  if($timedOut){if($p.MainModule.FileName -ine $Executable -or $p.StartTime.ToUniversalTime() -ne $birth){throw 'Bounded child lease changed.'};$p.Kill();[void]$p.WaitForExit(15000)}
  $out=if($stdout.Wait(2000)){$stdout.Result}else{'<drain-timeout>'};$err=if($stderr.Wait(2000)){$stderr.Result}else{'<drain-timeout>'};$code=if($p.HasExited){$p.ExitCode}else{$null}
  $record=[ordered]@{label=$Label;executable=$Executable;arguments=$Arguments;pid=$p.Id;birthUtc=$birth.ToString('o');exitCode=$code;timedOut=$timedOut;milliseconds=$watch.ElapsedMilliseconds;stdout=$out.Substring(0,[Math]::Min(65536,$out.Length));stderr=$err.Substring(0,[Math]::Min(65536,$err.Length))};$p.Dispose();Write-ResearchJson (Join-Path $evidence ($Label+'.json')) $record;return $record
}
function Observe-App([string]$Image,[string]$Label){
  $match=@(Get-CimInstance Win32_Process -Filter ('Name = '''+[IO.Path]::GetFileName($Image)+'''') -OperationTimeoutSec 5|Where-Object {$_.ExecutablePath -ieq $Image})
  if($match.Count -ne 1){return [ordered]@{status='no-unique-live-main-process';processCount=$match.Count;scenarioClassification='skipped-main-process-unavailable'}}
  $path=Join-Path $evidence ($Label+'.json');$windowsPowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $args=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$PSCommandPath,'-Mode','Snapshot','-Product',$Product,'-ExpectedSourceCommit',$env:GITHUB_SHA,'-ObservationProcessId',[string]$match[0].ProcessId,'-ObservedImage',$Image,'-SnapshotPath',$path)
  $result=Invoke-Bounded $windowsPowerShell $args 30 ($Label+'-observer')
  if($result.timedOut -or $result.exitCode -ne 0 -or -not (Test-Path -LiteralPath $path)){return [ordered]@{status='observer-timeout-or-error';scenarioClassification='skipped-ui-observer-unavailable';observer=$result}}
  $snapshot=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
  $interactive=@($snapshot.windows|Where-Object {$_.uiaStatus -eq 'enumerated' -and $_.elements.Count -gt 0})
  return [ordered]@{status=if($interactive.Count){'actual-uia-elements-observed'}elseif($snapshot.windows.Count){'window-without-uia-elements'}else{'no-visible-owned-window'};snapshot=[IO.Path]::GetFileName($path);visibleWindows=$snapshot.windows.Count;uiaWindows=$interactive.Count;processId=$snapshot.processId;birthUtc=$snapshot.birthUtc;sessionId=$snapshot.sessionId;visibleWindowStation=$snapshot.visibleWindowStation}
}
$products=@(
 @{name='v2rayN';version='7.25.4';asset='v2rayN-windows-64.zip';bytes=167955516;sha='e699ddc7f02d060dee2b0005d3879d82db1c36961b866d1ed0f9f93f16390a6b';url='https://github.com/2dust/v2rayN/releases/download/7.25.4/v2rayN-windows-64.zip';source='7d6a967c18c697f28dc6917122ed3a4993fcf336'},
 @{name='cvr';version='2.5.7';asset='Clash.Verge_2.5.7_x64_fixed_webview2-setup.exe';bytes=249987558;sha='81c5bdb671d4ea17ad65bc1f96a77825e370d0baf0019aa89ab9ba9189131238';url='https://github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.5.7/Clash.Verge_2.5.7_x64_fixed_webview2-setup.exe';source='ea509b82363a40c3c32e951d7ce9d66d66da411f'}
)
$baseline=Network-State;$script:Receipt.beforeNetwork=$baseline;Save-Receipt
$failure=$null
try{
  foreach($pin in $products){
    if($Product -ne 'both' -and $Product -ne $pin.name){continue}
    $directory=Join-Path $work $pin.name;[void][IO.Directory]::CreateDirectory($directory)
    $record=[ordered]@{name=$pin.name;version=$pin.version;sourceCommit=$pin.source;assetUrl=$pin.url;expectedSha256=$pin.sha;expectedBytes=$pin.bytes;result='running';actualSha256=$null;actualBytes=$null;install=$null;launch=$null;observations=@();cli=@();services=@();scenarios=@();cleanup=$null}
    $script:Receipt.products+=,$record;Save-Receipt
    $asset=Join-Path $directory $pin.asset;$curl=Join-Path $env:SystemRoot 'System32\curl.exe'
    $download=Invoke-Bounded $curl @('--fail','--silent','--show-error','--location','--proto','=https','--tlsv1.2','--connect-timeout','15','--max-time','180','--retry','2','--output',$asset,$pin.url) 240 ($pin.name+'-download')
    if($download.timedOut -or $download.exitCode -ne 0){throw 'Official competitor asset download failed.'}
    $record.actualBytes=(Get-Item -LiteralPath $asset).Length;$record.actualSha256=(Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash.ToLowerInvariant()
    if($record.actualBytes -ne $pin.bytes -or $record.actualSha256 -cne $pin.sha){throw 'Official competitor package hash/size mismatch.'}
    if(@(Get-CimInstance Win32_Process -OperationTimeoutSec 5|Where-Object {$_.Name -in @('v2rayN.exe','clash-verge.exe','clash-verge-service.exe','verge-mihomo.exe','verge-mihomo-alpha.exe')}).Count){throw 'Preexisting competitor process; fresh runner required.'}
    $installed=$false;$image='';$installRoot=Join-Path $directory 'install'
    try{
      if($pin.name -eq 'v2rayN'){
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip=[IO.Compression.ZipFile]::OpenRead($asset);try{foreach($entry in $zip.Entries){[void](Assert-Within (Join-Path $installRoot $entry.FullName) $installRoot)}}finally{$zip.Dispose()}
        [IO.Compression.ZipFile]::ExtractToDirectory($asset,$installRoot);$image=Join-Path $installRoot 'v2rayN-windows-64\v2rayN.exe';$record.install=@{kind='official-portable-zip-extraction';networkChangesRequested=$false}
      }else{
        if(Get-Service -Name clash_verge_service -ErrorAction SilentlyContinue){throw 'Preexisting CVR service; installer refused.'}
        $appData=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'io.github.clash-verge-rev.clash-verge-rev'
        if(Test-Path -LiteralPath $appData){throw 'Preexisting CVR app data; real data must never be used.'}
        # NSIS /D and _?= must be the final, unquoted argument. ArgumentList quotes whitespace paths.
        if($installRoot -match '[\s" ]'){throw 'Hosted NSIS research path must contain no whitespace or quotes.'}
        $record.install=Invoke-Bounded $asset @('/S',('/D='+$installRoot)) 600 'cvr-install'
        if($record.install.timedOut -or $record.install.exitCode -ne 0){throw 'Official CVR installer failed.'}
        $installed=$true;$image=Join-Path $installRoot 'clash-verge.exe'
      }
      if(-not (Test-Path -LiteralPath $image -PathType Leaf)){throw 'Official installed/extracted main image missing.'}
      $version=[Diagnostics.FileVersionInfo]::GetVersionInfo($image);$record.mainImage=@{fileVersion=$version.FileVersion;productVersion=$version.ProductVersion;sha256=(Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash.ToLowerInvariant()}
      $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$image;$start.WorkingDirectory=[IO.Path]::GetDirectoryName($image);$start.UseShellExecute=$false
      $watch=[Diagnostics.Stopwatch]::StartNew();$gui=[Diagnostics.Process]::Start($start);$record.launch=@{pid=$gui.Id;birthUtc=$gui.StartTime.ToUniversalTime().ToString('o');arguments=@();image=$image;cwd=$start.WorkingDirectory}
      Start-Sleep -Seconds 8
      $record.observations+=,(Observe-App $image ($pin.name+'-firstlaunch'));$record.firstObservationMilliseconds=$watch.ElapsedMilliseconds;Save-Receipt
      Start-Sleep -Seconds 5;$record.observations+=,(Observe-App $image ($pin.name+'-settled'))
      $record.services=@(Get-CimInstance Win32_Service -OperationTimeoutSec 5|Where-Object {$_.Name -eq 'clash_verge_service'}|Select-Object Name,State,StartMode,ProcessId,PathName)
      $cliFiles=if($pin.name -eq 'v2rayN'){@(@{path='v2rayN-windows-64\bin\xray\xray.exe';args=@('version')},@{path='v2rayN-windows-64\bin\sing_box\sing-box.exe';args=@('version')},@{path='v2rayN-windows-64\bin\mihomo\mihomo.exe';args=@('-v')})}else{@(@{path='verge-mihomo.exe';args=@('-v')})}
      foreach($cli in $cliFiles){$binary=Join-Path $installRoot $cli.path;if(Test-Path -LiteralPath $binary -PathType Leaf){$record.cli+=,(Invoke-Bounded $binary $cli.args 15 ($pin.name+'-cli-'+[IO.Path]::GetFileNameWithoutExtension($binary)))}else{$record.cli+=,@{path=$cli.path;status='skipped-official-sidecar-path-not-present'}}}
      foreach($scenario in @('synthetic-network','genuine-gui-off','runtime-crash-recovery','config-unavailable','service-unavailable')){$record.scenarios+=,@{name=$scenario;status='skipped';classification='first-launch-probe-awaits-actual-ui-and-source-backed-adapter';performed=$false}}
      $record.afterLaunchNetwork=Network-State;$record.result='first-launch-observed-no-functional-acceptance';Save-Receipt
    }finally{
      $cleanup=[ordered]@{stopped=@();uninstall=$null;serviceResidue=$null;networkRestored=$false}
      $service=Get-CimInstance Win32_Service -Filter "Name='clash_verge_service'" -OperationTimeoutSec 5
      if($service -and $pin.name -eq 'cvr'){
        $serviceImage=if($service.PathName -match '^\s*"([^"]+)"'){$Matches[1]}else{([string]$service.PathName -split ' ')[0]}
        [void](Assert-Within $serviceImage $installRoot);Stop-Service -Name clash_verge_service -Force -ErrorAction Stop
      }
      $cleanup.stopped=@(Stop-OwnedProcesses $installRoot)
      if($installed){$uninstaller=Join-Path $installRoot 'uninstall.exe';if(-not (Test-Path -LiteralPath $uninstaller)){throw 'Owned CVR uninstaller missing.'};$cleanup.uninstall=Invoke-Bounded $uninstaller @('/S',('_?='+$installRoot)) 240 'cvr-uninstall';if($cleanup.uninstall.timedOut -or $cleanup.uninstall.exitCode -ne 0){throw 'Owned CVR uninstall failed.'}}
      $cleanup.serviceResidue=[bool](Get-Service -Name clash_verge_service -ErrorAction SilentlyContinue)
      $after=Network-State;$cleanup.networkRestored=(($after|ConvertTo-Json -Depth 10 -Compress) -ceq ($baseline|ConvertTo-Json -Depth 10 -Compress));$record.cleanup=$cleanup;$script:Receipt.cleanup+=,@{product=$pin.name;network=$after;result=$cleanup};Save-Receipt
      if($cleanup.serviceResidue -or -not $cleanup.networkRestored -or @(Owned-Processes $installRoot).Count){throw 'Competitor cleanup/network readback failed; next product must not run.'}
    }
  }
  $script:Receipt.result='bounded-first-launch-observations-collected'
}catch{$failure=$_;$script:Receipt.result='failed';$script:Receipt.error=$_.Exception.GetType().FullName+': '+$_.Exception.Message}
finally{$script:Receipt.completedAt=[DateTimeOffset]::UtcNow.ToString('o');Save-Receipt}
if($failure){throw $failure}
Write-Output ('Observation receipts: '+$evidence+'; functionalAcceptance=false')