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
  [string]$InstallerUiDirectory = "",
  [Parameter(ParameterSetName = "Dispatch")]
  [string]$InstallerUiPath = "",
  [Parameter(ParameterSetName = "Dispatch")]
  [string]$InstallerFontPath = "",
  [Parameter(ParameterSetName = "Dispatch")]
  [string]$HandoffSignalPath = "",
  [Parameter(ParameterSetName = "Dispatch")]
  [string]$RunAfterPath = "",
  [Parameter(ParameterSetName = "Dispatch")]
  [switch]$NoRunAfter,
  [Parameter(ParameterSetName = "Dispatch")]
  [switch]$MinimizedAfter,
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
  [Parameter(ParameterSetName = "Recover", Mandatory = $true)]
  [switch]$Recover,
  [Parameter(ParameterSetName = "Worker", Mandatory = $true)]
  [Parameter(ParameterSetName = "Watchdog", Mandatory = $true)]
  [Parameter(ParameterSetName = "Recover", Mandatory = $true)]
  [string]$StageDirectory
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$script:ServiceMaintenanceScript = Join-Path $PSScriptRoot "service-maintenance.ps1"
if (-not (Test-Path -LiteralPath $script:ServiceMaintenanceScript -PathType Leaf)) {
  $script:ServiceMaintenanceScript = Join-Path $PSScriptRoot "..\src\installer\service-maintenance.ps1"
}
. $script:ServiceMaintenanceScript
$script:BootRecoveryScript = Join-Path $PSScriptRoot "maintenance-boot-recovery.ps1"
if (-not (Test-Path -LiteralPath $script:BootRecoveryScript -PathType Leaf)) {
  $script:BootRecoveryScript = Join-Path $PSScriptRoot "..\src\installer\maintenance-boot-recovery.ps1"
}
. $script:BootRecoveryScript

function Get-InstallerCommonDataRoot { return [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData) }
$nativeProgramFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
$script:OwnedInstallRoot = [IO.Path]::GetFullPath("$nativeProgramFiles\EgoistShield").TrimEnd('\')
$script:OwnedDataRoot = [IO.Path]::GetFullPath((Join-Path (Get-InstallerCommonDataRoot) 'EgoistShield')).TrimEnd('\')
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

function ConvertTo-InstallerWindowsArgument {
  param([AllowEmptyString()][string]$Value)
  # ProcessStartInfo.Arguments uses Windows argv rules, including empty values
  # and backslashes before embedded/final quotes. PowerShell 5.1's native call
  # binder cannot preserve every ImagePath verbatim.
  $quoted = [Text.StringBuilder]::new()
  [void]$quoted.Append('"')
  $slashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') { $slashes++; continue }
    if ($character -eq '"') {
      [void]$quoted.Append(('\' * (2 * $slashes + 1)))
    } else {
      [void]$quoted.Append(('\' * $slashes))
    }
    [void]$quoted.Append($character)
    $slashes = 0
  }
  [void]$quoted.Append(('\' * (2 * $slashes)))
  [void]$quoted.Append('"')
  return $quoted.ToString()
}

function Invoke-InstallerNativeProcess {
  param([string]$Executable, [string[]]$Arguments, [ValidateRange(1, 60)][int]$TimeoutSeconds = 30)
  if (-not [IO.Path]::IsPathRooted($Executable) -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "Installer native executable must be an existing absolute file."
  }
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Executable
  $start.Arguments = (@($Arguments | ForEach-Object { ConvertTo-InstallerWindowsArgument $_ }) -join ' ')
  if ($start.Arguments.Length -gt 30000) { throw "Installer native arguments exceed their bound." }
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.StandardOutputEncoding = [Text.Encoding]::UTF8
  $start.StandardErrorEncoding = [Text.Encoding]::UTF8
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  try {
    if (-not $process.Start()) { throw "Installer native process did not start." }
    $output = $process.StandardOutput.ReadToEndAsync()
    $errors = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      # This object owns the exact child handle created above; no PID lookup.
      $process.Kill()
      [void]$process.WaitForExit(5000)
      throw "Installer native process exceeded its timeout."
    }
    if (-not $output.Wait(5000) -or -not $errors.Wait(5000)) { throw "Installer native output did not close." }
    return [pscustomobject]@{ exitCode = $process.ExitCode; output = $output.Result; errors = $errors.Result }
  } finally { $process.Dispose() }
}

function Get-InstallerNativeTool {
  param([ValidateSet('sc.exe', 'reg.exe')][string]$Name)
  $directory = if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) { 'Sysnative' } else { 'System32' }
  return Join-Path (Join-Path $env:SystemRoot $directory) $Name
}

function Invoke-PreservedRegistrationSc {
  param([string[]]$Arguments)
  $result = Invoke-InstallerNativeProcess -Executable (Get-InstallerNativeTool 'sc.exe') -Arguments $Arguments
  if ($result.exitCode -ne 0) { throw "Preserved service SCM command failed ($($result.exitCode))." }
}

function Get-PreservedServiceRegistrationMetadata {
  param([string]$Name)
  $key = Get-Item -LiteralPath "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\$Name" -ErrorAction Stop
  $unexpanded = [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
  foreach ($required in @('ImagePath', 'ObjectName', 'Type', 'ErrorControl')) {
    if ($key.GetValueNames() -notcontains $required) { throw "SERVICE_REGISTRATION_UNSUPPORTED: $Name lacks $required." }
  }
  foreach ($number in @('Type', 'ErrorControl')) {
    if ($key.GetValueKind($number) -ne [Microsoft.Win32.RegistryValueKind]::DWord) {
      throw "SERVICE_REGISTRATION_UNSUPPORTED: $Name has invalid $number metadata."
    }
  }
  foreach ($dependency in @('DependOnService', 'DependOnGroup')) {
    if ($key.GetValueNames() -contains $dependency -and $key.GetValueKind($dependency) -ne [Microsoft.Win32.RegistryValueKind]::MultiString) {
      throw "SERVICE_REGISTRATION_UNSUPPORTED: $Name has invalid dependency metadata."
    }
  }
  return [pscustomobject]@{
    schemaVersion = 1
    binPath = [string]$key.GetValue('ImagePath', '', $unexpanded)
    account = [string]$key.GetValue('ObjectName', '', $unexpanded)
    type = [int]$key.GetValue('Type', -1)
    errorControl = [int]$key.GetValue('ErrorControl', -1)
    displayName = [string]$key.GetValue('DisplayName', $Name, $unexpanded)
    group = [string]$key.GetValue('Group', '', $unexpanded)
    dependencies = @($key.GetValue('DependOnService', [string[]]@(), $unexpanded))
    dependencyGroups = @($key.GetValue('DependOnGroup', [string[]]@(), $unexpanded))
  }
}

function Assert-PreservedServiceRegistration {
  param([object]$Record)
  $name = [string]$Record.name
  if (-not $name -or $name.Length -gt 256 -or $name -match '[/\\"\x00-\x1f]') { throw "Invalid preserved service name." }
  if (-not $Record.PSObject.Properties['registration']) {
    throw "SERVICE_REGISTRATION_UNVERIFIED: $name has no checked SCM metadata; its backup was preserved."
  }
  $registration = $Record.registration
  foreach ($field in @('schemaVersion', 'binPath', 'account', 'type', 'errorControl', 'displayName', 'group', 'dependencies', 'dependencyGroups')) {
    if (-not $registration -or -not $registration.PSObject.Properties[$field]) {
      throw "SERVICE_REGISTRATION_UNVERIFIED: $name lacks checked $field metadata."
    }
  }
  if ($registration.schemaVersion -ne 1 -or [int]$registration.type -ne 16 -or
      [string]$registration.account -notin @('LocalSystem', 'NT AUTHORITY\SYSTEM') -or
      [int]$registration.errorControl -notin @(0, 1, 2, 3)) {
    throw "SERVICE_REGISTRATION_UNSUPPORTED: $name requires an own-process LocalSystem registration."
  }
  if (-not [string]::Equals([string]$registration.binPath, [string]$Record.pathName, [StringComparison]::Ordinal) -or
      -not (Test-OwnedServicePath ([string]$registration.binPath)) -or
      [string]$registration.binPath -match '[\x00-\x1f]' -or
      ([string]$registration.binPath).Length -gt 16384 -or
      -not [string]$registration.displayName -or ([string]$registration.displayName).Length -gt 256 -or
      [string]$registration.displayName -match '[\x00-\x1f]' -or
      ([string]$registration.group).Length -gt 256 -or [string]$registration.group -match '[\x00-\x1f]') {
    throw "SERVICE_REGISTRATION_UNVERIFIED: $name has invalid checked command or display metadata."
  }
  $command = ([string]$registration.binPath).Trim()
  $executable = if ($command.StartsWith('"')) {
    $end = $command.IndexOf('"', 1)
    if ($end -le 1) { throw "Invalid preserved service executable." }
    $command.Substring(1, $end - 1)
  } else {
    $match = [regex]::Match($command, '^(.*?\.exe)(?:\s|$)', 'IgnoreCase')
    if (-not $match.Success -or $match.Groups[1].Value -match '\s') { throw "Unquoted preserved service executable is ambiguous." }
    $match.Groups[1].Value
  }
  if (-not $executable.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) { throw "Unsupported preserved service executable." }
  $dependencyNames = @($registration.dependencies) + @($registration.dependencyGroups)
  if ($dependencyNames.Count -gt 64) { throw "Preserved service dependencies exceed their bound." }
  foreach ($dependency in $dependencyNames) {
    if (-not [string]$dependency -or ([string]$dependency).Length -gt 256 -or [string]$dependency -match '[/\\\x00-\x1f]') {
      throw "Invalid preserved service dependency."
    }
  }
  return [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($executable))
}

function Assert-CurrentPreservedServiceOwnership {
  param([string]$Name, [switch]$RequirePresent)
  $policy = Get-InstallerServicePolicy $Name
  if (-not $policy) {
    if ($RequirePresent) { throw "Preserved service $Name is missing." }
    return $null
  }
  if (-not (Test-OwnedServicePath ([string]$policy.pathName))) { throw "Refusing to restore or start a foreign service $Name." }
  return $policy
}

function Get-ServiceFrameworkRelease {
  $view = if ([Environment]::Is64BitOperatingSystem) { [Microsoft.Win32.RegistryView]::Registry64 } else { [Microsoft.Win32.RegistryView]::Registry32 }
  $registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $view)
  try {
    $key = $registry.OpenSubKey('SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', $false)
    if (-not $key) { return 0 }
    try { return [int]$key.GetValue('Release', 0) } finally { $key.Dispose() }
  } finally { $registry.Dispose() }
}

function Assert-SupportedServiceFramework {
  if ((Get-ServiceFrameworkRelease) -lt 528040) {
    throw '.NET Framework 4.8 or newer is required before updating the service wrappers. Install Windows updates and retry; services have not been stopped.'
  }
}

function Get-PreservedWrapperDefinitions {
  return @{
    EgoistShieldSystemDoH = @('SystemDoH', 'egoistshield-system-doh-service')
    EgoistShieldTelegramProxy = @('TelegramProxy', 'egoistshield-telegram-proxy-service')
    EgoistShieldZapret = @('Zapret', 'egoistshield-zapret-service')
  }
}

function Protect-StageDirectory {
  param([string]$Path)
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Deferred stage must not be a reparse point." }
  $administrators = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
  $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
  $security = New-Object Security.AccessControl.DirectorySecurity
  $security.SetOwner($administrators)
  $security.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($administrators, $system)) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity,
      [Security.AccessControl.FileSystemRights]::FullControl,
      ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),
      [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $security -ErrorAction Stop
  $actual = Get-Acl -LiteralPath $Path -ErrorAction Stop
  if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544') {
    throw "Protected installer directory ownership or inheritance readback failed."
  }
  foreach ($rule in $actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        $rule.IdentityReference.Value -notin @('S-1-5-18', 'S-1-5-32-544')) {
      throw "Protected installer directory retained an untrusted access rule."
    }
  }
}

function New-InstallerProtectedFileSecurity {
  $security = New-Object Security.AccessControl.FileSecurity
  $security.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  $security.SetAccessRuleProtection($true, $false)
  foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($sid)), [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
  }
  return $security
}

function Protect-InstallerStageFile {
  param([string]$Path)
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Protected installer file is not a plain file."
  }
  Set-Acl -LiteralPath $Path -AclObject (New-InstallerProtectedFileSecurity) -ErrorAction Stop
  $actual = Get-Acl -LiteralPath $Path -ErrorAction Stop
  if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544') {
    throw "Protected installer file ownership or inheritance readback failed."
  }
  foreach ($rule in $actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        $rule.IdentityReference.Value -notin @('S-1-5-18', 'S-1-5-32-544')) { throw "Protected installer file retained an untrusted access rule." }
  }
}

function Protect-InstallerStageTree {
  param([string]$Stage)
  $stagePath = [IO.Path]::GetFullPath($Stage).TrimEnd('\')
  $directories = New-Object 'Collections.Generic.List[string]'
  $files = New-Object 'Collections.Generic.List[string]'
  $pending = New-Object 'Collections.Generic.Stack[string]'
  $pending.Push($stagePath)
  while ($pending.Count -gt 0) {
    $directory = $pending.Pop()
    $item = Get-Item -LiteralPath $directory -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Installer backup tree contains a reparse point." }
    $directories.Add($directory)
    foreach ($child in @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)) {
      if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
          -not $child.FullName.StartsWith($stagePath + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Installer backup tree escaped its protected stage."
      }
      if ($child.PSIsContainer) { $pending.Push($child.FullName) } else { $files.Add($child.FullName) }
    }
    if ($directories.Count + $files.Count + $pending.Count -gt 100000) { throw "Installer backup tree exceeds its supported file bound." }
  }
  foreach ($directory in $directories) { Protect-StageDirectory -Path $directory }
  foreach ($file in $files) { Protect-InstallerStageFile -Path $file }
}

function Write-JsonAtomic {
  param([string]$Path, [object]$Value)
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $directory -Force -ErrorAction Stop | Out-Null
  $temporary = "$Path." + [Guid]::NewGuid().ToString('N') + '.tmp'
  $security = New-InstallerProtectedFileSecurity
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 12))
  try {
    $stream = New-Object IO.FileStream($temporary, [IO.FileMode]::CreateNew,
      [Security.AccessControl.FileSystemRights]::Write, [IO.FileShare]::None, 4096,
      [IO.FileOptions]::WriteThrough, $security)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    if (Test-Path -LiteralPath $Path -PathType Leaf) { [IO.File]::Replace($temporary, $Path, [Management.Automation.Language.NullString]::Value) }
    else { [IO.File]::Move($temporary, $Path) }
  } finally {
    if (Test-Path -LiteralPath $temporary -PathType Leaf) { Remove-Item -LiteralPath $temporary -Force -ErrorAction Stop }
  }
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
    "recovered" { "0|ERROR: Обновление прервалось. Службы и DNS восстановлены." }
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

function New-InstallerReceiptMutexSecurity {
  $security = New-Object Security.AccessControl.MutexSecurity
  $security.SetAccessRuleProtection($true, $false)
  $security.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $identity = New-Object Security.Principal.SecurityIdentifier($sid)
    $security.AddAccessRule((New-Object Security.AccessControl.MutexAccessRule($identity, 'FullControl', 'Allow')))
  }
  return $security
}

function Enter-InstallerReceiptLease {
  $canonicalStage = [IO.Path]::GetFullPath($StageDirectory).TrimEnd('\').ToLowerInvariant()
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $stageId = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonicalStage))).Replace('-', '') }
  finally { $hasher.Dispose() }
  $created = $false
  $lease = [Threading.Mutex]::new($false, "Global\EgoistShield.InstallerReceipt.$stageId", [ref]$created, (New-InstallerReceiptMutexSecurity))
  try {
    try { $acquired = $lease.WaitOne(5000) }
    catch [Threading.AbandonedMutexException] { $acquired = $true }
    if (-not $acquired) { throw "Installer receipt is busy; its pending event must not overwrite another writer." }
    return $lease
  } catch { $lease.Dispose(); throw }
}

function Add-ReceiptEvent {
  param([string]$Stage, [string]$Status, [string]$Message = "", [hashtable]$Data = @{})
  $receiptLease = Enter-InstallerReceiptLease
  try {
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
  } finally {
    $receiptLease.ReleaseMutex()
    $receiptLease.Dispose()
  }
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
    workerExecutable = [string](Get-Process -Id $PID -ErrorAction Stop).Path
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
  foreach ($service in @(Get-CimInstance Win32_Service -ErrorAction Stop -OperationTimeoutSec 3 | Sort-Object Name)) {
    $name = [string]$service.Name
    if (-not (Test-OwnedServicePath ([string]$service.PathName))) {
      if ($script:AllServiceNames -contains $name) { throw "Service $name is not backed by an Egoist Shield-owned executable." }
      continue
    }
    if ([string]$service.StartName -notin @("LocalSystem", "NT AUTHORITY\SYSTEM")) {
      throw "SERVICE_ACCOUNT_UNSUPPORTED: $name uses a custom service account; its credentials cannot be preserved by registry export. No services have been stopped."
    }
    $policy = Get-InstallerServicePolicy $name
    if (-not $policy) { throw "Could not read startup policy for $name." }
    $registration = Get-PreservedServiceRegistrationMetadata $name
    $checkedRecord = [pscustomobject]@{ name = $name; pathName = [string]$registration.binPath; registration = $registration }
    [void](Assert-PreservedServiceRegistration $checkedRecord)
    if (-not [string]::Equals([Environment]::ExpandEnvironmentVariables([string]$registration.binPath),
        [Environment]::ExpandEnvironmentVariables([string]$service.PathName), [StringComparison]::Ordinal) -or
        -not [string]::Equals([Environment]::ExpandEnvironmentVariables([string]$registration.binPath),
        [string]$policy.pathName, [StringComparison]::Ordinal)) {
      throw "Service registration changed during snapshot for $name; no services have been stopped."
    }
    $regFile = Join-Path $registryDirectory ("service-" + $records.Count + ".reg")
    & reg.exe export "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\$name" $regFile /y | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $regFile -PathType Leaf)) { throw "Could not export $name service registration." }
    $wrapperHash = ''
    $definitions = Get-PreservedWrapperDefinitions
    if ($definitions.ContainsKey($name)) {
      $definition = $definitions[$name]
      $wrapper = Assert-OwnedRuntimeMigrationPath (Join-Path $script:RuntimeRoot ($definition[0] + '\service-wrapper\' + $definition[1] + '.exe'))
      if ([IO.Path]::GetFullPath(([string]$service.PathName).Trim().Trim('"')) -ne $wrapper) { throw "Runtime migration service ownership mismatch for $name." }
      $wrapperHash = Get-FileSha256 $wrapper
    }
    $records += [pscustomobject]@{
      name = $name
      pathName = [string]$registration.binPath
      wasRunning = ([string]$service.State -eq "Running")
      startMode = [string]$policy.startMode
      delayedAutoStart = [bool]$policy.delayedAutoStart
      registryFile = [IO.Path]::GetFileName($regFile)
      registrySha256 = Get-FileSha256 $regFile
      registration = $registration
      wrapperSha256 = $wrapperHash
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
    $matchingAdapters = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop |
      Where-Object { [string]$_.InterfaceGuid -eq [string]$record.interfaceGuid -and $_.Status -eq "Up" })
    if ($matchingAdapters.Count -ne 1) { throw "Critical DNS adapter is missing or changed." }
    $expected = @($record.servers | ForEach-Object { [string]$_ })
    if ($expected.Count -eq 0) { throw "Critical DNS backup has no servers." }
    Set-DnsClientServerAddress -InterfaceIndex $matchingAdapters[0].ifIndex -ServerAddresses $expected -ErrorAction Stop
    $readback = @((Get-DnsClientServerAddress -InterfaceIndex $matchingAdapters[0].ifIndex -ErrorAction Stop |
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
  $preservedProfile = [string]$State.zapretProfile
  if (-not $preservedProfile) { return }
  if ($preservedProfile -notmatch '^[A-Za-z0-9 ()_-]{1,80}$') { throw "Preserved Zapret profile name is invalid." }
  $profileFile = Join-Path (Join-Path $script:RuntimeRoot "Zapret\core") ($preservedProfile + ".bat")
  if (-not (Test-Path -LiteralPath $profileFile -PathType Leaf)) { throw "Preserved Zapret profile is missing after reinstall." }
  $profileRoot = Get-InteractiveProfileRoot
  if (-not $profileRoot) { return }
  $file = Join-Path $profileRoot "AppData\Roaming\Egoist Shield\egoistshield-state.json"
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return }
  $settings = Get-Content -LiteralPath $file -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if (-not $settings.settings) { throw "Shield user state has no settings object." }
  $settings.settings.zapretProfile = $preservedProfile
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
  Stop-InstallerOwnedService $Name { param($path) Test-OwnedServicePath $path }
}

function Enter-InstallerServiceMaintenance {
  $directory = Join-Path $script:OwnedDataRoot "installer"
  [void](Assert-PlainWrapperMigrationPath -Path $directory -Root $script:OwnedDataRoot)
  New-Item -ItemType Directory -Path $directory -Force -ErrorAction Stop | Out-Null
  Protect-StageDirectory -Path $directory
  $marker = Join-Path $directory "service-maintenance.json"
  if (Test-Path -LiteralPath $marker -PathType Leaf) {
    $existing = Get-Content -LiteralPath $marker -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($existing.schemaVersion -ne 1 -or $existing.owner -ne "EgoistShield" -or [string]$existing.stage -ne $StageDirectory) {
      throw "Another service maintenance transaction requires recovery."
    }
    return
  }
  Write-JsonAtomic -Path $marker -Value @{schemaVersion=1;owner="EgoistShield";stage=$StageDirectory}
}

function Complete-InstallerServiceMaintenance {
  $marker = Join-Path $script:OwnedDataRoot "installer\service-maintenance.json"
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { return }
  $existing = Get-Content -LiteralPath $marker -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ($existing.owner -ne "EgoistShield" -or [string]$existing.stage -ne $StageDirectory) {
    throw "Refusing to remove another service maintenance transaction."
  }
  Remove-Item -LiteralPath $marker -Force -ErrorAction Stop
}

function Get-InstallerServiceMaintenanceStatus {
  $marker = Join-Path $script:OwnedDataRoot "installer\service-maintenance.json"
  if (-not (Test-Path -LiteralPath $marker)) { return 'absent' }
  [void](Assert-PlainWrapperMigrationPath -Path $marker -Root $script:OwnedDataRoot)
  $item = Get-Item -LiteralPath $marker -ErrorAction Stop
  if ($item.PSIsContainer -or $item.Length -gt 16384) { throw "Service maintenance marker is invalid or exceeds its limit." }
  $existing = Get-Content -LiteralPath $marker -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ($existing.schemaVersion -ne 1 -or $existing.owner -ne 'EgoistShield' -or
      -not [IO.Path]::IsPathRooted([string]$existing.stage)) { throw "Service maintenance marker identity is unverified." }
  if ([string]::Equals([string]$existing.stage, $StageDirectory, [StringComparison]::OrdinalIgnoreCase)) { return 'owned' }
  return 'foreign'
}

function Test-InstallerServiceMaintenanceOwner {
  return (Get-InstallerServiceMaintenanceStatus) -eq 'owned'
}

function Enter-DeferredReinstallRecoveryLease {
  $lease = New-Object Threading.Mutex($false, "Global\EgoistShield.DeferredReinstall")
  try {
    try { $acquired = $lease.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $acquired = $true }
    if (-not $acquired) { throw "Protected reinstall is still active; recovery must not overlap its mutations." }
    return $lease
  } catch { $lease.Dispose(); throw }
}

function Get-ValidatedMaintenanceRecoveryState {
  param([string]$Stage)
  $deferredRoot = Join-Path (Get-InstallerCommonDataRoot) "EgoistShieldInstaller\DeferredRuns"
  $previousStage = Assert-PlainWrapperMigrationPath -Path $Stage -Root $deferredRoot
  $previousStatePath = Assert-PlainWrapperMigrationPath -Path (Join-Path $previousStage "state.json") -Root $previousStage
  if ((Get-Item -LiteralPath $previousStatePath -ErrorAction Stop).Length -gt 4194304) { throw "Previous reinstall state exceeds its limit." }
  $previous = Get-Content -LiteralPath $previousStatePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ($previous.schemaVersion -ne 1 -or $previous.owner -ne "EgoistShield") { throw "Unverified previous reinstall state." }
  [void](Assert-PlainWrapperMigrationPath -Path ([string]$previous.installer) -Root $previousStage)
  [void](Assert-PlainWrapperMigrationPath -Path ([string]$previous.manifest) -Root $previousStage)
  [void](Get-ValidatedRelease -Installer ([string]$previous.installer) -Manifest ([string]$previous.manifest) -Version ([string]$previous.version) -Sha256 ([string]$previous.sha256) -AllowStagedPair)
  foreach ($record in @($previous.services)) {
    if (-not $record.name -or [string]$record.name -match '[/\\]' -or
        [string]$record.registryFile -notmatch '^service-\d+\.reg$' -or
        -not (Test-OwnedServicePath ([string]$record.pathName))) { throw "Unverified previous service snapshot." }
    [void](Assert-PlainWrapperMigrationPath -Path (Join-Path (Join-Path $previousStage "service-registry") ([string]$record.registryFile)) -Root $previousStage)
    [void](Assert-PreservedServiceRegistration -Record $record)
    [void](Get-PreservedRegistryBackup -Record $record)
  }
  return $previous
}

function Resume-InterruptedServiceMaintenance {
  $marker = Join-Path $script:OwnedDataRoot "installer\service-maintenance.json"
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { return }
  [void](Assert-PlainWrapperMigrationPath -Path $marker -Root $script:OwnedDataRoot)
  if ((Get-Item -LiteralPath $marker -ErrorAction Stop).Length -gt 16384) { throw "Service maintenance marker exceeds its limit." }
  $pending = Get-Content -LiteralPath $marker -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ($pending.schemaVersion -ne 1 -or $pending.owner -ne "EgoistShield") { throw "Unverified service maintenance marker." }
  $previousStage = [string]$pending.stage
  # The caller holds the shared deferred-reinstall mutex. The same lease also
  # serializes watchdog recovery, including a watchdog left by an older stage.
  $StageDirectory = $previousStage
  $previous = Get-ValidatedMaintenanceRecoveryState -Stage $previousStage
  $previous.runAfter = $false
  $resumed = Invoke-Recovery -State $previous -Reason "Resuming the preserved service state before a new reinstall."
  if ($resumed -ne $true -or (Test-Path -LiteralPath $marker -PathType Leaf)) {
    throw "Previous service maintenance still requires recovery; its original snapshot was preserved."
  }
  [void](Unregister-InstallerMaintenanceBootRecovery -StageDirectory $previousStage -RestorationVerified:$true)
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
  $serviceRecords = @($State.services | Where-Object { $_.name -ne "EgoistShieldCore" })
  # Reject unverifiable old stages and foreign name collisions before restoring
  # files or DNS ownership. A stage without metadata is kept for manual recovery.
  foreach ($record in $serviceRecords) {
    [void](Assert-PreservedServiceRegistration $record)
    [void](Get-PreservedRegistryBackup $record)
    [void](Assert-CurrentPreservedServiceOwnership ([string]$record.name))
  }
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
  foreach ($record in $serviceRecords) {
    Restore-PreservedServiceRegistration $record
  }
}

function Get-PreservedRegistryBackup {
  param([object]$Record)
  if ([string]$Record.registryFile -notmatch '^service-\d+\.reg$' -or
      -not $Record.PSObject.Properties['registrySha256'] -or [string]$Record.registrySha256 -notmatch '^[0-9A-Fa-f]{64}$') {
    throw "SERVICE_REGISTRATION_UNVERIFIED: $($Record.name) has no checked registry backup."
  }
  $file = Assert-PlainWrapperMigrationPath -Path (Join-Path (Join-Path $StageDirectory 'service-registry') ([string]$Record.registryFile)) -Root $StageDirectory
  if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileSha256 $file) -ne [string]$Record.registrySha256) {
    throw "Preserved service registry backup failed checksum validation."
  }
  return $file
}

function New-DisabledServiceRegistryImport {
  param([object]$Record)
  $source = Get-PreservedRegistryBackup $Record
  if ((Get-Item -LiteralPath $source -ErrorAction Stop).Length -gt 4194304) { throw "Preserved service registry backup exceeds its bound." }
  $root = 'HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\' + [string]$Record.name
  $inRoot = $false
  $changed = 0
  $lines = @([IO.File]::ReadAllLines($source))
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index].Trim() -match '^\[(.*)\]$') {
      $section = $Matches[1]
      if (-not $section.Equals($root, [StringComparison]::OrdinalIgnoreCase) -and
          -not $section.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Preserved registry backup contains a foreign section."
      }
      $inRoot = $section.Equals($root, [StringComparison]::OrdinalIgnoreCase)
    } elseif ($inRoot -and $lines[$index] -match '^"Start"=dword:[0-9a-fA-F]{8}$') {
      $lines[$index] = '"Start"=dword:00000004'
      $changed++
    }
  }
  if ($changed -ne 1) { throw "Preserved registry backup has no unique startup entry." }
  $destination = Assert-PlainWrapperMigrationPath -Path (Join-Path (Split-Path -Parent $source) ('maintenance-' + [string]$Record.registryFile)) -Root $StageDirectory
  [IO.File]::WriteAllLines($destination, [string[]]$lines, [Text.Encoding]::Unicode)
  return $destination
}

function Restore-PreservedServiceRegistration {
  param([object]$Record)
  $name = [string]$Record.name
  $executable = Assert-PreservedServiceRegistration $Record
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Preserved service executable is missing for $name." }
  $registration = $Record.registration
  $import = New-DisabledServiceRegistryImport $Record
  $current = Assert-CurrentPreservedServiceOwnership $name
  $service = Get-InstallerServiceState $name
  if ($service -and [string]$service.ServiceName -ne $name) { throw "Literal preserved service identity mismatch." }
  if ($service -and -not $current) { throw "Preserved service $name has no verifiable registration." }
  if ($service -and $service.Status -ne 'Stopped') { throw "Preserved service $name must remain stopped during registration restore." }
  $action = if ($current -or $service) { 'config' } else { 'create' }
  $errorMode = @('ignore', 'normal', 'severe', 'critical')[[int]$registration.errorControl]
  $dependencies = @($registration.dependencies) + @($registration.dependencyGroups | ForEach-Object { '+' + [string]$_ })
  $arguments = @($action, $name, 'binPath=', [string]$registration.binPath, 'type=', 'own',
    'start=', 'disabled', 'error=', $errorMode, 'obj=', 'LocalSystem', 'DisplayName=', [string]$registration.displayName,
    'group=', [string]$registration.group, 'depend=', ($dependencies -join '/'))
  # Ownership is read again directly before each host mutation. The generated
  # registry import retains Start=Disabled, including across a worker crash.
  [void](Assert-CurrentPreservedServiceOwnership $name)
  Invoke-PreservedRegistrationSc -Arguments $arguments
  $configured = Assert-CurrentPreservedServiceOwnership $name -RequirePresent
  if ($configured.startMode -ne 'Disabled' -or -not [string]::Equals(
      [Environment]::ExpandEnvironmentVariables([string]$configured.pathName),
      [Environment]::ExpandEnvironmentVariables([string]$registration.binPath), [StringComparison]::Ordinal)) {
    throw "Could not re-register $name with the service manager: SCM registration readback failed."
  }
  $importResult = Invoke-InstallerNativeProcess -Executable (Get-InstallerNativeTool 'reg.exe') -Arguments @('import', $import)
  if ($importResult.exitCode -ne 0) { throw "Could not import preserved service registration for $name." }
  $restored = Assert-CurrentPreservedServiceOwnership $name -RequirePresent
  if ($restored.startMode -ne 'Disabled' -or -not [string]::Equals(
      [Environment]::ExpandEnvironmentVariables([string]$restored.pathName),
      [Environment]::ExpandEnvironmentVariables([string]$registration.binPath), [StringComparison]::Ordinal)) {
    throw "Preserved service $name did not retain its command and Disabled before resume."
  }
}

function Assert-OwnedRuntimeMigrationPath {
  param([string]$Path)
  $candidate = [IO.Path]::GetFullPath($Path)
  $runtimeRoot = [IO.Path]::GetFullPath($script:RuntimeRoot).TrimEnd('\')
  if (-not $candidate.StartsWith($runtimeRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Runtime migration path is outside the owned root.'
  }
  $current = $candidate
  while ($current -and $current.StartsWith($runtimeRoot, [StringComparison]::OrdinalIgnoreCase)) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Runtime migration refuses reparse points.' }
    }
    if ($current -eq $runtimeRoot) { break }
    $current = [IO.Path]::GetDirectoryName($current)
  }
  return $candidate
}

function Write-OwnedRuntimeMigrationFile {
  param([string]$Path, [string]$Content)
  $target = Assert-OwnedRuntimeMigrationPath $Path
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'Runtime migration target is missing.' }
  $temporary = Assert-OwnedRuntimeMigrationPath ($target + '.migration-' + [Guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllText($temporary, $Content, (New-Object Text.UTF8Encoding($false)))
    [IO.File]::Replace($temporary, $target, [NullString]::Value)
  } finally {
    if (Test-Path -LiteralPath $temporary -PathType Leaf) { Remove-Item -LiteralPath $temporary -Force -ErrorAction Stop }
  }
}

function Assert-PlainWrapperMigrationPath {
  param([string]$Path, [string]$Root)
  $candidate = [IO.Path]::GetFullPath($Path)
  $ownedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  if (-not $candidate.StartsWith($ownedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Wrapper migration path is outside its owned root.' }
  $current = $candidate
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Wrapper migration refuses reparse points.' }
    }
    $current = [IO.Path]::GetDirectoryName($current)
  }
  return $candidate
}

function Get-VerifiedPackagedServiceWrapper {
  param([string]$Version)
  $expectedHash = 'B5066B7BBDFBA1293E5D15CDA3CAAEA88FBEAB35BD5B38C41C913D492AADFC4F'
  $expectedBytes = 655872
  $relative = 'zapret/service-wrapper/egoistshield-zapret-service.exe'
  $manifestPath = Assert-PlainWrapperMigrationPath -Path (Join-Path $script:OwnedInstallRoot 'resources\runtime\manifest.json') -Root $script:OwnedInstallRoot
  if ((Get-Item -LiteralPath $manifestPath -ErrorAction Stop).Length -gt 4194304) { throw 'Wrapper payload manifest exceeds its migration limit.' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ([int]$manifest.schemaVersion -ne 1 -or [string]$manifest.packageVersion -ne $Version) { throw 'Wrapper payload manifest version is not the installed release.' }
  $components = @($manifest.components | Where-Object { $_.name -eq 'zapret' -and $_.present -eq $true })
  if ($components.Count -ne 1) { throw 'Wrapper payload component inventory is missing or ambiguous.' }
  $files = @($components[0].files | Where-Object { [string]$_.path -eq $relative })
  if ($files.Count -ne 1 -or [string]$files[0].sha256 -ne $expectedHash -or [int64]$files[0].size -ne $expectedBytes) { throw 'Wrapper payload inventory does not match the pinned WinSW release.' }
  $source = Assert-PlainWrapperMigrationPath -Path (Join-Path (Split-Path -Parent $manifestPath) $relative) -Root $script:OwnedInstallRoot
  if ((Get-Item -LiteralPath $source -ErrorAction Stop).Length -ne $expectedBytes -or (Get-FileSha256 $source) -ne $expectedHash) { throw 'Packaged service wrapper failed pinned checksum validation.' }
  return [pscustomobject]@{ path = $source; sha256 = $expectedHash; bytes = $expectedBytes }
}

function Assert-PreservedWrapperStopped {
  param([string]$Name, [string]$Wrapper)
  $service = Get-Service -Name $Name -ErrorAction Stop
  if ($service.Status -ne 'Stopped') { throw "Wrapper migration requires stopped service $Name." }
  $registration = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction Stop
  if (-not $registration -or [IO.Path]::GetFullPath(([string]$registration.PathName).Trim().Trim('"')) -ne $Wrapper) { throw "Wrapper migration current service ownership mismatch for $Name." }
}

function Update-PreservedServiceWrappers {
  param([object]$State)
  $definitions = Get-PreservedWrapperDefinitions
  $records = @($State.services | Where-Object { $definitions.ContainsKey([string]$_.name) })
  if ($records.Count -eq 0) { return }
  $payload = Get-VerifiedPackagedServiceWrapper -Version ([string]$State.version)
  $plans = @()
  foreach ($record in $records) {
    $name = [string]$record.name
    if (@($records | Where-Object { $_.name -eq $name }).Count -ne 1) { throw 'Wrapper migration service snapshot is ambiguous.' }
    $definition = $definitions[$name]
    $relative = $definition[0] + '\service-wrapper\' + $definition[1] + '.exe'
    $wrapper = Assert-PlainWrapperMigrationPath -Path (Join-Path $script:RuntimeRoot $relative) -Root $script:RuntimeRoot
    if ([IO.Path]::GetFullPath(([string]$record.pathName).Trim().Trim('"')) -ne $wrapper) { throw "Wrapper migration saved service ownership mismatch for $name." }
    Assert-PreservedWrapperStopped -Name $name -Wrapper $wrapper
    $backupRoot = Join-Path $StageDirectory 'runtime-backup'
    $backup = Assert-PlainWrapperMigrationPath -Path (Join-Path $backupRoot $relative) -Root $backupRoot
    if ([string]$record.wrapperSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or (Get-FileSha256 $backup) -ne [string]$record.wrapperSha256) { throw 'Preserved service wrapper failed original checksum validation.' }
    $currentHash = Get-FileSha256 $wrapper
    if ($currentHash -ne [string]$record.wrapperSha256 -and $currentHash -ne $payload.sha256) { throw 'Runtime service wrapper is not the preserved or new verified binary.' }
    $plans += [pscustomobject]@{ name = $name; path = $wrapper; replace = ($currentHash -ne $payload.sha256) }
  }
  if (-not ($plans | Where-Object { $_.replace })) { return }
  # Persist before the first replacement: watchdog recovery must stop every
  # migrated wrapper before restoring the original runtime backup.
  $State | Add-Member -NotePropertyName wrapperMigrationPending -NotePropertyValue $true -Force
  Write-JsonAtomic -Path (Join-Path $StageDirectory 'state.json') -Value $State
  foreach ($plan in @($plans | Where-Object { $_.replace })) {
    Assert-PreservedWrapperStopped -Name $plan.name -Wrapper $plan.path
    $temporary = Assert-PlainWrapperMigrationPath -Path ($plan.path + '.migration-' + [Guid]::NewGuid().ToString('N')) -Root $script:RuntimeRoot
    try {
      [IO.File]::Copy($payload.path, $temporary, $false)
      if ((Get-Item -LiteralPath $temporary).Length -ne $payload.bytes -or (Get-FileSha256 $temporary) -ne $payload.sha256) { throw 'Staged service wrapper failed checksum readback.' }
      [IO.File]::Replace($temporary, $plan.path, [NullString]::Value)
      if ((Get-FileSha256 $plan.path) -ne $payload.sha256) { throw 'Migrated service wrapper failed checksum readback.' }
    } finally {
      if (Test-Path -LiteralPath $temporary -PathType Leaf) { Remove-Item -LiteralPath $temporary -Force -ErrorAction Stop }
    }
  }
}

function Stop-PreservedWrappersForRecovery {
  param([object]$State)
  if (-not $State.PSObject.Properties['wrapperMigrationPending'] -or $State.wrapperMigrationPending -ne $true) { return }
  $definitions = Get-PreservedWrapperDefinitions
  foreach ($record in @($State.services)) {
    $name = [string]$record.name
    if (-not $definitions.ContainsKey($name)) { continue }
    $definition = $definitions[$name]
    $wrapper = Assert-PlainWrapperMigrationPath -Path (Join-Path $script:RuntimeRoot ($definition[0] + '\service-wrapper\' + $definition[1] + '.exe')) -Root $script:RuntimeRoot
    $registration = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction Stop
    if ($registration -and ([IO.Path]::GetFullPath(([string]$registration.PathName).Trim().Trim('"')) -ne $wrapper -or [IO.Path]::GetFullPath(([string]$record.pathName).Trim().Trim('"')) -ne $wrapper)) { throw "Wrapper rollback service ownership mismatch for $name." }
    Stop-OwnedServiceForInstall -Name $name
  }
}

function Update-PreservedRuntimeReliability {
  param([object]$State)
  $definitions = @{
    EgoistShieldSystemDoH = @('SystemDoH', 'egoistshield-system-doh-service')
    EgoistShieldTelegramProxy = @('TelegramProxy', 'egoistshield-telegram-proxy-service')
    EgoistShieldZapret = @('Zapret', 'egoistshield-zapret-service')
  }
  foreach ($record in @($State.services)) {
    $name = [string]$record.name
    if (-not $definitions.ContainsKey($name)) { continue }
    $service = Get-Service -Name $name -ErrorAction Stop
    if ($service.Status -ne 'Stopped') { throw "Runtime migration requires stopped service $name." }
    $definition = $definitions[$name]
    $componentRoot = Join-Path $script:RuntimeRoot $definition[0]
    $wrapper = Assert-OwnedRuntimeMigrationPath (Join-Path $componentRoot ('service-wrapper\' + $definition[1] + '.exe'))
    if ([IO.Path]::GetFullPath(([string]$record.pathName).Trim().Trim('"')) -ne $wrapper) { throw "Runtime migration service ownership mismatch for $name." }
    $xmlPath = Assert-OwnedRuntimeMigrationPath ([IO.Path]::ChangeExtension($wrapper, '.xml'))
    if ((Get-Item -LiteralPath $xmlPath).Length -gt 65536) { throw 'Runtime wrapper configuration exceeds its migration limit.' }
    $settings = New-Object Xml.XmlReaderSettings
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [Xml.XmlReader]::Create($xmlPath, $settings)
    $document = New-Object Xml.XmlDocument
    $document.XmlResolver = $null
    try { $document.Load($reader) } finally { $reader.Dispose() }
    if ($document.SelectSingleNode('/service/id').InnerText -ne $name) { throw 'Runtime wrapper service id mismatch.' }
    $engine = Assert-OwnedRuntimeMigrationPath $document.SelectSingleNode('/service/executable').InnerText
    if (-not $engine.StartsWith([IO.Path]::GetFullPath($componentRoot) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime engine belongs to a different component.' }
    $log = $document.SelectSingleNode('/service/log')
    if (-not $log -or $log.GetAttribute('mode') -ne 'roll-by-size') { throw 'Runtime wrapper logging mode is unsupported.' }
    $threshold = $log.SelectSingleNode('sizeThreshold')
    $keep = $log.SelectSingleNode('keepFiles')
    if (-not $threshold -or -not $keep) { throw 'Runtime wrapper logging limits are missing.' }
    $threshold.InnerText = '10240'
    $keep.InnerText = '5'
    foreach ($node in @($document.SelectNodes('/service/onfailure'))) { [void]$document.DocumentElement.RemoveChild($node) }
    foreach ($delay in @('5 sec', '10 sec', '60 sec')) {
      $failure = $document.CreateElement('onfailure')
      $failure.SetAttribute('action', 'restart'); $failure.SetAttribute('delay', $delay)
      [void]$document.DocumentElement.AppendChild($failure)
    }
    $reset = $document.SelectSingleNode('/service/resetfailure')
    if (-not $reset) { $reset = $document.CreateElement('resetfailure'); [void]$document.DocumentElement.AppendChild($reset) }
    $reset.InnerText = '1 hour'
    Write-OwnedRuntimeMigrationFile -Path $xmlPath -Content $document.OuterXml
    if ($name -ne 'EgoistShieldSystemDoH') { continue }
    $configPath = Assert-OwnedRuntimeMigrationPath (Join-Path $componentRoot 'config.json')
    if ((Get-Item -LiteralPath $configPath).Length -gt 1048576) { throw 'DNS configuration exceeds its migration limit.' }
    $config = Get-Content -LiteralPath $configPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if (-not $config.dns -or -not $config.inbounds -or -not $config.log) { throw 'DNS configuration does not match the managed Xray format.' }
    foreach ($inbound in @($config.inbounds)) {
      $address = $null
      if (-not [Net.IPAddress]::TryParse([string]$inbound.listen, [ref]$address) -or -not [Net.IPAddress]::IsLoopback($address)) { throw 'DNS configuration contains a non-loopback listener.' }
    }
    if (-not $config.dns.PSObject.Properties['hosts']) { $config.dns | Add-Member -NotePropertyName hosts -NotePropertyValue ([pscustomobject]@{}) }
    $marker = $config.dns.hosts.PSObject.Properties['health.egoist.invalid']
    if ($marker -and (@($marker.Value).Count -ne 1 -or [string]@($marker.Value)[0] -ne '127.0.0.1')) { throw 'DNS health marker conflicts with preserved configuration.' }
    if (-not $marker) { $config.dns.hosts | Add-Member -NotePropertyName 'health.egoist.invalid' -NotePropertyValue '127.0.0.1' }
    if ($config.log.PSObject.Properties['error']) { $config.log.error = '' }
    Write-OwnedRuntimeMigrationFile -Path $configPath -Content ($config | ConvertTo-Json -Depth 64)
    & $engine run -test -config $configPath *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Preserved DNS configuration failed the Xray validation; recovery will restore its backup.' }
  }
}

function Test-OwnedTelegramProxyListener {
  param([string]$ExpectedWrapper, [int]$Port, [string]$HostAddress = '127.0.0.1')
  $address = $null
  if ($Port -lt 1 -or $Port -gt 65535 -or
      -not [Net.IPAddress]::TryParse($HostAddress, [ref]$address) -or
      -not [Net.IPAddress]::IsLoopback($address)) { return $false }
  $service = Get-CimInstance Win32_Service -Filter "Name='EgoistShieldTelegramProxy'" -OperationTimeoutSec 3 -ErrorAction Stop
  if (-not $service -or $service.State -ne 'Running' -or [int]$service.ProcessId -le 0) { return $false }
  $actualWrapper = [IO.Path]::GetFullPath(([string]$service.PathName).Trim().Trim('"'))
  if (-not $actualWrapper.Equals([IO.Path]::GetFullPath($ExpectedWrapper), [StringComparison]::OrdinalIgnoreCase)) { return $false }
  $processes = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,ExecutablePath,CreationDate -OperationTimeoutSec 3 -ErrorAction Stop)
  $root = @($processes | Where-Object { [int]$_.ProcessId -eq [int]$service.ProcessId })
  if ($root.Count -ne 1 -or -not [string]::Equals([string]$root[0].ExecutablePath, $actualWrapper, [StringComparison]::OrdinalIgnoreCase)) { return $false }
  $component = [IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $ExpectedWrapper))).TrimEnd('\') + '\'
  $owned = New-Object 'Collections.Generic.HashSet[int]'
  [void]$owned.Add([int]$service.ProcessId)
  $byPid = @{}
  foreach ($item in $processes) { $byPid[[int]$item.ProcessId] = $item }
  for ($depth = 0; $depth -lt 8; $depth++) {
    $count = $owned.Count
    foreach ($item in $processes) {
      $parent = $byPid[[int]$item.ParentProcessId]
      if ($parent -and $owned.Contains([int]$item.ParentProcessId) -and
          $parent.CreationDate -and $item.CreationDate -and
          [DateTime]$item.CreationDate -ge [DateTime]$parent.CreationDate -and
          ([string]$item.ExecutablePath).StartsWith($component, [StringComparison]::OrdinalIgnoreCase)) {
        [void]$owned.Add([int]$item.ProcessId)
      }
    }
    if ($owned.Count -gt 64) { return $false }
    if ($owned.Count -eq $count) { break }
  }
  $wildcard = if ($address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) { '0.0.0.0' } else { '::' }
  $listeners = @(Get-CimInstance -Namespace 'root/StandardCimv2' -ClassName MSFT_NetTCPConnection `
    -Filter "LocalPort=$Port AND State=2" -OperationTimeoutSec 3 -ErrorAction Stop)
  return @($listeners | Where-Object {
    $owned.Contains([int]$_.OwningProcess) -and
    ([string]$_.LocalAddress -eq $address.ToString() -or [string]$_.LocalAddress -eq $wildcard)
  }).Count -gt 0
}

function Wait-OwnedTelegramProxyReady {
  param([string]$ExpectedWrapper, [int]$Port, [string]$HostAddress = '127.0.0.1', [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $client = $null
    try {
      if (Test-OwnedTelegramProxyListener -ExpectedWrapper $ExpectedWrapper -Port $Port -HostAddress $HostAddress) {
        $client = New-Object Net.Sockets.TcpClient
        $connect = $client.ConnectAsync($HostAddress, $Port)
        if ($connect.Wait(750) -and $client.Connected -and
            (Test-OwnedTelegramProxyListener -ExpectedWrapper $ExpectedWrapper -Port $Port -HostAddress $HostAddress)) { return $true }
      }
    } catch { Write-Verbose 'Telegram readiness ownership could not be confirmed.' }
    finally { if ($client) { $client.Dispose() } }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Start-PreservedServices {
  param([object]$State)
  $runningNames = @($State.services | Where-Object { $_.wasRunning -eq $true -and $_.startMode -ne "Disabled" } | ForEach-Object { [string]$_.name })
  $core = @($State.services | Where-Object { $_.name -eq "EgoistShieldCore" })
  $startCore = $core.Count -eq 0 -or ($core[0].wasRunning -eq $true -and $core[0].startMode -ne "Disabled")
  $startOrder = @("EgoistShieldSystemDoH", "EgoistShieldGravitylessDNS", "EgoistShieldZapret", "EgoistShieldTelegramProxy")
  $startOrder += @($runningNames | Where-Object { $_ -ne "EgoistShieldCore" -and $startOrder -notcontains $_ })
  $startOrder += @("EgoistShieldCore")
  foreach ($name in $startOrder) {
    if ($name -eq "EgoistShieldCore" -and -not $startCore) { continue }
    if ($runningNames -notcontains $name -and $name -ne "EgoistShieldCore") { continue }
    [void](Assert-CurrentPreservedServiceOwnership $name -RequirePresent)
    $service = Get-InstallerServiceState $name
    if (-not $service) {
      throw "Required preserved service $name is missing after reinstall."
    }
    if ([string]$service.ServiceName -ne $name) { throw "Literal preserved service identity mismatch." }
    if ($service.Status -ne "Running") {
      $started = $false
      for ($attempt = 0; $attempt -lt 8; $attempt++) {
        try {
          [void](Assert-CurrentPreservedServiceOwnership $name -RequirePresent)
          Start-Service -Name $name -ErrorAction Stop
          [void](Assert-CurrentPreservedServiceOwnership $name -RequirePresent)
          $service = Get-InstallerServiceState $name
          if (-not $service -or [string]$service.ServiceName -ne $name) { throw "Literal preserved service identity mismatch." }
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
    [void](Assert-CurrentPreservedServiceOwnership $name -RequirePresent)
    if ($name -eq "EgoistShieldSystemDoH" -and @($State.criticalDns).Count -gt 0) {
      if (-not (Test-LoopbackDnsReady -State $State)) { throw "SystemDoH did not recover before network services started." }
      Restore-CriticalAdapterDns -State $State
    }
    if ($name -eq 'EgoistShieldTelegramProxy') {
      $componentRoot = Join-Path $script:RuntimeRoot 'TelegramProxy'
      $config = Get-Content -LiteralPath (Join-Path $componentRoot 'config.json') -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      $wrapper = Join-Path $componentRoot 'service-wrapper\egoistshield-telegram-proxy-service.exe'
      if (-not (Wait-OwnedTelegramProxyReady -ExpectedWrapper $wrapper -Port ([int]$config.port) -HostAddress ([string]$config.host))) {
        throw 'Telegram Proxy did not confirm an owned listener after reinstall; a foreign listener is not readiness.'
      }
    }
  }
}

function Restore-PreservedServiceStartModes {
  param([object]$State)
  Restore-InstallerServiceStartModes @($State.services) { param($path) Test-OwnedServicePath $path }
  if (@($State.services | Where-Object { $_.name -eq "EgoistShieldCore" }).Count -eq 0) {
    # A missing old registration was created by NSIS, then stopped for the
    # migration. It has no previous startup mode to restore.
    Set-InstallerServiceStartMode "EgoistShieldCore" "Auto" $false { param($path) Test-OwnedServicePath $path }
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
  param([object]$State)
  $exe = Join-Path $script:OwnedInstallRoot "EgoistShield.exe"
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Installed desktop executable is missing." }
  $minimized = $State -and $State.PSObject.Properties.Name -contains 'minimizedAfter' -and $State.minimizedAfter -eq $true
  if ($minimized) {
    Start-Process -FilePath $exe -ArgumentList '--minimized' -WorkingDirectory $script:OwnedInstallRoot -WindowStyle Hidden | Out-Null
  } else {
    Start-Process -FilePath $exe -WorkingDirectory $script:OwnedInstallRoot | Out-Null
  }
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $running = @(Get-CimInstance Win32_Process -Filter "Name='EgoistShield.exe'" -ErrorAction SilentlyContinue |
      Where-Object { [string]$_.ExecutablePath -eq $exe -and [string]$_.CommandLine -notmatch '--type=|component-worker\.cjs' })
    if ($running.Count -gt 0) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Installed Shield desktop did not start after reinstall."
}

function Restore-CriticalOwnedDnsBaseline {
  param([object]$State)
  if (@($State.criticalDns).Count -eq 0) { return }
  $backup = Join-Path $StageDirectory 'dns-owned-state.json'
  $metadata = Get-Content -LiteralPath $backup -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ($metadata.schemaVersion -ne 1 -or $metadata.owner -ne 'EgoistShield') { throw 'Protected DNS ownership state is invalid.' }
  $adapters = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop)
  foreach ($record in @($State.criticalDns)) {
    $guid = [Guid]$record.interfaceGuid
    $matchingAdapters = @($adapters | Where-Object { [Guid]$_.InterfaceGuid -eq $guid })
    $saved = @($metadata.originalAdapters | Where-Object { [Guid]$_.interfaceGuid -eq $guid })
    if ($matchingAdapters.Count -ne 1 -or $saved.Count -ne 1) { throw 'Protected DNS adapter or baseline is unavailable.' }
    $owned = @($metadata.servers)
    if ($metadata.PSObject.Properties['adapterServers']) {
      foreach ($entry in $metadata.adapterServers.PSObject.Properties) {
        if ([Guid]$entry.Name -eq $guid) { $owned = @($entry.Value); break }
      }
    }
    foreach ($address in @($record.servers)) {
      if ($owned -notcontains [string]$address) { throw 'Critical DNS snapshot contains an unowned resolver.' }
    }
    $index = [int]$matchingAdapters[0].ifIndex
    $rows = @(Get-DnsClientServerAddress -InterfaceIndex $index -ErrorAction Stop)
    $current = @($rows | ForEach-Object { @($_.ServerAddresses) } | Where-Object { $_ })
    if (($current -join '|') -ne (@($record.servers) -join '|')) { throw 'DNS changed after the protected snapshot; baseline recovery was skipped.' }
    foreach ($family in @(@{code=2;addresses='ipv4';isStatic='ipv4Static'}, @{code=23;addresses='ipv6';isStatic='ipv6Static'})) {
      $row = @($rows | Where-Object { [int]$_.AddressFamily -eq $family.code })
      if ($row.Count -ne 1 -or @($row[0].ServerAddresses).Count -eq 0) { continue }
      $original = @($saved[0].($family.addresses) | Where-Object { $_ })
      if ([bool]$saved[0].($family.isStatic)) {
        if ($original.Count -eq 0) { throw 'Static DNS baseline has no addresses.' }
        foreach ($address in $original) {
          $ip = $null
          if (-not [Net.IPAddress]::TryParse([string]$address, [ref]$ip) -or [Net.IPAddress]::IsLoopback($ip)) { throw 'DNS baseline has no independent usable resolver.' }
        }
        $row[0] | Set-DnsClientServerAddress -ServerAddresses $original -ErrorAction Stop
        $actual = @((Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily $family.code -ErrorAction Stop).ServerAddresses)
        if (($actual -join '|') -ne ($original -join '|')) { throw 'Static DNS baseline readback failed.' }
      } else {
        $row[0] | Set-DnsClientServerAddress -ResetServerAddresses -ErrorAction Stop
      }
    }
  }
  Clear-DnsClientCache -ErrorAction Stop
}

function Test-PayloadRollbackPending {
  $marker = Join-Path (Split-Path -Parent $script:RuntimeRoot) 'installer\pending-upgrade-quarantine.txt'
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { return $false }
  try {
    $value = [IO.File]::ReadAllText($marker).Trim()
    return -not $value.StartsWith('COMMITTED|', [StringComparison]::Ordinal)
  } catch { return $true }
}

function Invoke-Recovery {
  param([object]$State, [string]$Reason)
  $recoveryLease = Enter-DeferredReinstallRecoveryLease
  try {
  $maintenanceStatus = Get-InstallerServiceMaintenanceStatus
  if ($maintenanceStatus -eq 'foreign') { throw "Another service maintenance stage is active; preserved state was not replayed." }
  if ($State.PSObject.Properties['handoffStarted'] -and $State.handoffStarted -ne $true -and
      $maintenanceStatus -eq 'absent') {
    Add-ReceiptEvent -Stage 'recovery' -Status 'recovery-not-needed' -Message 'Update failed before service handoff; no services or DNS were stopped.'
    return $true
  }
  if ($State.PSObject.Properties['handoffStarted'] -and $State.handoffStarted -eq $true -and
      $maintenanceStatus -eq 'absent') {
    Add-ReceiptEvent -Stage 'recovery' -Status 'recovery-not-needed' -Message 'The service maintenance transaction is already closed; its preserved snapshot must not be replayed.'
    return $true
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
    return $false
  } else {
    Complete-InstallerServiceMaintenance
    Add-ReceiptEvent -Stage "recovery" -Status "recovered" -Message "Previously active services and DNS were restored."
    return $true
  }
  } finally {
    $recoveryLease.ReleaseMutex()
    $recoveryLease.Dispose()
  }
}

function Stop-VerifiedInstallerTransactionProcess {
  param([int]$ProcessId, [int64]$StartTicks, [string]$Executable)
  if ($ProcessId -le 0 -or $StartTicks -le 0 -or -not $Executable) { return $false }
  if ($ProcessId -eq $PID) { throw "Refusing to terminate the recovery process itself." }
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $process) { return $true }
  try {
    # Cache the handle before checking identity. Kill/Wait then use this same
    # process object rather than reopening a PID that Windows may have reused.
    $heldHandle = $process.Handle
    if ($null -eq $heldHandle -or $heldHandle -eq [IntPtr]::Zero) { throw "Installer process handle is unavailable." }
    if ([int64]$process.StartTime.Ticks -ne $StartTicks) { return $true }
    if (-not [string]::Equals([string]$process.Path, $Executable, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Installer process executable identity changed; termination was refused."
    }
    if (-not $process.HasExited) { $process.Kill() }
    if (-not $process.WaitForExit(5000)) { throw "Verified installer process did not stop within its limit." }
    return $true
  } finally { $process.Dispose() }
}

function Assert-InstallerNotCancelled {
  if (Test-Path -LiteralPath (Join-Path $StageDirectory "cancel.flag") -PathType Leaf) {
    throw "Protected reinstall was cancelled after its watchdog deadline."
  }
}

function Test-InstallerTransactionComplete {
  return (Test-Path -LiteralPath (Join-Path $StageDirectory "complete.flag") -PathType Leaf) -and
    (Get-InstallerServiceMaintenanceStatus) -eq 'absent'
}

function Write-PendingInstallerRecovery {
  param([string]$Reason, [int]$Attempts)
  Write-JsonAtomic -Path (Join-Path $StageDirectory "recovery-pending.json") -Value @{
    schemaVersion = 1; owner = "EgoistShield"; stage = $StageDirectory
    at = [DateTime]::UtcNow.ToString("o"); attempts = $Attempts; reason = $Reason
  }
  Add-ReceiptEvent -Stage "recovery" -Status "recovery-warning" -Message $Reason
}

function Invoke-InstallerRecoveryAttempts {
  param([object]$State, [string]$Reason, [ValidateRange(1, 12)][int]$Attempts = 6,
    [ValidateRange(0, 60)][int]$RetrySeconds = 10)
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      $recovered = Invoke-Recovery -State $State -Reason $Reason
      if ($recovered -eq $true -and -not (Test-InstallerServiceMaintenanceOwner)) {
        $pendingPath = Join-Path $StageDirectory "recovery-pending.json"
        if (Test-Path -LiteralPath $pendingPath -PathType Leaf) { Remove-Item -LiteralPath $pendingPath -Force -ErrorAction Stop }
        return $true
      }
    } catch {
      Write-PendingInstallerRecovery -Reason ("Recovery attempt ${attempt}: " + $_.Exception.Message) -Attempts $attempt
    }
    if ($attempt -lt $Attempts) { Start-Sleep -Seconds $RetrySeconds }
  }
  Write-PendingInstallerRecovery -Reason "Bounded recovery attempts were exhausted; the protected snapshot and recovery registration were retained." -Attempts $Attempts
  return $false
}

function Invoke-WatchdogMode {
  if (Test-InstallerTransactionComplete) { return $true }
  [void](Assert-InstallerMaintenanceBootRecovery -StageDirectory $StageDirectory)
  $deadlinePath = Join-Path $StageDirectory "watchdog-deadline.txt"
  $deadline = [DateTime]::Parse((Get-Content -LiteralPath $deadlinePath -Raw), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-InstallerTransactionComplete) { return $true }
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
  if (Test-InstallerTransactionComplete) { return $true }
  $state = Get-ValidatedMaintenanceRecoveryState -Stage $StageDirectory
  $heartbeatPath = Join-Path $StageDirectory "heartbeat.json"
  Set-Content -LiteralPath (Join-Path $StageDirectory "cancel.flag") -Value "watchdog-deadline" -Encoding ASCII -Force -ErrorAction Stop
  # Give a responsive worker time to leave its mutation loop and recover while
  # it still owns the lease. Escalation is limited to recorded exact identities.
  for ($grace = 0; $grace -lt 5; $grace++) {
    if (Test-InstallerTransactionComplete) { return $true }
    if (-not (Test-Path -LiteralPath $heartbeatPath -PathType Leaf)) { break }
    $heartbeat = Get-Content -LiteralPath $heartbeatPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $workerProcess = Get-Process -Id ([int]$heartbeat.workerPid) -ErrorAction SilentlyContinue
    try {
      if (-not $workerProcess -or [int64]$workerProcess.StartTime.Ticks -ne [int64]$heartbeat.workerStartTicks) { break }
    } finally { if ($workerProcess) { $workerProcess.Dispose() } }
    Start-Sleep -Seconds 2
  }
  try {
    if (Test-Path -LiteralPath $heartbeatPath -PathType Leaf) {
      $heartbeat = Get-Content -LiteralPath $heartbeatPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      if ($heartbeat.owner -ne "EgoistShield") { throw "Unverified installer heartbeat owner." }
      if ([int]$heartbeat.installerPid -gt 0 -and
          -not (Stop-VerifiedInstallerTransactionProcess -ProcessId ([int]$heartbeat.installerPid) -StartTicks ([int64]$heartbeat.installerStartTicks) -Executable ([string]$state.installer))) {
        throw "Installer process identity is incomplete; recovery remains pending."
      }
      $workerExecutable = [IO.Path]::GetFullPath((Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"))
      if (-not $heartbeat.PSObject.Properties['workerExecutable'] -or
          -not [string]::Equals([string]$heartbeat.workerExecutable, $workerExecutable, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unverified worker executable; recovery remains pending."
      }
      if (-not (Stop-VerifiedInstallerTransactionProcess -ProcessId ([int]$heartbeat.workerPid) -StartTicks ([int64]$heartbeat.workerStartTicks) -Executable $workerExecutable)) {
        throw "Worker process identity is incomplete; recovery remains pending."
      }
    }
  } catch {
    Write-PendingInstallerRecovery -Reason $_.Exception.Message -Attempts 0
    return $false
  }
  $state.runAfter = $false
  $completionLease = $null
  for ($attempt = 0; $attempt -lt 6; $attempt++) {
    try { $completionLease = Enter-DeferredReinstallRecoveryLease; break }
    catch {
      if ($attempt -eq 5) { Write-PendingInstallerRecovery -Reason $_.Exception.Message -Attempts 6; return $false }
      Start-Sleep -Seconds 10
    }
  }
  try {
    if (Test-InstallerTransactionComplete) { return $true }
    $recovered = Invoke-InstallerRecoveryAttempts -State $state -Reason "Watchdog recovered an interrupted or timed-out silent reinstall."
    Write-DesktopUpdateResult -State $state -Ok $false -Message "Обновление прервалось. Результат восстановления служб и DNS сохранён в журнале установки."
    if ($recovered -eq $true) {
      [void](Unregister-InstallerMaintenanceBootRecovery -StageDirectory $StageDirectory -RestorationVerified:$true)
      Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "watchdog-recovered" -Encoding ASCII -Force
    }
    return $recovered
  } finally {
    $completionLease.ReleaseMutex()
    $completionLease.Dispose()
  }
}

function Invoke-WorkerMode {
  if (-not (Test-IsAdministrator)) { throw "Deferred reinstall worker requires an elevated administrator token." }
  Assert-SupportedServiceFramework
  $statePath = Join-Path $StageDirectory "state.json"
  $state = Get-Content -LiteralPath $statePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  $release = Get-ValidatedRelease -Installer ([string]$state.installer) -Manifest ([string]$state.manifest) -Version ([string]$state.version) -Sha256 ([string]$state.sha256) -AllowStagedPair
  $mutex = New-Object Threading.Mutex($false, "Global\EgoistShield.DeferredReinstall")
  try { $acquired = $mutex.WaitOne(0) }
  catch [Threading.AbandonedMutexException] { $acquired = $true }
  if (-not $acquired) {
    Add-ReceiptEvent -Stage "worker" -Status "failed" -Message "Another protected Egoist Shield reinstall is already running."
    Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "dispatch-failed" -Encoding ASCII -Force
    $mutex.Dispose()
    throw "Another deferred Egoist Shield reinstall is already running."
  }
  try {
    Add-ReceiptEvent -Stage "worker" -Status "waiting" -Message "Validated elevated worker is waiting before the final handoff."
    Start-Sleep -Seconds ([int]$state.delaySeconds)
    Assert-InstallerNotCancelled
    Resume-InterruptedServiceMaintenance
    $state.handoffStarted = $false
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
    Protect-InstallerStageTree -Stage $StageDirectory
    [void](Register-InstallerMaintenanceBootRecovery -StageDirectory $StageDirectory)
    $powerShell = Get-NativePowerShellPath
    $watchdogArguments = @("-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", (Join-Path $StageDirectory "invoke-final-silent-reinstall.ps1"), "-Watchdog", "-StageDirectory", $StageDirectory)
    $watchdogCommandLine = ($watchdogArguments | ForEach-Object { ConvertTo-InstallerWindowsArgument ([string]$_) }) -join ' '
    Start-Process -FilePath $powerShell -ArgumentList $watchdogCommandLine -WindowStyle Hidden | Out-Null

    Assert-InstallerNotCancelled
    Enter-InstallerServiceMaintenance
    $state.handoffStarted = $true
    Write-JsonAtomic -Path $statePath -Value $state
    Stop-OwnedProcesses
    Assert-InstallerNotCancelled
    Suspend-InstallerServiceRestarts -Records @($state.services) -SnapshotPath $statePath -OwnPath {
      param($path) Test-OwnedServicePath $path
    } -StopCore { param($name) Stop-OwnedServiceForInstall -Name $name }
    foreach ($name in @($state.services | Where-Object { $_.name -notin @("EgoistShieldCore", "EgoistShieldSystemDoH") } | ForEach-Object { $_.name })) {
      Assert-InstallerNotCancelled
      Stop-OwnedServiceForInstall -Name $name
    }
    # SystemDoH is deliberately the last owned service stopped. Once this
    # succeeds, Windows may temporarily have only a silent loopback DNS entry.
    Stop-OwnedServiceForInstall -Name "EgoistShieldSystemDoH"
    Assert-InstallerNotCancelled
    Add-ReceiptEvent -Stage "handoff" -Status "dns-stopped" -Message "SystemDoH was stopped last; silent installation is starting."
    Set-Content -LiteralPath (Join-Path $StageDirectory "backup-ready.flag") -Value "ready" -Encoding ASCII -Force

    $previousProtectedStage = $env:EGOIST_PROTECTED_REINSTALL_STAGE
    try {
      $env:EGOIST_PROTECTED_REINSTALL_STAGE = $StageDirectory
      $installerProcess = Start-Process -FilePath $release.installer -ArgumentList @("/S") -PassThru -WindowStyle Hidden
    } finally {
      $env:EGOIST_PROTECTED_REINSTALL_STAGE = $previousProtectedStage
    }
    while (-not $installerProcess.HasExited) {
      Write-Heartbeat -Stage $StageDirectory -Phase "installer-running" -InstallerPid $installerProcess.Id
      Assert-InstallerNotCancelled
      Start-Sleep -Seconds 2
      $installerProcess.Refresh()
    }
    $exitCode = $installerProcess.ExitCode
    Add-ReceiptEvent -Stage "installer" -Status "installer-exited" -Message "Silent installer exited." -Data @{ exitCode = $exitCode }
    if ($exitCode -ne 0) { throw "Silent installer failed with exit code $exitCode." }

    Write-Heartbeat -Stage $StageDirectory -Phase "restoring"
    Assert-InstallerNotCancelled
    Stop-OwnedServiceForInstall -Name "EgoistShieldCore"
    Restore-PreservedState -State $state
    Update-PreservedRuntimeReliability -State $state
    Update-PreservedServiceWrappers -State $state
    Reconcile-PreservedZapretProfile -State $state
    Restore-InstalledIdentity -State $state
    Restore-PreservedServiceStartModes -State $state
    Start-PreservedServices -State $state
    $installedExe = Join-Path $script:OwnedInstallRoot "EgoistShield.exe"
    if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) { throw "Installed EgoistShield.exe is missing." }
    $installedVersion = [string](Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion
    if ($installedVersion -notlike "$($state.version)*") { throw "Installed version is $installedVersion, expected $($state.version)." }
    if (-not (Test-LoopbackDnsReady -State $state)) { throw "SystemDoH did not answer through 127.0.0.1 after reinstall." }
    Restore-CriticalAdapterDns -State $state
    if (-not (Test-LoopbackDnsReady -State $state)) { throw "Restored adapter DNS did not pass readback." }
    Complete-InstallerServiceMaintenance
    [void](Unregister-InstallerMaintenanceBootRecovery -StageDirectory $StageDirectory -RestorationVerified:$true)
    if ($state.runAfter -ne $false) { Start-InstalledDesktop -State $state }
    Add-ReceiptEvent -Stage "verify" -Status "succeeded" -Message "Installer, version, Core, preserved services and DNS passed readback." -Data @{ installedVersion = $installedVersion }
    Write-DesktopUpdateResult -State $state -Ok $true -Message "Обновление до $installedVersion установлено; службы и DNS проверены."
    Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "success" -Encoding ASCII -Force
  } catch {
    $recoveryComplete = $false
    try {
      if (Get-Variable -Name installerProcess -Scope Local -ErrorAction SilentlyContinue) {
        if ($installerProcess -and -not $installerProcess.HasExited) {
          if (-not (Stop-VerifiedInstallerTransactionProcess -ProcessId $installerProcess.Id -StartTicks ([int64]$installerProcess.StartTime.Ticks) -Executable ([string]$release.installer))) {
            throw "Silent installer could not be stopped before recovery."
          }
        }
      }
      $state = Get-Content -LiteralPath $statePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      if ($state.handoffStarted -eq $true -or (Test-InstallerServiceMaintenanceOwner)) {
        $recoveryComplete = Invoke-InstallerRecoveryAttempts -State $state -Reason $_.Exception.Message -Attempts 2 -RetrySeconds 2
      } else {
        $recoveryComplete = $true
      }
      Write-DesktopUpdateResult -State $state -Ok $false -Message "Обновление не завершилось. Результат восстановления служб и DNS сохранён в журнале установки."
    } catch {
      Add-ReceiptEvent -Stage "fatal" -Status "failed" -Message $_.Exception.Message
    }
    if ($recoveryComplete -eq $true -and -not (Test-InstallerServiceMaintenanceOwner)) {
      [void](Unregister-InstallerMaintenanceBootRecovery -StageDirectory $StageDirectory -RestorationVerified:$true)
      Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "failed-recovered" -Encoding ASCII -Force
    } else {
      Write-PendingInstallerRecovery -Reason "Worker stopped before verified recovery; watchdog/boot recovery must retry." -Attempts 2
    }
    throw
  } finally {
    try { $mutex.ReleaseMutex() } catch { Write-Verbose "Deferred reinstall mutex was not owned: $($_.Exception.Message)" }
    $mutex.Dispose()
  }
}

if ($Recover) {
  if (-not (Test-IsAdministrator)) { throw "Boot recovery requires a privileged service token." }
  $StageDirectory = Resolve-FullPath -Path $StageDirectory -MustExist
  if ((Invoke-WatchdogMode) -ne $true) { exit 1 }
  exit 0
}

if ($Watchdog) {
  $StageDirectory = Resolve-FullPath -Path $StageDirectory -MustExist
  if ((Invoke-WatchdogMode) -ne $true) { exit 1 }
  exit 0
}

if ($Worker) {
  $StageDirectory = Resolve-FullPath -Path $StageDirectory -MustExist
  try {
    Invoke-WorkerMode
  } catch {
    if (-not (Test-Path -LiteralPath (Join-Path $StageDirectory "complete.flag")) -and -not (Test-InstallerServiceMaintenanceOwner)) {
      try {
        Add-ReceiptEvent -Stage "worker" -Status "failed" -Message "Protected reinstall worker stopped before completion."
      } catch {
        Write-Warning "Worker receipt could not be recorded: $($_.Exception.Message)"
        Write-BrandedInstallerStatus -Stage "worker" -Status "failed" -Message "Protected reinstall worker stopped before completion."
      }
      try {
        Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "worker-failed" -Encoding ASCII -Force
      } catch { Write-Warning "Worker failure could not be recorded: $($_.Exception.Message)" }
    }
    throw
  }
  exit 0
}

if ($InstallerUiDirectory) {
  if ($InstallerUiPath -or $InstallerFontPath -or $HandoffSignalPath -or $RunAfterPath) { throw 'Use either the branded UI directory or individual handoff paths.' }
  $InstallerUiDirectory = Resolve-FullPath -Path $InstallerUiDirectory -MustExist
  $InstallerUiPath = Join-Path $InstallerUiDirectory 'ModernInstaller.exe'
  $InstallerFontPath = Join-Path $InstallerUiDirectory 'Unbounded.ttf'
  $HandoffSignalPath = Join-Path $InstallerUiDirectory 'handoff-started.flag'
  $RunAfterPath = Join-Path $InstallerUiDirectory 'run_after.txt'
}

if ($EmbeddedRelease) {
  if ($IntegrityManifestPath -or $ExpectedSha256) { throw "Embedded release dispatch must not accept an external manifest or checksum." }
  $release = Get-ValidatedEmbeddedRelease -Installer $InstallerPath -Version $ExpectedVersion
} else {
  if (-not $IntegrityManifestPath -or -not $ExpectedSha256) { throw "IntegrityManifestPath and ExpectedSha256 are required for release dispatch." }
  $release = Get-ValidatedRelease -Installer $InstallerPath -Manifest $IntegrityManifestPath -Version $ExpectedVersion -Sha256 $ExpectedSha256
}
Assert-SupportedServiceFramework
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
if ($NoRunAfter) { $runAfter = $false }

if ([string]::IsNullOrWhiteSpace($ReceiptRoot)) { $ReceiptRoot = Join-Path (Get-InstallerCommonDataRoot) "EgoistShieldInstaller\DeferredRuns" }
$receiptBase = Resolve-FullPath -Path $ReceiptRoot
$canonicalReceiptBase = Resolve-FullPath -Path (Join-Path (Get-InstallerCommonDataRoot) "EgoistShieldInstaller\DeferredRuns")
if (-not [string]::Equals($receiptBase, $canonicalReceiptBase, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Protected recovery requires the canonical installer receipt directory."
}
if (-not (Test-IsAdministrator)) {
  $dispatchArguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', $PSCommandPath, '-InstallerPath', $release.installer, '-ExpectedVersion', $ExpectedVersion,
    '-DelaySeconds', [string]$DelaySeconds, '-WatchdogTimeoutSeconds', [string]$WatchdogTimeoutSeconds)
  if ($EmbeddedRelease) { $dispatchArguments += '-EmbeddedRelease' }
  else { $dispatchArguments += @('-IntegrityManifestPath', $IntegrityManifestPath, '-ExpectedSha256', $ExpectedSha256) }
  $dispatchPathPairs = @(,@('FromVersion', $FromVersion))
  if ($InstallerUiDirectory) { $dispatchPathPairs += ,@('InstallerUiDirectory', $InstallerUiDirectory) }
  else { $dispatchPathPairs += @(@('InstallerUiPath', $InstallerUiPath), @('InstallerFontPath', $InstallerFontPath), @('HandoffSignalPath', $HandoffSignalPath), @('RunAfterPath', $RunAfterPath)) }
  foreach ($pair in $dispatchPathPairs) {
    if ([string]$pair[1]) { $dispatchArguments += @('-' + $pair[0], [string]$pair[1]) }
  }
  if ($NoRunAfter) { $dispatchArguments += '-NoRunAfter' }
  if ($MinimizedAfter) { $dispatchArguments += '-MinimizedAfter' }
  $dispatchCommandLine = ($dispatchArguments | ForEach-Object { ConvertTo-InstallerWindowsArgument ([string]$_) }) -join ' '
  Start-Process -FilePath (Get-NativePowerShellPath) -ArgumentList $dispatchCommandLine -Verb RunAs -WindowStyle Hidden -ErrorAction Stop | Out-Null
  [pscustomobject]@{ dispatched = $true; elevatedPreparationPending = $true; version = $release.version } | ConvertTo-Json
  exit 0
}
$installerStageRoot = Split-Path -Parent $receiptBase
[void](Assert-PlainWrapperMigrationPath -Path $installerStageRoot -Root (Get-InstallerCommonDataRoot))
New-Item -ItemType Directory -Path $installerStageRoot -Force -ErrorAction Stop | Out-Null
Protect-StageDirectory -Path $installerStageRoot
[void](Assert-PlainWrapperMigrationPath -Path $receiptBase -Root $installerStageRoot)
New-Item -ItemType Directory -Path $receiptBase -Force -ErrorAction Stop | Out-Null
Protect-StageDirectory -Path $receiptBase
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
Copy-Item -LiteralPath $script:ServiceMaintenanceScript -Destination (Join-Path $StageDirectory "service-maintenance.ps1") -Force -ErrorAction Stop
Copy-Item -LiteralPath $script:BootRecoveryScript -Destination (Join-Path $StageDirectory "maintenance-boot-recovery.ps1") -Force -ErrorAction Stop
if ($brandedUi) {
  Copy-Item -LiteralPath $InstallerUiPath -Destination (Join-Path $StageDirectory "ModernInstaller.exe") -Force -ErrorAction Stop
  Copy-Item -LiteralPath $InstallerFontPath -Destination (Join-Path $StageDirectory "Unbounded.ttf") -Force -ErrorAction Stop
  if ($RunAfterPath) { Copy-Item -LiteralPath $RunAfterPath -Destination (Join-Path $StageDirectory "run_after.txt") -Force -ErrorAction Stop }
}
foreach ($stagedFile in @(Get-ChildItem -LiteralPath $StageDirectory -File -ErrorAction Stop)) {
  Protect-InstallerStageFile -Path $stagedFile.FullName
}
if ((Get-FileSha256 $stagedInstaller) -ne $release.sha256) { throw "Staged installer failed SHA-256 readback." }
$state = [ordered]@{
  schemaVersion = 1
  owner = "EgoistShield"
  receiptBase = $receiptBase
  installer = $stagedInstaller
  manifest = $stagedManifest
  sourceInstaller = $release.installer
  version = $release.version
  sha256 = $release.sha256
  bytes = $release.bytes
  delaySeconds = $DelaySeconds
  runAfter = $runAfter
  minimizedAfter = [bool]$MinimizedAfter
  fromVersion = $FromVersion
  watchdogTimeoutSeconds = $WatchdogTimeoutSeconds
  services = @()
  userState = @()
  criticalDns = @()
  installationId = ""
  zapretProfile = ""
  wrapperMigrationPending = $false
  handoffStarted = $false
}
Write-JsonAtomic -Path (Join-Path $StageDirectory "state.json") -Value $state
Add-ReceiptEvent -Stage "dispatch" -Status "dispatched" -Message "Installer was validated and staged; elevated worker will perform the final handoff." -Data @{ version = $release.version; sha256 = $release.sha256 }
$powerShell = Get-NativePowerShellPath
$workerArguments = @("-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $stagedScript, "-Worker", "-StageDirectory", $StageDirectory)
$workerCommandLine = ($workerArguments | ForEach-Object { ConvertTo-InstallerWindowsArgument ([string]$_) }) -join ' '
try {
  if ($brandedUi) {
    $uiCommandLine = (@($StageDirectory, '--monitor') | ForEach-Object { ConvertTo-InstallerWindowsArgument ([string]$_) }) -join ' '
    $uiProcess = Start-Process -FilePath (Join-Path $StageDirectory "ModernInstaller.exe") -ArgumentList $uiCommandLine -PassThru
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
    Start-Process -FilePath $powerShell -ArgumentList $workerCommandLine -WindowStyle Hidden | Out-Null
  } else {
    Start-Process -FilePath $powerShell -ArgumentList $workerCommandLine -Verb RunAs -WindowStyle Hidden | Out-Null
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
