# Immutable pre-fix function evidence.
# Origin: scripts/invoke-final-silent-reinstall.ps1, reviewed whole-file SHA256
# 3AD1A0FD65B3A8F42B2644C6CF8B375BC92981A504F5050C486AD769F26475FD.
# Both complete functions were retained in a bounded read of the pre-fix source
# before its controlled watchdog/recovery probe. The full worker was not saved.
# This file preserves that function text with normalized line endings; its hash
# identifies this excerpt, not the original whole worker. No current worker text
# was used to reconstruct these functions. This file only defines functions.

function Invoke-Recovery {
  param([object]$State, [string]$Reason)
  $recoveryLease = Enter-DeferredReinstallRecoveryLease
  try {
  if ($State.PSObject.Properties['handoffStarted'] -and $State.handoffStarted -ne $true -and
      -not (Test-InstallerServiceMaintenanceOwner)) {
    Add-ReceiptEvent -Stage 'recovery' -Status 'recovery-not-needed' -Message 'Update failed before service handoff; no services or DNS were stopped.'
    return
  }
  Add-ReceiptEvent -Stage "recovery" -Status "recovering" -Message $Reason
  $recoveryErrors = @()
  try { Stop-OwnedServiceForInstall -Name "EgoistShieldCore" } catch { $recoveryErrors += "stop-core: $($_.Exception.Message)" }
  try {
    Stop-PreservedWrappersForRecovery -State $State
    Restore-PreservedState -State $State
  } catch { $recoveryErrors += "restore: $($_.Exception.Message)" }
  try { Reconcile-PreservedZapretProfile -State $State } catch { $recoveryErrors += "zapret-profile: $($_.Exception.Message)" }
  try { Restore-InstalledIdentity -State $State } catch { $recoveryErrors += "identity: $($_.Exception.Message)" }
  $payloadRollbackPending = Test-PayloadRollbackPending
  if ($payloadRollbackPending) { $recoveryErrors += 'payload-rollback-pending: Previous application files are preserved in quarantine; application rollback is not yet confirmed.' }
  try {
    Restore-PreservedServiceStartModes -State $State
    Start-PreservedServices -State $State
  } catch { $recoveryErrors += "services: $($_.Exception.Message)" }
  if (Test-LoopbackDnsReady -State $State) {
    try { Restore-CriticalAdapterDns -State $State } catch { $recoveryErrors += "dns-adapter: $($_.Exception.Message)" }
  } else {
    try {
      Restore-CriticalOwnedDnsBaseline -State $State
      $recoveryErrors += "SystemDoH was not healthy; still-owned critical adapters were restored to their recorded DNS baseline."
    } catch { $recoveryErrors += "dns-failsafe: $($_.Exception.Message)" }
  }
  if ($State.runAfter -ne $false -and -not $payloadRollbackPending) {
    try { Start-InstalledDesktop -State $State } catch { $recoveryErrors += "desktop: $($_.Exception.Message)" }
  }
  if ($recoveryErrors.Count -gt 0) {
    Add-ReceiptEvent -Stage "recovery" -Status "recovery-warning" -Message ($recoveryErrors -join " | ")
  } else {
    Complete-InstallerServiceMaintenance
    Add-ReceiptEvent -Stage "recovery" -Status "recovered" -Message "Previously active services and DNS were restored."
  }
  } finally {
    $recoveryLease.ReleaseMutex()
    $recoveryLease.Dispose()
  }
}

function Invoke-WatchdogMode {
  $statePath = Join-Path $StageDirectory "state.json"
  $deadlinePath = Join-Path $StageDirectory "watchdog-deadline.txt"
  $deadline = [DateTime]::Parse((Get-Content -LiteralPath $deadlinePath -Raw), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath (Join-Path $StageDirectory "complete.flag")) { return }
    $heartbeatPath = Join-Path $StageDirectory "heartbeat.json"
    if (Test-Path -LiteralPath $heartbeatPath -PathType Leaf) {
      try {
        $heartbeat = Get-Content -LiteralPath $heartbeatPath -Raw | ConvertFrom-Json
        $workerProcess = Get-Process -Id ([int]$heartbeat.workerPid) -ErrorAction SilentlyContinue
        if (-not $workerProcess -or [int64]$workerProcess.StartTime.Ticks -ne [int64]$heartbeat.workerStartTicks) { break }
      } catch { Write-Verbose "Watchdog could not inspect worker heartbeat: $($_.Exception.Message)" }
    }
    Start-Sleep -Seconds 2
  }
  if (Test-Path -LiteralPath (Join-Path $StageDirectory "complete.flag")) { return }
  $state = Get-Content -LiteralPath $statePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  $heartbeatPath = Join-Path $StageDirectory "heartbeat.json"
  if (Test-Path -LiteralPath $heartbeatPath -PathType Leaf) {
    try {
      $heartbeat = Get-Content -LiteralPath $heartbeatPath -Raw | ConvertFrom-Json
      $installerPid = [int]$heartbeat.installerPid
      if ($installerPid -gt 0) {
        $installerProcess = Get-Process -Id $installerPid -ErrorAction SilentlyContinue
        if ($installerProcess -and [int64]$installerProcess.StartTime.Ticks -eq [int64]$heartbeat.installerStartTicks -and
            [string]$installerProcess.Path -eq [string]$state.installer) {
          Stop-Process -Id $installerPid -Force -ErrorAction SilentlyContinue
        }
      }
    } catch { Write-Verbose "Watchdog could not terminate the exact installer process: $($_.Exception.Message)" }
  }
  Invoke-Recovery -State $state -Reason "Watchdog recovered an interrupted or timed-out silent reinstall."
  Write-DesktopUpdateResult -State $state -Ok $false -Message "Обновление прервалось. Результат восстановления служб и DNS сохранён в журнале установки."
  Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "watchdog-recovered" -Encoding ASCII -Force
}
