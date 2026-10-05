[CmdletBinding()]
param(
  [ValidateSet('Run','GuardOnly')][string]$Mode='Run',
  [string]$IntegrityManifestPath='',
  [string]$EvidenceDirectory='',
  [ValidatePattern('^$|^[a-f0-9]{40}$')][string]$ExpectedSourceCommit='',
  [switch]$LibraryOnly
)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$script:VpnTestsRoot=$PSScriptRoot
$script:VpnMainHelpers=& {
  . (Join-Path $PSScriptRoot 'windows-production-acceptance.ps1') -LibraryOnly
  $result=@{}
  foreach($name in @('Get-NativeAcceptanceEnvironmentErrors','Assert-NativeOrdinaryPath','Assert-NativePathWithin','Resolve-NativeApplication','Assert-NativeAdministratorAcl','Assert-NativeAdministratorOwned','Get-NativeCimSnapshot','Get-NativeNetworkFingerprint','Get-NativeProductServices','Get-NativeProcessIdentity','Assert-NativeService','Get-NativeRecoveryPolicy','Assert-NativeNoGui')){
    $result[$name]=(Get-Command $name -CommandType Function).ScriptBlock
  }
  return $result
}
foreach($name in $script:VpnMainHelpers.Keys){Set-Item -Path ('Function:\'+$name) -Value $script:VpnMainHelpers[$name]}

function Assert-VpnHostedGuard {
  param([string]$SourceCommit,[switch]$IdentityRequired)
  $environment=@{}
  foreach($name in @('GITHUB_ACTIONS','CI','RUNNER_ENVIRONMENT','RUNNER_OS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA')){$environment[$name]=[Environment]::GetEnvironmentVariable($name)}
  $windows=[Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
  $administrator=$windows -and ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $errors=@(Get-NativeAcceptanceEnvironmentErrors -Environment $environment -Administrator $administrator -Windows $windows)
  if($errors.Count){throw ('VPN native hosted guard refused before any write: '+($errors -join ', '))}
  if($PSVersionTable.PSVersion.Major -lt 7 -or -not [Environment]::Is64BitProcess){throw 'PowerShell 7 x64 is required.'}
  if($IdentityRequired -and $SourceCommit -cne $environment.GITHUB_SHA){throw 'VPN candidate source must equal actual GITHUB_SHA.'}
}

function Save-VpnReceipt {$script:VpnReceipt | ConvertTo-Json -Depth 24 | Set-Content -LiteralPath $script:VpnReceiptPath -Encoding utf8}
function Add-VpnEvidence {
  param([string]$Name,$Observation)
  $script:VpnReceipt.checks.Add([ordered]@{name=$Name;observedAt=[DateTimeOffset]::UtcNow.ToString('o');evidence=$Observation})
  Save-VpnReceipt
}
function Test-VpnWatchdog {
  if($script:VpnWatchdog -and $script:VpnWatchdog.State -in @('Failed','Stopped','Completed')){throw 'The independent control watchdog ended before the native gate finished.'}
  if($script:VpnAlarmPath -and (Test-Path -LiteralPath $script:VpnAlarmPath)){throw ('Control/DNS safety watchdog failed: '+[IO.File]::ReadAllText($script:VpnAlarmPath))}
}
function Wait-VpnCondition {
  param([scriptblock]$Condition,[string]$Label,[int]$TimeoutSeconds=90,[switch]$IgnoreWatchdog)
  $watch=[Diagnostics.Stopwatch]::StartNew();$last=''
  while($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds){
    if(-not $IgnoreWatchdog){Test-VpnWatchdog}
    try{$value=& $Condition;if($value){return $value}}catch{$last=$_.Exception.Message}
    Start-Sleep -Milliseconds 200
  }
  throw "Timed out observing $Label. $last"
}
function Start-VpnOwnedChild {
  param([string]$Executable,[string[]]$Arguments,[string]$Label,[string]$DotnetRoot='')
  Assert-NativeOrdinaryPath -Path $Executable -Leaf
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Executable;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.WorkingDirectory=$script:VpnWork
  foreach($argument in $Arguments){$info.ArgumentList.Add($argument)}
  foreach($name in @($info.Environment.Keys)){if($name -match '^(DOTNET_|COMPLUS_|CORECLR_|COR_)'){[void]$info.Environment.Remove($name)}}
  $info.Environment['DOTNET_ADD_GLOBAL_TOOLS_TO_PATH']='0'
  if($DotnetRoot){$info.Environment['DOTNET_ROOT']=$DotnetRoot;$info.Environment['DOTNET_ROOT_X64']=$DotnetRoot}
  $process=[Diagnostics.Process]::new();$process.StartInfo=$info
  if(-not $process.Start()){throw "Owned $Label child did not start."}
  return [pscustomobject]@{Process=$process;Output=$process.StandardOutput.ReadToEndAsync();Errors=$process.StandardError.ReadToEndAsync();Label=$Label}
}
function Stop-VpnOwnedChild {
  param($Child,[int]$TimeoutSeconds=15,[switch]$AllowNonzero)
  try{
    if(-not $Child.Process.WaitForExit($TimeoutSeconds*1000)){$Child.Process.Kill();[void]$Child.Process.WaitForExit(5000);throw "Owned $($Child.Label) child exceeded its deadline."}
    $result=[ordered]@{exitCode=$Child.Process.ExitCode;processId=$Child.Process.Id;stdout=$Child.Output.GetAwaiter().GetResult();stderr=$Child.Errors.GetAwaiter().GetResult()}
    [IO.File]::WriteAllText((Join-Path $script:VpnWork ($Child.Label+'.stdout.txt')),$result.stdout,[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $script:VpnWork ($Child.Label+'.stderr.txt')),$result.stderr,[Text.UTF8Encoding]::new($false))
    if(-not $AllowNonzero -and $result.exitCode -ne 0){throw "Owned $($Child.Label) child failed ($($result.exitCode)): $($result.stderr)"}
    return $result
  }finally{$Child.Process.Dispose()}
}
function Invoke-VpnBounded {
  param([string]$Executable,[string[]]$Arguments,[string]$Label,[int]$TimeoutSeconds=30)
  return Stop-VpnOwnedChild (Start-VpnOwnedChild -Executable $Executable -Arguments $Arguments -Label $Label) -TimeoutSeconds $TimeoutSeconds
}

function Get-VpnAllRoutes {
  return @(Get-NetRoute -PolicyStore ActiveStore | Sort-Object InterfaceIndex,DestinationPrefix,NextHop,RouteMetric | ForEach-Object {
    [ordered]@{index=[int]$_.InterfaceIndex;prefix=[string]$_.DestinationPrefix;nextHop=[string]$_.NextHop;metric=[int]$_.RouteMetric;protocol=[string]$_.Protocol}
  })
}
function Assert-VpnPhysicalNetwork {
  param($Baseline,[string]$Label)
  $now=Get-NativeNetworkFingerprint
  $indices=@($Baseline.dns | ForEach-Object {[int]$_.index})
  $bindings=@($Baseline.ipv6Bindings | ForEach-Object {[string]$_.Name})
  $actual=[ordered]@{dns=@($now.dns | Where-Object {$_.index -in $indices});defaultRoutes=@($now.defaultRoutes | Where-Object {$_.index -in $indices});ipv6Bindings=@($now.ipv6Bindings | Where-Object {$_.Name -in $bindings});userProxy=$now.userProxy;winHttp=$now.winHttp}
  if(($actual | ConvertTo-Json -Depth 8 -Compress) -cne ($Baseline | ConvertTo-Json -Depth 8 -Compress)){throw "Physical DNS/default routes/proxy/IPv6 changed during $Label."}
  return $actual
}
function Invoke-VpnControlCanary {
  param([string]$Label)
  $watch=[Diagnostics.Stopwatch]::StartNew()
  Initialize-VpnNativeReaders
  $lookup=[LagomVpnNativeRead]::LookupAsync()
  if(-not $lookup.Wait(8000)){throw 'Actual Windows DNS lookup for github.com exceeded 8s.'}
  $addresses=@($lookup.GetAwaiter().GetResult())
  if(-not $addresses.Count){throw 'Actual Windows DNS returned no GitHub address.'}
  $curl=Join-Path ([Environment]::GetFolderPath('System')) 'curl.exe'
  $result=Invoke-VpnBounded -Executable $curl -Arguments @('--proxy','','--noproxy','*','--connect-timeout','5','--max-time','10','--fail','--silent','--show-error','--output','NUL','--write-out','%{http_code} %{remote_ip} %{ssl_verify_result}','https://github.com/robots.txt') -Label ('control-'+$Label) -TimeoutSeconds 13
  if($result.stdout -cnotmatch '^200 ([0-9a-fA-F:.]+) 0$'){throw 'Actual HTTPS control canary did not return HTTP200 with verified TLS.'}
  return [ordered]@{at=[DateTimeOffset]::UtcNow.ToString('o');dnsHost='github.com.';resolvedAddresses=$addresses;dnsApi='DnsQuery_W';dnsOptions='0x1148: BYPASS_CACHE|NO_HOSTS_FILE|WIRE_ONLY|TREAT_AS_FQDN';https='https://github.com/robots.txt';curl=$result.stdout;elapsedMs=$watch.ElapsedMilliseconds;useSystemDns=$true;proxyExplicitlyDisabled=$true}
}
function Assert-VpnPrivateTree {
  param([string]$Root)
  Assert-NativeOrdinaryPath -Path $Root
  $rows=@();$items=@(Get-Item -LiteralPath $Root -Force)+@(Get-ChildItem -LiteralPath $Root -Recurse -Force)
  foreach($item in $items){
    Assert-NativeOrdinaryPath -Path $item.FullName -Leaf:(-not $item.PSIsContainer)
    $acl=Get-Acl -LiteralPath $item.FullName;$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if($owner -notin @('S-1-5-18','S-1-5-32-544') -or ($item.FullName -ieq $Root -and -not $acl.AreAccessRulesProtected)){throw 'Private VPN snapshot/config owner or protected root DACL failed.'}
    $allows=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {$_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow})
    if(@($allows | Where-Object {$_.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')}).Count){throw 'Private VPN tree grants an untrusted identity access.'}
    foreach($sid in @('S-1-5-18','S-1-5-32-544')){if(-not @($allows | Where-Object {$_.IdentityReference.Value -eq $sid -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl}).Count){throw 'Private VPN tree lacks its complete administrator/system DACL.'}}
    $rows+=[ordered]@{relative=$item.FullName.Substring($Root.Length);owner=$owner;sddl=$acl.Sddl}
  }
  return $rows
}
function Get-VpnReadOnlyStatus {
  $result=Invoke-VpnBounded -Executable $script:VpnCore -Arguments @('--vpn-service-status') -Label ('vpn-status-'+[Guid]::NewGuid().ToString('N').Substring(0,8)) -TimeoutSeconds 18
  $status=$result.stdout | ConvertFrom-Json
  if($status.observation.state -ne 'observed' -or $status.serviceState -eq 'unknown'){throw 'Installed read-only Core status is unknown.'}
  return $status
}

function Initialize-VpnNativeReaders {
  if('LagomVpnNativeRead' -as [type]){return}
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
public static class LagomVpnNativeRead {
 [DllImport("shell32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern IntPtr CommandLineToArgvW(string command,out int count);
 [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
 public static string[] Arguments(string command) { int count;IntPtr ptr=CommandLineToArgvW(command,out count);if(ptr==IntPtr.Zero)throw new InvalidOperationException("Native argv unreadable.");try{var result=new List<string>();for(int i=0;i<count;i++)result.Add(Marshal.PtrToStringUni(Marshal.ReadIntPtr(ptr,i*IntPtr.Size)));return result.ToArray();}finally{LocalFree(ptr);}}
 [DllImport("dnsapi.dll",CharSet=CharSet.Unicode,ExactSpelling=true)] private static extern int DnsQuery_W(string name,ushort type,uint options,IntPtr extra,out IntPtr records,IntPtr reserved);
 [DllImport("dnsapi.dll",ExactSpelling=true)] private static extern void DnsFree(IntPtr records,int freeType);
 public static Task<string[]> LookupAsync(){return Task.Run(()=>Lookup());}
 private static string[] Lookup(){if(IntPtr.Size!=8)throw new PlatformNotSupportedException("Fixed native DNS layout requires x64.");IntPtr records=IntPtr.Zero;try{int status=DnsQuery_W("github.com.",1,0x1148,IntPtr.Zero,out records,IntPtr.Zero);if(status!=0)throw new Win32Exception(status,"Actual Windows wire DNS query failed.");var result=new List<string>();var seen=new HashSet<IntPtr>();for(IntPtr cursor=records;cursor!=IntPtr.Zero;cursor=Marshal.ReadIntPtr(cursor)){if(seen.Count>=256||!seen.Add(cursor))throw new InvalidOperationException("Malformed DNS record chain.");if(Marshal.ReadInt16(cursor,16)==1&&Marshal.ReadInt16(cursor,18)>=4){byte[] address=new byte[4];Marshal.Copy(IntPtr.Add(cursor,32),address,0,4);result.Add(new IPAddress(address).ToString());}}if(result.Count==0)throw new InvalidOperationException("No real A record from Windows wire DNS.");return result.ToArray();}finally{if(records!=IntPtr.Zero)DnsFree(records,1);}}
}
'@
}
function Assert-VpnLiveGeneration {
  $scm=Assert-NativeService -Name 'EgoistShieldVpn' -Executable $script:VpnWrapper -Running
  if((Get-FileHash -LiteralPath $script:VpnWrapper -Algorithm SHA256).Hash -ine $script:VpnWrapperHash){throw 'Actual service wrapper differs from authenticated bundled WinSW.'}
  $hostRows=@(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($scm.process.processId)" -OperationTimeoutSec 5 | Where-Object {$_.ExecutablePath -ieq $script:VpnCore})
  if($hostRows.Count -ne 1){throw 'VPN wrapper has no unique installed fixed Core runtime host.'}
  $vpnHostProcess=$hostRows[0];$hostArguments=@([LagomVpnNativeRead]::Arguments([string]$vpnHostProcess.CommandLine))
  if(($hostArguments | ConvertTo-Json -Compress) -cne (@($script:VpnCore,'--run-vpn-runtime') | ConvertTo-Json -Compress)){throw 'Actual VPN host argv is not the fixed production host contract.'}
  $runtimeRows=@(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($vpnHostProcess.ProcessId)" -OperationTimeoutSec 5 | Where-Object {$_.ExecutablePath -ieq $script:VpnRuntime})
  if($runtimeRows.Count -ne 1){throw 'VPN Core host has no unique installed sing-box child.'}
  $runtime=$runtimeRows[0];$runtimeArguments=@([LagomVpnNativeRead]::Arguments([string]$runtime.CommandLine))
  if(($runtimeArguments | ConvertTo-Json -Compress) -cne (@($script:VpnRuntime,'run','-c',$script:VpnConfig) | ConvertTo-Json -Compress)){throw 'Actual sing-box argv is not the fixed protected config contract.'}
  foreach($row in @($vpnHostProcess,$runtime)){$owner=Invoke-CimMethod -InputObject $row -MethodName GetOwner -OperationTimeoutSec 5;if($owner.ReturnValue -ne 0 -or $owner.User -cne 'SYSTEM' -or $owner.Domain -cne 'NT AUTHORITY'){throw 'Actual VPN host/runtime is not LocalSystem.'}}
  $listeners=@(Get-NetTCPConnection -LocalPort 10838 -State Listen -ErrorAction SilentlyContinue)
  if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -cne '127.0.0.1' -or [int]$listeners[0].OwningProcess -ne [int]$runtime.ProcessId){throw 'The actual VPN SOCKS listener is not solely owned by this pinned runtime.'}
  $status=Get-VpnReadOnlyStatus
  if(-not $status.serviceInstalled -or -not $status.serviceRunning -or -not $status.backgroundEnabled -or -not $status.running -or $status.localHealth -ne 'responsive' -or $status.startType -ne 'auto' -or [int]$status.pid -ne [int]$scm.process.processId){throw 'Production native VPN status has no fresh SCM/endpoint readiness proof.'}
  $tun=@(Get-NetAdapter -IncludeHidden | Where-Object {$_.Name -ceq 'egoist-vpn' -and $_.Status -eq 'Up'})
  if($tun.Count -ne 1){throw 'The real egoist-vpn TUN adapter is absent or ambiguous.'}
  $address=@(Get-NetIPAddress -InterfaceIndex $tun[0].ifIndex -AddressFamily IPv4 -ErrorAction Stop | Where-Object {$_.IPAddress -eq '172.19.0.1' -and $_.PrefixLength -eq 30})
  if($address.Count -ne 1){throw 'The real TUN IPv4 address is missing.'}
  $route=@(Find-NetRoute -RemoteIPAddress '198.18.0.254' -ErrorAction Stop | Where-Object {$_.PSObject.Properties['DestinationPrefix']})
  if(-not $route.Count -or @($route | Where-Object {$_.InterfaceIndex -ne $tun[0].ifIndex}).Count){throw 'The synthetic destination does not actually select the real TUN route.'}
  return [ordered]@{scm=$scm;host=(Get-NativeProcessIdentity ([int]$vpnHostProcess.ProcessId));runtime=(Get-NativeProcessIdentity ([int]$runtime.ProcessId));listener=($listeners | Select-Object LocalAddress,LocalPort,OwningProcess);status=$status;tun=($tun | Select-Object Name,ifIndex,Status,InterfaceDescription);address=($address | Select-Object IPAddress,PrefixLength,InterfaceIndex);route=($route | Select-Object InterfaceIndex,DestinationPrefix,NextHop,RouteMetric)}
}

function Get-VpnUiRoot {
  $proof=$script:VpnGuiLease.Receipt
  $child=[Diagnostics.Process]::GetProcessById([int]$proof.processId)
  try{
    if($child.HasExited -or $child.MainModule.FileName -ine $script:VpnGui -or [Math]::Abs(($child.StartTime.ToUniversalTime()-[DateTimeOffset]::Parse([string]$proof.startTimeUtc).UtcDateTime).TotalMilliseconds) -gt 1){throw 'The GUI identity no longer matches its elevated-token lease.'}
    $root=[Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$proof.mainWindowHandle)
    if(-not $root -or $root.Current.ProcessId -ne [int]$proof.processId){throw 'UIA root does not belong to the exact elevated GUI.'}
    return $root
  }finally{$child.Dispose()}
}
function Find-VpnUiElement {
  param([string]$Name,$ControlType=$null,$Scope=$null,[int]$TimeoutSeconds=35,[string]$DescendantName='')
  return Wait-VpnCondition -Label ('genuine UIA '+$Name) -TimeoutSeconds $TimeoutSeconds -Condition {
    $searchRoot=if($Scope){$Scope}else{Get-VpnUiRoot}
    $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$Name)
    if($ControlType){$condition=[Windows.Automation.AndCondition]::new($condition,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,$ControlType))}
    $matches=@($searchRoot.FindAll([Windows.Automation.TreeScope]::Descendants,$condition) | Where-Object {$_.Current.IsEnabled -and $_.Current.ProcessId -eq [int]$script:VpnGuiLease.Receipt.processId})
    if($DescendantName){$matches=@($matches | Where-Object {$_.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$DescendantName)).Count -gt 0})}
    if($matches.Count -ne 1){return $null}
    $item=$matches[0];$scroll=$null
    if($item.Current.IsOffscreen -and $item.TryGetCurrentPattern([Windows.Automation.ScrollItemPattern]::Pattern,[ref]$scroll)){$scroll.ScrollIntoView()}
    if($item.Current.IsOffscreen){return $null};return $item
  }
}
function Invoke-VpnUiElement {
  param($Element,[string]$Label)
  Test-VpnWatchdog
  $observed=[ordered]@{name=$Element.Current.Name;controlType=$Element.Current.ControlType.ProgrammaticName;guiProcessId=[int]$script:VpnGuiLease.Receipt.processId}
  $pattern=$null
  if($Element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke()}
  elseif($Element.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)){$pattern.Toggle()}
  elseif($Element.TryGetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)){$pattern.Expand()}
  else{throw "Genuine UIA element has no supported action pattern: $Label"}
  $observed.pattern=$pattern.GetType().Name
  Add-VpnEvidence ('elevated-gui-action:'+ $Label) $observed
}
function Invoke-VpnUiButton {
  param([string]$Name,$Scope=$null)
  Invoke-VpnUiElement (Find-VpnUiElement -Name $Name -ControlType ([Windows.Automation.ControlType]::Button) -Scope $Scope) -Label $Name
}
function Select-VpnUiOption {
  param([string]$Name,[string]$Option)
  $combo=Find-VpnUiElement -Name $Name -ControlType ([Windows.Automation.ControlType]::ComboBox)
  $expansion=$null
  if($combo.TryGetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$expansion)){$expansion.Expand()}
  $optionElement=Find-VpnUiElement -Name $Option -Scope $combo -TimeoutSeconds 15
  $selection=$null
  if(-not $optionElement.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern,[ref]$selection)){throw 'A real native select option lacks SelectionItemPattern.'}
  $selection.Select()
  if($expansion){$expansion.Collapse()}
  $selectionPattern=$combo.GetCurrentPattern([Windows.Automation.SelectionPattern]::Pattern)
  $selected=@($selectionPattern.GetCurrentSelection())
  if($selected.Count -ne 1 -or $selected[0].Current.Name -cne $Option){throw 'The genuine select did not retain the requested option.'}
  Add-VpnEvidence ('elevated-gui-selection:'+ $Name) ([ordered]@{selected=$Option;controlType=$combo.Current.ControlType.ProgrammaticName})
}
function Invoke-VpnNavigation {
  param([string]$Name)
  $root=Get-VpnUiRoot
  $navigation=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,'Основная навигация'))
  if($navigation.Count -eq 1){Invoke-VpnUiButton -Name $Name -Scope $navigation[0]}
  else{Invoke-VpnUiButton -Name $Name}
}
function Assert-VpnElevatedGuiProof {
  param($Proof)
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent();$current=[Diagnostics.Process]::GetCurrentProcess()
  try{
    if($Proof.launchPolicy -cne 'elevated' -or $Proof.elevatedGui -isnot [bool] -or -not $Proof.elevatedGui -or $Proof.guiRequestedExecutionLevel -cne 'asInvoker' -or @($Proof.arguments).Count -ne 0 -or $Proof.executable -ine $script:VpnGui -or $Proof.source.commit -cne $script:VpnSourceCommit){throw 'Vpn GUI launch is not the actual source-bound elevated empty-argv process.'}
    foreach($token in @($Proof.token,$Proof.runnerToken)){
      if($token.elevated -isnot [bool] -or -not $token.elevated -or $token.administratorsEnabled -isnot [bool] -or -not $token.administratorsEnabled -or ($token.integrityRid -isnot [int] -and $token.integrityRid -isnot [long]) -or $token.integrityRid -lt 12288 -or $token.uiAccess -isnot [bool] -or $token.uiAccess -or $token.tokenType -ne 1){throw 'Vpn GUI requires a measured elevated administrator primary high token.'}
      if($token.userSid -in @('S-1-5-18','S-1-5-19','S-1-5-20') -or $token.userSid -cne $identity.User.Value -or $token.sessionId -ne $current.SessionId){throw 'Vpn GUI token does not belong to the actual current Windows user/session.'}
    }
    if($Proof.token.userSid -cne $Proof.runnerToken.userSid -or $Proof.token.sessionId -ne $Proof.runnerToken.sessionId){throw 'Vpn GUI token differs from its measured launcher user/session.'}
  }finally{$current.Dispose();$identity.Dispose()}
}
function Start-VpnElevatedGui {
  param([Parameter(Mandatory=$true)][ValidateSet('Install','OffAndRemove')][string]$Operation)
  Assert-NativeNoGui
  $script:VpnGuiLease=Start-ElevatedGuiLease -CanonicalInstalledGuiPath $script:VpnGui -IntegrityManifestPath $script:VpnManifestPath -ExpectedSourceCommit $script:VpnSourceCommit -WorkRoot $script:VpnWork -EvidenceDirectory $script:VpnEvidence -LeaseSeconds 540
  $proof=$script:VpnGuiLease.Receipt
  Assert-VpnElevatedGuiProof $proof
  Add-VpnEvidence 'elevated-gui-empty-argv-high-token-lease' $proof
  $script:VpnGuiOperation=$Operation
  $script:VpnReceipt.gui+=[ordered]@{operation=$Operation;phase='launch';launch=$proof}
  [void](Get-VpnUiRoot)
}
function Close-VpnElevatedGui {
  $child=[Diagnostics.Process]::GetProcessById([int]$script:VpnGuiLease.Receipt.processId)
  try{
    $heldGuiProcessHandle=$child.Handle
    $closeDiagnostics=[ordered]@{
      schemaVersion=1;processId=$child.Id;startTimeUtc=$script:VpnGuiLease.Receipt.startTimeUtc;callerProcessHandleHeld=($heldGuiProcessHandle -ne [IntPtr]::Zero)
      powershellVersion=$PSVersionTable.PSVersion.ToString();runtimeVersion=[Environment]::Version.ToString()
      closeRequestedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');closeReturnedAtUtc=$null;closeElapsedMilliseconds=$null
      waitBudgetMilliseconds=30000;waitStartedAtUtc=$null;waitFinishedAtUtc=$null;waitElapsedMilliseconds=$null;waitReturned=$null;exitCodeAtWait=$null;hasExitedBeforeCleanup=$null;exitCodeBeforeCleanup=$null;processExitUtcBeforeCleanup=$null;readbackErrorType=$null;readbackHresult=$null;readbackStartedAtUtc=$null;readbackFinishedAtUtc=$null
    }
    $script:VpnReceipt.gui+=[ordered]@{operation=$script:VpnGuiOperation;phase='close-observation';closeDiagnostics=$closeDiagnostics}
    try{Save-VpnReceipt}catch{} # Diagnostics cannot replace the original close outcome.
    $closeWatch=[Diagnostics.Stopwatch]::StartNew()
    Invoke-VpnUiButton -Name 'Закрыть приложение'
    $closeDiagnostics.closeElapsedMilliseconds=$closeWatch.ElapsedMilliseconds
    $closeDiagnostics.closeReturnedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    $closeDiagnostics.waitStartedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    $waitWatch=[Diagnostics.Stopwatch]::StartNew()
    $waitReturned=$child.WaitForExit(30000)
    $closeDiagnostics.waitElapsedMilliseconds=$waitWatch.ElapsedMilliseconds
    $closeDiagnostics.waitFinishedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    $closeDiagnostics.waitReturned=$waitReturned
    $exitCodeAtWait=if($waitReturned){$child.ExitCode}else{$null}
    $closeDiagnostics.exitCodeAtWait=$exitCodeAtWait
    $closeDiagnostics.readbackStartedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    try{
      $closeDiagnostics.hasExitedBeforeCleanup=$child.HasExited
      if($closeDiagnostics.hasExitedBeforeCleanup){
        $closeDiagnostics.exitCodeBeforeCleanup=$child.ExitCode
        $closeDiagnostics.processExitUtcBeforeCleanup=$child.ExitTime.ToUniversalTime().ToString('o')
      }
    }catch{
      $closeDiagnostics.readbackErrorType=$_.Exception.GetType().Name
      $closeDiagnostics.readbackHresult=$_.Exception.HResult
    }
    $closeDiagnostics.readbackFinishedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    try{Save-VpnReceipt}catch{} # Diagnostics cannot replace the original close outcome.
    if(-not $waitReturned -or $exitCodeAtWait -ne 0){throw 'The actual normal GUI close did not terminate successfully.'}
    Assert-NativeNoGui
    $cleanup=Stop-ElevatedGuiLease -Lease $script:VpnGuiLease;$script:VpnGuiLease=$null
    if(-not $cleanup.exitedNormally -or $cleanup.exitCode -ne 0 -or -not $cleanup.cleanup.noOrphans){throw 'Elevated GUI guardian has no normal zero-orphan close proof.'}
    Add-VpnEvidence 'actual-normal-gui-close-and-zero-gui-processes' $cleanup
    $script:VpnReceipt.gui+=[ordered]@{operation=$script:VpnGuiOperation;phase='close';normalExit=$true;cleanup=$cleanup}
    $script:VpnGuiOperation=$null
  }finally{try{Save-VpnReceipt}catch{};$child.Dispose()}
}
function Read-VpnUiProfile {
  Assert-NativeOrdinaryPath -Path $script:VpnStateFile -Leaf
  if((Get-Item -LiteralPath $script:VpnStateFile).Length -gt 1048576){throw 'The genuine UI profile is unexpectedly large.'}
  return [IO.File]::ReadAllText($script:VpnStateFile) | ConvertFrom-Json
}
function Configure-VpnThroughUi {
  param([int]$FixturePort,[string]$NodeName)
  Invoke-VpnNavigation 'Настройки'
  $before=Read-VpnUiProfile
  if(@($before.nodes).Count -ne 0 -or @($before.domainRules).Count -ne 0 -or @($before.processRules).Count -ne 0 -or $before.settings.autoConnect -or $before.settings.minimizeToTray -or $before.settings.killSwitch -or [string]$before.settings.runtimePath){throw 'Native VPN gate requires a clean elevated GUI profile, without preexisting nodes/rules/autoconnect/custom runtime/kill switch/tray close.'}
  $summary=Find-VpnUiElement -Name 'Маршрутизация VPN Режим соединения, DNS и правила'
  Invoke-VpnUiElement $summary 'Маршрутизация VPN'
  Select-VpnUiOption -Name 'Режим маршрутизации VPN' -Option 'По правилам · остальное напрямую'
  Select-VpnUiOption -Name 'DNS соединения VPN' -Option 'DNS системы'
  Invoke-VpnUiButton 'Сохранить настройки VPN'
  [void](Wait-VpnCondition -Label 'saved genuine settings' -Condition {$state=Read-VpnUiProfile;if($state.settings.routeMode -eq 'selected' -and $state.settings.dnsMode -eq 'system'){return $state}})
  Invoke-VpnUiButton 'Добавить правило процесса VPN'
  $dialog=Find-VpnUiElement -Name 'Добавить правило процесса VPN' -DescendantName 'Процесс для правила VPN'
  $edit=Find-VpnUiElement -Name 'Процесс для правила VPN' -ControlType ([Windows.Automation.ControlType]::Edit) -Scope $dialog
  $value=$edit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern);$value.SetValue('LagomVpnNativeProbe.exe')
  Select-VpnUiOption -Name 'Действие правила VPN' -Option 'Через VPN'
  Invoke-VpnUiButton -Name 'Сохранить правило' -Scope $dialog
  [void](Wait-VpnCondition -Label 'saved genuine process rule' -Condition {$state=Read-VpnUiProfile;if(@($state.processRules).Count -eq 1 -and $state.processRules[0].process -ceq 'LagomVpnNativeProbe.exe' -and $state.processRules[0].mode -eq 'vpn'){return $state}})
  Invoke-VpnNavigation 'VPN'
  $uri='socks5://127.0.0.1:'+ $FixturePort +'#'+[Uri]::EscapeDataString($NodeName)
  # The shipped Import button reads the real Windows clipboard. No state or
  # product API is called from the test; this is ordinary user import content.
  $script:VpnPreviousClipboard=Get-Clipboard -Raw -ErrorAction SilentlyContinue
  Set-Clipboard -Value $uri
  $script:VpnClipboardChanged=$true
  Invoke-VpnUiButton 'Импорт'
  [void](Wait-VpnCondition -Label 'UI clipboard node import' -Condition {$state=Read-VpnUiProfile;if(@($state.nodes).Count -eq 1 -and $state.nodes[0].name -ceq $NodeName -and $state.nodes[0].id -eq $state.activeNodeId){return $state}})
  Add-VpnEvidence 'genuine-ui-settings-rule-and-node-persisted' ([ordered]@{routeMode='selected';dnsMode='system';process='LagomVpnNativeProbe.exe';mode='vpn';nodeName=$NodeName;fixturePort=$FixturePort;profileReadOnlyByHarness=$true})
}

function Build-VpnProbe {
  param([string]$WorkRoot)
  Assert-NativeOrdinaryPath -Path $WorkRoot
  $directory=Join-Path $WorkRoot 'plain-tcp-probe';[void][IO.Directory]::CreateDirectory($directory)
  $source=Join-Path $directory 'windows-vpn-native-probe.cs'
  [IO.File]::WriteAllBytes($source,[IO.File]::ReadAllBytes((Join-Path $script:VpnTestsRoot 'windows-vpn-native-probe.cs')))
  $escaped=[Security.SecurityElement]::Escape($source)
  $projectFile=Join-Path $directory 'LagomVpnNativeProbe.csproj'
  [IO.File]::WriteAllText($projectFile,"<Project Sdk=`"Microsoft.NET.Sdk`"><PropertyGroup><OutputType>Exe</OutputType><AssemblyName>LagomVpnNativeProbe</AssemblyName><TargetFramework>net10.0-windows</TargetFramework><PlatformTarget>x64</PlatformTarget><LangVersion>14.0</LangVersion><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings><EnableDefaultCompileItems>false</EnableDefaultCompileItems><NuGetAudit>false</NuGetAudit></PropertyGroup><ItemGroup><Compile Include=`"$escaped`"/></ItemGroup></Project>",[Text.UTF8Encoding]::new($false))
  $projectRoot=[IO.Path]::GetFullPath((Join-Path $script:VpnTestsRoot '..'))
  $sdk=if($env:SHIELD_DOTNET){[IO.Path]::GetFullPath($env:SHIELD_DOTNET)}else{Join-Path $projectRoot '.tools\dotnet-10.0.401\dotnet.exe'}
  $saved=@{}
  foreach($name in @('TEMP','TMP','DOTNET_CLI_HOME','DOTNET_ADD_GLOBAL_TOOLS_TO_PATH','DOTNET_CLI_TELEMETRY_OPTOUT')){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
  try{
    $env:DOTNET_ADD_GLOBAL_TOOLS_TO_PATH='0'
    $env:TEMP=$directory;$env:TMP=$directory;$env:DOTNET_CLI_HOME=Join-Path $directory 'dotnet-home';$env:DOTNET_CLI_TELEMETRY_OPTOUT='1'
    [void](Invoke-VpnBounded -Executable $sdk -Arguments @('build',$projectFile,'-c','Release','--nologo','--ignore-failed-sources') -Label 'plain-tcp-probe-build' -TimeoutSeconds 60)
  }finally{foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}}
  $executable=Join-Path $directory 'bin\Release\net10.0-windows\LagomVpnNativeProbe.exe'
  return [ordered]@{executable=$executable;dotnetRoot=[IO.Path]::GetDirectoryName($sdk);sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash;executableSha256=(Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash;sourceFile='tests/windows-vpn-native-probe.cs'}
}
function Invoke-VpnNonceProbe {
  param($Generation,[string]$Label)
  $nonce=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
  $file=Join-Path $script:VpnWork ($Label+'.probe.json')
  $child=Start-VpnOwnedChild -Executable $script:VpnProbe.executable -Arguments @('--probe',$nonce,$script:VpnFixtureProof.instance,$file) -Label $Label -DotnetRoot $script:VpnProbe.dotnetRoot
  $released=$false
  try{
    $proof=Wait-VpnCondition -Label 'actual plain TCP probe nonce' -TimeoutSeconds 15 -Condition {if(Test-Path -LiteralPath $file){return [IO.File]::ReadAllText($file)|ConvertFrom-Json};if($child.Process.HasExited){throw 'The plain TCP nonce probe ended without actual response evidence.'}}
    if($proof.processId -ne $child.Process.Id -or $proof.processName -cne 'LagomVpnNativeProbe.exe' -or $proof.proxyConfigured -or $proof.targetAddress -cne '198.18.0.254' -or $proof.nonce -cne $nonce -or $proof.fixtureInstance -cne $script:VpnFixtureProof.instance){throw 'The actual plain TCP nonce proof is mismatched.'}
    $events=@(Get-Content -LiteralPath $script:VpnFixtureEvents | Where-Object {$_} | ForEach-Object {$_|ConvertFrom-Json} | Where-Object {$_.kind -eq 'nonce-served' -and $_.nonce -ceq $nonce})
    if($events.Count -ne 1 -or $events[0].responseSha256 -cne $proof.responseSha256 -or $events[0].peerAddress -cne '127.0.0.1'){throw 'The real SOCKS peer did not observe this new nonce.'}
    $flow=@(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $events[0].peerPort -RemoteAddress '127.0.0.1' -RemotePort $script:VpnFixtureProof.port -State Established -ErrorAction SilentlyContinue)
    if($flow.Count -ne 1 -or [int]$flow[0].OwningProcess -ne [int]$Generation.runtime.processId){throw 'The actual retained sing-box→fixture socket is not owned by this verified native generation.'}
    $probeFlow=@(Get-NetTCPConnection -OwningProcess $child.Process.Id -State Established -ErrorAction SilentlyContinue | Where-Object {$_.RemoteAddress -eq '198.18.0.254' -and $_.RemotePort -eq 19080})
    if($probeFlow.Count -ne 1){throw 'The probe does not own a real plain TCP synthetic destination flow.'}
    $nativeProof=[ordered]@{probe=$proof;fixtureEvent=$events[0];socksFlow=($flow | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess);plainFlow=($probeFlow | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess);runtimeInstance=$Generation.runtime}
    [IO.File]::WriteAllText($file+'.release',('release:'+ $nonce),[Text.UTF8Encoding]::new($false));$released=$true
    [void](Stop-VpnOwnedChild $child -TimeoutSeconds 10)
    Add-VpnEvidence ('actual-tun-plain-tcp-socks-egress:'+ $Label) $nativeProof
  }finally{
    if(-not $released){if(-not $child.Process.HasExited){$child.Process.Kill();[void]$child.Process.WaitForExit(5000)};$child.Process.Dispose()}
  }
}
function Assert-VpnStopped {
  $rows=@(Get-NativeProductServices | Where-Object {$_.Name -ceq 'EgoistShieldVpn'})
  if($rows.Count -ne 1 -or $rows[0].PathName.Trim().Trim('"') -ine $script:VpnWrapper -or $rows[0].State -ne 'Stopped' -or $rows[0].StartMode -ne 'Disabled' -or [int]$rows[0].ProcessId -ne 0){throw 'The real VPN service is not Stopped + Disabled with zero native PID.'}
  $status=Get-VpnReadOnlyStatus
  if(-not $status.serviceInstalled -or $status.serviceState -ne 'stopped' -or $status.startType -ne 'disabled' -or $status.backgroundEnabled -or $status.running -or $status.localHealth -ne 'unresponsive'){throw 'Production read-only status did not verify background OFF intent and stopped local endpoint.'}
  Assert-VpnNoRuntime
  return [ordered]@{scm=$rows[0];status=$status;remainingListeners=0;remainingRuntimes=0;remainingTunAdapters=0}
}
function Assert-VpnNoRuntime {
  if(@(Get-NetTCPConnection -LocalPort 10838 -State Listen -ErrorAction SilentlyContinue).Count){throw 'An actual listener remains at the owned VPN port.'}
  if(@(Get-NetAdapter -IncludeHidden | Where-Object {$_.Name -ceq 'egoist-vpn'}).Count){throw 'The owned TUN interface remains after runtime shutdown.'}
  if(@(Get-CimInstance Win32_Process -Filter "Name = 'sing-box.exe'" -OperationTimeoutSec 5 | Where-Object {$_.ExecutablePath -ieq $script:VpnRuntime}).Count){throw 'An actual pinned owned sing-box remains after shutdown.'}
}

function Invoke-VpnEmergencyStop {
  param([string]$SourceCommit,[string]$WrapperHash,[string]$WorkRoot,[string]$CoreHash)
  Assert-VpnHostedGuard -SourceCommit $SourceCommit -IdentityRequired
  $canonicalWork=Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) ('lagom-native-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT)
  [void](Assert-NativePathWithin -Path $WorkRoot -Root $canonicalWork)
  Assert-NativeOrdinaryPath -Path $WorkRoot
  $script:VpnWork=$WorkRoot
  $fixedWrapper=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShield\Runtime\Vpn\service-wrapper\egoistshield-vpn-service.exe'
  $rows=@(Get-NativeProductServices | Where-Object {$_.Name -ceq 'EgoistShieldVpn'})
  if(-not $rows.Count){return [ordered]@{kind='emergency-cleanup-only';serviceAbsent=$true;uiStopProved=$false}}
  if($rows.Count -ne 1 -or $rows[0].PathName.Trim().Trim('"') -ine $fixedWrapper -or $WrapperHash -cnotmatch '^[a-fA-F0-9]{64}$'){throw 'Emergency cleanup refused an unknown SCM identity.'}
  [void](Assert-NativeAdministratorOwned $fixedWrapper)
  if((Get-FileHash -LiteralPath $fixedWrapper -Algorithm SHA256).Hash -ine $WrapperHash){throw 'Emergency cleanup refused an unpinned wrapper.'}
  $sc=Join-Path ([Environment]::GetFolderPath('System')) 'sc.exe'
  [void](Invoke-VpnBounded -Executable $sc -Arguments @('config','EgoistShieldVpn','start=','disabled') -Label 'emergency-vpn-disable' -TimeoutSeconds 8)
  $current=@(Get-NativeProductServices | Where-Object {$_.Name -ceq 'EgoistShieldVpn'})
  if($current.Count -ne 1 -or $current[0].StartMode -ne 'Disabled' -or $current[0].PathName.Trim().Trim('"') -ine $fixedWrapper){throw 'Emergency Disabled readback failed.'}
  if($current[0].State -ne 'Stopped'){
    $stop=Start-VpnOwnedChild -Executable $sc -Arguments @('stop','EgoistShieldVpn') -Label 'emergency-vpn-stop'
    [void](Stop-VpnOwnedChild $stop -TimeoutSeconds 8 -AllowNonzero)
  }
  $stopped=$false;$watch=[Diagnostics.Stopwatch]::StartNew()
  while($watch.Elapsed.TotalSeconds -lt 12){$row=Get-NativeProductServices|Where-Object {$_.Name -ceq 'EgoistShieldVpn'};if($row.State -eq 'Stopped'){$stopped=$true;break};Start-Sleep -Milliseconds 150}
  if(-not $stopped -and [int]$row.ProcessId -gt 0){
    $identity=Get-NativeProcessIdentity ([int]$row.ProcessId);$held=[Diagnostics.Process]::GetProcessById([int]$identity.processId)
    try{
      if($held.HasExited -or $held.MainModule.FileName -ine $fixedWrapper -or [Math]::Abs(($held.StartTime.ToUniversalTime()-[DateTimeOffset]::Parse($identity.createdUtc).UtcDateTime).TotalMilliseconds) -gt 1){throw 'Emergency cleanup refused a changed live process identity.'}
      $held.Kill();[void]$held.WaitForExit(5000)
    }finally{$held.Dispose()}
  }
  $coreStopped=$false;$reenabled=$false;$stableSince=$null;$stable=[Diagnostics.Stopwatch]::StartNew()
  while($stable.Elapsed.TotalSeconds -lt 25){
    $readback=@(Get-NativeProductServices|Where-Object {$_.Name -ceq 'EgoistShieldVpn'})
    if($readback.Count -eq 0){return [ordered]@{kind='emergency-cleanup-only';serviceAbsent=$true;coreNormallyStopped=$coreStopped;uiStopProved=$false}}
    if($readback.Count -ne 1 -or $readback[0].PathName.Trim().Trim('"') -ine $fixedWrapper){throw 'Emergency stable readback found an unknown SCM identity.'}
    if($readback[0].StartMode -ne 'Disabled'){
      $reenabled=$true;$stableSince=$null
      # Only failure cleanup may drain the exact authenticated Core normally.
      # This covers an install already in flight while the first OFF occurred.
      if(-not $coreStopped){
        $fixedCore=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield\resources\core-service\win-x64\EgoistShield.Service.exe'
        if($CoreHash -cnotmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $fixedCore -Algorithm SHA256).Hash -ine $CoreHash){throw 'Emergency Core drain refused a changed candidate pin.'}
        $coreProof=Assert-NativeService -Name 'EgoistShieldCore' -Executable $fixedCore -Running
        [void](Invoke-VpnBounded -Executable $sc -Arguments @('stop','EgoistShieldCore') -Label 'emergency-exact-core-normal-stop' -TimeoutSeconds 8)
        $drain=[Diagnostics.Stopwatch]::StartNew();$drained=$false
        while($drain.Elapsed.TotalSeconds -lt 15){$coreRows=@(Get-NativeProductServices|Where-Object {$_.Name -ceq 'EgoistShieldCore'});if($coreRows.Count -eq 1 -and $coreRows[0].State -eq 'Stopped' -and $coreRows[0].PathName.Trim().Trim('"') -ieq $fixedCore){$drained=$true;break};Start-Sleep -Milliseconds 150}
        if(-not $drained){throw 'Emergency exact Core normal stop could not be verified.'};$coreStopped=$true
      }
      [void](Invoke-VpnBounded -Executable $sc -Arguments @('config','EgoistShieldVpn','start=','disabled') -Label 'emergency-vpn-redisable' -TimeoutSeconds 8)
      $again=Start-VpnOwnedChild -Executable $sc -Arguments @('stop','EgoistShieldVpn') -Label 'emergency-vpn-restop';[void](Stop-VpnOwnedChild $again -TimeoutSeconds 8 -AllowNonzero)
    }
    $clean=$readback[0].StartMode -eq 'Disabled' -and $readback[0].State -eq 'Stopped' -and [int]$readback[0].ProcessId -eq 0 -and @(Get-NetTCPConnection -LocalPort 10838 -State Listen -ErrorAction SilentlyContinue).Count -eq 0 -and @(Get-NetAdapter -IncludeHidden|Where-Object {$_.Name -ceq 'egoist-vpn'}).Count -eq 0
    if($clean){if($null -eq $stableSince){$stableSince=$stable.Elapsed.TotalSeconds};if($stable.Elapsed.TotalSeconds-$stableSince -ge 5){return [ordered]@{kind='emergency-cleanup-only';scm=$readback;stableDisabledSeconds=5;inFlightReenableObserved=$reenabled;coreNormallyStopped=$coreStopped;uiStopProved=$false;intentStateRestored=$false}}}else{$stableSince=$null}
    Start-Sleep -Milliseconds 200
  }
  throw 'Emergency cleanup could not prove stable Disabled/Stopped/no endpoint/TUN; native gate remains failed.'
}

function Start-VpnControlWatchdog {
  $options=[ordered]@{sourceCommit=$script:VpnSourceCommit;wrapperHash=$script:VpnWrapperHash;coreHash=$script:VpnCoreHash;workRoot=$script:VpnWork;baseline=$script:VpnBaseline;
    alarmPath=$script:VpnAlarmPath;armPath=$script:VpnArmPath;stopPath=$script:VpnWatchdogStop;logPath=$script:VpnControlLog}
  $script:VpnWatchdog=Start-Job -Name 'lagom-native-vpn-control' -ArgumentList @((Join-Path $script:VpnTestsRoot 'windows-vpn-native-acceptance.ps1'),($options|ConvertTo-Json -Depth 12 -Compress)) -ScriptBlock {
    param($Source,$OptionsJson)
    . $Source -LibraryOnly
    $options=$OptionsJson|ConvertFrom-Json
    Assert-VpnHostedGuard -SourceCommit $options.sourceCommit -IdentityRequired
    $script:VpnWork=[string]$options.workRoot
    foreach($file in @($options.alarmPath,$options.armPath,$options.stopPath,$options.logPath)){[void](Assert-NativePathWithin -Path $file -Root $script:VpnWork)}
    $watch=[Diagnostics.Stopwatch]::StartNew();$samples=0
    try{
      while($watch.Elapsed.TotalSeconds -lt 900){
        if(Test-Path -LiteralPath $options.stopPath){return}
        $physical=Assert-VpnPhysicalNetwork -Baseline $options.baseline -Label 'independent watchdog'
        $canary=Invoke-VpnControlCanary -Label ('watchdog-'+$samples)
        $row=[ordered]@{sample=$samples;canary=$canary;physicalPreserved=$true;physical=$physical}
        ($row|ConvertTo-Json -Depth 10 -Compress)|Add-Content -LiteralPath $options.logPath -Encoding utf8
        $samples++;Start-Sleep -Milliseconds 1500
      }
      throw 'The control watchdog lease exceeded its fixed 900s bound.'
    }catch{
      $failure=[ordered]@{at=[DateTimeOffset]::UtcNow.ToString('o');error=$_.Exception.Message;samples=$samples;nativeAcceptancePassed=$false}
      [IO.File]::WriteAllText($options.alarmPath,($failure|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
      if(Test-Path -LiteralPath $options.armPath){try{$failure.cleanup=Invoke-VpnEmergencyStop -SourceCommit $options.sourceCommit -WrapperHash $options.wrapperHash -CoreHash $options.coreHash -WorkRoot $script:VpnWork}catch{$failure.cleanupError=$_.Exception.Message}}
      [IO.File]::WriteAllText($options.alarmPath,($failure|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
      throw
    }
  }
  [void](Wait-VpnCondition -Label 'first independent real DNS/HTTPS watchdog sample' -TimeoutSeconds 25 -Condition {if(Test-Path -LiteralPath $script:VpnControlLog){$first=Get-Content -LiteralPath $script:VpnControlLog -TotalCount 1;if($first){return $first|ConvertFrom-Json}}})
}

function Stop-VpnVerifiedWrapperForRecovery {
  param($Generation)
  $held=@()
  try{
    foreach($identity in @($Generation.scm.process,$Generation.host,$Generation.runtime)){
      $child=[Diagnostics.Process]::GetProcessById([int]$identity.processId)
      if($child.HasExited -or $child.MainModule.FileName -ine $identity.executable -or [Math]::Abs(($child.StartTime.ToUniversalTime()-[DateTimeOffset]::Parse($identity.createdUtc).UtcDateTime).TotalMilliseconds) -gt 1){$child.Dispose();throw 'Crash injection refused a changed live process generation.'}
      $held+=$child
    }
    $before=Assert-VpnLiveGeneration
    if($before.scm.process.processId -ne $Generation.scm.process.processId -or $before.runtime.processId -ne $Generation.runtime.processId){throw 'SCM generation changed before the exact wrapper crash.'}
    Add-VpnEvidence 'bounded-crash-injection-exact-verified-winsw-handle' ([ordered]@{wrapper=$Generation.scm.process;sha256=$script:VpnWrapperHash;method='Process.Kill on held exact wrapper only';guiAbsent=$true})
    $held[0].Kill();if(-not $held[0].WaitForExit(5000)){throw 'The verified wrapper handle did not terminate.'}
    $after=Wait-VpnCondition -Label 'fresh actual native SCM/TUN/runtime recovery' -TimeoutSeconds 95 -Condition {
      $fresh=Assert-VpnLiveGeneration
      if($fresh.scm.process.processId -eq $Generation.scm.process.processId -or $fresh.runtime.processId -eq $Generation.runtime.processId){return $null}
      if([DateTimeOffset]::Parse($fresh.scm.process.createdUtc) -le [DateTimeOffset]::Parse($Generation.scm.process.createdUtc) -or [DateTimeOffset]::Parse($fresh.runtime.createdUtc) -le [DateTimeOffset]::Parse($Generation.runtime.createdUtc)){throw 'Recovered native process creation is not newer.'}
      foreach($old in $held){if(-not $old.HasExited){return $null}};return $fresh
    }
    Add-VpnEvidence 'actual-newer-wrapper-runtime-and-old-processes-exited' ([ordered]@{before=$Generation;after=$after;oldNativeHandlesExited=$true})
    return $after
  }finally{foreach($child in $held){$child.Dispose()}}
}

function Invoke-VpnNativeAcceptance {
  Assert-VpnHostedGuard -SourceCommit $ExpectedSourceCommit -IdentityRequired:($Mode -eq 'Run')
  if($Mode -eq 'GuardOnly'){Write-Output 'VPN hosted guards passed; no files, services, routes, DNS, clipboard or GUI were changed.';return}
  Assert-NativeOrdinaryPath $env:RUNNER_TEMP;Assert-NativeOrdinaryPath $env:GITHUB_WORKSPACE
  $script:VpnSourceCommit=$ExpectedSourceCommit
  $script:VpnManifestPath=Assert-NativePathWithin -Path $IntegrityManifestPath -Root $env:GITHUB_WORKSPACE
  Assert-NativeOrdinaryPath -Path $script:VpnManifestPath -Leaf
  $projectRoot=[IO.Path]::GetFullPath((Join-Path $script:VpnTestsRoot '..'))
  if($projectRoot -ine [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)){throw 'The VPN gate must run from the actual checked-out source workspace.'}
  $actualHead=& git -C $projectRoot rev-parse HEAD
  if($LASTEXITCODE -ne 0 -or $actualHead -cne $script:VpnSourceCommit){throw 'Actual checked-out HEAD does not match the candidate source commit.'}
  $frozenFiles=@('tests/windows-vpn-native-acceptance.ps1','tests/windows-vpn-native-probe.cs','tests/windows-vpn-production-acceptance.mjs','tests/windows-ordinary-gui.ps1','tests/windows-ordinary-gui.cs','tests/windows-production-acceptance.ps1','tests/windows-production-acceptance.mjs')
  foreach($relative in $frozenFiles){$tracked=& git -C $projectRoot ls-files --error-unmatch -- $relative;if($LASTEXITCODE -ne 0){throw "Uncommitted VPN gate source: $relative"}}
  & git -C $projectRoot diff --quiet HEAD -- $frozenFiles
  if($LASTEXITCODE -ne 0){throw 'VPN acceptance/elevated GUI helpers must match the candidate source commit.'}
  $manifest=[IO.File]::ReadAllText($script:VpnManifestPath)|ConvertFrom-Json
  if($manifest.product -cne 'Egoist Lagom' -or $manifest.source.commit -cne $script:VpnSourceCommit -or [string]$manifest.version -cnotmatch '^\d+\.\d+\.\d+$'){throw 'Candidate integrity manifest identity failed.'}
  $script:VpnInstallRoot=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield'
  $script:VpnGui=Join-Path $script:VpnInstallRoot 'EgoistShield.exe'
  $script:VpnCore=Join-Path $script:VpnInstallRoot 'resources\core-service\win-x64\EgoistShield.Service.exe'
  $script:VpnRuntime=Join-Path $script:VpnInstallRoot 'resources\runtime\sing-box\sing-box.exe'
  $script:VpnProductRoot=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShield'
  $script:VpnWrapper=Join-Path $script:VpnProductRoot 'Runtime\Vpn\service-wrapper\egoistshield-vpn-service.exe'
  $script:VpnConfig=Join-Path $script:VpnProductRoot 'Runtime\Vpn\config.json'
  $script:VpnConnection=Join-Path $script:VpnProductRoot 'Service\Vpn\connection.json'
  $script:VpnStateFile=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Egoist Shield\egoistshield-state.json'
  $script:VpnNode=Resolve-NativeApplication 'node'
  foreach($file in @($script:VpnGui,$script:VpnCore,$script:VpnRuntime)){Assert-NativeOrdinaryPath -Path $file -Leaf;[void](Assert-NativeAdministratorOwned $file -InstallationPath)}
  [void](Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:VpnCore -Running)
  Assert-NativeNoGui
  if(@(Get-NativeProductServices | Where-Object {$_.Name -ceq 'EgoistShieldVpn'}).Count -or (Test-Path -LiteralPath $script:VpnConnection)){throw 'The clean candidate already has a VPN service or snapshot; this gate does not replace existing sessions.'}
  Assert-VpnNoRuntime
  $existingOthers=@(Get-NativeProductServices | Where-Object {$_.Name -cne 'EgoistShieldVpn'} | Select-Object Name,State,StartMode,StartName,PathName)
  if(@($existingOthers | Where-Object {$_.Name -in @('EgoistShieldZapret','EgoistShieldSystemDoH') -and $_.State -eq 'Running'}).Count){throw 'Native VPN gate requires interfering DPI/DNS services stopped beforehand by the main candidate acceptance.'}
  $baseWork=Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) ('lagom-native-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT)
  Assert-NativeOrdinaryPath $baseWork
  $script:VpnWork=Assert-NativePathWithin -Path (Join-Path $baseWork 'vpn-native') -Root $baseWork
  if(Test-Path -LiteralPath $script:VpnWork){throw 'VPN native work already exists; inspect its receipt before any retry.'}
  $script:VpnEvidence=if($EvidenceDirectory){Assert-NativePathWithin -Path $EvidenceDirectory -Root $script:VpnWork}else{Join-Path $script:VpnWork 'evidence'}
  [void][IO.Directory]::CreateDirectory($script:VpnWork);[void][IO.Directory]::CreateDirectory($script:VpnEvidence)
  Assert-NativeOrdinaryPath $script:VpnWork;Assert-NativeOrdinaryPath $script:VpnEvidence
  $script:VpnReceiptPath=Join-Path $script:VpnEvidence 'vpn-native-receipt.json'
  $sourceHashes=@($frozenFiles | ForEach-Object {[ordered]@{file=$_;sha256=(Get-FileHash -LiteralPath (Join-Path $projectRoot $_) -Algorithm SHA256).Hash}})
  $script:VpnReceipt=[ordered]@{schemaVersion=1;kind='actual-hosted-production-background-vpn-native-acceptance';gate='Background VPN native TUN, recovery and elevated GUI OFF';sourceCommit=$script:VpnSourceCommit;candidateVersion=$manifest.version;
    startedAt=[DateTimeOffset]::UtcNow.ToString('o');status='running';nativeAcceptancePassed=$false;sourceHashes=$sourceHashes;gui=@();checks=[Collections.Generic.List[object]]::new();
    limitations=@('Controlled loopback SOCKS protocol fixture proves TUN/SOCKS integration, not external VPN-provider availability.','No native reboot or months-long pilot is asserted.','Emergency SCM cleanup is never accepted as a genuine UI OFF result.');cleanup=[ordered]@{}}
  $script:VpnGuiLease=$null;$script:VpnFixtureChild=$null;$script:VpnWatchdog=$null;$script:VpnAlarmPath=$null;$script:VpnPreviousClipboard=$null;$script:VpnClipboardChanged=$false;$script:VpnArmed=$false
  $savedTemporary=@{TEMP=$env:TEMP;TMP=$env:TMP};$env:TEMP=$script:VpnWork;$env:TMP=$script:VpnWork
  Save-VpnReceipt
  try{
    $payloadOutput=Join-Path $script:VpnWork 'installed-payload.json'
    $payloadOptions=Join-Path $script:VpnWork 'installed-payload.options.json'
    [IO.File]::WriteAllText($payloadOptions,([ordered]@{installRoot=$script:VpnInstallRoot;integrity=$script:VpnManifestPath;sourceCommit=$script:VpnSourceCommit;version=$manifest.version;output=$payloadOutput}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    [void](Invoke-VpnBounded -Executable $script:VpnNode -Arguments @((Join-Path $script:VpnTestsRoot 'windows-production-acceptance.mjs'),'verify-payload',$payloadOptions) -Label 'actual-installed-payload' -TimeoutSeconds 180)
    $payload=[IO.File]::ReadAllText($payloadOutput)|ConvertFrom-Json
    if(-not $payload.ok){throw 'Actual installed payload verification failed.'}
    $corePins=@($manifest.payload|Where-Object {$_.path -ceq 'resources/core-service/win-x64/EgoistShield.Service.exe'})
    if($corePins.Count -ne 1){throw 'Authenticated candidate payload lacks the exact Core pin.'};$script:VpnCoreHash=[string]$corePins[0].sha256
    Add-VpnEvidence 'actual-installed-source-bound-payload-and-protected-cli-inventory' ([ordered]@{receipt='installed-payload.json';integrityManifestSha256=(Get-FileHash -LiteralPath $script:VpnManifestPath -Algorithm SHA256).Hash;verifiedFiles=@($payload.verified).Count;fuses=$payload.fuses;asarHeaderSha256=$payload.asarHeaderSha256})
    $runtimeManifest=[IO.File]::ReadAllText((Join-Path $script:VpnInstallRoot 'resources\runtime\manifest.json'))|ConvertFrom-Json
    $component=@($runtimeManifest.components|Where-Object {$_.name -ceq 'sing-box'})
    $runtimePin=@($component.files|Where-Object {$_.path -ceq 'sing-box/sing-box.exe'})
    if($component.Count -ne 1 -or $component[0].version -cne 'v1.14.0' -or $runtimePin.Count -ne 1 -or [long]$runtimePin[0].size -ne 81819136 -or $runtimePin[0].sha256 -cne 'aad0ede010eafa7b277e520464f3a66fde820103d737eff739f40f3cc9451dcc' -or (Get-FileHash -LiteralPath $script:VpnRuntime -Algorithm SHA256).Hash -ine $runtimePin[0].sha256){throw 'The final actual installed sing-box inventory/binary pin does not match reviewed 1.14.0.'}
    $winswPins=@($runtimeManifest.components|Where-Object {$_.name -ceq 'zapret'}|ForEach-Object {$_.files}|Where-Object {$_.path -ceq 'zapret/service-wrapper/egoistshield-zapret-service.exe'})
    if($winswPins.Count -ne 1){throw 'Authenticated installed manifest lacks the fixed WinSW wrapper pin.'}
    $script:VpnWrapperHash=[string]$winswPins[0].sha256
    $wrapperSource=Join-Path $script:VpnInstallRoot 'resources\runtime\zapret\service-wrapper\egoistshield-zapret-service.exe'
    if((Get-FileHash -LiteralPath $wrapperSource -Algorithm SHA256).Hash -ine $script:VpnWrapperHash){throw 'Actual bundled WinSW does not match its authenticated inventory.'}
    Initialize-VpnNativeReaders
    Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
    . (Join-Path $script:VpnTestsRoot 'windows-ordinary-gui.ps1') -OrdinaryGuiLibraryOnly
    $script:VpnBaseline=Get-NativeNetworkFingerprint;$script:VpnBaselineRoutes=Get-VpnAllRoutes
    Add-VpnEvidence 'actual-network-before-vpn' ([ordered]@{fingerprint=$script:VpnBaseline;routes=$script:VpnBaselineRoutes;control=(Invoke-VpnControlCanary 'before-vpn')})
    $script:VpnProbe=Build-VpnProbe -WorkRoot $script:VpnWork
    Add-VpnEvidence 'frozen-harmless-plain-tcp-probe-build' $script:VpnProbe
    $script:VpnFixtureEvents=Join-Path $script:VpnWork 'socks-events.ndjson';$script:VpnFixtureStop=Join-Path $script:VpnWork 'socks-stop.txt';$fixtureReceipt=Join-Path $script:VpnWork 'socks-fixture.json'
    $script:VpnFixtureNonce=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
    $fixtureOptions=Join-Path $script:VpnWork 'socks-fixture.options.json'
    [IO.File]::WriteAllText($fixtureOptions,([ordered]@{workRoot=$script:VpnWork;receiptPath=$fixtureReceipt;eventsPath=$script:VpnFixtureEvents;stopPath=$script:VpnFixtureStop;stopNonce=$script:VpnFixtureNonce;leaseSeconds=900}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    $script:VpnFixtureChild=Start-VpnOwnedChild -Executable $script:VpnNode -Arguments @((Join-Path $script:VpnTestsRoot 'windows-vpn-production-acceptance.mjs'),'Fixture',$fixtureOptions) -Label 'nonce-socks-fixture'
    $script:VpnFixtureProof=Wait-VpnCondition -Label 'real own loopback SOCKS fixture' -TimeoutSeconds 15 -Condition {if(Test-Path -LiteralPath $fixtureReceipt){return [IO.File]::ReadAllText($fixtureReceipt)|ConvertFrom-Json}}
    $fixtureListener=@(Get-NetTCPConnection -LocalPort $script:VpnFixtureProof.port -State Listen -ErrorAction Stop)
    if($script:VpnFixtureProof.processId -ne $script:VpnFixtureChild.Process.Id -or $script:VpnFixtureProof.listenAddress -cne '127.0.0.1' -or $script:VpnFixtureProof.externalDial -or $fixtureListener.Count -ne 1 -or $fixtureListener[0].LocalAddress -cne '127.0.0.1' -or [int]$fixtureListener[0].OwningProcess -ne $script:VpnFixtureChild.Process.Id){throw 'The real loopback fixture listener has no owned-child socket proof.'}
    Add-VpnEvidence 'actual-synthetic-only-loopback-socks-fixture' $script:VpnFixtureProof
    $negativeNonce=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
    $negativeChild=Start-VpnOwnedChild -Executable $script:VpnProbe.executable -Arguments @('--probe',$negativeNonce,$script:VpnFixtureProof.instance,(Join-Path $script:VpnWork 'before-vpn-negative.json')) -Label 'before-vpn-negative-probe' -DotnetRoot $script:VpnProbe.dotnetRoot
    $negative=Stop-VpnOwnedChild $negativeChild -TimeoutSeconds 17 -AllowNonzero
    if($negative.exitCode -ne 1 -or -not $negative.stderr){throw 'The synthetic destination was reachable before the actual TUN, or the negative probe contract failed.'}
    $negativeProof=$negative.stderr|ConvertFrom-Json
    if($negativeProof.ok -or $negativeProof.nonce -cne $negativeNonce -or $negativeProof.targetAddress -cne '198.18.0.254'){throw 'The before-TUN negative probe lacks its real target/nonce identity.'}
    Add-VpnEvidence 'actual-before-tun-negative-plain-tcp-probe' $negativeProof
    Start-VpnElevatedGui -Operation 'Install'
    $nodeName='native-vpn-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT
    Configure-VpnThroughUi -FixturePort ([int]$script:VpnFixtureProof.port) -NodeName $nodeName
    $preflightOptions=Join-Path $script:VpnWork 'genuine-ui-preflight.options.json'
    [IO.File]::WriteAllText($preflightOptions,([ordered]@{sourceCommit=$script:VpnSourceCommit;stateFile=$script:VpnStateFile;resources=(Join-Path $script:VpnInstallRoot 'resources');workRoot=$script:VpnWork;fixturePort=[int]$script:VpnFixtureProof.port;nodeName=$nodeName}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    [void](Invoke-VpnBounded -Executable $script:VpnNode -Arguments @((Join-Path $script:VpnTestsRoot 'windows-vpn-production-acceptance.mjs'),'Preflight',$preflightOptions) -Label 'genuine-ui-config-preflight' -TimeoutSeconds 35)
    $preflight=[IO.File]::ReadAllText((Join-Path $script:VpnWork 'ui-config-preflight.receipt.json'))|ConvertFrom-Json
    if(-not $preflight.configCheckAccepted -or $preflight.nativeAcceptancePassed -or $preflight.actualTunRuns -ne 0){throw 'Generated own-file preflight is not genuine or has an invalid native claim.'}
    Add-VpnEvidence 'genuine-ui-read-only-fixed-config-native-check-before-enable' $preflight
    $script:VpnAlarmPath=Join-Path $script:VpnWork 'control-alarm.json';$script:VpnArmPath=Join-Path $script:VpnWork 'control-armed.txt';$script:VpnWatchdogStop=Join-Path $script:VpnWork 'control-stop.txt';$script:VpnControlLog=Join-Path $script:VpnWork 'control-samples.ndjson'
    Start-VpnControlWatchdog
    [void](Assert-VpnPhysicalNetwork -Baseline $script:VpnBaseline -Label 'pre-enable');[void](Invoke-VpnControlCanary 'pre-enable');Test-VpnWatchdog
    $switch=Find-VpnUiElement -Name 'VPN без приложения (TUN)'
    Invoke-VpnUiElement $switch 'request elevated GUI background VPN install'
    $confirmation=Find-VpnUiElement -Name 'Включить VPN без приложения' -DescendantName 'Установить и включить'
    # This arm grants only disposable emergency OFF for a previously absent,
    # fixed and pinned owned wrapper; it does not bypass the genuine GUI start.
    [IO.File]::WriteAllText($script:VpnArmPath,'armed-clean-owned-vpn',[Text.UTF8Encoding]::new($false));$script:VpnArmed=$true
    Invoke-VpnUiButton -Name 'Установить и включить' -Scope $confirmation
    $generation=Wait-VpnCondition -Label 'actual installed production SCM/SOCKS/TUN' -TimeoutSeconds 100 -Condition {Assert-VpnLiveGeneration}
    $tunStartedAt=[DateTimeOffset]::UtcNow
    $connection=[IO.File]::ReadAllText($script:VpnConnection)|ConvertFrom-Json
    if($connection.owner -cne 'EgoistShield' -or $connection.schemaVersion -ne 1 -or $connection.nodeId -cne $preflight.nodeId -or $connection.configSha256 -cne $preflight.configSha256 -or (Get-FileHash -LiteralPath $script:VpnConfig -Algorithm SHA256).Hash -ine $preflight.configSha256 -or [string]$connection.config -cne [IO.File]::ReadAllText($preflight.configFile)){throw 'Actual protected saved snapshot/config differs from the genuine UI preflight.'}
    Add-VpnEvidence 'actual-protected-immutable-snapshot-and-private-acl' ([ordered]@{configSha256=$connection.configSha256;nodeId=$connection.nodeId;servicePrivate=(Assert-VpnPrivateTree (Join-Path $script:VpnProductRoot 'Service\Vpn'));runtimePrivate=(Assert-VpnPrivateTree (Join-Path $script:VpnProductRoot 'Runtime\Vpn'))})
    Add-VpnEvidence 'actual-installed-automatic-localsystem-tun-generation' ([ordered]@{generation=$generation;recoveryPolicy=(Get-NativeRecoveryPolicy 'EgoistShieldVpn');activeRoutes=(Get-VpnAllRoutes)})
    Invoke-VpnNonceProbe -Generation $generation -Label 'gui-open-vpn-probe'
    [void](Assert-VpnPhysicalNetwork $script:VpnBaseline 'active TUN');Add-VpnEvidence 'actual-dns-https-control-with-active-tun' (Invoke-VpnControlCanary 'active-tun')
    Close-VpnElevatedGui
    $closedGeneration=Assert-VpnLiveGeneration
    if($closedGeneration.scm.process.processId -ne $generation.scm.process.processId -or $closedGeneration.runtime.processId -ne $generation.runtime.processId){throw 'The background service/runtime unexpectedly changed on normal GUI close.'}
    Invoke-VpnNonceProbe -Generation $closedGeneration -Label 'gui-closed-vpn-probe'
    $recovered=Stop-VpnVerifiedWrapperForRecovery -Generation $closedGeneration
    Assert-NativeNoGui
    Invoke-VpnNonceProbe -Generation $recovered -Label 'recovered-gui-closed-vpn-probe'
    Add-VpnEvidence 'actual-dns-https-control-after-native-recovery' (Invoke-VpnControlCanary 'after-recovery')
    Start-VpnElevatedGui -Operation 'OffAndRemove'
    Invoke-VpnNavigation 'VPN'
    Invoke-VpnUiElement (Find-VpnUiElement -Name 'VPN без приложения (TUN)') 'normal elevated GUI background VPN OFF'
    $stopped=Wait-VpnCondition -Label 'actual normal production OFF Stopped Disabled no endpoints/interfaces' -TimeoutSeconds 75 -Condition {Assert-VpnStopped}
    $tunStoppedAt=[DateTimeOffset]::UtcNow
    Add-VpnEvidence 'actual-normal-gui-off-disabled-intent-no-endpoint-tun-runtime' $stopped
    $after=Get-NativeNetworkFingerprint;$afterRoutes=Get-VpnAllRoutes
    if(($after|ConvertTo-Json -Depth 10 -Compress) -cne ($script:VpnBaseline|ConvertTo-Json -Depth 10 -Compress) -or ($afterRoutes|ConvertTo-Json -Depth 10 -Compress) -cne ($script:VpnBaselineRoutes|ConvertTo-Json -Depth 10 -Compress)){throw 'Actual network DNS/default/all routes/proxy/IPv6 did not restore after normal VPN OFF.'}
    Add-VpnEvidence 'actual-complete-network-restored-after-ui-off' ([ordered]@{fingerprint=$after;routes=$afterRoutes;control=(Invoke-VpnControlCanary 'after-off')})
    Invoke-VpnUiButton 'Удалить службу VPN'
    $removeDialog=Find-VpnUiElement -Name 'Удалить службу VPN' -DescendantName 'Удалить'
    Invoke-VpnUiButton -Name 'Удалить' -Scope $removeDialog
    [void](Wait-VpnCondition -Label 'actual normal GUI VPN removal' -TimeoutSeconds 60 -Condition {
      if(@(Get-NativeProductServices|Where-Object {$_.Name -ceq 'EgoistShieldVpn'}).Count -or (Test-Path -LiteralPath $script:VpnConnection)){return $null};Assert-VpnNoRuntime
      $status=Get-VpnReadOnlyStatus;if($status.serviceInstalled -or $status.running -or $status.backgroundEnabled -or $status.serviceState -ne 'not-installed'){return $null};return $status
    })
    Add-VpnEvidence 'actual-normal-gui-remove-scm-snapshot-absent' ([ordered]@{serviceAbsent=$true;protectedSnapshotAbsent=$true;ownedTunRuntimeListenerAbsent=$true})
    Close-VpnElevatedGui
    $others=@(Get-NativeProductServices|Where-Object {$_.Name -cne 'EgoistShieldVpn'}|Select-Object Name,State,StartMode,StartName,PathName)
    if(($others|ConvertTo-Json -Depth 8 -Compress) -cne ($existingOthers|ConvertTo-Json -Depth 8 -Compress)){throw 'The native VPN gate changed another baseline product service state/start/path/account.'}
    Test-VpnWatchdog
    [void](Wait-VpnCondition -Label 'independent real control sample after actual UI OFF' -TimeoutSeconds 25 -Condition {
      $lastLine=Get-Content -LiteralPath $script:VpnControlLog -Tail 1
      if($lastLine){$latest=$lastLine|ConvertFrom-Json;if([DateTimeOffset]::Parse($latest.canary.at) -gt $tunStoppedAt){return $latest}}
    })
    $samples=@(Get-Content -LiteralPath $script:VpnControlLog | Where-Object {$_} | ForEach-Object {$_|ConvertFrom-Json})
    $activeSamples=@($samples|Where-Object {[DateTimeOffset]::Parse($_.canary.at) -ge $tunStartedAt -and [DateTimeOffset]::Parse($_.canary.at) -le $tunStoppedAt})
    if($samples.Count -lt 3 -or $activeSamples.Count -lt 1){throw 'Independent throughout actual active-TUN DNS/HTTPS/control observation is insufficient.'}
    Add-VpnEvidence 'independent-throughout-actual-control-and-physical-dns-preserved' ([ordered]@{samples=$samples.Count;activeTunSamples=$activeSamples.Count;tunObservedFrom=$tunStartedAt.ToString('o');tunObservedStoppedAt=$tunStoppedAt.ToString('o');first=$samples[0].canary.at;last=$samples[-1].canary.at;log='control-samples.ndjson';sha256=(Get-FileHash -LiteralPath $script:VpnControlLog -Algorithm SHA256).Hash})
    $script:VpnReceipt.nativeAcceptancePassed=$true;$script:VpnReceipt.status='passed'
  }catch{
    $script:VpnReceipt.status='failed';$script:VpnReceipt.nativeAcceptancePassed=$false;$script:VpnReceipt.error=$_.Exception.Message
    throw
  }finally{
    $cleanupErrors=[Collections.Generic.List[string]]::new()
    if($script:VpnGuiLease){try{$script:VpnReceipt.cleanup.guiGuardian=Stop-ElevatedGuiLease $script:VpnGuiLease;$script:VpnGuiLease=$null}catch{$cleanupErrors.Add($_.Exception.Message)}}
    if($script:VpnArmed -and -not $script:VpnReceipt.nativeAcceptancePassed){try{$script:VpnReceipt.cleanup.emergency=Invoke-VpnEmergencyStop -SourceCommit $script:VpnSourceCommit -WrapperHash $script:VpnWrapperHash -CoreHash $script:VpnCoreHash -WorkRoot $script:VpnWork}catch{$cleanupErrors.Add($_.Exception.Message)}}
    if($script:VpnWatchdog){
      try{[IO.File]::WriteAllText($script:VpnWatchdogStop,'stop',[Text.UTF8Encoding]::new($false));[void](Wait-Job $script:VpnWatchdog -Timeout 30);if($script:VpnWatchdog.State -eq 'Running'){Stop-Job $script:VpnWatchdog;throw 'Independent control watchdog did not acknowledge its normal stop.'};$jobErrors=@();Receive-Job $script:VpnWatchdog -ErrorAction SilentlyContinue -ErrorVariable jobErrors | Out-Null;if($jobErrors.Count){$cleanupErrors.Add('Independent control watchdog reported failure.')};Remove-Job $script:VpnWatchdog}catch{$cleanupErrors.Add($_.Exception.Message)}
    }
    if($script:VpnFixtureChild){try{[IO.File]::WriteAllText($script:VpnFixtureStop,('stop:'+ $script:VpnFixtureNonce),[Text.UTF8Encoding]::new($false));$script:VpnReceipt.cleanup.fixture=Stop-VpnOwnedChild $script:VpnFixtureChild -TimeoutSeconds 15;$script:VpnFixtureChild=$null}catch{$cleanupErrors.Add($_.Exception.Message)}}
    if($script:VpnClipboardChanged){try{if($null -ne $script:VpnPreviousClipboard){Set-Clipboard -Value $script:VpnPreviousClipboard}else{Set-Clipboard -Value ''}}catch{$cleanupErrors.Add('Owned hosted clipboard cleanup failed.')}}
    $script:VpnReceipt.cleanup.errors=$cleanupErrors.ToArray()
    if($cleanupErrors.Count){$script:VpnReceipt.nativeAcceptancePassed=$false;$script:VpnReceipt.status='failed';$script:VpnReceipt.cleanupFailed=$true}
    $script:VpnReceipt.finishedAt=[DateTimeOffset]::UtcNow.ToString('o');Save-VpnReceipt
    foreach($name in $savedTemporary.Keys){[Environment]::SetEnvironmentVariable($name,$savedTemporary[$name],'Process')}
  }
  if(-not $script:VpnReceipt.nativeAcceptancePassed){throw 'VPN native acceptance did not pass with verified cleanup.'}
  Write-Output ('Actual hosted production VPN native acceptance passed: '+ $script:VpnReceiptPath)
}

if($LibraryOnly){return}
Invoke-VpnNativeAcceptance
