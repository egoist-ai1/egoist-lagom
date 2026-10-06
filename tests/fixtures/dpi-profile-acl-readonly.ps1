param([Parameter(Mandatory=$true)][string]$NativeSourcePath,[Parameter(Mandatory=$true)][string]$DpiSourcePath,[Parameter(Mandatory=$true)][string]$WorkDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
# Actual Get-Acl loads Security type data, including Sddl. Load that same trusted module without querying ACL.
$securityModule=[IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Security','Microsoft.PowerShell.Security.psd1')
Microsoft.PowerShell.Core\Import-Module -Name $securityModule -ErrorAction Stop
function Require([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function Source-Hash([string]$Path){$sha=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($Path))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
foreach($path in @($NativeSourcePath,$DpiSourcePath,$WorkDirectory)){Require ([IO.Path]::IsPathRooted($path)) 'Explicit absolute source/work paths required'}
Require ([IO.Directory]::Exists($WorkDirectory)) 'Own work directory must exist'
$beforeHashes=@(Source-Hash $NativeSourcePath;Source-Hash $DpiSourcePath)
$parserErrors=0
function Parse-Source([string]$Path){$tokens=$null;$errors=$null;$tree=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors);Require (@($errors).Count -eq 0) 'Explicit public source parser failed';return $tree}
$nativeAst=Parse-Source $NativeSourcePath;$dpiAst=Parse-Source $DpiSourcePath
$functions=@($nativeAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true))
$names=@('Assert-NativeOrdinaryPath','Assert-NativePathWithin','Assert-NativeAdministratorAcl','Assert-NativeAdministratorOwned');$imported=@()
foreach($name in $names){
 $match=@($functions | Where-Object {$_.Name -ceq $name});Require ($match.Count -eq 1) 'Actual whitelisted function missing/duplicated';$fn=$match[0]
 $body=$fn.Body.Extent.Text.Substring(1,$fn.Body.Extent.Text.Length-2)
 Set-Item -Path ('Function:script:'+$name) -Value ([ScriptBlock]::Create($body))
 $sha=[Security.Cryptography.SHA256]::Create();try{$extentSha256=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fn.Extent.Text))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()};$imported+=[ordered]@{name=$name;sourceLine=$fn.Extent.StartLineNumber;sourceExtentSha256=$extentSha256}
}
function Profile-Command($Tree){
 $all=@($Tree.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst]},$true) | Where-Object {$_.GetCommandName() -ceq 'Assert-NativeAdministratorOwned' -and @($_.CommandElements | Where-Object {$_.Extent.Text -ceq '$acceptanceProfile'}).Count -eq 1})
 Require ($all.Count -eq 1) 'Actual acceptance profile callsite missing/duplicated';return $all[0]
}
$correctCall=Profile-Command $dpiAst
Require ($correctCall.Extent.Text -ceq 'Assert-NativeAdministratorOwned $acceptanceProfile') 'Current ProgramData profile caller must use the ordinary ACL policy'
$newCommand=[ScriptBlock]::Create($correctCall.Extent.Text)
# One known bad caller variant only, in memory. No draft/frozen whole-source comparison is used in CI.
$wrongScopeText=$correctCall.Extent.Text+' -InstallationPath'
$oldCommand=[ScriptBlock]::Create($wrongScopeText)
$systemSid='S-1-5-18';$adminSid='S-1-5-32-544';$installerSid='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';$usersSid='S-1-5-32-545';$foreignSid='S-1-5-21-1111111111-2222222222-3333333333-1001'
function Security-Record([string]$Owner,[string]$AllowSid='',[Security.AccessControl.FileSystemRights]$Rights=[Security.AccessControl.FileSystemRights]::ReadAndExecute){
 $security=[Security.AccessControl.FileSecurity]::new();$security.SetOwner([Security.Principal.SecurityIdentifier]::new($Owner));$security.SetAccessRuleProtection($true,$false)
 if($AllowSid){$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($AllowSid),$Rights,[Security.AccessControl.AccessControlType]::Allow))}
 return $security
}
$systemSecurity=Security-Record $systemSid;$adminSecurity=Security-Record $adminSid;$installerSecurity=Security-Record $installerSid
$programFiles=[Environment]::GetFolderPath('ProgramFiles');$programData=[Environment]::GetFolderPath('CommonApplicationData');$windows=[Environment]::GetFolderPath('Windows')
Require (-not [string]::IsNullOrWhiteSpace($programFiles) -and -not [string]::IsNullOrWhiteSpace($programData)) 'Known folder metadata unavailable'
$installRoot=Join-Path $programFiles 'EgoistShield';$dpiRoot=Join-Path (Join-Path $programData 'EgoistShield') 'Runtime\Zapret'
$exactProfile=Assert-NativePathWithin (Join-Path $dpiRoot 'core\lagom-ci-fictional-acl-scope-only.bat') $dpiRoot
$script:Checks=[Collections.Generic.List[object]]::new();$script:mockAclReads=0;$script:leafSecurity=$systemSecurity
$script:acceptanceProfile=Join-Path ([IO.Path]::GetFullPath($WorkDirectory)) ('fictional-acl-'+[Guid]::NewGuid().ToString('N')+'.txt')
[IO.File]::WriteAllText($script:acceptanceProfile,'Owned inert fixture: no installed data.',[Text.UTF8Encoding]::new($false))
# Only the Get-Acl OS leaf is mocked. The ordinary/no-reparse function reads our own file/ancestors.
function Get-Acl {param([string]$LiteralPath);Require ([IO.Path]::GetFullPath($LiteralPath) -ceq [IO.Path]::GetFullPath($script:acceptanceProfile)) 'ACL leaf may only address the own fixture';$script:mockAclReads++;return $script:leafSecurity}
function Check([string]$Name,[ScriptBlock]$Run){& $Run | Out-Null;$script:Checks.Add([ordered]@{name=$Name;passed=$true})}
function Refuse([ScriptBlock]$Run,[string]$Reason){$message=$null;try{& $Run | Out-Null}catch{$message=$_.Exception.Message};Require ($null -ne $message -and $message -match $Reason) ('Expected exact refusal: '+$Reason+'; actual inert error: '+$message);return $message}
Check 'empty relative Join-Path resolves the canonical installation root' {Assert-NativeAdministratorAcl -Security $systemSecurity -Path (Join-Path $installRoot '') -InstallationPath}
Check 'canonical installation descendant retains administrator ACL admission' {Assert-NativeAdministratorAcl -Security $adminSecurity -Path (Join-Path $installRoot 'resources\component-worker.cjs') -InstallationPath}
Check 'TrustedInstaller is admitted only for canonical installation scope' {Assert-NativeAdministratorAcl -Security $installerSecurity -Path (Join-Path $installRoot 'EgoistShield.Worker.exe') -InstallationPath}
Check 'installation sibling prefix remains rejected' {Refuse {Assert-NativeAdministratorAcl -Security $systemSecurity -Path (Join-Path ($installRoot+'-foreign') 'fixture.exe') -InstallationPath} 'scope escaped canonical'}
Check 'installation dotdot escape remains rejected' {Refuse {Assert-NativeAdministratorAcl -Security $systemSecurity -Path (Join-Path $installRoot '..\foreign\fixture.exe') -InstallationPath} 'scope escaped canonical'}
Check 'installation scope still requires an absolute path' {Refuse {Assert-NativeAdministratorAcl -Security $systemSecurity -Path 'relative\fixture.exe' -InstallationPath} 'requires an absolute'}
Check 'RED exact ProgramData profile cannot be treated as Program Files installation' {$script:redProgramData=Refuse {Assert-NativeAdministratorAcl -Security $systemSecurity -Path $exactProfile -InstallationPath} 'scope escaped canonical'}
Check 'GREEN exact scoped ProgramData profile admits only ordinary administrator ACL policy' {$bound=Assert-NativePathWithin $exactProfile $dpiRoot;Assert-NativeAdministratorAcl -Security $systemSecurity -Path $bound}
Check 'TrustedInstaller owner is forbidden for ProgramData profile' {Refuse {Assert-NativeAdministratorAcl -Security $installerSecurity -Path $exactProfile} 'Untrusted installation owner'}
Check 'TrustedInstaller write ACE is forbidden for ProgramData profile' {$security=Security-Record $adminSid $installerSid ([Security.AccessControl.FileSystemRights]::FullControl);Refuse {Assert-NativeAdministratorAcl -Security $security -Path $exactProfile} 'Untrusted write/delete ACE'}
Check 'foreign owner is still rejected for ProgramData profile' {$security=Security-Record $foreignSid;Refuse {Assert-NativeAdministratorAcl -Security $security -Path $exactProfile} 'Untrusted installation owner'}
Check 'ordinary users write ACE remains rejected' {$security=Security-Record $adminSid $usersSid ([Security.AccessControl.FileSystemRights]::Write);Refuse {Assert-NativeAdministratorAcl -Security $security -Path $exactProfile} 'Untrusted write/delete ACE'}
Check 'ordinary users readonly ACE remains permitted' {$security=Security-Record $adminSid $usersSid;Assert-NativeAdministratorAcl -Security $security -Path $exactProfile}
Check 'canonical installation comparison remains case insensitive' {Assert-NativeAdministratorAcl -Security $systemSecurity -Path $installRoot.ToLowerInvariant() -InstallationPath}
Check 'ProgramData profile path cannot escape the exact owned DPI root' {Refuse {Assert-NativePathWithin (Join-Path $dpiRoot '..\foreign\fixture.bat') $dpiRoot} 'path escaped its scope'}
Check 'RED one in-memory wrong-scope variant of actual caller is refused' {$script:leafSecurity=$systemSecurity;$script:redOriginalCall=Refuse {& $oldCommand} 'scope escaped canonical'}
Check 'current actual AST profile caller preserves ordinary path and owner checks' {$script:leafSecurity=$systemSecurity;$result=& $newCommand;Require ($result.path -ceq $script:acceptanceProfile -and $result.owner -ceq $systemSid) 'Actual owned-profile command did not preserve ordinary ACL receipt'}
Check 'current actual AST profile caller rejects untrusted write ACE' {$script:leafSecurity=Security-Record $adminSid $usersSid ([Security.AccessControl.FileSystemRights]::Write);Refuse {& $newCommand} 'Untrusted write/delete ACE'}
Check 'current actual profile caller rejects a reparse leaf before its ACL read' {
 $beforeAcl=$script:mockAclReads;$script:reparseMockReads=0
 try{
  Set-Item -Path 'Function:script:Get-Item' -Value {
   [CmdletBinding()]param([string]$LiteralPath,[switch]$Force)
   Require ([IO.Path]::GetFullPath($LiteralPath) -ceq [IO.Path]::GetFullPath($script:acceptanceProfile)) 'Reparse OS leaf fixture may only address the own file'
   $script:reparseMockReads++
   return [pscustomobject]@{Attributes=[IO.FileAttributes]::ReparsePoint;PSIsContainer=$false}
  }
  Refuse {& $newCommand} 'Reparse path refused'
  Require ($script:reparseMockReads -eq 1 -and $script:mockAclReads -eq $beforeAcl) 'Reparse caller reached its ACL leaf'
 }finally{Remove-Item -Path 'Function:script:Get-Item'}
}
Require ($script:Checks.Count -eq 19 -and $script:mockAclReads -eq 3) 'Exact 19 CI cases/3 mocked ACL reads required'

$afterHashes=@(Source-Hash $NativeSourcePath;Source-Hash $DpiSourcePath)
Require (($beforeHashes -join ',') -ceq ($afterHashes -join ',')) 'Actual source bytes changed during CI check'
[ordered]@{schemaVersion=1;kind='source-bound-readonly-dpi-profile-acl-ci-guards';powershellVersion=$PSVersionTable.PSVersion.ToString();edition=$PSVersionTable.PSEdition;parserErrors=0;pass=19;caseCount=19;checks=$script:Checks;importedFunctions=$imported;nativeSourceSha256=$beforeHashes[0];dpiSourceSha256=$beforeHashes[1];currentProfileCaller=[ordered]@{line=$correctCall.Extent.StartLineNumber;text=$correctCall.Extent.Text};wrongCallerVariant=[ordered]@{text=$wrongScopeText;inMemoryOnly=$true};knownFolders=[ordered]@{programFiles=$programFiles;commonApplicationData=$programData;windows=$windows;systemDrive=$env:SystemDrive;process64Bit=[Environment]::Is64BitProcess};programDataPath=$exactProfile;redProgramDataError=$script:redProgramData;redWrongCallerError=$script:redOriginalCall;greenExactProgramData=$true;canonicalInstallationGuardChanged=$false;trustedInstallerProgramDataAdmitted=$false;securityModuleTypeDataLoaded=$true;mockedAclLeafReads=3;mockedReparseLeafReads=1;actualAclOsRead=0;actualOrdinaryPathReads='own fixture file and ancestors only';harnessEntrypointsExecuted=0;installedProductFilesRead=0;privateDataRead=0;serviceActions=0;scm=0;tasks=0;drivers=0;gui=0;uia=0;uac=0;setup=0;networkQueries=0;externalNetwork=0;sourceWrites=0;limitations=@('Canonical Program Files and ProgramData paths are lexical metadata only; no installed product file is read.','Real in-memory FileSecurity/SIDs and an own runtime file are used; Get-Acl and one negative reparse Get-Item OS leaf are mocked.','Actual native DPI, provisioning and cleanup operations are not run; CI guard PASS is not native acceptance.')}|ConvertTo-Json -Depth 9
