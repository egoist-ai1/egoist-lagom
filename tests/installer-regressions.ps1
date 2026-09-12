param([switch]$Baseline)
$ErrorActionPreference = 'Stop'
$source = if ($Baseline) { 'recovery/official-app/resources/installer/owned-cleanup.ps1' } else { 'src/installer/owned-cleanup.ps1' }
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) $source), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($name in @('Reset-WindowsNetworkBaseline', 'Backup-AndResetPersistedNetworkActivation', 'Restore-OwnedDnsTransaction')) {
  $fn = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  . ([ScriptBlock]::Create($fn.Extent.Text))
}
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('shield-installer-tests-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($scratch) | Out-Null
$calls = [Collections.Generic.List[string]]::new()
function Write-Journal { param($Stage, $Data) }
function Save-SystemNetworkBaseline { $calls.Add('snapshot') }
function Reset-OwnedNetworkState { $calls.Add('owned-proxy') }
function Remove-OwnedTunnelAdapters { $calls.Add('owned-adapters') }
function Notify-SystemProxyChanged { $calls.Add('notify') }
function Invoke-CheckedExternal { param($Executable, $Arguments, $Context) $calls.Add([string]$Context) }
function Get-UplinkNetworkAdapters { @() }
function New-ItemProperty { $calls.Add('foreign-registry-write') }
function Remove-ItemProperty { $calls.Add('foreign-registry-remove') }
function Get-ItemProperty { @{ ProxyEnable = 0 } }
function Get-NetAdapter { param($InterfaceIndex, $ErrorAction) [pscustomobject]@{ ifIndex = 77; InterfaceGuid = 'replacement-adapter' } }
function Get-DnsClientServerAddress { param($InterfaceIndex, $ErrorAction) [pscustomobject]@{ ServerAddresses = @('9.9.9.9') } }
function netsh { $calls.Add('dns-write') }
function ipconfig.exe { }
function Join-IfSet { param($Base, $Child) if ($Base) { Join-Path $Base $Child } }
function Assert-OwnedPath { param($Path, $Because) if (-not $Path.StartsWith($scratch)) { throw 'Test escaped scratch' } }
function Write-Utf8NoBomFile { param($Path, $Content) [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false)) }
$failures = 0
function Check { param([string]$Name, [scriptblock]$Test) try { & $Test; Write-Output "PASS: $Name" } catch { $script:failures++; Write-Output "FAIL: $Name - $_" } }
try {
  $programDataRoot = Join-Path $scratch 'ProgramData'
  $roamingAppDataRoot = Join-Path $scratch 'Roaming'
  $stateDir = Join-Path $roamingAppDataRoot 'Egoist Shield'
  $userStateBackupDirectory = Join-Path $scratch 'backup'
  $userStateBackupManifestPath = Join-Path $userStateBackupDirectory 'manifest.json'
  $journalDir = Join-Path $programDataRoot 'EgoistShield/transactions'
  [IO.Directory]::CreateDirectory($stateDir) | Out-Null
  [IO.Directory]::CreateDirectory($journalDir) | Out-Null
  $journalPath = Join-Path $journalDir 'dns-transaction.json'
  Check 'installer does not reset foreign DNS or system proxies' {
    # Avoid host registry access even while running the old implementation.
    function Test-Path { param($LiteralPath) $true }
    function Restore-OwnedDnsTransaction { $calls.Add('owned-dns') }
    $calls.Clear(); Reset-WindowsNetworkBaseline -CaptureForRollback
    if (($calls -join ',') -ne 'snapshot,owned-proxy,owned-dns,owned-adapters') { throw ('Unexpected mutations: ' + ($calls -join ',')) }
  }
  Check 'upgrade disables app startup as well as network startup' {
    @{settings=@{autoStart=$true;autoConnect=$true;systemDohEnabled=$true};nodes=@(@{id='saved'})} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $stateDir 'egoistshield-state.json') -Encoding UTF8
    Backup-AndResetPersistedNetworkActivation
    $state = Get-Content (Join-Path $stateDir 'egoistshield-state.json') -Raw | ConvertFrom-Json
    if ($state.settings.autoStart -or $state.settings.autoConnect -or $state.settings.systemDohEnabled) { throw 'Activation survived install' }
    if ($state.nodes[0].id -ne 'saved') { throw 'User nodes lost' }
  }
  Check 'DNS rollback never falls back to an index reused by another adapter' {
    @{owner='EgoistShield'; resource='dns'; desiredServers=@('127.0.0.1'); original=@(@{interfaceGuid='removed-adapter';interfaceIndex=77;ipv4=@('1.1.1.1');ipv4Static=$true;ipv6=@();ipv6Static=$false})} | ConvertTo-Json -Depth 8 | Set-Content $journalPath -Encoding UTF8
    $calls.Clear(); Restore-OwnedDnsTransaction
    if ($calls.Contains('dns-write')) { throw 'Foreign adapter was modified' }
  }
  Check 'DNS rollback preserves a later external DNS change' {
    @{owner='EgoistShield'; resource='dns'; desiredServers=@('127.0.0.1'); original=@(@{interfaceGuid='replacement-adapter';interfaceIndex=77;ipv4=@('1.1.1.1');ipv4Static=$true;ipv6=@();ipv6Static=$false})} | ConvertTo-Json -Depth 8 | Set-Content $journalPath -Encoding UTF8
    $calls.Clear(); Restore-OwnedDnsTransaction
    if ($calls.Contains('dns-write')) { throw 'Foreign DNS was replaced' }
  }
} finally {
  $full = [IO.Path]::GetFullPath($scratch)
  if ($full.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $full -Leaf) -match '^shield-installer-tests-[a-f0-9]{32}$') { Remove-Item -LiteralPath $full -Recurse -Force }
}
if ($failures) { exit 1 }
