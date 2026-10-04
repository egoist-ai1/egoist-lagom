param([Parameter(Mandatory=$true)][string]$TestDirectory,[switch]$NativeAcl)
$ErrorActionPreference='Stop';Set-StrictMode -Version 2
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5){throw 'Run this regression in Windows PowerShell 5.'}
if(-not $env:LAGOM_TEST_TEMP -or -not [IO.Path]::IsPathRooted($env:LAGOM_TEST_TEMP)){throw 'Set task-scoped LAGOM_TEST_TEMP.'}
$root=[IO.Path]::GetFullPath($TestDirectory)
$boundary=[IO.Path]::GetFullPath($env:LAGOM_TEST_TEMP).TrimEnd('\')+'\'
if(-not $root.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)){throw 'Receipt fixture must stay within task-scoped LAGOM_TEST_TEMP.'}
if($NativeAcl -and -not [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'The native ACL fixture requires an elevated token.'}
$project=Split-Path -Parent $PSScriptRoot
$module=Join-Path $project 'src\installer\gui-login-startup.ps1'
$parseTokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($module,[ref]$parseTokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'GUI startup helper has parser errors.'}
. $module
[void][IO.Directory]::CreateDirectory($root)
Assert-GuiStartupPlainPath $root
$dataRoot=Join-Path $root 'receipt-state\GuiStartup'
$sid='S-1-5-21-1-2-3-1001'
$context=[pscustomobject]@{root=(Join-Path $root 'PF [x]');exe=(Join-Path $root 'PF [x]\EgoistShield.exe');sid=$sid;taskName=('EgoistLagom-GuiAutostart-'+$sid);dataRoot=$dataRoot;receipt=(Join-Path $dataRoot ($sid+'.json'))}
$record=[pscustomobject]@{schemaVersion=1;owner='EgoistShield';purpose='gui-login-startup';userSid=$sid;taskName=$context.taskName;executable=$context.exe;registrationId=[Guid]::NewGuid().ToString('N');suspended=$false;resumeEnabled=$false;note=([char]0x041F+[string][char]0x0443+[string][char]0x0441+[string][char]0x043A)}
$utf8=[Text.UTF8Encoding]::new($false)
$count=0
function Assert-ReceiptTest([bool]$Condition,[string]$Message){$script:count++;if(-not $Condition){throw ('GUI startup receipt regression: '+$Message)}}
function Assert-ReceiptRejected([scriptblock]$Action,[string]$Message){$failed=$false;try{&$Action|Out-Null}catch{$failed=$true};Assert-ReceiptTest $failed $Message}
function Get-ReceiptAclIdentity([string]$Path){
 $acl=Get-Acl -LiteralPath $Path -ErrorAction Stop
 $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|ForEach-Object{$_.IdentityReference.Value+':'+$_.AccessControlType+':'+[int]$_.FileSystemRights+':'+$_.InheritanceFlags+':'+$_.PropagationFlags+':'+$_.IsInherited}|Sort-Object)
 # Replace may add the DACL auto-inherited metadata flag on Windows. Compare
 # ownership, protected inheritance and every actual ACE instead of that flag.
 return $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value+'|'+$acl.GetGroup([Security.Principal.SecurityIdentifier]).Value+'|'+$acl.AreAccessRulesProtected+'|'+($rules -join ';')
}
function Assert-ReceiptAcl([string]$Path){
 $acl=Get-Acl -LiteralPath $Path -ErrorAction Stop
 Assert-ReceiptTest ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq 'S-1-5-32-544') 'native file owner remains Administrators'
 Assert-ReceiptTest $acl.AreAccessRulesProtected 'native receipt DACL remains protected'
 $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 Assert-ReceiptTest ($rules.Count -eq 2) 'native receipt has exactly two allow entries'
 foreach($sidValue in @('S-1-5-18','S-1-5-32-544')){
  $entries=@($rules|Where-Object{$_.IdentityReference.Value -ceq $sidValue})
  Assert-ReceiptTest ($entries.Count -eq 1 -and $entries[0].AccessControlType -eq 'Allow' -and $entries[0].FileSystemRights -eq [Security.AccessControl.FileSystemRights]::FullControl -and -not $entries[0].IsInherited) ('native receipt grants only explicit full control to '+$sidValue)
 }
}
if($NativeAcl){
 # Execute the complete production writer/reader with real NTFS security. No
 # scheduler, installation lookup, GUI startup lease or logon task is invoked.
 Write-GuiStartupReceipt $context $record
 $first=Read-GuiStartupReceipt $context
 Assert-ReceiptTest (-not $first.suspended -and -not $first.resumeEnabled -and $first.note -ceq $record.note) 'initial production write is valid UTF8 and has the original state'
 Assert-ReceiptAcl $context.receipt
 $before=Get-ReceiptAclIdentity $context.receipt
 $record.suspended=$true;$record.resumeEnabled=$true
 Write-GuiStartupReceipt $context $record
 $second=Read-GuiStartupReceipt $context
 Assert-ReceiptTest ($second.suspended -and $second.resumeEnabled -and $second.registrationId -ceq $first.registrationId -and $second.note -ceq $record.note) 'replacement production write updates state and preserves identity/UTF8'
 Assert-ReceiptAcl $context.receipt
 Assert-ReceiptTest ((Get-ReceiptAclIdentity $context.receipt) -ceq $before) 'replacement preserves receipt owner, group, protected inheritance and access rules'
 Assert-ReceiptTest (@(Get-ChildItem -LiteralPath $dataRoot -Filter '*.tmp' -Force).Count -eq 0) 'successful writer leaves no temporary receipt'
 $validJson=[IO.File]::ReadAllText($context.receipt,[Text.Encoding]::UTF8)
 $invalid=($validJson|ConvertFrom-Json);$invalid.schemaVersion=2
 [IO.File]::WriteAllText($context.receipt,($invalid|ConvertTo-Json -Depth 5),$utf8)
 Assert-ReceiptRejected {Read-GuiStartupReceipt $context} 'production read rejects an invalid persisted schema'
 Assert-ReceiptRejected {Write-GuiStartupReceipt $context $record} 'production write refuses to replace an invalid existing receipt'
 Assert-ReceiptTest (([IO.File]::ReadAllText($context.receipt,[Text.Encoding]::UTF8)|ConvertFrom-Json).schemaVersion -eq 2) 'rejected replacement leaves invalid evidence unchanged'
 [IO.File]::WriteAllText($context.receipt,$validJson,$utf8)
 Assert-ReceiptTest (Read-GuiStartupReceipt $context).suspended 'restored valid fixture reads through the production guard'
 $mode='native-production-writer';$limitation='Only task-owned NTFS fixture files and ACLs; no native task, service, logon or installed application acceptance.'
}else{
 # Medium-token CI cannot create an Administrators-owned file. Execute the
 # exact production commit statement so WinPS5 null binding still regresses.
 $writer=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Write-GuiStartupReceipt'},$true)
 $branches=@($writer.Body.FindAll({param($node)$node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text -match '\[IO\.File\]::Replace\('},$true))
 Assert-ReceiptTest ($branches.Count -eq 1) 'there is one production receipt commit branch'
 $commit=[scriptblock]::Create($branches[0].Extent.Text)
 [void][IO.Directory]::CreateDirectory($dataRoot)
 $temporary=Join-Path $dataRoot 'first.tmp'
 [IO.File]::WriteAllText($temporary,($record|ConvertTo-Json -Depth 5),$utf8)
 &$commit
 $first=[IO.File]::ReadAllText($context.receipt,[Text.Encoding]::UTF8)|ConvertFrom-Json
 Assert-ReceiptTest (-not $first.suspended -and $first.note -ceq $record.note -and -not [IO.File]::Exists($temporary)) 'production move branch commits the first UTF8 fixture'
 $before=Get-ReceiptAclIdentity $context.receipt
 $record.suspended=$true;$record.resumeEnabled=$true
 $temporary=Join-Path $dataRoot 'second.tmp'
 [IO.File]::WriteAllText($temporary,($record|ConvertTo-Json -Depth 5),$utf8)
 &$commit
 $second=[IO.File]::ReadAllText($context.receipt,[Text.Encoding]::UTF8)|ConvertFrom-Json
 Assert-ReceiptTest ($second.suspended -and $second.resumeEnabled -and $second.registrationId -ceq $first.registrationId -and $second.note -ceq $record.note) 'production replace branch commits updated identity/state/UTF8'
 Assert-ReceiptTest (-not [IO.File]::Exists($temporary)) 'replacement consumes its temporary file'
 Assert-ReceiptTest ((Get-ReceiptAclIdentity $context.receipt) -ceq $before) 'production commit branch preserves fixture ACL'
 $mode='production-commit-branch';$limitation='Actual production commit statement and NTFS readback only; medium-token mode does not exercise protected directory/file creation or production schema guards. Use -NativeAcl under elevation for those.'
}
$result=[ordered]@{schemaVersion=1;passed=$true;mode=$mode;psEdition=$PSVersionTable.PSEdition;psVersion=$PSVersionTable.PSVersion.ToString();assertionCount=$count;successfulWrites=2;aclPreserved=$true;nativeTaskOperations=0;fixtureRoot=$root;productionHelperSha256=(Get-FileHash -LiteralPath $module -Algorithm SHA256).Hash.ToLowerInvariant();limitation=$limitation}
[IO.File]::WriteAllText((Join-Path $root 'gui-startup-receipt-test.json'),($result|ConvertTo-Json -Depth 5),$utf8)
Write-Output ('GUI startup receipt: '+$mode+', '+$count+' assertions passed.')
