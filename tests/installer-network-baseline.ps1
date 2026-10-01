param([Parameter(Mandatory=$true)][string]$TempRoot,[string]$BeforeSource='')
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
if(-not [IO.Path]::IsPathRooted($TempRoot)){throw 'An absolute task-owned TempRoot is required.'}
$caseRoot=Join-Path ([IO.Path]::GetFullPath($TempRoot)) ('dns-baseline-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
[void][IO.Directory]::CreateDirectory($caseRoot)
$source=Join-Path (Split-Path -Parent $PSScriptRoot) 'src\installer\owned-cleanup.ps1'
function Import-BaselineFunction([string]$Path,[string]$Name,[string]$Alias=''){
  $tokens=$null;$parseErrors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$parseErrors)
  if($parseErrors.Count){throw ($parseErrors|Out-String)}
  $node=$ast.Find({param($item)$item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq $Name},$true)
  if(-not $node){throw "Production function is missing: $Name"}
  if(-not $Alias){$Alias=$Name}
  Invoke-Expression ('function script:'+ $Alias+' '+$node.Body.Extent.Text)
}
foreach($name in @('Get-UplinkNetworkAdapters','Save-SystemNetworkBaseline','Restore-SystemNetworkBaseline')){Import-BaselineFunction $source $name}
if($BeforeSource){Import-BaselineFunction $BeforeSource 'Save-SystemNetworkBaseline' 'Save-BeforeBaseline'}
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
$script:shieldUserRegistryRoot='Registry::HKEY_CURRENT_USER'
$script:upgradeStateDirectory=$caseRoot
$script:networkBaselinePath=Join-Path $caseRoot 'network-baseline.json'
$script:providerFailure=$false;$script:dnsQueries=0;$script:externalCalls=@();$script:journal=@()
$script:adapters=@(
  [pscustomobject]@{ifIndex=9;InterfaceGuid='{00000000-0000-0000-0000-000000000009}';Name='vEthernet (nat)';InterfaceDescription='Hyper-V Virtual Ethernet Adapter';Status='Up'},
  [pscustomobject]@{ifIndex=14;InterfaceGuid='{00000000-0000-0000-0000-000000000014}';Name='Ethernet';InterfaceDescription='Fixture Ethernet';Status='Up'},
  [pscustomobject]@{ifIndex=15;InterfaceGuid='{00000000-0000-0000-0000-000000000015}';Name='IPv6 only';InterfaceDescription='Fixture Ethernet';Status='Up'})
$script:dnsRows=@(
  [pscustomobject]@{InterfaceIndex=14;AddressFamily=2;ServerAddresses=@('192.0.2.53')},
  [pscustomobject]@{InterfaceIndex=15;AddressFamily=23;ServerAddresses=@('2001:db8::53')},
  [pscustomobject]@{InterfaceIndex=99;AddressFamily=2;ServerAddresses=@('198.51.100.53')})
function Get-NetAdapter {param($ErrorAction)return $script:adapters}
function Get-DnsClientServerAddress {
  param($InterfaceIndex,$AddressFamily,$ErrorAction)
  $script:dnsQueries++
  if($script:providerFailure){throw 'CIM provider unavailable'}
  if($PSBoundParameters.ContainsKey('InterfaceIndex')){throw 'CmdletizationQuery_NotFound: missing DNS client family on virtual adapter'}
  return $script:dnsRows
}
function Get-RegistryValueSnapshot {param($RegistryPath,$Name)return [pscustomobject]@{exists=$false;kind=$null;value=$null}}
function Get-ItemProperty {
  param($LiteralPath,$Name,$ErrorAction)
  $value=''
  if($LiteralPath -like '*\Tcpip\*000000000014}'){ $value='192.0.2.53' }
  if($LiteralPath -like '*\Tcpip6\*000000000015}'){ $value='2001:db8::53' }
  return [pscustomobject]@{NameServer=$value}
}
function Write-Journal {param($Event,$Data)$script:journal+= $Event}
function Restore-RegistrySnapshotRecord {param($RegistryPath,$Name,$Snapshot)}
function Notify-SystemProxyChanged {}
function Invoke-CheckedExternal {
  param($Executable,$Arguments,$Stage)
  $script:externalCalls+=[pscustomobject]@{executable=$Executable;arguments=@($Arguments);stage=$Stage}
  return 0
}
$beforeFailed=$false
if($BeforeSource){
  try{Save-BeforeBaseline}catch{$beforeFailed=$_.Exception.Message -like '*CmdletizationQuery_NotFound*'}
  Require $beforeFailed 'Old snapshot did not reproduce the missing-family failure.'
  Require (-not (Test-Path -LiteralPath $networkBaselinePath)) 'Failed old snapshot unexpectedly published a baseline.'
}
$script:dnsQueries=0
Save-SystemNetworkBaseline
$snapshot=Get-Content -LiteralPath $networkBaselinePath -Raw|ConvertFrom-Json
Require ($script:dnsQueries -eq 1) 'DNS client inventory must be one complete provider read.'
Require (@($snapshot.adapters).Count -eq 2) 'A bridge with no DNS client rows or a foreign row was included.'
$v4=@($snapshot.adapters|Where-Object interfaceIndex -eq 14)[0]
$v6=@($snapshot.adapters|Where-Object interfaceIndex -eq 15)[0]
Require ($v4.ipv4Captured -eq $true -and $v4.ipv6Captured -eq $false -and $v4.ipv4Static -eq $true -and @($v4.ipv4)[0] -eq '192.0.2.53') 'IPv4 snapshot lost its actual family/static state.'
Require ($v6.ipv4Captured -eq $false -and $v6.ipv6Captured -eq $true -and $v6.ipv6Static -eq $true -and @($v6.ipv6)[0] -eq '2001:db8::53') 'IPv6-only snapshot lost its actual family/static state.'
Restore-SystemNetworkBaseline
$dnsCalls=@($script:externalCalls|Where-Object {$_.arguments -contains 'dnsservers'})
Require ($dnsCalls.Count -eq 2 -and @($dnsCalls|Where-Object {$_.arguments -contains 'name=9'}).Count -eq 0) 'Rollback targeted a bridge without DNS state.'
Require ($dnsCalls[0].arguments -contains 'ipv4' -and $dnsCalls[0].arguments -contains 'name=14' -and $dnsCalls[1].arguments -contains 'ipv6' -and $dnsCalls[1].arguments -contains 'name=15') 'Rollback changed an uncaptured family.'
Require (-not (Test-Path -LiteralPath $networkBaselinePath)) 'Successful controlled rollback did not complete its journal.'
$script:providerFailure=$true
$providerRefused=$false
try{Save-SystemNetworkBaseline}catch{$providerRefused=$_.Exception.Message -eq 'CIM provider unavailable'}
Require ($providerRefused -and -not (Test-Path -LiteralPath $networkBaselinePath) -and -not (Test-Path -LiteralPath ($networkBaselinePath+'.tmp'))) 'A provider failure was hidden or published an incomplete snapshot.'
$script:providerFailure=$false
# Old version-1 journals had no captured-family flags and must retain their
# original rollback meaning after the new installer reads them.
$oldJournal=@{schemaVersion=1;owner='EgoistShield';proxy=$snapshot.proxy;winHttpSettings=$snapshot.winHttpSettings;adapters=@(@{interfaceGuid=$script:adapters[1].InterfaceGuid;ipv4=@('192.0.2.53');ipv4Static=$true;ipv6=@();ipv6Static=$false})}
$oldJournal|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $networkBaselinePath -Encoding utf8
$script:externalCalls=@()
Restore-SystemNetworkBaseline
$legacyCalls=@($script:externalCalls|Where-Object {$_.arguments -contains 'dnsservers'})
Require ($legacyCalls.Count -eq 2 -and $legacyCalls[1].arguments -contains 'source=dhcp') 'Old baseline rollback compatibility changed.'
[pscustomobject]@{groups=6;beforeMissingFamilyFailed=$beforeFailed;actualProductionFunctions=$true;nativeFiles=$true;dnsProviderBoundary='controlled';registryMutations=0;serviceMutations=0;networkMutations=0;scope='Snapshot/rollback family inventory; hosted actual PreInstall must verify the real Windows provider'}|ConvertTo-Json -Compress
