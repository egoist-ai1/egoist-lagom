# Shared by the installer and its protected reinstall worker. No work on import.
function Invoke-InstallerSc {
  param([string[]]$Arguments, [int[]]$AllowedExitCodes = @(0))
  & (Join-Path $env:SystemRoot "System32\sc.exe") @Arguments | Out-Null
  if ($AllowedExitCodes -notcontains $LASTEXITCODE) {
    throw "SCM command failed for $($Arguments[1]) ($LASTEXITCODE)."
  }
}

function Get-InstallerServicePolicy {
  param([string]$Name)
  if (-not $Name -or $Name.Length -gt 256 -or $Name -match '[/\\]') {
    throw "Invalid service name."
  }
  $key = "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\$Name"
  if (-not (Test-Path -LiteralPath $key)) { return $null }
  $record = Get-Item -LiteralPath $key -ErrorAction Stop
  $mode = switch ([int]$record.GetValue("Start", -1)) {
    2 { "Auto" }
    3 { "Manual" }
    4 { "Disabled" }
    default { throw "Unsupported service start mode for $Name." }
  }
  return [pscustomobject]@{
    name = $Name
    pathName = [string]$record.GetValue("ImagePath", "")
    startMode = $mode
    delayedAutoStart = ([int]$record.GetValue("DelayedAutoStart", 0) -ne 0)
  }
}

function Set-InstallerServiceStartMode {
  param([string]$Name, [string]$Mode, [bool]$DelayedAutoStart, [scriptblock]$OwnPath)
  $before = Get-InstallerServicePolicy $Name
  if (-not $before) { return }
  if (-not (& $OwnPath ([string]$before.pathName))) {
    throw "Refusing to change startup of non-owned service $Name."
  }
  $start = switch ($Mode) {
    { $_ -in @("Auto", "Automatic") } { if ($DelayedAutoStart) { "delayed-auto" } else { "auto" }; break }
    "Manual" { "demand" }
    "Disabled" { "disabled" }
    default { throw "Invalid preserved service start mode for $Name." }
  }
  Invoke-InstallerSc @("config", $Name, "start=", $start)
  $after = Get-InstallerServicePolicy $Name
  $expected = if ($Mode -eq "Automatic") { "Auto" } else { $Mode }
  if (-not $after -or $after.startMode -ne $expected -or
      -not (& $OwnPath ([string]$after.pathName)) -or
      ($expected -eq "Auto" -and $after.delayedAutoStart -ne $DelayedAutoStart)) {
    throw "SCM startup readback failed for $Name."
  }
}

function Stop-InstallerOwnedService {
  param([string]$Name, [scriptblock]$OwnPath)
  $policy = Get-InstallerServicePolicy $Name
  if (-not $policy) { return }
  if (-not (& $OwnPath ([string]$policy.pathName))) { throw "Refusing to stop non-owned service $Name." }
  # Disabled also blocks an SCM restart that was already queued. Changing
  # FailureActions alone cannot cancel that queue.
  Set-InstallerServiceStartMode $Name "Disabled" $false $OwnPath
  Invoke-InstallerSc @("stop", $Name) @(0, 1062)
  $deadline = (Get-Date).AddSeconds(15)
  do {
    $service = Get-InstallerServiceState $Name
    if (-not $service -or $service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Stopped) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  if ($service -and $service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
    $escapedName = $Name.Replace("\", "\\").Replace("'", "\'")
    $record = Get-CimInstance Win32_Service -Filter "Name='$escapedName'" -OperationTimeoutSec 3 -ErrorAction Stop
    if (-not $record -or -not (& $OwnPath ([string]$record.PathName)) -or [int]$record.ProcessId -le 0) {
      throw "Cannot prove a surviving owned service process for $Name."
    }
    $processId = [int]$record.ProcessId
    $nativeProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -OperationTimeoutSec 3 -ErrorAction Stop
    if (-not $nativeProcess -or -not (& $OwnPath ([string]$nativeProcess.ExecutablePath))) {
      throw "Refusing to kill an unverified process for $Name."
    }
    $shared = @(Get-CimInstance Win32_Service -Filter "ProcessId=$processId" -OperationTimeoutSec 3 -ErrorAction Stop |
      Where-Object { [string]$_.Name -ne $Name -and -not (& $OwnPath ([string]$_.PathName)) })
    if ($shared.Count -ne 0) { throw "Refusing to kill a service process shared with a foreign service." }
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
      try {
        # Hold the process handle and compare its birth and executable to the
        # fresh CIM record. A reused PID must never authorize termination.
        $heldHandle = $process.Handle
        if (-not $heldHandle -or $heldHandle -eq [IntPtr]::Zero) { throw "Service process handle is unavailable." }
        if (-not $nativeProcess.CreationDate -or
            [Math]::Abs(($process.StartTime.ToUniversalTime() - ([DateTime]$nativeProcess.CreationDate).ToUniversalTime()).TotalMilliseconds) -ge 1 -or
            -not [string]::Equals([string]$process.Path, [string]$nativeProcess.ExecutablePath, [StringComparison]::OrdinalIgnoreCase) -or
            -not (& $OwnPath ([string]$process.Path))) { throw "Service process identity changed." }
        $process.Kill()
        if (-not $process.WaitForExit(5000)) { throw "Owned service process did not exit for $Name." }
      } finally { $process.Dispose() }
    }
  }

  $stopped = 0
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $current = Get-InstallerServiceState $Name
    if (-not $current -or $current.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
      $stopped++
      if ($stopped -ge 2) { return }
    } else { $stopped = 0 }
    Start-Sleep -Milliseconds 250
  }
  throw "Owned service $Name did not remain stopped; installation cannot replace its files."
}

function Get-InstallerServiceState {
  param([string]$Name)
  try { return Get-Service -Name ([Management.Automation.WildcardPattern]::Escape($Name)) -ErrorAction Stop }
  catch {
    if ($_.FullyQualifiedErrorId -like 'NoServiceFoundForGivenName*') { return $null }
    throw
  }
}

function Suspend-InstallerServiceRestarts {
  param([object[]]$Records, [string]$SnapshotPath, [scriptblock]$OwnPath, [scriptblock]$StopCore)
  if (-not (Test-Path -LiteralPath $SnapshotPath -PathType Leaf)) {
    throw "Service startup snapshot must be durable before quiescence."
  }
  $saved = Get-Content -LiteralPath $SnapshotPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  $savedRecords = if ($saved -and $saved.PSObject.Properties['services']) { @($saved.services) } else { @($saved) }
  foreach ($record in @($Records)) {
    $match = @($savedRecords | Where-Object { [string]$_.name -eq [string]$record.name })
    if ($match.Count -ne 1 -or [string]$match[0].startMode -ne [string]$record.startMode -or
        [string]$match[0].pathName -ne [string]$record.pathName -or
        [bool]$match[0].delayedAutoStart -ne [bool]$record.delayedAutoStart) {
      throw "Service maintenance snapshot mismatch for $($record.name)."
    }
    if ([string]$record.startMode -notin @("Auto", "Automatic", "Manual", "Disabled") -or
        -not (& $OwnPath ([string]$record.pathName))) {
      throw "Unverified service maintenance record for $($record.name)."
    }
  }
  # Stop the supervisor before disabling components: an in-flight policy
  # repair in the old Core can otherwise overwrite Disabled with Auto.
  $cores = @($Records | Where-Object {
    [string]$_.name -eq "EgoistShieldCore" -or [string]$_.pathName -match '(?i)[\\/]EgoistShield\.Service\.exe(?:[" ]|$)'
  })
  foreach ($record in $cores) {
    Set-InstallerServiceStartMode ([string]$record.name) "Disabled" $false $OwnPath
    & $StopCore ([string]$record.name)
  }
  foreach ($record in @($Records)) {
    if (@($cores | Where-Object { $_.name -eq $record.name }).Count -ne 0) { continue }
    Set-InstallerServiceStartMode ([string]$record.name) "Disabled" $false $OwnPath
  }
}

function Restore-InstallerServiceStartModes {
  param([object[]]$Records, [scriptblock]$OwnPath)
  foreach ($record in @($Records)) {
    $delayed = $record.PSObject.Properties['delayedAutoStart'] -and $record.delayedAutoStart -eq $true
    Set-InstallerServiceStartMode ([string]$record.name) ([string]$record.startMode) ([bool]$delayed) $OwnPath
  }
}
