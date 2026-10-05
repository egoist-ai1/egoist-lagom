param(
  [Parameter(Mandatory=$true)][string]$CommandPath,
  [Parameter(Mandatory=$true)][string]$WorkRoot,
  [switch]$MissingModule
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($WorkRoot)
$commandFile = [IO.Path]::GetFullPath($CommandPath)
if (-not $commandFile.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture command must belong to the supplied temporary root.' }
$command = [IO.File]::ReadAllText($commandFile, [Text.Encoding]::UTF8)
$moduleDir = [IO.Path]::Combine($root, 'Modules', 'DnsClient')
$modulePath = [IO.Path]::Combine($moduleDir, 'DnsClient.psd1')
[IO.Directory]::CreateDirectory($moduleDir) | Out-Null
if (-not $MissingModule) {
  $moduleText = @'
function Get-DnsClientServerAddress {
  [CmdletBinding()]
  param([string[]]$AddressFamily)
  $global:FixtureModuleCalls += 1
  $global:FixtureFamilies = @($AddressFamily)
  $global:FixtureErrorAction = [string]$PSBoundParameters['ErrorAction']
  [pscustomobject]@{InterfaceAlias='inert-owned-reader';InterfaceIndex=77;AddressFamily=2;ServerAddresses=@('192.0.2.53')}
  [pscustomobject]@{InterfaceAlias='inert-owned-reader';InterfaceIndex=77;AddressFamily=23;ServerAddresses=@('2001:db8::53')}
}
Export-ModuleMember -Function Get-DnsClientServerAddress
'@
  [IO.File]::WriteAllText([IO.Path]::Combine($moduleDir, 'DnsClient.psm1'), $moduleText, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($modulePath, "@{RootModule='DnsClient.psm1';ModuleVersion='1.0.0';FunctionsToExport=@('Get-DnsClientServerAddress')}", [Text.UTF8Encoding]::new($false))
}
$global:FixtureModuleCalls = 0
$global:FixtureShadowCalls = 0
$global:FixtureFamilies = @()
$global:FixtureErrorAction = ''
function global:Get-DnsClientServerAddress {
  [CmdletBinding()]
  param([string[]]$AddressFamily)
  $global:FixtureShadowCalls += 1
  [pscustomobject]@{InterfaceAlias='unrelated-command-shadow';InterfaceIndex=666;AddressFamily=2;ServerAddresses=@('198.51.100.53')}
}
# Redirect only the trusted DnsClient manifest expression to this harmless
# temporary module. Utility/Core remain real OS builtins. No live DNS cmdlet runs.
$expression = "[IO.Path]::Combine(" + '$PSHOME' + ", 'Modules', 'DnsClient', 'DnsClient.psd1')"
$matches = [regex]::Matches($command, [regex]::Escape($expression)).Count
if ($matches -gt 1) { throw 'Unexpected duplicate module root expression.' }
if ($matches -eq 1) { $command = $command.Replace($expression, "'" + $modulePath.Replace("'", "''") + "'") }
$ok = $false
try {
  $value = & ([ScriptBlock]::Create($command))
  [Console]::Out.WriteLine([string]$value)
  $ok = $true
} catch {
  # Never print the original error/paths. The test only needs refusal.
} finally {
  $metadata = [pscustomobject]@{
    ok=$ok; redirectedModuleRoots=$matches; moduleCalls=$global:FixtureModuleCalls
    shadowCalls=$global:FixtureShadowCalls; families=$global:FixtureFamilies
    errorAction=$global:FixtureErrorAction; nativeQueries=0
  }
  [Console]::Error.WriteLine('INERT_SNAPSHOT_PROBE:' + (Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $metadata -Compress))
}
if (-not $ok) { exit 1 }
