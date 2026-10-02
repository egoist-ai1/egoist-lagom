param([Parameter(Mandatory=$true)][string]$TestDirectory,[string]$SourcePath='',[switch]$ExpectBaselineFailure)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
function Require([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
$root=[IO.Path]::GetFullPath($TestDirectory).TrimEnd('\')
Require ((Split-Path -Leaf $root) -like 'lagom-upgrade-state-identity-*') 'Use a task-owned identity fixture directory.'
Require (((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'Fixture root must be ordinary.'
if(-not $SourcePath){$SourcePath=Join-Path (Split-Path -Parent $PSScriptRoot) 'src\installer\owned-cleanup.ps1'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($SourcePath,[ref]$tokens,[ref]$errors)
Require ($errors.Count -eq 0) 'Production cleanup failed native parsing.'
$repair=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Repair-UpgradeStateAccess'},$true)
$normalize=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Resolve-NormalizedPath'},$true)
. ([scriptblock]::Create($normalize.Extent.Text))
. ([scriptblock]::Create($repair.Extent.Text))
$actualIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
$actualSid=$actualIdentity.User
$actualAdmin=([Security.Principal.WindowsPrincipal]::new($actualIdentity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$script:forceRole=$true;$script:newItems=0
$script:takeownCalls=New-Object 'Collections.Generic.List[object]'
$savedFixtureState=$env:EGOISTSHIELD_INSTALLER_STATE_DIR;$env:EGOISTSHIELD_INSTALLER_STATE_DIR=''
function Assert-FixturePath([string]$Path){Require ([IO.Path]::GetFullPath($Path).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) 'Boundary escaped fixture.'}
function New-Object {
  [CmdletBinding()]param([Parameter(Position=0)][string]$TypeName,[Parameter(Position=1)][object[]]$ArgumentList)
  if($TypeName -eq 'Security.Principal.WindowsPrincipal' -and $script:forceRole){
    $principal=[pscustomobject]@{}
    $principal|Add-Member ScriptMethod IsInRole {param($Role)if($Role -ne [Security.Principal.WindowsBuiltInRole]::Administrator){throw 'Unexpected role query'};return $true}
    return $principal
  }
  Microsoft.PowerShell.Utility\New-Object @PSBoundParameters
}
function New-Item {[CmdletBinding()]param([string]$ItemType,[string]$Path,[switch]$Force)Assert-FixturePath $Path;$script:newItems++;Microsoft.PowerShell.Management\New-Item @PSBoundParameters}
function Invoke-CheckedExternal {
  param([string]$Executable,[object[]]$Arguments,[string]$Stage)
  Require ((Split-Path -Leaf $Executable) -eq 'takeown.exe' -and $Arguments[0] -eq '/F' -and $Arguments[2] -eq '/A') 'Unexpected native boundary.'
  Assert-FixturePath ([string]$Arguments[1])
  $script:takeownCalls.Add([pscustomobject]@{target=[string]$Arguments[1];recursive=($Arguments -contains '/R')});return 0
}
function Set-SeedAcl([string]$Path){
  if([IO.Directory]::Exists($Path)){
    $acl=[Security.AccessControl.DirectorySecurity]::new()
    $rule=[Security.AccessControl.FileSystemAccessRule]::new($actualSid,[Security.AccessControl.FileSystemRights]::FullControl,([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
  }else{
    $acl=[Security.AccessControl.FileSecurity]::new()
    $rule=[Security.AccessControl.FileSystemAccessRule]::new($actualSid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow)
  }
  $acl.SetAccessRuleProtection($true,$false);[void]$acl.AddAccessRule($rule)
  if([IO.Directory]::Exists($Path)){[IO.Directory]::SetAccessControl($Path,$acl)}else{[IO.File]::SetAccessControl($Path,$acl)}
}
function Get-PathAcl([string]$Path){if([IO.Directory]::Exists($Path)){return [IO.Directory]::GetAccessControl($Path)}else{return [IO.File]::GetAccessControl($Path)}}
function New-Fixture([string]$Name){
  $case=Join-Path $root $Name
  $script:programDataRoot=Join-Path $case 'data';$script:upgradeStateDirectory=Join-Path $programDataRoot 'EgoistShield\installer'
  [void][IO.Directory]::CreateDirectory($upgradeStateDirectory)
  $script:upgradeMarkerPath=Join-Path $upgradeStateDirectory 'pending-upgrade-quarantine.txt'
  $script:upgradeJournalPath=Join-Path $upgradeStateDirectory 'upgrade-journal.json'
  $script:registrationBackupDirectory=Join-Path $upgradeStateDirectory 'registration-backup'
  $script:networkBaselinePath=Join-Path $upgradeStateDirectory 'network-baseline.json'
  $script:userStateBackupDirectory=Join-Path $upgradeStateDirectory 'user-state-backup'
  $script:serviceBackupDirectory=Join-Path $upgradeStateDirectory 'service-backup'
  $script:runtimeQuarantineManifestPath=Join-Path $upgradeStateDirectory 'runtime-quarantine.json'
  $allowed=New-Object 'Collections.Generic.List[string]';$allowed.Add($upgradeStateDirectory)
  foreach($path in @($upgradeMarkerPath,$upgradeJournalPath,$networkBaselinePath,$runtimeQuarantineManifestPath)){[IO.File]::WriteAllText($path,'fixture data');$allowed.Add($path)}
  foreach($path in @($registrationBackupDirectory,$userStateBackupDirectory,$serviceBackupDirectory)){
    [void][IO.Directory]::CreateDirectory((Join-Path $path 'nested'))
    $leaf=Join-Path $path 'nested\fixture.json';[IO.File]::WriteAllText($leaf,'fixture data')
    $allowed.Add($path);$allowed.Add((Join-Path $path 'nested'));$allowed.Add($leaf)
  }
  $excluded=New-Object 'Collections.Generic.List[string]'
  foreach($name in @('Logs','SecureWork','unrelated')){
    $path=Join-Path $upgradeStateDirectory $name;[void][IO.Directory]::CreateDirectory($path)
    $leaf=Join-Path $path 'preserved.txt';[IO.File]::WriteAllText($leaf,'preserve this data')
    $excluded.Add($path);$excluded.Add($leaf)
  }
  foreach($path in @($allowed.ToArray()+$excluded.ToArray())){Set-SeedAcl $path}
  $before=@{};foreach($path in $excluded){$before[$path]=(Get-PathAcl $path).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)}
  $script:newItems=0;$script:takeownCalls.Clear()
  return [pscustomobject]@{root=$case;allowed=@($allowed.ToArray());excluded=@($excluded.ToArray());before=$before}
}
function Invoke-RepairWithCallerPoison([string]$Poison=''){
  Set-StrictMode -Off # Production scope exposes the constructor defect.
  if($Poison){$installerIdentitySid=$Poison}
  Repair-UpgradeStateAccess
}
function Assert-Repaired($Case){
  $expected=@('S-1-5-18','S-1-5-32-544',$actualSid.Value)|Select-Object -Unique|Sort-Object
  foreach($path in $Case.allowed){
    $acl=Get-PathAcl $path;$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    Require $acl.AreAccessRulesProtected 'Production ACL is not protected.'
    Require ($rules.Count -eq $expected.Count) 'Duplicate ACE or unrelated SID retained.'
    Require ((@($rules|ForEach-Object{$_.IdentityReference.Value}|Sort-Object) -join '|') -ceq ($expected -join '|')) 'Actual installer SID lost or caller poison retained.'
    foreach($rule in $rules){
      Require (-not $rule.IsInherited -and $rule.AccessControlType -eq 'Allow' -and $rule.FileSystemRights -eq 'FullControl') 'Full-control/inheritance semantics changed.'
      if([IO.Directory]::Exists($path)){Require ($rule.InheritanceFlags -eq ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit)) 'Directory inheritance flags changed.'}
    }
  }
  foreach($path in $Case.excluded){Require ((Get-PathAcl $path).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -ceq $Case.before[$path]) 'Excluded protected DACL changed.'}
  foreach($call in $takeownCalls){Require ($Case.excluded -notcontains $call.target) 'Takeown reached an excluded item.'}
  Require (@($takeownCalls|Where-Object{$_.target -eq $upgradeStateDirectory -and $_.recursive}).Count -eq 0) 'Takeown recursively traversed installer parent.'
}
try{
  $first=New-Fixture 'first'
  $failure=$null;try{Invoke-RepairWithCallerPoison}catch{$failure=$_}
  if($ExpectBaselineFailure){
    Require ($null -ne $failure -and $failure.FullyQualifiedErrorId -like '*CannotFindAppropriateCtor*') 'Baseline did not reproduce CannotFindAppropriateCtor.'
    Require ($script:newItems -eq 1 -and $script:takeownCalls.Count -eq 1) 'Baseline original mutation order changed.'
    Write-Output 'RED reproduced: actual Repair AST failed CannotFindAppropriateCtor after one directory creation and one harmless takeown boundary.'
    exit 0
  }
  Require ($null -eq $failure) ('Actual Repair AST failed: '+$(if($failure){$failure.FullyQualifiedErrorId}else{''}))
  Assert-Repaired $first
  $poison=New-Fixture 'caller-poison';Invoke-RepairWithCallerPoison 'S-1-5-21-111-222-333-444';Assert-Repaired $poison
  Write-Output 'PASS: exact Repair AST uses actual WindowsIdentity SID, ignores caller-scope poison, and writes real protected SYSTEM/Administrators/installer full-control DACLs without duplicate ACEs'
  Write-Output 'PASS: protected Logs/SecureWork/unrelated leaves unchanged; harmless takeown boundary stays within selected own paths'
  $wrong=New-Fixture 'wrong-path';$script:upgradeStateDirectory=Join-Path $wrong.root 'unrelated-target'
  $failed=$false;try{Invoke-RepairWithCallerPoison}catch{$failed=$_.Exception.Message -like '*outside the owned installer state root*'}
  Require ($failed -and $newItems -eq 0 -and $takeownCalls.Count -eq 0) 'Owned-path guard did not refuse before mutation.'
  # Only acquisition RHS is replaced in invalid-identity negatives. Positive
  # cases above execute the entire exact function with real GetCurrent.
  $assignment=$repair.Find({param($n)$n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$identity'},$true)
  $providerBody=$repair.Extent.Text;$offset=$assignment.Right.Extent.StartOffset-$repair.Extent.StartOffset
  $providerBody=$providerBody.Remove($offset,$assignment.Right.Extent.Text.Length).Insert($offset,'Get-FixtureIdentity')
  function Get-FixtureIdentity {return $script:invalidIdentity}
  . ([scriptblock]::Create($providerBody))
  foreach($value in @('','not-a-sid')){
    $case=New-Fixture ('invalid-'+[Guid]::NewGuid().ToString('N'))
    $script:invalidIdentity=[pscustomobject]@{User=[pscustomobject]@{Value=$value}}
    $failed=$false;try{Invoke-RepairWithCallerPoison}catch{$failed=$true}
    Require ($failed -and $newItems -eq 0 -and $takeownCalls.Count -eq 0) 'Invalid SID reached New-Item or takeown.'
  }
  . ([scriptblock]::Create($repair.Extent.Text))
  Write-Output 'PASS: controlled invalid/empty identity acquisition and exact owned-path guard refuse before New-Item/takeown'
  if(-not $actualAdmin){
    $case=New-Fixture 'real-nonadmin';$script:forceRole=$false
    $failed=$false;try{Invoke-RepairWithCallerPoison}catch{$failed=$_.Exception.Message -like '*elevated administrator token*'}
    Require ($failed -and $newItems -eq 0 -and $takeownCalls.Count -eq 0) 'Actual nonAdmin token bypassed guard.'
    $script:forceRole=$true
    Write-Output 'PASS: actual non-elevated token fails closed; positive Administrator-role boundary explicitly controlled'
  }else{Write-Output 'PASS: actual administrator token present; positive role boundary explicitly controlled'}
  foreach($kind in @('root','child')){
    $case=New-Fixture ('reparse-'+$kind)
    $target=Join-Path $case.root 'junction-target';[void][IO.Directory]::CreateDirectory($target);Set-SeedAcl $target
    $before=(Get-PathAcl $target).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
    $link=if($kind -eq 'root'){$upgradeStateDirectory}else{$registrationBackupDirectory}
    Assert-FixturePath $link;Microsoft.PowerShell.Management\Remove-Item -LiteralPath $link -Recurse -Force
    [void](Microsoft.PowerShell.Management\New-Item -ItemType Junction -Path $link -Target $target)
    $script:newItems=0;$script:takeownCalls.Clear()
    $failed=$false;try{Invoke-RepairWithCallerPoison}catch{$failed=$_.Exception.Message -like '*reparse point*'}
    Require $failed 'Actual NTFS reparse point was accepted.'
    Require ((Get-PathAcl $target).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -ceq $before) 'Reparse target DACL changed.'
    Require (@($takeownCalls|Where-Object{$_.target -eq $link}).Count -eq 0) 'Takeown reached reparse link.'
  }
  $case=New-Fixture 'fixture-env';$before=(Get-PathAcl $upgradeStateDirectory).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
  $env:EGOISTSHIELD_INSTALLER_STATE_DIR=$upgradeStateDirectory;$script:forceRole=$false;Invoke-RepairWithCallerPoison
  Require ($takeownCalls.Count -eq 0 -and (Get-PathAcl $upgradeStateDirectory).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -ceq $before) 'Existing fixture-env early return changed DACL or invoked takeown.'
  Write-Output 'PASS: real NTFS root/child reparse guards and existing fixture-env early return retained'
  Write-Output 'Installer upgrade-state identity: 9 cases passed; actual Windows identity and .NET ACL operations; native takeown/SCM/registry/DNS/tasks/UAC 0.'
}finally{$env:EGOISTSHIELD_INSTALLER_STATE_DIR=$savedFixtureState}
