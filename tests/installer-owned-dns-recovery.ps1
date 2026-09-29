$ErrorActionPreference = 'Stop'
if (-not $env:LAGOM_TEST_TEMP -or -not [IO.Path]::IsPathRooted($env:LAGOM_TEST_TEMP)) { throw 'Set task-scoped LAGOM_TEST_TEMP.' }
$StageDirectory = Join-Path $env:LAGOM_TEST_TEMP ('d-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$null = New-Item -ItemType Directory -Path $StageDirectory
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\scripts\invoke-final-silent-reinstall.ps1'))
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Restore-CriticalOwnedDnsBaseline'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
$guid='00000000-0000-0000-0000-000000000015'
$state=[pscustomobject]@{criticalDns=@([pscustomobject]@{interfaceGuid=$guid;interfaceIndex=15;servers=@('127.0.0.1','::1')})}
$baseline=@{schemaVersion=1;owner='EgoistShield';servers=@('127.0.0.1','::1');originalAdapters=@(@{interfaceGuid=$guid;ipv4=@('192.0.2.53');ipv4Static=$true;ipv6=@();ipv6Static=$false})}
function Save-Baseline { $baseline | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $StageDirectory 'dns-owned-state.json') -Encoding utf8 }
function Reset-Fixture {
  $script:adapters=@([pscustomobject]@{InterfaceGuid=$guid;ifIndex=25},[pscustomobject]@{InterfaceGuid='00000000-0000-0000-0000-000000000099';ifIndex=99})
  $script:rows=@([pscustomobject]@{InterfaceIndex=25;AddressFamily=2;ServerAddresses=@('127.0.0.1')},[pscustomobject]@{InterfaceIndex=25;AddressFamily=23;ServerAddresses=@('::1')})
  $script:calls=@()
  Save-Baseline
}
function Get-NetAdapter { param([switch]$IncludeHidden,$ErrorAction) return $script:adapters }
function Get-DnsClientServerAddress { param($InterfaceIndex,$AddressFamily,$ErrorAction) return @($script:rows | Where-Object { $_.InterfaceIndex -eq $InterfaceIndex -and (-not $AddressFamily -or $_.AddressFamily -eq $AddressFamily) }) }
function Set-DnsClientServerAddress {
  param([Parameter(ValueFromPipeline=$true)]$InputObject,$ServerAddresses,[switch]$ResetServerAddresses)
  process {
    $script:calls += [pscustomobject]@{index=$InputObject.InterfaceIndex;family=$InputObject.AddressFamily;reset=[bool]$ResetServerAddresses}
    $InputObject.ServerAddresses = if ($ResetServerAddresses) { @() } else { @($ServerAddresses) }
  }
}
function Clear-DnsClientCache { param($ErrorAction) }
function Require { param([bool]$Value,[string]$Message) if (-not $Value) { throw $Message } }
Reset-Fixture
Restore-CriticalOwnedDnsBaseline $state
Require ($script:calls.Count -eq 2 -and $script:calls[0].index -eq 25 -and -not $script:calls[0].reset -and $script:calls[1].reset) 'GUID/family baseline was not restored.'
Require (@($script:rows[0].ServerAddresses)[0] -eq '192.0.2.53') 'Static DNS baseline was lost.'
Write-Output 'PASS: exact owned GUID restores static IPv4 and DHCP IPv6, ignoring unrelated adapter'
Reset-Fixture
$script:rows[0].ServerAddresses=@('198.51.100.53')
$refused=$false
try { Restore-CriticalOwnedDnsBaseline $state } catch { $refused=$_.Exception.Message -like '*DNS changed*' }
Require ($refused -and $script:calls.Count -eq 0) 'External DNS change was overwritten.'
Write-Output 'PASS: DNS changed after snapshot is preserved'
Reset-Fixture
$script:adapters=@($script:adapters | Where-Object { $_.ifIndex -eq 99 })
$refused=$false
try { Restore-CriticalOwnedDnsBaseline $state } catch { $refused=$_.Exception.Message -like '*unavailable*' }
Require ($refused -and $script:calls.Count -eq 0) 'Missing GUID was replaced by another index.'
Write-Output 'PASS: absent adapter never targets a replacement device'
Reset-Fixture
$baseline.originalAdapters[0].ipv4=@('127.0.0.1')
Save-Baseline
$refused=$false
try { Restore-CriticalOwnedDnsBaseline $state } catch { $refused=$_.Exception.Message -like '*independent usable*' }
Require ($refused -and $script:calls.Count -eq 0) 'Invalid self-dependent baseline was reset blindly.'
Write-Output 'PASS: invalid loopback baseline refuses a blind fallback'
Reset-Fixture
$baseline.servers=@('127.0.0.1')
Save-Baseline
$refused=$false
try { Restore-CriticalOwnedDnsBaseline $state } catch { $refused=$_.Exception.Message -like '*unowned resolver*' }
Require ($refused -and $script:calls.Count -eq 0) 'Unowned critical resolver was changed.'
Write-Output 'PASS: unowned resolver is rejected before mutation'
