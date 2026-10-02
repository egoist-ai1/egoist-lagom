param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$project=Split-Path -Parent $PSScriptRoot
$testRoot=[IO.Path]::GetFullPath($TestDirectory)
if (-not $testRoot.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Use task-owned ACL fixtures.' }
function Require([bool]$Value,[string]$Message) { if (-not $Value) { throw $Message } }
function Read-Ast([string]$Path) {
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors)
  Require ($errors.Count -eq 0) 'ACL fixture source failed Windows PowerShell parsing.'
  return $ast
}
function Import-Function($Ast,[string]$Name) {
  $fn=$Ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $Name},$true)
  Require ($null -ne $fn) ('Missing ACL fixture function '+$Name)
  . ([scriptblock]::Create(($fn.Extent.Text -replace '^function ','function script:')))
}
$workerPath=Join-Path $project 'scripts\invoke-final-silent-reinstall.ps1'
$workerAst=Read-Ast $workerPath
$workerHash=(Get-FileHash -LiteralPath $workerPath).Hash
foreach ($name in @('Get-FileSha256','Assert-PlainWrapperMigrationPath','Get-SystemDohPrivatePolicyDigest','Get-SystemDohActivationDigest','Test-SystemDohConfigArgument','Get-SystemDohRecoveryFiles','Write-VerifiedSystemDohRecoveryRuntime','Test-OwnedSystemDohRecoveryRuntime','Test-PreservedPrivateDnsIntent','Assert-SystemDohPayloadContinuity','Get-SystemDohPayloadContinuityLease','Close-SystemDohRuntimeLease','Protect-StageDirectory','New-InstallerProtectedFileSecurity','Protect-InstallerStageFile','Assert-OwnedSystemDohInputSingleLink','Protect-OwnedSystemDohMigrationInputs')) { Import-Function $workerAst $name }
# Reuse the established controlled native identity boundary, not its test body.
$proofAst=Read-Ast (Join-Path $PSScriptRoot 'installer-private-dns-proof.ps1')
foreach ($name in @('Assert-PreservedServiceRegistration','Get-PreservedRegistryBackup','Assert-CurrentPreservedServiceOwnership','Assert-InstallerBootRecoveryFileProtection','Get-InstalledIdentity','Write-JsonAtomic','Get-InstallerServiceState','Get-CimInstance','Get-Process')) { Import-Function $proofAst $name }
$newFixture=$proofAst.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'New-Fixture'},$true)
$text=($newFixture.Extent.Text -replace '^function ','function script:').Replace("`$script:RuntimeRoot=Join-Path `$case 'Runtime'","`$script:RuntimeRoot=Join-Path `$case 'OwnedData\Runtime'")
. ([scriptblock]::Create($text))
function New-LegacySecurity([switch]$Directory,[switch]$Writer,[switch]$ForeignOwner) {
  $security=if($Directory){[Security.AccessControl.DirectorySecurity]::new()}else{[Security.AccessControl.FileSecurity]::new()}
  $owner=if($ForeignOwner){'BU'}else{'BA'}
  $rights=if($Writer){'0x1301bf'}else{'0x1200a9'}
  $security.SetSecurityDescriptorSddlForm(('O:'+ $owner+'G:SYD:AI(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;'+$rights+';;;BU)'))
  return $security
}
function Get-Acl {
  [CmdletBinding()]param([string]$LiteralPath)
  if ($script:AclByPath.ContainsKey($LiteralPath)) { return $script:AclByPath[$LiteralPath] }
  return New-LegacySecurity -Directory:(Test-Path -LiteralPath $LiteralPath -PathType Container)
}
function Set-Acl {
  [CmdletBinding()]param([string]$LiteralPath,$AclObject)
  Require ($script:AllowedChanges -contains $LiteralPath) 'ACL change escaped the exact owned DNS inputs.'
  $script:AclChanges.Add($LiteralPath)
  $script:AclByPath[$LiteralPath]=$AclObject
  if ($script:ChangedGeneration) { $script:service.ProcessId=999 }
  if ($script:AttemptStateWrite) { [IO.File]::AppendAllText((Join-Path $component 'state.json'),' ') }
}
function Add-ReceiptEvent { param($Stage,$Status,$Message) $script:Statuses.Add([string]$Status) }
function Start-Service { throw 'Forbidden native service start.' }
function Stop-Service { throw 'Forbidden native service stop.' }
function Stop-Process { throw 'Forbidden native process termination.' }
function Set-DnsClientServerAddress { throw 'Forbidden native adapter write.' }
function sc.exe { throw 'Forbidden native SCM mutation.' }
function Test-PrivateSecurity($Security) {
  $rules=@($Security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  return $Security.AreAccessRulesProtected -and $rules.Count -eq 2 -and
    @($rules | Where-Object { $_.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544') -or $_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne 'FullControl' -or $_.InheritanceFlags -ne 'None' -or $_.PropagationFlags -ne 'None' }).Count -eq 0
}
$bootAst=Read-Ast (Join-Path $project 'src\installer\maintenance-boot-recovery.ps1')
function Reset-AclFixture([switch]$NoSupervision) {
  Import-Function $proofAst 'Assert-InstallerBootRecoveryFileProtection'
  New-Fixture
  $primary=Join-Path (Split-Path -Parent $state.userState[0].source) 'egoistshield-state.json'
  Copy-Item -LiteralPath $state.userState[0].source -Destination $primary
  $state.userState[0].source=$primary
  $runtimeState=Join-Path $component 'state.json'
  [IO.File]::WriteAllText($runtimeState,'{"pid":101,"localAddress":"127.0.0.1","localPort":53,"url":"https://private.example.invalid:8443/dns-query/fixture-only"}')
  $script:supervision=Join-Path $OwnedDataRoot 'Service\service-supervision.json'
  if (-not $NoSupervision) { [IO.File]::WriteAllText($supervision,'{"schemaVersion":1,"owner":"EgoistShield","services":{"EgoistShieldSystemDoH":{"running":true}}}') }
  $state | Add-Member NoteProperty payloadContinuity (Test-OwnedSystemDohRecoveryRuntime -State $state -PreservedRuntimeRecovery -AsEvidence)
  $script:AllowedFiles=@($runtimeState,$config,$engine,$wrapper,$xml)+$(if($NoSupervision){@()}else{@($supervision)})
  $script:AllowedChanges=@($component,(Join-Path $component 'runtime'),(Join-Path $component 'service-wrapper'))+$AllowedFiles
  $script:AclByPath=@{}
  $script:AclChanges=[Collections.Generic.List[string]]::new()
  $script:Statuses=[Collections.Generic.List[string]]::new()
  $script:ChangedGeneration=$false;$script:AttemptStateWrite=$false
  foreach($path in $AllowedChanges){$AclByPath[$path]=New-LegacySecurity -Directory:(Test-Path -LiteralPath $path -PathType Container)}
  Import-Function $bootAst 'Assert-InstallerBootRecoveryFileProtection'
  $script:Before=@{}
  foreach($path in $AllowedFiles){$Before[$path]=Get-FileSha256 $path}
}
function Assert-Unchanged {
  foreach($path in $Before.Keys){Require ((Get-FileSha256 $path) -ceq $Before[$path]) 'Private ACL upgrade changed protected input bytes.'}
  Require ($service.State -ceq 'Running') 'Private ACL upgrade stopped the resolver.'
}
function Expect-Refusal([string]$Name,[scriptblock]$Mutation,[switch]$AfterChanges) {
  Reset-AclFixture
  & $Mutation
  $refused=$false;try{[void](Protect-OwnedSystemDohMigrationInputs -State $state)}catch{$refused=$true}
  Require $refused ('Private ACL upgrade accepted '+$Name)
  if(-not $AfterChanges){Require ($AclChanges.Count -eq 0) ('Private ACL upgrade changed rights before refusing '+$Name)}
  Assert-Unchanged
  $script:cases++
}
$script:cases=0
Reset-AclFixture
Require (-not (Test-PrivateSecurity (Get-Acl -LiteralPath $config))) 'Legacy inherited Users READ fixture was already private.'
Require (Protect-OwnedSystemDohMigrationInputs -State $state) 'Exact retained private generation was refused.'
foreach($path in $AllowedFiles){Require (Test-PrivateSecurity (Get-Acl -LiteralPath $path)) 'Protected file did not have the exact explicit Admin/SYSTEM private ACL.'}
Require ($AclChanges.Count -eq 9 -and $Statuses.Contains('private-dns-input-acls-protected')) 'Exact protected ACL inventory or completion receipt was missing.'
Assert-Unchanged
Require (Test-OwnedSystemDohRecoveryRuntime -State $state -PreservedRuntimeRecovery) 'ACL upgrade changed the owned PID/birth/private generation.'
$script:cases++
Reset-AclFixture -NoSupervision
Require (Protect-OwnedSystemDohMigrationInputs -State $state) 'Absent optional supervision intent blocked the upgrade.'
Require (-not (Test-Path -LiteralPath $supervision) -and $AclChanges.Count -eq 8) 'ACL upgrade invented missing supervision intent.'
Assert-Unchanged;$script:cases++
Expect-Refusal 'untrusted writer' {$AclByPath[$config]=New-LegacySecurity -Writer}
Expect-Refusal 'foreign owner' {$AclByPath[$config]=New-LegacySecurity -ForeignOwner}
Expect-Refusal 'manual off' {$doc=Get-Content -LiteralPath $state.userState[0].source -Raw|ConvertFrom-Json;$doc.settings.systemDohEnabled=$false;Write-JsonAtomic $state.userState[0].source $doc}
Expect-Refusal 'foreign private endpoint state' {$doc=Get-Content -LiteralPath (Join-Path $component 'state.json') -Raw|ConvertFrom-Json;$doc.url='https://different.example.invalid/dns-query';Write-JsonAtomic (Join-Path $component 'state.json') $doc;$Before[(Join-Path $component 'state.json')]=Get-FileSha256 (Join-Path $component 'state.json')}
Expect-Refusal 'stopped supervision intent' {$doc=Get-Content -LiteralPath $supervision -Raw|ConvertFrom-Json;$doc.services.EgoistShieldSystemDoH.running=$false;Write-JsonAtomic $supervision $doc;$Before[$supervision]=Get-FileSha256 $supervision}
Expect-Refusal 'foreign supervision owner' {$doc=Get-Content -LiteralPath $supervision -Raw|ConvertFrom-Json;$doc.owner='foreign';Write-JsonAtomic $supervision $doc;$Before[$supervision]=Get-FileSha256 $supervision}
Expect-Refusal 'foreign listener' {$tcp[0].OwningProcess=999}
Expect-Refusal 'linked runtime configuration' {New-Item -ItemType HardLink -Path (Join-Path $component 'config-alias.json') -Target $config|Out-Null}
Expect-Refusal 'linked legacy state' {New-Item -ItemType HardLink -Path (Join-Path $component 'state-alias.json') -Target (Join-Path $component 'state.json')|Out-Null}
Expect-Refusal 'linked supervision intent' {New-Item -ItemType HardLink -Path (Join-Path $OwnedDataRoot 'Service\supervision-alias.json') -Target $supervision|Out-Null}
Expect-Refusal 'generation changed during ACL application' {$script:ChangedGeneration=$true} -AfterChanges
Expect-Refusal 'state write during ACL application' {$script:AttemptStateWrite=$true} -AfterChanges
Require ((Get-FileHash -LiteralPath $workerPath).Hash -ceq $workerHash) 'Installer source changed during ACL validation.'
Write-Output ('Private DNS ACL upgrade: '+$cases+' cases passed; real file leases/JSON/SHA/private SecurityDescriptors/hardlink identity; controlled ACL/CIM/SCM boundaries; production mutations0')
