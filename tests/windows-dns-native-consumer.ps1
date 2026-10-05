[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$DnsSource,[Parameter(Mandatory=$true)][string]$Output,[switch]$ApplyProposalForProof)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
# Load the trusted utility command before mocks: PS5 auto-import exports Get-FileHash as a function.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -ErrorAction Stop
$source=[IO.File]::ReadAllText($DnsSource)
$sourceHash=([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash([IO.File]::ReadAllBytes($DnsSource)))).Replace('-','').ToLowerInvariant()
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if(@($errors).Count){throw 'Actual DNS acceptance source cannot be parsed.'}
$selected=@('ConvertTo-DnsIpSequence','Test-DnsSameSequence','Assert-DnsNativeApiPresence','Assert-DnsPrivateOwnedState','Assert-DnsUnrelatedPreserved')
$allowed=@('ForEach-Object','Join-Path','Assert-NativeAdministratorOwned','Get-Acl','Get-Item','Get-Content','ConvertFrom-Json','Test-DnsSameSequence','Get-DnsClientDohServerAddress','Where-Object','ConvertTo-DnsIpSequence','Get-DnsNativeInventory','Assert-DnsNativeApiPresence','Assert-DnsUnrelatedPreserved','Get-FileHash','Save-NativeReceipt','ConvertTo-Json')
$consumerText=$null
foreach($name in $selected){
 $functions=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
 if($functions.Count -ne 1){throw 'Actual consumer function identity is ambiguous.'}
 foreach($command in @($functions[0].FindAll({param($n) $n -is [Management.Automation.Language.CommandAst]},$true))){if($command.GetCommandName() -notin $allowed){throw 'Unexpected actual consumer command refused before execution.'}}
 $body=$functions[0].Extent.Text
 if($name -ceq 'Assert-DnsPrivateOwnedState'){$consumerText=$body}else{. ([scriptblock]::Create($body))}
}
$oldLine='      $expected=if($managed){$script:DnsProfile[$family]}else{$original.families[$family].servers}'
$newLine='      $expected=$original.families[$family].servers;if($managed){$expected=$script:DnsProfile[$family]}'
if($ApplyProposalForProof){
 if(([regex]::Matches($consumerText,[regex]::Escape($oldLine))).Count -ne 1){throw 'Proposal fixture requires exactly the frozen original assignment.'}
 $consumerText=$consumerText.Replace($oldLine,$newLine)
}
. ([scriptblock]::Create($consumerText))
function Assert-NativeAdministratorOwned {param($Path)}
function Get-Acl {param($LiteralPath)
 $acl=[pscustomobject]@{AreAccessRulesProtected=$true}
 $acl|Add-Member ScriptMethod GetAccessRules {param($a,$b,$c) return @()}
 $acl|Add-Member ScriptMethod GetOwner {param($t) return [pscustomobject]@{Value='S-1-5-18'}}
 return $acl
}
function Get-Item {param($LiteralPath) return [pscustomobject]@{Length=512}}
function Get-Content {param($LiteralPath,[switch]$Raw) return ($script:State|ConvertTo-Json -Depth 15 -Compress)}
function Get-FileHash {param($LiteralPath,$Algorithm) return [pscustomobject]@{Hash=('a'*64)}}
function Get-DnsClientDohServerAddress {$script:DohReadCount++;return $script:Records}
function Get-DnsNativeInventory {$script:InventoryReadCount++;return $script:Current}
function Save-NativeReceipt {$script:SaveCount++}
function Reset-ConsumerFixture {
 $script:DataRoot='C:\Controlled-Inert-Data'
 $url='https://controlled.invalid/dns-query';$guid='22222222-2222-2222-2222-222222222222'
 $script:DnsProfile=@{url=$url;servers=@('192.0.2.1','192.0.2.2');ipv4=@('192.0.2.1','192.0.2.2');ipv6=@()}
 $baselineFamilies=@{ipv4=@{apiPresent=$true;servers=@('198.51.100.53');static=$false;nameServer=$null};ipv6=@{apiPresent=$true;servers=@();static=$false;nameServer=$null}}
 $script:DnsAdapter=@{guid=$guid;families=$baselineFamilies}
 $snapshot=@{interfaceGuid=$guid;ipv4=@('198.51.100.53');ipv6=@();ipv4Static=$false;ipv6Static=$false}
 $script:State=@{schemaVersion=1;owner='EgoistShield';url=$url;servers=@($script:DnsProfile.servers);originalDnsAdapters=@($snapshot)}
 $doh=@([pscustomobject]@{ServerAddress='192.0.2.1';DohTemplate=$url;AllowFallbackToUdp=$false;AutoUpgrade=$true},[pscustomobject]@{ServerAddress='192.0.2.2';DohTemplate=$url;AllowFallbackToUdp=$false;AutoUpgrade=$true},[pscustomobject]@{ServerAddress='192.0.2.3';DohTemplate='https://foreign.invalid/dns-query';AllowFallbackToUdp=$true;AutoUpgrade=$false})
 $script:Records=$doh
 $network=@{defaultRoutes=@();ipv6Bindings=@();userProxy=@{};winHttp=@{}}
 $script:DnsBefore=@{adapters=@($script:DnsAdapter);network=$network;tasks=@();productServices=@();doh=$doh}
 $families=@{ipv4=@{apiPresent=$true;servers=@($script:DnsProfile.ipv4);static=$true;nameServer='managed'};ipv6=@{apiPresent=$true;servers=@();static=$false;nameServer=$null}}
 $script:Current=@{adapters=@(@{guid=$guid;families=$families});network=$network;tasks=@();productServices=@();doh=$doh}
 $script:Receipt=@{privateStateReadbacks=@()};$script:SaveCount=0;$script:DohReadCount=0;$script:InventoryReadCount=0
}
$cases=@(
 @{name='empty-unmanaged-family-and-distinct-foreign-prefix';pass=$true;change={}},
 @{name='singleton-unmanaged-family-keeps-whole-address';pass=$true;change={$script:State.originalDnsAdapters[0].ipv6=@('2001:db8::53');$script:DnsAdapter.families.ipv6.servers=@('2001:db8::53');$script:Current.adapters[0].families.ipv6.servers=@('2001:db8::53')}},
 @{name='multiple-unmanaged-family-preserves-order-cardinality';pass=$true;change={$v=@('2001:db8::53','2001:db8::54');$script:State.originalDnsAdapters[0].ipv6=$v;$script:DnsAdapter.families.ipv6.servers=$v;$script:Current.adapters[0].families.ipv6.servers=$v}},
 @{name='managed-family-order-mismatch-rejected';pass=$false;change={$script:Current.adapters[0].families.ipv4.servers=@('192.0.2.2','192.0.2.1')}},
 @{name='managed-family-cardinality-mismatch-rejected';pass=$false;change={$script:Current.adapters[0].families.ipv4.servers=@('192.0.2.1')}},
 @{name='intent-server-order-mismatch-rejected';pass=$false;change={$script:State.servers=@('192.0.2.2','192.0.2.1')}},
 @{name='intent-server-cardinality-mismatch-rejected';pass=$false;change={$script:State.servers=@('192.0.2.1')}},
 @{name='intent-null-address-member-rejected';pass=$false;change={$script:State.originalDnsAdapters[0].ipv6=@($null)}},
 @{name='intent-malformed-address-rejected';pass=$false;change={$script:State.servers=@('invalid-address','192.0.2.2')}},
 @{name='native-doh-malformed-address-rejected';pass=$false;change={$script:Records=@($script:Records)+[pscustomobject]@{ServerAddress='invalid-address';DohTemplate='foreign';AllowFallbackToUdp=$false;AutoUpgrade=$true}}},
 @{name='owned-doh-duplicate-cardinality-rejected';pass=$false;change={$script:Records=@($script:Records)+$script:Records[0]}},
 @{name='owned-doh-missing-record-rejected';pass=$false;change={$script:Records=@($script:Records[1],$script:Records[2])}},
 @{name='owned-doh-template-mismatch-rejected';pass=$false;change={$script:Records[0].DohTemplate='https://wrong.invalid/dns-query'}},
 @{name='owned-doh-udp-fallback-rejected';pass=$false;change={$script:Records[0].AllowFallbackToUdp=$true}},
 @{name='owned-doh-auto-upgrade-disabled-rejected';pass=$false;change={$script:Records[0].AutoUpgrade=$false}},
 @{name='foreign-doh-change-rejected';pass=$false;change={$foreign=[pscustomobject]@{ServerAddress='192.0.2.3';DohTemplate='https://changed.invalid/dns-query';AllowFallbackToUdp=$true;AutoUpgrade=$false};$script:Current.doh=@($script:Records[0],$script:Records[1],$foreign)}},
 @{name='unmanaged-api-family-presence-change-rejected';pass=$false;change={$script:Current.adapters[0].families.ipv6.apiPresent=$false}},
 @{name='baseline-guid-mismatch-rejected';pass=$false;change={$script:State.originalDnsAdapters[0].interfaceGuid='33333333-3333-3333-3333-333333333333'}},
 @{name='baseline-static-choice-change-rejected';pass=$false;change={$script:State.originalDnsAdapters[0].ipv4Static=$true}}
)
$results=@()
foreach($case in $cases){
 Reset-ConsumerFixture;& $case.change
 $accepted=$false;$errorClass='none';$errorMessage=$null;$stack=$null
 try{[void](Assert-DnsPrivateOwnedState 'controlled-maintained-consumer');$accepted=$true}catch{$errorClass=$_.Exception.GetBaseException().GetType().FullName;$errorMessage=$_.Exception.Message;$stack=$_.ScriptStackTrace -split "`r?`n" | Where-Object {$_ -match '^at (ConvertTo-DnsIpSequence|Test-DnsSameSequence|Assert-DnsPrivateOwnedState|Assert-DnsUnrelatedPreserved), <No file>:'}}
 $proofClean=if($accepted){$script:Receipt.privateStateReadbacks.Count -eq 1 -and $script:SaveCount -eq 1 -and $script:DohReadCount -eq 1 -and $script:InventoryReadCount -eq 1}else{$script:Receipt.privateStateReadbacks.Count -eq 0 -and $script:SaveCount -eq 0}
 $results+=@{name=$case.name;expectedAccepted=$case.pass;accepted=$accepted;passed=($accepted -eq $case.pass -and $proofClean);errorClass=$errorClass;errorMessage=$errorMessage;consumerStack=$stack;privateReadbacks=$script:Receipt.privateStateReadbacks.Count}
}
$nullRejected=$false;try{[void](Test-DnsSameSequence @($null) @())}catch{$nullRejected=$true}
$emptyAccepted=Test-DnsSameSequence @() @()
$result=[ordered]@{schemaVersion=1;kind='actual-dns-private-intent-consumer-inert-regression';powershellVersion=$PSVersionTable.PSVersion.ToString();sourceSha256=$sourceHash;proposalAppliedOnlyInMemory=[bool]$ApplyProposalForProof;selectedFunctionCount=$selected.Count;caseCount=$results.Count;passedCaseCount=@($results|Where-Object {$_.passed}).Count;allPassed=(@($results|Where-Object {-not $_.passed}).Count -eq 0 -and $nullRejected -and $emptyAccepted);directNullAddressRejected=$nullRejected;directEmptySequenceAccepted=$emptyAccepted;nativeDnsCalls=0;networkCalls=0;serviceMutations=0;registryWrites=0;sourceWrites=0;fileWrites='owned Output only';cases=$results}
$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($result|ConvertTo-Json -Depth 10))
$stream=[IO.File]::Open($Output,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
if(-not $result.allPassed){exit 1}