[CmdletBinding()]
param(
  [ValidateSet('Run','GuardOnly')][string]$Mode='Run',
  [string]$IntegrityManifestPath='',
  [string]$EvidenceDirectory='',
  [ValidatePattern('^$|^[a-f0-9]{40}$')][string]$ExpectedSourceCommit='',
  [ValidateRange(0,120)][int]$SoakMinutes=0,
  [string]$UpgradeBaselineInstaller='',
  [switch]$LibraryOnly,
  [switch]$TraceReadonlyBootstrap
)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
if($LibraryOnly -and $TraceReadonlyBootstrap){$nativeReadonlyBootstrapClock=[Diagnostics.Stopwatch]::StartNew();[Console]::Error.WriteLine('readonly-library|shared|bootstrap-start|0')}

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
function Get-NativePathAclSnapshot {
  param([string]$Path)
  Assert-NativeOrdinaryPath -Path $Path -Leaf:([IO.File]::Exists($Path))
  $acl=Get-Acl -LiteralPath $Path
  return [ordered]@{path=$Path;owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;sddl=$acl.Sddl;protected=$acl.AreAccessRulesProtected;canonical=$acl.AreAccessRulesCanonical;rules=@(foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){[ordered]@{sid=$rule.IdentityReference.Value;rights=[int]$rule.FileSystemRights;type=[string]$rule.AccessControlType;inherited=$rule.IsInherited;inheritance=[int]$rule.InheritanceFlags;propagation=[int]$rule.PropagationFlags}})}
}
function Assert-NativeAdministratorAcl {
  param([Security.AccessControl.FileSystemSecurity]$Security,[string]$Path,[switch]$InstallationPath)
  $trusted=@('S-1-5-18','S-1-5-32-544')
  if($InstallationPath){
    if(-not [IO.Path]::IsPathRooted($Path)){throw 'Installation ACL scope requires an absolute path.'}
    $canonicalRoot=[IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield')).TrimEnd('\')
    $full=[IO.Path]::GetFullPath($Path).TrimEnd('\')
    if($full -ine $canonicalRoot -and -not $full.StartsWith($canonicalRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Installation ACL scope escaped canonical Program Files.'}
    $trusted+='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
  }
  if($Security.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted){throw "Untrusted installation owner: $Path"}
  $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach($rule in $Security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if(($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0){continue}
    if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -notin $trusted -and ($rule.FileSystemRights -band $write) -ne 0){throw "Untrusted write/delete ACE: $Path; SID=$($rule.IdentityReference.Value); rights=$([int]$rule.FileSystemRights); inherited=$($rule.IsInherited); SDDL=$($Security.Sddl)"}
  }
}
function Assert-NativeAdministratorOwned {
  param([string]$Path,[switch]$InstallationPath)
  Assert-NativeOrdinaryPath -Path $Path -Leaf:([IO.File]::Exists($Path))
  $acl=Get-Acl -LiteralPath $Path
  Assert-NativeAdministratorAcl -Security $acl -Path $Path -InstallationPath:$InstallationPath
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
function Set-NativeWindowsPowerShellChildEnvironment {
  param([Parameter(Mandatory=$true)][Diagnostics.ProcessStartInfo]$StartInfo)
  # NSIS and native helpers launch Windows PowerShell 5, which cannot load
  # PowerShell 7 Security/Management modules inherited from the CI parent.
  # Scope the native module path to the owned child; retain real ACL checks.
  $windows=[Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
  if([string]::IsNullOrWhiteSpace($windows)){throw 'Native Windows module root is unavailable.'}
  $StartInfo.EnvironmentVariables['PSModulePath']=[IO.Path]::Combine($windows,'System32\WindowsPowerShell\v1.0\Modules')
}
function Invoke-NativeBounded {
  param([string]$Executable,[string[]]$Arguments,[string]$Label,[int]$TimeoutSeconds=300,[string]$WorkingDirectory='')
  Assert-NativeOrdinaryPath -Path $Executable -Leaf
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Executable;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  if($WorkingDirectory){$info.WorkingDirectory=Assert-NativePathWithin $WorkingDirectory $script:Work;Assert-NativeOrdinaryPath $info.WorkingDirectory}
  Set-NativeWindowsPowerShellChildEnvironment -StartInfo $info
  $info.Environment['DOTNET_ADD_GLOBAL_TOOLS_TO_PATH']='0'
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
  param([scriptblock]$Condition,[string]$Label,[int]$TimeoutSeconds=90,[switch]$StopOnError)
  $watch=[Diagnostics.Stopwatch]::StartNew();$lastError=''
  do{try{$value=& $Condition;if($value){return $value}}catch{if($StopOnError){throw};$lastError=$_.Exception.Message};Start-Sleep -Milliseconds 250}while($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds)
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
function Assert-NativeGuiExecutionLevel {
  param([ValidateSet('gui','worker')][string]$Role,[string]$Level)
  $expected='asInvoker'
  if($Level -cne $expected){throw ("Installed "+$Role+" PE requests an incorrect execution level; expected "+$expected+'.')}
}
function Assert-NativeElevatedGuiTokenProof {
  param($Token,$RunnerToken)
  foreach($proof in @($Token,$RunnerToken)){
    if($null -eq $proof -or $proof.elevated -isnot [bool] -or -not $proof.elevated -or $proof.administratorsEnabled -isnot [bool] -or -not $proof.administratorsEnabled){throw 'Elevated GUI requires an actual elevated administrator token and runner.'}
    if(($proof.integrityRid -isnot [int] -and $proof.integrityRid -isnot [long]) -or $proof.integrityRid -lt 12288 -or $proof.uiAccess -isnot [bool] -or $proof.uiAccess -or ($proof.tokenType -isnot [int] -and $proof.tokenType -isnot [long]) -or $proof.tokenType -ne 1){throw 'Elevated GUI requires high integrity, a primary token and no UIAccess.'}
    if($proof.userSid -isnot [string] -or $proof.userSid -cnotmatch '^S-[0-9]+(?:-[0-9]+)+$' -or $proof.userSid -cin @('S-1-5-18','S-1-5-19','S-1-5-20') -or ($proof.sessionId -isnot [int] -and $proof.sessionId -isnot [long]) -or $proof.sessionId -lt 0){throw 'Elevated GUI requires a real interactive user SID and session.'}
  }
  if($Token.userSid -cne $RunnerToken.userSid -or $Token.sessionId -ne $RunnerToken.sessionId){throw 'Elevated GUI token user/session differs from the actual current runner token.'}
}

function Assert-NativeGuiElevation {
  param([switch]$MigrationExpected)
  $gui=Join-Path $script:InstallRoot 'EgoistShield.exe';$worker=Join-Path $script:InstallRoot 'EgoistShield.Worker.exe'
  foreach($role in @('gui','worker')){
    $executable=if($role -ceq 'gui'){$gui}else{$worker}
    [xml]$manifest=Get-NativePeResource -Executable $executable
    $level=$manifest.SelectSingleNode("//*[local-name()='requestedExecutionLevel']")
    if(-not $level){throw 'Installed GUI/Worker PE execution level is missing.'}
    Assert-NativeGuiExecutionLevel -Role $role -Level $level.GetAttribute('level')
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
  [void](Assert-NativeAdministratorOwned $gui -InstallationPath)
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

function Copy-NativeGuiLog {
  param([Diagnostics.ProcessStartInfo]$StartInfo,[ValidatePattern('^[a-z0-9-]+$')][string]$Label)
  $record=[ordered]@{name=($Label+'-main.log');status='missing'}
  try{
    $appData=[string]$StartInfo.Environment['APPDATA']
    if(-not $appData -or -not [IO.Path]::IsPathRooted($appData)){throw 'Actual GUI launch environment has no absolute APPDATA.'}
    $source=Join-Path $appData 'Egoist Shield\logs\main.log'
    [void](Assert-NativePathWithin $source $appData)
    if(Test-Path -LiteralPath $source -PathType Leaf){
      Assert-NativeOrdinaryPath -Path $source -Leaf
      $bytes=(Get-Item -LiteralPath $source).Length
      if($bytes -gt 6291456){throw 'GUI diagnostic log exceeded its explicit bound; original retained.'}
      $destination=Join-Path $script:Work $record.name
      [void](Assert-NativePathWithin $destination $script:Work)
      Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
      $record.status='captured';$record.bytes=(Get-Item -LiteralPath $destination).Length;$record.sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    }
  }catch{$record.status='refused-or-unavailable';$record.error=$_.Exception.Message}
  return $record
}

function Save-NativeGuiFailureObservation {
  param([Diagnostics.Process]$Process,$Root,[ValidatePattern('^[a-z0-9-]+$')][string]$Label)
  $record=[ordered]@{label=$Label;observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');processId=$Process.Id;mainLog=(Copy-NativeGuiLog -StartInfo $Process.StartInfo -Label $Label);controls=@();readbackErrors=@()}
  try{$Process.Refresh();$record.exited=$Process.HasExited;if($Process.HasExited){$record.exitCode=$Process.ExitCode}else{$record.windowHandle=[long]$Process.MainWindowHandle}}catch{$record.readbackErrors+=$_.Exception.Message}
  if($Root){
    try{
      if($Root.Current.ProcessId -ne $Process.Id){throw 'Observation root belongs to a different GUI.'}
      $controls=$Root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
      $record.totalElements=$controls.Count
      for($index=0;$index -lt $controls.Count -and $record.controls.Count -lt 160;$index++){
        $current=$controls[$index].Current
        if($current.ControlType.ProgrammaticName -notin @('ControlType.Button','ControlType.Text','ControlType.Window')){continue}
        $name=[string]$current.Name
        if($name.Length -gt 512){$name=$name.Substring(0,512)}
        $record.controls+=[ordered]@{type=$current.ControlType.ProgrammaticName;name=$name;enabled=$current.IsEnabled;offscreen=$current.IsOffscreen}
      }
    }catch{$record.readbackErrors+=$_.Exception.Message}
  }
  $file=Join-Path $script:Work ($Label+'-failure-observation.json')
  [void](Assert-NativePathWithin $file $script:Work)
  [IO.File]::WriteAllText($file,($record|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
}

function Invoke-NativeGui {
  param([ValidateSet('provision-telegram','check-telegram')][string]$Action,[string]$Label)
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  . (Join-Path $PSScriptRoot 'native-gui-diagnostics.ps1') -LibraryOnly
  $gui=Join-Path $script:InstallRoot 'EgoistShield.exe'
  [void](Assert-NativeAdministratorOwned $gui -InstallationPath)
  Add-NativeMutation -Kind 'canonical-gui-native-uia' -Target $gui -Purpose $Action
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$gui;$info.WorkingDirectory=$script:InstallRoot;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  foreach($name in @($info.Environment.Keys)){if($name -match '^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH|LAGOM_TEST_USER_DATA_DIR|SHIELD_.*|EGOIST_.*)$'){[void]$info.Environment.Remove($name)}}
  $info.Environment['NODE_ENV']='production'
  # No remote debugger, renderer-accessibility flag, development path or special
  # Core authority is added. InvokePattern operates the actual shipped buttons.
  $launchDiagnostics=$null
  try{$launchDiagnostics=New-NativeGuiLaunchDiagnostics -StartInfo $info -Work $script:Work -Label $Label}catch{Write-Warning ('GUI diagnostic setup unavailable: '+$_.Exception.GetType().FullName)}
  $child=[Diagnostics.Process]::new();$child.StartInfo=$info;$closed=$false;$started=$false;$root=$null;$stdout=$null;$stderr=$null
  try{
    $started=$child.Start();if(-not $started){throw 'Canonical GUI did not start.'}
    if($launchDiagnostics){$launchDiagnostics.child=Get-NativeGuiProcessDiagnostics -Process $child -ExpectedImage $gui;$launchDiagnostics.sessionMatchesParent=($launchDiagnostics.child.sessionId -ne $null -and $launchDiagnostics.child.sessionId -eq $launchDiagnostics.parent.sessionId)}
    $stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
    $hwnd=Wait-NativeCondition -Condition {$child.Refresh();if($child.HasExited){throw "Canonical GUI exited before exposing a window (exit $($child.ExitCode))."};if($child.MainWindowHandle -ne [IntPtr]::Zero){return $child.MainWindowHandle}} -Label 'Canonical GUI native window' -TimeoutSeconds 90 -StopOnError
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
      Add-NativeMutation -Kind 'telegram-native-invoke' -Target 'EgoistShieldTelegramProxy' -Purpose ("Invoke shipped install control in exact GUI PID "+$child.Id)
      ([Windows.Automation.InvokePattern]$installButton.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
      Save-NativeGuiFailureObservation -Process $child -Root $root -Label ($Label+'-after-invoke')
      $capture=[ordered]@{watch=[Diagnostics.Stopwatch]::StartNew();next=2;label=$Label}
      [void](Wait-NativeCondition -Condition {
        if($capture.next -le 45 -and $capture.watch.Elapsed.TotalSeconds -ge $capture.next){
          Save-NativeGuiFailureObservation -Process $child -Root $root -Label ($capture.label+'-click-'+$capture.next+'s')
          $capture.next=if($capture.next -eq 2){15}elseif($capture.next -eq 15){45}else{999}
        }
        Assert-NativeService -Name 'EgoistShieldTelegramProxy' -Executable $wrapper -Running
      } -Label 'Telegram installed through genuine GUI control' -TimeoutSeconds 240)
    }else{[void](Assert-NativeService -Name 'EgoistShieldTelegramProxy' -Executable $wrapper -Running)}
    $completion=Wait-NativeTelegramGuiCompletion -FindButton $findButton -Process $child -Root $root -Label $Label
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
    $result=[ordered]@{ok=$true;mode=$Action;mainProcessId=$child.Id;arguments=@();automation='native UIAutomation InvokePattern and WindowPattern';operationCompletion=$completion;productionOverride=$false;coreWorker=Get-NativeProcessIdentity ([int]$workers[0].ProcessId);workerOwnerSid=$owner.Sid;installResult=[ordered]@{serviceInstalled=$true;serviceRunning=$true;running=$true;portConflict=[ordered]@{port=$port;host=[string]$config.host}};exitCode=$child.ExitCode}
    $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $script:Work ($Label+'.json')) -Encoding utf8
    $script:Receipt.gui+=$result;Save-NativeReceipt;return $result
  }catch{
    if($started){try{Save-NativeGuiFailureObservation -Process $child -Root $root -Label $Label}catch{Write-Warning ('GUI observation unavailable: '+$_.Exception.Message)}}
    throw
  }finally{
    try{
      if($started -and -not $closed -and -not $child.HasExited){
        # Only the handle created in this function is canceled on test failure.
        # SCM processes and other GUIs are never selected for this cleanup.
        $child.Kill();[void]$child.WaitForExit(5000)
      }
    }catch{Write-Warning ('Own GUI cleanup unavailable: '+$_.Exception.GetType().FullName)}
    try{[void](Complete-NativeGuiDiagnostics -Stdout $stdout -Stderr $stderr -Launch $launchDiagnostics -Work $script:Work -Label $Label)}catch{Write-Warning ('GUI diagnostics unavailable: '+$_.Exception.GetType().FullName)}
    try{$child.Dispose()}catch{Write-Warning ('Own GUI handle disposal unavailable: '+$_.Exception.GetType().FullName)}
  }
}
function Invoke-NativeElevatedGui {
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  . (Join-Path $PSScriptRoot 'windows-ordinary-gui.ps1') -OrdinaryGuiLibraryOnly
  $gui=Join-Path $script:InstallRoot 'EgoistShield.exe'
  $elevatedEvidence=Join-Path $script:Work 'elevated-evidence'
  [void][IO.Directory]::CreateDirectory($elevatedEvidence)
  Add-NativeMutation -Kind 'elevated-gui-native-uia' -Target $gui -Purpose 'Actual Windows administrator GUI stops and starts the installed Telegram service through the shipped Core broker.'
  $lease=$null;$child=$null;$closed=$false;$operationError=$null;$cleanup=$null
  $script:Receipt.elevatedGui=[ordered]@{ok=$false;result='running';launch=$null;actualProcess=$null;exitCode=$null;cleanup=$null;managementMode='administrator-required';normalUacPromptObserved=$false}
  Save-NativeReceipt
  try{
    $lease=Start-ElevatedGuiLease -CanonicalInstalledGuiPath $gui -IntegrityManifestPath $script:ManifestPath -ExpectedSourceCommit $script:SourceCommit -WorkRoot $script:Work -EvidenceDirectory $elevatedEvidence
    $proof=$lease.Receipt
    $script:Receipt.elevatedGui.launch=$proof
    if($proof.launchPolicy -cne 'elevated' -or $proof.elevatedGui -ne $true -or $proof.guiRequestedExecutionLevel -cne 'asInvoker'){throw 'Elevated GUI lease did not prove the explicit current-token launch policy.'}
    Assert-NativeElevatedGuiTokenProof -Token $proof.token -RunnerToken $proof.runnerToken
    if($proof.executable -ine $gui -or @($proof.arguments).Count -ne 0 -or $proof.source.commit -cne $script:SourceCommit -or $proof.artifactSourceCommit -cne $script:SourceCommit -or $proof.harnessSourceCommit -cne $script:SourceCommit){throw 'Elevated GUI launch/source identity mismatch.'}
    $child=[Diagnostics.Process]::GetProcessById([int]$proof.processId)
    $heldGuiProcessHandle=$child.Handle
    $identity=Get-NativeProcessIdentity $child.Id
    if($identity.executable -ine $gui -or [Math]::Abs(([DateTimeOffset]::Parse($proof.startTimeUtc).UtcDateTime-$child.StartTime.ToUniversalTime()).TotalMilliseconds) -gt 20){throw 'Elevated GUI creation identity changed.'}
    $hwnd=[IntPtr]([long]$proof.mainWindowHandle)
    $root=[Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if(-not $root -or $root.Current.ProcessId -ne $child.Id){throw 'Native UIA root does not belong to the exact elevated GUI.'}
    $buttonType=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)
    $findButton={param([string]$Name)
      $named=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$Name)
      $buttons=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.AndCondition]::new($buttonType,$named))
      if($buttons.Count -eq 1 -and $buttons[0].Current.IsEnabled){return $buttons[0]}
    }
    $navigation=Get-NativeTelegramNavigation -FindButton $findButton -Label 'Elevated GUI'
    ([Windows.Automation.InvokePattern]$navigation.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    $wrapper=Join-Path $script:DataRoot 'Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe'
    $before=Assert-NativeService -Name 'EgoistShieldTelegramProxy' -Executable $wrapper -Running
    $portFixtureBefore=Get-NativeTelegramPortFixtureState
    [void](Assert-NativeTelegramEndpoint -Port $portFixtureBefore.port)
    $stop=Wait-NativeCondition -Condition {& $findButton 'Остановить'} -Label 'Elevated GUI actual stop control' -TimeoutSeconds 60
    ([Windows.Automation.InvokePattern]$stop.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    $stopped=Wait-NativeCondition -Condition {
      $row=@(Get-NativeProductServices | Where-Object {$_.Name -eq 'EgoistShieldTelegramProxy'})
      if($row.Count -eq 1 -and $row[0].PathName.Trim().Trim('"') -ieq $wrapper -and $row[0].State -eq 'Stopped' -and [int]$row[0].ProcessId -eq 0){return $row[0]}
    } -Label 'Real SCM Telegram stop through elevated GUI/Core IPC' -TimeoutSeconds 90
    # SCM Stopped can precede the stop IPC/status response. Complete the genuine
    # GUI OFF action before the fixture can change its observed endpoint status.
    $stopCompletion=Wait-NativeTelegramStoppedGuiCompletion -FindButton $findButton -Process $child -Root $root -Label 'Elevated GUI'
    $script:Receipt.elevatedGui.stopOperationCompletion=$stopCompletion;Save-NativeReceipt
    Invoke-NativeTelegramOccupiedPort -FindButton $findButton -Process $child -Root $root -BeforeState $portFixtureBefore
    $start=Wait-NativeCondition -Condition {& $findButton 'Запустить'} -Label 'Elevated GUI actual start control' -TimeoutSeconds 60
    ([Windows.Automation.InvokePattern]$start.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    $after=Wait-NativeCondition -Condition {Assert-NativeService -Name 'EgoistShieldTelegramProxy' -Executable $wrapper -Running} -Label 'Real SCM Telegram start through elevated GUI/Core IPC' -TimeoutSeconds 90
    if($after.process.processId -eq $before.process.processId -and $after.process.createdUtc -ceq $before.process.createdUtc){throw 'Elevated GUI restart did not produce a new verified service identity.'}
    $completion=Wait-NativeTelegramGuiCompletion -FindButton $findButton -Process $child -Root $root -Label 'Elevated GUI'
    $configuration=Get-Content -LiteralPath (Join-Path $script:DataRoot 'Runtime\TelegramProxy\config.json') -Raw | ConvertFrom-Json
    $endpoint=Assert-NativeTelegramEndpoint -Port ([int]$configuration.port)
    $portFixtureAfter=Get-NativeTelegramPortFixtureState
    if($portFixtureAfter.configurationSha256 -cne $portFixtureBefore.configurationSha256 -or $portFixtureAfter.settingsSha256 -cne $portFixtureBefore.settingsSha256 -or $portFixtureAfter.port -ne $portFixtureBefore.port -or $portFixtureAfter.host -cne $portFixtureBefore.host){throw 'TG normal recovery changed retained configuration/settings or its endpoint.'}
    $script:Receipt.telegramOccupiedPort.recovered=[ordered]@{ready=$true;ownership=if($portFixtureAfter.host -ceq '127.0.0.1'){$endpoint.nativeSnapshot.ownership}else{$endpoint.nativeSnapshot.ipv6Ownership};ipv4Ownership=$endpoint.nativeSnapshot.ownership;ipv6Ownership=$endpoint.nativeSnapshot.ipv6Ownership;port=$portFixtureAfter.port;host=$portFixtureAfter.host;configurationSha256=$portFixtureAfter.configurationSha256;settingsSha256=$portFixtureAfter.settingsSha256;serviceProcessId=$after.process.processId;remoteConnectivityVerified=$false}
    $script:Receipt.telegramOccupiedPort.ok=$true;$script:Receipt.telegramOccupiedPort.result='passed-conflict-refusal-and-normal-recovery'
    $script:Receipt.checks+=[ordered]@{name='actual-telegram-occupied-loopback-port-refusal-preserves-own-listener-and-recovers';ok=$true};Save-NativeReceipt
    $core=Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:Core -Running
    $workers=@(Get-NativeCimSnapshot Win32_Process -Filter "Name = 'EgoistShield.Worker.exe'" | Where-Object {$_.ExecutablePath -ieq (Join-Path $script:InstallRoot 'EgoistShield.Worker.exe') -and [int]$_.ParentProcessId -eq [int]$core.scm.ProcessId})
    if($workers.Count -ne 1){throw 'Elevated GUI IPC did not use one exact protected Core worker.'}
    $owner=Invoke-CimMethod -InputObject $workers[0] -MethodName GetOwnerSid
    if($owner.ReturnValue -ne 0 -or $owner.Sid -ne 'S-1-5-18'){throw 'Elevated GUI component operation was not executed by the LocalSystem worker.'}
    $pattern=$null
    if(-not $root.TryGetCurrentPattern([Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)){throw 'Elevated GUI lacks native close pattern.'}
    $closeDiagnostics=[ordered]@{
      schemaVersion=1;processId=$child.Id;startTimeUtc=$proof.startTimeUtc;callerProcessHandleHeld=($heldGuiProcessHandle -ne [IntPtr]::Zero)
      powershellVersion=$PSVersionTable.PSVersion.ToString();runtimeVersion=[Environment]::Version.ToString()
      closeRequestedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');closeReturnedAtUtc=$null;closeElapsedMilliseconds=$null
      waitBudgetMilliseconds=30000;waitStartedAtUtc=$null;waitFinishedAtUtc=$null;waitElapsedMilliseconds=$null;waitReturned=$null;exitCodeAtWait=$null;hasExitedBeforeCleanup=$null;exitCodeBeforeCleanup=$null;processExitUtcBeforeCleanup=$null;readbackErrorType=$null;readbackHresult=$null;readbackStartedAtUtc=$null;readbackFinishedAtUtc=$null
    }
    $script:Receipt.elevatedGui.before=$before;$script:Receipt.elevatedGui.stopped=$stopped;$script:Receipt.elevatedGui.after=$after
    $script:Receipt.elevatedGui.operationCompletion=$completion;$script:Receipt.elevatedGui.endpoint=$endpoint
    $script:Receipt.elevatedGui.workerOwnerSid=$owner.Sid
    $script:Receipt.elevatedGui.closeDiagnostics=$closeDiagnostics;Save-NativeReceipt
    $closeWatch=[Diagnostics.Stopwatch]::StartNew()
    ([Windows.Automation.WindowPattern]$pattern).Close()
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
    Save-NativeReceipt
    if(-not $waitReturned -or $exitCodeAtWait -ne 0){throw 'Elevated GUI did not exit normally.'};$closed=$true
    $script:Receipt.elevatedGui=[ordered]@{ok=$true;result='passed-elevated-gui-ipc';managementMode='administrator-required';normalUacPromptObserved=$false;launch=$proof;actualProcess=$identity;automation='native UIAutomation InvokePattern and WindowPattern';stopOperationCompletion=$stopCompletion;operationCompletion=$completion;before=$before;stopped=$stopped;after=$after;endpoint=$endpoint;worker=Get-NativeProcessIdentity ([int]$workers[0].ProcessId);workerOwnerSid=$owner.Sid;exitCode=$child.ExitCode;cleanup=$null;closeDiagnostics=$closeDiagnostics}
    Save-NativeReceipt
  }catch{$operationError=$_;$script:Receipt.elevatedGui.ok=$false;$script:Receipt.elevatedGui.result='failed';$script:Receipt.elevatedGui.error=$_.Exception.Message;Save-NativeReceipt}
  finally{
    if($lease){
      try{$cleanup=Stop-ElevatedGuiLease -Lease $lease;if(-not $closed -or -not $cleanup.exitedNormally -or $cleanup.exitCode -ne 0){throw 'Elevated GUI cleanup did not follow a normal successful GUI exit.'}}
      catch{if(-not $operationError){$operationError=$_};$script:Receipt.elevatedGui.ok=$false;$script:Receipt.elevatedGui.result='failed';$script:Receipt.elevatedGui.error=$operationError.Exception.Message}
    }
    if($child){$child.Dispose()}
    $destination=Join-Path $script:Evidence 'elevated-gui';[void][IO.Directory]::CreateDirectory($destination)
    foreach($file in @(Get-ChildItem -LiteralPath $elevatedEvidence -File)){Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $destination $file.Name)}
    if($lease){foreach($name in @('source-hashes.json','build.txt','run.stdout.txt','run.stderr.txt')){$file=Join-Path $lease.Build.Directory $name;if(Test-Path -LiteralPath $file -PathType Leaf){Copy-Item -LiteralPath $file -Destination (Join-Path $destination $name)}}}
    if($script:Receipt.Contains('elevatedGui')){$script:Receipt.elevatedGui.cleanup=$cleanup;Save-NativeReceipt}
  }
  if($operationError){throw $operationError}
  Assert-NativeNoGui
  [void](Assert-NativeTelegramEndpoint -Port ([int]$configuration.port))
  Assert-NativePrivateState 'after-elevated-gui-operation'
  Assert-NativeNetworkPreserved 'elevated-gui-stop-start-and-close'
  $gate=@($script:Receipt.releaseGates | Where-Object {$_.name -eq 'GUI IPC from an actual elevated Windows user token'})
  if($gate.Count -ne 1){throw 'Elevated GUI release gate is missing or ambiguous.'}
  $gate[0].status='passed';$gate[0].reason='Actual current Windows GUI token: elevated, Administrators enabled, high integrity, same user/session, primary and no UIAccess. The GUI manifest is asInvoker; this explicit native acceptance launch inherited the actual elevated administrator runner token. No filtered-token or sandbox bypass is used. Genuine shipped UI controls stopped and restarted SCM Telegram through the protected LocalSystem Core worker; normal GUI exit and zero-orphan cleanup verified.'
  $script:Receipt.checks+=[ordered]@{name='actual-elevated-gui-core-broker-service-stop-start-and-normal-quit';ok=$true};Save-NativeReceipt
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
      if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544') -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0){
        $failure=[ordered]@{phase=$Label;path=$file;offendingRule=[ordered]@{sid=$rule.IdentityReference.Value;rights=[int]$rule.FileSystemRights;inherited=$rule.IsInherited;inheritance=[int]$rule.InheritanceFlags;propagation=[int]$rule.PropagationFlags};fileAcl=$null;parentAcl=$null;diagnosticErrorType=$null}
        try{
          $failure.fileAcl=Get-NativePathAclSnapshot $file
          $failure.parentAcl=Get-NativePathAclSnapshot ([IO.Path]::GetDirectoryName($file))
        }catch{$failure.diagnosticErrorType=$_.Exception.GetType().Name}
        if(-not $script:Receipt.Contains('privateStateFailures')){$script:Receipt.privateStateFailures=@()}
        $script:Receipt.privateStateFailures+=$failure;Save-NativeReceipt
        throw "Credential state is readable by an unrelated principal before backup: $file"
      }
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
function Read-NativeTelegramEndpointSnapshot {
  param([int]$Port,[int]$TimeoutMilliseconds)
  # Existing child retirement/drain allowance is reserved inside the endpoint deadline.
  $seconds=[Math]::Min(4,[Math]::Floor(($TimeoutMilliseconds-7000)/1000))
  if($seconds -lt 1){throw 'Telegram endpoint deadline cannot admit another bounded snapshot.'}
  $result=Invoke-NativeBounded -Executable $script:Core -Arguments @('--telegram-listener-snapshot','--port',[string]$Port) -Label ('telegram-listener-'+$Port) -TimeoutSeconds ([int]$seconds)
  if([Text.Encoding]::UTF8.GetByteCount($result.stdout) -gt 65536){throw 'Telegram snapshot exceeded its output bound.'}
  return $result.stdout | ConvertFrom-Json
}
function Test-NativeTelegramTcp {
  param([int]$Port,[int]$TimeoutMilliseconds)
  if($TimeoutMilliseconds -le 0){throw 'Telegram endpoint deadline expired before TCP.'}
  $client=[Net.Sockets.TcpClient]::new()
  try{return $client.ConnectAsync('127.0.0.1',$Port).Wait([Math]::Min(3000,$TimeoutMilliseconds)) -and $client.Connected}finally{$client.Dispose()}
}
function ConvertTo-NativeTelegramUtcInstant {
  param($Value)
  if($Value -is [DateTimeOffset]){return $Value.ToUniversalTime()}
  if($Value -is [DateTime]){
    if($Value.Kind -eq [DateTimeKind]::Unspecified){throw 'Telegram identity timestamp has no known timezone.'}
    return ([DateTimeOffset]$Value).ToUniversalTime()
  }
  if($Value -isnot [string] -or $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$'){throw 'Telegram identity timestamp is not an explicit ISO UTC/offset instant.'}
  return ([DateTimeOffset]::Parse($Value,[Globalization.CultureInfo]::InvariantCulture)).ToUniversalTime()
}
function Get-NativeTelegramSnapshotState {
  param($Value,[int]$Port,$Service)
  if($Value.schemaVersion -ne 2 -or $Value.operation -cne 'telegram-listener-snapshot' -or $Value.serviceName -cne 'EgoistShieldTelegramProxy' -or $Value.port -ne $Port -or
     $Value.snapshotAvailable -isnot [bool] -or -not $Value.snapshotAvailable -or $Value.stable -isnot [bool] -or -not $Value.stable -or
     $Value.serviceState -cne 'Running' -or $Value.rootProcessPathVerified -isnot [bool] -or -not $Value.rootProcessPathVerified -or $Value.managedProcessId -ne $null){throw 'Unknown or incomplete actual Telegram native snapshot.'}
  $snapshot=$Value.snapshot
  if(-not $snapshot -or $snapshot.stable -isnot [bool] -or -not $snapshot.stable -or $snapshot.serviceState -cne 'Running' -or
     $snapshot.serviceProcessId -ne $Value.serviceProcessId -or $Value.serviceProcessId -ne $Service.process.processId){throw 'Actual Telegram SCM process identity changed.'}
  $rows=@($snapshot.processes);$listeners=@($snapshot.listeners)
  if($rows.Count -gt 128 -or $listeners.Count -gt 128){throw 'Actual Telegram snapshot row bound exceeded.'}
  $byId=@{}
  foreach($row in $rows){
    if(-not $row -or $row.processId -isnot [long] -and $row.processId -isnot [int] -or $row.processId -le 0 -or $row.processId -gt [int]::MaxValue -or $byId.ContainsKey([int]$row.processId)){throw 'Incomplete or duplicate actual Telegram process row.'}
    $byId[[int]$row.processId]=$row
  }
  $root=$byId[[int]$Value.serviceProcessId]
  $expected=Join-Path $script:DataRoot 'Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe'
  if(-not $root -or $root.executablePath -ine $expected -or -not $root.createdAt -or -not $Value.rootProcessCreatedAt){throw 'Actual Telegram root path/birth proof is unavailable.'}
  $birth=(ConvertTo-NativeTelegramUtcInstant $root.createdAt)
  if($birth -ne (ConvertTo-NativeTelegramUtcInstant $Value.rootProcessCreatedAt) -or [Math]::Abs(($birth-(ConvertTo-NativeTelegramUtcInstant $Service.process.createdUtc)).Ticks) -gt 10){throw 'Actual Telegram root birth changed.'}
  foreach($listener in $listeners){
    if(-not $listener -or $listener.localPort -ne $Port -or $listener.localAddress -notin @('127.0.0.1','::1')){throw 'Actual Telegram listener is non-loopback or malformed.'}
    $current=[int]$listener.owningProcess;$seen=[Collections.Generic.HashSet[int]]::new();$found=$false
    for($depth=0;$depth -lt 32 -and $current -gt 0;$depth++){
      if(-not $seen.Add($current) -or -not $byId.ContainsKey($current)){break};$row=$byId[$current]
      if(-not $row.createdAt -or -not $row.executablePath -or (ConvertTo-NativeTelegramUtcInstant $row.createdAt) -lt $birth){break}
      if($current -eq [int]$Value.serviceProcessId){$found=$true;break}
      $parent=$byId[[int]$row.parentProcessId]
      if(-not $parent -or -not $parent.createdAt -or (ConvertTo-NativeTelegramUtcInstant $parent.createdAt) -gt (ConvertTo-NativeTelegramUtcInstant $row.createdAt)){break};$current=[int]$row.parentProcessId
    }
    if(-not $found){throw 'Actual Telegram endpoint owner/birth is not a verified SCM descendant.'}
  }
  if($Value.ownership -cne $Value.ipv4.state -or $Value.ipv6Ownership -cne $Value.ipv6.state){throw 'Contradictory Telegram family ownership.'}
  foreach($family in @($Value.ipv4,$Value.ipv6)){
    if($family.state -notin @('owned','missing')){throw 'Actual Telegram listener is foreign or ownership unknown.'}
    if($family.state -eq 'owned' -and ($family.rootPid -ne $Value.serviceProcessId -or -not $family.rootCreatedAt -or
      (ConvertTo-NativeTelegramUtcInstant $family.rootCreatedAt) -ne $birth -or -not $family.ownerCreatedAt -or
      -not $byId.ContainsKey([int]$family.ownerPid) -or (ConvertTo-NativeTelegramUtcInstant $family.ownerCreatedAt) -ne (ConvertTo-NativeTelegramUtcInstant $byId[[int]$family.ownerPid].createdAt))){throw 'Incomplete actual Telegram family owner identity.'}
  }
  if($listeners.Count -eq 0){if($Value.ipv4.state -ne 'missing' -or $Value.ipv6.state -ne 'missing'){throw 'Contradictory Telegram absence proof.'};return 'pending'}
  if($Value.ipv4.state -ne 'owned' -and $Value.ipv6.state -ne 'owned'){throw 'Actual Telegram listener ownership was not established.'}
  return 'ready'
}
function Save-NativeTelegramEndpointObservation {
  param([int]$Port,[string]$Result,[double]$ElapsedMilliseconds,$LastSnapshot,[string]$ErrorMessage='',[int]$TimeoutSeconds=30)
  $record=[ordered]@{observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');port=$Port;result=$Result;endpointBudgetSeconds=$TimeoutSeconds;elapsedMilliseconds=[Math]::Round($ElapsedMilliseconds,2);lastSnapshot=$LastSnapshot;error=$ErrorMessage}
  $previous=if($script:Receipt.Contains('telegramEndpointObservations')){@($script:Receipt.telegramEndpointObservations)}else{@()}
  $script:Receipt.telegramEndpointObservations=@(@($previous)+@($record) | Select-Object -Last 16)
  Save-NativeReceipt
}
function Assert-NativeTelegramEndpoint {
  param([int]$Port,[ValidateRange(1,30)][int]$TimeoutSeconds=30)
  if($Port -lt 1024 -or $Port -gt 65535){throw 'Invalid actual Telegram loopback port.'}
  $wrapper=Join-Path $script:DataRoot 'Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe'
  # Preserve the independent SCM path/account/startup gate before the bounded listener phase.
  $service=Assert-NativeService -Name 'EgoistShieldTelegramProxy' -Executable $wrapper -Running
  $watch=[Diagnostics.Stopwatch]::StartNew();$last=$null
  try{
    do{
      $remaining=[int]($TimeoutSeconds*1000-$watch.Elapsed.TotalMilliseconds)
      if($remaining -le 0){throw 'Actual Telegram endpoint readiness deadline timed out.'}
      $before=Read-NativeTelegramEndpointSnapshot -Port $Port -TimeoutMilliseconds $remaining
      $last=$before.snapshot
      if($watch.Elapsed.TotalMilliseconds -ge $TimeoutSeconds*1000){throw 'Actual Telegram endpoint readiness deadline timed out.'}
      $state=Get-NativeTelegramSnapshotState -Value $before -Port $Port -Service $service
      if($state -eq 'pending'){
        $remaining=[int]($TimeoutSeconds*1000-$watch.Elapsed.TotalMilliseconds)
        if($remaining -gt 0){Start-Sleep -Milliseconds ([Math]::Min(250,$remaining))};continue
      }
      $remaining=[int]($TimeoutSeconds*1000-$watch.Elapsed.TotalMilliseconds)
      if(-not (Test-NativeTelegramTcp -Port $Port -TimeoutMilliseconds $remaining)){throw 'Actual Telegram TCP readiness failed.'}
      $remaining=[int]($TimeoutSeconds*1000-$watch.Elapsed.TotalMilliseconds)
      if($remaining -le 0){throw 'Actual Telegram endpoint deadline expired after TCP.'}
      $after=Read-NativeTelegramEndpointSnapshot -Port $Port -TimeoutMilliseconds $remaining;$last=$after.snapshot
      if((Get-NativeTelegramSnapshotState -Value $after -Port $Port -Service $service) -ne 'ready' -or $after.serviceProcessId -ne $before.serviceProcessId -or
         (ConvertTo-NativeTelegramUtcInstant $after.rootProcessCreatedAt) -ne (ConvertTo-NativeTelegramUtcInstant $before.rootProcessCreatedAt)){throw 'Actual Telegram root/listener changed during TCP proof.'}
      if($watch.Elapsed.TotalMilliseconds -ge $TimeoutSeconds*1000){throw 'Actual Telegram endpoint readiness deadline timed out.'}
      Save-NativeTelegramEndpointObservation -Port $Port -Result 'ready' -ElapsedMilliseconds $watch.Elapsed.TotalMilliseconds -LastSnapshot $last -TimeoutSeconds $TimeoutSeconds
      return [ordered]@{service=$service;endpoints=@($after.snapshot.listeners);tcpConnected=$true;nativeSnapshot=$after;readinessMilliseconds=[Math]::Round($watch.Elapsed.TotalMilliseconds,2)}
    }while($watch.Elapsed.TotalMilliseconds -lt $TimeoutSeconds*1000)
    throw 'Actual Telegram endpoint readiness deadline timed out.'
  }catch{
    $primary=$_
    try{Save-NativeTelegramEndpointObservation -Port $Port -Result 'failed' -ElapsedMilliseconds $watch.Elapsed.TotalMilliseconds -LastSnapshot $last -ErrorMessage $primary.Exception.Message -TimeoutSeconds $TimeoutSeconds}catch{Write-Warning ('Telegram endpoint evidence unavailable: '+$_.Exception.Message)}
    throw $primary
  }
}
# Additive native acceptance draft: only invoked inside the already guarded isolated GUI flow.
function Get-NativeTelegramPortFixtureHash {
  param([byte[]]$Bytes)
  $algorithm=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$algorithm.Dispose()}
}
function ConvertTo-NativeTelegramPortFixtureState {
  param([byte[]]$ConfigurationBytes,[byte[]]$ProfileBytes)
  if($ConfigurationBytes.Length -lt 2 -or $ConfigurationBytes.Length -gt 65536 -or $ProfileBytes.Length -lt 2 -or $ProfileBytes.Length -gt 2097152){throw 'TG port fixture state exceeds its bounded read.'}
  $encoding=[Text.UTF8Encoding]::new($false,$true)
  $configOffset=if($ConfigurationBytes.Length -ge 3 -and $ConfigurationBytes[0] -eq 239 -and $ConfigurationBytes[1] -eq 187 -and $ConfigurationBytes[2] -eq 191){3}else{0}
  $profileOffset=if($ProfileBytes.Length -ge 3 -and $ProfileBytes[0] -eq 239 -and $ProfileBytes[1] -eq 187 -and $ProfileBytes[2] -eq 191){3}else{0}
  $config=$encoding.GetString($ConfigurationBytes,$configOffset,$ConfigurationBytes.Length-$configOffset) | ConvertFrom-Json
  $profile=$encoding.GetString($ProfileBytes,$profileOffset,$ProfileBytes.Length-$profileOffset) | ConvertFrom-Json
  if(($config.port -isnot [int] -and $config.port -isnot [long]) -or $config.port -lt 1024 -or $config.port -gt 65535 -or $config.host -cnotin @('127.0.0.1','::1') -or $profile.settings -isnot [pscustomobject]){throw 'TG port fixture requires confirmed loopback configuration and settings.'}
  $settings=[ordered]@{}
  foreach($property in @($profile.settings.PSObject.Properties | Sort-Object Name)){$settings[$property.Name]=$property.Value}
  $settingsBytes=$encoding.GetBytes(($settings | ConvertTo-Json -Depth 16 -Compress))
  if($settingsBytes.Length -gt 65536){throw 'TG port fixture settings exceed their fingerprint bound.'}
  return [ordered]@{port=[int]$config.port;host=[string]$config.host;configurationSha256=(Get-NativeTelegramPortFixtureHash $ConfigurationBytes);settingsSha256=(Get-NativeTelegramPortFixtureHash $settingsBytes);privateContentIncluded=$false}
}
function Get-NativeTelegramPortFixtureState {
  $config=Join-Path $script:DataRoot 'Runtime\TelegramProxy\config.json'
  $profile=Join-Path (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Egoist Shield') 'egoistshield-state.json'
  Assert-NativeOrdinaryPath -Path $config -Leaf
  [void](Assert-NativeAdministratorOwned $config)
  Assert-NativeOrdinaryPath -Path $profile -Leaf
  return ConvertTo-NativeTelegramPortFixtureState -ConfigurationBytes ([IO.File]::ReadAllBytes($config)) -ProfileBytes ([IO.File]::ReadAllBytes($profile))
}
function New-NativeTelegramOccupiedPortActor {
  param([ValidateRange(1024,65535)][int]$Port,[ValidateSet('127.0.0.1','::1')][string]$HostAddress)
  $listener=$null;$process=$null
  try{
    $process=[Diagnostics.Process]::GetCurrentProcess();$handle=$process.Handle
    if($handle -eq [IntPtr]::Zero){throw 'Own TG port fixture process handle unavailable.'}
    $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse($HostAddress),$Port)
    $listener.ExclusiveAddressUse=$true
    # .NET 10 reapplies socket options in Server getter; retain before binding.
    $socket=$listener.Server
    if($HostAddress -ceq '::1'){$socket.DualMode=$false}
    $listener.Start(4)
    $actor=[pscustomobject]@{listener=$listener;socket=$socket;socketHandle=$socket.Handle;process=$process;heldHandle=$handle;processId=$process.Id;createdUtc=$process.StartTime.ToUniversalTime().ToString('o');executable=$process.MainModule.FileName;port=$Port;host=$HostAddress;released=$false}
    [void](Get-NativeTelegramOccupiedPortActorIdentity -Actor $actor)
    return $actor
  }catch{if($listener){$listener.Stop()};if($process){$process.Dispose()};throw}
}
function Get-NativeTelegramOccupiedPortActorIdentity {
  param($Actor)
  $Actor.process.Refresh()
  if($Actor.released -or $Actor.process.HasExited -or $Actor.processId -ne $PID -or $Actor.process.Id -ne $Actor.processId -or $Actor.heldHandle -eq [IntPtr]::Zero -or $Actor.process.Handle -ne $Actor.heldHandle -or $Actor.process.MainModule.FileName -ine $Actor.executable -or $Actor.process.StartTime.ToUniversalTime().ToString('o') -cne $Actor.createdUtc -or $Actor.socketHandle -eq [IntPtr]::Zero -or $Actor.socket.Handle -ne $Actor.socketHandle -or -not $Actor.socket.IsBound){throw 'Own TG occupied-port actor identity changed.'}
  $endpoint=$Actor.socket.LocalEndPoint
  if($endpoint.Port -ne $Actor.port -or $endpoint.Address.ToString() -cne $Actor.host -or -not [Net.IPAddress]::IsLoopback($endpoint.Address)){throw 'Own TG occupied-port actor endpoint changed.'}
  return [ordered]@{processId=$Actor.processId;createdUtc=$Actor.createdUtc;executable=$Actor.executable;processHandleHeld=$true;port=$Actor.port;host=$Actor.host;listenerHeld=$true}
}
function Stop-NativeTelegramOccupiedPortActor {
  param($Actor)
  # Releases only the retained socket/process observation handle; never stops another process or service.
  if($Actor){try{$Actor.listener.Stop();$Actor.released=$true}finally{$Actor.process.Dispose()}}
}
function Assert-NativeTelegramOccupiedPortSnapshot {
  param($Value,[ValidateRange(1024,65535)][int]$Port,[ValidateSet('127.0.0.1','::1')][string]$HostAddress,[ValidateSet('missing','foreign')][string]$Expected,$ActorIdentity)
  if($Value.schemaVersion -ne 2 -or $Value.operation -cne 'telegram-listener-snapshot' -or $Value.serviceName -cne 'EgoistShieldTelegramProxy' -or $Value.port -ne $Port -or $Value.snapshotAvailable -isnot [bool] -or -not $Value.snapshotAvailable -or $Value.stable -isnot [bool] -or -not $Value.stable -or $Value.serviceState -cne 'Stopped' -or $Value.serviceProcessId -ne 0 -or $Value.managedProcessId -ne $null -or $Value.rootProcessPathVerified -isnot [bool] -or $Value.rootProcessPathVerified -or $Value.rootProcessCreatedAt -ne $null -or $Value.remoteConnectivityVerified -isnot [bool] -or $Value.remoteConnectivityVerified){throw 'TG conflict snapshot lacks stopped stable production identity.'}
  $snapshot=$Value.snapshot
  if(-not $snapshot -or $snapshot.stable -isnot [bool] -or -not $snapshot.stable -or $snapshot.serviceState -cne 'Stopped' -or $snapshot.serviceProcessId -ne 0 -or $Value.ownership -cne $Value.ipv4.state -or $Value.ipv6Ownership -cne $Value.ipv6.state){throw 'TG conflict snapshot contradicts SCM/family identity.'}
  $rows=@($snapshot.processes);$listeners=@($snapshot.listeners)
  if($rows.Count -gt 128 -or $listeners.Count -gt 128){throw 'TG conflict snapshot exceeds its row bound.'}
  $byId=@{}
  foreach($row in $rows){
    if(($row.processId -isnot [int] -and $row.processId -isnot [long]) -or $row.processId -lt 1 -or $row.processId -gt [int]::MaxValue -or $byId.ContainsKey([int]$row.processId)){throw 'TG conflict snapshot process rows are malformed or duplicated.'}
    $byId[[int]$row.processId]=$row
  }
  if($Expected -ceq 'missing'){
    if($listeners.Count -ne 0 -or $Value.ipv4.state -cne 'missing' -or $Value.ipv6.state -cne 'missing'){throw 'TG OFF did not release the actual port.'}
    return [ordered]@{state='missing';serviceStopped=$true;ready=$false;port=$Port}
  }
  if(-not $ActorIdentity -or $ActorIdentity.processHandleHeld -ne $true -or $ActorIdentity.listenerHeld -ne $true -or $ActorIdentity.port -ne $Port -or $ActorIdentity.host -cne $HostAddress -or $ActorIdentity.processId -lt 1 -or -not [IO.Path]::IsPathRooted([string]$ActorIdentity.executable)){throw 'TG conflict requires retained own actor identity.'}
  $family=if($HostAddress -ceq '127.0.0.1'){$Value.ipv4}else{$Value.ipv6}
  $other=if($HostAddress -ceq '127.0.0.1'){$Value.ipv6}else{$Value.ipv4}
  if($family.state -cne 'foreign' -or $other.state -cne 'missing' -or $family.ownerPid -ne $ActorIdentity.processId -or $family.rootPid -ne $null -or $family.rootCreatedAt -ne $null -or $listeners.Count -ne 1){throw 'TG conflict was not the sole retained foreign loopback listener.'}
  $listener=$listeners[0]
  if($listener.localPort -ne $Port -or $listener.localAddress -cne $HostAddress -or $listener.owningProcess -ne $ActorIdentity.processId){throw 'TG conflict listener does not belong to the retained own actor.'}
  $row=$byId[[int]$ActorIdentity.processId]
  if(-not $row -or $row.executablePath -ine $ActorIdentity.executable -or $family.ownerName -ine [IO.Path]::GetFileName([string]$ActorIdentity.executable) -or -not $row.createdAt -or -not $family.ownerCreatedAt){throw 'TG conflict owner path/birth proof unavailable.'}
  $birth=ConvertTo-NativeTelegramUtcInstant $row.createdAt
  if($birth -ne (ConvertTo-NativeTelegramUtcInstant $family.ownerCreatedAt) -or [Math]::Abs(($birth-(ConvertTo-NativeTelegramUtcInstant $ActorIdentity.createdUtc)).Ticks) -ge 10){throw 'TG conflict retained owner birth changed.'}
  return [ordered]@{state='foreign';serviceStopped=$true;ready=$false;port=$Port;host=$HostAddress;owner=$ActorIdentity;soleListenerVerified=$true}
}
function ConvertTo-NativeTelegramConflictGuiObservation {
  param([object[]]$TextRows,[int]$Port,[string]$HostAddress,[int]$GuiProcessId)
  if($TextRows.Count -gt 512){throw 'TG conflict GUI observation exceeds its text bound.'}
  $visible=@($TextRows | Where-Object {-not $_.offscreen})
  $title=@($visible | Where-Object {$_.name -ceq 'Действие не выполнено'})
  $reasonPattern='^Порт Telegram Proxy '+[Regex]::Escape($HostAddress)+':'+$Port+' занят '
  $reason=@($visible | Where-Object {[string]$_.name -cmatch $reasonPattern})
  $proxy=@($visible | Where-Object {$_.name -ceq 'Прокси'})
  $notReady=@($visible | Where-Object {$_.name -ceq 'не запущен'})
  $ready=@($visible | Where-Object {$_.name -ceq 'работает'})
  if($ready.Count -gt 0){throw 'TG GUI claims ready while its actual port is occupied.'}
  if($title.Count -ne 1 -or $reason.Count -ne 1 -or $proxy.Count -ne 1 -or $notReady.Count -ne 1){return $null}
  return [ordered]@{processId=$GuiProcessId;errorTitle='Действие не выполнено';configuredPortConflictVisible=$true;proxyLabel='не запущен';ready=$false;privateTextIncluded=$false}
}
function Get-NativeTelegramConflictGuiObservation {
  param($Root,$Process,[int]$Port,[string]$HostAddress)
  $Process.Refresh()
  if($Process.HasExited -or $Root.Current.ProcessId -ne $Process.Id){throw 'TG conflict observation lost the exact GUI identity.'}
  $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Text)
  $elements=$Root.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)
  if($elements.Count -gt 512){throw 'TG conflict GUI text collection exceeds its bound.'}
  $rows=@(foreach($element in $elements){[pscustomobject]@{name=[string]$element.Current.Name;offscreen=[bool]$element.Current.IsOffscreen}})
  return ConvertTo-NativeTelegramConflictGuiObservation -TextRows $rows -Port $Port -HostAddress $HostAddress -GuiProcessId $Process.Id
}
function Invoke-NativeTelegramOccupiedPort {
  param([scriptblock]$FindButton,$Process,$Root,$BeforeState)
  $port=[int]$BeforeState.port;$hostAddress=[string]$BeforeState.host;$actor=$null
  $result=[ordered]@{ok=$false;result='running';port=$port;host=$hostAddress;before=$BeforeState;actor=$null;beforeAttempt=$null;afterAttempt=$null;gui=$null;configurationPreserved=$false;settingsPreserved=$false;releasedOwnListener=$false;recovered=$null;remoteConnectivityVerified=$false}
  $script:Receipt.telegramOccupiedPort=$result;Save-NativeReceipt
  try{
    $empty=Read-NativeTelegramEndpointSnapshot -Port $port -TimeoutMilliseconds 30000
    [void](Assert-NativeTelegramOccupiedPortSnapshot -Value $empty -Port $port -HostAddress $hostAddress -Expected missing)
    Add-NativeMutation -Kind 'owned-loopback-occupied-port-fixture' -Target ($hostAddress+':'+$port) -Purpose 'Hold only the isolated test runner socket; genuine GUI/Core start must refuse the foreign listener.'
    $actor=New-NativeTelegramOccupiedPortActor -Port $port -HostAddress $hostAddress
    $result.actor=Get-NativeTelegramOccupiedPortActorIdentity -Actor $actor
    $snapshot=Read-NativeTelegramEndpointSnapshot -Port $port -TimeoutMilliseconds 30000
    $result.beforeAttempt=Assert-NativeTelegramOccupiedPortSnapshot -Value $snapshot -Port $port -HostAddress $hostAddress -Expected foreign -ActorIdentity (Get-NativeTelegramOccupiedPortActorIdentity -Actor $actor)
    $start=Wait-NativeCondition -Condition {& $FindButton 'Запустить'} -Label 'TG occupied port actual start control' -TimeoutSeconds 60
    if(Get-NativeTelegramGuiVisibleError -Root $Root){throw 'TG occupied-port attempt began with an earlier GUI failure.'}
    ([Windows.Automation.InvokePattern]$start.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    $result.gui=Wait-NativeCondition -Condition {Get-NativeTelegramConflictGuiObservation -Root $Root -Process $Process -Port $port -HostAddress $hostAddress} -Label 'TG actual occupied port refusal and honest unready GUI' -TimeoutSeconds 45 -StopOnError
    $snapshot=Read-NativeTelegramEndpointSnapshot -Port $port -TimeoutMilliseconds 30000
    $result.afterAttempt=Assert-NativeTelegramOccupiedPortSnapshot -Value $snapshot -Port $port -HostAddress $hostAddress -Expected foreign -ActorIdentity (Get-NativeTelegramOccupiedPortActorIdentity -Actor $actor)
    $current=Get-NativeTelegramPortFixtureState
    if($current.configurationSha256 -cne $BeforeState.configurationSha256 -or $current.settingsSha256 -cne $BeforeState.settingsSha256){throw 'TG conflict attempt changed retained configuration/settings.'}
    $result.configurationPreserved=$true;$result.settingsPreserved=$true
    $dismiss=Wait-NativeCondition -Condition {
      if(-not (Get-NativeTelegramGuiVisibleError -Root $Root)){return [pscustomobject]@{control=$null;alreadyGone=$true}}
      $button=& $FindButton 'Закрыть уведомление'
      if($button){return [pscustomobject]@{control=$button;alreadyGone=$false}}
    } -Label 'TG conflict genuine notification dismiss or observed expiry' -TimeoutSeconds 15
    if($dismiss.control){([Windows.Automation.InvokePattern]$dismiss.control.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()}
    $result.result='conflict-confirmed-awaiting-normal-recovery';Save-NativeReceipt
  }catch{$result.result='failed';$result.error=$_.Exception.Message;throw}
  finally{
    if($actor){Stop-NativeTelegramOccupiedPortActor -Actor $actor;$result.releasedOwnListener=$true}
    Save-NativeReceipt
  }
}

function Get-NativeTelegramGuiVisibleError {
  param($Root)
  $title='Действие не выполнено'
  $condition=[Windows.Automation.AndCondition]::new(
    [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Text),
    [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$title))
  foreach($element in $Root.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)){
    if($element.Current.ControlType -eq [Windows.Automation.ControlType]::Text -and $element.Current.Name -ceq $title -and -not $element.Current.IsOffscreen){return [ordered]@{title=$title;observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')}}
  }
  return $null
}
function Wait-NativeTelegramStoppedGuiCompletion {
  param([scriptblock]$FindButton,$Process,$Root,[string]$Label,[ValidateRange(1,45)][int]$TimeoutSeconds=45)
  return Wait-NativeCondition -Label ($Label+' actual Telegram stop operation completion') -TimeoutSeconds $TimeoutSeconds -StopOnError -Condition {
    $Process.Refresh();if($Process.HasExited){throw 'Actual GUI exited before Telegram stop operation completion.'}
    if($Root.Current.ProcessId -ne $Process.Id){throw 'Telegram stop completion observation root changed GUI identity.'}
    if(Get-NativeTelegramGuiVisibleError -Root $Root){throw 'Actual GUI reports failed Telegram stop operation: Действие не выполнено.'}
    $start=& $FindButton 'Запустить'
    if($start -and $start.Current.Name -ceq 'Запустить' -and $start.Current.IsEnabled -and -not $start.Current.IsOffscreen){return [ordered]@{name='Запустить';enabled=$true;processId=$Process.Id;observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')}}
  }
}
function Wait-NativeTelegramGuiCompletion {
  param([scriptblock]$FindButton,$Process,$Root,[string]$Label,[ValidateRange(1,45)][int]$TimeoutSeconds=45)
  return Wait-NativeCondition -Label ($Label+' actual Telegram operation completion') -TimeoutSeconds $TimeoutSeconds -StopOnError -Condition {
    $Process.Refresh();if($Process.HasExited){throw 'Actual GUI exited before Telegram operation completion.'}
    if($Root.Current.ProcessId -ne $Process.Id){throw 'Telegram completion observation root changed GUI identity.'}
    if(Get-NativeTelegramGuiVisibleError -Root $Root){throw 'Actual GUI reports failed Telegram operation: Действие не выполнено.'}
    $stop=& $FindButton 'Остановить'
    if($stop -and $stop.Current.Name -ceq 'Остановить' -and $stop.Current.IsEnabled -and -not $stop.Current.IsOffscreen){return [ordered]@{name='Остановить';enabled=$true;processId=$Process.Id;observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')}}
  }
}
function Assert-NativeGuiStartupTaskXml {
  param([string]$XmlText,$State,[bool]$ExpectedEnabled)
  if($State.owner -cne 'EgoistShield' -or $State.purpose -cne 'gui-login-startup' -or [string]$State.userSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$' -or $State.taskName -cne ('EgoistLagom-GuiAutostart-'+$State.userSid) -or $State.taskPath -cne ('\'+$State.taskName)){throw 'Native GUI startup task namespace/user is not exact.'}
  $xml=[Xml.XmlDocument]::new();$xml.XmlResolver=$null;$xml.LoadXml($XmlText)
  $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
  $principals=@($xml.SelectNodes('/t:Task/t:Principals/t:Principal',$ns));$actions=@($xml.SelectNodes('/t:Task/t:Actions/*',$ns));$triggers=@($xml.SelectNodes('/t:Task/t:Triggers/*',$ns))
  if($principals.Count -ne 1 -or $actions.Count -ne 1 -or $actions[0].LocalName -cne 'Exec' -or $triggers.Count -ne 1 -or $triggers[0].LocalName -cne 'LogonTrigger'){throw 'Native GUI startup task must have one interactive principal, exact executable action and logon trigger.'}
  $requirements=@{
    '/t:Task/t:RegistrationInfo/t:Author'='EgoistShield'
    '/t:Task/t:Principals/t:Principal/t:UserId'=[string]$State.userSid
    '/t:Task/t:Principals/t:Principal/t:LogonType'='InteractiveToken'
    '/t:Task/t:Principals/t:Principal/t:RunLevel'='HighestAvailable'
    '/t:Task/t:Triggers/t:LogonTrigger/t:UserId'=[string]$State.userSid
    '/t:Task/t:Triggers/t:LogonTrigger/t:Enabled'='true'
    '/t:Task/t:Actions/t:Exec/t:Command'=(Join-Path $script:InstallRoot 'EgoistShield.exe')
    '/t:Task/t:Actions/t:Exec/t:Arguments'='--background --minimized'
    '/t:Task/t:Actions/t:Exec/t:WorkingDirectory'=$script:InstallRoot
    '/t:Task/t:Settings/t:ExecutionTimeLimit'='PT0S'
    '/t:Task/t:Settings/t:MultipleInstancesPolicy'='IgnoreNew'
    '/t:Task/t:Settings/t:AllowStartOnDemand'='false'
    '/t:Task/t:Settings/t:Enabled'=if($ExpectedEnabled){'true'}else{'false'}
  }
  $defaults=@{'/t:Task/t:Settings/t:MultipleInstancesPolicy'='IgnoreNew';'/t:Task/t:Settings/t:Enabled'='true';'/t:Task/t:Triggers/t:LogonTrigger/t:Enabled'='true'}
  foreach($name in $requirements.Keys){
    $nodes=$xml.SelectNodes($name,$ns);if($nodes.Count -gt 1){throw ('Actual GUI startup Scheduler XML duplicates: '+$name)}
    $value=if($nodes.Count -eq 1){$nodes[0].InnerText}elseif($defaults.ContainsKey($name)){$defaults[$name]}else{$null}
    if($name -in @('/t:Task/t:Principals/t:Principal/t:UserId','/t:Task/t:Triggers/t:LogonTrigger/t:UserId')){
      if([string]::IsNullOrWhiteSpace($value)){throw 'Actual GUI startup user identity is missing.'}
      $value=if($value.StartsWith('S-',[StringComparison]::Ordinal)){[Security.Principal.SecurityIdentifier]::new($value).Value}else{([Security.Principal.NTAccount]::new($value)).Translate([Security.Principal.SecurityIdentifier]).Value}
    }
    if($value -cne $requirements[$name]){throw ('Actual GUI startup Scheduler XML differs: '+$name)}
  }
  $description=$xml.SelectNodes('/t:Task/t:RegistrationInfo/t:Description',$ns)
  if($description.Count -ne 1 -or $description[0].InnerText -cnotmatch '^Verified per-user Egoist Lagom GUI startup; RegistrationId=([a-f0-9]{32})$'){throw 'Actual GUI startup Scheduler protected registration nonce is missing.'}
  $registrationId=$Matches[1]
  $uri=$xml.SelectNodes('/t:Task/t:RegistrationInfo/t:URI',$ns)
  if($uri.Count -ne 1 -or ($uri[0].InnerText -cne ('egoistshield:gui-login-startup:v1:'+$State.userSid+':'+$registrationId) -and $uri[0].InnerText -cne $State.taskPath)){throw 'Actual GUI startup Scheduler registration URI differs from its exact protected identity/task path.'}
  return [ordered]@{highestAvailable=$true;interactiveToken=$true;userSid=$State.userSid;executionTimeLimit='PT0S';arguments='--background --minimized';enabled=$ExpectedEnabled;registrationId=$registrationId;description=$description[0].InnerText;uri=$uri[0].InnerText;actualLogonExecuted=$false;actualSettingsToggleInvoked=$false}
}
function Invoke-NativeGuiStartupOperation {
  param([ValidateSet('Sync','Verify')][string]$Operation,[ValidateSet('true','false')][string]$Enabled='false',[string]$Label,[bool]$ExpectedEnabled)
  $helper=Join-Path $script:InstallRoot 'resources\installer\gui-login-startup.ps1'
  [void](Assert-NativeAdministratorOwned $helper -InstallationPath)
  $invoke=Invoke-NativeBounded -Executable $script:NativePowerShell -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$helper,'-Operation',$Operation,'-Enabled',$Enabled) -Label $Label -TimeoutSeconds 45
  $state=$invoke.stdout | ConvertFrom-Json
  if($state.verified -isnot [bool] -or -not $state.verified -or $state.enabled -isnot [bool] -or $state.enabled -ne $ExpectedEnabled -or $state.suspended -isnot [bool] -or $state.suspended -or $state.userSid -cne $script:Receipt.elevatedGui.launch.token.userSid){throw 'Actual GUI startup public helper state differs from the verified elevated interactive user/intent.'}
  $record=[ordered]@{operation=$Operation;enabledArgument=$Enabled;state=$state;helperSha256=(Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash;actualLogonExecuted=$false;actualSettingsToggleInvoked=$false}
  if($ExpectedEnabled){
    $task=Get-ScheduledTask -TaskName $state.taskName -TaskPath '\' -ErrorAction Stop
    $xmlText=Export-ScheduledTask -TaskName $state.taskName -TaskPath '\' -ErrorAction Stop
    $record.scheduler=Assert-NativeGuiStartupTaskXml -XmlText $xmlText -State $state -ExpectedEnabled $true
    if($Operation -ceq 'Verify' -and $script:Receipt.guiStartup.operations.Count -gt 0 -and $record.scheduler.registrationId -cne $script:Receipt.guiStartup.operations[0].scheduler.registrationId){throw 'Restored GUI startup task registration differs from the originally authenticated enabled task.'}
    $file=Join-Path $script:Work ($Label+'.task.xml')
    [IO.File]::WriteAllText($file,$xmlText,[Text.UTF8Encoding]::new($false))
    $record.schedulerXml=[ordered]@{file=([IO.Path]::GetFileName($file));sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash;bytes=(Get-Item -LiteralPath $file).Length}
    $receipt=Join-Path $script:DataRoot ('GuiStartup\'+$state.userSid+'.json')
    $record.protectedReceipt=Assert-NativeAdministratorOwned $receipt
    $saved=Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
    if($saved.owner -cne 'EgoistShield' -or $saved.purpose -cne 'gui-login-startup' -or $saved.userSid -cne $state.userSid -or $saved.registrationId -cnotmatch '^[a-f0-9]{32}$' -or $record.scheduler.registrationId -cne $saved.registrationId){throw 'Actual GUI startup task registration is not bound to its protected owner receipt.'}
    if([string]$task.Principal.LogonType -cne 'Interactive' -or [string]$task.Principal.RunLevel -cne 'Highest'){throw 'Actual Scheduler principal readback is not highest interactive.'}
  }else{
    if(Get-ScheduledTask -TaskName $state.taskName -TaskPath '\' -ErrorAction SilentlyContinue){throw 'GUI startup disable did not remove the exact owned task.'}
    if(Test-Path -LiteralPath (Join-Path $script:DataRoot ('GuiStartup\'+$state.userSid+'.json'))){throw 'GUI startup disable retained the exact protected ownership receipt.'}
  }
  $script:Receipt.guiStartup.operations+=,$record;Save-NativeReceipt
  Assert-NativeNoGui;Assert-NativeNetworkPreserved $Label
  return $record
}
function Observe-NativeGuiStartupSuspension {
  if(-not $script:Receipt.Contains('guiStartup') -or $script:Receipt.guiStartup.disabledDuringTransaction){return}
  $state=$script:Receipt.guiStartup.operations[0].state
  $task=Get-ScheduledTask -TaskName $state.taskName -TaskPath '\' -ErrorAction Stop
  if($task.Settings.Enabled -ne $false){return}
  $receiptPath=Join-Path $script:DataRoot ('GuiStartup\'+$state.userSid+'.json')
  [void](Assert-NativeAdministratorOwned $receiptPath)
  $saved=Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  if($saved.owner -cne 'EgoistShield' -or $saved.purpose -cne 'gui-login-startup' -or $saved.userSid -cne $state.userSid -or $saved.suspended -ne $true -or $saved.resumeEnabled -ne $true){throw 'Disabled GUI startup task lacks its owned suspended enabled-intent receipt.'}
  $xmlText=Export-ScheduledTask -TaskName $state.taskName -TaskPath '\' -ErrorAction Stop
  $proof=Assert-NativeGuiStartupTaskXml -XmlText $xmlText -State $state -ExpectedEnabled $false
  if($proof.registrationId -cne $script:Receipt.guiStartup.operations[0].scheduler.registrationId -or $proof.registrationId -cne $saved.registrationId){throw 'Suspended GUI startup task registration no longer matches its original protected owner receipt.'}
  $file=Join-Path $script:Work 'gui-startup-suspended.task.xml'
  [IO.File]::WriteAllText($file,$xmlText,[Text.UTF8Encoding]::new($false))
  $script:Receipt.guiStartup.disabledDuringTransaction=$true
  $script:Receipt.guiStartup.suspension=[ordered]@{scheduler=$proof;receiptSha256=(Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash;schedulerXmlSha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash;observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')}
  Save-NativeReceipt
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
function Initialize-NativeCandidateInstallerHelpers {
  param([object]$Manifest,[string]$SourceRoot,[string]$Destination)
  Assert-NativeOrdinaryPath -Path $SourceRoot
  Assert-NativeOrdinaryPath -Path (Split-Path -Parent $Destination)
  if(Test-Path -LiteralPath $Destination){throw 'Candidate installer helper destination must be fresh.'}
  $files=@(
    @('invoke-final-silent-reinstall.ps1','scripts\invoke-final-silent-reinstall.ps1'),
    @('service-maintenance.ps1','src\installer\service-maintenance.ps1'),
    @('maintenance-boot-recovery.ps1','src\installer\maintenance-boot-recovery.ps1'),
    @('gui-login-startup.ps1','src\installer\gui-login-startup.ps1')
  )
  $prepared=@()
  foreach($pair in $files){
    $relative='resources/installer/'+$pair[0]
    $entries=@($Manifest.payload | Where-Object {$_.path -ceq $relative})
    if($entries.Count -ne 1 -or [string]$entries[0].sha256 -cnotmatch '^[a-fA-F0-9]{64}$' -or [long]$entries[0].bytes -le 3){throw 'Candidate helper payload identity is missing or ambiguous.'}
    $source=Join-Path $SourceRoot $pair[1];Assert-NativeOrdinaryPath -Path $source -Leaf
    $bytes=[IO.File]::ReadAllBytes($source)
    if($bytes.Length -lt 3 -or $bytes[0] -ne 0xef -or $bytes[1] -ne 0xbb -or $bytes[2] -ne 0xbf){$bytes=[byte[]](@(0xef,0xbb,0xbf)+$bytes)}
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try{$digest=([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-','')}finally{$algorithm.Dispose()}
    if($bytes.Length -ne [long]$entries[0].bytes -or $digest -ine [string]$entries[0].sha256){throw 'Current helper does not match immutable candidate payload bytes.'}
    $prepared+=@{name=$pair[0];bytes=$bytes;sha256=$digest;payloadPath=$relative}
  }
  New-Item -ItemType Directory -Path $Destination -ErrorAction Stop | Out-Null
  $inventory=@()
  foreach($file in $prepared){
    $target=Join-Path $Destination $file.name
    $stream=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$stream.Write($file.bytes,0,$file.bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ine $file.sha256){throw 'Candidate helper write failed immutable readback.'}
    $inventory+=[ordered]@{path=$target;payloadPath=$file.payloadPath;bytes=$file.bytes.Length;sha256=$file.sha256}
  }
  return [ordered]@{helper=(Join-Path $Destination 'invoke-final-silent-reinstall.ps1');inventory=$inventory;immutablePayloadMatched=$true}
}
function Assert-NativeProtectedStage {
  param([string]$Stage)
  $statePath=Join-Path $Stage 'state.json'
  [void](Assert-NativeAdministratorOwned $statePath)
  $state=Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
  if($state.schemaVersion -ne 1 -or $state.owner -cne 'EgoistShield' -or $state.version -cne $script:Version -or
    $state.sha256 -ine $script:InstallerHash -or [long]$state.bytes -ne (Get-Item -LiteralPath $script:Installer).Length -or
    $state.runAfter -isnot [bool] -or $state.runAfter -ne $false -or [IO.Path]::GetFullPath([string]$state.sourceInstaller) -ine $script:Installer -or
    [IO.Path]::GetFullPath([string]$state.installer) -ine (Join-Path $Stage ('EgoistShield-Setup-'+$script:Version+'.exe')) -or
    [IO.Path]::GetFullPath([string]$state.manifest) -ine (Join-Path $Stage 'package-integrity.json')){throw 'Protected stage does not identify the admitted immutable installer.'}
  $inventory=@()
  foreach($name in @('invoke-final-silent-reinstall.ps1','service-maintenance.ps1','maintenance-boot-recovery.ps1','gui-login-startup.ps1')){
    $entries=@($script:CandidateManifest.payload|Where-Object {$_.path -ceq ('resources/installer/'+$name)})
    if($entries.Count -ne 1){throw 'Protected helper payload is missing or ambiguous.'}
    $file=Join-Path $Stage $name;[void](Assert-NativeAdministratorOwned $file)
    $hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    if($hash -ine $entries[0].sha256 -or (Get-Item -LiteralPath $file).Length -ne [long]$entries[0].bytes){throw 'Protected helper does not match current immutable payload.'}
    $inventory+=[ordered]@{path=$file;sha256=$hash;bytes=[long]$entries[0].bytes}
  }
  foreach($file in @([string]$state.installer,[string]$state.manifest)){[void](Assert-NativeAdministratorOwned $file)}
  if((Get-FileHash -LiteralPath $state.installer -Algorithm SHA256).Hash -ine $script:InstallerHash -or
    (Get-FileHash -LiteralPath $state.manifest -Algorithm SHA256).Hash -ine (Get-FileHash -LiteralPath $script:ManifestPath -Algorithm SHA256).Hash){throw 'Protected staging changed admitted installer or manifest bytes.'}
  return [ordered]@{installerSha256=$script:InstallerHash;helpers=$inventory;runAfter=$false;currentPayloadMatched=$true}
}
function Assert-NativeProtectedCompletion {
  param([object]$Receipt,[string]$RunId,[string]$Flag)
  if($Flag.Trim() -cne 'success' -or $Receipt.schemaVersion -ne 1 -or $Receipt.owner -cne 'EgoistShield' -or $Receipt.runId -cne $RunId){throw 'Protected completion flag or receipt identity is unverified.'}
  $events=@($Receipt.events)
  $verified=@($events | Where-Object {$_.stage -ceq 'verify' -and $_.status -ceq 'succeeded'})
  $installers=@($events | Where-Object {$_.stage -ceq 'installer' -and $_.status -ceq 'installer-exited'})
  if($verified.Count -ne 1 -or $installers.Count -ne 1 -or ($installers[0].data.exitCode -isnot [int] -and $installers[0].data.exitCode -isnot [int64]) -or $installers[0].data.exitCode -ne 0){throw 'Protected completion lacks one verified installer exit and final readback.'}
  if(@($events | Where-Object {$_.status -in @('failed','recovery-pending','recovery-warning','recovering','recovered','desktop-launch-failed')}).Count -ne 0){throw 'Protected completion contains a failed or recovered transaction.'}
}
function Invoke-NativeProtectedReinstall {
  param([ValidateSet('same-version','upgrade-3.8.0')][string]$Operation='same-version')
  $key=if($Operation -eq 'upgrade-3.8.0'){'protectedUpgrade'}else{'reinstall'}
  $prefix=if($Operation -eq 'upgrade-3.8.0'){'protected-upgrade'}else{'reinstall'}
  $helper=Join-Path $script:InstallRoot 'resources\installer\invoke-final-silent-reinstall.ps1'
  $helperProof=$null
  if($Operation -eq 'upgrade-3.8.0'){
    # The old baseline helper is not substituted for the current tested payload.
    $helperProof=Initialize-NativeCandidateInstallerHelpers -Manifest $script:CandidateManifest -SourceRoot (Split-Path -Parent $PSScriptRoot) -Destination (Join-Path $script:Work 'candidate-installer-helpers')
    $helper=$helperProof.helper
  }
  Add-NativeMutation -Kind ('protected-'+$Operation) -Target $script:InstallRoot -Purpose 'Production handoff preserves owned services, private DNS, startup intent and settings.'
  $dispatch=Invoke-NativeBounded -Executable $script:NativePowerShell -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$helper,'-InstallerPath',$script:Installer,'-IntegrityManifestPath',$script:ManifestPath,'-ExpectedVersion',$script:Version,'-ExpectedSha256',$script:InstallerHash,'-FromVersion',$(if($Operation -eq 'upgrade-3.8.0'){'3.8.0'}else{$script:Version}),'-NoRunAfter','-DelaySeconds','8') -Label ($prefix+'-dispatch') -TimeoutSeconds 90
  $result=$dispatch.stdout | ConvertFrom-Json
  if($result.dispatched -isnot [bool] -or -not $result.dispatched -or [string]$result.runId -cnotmatch '^[a-f0-9]{32}$'){throw 'Production reinstall returned no protected run identity.'}
  $stage=Join-Path $script:DeferredRoot ([string]$result.runId)
  if([IO.Path]::GetFullPath([string]$result.state) -ine (Join-Path $stage 'state.json') -or [IO.Path]::GetFullPath([string]$result.receipt) -ine (Join-Path $stage 'receipt.json')){throw 'Production stage escaped its canonical root.'}
  [void](Assert-NativeAdministratorOwned $stage)
  $record=[ordered]@{stage=$stage;operation=$Operation;dispatched=$true;bootTask=$null;completed=$false;helperProof=$helperProof;diagnosticCopies=@()}
  $script:Receipt[$key]=$record;Save-NativeReceipt
  $taskName='EgoistShield-InstallerBootRecovery-'+[string]$result.runId;$watch=[Diagnostics.Stopwatch]::StartNew()
  try{
    do{
      Observe-NativeGuiStartupSuspension
      $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
      if($task -and -not $record.bootTask){
        $record.bootTask=Assert-NativeBootTask -Stage $stage
        $record.stageProof=Assert-NativeProtectedStage -Stage $stage
        foreach($name in @('state.json','boot-recovery.json','invoke-final-silent-reinstall.ps1','service-maintenance.ps1','maintenance-boot-recovery.ps1','gui-login-startup.ps1')){[void](Assert-NativeAdministratorOwned (Join-Path $stage $name))};Save-NativeReceipt
      }
      if(Test-Path -LiteralPath (Join-Path $stage 'complete.flag') -PathType Leaf){break};Start-Sleep -Milliseconds 200
    }while($watch.Elapsed.TotalSeconds -lt 900)
    if(-not (Test-Path -LiteralPath (Join-Path $stage 'complete.flag') -PathType Leaf)){throw 'Actual protected reinstall exceeded 15 minutes; production recovery state retained.'}
    $receipt=Get-Content -LiteralPath (Join-Path $stage 'receipt.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-NativeProtectedCompletion -Receipt $receipt -RunId ([string]$result.runId) -Flag ([IO.File]::ReadAllText((Join-Path $stage 'complete.flag')))
    if(-not $record.bootTask){throw 'Actual production SYSTEM Task registration was never observed.'}
    [void](Wait-NativeCondition -Condition {if(-not (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue)){return $true}} -Label 'Production Task unregistration' -TimeoutSeconds 30)
    if(Test-Path -LiteralPath (Join-Path $script:DataRoot 'installer\service-maintenance.json')){throw 'Protected completion retained the maintenance marker.'}
    $record.completed=$true;$record.elapsedMilliseconds=$dispatch.elapsedMilliseconds+$watch.ElapsedMilliseconds;$record.elapsedSeconds=[Math]::Round($watch.Elapsed.TotalSeconds,2);$record.taskRemoved=$true;Save-NativeReceipt
  }finally{
    foreach($name in @('receipt.json','state.json','boot-recovery.json','worker.stdout.log','worker.stderr.log')){
      $file=Join-Path $stage $name
      try{
        if(Test-Path -LiteralPath $file -PathType Leaf){Copy-Item -LiteralPath $file -Destination (Join-Path $script:Work ($prefix+'-'+$name));$record.diagnosticCopies+=@{name=$name;status='captured'}}
      }catch{$record.diagnosticCopies+=@{name=$name;status='unavailable';exceptionType=$_.Exception.GetType().FullName}}
    }
    try{Save-NativeReceipt}catch{Write-Warning 'Protected diagnostics receipt unavailable; original transaction failure retained.'}
  }
  return $record
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

function Measure-NativeIdleCore {
  param([ValidateSet('baseline-3.8.0','candidate')][string]$Label)
  Assert-NativeNoGui
  $others=@(Get-NativeProductServices | Where-Object { $_.Name -ne 'EgoistShieldCore' -and $_.State -eq 'Running' })
  if($others.Count){throw 'Idle Core comparison requires the same Core-only condition.'}
  $samples=@();$priorCpu=$null;$firstBirth=$null;$watch=[Diagnostics.Stopwatch]::StartNew()
  for($i=0;$i -lt 12;$i++){
    Assert-NativeNoGui
    $service=Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:Core -Running
    $identity=$service.process
    $held=Get-Process -Id ([int]$identity.processId) -ErrorAction Stop
    try{
      $handle=$held.Handle
      $birth=$held.StartTime.ToUniversalTime()
      if($handle -eq [IntPtr]::Zero -or $held.Path -ine $identity.executable -or [Math]::Abs(($birth-[DateTimeOffset]::Parse([string]$identity.createdUtc).UtcDateTime).Ticks) -gt 10){throw 'Paired resource sample path/birth changed.'}
      $key=[string]$held.Id+'|'+$birth.ToString('o')
      if($firstBirth -and $key -cne $firstBirth){throw 'Core restarted during the bounded idle comparison.'}
      $firstBirth=$key;$cpu=[double]$held.TotalProcessorTime.TotalSeconds
      $delta=if($null -eq $priorCpu){$null}else{$cpu-$priorCpu};$priorCpu=$cpu
      $samples+=[ordered]@{index=$i;utc=[DateTimeOffset]::UtcNow.ToString('o');elapsedSeconds=[Math]::Round($watch.Elapsed.TotalSeconds,3);processId=$held.Id;birthUtc=$birth.ToString('o');cpuTotalSeconds=$cpu;cpuDeltaSeconds=$delta;workingSetBytes=$held.WorkingSet64;privateMemoryBytes=$held.PrivateMemorySize64;handles=$held.HandleCount;threads=$held.Threads.Count}
    }finally{$held.Dispose()}
    if($i -lt 11){Start-Sleep -Seconds 5}
  }
  $measurement=[ordered]@{kind='actual-installed-idle-Core-only';label=$Label;sampleCount=12;intervalSeconds=5;actualGuiRunning=$false;otherProductServicesRunning=$false;coreImageSha256=(Get-FileHash -LiteralPath $script:Core -Algorithm SHA256).Hash;hostOs=[Environment]::OSVersion.VersionString;samples=$samples;limits='Sequential idle samples on the same disposable VM; descendants, GUI startup, network throughput and long-term memory growth excluded.'}
  if(-not $script:Receipt.Contains('pairedCoreResources')){$script:Receipt.pairedCoreResources=@()}
  $script:Receipt.pairedCoreResources+=$measurement
  Save-NativeReceipt
}

function Initialize-NativeUpgradeBaseline {
  param([string]$Installer)
  if(-not $Installer){return}
  $baseline=Assert-NativePathWithin -Path $Installer -Root $env:RUNNER_TEMP
  Assert-NativeOrdinaryPath -Path $baseline -Leaf
  $pin=[ordered]@{version='3.8.0';releaseId=401228861;assetId=608894669;bytes=277603619;sha256='771ba1adcfd4c24fcbee89c2e84d714099491ac97e9b4a6ba523031a03d27d81';origin='https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.8.0/EgoistShield-Setup-3.8.0.exe';originEvidence='GitHub release asset HTTPS metadata and immutable SHA-256; no published Ed25519 manifest exists for this baseline.'}
  if((Get-Item -LiteralPath $baseline).Length -ne $pin.bytes -or (Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash -ine $pin.sha256){throw 'Upgrade baseline differs from the exact official 3.8.0 artifact.'}
  Add-NativeMutation -Kind 'official-3.8.0-clean-install' -Target $script:InstallRoot -Purpose 'Authenticate original published artifact by exact asset ID/size/SHA and test a genuine 3.8.0 to candidate installer upgrade.'
  $result=Invoke-NativeBounded -Executable $baseline -Arguments @('/S') -Label 'baseline-3.8.0-clean-install' -TimeoutSeconds 600
  $version=[Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $script:InstallRoot 'EgoistShield.exe')).ProductVersion
  if($version -notin @('3.8.0','3.8.0.0')){throw 'Installed baseline is not actual 3.8.0.'}
  Assert-NativeNoGui;Assert-NativeNetworkPreserved 'original-3.8.0-install'
  Measure-NativeIdleCore -Label 'baseline-3.8.0'
  $userRoot=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Egoist Shield'
  if(-not (Test-Path -LiteralPath $userRoot)){New-Item -ItemType Directory -Path $userRoot | Out-Null}
  Assert-NativeOrdinaryPath $userRoot
  $profile=Join-Path $userRoot 'egoistshield-state.json'
  $data=[ordered]@{stateRevision=9;legacyMigrationVersion=1;nodes=@([ordered]@{id='synthetic-upgrade-node';name='Upgrade fixture';protocol='vless';server='upgrade.example.invalid';port=443;uri='vless://11111111-1111-4111-8111-111111111111@upgrade.example.invalid:443';metadata=@{id='11111111-1111-4111-8111-111111111111'}});activeNodeId='synthetic-upgrade-node';subscriptions=@([ordered]@{id='synthetic-upgrade-subscription';name='Local upgrade fixture';url='https://upgrade.example.invalid/never-requested';enabled=$false;lastUpdated=$null});processRules=@();domainRules=@();usageHistory=@();settings=[ordered]@{autoStart=$false;autoConnect=$false;autoUpdate=$false;systemDohEnabled=$false;systemDnsServers='';customDnsUrl='';allowTelemetry=$false;allowExternalGeoLookups=$false;privacyConsentVersion=1}}
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($data|ConvertTo-Json -Depth 12))
  foreach($file in @($profile,($profile+'.bak'))){if(Test-Path -LiteralPath $file){throw 'Fresh baseline unexpectedly contains a profile; refuse synthetic overwrite.'};[IO.File]::WriteAllBytes($file,$bytes)}
  $script:Receipt.upgradeBaseline=[ordered]@{artifact=$pin;actualInstalledVersion=$version;installerMilliseconds=$result.elapsedMilliseconds;primary=$profile;primarySha256=(Get-FileHash -LiteralPath $profile -Algorithm SHA256).Hash;backupSha256=(Get-FileHash -LiteralPath ($profile+'.bak') -Algorithm SHA256).Hash;syntheticOnly=$true;profileReadbacks=@();originalProfileBytesPreserved=$false;releaseManifestSignatureNotClaimed=$true}
  Save-NativeReceipt
}
function Assert-NativeUpgradeProfile {
  param([string]$Phase)
  if(-not $script:Receipt.Contains('upgradeBaseline')){return}
  $profile=$script:Receipt.upgradeBaseline.primary
  $saved=Get-Content -LiteralPath $profile -Raw | ConvertFrom-Json
  if(@($saved.nodes).Count -ne 1 -or $saved.nodes[0].id -cne 'synthetic-upgrade-node' -or $saved.activeNodeId -cne 'synthetic-upgrade-node' -or @($saved.subscriptions).Count -ne 1 -or $saved.subscriptions[0].id -cne 'synthetic-upgrade-subscription' -or $saved.settings.allowTelemetry -ne $false -or $saved.settings.autoConnect -ne $false){throw 'Actual upgrade or GUI activation changed saved synthetic profiles/intents.'}
  $current=(Get-FileHash -LiteralPath $profile -Algorithm SHA256).Hash
  $script:Receipt.upgradeBaseline.profileReadbacks+=[ordered]@{phase=$Phase;sha256=$current;identicalBytes=($current -ceq $script:Receipt.upgradeBaseline.primarySha256);nodesPreserved=$true;subscriptionsPreserved=$true}
  if($Phase -eq 'after-installer'){
    if($current -cne $script:Receipt.upgradeBaseline.primarySha256 -or (Get-FileHash -LiteralPath ($profile+'.bak') -Algorithm SHA256).Hash -cne $script:Receipt.upgradeBaseline.backupSha256){throw 'The candidate installer changed original primary/backup bytes.'}
    $script:Receipt.upgradeBaseline.originalProfileBytesPreserved=$true
  }
  Save-NativeReceipt
}

function Invoke-NativeAutonomousSoak {
  param([int]$Minutes,[int]$TelegramPort)
  if($Minutes -eq 0){return}
  Assert-NativeNoGui
  $watch=[Diagnostics.Stopwatch]::StartNew()
  $duration=$Minutes*60
  $samples=[Collections.Generic.List[object]]::new()
  $cpuByBirth=@{}
  $script:Receipt.autonomousSoak=[ordered]@{kind='actual-Core-and-Telegram-without-GUI';requestedMinutes=$Minutes;startedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');sampleIntervalSeconds=30;result='running';samples=@();otherModulesSoakVerified=$false;longerUptimeClaim=$false}
  Save-NativeReceipt
  try{
    do{
      Assert-NativeNoGui
      $core=Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:Core -Running
      $telegram=Assert-NativeTelegramEndpoint -Port $TelegramPort
      $observations=@()
      foreach($service in @($core,$telegram.service)){
        if(-not $service){continue}
        $identity=$service.process
        if(-not $identity -or [int]$identity.processId -le 0){throw 'Soak service process identity is unavailable.'}
        $held=Get-Process -Id ([int]$identity.processId) -ErrorAction Stop
        try{
          # Resource counters belong to the same path/birth already accepted by the SCM gate.
          if($held.Path -ine [string]$identity.executable -or [Math]::Abs(($held.StartTime.ToUniversalTime()-[DateTimeOffset]::Parse([string]$identity.createdUtc).UtcDateTime).Ticks) -gt 10){throw 'Soak resource identity changed during inspection.'}
          $birthKey=[string]$held.Id+'|'+[string]$identity.createdUtc
          $cpu=[double]$held.TotalProcessorTime.TotalSeconds
          $delta=if($cpuByBirth.ContainsKey($birthKey)){$cpu-[double]$cpuByBirth[$birthKey]}else{$null}
          $cpuByBirth[$birthKey]=$cpu
          $observations+=[ordered]@{processId=$held.Id;createdUtc=$identity.createdUtc;path=$held.Path;cpuTotalSeconds=$cpu;cpuDeltaSeconds=$delta;workingSetBytes=$held.WorkingSet64;privateMemoryBytes=$held.PrivateMemorySize64;handles=$held.HandleCount;threads=$held.Threads.Count}
        }finally{$held.Dispose()}
      }
      $samples.Add([ordered]@{observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');elapsedSeconds=[Math]::Round($watch.Elapsed.TotalSeconds,3);coreProcessId=$core.process.processId;telegramReady=$true;resources=$observations})
      $script:Receipt.autonomousSoak.samples=$samples.ToArray()
      Save-NativeReceipt
      $remaining=$duration-$watch.Elapsed.TotalSeconds
      if($remaining -gt 0){Start-Sleep -Milliseconds ([int]([Math]::Min(30,$remaining)*1000))}
    }while($watch.Elapsed.TotalSeconds -lt $duration)
    Assert-NativeNoGui;Assert-NativeNetworkPreserved 'autonomous-soak'
    $script:Receipt.autonomousSoak.result='passed'
    $script:Receipt.autonomousSoak.elapsedSeconds=[Math]::Round($watch.Elapsed.TotalSeconds,3)
    $script:Receipt.autonomousSoak.finishedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    $script:Receipt.checks+=[ordered]@{name='actual-autonomous-Core-Telegram-soak';ok=$true;minutes=$Minutes;elapsedSeconds=$script:Receipt.autonomousSoak.elapsedSeconds;sampleCount=$samples.Count;DNSandDPI=$false;months=$false}
    Save-NativeReceipt
  }catch{
    $script:Receipt.autonomousSoak.result='failed';$script:Receipt.autonomousSoak.elapsedSeconds=[Math]::Round($watch.Elapsed.TotalSeconds,3);Save-NativeReceipt;throw
  }
}

function Assert-NativeCleanStart {
  if(@(Get-NativeProductServices).Count -ne 0){throw 'Existing product/shared-name services make clean acceptance unsafe.'}
  if(@(Get-NativeProductTasks).Count -ne 0){throw 'Existing product Tasks make clean acceptance unsafe.'}
  foreach($target in @($script:InstallRoot,$script:DataRoot,$script:InstallerDataRoot,(Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Egoist Lagom'),(Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Egoist Shield'),(Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'EgoistShield'))){if(Test-Path -LiteralPath $target){throw "Existing product directory makes acceptance unsafe: $target"}}
  if(@(Get-NativeCimSnapshot Win32_Process | Where-Object {$_.Name -match '^Egoist(?:Shield|Lagom)'}).Count -ne 0){throw 'Existing product processes make acceptance unsafe.'}
  foreach($path in @('SOFTWARE\EgoistShield','SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield')){
    $key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($path)
    if($key){$key.Dispose();throw "Existing product registration makes acceptance unsafe: $path"}
  }
}
function Assert-NativeNetworkGuiReceipts {
  param($Receipt,[string]$SourceCommit,[string]$InstalledGuiPath,[string]$ExpectedIntegritySha256)
  if($SourceCommit -cnotmatch '^[a-f0-9]{40}$' -or $ExpectedIntegritySha256 -cnotmatch '^[a-fA-F0-9]{64}$'){throw 'Network GUI source/integrity identity is invalid.'}
  $launches=@($Receipt.gui | Where-Object {($_.PSObject.Properties.Name -contains 'launch') -and $null -ne $_.launch})
  $cleanups=@($Receipt.gui | Where-Object {($_.PSObject.Properties.Name -contains 'cleanup') -and $null -ne $_.cleanup})
  if($launches.Count -ne 2 -or $cleanups.Count -ne 2 -or @($launches.operation | Select-Object -Unique).Count -ne 2){throw 'Network GUI requires two distinct operations and exactly two paired normal-close receipts.'}
  foreach($entry in $launches){
    $proof=$entry.launch
    if($proof.launchPolicy -cne 'elevated' -or $proof.elevatedGui -ne $true -or $proof.guiRequestedExecutionLevel -cne 'asInvoker'){throw 'Network GUI launch does not prove the protected UAC entry and current-token policy.'}
    Assert-NativeElevatedGuiTokenProof -Token $proof.token -RunnerToken $proof.runnerToken
    if($proof.executable -ine $InstalledGuiPath -or @($proof.arguments).Count -ne 0 -or $proof.source.commit -cne $SourceCommit -or $proof.artifactSourceCommit -cne $SourceCommit -or $proof.harnessSourceCommit -cne $SourceCommit -or $proof.source.version -cne $Receipt.candidateVersion -or [string]$proof.source.integrityManifestSha256 -cnotmatch '^[a-fA-F0-9]{64}$' -or $proof.source.integrityManifestSha256 -ine $ExpectedIntegritySha256){throw 'Network GUI launch identity differs from the exact installed signed source/payload.'}
    if(($proof.processId -isnot [int] -and $proof.processId -isnot [long]) -or $proof.processId -le 0 -or [string]::IsNullOrWhiteSpace([string]$proof.startTimeUtc)){throw 'Network GUI launched process birth identity is absent.'}
    $paired=@($cleanups | Where-Object {$_.operation -ceq $entry.operation -and $_.cleanup.launch.processId -eq $proof.processId -and $_.cleanup.launch.startTimeUtc -ceq $proof.startTimeUtc})
    if($paired.Count -ne 1){throw 'Network GUI normal close is not bound to the same operation/process birth.'}
    $final=$paired[0].cleanup
    if($final.stage -cne 'completed' -or $final.exitedNormally -isnot [bool] -or -not $final.exitedNormally -or ($final.exitCode -isnot [int] -and $final.exitCode -isnot [long]) -or $final.exitCode -ne 0 -or $final.cleanup.noOrphans -isnot [bool] -or -not $final.cleanup.noOrphans -or ($final.cleanup.activeProcesses -isnot [int] -and $final.cleanup.activeProcesses -isnot [long]) -or $final.cleanup.activeProcesses -ne 0){throw 'Network GUI lacks normal exit zero and zero-orphan job readback.'}
    if($final.launch.launchPolicy -cne 'elevated' -or $final.launch.elevatedGui -ne $true -or $final.launch.source.commit -cne $SourceCommit -or $final.launch.executable -ine $InstalledGuiPath){throw 'Network GUI cleanup launch proof differs from the elevated source identity.'}
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
      $rawReceipt=Get-Content -LiteralPath $path -Raw
      $receipt=if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){ConvertFrom-Json -InputObject $rawReceipt -DateKind String}else{ConvertFrom-Json -InputObject $rawReceipt}
      if($receipt.sourceCommit -cne $script:SourceCommit -or $receipt.candidateVersion -cne $script:Version){throw 'Network gate receipt differs from the actual installed candidate.'}
      if($kind -eq 'dns'){
        if($receipt.kind -cne 'actual-native-elevated-gui-windows-doh' -or $receipt.result -cne 'passed' -or $receipt.guardian.stage -cne 'disarmed'){throw 'Actual DNS gate did not pass with normal restoration.'}
        $name='System DNS from elevated GUI, persistence and restoration'
      }else{
        if($receipt.kind -cne 'actual-hosted-production-background-vpn-native-acceptance' -or $receipt.status -cne 'passed' -or $receipt.nativeAcceptancePassed -ne $true -or @($receipt.cleanup.errors).Count){throw 'Actual VPN gate did not pass with verified normal cleanup.'}
        $name='Background VPN native TUN, recovery and elevated GUI OFF'
      }
      Assert-NativeNetworkGuiReceipts -Receipt $receipt -SourceCommit $script:SourceCommit -InstalledGuiPath (Join-Path $script:InstallRoot 'EgoistShield.exe') -ExpectedIntegritySha256 (Get-FileHash -LiteralPath $script:ManifestPath -Algorithm SHA256).Hash
      $gate=@($script:Receipt.releaseGates | Where-Object {$_.name -ceq $name})
      if($gate.Count -ne 1){throw 'Network release gate identity is ambiguous.'}
      $gate[0].status='passed';$gate[0].reason='Actual installed candidate, elevated high/admin GUI with exact source/executable/process birth, paired normal close and zero-orphan cleanup, and independent native readback; detailed receipt retained.'
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
  $script:CandidateManifest=$manifest
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
    guiLaunchContract=[ordered]@{managementMode='administrator-required';guiManifest='asInvoker';workerManifest='asInvoker';authorization='protected native Windows UAC entry; actual High administrator Core token contract';restrictedTokenAcceptanceRequested=$false;normalUacPromptObserved=$false};startedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');result='running';cleanStartVerified=$true;mutations=@();checks=@();gui=@();networkReadbacks=@();privateStateReadbacks=@();beforeNetwork=(Get-NativeNetworkFingerprint);releaseReady=$false
    releaseGates=@(
      [ordered]@{name='Reboot/interrupted installation SYSTEM recovery';status='not-tested';reason='A live hosted runner cannot reboot within this job. Actual Task registration/principal/action/removal are exercised.'},
      [ordered]@{name='System DNS from elevated GUI, persistence and restoration';status='not-tested';reason='Separate actual installed DNS gate must pass.'},
      [ordered]@{name='Background VPN native TUN, recovery and elevated GUI OFF';status='not-tested';reason='Separate actual installed VPN gate must pass.'},
      [ordered]@{name='Driver-backed Zapret end-to-end';status='not-tested';reason='No unrelated driver or default-route filtering on the hosted control connection.'},
      [ordered]@{name='3.7.9 legacy worker automatic update chain';status='not-tested';reason='Requires separately authenticated official old Setup and signed candidate release feed; new-helper same-version reinstall does not prove it.'},
      [ordered]@{name='3.7.7 and 3.7.8 update trust compatibility';status='not-tested';reason='No authenticated legacy update chain is asserted.'},
      [ordered]@{name='GUI IPC from an actual elevated Windows user token';status='not-tested';reason='Requires actual administrator GUI token/source identity, genuine service Stop/Start IPC, LocalSystem worker and normal close.'},
      [ordered]@{name='72 hour/7 day soak/month-scale uptime';status='not-tested';reason='Bounded native acceptance is not a long-duration pilot.'}
    )
  };Save-NativeReceipt
  $uninstalled=$false;$primaryError=$null
  try{
    Initialize-NativeUpgradeBaseline -Installer $UpgradeBaselineInstaller
    $mutationKind=if($UpgradeBaselineInstaller){'official-3.8.0-to-candidate-upgrade'}else{'setup-clean-install'}
    Add-NativeMutation -Kind $mutationKind -Target $script:InstallRoot -Purpose 'Actual generated candidate silent installation or original-version upgrade.'
    if($UpgradeBaselineInstaller){$install=Invoke-NativeProtectedReinstall -Operation 'upgrade-3.8.0'}
    else{$install=Invoke-NativeBounded -Executable $script:Installer -Arguments @('/S') -Label 'clean-install' -TimeoutSeconds 600}
    $installKind=if($UpgradeBaselineInstaller){'actual-original-3.8.0-to-candidate-installer-upgrade'}else{'actual-generated-setup-clean-install'}
    $script:Receipt.checks+=[ordered]@{name=$installKind;ok=$true;milliseconds=$install.elapsedMilliseconds}
    Assert-NativeUpgradeProfile 'after-installer'
    $acls=@();foreach($relative in @('','EgoistShield.exe','EgoistShield.Worker.exe','resources','resources\app.asar','resources\component-worker.cjs','resources\worker-host-integrity.json','resources\core-service\win-x64\EgoistShield.Service.exe')){$acls+=Assert-NativeAdministratorOwned (Join-Path $script:InstallRoot $relative) -InstallationPath};$script:Receipt.acls=$acls
    $options=[ordered]@{installRoot=$script:InstallRoot;integrity=$script:ManifestPath;sourceCommit=$script:SourceCommit;version=$script:Version;output=(Join-Path $script:Work 'installed-payload.json')}
    $optionsPath=Join-Path $script:Work 'installed-payload.options.json';$options | ConvertTo-Json | Set-Content -LiteralPath $optionsPath -Encoding utf8
    [void](Invoke-NativeBounded -Executable $script:Node -Arguments @($script:NodeHelper,'verify-payload',$optionsPath) -Label 'installed-payload' -TimeoutSeconds 180)
    $script:Receipt.elevation=Assert-NativeGuiElevation
    $script:Receipt.checks+=[ordered]@{name='actual-installed-payload-fuses-asar-worker-inventory-acls-and-administrator-gui-manifest';ok=$true;receipt='installed-payload.json'}
    $script:Receipt.core=Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:Core -Running;$script:Receipt.corePolicy=Get-NativeRecoveryPolicy 'EgoistShieldCore'
    Assert-NativeNoGui;Assert-NativeNetworkPreserved 'clean-install'
    if($UpgradeBaselineInstaller){Measure-NativeIdleCore -Label 'candidate'}
    $gui=Invoke-NativeGui -Action 'provision-telegram' -Label 'gui-provision';Assert-NativeNoGui
    Assert-NativeUpgradeProfile 'after-first-GUI'
    $port=[int]$gui.installResult.portConflict.port
    $script:Receipt.telegramWithoutGui=Assert-NativeTelegramEndpoint -Port $port;$script:Receipt.telegramPolicy=Get-NativeRecoveryPolicy 'EgoistShieldTelegramProxy'
    $script:Receipt.checks+=[ordered]@{name='actual-production-gui-ipc-telegram-persists-after-gui-quit';ok=$true};Assert-NativeNetworkPreserved 'gui-close'
    Invoke-NativeElevatedGui
    Invoke-NativeNetworkGates
    Stop-NativeVerifiedCoreForRecovery;Assert-NativeNoGui
    $script:Receipt.telegramAfterCoreCrash=Assert-NativeTelegramEndpoint -Port $port;Assert-NativeNetworkPreserved 'core-crash-recovery'
    New-NativePrivateStateFixture;Assert-NativePrivateState 'before-private-backup'
    $script:Receipt.guiStartup=[ordered]@{kind='actual-packaged-gui-startup-helper-task-lifecycle';operations=@();disabledDuringTransaction=$false;restoredAfterReinstall=$false;actualLogonExecuted=$false;actualSettingsToggleInvoked=$false}
    Add-NativeMutation -Kind 'actual-owned-gui-startup-opt-in-task' -Target 'current verified interactive user' -Purpose 'Actual packaged public Sync/Verify helper and Task Scheduler highest interactive readback; no logon is provoked.'
    [void](Invoke-NativeGuiStartupOperation -Operation Sync -Enabled true -Label 'gui-startup-enable' -ExpectedEnabled $true)
    Set-NativeOwnedLegacyLayer;[void](Invoke-NativeProtectedReinstall)
    if(-not $script:Receipt.guiStartup.disabledDuringTransaction){throw 'Enabled GUI startup task was not actually observed suspended during the reinstall transaction.'}
    [void](Invoke-NativeGuiStartupOperation -Operation Verify -Label 'gui-startup-after-reinstall' -ExpectedEnabled $true)
    $script:Receipt.guiStartup.restoredAfterReinstall=$true;Save-NativeReceipt
    [void](Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:Core -Running);[void](Get-NativeRecoveryPolicy 'EgoistShieldCore');[void](Get-NativeRecoveryPolicy 'EgoistShieldTelegramProxy')
    $script:Receipt.telegramAfterReinstall=Assert-NativeTelegramEndpoint -Port $port
    if((Get-FileHash -LiteralPath $script:Receipt.inactiveVpnFixture.path -Algorithm SHA256).Hash -cne $script:Receipt.inactiveVpnFixture.sha256){throw 'Actual upgrade changed private inactive VPN filesystem fixture.'}
    Assert-NativePrivateState 'after-private-state-preservation'
    Assert-NativeUpgradeProfile 'after-protected-reinstall'
    $script:Receipt.elevationMigration=Assert-NativeGuiElevation -MigrationExpected
    Assert-NativeNoGui;Assert-NativeNetworkPreserved 'protected-reinstall'
    [void](Invoke-NativeGui -Action 'check-telegram' -Label 'gui-after-reinstall');Assert-NativeNoGui
    $script:Receipt.checks+=[ordered]@{name='actual-protected-reinstall-with-recovery-services-and-system-task-registration-roundtrip';ok=$true;actualReboot=$false}
    [void](Invoke-NativeGuiStartupOperation -Operation Sync -Enabled false -Label 'gui-startup-disable' -ExpectedEnabled $false)
    $script:Receipt.checks+=[ordered]@{name='actual-packaged-gui-startup-highest-interactive-enable-suspend-restore-disable';ok=$true;actualLogonExecuted=$false;actualSettingsToggleInvoked=$false};Save-NativeReceipt
    Invoke-NativeAutonomousSoak -Minutes $SoakMinutes -TelegramPort $port
    $uninstaller=Join-Path $script:InstallRoot 'Uninstall Egoist Shield.exe'
    [void](Assert-NativeAdministratorOwned $uninstaller -InstallationPath)
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

if($LibraryOnly -and $TraceReadonlyBootstrap){[Console]::Error.WriteLine('readonly-library|shared|definitions-ready|'+$nativeReadonlyBootstrapClock.ElapsedMilliseconds)}
if($LibraryOnly){return}
Invoke-NativeAcceptance
