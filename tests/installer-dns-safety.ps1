$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '..\src\installer\owned-cleanup.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
  [IO.Path]::GetFullPath($sourcePath), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }

foreach ($name in @(
  'Test-OnlyLoopbackDnsServers',
  'Test-RunningOwnedSystemDoh',
  'Get-CriticalLoopbackDnsInterfaces',
  'Test-InstallMayStopOwnedRuntimes'
)) {
  $fn = $ast.Find({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  if (-not $fn) { throw "Function not found: $name" }
  . ([ScriptBlock]::Create($fn.Extent.Text))
}

$script:serviceRunning = $false
$script:queryFailure = $false
$script:adapterRows = @()
$script:dnsRows = @()
function Get-CimInstance {
  param($ClassName, $Filter, $ErrorAction)
  if ($ClassName -ne 'Win32_Service' -or $Filter -notlike '*EgoistShieldSystemDoH*') {
    throw 'Unexpected CIM query'
  }
  if ($script:queryFailure) { throw 'mock service query failure' }
  if ($script:serviceRunning) { return [pscustomobject]@{ State = 'Running' } }
  return [pscustomobject]@{ State = 'Stopped' }
}
function Get-NetAdapter {
  param([switch]$IncludeHidden, $ErrorAction)
  if ($script:queryFailure) { throw 'mock adapter query failure' }
  return @($script:adapterRows)
}
function Get-DnsClientServerAddress {
  param($ErrorAction)
  if ($script:queryFailure) { throw 'mock DNS query failure' }
  return @($script:dnsRows)
}

$failures = 0
function Check {
  param([string]$Name, [scriptblock]$Test)
  try {
    & $Test
    Write-Output "PASS: $Name"
  } catch {
    $script:failures++
    Write-Output "FAIL: $Name - $_"
  }
}

Check 'loopback server classification accepts IPv4, IPv6 and scoped IPv6' {
  if (-not (Test-OnlyLoopbackDnsServers @('127.0.0.1', '::1', '::1%7'))) {
    throw 'Loopback-only DNS list was not recognized.'
  }
}
Check 'loopback server classification rejects a usable public fallback' {
  if (Test-OnlyLoopbackDnsServers @('127.0.0.1', '1.1.1.1')) {
    throw 'Mixed local/public DNS list was classified as loopback-only.'
  }
}
Check 'loopback server classification rejects an empty or invalid list' {
  if ((Test-OnlyLoopbackDnsServers @()) -or (Test-OnlyLoopbackDnsServers @('invalid'))) {
    throw 'An unusable list was classified as a loopback dependency.'
  }
}

Check 'running SystemDoH and sole loopback DNS block installer mutation' {
  $script:serviceRunning = $true
  $script:queryFailure = $false
  $script:adapterRows = @([pscustomobject]@{ ifIndex = 15; Name = 'Wi-Fi'; Status = 'Up' })
  $script:dnsRows = @(
    [pscustomobject]@{ InterfaceIndex = 15; ServerAddresses = @('127.0.0.1') },
    [pscustomobject]@{ InterfaceIndex = 15; ServerAddresses = @() }
  )
  $result = Test-InstallMayStopOwnedRuntimes 2>$null
  if ($result) { throw 'Critical local DNS dependency was allowed.' }
}
Check 'stopped SystemDoH does not create a false upgrade block' {
  $script:serviceRunning = $false
  $script:queryFailure = $false
  $result = Test-InstallMayStopOwnedRuntimes 2>$null
  if (-not $result) { throw 'Stopped service was treated as a live dependency.' }
}
Check 'public fallback DNS keeps the update path available' {
  $script:serviceRunning = $true
  $script:queryFailure = $false
  $script:dnsRows = @([pscustomobject]@{
    InterfaceIndex = 15
    ServerAddresses = @('127.0.0.1', '1.1.1.1')
  })
  $result = Test-InstallMayStopOwnedRuntimes 2>$null
  if (-not $result) { throw 'A usable non-local fallback was ignored.' }
}
Check 'safety query failure while SystemDoH runs fails closed' {
  $script:serviceRunning = $true
  $script:queryFailure = $true
  $result = Test-InstallMayStopOwnedRuntimes 2>$null
  if ($result) { throw 'Indeterminate DNS safety was allowed.' }
  $script:queryFailure = $false
}

$phaseSwitch = $ast.Find({
  param($node)
  $node -is [Management.Automation.Language.SwitchStatementAst] -and
    $node.Condition.Extent.Text -eq '$Phase'
}, $true)
foreach ($phaseName in @('PreInstall', 'FreeFiles')) {
  $phaseBody = @($phaseSwitch.Clauses | Where-Object { $_.Item1.Value -eq $phaseName })[0].Item2.Extent.Text
  $guardAt = $phaseBody.IndexOf('Test-InstallMayStopOwnedRuntimes', [StringComparison]::Ordinal)
  $stopAt = $phaseBody.IndexOf('Stop-AllOwnedRuntimes', [StringComparison]::Ordinal)
  Check "$phaseName checks DNS before stopping runtimes" {
    if ($guardAt -lt 0 -or $stopAt -lt 0 -or $guardAt -ge $stopAt) {
      throw "$phaseName does not guard the first runtime stop."
    }
  }
}

$nsi = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\src\installer\setup.nsi') -Raw
Check 'NSIS enters branded progress before safety check and checks before handoff' {
  $guardAt = $nsi.IndexOf('RunPhase CheckInstallSafety', [StringComparison]::Ordinal)
  $launchAt = $nsi.IndexOf('Exec ''"$PLUGINSDIR\ModernInstaller.exe"', [StringComparison]::Ordinal)
  $startAt = $nsi.IndexOf('UserStarted:', [StringComparison]::Ordinal)
  $handoffAt = $nsi.IndexOf('!insertmacro RunProtectedReinstallHandoff', $guardAt, [StringComparison]::Ordinal)
  if ($guardAt -lt 0 -or $launchAt -lt 0 -or $startAt -lt 0 -or $handoffAt -lt 0 -or
      $launchAt -ge $startAt -or $startAt -ge $guardAt -or $guardAt -ge $handoffAt) {
    throw 'Branded progress, DNS safety and protected handoff are out of order.'
  }
}

if ($failures) { exit 1 }
