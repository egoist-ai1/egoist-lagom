param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$root=[IO.Path]::GetFullPath($TestDirectory)
if (-not $root.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Use task-owned temporary files.' }
$source=Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\invoke-final-silent-reinstall.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Production source does not parse in WinPS5.1.' }
foreach ($name in @('Reconcile-PreservedZapretProfile','Restore-CriticalOwnedDnsBaseline','Restore-CriticalAdapterDns')) {
  $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if (-not $fn) { throw "Missing production function $name." }
  . ([scriptblock]::Create($fn.Extent.Text))
}
function Require([bool]$Value,[string]$Message) { if(-not $Value){throw $Message} }
function Invoke-InstallerSc {throw 'Forbidden SCM mutation.'}
function reg.exe {throw 'Forbidden registry mutation.'}
$script:StageDirectory=Join-Path $root 's'
$script:RuntimeRoot=Join-Path $root 'r'
$script:profileRoot=Join-Path $root 'p'
function Get-InteractiveProfileRoot {return $script:profileRoot}
foreach($directory in @($script:StageDirectory,(Join-Path $script:RuntimeRoot 'Zapret\core'),(Join-Path $script:profileRoot 'AppData\Roaming\Egoist Shield'))){New-Item -ItemType Directory -Path $directory -Force | Out-Null}
$settingsFile=Join-Path $script:profileRoot 'AppData\Roaming\Egoist Shield\egoistshield-state.json'
[IO.File]::WriteAllText($settingsFile,'{"settings":{"zapretProfile":"Original"}}')
[IO.File]::WriteAllText((Join-Path $script:RuntimeRoot 'Zapret\core\Fixture (1).bat'),'fixture only')
$automaticProfile=$PROFILE
Reconcile-PreservedZapretProfile ([pscustomobject]@{zapretProfile='Fixture (1)'})
$settings=Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
$before=Get-Content -LiteralPath (Join-Path $StageDirectory 'zapret-profile-user-state.before.json') -Raw | ConvertFrom-Json
Require ($settings.settings.zapretProfile -eq 'Fixture (1)' -and $before.settings.zapretProfile -eq 'Original') 'Production profile recovery did not retain the selected profile and original state backup.'
Require ($PROFILE -ceq $automaticProfile) 'Production profile recovery assigned to the automatic PROFILE variable.'
Write-Output 'PASS: actual profile recovery writes the selected profile and retains original state via real File.Replace'

$script:interfaceGuid=[Guid]::NewGuid()
$script:dnsRows=@([pscustomobject]@{InterfaceIndex=41;AddressFamily=2;ServerAddresses=@('127.0.0.1')},[pscustomobject]@{InterfaceIndex=41;AddressFamily=23;ServerAddresses=@('::1')})
$script:dnsWrites=0;$script:cacheClears=0
function Get-NetAdapter {param([switch]$IncludeHidden,$ErrorAction) return @([pscustomobject]@{InterfaceGuid=[Guid]::NewGuid();ifIndex=42;Status='Up'},[pscustomobject]@{InterfaceGuid=$script:interfaceGuid;ifIndex=41;Status='Up'})}
function Get-DnsClientServerAddress {
  param([int]$InterfaceIndex,[int]$AddressFamily=0,$ErrorAction)
  Require ($InterfaceIndex -eq 41) 'DNS readback targeted a wrong adapter.'
  if($AddressFamily){return @($script:dnsRows | Where-Object AddressFamily -eq $AddressFamily)}
  return $script:dnsRows
}
function Set-DnsClientServerAddress {
  [CmdletBinding()]param([Parameter(ValueFromPipeline=$true)]$InputObject,[int]$InterfaceIndex=0,[string[]]$ServerAddresses,[switch]$ResetServerAddresses)
  process {
    Require (-not $ResetServerAddresses) 'Static baseline was unexpectedly reset.'
    if($InputObject){Require ($InputObject.InterfaceIndex -eq 41) 'DNS write targeted a foreign adapter.';$InputObject.ServerAddresses=@($ServerAddresses)}
    else {
      Require ($InterfaceIndex -eq 41) 'Critical DNS write targeted a wrong adapter.'
      foreach($row in $script:dnsRows){$row.ServerAddresses=@($ServerAddresses | Where-Object {([Net.IPAddress]$_).AddressFamily -eq $(if($row.AddressFamily -eq 2){[Net.Sockets.AddressFamily]::InterNetwork}else{[Net.Sockets.AddressFamily]::InterNetworkV6})})}
    }
    $script:dnsWrites++
  }
}
function Clear-DnsClientCache {param($ErrorAction) $script:cacheClears++}
$state=[pscustomobject]@{criticalDns=@([pscustomobject]@{interfaceGuid=$script:interfaceGuid.ToString();servers=@('127.0.0.1','::1')})}
$metadata=@{schemaVersion=1;owner='EgoistShield';servers=@('127.0.0.1','::1');originalAdapters=@(@{interfaceGuid=$script:interfaceGuid.ToString();ipv4=@('192.0.2.53');ipv4Static=$true;ipv6=@('2001:db8::53');ipv6Static=$true})}
[IO.File]::WriteAllText((Join-Path $StageDirectory 'dns-owned-state.json'),($metadata | ConvertTo-Json -Depth 8))
Restore-CriticalOwnedDnsBaseline $state
Require ($script:dnsWrites -eq 2 -and $script:cacheClears -eq 1 -and ($script:dnsRows[0].ServerAddresses -join ',') -eq '192.0.2.53' -and ($script:dnsRows[1].ServerAddresses -join ',') -eq '2001:db8::53') 'Production DNS baseline did not restore and read back both address families on the matching adapter.'
Write-Output 'PASS: actual baseline recovery selects the GUID-matched adapter and verifies IPv4/IPv6 results'
Restore-CriticalAdapterDns $state
Require ($script:dnsWrites -eq 3 -and ($script:dnsRows[0].ServerAddresses -join ',') -eq '127.0.0.1' -and ($script:dnsRows[1].ServerAddresses -join ',') -eq '::1') 'Production critical DNS recovery targeted the wrong adapter or failed readback.'
Write-Output 'PASS: actual critical resolver recovery targets only the matching active adapter'
Write-Output 'Installer worker restoration: 3 groups passed; live SCM/registry/network/DNS writes 0; real isolated profile files and controlled adapters.'
