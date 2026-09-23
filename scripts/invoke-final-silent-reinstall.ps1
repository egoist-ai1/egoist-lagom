[CmdletBinding(DefaultParameterSetName = "Dispatch")]
param(
  [Parameter(ParameterSetName = "Dispatch", Mandatory = $true)]
  [string]$InstallerPath,
  [Parameter(ParameterSetName = "Dispatch")]
  [string]$IntegrityManifestPath,
  [Parameter(ParameterSetName = "Dispatch", Mandatory = $true)]
  [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+$')]
  [string]$ExpectedVersion,
  [Parameter(ParameterSetName = "Dispatch")]
  [ValidatePattern('^[A-Fa-f0-9]{64}$')]
  [string]$ExpectedSha256,
  [Parameter(ParameterSetName = "Dispatch")]
  [switch]$EmbeddedRelease,
  [Parameter(ParameterSetName = "Dispatch")]
  [string]$InstallerUiPath = "",
  [Parameter(ParameterSetName = "Dispatch")]
  [string]$InstallerFontPath = "",
  [Parameter(ParameterSetName = "Dispatch")]
  [string]$HandoffSignalPath = "",
  [Parameter(ParameterSetName = "Dispatch")]
  [string]$RunAfterPath = "",
  [Parameter(ParameterSetName = "Dispatch")]
  [ValidatePattern('^$|^[0-9]+\.[0-9]+\.[0-9]+$')]
  [string]$FromVersion = "",
  [Parameter(ParameterSetName = "Dispatch")]
  [string]$ReceiptRoot = "",
  [Parameter(ParameterSetName = "Dispatch")]
  [ValidateRange(0, 300)]
  [int]$DelaySeconds = 15,
  [Parameter(ParameterSetName = "Dispatch")]
  [ValidateRange(120, 3600)]
  [int]$WatchdogTimeoutSeconds = 1200,
  [Parameter(ParameterSetName = "Dispatch")]
  [switch]$PlanOnly,
  [Parameter(ParameterSetName = "Worker", Mandatory = $true)]
  [switch]$Worker,
  [Parameter(ParameterSetName = "Watchdog", Mandatory = $true)]
  [switch]$Watchdog,
  [Parameter(ParameterSetName = "Worker", Mandatory = $true)]
  [Parameter(ParameterSetName = "Watchdog", Mandatory = $true)]
  [string]$StageDirectory
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$nativeProgramFiles = if ([Environment]::Is64BitOperatingSystem -and $env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
$script:OwnedInstallRoot = [IO.Path]::GetFullPath("$nativeProgramFiles\EgoistShield").TrimEnd('\')
$script:OwnedDataRoot = [IO.Path]::GetFullPath("$env:ProgramData\EgoistShield").TrimEnd('\')
$script:RuntimeRoot = Join-Path $script:OwnedDataRoot "Runtime"
$script:OptionalServiceNames = @(
  "EgoistShieldSystemDoH",
  "EgoistShieldGravitylessDNS",
  "EgoistShieldZapret",
  "EgoistShieldTelegramProxy"
)
$script:AllServiceNames = @("EgoistShieldCore") + $script:OptionalServiceNames

function Resolve-FullPath {
  param([string]$Path, [switch]$MustExist, [switch]$Leaf)
  if ([string]::IsNullOrWhiteSpace($Path)) { throw "A required path is empty." }
  $resolved = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  if ($MustExist) {
    $type = if ($Leaf) { "Leaf" } else { "Any" }
    if (-not (Test-Path -LiteralPath $resolved -PathType $type)) { throw "Path does not exist: $resolved" }
  }
  return $resolved
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-NativePowerShellPath {
  if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
    return (Join-Path $env:SystemRoot "Sysnative\WindowsPowerShell\v1.0\powershell.exe")
  }
  return (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe")
}

function Get-FileSha256 {
  param([string]$Path)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
      return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "")
    } finally {
      $algorithm.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Protect-StageDirectory {
  param([string]$Path)
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Deferred stage must not be a reparse point." }
  & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not restrict deferred stage ACL." }
}

function Write-JsonAtomic {
  param([string]$Path, [object]$Value)
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $directory -Force -ErrorAction Stop | Out-Null
  $temporary = "$Path.tmp"
  $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporary -Encoding UTF8 -Force -ErrorAction Stop
  Move-Item -LiteralPath $temporary -Destination $Path -Force -ErrorAction Stop
}

function Write-BrandedInstallerStatus {
  param([string]$Stage, [string]$Status, [string]$Message = "", [hashtable]$Data = @{})
  $display = switch ($Status) {
    "dispatched" { "8|Подготавливаем защищённое обновление..." }
    "waiting" { "15|Проверяем сохранённые службы и настройки..." }
    "dns-stopped" { "38|Компоненты сохранены. Устанавливаем новую версию..." }
    "installer-exited" {
      if ([int]$Data.exitCode -eq 0) { "82|Восстанавливаем DNS и службы..." }
      else { "88|Установка прервалась. Восстанавливаем предыдущую версию и DNS..." }
    }
    "recovering" { "88|Восстанавливаем предыдущую рабочую версию..." }
    "succeeded" { "100|DONE" }
    "recovered" { "0|ERROR: Обновление прервалось. Предыдущая версия и DNS восстановлены." }
    "recovery-warning" { "0|ERROR: Восстановление требует внимания. Подробности в защищённом журнале установки." }
    "failed" { "0|ERROR: Установка не завершена. Подробности в защищённом журнале установки." }
    default { $null }
  }
  if (-not $display) { return }
  $statusPath = Join-Path $StageDirectory "status.txt"
  $temporary = "$statusPath.tmp"
  try {
    [IO.File]::WriteAllText($temporary, $display, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $statusPath -Force -ErrorAction Stop
  } catch {
    Write-Warning "Branded installer status could not be written: $($_.Exception.Message)"
  }
}

function Write-DesktopUpdateResult {
  param([object]$State, [bool]$Ok, [string]$Message)
  if (-not $State -or -not $State.PSObject.Properties['fromVersion'] -or
      [string]::IsNullOrWhiteSpace([string]$State.fromVersion)) { return }
  try {
    $resultDir = Join-Path $script:OwnedDataRoot "Installer"
    New-Item -ItemType Directory -Path $resultDir -Force -ErrorAction Stop | Out-Null
    $resultPath = Join-Path $resultDir "last-update-result.json"
    $temporary = "$resultPath.tmp"
    $value = [ordered]@{
      schemaVersion = 1
      ok = $Ok
      code = if ($Ok) { 0 } else { 1 }
      fromVersion = [string]$State.fromVersion
      toVersion = [string]$State.version
      message = $Message
      completedAt = [DateTime]::UtcNow.ToString("o")
    }
    [IO.File]::WriteAllText($temporary, ($value | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $resultPath -Force -ErrorAction Stop
  } catch { Write-Warning "Update result could not be recorded: $($_.Exception.Message)" }
}

function Add-ReceiptEvent {
  param([string]$Stage, [string]$Status, [string]$Message = "", [hashtable]$Data = @{})
  $receiptPath = Join-Path $StageDirectory "receipt.json"
  $receipt = if (Test-Path -LiteralPath $receiptPath -PathType Leaf) {
    Get-Content -LiteralPath $receiptPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  } else {
    [pscustomobject]@{
      schemaVersion = 1
      owner = "EgoistShield"
      runId = Split-Path -Leaf $StageDirectory
      createdAt = [DateTime]::UtcNow.ToString("o")
      status = "created"
      events = @()
    }
  }
  $receiptEvent = [ordered]@{
    at = [DateTime]::UtcNow.ToString("o")
    stage = $Stage
    status = $Status
    message = $Message
    data = $Data
  }
  $receipt.events = @($receipt.events) + [pscustomobject]$receiptEvent
  $receipt.status = $Status
  $receipt | Add-Member -NotePropertyName updatedAt -NotePropertyValue $receiptEvent.at -Force
  Write-JsonAtomic -Path $receiptPath -Value $receipt
  Write-BrandedInstallerStatus -Stage $Stage -Status $Status -Message $Message -Data $Data
}

function Write-Heartbeat {
  param([string]$Stage, [string]$Phase, [int]$InstallerPid = 0)
  $workerStartTicks = [int64](Get-Process -Id $PID -ErrorAction Stop).StartTime.Ticks
  $installerStartTicks = [int64]0
  if ($InstallerPid -gt 0) {
    $installerProcess = Get-Process -Id $InstallerPid -ErrorAction SilentlyContinue
    if ($installerProcess) { $installerStartTicks = [int64]$installerProcess.StartTime.Ticks }
  }
  Write-JsonAtomic -Path (Join-Path $Stage "heartbeat.json") -Value ([ordered]@{
    owner = "EgoistShield"
    workerPid = $PID
    workerStartTicks = $workerStartTicks
    installerPid = $InstallerPid
    installerStartTicks = $installerStartTicks
    phase = $Phase
    at = [DateTime]::UtcNow.ToString("o")
  })
}

function Get-ValidatedRelease {
  param([string]$Installer, [string]$Manifest, [string]$Version, [string]$Sha256, [switch]$AllowStagedPair)
  $installerFull = Resolve-FullPath -Path $Installer -MustExist -Leaf
  $manifestFull = Resolve-FullPath -Path $Manifest -MustExist -Leaf
  $manifestObject = Get-Content -LiteralPath $manifestFull -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ([string]$manifestObject.product -ne "Egoist Lagom") { throw "Unexpected product in integrity manifest." }
  if ([string]$manifestObject.version -ne $Version) { throw "Integrity manifest version does not match $Version." }
  if ([string]$manifestObject.installer.sha256 -ne $Sha256.ToUpperInvariant()) { throw "Expected SHA-256 does not match the integrity manifest." }
  if ([int64]$manifestObject.installer.bytes -ne (Get-Item -LiteralPath $installerFull).Length) { throw "Installer length does not match the integrity manifest." }
  if ((Get-FileSha256 $installerFull) -ne $Sha256.ToUpperInvariant()) { throw "Installer SHA-256 validation failed." }
  $expectedName = "EgoistShield-Setup-$Version.exe"
  if ([IO.Path]::GetFileName($installerFull) -ne $expectedName) { throw "Installer filename must be $expectedName." }
  $projectRoot = Split-Path -Parent (Split-Path -Parent $manifestFull)
  $manifestInstaller = Resolve-FullPath -Path (Join-Path $projectRoot ([string]$manifestObject.installer.path))
  $isStagedPair = $AllowStagedPair -and
    (Split-Path -Parent $manifestFull).Equals((Split-Path -Parent $installerFull), [StringComparison]::OrdinalIgnoreCase) -and
    [IO.Path]::GetFileName($installerFull) -eq $expectedName
  if (-not $manifestInstaller.Equals($installerFull, [StringComparison]::OrdinalIgnoreCase) -and -not $isStagedPair) {
    throw "Installer path is not the installer named by the integrity manifest."
  }
  $versionInfo = (Get-Item -LiteralPath $installerFull).VersionInfo
  $fileVersion = [string]$versionInfo.FileVersion
  if ($fileVersion -and $fileVersion -notlike "$Version*") { throw "Installer PE version is $fileVersion, expected $Version." }
  return [pscustomobject]@{
    installer = $installerFull
    manifest = $manifestFull
    version = $Version
    sha256 = $Sha256.ToUpperInvariant()
    bytes = [int64](Get-Item -LiteralPath $installerFull).Length
  }
}

function Get-ValidatedEmbeddedRelease {
  param([string]$Installer, [string]$Version)
  $installerFull = Resolve-FullPath -Path $Installer -MustExist -Leaf
  $item = Get-Item -LiteralPath $installerFull -ErrorAction Stop
  if ($item.Length -lt 1024) { throw "Bundled installer is unexpectedly small." }
  $stream = [IO.File]::Open($installerFull, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    if ($stream.ReadByte() -ne 0x4D -or $stream.ReadByte() -ne 0x5A) { throw "Bundled installer is not a Windows executable." }
  } finally {
    $stream.Dispose()
  }
  $versionInfo = $item.VersionInfo
  if ([string]$versionInfo.ProductName -ne "Egoist Lagom") { throw "Bundled installer product identity is invalid." }
  if ([string]$versionInfo.FileDescription -ne "Egoist Lagom Setup") { throw "Bundled installer description is invalid." }
  if ([string]$versionInfo.FileVersion -notlike "$Version.*") { throw "Bundled installer PE version is $($versionInfo.FileVersion), expected $Version." }
  if ([string]$versionInfo.ProductVersion -notlike "$Version.*") { throw "Bundled installer product version is $($versionInfo.ProductVersion), expected $Version." }
  return [pscustomobject]@{
    installer = $installerFull
    manifest = $null
    version = $Version
    sha256 = Get-FileSha256 $installerFull
    bytes = [int64]$item.Length
  }
}

function Get-InteractiveProfileRoot {
  try {
    $userName = [string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName
    if (-not $userName) { return $null }
    $sid = ([Security.Principal.NTAccount]$userName).Translate([Security.Principal.SecurityIdentifier]).Value
    $key = "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid"
    $profileRoot = [Environment]::ExpandEnvironmentVariables([string](Get-ItemProperty -LiteralPath $key -Name ProfileImagePath -ErrorAction Stop).ProfileImagePath)
    if (Test-Path -LiteralPath $profileRoot -PathType Container) { return [IO.Path]::GetFullPath($profileRoot).TrimEnd('\') }
  } catch { Write-Verbose "Interactive profile could not be resolved: $($_.Exception.Message)" }
  return $null
}

function Test-OwnedServicePath {
  param([string]$PathName)
  if ([string]::IsNullOrWhiteSpace($PathName)) { return $false }
  $candidate = $PathName.Trim()
  if ($candidate.StartsWith('"')) {
    $closing = $candidate.IndexOf('"', 1)
    if ($closing -le 1) { return $false }
    $candidate = $candidate.Substring(1, $closing - 1)
  } else {
    $match = [regex]::Match($candidate, '^(.*?\.exe)(?:\s|$)', 'IgnoreCase')
    if (-not $match.Success) { return $false }
    $candidate = $match.Groups[1].Value
  }
  try { $full = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($candidate)).TrimEnd('\') } catch { return $false }
  return $full.StartsWith($script:OwnedInstallRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $full.StartsWith($script:OwnedDataRoot + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Get-OwnedServiceSnapshot {
  param([string]$Stage)
  $records = @()
  $registryDirectory = Join-Path $Stage "service-registry"
  New-Item -ItemType Directory -Path $registryDirectory -Force -ErrorAction Stop | Out-Null
  foreach ($name in $script:AllServiceNames) {
    $service = Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue
    if (-not $service) { continue }
    if (-not (Test-OwnedServicePath ([string]$service.PathName))) { throw "Service $name is not backed by an Egoist Shield-owned executable." }
    $regFile = Join-Path $registryDirectory "$name.reg"
    & reg.exe export "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\$name" $regFile /y | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $regFile -PathType Leaf)) { throw "Could not export $name service registration." }
    $records += [pscustomobject]@{
      name = $name
      pathName = [string]$service.PathName
      wasRunning = ([string]$service.State -eq "Running")
      startMode = [string]$service.StartMode
      registryFile = [IO.Path]::GetFileName($regFile)
    }
  }
  return @($records)
}

function Backup-UserActivationState {
  param([string]$Stage)
  $profileRoot = Get-InteractiveProfileRoot
  if (-not $profileRoot) { return @() }
  $sources = @(
    (Join-Path $profileRoot "AppData\Roaming\Egoist Shield\egoistshield-state.json"),
    (Join-Path $profileRoot "AppData\Roaming\Egoist Shield\egoistshield-state.json.bak"),
    (Join-Path $profileRoot "AppData\Roaming\Egoist Shield\installation-activation.json"),
    (Join-Path $profileRoot "AppData\Roaming\EgoistShield\egoistshield-state.json"),
    (Join-Path $profileRoot "AppData\Roaming\EgoistShield\egoistshield-state.json.bak")
  )
  $backupDirectory = Join-Path $Stage "user-state"
  $records = @()
  foreach ($source in $sources) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    New-Item -ItemType Directory -Path $backupDirectory -Force -ErrorAction Stop | Out-Null
    $backupName = "state-$($records.Count).json"
    Copy-Item -LiteralPath $source -Destination (Join-Path $backupDirectory $backupName) -Force -ErrorAction Stop
    $records += [pscustomobject]@{ source = $source; backupName = $backupName; sha256 = Get-FileSha256 $source }
  }
  return @($records)
}

function Backup-CriticalDnsState {
  param([string]$Stage)
  $records = @()
  $dnsRows = @(Get-DnsClientServerAddress -ErrorAction Stop)
  foreach ($adapter in @(Get-NetAdapter -IncludeHidden -ErrorAction Stop | Where-Object { $_.Status -eq "Up" })) {
    $addresses = @($dnsRows | Where-Object { $_.InterfaceIndex -eq $adapter.ifIndex } |
      ForEach-Object { @($_.ServerAddresses) } | Where-Object { $_ })
    if ($addresses.Count -eq 0) { continue }
    $allLoopback = $true
    foreach ($address in $addresses) {
      $ip = $null
      if (-not [Net.IPAddress]::TryParse(([string]$address).Trim('[', ']'), [ref]$ip) -or -not [Net.IPAddress]::IsLoopback($ip)) {
        $allLoopback = $false
        break
      }
    }
    if (-not $allLoopback) { continue }
    $records += [pscustomobject]@{
      interfaceGuid = [string]$adapter.InterfaceGuid
      interfaceIndex = [int]$adapter.ifIndex
      servers = @($addresses)
    }
  }
  if ($records.Count -gt 0) {
    $stateFile = Join-Path $script:OwnedDataRoot "Service\dns-owned-state.json"
    if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) { throw "Owned DNS state is missing while Windows depends on loopback DNS." }
    $backup = Join-Path $Stage "dns-owned-state.json"
    Copy-Item -LiteralPath $stateFile -Destination $backup -Force -ErrorAction Stop
    $metadata = Get-Content -LiteralPath $backup -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($metadata.schemaVersion -ne 1 -or $metadata.owner -ne "EgoistShield") { throw "Owned DNS state is invalid." }
  }
  return @($records)
}

function Restore-CriticalDnsState {
  param([object]$State)
  $backup = Join-Path $StageDirectory "dns-owned-state.json"
  if (@($State.criticalDns).Count -eq 0) { return }
  if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) { throw "Protected owned DNS backup is missing." }
  $target = Join-Path $script:OwnedDataRoot "Service\dns-owned-state.json"
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force -ErrorAction Stop | Out-Null
  Copy-Item -LiteralPath $backup -Destination $target -Force -ErrorAction Stop
}

function Restore-CriticalAdapterDns {
  param([object]$State)
  foreach ($record in @($State.criticalDns)) {
    $matches = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop |
      Where-Object { [string]$_.InterfaceGuid -eq [string]$record.interfaceGuid -and $_.Status -eq "Up" })
    if ($matches.Count -ne 1) { throw "Critical DNS adapter is missing or changed." }
    $expected = @($record.servers | ForEach-Object { [string]$_ })
    if ($expected.Count -eq 0) { throw "Critical DNS backup has no servers." }
    Set-DnsClientServerAddress -InterfaceIndex $matches[0].ifIndex -ServerAddresses $expected -ErrorAction Stop
    $readback = @((Get-DnsClientServerAddress -InterfaceIndex $matches[0].ifIndex -ErrorAction Stop |
      Select-Object -ExpandProperty ServerAddresses) | Where-Object { $_ })
    foreach ($address in $expected) {
      if ($readback -notcontains $address) { throw "Critical DNS adapter readback did not restore $address." }
    }
  }
}

function Get-InstalledIdentity {
  $path = Join-Path $script:OwnedInstallRoot "resources\installation.json"
  $metadata = Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  $parsed = [Guid]::Empty
  if (-not [Guid]::TryParse([string]$metadata.id, [ref]$parsed) -or $parsed -eq [Guid]::Empty) {
    throw "Installed Shield identity is invalid."
  }
  return [string]$parsed
}

function Restore-InstalledIdentity {
  param([object]$State)
  $id = [string]$State.installationId
  $parsed = [Guid]::Empty
  if (-not [Guid]::TryParse($id, [ref]$parsed) -or $parsed -eq [Guid]::Empty) { throw "Preserved installation identity is invalid." }
  $path = Join-Path $script:OwnedInstallRoot "resources\installation.json"
  $app = Join-Path $script:OwnedInstallRoot "EgoistShield.exe"
  $installedVersion = [string](Get-Item -LiteralPath $app -ErrorAction Stop).VersionInfo.ProductVersion
  if ($installedVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Installed Shield version could not be verified for identity restoration." }
  $text = @{ id = $id; version = $installedVersion } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($path, $text + "`n", [Text.UTF8Encoding]::new($false))
}

function Reconcile-PreservedZapretProfile {
  param([object]$State)
  $profile = [string]$State.zapretProfile
  if (-not $profile) { return }
  if ($profile -notmatch '^[A-Za-z0-9 ()_-]{1,80}$') { throw "Preserved Zapret profile name is invalid." }
  $profileFile = Join-Path (Join-Path $script:RuntimeRoot "Zapret\core") ($profile + ".bat")
  if (-not (Test-Path -LiteralPath $profileFile -PathType Leaf)) { throw "Preserved Zapret profile is missing after reinstall." }
  $profileRoot = Get-InteractiveProfileRoot
  if (-not $profileRoot) { return }
  $file = Join-Path $profileRoot "AppData\Roaming\Egoist Shield\egoistshield-state.json"
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return }
  $settings = Get-Content -LiteralPath $file -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if (-not $settings.settings) { throw "Shield user state has no settings object." }
  $settings.settings.zapretProfile = $profile
  $temporary = "$file.profile.tmp"
  [IO.File]::WriteAllText($temporary, (($settings | ConvertTo-Json -Depth 70) + "`n"), [Text.UTF8Encoding]::new($false))
  [IO.File]::Replace($temporary, $file, (Join-Path $StageDirectory "zapret-profile-user-state.before.json"))
}

function Invoke-RobocopyDirectory {
  param([string]$Source, [string]$Destination)
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return }
  New-Item -ItemType Directory -Path $Destination -Force -ErrorAction Stop | Out-Null
  & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Robocopy failed with exit code $LASTEXITCODE ($Source -> $Destination)." }
}

function Stop-OwnedServiceForInstall {
  param([string]$Name)
  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $service -or $service.Status -eq "Stopped") { return }
  $record = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction Stop
  if (-not (Test-OwnedServicePath ([string]$record.PathName))) { throw "Refusing to stop non-owned service $Name." }
  Stop-Service -Name $Name -Force -ErrorAction Stop
  $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
}

function Stop-OwnedProcesses {
  foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='EgoistShield.exe'" -ErrorAction SilentlyContinue)) {
    $executable = [string]$process.ExecutablePath
    if (-not $executable) { continue }
    try { $full = [IO.Path]::GetFullPath($executable) } catch { continue }
    if (-not $full.StartsWith($script:OwnedInstallRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
  }
}

function Restore-PreservedState {
  param([object]$State)
  $runtimeBackup = Join-Path $StageDirectory "runtime-backup"
  if (Test-Path -LiteralPath $runtimeBackup -PathType Container) {
    Invoke-RobocopyDirectory -Source $runtimeBackup -Destination $script:RuntimeRoot
  }
  foreach ($record in @($State.userState)) {
    $backup = Join-Path (Join-Path $StageDirectory "user-state") ([string]$record.backupName)
    if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) { continue }
    if ((Get-FileSha256 $backup) -ne [string]$record.sha256) { throw "Preserved user-state file failed checksum validation." }
    New-Item -ItemType Directory -Path (Split-Path -Parent ([string]$record.source)) -Force -ErrorAction Stop | Out-Null
    Copy-Item -LiteralPath $backup -Destination ([string]$record.source) -Force -ErrorAction Stop
  }
  Restore-CriticalDnsState -State $State
  foreach ($record in @($State.services | Where-Object { $_.name -ne "EgoistShieldCore" })) {
    $regFile = Join-Path (Join-Path $StageDirectory "service-registry") ([string]$record.registryFile)
    if (-not (Test-Path -LiteralPath $regFile -PathType Leaf)) { throw "Service backup is missing for $($record.name)." }
    if (-not (Get-Service -Name ([string]$record.name) -ErrorAction SilentlyContinue)) {
      $pathName = ([string]$record.pathName).Trim().Trim('"')
      if (-not (Test-OwnedServicePath $pathName) -or -not $pathName.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase) -or
          -not (Test-Path -LiteralPath $pathName -PathType Leaf)) {
        throw "Owned service wrapper is missing for $($record.name)."
      }
      & $pathName install | Out-Null
      if ($LASTEXITCODE -ne 0 -or -not (Get-Service -Name ([string]$record.name) -ErrorAction SilentlyContinue)) {
        throw "Could not re-register $($record.name) with the service manager."
      }
    }
    & reg.exe import $regFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not restore $($record.name) service registration." }
  }
}

function Start-PreservedServices {
  param([object]$State)
  $runningNames = @($State.services | Where-Object { $_.wasRunning -eq $true } | ForEach-Object { [string]$_.name })
  $startOrder = @("EgoistShieldSystemDoH", "EgoistShieldGravitylessDNS", "EgoistShieldCore", "EgoistShieldZapret", "EgoistShieldTelegramProxy")
  foreach ($name in $startOrder) {
    if ($runningNames -notcontains $name -and $name -ne "EgoistShieldCore") { continue }
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $service) {
      if ($runningNames -contains $name) { throw "Previously running service $name is missing after reinstall." }
      continue
    }
    if ($service.Status -ne "Running") {
      $started = $false
      for ($attempt = 0; $attempt -lt 8; $attempt++) {
        try {
          Start-Service -Name $name -ErrorAction Stop
          $service = Get-Service -Name $name -ErrorAction Stop
          $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(35))
          $started = $true
          break
        } catch {
          if ($attempt -eq 7) { throw }
          Start-Sleep -Seconds 2
        }
      }
      if (-not $started) { throw "Service $name did not start after reinstall." }
    }
    if ($name -eq "EgoistShieldSystemDoH" -and @($State.criticalDns).Count -gt 0) {
      if (-not (Test-LoopbackDnsReady -State $State)) { throw "SystemDoH did not recover before network services started." }
      Restore-CriticalAdapterDns -State $State
    }
  }
}

function Test-LoopbackDnsReady {
  param([object]$State)
  $dohWasRunning = @($State.services | Where-Object { $_.name -eq "EgoistShieldSystemDoH" -and $_.wasRunning -eq $true }).Count -gt 0
  if (-not $dohWasRunning) { return $true }
  for ($attempt = 0; $attempt -lt 12; $attempt++) {
    try {
      $answer = Resolve-DnsName -Name "example.com" -Server "127.0.0.1" -DnsOnly -QuickTimeout -ErrorAction Stop
      if (@($answer).Count -gt 0) { return $true }
    } catch {
      Write-Verbose "SystemDoH readiness attempt $($attempt + 1) failed: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Start-InstalledDesktop {
  $exe = Join-Path $script:OwnedInstallRoot "EgoistShield.exe"
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Installed desktop executable is missing." }
  # A normal launch also raises the already-running Electron window through its
  # second-instance handler. Hidden/minimized startup left the app invisible.
  Start-Process -FilePath $exe -WorkingDirectory $script:OwnedInstallRoot | Out-Null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $running = @(Get-CimInstance Win32_Process -Filter "Name='EgoistShield.exe'" -ErrorAction SilentlyContinue |
      Where-Object { [string]$_.ExecutablePath -eq $exe })
    if ($running.Count -gt 0) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Installed Shield desktop did not start after reinstall."
}

function Reset-CriticalLoopbackDnsToDhcp {
  $active = @(Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Up" })
  $dns = @(Get-DnsClientServerAddress -ErrorAction SilentlyContinue)
  foreach ($adapter in $active) {
    $servers = @($dns | Where-Object { $_.InterfaceIndex -eq $adapter.ifIndex } | ForEach-Object { @($_.ServerAddresses) })
    if ($servers.Count -eq 0) { continue }
    $allLoopback = $true
    foreach ($server in $servers) {
      $ip = $null
      if (-not [Net.IPAddress]::TryParse(([string]$server).Trim('[', ']'), [ref]$ip) -or -not [Net.IPAddress]::IsLoopback($ip)) { $allLoopback = $false; break }
    }
    if ($allLoopback) { Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ResetServerAddresses -ErrorAction Stop }
  }
  Clear-DnsClientCache -ErrorAction SilentlyContinue
}

function Invoke-Recovery {
  param([object]$State, [string]$Reason)
  Add-ReceiptEvent -Stage "recovery" -Status "recovering" -Message $Reason
  $recoveryErrors = @()
  try { Stop-OwnedServiceForInstall -Name "EgoistShieldCore" } catch { $recoveryErrors += "stop-core: $($_.Exception.Message)" }
  try { Restore-PreservedState -State $State } catch { $recoveryErrors += "restore: $($_.Exception.Message)" }
  try { Reconcile-PreservedZapretProfile -State $State } catch { $recoveryErrors += "zapret-profile: $($_.Exception.Message)" }
  try { Restore-InstalledIdentity -State $State } catch { $recoveryErrors += "identity: $($_.Exception.Message)" }
  try { Start-PreservedServices -State $State } catch { $recoveryErrors += "services: $($_.Exception.Message)" }
  if (Test-LoopbackDnsReady -State $State) {
    try { Restore-CriticalAdapterDns -State $State } catch { $recoveryErrors += "dns-adapter: $($_.Exception.Message)" }
  } else {
    try {
      Reset-CriticalLoopbackDnsToDhcp
      $recoveryErrors += "SystemDoH was not healthy; loopback-only DNS adapters were reset to DHCP."
    } catch { $recoveryErrors += "dns-failsafe: $($_.Exception.Message)" }
  }
  if ($State.runAfter -ne $false) {
    try { Start-InstalledDesktop } catch { $recoveryErrors += "desktop: $($_.Exception.Message)" }
  }
  if ($recoveryErrors.Count -gt 0) {
    Add-ReceiptEvent -Stage "recovery" -Status "recovery-warning" -Message ($recoveryErrors -join " | ")
  } else {
    Add-ReceiptEvent -Stage "recovery" -Status "recovered" -Message "Previously active services and DNS were restored."
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
  Write-DesktopUpdateResult -State $state -Ok $false -Message "Обновление прервалось. Предыдущая версия и сетевые службы восстановлены."
  Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "watchdog-recovered" -Encoding ASCII -Force
}

function Invoke-WorkerMode {
  if (-not (Test-IsAdministrator)) { throw "Deferred reinstall worker requires an elevated administrator token." }
  $statePath = Join-Path $StageDirectory "state.json"
  $state = Get-Content -LiteralPath $statePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  $release = Get-ValidatedRelease -Installer ([string]$state.installer) -Manifest ([string]$state.manifest) -Version ([string]$state.version) -Sha256 ([string]$state.sha256) -AllowStagedPair
  $mutex = New-Object Threading.Mutex($false, "Global\EgoistShield.DeferredReinstall")
  if (-not $mutex.WaitOne(0)) {
    Add-ReceiptEvent -Stage "worker" -Status "failed" -Message "Another protected Egoist Shield reinstall is already running."
    Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "dispatch-failed" -Encoding ASCII -Force
    $mutex.Dispose()
    throw "Another deferred Egoist Shield reinstall is already running."
  }
  try {
    Add-ReceiptEvent -Stage "worker" -Status "waiting" -Message "Validated elevated worker is waiting before the final handoff."
    Start-Sleep -Seconds ([int]$state.delaySeconds)
    $state.services = @(Get-OwnedServiceSnapshot -Stage $StageDirectory)
    $state.userState = @(Backup-UserActivationState -Stage $StageDirectory)
    $state.criticalDns = @(Backup-CriticalDnsState -Stage $StageDirectory)
    $state.installationId = Get-InstalledIdentity
    $state.zapretProfile = [string](Get-ItemProperty -LiteralPath "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\EgoistShieldZapret" -Name EgoistShieldProfile -ErrorAction SilentlyContinue).EgoistShieldProfile
    Invoke-RobocopyDirectory -Source $script:RuntimeRoot -Destination (Join-Path $StageDirectory "runtime-backup")
    Write-JsonAtomic -Path $statePath -Value $state
    $deadline = [DateTime]::UtcNow.AddSeconds([int]$state.watchdogTimeoutSeconds).ToString("o")
    Set-Content -LiteralPath (Join-Path $StageDirectory "watchdog-deadline.txt") -Value $deadline -Encoding ASCII -Force
    Write-Heartbeat -Stage $StageDirectory -Phase "preparing"
    $powerShell = Get-NativePowerShellPath
    Start-Process -FilePath $powerShell -ArgumentList @("-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", (Join-Path $StageDirectory "invoke-final-silent-reinstall.ps1"), "-Watchdog", "-StageDirectory", $StageDirectory) -WindowStyle Hidden | Out-Null

    Stop-OwnedProcesses
    foreach ($name in @("EgoistShieldTelegramProxy", "EgoistShieldZapret", "EgoistShieldGravitylessDNS", "EgoistShieldCore")) {
      Stop-OwnedServiceForInstall -Name $name
    }
    # SystemDoH is deliberately the last owned service stopped. Once this
    # succeeds, Windows may temporarily have only a silent loopback DNS entry.
    Stop-OwnedServiceForInstall -Name "EgoistShieldSystemDoH"
    Add-ReceiptEvent -Stage "handoff" -Status "dns-stopped" -Message "SystemDoH was stopped last; silent installation is starting."
    Set-Content -LiteralPath (Join-Path $StageDirectory "backup-ready.flag") -Value "ready" -Encoding ASCII -Force

    $installerProcess = Start-Process -FilePath $release.installer -ArgumentList @("/S") -PassThru -WindowStyle Hidden
    while (-not $installerProcess.HasExited) {
      Write-Heartbeat -Stage $StageDirectory -Phase "installer-running" -InstallerPid $installerProcess.Id
      Start-Sleep -Seconds 2
      $installerProcess.Refresh()
    }
    $exitCode = $installerProcess.ExitCode
    Add-ReceiptEvent -Stage "installer" -Status "installer-exited" -Message "Silent installer exited." -Data @{ exitCode = $exitCode }
    if ($exitCode -ne 0) { throw "Silent installer failed with exit code $exitCode." }

    Write-Heartbeat -Stage $StageDirectory -Phase "restoring"
    Stop-OwnedServiceForInstall -Name "EgoistShieldCore"
    Restore-PreservedState -State $state
    Reconcile-PreservedZapretProfile -State $state
    Restore-InstalledIdentity -State $state
    Start-PreservedServices -State $state
    $installedExe = Join-Path $script:OwnedInstallRoot "EgoistShield.exe"
    if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) { throw "Installed EgoistShield.exe is missing." }
    $installedVersion = [string](Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion
    if ($installedVersion -notlike "$($state.version)*") { throw "Installed version is $installedVersion, expected $($state.version)." }
    if (-not (Test-LoopbackDnsReady -State $state)) { throw "SystemDoH did not answer through 127.0.0.1 after reinstall." }
    Restore-CriticalAdapterDns -State $state
    if (-not (Test-LoopbackDnsReady -State $state)) { throw "Restored adapter DNS did not pass readback." }
    if ($state.runAfter -ne $false) { Start-InstalledDesktop }
    Add-ReceiptEvent -Stage "verify" -Status "succeeded" -Message "Installer, version, Core, preserved services and DNS passed readback." -Data @{ installedVersion = $installedVersion }
    Write-DesktopUpdateResult -State $state -Ok $true -Message "Обновление до $installedVersion установлено; службы и DNS проверены."
    Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "success" -Encoding ASCII -Force
  } catch {
    try {
      $state = Get-Content -LiteralPath $statePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      Invoke-Recovery -State $state -Reason $_.Exception.Message
      Write-DesktopUpdateResult -State $state -Ok $false -Message "Обновление не завершилось. Предыдущая версия и сетевые службы восстановлены."
    } catch {
      Add-ReceiptEvent -Stage "fatal" -Status "failed" -Message $_.Exception.Message
    }
    Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "failed-recovered" -Encoding ASCII -Force
    throw
  } finally {
    try { $mutex.ReleaseMutex() } catch { Write-Verbose "Deferred reinstall mutex was not owned: $($_.Exception.Message)" }
    $mutex.Dispose()
  }
}

if ($Watchdog) {
  $StageDirectory = Resolve-FullPath -Path $StageDirectory -MustExist
  Invoke-WatchdogMode
  exit 0
}

if ($Worker) {
  $StageDirectory = Resolve-FullPath -Path $StageDirectory -MustExist
  try {
    Invoke-WorkerMode
  } catch {
    if (-not (Test-Path -LiteralPath (Join-Path $StageDirectory "complete.flag"))) {
      try {
        Add-ReceiptEvent -Stage "worker" -Status "failed" -Message "Protected reinstall worker stopped before completion."
        Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "worker-failed" -Encoding ASCII -Force
      } catch { Write-Warning "Worker failure could not be recorded: $($_.Exception.Message)" }
    }
    throw
  }
  exit 0
}

if ($EmbeddedRelease) {
  if ($IntegrityManifestPath -or $ExpectedSha256) { throw "Embedded release dispatch must not accept an external manifest or checksum." }
  $release = Get-ValidatedEmbeddedRelease -Installer $InstallerPath -Version $ExpectedVersion
} else {
  if (-not $IntegrityManifestPath -or -not $ExpectedSha256) { throw "IntegrityManifestPath and ExpectedSha256 are required for release dispatch." }
  $release = Get-ValidatedRelease -Installer $InstallerPath -Manifest $IntegrityManifestPath -Version $ExpectedVersion -Sha256 $ExpectedSha256
}
if ($PlanOnly) {
  [pscustomobject]@{
    ready = $true
    installer = $release.installer
    version = $release.version
    sha256 = $release.sha256
    bytes = $release.bytes
    willElevate = -not (Test-IsAdministrator)
    dnsStopOrder = "last"
  } | ConvertTo-Json -Depth 4
  exit 0
}

$runningMutex = New-Object Threading.Mutex($false, "Global\EgoistShield.DeferredReinstall")
try {
  if (-not $runningMutex.WaitOne(0)) { throw "Защищённая переустановка Egoist Shield уже выполняется." }
  $runningMutex.ReleaseMutex()
} finally {
  $runningMutex.Dispose()
}

$brandedUi = -not [string]::IsNullOrWhiteSpace($InstallerUiPath)
if ($brandedUi -ne (-not [string]::IsNullOrWhiteSpace($InstallerFontPath)) -or
    $brandedUi -ne (-not [string]::IsNullOrWhiteSpace($HandoffSignalPath))) {
  throw "Branded installer handoff requires UI, font, and signal paths together."
}
if ($brandedUi) {
  $InstallerUiPath = Resolve-FullPath -Path $InstallerUiPath -MustExist -Leaf
  $InstallerFontPath = Resolve-FullPath -Path $InstallerFontPath -MustExist -Leaf
  $HandoffSignalPath = Resolve-FullPath -Path $HandoffSignalPath
  if ([IO.Path]::GetFileName($InstallerUiPath) -ne "ModernInstaller.exe" -or
      [IO.Path]::GetFileName($InstallerFontPath) -ne "Unbounded.ttf" -or
      [IO.Path]::GetFileName($HandoffSignalPath) -ne "handoff-started.flag" -or
      -not (Test-Path -LiteralPath (Split-Path -Parent $HandoffSignalPath) -PathType Container)) {
    throw "Branded installer handoff paths are invalid."
  }
}
$runAfter = $true
if (-not [string]::IsNullOrWhiteSpace($RunAfterPath)) {
  if (-not $brandedUi) { throw "RunAfterPath requires branded installer handoff." }
  $RunAfterPath = Resolve-FullPath -Path $RunAfterPath -MustExist -Leaf
  if ([IO.Path]::GetFileName($RunAfterPath) -ne "run_after.txt" -or
      [IO.Path]::GetDirectoryName($RunAfterPath) -ne [IO.Path]::GetDirectoryName($HandoffSignalPath)) {
    throw "Installer launch preference path is invalid."
  }
  $runAfterValue = ([IO.File]::ReadAllText($RunAfterPath, [Text.Encoding]::UTF8)).Trim()
  if ($runAfterValue -notin @("0", "1")) { throw "Installer launch preference is invalid." }
  $runAfter = $runAfterValue -eq "1"
}

if ([string]::IsNullOrWhiteSpace($ReceiptRoot)) { $ReceiptRoot = Join-Path $env:ProgramData "EgoistShieldInstaller\DeferredRuns" }
$receiptBase = Resolve-FullPath -Path $ReceiptRoot
New-Item -ItemType Directory -Path $receiptBase -Force -ErrorAction Stop | Out-Null
$StageDirectory = Join-Path $receiptBase ([Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $StageDirectory -Force -ErrorAction Stop | Out-Null
Protect-StageDirectory -Path $StageDirectory
$stagedInstaller = Join-Path $StageDirectory "EgoistShield-Setup-$($release.version).exe"
$stagedManifest = Join-Path $StageDirectory "package-integrity.json"
$stagedScript = Join-Path $StageDirectory "invoke-final-silent-reinstall.ps1"
Copy-Item -LiteralPath $release.installer -Destination $stagedInstaller -Force -ErrorAction Stop
if ($release.manifest) {
  Copy-Item -LiteralPath $release.manifest -Destination $stagedManifest -Force -ErrorAction Stop
} else {
  Write-JsonAtomic -Path $stagedManifest -Value ([ordered]@{
    schemaVersion = 1
    product = "Egoist Lagom"
    version = $release.version
    installer = [ordered]@{
      path = "dist/EgoistShield-Setup-$($release.version).exe"
      bytes = $release.bytes
      sha256 = $release.sha256
    }
  })
}
Copy-Item -LiteralPath $PSCommandPath -Destination $stagedScript -Force -ErrorAction Stop
if ($brandedUi) {
  Copy-Item -LiteralPath $InstallerUiPath -Destination (Join-Path $StageDirectory "ModernInstaller.exe") -Force -ErrorAction Stop
  Copy-Item -LiteralPath $InstallerFontPath -Destination (Join-Path $StageDirectory "Unbounded.ttf") -Force -ErrorAction Stop
  if ($RunAfterPath) { Copy-Item -LiteralPath $RunAfterPath -Destination (Join-Path $StageDirectory "run_after.txt") -Force -ErrorAction Stop }
}
if ((Get-FileSha256 $stagedInstaller) -ne $release.sha256) { throw "Staged installer failed SHA-256 readback." }
$state = [ordered]@{
  schemaVersion = 1
  owner = "EgoistShield"
  installer = $stagedInstaller
  manifest = $stagedManifest
  sourceInstaller = $release.installer
  version = $release.version
  sha256 = $release.sha256
  bytes = $release.bytes
  delaySeconds = $DelaySeconds
  runAfter = $runAfter
  fromVersion = $FromVersion
  watchdogTimeoutSeconds = $WatchdogTimeoutSeconds
  services = @()
  userState = @()
  criticalDns = @()
  installationId = ""
  zapretProfile = ""
}
Write-JsonAtomic -Path (Join-Path $StageDirectory "state.json") -Value $state
Add-ReceiptEvent -Stage "dispatch" -Status "dispatched" -Message "Installer was validated and staged; elevated worker will perform the final handoff." -Data @{ version = $release.version; sha256 = $release.sha256 }
$powerShell = Get-NativePowerShellPath
$workerArguments = @("-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $stagedScript, "-Worker", "-StageDirectory", $StageDirectory)
try {
  if ($brandedUi) {
    $uiProcess = Start-Process -FilePath (Join-Path $StageDirectory "ModernInstaller.exe") -ArgumentList @($StageDirectory, "--monitor") -PassThru
    $readyFlag = Join-Path $StageDirectory "ui-ready.flag"
    $readyDeadline = [DateTime]::UtcNow.AddSeconds(15)
    while (-not (Test-Path -LiteralPath $readyFlag -PathType Leaf)) {
      if ($uiProcess.HasExited) { throw "Branded installer window exited before it became ready." }
      if ([DateTime]::UtcNow -ge $readyDeadline) { throw "Branded installer window did not become ready." }
      Start-Sleep -Milliseconds 100
      $uiProcess.Refresh()
    }
  }
  if (Test-IsAdministrator) {
    Start-Process -FilePath $powerShell -ArgumentList $workerArguments -WindowStyle Hidden | Out-Null
  } else {
    Start-Process -FilePath $powerShell -ArgumentList $workerArguments -Verb RunAs -WindowStyle Hidden | Out-Null
  }
  if ($brandedUi) {
    [IO.File]::WriteAllText($HandoffSignalPath, $StageDirectory, [Text.UTF8Encoding]::new($false))
  }
} catch {
  Write-BrandedInstallerStatus -Stage "dispatch" -Status "failed" -Message $_.Exception.Message
  Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "dispatch-failed" -Encoding ASCII -Force
  throw
}
[pscustomobject]@{
  dispatched = $true
  runId = Split-Path -Leaf $StageDirectory
  receipt = Join-Path $StageDirectory "receipt.json"
  state = Join-Path $StageDirectory "state.json"
  delaySeconds = $DelaySeconds
} | ConvertTo-Json -Depth 4
