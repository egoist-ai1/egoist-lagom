[CmdletBinding()]
param(
  [ValidateSet('Probe','GuardOnly','Snapshot','Action','Fixture')][string]$Mode='Probe',
  [ValidateSet('both','v2rayN','cvr')][string]$Product='both',
  [string]$EvidenceDirectory='',
  [ValidatePattern('^$|^[a-f0-9]{40}$')][string]$ExpectedSourceCommit='',
  [int]$ObservationProcessId=0,[string]$ObservedImage='',[string]$SnapshotPath='',
  [string]$ObservationBirthUtc='',
  [ValidateSet('V2Import','V2Global','V2Reload','V2Close','CvrProfiles','CvrImport','CvrHome','CvrExit')][string]$ActionKind='CvrProfiles',
  [string]$ActionValue='',
  [string]$FixtureReadyPath='',[string]$FixtureEventsPath='',[string]$FixtureStopPath='',
  [ValidatePattern('^$|^[a-f0-9]{32}$')][string]$FixtureStopNonce=''
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

function Initialize-LoopbackType {
  Add-Type -TypeDefinition @'
using System;using System.IO;using System.Net;using System.Net.Sockets;using System.Text;using System.Diagnostics;using System.Threading;using System.Text.RegularExpressions;
public static class LagomCompetitorLoopback {
 static byte[] Read(NetworkStream stream,int length){var bytes=new byte[length];int offset=0;while(offset<length){int n=stream.Read(bytes,offset,length-offset);if(n==0)throw new EndOfStreamException();offset+=n;}return bytes;}
 static string Line(NetworkStream stream){var text=new StringBuilder();while(text.Length<256){int b=stream.ReadByte();if(b<0)throw new EndOfStreamException();if(b==10)return text.ToString();if(b>127)throw new InvalidDataException();text.Append((char)b);}throw new InvalidDataException("Bounded fixture line exceeded.");}
 static void Write(NetworkStream stream,byte[] bytes){stream.Write(bytes,0,bytes.Length);stream.Flush();}
 public static int FreePort(){var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;listener.Stop();return port;}
 public static void Run(string ready,string events,string stop,string stopNonce,int leaseSeconds){
  if(!Regex.IsMatch(stopNonce,"^[a-f0-9]{32}$"))throw new ArgumentException("Synthetic stop nonce format.");
  var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;
  string instance=Guid.NewGuid().ToString("N");string json="{\"processId\":"+Process.GetCurrentProcess().Id+",\"listenAddress\":\"127.0.0.1\",\"port\":"+port+",\"instance\":\""+instance+"\",\"externalDial\":false,\"leaseSeconds\":"+leaseSeconds+"}";
  json=json.Replace("\"externalDial\":false","\"profileUrl\":\"http://127.0.0.1:"+port+"/synthetic/"+instance+".yaml\",\"externalDial\":false");File.WriteAllText(ready+".part",json,new UTF8Encoding(false));File.Move(ready+".part",ready);var deadline=DateTime.UtcNow.AddSeconds(leaseSeconds);
  try{while(DateTime.UtcNow<deadline){if(File.Exists(stop)&&File.ReadAllText(stop).Trim()==stopNonce)break;if(!listener.Pending()){Thread.Sleep(50);continue;}using(var client=listener.AcceptTcpClient()){
    client.ReceiveTimeout=5000;client.SendTimeout=5000;var stream=client.GetStream();stream.ReadTimeout=5000;stream.WriteTimeout=5000;
    try{
    int first=stream.ReadByte();if(first==71){
      string request="G"+Line(stream).TrimEnd('\r');if(request!="GET /synthetic/"+instance+".yaml HTTP/1.1")throw new InvalidDataException("Only exact owned synthetic profile GET accepted");
      int total=0;while(true){string httpHeader=Line(stream).TrimEnd('\r');total+=httpHeader.Length;if(total>2048)throw new InvalidDataException("Bounded HTTP headers");if(httpHeader.Length==0)break;}
      string yaml="allow-lan: false\nbind-address: 127.0.0.1\nmode: rule\ngeo-auto-update: false\ndns:\n  enable: false\ntun:\n  enable: false\nproxies:\n  - name: shield-ci-synthetic\n    type: socks5\n    server: 127.0.0.1\n    port: "+port+"\n    udp: false\nproxy-groups: []\nrules:\n  - MATCH,shield-ci-synthetic\n";
      byte[] body=Encoding.UTF8.GetBytes(yaml);Write(stream,Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: application/yaml\r\nContent-Length: "+body.Length+"\r\nConnection: close\r\n\r\n"));Write(stream,body);
      File.AppendAllText(events,"{\"kind\":\"synthetic-profile-served\",\"instance\":\""+instance+"\"}\n",new UTF8Encoding(false));continue;
    }

if(first!=5)throw new InvalidDataException("SOCKS or exact HTTP GET only");var greeting=new byte[]{5,Read(stream,1)[0]};if(greeting[0]!=5||greeting[1]<1||greeting[1]>16)throw new InvalidDataException("SOCKS greeting");var methods=Read(stream,greeting[1]);if(Array.IndexOf(methods,(byte)0)<0)throw new InvalidDataException("SOCKS no-auth absent");Write(stream,new byte[]{5,0});
      var header=Read(stream,4);if(header[0]!=5||header[1]!=1||header[2]!=0||header[3]!=1)throw new InvalidDataException("Only synthetic IPv4 CONNECT accepted");var address=Read(stream,4);var targetPort=Read(stream,2);if(address[0]!=198||address[1]!=18||address[2]!=0||address[3]!=254||targetPort[0]!=74||targetPort[1]!=136)throw new InvalidDataException("Non-synthetic target rejected");
      Write(stream,new byte[]{5,0,0,1,127,0,0,1,0,0});var nonce=Line(stream);if(!Regex.IsMatch(nonce,"^[A-Za-z0-9-]{1,128}$"))throw new InvalidDataException("Synthetic nonce format");
      int peerPort=((IPEndPoint)client.Client.RemoteEndPoint).Port;File.AppendAllText(events,"{\"kind\":\"nonce-served\",\"nonce\":\""+nonce+"\",\"instance\":\""+instance+"\",\"peerPort\":"+peerPort+",\"target\":\"198.18.0.254:19080\"}\n",new UTF8Encoding(false));
      Write(stream,Encoding.ASCII.GetBytes("SYNTHETIC-OK:"+nonce+"\n"));try{stream.ReadByte();}catch(IOException){}
    }catch(Exception ex){File.AppendAllText(events,"{\"kind\":\"rejected-or-closed\",\"errorType\":\""+ex.GetType().Name+"\"}\n",new UTF8Encoding(false));}
  }}}finally{listener.Stop();}
 }
 public sealed class Lease:IDisposable {public TcpClient Client;public string Response;public double Milliseconds;public void Dispose(){if(Client!=null)Client.Close();}}
 public static Lease Probe(int port,string nonce){if(!Regex.IsMatch(nonce,"^[A-Za-z0-9-]{1,128}$"))throw new ArgumentException("Nonce format");var watch=Stopwatch.StartNew();var client=new TcpClient();try{var connect=client.ConnectAsync(IPAddress.Loopback,port);if(!connect.Wait(4000))throw new TimeoutException("Loopback connect");client.ReceiveTimeout=4000;client.SendTimeout=4000;var stream=client.GetStream();stream.ReadTimeout=4000;stream.WriteTimeout=4000;Write(stream,new byte[]{5,1,0});var auth=Read(stream,2);if(auth[0]!=5||auth[1]!=0)throw new InvalidDataException("SOCKS auth response");Write(stream,new byte[]{5,1,0,1,198,18,0,254,74,136});var reply=Read(stream,4);if(reply[0]!=5||reply[1]!=0)throw new InvalidDataException("SOCKS CONNECT rejected");if(reply[3]==1)Read(stream,6);else if(reply[3]==4)Read(stream,18);else if(reply[3]==3){int n=Read(stream,1)[0];Read(stream,n+2);}else throw new InvalidDataException("SOCKS reply address type");Write(stream,Encoding.ASCII.GetBytes(nonce+"\n"));string response=Line(stream);if(response!="SYNTHETIC-OK:"+nonce)throw new InvalidDataException("Actual nonce mismatch");return new Lease{Client=client,Response=response,Milliseconds=watch.Elapsed.TotalMilliseconds};}catch{client.Close();throw;}}
}
'@
}
if($Mode -eq 'Fixture'){
  $FixtureReadyPath=Assert-Within $FixtureReadyPath $work;$FixtureEventsPath=Assert-Within $FixtureEventsPath $work;$FixtureStopPath=Assert-Within $FixtureStopPath $work
  if($FixtureStopNonce -cnotmatch '^[a-f0-9]{32}$'){throw 'Actual synthetic fixture stop nonce required.'}
  Initialize-LoopbackType
  [LagomCompetitorLoopback]::Run($FixtureReadyPath,$FixtureEventsPath,$FixtureStopPath,$FixtureStopNonce,600)
  return
}

if($Mode -in @('Snapshot','Action')){
  $ObservedImage=Assert-Within $ObservedImage $work;$SnapshotPath=Assert-Within $SnapshotPath $env:RUNNER_TEMP
  if([IO.Path]::GetFileName($ObservedImage) -cnotin @('v2rayN.exe','clash-verge.exe')){throw 'Observer accepts only exact competitor main image names.'}
  $target=[Diagnostics.Process]::GetProcessById($ObservationProcessId);[void]$target.Handle;$targetSession=$target.SessionId
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

  function Find-UiOne([string]$Type,[string]$Name='',[string]$Id=''){
    $found=@();$seen=@{}
    foreach($h in [LagomCompetitorWindow]::Windows($target.Id)){
      $ui=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]$h)
      foreach($n in $ui.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)){
        $c=$n.Current
        if($c.IsEnabled -and -not $c.IsOffscreen -and $c.ControlType.ProgrammaticName -ceq ('ControlType.'+$Type) -and (-not $Name -or $c.Name -ieq $Name) -and (-not $Id -or $c.AutomationId -ceq $Id)){$key=@($n.GetRuntimeId()) -join ':';if(-not $seen.ContainsKey($key)){$seen[$key]=$true;$found+=,$n}}
      }
    }
    if($found.Count -ne 1){throw ('UI control unavailable or ambiguous: '+$Type+'/'+$Name+'/'+$Id+' count='+$found.Count)}
    return $found[0]
  }
  function Use-UiPattern($Node,[string]$Kind,[string]$Value=''){
    $c=$Node.Current;$pattern=$null
    $id=switch($Kind){Invoke{[Windows.Automation.InvokePattern]::Pattern};Expand{[Windows.Automation.ExpandCollapsePattern]::Pattern};Select{[Windows.Automation.SelectionItemPattern]::Pattern};Value{[Windows.Automation.ValuePattern]::Pattern}}
    if(-not $Node.TryGetCurrentPattern($id,[ref]$pattern)){throw ('Actual UI pattern unavailable: '+$Kind)}
    $step=[ordered]@{kind=$Kind;name=$c.Name;id=$c.AutomationId;type=$c.ControlType.ProgrammaticName;requestedAt=[DateTimeOffset]::UtcNow.ToString('o')}
    switch($Kind){Invoke{([Windows.Automation.InvokePattern]$pattern).Invoke()};Expand{([Windows.Automation.ExpandCollapsePattern]$pattern).Expand()};Select{([Windows.Automation.SelectionItemPattern]$pattern).Select()};Value{([Windows.Automation.ValuePattern]$pattern).SetValue($Value)}}
    $step.completedAt=[DateTimeOffset]::UtcNow.ToString('o');$script:ActionRecord.steps+=,$step
  }
  $script:ActionRecord=$null
  if($Mode -eq 'Action'){
    $script:ActionRecord=[ordered]@{requested=$ActionKind;status='running';steps=@();error=$null;functionalResultProved=$false}
    try{
      if($target.HasExited -or $target.StartTime.ToUniversalTime().ToString('o') -cne $ObservationBirthUtc){throw 'UI action expected generation mismatch.'}
      if(($ActionKind.StartsWith('V2') -and [IO.Path]::GetFileName($ObservedImage) -cne 'v2rayN.exe') -or ($ActionKind.StartsWith('Cvr') -and [IO.Path]::GetFileName($ObservedImage) -cne 'clash-verge.exe')){throw 'Action kind and leased official main image mismatch.'}
      switch($ActionKind){
        V2Import{
          if([IO.Path]::GetFileName($ObservedImage) -cne 'v2rayN.exe' -or $ActionValue -cnotmatch '^socks://127\.0\.0\.1:[1-9][0-9]{0,4}#shield-ci-synthetic$' -or ([Uri]$ActionValue).Port -gt 65535){throw 'Only the owned synthetic SOCKS URI is accepted.'}
          Use-UiPattern (Find-UiOne MenuItem Configuration) Expand
          Start-Sleep -Milliseconds 400
          $item=Find-UiOne MenuItem '' menuAddServerViaClipboard
          Add-Type -AssemblyName PresentationCore
          [System.Windows.Clipboard]::SetText($ActionValue)
          try{Use-UiPattern $item Invoke;Start-Sleep -Seconds 2}finally{[System.Windows.Clipboard]::Clear()}
        }
        V2Global{
          Use-UiPattern (Find-UiOne ComboBox '' cmbRoutings2) Expand
          Start-Sleep -Milliseconds 400
          $label='V4-'+[char]0x5168+[char]0x5c40+'(Global)'
          Use-UiPattern (Find-UiOne ListItem $label) Select
        }
        V2Reload{Use-UiPattern (Find-UiOne MenuItem '' menuReload) Invoke}
        V2Close{Use-UiPattern (Find-UiOne MenuItem '' menuClose) Invoke}
        CvrProfiles{Use-UiPattern (Find-UiOne Button Profiles) Invoke}
        CvrHome{Use-UiPattern (Find-UiOne Button Home) Invoke}
        CvrImport{
          if([IO.Path]::GetFileName($ObservedImage) -cne 'clash-verge.exe' -or $ActionValue -cnotmatch '^http://127\.0\.0\.1:[1-9][0-9]{0,4}/synthetic/[a-f0-9]{32}\.yaml$' -or ([Uri]$ActionValue).Port -gt 65535){throw 'Only the owned loopback profile URL is accepted.'}
          Use-UiPattern (Find-UiOne Edit) Value $ActionValue
          Start-Sleep -Milliseconds 700
          Use-UiPattern (Find-UiOne Button Import) Invoke
        }
        CvrExit{
          Use-UiPattern (Find-UiOne Button Settings) Invoke
          Start-Sleep -Milliseconds 700
          Use-UiPattern (Find-UiOne Button Exit) Invoke
        }
      }
      Start-Sleep -Milliseconds 700;$script:ActionRecord.status='request-performed'
    }catch{$script:ActionRecord.status='skipped-or-action-failed';$script:ActionRecord.error=$_.Exception.GetType().Name+': '+$_.Exception.Message}
  }

  $result=[ordered]@{kind='actual-target-window-observation';processId=$target.Id;image=$ObservedImage;birthUtc=$birth;sessionId=$targetSession;visibleWindowStation=[LagomCompetitorWindow]::VisibleStation();windows=@();capturedAt=[DateTimeOffset]::UtcNow.ToString('o');desktopScreenshotTaken=$false;action=$script:ActionRecord;targetExitedAfterAction=$target.HasExited}
  $handles=if($target.HasExited){@()}else{[LagomCompetitorWindow]::Windows($target.Id)}
  foreach($handle in $handles){
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
  if(-not $target.HasExited -and $target.StartTime.ToUniversalTime().ToString('o') -cne $birth){throw 'Target process generation changed during observation.'}
  Write-ResearchJson $SnapshotPath $result;return
}
if($PSVersionTable.PSVersion.Major -lt 7){throw 'Coordinator requires PowerShell7.'}
$evidence=if($EvidenceDirectory){Assert-Within $EvidenceDirectory $env:RUNNER_TEMP}else{Join-Path $env:RUNNER_TEMP 'lagom-competitor-evidence'}
if((Test-Path -LiteralPath $work) -or (Test-Path -LiteralPath $evidence)){throw 'Fresh research directories required.'}
[void][IO.Directory]::CreateDirectory($work);[void][IO.Directory]::CreateDirectory($evidence)
$script:Receipt=[ordered]@{schemaVersion=1;kind='official-competitor-hosted-observation';sourceCommit=$env:GITHUB_SHA;runId=$env:GITHUB_RUN_ID;runAttempt=$env:GITHUB_RUN_ATTEMPT;startedAt=[DateTimeOffset]::UtcNow.ToString('o');phase='bounded-uia-and-loopback-comparison';result='running';functionalAcceptance=$false;realUserDataUsed=$false;products=@();host=[ordered]@{os=[Environment]::OSVersion.VersionString;runnerImage=$env:ImageOS;imageVersion=$env:ImageVersion;ps=$PSVersionTable.PSVersion.ToString();userInteractive=[Environment]::UserInteractive;sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId;locale=[Globalization.CultureInfo]::CurrentCulture.Name};limitations=@('A first-launch observation is not VPN/TUN correctness or desktop Windows10/11 acceptance.','No offline/GUI OFF/recovery claim follows from owned emergency cleanup.');cleanup=@()}
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
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Executable;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.WorkingDirectory=[IO.Path]::GetDirectoryName($Executable);$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;[void](Clear-ChildSecrets $info);foreach($arg in $Arguments){$info.ArgumentList.Add($arg)}
  $watch=[Diagnostics.Stopwatch]::StartNew();$p=[Diagnostics.Process]::Start($info);$birth=$p.StartTime.ToUniversalTime();$stdout=$p.StandardOutput.ReadToEndAsync();$stderr=$p.StandardError.ReadToEndAsync();$timedOut=-not $p.WaitForExit($TimeoutSeconds*1000)
  if($timedOut){if($p.MainModule.FileName -ine $Executable -or $p.StartTime.ToUniversalTime() -ne $birth){throw 'Bounded child lease changed.'};$p.Kill();[void]$p.WaitForExit(15000)}
  $out=if($stdout.Wait(2000)){$stdout.Result}else{'<drain-timeout>'};$err=if($stderr.Wait(2000)){$stderr.Result}else{'<drain-timeout>'};$code=if($p.HasExited){$p.ExitCode}else{$null}
  $record=[ordered]@{label=$Label;executable=$Executable;arguments=$Arguments;pid=$p.Id;birthUtc=$birth.ToString('o');exitCode=$code;timedOut=$timedOut;milliseconds=$watch.ElapsedMilliseconds;stdout=$out.Substring(0,[Math]::Min(65536,$out.Length));stderr=$err.Substring(0,[Math]::Min(65536,$err.Length))};$p.Dispose();Write-ResearchJson (Join-Path $evidence ($Label+'.json')) $record;return $record
}
function Observe-App([string]$Image,[string]$Label){
  $match=@(Get-CimInstance Win32_Process -Filter ('Name = '''+[IO.Path]::GetFileName($Image)+'''') -OperationTimeoutSec 5|Where-Object {$_.ExecutablePath -ieq $Image})
  if($match.Count -ne 1){return [ordered]@{status='no-unique-live-main-process';processCount=$match.Count;scenarioClassification='skipped-main-process-unavailable'}}
  $path=Join-Path $evidence ($Label+'.json');$windowsPowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $observerArguments=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$PSCommandPath,'-Mode','Snapshot','-Product',$Product,'-ExpectedSourceCommit',$env:GITHUB_SHA,'-ObservationProcessId',[string]$match[0].ProcessId,'-ObservedImage',$Image,'-SnapshotPath',$path)
  $result=Invoke-Bounded $windowsPowerShell $observerArguments 30 ($Label+'-observer')
  if($result.timedOut -or $result.exitCode -ne 0 -or -not (Test-Path -LiteralPath $path)){return [ordered]@{status='observer-timeout-or-error';scenarioClassification='skipped-ui-observer-unavailable';observer=$result}}
  $snapshot=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
  $interactive=@($snapshot.windows|Where-Object {$_.uiaStatus -eq 'enumerated' -and $_.elements.Count -gt 0})
  return [ordered]@{status=if($interactive.Count){'actual-uia-elements-observed'}elseif($snapshot.windows.Count){'window-without-uia-elements'}else{'no-visible-owned-window'};snapshot=[IO.Path]::GetFileName($path);visibleWindows=$snapshot.windows.Count;uiaWindows=$interactive.Count;processId=$snapshot.processId;birthUtc=$snapshot.birthUtc;sessionId=$snapshot.sessionId;visibleWindowStation=$snapshot.visibleWindowStation}
}

function Clear-ChildSecrets($Info){
  $count=0;foreach($key in @($Info.Environment.Keys)){if($key -match '(?i)(TOKEN|PASSWORD|SECRET|CREDENTIAL|^ACTIONS_|^VSS_|^CLASH_)'){[void]$Info.Environment.Remove($key);$count++}};return $count
}
function Invoke-UiAction([string]$Image,[string]$Kind,[string]$Value,[string]$Label){
  $match=@(Get-CimInstance Win32_Process -Filter ('Name = '''+[IO.Path]::GetFileName($Image)+'''') -OperationTimeoutSec 5|Where-Object {$_.ExecutablePath -ieq $Image})
  if($match.Count -ne 1){return @{status='skipped';classification='no-unique-live-main-process'}}
  $p=[Diagnostics.Process]::GetProcessById([int]$match[0].ProcessId)
  try{[void]$p.Handle;$birth=$p.StartTime.ToUniversalTime().ToString('o');if($p.MainModule.FileName -ine $Image){throw 'UI coordinator held image mismatch.'}}finally{$p.Dispose()}
  $path=Join-Path $evidence ($Label+'.json');$ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments=@('-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',$PSCommandPath,'-Mode','Action','-ExpectedSourceCommit',$env:GITHUB_SHA,'-ObservationProcessId',[string]$match[0].ProcessId,'-ObservedImage',$Image,'-ObservationBirthUtc',$birth,'-SnapshotPath',$path,'-ActionKind',$Kind)
  if($Value){$arguments+=@('-ActionValue',$Value)}
  $invoke=Invoke-Bounded $ps $arguments 30 ($Label+'-actor')
  if($invoke.timedOut -or $invoke.exitCode -ne 0 -or -not(Test-Path -LiteralPath $path)){return @{status='skipped';classification='bounded-ui-actor-timeout-or-provider-error';invoke=$invoke}}
  $snapshot=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
  return [ordered]@{status=$snapshot.action.status;snapshot=[IO.Path]::GetFileName($path);action=$snapshot.action;targetExitedAfterAction=$snapshot.targetExitedAfterAction}
}
function Wait-AppCore([string]$Root,[int]$Port,[int]$Seconds=25){
  $deadline=[DateTimeOffset]::UtcNow.AddSeconds($Seconds)
  do{
    foreach($connection in @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalAddress -ceq '127.0.0.1'})){
      $row=Get-CimInstance Win32_Process -Filter ('ProcessId='+$connection.OwningProcess) -OperationTimeoutSec 5
      if(-not $row -or -not $row.ExecutablePath){continue}
      if(-not ([string]$row.ExecutablePath).StartsWith($Root+'\',[StringComparison]::OrdinalIgnoreCase)){continue}
      $p=[Diagnostics.Process]::GetProcessById([int]$row.ProcessId);[void]$p.Handle
      $birth=$p.StartTime.ToUniversalTime();$delta=[Math]::Abs([long]($birth.Ticks-([DateTime]$row.CreationDate).ToUniversalTime().Ticks))
      if($p.MainModule.FileName -ine $row.ExecutablePath -or $delta -gt 10){$p.Dispose();throw 'App core PID/image/birth lease mismatch.'}
      return [ordered]@{process=$p;image=[string]$row.ExecutablePath;birthUtc=$birth.ToString('o');port=$Port}
    }
    Start-Sleep -Milliseconds 350
  }while([DateTimeOffset]::UtcNow -lt $deadline)
  throw 'No actual loopback listener owned by the official app runtime.'
}
function Invoke-AppNonce($Core,$Fixture,[string]$Events){
  $nonce=[Guid]::NewGuid().ToString('N');$probe=$null
  try{
    if($Core.process.HasExited -or $Core.process.MainModule.FileName -ine $Core.image -or $Core.process.StartTime.ToUniversalTime().ToString('o') -cne $Core.birthUtc){throw 'Actual app core generation changed.'}
    $probe=[LagomCompetitorLoopback]::Probe($Core.port,$nonce)
    $nonceEvents=@(Get-Content -LiteralPath $Events|ForEach-Object {$_|ConvertFrom-Json}|Where-Object {$_.kind -ceq 'nonce-served' -and $_.nonce -ceq $nonce})
    if($nonceEvents.Count -ne 1 -or $nonceEvents[0].instance -cne $Fixture.instance){throw 'Actual unique fixture nonce proof missing.'}
    $flow=@(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $nonceEvents[0].peerPort -RemoteAddress '127.0.0.1' -RemotePort $Fixture.port -State Established -ErrorAction Stop)
    if($flow.Count -ne 1 -or [int]$flow[0].OwningProcess -ne $Core.process.Id){throw 'Actual app core to fixture socket owner mismatch.'}
    return [ordered]@{nonce=$nonce;responseMatched=$true;milliseconds=$probe.Milliseconds;corePid=$Core.process.Id;coreBirthUtc=$Core.birthUtc;coreImage=$Core.image;fixtureInstance=$Fixture.instance;outboundSocket=$flow[0]|Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess}
  }finally{if($probe){$probe.Dispose()}}
}
function Invoke-GuiScenarios([string]$Image,[string]$Root,[string]$Name){
  $result=[ordered]@{scope='genuine-uia-import-and-loopback-inbound-no-system-proxy-no-tun';status='running';fixture=$null;actions=@();requests=@();automaticRecovery=$null;genuineExit=$null;configUnavailable=@{status='skipped';reason='GUI config-unavailable adapter is not established; see separate official CLI scope'};serviceUnavailable=@{status=if(Get-Service -Name clash_verge_service -ErrorAction SilentlyContinue){'skipped'}else{'not-applicable'};reason='Actual SCM presence read before scenario; no service-failure adapter established and no service installed by this scenario'};cleanup=$null}
  $directory=Join-Path $Root 'synthetic-gui';[void][IO.Directory]::CreateDirectory($directory)
  $readyPath=Join-Path $directory 'ready.json';$events=Join-Path $directory 'events.ndjson';$stop=Join-Path $directory 'stop.txt';$stopNonce=[Guid]::NewGuid().ToString('N');$fixtureLease=$null;$core=$null
  $port=if($Name -ceq 'v2rayN'){10808}else{7897}
  try{
    $ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $fixtureLease=Start-ResearchChild $ps @('-NoLogo','-NoProfile','-NonInteractive','-File',$PSCommandPath,'-Mode','Fixture','-ExpectedSourceCommit',$env:GITHUB_SHA,'-FixtureReadyPath',$readyPath,'-FixtureEventsPath',$events,'-FixtureStopPath',$stop,'-FixtureStopNonce',$stopNonce) ($Name+'-gui-fixture')
    $deadline=[DateTimeOffset]::UtcNow.AddSeconds(15);while(-not(Test-Path -LiteralPath $readyPath)){if($fixtureLease.process.HasExited -or [DateTimeOffset]::UtcNow -gt $deadline){throw 'Actual GUI fixture readiness failed.'};Start-Sleep -Milliseconds 100}
    $fixture=Get-Content -LiteralPath $readyPath -Raw|ConvertFrom-Json;$result.fixture=$fixture
    $listener=@(Get-NetTCPConnection -LocalPort $fixture.port -State Listen -ErrorAction Stop)
    if($fixture.processId -ne $fixtureLease.process.Id -or $fixture.listenAddress -cne '127.0.0.1' -or $fixture.externalDial -or $listener.Count -ne 1 -or [int]$listener[0].OwningProcess -ne $fixtureLease.process.Id){throw 'GUI fixture actual socket/identity mismatch.'}
    if($Name -ceq 'v2rayN'){
      $result.actions+=,(Invoke-UiAction $Image V2Import ('socks://127.0.0.1:'+$fixture.port+'#shield-ci-synthetic') ($Name+'-gui-import'))
      $result.actions+=,(Invoke-UiAction $Image V2Global '' ($Name+'-gui-global-routing'))
      $result.actions+=,(Invoke-UiAction $Image V2Reload '' ($Name+'-gui-reload'))
    }else{
      $result.actions+=,(Invoke-UiAction $Image CvrProfiles '' ($Name+'-gui-profiles'))
      $result.actions+=,(Invoke-UiAction $Image CvrImport $fixture.profileUrl ($Name+'-gui-import'))
      $result.actions+=,(Invoke-UiAction $Image CvrHome '' ($Name+'-gui-home'))
    }
    if(@($result.actions|Where-Object {$_.status -cne 'request-performed'}).Count){$result.status='skipped';$result.classification='actual-ui-control-unavailable-or-action-failed';return $result}
    $core=Wait-AppCore $Root $port
    for($i=0;$i -lt 20;$i++){$result.requests+=,(Invoke-AppNonce $core $fixture $events)}
    $times=@($result.requests|ForEach-Object {[double]$_.milliseconds}|Sort-Object);$result.timing=@{count=20;medianMs=($times[9]+$times[10])/2;p95Ms=$times[18];scope='synthetic protocol roundtrips only; no overall product speed claim'}
    $crashed=[ordered]@{pid=$core.process.Id;birthUtc=$core.birthUtc;image=$core.image};Stop-ResearchChild $core;$core=$null
    $watch=[Diagnostics.Stopwatch]::StartNew();$recovered=$null;$recoveryError=$null
    try{$core=Wait-AppCore $Root $port 20;$recovered=Invoke-AppNonce $core $fixture $events}catch{$recoveryError=$_.Exception.GetType().Name+": "+$_.Exception.Message}
    $result.automaticRecovery=@{status=if($recovered){'observed'}else{'not-observed-within-20s'};trigger='leased actual app core crash';harnessRestartRequested=$false;crashedGeneration=$crashed;milliseconds=$watch.ElapsedMilliseconds;proof=$recovered;error=$recoveryError}
    if(-not $core -and $Name -ceq 'v2rayN'){
      $result.actions+=,(Invoke-UiAction $Image V2Reload '' ($Name+'-gui-manual-reload-after-crash'))
      try{$core=Wait-AppCore $Root $port 10;$result.manualRecovery=Invoke-AppNonce $core $fixture $events}catch{$result.manualRecovery=@{status='not-observed';reason=$_.Exception.Message}}
    }
    if($core){$core.process.Dispose();$core=$null}
    $exitKind=if($Name -ceq 'v2rayN'){'V2Close'}else{'CvrExit'}
    $exit=Invoke-UiAction $Image $exitKind '' ($Name+'-gui-exit')
    Start-Sleep -Seconds 2
    $remaining=@(Get-CimInstance Win32_Process -OperationTimeoutSec 5|Where-Object {$_.ExecutablePath -ieq $Image}).Count
    $listenerRemaining=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count
    $result.genuineExit=@{action=$exit;mainProcessAbsent=($remaining -eq 0);inboundListenerAbsent=($listenerRemaining -eq 0);status=if($exit.status -ceq 'request-performed' -and $remaining -eq 0 -and $listenerRemaining -eq 0){'observed'}else{'skipped-or-exit-not-completed'};systemProxyOffTested=$false;systemProxyNeverEnabledByHarness=$true}
    $result.status='bounded-gui-functional-observations-collected'
  }catch{$result.status='failed';$result.error=$_.Exception.GetType().Name+': '+$_.Exception.Message}
  finally{
    if($core){$core.process.Dispose()}
    if(Test-Path -LiteralPath $events){Write-ResearchJson (Join-Path $evidence ($Name+'-gui-fixture-events.json')) @(Get-Content -LiteralPath $events|ForEach-Object {$_|ConvertFrom-Json})}
    if($fixtureLease){[IO.File]::WriteAllText($stop,$stopNonce,[Text.UTF8Encoding]::new($false));if(-not $fixtureLease.process.WaitForExit(10000)){Stop-ResearchChild $fixtureLease}else{$fixtureLease.process.Dispose()}}
    $result.cleanup=@{fixtureStopped=if($fixtureLease){$true}else{$null};fixtureStarted=($null -ne $fixtureLease);noTunSystemProxyOrDnsRequested=$true}
  }
  return $result
}

function Start-ResearchChild([string]$Executable,[string[]]$Arguments,[string]$Label){
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Executable;$info.WorkingDirectory=[IO.Path]::GetDirectoryName($Executable);$info.UseShellExecute=$false;$info.CreateNoWindow=$true;foreach($arg in $Arguments){$info.ArgumentList.Add($arg)}
  $removed=0;foreach($key in @($info.Environment.Keys)){if($key -match '(?i)(TOKEN|PASSWORD|SECRET|CREDENTIAL|^ACTIONS_|^VSS_|^CLASH_)'){[void]$info.Environment.Remove($key);$removed++}}
  $p=[Diagnostics.Process]::Start($info);[void]$p.Handle;$lease=[ordered]@{process=$p;image=$Executable;birthUtc=$p.StartTime.ToUniversalTime().ToString('o');label=$Label;sensitiveEnvironmentKeysRemoved=$removed};return $lease
}
function Stop-ResearchChild($Lease){$p=$Lease.process;try{if(-not $p.HasExited){if($p.MainModule.FileName -ine $Lease.image -or $p.StartTime.ToUniversalTime().ToString('o') -cne $Lease.birthUtc){throw 'Owned child generation lease changed.'};$p.Kill();if(-not $p.WaitForExit(10000)){throw 'Owned child did not terminate.'}}}finally{$p.Dispose()}}
function Wait-CoreListener($Lease,[int]$Port){
  $deadline=[DateTimeOffset]::UtcNow.AddSeconds(30)
  while([DateTimeOffset]::UtcNow -lt $deadline){if($Lease.process.HasExited){throw 'Actual bundled Mihomo exited before listener readiness.'};$listener=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue);if($listener.Count -eq 1 -and $listener[0].LocalAddress -ceq '127.0.0.1' -and [int]$listener[0].OwningProcess -eq $Lease.process.Id){return [ordered]@{processId=$Lease.process.Id;birthUtc=$Lease.birthUtc;listenAddress='127.0.0.1';port=$Port;readinessAt=[DateTimeOffset]::UtcNow.ToString('o')}};Start-Sleep -Milliseconds 300};throw 'Actual core readiness deadline exceeded.'
}
function Invoke-EngineScenarios([string]$Binary,[string]$ProductRoot,[string]$Name){
  $scope='official-bundled-mihomo-cli-only';$result=[ordered]@{scope=$scope;genuineGuiImportPerformed=$false;genuineGuiOffPerformed=$false;automaticAppRecoveryProved=$false;status='running';fixture=$null;configValidation=$null;firstStart=$null;requests=@();cliStop=$null;recovery=$null;configUnavailable=$null;cleanup=$null}
  $directory=Join-Path $ProductRoot 'synthetic-engine';[void][IO.Directory]::CreateDirectory($directory);$config=Join-Path $directory 'synthetic.yaml';$engineHome=Join-Path $directory 'home';[void][IO.Directory]::CreateDirectory($engineHome)
  $fixtureReady=Join-Path $directory 'fixture-ready.json';$events=Join-Path $directory 'fixture-events.ndjson';$fixtureStop=Join-Path $directory 'fixture-stop.txt';$stopNonce=[Guid]::NewGuid().ToString('N');$fixtureLease=$null;$engineLease=$null;$corePort=[LagomCompetitorLoopback]::FreePort()
  try{
    $windowsPowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $fixtureLease=Start-ResearchChild $windowsPowerShell @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$PSCommandPath,'-Mode','Fixture','-ExpectedSourceCommit',$env:GITHUB_SHA,'-FixtureReadyPath',$fixtureReady,'-FixtureEventsPath',$events,'-FixtureStopPath',$fixtureStop,'-FixtureStopNonce',$stopNonce) ($Name+'-fixture')
    $deadline=[DateTimeOffset]::UtcNow.AddSeconds(15);while(-not(Test-Path -LiteralPath $fixtureReady)){if($fixtureLease.process.HasExited -or [DateTimeOffset]::UtcNow -gt $deadline){throw 'Loopback fixture did not become ready.'};Start-Sleep -Milliseconds 100};$fixture=Get-Content -LiteralPath $fixtureReady -Raw|ConvertFrom-Json
    $listener=@(Get-NetTCPConnection -LocalPort $fixture.port -State Listen -ErrorAction Stop);if($fixture.processId -ne $fixtureLease.process.Id -or $fixture.listenAddress -cne '127.0.0.1' -or $fixture.externalDial -or $listener.Count -ne 1 -or [int]$listener[0].OwningProcess -ne $fixtureLease.process.Id){throw 'Fixture identity/socket proof mismatch.'};$result.fixture=$fixture
    $yaml="mixed-port: $corePort`nallow-lan: false`nbind-address: 127.0.0.1`nmode: rule`nlog-level: warning`ngeo-auto-update: false`ndns:`n  enable: false`ntun:`n  enable: false`nproxies:`n  - name: synthetic-only`n    type: socks5`n    server: 127.0.0.1`n    port: $($fixture.port)`n    udp: false`nproxy-groups: []`nrules:`n  - MATCH,synthetic-only`n"
    [IO.File]::WriteAllText($config,$yaml,[Text.UTF8Encoding]::new($false));$originalHash=(Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
    $result.configValidation=Invoke-Bounded $Binary @('-t','-d',$engineHome,'-f',$config) 30 ($Name+'-engine-config-validation')
    if($result.configValidation.timedOut -or $result.configValidation.exitCode -ne 0){$result.status='skipped';$result.classification='actual-engine-config-or-dependency-unavailable';return $result}
    $engineArgs=@('-d',$engineHome,'-f',$config);$engineLease=Start-ResearchChild $Binary $engineArgs ($Name+'-engine-first');$result.firstStart=Wait-CoreListener $engineLease $corePort
    for($i=0;$i -lt 20;$i++){$nonce=[Guid]::NewGuid().ToString('N');$probe=$null;try{$probe=[LagomCompetitorLoopback]::Probe($corePort,$nonce);$nonceEvents=@(Get-Content -LiteralPath $events|ForEach-Object {$_|ConvertFrom-Json}|Where-Object {$_.kind -eq 'nonce-served' -and $_.nonce -ceq $nonce});if($nonceEvents.Count -ne 1 -or $nonceEvents[0].instance -cne $fixture.instance){throw 'Unique actual fixture nonce proof missing.'};$sample=[ordered]@{nonce=$nonce;milliseconds=$probe.Milliseconds;responseMatched=$true;fixtureInstance=$fixture.instance;outboundSocket=$null};if($i -eq 0){$flow=@(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $nonceEvents[0].peerPort -RemoteAddress '127.0.0.1' -RemotePort $fixture.port -State Established -ErrorAction Stop);if($flow.Count -ne 1 -or [int]$flow[0].OwningProcess -ne $engineLease.process.Id){throw 'Live core-to-fixture socket owner mismatch.'};$sample.outboundSocket=$flow[0]|Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess};$result.requests+=,$sample}finally{if($probe){$probe.Dispose()}}}
    $times=@($result.requests|ForEach-Object {[double]$_.milliseconds}|Sort-Object);$result.sampleSummary=@{count=$times.Count;medianMs=($times[9]+$times[10])/2;p95Ms=$times[18];interpretation='20 synthetic protocol roundtrips, engine-only; no product speed multiplier inferred'}
    $engineLease.process.Refresh();$result.resources=@{workingSetBytes=$engineLease.process.WorkingSet64;totalProcessorMilliseconds=$engineLease.process.TotalProcessorTime.TotalMilliseconds}
    Stop-ResearchChild $engineLease;$engineLease=$null;$unexpected=$false;$stopProbeError=$null;try{$probe=[LagomCompetitorLoopback]::Probe($corePort,[Guid]::NewGuid().ToString('N'));$probe.Dispose();$unexpected=$true}catch{$stopProbeError=$_.Exception.GetType().Name+": "+$_.Exception.Message};if($unexpected){throw 'CLI stop did not remove the synthetic path.'};$result.cliStop=@{status='observed';requestFailedAfterStop=$true;genuineGuiOff=$false;method='leased CLI child stop';observedError=$stopProbeError}
    $engineLease=Start-ResearchChild $Binary $engineArgs ($Name+'-engine-restart');$watch=[Diagnostics.Stopwatch]::StartNew();$ready=Wait-CoreListener $engineLease $corePort;$probe=[LagomCompetitorLoopback]::Probe($corePort,[Guid]::NewGuid().ToString('N'));$probe.Dispose();$result.recovery=@{status='observed';milliseconds=$watch.ElapsedMilliseconds;readiness=$ready;method='harness-driven restart after explicit CLI stop';automaticAppRecovery=$false};Stop-ResearchChild $engineLease;$engineLease=$null
    $held=$config+'.held';Move-Item -LiteralPath $config -Destination $held
    try{$check=Invoke-Bounded $Binary @('-t','-d',$engineHome,'-f',$config) 30 ($Name+'-engine-config-unavailable');$generated=Test-Path -LiteralPath $config;$result.configUnavailable=@{status='observed';scope=$scope;check=$check;originalConfigTemporarilyAbsent=$true;newConfigCreated=$generated;preservedOriginalSha256=$originalHash;behavior='Record actual default generation/error; never call this old-profile recovery.'};if($generated){Move-Item -LiteralPath $config -Destination ($config+'.generated-after-unavailable')}}finally{Move-Item -LiteralPath $held -Destination $config}
    if((Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -cne $originalHash){throw 'Original synthetic config restoration mismatch.'}
    $result.status='observed'
  }catch{$result.status='failed';$result.error=$_.Exception.GetType().FullName+': '+$_.Exception.Message}
  finally{if(Test-Path -LiteralPath $events){Write-ResearchJson (Join-Path $evidence ($Name+'-engine-fixture-events.json')) @(Get-Content -LiteralPath $events|ForEach-Object {$_|ConvertFrom-Json})};if($engineLease){Stop-ResearchChild $engineLease};if($fixtureLease){[IO.File]::WriteAllText($fixtureStop,$stopNonce,[Text.UTF8Encoding]::new($false));if(-not $fixtureLease.process.WaitForExit(10000)){Stop-ResearchChild $fixtureLease}else{$fixtureLease.process.Dispose()}};$result.cleanup=@{runtimeStopped=(@(Get-NetTCPConnection -LocalPort $corePort -State Listen -ErrorAction SilentlyContinue).Count -eq 0);fixtureStopRequested=$true;noSystemProxyDnsTunRequested=$true}}
  return $result
}
Initialize-LoopbackType
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
      $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$image;$start.WorkingDirectory=[IO.Path]::GetDirectoryName($image);$start.UseShellExecute=$false;[void](Clear-ChildSecrets $start)
      $watch=[Diagnostics.Stopwatch]::StartNew();$gui=[Diagnostics.Process]::Start($start);$record.launch=@{pid=$gui.Id;birthUtc=$gui.StartTime.ToUniversalTime().ToString('o');arguments=@();image=$image;cwd=$start.WorkingDirectory}
      Start-Sleep -Seconds 8
      $record.observations+=,(Observe-App $image ($pin.name+'-firstlaunch'));$record.firstObservationMilliseconds=$watch.ElapsedMilliseconds;Save-Receipt
      Start-Sleep -Seconds 5;$record.observations+=,(Observe-App $image ($pin.name+'-settled'))
      $record.services=@(Get-CimInstance Win32_Service -OperationTimeoutSec 5|Where-Object {$_.Name -eq 'clash_verge_service'}|Select-Object Name,State,StartMode,ProcessId,PathName)
      $cliFiles=if($pin.name -eq 'v2rayN'){@(@{path='v2rayN-windows-64\bin\xray\xray.exe';args=@('version')},@{path='v2rayN-windows-64\bin\sing_box\sing-box.exe';args=@('version')},@{path='v2rayN-windows-64\bin\mihomo\mihomo.exe';args=@('-v')})}else{@(@{path='verge-mihomo.exe';args=@('-v')})}
      foreach($cli in $cliFiles){$binary=Join-Path $installRoot $cli.path;if(Test-Path -LiteralPath $binary -PathType Leaf){$record.cli+=,(Invoke-Bounded $binary $cli.args 15 ($pin.name+'-cli-'+[IO.Path]::GetFileNameWithoutExtension($binary)))}else{$record.cli+=,@{path=$cli.path;status='skipped-official-sidecar-path-not-present'}}}
      $record.gui=Invoke-GuiScenarios $image $installRoot $pin.name;Save-Receipt
      $engineBinary=if($pin.name -ceq 'v2rayN'){Join-Path $installRoot 'v2rayN-windows-64\bin\mihomo\mihomo.exe'}else{Join-Path $installRoot 'verge-mihomo.exe'}
      if(Test-Path -LiteralPath $engineBinary -PathType Leaf){$record.engine=Invoke-EngineScenarios $engineBinary $directory $pin.name}else{$record.engine=@{status='skipped';classification='official-Mihomo-sidecar-unavailable'}}
      $record.scenarios=@(@{name='synthetic-network';scope='app-loopback-inbound';actualNonceRequests=@($record.gui.requests).Count;details='See GUI proof; no TUN/system-proxy connection is requested.'},@{name='genuine-gui-off';scope='actual-app-Exit-request';result=$record.gui.genuineExit;details='Exit completion is distinct from changing the OS proxy toggle.'},@{name='runtime-crash-recovery';scope='actual-app-owner-after-leased-core-crash';result=$record.gui.automaticRecovery},@{name='config-unavailable';scope='bundled-Mihomo-CLI-only';details='See engine.configUnavailable; not app old-profile recovery.'},@{name='service-unavailable';scope='default-first-launch';result=$record.gui.serviceUnavailable})
      $record.afterLaunchNetwork=Network-State;$record.result='bounded-comparisons-recorded-no-full-functional-acceptance';Save-Receipt
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
  $script:Receipt.result='bounded-uia-and-loopback-observations-collected'
}catch{$failure=$_;$script:Receipt.result='failed';$script:Receipt.error=$_.Exception.GetType().FullName+': '+$_.Exception.Message}
finally{$script:Receipt.completedAt=[DateTimeOffset]::UtcNow.ToString('o');Save-Receipt}
if($failure){throw $failure}
Write-Output ('Observation receipts: '+$evidence+'; functionalAcceptance=false')