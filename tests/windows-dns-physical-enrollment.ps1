[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Prepare','Control')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$CoreSource,
  [Parameter(Mandatory=$true)][string]$AcceptanceSource,
  [Parameter(Mandatory=$true)][string]$WorkRoot
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
foreach($value in @($CoreSource,$AcceptanceSource,$WorkRoot)){
  if(-not [IO.Path]::IsPathRooted($value) -or -not [IO.Path]::GetFullPath($value).Equals($value,[StringComparison]::OrdinalIgnoreCase)){throw 'Absolute canonical controlled fixture paths required.'}
  if(-not [IO.File]::Exists($value) -and -not [IO.Directory]::Exists($value)){throw 'Controlled fixture path is unavailable.'}
  if([IO.File]::GetAttributes($value) -band [IO.FileAttributes]::ReparsePoint){throw 'Ordinary controlled fixture paths required.'}
}
if(-not [IO.Directory]::Exists($WorkRoot)){throw 'Private fixture work directory required.'}
$utf8=[Text.UTF8Encoding]::new($false)
function Write-Receipt([string]$Name,$Value){
  [IO.File]::WriteAllText((Join-Path $WorkRoot $Name),($Value|ConvertTo-Json -Depth 6),$utf8)
}
if($Mode -ceq 'Prepare'){
  if($PSVersionTable.PSEdition -cne 'Core' -or $PSVersionTable.PSVersion.Major -lt 7){throw 'PS7 compiler required for actual Core generator fixture.'}
  $coreHash=(Get-FileHash -LiteralPath $CoreSource -Algorithm SHA256).Hash
  $acceptanceHash=(Get-FileHash -LiteralPath $AcceptanceSource -Algorithm SHA256).Hash
  $source=[IO.File]::ReadAllText($CoreSource)
  $markers=@(
    ([string][char]9+'private static string CreateSnapshotScript('),
    ([string][char]9+'private static string CreateApplyScript('),
    ([string][char]9+'private static string SerializeForPowerShell<'),
    ([string][char]9+'private static string ToPowerShellArray(')
  )
  $bounds=@()
  foreach($marker in $markers){
    if([regex]::Matches($source,[regex]::Escape($marker)).Count -ne 1){throw 'Actual generator method bounds changed or are ambiguous.'}
    $bounds+= $source.IndexOf($marker,[StringComparison]::Ordinal)
  }
  if(-not ($bounds[0] -lt $bounds[1] -and $bounds[1] -lt $bounds[2] -and $bounds[2] -lt $bounds[3])){throw 'Actual generator method order changed.'}
  $methods=$source.Substring($bounds[0],$bounds[1]-$bounds[0])+$source.Substring($bounds[2],$bounds[3]-$bounds[2])
  $support=@'
using System;
using System.Collections.Generic;
using System.Text.Json;
public sealed class DnsAdapterSnapshot {
 public int InterfaceIndex {get;set;}
 public string InterfaceAlias {get;set;} = "";
 public string InterfaceGuid {get;set;} = "";
}
internal static class JsonDefaults {
 internal static JsonSerializerOptions StateOptions = new() {PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
}
public static class PhysicalScopeSnapshotGenerator {
'@
  $entry=@'
 public static string Automatic() => CreateSnapshotScript(null, physicalOnly: true);
 public static string General() => CreateSnapshotScript(null);
 public static string ExplicitVirtual() => CreateSnapshotScript(new[] {new DnsAdapterSnapshot { InterfaceIndex=20, InterfaceAlias="vEthernet (nat)", InterfaceGuid="00000000-0000-0000-0000-000000000020"}});
}
'@
  $compilerSource=$support+[char]10+$methods+[char]10+$entry
  $compilerFile=Join-Path $WorkRoot 'actual-snapshot-generator.cs'
  [IO.File]::WriteAllText($compilerFile,$compilerSource,$utf8)
  $savedTemp=$env:TEMP;$savedTmp=$env:TMP
  try{
    $env:TEMP=$WorkRoot;$env:TMP=$WorkRoot
    Add-Type -TypeDefinition $compilerSource -CompilerOptions '/nullable:enable' -ErrorAction Stop
  }finally{$env:TEMP=$savedTemp;$env:TMP=$savedTmp}
  [IO.File]::WriteAllText((Join-Path $WorkRoot 'snapshot-proposed-generated.ps1'),[PhysicalScopeSnapshotGenerator]::Automatic(),$utf8)
  [IO.File]::WriteAllText((Join-Path $WorkRoot 'snapshot-explicit-generated.ps1'),[PhysicalScopeSnapshotGenerator]::ExplicitVirtual(),$utf8)
  [IO.File]::WriteAllText((Join-Path $WorkRoot 'snapshot-general-generated.ps1'),[PhysicalScopeSnapshotGenerator]::General(),$utf8)
  if((Get-FileHash -LiteralPath $CoreSource -Algorithm SHA256).Hash -cne $coreHash -or (Get-FileHash -LiteralPath $AcceptanceSource -Algorithm SHA256).Hash -cne $acceptanceHash){throw 'Actual fixture inputs changed during compilation.'}
  $proof=[ordered]@{
    kind='maintained-actual-Core-generator-compile';powershell=$PSVersionTable.PSVersion.ToString()
    coreSource=$CoreSource;coreSha256=$coreHash;acceptanceSource=$AcceptanceSource;acceptanceSha256=$acceptanceHash
    actualMethodsExtracted=$true;minimalIdentityDtoSupport=$true;fullCoreBuildPerformed=$false
    files=@('actual-snapshot-generator.cs','snapshot-proposed-generated.ps1','snapshot-explicit-generated.ps1','snapshot-general-generated.ps1'|ForEach-Object {
      @{name=$_;sha256=(Get-FileHash -LiteralPath (Join-Path $WorkRoot $_) -Algorithm SHA256).Hash}
    })
    liveNativeQueriesOrWrites=0;nativeAcceptancePassed=$false
  }
  Write-Receipt 'physical-snapshot-generator.json' $proof
  $proof|ConvertTo-Json -Depth 6 -Compress
  return
}
$compile=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText((Join-Path $WorkRoot 'physical-snapshot-generator.json')))
if(-not $compile.actualMethodsExtracted -or $compile.coreSource -ine $CoreSource -or $compile.acceptanceSource -ine $AcceptanceSource -or
   (Get-FileHash -LiteralPath $CoreSource -Algorithm SHA256).Hash -cne $compile.coreSha256 -or
   (Get-FileHash -LiteralPath $AcceptanceSource -Algorithm SHA256).Hash -cne $compile.acceptanceSha256){throw 'Controlled actual generator input proof differs.'}
$expected=@('actual-snapshot-generator.cs','snapshot-proposed-generated.ps1','snapshot-explicit-generated.ps1','snapshot-general-generated.ps1')
if($compile.files.Count -ne $expected.Count){throw 'Controlled generator artifact count differs.'}
foreach($name in $expected){
  $rows=@($compile.files|Where-Object {$_.name -ceq $name})
  $file=Join-Path $WorkRoot $name
  if($rows.Count -ne 1 -or ([IO.File]::GetAttributes($file) -band [IO.FileAttributes]::ReparsePoint) -or
     (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -cne $rows[0].sha256){throw 'Controlled generated artifact identity differs.'}
}
$script:Results=[Collections.Generic.List[object]]::new()
$script:PhysicalCalls=0;$script:PhysicalFailure=$false
$guid10='00000000-0000-0000-0000-000000000010';$guid20='00000000-0000-0000-0000-000000000020'
function Setup {
  $script:AllAdapters=@(
    [pscustomobject]@{ifIndex=10;Name='Ethernet';InterfaceGuid=$guid10;InterfaceDescription='Hardware Ethernet';Status='Up'},
    [pscustomobject]@{ifIndex=20;Name='vEthernet (nat)';InterfaceGuid=$guid20;InterfaceDescription='Hyper-V Virtual Ethernet';Status='Up'}
  )
  $script:Physical=@($script:AllAdapters[0])
  $script:Interfaces=@(
    [pscustomobject]@{InterfaceIndex=10;InterfaceAlias='Ethernet';ConnectionState='Connected';InterfaceMetric=10},
    [pscustomobject]@{InterfaceIndex=20;InterfaceAlias='vEthernet (nat)';ConnectionState='Connected';InterfaceMetric=20}
  )
  $script:Routes=@([pscustomobject]@{InterfaceIndex=10})
  $script:PhysicalCalls=0;$script:PhysicalFailure=$false
  $script:Inventory=@{adapters=@($script:AllAdapters|ForEach-Object{@{index=$_.ifIndex;guid=$_.InterfaceGuid;alias=$_.Name;description=$_.InterfaceDescription;families=@{ipv4=@{apiPresent=$true;servers=@(if($_.ifIndex -eq 10){'192.0.2.53'})};ipv6=@{apiPresent=$true;servers=@()}}}})}
}
function Get-NetAdapter {
  [CmdletBinding()]param([int]$InterfaceIndex,[switch]$Physical,[switch]$IncludeHidden)
  if($Physical){
    $script:PhysicalCalls++
    if($script:PhysicalFailure){Write-Error 'FIXTURE_PHYSICAL_CIM_ERROR';return}
    return $script:Physical
  }
  if($PSBoundParameters.ContainsKey('InterfaceIndex')){return @($script:AllAdapters|Where-Object {$_.ifIndex -eq $InterfaceIndex})}
  return $script:AllAdapters
}
function Get-NetIPInterface {[CmdletBinding()]param();return $script:Interfaces}
function Get-NetRoute {[CmdletBinding()]param([string]$DestinationPrefix,[string]$PolicyStore);return $script:Routes}
function Get-NetAdapterBinding {[CmdletBinding()]param([string]$Name,[string]$ComponentID);return [pscustomobject]@{Enabled=$true}}
function Get-DnsClientServerAddress {
  [CmdletBinding()]param([int]$InterfaceIndex,[string]$AddressFamily)
  if(-not $PSBoundParameters.ContainsKey('InterfaceIndex')){
    return [pscustomobject]@{InterfaceIndex=10;AddressFamily=2;ServerAddresses=@('2001:db8::53')}
  }
  return [pscustomobject]@{ServerAddresses=if($InterfaceIndex -eq 10 -and $AddressFamily -ceq 'IPv4'){@('192.0.2.53')}else{@()}}
}
function Get-ItemProperty {[CmdletBinding()]param([string]$Path,[string]$LiteralPath,[string]$Name);return [pscustomobject]@{NameServer=$null}}
function Set-DnsClientServerAddress {throw 'UNEXPECTED_LIVE_DNS_WRITE'}
function Get-CimInstance {throw 'UNEXPECTED_LIVE_CIM_QUERY'}
function Stop-Service {throw 'UNEXPECTED_LIVE_SCM_WRITE'}
function Get-ScheduledTask {throw 'UNEXPECTED_LIVE_TASK_QUERY'}
function Check([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Refuses([scriptblock]$Action,[string]$Pattern){
  $refused=$false;try{&$Action|Out-Null}catch{$refused=$true;Check ($_.Exception.Message -match $Pattern) 'Unexpected controlled error category.'}
  Check $refused 'Controlled unsafe shape was accepted.'
}
function Case([string]$Name,[scriptblock]$Action){
  try{&$Action|Out-Null;$script:Results.Add(@{name=$Name;passed=$true})}
  catch{$script:Results.Add(@{name=$Name;passed=$false;errorType=$_.Exception.GetType().Name;detail=$_.Exception.Message})}
}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($AcceptanceSource),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Actual acceptance AST errors.'}
foreach($name in @('Get-DnsSafeAdapter','Get-DnsNativeServerAddressMap')){
  $defs=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$false))
  if($defs.Count -ne 1){throw 'Controlled actual function identity ambiguous.'}
  Invoke-Expression $defs[0].Extent.Text
}
$general=[ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $WorkRoot 'snapshot-general-generated.ps1')))
$new=[ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $WorkRoot 'snapshot-proposed-generated.ps1')))
$explicit=[ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $WorkRoot 'snapshot-explicit-generated.ps1')))
function RunSnapshot([scriptblock]$Script){return @((&$Script)|ConvertFrom-Json)}
Case 'actual-default-general-generator-remains-broad-and-does-not-query-physical-api' {
  Setup;$result=RunSnapshot $general
  Check ($result.Count -eq 2 -and ($result.interfaceIndex -join ',') -ceq '10,20' -and $script:PhysicalCalls -eq 0) 'Default/general collector was narrowed or reclassified.'
}
Case 'proposed-actual-generator-selects-only-physical-api-member' {
  Setup;$result=RunSnapshot $new
  Check ($result.Count -eq 1 -and $result[0].interfaceIndex -eq 10 -and $result[0].interfaceGuid -ceq $guid10 -and $script:PhysicalCalls -eq 1) 'Physical API target scope differs.'
  Check ((Get-DnsSafeAdapter $script:Inventory).index -eq 10) 'Harness physical scope differs from product.'
}
Case 'physical-api-truth-does-not-infer-physical-from-name-or-description' {
  Setup;$script:AllAdapters[0].InterfaceDescription='Hyper-V Virtual Ethernet';$script:Inventory.adapters[0].description='Hyper-V Virtual Ethernet'
  $result=RunSnapshot $new;Check ($result.Count -eq 1 -and $result[0].interfaceIndex -eq 10) 'Physical API member was reclassified by invented text heuristics.'
}
Case 'up-physical-without-connected-ip-row-is-not-automatic-target' {
  Setup
  $unused=[pscustomobject]@{ifIndex=5;Name='Ethernet 4';InterfaceGuid=$null;InterfaceDescription='Unused physical fixture';Status='Up'}
  $script:AllAdapters+= $unused;$script:Physical+= $unused
  $result=RunSnapshot $new
  Check ($result.Count -eq 1 -and $result[0].interfaceIndex -eq 10) 'Up physical adapter without connected IP row became a target.'
  Check ((Get-DnsSafeAdapter $script:Inventory).index -eq 10) 'Unused physical identity was unnecessarily required for harness admission.'
}
Case 'multiple-connected-physical-targets-remain-harness-refused' {
  Setup;$script:Physical=$script:AllAdapters
  $result=RunSnapshot $new;Check ($result.Count -eq 2) 'Product active physical scope was narrowed to default route.'
  Refuses {Get-DnsSafeAdapter $script:Inventory} 'Ambiguous/default adapter topology'
}
Case 'explicit-recorded-disconnected-virtual-guid-remains-readable' {
  Setup;$script:Interfaces=@($script:Interfaces[0])
  $result=RunSnapshot $explicit
  Check ($result.Count -eq 1 -and $result[0].interfaceIndex -eq 20 -and $result[0].interfaceGuid -ceq $guid20 -and $script:PhysicalCalls -eq 0) 'Explicit virtual ownership target was physically filtered.'
}
Case 'unknown-connected-adapter-refused-before-classification' {
  Setup;$script:AllAdapters=@($script:AllAdapters[0]);$script:Inventory.adapters=@($script:Inventory.adapters[0])
  Refuses {RunSnapshot $new} 'exactly one adapter'
  Refuses {Get-DnsSafeAdapter $script:Inventory} 'exactly one inventoried adapter'
}
Case 'physical-guid-mismatch-and-duplicate-identity-refused' {
  Setup;$script:Physical=@([pscustomobject]@{ifIndex=10;Name='Ethernet';InterfaceGuid=$guid20;InterfaceDescription='Hardware Ethernet'})
  Refuses {RunSnapshot $new} 'identity changed or is ambiguous'
  Refuses {Get-DnsSafeAdapter $script:Inventory} 'identity changed or is ambiguous'
  Setup;$script:Physical+= $script:Physical[0]
  Refuses {RunSnapshot $new} 'identity changed or is ambiguous'
  Refuses {Get-DnsSafeAdapter $script:Inventory} 'identity changed or is ambiguous'
}
Case 'invalid-selected-guid-refused' {
  Setup;$script:AllAdapters[0].InterfaceGuid='not-a-guid';$script:Inventory.adapters[0].guid='not-a-guid'
  Refuses {RunSnapshot $new} 'GUID is invalid'
  Refuses {Get-DnsSafeAdapter $script:Inventory} 'GUID is invalid'
}
Case 'physical-cim-error-propagates' {
  Setup;$script:PhysicalFailure=$true
  Refuses {RunSnapshot $new} 'FIXTURE_PHYSICAL_CIM_ERROR'
  Refuses {Get-DnsSafeAdapter $script:Inventory} 'FIXTURE_PHYSICAL_CIM_ERROR'
}
Case 'raw-duplicate-default-and-nonphysical-default-remain-refused' {
  Setup;$script:Routes+= [pscustomobject]@{InterfaceIndex=10}
  Refuses {Get-DnsSafeAdapter $script:Inventory} 'Ambiguous/default adapter topology'
  Setup;$script:Routes=@([pscustomobject]@{InterfaceIndex=20})
  Refuses {Get-DnsSafeAdapter $script:Inventory} 'Ambiguous/default adapter topology'
}
Case 'loopback-ip-interface-excluded-before-null-lookup' {
  Setup;$script:Interfaces+= [pscustomobject]@{InterfaceIndex=1;InterfaceAlias='Loopback Pseudo-Interface 1';ConnectionState='Connected';InterfaceMetric=1}
  $result=RunSnapshot $new;Check ($result.Count -eq 1 -and $result[0].interfaceIndex -eq 10) 'Loopback interface became an automatic target.'
}
Case 'loopback-dns-and-malformed-family-remain-refused' {
  Setup;$script:Inventory.adapters[0].families.ipv4.servers=@('127.0.0.1')
  Refuses {Get-DnsSafeAdapter $script:Inventory} 'Original loopback DNS'
  Refuses {Get-DnsNativeServerAddressMap} 'differs from its declared family'
}
$r=[ordered]@{kind='maintained-actual-generated-snapshot-physical-api-control';powershell=$PSVersionTable.PSVersion.ToString();groups=$script:Results.Count;results=$script:Results.ToArray();accepted=(@($script:Results|Where-Object {-not $_.passed}).Count -eq 0);actualNativeAcceptance=$false;liveNativeQueriesOrWrites=0}
$out=Join-Path $WorkRoot ('physical-scope-'+$PSVersionTable.PSEdition+'.json')
[IO.File]::WriteAllText($out,($r|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$r|ConvertTo-Json -Depth 5 -Compress
if(-not $r.accepted){exit 1}