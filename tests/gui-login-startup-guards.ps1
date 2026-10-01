param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop';Set-StrictMode -Version 2
$project=Split-Path -Parent $PSScriptRoot
$module=Join-Path $project 'src\installer\gui-login-startup.ps1'
$root=[IO.Path]::GetFullPath($TestDirectory)
if(-not $root.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Use task-scoped test files.'}
[void][IO.Directory]::CreateDirectory($root)
function New-Object {param([string]$ComObject) throw 'Native COM/task mutation is forbidden in this fixture.'}
. $module
$script:Count=0;$script:Names=[Collections.Generic.List[string]]::new()
function Assert-Test([bool]$Condition,[string]$Message){$script:Count++;if(-not $Condition){throw ('GUI startup fixture failed: '+$Message)}}
function Assert-Throws([scriptblock]$Action,[string]$Message){$failed=$false;try{&$Action|Out-Null}catch{$failed=$true};Assert-Test $failed $Message}
$script:ProgramFilesFixture=Join-Path $root 'PF [x]';$script:GuiRoot=Join-Path $script:ProgramFilesFixture 'EgoistShield';$script:DataRoot=Join-Path $root 'GuiStartup'
function Get-GuiStartupProgramFilesRoot{return $script:ProgramFilesFixture}
function Get-GuiStartupCanonicalRoot{return $script:GuiRoot}
function Get-GuiStartupDataRoot{return $script:DataRoot}
[void][IO.Directory]::CreateDirectory((Join-Path $script:GuiRoot 'resources\installer'));[void][IO.Directory]::CreateDirectory($script:DataRoot)
$script:Context=Get-GuiStartupContext 'S-1-5-21-1-2-3-1001'
$script:OriginalRead=(Get-Command Read-GuiStartupReceipt).ScriptBlock
$script:OriginalProtected=(Get-Command Assert-GuiStartupProtectedPath).ScriptBlock
function Trusted-Acl([switch]$Directory){
 $acl=if($Directory){[Security.AccessControl.DirectorySecurity]::new()}else{[Security.AccessControl.FileSecurity]::new()}
 $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));$acl.SetAccessRuleProtection($true,$false)
 foreach($sid in @('S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','Allow'))}
 return $acl
}
$script:AclOverride=$null
function Get-Acl {param([string]$LiteralPath) if($script:AclOverride){return $script:AclOverride};return Trusted-Acl -Directory:(Test-Path -LiteralPath $LiteralPath -PathType Container)}
function Make-Payload {
 $files=@('EgoistShield.exe','resources/app.asar','resources/installer/gui-login-startup.ps1')
 [IO.File]::WriteAllText((Join-Path $script:GuiRoot $files[0]),'Harmless executable-shaped fixture; never executed.')
 [IO.File]::WriteAllText((Join-Path $script:GuiRoot $files[1]),'Harmless ASAR-shaped fixture; never executed.')
 [IO.File]::Copy($module,(Join-Path $script:GuiRoot $files[2]),$true)
 $entries=@($files|ForEach-Object{$file=Join-Path $script:GuiRoot $_;[ordered]@{path=$_;roles=@('gui');bytes=(Get-Item -LiteralPath $file).Length;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}})
 [IO.File]::WriteAllText((Join-Path $script:GuiRoot 'resources\worker-host-integrity.json'),([ordered]@{schemaVersion=1;owner='EgoistShield';files=$entries}|ConvertTo-Json -Depth 8))
}
Make-Payload
function New-Receipt {return [pscustomobject]@{schemaVersion=1;owner='EgoistShield';purpose='gui-login-startup';userSid=$script:Context.sid;taskName=$script:Context.taskName;executable=$script:Context.exe;registrationId='11111111111111111111111111111111';suspended=$false;resumeEnabled=$false}}
function New-Task([bool]$Enabled,[object]$Receipt){return [pscustomobject]@{Name=$script:Context.taskName;Path=$script:Context.taskPath;Enabled=$Enabled;Xml=(New-GuiStartupTaskXml $script:Context $Receipt $Enabled);SecurityDescriptor=$script:Context.sddl;PrincipalUserId=$script:Context.sid;PrincipalLogonType=3}}
function Reset-Fixture {if(Test-Path -LiteralPath $script:Context.receipt){[IO.File]::Delete($script:Context.receipt)};$script:Receipt=$null;$script:Task=$null;$script:Creates=0;$script:Enables=0;$script:Deletes=0;$script:OnCreate=$null;$script:AclOverride=$null}
function Read-GuiStartupReceipt {param([object]$Context)return $script:Receipt}
function Write-GuiStartupReceipt {param([object]$Context,[object]$Record)$script:Receipt=($Record|ConvertTo-Json -Depth 5|ConvertFrom-Json);[IO.File]::WriteAllText($Context.receipt,($script:Receipt|ConvertTo-Json -Depth 5))}
function Get-OwnedGuiStartupContexts {if($script:Receipt -and (Test-Path -LiteralPath $script:Context.receipt)){return $script:Context}}
function Invoke-GuiStartupLease {param([scriptblock]$Action)&$Action}
function Invoke-GuiStartupScheduler {
 param([string]$Action,[object]$Context,[string]$Xml,[bool]$TaskEnabled,[string]$ExpectedXml,[string]$ExpectedDescriptor)
 if($Action -eq 'Read'){return $script:Task}
 if($Action -eq 'Create'){
  if($script:OnCreate){&$script:OnCreate}
  if($script:Task){throw 'create-only collision'}
  $script:Creates++;$script:Task=New-Task $false $script:Receipt;$script:Task.Xml=$Xml;return
 }
 if(-not $script:Task -or $script:Task.Xml -cne $ExpectedXml -or $script:Task.SecurityDescriptor -cne $ExpectedDescriptor){throw 'task changed before mutation'}
 if($Action -eq 'SetEnabled'){$script:Enables++;$script:Task.Enabled=$TaskEnabled;$script:Task.Xml=New-GuiStartupTaskXml $script:Context $script:Receipt $TaskEnabled;return}
 if($Action -eq 'Remove'){$script:Deletes++;$script:Task=$null;return}
 throw 'unexpected scheduler action'
}
function Set-XmlValue([string]$XPath,[string]$Value){$xml=ConvertFrom-GuiStartupXml $script:Task.Xml;$ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task');$xml.SelectSingleNode($XPath,$ns).InnerText=$Value;$script:Task.Xml=$xml.OuterXml}

Reset-Fixture
Assert-Test ((Sync-GuiLoginStartup $script:Context $false).enabled -eq $false -and $script:Creates -eq 0) 'false intent never creates a task or receipt'
$script:Names.Add('false intent does not create')
Assert-Test (Sync-GuiLoginStartup $script:Context $true).enabled 'true intent verifies enabled task'
Assert-Test ($script:Creates -eq 1 -and $script:Enables -eq 1) 'new task is created disabled and enabled only after proof'
Assert-Test (Sync-GuiLoginStartup $script:Context $true).enabled 'second enable is idempotent'
Assert-Test ($script:Creates -eq 1 -and $script:Enables -eq 1) 'idempotent enable has no rewrite'
$script:Names.Add('disabled create readback enable and idempotence')
Assert-GuiStartupTaskOwned $script:Context $script:Receipt $script:Task -ExpectedEnabled $true
$script:Names.Add('exact owned XML SID action ACL and settings')

foreach($change in @(
 @('/t:Task/t:Principals/t:Principal/t:RunLevel','LeastPrivilege'),
 @('/t:Task/t:Principals/t:Principal/t:LogonType','ServiceAccount'),
 @('/t:Task/t:Principals/t:Principal/t:UserId','S-1-5-18'),
 @('/t:Task/t:Actions/t:Exec/t:Command','C:\\foreign.exe'),
 @('/t:Task/t:Actions/t:Exec/t:Arguments','--remote-debugging-port=9222'),
 @('/t:Task/t:Actions/t:Exec/t:WorkingDirectory','C:\\foreign'),
 @('/t:Task/t:Triggers/t:LogonTrigger/t:UserId','S-1-5-21-9-9-9-1001'),
 @('/t:Task/t:Settings/t:ExecutionTimeLimit','PT72H'),
 @('/t:Task/t:Settings/t:StopIfGoingOnBatteries','true'),
 @('/t:Task/t:Settings/t:MultipleInstancesPolicy','Parallel'))){
 Reset-Fixture;$script:Receipt=New-Receipt;$script:Task=New-Task $true $script:Receipt;Set-XmlValue $change[0] $change[1]
 Assert-Throws {Sync-GuiLoginStartup $script:Context $false} 'tampered task cannot be deleted'
 Assert-Test ($script:Deletes -eq 0 -and $script:Enables -eq 0) 'tampered task remains untouched'
}
$script:Names.Add('ten principal action trigger and lifetime tamper refusals')
Reset-Fixture;$script:Receipt=New-Receipt;$script:Task=New-Task $true $script:Receipt;$script:Task.SecurityDescriptor='O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;WD)'
Assert-Throws {Sync-GuiLoginStartup $script:Context $false} 'foreign task DACL refuses deletion';Assert-Test ($script:Deletes -eq 0) 'foreign ACL preserved'
$script:Names.Add('foreign ACL and task preservation')
Reset-Fixture;$script:Task=New-Task $true (New-Receipt)
Assert-Throws {Sync-GuiLoginStartup $script:Context $true} 'task without protected receipt refuses overwrite';Assert-Test ($script:Creates -eq 0 -and $script:Deletes -eq 0) 'unowned collision unchanged'
$script:Names.Add('task name alone is never ownership')
Reset-Fixture;$script:OnCreate={$script:Task=New-Task $true (New-Receipt);$script:Task.Xml='<Task />'}
Assert-Throws {Sync-GuiLoginStartup $script:Context $true} 'race at create remains create-only';Assert-Test ($script:Creates -eq 0 -and $script:Deletes -eq 0) 'raced foreign task preserved'
$script:Names.Add('create-only collision race')
Assert-Throws {ConvertFrom-GuiStartupXml '<!DOCTYPE Task [<!ENTITY x SYSTEM "file:///secret">]><Task>&x;</Task>'} 'DTD refused'
Assert-Throws {Get-GuiStartupContext 'S-1-5-18'} 'SYSTEM GUI context refused'
$script:Names.Add('DTD and service SID refusal')
Assert-GuiStartupInteractiveIdentity -TokenSid $script:Context.sid -SessionSid $script:Context.sid -SessionId 1 -IsAdministrator $true
Assert-Throws {Assert-GuiStartupInteractiveIdentity -TokenSid $script:Context.sid -SessionSid 'S-1-5-21-9-9-9-1001' -SessionId 1 -IsAdministrator $true} 'alternate administrator credentials cannot create a GUI task for this session'
Assert-Throws {Assert-GuiStartupInteractiveIdentity -TokenSid $script:Context.sid -SessionSid $script:Context.sid -SessionId 0 -IsAdministrator $true} 'service-session GUI rejected'
Assert-Throws {Assert-GuiStartupInteractiveIdentity -TokenSid $script:Context.sid -SessionSid $script:Context.sid -SessionId 1 -IsAdministrator $false} 'medium token cannot authorize highest startup'
$script:Names.Add('same interactive SID and elevated token policy')

Reset-Fixture;[void](Sync-GuiLoginStartup $script:Context $true)
$registration=$script:Receipt.registrationId
Suspend-OwnedGuiLoginStartup
Assert-Test (-not $script:Task.Enabled -and $script:Receipt.suspended -and $script:Receipt.resumeEnabled) 'installer suspension durably preserves enabled intent'
Assert-Throws {Sync-GuiLoginStartup $script:Context $true} 'normal GUI cannot defeat suspended transaction'
$maintenance=Join-Path $root 'installer\service-maintenance.json';[void][IO.Directory]::CreateDirectory((Split-Path -Parent $maintenance));[IO.File]::WriteAllText($maintenance,'{}')
Resume-OwnedGuiLoginStartup
Assert-Test (-not $script:Task.Enabled -and $script:Receipt.suspended) 'NSIS completion defers while protected worker maintains services'
[IO.File]::Delete($maintenance)
Resume-OwnedGuiLoginStartup
Assert-Test ($script:Task.Enabled -and -not $script:Receipt.suspended -and $script:Receipt.registrationId -eq $registration) 'verified payload restores same original task and intent'
$script:Names.Add('durable suspension maintenance deferral and restoration')
[void](Sync-GuiLoginStartup $script:Context $false)
Assert-Test ($script:Deletes -eq 1 -and -not $script:Task -and -not (Test-Path -LiteralPath $script:Context.receipt)) 'opt out deletes only own task'
$script:Names.Add('verified opt-out')

Reset-Fixture;[void](Sync-GuiLoginStartup $script:Context $true);Suspend-OwnedGuiLoginStartup
[IO.File]::AppendAllText((Join-Path $script:GuiRoot 'EgoistShield.exe'),'tamper')
Assert-Throws {Resume-OwnedGuiLoginStartup} 'changed GUI payload cannot be enabled during recovery'
Assert-Test (-not $script:Task.Enabled -and $script:Receipt.suspended) 'failed payload proof retains suspended intent'
Make-Payload;Resume-OwnedGuiLoginStartup
$script:Names.Add('restore requires actual pinned payload bytes')
$leases=@(Assert-GuiStartupInstallation $script:Context);foreach($lease in $leases){$lease.Dispose()}
[IO.File]::WriteAllText((Join-Path $script:GuiRoot 'foreign.dll'),'never loaded')
Assert-Throws {Assert-GuiStartupInstallation $script:Context} 'unpinned DLL refuses GUI startup authority'
[IO.File]::Delete((Join-Path $script:GuiRoot 'foreign.dll'))
$script:Names.Add('side-load inventory protection')
$script:AclOverride=Trusted-Acl
$script:AclOverride.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Write','Allow'))
Assert-Throws {Assert-GuiStartupInstallation $script:Context} 'nonadministrator GUI mutation rights refused';$script:AclOverride=$null
$script:Names.Add('protected installation ACL enforcement')

Reset-Fixture;$script:Receipt=New-Receipt;$script:Task=New-Task $true $script:Receipt
$legacy=$script:Task;$legacy.Name='EgoistShieldStartup';$legacy.Path='\EgoistShieldStartup'
$removed=@(Remove-OwnedLegacyGuiLoginStartup $script:Context)
Assert-Test ($removed.Count -eq 1 -and $script:Deletes -eq 1) 'legacy task requires actual direct GUI action SID author and protected ACL'
Reset-Fixture;$script:Receipt=New-Receipt;$script:Task=New-Task $true $script:Receipt;$script:Task.Name='EgoistShieldStartup';$script:Task.Path='\EgoistShieldStartup';Set-XmlValue '/t:Task/t:Actions/t:Exec/t:Command' 'C:\\foreign.exe'
Assert-Test (@(Remove-OwnedLegacyGuiLoginStartup $script:Context).Count -eq 0 -and $script:Deletes -eq 0) 'foreign task with legacy name is left untouched'
$script:Names.Add('legacy exact action proof and foreign-name preservation')

Reset-Fixture;[void](Sync-GuiLoginStartup $script:Context $true)
$bad=$script:Receipt | ConvertTo-Json -Depth 5 | ConvertFrom-Json;$bad.userSid='S-1-5-21-9-9-9-1001'
[IO.File]::WriteAllText($script:Context.receipt,($bad|ConvertTo-Json -Depth 5))
Assert-Throws {& $script:OriginalRead $script:Context} 'actual protected receipt parser rejects a foreign SID'
$script:Names.Add('receipt identity is validated independently of task name')
Reset-Fixture;[void](Sync-GuiLoginStartup $script:Context $true)
$xml=ConvertFrom-GuiStartupXml $script:Task.Xml;$ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
$action=$xml.SelectSingleNode('/t:Task/t:Actions',$ns);[void]$action.AppendChild($action.FirstChild.CloneNode($true));$script:Task.Xml=$xml.OuterXml
Assert-Throws {Sync-GuiLoginStartup $script:Context $false} 'an extra native Exec action prevents removal'
Assert-Test ($script:Deletes -eq 0) 'ambiguous action preserved'
$script:Names.Add('extra action is rejected')


# Representative Windows normalization; descriptors and tasks are still fixtures.
Reset-Fixture;$script:Receipt=New-Receipt;$script:Task=New-Task $true $script:Receipt
Set-XmlValue '/t:Task/t:RegistrationInfo/t:URI' $script:Context.taskPath
$xml=ConvertFrom-GuiStartupXml $script:Task.Xml;$ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
$defaultPaths=@('/t:Task/t:Triggers/t:LogonTrigger/t:Enabled')+@('MultipleInstancesPolicy','RunOnlyIfNetworkAvailable','Enabled','Hidden','RunOnlyIfIdle','WakeToRun','Priority'|ForEach-Object{'/t:Task/t:Settings/t:'+$_})
foreach($path in $defaultPaths){$node=$xml.SelectSingleNode($path,$ns);[void]$node.ParentNode.RemoveChild($node)}
$script:Task.Xml=$xml.OuterXml
Assert-GuiStartupTaskOwned $script:Context $script:Receipt $script:Task -ExpectedEnabled $true
Assert-Test (Get-GuiStartupVerifiedState $script:Context).verified 'canonical task-path URI and absent documented defaults verify'
Assert-Test ([string]$script:Task.Xml -match $script:Receipt.registrationId) 'normalized registration retains protected nonce in Description'
$script:Names.Add('Windows task path URI and omitted schema defaults')
foreach($path in @('/t:Task/t:RegistrationInfo/t:URI','/t:Task/t:RegistrationInfo/t:Description')){
 Reset-Fixture;$script:Receipt=New-Receipt;$script:Task=New-Task $true $script:Receipt;Set-XmlValue $path 'foreign-registration'
 Assert-Throws {Sync-GuiLoginStartup $script:Context $false} 'foreign URI or nonce Description refuses deletion';Assert-Test ($script:Deletes -eq 0) 'foreign registration remains untouched'
}
$script:Names.Add('task path never replaces protected registration nonce')
foreach($setting in @('DisallowStartIfOnBatteries','StopIfGoingOnBatteries','AllowHardTerminate','StartWhenAvailable','AllowStartOnDemand','ExecutionTimeLimit')){
 Reset-Fixture;$script:Receipt=New-Receipt;$script:Task=New-Task $true $script:Receipt
 $xml=ConvertFrom-GuiStartupXml $script:Task.Xml;$ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task');$node=$xml.SelectSingleNode('/t:Task/t:Settings/t:'+$setting,$ns);[void]$node.ParentNode.RemoveChild($node);$script:Task.Xml=$xml.OuterXml
 Assert-Throws {Assert-GuiStartupTaskOwned $script:Context $script:Receipt $script:Task} 'missing nondefault must not use application preference'
}
foreach($change in @(@('/t:Task/t:Triggers/t:LogonTrigger/t:Enabled','false'),@('RunOnlyIfNetworkAvailable','true'),@('Hidden','true'),@('RunOnlyIfIdle','true'),@('WakeToRun','true'),@('Priority','8'),@('AllowStartOnDemand','true'),@('StartWhenAvailable','false'),@('DisallowStartIfOnBatteries','true'),@('AllowHardTerminate','true'))){
 Reset-Fixture;$script:Receipt=New-Receipt;$script:Task=New-Task $true $script:Receipt;$path=if($change[0].StartsWith('/')){$change[0]}else{'/t:Task/t:Settings/t:'+$change[0]};Set-XmlValue $path $change[1]
 Assert-Throws {Assert-GuiStartupTaskOwned $script:Context $script:Receipt $script:Task} 'explicit opposite remains rejected'
}
Reset-Fixture;$script:Receipt=New-Receipt;$script:Task=New-Task $false $script:Receipt
$xml=ConvertFrom-GuiStartupXml $script:Task.Xml;$ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task');$node=$xml.SelectSingleNode('/t:Task/t:Settings/t:Enabled',$ns);[void]$node.ParentNode.RemoveChild($node);$script:Task.Xml=$xml.OuterXml
Assert-Throws {Assert-GuiStartupTaskOwned $script:Context $script:Receipt $script:Task -ExpectedEnabled $false} 'missing enabled means true, never suspended false'
foreach($field in @('RestartOnFailure','DeleteExpiredTaskAfter')){
 Reset-Fixture;$script:Receipt=New-Receipt;$script:Task=New-Task $true $script:Receipt
 $xml=ConvertFrom-GuiStartupXml $script:Task.Xml;$ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task');$node=$xml.CreateElement($field,$ns.LookupNamespace('t'));$node.InnerText='PT1M';[void]$xml.SelectSingleNode('/t:Task/t:Settings',$ns).AppendChild($node);$script:Task.Xml=$xml.OuterXml
 Assert-Throws {Assert-GuiStartupTaskOwned $script:Context $script:Receipt $script:Task} 'normalization never authorizes restart loops or expiry'
}
$script:Names.Add('missing nondefaults explicit opposites suspended intent restart and expiry refusals')
$oldContext=$script:Context;$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
try{
 $script:Context=Get-GuiStartupContext $identity.User.Value
 Reset-Fixture;$script:Receipt=New-Receipt;$script:Task=New-Task $true $script:Receipt;$script:Task.PrincipalUserId=$identity.Name
 Set-XmlValue '/t:Task/t:Principals/t:Principal/t:UserId' $identity.Name;Set-XmlValue '/t:Task/t:Triggers/t:LogonTrigger/t:UserId' $identity.Name
 Assert-GuiStartupTaskOwned $script:Context $script:Receipt $script:Task
 Assert-Test (Get-GuiStartupVerifiedState $script:Context).verified 'actual Windows account translates to exact interactive SID'
 $systemName=([Security.Principal.SecurityIdentifier]::new('S-1-5-18')).Translate([Security.Principal.NTAccount]).Value;$script:Task.PrincipalUserId=$systemName
 Assert-Throws {Assert-GuiStartupTaskOwned $script:Context $script:Receipt $script:Task} 'localized SYSTEM is not interactive SID'
 $script:Task.PrincipalUserId='Unresolvable-'+[Guid]::NewGuid().ToString('N')
 Assert-Throws {Assert-GuiStartupTaskOwned $script:Context $script:Receipt $script:Task} 'unresolvable account is not trusted by name'
 $script:Task.PrincipalUserId=$identity.Name;Set-XmlValue '/t:Task/t:Principals/t:Principal/t:UserId' $systemName
 Assert-Throws {Assert-GuiStartupTaskOwned $script:Context $script:Receipt $script:Task} 'XML SID must match COM SID'
}finally{$identity.Dispose();$script:Context=$oldContext}
$script:Names.Add('real Windows account resolution and localized foreign-account refusal')

Reset-Fixture;[void](Sync-GuiLoginStartup $script:Context $true);Remove-OwnedGuiLoginStartup
Assert-Test ($script:Deletes -eq 1 -and -not $script:Task -and -not (Test-Path -LiteralPath $script:Context.receipt)) 'uninstall retires only proven owned task'
$script:Names.Add('owned uninstall retirement')
$result=[ordered]@{schemaVersion=1;passed=$true;groups=@($script:Names);groupCount=$script:Names.Count;assertionCount=$script:Count;nativeTaskReads=0;nativeTaskCreates=0;nativeTaskUpdates=0;nativeTaskDeletes=0;nativeTaskActions=0;nativeAclWrites=0;productionHelperSha256=(Get-FileHash -LiteralPath $module -Algorithm SHA256).Hash.ToLowerInvariant();limitation='Controlled scheduler and ACL descriptors; real native high-token COM/logon remains hosted acceptance gate.'}
[IO.File]::WriteAllText((Join-Path $root 'gui-startup-test.json'),($result|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
Write-Output ('GUI login startup: '+$script:Names.Count+' groups, '+$script:Count+' assertions passed; no native task operations.')