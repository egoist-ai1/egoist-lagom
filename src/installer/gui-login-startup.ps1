param(
  [Alias('Operation')][ValidateSet('Sync','Verify','CleanupLegacy')][string]$GuiStartupOperation = '',
  [Alias('Enabled')][ValidateSet('true','false')][string]$GuiStartupEnabled = 'false'
)
# Dot-sourcing this module defines functions only. GUI calls a fixed installed helper.

function Get-GuiStartupProgramFilesRoot {
  if([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess){
    $base=$null;$key=$null
    try{$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64);$key=$base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion');$value=[string]$key.GetValue('ProgramFilesDir');if(-not [IO.Path]::IsPathRooted($value)){throw 'Native Program Files directory is unavailable.'};return $value}
    finally{if($key){$key.Dispose()};if($base){$base.Dispose()}}
  }
  return [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
}
function Get-GuiStartupCanonicalRoot {
  return [IO.Path]::GetFullPath((Join-Path (Get-GuiStartupProgramFilesRoot) 'EgoistShield')).TrimEnd('\')
}
function Get-GuiStartupDataRoot {
  return Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)) 'EgoistShield\GuiStartup'
}
function Get-GuiStartupContext {
  param([Parameter(Mandatory=$true)][string]$UserSid)
  if ($UserSid -cnotmatch '^S-1-(?:5-21|12-1)(?:-[0-9]+){4}$' -or [Security.Principal.SecurityIdentifier]::new($UserSid).Value -cne $UserSid) { throw 'GUI startup requires a canonical interactive account SID.' }
  $root = Get-GuiStartupCanonicalRoot
  $name = 'EgoistLagom-GuiAutostart-' + $UserSid
  return [pscustomobject]@{root=$root;exe=(Join-Path $root 'EgoistShield.exe');helper=(Join-Path $root 'resources\installer\gui-login-startup.ps1');sid=$UserSid;taskName=$name;taskPath=('\'+$name);dataRoot=(Get-GuiStartupDataRoot);receipt=(Join-Path (Get-GuiStartupDataRoot) ($UserSid+'.json'));sddl='O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)'}
}
function Assert-GuiStartupPlainPath {
  param([string]$Path)
  $current=[IO.Path]::GetFullPath($Path)
  while ($current) {
    $item=Get-Item -LiteralPath $current -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'GUI startup refuses reparse points.' }
    $current=[IO.Path]::GetDirectoryName($current.TrimEnd('\'))
  }
}
function Assert-GuiStartupProtectedPath {
  param([string]$Path,[string]$Root,[switch]$Receipt)
  Assert-GuiStartupPlainPath $Path
  $current=[IO.Path]::GetFullPath($Path); $boundary=[IO.Path]::GetFullPath($Root).TrimEnd('\')
  if ($current -ne $boundary -and -not $current.StartsWith($boundary+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'GUI startup protected path escaped its root.' }
  $trusted=@('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  $mutable=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  while ($true) {
    $acl=Get-Acl -LiteralPath $current -ErrorAction Stop
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted -or ($Receipt -and -not $acl.AreAccessRulesProtected)) { throw 'GUI startup path owner or DACL is untrusted.' }
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -eq 'Allow' -and ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and $rule.IdentityReference.Value -notin $trusted -and ($rule.FileSystemRights -band $mutable) -ne 0) { throw 'A non-administrator can modify the GUI startup path.' }
    }
    if ($current.Equals($boundary,[StringComparison]::OrdinalIgnoreCase)) { break }
    $current=[IO.Path]::GetDirectoryName($current)
  }
}
function Initialize-GuiStartupReceiptDirectory {
  param([object]$Context)
  $base=[IO.Path]::GetDirectoryName($Context.dataRoot)
  foreach ($directory in @($base,$Context.dataRoot)) {
    if (-not (Test-Path -LiteralPath $directory)) {
      Assert-GuiStartupPlainPath ([IO.Path]::GetDirectoryName($directory))
      $acl=[Security.AccessControl.DirectorySecurity]::new()
      $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));$acl.SetAccessRuleProtection($true,$false)
      foreach($sid in @('S-1-5-18','S-1-5-32-544')) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow')) }
      [IO.DirectoryInfo]::new($directory).Create($acl)
    }
    Assert-GuiStartupProtectedPath -Path $directory -Root $base
  }
  Assert-GuiStartupProtectedPath -Path $Context.dataRoot -Root $Context.dataRoot -Receipt
}
function Assert-GuiStartupInteractiveIdentity {
  param([string]$TokenSid,[string]$SessionSid,[int]$SessionId,[bool]$IsAdministrator)
  if(-not $IsAdministrator){throw 'GUI startup registration requires the normal UAC-elevated application.'}
  if($SessionId -le 0){throw 'GUI startup cannot be registered from a service session.'}
  if($TokenSid -cne $SessionSid){throw 'GUI startup refuses credentials belonging to a different session user.'}
  [void](Get-GuiStartupContext $TokenSid)
}
function Get-GuiStartupInteractiveIdentity {
  if (-not ('EgoistGuiStartupNative' -as [type])) {
    Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class EgoistGuiStartupNative {
 [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool WTSQuerySessionInformation(IntPtr server,int session,int info,out IntPtr buffer,out int bytes);
 [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr value);
 static string Query(int session,int info) { IntPtr value;int bytes;if(!WTSQuerySessionInformation(IntPtr.Zero,session,info,out value,out bytes))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());try{return Marshal.PtrToStringUni(value)??"";}finally{WTSFreeMemory(value);} }
 public static string Account(int session) { string user=Query(session,5),domain=Query(session,7);if(String.IsNullOrWhiteSpace(user))throw new InvalidOperationException("No interactive session account.");return String.IsNullOrWhiteSpace(domain)?user:domain+"\\"+user; }
}
"@ -ErrorAction Stop
  }
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  try {
    if (-not [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'GUI startup registration requires the normal UAC-elevated application.' }
    $session=[Diagnostics.Process]::GetCurrentProcess().SessionId
    if ($session -le 0) { throw 'GUI startup cannot be registered from a service session.' }
    $sessionSid=[Security.Principal.NTAccount]::new([EgoistGuiStartupNative]::Account($session)).Translate([Security.Principal.SecurityIdentifier]).Value
    Assert-GuiStartupInteractiveIdentity -TokenSid $identity.User.Value -SessionSid $sessionSid -SessionId $session -IsAdministrator $true
    return $sessionSid
  } finally { $identity.Dispose() }
}
function Get-GuiStartupHash {
  param([IO.Stream]$Stream)
  $algorithm=[Security.Cryptography.SHA256]::Create()
  try {return ([BitConverter]::ToString($algorithm.ComputeHash($Stream))).Replace('-','').ToLowerInvariant()} finally {$algorithm.Dispose()}
}
function Assert-GuiStartupInstallation {
  param([object]$Context,[switch]$RequireCanonicalHelper,[switch]$HelperOnly)
  if ($RequireCanonicalHelper -and -not [IO.Path]::GetFullPath($PSCommandPath).Equals($Context.helper,[StringComparison]::OrdinalIgnoreCase)) { throw 'GUI startup requires its canonical installed helper.' }
  $programFiles=Get-GuiStartupProgramFilesRoot
  $leases=[Collections.Generic.List[IO.Stream]]::new()
  try {
    $inventory=Join-Path $Context.root 'resources\worker-host-integrity.json'
    Assert-GuiStartupProtectedPath -Path $inventory -Root $programFiles
    $input=[IO.File]::Open($inventory,'Open','Read','Read');[void]$leases.Add($input)
    if ($input.Length -gt 1048576) { throw 'GUI startup inventory exceeds its limit.' }
    $reader=[IO.StreamReader]::new($input,[Text.Encoding]::UTF8,$true,4096,$true)
    try {$record=$reader.ReadToEnd() | ConvertFrom-Json -ErrorAction Stop} finally {$reader.Dispose()}
    if ($record.schemaVersion -ne 1 -or $record.owner -cne 'EgoistShield' -or @($record.files).Count -lt 1 -or @($record.files).Count -gt 1024) { throw 'GUI startup inventory identity is invalid.' }
    $seen=@{};$selected=@{}
    foreach($entry in $record.files) {
      $relative=[string]$entry.path
      if (-not $relative -or $relative.Length -gt 512 -or $relative -match '[\\:\x00-\x1f]' -or $relative.StartsWith('/') -or @($relative.Split('/') | Where-Object { -not $_ -or $_ -in @('.','..') -or $_.EndsWith(' ') -or $_.EndsWith('.') }).Count -gt 0 -or $seen.ContainsKey($relative)) { throw 'GUI startup inventory path is invalid or duplicate.' }
      $seen[$relative]=$true
      if (@($entry.roles | Where-Object {$_ -ceq 'gui'}).Count -eq 0 -or ($HelperOnly -and $relative -cne 'resources/installer/gui-login-startup.ps1')) {continue}
      if ([long]$entry.bytes -lt 0 -or [long]$entry.bytes -gt 1073741824 -or [string]$entry.sha256 -cnotmatch '^[a-f0-9]{64}$') {throw 'GUI startup checksum metadata is invalid.'}
      $file=Join-Path $Context.root $relative.Replace('/','\')
      Assert-GuiStartupProtectedPath -Path $file -Root $programFiles
      $stream=[IO.File]::Open($file,'Open','Read','Read');[void]$leases.Add($stream)
      if ($stream.Length -ne [long]$entry.bytes -or (Get-GuiStartupHash $stream) -cne [string]$entry.sha256) {throw 'GUI startup target does not match its authenticated installation inventory.'}
      $selected[$relative]=$true
    }
    $requiredFiles=if($HelperOnly){@('resources/installer/gui-login-startup.ps1')}else{@('EgoistShield.exe','resources/app.asar','resources/installer/gui-login-startup.ps1')}
    foreach($required in $requiredFiles) {if (-not $selected.ContainsKey($required)) {throw 'GUI startup target/helper inventory is incomplete.'}}
    if(-not $HelperOnly){foreach($file in Get-ChildItem -LiteralPath $Context.root -File -ErrorAction Stop) {if ($file.Extension -ieq '.dll' -and -not $selected.ContainsKey($file.Name)) {throw 'GUI startup refuses an unpinned side-loaded DLL.'}}}
    return $leases
  } catch {foreach($lease in $leases){$lease.Dispose()};throw}
}
function Invoke-GuiStartupLease {
  param([scriptblock]$Action)
  $security=[Security.AccessControl.MutexSecurity]::new();$security.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));$security.SetAccessRuleProtection($true,$false)
  foreach($sid in @('S-1-5-18','S-1-5-32-544')) {$security.AddAccessRule([Security.AccessControl.MutexAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','Allow'))}
  $created=$false;$mutex=[Threading.Mutex]::new($false,'Global\EgoistLagom.GuiStartup',[ref]$created,$security);$acquired=$false
  try {
    $acl=$mutex.GetAccessControl()
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544') -or -not $acl.AreAccessRulesProtected) {throw 'GUI startup mutex ownership is untrusted.'}
    foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {if ($rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')) {throw 'GUI startup mutex permits a foreign principal.'}}
    try {$acquired=$mutex.WaitOne(8000)} catch [Threading.AbandonedMutexException] {$acquired=$true}
    if (-not $acquired) {throw 'GUI startup synchronization is busy.'}
    & $Action
  } finally {if($acquired){$mutex.ReleaseMutex()};$mutex.Dispose()}
}
function Read-GuiStartupReceipt {
  param([object]$Context)
  if (-not (Test-Path -LiteralPath $Context.receipt)) {return $null}
  Assert-GuiStartupProtectedPath -Path $Context.receipt -Root $Context.dataRoot -Receipt
  if ((Get-Item -LiteralPath $Context.receipt -ErrorAction Stop).Length -gt 32768) {throw 'GUI startup receipt exceeds its limit.'}
  $record=[IO.File]::ReadAllText($Context.receipt,[Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop
  if ($record.schemaVersion -ne 1 -or $record.owner -cne 'EgoistShield' -or $record.purpose -cne 'gui-login-startup' -or [string]$record.userSid -cne $Context.sid -or [string]$record.taskName -cne $Context.taskName -or [string]$record.executable -cne $Context.exe -or [string]$record.registrationId -cnotmatch '^[a-f0-9]{32}$' -or $record.suspended -isnot [bool] -or $record.resumeEnabled -isnot [bool]) {throw 'GUI startup receipt identity is untrusted.'}
  return $record
}
function Write-GuiStartupReceipt {
  param([object]$Context,[object]$Record)
  Initialize-GuiStartupReceiptDirectory $Context
  if(Test-Path -LiteralPath $Context.receipt){[void](Read-GuiStartupReceipt $Context)}
  $security=[Security.AccessControl.FileSecurity]::new();$security.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));$security.SetAccessRuleProtection($true,$false)
  foreach($sid in @('S-1-5-18','S-1-5-32-544')) {$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','Allow'))}
  $temporary=Join-Path $Context.dataRoot ([Guid]::NewGuid().ToString('N')+'.tmp');$stream=$null
  try {
    $stream=[IO.FileStream]::new($temporary,'CreateNew',[Security.AccessControl.FileSystemRights]::Write,'None',4096,[IO.FileOptions]::WriteThrough,$security)
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Record | ConvertTo-Json -Depth 5));$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true);$stream.Dispose();$stream=$null
    if(Test-Path -LiteralPath $Context.receipt){[IO.File]::Replace($temporary,$Context.receipt,$null)}else{[IO.File]::Move($temporary,$Context.receipt)}
    [void](Read-GuiStartupReceipt $Context)
  } finally {if($stream){$stream.Dispose()};if(Test-Path -LiteralPath $temporary){[IO.File]::Delete($temporary)}}
}
function New-GuiStartupTaskXml {
  param([object]$Context,[object]$Receipt,[bool]$TaskEnabled)
  $sid=[Security.SecurityElement]::Escape($Context.sid);$exe=[Security.SecurityElement]::Escape($Context.exe);$root=[Security.SecurityElement]::Escape($Context.root)
  $enabledText=if($TaskEnabled){'true'}else{'false'}
  return @"
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Author>EgoistShield</Author><URI>egoistshield:gui-login-startup:v1:$sid`:$($Receipt.registrationId)</URI><Description>Verified per-user Egoist Lagom GUI startup; RegistrationId=$($Receipt.registrationId)</Description></RegistrationInfo><Triggers><LogonTrigger><Enabled>true</Enabled><UserId>$sid</UserId></LogonTrigger></Triggers><Principals><Principal id="Gui"><UserId>$sid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>false</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><AllowStartOnDemand>false</AllowStartOnDemand><Enabled>$enabledText</Enabled><Hidden>false</Hidden><RunOnlyIfIdle>false</RunOnlyIfIdle><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>7</Priority></Settings><Actions Context="Gui"><Exec><Command>$exe</Command><Arguments>--background --minimized</Arguments><WorkingDirectory>$root</WorkingDirectory></Exec></Actions></Task>
"@
}
function ConvertFrom-GuiStartupXml {
  param([string]$Xml)
  if (-not $Xml -or $Xml.Length -gt 262144) {throw 'GUI startup task XML exceeds its limit.'}
  $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null
  $reader=[Xml.XmlReader]::Create([IO.StringReader]::new($Xml),$settings)
  try {$document=[Xml.XmlDocument]::new();$document.XmlResolver=$null;$document.Load($reader);return $document} finally {$reader.Dispose()}
}
function Assert-GuiStartupTaskProtection {
  param([string]$Descriptor)
  $sd=[Security.AccessControl.RawSecurityDescriptor]::new($Descriptor)
  if ($sd.Owner.Value -notin @('S-1-5-18','S-1-5-32-544') -or -not $sd.DiscretionaryAcl -or ($sd.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -eq 0) {throw 'GUI startup task DACL is unprotected.'}
  $full=@{}
  foreach($ace in $sd.DiscretionaryAcl) {
    if ($ace -isnot [Security.AccessControl.CommonAce] -or $ace.AceQualifier -ne 'AccessAllowed' -or $ace.SecurityIdentifier.Value -notin @('S-1-5-18','S-1-5-32-544')) {throw 'GUI startup task grants foreign access.'}
    if (($ace.AccessMask -band 0x1f01ff) -eq 0x1f01ff -or ($ace.AccessMask -band 0x10000000) -ne 0) {$full[$ace.SecurityIdentifier.Value]=$true}
  }
  if (-not $full.ContainsKey('S-1-5-18') -or -not $full.ContainsKey('S-1-5-32-544')) {throw 'GUI startup task lacks administrator/SYSTEM control.'}
}
function Resolve-GuiStartupAccountSid {
  param([string]$Account)
  if([string]::IsNullOrWhiteSpace($Account) -or $Account.Length -gt 512){throw 'GUI startup account identity is missing or exceeds its limit.'}
  try {
    if($Account.StartsWith('S-',[StringComparison]::Ordinal)){
      $sid=[Security.Principal.SecurityIdentifier]::new($Account)
      if($sid.Value -cne $Account){throw 'Noncanonical SID.'}
      return $sid.Value
    }
    return ([Security.Principal.NTAccount]::new($Account)).Translate([Security.Principal.SecurityIdentifier]).Value
  }catch{throw 'GUI startup account cannot be resolved to an exact Windows SID.'}
}
function Assert-GuiStartupTaskOwned {
  param([object]$Context,[object]$Receipt,[object]$Task,[Nullable[bool]]$ExpectedEnabled)
  if (-not $Receipt -or -not $Task -or [string]$Receipt.registrationId -cnotmatch '^[a-f0-9]{32}$' -or $Task.Name -cne $Context.taskName -or $Task.Path -cne $Context.taskPath -or (Resolve-GuiStartupAccountSid ([string]$Task.PrincipalUserId)) -cne $Context.sid -or $Task.PrincipalLogonType -ne 3) {throw 'GUI startup task ownership is unverified.'}
  if ($null -ne $ExpectedEnabled -and $Task.Enabled -ne $ExpectedEnabled) {throw 'GUI startup enabled readback mismatch.'}
  Assert-GuiStartupTaskProtection ([string]$Task.SecurityDescriptor)
  $actual=ConvertFrom-GuiStartupXml $Task.Xml;$expected=ConvertFrom-GuiStartupXml (New-GuiStartupTaskXml $Context $Receipt ([bool]$Task.Enabled))
  $ns=[Xml.XmlNamespaceManager]::new($actual.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
  $en=[Xml.XmlNamespaceManager]::new($expected.NameTable);$en.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
  foreach($selection in @('/t:Task/t:RegistrationInfo','/t:Task/t:Principals','/t:Task/t:Principals/t:Principal','/t:Task/t:Triggers','/t:Task/t:Triggers/t:LogonTrigger','/t:Task/t:Actions','/t:Task/t:Actions/t:Exec','/t:Task/t:Settings')) {if($actual.SelectNodes($selection,$ns).Count -ne 1){throw 'GUI startup XML contains ambiguous sections.'}}
  if($actual.SelectSingleNode('/t:Task/t:Triggers',$ns).ChildNodes.Count -ne 1 -or $actual.SelectSingleNode('/t:Task/t:Actions',$ns).ChildNodes.Count -ne 1 -or $actual.SelectSingleNode('/t:Task/t:Principals',$ns).ChildNodes.Count -ne 1) {throw 'GUI startup XML contains extra actions, triggers or principals.'}
  foreach($selection in @('/t:Task/t:RegistrationInfo/t:Author','/t:Task/t:RegistrationInfo/t:Description','/t:Task/t:Principals/t:Principal/@id','/t:Task/t:Principals/t:Principal/t:UserId','/t:Task/t:Principals/t:Principal/t:LogonType','/t:Task/t:Principals/t:Principal/t:RunLevel','/t:Task/t:Triggers/t:LogonTrigger/t:UserId','/t:Task/t:Actions/@Context','/t:Task/t:Actions/t:Exec/t:Command','/t:Task/t:Actions/t:Exec/t:Arguments','/t:Task/t:Actions/t:Exec/t:WorkingDirectory')) {
    $nodes=$actual.SelectNodes($selection,$ns);$wanted=$expected.SelectSingleNode($selection,$en)
    if($nodes.Count -ne 1){throw 'GUI startup XML does not match its protected receipt/action.'}
    if($selection -in @('/t:Task/t:Principals/t:Principal/t:UserId','/t:Task/t:Triggers/t:LogonTrigger/t:UserId')){
      if((Resolve-GuiStartupAccountSid $nodes[0].InnerText) -cne $Context.sid){throw 'GUI startup XML user does not resolve to its protected interactive SID.'}
    }elseif($nodes[0].InnerText -cne $wanted.InnerText){throw 'GUI startup XML does not match its protected receipt/action.'}
  }
  $uri=$actual.SelectNodes('/t:Task/t:RegistrationInfo/t:URI',$ns)
  if($uri.Count -ne 1 -or ($uri[0].InnerText -cne $expected.SelectSingleNode('/t:Task/t:RegistrationInfo/t:URI',$en).InnerText -and $uri[0].InnerText -cne $Context.taskPath)){throw 'GUI startup task URI differs from its protected registration or exact canonical task path.'}
  $triggerEnabled=$actual.SelectNodes('/t:Task/t:Triggers/t:LogonTrigger/t:Enabled',$ns)
  if($triggerEnabled.Count -gt 1 -or ($triggerEnabled.Count -eq 1 -and $triggerEnabled[0].InnerText -cne 'true')){throw 'GUI startup logon trigger must be enabled.'}
  foreach($parent in @('/t:Task/t:Principals/t:Principal','/t:Task/t:Triggers/t:LogonTrigger','/t:Task/t:Actions/t:Exec')) {
    $allowed=@($expected.SelectSingleNode($parent,$en).ChildNodes | ForEach-Object {$_.LocalName})
    foreach($node in $actual.SelectSingleNode($parent,$ns).ChildNodes) {if($node.LocalName -notin $allowed){throw 'GUI startup XML contains an unsupported principal, trigger or action field.'}}
  }
  # Missing fields use only Microsoft Task Scheduler schema defaults, never
  # the application's preference. PT0S/battery/start-demand overrides stay required.
  # https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-schema
  $defaults=@{MultipleInstancesPolicy='IgnoreNew';DisallowStartIfOnBatteries='true';StopIfGoingOnBatteries='true';AllowHardTerminate='true';StartWhenAvailable='false';RunOnlyIfNetworkAvailable='false';AllowStartOnDemand='true';Enabled='true';Hidden='false';RunOnlyIfIdle='false';WakeToRun='false';ExecutionTimeLimit='PT72H';Priority='7'}
  foreach($node in $expected.SelectSingleNode('/t:Task/t:Settings',$en).ChildNodes) {
    $nodes=$actual.SelectNodes('/t:Task/t:Settings/t:'+$node.LocalName,$ns)
    if($nodes.Count -gt 1){throw 'GUI startup settings contain duplicate fields.'}
    $value=if($nodes.Count -eq 1){$nodes[0].InnerText}else{$defaults[$node.LocalName]}
    if($value -cne $node.InnerText){throw 'GUI startup settings readback mismatch.'}
  }
  if($actual.SelectNodes('/t:Task/t:Settings/t:RestartOnFailure',$ns).Count -gt 0 -or $actual.SelectNodes('/t:Task/t:Settings/t:DeleteExpiredTaskAfter',$ns).Count -gt 0) {throw 'GUI startup refuses restart loops and expiry.'}
}
function Invoke-GuiStartupScheduler {
  param([ValidateSet('Read','Create','SetEnabled','Remove')][string]$Action,[object]$Context,[string]$Xml,[bool]$TaskEnabled,[string]$ExpectedXml,[string]$ExpectedDescriptor)
  $service=$null;$folder=$null;$task=$null;$definition=$null;$principal=$null
  try {
    $service=New-Object -ComObject 'Schedule.Service';$service.Connect();$folder=$service.GetFolder('\')
    if($Action -eq 'Create'){[void]$folder.RegisterTask($Context.taskName,$Xml,18,$Context.sid,$null,3,$Context.sddl);return}
    try{$task=$folder.GetTask($Context.taskName)}catch{$errorObject=$_.Exception;while($errorObject.InnerException){$errorObject=$errorObject.InnerException};if($errorObject.HResult -eq -2147024894){return $null};throw}
    if($Action -in @('SetEnabled','Remove')){
      if(-not $task -or [string]$task.Xml -cne $ExpectedXml -or [string]$task.GetSecurityDescriptor(7) -cne $ExpectedDescriptor){throw 'GUI startup task changed before mutation.'}
      if($Action -eq 'Remove'){$folder.DeleteTask($Context.taskName,0)}else{$task.Enabled=$TaskEnabled};return
    }
    $definition=$task.Definition;$principal=$definition.Principal
    return [pscustomobject]@{Name=[string]$task.Name;Path=[string]$task.Path;Enabled=[bool]$task.Enabled;Xml=[string]$task.Xml;SecurityDescriptor=[string]$task.GetSecurityDescriptor(7);PrincipalUserId=[string]$principal.UserId;PrincipalLogonType=[int]$principal.LogonType}
  }finally{foreach($instance in @($principal,$definition,$task,$folder,$service)){if($null -ne $instance -and [Runtime.InteropServices.Marshal]::IsComObject($instance)){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($instance)}}}
}
function Get-GuiStartupVerifiedState {
  param([object]$Context)
  $task=Invoke-GuiStartupScheduler -Action Read -Context $Context;$receipt=Read-GuiStartupReceipt $Context
  if($task){Assert-GuiStartupTaskOwned $Context $receipt $task}
  return [pscustomobject]@{schemaVersion=1;owner='EgoistShield';purpose='gui-login-startup';userSid=$Context.sid;taskName=$Context.taskName;taskPath=$Context.taskPath;enabled=[bool]($task -and $task.Enabled);verified=$true;suspended=[bool]($receipt -and $receipt.suspended)}
}
function Sync-GuiLoginStartup {
  param([object]$Context,[bool]$Enable)
  $maintenance=Join-Path ([IO.Path]::GetDirectoryName($Context.dataRoot)) 'installer\service-maintenance.json'
  if(Test-Path -LiteralPath $maintenance){throw 'GUI startup cannot change during protected installer maintenance.'}
  $task=Invoke-GuiStartupScheduler -Action Read -Context $Context;$receipt=Read-GuiStartupReceipt $Context
  if($task){Assert-GuiStartupTaskOwned $Context $receipt $task}
  if($receipt -and $receipt.suspended){throw 'GUI startup is suspended by an unfinished installer transaction.'}
  if($Enable){
    if(-not $receipt){$receipt=[pscustomobject]@{schemaVersion=1;owner='EgoistShield';purpose='gui-login-startup';userSid=$Context.sid;taskName=$Context.taskName;executable=$Context.exe;registrationId=[Guid]::NewGuid().ToString('N');suspended=$false;resumeEnabled=$false};Write-GuiStartupReceipt $Context $receipt}
    if(-not $task){Invoke-GuiStartupScheduler -Action Create -Context $Context -Xml (New-GuiStartupTaskXml $Context $receipt $false);$task=Invoke-GuiStartupScheduler -Action Read -Context $Context;Assert-GuiStartupTaskOwned $Context $receipt $task -ExpectedEnabled $false}
    if(-not $task.Enabled){Invoke-GuiStartupScheduler -Action SetEnabled -Context $Context -TaskEnabled $true -ExpectedXml $task.Xml -ExpectedDescriptor $task.SecurityDescriptor}
    $task=Invoke-GuiStartupScheduler -Action Read -Context $Context;Assert-GuiStartupTaskOwned $Context $receipt $task -ExpectedEnabled $true
  }else{
    if($task){Invoke-GuiStartupScheduler -Action Remove -Context $Context -ExpectedXml $task.Xml -ExpectedDescriptor $task.SecurityDescriptor}
    if(Invoke-GuiStartupScheduler -Action Read -Context $Context){throw 'GUI startup removal readback failed.'}
    if($receipt){[void](Read-GuiStartupReceipt $Context);[IO.File]::Delete($Context.receipt)}
  }
  return Get-GuiStartupVerifiedState $Context
}
function Get-OwnedGuiStartupContexts {
  $root=Get-GuiStartupDataRoot
  if(-not (Test-Path -LiteralPath $root)){return}
  Assert-GuiStartupProtectedPath -Path $root -Root $root -Receipt
  $files=@(Get-ChildItem -LiteralPath $root -Filter '*.json' -File -ErrorAction Stop)
  if($files.Count -gt 1024){throw 'GUI startup receipt inventory exceeds its limit.'}
  foreach($file in $files){$context=Get-GuiStartupContext $file.BaseName;[void](Read-GuiStartupReceipt $context);$context}
}
function Suspend-OwnedGuiLoginStartup {
  if(-not (Test-Path -LiteralPath (Get-GuiStartupDataRoot))){return}
  Invoke-GuiStartupLease {
    foreach($context in @(Get-OwnedGuiStartupContexts)){
      $receipt=Read-GuiStartupReceipt $context;$task=Invoke-GuiStartupScheduler -Action Read -Context $context
      if(-not $task){continue};Assert-GuiStartupTaskOwned $context $receipt $task
      if(-not $receipt.suspended){$receipt.suspended=$true;$receipt.resumeEnabled=[bool]$task.Enabled;Write-GuiStartupReceipt $context $receipt}
      if($task.Enabled){Invoke-GuiStartupScheduler -Action SetEnabled -Context $context -TaskEnabled $false -ExpectedXml $task.Xml -ExpectedDescriptor $task.SecurityDescriptor}
      Assert-GuiStartupTaskOwned $context $receipt (Invoke-GuiStartupScheduler -Action Read -Context $context) -ExpectedEnabled $false
    }
  }
}
function Resume-OwnedGuiLoginStartup {
  if(Test-Path -LiteralPath (Join-Path ([IO.Path]::GetDirectoryName((Get-GuiStartupDataRoot))) 'installer\service-maintenance.json')){return}
  if(-not (Test-Path -LiteralPath (Get-GuiStartupDataRoot))){return}
  Invoke-GuiStartupLease {
    $leases=@()
    try{
      foreach($context in @(Get-OwnedGuiStartupContexts)){
        $receipt=Read-GuiStartupReceipt $context
        if(-not $receipt.suspended){continue}
        $task=Invoke-GuiStartupScheduler -Action Read -Context $context
        if(-not $task){throw 'Suspended GUI startup task is missing; foreign changes are preserved.'}
        Assert-GuiStartupTaskOwned $context $receipt $task
        $leases=@(Assert-GuiStartupInstallation $context)
        if($task.Enabled -ne $receipt.resumeEnabled){Invoke-GuiStartupScheduler -Action SetEnabled -Context $context -TaskEnabled $receipt.resumeEnabled -ExpectedXml $task.Xml -ExpectedDescriptor $task.SecurityDescriptor}
        Assert-GuiStartupTaskOwned $context $receipt (Invoke-GuiStartupScheduler -Action Read -Context $context) -ExpectedEnabled $receipt.resumeEnabled
        $receipt.suspended=$false;$receipt.resumeEnabled=$false;Write-GuiStartupReceipt $context $receipt
        foreach($lease in $leases){$lease.Dispose()};$leases=@()
      }
    }finally{foreach($lease in $leases){$lease.Dispose()}}
  }
}
function Remove-OwnedGuiLoginStartup {
  if(-not (Test-Path -LiteralPath (Get-GuiStartupDataRoot))){return}
  Invoke-GuiStartupLease {
    foreach($context in @(Get-OwnedGuiStartupContexts)){
      $receipt=Read-GuiStartupReceipt $context;$task=Invoke-GuiStartupScheduler -Action Read -Context $context
      if($task){Assert-GuiStartupTaskOwned $context $receipt $task;Invoke-GuiStartupScheduler -Action Remove -Context $context -ExpectedXml $task.Xml -ExpectedDescriptor $task.SecurityDescriptor}
      if(Invoke-GuiStartupScheduler -Action Read -Context $context){throw 'GUI startup uninstall readback failed.'}
      [void](Read-GuiStartupReceipt $context);[IO.File]::Delete($context.receipt)
    }
  }
}
function Remove-OwnedLegacyGuiLoginStartup {
  param([object]$Context)
  $legacy=[pscustomobject]@{taskName='EgoistShieldStartup';taskPath='\EgoistShieldStartup'}
  $task=Invoke-GuiStartupScheduler -Action Read -Context $legacy
  if(-not $task){return @()}
  $xml=ConvertFrom-GuiStartupXml $task.Xml;$ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
  $exec=$xml.SelectNodes('/t:Task/t:Actions/t:Exec',$ns);$principal=$xml.SelectNodes('/t:Task/t:Principals/t:Principal',$ns)
  try{$legacySid=Resolve-GuiStartupAccountSid ([string]$task.PrincipalUserId)}catch{return @()}
  if($task.Name -cne $legacy.taskName -or $task.Path -cne $legacy.taskPath -or $legacySid -cne $Context.sid -or $task.PrincipalLogonType -ne 3 -or $exec.Count -ne 1 -or $principal.Count -ne 1 -or $xml.SelectSingleNode('/t:Task/t:Actions',$ns).ChildNodes.Count -ne 1 -or $exec[0].SelectSingleNode('t:Command',$ns).InnerText -cne $Context.exe -or $exec[0].SelectSingleNode('t:Arguments',$ns).InnerText -cne '--background --minimized' -or $xml.SelectSingleNode('/t:Task/t:RegistrationInfo/t:Author',$ns).InnerText -cne 'EgoistShield'){return @()}
  # Legacy registrations have no ownership receipt: never retire a mutable/foreign ACL.
  Assert-GuiStartupTaskProtection ([string]$task.SecurityDescriptor)
  Invoke-GuiStartupScheduler -Action Remove -Context $legacy -ExpectedXml $task.Xml -ExpectedDescriptor $task.SecurityDescriptor
  if(Invoke-GuiStartupScheduler -Action Read -Context $legacy){throw 'Owned legacy GUI startup task removal readback failed.'}
  return @($legacy.taskName)
}
if($GuiStartupOperation){
  $ErrorActionPreference='Stop';$leases=@()
  try{
    $canonicalHelper=Join-Path (Get-GuiStartupCanonicalRoot) 'resources\installer\gui-login-startup.ps1'
    if(-not [IO.Path]::GetFullPath($PSCommandPath).Equals($canonicalHelper,[StringComparison]::OrdinalIgnoreCase)){throw 'GUI startup requires its canonical installed helper.'}
    $context=Get-GuiStartupContext (Get-GuiStartupInteractiveIdentity)
    $leases=@(Assert-GuiStartupInstallation $context -RequireCanonicalHelper -HelperOnly)
    $fast=$false;$result=$null
    if($GuiStartupOperation -ceq 'Sync' -and $GuiStartupEnabled -ceq 'false'){
      $task=Invoke-GuiStartupScheduler -Action Read -Context $context
      $receipt=Read-GuiStartupReceipt $context
      if(-not $task -and -not $receipt){$result=Get-GuiStartupVerifiedState $context;$fast=$true}
    }elseif($GuiStartupOperation -ceq 'CleanupLegacy'){
      $legacy=Invoke-GuiStartupScheduler -Action Read -Context ([pscustomobject]@{taskName='EgoistShieldStartup'})
      if(-not $legacy){$result=[pscustomobject]@{removed=@()};$fast=$true}
    }
    if(-not $fast){
      foreach($lease in $leases){$lease.Dispose()};$leases=@(Assert-GuiStartupInstallation $context -RequireCanonicalHelper)
      $result=Invoke-GuiStartupLease {
        switch($GuiStartupOperation){'Sync'{Sync-GuiLoginStartup $context ($GuiStartupEnabled -ceq 'true')};'Verify'{Get-GuiStartupVerifiedState $context};'CleanupLegacy'{[pscustomobject]@{removed=@(Remove-OwnedLegacyGuiLoginStartup $context)}}}
      }
    }
    $result | ConvertTo-Json -Depth 5 -Compress
  }catch{Write-Error $_;exit 1}finally{foreach($lease in $leases){$lease.Dispose()}}
}
