# Shared by the installer and its protected reinstall worker. No work on import.
function ConvertTo-InstallerDiagnosticMessage {
  param([AllowEmptyString()][string]$Message)
  if (-not $Message) { return '' }
  # Do not persist invocation text, stack traces, endpoint URLs or credentials.
  $safe = if ($Message.Length -gt 16384) { $Message.Substring(0, 16384) } else { $Message }
  # Serialized error fragments can escape credential keys and URI punctuation.
  $decodeUnicode = [Text.RegularExpressions.MatchEvaluator]{ param($match) [string][char][Convert]::ToInt32($match.Groups[1].Value, 16) }
  $safe = [regex]::Replace($safe, '(?i)\\+u([0-9a-f]{4})', $decodeUnicode)
  $safe = [regex]::Replace($safe, '(?im)\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*(?:\\*["''])?\s*[:=]\s*[^\r\n]+', '[redacted authorization]')
  $safe = [regex]::Replace($safe, '(?i)\b[a-z][a-z0-9+.-]*:(?:/|\\+/|\\+u002f){2}[^\s"''<>]+', '[redacted URL]')
  $safe = [regex]::Replace($safe, '(?i)\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_.-]+', '[redacted authorization]')
  $safe = [regex]::Replace($safe, '(?i)\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|token|password|passwd|secret|credential)\b\s*(?:\\*["''])?\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|''(?:\\.|[^''\\])*''|[^\s,;]+)', '[redacted credential]')
  $safe = [regex]::Replace($safe, '(?im)\b(?:arguments|commandline|argv|args)\s*(?:\\*["''])?\s*[:=]\s*[^\r\n]+', '[redacted invocation]')
  $safe = [regex]::Replace($safe, '[\x00-\x20\x7f]+', ' ').Trim()
  if ($safe.Length -gt 2048) { $safe = $safe.Substring(0, 2048) }
  return $safe
}

function New-InstallerFailureDiagnostic {
  param([Management.Automation.ErrorRecord]$Failure, [string]$Substage = 'phase-dispatch')
  if ($Substage -notmatch '^[a-z][a-z0-9-]{0,63}$') { $Substage = 'unknown' }
  $exceptionType = [string]$Failure.Exception.GetType().FullName
  if ($exceptionType.Length -gt 256) { $exceptionType = $exceptionType.Substring(0, 256) }
  $errorId = ConvertTo-InstallerDiagnosticMessage ([string]$Failure.FullyQualifiedErrorId)
  if ($errorId.Length -gt 256) { $errorId = $errorId.Substring(0, 256) }
  return [pscustomobject]@{
    schemaVersion = 1
    purpose = 'private-dns-payload-continuity-failure'
    exceptionType = $exceptionType
    errorId = $errorId
    line = [int]$Failure.InvocationInfo.ScriptLineNumber
    substage = $Substage
    errorMessage = ConvertTo-InstallerDiagnosticMessage ([string]$Failure.Exception.Message)
  }
}

function Read-InstallerFailureDiagnostic {
  param([AllowEmptyString()][string]$Json)
  try {
    if (-not $Json -or [Text.Encoding]::UTF8.GetByteCount($Json) -gt 8192) { return $null }
    $record = $Json | ConvertFrom-Json -ErrorAction Stop
    if (-not $record -or $record -is [array] -or $record.schemaVersion -ne 1 -or
        $record.purpose -cne 'private-dns-payload-continuity-failure' -or
        $record.substage -notmatch '^[a-z][a-z0-9-]{0,63}$' -or
        ($record.line -isnot [int] -and $record.line -isnot [int64]) -or $record.line -lt 0 -or $record.line -gt 100000 -or
        $record.exceptionType -isnot [string] -or $record.errorId -isnot [string] -or $record.errorMessage -isnot [string]) { return $null }
    $exceptionType = ConvertTo-InstallerDiagnosticMessage $record.exceptionType
    if ($exceptionType.Length -gt 256) { $exceptionType = $exceptionType.Substring(0, 256) }
    $errorId = ConvertTo-InstallerDiagnosticMessage $record.errorId
    if ($errorId.Length -gt 256) { $errorId = $errorId.Substring(0, 256) }
    return [pscustomobject]@{
      schemaVersion = 1; purpose = 'private-dns-payload-continuity-failure'
      exceptionType = $exceptionType; errorId = $errorId; line = [int]$record.line
      substage = [string]$record.substage
      errorMessage = ConvertTo-InstallerDiagnosticMessage $record.errorMessage
    }
  } catch { return $null }
}

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

# Caller supplies a fresh CIM record and its product ownership predicate.
# The captured process handle, birth and image authorize termination together.
function Stop-InstallerOwnedProcess {
  param([object]$Record, [scriptblock]$OwnPath)
  if (-not $Record -or [int]$Record.ProcessId -le 0 -or -not $Record.CreationDate -or
      -not $Record.ExecutablePath -or -not (& $OwnPath ([string]$Record.ExecutablePath))) {
    throw 'Cannot prove the exact owned process selected for cleanup.'
  }
  try { $ownedProcess = [Diagnostics.Process]::GetProcessById([int]$Record.ProcessId) }
  catch [ArgumentException] { return $false }
  $capturedHandle = [IntPtr]::Zero
  try {
    if ($ownedProcess.HasExited) { return $false }
    $capturedHandle = $ownedProcess.Handle
    if (-not $capturedHandle -or $capturedHandle -eq [IntPtr]::Zero) { throw 'Owned process handle is unavailable.' }
    $actualImage = [string]$ownedProcess.Path
    if ([Math]::Abs(($ownedProcess.StartTime.ToUniversalTime() - ([DateTime]$Record.CreationDate).ToUniversalTime()).TotalMilliseconds) -ge 1 -or
        -not [string]::Equals($actualImage, [string]$Record.ExecutablePath, [StringComparison]::OrdinalIgnoreCase) -or
        -not (& $OwnPath $actualImage)) { throw 'Owned process identity changed before cleanup.' }
    $ownedProcess.Kill()
    if (-not $ownedProcess.WaitForExit(5000)) { throw 'The exact owned process did not retire after cleanup.' }
    return $true
  } catch {
    $cleanupError = $_
    # A captured exited handle cannot be recycled into a live replacement PID.
    if ($capturedHandle -and $capturedHandle -ne [IntPtr]::Zero) {
      try { if ($ownedProcess.HasExited) { return $false } } catch {}
    }
    throw $cleanupError
  } finally { $ownedProcess.Dispose() }
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
