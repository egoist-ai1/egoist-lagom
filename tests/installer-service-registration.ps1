param([Parameter(Mandatory=$true)][string]$TestDirectory,[Parameter(Mandatory=$true)][string]$ReceiptPath)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
Add-Type -AssemblyName System.ServiceProcess
$root=[IO.Path]::GetFullPath($TestDirectory).TrimEnd('\')
$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
if ($root -ne $temp -and -not $root.StartsWith($temp+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Use task-scoped temporary files.' }
if (-not [IO.Path]::GetFullPath($ReceiptPath).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Receipt escaped fixture root.' }
$project=Split-Path -Parent $PSScriptRoot
$source=Join-Path $project 'scripts\invoke-final-silent-reinstall.ps1'
function Load-Functions([string]$File,[string[]]$Names) {
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($File,[ref]$tokens,[ref]$errors)
  if ($errors.Count) { throw 'Production source does not parse in Windows PowerShell 5.1.' }
  foreach($name in $Names) {
    $fn=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    if (-not $fn) { throw ('Missing production function: '+$name) }
    . ([scriptblock]::Create(($fn.Extent.Text -replace '^function ', 'function script:')))
  }
}
Load-Functions $source @('ConvertTo-InstallerWindowsArgument','Invoke-InstallerNativeProcess','Get-InstallerNativeTool',
  'Invoke-PreservedRegistrationSc','Get-PreservedServiceRegistrationMetadata','Assert-PreservedServiceRegistration',
  'Assert-CurrentPreservedServiceOwnership','Test-OwnedServicePath','Get-FileSha256','Get-OwnedServiceSnapshot',
  'Get-PreservedWrapperDefinitions','Assert-PlainWrapperMigrationPath','Get-PreservedRegistryBackup',
  'New-DisabledServiceRegistryImport','Restore-PreservedServiceRegistration','Restore-PreservedState','Start-PreservedServices')
Load-Functions (Join-Path $project 'src\installer\service-maintenance.ps1') @('Get-InstallerServiceState')
$script:OwnedInstallRoot=Join-Path $root 'Install'
$script:OwnedDataRoot=Join-Path $root 'Product'
$script:RuntimeRoot=Join-Path $script:OwnedDataRoot 'Runtime'
$script:StageDirectory=Join-Path $root 'Stage'
$script:AllServiceNames=@('EgoistShieldCore','EgoistShieldGravitylessDNS')
$null=New-Item -ItemType Directory -Path $script:OwnedInstallRoot,$script:OwnedDataRoot,(Join-Path $script:StageDirectory 'service-registry') -Force
$script:cases=[Collections.Generic.List[object]]::new()
$script:hostCalls=0;$script:actualEchoArguments=0;$script:ownedChildTimeoutKills=0
function Require([bool]$Value,[string]$Message) { if (-not $Value) { throw $Message } }
function Case([string]$Name,[scriptblock]$Action) {
  $message='';try { & $Action } catch { $message=$_.Exception.Message }
  $script:cases.Add([pscustomobject]@{name=$Name;passed=($message -eq '');error=$message})
}
function Refused([scriptblock]$Action,[string]$Pattern) {
  $message='';try { & $Action } catch { $message=$_.Exception.Message }
  Require ($message -like $Pattern) ('Expected refusal '+$Pattern+'; received '+$message)
}
$echo=Join-Path $root 'Argument echo [fixture].exe'
$code=@'
using System;
using System.Collections.Generic;
using System.Text;
using System.IO;
using System.Threading;
using Microsoft.Win32;
public class LagomRegistrationFixtureKey {
 public Dictionary<string,object> Values = new Dictionary<string,object>(StringComparer.OrdinalIgnoreCase);
 public Dictionary<string,RegistryValueKind> Kinds = new Dictionary<string,RegistryValueKind>(StringComparer.OrdinalIgnoreCase);
 public string[] GetValueNames() { var a=new string[Values.Count]; Values.Keys.CopyTo(a,0); return a; }
 public object GetValue(string key, object fallback) { return GetValue(key,fallback,RegistryValueOptions.None); }
 public object GetValue(string key, object fallback, RegistryValueOptions options) { return Values.ContainsKey(key)?Values[key]:fallback; }
 public RegistryValueKind GetValueKind(string key) { return Kinds.ContainsKey(key)?Kinds[key]:RegistryValueKind.String; }
}
public static class LagomArgumentEcho {
 public static int Main(string[] args) {
  if(args.Length==1 && args[0]=="--exit7") return 7;
  if(args.Length==2 && args[0]=="--sleep-file") {
   File.WriteAllText(args[1],System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
   Thread.Sleep(8000); return 0;
  }
  Console.OutputEncoding=new UTF8Encoding(false);
  Console.WriteLine(args.Length.ToString());
  foreach(var arg in args) Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(arg)));
  return 0;
 }
}
'@
$compiled=Join-Path $root ('echo-'+[Guid]::NewGuid().ToString('N')+'.exe')
Add-Type -TypeDefinition $code -OutputAssembly $compiled -OutputType ConsoleApplication
Move-Item -LiteralPath $compiled -Destination $echo -Force -ErrorAction Stop
[void][Reflection.Assembly]::LoadFile($echo)
$script:actualRunner=(Get-Command Invoke-InstallerNativeProcess).ScriptBlock
$script:actualSc=(Get-Command Invoke-PreservedRegistrationSc).ScriptBlock
function Assert-Echo([string[]]$Arguments) {
  $result=& $script:actualRunner -Executable $echo -Arguments $Arguments
  Require ($result.exitCode -eq 0 -and $result.errors -eq '') 'Harmless echo failed.'
  $received=@($result.output -split '\r?\n')
  Require ([int]$received[0] -eq $Arguments.Count) 'Native argument count changed.'
  for($index=0;$index -lt $Arguments.Count;$index++) {
    $decoded=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($received[$index+1]))
    Require ([string]::Equals($decoded,$Arguments[$index],[StringComparison]::Ordinal)) ('Native argument changed at '+$index)
  }
  $script:actualEchoArguments+=$Arguments.Count
}
Case 'actual WinPS native argv preserves empty whitespace unicode quotes and trailing slashes' {
  $arguments=@('','plain','two words',"`t",'Привет 世界','C:\folder with space\','"C:\Own\service.exe" --config "C:\file path\dns.toml"',
    'embedded"quote','slash\"quote','double\\"quote','many\\\"quote','left""right','$literal; $(not-executed) & ^ | %VAR%')
  foreach($slashes in 0..12) { foreach($quote in @('','"','""')) { foreach($suffix in @('',' x','\')) { $arguments+=('head'+('\'*$slashes)+$quote+$suffix) } } }
  Assert-Echo $arguments
}
Case 'actual native process returns nonzero exit status' { Require ((& $script:actualRunner -Executable $echo -Arguments @('--exit7')).exitCode -eq 7) 'Native exit code was lost.' }
Case 'actual native timeout terminates only its owned child handle' {
  $pidFile=Join-Path $root 'owned-child.pid'
  Refused { & $script:actualRunner -Executable $echo -Arguments @('--sleep-file',$pidFile) -TimeoutSeconds 1 } '*exceeded its timeout*'
  $childPid=[int][IO.File]::ReadAllText($pidFile)
  Require (-not (Microsoft.PowerShell.Management\Get-Process -Id $childPid -ErrorAction SilentlyContinue)) 'Owned timed-out child survived.'
  $script:ownedChildTimeoutKills++
}
Case 'oversized native argv rejected before start' { Refused { & $script:actualRunner -Executable $echo -Arguments @('x'*30001) } '*arguments exceed*' }

$script:policies=@{};$script:keys=@{};$script:services=@{};$script:scCalls=[Collections.Generic.List[object]]::new()
$script:imports=0;$script:starts=@();$script:mutateBeforeImport=$false;$script:badScReadback=$false
$script:cimRecords=@();$script:scExit=0
$script:policyReads=0;$script:foreignAtRead=0
function Get-Item {
  param($LiteralPath,$ErrorAction)
  if ([string]$LiteralPath -like 'Registry::*') {
    $name=([string]$LiteralPath).Substring(([string]$LiteralPath).LastIndexOf('\')+1)
    if (-not $script:keys.ContainsKey($name)) { throw 'Fixture registry key unavailable.' }
    return $script:keys[$name]
  }
  return Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -ErrorAction Stop
}
function Get-InstallerServicePolicy {
  param($Name)
  $script:policyReads++
  if($script:foreignAtRead -gt 0 -and $script:policyReads -ge $script:foreignAtRead) { return [pscustomobject]@{pathName='C:\Foreign\service.exe';startMode='Auto'} }
  if($script:policies.ContainsKey($Name)){return $script:policies[$Name]}; return $null
}
function Get-CimInstance {param($ClassName,$OperationTimeoutSec,$ErrorAction) if($ClassName -ne 'Win32_Service'){$script:hostCalls++;throw 'Forbidden CIM query.'};return $script:cimRecords}
function Get-Service {
  param($Name,$ErrorAction)
  $found=@($script:services.Values | Where-Object { $_.ServiceName -like [string]$Name })
  if ($found.Count) { return $found }
  $exception=[Exception]::new('No such fixture service.')
  $record=[Management.Automation.ErrorRecord]::new($exception,'NoServiceFoundForGivenName,Microsoft.PowerShell.Commands.GetServiceCommand',[Management.Automation.ErrorCategory]::ObjectNotFound,$Name)
  throw $record
}
function Start-Service {param($Name,$ErrorAction) $script:starts+=[string]$Name; $script:services[$Name].Status='Running'}
function Start-Sleep {}
function Stop-Process {$script:hostCalls++;throw 'Forbidden host kill.'}
function sc.exe {$script:hostCalls++;throw 'Forbidden native SCM.'}
function reg.exe {
  param($Action,$Key,$Destination,$Overwrite)
  if($Action -ne 'export'){$script:hostCalls++;throw 'Forbidden registry write.'}
  [IO.File]::WriteAllText($Destination, 'controlled-export', [Text.Encoding]::Unicode)
  $script:LASTEXITCODE=0
}
function Restore-CriticalDnsState {}
function Invoke-RobocopyDirectory { throw 'Unexpected runtime restore fixture.' }
function Invoke-InstallerNativeProcess {
  param($Executable,$Arguments,$TimeoutSeconds)
  if([IO.Path]::GetFileName($Executable) -eq 'reg.exe' -and $Arguments[0] -eq 'import') {
    $text=[IO.File]::ReadAllText($Arguments[1])
    Require ($text.Contains('"Start"=dword:00000004')) 'Registry import lost Disabled.'
    $script:imports++;return [pscustomobject]@{exitCode=0;output='';errors=''}
  }
  if([IO.Path]::GetFileName($Executable) -eq 'sc.exe' -and $script:scExit -ne 0) { return [pscustomobject]@{exitCode=$script:scExit;output='';errors=''} }
  $script:hostCalls++;throw 'Forbidden native executable boundary.'
}
function Invoke-PreservedRegistrationSc {
  param($Arguments)
  $script:scCalls.Add([string[]]$Arguments)
  $name=[string]$Arguments[1]
  $bin=[string]$Arguments[[Array]::IndexOf($Arguments,'binPath=')+1]
  Require ($Arguments[[Array]::IndexOf($Arguments,'start=')+1] -eq 'disabled') 'SCM recreation did not stay Disabled.'
  $script:policies[$name]=[pscustomobject]@{name=$name;pathName=$bin;startMode=$(if($script:badScReadback){'Auto'}else{'Disabled'});delayedAutoStart=$false}
  $script:services[$name]=[pscustomobject]@{ServiceName=$name;Status='Stopped'}
  $script:services[$name]|Add-Member ScriptMethod WaitForStatus {param($Status,$Timeout) Require ($this.Status -eq 'Running') 'Service did not start.'}
}
function New-Record {
  param([string]$Name='Legacy[DNS]',[string]$Arguments=' --config "C:\file path\dns.toml" --empty "" --tail "end\\"')
  $binary=Join-Path $script:OwnedDataRoot 'GravitylessDNS\dnscrypt-proxy.exe'
  $null=New-Item -ItemType Directory -Path (Split-Path -Parent $binary) -Force
  [IO.File]::WriteAllText($binary,'Not executed; only an existence fixture.')
  $registration=[pscustomobject]@{schemaVersion=1;binPath=('"'+$binary+'"'+$Arguments);account='LocalSystem';type=16;errorControl=1;
    displayName='Legacy DNS с пробелами';group='';dependencies=@('Tcpip','Service With Spaces');dependencyGroups=@('Network Group')}
  $file=Join-Path (Join-Path $script:StageDirectory 'service-registry') 'service-0.reg'
  [IO.File]::WriteAllText($file,('Windows Registry Editor Version 5.00'+"`r`n`r`n"+'[HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\'+$Name+']'+"`r`n"+'"Start"=dword:00000002'+"`r`n"+'"Type"=dword:00000010'+"`r`n"),[Text.Encoding]::Unicode)
  return [pscustomobject]@{name=$Name;pathName=$registration.binPath;registration=$registration;registryFile='service-0.reg';
    registrySha256=(Get-FileSha256 $file);wasRunning=$true;startMode='Auto';delayedAutoStart=$true}
}
function Reset-Fixture {
  $script:policies=@{};$script:keys=@{};$script:services=@{};$script:scCalls.Clear();$script:imports=0;$script:starts=@();$script:badScReadback=$false
  $script:policyReads=0;$script:foreignAtRead=0
}
Case 'missing legacy registration is created by SCM with exact command and dependency groups' {
  Reset-Fixture;$record=New-Record
  Restore-PreservedState ([pscustomobject]@{services=@($record);userState=@()})
  Require ($script:scCalls.Count -eq 1 -and $script:scCalls[0][0] -eq 'create' -and $script:imports -eq 1) 'Missing service was not recreated/imported.'
  $command=$script:scCalls[0]
  Require ([string]$command[[Array]::IndexOf($command,'binPath=')+1] -ceq $record.pathName) 'Full ImagePath was changed.'
  Require ($command[[Array]::IndexOf($command,'depend=')+1] -eq 'Tcpip/Service With Spaces/+Network Group') 'SCM dependencies changed.'
  Require ($command[[Array]::IndexOf($command,'group=')+1] -eq '') 'Empty load-order group was lost.'
  Assert-Echo $command
  Require ([IO.File]::ReadAllText((Get-PreservedRegistryBackup $record)).Contains('"Start"=dword:00000002')) 'Original registry backup was modified.'
}
Case 'existing stopped owned registration is configured and remains Disabled' {
  Reset-Fixture;$record=New-Record
  $script:policies[$record.name]=[pscustomobject]@{pathName=$record.pathName;startMode='Disabled'}
  $script:services[$record.name]=[pscustomobject]@{ServiceName=$record.name;Status='Stopped'}
  Restore-PreservedServiceRegistration $record
  Require ($script:scCalls[0][0] -eq 'config' -and $script:policies[$record.name].startMode -eq 'Disabled') 'Existing service changed startup early.'
}
Case 'foreign same-name registration prevents config and registry import' {
  Reset-Fixture;$record=New-Record
  $script:policies[$record.name]=[pscustomobject]@{pathName='C:\Foreign\service.exe';startMode='Auto'}
  Refused {Restore-PreservedState ([pscustomobject]@{services=@($record);userState=@()})} '*foreign service*'
  Require ($script:scCalls.Count -eq 0 -and $script:imports -eq 0) 'Foreign registration was modified.'
}
Case 'running owned registration is refused before config and import' {
  Reset-Fixture;$record=New-Record
  $script:policies[$record.name]=[pscustomobject]@{pathName=$record.pathName;startMode='Disabled'}
  $script:services[$record.name]=[pscustomobject]@{ServiceName=$record.name;Status='Running'}
  Refused {Restore-PreservedServiceRegistration $record} '*must remain stopped*'
  Require ($script:scCalls.Count -eq 0 -and $script:imports -eq 0) 'Running registration was overwritten.'
}
Case 'ownership change immediately before SCM mutation is refused' {
  Reset-Fixture;$record=New-Record;$script:foreignAtRead=2
  Refused {Restore-PreservedServiceRegistration $record} '*foreign service*'
  Require ($script:scCalls.Count -eq 0 -and $script:imports -eq 0) 'A late ownership change reached SCM/import.'
}
Case 'ownership change after SCM return prevents registry import' {
  Reset-Fixture;$record=New-Record;$script:foreignAtRead=3
  Refused {Restore-PreservedServiceRegistration $record} '*foreign service*'
  Require ($script:scCalls.Count -eq 1 -and $script:imports -eq 0) 'Changed ownership reached registry import.'
}
Case 'old stage without checked metadata is refused and original backup retained' {
  Reset-Fixture;$record=New-Record;$record.PSObject.Properties.Remove('registration')
  Refused {Restore-PreservedState ([pscustomobject]@{services=@($record);userState=@()})} '*no checked SCM metadata*'
  Require ($script:scCalls.Count -eq 0 -and (Test-Path -LiteralPath (Join-Path (Join-Path $script:StageDirectory 'service-registry') 'service-0.reg'))) 'Old stage backup was lost.'
}
foreach($type in @(32,272,1,2,0)) {
  Case ('unsupported service type '+$type+' is refused before mutation') {
    Reset-Fixture;$record=New-Record;$record.registration.type=$type
    Refused {Restore-PreservedServiceRegistration $record} '*own-process LocalSystem*'
    Require ($script:scCalls.Count -eq 0 -and $script:imports -eq 0) 'Unsupported type modified SCM.'
  }
}
foreach($account in @('DOMAIN\User','NT AUTHORITY\LocalService','NT SERVICE\Legacy')) {
  Case ('unsupported account '+$account+' is refused before mutation') {
    Reset-Fixture;$record=New-Record;$record.registration.account=$account
    Refused {Restore-PreservedServiceRegistration $record} '*own-process LocalSystem*'
  }
}
Case 'tampered registry backup is refused before SCM mutation' {
  Reset-Fixture;$record=New-Record
  [IO.File]::AppendAllText((Get-PreservedRegistryBackup $record),'tamper')
  Refused {Restore-PreservedServiceRegistration $record} '*checksum validation*'
  Require ($script:scCalls.Count -eq 0) 'Tampered backup modified SCM.'
}
Case 'foreign registry section is refused before SCM mutation' {
  Reset-Fixture;$record=New-Record;$file=Get-PreservedRegistryBackup $record
  [IO.File]::AppendAllText($file,"`r`n[HKEY_LOCAL_MACHINE\SOFTWARE\Foreign]`r`n",[Text.Encoding]::Unicode)
  $record.registrySha256=Get-FileSha256 $file
  Refused {Restore-PreservedServiceRegistration $record} '*foreign section*'
  Require ($script:scCalls.Count -eq 0) 'Foreign section reached SCM.'
}
Case 'ambiguous unquoted executable is refused before mutation' {
  Reset-Fixture;$record=New-Record;$record.registration.binPath=Join-Path $script:OwnedDataRoot 'Folder With Spaces\service.exe';$record.pathName=$record.registration.binPath
  Refused {Assert-PreservedServiceRegistration $record} '*Unquoted*ambiguous*'
}
Case 'case-sensitive command argument mismatch is refused before mutation' {
  Reset-Fixture;$record=New-Record;$record.pathName=$record.pathName.Replace('--config','--CONFIG')
  Refused {Assert-PreservedServiceRegistration $record} '*invalid checked command*'
}
Case 'missing registry integrity metadata is refused before mutation' {
  Reset-Fixture;$record=New-Record;$record.PSObject.Properties.Remove('registrySha256')
  Refused {Restore-PreservedServiceRegistration $record} '*no checked registry backup*'
  Require ($script:scCalls.Count -eq 0) 'Unchecked registry backup reached SCM.'
}
Case 'unsupported error control is refused before mutation' {
  Reset-Fixture;$record=New-Record;$record.registration.errorControl=4
  Refused {Assert-PreservedServiceRegistration $record} '*own-process LocalSystem*'
}
Case 'unsupported service-name quote is refused before mutation' {
  Reset-Fixture;$record=New-Record 'Legacy"Name'
  Refused {Assert-PreservedServiceRegistration $record} '*Invalid preserved service name*'
}
Case 'registry section with surrounding whitespace cannot escape ownership' {
  Reset-Fixture;$record=New-Record;$file=Get-PreservedRegistryBackup $record
  [IO.File]::AppendAllText($file,"`r`n [HKEY_LOCAL_MACHINE\SOFTWARE\Foreign] `r`n",[Text.Encoding]::Unicode)
  $record.registrySha256=Get-FileSha256 $file
  Refused {Restore-PreservedServiceRegistration $record} '*foreign section*'
}
Case 'unsupported dependency separator is refused before mutation' {
  Reset-Fixture;$record=New-Record;$record.registration.dependencyGroups=@('Group/Invalid')
  Refused {Assert-PreservedServiceRegistration $record} '*dependency*'
}
Case 'failed SCM Disabled readback prevents registry import' {
  Reset-Fixture;$record=New-Record;$script:badScReadback=$true
  Refused {Restore-PreservedServiceRegistration $record} '*SCM registration readback failed*'
  Require ($script:imports -eq 0) 'Bad SCM readback reached import.'
}
Case 'literal wildcard alias starts its own service despite foreign compatible name' {
  Reset-Fixture;$record=New-Record;Restore-PreservedServiceRegistration $record
  $script:services['LegacyD']=[pscustomobject]@{ServiceName='LegacyD';Status='Running'}
  Start-PreservedServices ([pscustomobject]@{services=@($record,[pscustomobject]@{name='EgoistShieldCore';wasRunning=$false;startMode='Auto'});criticalDns=@()})
  Require (($script:starts -join ',') -eq $record.name -and $script:services[$record.name].Status -eq 'Running') 'A foreign wildcard match was treated as readiness.'
}
Case 'foreign same-name service is refused before start' {
  Reset-Fixture;$record=New-Record;$script:policies[$record.name]=[pscustomobject]@{pathName='C:\Foreign\service.exe';startMode='Auto'}
  Refused {Start-PreservedServices ([pscustomobject]@{services=@($record);criticalDns=@()})} '*foreign service*'
  Require ($script:starts.Count -eq 0) 'A foreign service was started.'
}
Case 'ownership change immediately before start cannot start foreign service' {
  Reset-Fixture;$record=New-Record;Restore-PreservedServiceRegistration $record
  $script:policyReads=0;$script:foreignAtRead=2
  Refused {Start-PreservedServices ([pscustomobject]@{services=@($record);criticalDns=@()})} '*foreign service*'
  Require ($script:starts.Count -eq 0) 'Late foreign registration was started.'
}
Case 'literal missing alias does not accept foreign wildcard match' {
  Reset-Fixture;$record=New-Record;$script:policies[$record.name]=[pscustomobject]@{pathName=$record.pathName;startMode='Manual'}
  $script:services['LegacyD']=[pscustomobject]@{ServiceName='LegacyD';Status='Running'}
  Refused {Start-PreservedServices ([pscustomobject]@{services=@($record);criticalDns=@()})} '*missing after reinstall*'
}
Case 'checked SCM runner rejects nonzero native status' {
  $script:scExit=5
  Refused {& $script:actualSc -Arguments @('create','Fixture')} '*SCM command failed (5)*'
  $script:scExit=0
}
Case 'snapshot preserves unexpanded command and complete checked SCM metadata' {
  Reset-Fixture;$record=New-Record 'LegacySnapshot'
  $key=[LagomRegistrationFixtureKey]::new()
  foreach($entry in @{ImagePath=$record.pathName;ObjectName='LocalSystem';Type=16;ErrorControl=1;DisplayName='Preserved display';Group='Own Group';DependOnService=[string[]]@('Tcpip');DependOnGroup=[string[]]@('Network Group')}.GetEnumerator()) {$key.Values[$entry.Key]=$entry.Value}
  $key.Kinds['Type']=[Microsoft.Win32.RegistryValueKind]::DWord;$key.Kinds['ErrorControl']=[Microsoft.Win32.RegistryValueKind]::DWord
  $key.Kinds['DependOnService']=[Microsoft.Win32.RegistryValueKind]::MultiString;$key.Kinds['DependOnGroup']=[Microsoft.Win32.RegistryValueKind]::MultiString
  $script:keys[$record.name]=$key
  $script:policies[$record.name]=[pscustomobject]@{pathName=$record.pathName;startMode='Auto';delayedAutoStart=$true}
  $script:cimRecords=@([pscustomobject]@{Name=$record.name;PathName=$record.pathName;StartName='LocalSystem';State='Running'})
  $snapshot=@(Get-OwnedServiceSnapshot $script:StageDirectory)
  Require ($snapshot.Count -eq 1 -and $snapshot[0].registration.type -eq 16 -and $snapshot[0].registration.group -eq 'Own Group') 'Snapshot metadata incomplete.'
  Require ($snapshot[0].pathName -ceq $record.pathName -and $snapshot[0].delayedAutoStart -and $snapshot[0].registrySha256.Length -eq 64) 'Snapshot command/policy/integrity changed.'
}
Case 'unsupported registration rejected during snapshot before export and stop' {
  $script:keys['LegacySnapshot'].Values['Type']=32
  Refused {Get-OwnedServiceSnapshot $script:StageDirectory} '*own-process LocalSystem*'
}
Case 'snapshot preserves raw environment path while checking expanded live command' {
  $script:keys['LegacySnapshot'].Values['Type']=16
  $env:LAGOM_REGISTRATION_FIXTURE_ROOT=$script:OwnedDataRoot
  $raw='"%LAGOM_REGISTRATION_FIXTURE_ROOT%\GravitylessDNS\dnscrypt-proxy.exe" --config "C:\space path\dns.toml"'
  $script:keys['LegacySnapshot'].Values['ImagePath']=$raw
  $script:cimRecords[0].PathName=[Environment]::ExpandEnvironmentVariables($raw)
  $script:policies['LegacySnapshot'].pathName=[Environment]::ExpandEnvironmentVariables($raw)
  $snapshot=@(Get-OwnedServiceSnapshot $script:StageDirectory)
  Require ($snapshot[0].pathName -ceq $raw -and $snapshot[0].registration.binPath -ceq $raw) 'Raw ImagePath environment tokens were changed.'
}
Case 'snapshot provider failure is not treated as empty services' {
  function Get-CimInstance {throw 'controlled CIM unavailable'}
  Refused {Get-OwnedServiceSnapshot $script:StageDirectory} '*CIM unavailable*'
}
$failed=@($script:cases | Where-Object {-not $_.passed}).Count
$receipt=[ordered]@{schemaVersion=1;scope='actual production functions with controlled SCM/registry/service boundaries';
  productionSourceSha256=(Get-FileSha256 $source);powerShellVersion=$PSVersionTable.PSVersion.ToString();
  caseCount=$script:cases.Count;passed=($script:cases.Count-$failed);failed=$failed;actualEchoArguments=$script:actualEchoArguments;
  ownedChildTimeoutKills=$script:ownedChildTimeoutKills;forbiddenHostCalls=$script:hostCalls;
  realScmMutations=0;realRegistryMutations=0;realNetworkMutations=0;cases=@($script:cases.ToArray());
  unicodeFixtureFirstCodePoint=[int]('Привет'[0]);
  nativeLimitations=@('No real SCM create/config/import/start','No native boot or power-loss recovery','No full upgrade installer run')}
$json=$receipt|ConvertTo-Json -Depth 10
[IO.File]::WriteAllText($ReceiptPath,$json,[Text.UTF8Encoding]::new($false))
Write-Output $json
if($failed){exit 1}
