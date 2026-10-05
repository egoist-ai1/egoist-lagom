[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$SourcePath,
  [Parameter(Mandatory=$true)][string]$WorkRoot
)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
function Test-AbsoluteFixturePath([string]$Value) {
  return [IO.Path]::IsPathRooted($Value) -and [IO.Path]::GetFullPath($Value).Equals($Value,[StringComparison]::OrdinalIgnoreCase)
}
if(-not (Test-AbsoluteFixturePath $SourcePath) -or -not (Test-AbsoluteFixturePath $WorkRoot)){throw 'Use absolute controlled source/work paths.'}
if(-not [IO.Directory]::Exists($WorkRoot) -or ([IO.File]::GetAttributes($WorkRoot) -band [IO.FileAttributes]::ReparsePoint)){throw 'Owned ordinary work directory required.'}
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($SourcePath),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Controlled source AST errors.'}
$names=@('Get-DnsNativeServerAddressMap','Get-DnsNativeApiFamily','Assert-DnsNativeApiPresence','Get-DnsSafeAdapter')
foreach($name in $names){
  $functions=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$false))
  if($functions.Count -ne 1){throw 'Controlled source function identity is ambiguous.'}
  Invoke-Expression $functions[0].Extent.Text
}
# Extract only four reviewed definitions; never dot-source the native entrypoint.
$script:Results=[Collections.Generic.List[object]]::new()
$script:ApiRows=@();$script:ApiFailure=$false;$script:ApiCalls=0;$script:FilteredCalls=0
$script:Interfaces=@();$script:Routes=@();$script:PhysicalAdapters=@();$script:AdapterLookups=0
function Get-DnsClientServerAddress {
  [CmdletBinding()]param([int]$InterfaceIndex,[string]$AddressFamily)
  $script:ApiCalls++
  if([string]$PSBoundParameters['ErrorAction'] -cne 'Stop'){throw 'Controlled query lost ErrorAction Stop.'}
  if($script:ApiFailure){Write-Error -Message 'FIXTURE_CIM_ERROR' -ErrorId 'CIMAccessDeniedFixture';return}
  if($PSBoundParameters.ContainsKey('InterfaceIndex') -or $PSBoundParameters.ContainsKey('AddressFamily')){
    $script:FilteredCalls++
    $family=if($AddressFamily -ceq 'IPv4'){2}else{23}
    $found=@($script:ApiRows | Where-Object {$_.InterfaceIndex -eq $InterfaceIndex -and $_.AddressFamily -eq $family})
    if(-not $found.Count){Write-Error -Message 'FIXTURE_NO_CIM_OBJECTS' -ErrorId 'CIMNoObjectsFixture';return}
    return $found
  }
  return $script:ApiRows
}
function Get-NetIPInterface {[CmdletBinding()]param();return $script:Interfaces}
function Get-NetRoute {[CmdletBinding()]param([string]$DestinationPrefix,[string]$PolicyStore);return $script:Routes}
function Get-NetAdapter {
  [CmdletBinding()]param([int]$InterfaceIndex)
  $script:AdapterLookups++
  return @($script:PhysicalAdapters | Where-Object {$_.ifIndex -eq $InterfaceIndex})
}
function Get-CimInstance {throw 'Unexpected live CIM query.'}
function Get-ScheduledTask {throw 'Unexpected live Task query.'}
function Set-DnsClientServerAddress {throw 'Unexpected live DNS mutation.'}
function Stop-Service {throw 'Unexpected live SCM mutation.'}
function Get-DnsSafeAdapterFrozen812 {
  param($Inventory)
  # Frozen actual 812 predicate, including the original null dereference order.
  $targets=@(Get-NetIPInterface | Where-Object {
    $adapter=Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
    $identity=([string]$_.InterfaceAlias+' '+[string]$adapter.InterfaceDescription)
    $_.ConnectionState -eq 'Connected' -and $identity -notmatch 'WireGuard|Wintun|Cloudflare\s+WARP|VPN|Loopback|isatap|Teredo|Pseudo|Npcap|Bluetooth|(^|[\s_-])(TAP|TUN)([\s_-]|$)'
  } | Group-Object InterfaceIndex | ForEach-Object {[int]$_.Name})
  $routes=@(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -PolicyStore ActiveStore)
  if($targets.Count -ne 1 -or $routes.Count -ne 1 -or [int]$routes[0].InterfaceIndex -ne $targets[0]){throw 'Ambiguous/default adapter topology refused before DNS mutation.'}
  $rows=@($Inventory.adapters | Where-Object {$_.index -eq $targets[0]})
  if($rows.Count -ne 1 -or [string]$rows[0].guid -notmatch '^\{?[a-fA-F0-9-]{36}\}?$' -or $rows[0].families.ipv4.servers.Count -lt 1){throw 'Stable GUID/original DNS is unavailable.'}
  foreach($family in @('ipv4','ipv6')){foreach($server in $rows[0].families[$family].servers){if([Net.IPAddress]::IsLoopback([Net.IPAddress]::Parse([string]$server))){throw 'Original loopback DNS requires a separate owned resolver gate.'}}}
  return $rows[0]
}
function Check([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Expect-Refusal([scriptblock]$Action,[string]$MessagePattern) {
  $refused=$false
  try{& $Action | Out-Null}catch{
    $refused=$true
    if($_.Exception.Message -notmatch $MessagePattern){throw ('Unexpected controlled refusal: '+$MessagePattern)}
  }
  Check $refused 'Controlled refusal case was accepted.'
}
function Run-Case([string]$Name,[scriptblock]$Action){
  try{& $Action | Out-Null;$script:Results.Add([ordered]@{name=$Name;passed=$true})}
  catch{$script:Results.Add([ordered]@{name=$Name;passed=$false;errorType=$_.Exception.GetType().Name;detail=$_.Exception.Message.Substring(0,[Math]::Min(256,$_.Exception.Message.Length))})}
}
function New-ApiRow([int]$Index,[int]$Family,[string[]]$Servers) {
  return [pscustomobject]@{InterfaceIndex=$Index;AddressFamily=$Family;ServerAddresses=$Servers}
}
function New-Adapter([int]$Index) {
  return [ordered]@{index=$Index;guid='11111111-1111-1111-1111-111111111111';alias='Ethernet';description='Ethernet fixture';status='Up';families=[ordered]@{
    ipv4=[ordered]@{apiPresent=$true;servers=@('192.0.2.53');static=$false;nameServer=$null;dhcpNameServer='192.0.2.53'}
    ipv6=[ordered]@{apiPresent=$false;servers=@();static=$false;nameServer=$null;dhcpNameServer=$null}
  }}
}
function Set-NormalTopology {
  $script:Inventory=[ordered]@{adapters=@((New-Adapter 10))}
  $script:Interfaces=@([pscustomobject]@{InterfaceIndex=10;InterfaceAlias='Ethernet';ConnectionState='Connected'})
  $script:Routes=@([pscustomobject]@{InterfaceIndex=10})
  $script:PhysicalAdapters=@([pscustomobject]@{ifIndex=10;InterfaceDescription='Ethernet fixture'})
}
Run-Case 'frozen-filtered-family-fails-absent-hidden-family' {
  $script:ApiRows=@((New-ApiRow 2 23 @()));$adapter=@{ifIndex=2};$family='ipv4'
  # Exact original family query expression; absence is a terminating CIM no-objects error.
  Expect-Refusal {Get-DnsClientServerAddress -InterfaceIndex ([int]$adapter.ifIndex) -AddressFamily $(if($family -eq 'ipv4'){'IPv4'}else{'IPv6'}) -ErrorAction Stop} 'FIXTURE_NO_CIM_OBJECTS'
}
Run-Case 'unfiltered-map-preserves-present-empty-and-absent-families' {
  $script:ApiRows=@((New-ApiRow 10 2 @('192.0.2.53')),(New-ApiRow 10 23 @('2001:db8::53')),(New-ApiRow 2 23 @()))
  $script:ApiCalls=0;$script:FilteredCalls=0
  $map=Get-DnsNativeServerAddressMap
  $absent=Get-DnsNativeApiFamily $map 2 2;$empty=Get-DnsNativeApiFamily $map 2 23
  Check ($script:ApiCalls -eq 1 -and $script:FilteredCalls -eq 0) 'Inventory was not one unfiltered query.'
  Check ($absent.apiPresent -is [bool] -and -not $absent.apiPresent -and $absent.servers.Count -eq 0) 'Absent family evidence changed.'
  Check ($empty.apiPresent -and $empty.servers.Count -eq 0) 'Present empty family was confused with absent family.'
  Check ((Get-DnsNativeApiFamily $map 10 2).servers[0] -ceq '192.0.2.53') 'Exact interface/family mapping changed.'
}
Run-Case 'terminating-command-error-propagates' {
  $script:ApiFailure=$true
  try{Expect-Refusal {Get-DnsNativeServerAddressMap} 'FIXTURE_CIM_ERROR'}finally{$script:ApiFailure=$false}
}
Run-Case 'duplicate-interface-family-refused' {
  $script:ApiRows=@((New-ApiRow 10 2 @('192.0.2.53')),(New-ApiRow 10 2 @('192.0.2.54')))
  Expect-Refusal {Get-DnsNativeServerAddressMap} 'duplicate interface/family'
}
Run-Case 'wrong-address-family-refused' {
  foreach($row in @((New-ApiRow 10 2 @('2001:db8::53')),(New-ApiRow 10 23 @('192.0.2.53')))){
    $script:ApiRows=@($row);Expect-Refusal {Get-DnsNativeServerAddressMap} 'differs from its declared family'
  }
}
Run-Case 'invalid-interface-or-family-refused' {
  foreach($row in @((New-ApiRow 0 2 @()),(New-ApiRow 10 99 @()))){
    $script:ApiRows=@($row);Expect-Refusal {Get-DnsNativeServerAddressMap} 'invalid interface/family'
  }
}
Run-Case 'missing-family-readback-preserved-but-change-refused' {
  $absent=@{apiPresent=$false;servers=@()};$present=@{apiPresent=$true;servers=@()}
  Assert-DnsNativeApiPresence $absent $absent $false
  Assert-DnsNativeApiPresence $present $present $true
  Expect-Refusal {Assert-DnsNativeApiPresence $absent $present $false} 'family presence differs'
  Expect-Refusal {Assert-DnsNativeApiPresence $present $absent $false} 'family presence differs'
  Expect-Refusal {Assert-DnsNativeApiPresence $absent $absent $true} 'family presence differs'
  Expect-Refusal {Assert-DnsNativeApiPresence @{apiPresent='true'} $present $false} 'family presence differs'
}
Run-Case 'frozen-strict2-loopback-null-adapter-fails' {
  Set-NormalTopology
  $script:Interfaces+= [pscustomobject]@{InterfaceIndex=1;InterfaceAlias='Loopback Pseudo-Interface 1';ConnectionState='Connected'}
  Expect-Refusal {Get-DnsSafeAdapterFrozen812 $script:Inventory} 'InterfaceDescription'
}
Run-Case 'connected-loopback-and-disconnected-missing-are-classified-before-lookup' {
  Set-NormalTopology
  $script:Interfaces+= [pscustomobject]@{InterfaceIndex=1;InterfaceAlias='Loopback Pseudo-Interface 1';ConnectionState='Connected'}
  $script:Interfaces+= [pscustomobject]@{InterfaceIndex=2;InterfaceAlias='Hidden fixture';ConnectionState='Disconnected'}
  $script:AdapterLookups=0
  $actual=Get-DnsSafeAdapter $script:Inventory
  Check ($actual.index -eq 10 -and $script:AdapterLookups -eq 0) 'Excluded/missing adapters required a live adapter lookup.'
}
Run-Case 'eligible-unknown-interface-refused' {
  Set-NormalTopology
  $script:Interfaces+= [pscustomobject]@{InterfaceIndex=20;InterfaceAlias='Ethernet unknown';ConnectionState='Connected'}
  Expect-Refusal {Get-DnsSafeAdapter $script:Inventory} 'exactly one inventoried adapter'
}
Run-Case 'normal-exact-default-adapter-passes' {
  Set-NormalTopology
  $actual=Get-DnsSafeAdapter $script:Inventory;Check ($actual.index -eq 10) 'Normal exact default adapter failed.'
}
Run-Case 'duplicate-or-multiple-eligible-adapters-refused' {
  Set-NormalTopology;$script:Inventory.adapters+= (New-Adapter 10)
  Expect-Refusal {Get-DnsSafeAdapter $script:Inventory} 'exactly one inventoried adapter'
  Set-NormalTopology;$script:Inventory.adapters+= (New-Adapter 20)
  $script:Interfaces+= [pscustomobject]@{InterfaceIndex=20;InterfaceAlias='Ethernet 2';ConnectionState='Connected'}
  Expect-Refusal {Get-DnsSafeAdapter $script:Inventory} 'Ambiguous/default adapter topology'
}
Run-Case 'absent-selected-ipv4-and-managed-description-refused' {
  Set-NormalTopology;$script:Inventory.adapters[0].families.ipv4.apiPresent=$false
  Expect-Refusal {Get-DnsSafeAdapter $script:Inventory} 'Stable GUID/original DNS'
  Set-NormalTopology;$script:Inventory.adapters[0].description='WireGuard tunnel'
  Expect-Refusal {Get-DnsSafeAdapter $script:Inventory} 'Ambiguous/default adapter topology'
}
Run-Case 'ambiguous-or-mismatched-default-route-refused' {
  Set-NormalTopology;$script:Routes+= [pscustomobject]@{InterfaceIndex=10}
  Expect-Refusal {Get-DnsSafeAdapter $script:Inventory} 'Ambiguous/default adapter topology'
  Set-NormalTopology;$script:Routes=@([pscustomobject]@{InterfaceIndex=20})
  Expect-Refusal {Get-DnsSafeAdapter $script:Inventory} 'Ambiguous/default adapter topology'
}
Run-Case 'diagnostic-two-eligible-one-default-retains-original-refusal' {
  Set-NormalTopology;$script:Inventory.adapters+= (New-Adapter 20)
  $script:Interfaces+= [pscustomobject]@{InterfaceIndex=20;InterfaceAlias='vEthernet (nat)';ConnectionState='Connected'}
  $message=$null;try{Get-DnsSafeAdapter $script:Inventory|Out-Null}catch{$message=$_.Exception.Message}
  Check ($null -ne $message -and $message.Contains(' Preflight=')) 'Original topology refusal lost diagnostic suffix.'
  $meta=ConvertFrom-Json -InputObject $message.Substring($message.IndexOf(' Preflight=')+11)
  Check ($meta.stage -ceq 'dns-safe-adapter-preflight' -and $meta.eligibleCount -eq 2 -and $meta.defaultRouteCount -eq 1 -and -not $meta.matched -and -not $meta.truncated) 'Same-input refusal counts differ.'
  Check (($meta.eligibleIndices -join ',') -ceq '10,20' -and ($meta.defaultRouteIndices -join ',') -ceq '10') 'Actual queried indices differ from diagnostic.'
}
Run-Case 'diagnostic-raw-route-duplicates-and-bounded-indices-retain-refusal' {
  Set-NormalTopology;$script:Routes+= [pscustomobject]@{InterfaceIndex=10}
  $message=$null;try{Get-DnsSafeAdapter $script:Inventory|Out-Null}catch{$message=$_.Exception.Message}
  Check ($null -ne $message -and $message.Contains(' Preflight=')) 'Duplicate route was accepted or lost diagnostics.'
  $meta=ConvertFrom-Json -InputObject $message.Substring($message.IndexOf(' Preflight=')+11)
  Check ($meta.eligibleCount -eq 1 -and $meta.defaultRouteCount -eq 2 -and ($meta.defaultRouteIndices -join ',') -ceq '10,10' -and -not $meta.matched) 'Raw route duplicate evidence was collapsed.'
  Set-NormalTopology;$script:Routes=@(1..40|ForEach-Object{[pscustomobject]@{InterfaceIndex=10}})
  $message=$null;try{Get-DnsSafeAdapter $script:Inventory|Out-Null}catch{$message=$_.Exception.Message}
  $meta=ConvertFrom-Json -InputObject $message.Substring($message.IndexOf(' Preflight=')+11)
  Check ($meta.defaultRouteCount -eq 40 -and $meta.defaultRouteIndices.Count -eq 32 -and $meta.truncated -and -not $meta.matched -and $message.Length -lt 1024) 'Fixed diagnostic bound or refusal changed.'
  $sourceFunction=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-DnsSafeAdapter'},$false))[0].Extent.Text
  Check ($sourceFunction.Contains('if($targets.Count -ne 1 -or $routes.Count -ne 1 -or [int]$routes[0].InterfaceIndex -ne $targets[0])')) 'Original unsafe-topology predicate changed.'
  Check ($sourceFunction.Contains('Get-NetIPInterface -ErrorAction Stop') -and $sourceFunction.Contains("Get-NetRoute -DestinationPrefix '0.0.0.0/0' -PolicyStore ActiveStore -ErrorAction Stop")) 'Original terminating topology query changed.'
}
# Static placement checks protect the active and pre-mutation managed-family call sites.
Run-Case 'presence-guard-used-by-active-readback-and-before-provider' {
  $active=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Assert-DnsPrivateOwnedState'},$false))[0].Extent.Text
  $accept=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Invoke-DnsNativeAcceptance'},$false))[0].Extent.Text
  Check ($active.Contains('Assert-DnsNativeApiPresence $original.families[$family] $actual[0].families[$family] $managed')) 'Active family presence gate absent.'
  $presence=$accept.IndexOf('if($ipv6){Assert-DnsNativeApiPresence')
  Check ($presence -ge 0 -and $presence -lt $accept.IndexOf('$script:DnsProfile=Get-DnsNativeProvider')) 'Managed IPv6 presence gate is after mutation planning.'
}
$receipt=[ordered]@{schemaVersion=1;groups=$script:Results.Count;controlledInputs=$true;actualNativeDnsQueries=0;liveDnsMutations=0;liveScmMutations=0;liveTaskMutations=0;liveRegistryMutations=0;nativeAcceptancePassed=$false;sourceSha256=(Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash;results=$script:Results.ToArray()}
$json=$receipt|ConvertTo-Json -Depth 6 -Compress
[IO.File]::WriteAllText((Join-Path $WorkRoot 'dns-inventory-regression.json'),$json,[Text.UTF8Encoding]::new($false))
Write-Output $json
if(@($script:Results | Where-Object {-not $_.passed}).Count){exit 1}