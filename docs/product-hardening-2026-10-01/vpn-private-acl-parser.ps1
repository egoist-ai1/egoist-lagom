param([Parameter(Mandatory=$true)][string]$SourcePath)
$ErrorActionPreference='Stop'
$vpnTokens=$null
$vpnErrors=$null
$vpnAst=[Management.Automation.Language.Parser]::ParseFile($SourcePath,[ref]$vpnTokens,[ref]$vpnErrors)
if($vpnErrors.Count -ne 0){throw ($vpnErrors | ForEach-Object Message | Out-String)}
$vpnSource=[IO.File]::ReadAllText($SourcePath)
$vpnIdentitySource=[regex]::Match($vpnSource,'\$vpnSystem=New-Object[^\r\n]+?\); \$vpnAdmin=New-Object[^\r\n]+?\)').Value
if(-not $vpnIdentitySource){throw 'Production SID constructor statement not found'}
Invoke-Expression $vpnIdentitySource
$vpnConstructionSource=[regex]::Match($vpnSource,'\$vpnAcl=if\(.+?\$vpnAcl.AddAccessRule\(\$vpnRule\)\}').Value
if(-not $vpnConstructionSource){throw 'Production DACL constructor statements not found'}
foreach($vpnDirectory in @($true,$false)){
 $vpnItem=[pscustomobject]@{PSIsContainer=$vpnDirectory}
 Invoke-Expression $vpnConstructionSource
 if(-not $vpnAcl.AreAccessRulesProtected){throw 'Production DACL constructor inherited rules'}
 if($vpnAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-18'){throw 'Production DACL owner differs'}
 $vpnRules=@($vpnAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 if($vpnRules.Count -ne 2){throw 'Production DACL constructor rule count differs'}
 foreach($vpnRule in $vpnRules){if($vpnRule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544') -or $vpnRule.AccessControlType -ne 'Allow' -or $vpnRule.FileSystemRights -ne 'FullControl'){throw 'Production DACL constructor permits another identity'}}
}
[pscustomobject]@{passed=$true;parserErrors=$vpnErrors.Count;productionDaclConstructors=2;fileSystemAclWrites=0;scmMutations=0;systemOwnerApplied=$false} | ConvertTo-Json -Compress
