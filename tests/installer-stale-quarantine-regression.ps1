$ErrorActionPreference = 'Stop'

# Exercise the stale runtime-quarantine repair entirely below %TEMP%.
# No SCM, DNS, registry or host runtime is touched.
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('shield-stale-runtime-' + [Guid]::NewGuid().ToString('N'))
try {
  $sourceDir = Join-Path $fixture 'ProgramData\EgoistShield\Runtime'
  $destinationDir = Join-Path $fixture 'ProgramData\EgoistShield\runtime.upgrade-old-test'
  $stateDir = Join-Path $fixture 'ProgramData\EgoistShield\Installer'
  New-Item -ItemType Directory -Force -Path (Join-Path $sourceDir 'SystemDoH'), (Join-Path $sourceDir 'TelegramProxy'), (Join-Path $destinationDir 'SystemDoH'), (Join-Path $destinationDir 'TelegramProxy'), $stateDir | Out-Null
  Set-Content -LiteralPath (Join-Path $sourceDir 'SystemDoH\config.json') -Value 'new' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $sourceDir 'TelegramProxy\new.txt') -Value 'new' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $destinationDir 'SystemDoH\config.json') -Value 'old' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $destinationDir 'SystemDoH\old.txt') -Value 'old' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $destinationDir 'TelegramProxy\config.json') -Value 'old' -Encoding UTF8
  $manifest = Join-Path $stateDir 'runtime-quarantine.json'
  @([ordered]@{ source = $sourceDir; destination = $destinationDir }) | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifest -Encoding UTF8

  $sourcePath = Join-Path $PSScriptRoot '..\src\installer\owned-cleanup.ps1'
  $source = [IO.File]::ReadAllText([IO.Path]::GetFullPath($sourcePath))
  $tokens = $null; $parseErrors = $null
  $ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
  $names = @('Get-FileSha256','ConvertFrom-JsonCollectionCompat','Resolve-NormalizedPath','Test-OwnedPath','Assert-OwnedPath','Read-OwnedRuntimeQuarantine','Assert-PlainOwnedDirectoryTree','Merge-StaleOwnedRuntimeDirectory','Repair-StaleOwnedRuntimeQuarantine','Move-OwnedDirectoryWithRetry','New-OwnedRuntimeQuarantine','Restore-OwnedRuntimeQuarantine','Write-RuntimeQuarantineManifest')
  $definitions = foreach ($name in $names) {
    $fn = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $fn) { throw "Function not found: $name" }
    $fn.Extent.Text
  }

  $script:runtimeQuarantineManifestPath = $manifest
  $script:ownedRoots = @((Split-Path -Parent (Split-Path -Parent $sourceDir)))
  $script:installRoot = $script:ownedRoots[0]
  $script:programDataRoot = $script:ownedRoots[0]
  function Write-Journal { param($Stage, $Extra) }
  . ([ScriptBlock]::Create($definitions -join [Environment]::NewLine))
  $conflict = $false
  try { Repair-StaleOwnedRuntimeQuarantine } catch { $conflict = $true }
  if (-not $conflict) { throw 'Different configs were silently discarded' }
  if (-not (Test-Path -LiteralPath $manifest)) { throw 'Conflict lost its recovery manifest' }
  if ((Get-Content -Raw -LiteralPath (Join-Path $destinationDir 'SystemDoH\config.json')).Trim() -ne 'old') { throw 'Old unique config was lost' }
  Set-Content -LiteralPath (Join-Path $destinationDir 'SystemDoH\config.json') -Value 'new' -Encoding UTF8
  Repair-StaleOwnedRuntimeQuarantine

  if (Test-Path -LiteralPath $destinationDir) { throw 'stale destination remained' }
  if (Test-Path -LiteralPath $manifest) { throw 'stale manifest remained' }
  if ((Get-Content -Raw -LiteralPath (Join-Path $sourceDir 'SystemDoH\config.json')).Trim() -ne 'new') { throw 'live source was overwritten' }
  if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'SystemDoH\old.txt'))) { throw 'missing old unique file was not merged' }
  if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'TelegramProxy\config.json'))) { throw 'nested old file was not merged' }
  Write-Output 'Stale runtime quarantine merge: PASS'

  $script:upgradeStateDirectory = $stateDir
  function Get-OwnedRuntimeDirectories { @($sourceDir) }
  function Get-ValidatedUpgradeQuarantine { $null }
  New-OwnedRuntimeQuarantine
  if (Test-Path -LiteralPath $sourceDir) { throw 'Atomic quarantine left the live directory behind' }
  Restore-OwnedRuntimeQuarantine
  if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'SystemDoH\old.txt'))) { throw 'Round-trip lost a file' }
  Write-Output 'Atomic runtime quarantine round-trip: PASS'

  $lockedFile = Join-Path $sourceDir 'TelegramProxy\new.txt'
  $locked = [IO.File]::Open($lockedFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    New-OwnedRuntimeQuarantine
    if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'SystemDoH\old.txt')) -or
        -not (Test-Path -LiteralPath $lockedFile)) { throw 'Failed quarantine split or lost the original runtime' }
    if (Test-Path -LiteralPath $manifest) { throw 'Skipped optional quarantine left a pending manifest' }
  } finally { $locked.Dispose() }
  Write-Output 'Locked-child optional quarantine is skipped without losing runtime: PASS'
} finally {
  $full = [IO.Path]::GetFullPath($fixture)
  if (-not $full.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase) -or
      (Split-Path $full -Leaf) -notmatch '^shield-stale-runtime-[a-f0-9]{32}$') { throw 'Invalid fixture cleanup path' }
  if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop }
}
