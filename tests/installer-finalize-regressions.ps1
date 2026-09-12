$ErrorActionPreference = 'Stop'
# Execute the real PostInstall control flow with in-memory substitutes for
# every filesystem, SCM, network and registration operation. No host mutation.
$sourcePath = Join-Path $PSScriptRoot '..\src\installer\owned-cleanup.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
  [IO.Path]::GetFullPath($sourcePath), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$phaseSwitch = $ast.Find({ param($node)
  $node -is [Management.Automation.Language.SwitchStatementAst] -and
  $node.Condition.Extent.Text -eq '$Phase'
}, $true)
$postInstall = @($phaseSwitch.Clauses | Where-Object { $_.Item1.Value -eq 'PostInstall' })[0].Item2
if (-not $postInstall) { throw 'PostInstall phase was not found.' }
# Preserve phase exit codes as catchable test signals rather than exiting the
# entire test process. All other statements remain the production source.
$phaseText = $postInstall.Extent.Text
$phaseText = $phaseText.Substring(1, $phaseText.Length - 2)
$phaseText = [regex]::Replace($phaseText, '\bexit\s+(\d+)\b', 'throw "MOCK_PHASE_EXIT:$1"')
$runPhase = [ScriptBlock]::Create($phaseText)

$installRoot = 'C:\MockEgoistShieldInstall'
$events = [Collections.Generic.List[string]]::new()
function Test-InstallRootHealthy { param($Root) $true }
function Invoke-CoreNativeDohCleanup { }
function Invoke-CoreOwnedDnsCleanup { }
function Remove-OptionalOwnedServices { }
function Write-Utf8NoBomFile { param($Path, $Content) }
function Write-Journal { param($Stage, $Extra) }
function Discard-OwnedNetworkArtifacts { }
function Remove-OwnedStartupArtifacts { }
function Update-ShellIconCache { }
function Assert-InstalledCandidateRuntime {
  param([switch]$BeforeCommit, [switch]$SkipTransactionResidue)
  $events.Add('runtime-gate')
  if (-not $script:coreRunning) { throw 'MOCK: Core stopped after initial service start.' }
}
function Complete-UpgradeQuarantine {
  $events.Add('commit')
  $script:previousVersionAvailable = $false
  $script:externalBaselineAvailable = $false
}
function Restore-UpgradeQuarantine {
  $events.Add('rollback')
  if (-not $script:previousVersionAvailable -or -not $script:externalBaselineAvailable) {
    return 'nothing-to-restore'
  }
  return 'restored'
}

$failures = 0
foreach ($coreRunning in @($false, $true)) {
  $script:coreRunning = $coreRunning
  $script:previousVersionAvailable = $true
  $script:externalBaselineAvailable = $true
  $events.Clear()
  $phaseFailure = $null
  try { & $runPhase } catch { $phaseFailure = $_ }
  try {
    if (-not $coreRunning) {
      if ($events.Contains('commit') -or -not $previousVersionAvailable -or -not $externalBaselineAvailable) {
        throw 'Stopped Core candidate was committed; previous version and rollback snapshots were lost.'
      }
      if (-not $events.Contains('runtime-gate') -or -not $events.Contains('rollback') -or -not $phaseFailure) {
        throw 'Stopped Core must fail the runtime gate and enter rollback before commit.'
      }
      Write-Output 'PASS: failed final Core validation preserves and restores the previous version'
    } else {
      if ($phaseFailure) { throw $phaseFailure }
      if ($events.IndexOf('runtime-gate') -lt 0 -or $events.IndexOf('commit') -le $events.IndexOf('runtime-gate')) {
        throw 'Healthy candidate must pass the final runtime gate before commit.'
      }
      Write-Output 'PASS: healthy Core candidate is committed only after runtime validation'
    }
  } catch {
    $failures++
    Write-Output "FAIL: $_ Events: $($events -join ', ')"
  }
}
if ($failures) { exit 1 }
