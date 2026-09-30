param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$root=[IO.Path]::GetFullPath($TestDirectory)
if (-not $root.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Use task-owned test files.' }
$project=Split-Path -Parent $PSScriptRoot
$module=Join-Path $project 'src\installer\maintenance-boot-recovery.ps1'
$tokens=$null; $parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($module,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'Boot recovery module does not parse in Windows PowerShell 5.1.' }
if (@($ast.EndBlock.Statements | Where-Object { $_ -isnot [Management.Automation.Language.FunctionDefinitionAst] }).Count) { throw 'Boot module import must contain only function definitions.' }
function New-Object { [CmdletBinding()]param([string]$ComObject) throw 'COM creation is forbidden before the controlled scheduler is installed.' }
. $module
$script:Assertions=0
$script:Groups=[Collections.Generic.List[string]]::new()
$script:TotalCreateCalls=0; $script:TotalDeleteCalls=0; $script:FactoryCalls=0
$script:ProgramDataFixture=Join-Path $root ('PD [x] ' + [char]0x416)
[void][IO.Directory]::CreateDirectory($script:ProgramDataFixture)

function Assert-Test([bool]$Condition,[string]$Message) {
  $script:Assertions++
  if (-not $Condition) { throw ('Boot recovery test failed: ' + $Message) }
}
function Assert-Throws([scriptblock]$Operation,[string]$Message) {
  $failed=$false
  try { & $Operation | Out-Null } catch { $failed=$true }
  Assert-Test $failed $Message
}
function New-TrustedAcl([switch]$Directory) {
  $acl=if($Directory){[Security.AccessControl.DirectorySecurity]::new()}else{[Security.AccessControl.FileSecurity]::new()}
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
  $acl.SetAccessRuleProtection($true,$false)
  foreach($sid in @('S-1-5-18','S-1-5-32-544')){
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))
  }
  return $acl
}
function Get-InstallerBootRecoveryCommonDataRoot { return $script:ProgramDataFixture }
function Get-Acl {
  [CmdletBinding()]param([string]$LiteralPath)
  if($script:AclOverrides.ContainsKey($LiteralPath)){return $script:AclOverrides[$LiteralPath]}
  return New-TrustedAcl -Directory:(Test-Path -LiteralPath $LiteralPath -PathType Container)
}
function New-HarmlessInventoryStream([string]$Path,[object]$Security) {
  $script:InventoryCreationSecurity=$Security
  return [IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
}
# Keep the production FileSecurity construction/flush/rename flow. Substitute
# only the native ACL FileStream constructor with an ordinary owned-temp stream.
$streamFunction=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'New-InstallerBootRecoveryInventoryStream'},$true)
$constructor='return [IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,$security)'
$streamText=$streamFunction.Extent.Text
Assert-Test ([regex]::Matches($streamText,[regex]::Escape($constructor)).Count -eq 1) 'one controlled native ACL creation boundary'
$streamText=$streamText.Replace($constructor,'return New-HarmlessInventoryStream -Path $Path -Security $security') -replace '^function ','function script:'
. ([scriptblock]::Create($streamText))
$ctors=@([IO.FileStream].GetConstructors() | Where-Object {$p=$_.GetParameters(); $p.Count -eq 7 -and $p[6].ParameterType -eq [Security.AccessControl.FileSecurity]})
Assert-Test ($ctors.Count -eq 1) 'WinPS 5.1 native protected FileStream constructor exists'

function New-FakeRegisteredTask([string]$Name,[string]$Xml,[string]$Sddl) {
  $task=[pscustomobject]@{Name=$Name;Path=('\'+$Name);Enabled=$true;Xml=$Xml;Sddl=$Sddl;Definition=[pscustomobject]@{Principal=[pscustomobject]@{UserId='SYSTEM';LogonType=5}}}
  $task | Add-Member -MemberType ScriptMethod -Name GetSecurityDescriptor -Value {param($Sections) Assert-Test ($Sections -eq 7) 'native owner/group/DACL readback requested'; return $this.Sddl}
  return $task
}
function Reset-Scheduler {
  $script:Scheduler=[pscustomobject]@{Tasks=@{};Reads=0;Creates=0;Deletes=0;ReadFailure=$false;CreateFailure=$false;DeleteFailure=$false;DropAfterCreate=$false;OnRead=$null;OnCreate=$null}
  $script:AclOverrides=@{}
  $script:InventoryCreationSecurity=$null
}
Reset-Scheduler
function New-Object {
  [CmdletBinding()]param([string]$ComObject)
  if($ComObject -ne 'Schedule.Service'){throw 'Unexpected COM factory; native scheduling is forbidden in this test.'}
  $script:FactoryCalls++
  $folder=[pscustomobject]@{}
  $folder | Add-Member -MemberType ScriptMethod -Name GetTask -Value {
    param($Name)
    $script:Scheduler.Reads++
    if($script:Scheduler.OnRead){& $script:Scheduler.OnRead $Name $script:Scheduler.Reads}
    if($script:Scheduler.ReadFailure){throw [Runtime.InteropServices.COMException]::new('controlled access denied',-2147024891)}
    if(-not $script:Scheduler.Tasks.ContainsKey($Name)){throw [Runtime.InteropServices.COMException]::new('controlled task missing',-2147024894)}
    return $script:Scheduler.Tasks[$Name]
  }
  $folder | Add-Member -MemberType ScriptMethod -Name RegisterTask -Value {
    param($Name,$Xml,$Flags,$User,$Password,$Logon,$Sddl)
    $script:Scheduler.Creates++; $script:TotalCreateCalls++
    Assert-Test ($Flags -eq 18 -and $User -eq 'SYSTEM' -and $null -eq $Password -and $Logon -eq 5) 'native registration uses create-only/principal-ACE flag and passwordless SYSTEM service-account'
    if($script:Scheduler.OnCreate){& $script:Scheduler.OnCreate $Name}
    if($script:Scheduler.CreateFailure){throw [Runtime.InteropServices.COMException]::new('controlled create failure',-2147024891)}
    if($script:Scheduler.Tasks.ContainsKey($Name)){throw [Runtime.InteropServices.COMException]::new('controlled collision',-2147024713)}
    if(-not $script:Scheduler.DropAfterCreate){$script:Scheduler.Tasks[$Name]=New-FakeRegisteredTask $Name $Xml $Sddl}
    return $null
  }
  $folder | Add-Member -MemberType ScriptMethod -Name DeleteTask -Value {
    param($Name,$Flags)
    $script:Scheduler.Deletes++; $script:TotalDeleteCalls++
    Assert-Test ($Flags -eq 0) 'native retirement flags are exact'
    if($script:Scheduler.DeleteFailure){throw [Runtime.InteropServices.COMException]::new('controlled delete failure',-2147024891)}
    $script:Scheduler.Tasks.Remove($Name)
  }
  $service=[pscustomobject]@{Folder=$folder}
  $service | Add-Member -MemberType ScriptMethod -Name Connect -Value {}
  $service | Add-Member -MemberType ScriptMethod -Name GetFolder -Value {param($Name) Assert-Test ($Name -ceq '\') 'scheduler stays in the local root folder'; return $this.Folder}
  return $service
}
function New-Stage {
  $stage=Join-Path (Join-Path $script:ProgramDataFixture 'EgoistShieldInstaller\DeferredRuns') ([Guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($stage)
  [IO.File]::WriteAllText((Join-Path $stage 'invoke-final-silent-reinstall.ps1'),'throw "Test task action must never execute."')
  [IO.File]::WriteAllText((Join-Path $stage 'service-maintenance.ps1'),'# Harmless hash inventory fixture.')
  [IO.File]::Copy($module,(Join-Path $stage 'maintenance-boot-recovery.ps1'))
  [IO.File]::WriteAllText((Join-Path $stage 'state.json'),'{"schemaVersion":1,"owner":"EgoistShield","handoffStarted":false}')
  return Get-InstallerBootRecoveryContext $stage
}
function New-RegisteredStage {
  Reset-Scheduler
  $context=New-Stage
  $record=Register-InstallerMaintenanceBootRecovery -StageDirectory $context.stage
  Assert-Test $record.verified 'registration returns verified identity'
  return $context
}
function Set-TaskXmlValue([object]$Context,[string]$XPath,[string]$Value) {
  $task=$script:Scheduler.Tasks[$Context.taskName]
  $xml=ConvertFrom-InstallerBootRecoveryXml $task.Xml
  $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable); $ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
  $xml.SelectSingleNode($XPath,$ns).InnerText=$Value
  $task.Xml=$xml.OuterXml
}

Assert-Test ($script:FactoryCalls -eq 0) 'import and filesystem setup perform no scheduler calls'
$context=New-RegisteredStage
$record=Assert-InstallerMaintenanceBootRecovery $context.stage
Assert-Test ($script:Scheduler.Creates -eq 1 -and $record.stage -eq $context.stage) 'durable verified registration precedes caller service mutations'
Assert-Test ($script:InventoryCreationSecurity.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-32-544' -and $script:InventoryCreationSecurity.AreAccessRulesProtected) 'production inventory FileSecurity has trusted owner/protected DACL'
$script:Groups.Add('protected registration and native COM argument contract')

$hash=Get-InstallerBootRecoveryFileHash $context.inventoryPath
$second=Register-InstallerMaintenanceBootRecovery $context.stage
Assert-Test ($script:Scheduler.Creates -eq 1 -and $second.inventorySha256 -eq $hash) 'same owned registration is idempotent'
$script:Groups.Add('owned registration idempotency')

[IO.File]::WriteAllText($context.statePath,'{"schemaVersion":1,"owner":"EgoistShield","handoffStarted":true,"progress":"restoring"}')
Assert-Test (Assert-InstallerMaintenanceBootRecovery $context.stage).verified 'mutable protected state is not content-hash pinned'
Assert-Test ((Get-InstallerBootRecoveryFileHash $context.inventoryPath) -eq $hash) 'mutable state leaves immutable inventory identity unchanged'
$script:Groups.Add('mutable state contract')

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LagomBootRecoveryArgv {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CommandLineToArgvW(string command, out int count);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  public static string[] Parse(string command) {
    int count; var memory=CommandLineToArgvW(command,out count);
    if(memory==IntPtr.Zero) throw new InvalidOperationException("argv parse failed");
    try { var result=new string[count]; for(int i=0;i<count;i++) result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory,i*IntPtr.Size)); return result; }
    finally { LocalFree(memory); }
  }
}
'@
$argv=[LagomBootRecoveryArgv]::Parse('"fixture.exe" '+$context.arguments)
Assert-Test ($argv.Count -eq 13 -and $argv[9] -ceq $context.worker -and $argv[10] -ceq '-Recover' -and $argv[12] -ceq $context.stage) 'native argv preserves exact Unicode/bracket/space stage and recovery-only action'
foreach($value in @('','a b','C:\trailing\','a"b',[string][char]0x416)){
  $parsed=[LagomBootRecoveryArgv]::Parse('"fixture.exe" '+(ConvertTo-InstallerBootRecoveryArgument $value))
  Assert-Test ($parsed.Count -eq 2 -and $parsed[1] -ceq $value) 'native Windows quote/backslash argument roundtrip'
}
$script:Groups.Add('native Windows argv without launching a task action')

foreach($path in @((Join-Path $root 'custom\01234567890123456789012345678901'),(Join-Path $context.stage 'nested\01234567890123456789012345678901'),(Join-Path $context.deferredRoot 'not-a-stage'))){
  Assert-Throws {Register-InstallerMaintenanceBootRecovery $path} 'custom/nested/non-GUID stages fail before scheduler writes'
}
Assert-Test ($script:Scheduler.Creates -eq 1) 'noncanonical stages do not register tasks'
$script:Groups.Add('canonical direct stage boundary')

Reset-Scheduler; $context=New-Stage
$foreign=New-FakeRegisteredTask $context.taskName '<Task />' 'D:(A;;FA;;;WD)'
$script:Scheduler.Tasks[$context.taskName]=$foreign
Assert-Throws {Register-InstallerMaintenanceBootRecovery $context.stage} 'foreign same-name task with no inventory is preserved'
Assert-Test ($script:Scheduler.Creates -eq 0 -and -not (Test-Path -LiteralPath $context.inventoryPath)) 'foreign collision causes no metadata/task replacement'
Assert-Throws {Unregister-InstallerMaintenanceBootRecovery $context.stage -RestorationVerified:$true} 'foreign task is not retired without own inventory'
Assert-Test ($script:Scheduler.Deletes -eq 0) 'foreign task remains registered'
$script:Groups.Add('foreign task collision and legacy-present-without-inventory refusal')

Reset-Scheduler; $context=New-Stage
$script:Scheduler.OnCreate={param($Name) $script:Scheduler.Tasks[$Name]=New-FakeRegisteredTask $Name '<Task />' 'D:(A;;FA;;;WD)'}
Assert-Throws {Register-InstallerMaintenanceBootRecovery $context.stage} 'create-only registration cannot overwrite task racing between read and create'
Assert-Test ($script:Scheduler.Tasks[$context.taskName].Xml -ceq '<Task />' -and $script:Scheduler.Deletes -eq 0) 'racing foreign task is unchanged'
$script:Groups.Add('create-only collision race')

Reset-Scheduler; $context=New-Stage; $script:Scheduler.ReadFailure=$true
Assert-Throws {Register-InstallerMaintenanceBootRecovery $context.stage} 'access-denied scheduler read is not treated as task absence'
Assert-Test ($script:Scheduler.Creates -eq 0 -and -not (Test-Path -LiteralPath $context.inventoryPath)) 'failed scheduler read performs no creation'
$script:Groups.Add('scheduler read failure closes safely')

Reset-Scheduler; $context=New-Stage; $script:Scheduler.CreateFailure=$true
Assert-Throws {Register-InstallerMaintenanceBootRecovery $context.stage} 'scheduler create failure prevents successful registration'
Assert-Test (Test-Path -LiteralPath $context.inventoryPath -PathType Leaf) 'protected inventory survives failed scheduling for safe retry'
$script:Scheduler.CreateFailure=$false
Assert-Test (Register-InstallerMaintenanceBootRecovery $context.stage).verified 'same protected inventory can retry create'
$script:Groups.Add('registration failure preserves durable inventory')

Reset-Scheduler; $context=New-Stage; $script:Scheduler.DropAfterCreate=$true
Assert-Throws {Register-InstallerMaintenanceBootRecovery $context.stage} 'missing post-create readback blocks the caller before services are disabled'
$script:Groups.Add('mandatory registration readback')

foreach($name in @('invoke-final-silent-reinstall.ps1','service-maintenance.ps1','maintenance-boot-recovery.ps1')){
  $context=New-RegisteredStage
  [IO.File]::AppendAllText((Join-Path $context.stage $name),'# changed after registration')
  Assert-Throws {Assert-InstallerMaintenanceBootRecovery $context.stage} 'each immutable script is hash pinned'
  Assert-Throws {Unregister-InstallerMaintenanceBootRecovery $context.stage -RestorationVerified:$true} 'changed script cannot silently retire recovery task'
  Assert-Test ($script:Scheduler.Deletes -eq 0) 'hash mismatch preserves recovery evidence/task'
}
$script:Groups.Add('worker/helper/module hash binding')

$context=New-RegisteredStage
[IO.File]::AppendAllText($context.inventoryPath,' ')
Assert-Throws {Assert-InstallerMaintenanceBootRecovery $context.stage} 'task metadata pins exact durable inventory bytes'
$script:Groups.Add('inventory byte binding')

foreach($json in @('{"schemaVersion":2,"owner":"EgoistShield"}','{"schemaVersion":1,"owner":"Foreign"}','not-json')){
  Reset-Scheduler; $context=New-Stage; [IO.File]::WriteAllText($context.statePath,$json)
  Assert-Throws {Register-InstallerMaintenanceBootRecovery $context.stage} 'corrupt/wrong-identity state cannot register recovery'
  Assert-Test ($script:Scheduler.Creates -eq 0) 'invalid state performs no scheduler creation'
}
Reset-Scheduler; $context=New-Stage; [IO.File]::WriteAllText($context.statePath,(' ' * 4194305))
Assert-Throws {Register-InstallerMaintenanceBootRecovery $context.stage} 'oversize state is rejected'
$script:Groups.Add('state schema/owner/size gate')

foreach($kind in @('user-owner','user-write','inherited-parent','inherit-only-full','deny')){
  Reset-Scheduler; $context=New-Stage
  $directory=$kind -in @('inherited-parent','inherit-only-full')
  $path=if($directory){$context.deferredRoot}else{$context.worker}
  $acl=New-TrustedAcl -Directory:$directory
  if($kind -eq 'user-owner'){$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-21-1-2-3-1001'))}
  if($kind -eq 'user-write'){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),[Security.AccessControl.FileSystemRights]::Write,[Security.AccessControl.AccessControlType]::Allow))}
  if($kind -eq 'inherited-parent'){$acl.SetAccessRuleProtection($false,$true)}
  if($kind -eq 'inherit-only-full'){
    $acl=[Security.AccessControl.DirectorySecurity]::new(); $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')); $acl.SetAccessRuleProtection($true,$false)
    foreach($sid in @('S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]::ContainerInherit,[Security.AccessControl.PropagationFlags]::InheritOnly,[Security.AccessControl.AccessControlType]::Allow))}
  }
  if($kind -eq 'deny'){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.AccessControl.FileSystemRights]::Read,[Security.AccessControl.AccessControlType]::Deny))}
  $script:AclOverrides[$path]=$acl
  Assert-Throws {Register-InstallerMaintenanceBootRecovery $context.stage} 'unsafe file owner/DACL is rejected'
  Assert-Test ($script:Scheduler.Creates -eq 0) 'unsafe protection performs no task creation'
}
$script:Groups.Add('trusted file owners and writable/delete-child parent protection')

Reset-Scheduler
$target=Join-Path $root 'junction-target'; [void][IO.Directory]::CreateDirectory($target)
$junction=Join-Path (Join-Path $script:ProgramDataFixture 'EgoistShieldInstaller\DeferredRuns') ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Junction -Path $junction -Value $target | Out-Null
Assert-Throws {Register-InstallerMaintenanceBootRecovery $junction} 'actual NTFS stage junction is rejected before scheduling'
Assert-Test ($script:Scheduler.Creates -eq 0) 'reparse stage creates no task'
$script:Groups.Add('real NTFS reparse rejection')

$mutations=@(
  @('/t:Task/t:Actions/t:Exec/t:Arguments','-File "foreign.ps1"'),
  @('/t:Task/t:Actions/t:Exec/t:Command','C:\Users\Public\powershell.exe'),
  @('/t:Task/t:Actions/t:Exec/t:WorkingDirectory','C:\Users\Public'),
  @('/t:Task/t:Principals/t:Principal/t:UserId','S-1-5-21-1-2-3-1001'),
  @('/t:Task/t:Principals/t:Principal/t:RunLevel','LeastPrivilege'),
  @('/t:Task/t:RegistrationInfo/t:URI','foreign'),
  @('/t:Task/t:RegistrationInfo/t:Description','foreign'),
  @('/t:Task/t:Triggers/t:BootTrigger/t:Delay','PT1H'),
  @('/t:Task/t:Settings/t:ExecutionTimeLimit','PT1H'),
  @('/t:Task/t:Settings/t:RestartOnFailure/t:Interval','PT1S'),
  @('/t:Task/t:Settings/t:RestartOnFailure/t:Count','999'),
  @('/t:Task/t:Settings/t:MultipleInstancesPolicy','Parallel'),
  @('/t:Task/t:Settings/t:DisallowStartIfOnBatteries','true'),
  @('/t:Task/t:Settings/t:StopIfGoingOnBatteries','true'),
  @('/t:Task/t:Settings/t:RunOnlyIfNetworkAvailable','true'),
  @('/t:Task/t:Settings/t:RunOnlyIfIdle','true'),
  @('/t:Task/t:Settings/t:Enabled','false')
)
foreach($mutation in $mutations){
  $context=New-RegisteredStage; Set-TaskXmlValue $context $mutation[0] $mutation[1]
  Assert-Throws {Assert-InstallerMaintenanceBootRecovery $context.stage} 'tampered scheduler action/principal/trigger/bounds/restrictions are rejected'
  Assert-Throws {Unregister-InstallerMaintenanceBootRecovery $context.stage -RestorationVerified:$true} 'foreign/tampered task is not deleted'
  Assert-Test ($script:Scheduler.Deletes -eq 0) 'tampered task remains registered'
}
foreach($parent in @('Actions','Triggers','Principals')){
  $context=New-RegisteredStage
  $task=$script:Scheduler.Tasks[$context.taskName]; $xml=ConvertFrom-InstallerBootRecoveryXml $task.Xml
  $node=$xml.DocumentElement.ChildNodes | Where-Object LocalName -EQ $parent
  [void]$node.AppendChild($node.FirstChild.CloneNode($true)); $task.Xml=$xml.OuterXml
  Assert-Throws {Assert-InstallerMaintenanceBootRecovery $context.stage} 'additional actions/triggers/principals are rejected'
}
$script:Groups.Add('scheduler XML and execution-policy tampering matrix')

foreach($sddl in @('O:BAG:SYD:(A;;FA;;;SY)(A;;FA;;;BA)','O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;BU)','O:BAG:SYD:P(A;;FA;;;SY)','O:BAG:SYD:P(A;IO;FA;;;SY)(A;;FA;;;BA)')){
  $context=New-RegisteredStage; $script:Scheduler.Tasks[$context.taskName].Sddl=$sddl
  Assert-Throws {Assert-InstallerMaintenanceBootRecovery $context.stage} 'unprotected/foreign/incomplete task DACL is rejected'
  Assert-Throws {Unregister-InstallerMaintenanceBootRecovery $context.stage -RestorationVerified:$true} 'unsafe task DACL is not retired'
}
$context=New-RegisteredStage; $script:Scheduler.Tasks[$context.taskName].Definition.Principal.LogonType=3
Assert-Throws {Assert-InstallerMaintenanceBootRecovery $context.stage} 'interactive logon type cannot masquerade as unattended SYSTEM'
$script:Groups.Add('native task identity and ACL readback')

$context=New-RegisteredStage
$script:Scheduler.Tasks[$context.taskName].Xml='<!DOCTYPE Task [<!ENTITY x SYSTEM "file:///C:/Windows/win.ini">]><Task>&x;</Task>'
Assert-Throws {Assert-InstallerMaintenanceBootRecovery $context.stage} 'untrusted scheduler XML cannot load a DTD/entity'
$script:Groups.Add('bounded XML parsing without external entities')

$context=New-RegisteredStage
Assert-Throws {Unregister-InstallerMaintenanceBootRecovery $context.stage} 'restoration verification is mandatory for retirement'
[void][IO.Directory]::CreateDirectory((Split-Path -Parent $context.maintenanceMarker))
[IO.File]::WriteAllText($context.maintenanceMarker,(@{schemaVersion=1;owner='EgoistShield';stage=$context.stage}|ConvertTo-Json))
Assert-Throws {Unregister-InstallerMaintenanceBootRecovery $context.stage -RestorationVerified:$true} 'own pending maintenance marker prevents retirement'
Assert-Test ($script:Scheduler.Deletes -eq 0) 'unresolved recovery task is retained'
[IO.File]::Delete($context.maintenanceMarker)
$retired=Unregister-InstallerMaintenanceBootRecovery $context.stage -RestorationVerified:$true
Assert-Test ($retired.removed -and $script:Scheduler.Deletes -eq 1 -and $script:Scheduler.Tasks.Count -eq 0) 'verified restoration retires only owned task with readback'
$again=Unregister-InstallerMaintenanceBootRecovery $context.stage -RestorationVerified:$true
Assert-Test ($again.absent -and $script:Scheduler.Deletes -eq 1) 'retirement is idempotent'
$script:Groups.Add('verified restoration and owned marker retirement gate')

Reset-Scheduler
$oldStage=Join-Path (Join-Path $script:ProgramDataFixture 'EgoistShieldInstaller\DeferredRuns') ([Guid]::NewGuid().ToString('N'))
$legacy=Unregister-InstallerMaintenanceBootRecovery $oldStage -RestorationVerified:$true
Assert-Test ($legacy.absent -and $script:Scheduler.Deletes -eq 0) 'legacy missing task/inventory/stage is a safe idempotent retirement no-op'
$script:Groups.Add('historical missing-task retirement')

$context=New-RegisteredStage
$script:Scheduler.OnRead={param($Name,$Count) if($Count -eq 4){$script:Scheduler.Tasks[$Name]=New-FakeRegisteredTask $Name '<Task />' 'D:(A;;FA;;;WD)'}}
Assert-Throws {Unregister-InstallerMaintenanceBootRecovery $context.stage -RestorationVerified:$true} 'fresh foreign task replacement before retirement is preserved'
Assert-Test ($script:Scheduler.Deletes -eq 0 -and $script:Scheduler.Tasks[$context.taskName].Xml -ceq '<Task />') 'fresh read prevents deleting foreign replacement'
$script:Groups.Add('retirement replacement race')

$context=New-RegisteredStage; $script:Scheduler.DeleteFailure=$true
Assert-Throws {Unregister-InstallerMaintenanceBootRecovery $context.stage -RestorationVerified:$true} 'scheduler deletion failure is reported'
Assert-Test ($script:Scheduler.Tasks.ContainsKey($context.taskName)) 'failed retirement retains own registered task'
$script:Groups.Add('retirement failure preserves task')

$result=[ordered]@{
  schemaVersion=1;passed=$true;groupCount=$script:Groups.Count;assertionCount=$script:Assertions;groups=@($script:Groups)
  controlledSchedulerCreateCalls=$script:TotalCreateCalls;controlledSchedulerDeleteCalls=$script:TotalDeleteCalls;controlledComFactoryCalls=$script:FactoryCalls
  productionModuleSha256=(Get-FileHash -LiteralPath $module -Algorithm SHA256).Hash.ToLowerInvariant()
  nativeSchedulerReads=0;nativeTaskCreates=0;nativeTaskUpdates=0;nativeTaskDeletes=0;nativeTaskActions=0;nativeScmMutations=0;systemDnsWrites=0;nativeFileAclWrites=0
  nativeHarmlessBoundaries=@('real owned files/hash/flush/rename','actual NTFS junction','CommandLineToArgvW parser','WinPS5.1 FileStream ACL constructor reflection')
  controlledBoundaries=@('Schedule.Service COM factory','filesystem Get-Acl','native protected FileStream creation')
  limits=@('Task Scheduler registration/readback/startup/retry timing are not executed natively.','Filesystem owner/DACL proofs use actual .NET security descriptors returned by controlled Get-Acl; this does not prove native file protection.','Inventory security descriptor construction is production code; native ACL file creation is replaced with an ordinary owned-temp file stream.','Recovery task action is a deliberately non-executed harmless fixture; worker/service recovery integration and historical signed bootstrap require separate acceptance.')
}
[IO.File]::WriteAllText((Join-Path $root 'boot-recovery-test.json'),($result|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
Write-Output ('installer boot recovery: '+$script:Groups.Count+' groups passed; '+$script:Assertions+' assertions; native scheduler reads/task mutations/actions 0; SCM/DNS/ACL writes 0')
