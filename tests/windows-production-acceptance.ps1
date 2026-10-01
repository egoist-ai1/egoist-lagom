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

function Get-NativeAcceptanceEnvironmentErrors {
  param([hashtable]$Environment,[bool]$Administrator,[bool]$Windows)
  $errors=[Collections.Generic.List[string]]::new()
  $required=@{GITHUB_ACTIONS='true';CI='true';RUNNER_ENVIRONMENT='github-hosted';RUNNER_OS='Windows';GITHUB_REPOSITORY='egoist-ai1/egoist-lagom'}
  foreach($name in $required.Keys){if([string]$Environment[$name] -cne $required[$name]){$errors.Add($name)}}
  foreach($name in @('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT')){if([string]$Environment[$name] -cnotmatch '^[1-9][0-9]*$'){$errors.Add($name)}}
  if([string]$Environment.GITHUB_SHA -cnotmatch '^[a-f0-9]{40}$'){$errors.Add('GITHUB_SHA')}
  if(-not $Windows){$errors.Add('Windows')};if(-not $Administrator){$errors.Add('ElevatedAdministrator')}
  return $errors.ToArray()
}
function Assert-NativeOrdinaryPath {
  param([string]$Path,[switch]$Leaf)
  $current=[IO.Path]::GetFullPath($Path);$first=$true
  while($current){
    $item=Get-Item -LiteralPath $current -Force -ErrorAction Stop
    if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "Reparse path refused: $current"}
    if($first -and ($Leaf -and $item.PSIsContainer -or -not $Leaf -and -not $item.PSIsContainer)){throw "Native path type mismatch: $current"}
    $parent=[IO.Path]::GetDirectoryName($current.TrimEnd('\'))
    if(-not $parent -or $parent -eq $current){break};$current=$parent;$first=$false
  }
}
function Assert-NativePathWithin {
  param([string]$Path,[string]$Root)
  if(-not [IO.Path]::IsPathRooted($Path) -or -not [IO.Path]::IsPathRooted($Root)){throw 'Native acceptance requires absolute paths.'}
  $full=[IO.Path]::GetFullPath($Path).TrimEnd('\');$container=[IO.Path]::GetFullPath($Root).TrimEnd('\')
  if(-not $full.StartsWith($container+'\',[StringComparison]::OrdinalIgnoreCase)){throw "Native acceptance path escaped its scope: $full"}
  return $full
}
function Resolve-NativeApplication {
  param([string]$Name)
  $command=Get-Command -Name $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1
  $executable=[string]$command.Source
  if(-not [IO.Path]::IsPathRooted($executable)){throw "Native application did not resolve to one absolute path: $Name"}
  Assert-NativeOrdinaryPath -Path $executable -Leaf
  return $executable
}
function Assert-NativeAdministratorOwned {
  param([string]$Path)
  Assert-NativeOrdinaryPath -Path $Path -Leaf:([IO.File]::Exists($Path))
  $acl=Get-Acl -LiteralPath $Path;$trusted=@('S-1-5-18','S-1-5-32-544')
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted){throw "Untrusted installation owner: $Path"}
  $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if(($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0){continue}
    if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -notin $trusted -and ($rule.FileSystemRights -band $write) -ne 0){throw "Untrusted write/delete ACE: $Path"}
  }
  return [ordered]@{path=$Path;owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;sddl=$acl.Sddl}
}
function Get-NativeNetworkFingerprint {
  $dns=@(Get-DnsClientServerAddress | Sort-Object InterfaceIndex,AddressFamily | ForEach-Object {[ordered]@{index=$_.InterfaceIndex;family=[int]$_.AddressFamily;servers=@($_.ServerAddresses)}})
  $routes=@(Get-NetRoute -PolicyStore ActiveStore | Where-Object {$_.DestinationPrefix -in @('0.0.0.0/0','::/0')} | Sort-Object InterfaceIndex,DestinationPrefix,NextHop | ForEach-Object {[ordered]@{index=$_.InterfaceIndex;prefix=$_.DestinationPrefix;nextHop=$_.NextHop;metric=$_.RouteMetric;protocol=[string]$_.Protocol}})
  $bindings=@(Get-NetAdapterBinding -ComponentID ms_tcpip6 | Sort-Object Name | Select-Object Name,Enabled)
  $proxy=[ordered]@{};$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Internet Settings')
  try{foreach($name in @('ProxyEnable','ProxyServer','ProxyOverride','AutoConfigURL')){$proxy[$name]=if($key){$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}else{$null}}}finally{if($key){$key.Dispose()}}
  $winHttp=[ordered]@{};$key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings\Connections')
  try{foreach($name in @('WinHttpSettings','DefaultConnectionSettings')){$bytes=if($key){$key.GetValue($name,$null)}else{$null};$winHttp[$name]=if($bytes -is [byte[]]){[Convert]::ToBase64String($bytes)}else{$bytes}}}finally{if($key){$key.Dispose()}}
  return [ordered]@{dns=$dns;defaultRoutes=$routes;ipv6Bindings=$bindings;userProxy=$proxy;winHttp=$winHttp}
}
function Get-NativeCimSnapshot {
  param([ValidateSet('Win32_Service','Win32_Process')][string]$ClassName,[string]$Filter='')
  for($attempt=1;$attempt -le 2;$attempt++){
    try{
      $query=@{ClassName=$ClassName;OperationTimeoutSec=30;ErrorAction='Stop'}
      if($Filter){$query.Filter=$Filter}
      return @(Get-CimInstance @query)
    }catch{
      if($attempt -eq 2){throw}
      Start-Sleep -Milliseconds 250
    }
  }
}
function Get-NativeProductServices {
  $filter="Name LIKE 'EgoistShield%' OR Name LIKE 'EgoistLagom%' OR Name='zapret' OR Name='SystemDoH' OR Name='TGWSProxy' OR Name='TelegramProxy'"
  return @(Get-NativeCimSnapshot Win32_Service -Filter $filter | Sort-Object Name | Select-Object Name,State,StartMode,StartName,PathName,ProcessId)
}
function Get-NativeProductTasks {
  return @(Get-ScheduledTask | Where-Object {$_.TaskName -match '(?i)Egoist(?:Shield|Lagom)'} | Sort-Object TaskPath,TaskName | Select-Object TaskName,TaskPath,State)
}
function Copy-NativeInstallerDiagnostics {
  $captured=@()
  $inputs=@(
    @{source=(Join-Path $script:DataRoot 'installer\upgrade-journal.json');name='installer-upgrade-journal.jsonl';maximum=1048576},
    @{source=(Join-Path $script:DataRoot 'Service\service.log');name='core-service.log';maximum=6291456},
    @{source=(Join-Path $script:DataRoot 'Service\service.log.1');name='core-service.previous.log';maximum=6291456}
  )
  foreach($entry in $inputs){
    $record=[ordered]@{name=$entry.name;status='missing'}
    try{
      [void](Assert-NativePathWithin $entry.source $script:DataRoot)
      if(Test-Path -LiteralPath $entry.source -PathType Leaf){
        Assert-NativeOrdinaryPath -Path $entry.source -Leaf
        $bytes=(Get-Item -LiteralPath $entry.source).Length
        if($bytes -gt $entry.maximum){throw 'Diagnostic file exceeded its explicit bound; original retained.'}
        $destination=Join-Path $script:Work $entry.name
        [void](Assert-NativePathWithin $destination $script:Work)
        Copy-Item -LiteralPath $entry.source -Destination $destination -ErrorAction Stop
        $record.status='captured';$record.bytes=(Get-Item -LiteralPath $destination).Length;$record.sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
      }
    }catch{$record.status='refused-or-unavailable';$record.error=$_.Exception.Message}
    $captured+=$record
  }
  return $captured
}
function Get-NativeProcessIdentity {
  param([int]$ProcessId)
  $row=Get-NativeCimSnapshot Win32_Process -Filter "ProcessId = $ProcessId"
  if(-not $row -or -not $row.CreationDate -or -not $row.ExecutablePath){throw "Unreadable native process identity: $ProcessId"}
  return [ordered]@{processId=[int]$row.ProcessId;parentProcessId=[int]$row.ParentProcessId;executable=[string]$row.ExecutablePath;createdUtc=([DateTimeOffset]$row.CreationDate).ToUniversalTime().ToString('o')}
}
function Assert-NativeService {
  param([string]$Name,[string]$Executable,[switch]$Running)
  $services=@(Get-NativeProductServices | Where-Object {$_.Name -eq $Name})
  if($services.Count -ne 1){throw "Actual SCM service missing or ambiguous: $Name"};$service=$services[0]
  if($service.PathName.Trim().Trim('"') -ine $Executable -or $service.StartMode -ne 'Auto' -or $service.StartName -notin @('LocalSystem','NT AUTHORITY\SYSTEM')){throw "SCM path/start/account contract failed: $Name"}
  if($Running -and ($service.State -ne 'Running' -or [int]$service.ProcessId -le 0)){throw "SCM readiness failed: $Name"}
  $identity=if($Running){Get-NativeProcessIdentity ([int]$service.ProcessId)}else{$null}
  if($identity -and $identity.executable -ine $Executable){throw "SCM live process path mismatch: $Name"}
  return [ordered]@{scm=$service;process=$identity}
}
function Get-NativeRecoveryPolicy {
  param([string]$Name)
  $key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Services\'+$Name)
  if(-not $key){throw "Missing SCM recovery policy: $Name"}
  try{
    [byte[]]$bytes=$key.GetValue('FailureActions',$null)
    if(-not $bytes -or $bytes.Length -lt 44){throw "Truncated SCM recovery policy: $Name"}
    $count=[BitConverter]::ToUInt32($bytes,12);$offset=[BitConverter]::ToUInt32($bytes,16)
    if($count -lt 3 -or $count -gt 8 -or $offset -lt 20 -or $offset+$count*8 -gt $bytes.Length){throw "Invalid recovery layout: $Name"}
    $actions=@();for($i=0;$i -lt $count;$i++){$actions+=[ordered]@{type=[BitConverter]::ToUInt32($bytes,[int]($offset+$i*8));delayMs=[BitConverter]::ToUInt32($bytes,[int]($offset+$i*8+4))}}
    $policy=[ordered]@{start=[int]$key.GetValue('Start',-1);resetSeconds=[BitConverter]::ToUInt32($bytes,0);nonCrash=[int]$key.GetValue('FailureActionsOnNonCrashFailures',0);actions=$actions}
    if($policy.start -ne 2 -or $policy.resetSeconds -lt 3600 -or $policy.nonCrash -ne 1 -or @($actions | Where-Object {$_.type -ne 1 -or $_.delayMs -le 0 -or $_.delayMs -gt 60000}).Count -ne 0){throw "Automatic restart-only policy failed: $Name"}
    return $policy
  }finally{$key.Dispose()}
}
function Save-NativeReceipt {$script:Receipt | ConvertTo-Json -Depth 28 | Set-Content -LiteralPath $script:ReceiptPath -Encoding utf8}
function Add-NativeMutation {
  param([string]$Kind,[string]$Target,[string]$Purpose)
  $script:Receipt.mutations+=[ordered]@{atUtc=[DateTimeOffset]::UtcNow.ToString('o');kind=$Kind;target=$Target;purpose=$Purpose};Save-NativeReceipt
}
function Invoke-NativeBounded {
  param([string]$Executable,[string[]]$Arguments,[string]$Label,[int]$TimeoutSeconds=300)
  Assert-NativeOrdinaryPath -Path $Executable -Leaf
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Executable;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  foreach($argument in $Arguments){$info.ArgumentList.Add([string]$argument)}
  $child=[Diagnostics.Process]::new();$child.StartInfo=$info;$watch=[Diagnostics.Stopwatch]::StartNew()
  try{
    if(-not $child.Start()){throw "Native child failed to start: $Label"}
    $stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
    if(-not $child.WaitForExit($TimeoutSeconds*1000)){
      $killError=$null
      try{if(-not $child.HasExited){$child.Kill()}}catch{$killError=$_.Exception.Message}
      $exited=$child.WaitForExit(5000)
      $drainError=$null
      try{[void]([Threading.Tasks.Task]::WhenAll([Threading.Tasks.Task[]]@($stdout,$stderr)).Wait(2000))}catch{$drainError=$_.Exception.Message}
      $out=if($stdout.Status -eq [Threading.Tasks.TaskStatus]::RanToCompletion){$stdout.GetAwaiter().GetResult()}else{''}
      $err=if($stderr.Status -eq [Threading.Tasks.TaskStatus]::RanToCompletion){$stderr.GetAwaiter().GetResult()}else{''}
      [IO.File]::WriteAllText((Join-Path $script:Work ($Label+'.stdout.txt')),$out.Substring(0,[Math]::Min($out.Length,1048576)),[Text.UTF8Encoding]::new($false))
      [IO.File]::WriteAllText((Join-Path $script:Work ($Label+'.stderr.txt')),$err.Substring(0,[Math]::Min($err.Length,1048576)),[Text.UTF8Encoding]::new($false))
      [ordered]@{result='failed-timeout';processId=$child.Id;executable=$Executable;timeoutSeconds=$TimeoutSeconds;elapsedMilliseconds=[Math]::Round($watch.Elapsed.TotalMilliseconds,2);exitObserved=$exited;stdoutComplete=($stdout.Status -eq [Threading.Tasks.TaskStatus]::RanToCompletion);stderrComplete=($stderr.Status -eq [Threading.Tasks.TaskStatus]::RanToCompletion);stdoutTruncated=($out.Length -gt 1048576);stderrTruncated=($err.Length -gt 1048576);killError=$killError;drainError=$drainError} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $script:Work ($Label+'.timeout.json')) -Encoding utf8
      throw "Native child exceeded ${TimeoutSeconds}s: $Label; bounded timeout evidence retained."
    }
    $out=$stdout.GetAwaiter().GetResult();$err=$stderr.GetAwaiter().GetResult()
    [IO.File]::WriteAllText((Join-Path $script:Work ($Label+'.stdout.txt')),$out,[Text.UTF8Encoding]::new($false));[IO.File]::WriteAllText((Join-Path $script:Work ($Label+'.stderr.txt')),$err,[Text.UTF8Encoding]::new($false))
    if($out.Length -gt 1048576 -or $err.Length -gt 1048576){throw "Native output limit exceeded: $Label"}
    if($child.ExitCode -ne 0){throw "Native child failed ($($child.ExitCode)): $Label; see owned stdout/stderr."}
    return [ordered]@{exitCode=$child.ExitCode;elapsedMilliseconds=[Math]::Round($watch.Elapsed.TotalMilliseconds,2);stdout=$out}
  }finally{$child.Dispose()}
}
function Wait-NativeCondition {
  param([scriptblock]$Condition,[string]$Label,[int]$TimeoutSeconds=90)
  $watch=[Diagnostics.Stopwatch]::StartNew();$lastError=''
  do{try{$value=& $Condition;if($value){return $value}}catch{$lastError=$_.Exception.Message};Start-Sleep -Milliseconds 250}while($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds)
  throw "Actual native observation timed out: $Label ($lastError)"
}
function Assert-NativeNetworkPreserved {
  param([string]$Label)
  $current=Get-NativeNetworkFingerprint;$before=$script:Receipt.beforeNetwork | ConvertTo-Json -Depth 12 -Compress;$after=$current | ConvertTo-Json -Depth 12 -Compress
  $script:Receipt.networkReadbacks+=[ordered]@{phase=$Label;preserved=($before -ceq $after);snapshot=$current};Save-NativeReceipt
  if($before -cne $after){throw "Runner DNS/default route/IPv6/proxy preservation failed: $Label"}
}
function Assert-NativeNoGui {if(@(Get-NativeCimSnapshot Win32_Process -Filter "Name = 'EgoistShield.exe'").Count -ne 0){throw 'GUI remains after the actual close/quit control.'}}

function Get-NativePeResource {
  param([string]$Executable,[switch]$Integrity)
  if(-not ('LagomAcceptanceResources' -as [type])){
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LagomAcceptanceResources {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr LoadLibraryEx(string path,IntPtr file,uint flags);
  [DllImport("kernel32.dll",EntryPoint="FindResourceW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr FindId(IntPtr module,IntPtr name,IntPtr type);
  [DllImport("kernel32.dll",EntryPoint="FindResourceW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr FindText(IntPtr module,string name,string type);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern uint SizeofResource(IntPtr module,IntPtr resource);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr LoadResource(IntPtr module,IntPtr resource);
  [DllImport("kernel32.dll")] public static extern IntPtr LockResource(IntPtr resource);
  [DllImport("kernel32.dll")] public static extern bool FreeLibrary(IntPtr module);
}
'@
  }
  # DATAFILE | IMAGE_RESOURCE maps the reviewed PE without running entry points.
  $module=[LagomAcceptanceResources]::LoadLibraryEx($Executable,[IntPtr]::Zero,0x22)
  if($module -eq [IntPtr]::Zero){throw 'Native PE resource map failed.'}
  try{
    $resource=if($Integrity){[LagomAcceptanceResources]::FindText($module,'ELECTRONASAR','INTEGRITY')}else{[LagomAcceptanceResources]::FindId($module,[IntPtr]1,[IntPtr]24)}
    if($resource -eq [IntPtr]::Zero){throw 'Actual PE manifest/integrity resource is missing.'}
    $size=[LagomAcceptanceResources]::SizeofResource($module,$resource)
    if($size -eq 0 -or $size -gt 65536){throw 'Invalid native PE resource size.'}
    $data=[LagomAcceptanceResources]::LockResource([LagomAcceptanceResources]::LoadResource($module,$resource))
    if($data -eq [IntPtr]::Zero){throw 'Native resource data is unreadable.'}
    $bytes=[byte[]]::new($size);[Runtime.InteropServices.Marshal]::Copy($data,$bytes,0,$bytes.Length)
    return [Text.Encoding]::UTF8.GetString($bytes).Trim([char]0,[char]0xFEFF)
  }finally{[void][LagomAcceptanceResources]::FreeLibrary($module)}
}
function Assert-NativeGuiElevation {
  param([switch]$MigrationExpected)
  $gui=Join-Path $script:InstallRoot 'EgoistShield.exe';$worker=Join-Path $script:InstallRoot 'EgoistShield.Worker.exe'
  foreach($executable in @($gui,$worker)){
    [xml]$manifest=Get-NativePeResource -Executable $executable
    $level=$manifest.SelectSingleNode("//*[local-name()='requestedExecutionLevel']")
    if(-not $level -or $level.GetAttribute('level') -cne 'asInvoker'){throw 'Installed GUI/Worker PE does not request asInvoker.'}
    $integrity=Get-NativePeResource -Executable $executable -Integrity | ConvertFrom-Json
    $payload=Get-Content -LiteralPath (Join-Path $script:Work 'installed-payload.json') -Raw | ConvertFrom-Json
    if(@($integrity | Where-Object {$_.file -eq 'resources\\app.asar' -or $_.file -eq 'resources\app.asar'}).Count -eq 0){throw 'PE ASAR integrity does not identify the installed app.asar.'}
    foreach($entry in @($integrity)){if($entry.file -match 'app\.asar$' -and ([string]$entry.alg -cne 'sha256' -or [string]$entry.value -cne [string]$payload.asarHeaderSha256)){throw 'Actual PE embedded ASAR header hash differs from installed archive.'}}
  }
  $values=@()
  foreach($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryHive]::CurrentUser)){
    foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)){
      $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view);$key=$base.OpenSubKey('Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers')
      try{
        $value=if($key){[string]$key.GetValue($gui,'',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}else{''}
        if($value -match '(?i)(?:^|\s)RUNASADMIN(?:\s|$)'){throw 'The canonical GUI retains a forced RUNASADMIN layer.'}
        if($MigrationExpected -and $hive -eq [Microsoft.Win32.RegistryHive]::CurrentUser -and $view -eq [Microsoft.Win32.RegistryView]::Registry64 -and $value -notmatch '(?:^|\s)HIGHDPIAWARE(?:\s|$)'){throw 'Upgrade discarded the unrelated HIGHDPIAWARE layer token.'}
        $values+=[ordered]@{hive=[string]$hive;view=[string]$view;value=$value}
      }finally{if($key){$key.Dispose()};$base.Dispose()}
    }
  }
  $link=Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Egoist Lagom.lnk'
  Assert-NativeOrdinaryPath -Path $link -Leaf
  $bytes=[IO.File]::ReadAllBytes($link)
  if($bytes.Length -lt 76 -or [BitConverter]::ToUInt32($bytes,0) -ne 76 -or ([BitConverter]::ToUInt32($bytes,20) -band 0x2000) -ne 0){throw 'Installed Start Menu shortcut retains RunAsUser or has an invalid shell-link header.'}
  return [ordered]@{guiManifest='asInvoker';workerManifest='asInvoker';layers=$values;shortcut=$link;shortcutRunAsUser=$false;embeddedAsarIntegrityVerified=$true}
}
function Set-NativeOwnedLegacyLayer {
  $gui=Join-Path $script:InstallRoot 'EgoistShield.exe'
  [void](Assert-NativeAdministratorOwned $gui)
  Add-NativeMutation -Kind 'owned-hkcu-compatibility-fixture' -Target $gui -Purpose 'Preserve HIGHDPIAWARE while migrating the old forced RUNASADMIN token.'
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64)
  $key=$base.CreateSubKey('Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers')
  try{$key.SetValue($gui,'~ HIGHDPIAWARE RUNASADMIN',[Microsoft.Win32.RegistryValueKind]::String)}finally{$key.Dispose();$base.Dispose()}
}
function Get-NativeTelegramNavigation {
  param([scriptblock]$FindButton,[string]$Label)
  $control=Wait-NativeCondition -Condition {
    $navigation=& $FindButton 'Telegram'
    if($navigation){return [pscustomobject]@{navigation=$navigation;expand=$null}}
    $settings=& $FindButton 'Настройки'
    if($settings){return [pscustomobject]@{navigation=$null;expand=$settings}}
  } -Label ($Label+' actual initial widget or dashboard control') -TimeoutSeconds 90
  if($control.navigation){return $control.navigation}
  ([Windows.Automation.InvokePattern]$control.expand.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
  return Wait-NativeCondition -Condition {& $FindButton 'Telegram'} -Label ($Label+' actual Telegram navigation after opening dashboard') -TimeoutSeconds 60
}

function Invoke-NativeGui {
  param([ValidateSet('provision-telegram','check-telegram')][string]$Action,[string]$Label)
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  $gui=Join-Path $script:InstallRoot 'EgoistShield.exe'
  [void](Assert-NativeAdministratorOwned $gui)
  Add-NativeMutation -Kind 'canonical-gui-native-uia' -Target $gui -Purpose $Action
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$gui;$info.WorkingDirectory=$script:InstallRoot;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
  foreach($name in @($info.Environment.Keys)){if($name -match '^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH|LAGOM_TEST_USER_DATA_DIR|SHIELD_.*|EGOIST_.*)$'){[void]$info.Environment.Remove($name)}}
  $info.Environment['NODE_ENV']='production'
  # No remote debugger, renderer-accessibility flag, development path or special
  # Core authority is added. InvokePattern operates the actual shipped buttons.
  $child=[Diagnostics.Process]::new();$child.StartInfo=$info;$closed=$false
  try{
    if(-not $child.Start()){throw 'Canonical GUI did not start.'}
    $hwnd=Wait-NativeCondition -Condition {$child.Refresh();if($child.HasExited){throw 'Canonical GUI exited before exposing a window.'};if($child.MainWindowHandle -ne [IntPtr]::Zero){return $child.MainWindowHandle}} -Label 'Canonical GUI native window' -TimeoutSeconds 90
    if($child.MainModule.FileName -ine $gui){throw 'Actual GUI executable identity changed.'}
    $root=[Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if(-not $root -or $root.Current.ProcessId -ne $child.Id){throw 'Native UIA root does not belong to the exact launched GUI.'}
    $buttonType=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)
    $findButton={param([string]$Name)
      $nameCondition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$Name)
      $condition=[Windows.Automation.AndCondition]::new($buttonType,$nameCondition)
      $buttons=$root.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)
      if($buttons.Count -eq 1 -and $buttons[0].Current.IsEnabled){return $buttons[0]}
    }
    $nav=Get-NativeTelegramNavigation -FindButton $findButton -Label 'Canonical GUI'
    ([Windows.Automation.InvokePattern]$nav.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    $wrapper=Join-Path $script:DataRoot 'Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe'
    if($Action -eq 'provision-telegram'){
      $installButton=Wait-NativeCondition -Condition {& $findButton 'Установить фоновую службу'} -Label 'Actual Telegram install control' -TimeoutSeconds 60
      ([Windows.Automation.InvokePattern]$installButton.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
      [void](Wait-NativeCondition -Condition {Assert-NativeService -Name 'EgoistShieldTelegramProxy' -Executable $wrapper -Running} -Label 'Telegram installed through genuine GUI control' -TimeoutSeconds 240)
    }else{[void](Assert-NativeService -Name 'EgoistShieldTelegramProxy' -Executable $wrapper -Running)}
    $config=Get-Content -LiteralPath (Join-Path $script:DataRoot 'Runtime\TelegramProxy\config.json') -Raw | ConvertFrom-Json
    $port=[int]$config.port
    [void](Assert-NativeTelegramEndpoint -Port $port)
    $core=Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:Core -Running
    $workers=@(Get-NativeCimSnapshot Win32_Process -Filter "Name = 'EgoistShield.Worker.exe'" | Where-Object {$_.ExecutablePath -ieq (Join-Path $script:InstallRoot 'EgoistShield.Worker.exe') -and [int]$_.ParentProcessId -eq [int]$core.scm.ProcessId})
    if($workers.Count -ne 1){throw 'Genuine GUI IPC did not leave one exact protected Core worker.'}
    $owner=Invoke-CimMethod -InputObject $workers[0] -MethodName GetOwnerSid
    if($owner.ReturnValue -ne 0 -or $owner.Sid -ne 'S-1-5-18'){throw 'Actual protected component worker is not LocalSystem.'}
    $pattern=$null
    if(-not $root.TryGetCurrentPattern([Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)){throw 'Actual GUI does not expose the native window close pattern.'}
    ([Windows.Automation.WindowPattern]$pattern).Close()
    if(-not $child.WaitForExit(30000) -or $child.ExitCode -ne 0){throw 'GUI did not exit normally through the native close control.'};$closed=$true
    $result=[ordered]@{ok=$true;mode=$Action;mainProcessId=$child.Id;arguments=@();automation='native UIAutomation InvokePattern and WindowPattern';productionOverride=$false;coreWorker=Get-NativeProcessIdentity ([int]$workers[0].ProcessId);workerOwnerSid=$owner.Sid;installResult=[ordered]@{serviceInstalled=$true;serviceRunning=$true;running=$true;portConflict=[ordered]@{port=$port;host=[string]$config.host}};exitCode=$child.ExitCode}
    $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $script:Work ($Label+'.json')) -Encoding utf8
    $script:Receipt.gui+=$result;Save-NativeReceipt;return $result
  }finally{
    if(-not $closed -and -not $child.HasExited){
      # Only the handle created in this function is canceled on test failure.
      # SCM processes and other GUIs are never selected for this cleanup.
      $child.Kill();[void]$child.WaitForExit(5000)
    };$child.Dispose()
  }
}
function Invoke-NativeOrdinaryGui {
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  . (Join-Path $PSScriptRoot 'windows-ordinary-gui.ps1') -OrdinaryGuiLibraryOnly
  $gui=Join-Path $script:InstallRoot 'EgoistShield.exe'
  $ordinaryEvidence=Join-Path $script:Work 'ordinary-evidence'
  [void][IO.Directory]::CreateDirectory($ordinaryEvidence)
  Add-NativeMutation -Kind 'ordinary-medium-gui-native-uia' -Target $gui -Purpose 'Actual nonadministrator GUI stops and starts the installed Telegram service through the shipped Core broker.'
  $lease=$null;$child=$null;$closed=$false;$operationError=$null;$cleanup=$null
  try{
    $lease=Start-OrdinaryGuiLease -CanonicalInstalledGuiPath $gui -IntegrityManifestPath $script:ManifestPath -ExpectedSourceCommit $script:SourceCommit -WorkRoot $script:Work -EvidenceDirectory $ordinaryEvidence
    $proof=$lease.Receipt
    if($proof.executable -ine $gui -or @($proof.arguments).Count -ne 0 -or $proof.source.commit -cne $script:SourceCommit){throw 'Ordinary GUI launch/source identity mismatch.'}
    $child=[Diagnostics.Process]::GetProcessById([int]$proof.processId)
    $identity=Get-NativeProcessIdentity $child.Id
    if($identity.executable -ine $gui -or [Math]::Abs(([DateTimeOffset]::Parse($proof.startTimeUtc).UtcDateTime-$child.StartTime.ToUniversalTime()).TotalMilliseconds) -gt 20){throw 'Ordinary GUI creation identity changed.'}
    $hwnd=[IntPtr]([long]$proof.mainWindowHandle)
    $root=[Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if(-not $root -or $root.Current.ProcessId -ne $child.Id){throw 'Native UIA root does not belong to the exact ordinary GUI.'}
    $buttonType=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)
    $findButton={param([string]$Name)
      $named=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$Name)
      $buttons=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.AndCondition]::new($buttonType,$named))
      if($buttons.Count -eq 1 -and $buttons[0].Current.IsEnabled){return $buttons[0]}
    }
    $navigation=Get-NativeTelegramNavigation -FindButton $findButton -Label 'Ordinary GUI'
    ([Windows.Automation.InvokePattern]$navigation.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    $wrapper=Join-Path $script:DataRoot 'Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe'
    $before=Assert-NativeService -Name 'EgoistShieldTelegramProxy' -Executable $wrapper -Running
    $stop=Wait-NativeCondition -Condition {& $findButton 'Остановить'} -Label 'Ordinary GUI actual stop control' -TimeoutSeconds 60
    ([Windows.Automation.InvokePattern]$stop.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    $stopped=Wait-NativeCondition -Condition {
      $row=@(Get-NativeProductServices | Where-Object {$_.Name -eq 'EgoistShieldTelegramProxy'})
      if($row.Count -eq 1 -and $row[0].PathName.Trim().Trim('"') -ieq $wrapper -and $row[0].State -eq 'Stopped' -and [int]$row[0].ProcessId -eq 0){return $row[0]}
    } -Label 'Real SCM Telegram stop through ordinary GUI/Core IPC' -TimeoutSeconds 90
    $start=Wait-NativeCondition -Condition {& $findButton 'Запустить'} -Label 'Ordinary GUI actual start control' -TimeoutSeconds 60
    ([Windows.Automation.InvokePattern]$start.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    $after=Wait-NativeCondition -Condition {Assert-NativeService -Name 'EgoistShieldTelegramProxy' -Executable $wrapper -Running} -Label 'Real SCM Telegram start through ordinary GUI/Core IPC' -TimeoutSeconds 90
    if($after.process.processId -eq $before.process.processId -and $after.process.createdUtc -ceq $before.process.createdUtc){throw 'Ordinary GUI restart did not produce a new verified service identity.'}
    $configuration=Get-Content -LiteralPath (Join-Path $script:DataRoot 'Runtime\TelegramProxy\config.json') -Raw | ConvertFrom-Json
    $endpoint=Assert-NativeTelegramEndpoint -Port ([int]$configuration.port)
    $core=Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:Core -Running
    $workers=@(Get-NativeCimSnapshot Win32_Process -Filter "Name = 'EgoistShield.Worker.exe'" | Where-Object {$_.ExecutablePath -ieq (Join-Path $script:InstallRoot 'EgoistShield.Worker.exe') -and [int]$_.ParentProcessId -eq [int]$core.scm.ProcessId})
    if($workers.Count -ne 1){throw 'Ordinary GUI IPC did not use one exact protected Core worker.'}
    $owner=Invoke-CimMethod -InputObject $workers[0] -MethodName GetOwnerSid
    if($owner.ReturnValue -ne 0 -or $owner.Sid -ne 'S-1-5-18'){throw 'Ordinary GUI component operation was not executed by the LocalSystem worker.'}
    $pattern=$null
    if(-not $root.TryGetCurrentPattern([Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)){throw 'Ordinary GUI lacks native close pattern.'}
    ([Windows.Automation.WindowPattern]$pattern).Close()
    if(-not $child.WaitForExit(30000) -or $child.ExitCode -ne 0){throw 'Ordinary GUI did not exit normally.'};$closed=$true
    $script:Receipt.ordinaryGui=[ordered]@{ok=$true;launch=$proof;actualProcess=$identity;automation='native UIAutomation InvokePattern and WindowPattern';before=$before;stopped=$stopped;after=$after;endpoint=$endpoint;worker=Get-NativeProcessIdentity ([int]$workers[0].ProcessId);workerOwnerSid=$owner.Sid;exitCode=$child.ExitCode;cleanup=$null}
    Save-NativeReceipt
  }catch{$operationError=$_}
  finally{
    if($lease){
      try{$cleanup=Stop-OrdinaryGuiLease -Lease $lease;if(-not $closed -or -not $cleanup.exitedNormally -or $cleanup.exitCode -ne 0){throw 'Ordinary GUI cleanup did not follow a normal successful GUI exit.'}}
      catch{if(-not $operationError){$operationError=$_}}
    }
    if($child){$child.Dispose()}
    $destination=Join-Path $script:Evidence 'ordinary-gui';[void][IO.Directory]::CreateDirectory($destination)
    foreach($file in @(Get-ChildItem -LiteralPath $ordinaryEvidence -File)){Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $destination $file.Name)}
    if($lease){foreach($name in @('source-hashes.json','build.txt','run.stdout.txt','run.stderr.txt')){$file=Join-Path $lease.Build.Directory $name;if(Test-Path -LiteralPath $file -PathType Leaf){Copy-Item -LiteralPath $file -Destination (Join-Path $destination $name)}}}
    if($script:Receipt.Contains('ordinaryGui')){$script:Receipt.ordinaryGui.cleanup=$cleanup;Save-NativeReceipt}
  }
  if($operationError){throw $operationError}
  Assert-NativeNoGui
  [void](Assert-NativeTelegramEndpoint -Port ([int]$configuration.port))
  Assert-NativePrivateState 'after-ordinary-gui-operation'
  Assert-NativeNetworkPreserved 'ordinary-gui-stop-start-and-close'
  $gate=@($script:Receipt.releaseGates | Where-Object {$_.name -eq 'GUI IPC from an actual standard Windows user token'})
  if($gate.Count -ne 1){throw 'Ordinary GUI release gate is missing or ambiguous.'}
  $gate[0].status='passed';$gate[0].reason='Actual GUI token: not elevated, Administrators disabled, medium integrity, no privileged bypass. Genuine shipped UI controls stopped and restarted SCM Telegram through the protected LocalSystem Core worker; normal GUI exit and zero-orphan cleanup verified.'
  $script:Receipt.checks+=[ordered]@{name='actual-nonadministrator-gui-core-broker-service-stop-start-and-normal-quit';ok=$true};Save-NativeReceipt
}

function Assert-NativePrivateState {
  param([string]$Label)
  $records=@()
  foreach($relative in @('Runtime\TelegramProxy\config.json','Runtime\TelegramProxy\state.json','Runtime\Vpn','Service\Vpn')){
    $file=Join-Path $script:DataRoot $relative
    if(-not (Test-Path -LiteralPath $file)){
      if($relative -eq 'Runtime\TelegramProxy\config.json'){throw 'Actual Telegram credential configuration is missing.'}
      $records+=[ordered]@{path=$file;exists=$false};continue
    }
    $protected=Assert-NativeAdministratorOwned $file
    $acl=Get-Acl -LiteralPath $file
    foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
      if(($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0){continue}
      if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544') -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0){throw "Credential state is readable by an unrelated principal before backup: $file"}
    }
    $records+=[ordered]@{path=$file;exists=$true;owner=$protected.owner;privateContent=$true;sddl=$acl.Sddl}
  }
  $script:Receipt.privateStateReadbacks+=[ordered]@{phase=$Label;records=$records};Save-NativeReceipt
}
function New-NativePrivateStateFixture {
  $directory=Join-Path $script:DataRoot 'Service\Vpn'
  if(Test-Path -LiteralPath $directory){throw 'Private fixture cannot overwrite existing VPN state.'}
  Add-NativeMutation -Kind 'inactive-private-file-fixture' -Target $directory -Purpose 'Actual installer preservation/ACL/uninstall boundary; no VPN service or connection is created.'
  [void][IO.Directory]::CreateDirectory($directory)
  $security=[Security.AccessControl.DirectorySecurity]::new()
  $security.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));$security.SetAccessRuleProtection($true,$false)
  foreach($sid in @('S-1-5-18','S-1-5-32-544')){
    $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
  }
  Set-Acl -LiteralPath $directory -AclObject $security
  [void](Assert-NativeAdministratorOwned $directory)
  $file=Join-Path $directory '.native-acceptance-sentinel'
  [IO.File]::WriteAllText($file,('inactive-native-filesystem-fixture-'+[Guid]::NewGuid().ToString('N')),[Text.UTF8Encoding]::new($false))
  $script:Receipt.inactiveVpnFixture=[ordered]@{path=$file;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash;actualVpnConnectionConfigured=$false;actualVpnServiceInstalled=$false}
  Save-NativeReceipt
}
function Assert-NativeTelegramEndpoint {
  param([int]$Port)
  if($Port -lt 1024 -or $Port -gt 65535){throw 'Invalid actual Telegram loopback port.'}
  $wrapper=Join-Path $script:DataRoot 'Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe'
  $service=Assert-NativeService -Name 'EgoistShieldTelegramProxy' -Executable $wrapper -Running
  $listeners=@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -eq $Port})
  if($listeners.Count -lt 1 -or @($listeners | Where-Object {$_.LocalAddress -notin @('127.0.0.1','::1')}).Count -ne 0){throw 'Telegram listener is absent or not loopback-only.'}
  $byId=@{};foreach($row in @(Get-NativeCimSnapshot Win32_Process)){$byId[[int]$row.ProcessId]=$row}
  foreach($listener in $listeners){
    $current=[int]$listener.OwningProcess;$seen=[Collections.Generic.HashSet[int]]::new();$found=$false
    for($depth=0;$depth -lt 32 -and $current -gt 0;$depth++){
      if(-not $seen.Add($current) -or -not $byId.ContainsKey($current)){break};$row=$byId[$current]
      if(-not $row.CreationDate -or $row.CreationDate -lt [DateTimeOffset]::Parse($service.process.createdUtc).UtcDateTime){break}
      if($current -eq [int]$service.scm.ProcessId){$found=$true;break}
      $parent=$byId[[int]$row.ParentProcessId]
      if(-not $parent -or -not $parent.CreationDate -or $parent.CreationDate -gt $row.CreationDate){break};$current=[int]$row.ParentProcessId
    }
    if(-not $found){throw 'Telegram endpoint PID is not a verified actual SCM descendant.'}
  }
  $client=[Net.Sockets.TcpClient]::new()
  try{if(-not $client.ConnectAsync('127.0.0.1',$Port).Wait(3000) -or -not $client.Connected){throw 'Actual Telegram TCP readiness failed.'}}finally{$client.Dispose()}
  return [ordered]@{service=$service;endpoints=@($listeners | Select-Object LocalAddress,LocalPort,OwningProcess);tcpConnected=$true}
}
function Assert-NativeBootTask {
  param([string]$Stage)
  $taskName='EgoistShield-InstallerBootRecovery-'+[IO.Path]::GetFileName($Stage)
  $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
  [xml]$xml=Export-ScheduledTask -TaskName $taskName -TaskPath '\'
  $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
  $principal=$xml.SelectSingleNode('/t:Task/t:Principals/t:Principal',$ns);$action=$xml.SelectSingleNode('/t:Task/t:Actions/t:Exec',$ns)
  if(-not $principal -or -not $action -or $principal.UserId -notin @('S-1-5-18','SYSTEM') -or $principal.RunLevel -ne 'HighestAvailable' -or [string]$task.Principal.LogonType -ne 'ServiceAccount' -or @($xml.SelectNodes('/t:Task/t:Triggers/t:BootTrigger',$ns)).Count -ne 1 -or [string]$action.Command -ine $script:NativePowerShell -or -not ([string]$action.Arguments).Contains((Join-Path $Stage 'invoke-final-silent-reinstall.ps1')) -or -not ([string]$action.Arguments).Contains('"-Recover"') -or -not ([string]$action.Arguments).Contains($Stage)){throw 'Actual registered boot Task principal/action/trigger does not match the protected stage.'}
  $xml.Save((Join-Path $script:Work ($taskName+'.xml')))
  return [ordered]@{taskName=$taskName;taskPath=$task.TaskPath;state=[string]$task.State;principal='S-1-5-18';logonType=[string]$task.Principal.LogonType;highest=$true;bootTrigger=$true;action=[string]$action.Command;arguments=[string]$action.Arguments;actualBootExecuted=$false}
}
function Invoke-NativeProtectedReinstall {
  $helper=Join-Path $script:InstallRoot 'resources\installer\invoke-final-silent-reinstall.ps1'
  Add-NativeMutation -Kind 'protected-reinstall' -Target $script:InstallRoot -Purpose 'Actual same-version upgrade while Core/TG retain automatic recovery.'
  $dispatch=Invoke-NativeBounded -Executable $script:NativePowerShell -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$helper,'-InstallerPath',$script:Installer,'-IntegrityManifestPath',$script:ManifestPath,'-ExpectedVersion',$script:Version,'-ExpectedSha256',$script:InstallerHash,'-NoRunAfter','-DelaySeconds','8') -Label 'protected-reinstall-dispatch' -TimeoutSeconds 90
  $result=$dispatch.stdout | ConvertFrom-Json
  if($result.dispatched -ne $true -or [string]$result.runId -cnotmatch '^[a-f0-9]{32}$'){throw 'Production reinstall returned no protected run identity.'}
  $stage=Join-Path $script:DeferredRoot ([string]$result.runId)
  if([IO.Path]::GetFullPath([string]$result.state) -ine (Join-Path $stage 'state.json')){throw 'Production stage escaped its canonical root.'}
  [void](Assert-NativeAdministratorOwned $stage)
  $script:Receipt.reinstall=[ordered]@{stage=$stage;dispatched=$true;bootTask=$null;completed=$false};Save-NativeReceipt
  $taskName='EgoistShield-InstallerBootRecovery-'+[string]$result.runId;$watch=[Diagnostics.Stopwatch]::StartNew()
  do{
    $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
    if($task -and -not $script:Receipt.reinstall.bootTask){
      $script:Receipt.reinstall.bootTask=Assert-NativeBootTask -Stage $stage
      foreach($name in @('state.json','boot-recovery.json','invoke-final-silent-reinstall.ps1','service-maintenance.ps1','maintenance-boot-recovery.ps1')){[void](Assert-NativeAdministratorOwned (Join-Path $stage $name))};Save-NativeReceipt
    }
    if(Test-Path -LiteralPath (Join-Path $stage 'complete.flag') -PathType Leaf){break};Start-Sleep -Milliseconds 200
  }while($watch.Elapsed.TotalSeconds -lt 900)
  if(-not (Test-Path -LiteralPath (Join-Path $stage 'complete.flag') -PathType Leaf)){throw 'Actual protected reinstall exceeded 15 minutes; production recovery state retained.'}
  foreach($name in @('receipt.json','state.json','boot-recovery.json','worker.stdout.log','worker.stderr.log')){$file=Join-Path $stage $name;if(Test-Path -LiteralPath $file -PathType Leaf){Copy-Item -LiteralPath $file -Destination (Join-Path $script:Work ('reinstall-'+$name))}}
  $receipt=Get-Content -LiteralPath (Join-Path $stage 'receipt.json') -Raw | ConvertFrom-Json
  $events=if($receipt.PSObject.Properties['events']){@($receipt.events)}else{@()}
  if(@($events | Where-Object {$_.stage -eq 'verify' -and $_.status -eq 'succeeded'}).Count -ne 1){throw 'Reinstall complete flag lacks actual successful verification receipt.'}
  if(-not $script:Receipt.reinstall.bootTask){throw 'Actual production SYSTEM Task registration was never observed.'}
  [void](Wait-NativeCondition -Condition {if(-not (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue)){return $true}} -Label 'Production Task unregistration' -TimeoutSeconds 30)
  $script:Receipt.reinstall.completed=$true;$script:Receipt.reinstall.elapsedSeconds=[Math]::Round($watch.Elapsed.TotalSeconds,2);$script:Receipt.reinstall.taskRemoved=$true;Save-NativeReceipt
}
function Stop-NativeVerifiedCoreForRecovery {
  $before=Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:Core -Running
  $target=[Diagnostics.Process]::GetProcessById([int]$before.process.processId)
  try{
    $handle=$target.Handle
    if($handle -eq [IntPtr]::Zero -or $target.MainModule.FileName -ine $script:Core -or [Math]::Abs(($target.StartTime.ToUniversalTime()-[DateTimeOffset]::Parse($before.process.createdUtc).UtcDateTime).TotalMilliseconds) -gt 1 -or (Get-FileHash -LiteralPath $script:Core -Algorithm SHA256).Hash -ine $script:CoreHash){throw 'Held Core handle/path/birth/hash does not match SCM.'}
    Add-NativeMutation -Kind 'held-owned-core-crash' -Target ($script:Core+' PID '+$before.process.processId) -Purpose 'Observe real SCM restart without GUI.'
    $watch=[Diagnostics.Stopwatch]::StartNew();$target.Kill();[void]$target.WaitForExit(5000)
    $after=Wait-NativeCondition -Condition {$value=Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:Core -Running;if([int]$value.process.processId -ne [int]$before.process.processId -and [DateTimeOffset]::Parse($value.process.createdUtc) -gt [DateTimeOffset]::Parse($before.process.createdUtc)){return $value}} -Label 'Actual SCM Core crash recovery' -TimeoutSeconds 90
    $verify=Invoke-NativeBounded -Executable $script:Core -Arguments @('--verify-pipe-server') -Label 'core-after-crash-pipe' -TimeoutSeconds 15
    $hello=$verify.stdout | ConvertFrom-Json
    if($hello.ok -ne $true -or $hello.code -ne 'VERIFIED' -or [int]$hello.serverProcessId -ne [int]$after.process.processId -or [int]$hello.serviceProcessId -ne [int]$after.process.processId){throw 'Actual recovered Core pipe identity was not verified.'}
    $script:Receipt.coreRecovery=[ordered]@{before=$before;after=$after;elapsedSeconds=[Math]::Round($watch.Elapsed.TotalSeconds,2);actualGuiRunning=$false;pipe=$hello};Save-NativeReceipt
  }finally{$target.Dispose()}
}

function Assert-NativeCleanStart {
  if(@(Get-NativeProductServices).Count -ne 0){throw 'Existing product/shared-name services make clean acceptance unsafe.'}
  if(@(Get-NativeProductTasks).Count -ne 0){throw 'Existing product Tasks make clean acceptance unsafe.'}
  foreach($target in @($script:InstallRoot,$script:DataRoot,$script:InstallerDataRoot,(Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Egoist Shield'),(Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'EgoistShield'))){if(Test-Path -LiteralPath $target){throw "Existing product directory makes acceptance unsafe: $target"}}
  if(@(Get-NativeCimSnapshot Win32_Process | Where-Object {$_.Name -match '^Egoist(?:Shield|Lagom)'}).Count -ne 0){throw 'Existing product processes make acceptance unsafe.'}
  foreach($path in @('SOFTWARE\EgoistShield','SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield')){
    $key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($path)
    if($key){$key.Dispose();throw "Existing product registration makes acceptance unsafe: $path"}
  }
}
function Invoke-NativeNetworkGates {
  $nativeShell=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  foreach($kind in @('dns','vpn')){
    $childWork=Join-Path $script:Work ($kind+'-native')
    $childEvidence=Join-Path $childWork 'evidence'
    $harness=Join-Path $PSScriptRoot ('windows-'+$kind+'-native-acceptance.ps1')
    Assert-NativeOrdinaryPath -Path $harness -Leaf
    try{
      [void](Invoke-NativeBounded -Executable $nativeShell -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-File',$harness,'-IntegrityManifestPath',$script:ManifestPath,'-ExpectedSourceCommit',$script:SourceCommit,'-EvidenceDirectory',$childEvidence) -Label ($kind+'-native-gate') -TimeoutSeconds 1200)
      $file=if($kind -eq 'dns'){'windows-dns-native-acceptance.json'}else{'vpn-native-receipt.json'}
      $path=Join-Path $childEvidence $file
      Assert-NativeOrdinaryPath -Path $path -Leaf
      $receipt=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
      if($receipt.sourceCommit -cne $script:SourceCommit -or $receipt.candidateVersion -cne $script:Version){throw 'Network gate receipt differs from the actual installed candidate.'}
      if($kind -eq 'dns'){
        if($receipt.kind -cne 'actual-native-ordinary-gui-windows-doh' -or $receipt.result -cne 'passed' -or $receipt.guardian.stage -cne 'disarmed'){throw 'Actual DNS gate did not pass with normal restoration.'}
        $name='System DNS from ordinary GUI, persistence and restoration'
      }else{
        if($receipt.kind -cne 'actual-hosted-production-background-vpn-native-acceptance' -or $receipt.status -cne 'passed' -or $receipt.nativeAcceptancePassed -ne $true -or @($receipt.cleanup.errors).Count){throw 'Actual VPN gate did not pass with verified normal cleanup.'}
        $name='Background VPN native TUN, recovery and ordinary GUI OFF'
      }
      $gate=@($script:Receipt.releaseGates | Where-Object {$_.name -ceq $name})
      if($gate.Count -ne 1){throw 'Network release gate identity is ambiguous.'}
      $gate[0].status='passed';$gate[0].reason='Actual installed candidate, ordinary medium GUI and independent native readback; detailed receipt retained.'
      $script:Receipt.checks+=[ordered]@{name=($kind+'-actual-native-network-gate');ok=$true;receipt=($kind+'-native/evidence/'+$file);sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash}
      Assert-NativeNoGui;Assert-NativeNetworkPreserved ($kind+'-native-restoration');Save-NativeReceipt
    }finally{
      if(Test-Path -LiteralPath $childWork){
        Assert-NativeOrdinaryPath -Path $childWork
        foreach($entry in @(Get-ChildItem -LiteralPath $childWork -Recurse -Force)){if(($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Network evidence contains an unexpected reparse point.'}}
        Copy-Item -LiteralPath $childWork -Destination (Join-Path $script:Evidence ($kind+'-native')) -Recurse -Force
      }
    }
  }
}

function Invoke-NativeAcceptance {
  $environment=@{}
  foreach($name in @('GITHUB_ACTIONS','CI','RUNNER_ENVIRONMENT','RUNNER_OS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA')){$environment[$name]=[Environment]::GetEnvironmentVariable($name)}
  $windows=[Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
  $administrator=$windows -and ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $errors=@(Get-NativeAcceptanceEnvironmentErrors -Environment $environment -Administrator $administrator -Windows $windows)
  if($errors.Count -ne 0){throw ('Native acceptance host guard refused before mutation: '+($errors -join ', '))}
  if($PSVersionTable.PSVersion.Major -lt 7 -or -not [Environment]::Is64BitProcess){throw 'PowerShell 7 x64 required for bounded native argument handling.'}
  Assert-NativeOrdinaryPath -Path $env:RUNNER_TEMP;Assert-NativeOrdinaryPath -Path $env:GITHUB_WORKSPACE
  $script:Work=Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) ('lagom-native-'+$environment.GITHUB_RUN_ID+'-'+$environment.GITHUB_RUN_ATTEMPT)
  if($Mode -eq 'GuardOnly'){Write-Output 'Native host guards passed; no mutation performed.';return}
  if($ExpectedSourceCommit -cne $environment.GITHUB_SHA){throw 'Source identity must equal the actual hosted Actions commit.'}
  $script:SourceCommit=$ExpectedSourceCommit
  $script:ManifestPath=Assert-NativePathWithin -Path $IntegrityManifestPath -Root $env:GITHUB_WORKSPACE
  Assert-NativeOrdinaryPath -Path $script:ManifestPath -Leaf
  $manifest=Get-Content -LiteralPath $script:ManifestPath -Raw | ConvertFrom-Json
  if($manifest.product -ne 'Egoist Lagom' -or [string]$manifest.version -cnotmatch '^\d+\.\d+\.\d+$' -or [string]$manifest.source.commit -cne $script:SourceCommit -or [string]$manifest.installer.sha256 -cnotmatch '^[a-fA-F0-9]{64}$'){throw 'Candidate integrity identity invalid.'}
  $relative=[string]$manifest.installer.path
  if($relative -cnotmatch '^dist/(?:[a-zA-Z0-9_-]+/)*EgoistShield-Setup-\d+\.\d+\.\d+\.exe$'){throw 'Candidate installer path is not canonical.'}
  $script:Installer=Assert-NativePathWithin -Path (Join-Path $env:GITHUB_WORKSPACE $relative) -Root $env:GITHUB_WORKSPACE
  Assert-NativeOrdinaryPath -Path $script:Installer -Leaf
  $script:InstallerHash=(Get-FileHash -LiteralPath $script:Installer -Algorithm SHA256).Hash
  if($script:InstallerHash -ine [string]$manifest.installer.sha256 -or (Get-Item -LiteralPath $script:Installer).Length -ne [long]$manifest.installer.bytes){throw 'Actual Setup differs from its source-bound integrity receipt.'}
  $script:Version=[string]$manifest.version
  $script:InstallRoot=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield'
  $script:DataRoot=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShield'
  $script:InstallerDataRoot=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShieldInstaller'
  $script:DeferredRoot=Join-Path $script:InstallerDataRoot 'DeferredRuns'
  $script:Core=Join-Path $script:InstallRoot 'resources\core-service\win-x64\EgoistShield.Service.exe'
  $entries=@($manifest.payload | Where-Object {$_.path -ceq 'resources/core-service/win-x64/EgoistShield.Service.exe'})
  if($entries.Count -ne 1){throw 'Source-bound payload does not identify the candidate Core.'};$script:CoreHash=[string]$entries[0].sha256
  $script:NativePowerShell=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $script:Node=Resolve-NativeApplication 'node'
  $script:NodeHelper=Join-Path $PSScriptRoot 'windows-production-acceptance.mjs'
  Assert-NativeCleanStart
  if(Test-Path -LiteralPath $script:Work){throw 'Acceptance work already exists; inspect the prior attempt.'}
  if(-not $EvidenceDirectory){$EvidenceDirectory=Join-Path $script:Work 'evidence'}
  $script:Evidence=Assert-NativePathWithin -Path $EvidenceDirectory -Root $env:RUNNER_TEMP
  $ancestor=$script:Evidence
  while(-not (Test-Path -LiteralPath $ancestor)){$ancestor=[IO.Path]::GetDirectoryName($ancestor)}
  Assert-NativeOrdinaryPath -Path $ancestor
  New-Item -ItemType Directory -Path $script:Work,$script:Evidence -Force | Out-Null
  $script:ReceiptPath=Join-Path $script:Work 'windows-production-acceptance.json'
  $script:Receipt=[ordered]@{
    schemaVersion=1;kind='actual-native-hosted-windows-acceptance';sourceCommit=$script:SourceCommit;candidateVersion=$script:Version
    installer=[ordered]@{path=$script:Installer;sha256=$script:InstallerHash;bytes=[long]$manifest.installer.bytes}
    host=[ordered]@{computerName=$env:COMPUTERNAME;os=[Environment]::OSVersion.VersionString;powershell=$PSVersionTable.PSVersion.ToString();administrator=$administrator;runnerEnvironment=$env:RUNNER_ENVIRONMENT;githubRunId=$env:GITHUB_RUN_ID;githubRunAttempt=$env:GITHUB_RUN_ATTEMPT}
    startedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');result='running';cleanStartVerified=$true;mutations=@();checks=@();gui=@();networkReadbacks=@();privateStateReadbacks=@();beforeNetwork=(Get-NativeNetworkFingerprint);releaseReady=$false
    releaseGates=@(
      [ordered]@{name='Reboot/interrupted installation SYSTEM recovery';status='not-tested';reason='A live hosted runner cannot reboot within this job. Actual Task registration/principal/action/removal are exercised.'},
      [ordered]@{name='System DNS from ordinary GUI, persistence and restoration';status='not-tested';reason='Separate actual installed DNS gate must pass.'},
      [ordered]@{name='Background VPN native TUN, recovery and ordinary GUI OFF';status='not-tested';reason='Separate actual installed VPN gate must pass.'},
      [ordered]@{name='Driver-backed Zapret end-to-end';status='not-tested';reason='No unrelated driver or default-route filtering on the hosted control connection.'},
      [ordered]@{name='3.7.9 legacy worker automatic update chain';status='not-tested';reason='Requires separately authenticated official old Setup and signed candidate release feed; new-helper same-version reinstall does not prove it.'},
      [ordered]@{name='3.7.7 and 3.7.8 update trust compatibility';status='not-tested';reason='No authenticated legacy update chain is asserted.'},
      [ordered]@{name='GUI IPC from an actual standard Windows user token';status='not-tested';reason='The hosted runner token is administrator; asInvoker resource/shortcut readback does not prove standard-user authorization.'},
      [ordered]@{name='72 hour/7 day soak/month-scale uptime';status='not-tested';reason='Bounded native acceptance is not a long-duration pilot.'}
    )
  };Save-NativeReceipt
  $uninstalled=$false;$primaryError=$null
  try{
    Add-NativeMutation -Kind 'setup-clean-install' -Target $script:InstallRoot -Purpose 'Actual generated candidate silent installation.'
    $install=Invoke-NativeBounded -Executable $script:Installer -Arguments @('/S') -Label 'clean-install' -TimeoutSeconds 600
    $script:Receipt.checks+=[ordered]@{name='actual-generated-setup-clean-install';ok=$true;milliseconds=$install.elapsedMilliseconds}
    $acls=@();foreach($relative in @('','EgoistShield.exe','EgoistShield.Worker.exe','resources','resources\app.asar','resources\component-worker.cjs','resources\worker-host-integrity.json','resources\core-service\win-x64\EgoistShield.Service.exe')){$acls+=Assert-NativeAdministratorOwned (Join-Path $script:InstallRoot $relative)};$script:Receipt.acls=$acls
    $options=[ordered]@{installRoot=$script:InstallRoot;integrity=$script:ManifestPath;sourceCommit=$script:SourceCommit;version=$script:Version;output=(Join-Path $script:Work 'installed-payload.json')}
    $optionsPath=Join-Path $script:Work 'installed-payload.options.json';$options | ConvertTo-Json | Set-Content -LiteralPath $optionsPath -Encoding utf8
    [void](Invoke-NativeBounded -Executable $script:Node -Arguments @($script:NodeHelper,'verify-payload',$optionsPath) -Label 'installed-payload' -TimeoutSeconds 180)
    $script:Receipt.elevation=Assert-NativeGuiElevation
    $script:Receipt.checks+=[ordered]@{name='actual-installed-payload-fuses-asar-worker-inventory-acls-and-no-forced-elevation';ok=$true;receipt='installed-payload.json'}
    $script:Receipt.core=Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:Core -Running;$script:Receipt.corePolicy=Get-NativeRecoveryPolicy 'EgoistShieldCore'
    Assert-NativeNoGui;Assert-NativeNetworkPreserved 'clean-install'
    $gui=Invoke-NativeGui -Action 'provision-telegram' -Label 'gui-provision';Assert-NativeNoGui
    $port=[int]$gui.installResult.portConflict.port
    $script:Receipt.telegramWithoutGui=Assert-NativeTelegramEndpoint -Port $port;$script:Receipt.telegramPolicy=Get-NativeRecoveryPolicy 'EgoistShieldTelegramProxy'
    $script:Receipt.checks+=[ordered]@{name='actual-production-gui-ipc-telegram-persists-after-gui-quit';ok=$true};Assert-NativeNetworkPreserved 'gui-close'
    Invoke-NativeOrdinaryGui
    Invoke-NativeNetworkGates
    Stop-NativeVerifiedCoreForRecovery;Assert-NativeNoGui
    $script:Receipt.telegramAfterCoreCrash=Assert-NativeTelegramEndpoint -Port $port;Assert-NativeNetworkPreserved 'core-crash-recovery'
    New-NativePrivateStateFixture;Assert-NativePrivateState 'before-private-backup'
    Set-NativeOwnedLegacyLayer;Invoke-NativeProtectedReinstall
    [void](Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:Core -Running);[void](Get-NativeRecoveryPolicy 'EgoistShieldCore');[void](Get-NativeRecoveryPolicy 'EgoistShieldTelegramProxy')
    $script:Receipt.telegramAfterReinstall=Assert-NativeTelegramEndpoint -Port $port
    if((Get-FileHash -LiteralPath $script:Receipt.inactiveVpnFixture.path -Algorithm SHA256).Hash -cne $script:Receipt.inactiveVpnFixture.sha256){throw 'Actual upgrade changed private inactive VPN filesystem fixture.'}
    Assert-NativePrivateState 'after-private-state-preservation'
    $script:Receipt.elevationMigration=Assert-NativeGuiElevation -MigrationExpected
    Assert-NativeNoGui;Assert-NativeNetworkPreserved 'protected-reinstall'
    [void](Invoke-NativeGui -Action 'check-telegram' -Label 'gui-after-reinstall');Assert-NativeNoGui
    $script:Receipt.checks+=[ordered]@{name='actual-protected-reinstall-with-recovery-services-and-system-task-registration-roundtrip';ok=$true;actualReboot=$false}
    $uninstaller=Join-Path $script:InstallRoot 'Uninstall Egoist Shield.exe'
    [void](Assert-NativeAdministratorOwned $uninstaller)
    Add-NativeMutation -Kind 'owned-uninstall' -Target $script:InstallRoot -Purpose 'Actual candidate uninstall and owned cleanup.'
    [void](Invoke-NativeBounded -Executable $uninstaller -Arguments @('/S') -Label 'uninstall' -TimeoutSeconds 300)
    [void](Wait-NativeCondition -Condition {if(-not (Test-Path -LiteralPath $script:InstallRoot)){return $true}} -Label 'Actual uninstaller completion' -TimeoutSeconds 90)
    if(@(Get-NativeProductServices).Count -ne 0 -or @(Get-NativeProductTasks).Count -ne 0){throw 'Product SCM/Task residue remains after actual uninstall.'}
    foreach($relative in @('Service\Vpn','Runtime\TelegramProxy')){if(Test-Path -LiteralPath (Join-Path $script:DataRoot $relative)){throw 'Actual uninstall retained owned private VPN/TG state.'}}
    Assert-NativeNoGui;Assert-NativeNetworkPreserved 'uninstall';$uninstalled=$true
    $script:Receipt.checks+=[ordered]@{name='actual-uninstall-removes-owned-scm-tasks-and-preserves-runner-network';ok=$true}
    $script:Receipt.result='passed-bounded-native-acceptance'
  }catch{$primaryError=$_;$script:Receipt.result='failed';$script:Receipt.error=$_.Exception.Message}
  finally{
    $script:Receipt.finishedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');$script:Receipt.actualUninstallCompleted=$uninstalled
    $script:Receipt.installerDiagnostics=@(Copy-NativeInstallerDiagnostics)
    try{$script:Receipt.finalServices=Get-NativeProductServices;$script:Receipt.finalTasks=Get-NativeProductTasks}catch{$script:Receipt.finalReadbackError=$_.Exception.Message}
    Save-NativeReceipt
    foreach($file in @(Get-ChildItem -LiteralPath $script:Work -File)){Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $script:Evidence $file.Name) -Force}
    # Do not conceal a failure by broad-killing or manually repairing a partly
    # installed product. Recovery state and logs remain on the disposable runner.
  }
  if($primaryError){throw $primaryError}
  Write-Output ('Actual bounded native acceptance passed. Receipt: '+$script:ReceiptPath+'; untested gates: '+@($script:Receipt.releaseGates | Where-Object {$_.status -ne 'passed'}).Count)
}

if($LibraryOnly){return}
Invoke-NativeAcceptance
