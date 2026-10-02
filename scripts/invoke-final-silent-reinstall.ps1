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
  [switch]$WaitForPreviousReinstall,
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
  [Parameter(ParameterSetName = "ProbePayloadContinuity", Mandatory = $true)]
  [switch]$ProbePayloadContinuity,
  [Parameter(ParameterSetName = "Worker", Mandatory = $true)]
  [Parameter(ParameterSetName = "Watchdog", Mandatory = $true)]
  [Parameter(ParameterSetName = "Recover", Mandatory = $true)]
  [Parameter(ParameterSetName = "ProbePayloadContinuity", Mandatory = $true)]
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

$script:GuiLoginStartupScript = Join-Path $PSScriptRoot "gui-login-startup.ps1"
if (-not (Test-Path -LiteralPath $script:GuiLoginStartupScript -PathType Leaf)) {
  $script:GuiLoginStartupScript = Join-Path $PSScriptRoot "..\src\installer\gui-login-startup.ps1"
}
. $script:GuiLoginStartupScript
foreach ($name in @('Suspend-OwnedGuiLoginStartup','Resume-OwnedGuiLoginStartup','Remove-OwnedGuiLoginStartup')) {
  if (-not (Get-Command -Name $name -CommandType Function -ErrorAction SilentlyContinue)) { throw "Required GUI login startup helper is incomplete: $name" }
}

function Get-InstallerCommonDataRoot { return [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData) }
$nativeProgramFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
$script:OwnedInstallRoot = [IO.Path]::GetFullPath("$nativeProgramFiles\EgoistShield").TrimEnd('\')
$script:OwnedDataRoot = [IO.Path]::GetFullPath((Join-Path (Get-InstallerCommonDataRoot) 'EgoistShield')).TrimEnd('\')
$script:RuntimeRoot = Join-Path $script:OwnedDataRoot "Runtime"
$script:OptionalServiceNames = @(
  "EgoistShieldSystemDoH",
  "EgoistShieldGravitylessDNS",
  "EgoistShieldZapret",
  "EgoistShieldTelegramProxy",
  "EgoistShieldVpn"
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

function Wait-InstallerElevatedPreparation {
  param(
    [Parameter(Mandatory = $true)][ValidateNotNull()][Diagnostics.Process]$Process,
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 300
  )
  # Wait on this held preparation process, not the subsequently dispatched worker tree.
  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    throw "Elevated installer preparation exceeded its readiness deadline."
  }
  $Process.Refresh()
  return $Process.ExitCode
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
    EgoistShieldVpn = @('Vpn', 'egoistshield-vpn-service')
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
    "dns-preserved" { "38|DNS работает. Устанавливаем новую версию..." }
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

function Resolve-ManifestInstallerPath {
  param([string]$Manifest, [string]$RelativePath, [string]$ExpectedName)
  if ([string]::IsNullOrWhiteSpace($RelativePath) -or $RelativePath.Length -gt 512 -or [IO.Path]::IsPathRooted($RelativePath)) {
    throw 'Integrity manifest installer path must be a bounded relative release path.'
  }
  $parts = @($RelativePath -split '[\\/]')
  if ($parts.Count -lt 2 -or $parts.Count -gt 10 -or $parts[0] -cnotin @('dist', 'updates') -or
      ($parts[0] -ceq 'updates' -and $parts.Count -ne 2) -or $parts[-1] -cne $ExpectedName) {
    throw 'Integrity manifest installer path has an unexpected distribution or filename.'
  }
  foreach ($part in $parts) {
    if ($part -in @('.', '..') -or $part -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$') {
      throw 'Integrity manifest installer path contains an unsafe segment.'
    }
  }
  $projectRoot = Split-Path -Parent $Manifest
  for ($index = 1; $index -lt $parts.Count; $index++) {
    $projectRoot = Split-Path -Parent $projectRoot
    if (-not $projectRoot) { throw 'Integrity manifest distribution path has no project root.' }
  }
  return Resolve-FullPath -Path (Join-Path $projectRoot ($parts -join [IO.Path]::DirectorySeparatorChar))
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
  $manifestInstaller = Resolve-ManifestInstallerPath -Manifest $manifestFull -RelativePath ([string]$manifestObject.installer.path) -ExpectedName $expectedName
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

function Get-InstallerSystemServiceSid {
  param([string]$Account)
  if ($Account -in @('LocalSystem', 'NT AUTHORITY\SYSTEM', 'S-1-5-18')) { return 'S-1-5-18' }
  try { return ([Security.Principal.NTAccount]::new($Account).Translate([Security.Principal.SecurityIdentifier])).Value }
  catch { return '' }
}

function Repair-LegacyCoreServiceRegistration {
  $name = 'EgoistShieldCore'
  $expected = Join-Path $script:OwnedInstallRoot 'resources\core-service\win-x64\EgoistShield.Service.exe'
  $quoted = '"' + $expected + '"'
  $services = @(Get-CimInstance Win32_Service -Filter "Name='EgoistShieldCore'" -ErrorAction Stop -OperationTimeoutSec 3 | Where-Object { $_.Name -ceq $name })
  if ($services.Count -eq 0) { return }
  if ($services.Count -ne 1) { throw 'Legacy Core registration is ambiguous.' }
  if (-not [string]::Equals([string]$services[0].PathName, $expected, [StringComparison]::OrdinalIgnoreCase)) { return }
  if ((Get-InstallerSystemServiceSid ([string]$services[0].StartName)) -cne 'S-1-5-18') { throw 'Legacy Core service account is not LocalSystem.' }
  $registration = Get-PreservedServiceRegistrationMetadata $name
  $policy = Get-InstallerServicePolicy $name
  if ([int]$registration.type -ne 16 -or (Get-InstallerSystemServiceSid ([string]$registration.account)) -cne 'S-1-5-18' -or
      -not [string]::Equals([string]$registration.binPath, $expected, [StringComparison]::OrdinalIgnoreCase) -or
      -not $policy -or -not [string]::Equals([string]$policy.pathName, $expected, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Legacy Core registration proof does not match the exact own-process System binary.'
  }
  if (-not (Test-Path -LiteralPath $expected -PathType Leaf)) { throw 'Legacy Core registration binary is missing.' }
  Assert-GuiStartupProtectedPath -Path $expected -Root $script:OwnedInstallRoot
  $binaryLease = [IO.File]::Open($expected, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $fresh = @(Get-CimInstance Win32_Service -Filter "Name='EgoistShieldCore'" -ErrorAction Stop -OperationTimeoutSec 3 | Where-Object { $_.Name -ceq $name })
    $freshRegistration = Get-PreservedServiceRegistrationMetadata $name
    $freshPolicy = Get-InstallerServicePolicy $name
    if ($fresh.Count -ne 1 -or (Get-InstallerSystemServiceSid ([string]$fresh[0].StartName)) -cne 'S-1-5-18' -or
        [int]$freshRegistration.type -ne 16 -or (Get-InstallerSystemServiceSid ([string]$freshRegistration.account)) -cne 'S-1-5-18' -or
        -not [string]::Equals([string]$fresh[0].PathName, $expected, [StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals([string]$freshRegistration.binPath, $expected, [StringComparison]::OrdinalIgnoreCase) -or
        -not $freshPolicy -or -not [string]::Equals([string]$freshPolicy.pathName, $expected, [StringComparison]::OrdinalIgnoreCase) -or
        $freshPolicy.startMode -cne $policy.startMode -or $freshPolicy.delayedAutoStart -ne $policy.delayedAutoStart) {
      throw 'Legacy Core registration changed immediately before normalization.'
    }
    Invoke-PreservedRegistrationSc -Arguments @('config', $name, 'binPath=', $quoted)
    $readback = @(Get-CimInstance Win32_Service -Filter "Name='EgoistShieldCore'" -ErrorAction Stop -OperationTimeoutSec 3 | Where-Object { $_.Name -ceq $name })
    $checkedRegistration = Get-PreservedServiceRegistrationMetadata $name
    $checkedPolicy = Get-InstallerServicePolicy $name
    if ($readback.Count -ne 1 -or (Get-InstallerSystemServiceSid ([string]$readback[0].StartName)) -cne 'S-1-5-18' -or
        [int]$checkedRegistration.type -ne 16 -or (Get-InstallerSystemServiceSid ([string]$checkedRegistration.account)) -cne 'S-1-5-18' -or
        -not [string]::Equals([string]$readback[0].PathName, $quoted, [StringComparison]::Ordinal) -or
        -not [string]::Equals([string]$checkedRegistration.binPath, $quoted, [StringComparison]::Ordinal) -or
        -not $checkedPolicy -or -not [string]::Equals([string]$checkedPolicy.pathName, $quoted, [StringComparison]::Ordinal) -or
        $checkedPolicy.startMode -cne $policy.startMode -or $checkedPolicy.delayedAutoStart -ne $policy.delayedAutoStart) {
      throw 'Legacy Core registration quoted command readback failed; no services have been stopped.'
    }
    Add-ReceiptEvent -Stage 'preflight' -Status 'core-imagepath-normalized' -Message 'Exact legacy Core ImagePath was quoted without changing account, startup mode or running state.'
  } finally { $binaryLease.Dispose() }
}

function Get-OwnedServiceSnapshot {
  param([string]$Stage)
  Repair-LegacyCoreServiceRegistration
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
    $readback = @((Get-DnsClientServerAddress -InterfaceIndex $matchingAdapters[0].ifIndex -ErrorAction Stop |
      Select-Object -ExpandProperty ServerAddresses) | Where-Object { $_ })
    $expectedNormalized = @($expected | ForEach-Object { ([Net.IPAddress]::Parse($_)).ToString() } | Sort-Object -Unique)
    $currentNormalized = @($readback | ForEach-Object { ([Net.IPAddress]::Parse([string]$_)).ToString() } | Sort-Object -Unique)
    if ($expectedNormalized.Count -ne $currentNormalized.Count -or
        (@(Compare-Object -ReferenceObject $expectedNormalized -DifferenceObject $currentNormalized).Count -gt 0)) {
      Add-ReceiptEvent -Stage 'recovery' -Status 'adapter-dns-external-preserved' -Message 'Adapter DNS changed after the owned snapshot; current VPN/user configuration was retained without replaying the snapshot.'
      continue
    }
    # The installer has not changed adapter DNS. An unchanged owned snapshot
    # already satisfies readback; avoid a redundant write racing a VPN/user.
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
  param([string]$Source, [string]$Destination, [string[]]$ExcludeDirectories = @())
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return }
  New-Item -ItemType Directory -Path $Destination -Force -ErrorAction Stop | Out-Null
  $copyArguments = @($Source, $Destination, '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:2', '/W:1', '/XJ', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($ExcludeDirectories.Count -gt 0) { $copyArguments += '/XD'; $copyArguments += $ExcludeDirectories }
  & robocopy.exe @copyArguments | Out-Null
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
    Suspend-OwnedGuiLoginStartup
    return
  }
  Write-JsonAtomic -Path $marker -Value @{schemaVersion=1;owner="EgoistShield";stage=$StageDirectory}
  Suspend-OwnedGuiLoginStartup
}

function Complete-InstallerServiceMaintenance {
  $marker = Join-Path $script:OwnedDataRoot "installer\service-maintenance.json"
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { Resume-OwnedGuiLoginStartup; return }
  $existing = Get-Content -LiteralPath $marker -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ($existing.owner -ne "EgoistShield" -or [string]$existing.stage -ne $StageDirectory) {
    throw "Refusing to remove another service maintenance transaction."
  }
  Remove-Item -LiteralPath $marker -Force -ErrorAction Stop
  Resume-OwnedGuiLoginStartup
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
  param([object]$State, [switch]$PreserveSystemDohRuntime)
  if ($PreserveSystemDohRuntime) { [void](Assert-SystemDohPayloadContinuity -State $State) }
  $serviceRecords = @($State.services | Where-Object { $_.name -ne "EgoistShieldCore" })
  if ($PreserveSystemDohRuntime) { $serviceRecords = @($serviceRecords | Where-Object { $_.name -ne 'EgoistShieldSystemDoH' }) }
  # Reject unverifiable old stages and foreign name collisions before restoring
  # files or DNS ownership. A stage without metadata is kept for manual recovery.
  foreach ($record in $serviceRecords) {
    [void](Assert-PreservedServiceRegistration $record)
    [void](Get-PreservedRegistryBackup $record)
    [void](Assert-CurrentPreservedServiceOwnership ([string]$record.name))
  }
  $runtimeBackup = Join-Path $StageDirectory "runtime-backup"
  if (Test-Path -LiteralPath $runtimeBackup -PathType Container) {
    foreach ($privateComponent in @('Vpn', 'TelegramProxy')) {
      $privateBackup = Join-Path $runtimeBackup $privateComponent
      if (Test-Path -LiteralPath $privateBackup -PathType Container) {
        [void](Assert-PlainWrapperMigrationPath -Path $privateBackup -Root $StageDirectory)
        $privateDestination = Assert-PlainWrapperMigrationPath -Path (Join-Path $script:RuntimeRoot $privateComponent) -Root $script:RuntimeRoot
        New-Item -ItemType Directory -Path $privateDestination -Force -ErrorAction Stop | Out-Null
        Protect-InstallerStageTree -Stage $privateDestination
      }
    }
    $excluded = if ($PreserveSystemDohRuntime) { @(Join-Path $runtimeBackup 'SystemDoH') } else { @() }
    Invoke-RobocopyDirectory -Source $runtimeBackup -Destination $script:RuntimeRoot -ExcludeDirectories $excluded
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
  param([object]$State, [switch]$PreserveSystemDohRuntime)
  $definitions = Get-PreservedWrapperDefinitions
  $records = @($State.services | Where-Object { $definitions.ContainsKey([string]$_.name) })
  if ($PreserveSystemDohRuntime) { $records = @($records | Where-Object { $_.name -ne 'EgoistShieldSystemDoH' }) }
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
  param([object]$State, [switch]$PreserveSystemDohRuntime)
  if (-not $State.PSObject.Properties['wrapperMigrationPending'] -or $State.wrapperMigrationPending -ne $true) { return }
  $definitions = Get-PreservedWrapperDefinitions
  foreach ($record in @($State.services)) {
    $name = [string]$record.name
    if (-not $definitions.ContainsKey($name)) { continue }
    if ($PreserveSystemDohRuntime -and $name -eq 'EgoistShieldSystemDoH') { continue }
    $definition = $definitions[$name]
    $wrapper = Assert-PlainWrapperMigrationPath -Path (Join-Path $script:RuntimeRoot ($definition[0] + '\service-wrapper\' + $definition[1] + '.exe')) -Root $script:RuntimeRoot
    $registration = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction Stop
    if ($registration -and ([IO.Path]::GetFullPath(([string]$registration.PathName).Trim().Trim('"')) -ne $wrapper -or [IO.Path]::GetFullPath(([string]$record.pathName).Trim().Trim('"')) -ne $wrapper)) { throw "Wrapper rollback service ownership mismatch for $name." }
    Stop-OwnedServiceForInstall -Name $name
  }
}

function Update-PreservedRuntimeReliability {
  param([object]$State, [switch]$PreserveSystemDohRuntime)
  $definitions = @{
    EgoistShieldSystemDoH = @('SystemDoH', 'egoistshield-system-doh-service')
    EgoistShieldTelegramProxy = @('TelegramProxy', 'egoistshield-telegram-proxy-service')
    EgoistShieldZapret = @('Zapret', 'egoistshield-zapret-service')
  }
  foreach ($record in @($State.services)) {
    $name = [string]$record.name
    if (-not $definitions.ContainsKey($name)) { continue }
    if ($PreserveSystemDohRuntime -and $name -eq 'EgoistShieldSystemDoH') { continue }
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
    $restartDelays = if ($name -eq 'EgoistShieldSystemDoH') { @('0 sec','1 sec','60 sec') } else { @('5 sec','10 sec','60 sec') }
    foreach ($delay in $restartDelays) {
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
    $config = Get-PatchedSystemDohMigrationConfiguration $config
    Write-OwnedRuntimeMigrationFile -Path $configPath -Content ($config | ConvertTo-Json -Depth 64)
    & $engine run -test -config $configPath *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Preserved DNS configuration failed the Xray validation; recovery will restore its backup.' }
  }
}

function Get-PatchedSystemDohMigrationConfiguration {
  param([object]$Configuration)
  # Clone before adding the fixed migration fields; preflight is read-only.
  $config = ($Configuration | ConvertTo-Json -Depth 64 -Compress) | ConvertFrom-Json -ErrorAction Stop
  if (-not $config.dns -or -not $config.inbounds -or -not $config.log) { throw 'Private DNS migration format is unsupported.' }
  if (-not $config.dns.PSObject.Properties['hosts']) { $config.dns | Add-Member -NotePropertyName hosts -NotePropertyValue ([pscustomobject]@{}) }
  $marker = $config.dns.hosts.PSObject.Properties['health.egoist.invalid']
  if ($marker -and (@($marker.Value).Count -ne 1 -or [string]@($marker.Value)[0] -ne '127.0.0.1')) { throw 'Private DNS migration health marker conflicts with its saved policy.' }
  if (-not $marker) { $config.dns.hosts | Add-Member -NotePropertyName 'health.egoist.invalid' -NotePropertyValue '127.0.0.1' }
  $config.dns | Add-Member -NotePropertyName serveStale -NotePropertyValue $true -Force
  $config.dns | Add-Member -NotePropertyName serveExpiredTTL -NotePropertyValue 120 -Force
  if ($config.log.PSObject.Properties['error']) { $config.log.error = '' }
  return $config
}

function Get-SystemDohMigrationCandidateDigest {
  param([object]$Configuration)
  $text = New-Object Text.StringBuilder
  $utf8 = [Text.UTF8Encoding]::new($false)
  function Add-MigrationDigestNode {
    param([object]$Value)
    if ($null -eq $Value) { [void]$text.Append('n'); return }
    if ($Value -is [bool]) { [void]$text.Append($(if ($Value) { 't' } else { 'f' })); return }
    if ($Value -is [string]) { [void]$text.Append('s').Append($utf8.GetByteCount($Value)).Append(':').Append($Value); return }
    if ($Value -is [System.Collections.IList] -or $Value -is [Array]) {
      [void]$text.Append('a').Append($Value.Count).Append(':')
      foreach ($item in $Value) { Add-MigrationDigestNode $item }
      return
    }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
      $names = [Collections.Generic.List[string]]::new()
      foreach ($property in $Value.PSObject.Properties) { $names.Add([string]$property.Name) }
      $names.Sort([StringComparer]::Ordinal)
      [void]$text.Append('o').Append($names.Count).Append(':')
      foreach ($name in $names) {
        [void]$text.Append('k').Append($utf8.GetByteCount($name)).Append(':').Append($name)
        Add-MigrationDigestNode $Value.PSObject.Properties[$name].Value
      }
      return
    }
    if ($Value -is [byte] -or $Value -is [sbyte] -or $Value -is [int16] -or $Value -is [uint16] -or
        $Value -is [int32] -or $Value -is [uint32] -or $Value -is [int64] -or $Value -is [uint64] -or
        $Value -is [decimal] -or $Value -is [double] -or $Value -is [single]) {
      $literal = if ($Value -is [double] -or $Value -is [single]) { $Value.ToString('R',[Globalization.CultureInfo]::InvariantCulture) } else { $Value.ToString([Globalization.CultureInfo]::InvariantCulture) }
      $number = [decimal]::Parse($literal,[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture).ToString('G29',[Globalization.CultureInfo]::InvariantCulture)
      [void]$text.Append('d').Append($utf8.GetByteCount($number)).Append(':').Append($number)
      return
    }
    throw 'Private DNS candidate contains an unsupported semantic value.'
  }
  Add-MigrationDigestNode $Configuration
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($utf8.GetBytes($text.ToString())))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Assert-OwnedSystemDohInputSingleLink {
  param([IO.FileStream]$Stream)
  if (-not ('LagomOwnedDnsInputIdentity.Native' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
namespace LagomOwnedDnsInputIdentity {
 [StructLayout(LayoutKind.Sequential)] internal struct Info {
  public uint Attributes,CreationLow,CreationHigh,AccessLow,AccessHigh,WriteLow,WriteHigh,Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
 }
 public static class Native {
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info information);
  public static uint Links(SafeFileHandle handle) {
   Info information;
   if(!GetFileInformationByHandle(handle,out information)) throw new Win32Exception(Marshal.GetLastWin32Error());
   return information.Links;
  }
 }
}
"@ -ErrorAction Stop
  }
  if (-not $Stream -or $Stream.SafeFileHandle.IsClosed -or [LagomOwnedDnsInputIdentity.Native]::Links($Stream.SafeFileHandle) -ne 1) {
    throw 'Private DNS protection refuses linked or unverifiable input files.'
  }
}

function Protect-OwnedSystemDohMigrationInputs {
  param([object]$State)
  $lease = Get-SystemDohPayloadContinuityLease -State $State
  $extraStreams = @()
  try {
    $root = Assert-PlainWrapperMigrationPath -Path (Join-Path $script:RuntimeRoot 'SystemDoH') -Root $script:RuntimeRoot
    if ($root -cne [string]$lease.evidence.root) { throw 'Private DNS protection root changed.' }
    $directories = @($root,(Join-Path $root 'runtime'),(Join-Path $root 'service-wrapper'))
    $files = @('state.json','config.json','runtime\xray-system-doh.exe','service-wrapper\egoistshield-system-doh-service.exe','service-wrapper\egoistshield-system-doh-service.xml') | ForEach-Object { Join-Path $root $_ }
    $intentPath = Assert-PlainWrapperMigrationPath -Path (Join-Path $script:OwnedDataRoot 'Service\service-supervision.json') -Root $script:OwnedDataRoot
    $hasIntent = Test-Path -LiteralPath $intentPath -PathType Leaf
    if ($hasIntent) { $files += $intentPath }
    # Legacy inherited Users READ is acceptable input authority, whereas any
    # untrusted writer/owner/deny rule is refused before the first ACL change.
    [void](Assert-PlainWrapperMigrationPath -Path $script:OwnedDataRoot -Root (Split-Path -Parent $script:OwnedDataRoot))
    [void](Assert-InstallerBootRecoveryFileProtection -Path $script:OwnedDataRoot)
    foreach ($path in @($script:RuntimeRoot) + $directories + $files) {
      [void](Assert-PlainWrapperMigrationPath -Path $path -Root $script:OwnedDataRoot)
      [void](Assert-InstallerBootRecoveryFileProtection -Path $path)
    }
    $extraReadback = @()
    foreach ($path in @((Join-Path $root 'state.json')) + $(if ($hasIntent) { @($intentPath) } else { @() })) {
      $stream = [IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
      $extraStreams += $stream
      if ($stream.Length -le 0 -or $stream.Length -gt 4194304) { throw 'Private DNS protection input exceeds its limit.' }
      $extraReadback += [pscustomobject]@{path=$path;sha256=(Get-FileSha256 $path)}
    }
    foreach ($stream in @($lease.streams | Select-Object -First 4) + $extraStreams) { Assert-OwnedSystemDohInputSingleLink -Stream $stream }
    $runtimeState = Get-Content -LiteralPath (Join-Path $root 'state.json') -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($runtimeState.localAddress -cne '127.0.0.1' -or $runtimeState.localPort -ne 53 -or
        ($runtimeState.PSObject.Properties['enabled'] -and $runtimeState.enabled -ne $true)) { throw 'Private DNS protection state is incompatible.' }
    $savedEndpoint = [Uri]$runtimeState.url
    if (-not $savedEndpoint.IsAbsoluteUri -or $savedEndpoint.Scheme -cne 'https') { throw 'Private DNS protection endpoint is invalid.' }
    $primary = @($State.userState | Where-Object { [IO.Path]::GetFileName([string]$_.source) -eq 'egoistshield-state.json' })
    if ($primary.Count -eq 0) { throw 'Private DNS protection enabled intent is missing.' }
    foreach ($record in $primary) {
      $current = Get-Content -LiteralPath $record.source -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      $settings = if ($current.PSObject.Properties['settings']) { $current.settings } else { $current }
      if ($settings.systemDohEnabled -ne $true -or ([Uri]$settings.systemDohUrl).AbsoluteUri -cne $savedEndpoint.AbsoluteUri) {
        throw 'Private DNS protection current private intent changed.'
      }
    }
    if ($hasIntent) {
      $intent = Get-Content -LiteralPath $intentPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      if ($intent.schemaVersion -ne 1 -or $intent.owner -cne 'EgoistShield' -or
          -not $intent.services.PSObject.Properties['EgoistShieldSystemDoH'] -or $intent.services.EgoistShieldSystemDoH.running -ne $true) {
        throw 'Private DNS protection supervision intent is unowned or stopped.'
      }
    }
    [void](Assert-SystemDohPayloadContinuity -State $State)
    foreach ($directory in $directories) { Protect-StageDirectory -Path $directory }
    foreach ($file in $files) { Protect-InstallerStageFile -Path $file }
    foreach ($entry in $extraReadback) {
      if ((Get-FileSha256 $entry.path) -cne $entry.sha256) { throw 'Private DNS protection input generation changed.' }
    }
    foreach ($stream in @($lease.streams | Select-Object -First 4) + $extraStreams) { Assert-OwnedSystemDohInputSingleLink -Stream $stream }
    if ($hasIntent -ne (Test-Path -LiteralPath $intentPath -PathType Leaf)) { throw 'Private DNS protection supervision generation changed.' }
    foreach ($held in $lease.handles) { if ($held.HasExited) { throw 'Private DNS protection held process exited.' } }
    [void](Assert-SystemDohPayloadContinuity -State $State)
    Add-ReceiptEvent -Stage 'migration' -Status 'private-dns-input-acls-protected' -Message 'Only the proven retained resolver inputs were protected; their bytes, processes and adapter DNS were preserved.'
    return $true
  } finally {
    foreach ($stream in $extraStreams) { if ($stream) { $stream.Dispose() } }
    Close-SystemDohRuntimeLease -Lease $lease
  }
}

function Invoke-OwnedSystemDohMigrationPreflight {
  param([object]$State)
  try { [void](Protect-OwnedSystemDohMigrationInputs -State $State) }
  catch { Write-Verbose 'Private DNS candidate input protection was unverified; the retained resolver was not stopped.'; return $null }
  $evidence = Assert-SystemDohPayloadContinuity -State $State
  $exe = Assert-PlainWrapperMigrationPath -Path (Join-Path $script:OwnedInstallRoot 'resources\core-service\win-x64\EgoistShield.Service.exe') -Root $script:OwnedInstallRoot
  [void](Assert-InstallerBootRecoveryFileProtection -Path $exe)
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $exe; $start.Arguments = '--probe-owned-system-doh-migration'
  $start.UseShellExecute = $false; $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
  $start.StandardOutputEncoding = [Text.Encoding]::UTF8; $start.StandardErrorEncoding = [Text.Encoding]::UTF8
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $start
  try {
    if (-not $process.Start()) { throw 'Private DNS candidate preflight did not start.' }
    [void]$process.Handle
    $output = $process.StandardOutput.ReadToEndAsync(); $errors = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(30000)) {
      # The native probe owns a kill-on-close child job; terminating only this
      # held probe process also contains its temporary high-port candidate.
      $process.Kill(); [void]$process.WaitForExit(3000)
      return $null
    }
    $json = $output.GetAwaiter().GetResult(); [void]$errors.GetAwaiter().GetResult()
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 16384) { throw 'Private DNS preflight output exceeds its limit.' }
    $result = $json | ConvertFrom-Json -ErrorAction Stop
    if ($result.schemaVersion -ne 1 -or $result.purpose -cne 'private-dns-migration-preflight' -or $result.ready -ne $true -or $process.ExitCode -ne 0) { return $null }
    if ($result.digestAlgorithm -cne 'leaf-v1' -or [string]$result.candidateSha256 -notmatch '^[0-9a-f]{64}$' -or
        [string]$result.wrapperPid -cne [string]$evidence.wrapperPid -or [string]$result.wrapperStartTicks -cne [string]$evidence.wrapperStartTicks -or
        [string]$result.productionPid -cne [string]$evidence.enginePid -or [string]$result.productionStartTicks -cne [string]$evidence.engineStartTicks -or
        [string]$result.originalConfigSha256 -ine (Get-FileSha256 $evidence.config)) { throw 'Private DNS candidate preflight generation changed.' }
    $config = Get-Content -LiteralPath $evidence.config -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $patched = Get-PatchedSystemDohMigrationConfiguration $config
    if ((Get-SystemDohMigrationCandidateDigest $patched) -cne [string]$result.candidateSha256) { throw 'Private DNS candidate preflight fixed configuration digest changed.' }
    [void](Assert-SystemDohPayloadContinuity -State $State)
    return $result
  } catch {
    Write-Verbose 'Private DNS candidate preflight did not authorize a switch; the current generation will be retained.'
    return $null
  } finally { $process.Dispose() }
}

function Prepare-SystemDohMigrationPayload {
  param([object]$State, [object]$Preflight)
  $evidence = Assert-SystemDohPayloadContinuity -State $State
  $directory = Assert-PlainWrapperMigrationPath -Path (Join-Path $StageDirectory 'system-doh-migration-candidate') -Root $StageDirectory
  if (Test-Path -LiteralPath $directory) { throw 'Private DNS migration candidate already exists; retained candidate requires recovery.' }
  New-Item -ItemType Directory -Path $directory -ErrorAction Stop | Out-Null
  Protect-InstallerStageTree -Stage $directory
  $config = Get-PatchedSystemDohMigrationConfiguration (Get-Content -LiteralPath $evidence.config -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop)
  if ((Get-SystemDohMigrationCandidateDigest $config) -cne [string]$Preflight.candidateSha256) { throw 'Private DNS staged candidate does not match its successful preflight.' }
  [IO.File]::WriteAllText((Join-Path $directory 'config.json'), (($config | ConvertTo-Json -Depth 64) + "`n"), [Text.UTF8Encoding]::new($false))
  $xml = Join-Path $evidence.root 'service-wrapper\egoistshield-system-doh-service.xml'
  $settings = [Xml.XmlReaderSettings]::new(); $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit; $settings.XmlResolver = $null
  $reader = [Xml.XmlReader]::Create($xml,$settings)
  $document = [Xml.XmlDocument]::new(); $document.XmlResolver = $null
  try { $document.Load($reader) } finally { $reader.Dispose() }
  $log = $document.SelectSingleNode('/service/log')
  if (-not $log -or $log.GetAttribute('mode') -ne 'roll-by-size' -or -not $log.SelectSingleNode('sizeThreshold') -or -not $log.SelectSingleNode('keepFiles')) { throw 'Private DNS staged wrapper logging format is unsupported.' }
  $log.SelectSingleNode('sizeThreshold').InnerText = '10240'; $log.SelectSingleNode('keepFiles').InnerText = '5'
  foreach ($node in @($document.SelectNodes('/service/onfailure'))) { [void]$document.DocumentElement.RemoveChild($node) }
  foreach ($delay in @('0 sec','1 sec','60 sec')) {
    $node = $document.CreateElement('onfailure'); $node.SetAttribute('action','restart'); $node.SetAttribute('delay',$delay)
    [void]$document.DocumentElement.AppendChild($node)
  }
  $reset = $document.SelectSingleNode('/service/resetfailure')
  if (-not $reset) { $reset = $document.CreateElement('resetfailure'); [void]$document.DocumentElement.AppendChild($reset) }
  $reset.InnerText = '1 hour'
  [IO.File]::WriteAllText((Join-Path $directory 'wrapper.xml'),($document.OuterXml + "`n"),[Text.UTF8Encoding]::new($false))
  $wrapper = Get-VerifiedPackagedServiceWrapper -Version ([string]$State.version)
  [IO.File]::Copy($wrapper.path,(Join-Path $directory 'wrapper.exe'),$false)
  if ((Get-FileSha256 (Join-Path $directory 'wrapper.exe')) -ine [string]$wrapper.sha256) { throw 'Private DNS staged wrapper checksum changed.' }
  $files = @(
    [pscustomobject]@{source=(Join-Path $directory 'config.json');relative='config.json'},
    [pscustomobject]@{source=(Join-Path $directory 'wrapper.xml');relative='service-wrapper\egoistshield-system-doh-service.xml'},
    [pscustomobject]@{source=(Join-Path $directory 'wrapper.exe');relative='service-wrapper\egoistshield-system-doh-service.exe'}
  )
  foreach ($file in $files) { $file | Add-Member -NotePropertyName sha256 -NotePropertyValue (Get-FileSha256 $file.source) }
  Protect-InstallerStageTree -Stage $directory
  [void](Assert-SystemDohPayloadContinuity -State $State)
  return [pscustomobject]@{root=$evidence.root;files=$files;candidateSha256=[string]$Preflight.candidateSha256}
}

function Start-VerifiedSystemDohSwitch {
  param([object]$State, [switch]$PreservedRuntimeRecovery)
  [void](Assert-CurrentPreservedServiceOwnership 'EgoistShieldSystemDoH' -RequirePresent)
  Start-Service -Name 'EgoistShieldSystemDoH' -ErrorAction Stop
  $service = Get-InstallerServiceState 'EgoistShieldSystemDoH'
  if (-not $service) { throw 'Private DNS switch service is missing.' }
  $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running,[TimeSpan]::FromSeconds(8))
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    if (Test-OwnedSystemDohRecoveryRuntime -State $State -PreservedRuntimeRecovery:$PreservedRuntimeRecovery) { return }
    if ($attempt -lt 2) { Start-Sleep -Milliseconds 250 }
  }
  throw 'Private DNS switch did not confirm its exact owned local listeners.'
}

function Invoke-SystemDohRuntimeMigration {
  param([object]$State)
  [void](Assert-SystemDohPayloadContinuity -State $State)
  $preflight = Invoke-OwnedSystemDohMigrationPreflight -State $State
  if (-not $preflight) {
    [void](Assert-SystemDohPayloadContinuity -State $State)
    Add-ReceiptEvent -Stage 'migration' -Status 'private-dns-migration-deferred' -Message 'The same private candidate is unavailable. The original owned resolver stayed running; no DNS configuration or adapter was changed.'
    return $false
  }
  $candidate = Prepare-SystemDohMigrationPayload -State $State -Preflight $preflight
  $switchFiles = @($candidate.files | ForEach-Object {
    $destination = Assert-PlainWrapperMigrationPath -Path (Join-Path $candidate.root $_.relative) -Root $candidate.root
    # WinPS 5.1 uses .NET Framework IO APIs: validate every atomic sibling
    # before stopping the retained resolver, including the MAX_PATH boundary.
    $temporary = Assert-PlainWrapperMigrationPath -Path (Join-Path (Split-Path -Parent $destination) ('.switch-' + [Guid]::NewGuid().ToString('N') + '.tmp')) -Root $candidate.root
    if ($destination.Length -ge 260 -or $temporary.Length -ge 260) { throw 'Private DNS switch paths exceed the supported Windows IO boundary.' }
    [pscustomobject]@{source=$_.source;relative=$_.relative;sha256=$_.sha256;destination=$destination;temporary=$temporary}
  })
  $commitLease = Get-SystemDohPayloadContinuityLease -State $State
  $elapsed = [Diagnostics.Stopwatch]::StartNew()
  try {
    $State | Add-Member -NotePropertyName dnsMigrationStarted -NotePropertyValue $true -Force
    Write-JsonAtomic -Path (Join-Path $StageDirectory 'state.json') -Value $State
    Set-InstallerServiceStartMode 'EgoistShieldSystemDoH' 'Disabled' $false { param($path) Test-OwnedServicePath $path }
    Stop-OwnedServiceForInstall -Name 'EgoistShieldSystemDoH'
    # Keep current private intent and journal pinned during the short switch;
    # release only the old runtime bytes once its exact held process stopped.
    Close-SystemDohRuntimeLease -Lease $commitLease -RuntimeFilesOnly
    foreach ($file in $switchFiles) {
      [void](Assert-InstallerBootRecoveryFileProtection -Path $file.source)
      if ((Get-FileSha256 $file.source) -cne [string]$file.sha256) { throw 'Private DNS switch candidate changed.' }
      $destination = Assert-PlainWrapperMigrationPath -Path $file.destination -Root $candidate.root
      Assert-PreservedWrapperStopped -Name 'EgoistShieldSystemDoH' -Wrapper (Join-Path $candidate.root 'service-wrapper\egoistshield-system-doh-service.exe')
      $temporary = Assert-PlainWrapperMigrationPath -Path $file.temporary -Root $candidate.root
      try {
        [IO.File]::Copy($file.source,$temporary,$false)
        if ((Get-FileSha256 $temporary) -cne [string]$file.sha256) { throw 'Private DNS switch candidate copy changed.' }
        [IO.File]::Replace($temporary,$destination,[NullString]::Value)
      } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction Stop } }
    }
    $patched = Get-Content -LiteralPath (Join-Path $candidate.root 'config.json') -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ((Get-SystemDohMigrationCandidateDigest $patched) -cne $candidate.candidateSha256) { throw 'Private DNS switch configuration digest changed.' }
    $record = @($State.services | Where-Object { $_.name -eq 'EgoistShieldSystemDoH' })[0]
    Set-InstallerServiceStartMode 'EgoistShieldSystemDoH' ([string]$record.startMode) ([bool]$record.delayedAutoStart) { param($path) Test-OwnedServicePath $path }
    Write-VerifiedSystemDohRecoveryRuntime -State $State
    Start-VerifiedSystemDohSwitch -State $State
    Add-ReceiptEvent -Stage 'migration' -Status 'private-dns-migrated' -Message 'The preflighted same-private configuration passed exact local ownership readback.' -Data @{switchMilliseconds=$elapsed.ElapsedMilliseconds}
    return $true
  } catch {
    $failure = $_
    try {
      Stop-OwnedServiceForInstall -Name 'EgoistShieldSystemDoH'
      Close-SystemDohRuntimeLease -Lease $commitLease -RuntimeFilesOnly
      $backup = Join-Path $StageDirectory 'runtime-backup\SystemDoH'
      foreach ($file in @($candidate.files)) {
        $original = Assert-PlainWrapperMigrationPath -Path (Join-Path $backup $file.relative) -Root $backup
        $expected = @($State.payloadContinuity.files | Where-Object { $_.path -ceq $file.relative })
        if ($expected.Count -ne 1 -or (Get-FileSha256 $original) -cne [string]$expected[0].sha256) { throw 'Private DNS immediate rollback backup changed.' }
        [IO.File]::Copy($original,(Join-Path $candidate.root $file.relative),$true)
      }
      $record = @($State.services | Where-Object { $_.name -eq 'EgoistShieldSystemDoH' })[0]
      Set-InstallerServiceStartMode 'EgoistShieldSystemDoH' ([string]$record.startMode) ([bool]$record.delayedAutoStart) { param($path) Test-OwnedServicePath $path }
      Start-VerifiedSystemDohSwitch -State $State -PreservedRuntimeRecovery
      $restored = Test-OwnedSystemDohRecoveryRuntime -State $State -PreservedRuntimeRecovery -AsEvidence
      if (-not $restored -or $restored -is [bool]) { throw 'Private DNS immediate rollback exact original generation is unverified.' }
      $State | Add-Member -NotePropertyName payloadContinuity -NotePropertyValue $restored -Force
      $State.dnsMigrationStarted = $false
      Write-JsonAtomic -Path (Join-Path $StageDirectory 'state.json') -Value $State
      Add-ReceiptEvent -Stage 'migration' -Status 'private-dns-switch-rolled-back' -Message 'The failed switch restored and verified the original private resolver before broader recovery.' -Data @{switchMilliseconds=$elapsed.ElapsedMilliseconds}
    } catch { throw 'Private DNS switch and immediate original-generation rollback require protected recovery.' }
    throw $failure
  } finally { Close-SystemDohRuntimeLease -Lease $commitLease }
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
  $elapsed = [Diagnostics.Stopwatch]::StartNew()
  while ($elapsed.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
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

function Wait-OwnedVpnReady {
  param([ValidateRange(1, 60)][int]$TimeoutSeconds = 45)
  $helper = Assert-PlainWrapperMigrationPath -Path (Join-Path $script:OwnedInstallRoot 'resources\core-service\win-x64\EgoistShield.Service.exe') -Root $script:OwnedInstallRoot
  $elapsed = [Diagnostics.Stopwatch]::StartNew()
  while ($elapsed.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    try {
      $result = Invoke-InstallerNativeProcess -Executable $helper -Arguments @('--vpn-service-status') -TimeoutSeconds 15
      if ($result.exitCode -eq 0 -and [Text.Encoding]::UTF8.GetByteCount([string]$result.output) -le 32768) {
        $status = $result.output | ConvertFrom-Json -ErrorAction Stop
        if ([string]$status.serviceName -eq 'EgoistShieldVpn' -and $status.serviceInstalled -eq $true -and
            [string]$status.serviceState -eq 'running' -and $status.running -eq $true -and
            [string]$status.localHealth -eq 'responsive' -and [string]$status.observation.state -eq 'observed' -and
            [int]$status.socksPort -eq 10838 -and [int]$status.pid -gt 0) { return $true }
      }
    } catch { Write-Verbose 'VPN service readiness could not be confirmed.' }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Get-SystemDohPrivatePolicyDigest {
  param([object]$Configuration)
  if (-not $Configuration.dns -or -not $Configuration.dns.servers) { throw 'Private DNS policy is missing.' }
  $policy = $Configuration.dns | ConvertTo-Json -Depth 64 -Compress | ConvertFrom-Json
  foreach ($name in @('serveStale', 'serveExpiredTTL')) { $policy.PSObject.Properties.Remove($name) }
  if ($policy.PSObject.Properties['hosts']) {
    $policy.hosts.PSObject.Properties.Remove('health.egoist.invalid')
    if (@($policy.hosts.PSObject.Properties).Count -eq 0) { $policy.PSObject.Properties.Remove('hosts') }
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($policy | ConvertTo-Json -Depth 64 -Compress))
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $hasher.Dispose() }
}

function Get-SystemDohActivationDigest {
  param([string]$Path)
  if ((Get-Item -LiteralPath $Path).Length -gt 4194304) { throw 'Private activation state exceeds its limit.' }
  $stored = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  $settings = if ($stored.PSObject.Properties['settings']) { $stored.settings } else { $stored }
  $values = [ordered]@{}
  foreach ($property in @($settings.PSObject.Properties | Where-Object { $_.Name -match '^systemDoh|^systemDnsServers$' } | Sort-Object Name)) { $values[$property.Name] = $property.Value }
  if ($values.Count -eq 0) { return $null }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($values | ConvertTo-Json -Depth 64 -Compress))
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $hasher.Dispose() }
}

function Test-SystemDohConfigArgument {
  param([string]$Arguments, [string]$ExpectedConfig)
  if (-not $Arguments -or $Arguments.Length -gt 32768) { return $false }
  # Apply Windows argv quoting so a flag inside a quoted executable/path is
  # not authority. Xray's Go parser accepts one or two dashes and '='.
  $tokens = New-Object 'Collections.Generic.List[string]'
  for ($offset = 0; $offset -lt $Arguments.Length; ) {
    while ($offset -lt $Arguments.Length -and [char]::IsWhiteSpace($Arguments[$offset])) { $offset++ }
    if ($offset -ge $Arguments.Length) { break }
    $token = New-Object Text.StringBuilder
    $quoted = $false
    while ($offset -lt $Arguments.Length -and ($quoted -or -not [char]::IsWhiteSpace($Arguments[$offset]))) {
      if ($Arguments[$offset] -eq '\') {
        $slashes = 0
        while ($offset -lt $Arguments.Length -and $Arguments[$offset] -eq '\') { $slashes++; $offset++ }
        if ($offset -lt $Arguments.Length -and $Arguments[$offset] -eq '"') {
          [void]$token.Append(('\' * [int][Math]::Floor($slashes / 2)))
          if (($slashes % 2) -eq 1) { [void]$token.Append('"') } else { $quoted = -not $quoted }
          $offset++
        } else { [void]$token.Append(('\' * $slashes)) }
      } elseif ($Arguments[$offset] -eq '"') { $quoted = -not $quoted; $offset++ }
      else { [void]$token.Append($Arguments[$offset]); $offset++ }
    }
    if ($quoted -or $tokens.Count -ge 256) { return $false }
    $tokens.Add($token.ToString())
  }
  $run = if ($tokens.Count -gt 0 -and $tokens[0] -ceq 'run') { 0 } elseif ($tokens.Count -gt 1 -and $tokens[1] -ceq 'run') { 1 } else { -1 }
  if ($run -lt 0 -or $tokens.Count -lt ($run + 2)) { return $false }
  # Managed wrappers need only 'run -c/config expected'. Extra positional
  # inputs or options could change Go flag parsing; reject them conservatively.
  $flag = [regex]::Match($tokens[$run + 1], '^--?(?:c|config)(?:=(.*))?$')
  if (-not $flag.Success) { return $false }
  if ($flag.Groups[1].Success) {
    if ($tokens.Count -ne ($run + 2)) { return $false }
    $selected = $flag.Groups[1].Value
  } else {
    if ($tokens.Count -ne ($run + 3)) { return $false }
    $selected = $tokens[$run + 2]
  }
  if (-not $selected) { return $false }
  try { return [IO.Path]::GetFullPath($selected).Equals($ExpectedConfig, [StringComparison]::OrdinalIgnoreCase) }
  catch { return $false }
}

function Get-SystemDohRecoveryFiles {
  param([object]$State)
  $records = @($State.services | Where-Object { $_.name -eq 'EgoistShieldSystemDoH' })
  if ($records.Count -ne 1) { throw 'Private DNS recovery requires one preserved owned service.' }
  $record = $records[0]
  [void](Assert-PreservedServiceRegistration $record)
  [void](Get-PreservedRegistryBackup $record)
  $root = Assert-PlainWrapperMigrationPath -Path (Join-Path $script:RuntimeRoot 'SystemDoH') -Root $script:RuntimeRoot
  $config = Assert-PlainWrapperMigrationPath -Path (Join-Path $root 'config.json') -Root $root
  $wrapper = Assert-PlainWrapperMigrationPath -Path (Join-Path $root 'service-wrapper\egoistshield-system-doh-service.exe') -Root $root
  $xml = Assert-PlainWrapperMigrationPath -Path ([IO.Path]::ChangeExtension($wrapper, '.xml')) -Root $root
  if (-not [IO.Path]::GetFullPath(([string]$record.pathName).Trim().Trim('"')).Equals($wrapper, [StringComparison]::OrdinalIgnoreCase)) { throw 'Private DNS wrapper does not match its preserved registration.' }
  if ((Get-Item -LiteralPath $config).Length -gt 1048576 -or (Get-Item -LiteralPath $xml).Length -gt 65536) { throw 'Private DNS recovery input exceeds its limit.' }
  $settings = New-Object Xml.XmlReaderSettings
  $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $reader = [Xml.XmlReader]::Create($xml, $settings)
  $document = New-Object Xml.XmlDocument
  $document.XmlResolver = $null
  try { $document.Load($reader) } finally { $reader.Dispose() }
  if ($document.SelectSingleNode('/service/id').InnerText -cne 'EgoistShieldSystemDoH') { throw 'Private DNS wrapper id changed.' }
  $engine = Assert-PlainWrapperMigrationPath -Path $document.SelectSingleNode('/service/executable').InnerText -Root $root
  $expectedEngine = [IO.Path]::GetFullPath((Join-Path $root 'runtime\xray-system-doh.exe'))
  if (-not $engine.Equals($expectedEngine, [StringComparison]::OrdinalIgnoreCase)) { throw 'Private DNS engine path changed.' }
  if (-not (Test-SystemDohConfigArgument -Arguments $document.SelectSingleNode('/service/arguments').InnerText -ExpectedConfig $config)) { throw 'Private DNS wrapper does not select the expected configuration.' }
  $configuration = Get-Content -LiteralPath $config -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  $files = @('config.json', 'service-wrapper\egoistshield-system-doh-service.exe', 'service-wrapper\egoistshield-system-doh-service.xml', 'runtime\xray-system-doh.exe')
  return [pscustomobject]@{ record = $record; root = $root; config = $config; wrapper = $wrapper; engine = $engine; configuration = $configuration; files = $files }
}

function Write-VerifiedSystemDohRecoveryRuntime {
  param([object]$State)
  if (@($State.services | Where-Object { $_.name -eq 'EgoistShieldSystemDoH' }).Count -eq 0) { return }
  $proof = Get-SystemDohRecoveryFiles $State
  $service = Get-InstallerServiceState 'EgoistShieldSystemDoH'
  if (-not $service -or $service.Status -ne 'Stopped') { throw 'Expected private runtime can only be recorded while its owned service is stopped.' }
  [void](Assert-CurrentPreservedServiceOwnership 'EgoistShieldSystemDoH' -RequirePresent)
  $backupRoot = Assert-PlainWrapperMigrationPath -Path (Join-Path $StageDirectory 'runtime-backup\SystemDoH') -Root $StageDirectory
  $backupConfig = Assert-PlainWrapperMigrationPath -Path (Join-Path $backupRoot 'config.json') -Root $backupRoot
  if ((Get-Item -LiteralPath $backupConfig).Length -gt 1048576) { throw 'Saved private policy exceeds its limit.' }
  $original = Get-Content -LiteralPath $backupConfig -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  $policy = Get-SystemDohPrivatePolicyDigest $proof.configuration
  if ($policy -cne (Get-SystemDohPrivatePolicyDigest $original)) { throw 'Runtime migration changed the preserved private DNS policy.' }
  $identity = Get-InstalledIdentity
  if ($identity -cne [string]$State.installationId) { throw 'Private runtime generation installation identity changed.' }
  $files = @()
  foreach ($relative in $proof.files) {
    $file = Assert-PlainWrapperMigrationPath -Path (Join-Path $proof.root $relative) -Root $proof.root
    $files += [pscustomobject]@{ path = $relative; bytes = (Get-Item -LiteralPath $file).Length; sha256 = Get-FileSha256 $file }
  }
  $receiptPath = Assert-PlainWrapperMigrationPath -Path (Join-Path $StageDirectory 'system-doh-migrated-runtime.json') -Root $StageDirectory
  Write-JsonAtomic -Path $receiptPath -Value @{
    schemaVersion = 1; owner = 'EgoistShield'; stage = $StageDirectory; installationId = $identity
    generation = [Guid]::NewGuid().ToString('N'); privatePolicySha256 = $policy
    originalConfigSha256 = Get-FileSha256 $backupConfig; files = $files
  }
  [void](Assert-InstallerBootRecoveryFileProtection -Path $receiptPath)
}

function Test-OwnedSystemDohRecoveryRuntime {
  param([object]$State, [switch]$PreservedRuntimeRecovery, [switch]$AsEvidence, [switch]$AsLease)
  $handles = @()
  $streams = @()
  $activationReadback = @()
  $ownedDnsReadback = $null
  $transferred = $false
  $script:SystemDohRecoveryDiagnosticFailure = $null
  $script:SystemDohRecoveryDiagnosticSubstage = 'recovery-files'
  try {
    $proof = Get-SystemDohRecoveryFiles $State
    $backupRoot = Assert-PlainWrapperMigrationPath -Path (Join-Path $StageDirectory 'runtime-backup\SystemDoH') -Root $StageDirectory
    $backupConfig = Assert-PlainWrapperMigrationPath -Path (Join-Path $backupRoot 'config.json') -Root $backupRoot
    $script:SystemDohRecoveryDiagnosticSubstage = 'expected-runtime-inventory'
    $expected = @{}
    $receiptHash = $null
    if ($PreservedRuntimeRecovery) {
      foreach ($relative in $proof.files) {
        $saved = Assert-PlainWrapperMigrationPath -Path (Join-Path $backupRoot $relative) -Root $backupRoot
        $expected[$relative] = [pscustomobject]@{ bytes = (Get-Item -LiteralPath $saved).Length; sha256 = Get-FileSha256 $saved }
      }
    } else {
      $receiptPath = Assert-PlainWrapperMigrationPath -Path (Join-Path $StageDirectory 'system-doh-migrated-runtime.json') -Root $StageDirectory
      [void](Assert-InstallerBootRecoveryFileProtection -Path $receiptPath)
      if ((Get-Item -LiteralPath $receiptPath).Length -gt 16384) { return $false }
      $receiptHash = Get-FileSha256 $receiptPath
      $receipt = Get-Content -LiteralPath $receiptPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      if ($receipt.schemaVersion -ne 1 -or $receipt.owner -cne 'EgoistShield' -or
          [string]$receipt.stage -cne $StageDirectory -or [string]$receipt.installationId -cne [string]$State.installationId -or
          [string]$receipt.generation -notmatch '^[0-9a-f]{32}$' -or @($receipt.files).Count -ne 4 -or
          [string]$receipt.originalConfigSha256 -cne (Get-FileSha256 $backupConfig) -or
          [string]$receipt.privatePolicySha256 -cne (Get-SystemDohPrivatePolicyDigest $proof.configuration)) { return $false }
      $original = Get-Content -LiteralPath $backupConfig -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      if ([string]$receipt.privatePolicySha256 -cne (Get-SystemDohPrivatePolicyDigest $original)) { return $false }
      foreach ($entry in @($receipt.files)) {
        if ($proof.files -cnotcontains [string]$entry.path -or $expected.ContainsKey([string]$entry.path) -or
            [string]$entry.sha256 -notmatch '^[0-9a-f]{64}$' -or [int64]$entry.bytes -lt 1) { return $false }
        $expected[[string]$entry.path] = $entry
      }
    }
    if ($expected.Count -ne 4) { return $false }
    $script:SystemDohRecoveryDiagnosticSubstage = 'runtime-file-leases'
    foreach ($relative in $proof.files) {
      $file = Assert-PlainWrapperMigrationPath -Path (Join-Path $proof.root $relative) -Root $proof.root
      [void](Assert-InstallerBootRecoveryFileProtection -Path $file)
      # Pin the exact restored generation while observing its processes.
      $stream = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      $streams += $stream
      if ($stream.Length -ne [int64]$expected[$relative].bytes -or
          (Get-FileSha256 $file) -cne [string]$expected[$relative].sha256) { return $false }
    }
    if ($PreservedRuntimeRecovery -and $proof.record.PSObject.Properties['wrapperSha256'] -and
        [string]$proof.record.wrapperSha256 -cne (Get-FileSha256 $proof.wrapper)) { return $false }
    $script:SystemDohRecoveryDiagnosticSubstage = 'private-activation-intent'
    foreach ($record in @($State.userState)) {
      $saved = Assert-PlainWrapperMigrationPath -Path (Join-Path (Join-Path $StageDirectory 'user-state') ([string]$record.backupName)) -Root $StageDirectory
      if ((Get-FileSha256 $saved) -cne [string]$record.sha256) { return $false }
      # Zapret profile reconciliation may intentionally reserialize the state.
      # Its private DNS intent and selected URL/address must still match the
      # exact authenticated backup; unrelated profile formatting is permitted.
      $intent = Get-SystemDohActivationDigest $saved
      if ($intent) {
        $source = [IO.Path]::GetFullPath([string]$record.source)
        $streams += [IO.File]::Open($source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        if ($intent -cne (Get-SystemDohActivationDigest $source)) { return $false }
        $activationReadback += [pscustomobject]@{ path = $source; digest = $intent }
      }
    }
    $script:SystemDohRecoveryDiagnosticSubstage = 'owned-dns-journal'
    if (@($State.criticalDns).Count -gt 0) {
      $saved = Assert-PlainWrapperMigrationPath -Path (Join-Path $StageDirectory 'dns-owned-state.json') -Root $StageDirectory
      $current = Assert-PlainWrapperMigrationPath -Path (Join-Path $script:OwnedDataRoot 'Service\dns-owned-state.json') -Root $script:OwnedDataRoot
      $streams += [IO.File]::Open($current, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      $ownedDnsReadback = [pscustomobject]@{ path = $current; digest = (Get-FileSha256 $saved) }
      if ($ownedDnsReadback.digest -cne (Get-FileSha256 $current)) { return $false }
    }
    $script:SystemDohRecoveryDiagnosticSubstage = 'service-identity'
    [void](Assert-CurrentPreservedServiceOwnership 'EgoistShieldSystemDoH' -RequirePresent)
    $service = Get-CimInstance Win32_Service -Filter "Name='EgoistShieldSystemDoH'" -OperationTimeoutSec 3 -ErrorAction Stop
    if (-not $service -or [string]$service.State -cne 'Running' -or [int]$service.ProcessId -le 0 -or
        [string]$service.StartName -notin @('LocalSystem', 'NT AUTHORITY\SYSTEM') -or
        -not [IO.Path]::GetFullPath(([string]$service.PathName).Trim().Trim('"')).Equals($proof.wrapper, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    $script:SystemDohRecoveryDiagnosticSubstage = 'wrapper-process'
    $processes = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,ExecutablePath,CreationDate,CommandLine -OperationTimeoutSec 3 -ErrorAction Stop)
    $wrappers = @($processes | Where-Object { [int]$_.ProcessId -eq [int]$service.ProcessId })
    if ($wrappers.Count -ne 1 -or -not $wrappers[0].CreationDate -or
        -not [string]::Equals([string]$wrappers[0].ExecutablePath, $proof.wrapper, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    $script:SystemDohRecoveryDiagnosticSubstage = 'engine-parent-process'
    $children = @($processes | Where-Object { [int]$_.ParentProcessId -eq [int]$service.ProcessId -and
        $_.CreationDate -and [DateTime]$_.CreationDate -ge [DateTime]$wrappers[0].CreationDate -and
        [string]::Equals([string]$_.ExecutablePath, $proof.engine, [StringComparison]::OrdinalIgnoreCase) })
    if ($children.Count -ne 1) { return $false }
    $script:SystemDohRecoveryDiagnosticSubstage = 'engine-config-arguments'
    if (-not (Test-SystemDohConfigArgument -Arguments ([string]$children[0].CommandLine) -ExpectedConfig $proof.config)) { return $false }
    $script:SystemDohRecoveryDiagnosticSubstage = 'process-birth-and-image'
    foreach ($item in @($wrappers[0], $children[0])) {
      $held = Get-Process -Id ([int]$item.ProcessId) -ErrorAction Stop
      $handles += $held
      [void]$held.Handle
      if ($held.HasExited -or
          [Math]::Abs(($held.StartTime.ToUniversalTime() - ([DateTime]$item.CreationDate).ToUniversalTime()).TotalMilliseconds) -gt 2 -or
          -not [string]::Equals([string]$held.MainModule.FileName, [string]$item.ExecutablePath, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    }
    $script:SystemDohRecoveryDiagnosticSubstage = 'owned-dns-listeners'
    $listeners = @($proof.configuration.inbounds | Where-Object { [int]$_.port -eq 53 })
    if ($listeners.Count -eq 0) { return $false }
    $udp = @(Get-CimInstance -Namespace 'root/StandardCimv2' -ClassName MSFT_NetUDPEndpoint -Filter 'LocalPort=53' -OperationTimeoutSec 3 -ErrorAction Stop)
    $tcp = @(Get-CimInstance -Namespace 'root/StandardCimv2' -ClassName MSFT_NetTCPConnection -Filter 'LocalPort=53 AND State=2' -OperationTimeoutSec 3 -ErrorAction Stop)
    foreach ($listener in $listeners) {
      $ip = $null
      if (-not [Net.IPAddress]::TryParse([string]$listener.listen, [ref]$ip) -or -not [Net.IPAddress]::IsLoopback($ip)) { return $false }
      $address = $ip.ToString()
      $wildcard = if ($ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) { '0.0.0.0' } else { '::' }
      foreach ($protocol in @('udp', 'tcp')) {
        $endpoints = if ($protocol -eq 'udp') { $udp } else { $tcp }
        $applicable = @($endpoints | Where-Object { [string]$_.LocalAddress -eq $address -or [string]$_.LocalAddress -eq $wildcard })
        if (@($applicable | Where-Object { [int]$_.OwningProcess -ne [int]$children[0].ProcessId }).Count -gt 0 -or
            @($applicable | Where-Object { [string]$_.LocalAddress -eq $address -and [int]$_.OwningProcess -eq [int]$children[0].ProcessId }).Count -eq 0) { return $false }
      }
    }
    $script:SystemDohRecoveryDiagnosticSubstage = 'final-owned-readback'
    $readback = Get-CimInstance Win32_Service -Filter "Name='EgoistShieldSystemDoH'" -OperationTimeoutSec 3 -ErrorAction Stop
    if (-not $readback -or [string]$readback.State -cne 'Running' -or [int]$readback.ProcessId -ne [int]$service.ProcessId) { return $false }
    foreach ($held in $handles) { if ($held.HasExited) { return $false } }
    if ($receiptHash -and (Get-FileSha256 $receiptPath) -cne $receiptHash) { return $false }
    foreach ($intent in $activationReadback) {
      if ($intent.digest -cne (Get-SystemDohActivationDigest $intent.path)) { return $false }
    }
    if ($ownedDnsReadback -and $ownedDnsReadback.digest -cne (Get-FileSha256 $ownedDnsReadback.path)) { return $false }
    [void](Assert-CurrentPreservedServiceOwnership 'EgoistShieldSystemDoH' -RequirePresent)
    if ($AsEvidence -or $AsLease) {
      $inventory = @($proof.files | ForEach-Object {
        [pscustomobject]@{ path = [string]$_; bytes = [int64]$expected[$_].bytes; sha256 = [string]$expected[$_].sha256 }
      })
      $evidence = [pscustomobject]@{
        schemaVersion = 1; purpose = 'private-dns-payload-continuity'; installationId = [string]$State.installationId
        root = $proof.root; wrapper = $proof.wrapper; engine = $proof.engine; config = $proof.config
        wrapperPid = [int]$wrappers[0].ProcessId; wrapperStartTicks = [string]$handles[0].StartTime.ToUniversalTime().Ticks
        enginePid = [int]$children[0].ProcessId; engineStartTicks = [string]$handles[1].StartTime.ToUniversalTime().Ticks
        files = $inventory
        listeners = @($listeners | ForEach-Object { [string]$_.listen })
        activation = @($activationReadback | ForEach-Object { [pscustomobject]@{path=$_.path;sha256=(Get-FileSha256 $_.path)} })
        ownedDns = $ownedDnsReadback
      }
      if ($AsLease) {
        $transferred = $true
        return [pscustomobject]@{evidence=$evidence;handles=$handles;streams=$streams}
      }
      return $evidence
    }
    return $true
  } catch {
    try { $script:SystemDohRecoveryDiagnosticFailure = New-InstallerFailureDiagnostic -Failure $_ -Substage $script:SystemDohRecoveryDiagnosticSubstage } catch { }
    Write-Verbose 'Private DNS local ownership or restored generation could not be confirmed.'
    return $false
  }
  finally {
    if (-not $transferred) {
      foreach ($held in $handles) { if ($held) { $held.Dispose() } }
      foreach ($stream in $streams) { if ($stream) { $stream.Dispose() } }
    }
  }
}

function Test-PreservedPrivateDnsIntent {
  param([object]$State)
  $enabled = $false
  foreach ($record in @($State.userState | Where-Object { [IO.Path]::GetFileName([string]$_.source) -eq 'egoistshield-state.json' })) {
    $saved = Join-Path (Join-Path $StageDirectory 'user-state') ([string]$record.backupName)
    if ((Get-FileSha256 $saved) -cne [string]$record.sha256) { throw 'Private DNS intent snapshot checksum changed.' }
    $document = Get-Content -LiteralPath $saved -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $settings = if ($document.PSObject.Properties['settings']) { $document.settings } else { $document }
    if ($settings.PSObject.Properties['systemDohEnabled']) {
      if ($settings.systemDohEnabled -ne $true) { return $false }
      $enabled = $true
    }
  }
  return $enabled
}

function Assert-SystemDohPayloadContinuity {
  param([object]$State, [object]$Evidence = $null)
  $script:PayloadContinuityDiagnosticSubstage = 'preserved-private-intent'
  if (-not $State.PSObject.Properties['payloadContinuity'] -or -not $State.payloadContinuity -or
      -not (Test-PreservedPrivateDnsIntent -State $State)) { throw 'Private DNS payload continuity is not authorized by preserved enabled intent.' }
  $script:PayloadContinuityDiagnosticSubstage = 'runtime-proof'
  $actual = if ($Evidence) { $Evidence } else { Test-OwnedSystemDohRecoveryRuntime -State $State -PreservedRuntimeRecovery -AsEvidence }
  $expected = $State.payloadContinuity
  if ($actual -is [bool] -or -not $actual) {
    $proofSubstage = Get-Variable -Name SystemDohRecoveryDiagnosticSubstage -Scope Script -ErrorAction SilentlyContinue
    if ($proofSubstage) { $script:PayloadContinuityDiagnosticSubstage = [string]$proofSubstage.Value }
    throw 'Private DNS payload continuity local ownership is unverified.'
  }
  $script:PayloadContinuityDiagnosticSubstage = 'held-runtime-generation'
  foreach ($field in @('schemaVersion','purpose','installationId','root','wrapper','engine','config','wrapperPid','wrapperStartTicks','enginePid','engineStartTicks')) {
    if ([string]$actual.$field -cne [string]$expected.$field) { throw 'Private DNS payload continuity generation changed.' }
  }
  if (@($expected.files).Count -ne 4 -or @($actual.files).Count -ne 4) { throw 'Private DNS payload continuity inventory changed.' }
  $fixed = @('config.json','service-wrapper\egoistshield-system-doh-service.exe','service-wrapper\egoistshield-system-doh-service.xml','runtime\xray-system-doh.exe')
  foreach ($relative in $fixed) {
    if (@($expected.files | Where-Object { [string]$_.path -ceq $relative }).Count -ne 1) { throw 'Private DNS payload continuity inventory is ambiguous.' }
  }
  foreach ($file in @($expected.files)) {
    $match = @($actual.files | Where-Object { [string]$_.path -ceq [string]$file.path })
    if ($match.Count -ne 1 -or [int64]$match[0].bytes -ne [int64]$file.bytes -or [string]$match[0].sha256 -cne [string]$file.sha256) {
      throw 'Private DNS payload continuity file generation changed.'
    }
  }
  return $actual
}

function Get-SystemDohPayloadContinuityLease {
  param([object]$State)
  $lease = Test-OwnedSystemDohRecoveryRuntime -State $State -PreservedRuntimeRecovery -AsLease
  if (-not $lease -or $lease -is [bool]) { throw 'Private DNS commit generation could not be leased.' }
  try { [void](Assert-SystemDohPayloadContinuity -State $State -Evidence $lease.evidence); return $lease }
  catch { Close-SystemDohRuntimeLease -Lease $lease; throw }
}

function Close-SystemDohRuntimeLease {
  param([object]$Lease, [switch]$RuntimeFilesOnly)
  if (-not $Lease) { return }
  if ($RuntimeFilesOnly) {
    for ($index=0; $index -lt 4; $index++) { if ($Lease.streams[$index]) { $Lease.streams[$index].Dispose(); $Lease.streams[$index]=$null } }
    return
  }
  foreach ($handle in @($Lease.handles)) { if ($handle) { $handle.Dispose() } }
  foreach ($stream in @($Lease.streams)) { if ($stream) { $stream.Dispose() } }
}

function Invoke-PayloadContinuityProbe {
  $script:PayloadContinuityDiagnosticSubstage = 'privileged-token'
  if (-not (Test-IsAdministrator)) { throw 'Private DNS continuity probe requires the protected installer token.' }
  $script:PayloadContinuityDiagnosticSubstage = 'protected-boot-receipt'
  $boot = Assert-InstallerMaintenanceBootRecovery -StageDirectory $StageDirectory
  if ($boot.verified -ne $true -or $boot.owner -ne 'EgoistShield') { throw 'Private DNS continuity stage is unverified.' }
  $script:PayloadContinuityDiagnosticSubstage = 'protected-recovery-snapshot'
  $state = Get-ValidatedMaintenanceRecoveryState -Stage $StageDirectory
  $script:PayloadContinuityDiagnosticSubstage = 'active-maintenance-owner'
  if ($state.handoffStarted -ne $true -or -not (Test-InstallerServiceMaintenanceOwner)) { throw 'Private DNS continuity transaction is not active.' }
  return Assert-SystemDohPayloadContinuity -State $state
}

function Start-PreservedServices {
  param([object]$State, [switch]$PreservedRuntimeRecovery)
  $runningNames = @($State.services | Where-Object { $_.wasRunning -eq $true -and $_.startMode -ne "Disabled" } | ForEach-Object { [string]$_.name })
  $core = @($State.services | Where-Object { $_.name -eq "EgoistShieldCore" })
  $startCore = $core.Count -eq 0 -or ($core[0].wasRunning -eq $true -and $core[0].startMode -ne "Disabled")
  $startOrder = @("EgoistShieldSystemDoH", "EgoistShieldGravitylessDNS", "EgoistShieldZapret", "EgoistShieldTelegramProxy", "EgoistShieldVpn")
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
    if ($name -eq "EgoistShieldSystemDoH") {
      if (-not (Test-OwnedSystemDohRecoveryRuntime -State $State -PreservedRuntimeRecovery:$PreservedRuntimeRecovery)) {
        throw "SystemDoH local ownership or restored runtime could not be confirmed before network services started."
      }
      if (Test-LoopbackDnsReady -State $State) {
        if (@($State.criticalDns).Count -gt 0) { Restore-CriticalAdapterDns -State $State }
      } else {
        Add-ReceiptEvent -Stage 'recovery' -Status 'private-dns-degraded' -Message 'Private upstream is unavailable; the exact owned local resolver was restored. Core and preserved services may start without changing adapter DNS.'
      }
    }
    if ($name -eq 'EgoistShieldTelegramProxy') {
      $componentRoot = Join-Path $script:RuntimeRoot 'TelegramProxy'
      $config = Get-Content -LiteralPath (Join-Path $componentRoot 'config.json') -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      $wrapper = Join-Path $componentRoot 'service-wrapper\egoistshield-telegram-proxy-service.exe'
      if (-not (Wait-OwnedTelegramProxyReady -ExpectedWrapper $wrapper -Port ([int]$config.port) -HostAddress ([string]$config.host))) {
        throw 'Telegram Proxy did not confirm an owned listener after reinstall; a foreign listener is not readiness.'
      }
    }
    if ($name -eq 'EgoistShieldVpn' -and -not (Wait-OwnedVpnReady)) {
      throw 'VPN did not confirm its owned local SOCKS listener after reinstall; SCM Running alone is not readiness.'
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
    Resume-OwnedGuiLoginStartup
    Add-ReceiptEvent -Stage 'recovery' -Status 'recovery-not-needed' -Message 'Update failed before service handoff; no services or DNS were stopped.'
    return $true
  }
  if ($State.PSObject.Properties['handoffStarted'] -and $State.handoffStarted -eq $true -and
      $maintenanceStatus -eq 'absent') {
    Resume-OwnedGuiLoginStartup
    Add-ReceiptEvent -Stage 'recovery' -Status 'recovery-not-needed' -Message 'The service maintenance transaction is already closed; its preserved snapshot must not be replayed.'
    return $true
  }
  Add-ReceiptEvent -Stage "recovery" -Status "recovering" -Message $Reason
  $recoveryErrors = @()
  try { Stop-OwnedServiceForInstall -Name "EgoistShieldCore" } catch { $recoveryErrors += "stop-core: $($_.Exception.Message)" }
  try {
    $keepPrivateRuntime = $State.PSObject.Properties['payloadContinuity'] -and $State.payloadContinuity -and
      (-not $State.PSObject.Properties['dnsMigrationStarted'] -or $State.dnsMigrationStarted -ne $true)
    if ($keepPrivateRuntime) { [void](Assert-SystemDohPayloadContinuity -State $State) }
    Stop-PreservedWrappersForRecovery -State $State -PreserveSystemDohRuntime:$keepPrivateRuntime
    Restore-PreservedState -State $State -PreserveSystemDohRuntime:$keepPrivateRuntime
  } catch { $recoveryErrors += "restore: $($_.Exception.Message)" }
  try { Reconcile-PreservedZapretProfile -State $State } catch { $recoveryErrors += "zapret-profile: $($_.Exception.Message)" }
  try { Restore-InstalledIdentity -State $State } catch { $recoveryErrors += "identity: $($_.Exception.Message)" }
  $payloadRollbackPending = Test-PayloadRollbackPending
  if ($payloadRollbackPending) { $recoveryErrors += 'payload-rollback-pending: Previous application files are preserved in quarantine; application rollback is not yet confirmed.' }
  try {
    Restore-PreservedServiceStartModes -State $State
    Start-PreservedServices -State $State -PreservedRuntimeRecovery
  } catch { $recoveryErrors += "services: $($_.Exception.Message)" }
  $activePrivateRuntime = @($State.services | Where-Object { $_.name -eq 'EgoistShieldSystemDoH' -and $_.wasRunning -eq $true }).Count -gt 0
  $localRuntimeVerified = -not $activePrivateRuntime -or (Test-OwnedSystemDohRecoveryRuntime -State $State -PreservedRuntimeRecovery)
  if (-not $localRuntimeVerified) { $recoveryErrors += 'dns-private-degraded: Active SystemDoH local ownership or exact restored generation could not be confirmed.' }
  if (Test-LoopbackDnsReady -State $State) {
    if ($localRuntimeVerified -and $State.PSObject.Properties['criticalDns'] -and @($State.criticalDns).Count -gt 0) {
      try { Restore-CriticalAdapterDns -State $State } catch { $recoveryErrors += "dns-adapter: $($_.Exception.Message)" }
    }
  } else {
    # The preserved private runtime and activation state were restored above.
    # Upstream unavailability does not authorize changing the user's DNS
    # operator. Keep current adapter DNS and leave this transaction pending
    # for verified private recovery; explicit DNS reset/off retains its path.
    if ($recoveryErrors.Count -eq 0 -and $localRuntimeVerified) {
      Add-ReceiptEvent -Stage 'recovery' -Status 'private-dns-degraded' -Message 'dns-private-degraded: The exact owned private resolver and settings were restored. Current adapter DNS was retained; Core may heal the same private upstream.'
    } else {
      $recoveryErrors += "dns-private-degraded: SystemDoH is not answering and local restoration is unverified; preserved private settings and current adapter DNS were retained without switching to another resolver."
    }
  }
  if ($State.runAfter -ne $false -and -not $payloadRollbackPending) {
    try { Start-InstalledDesktop -State $State } catch { $recoveryErrors += "desktop: $($_.Exception.Message)" }
  }
  if ($recoveryErrors.Count -gt 0) {
    Add-ReceiptEvent -Stage "recovery" -Status "recovery-warning" -Message ($recoveryErrors -join " | ")
    return $false
  } else {
    Complete-InstallerServiceMaintenance
    Add-ReceiptEvent -Stage "recovery" -Status "recovered" -Message "Previously active owned services and DNS settings were restored; private upstream availability is reported separately."
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

function Get-InstallerWatchdogWaitMilliseconds {
  param([DateTime]$Deadline, [ValidateRange(120, 3600)][int]$MaximumSeconds = 1200)
  $remaining = ($Deadline.ToUniversalTime() - [DateTime]::UtcNow).TotalMilliseconds
  return [int64][Math]::Max(0, [Math]::Min($remaining, [int64]$MaximumSeconds * 1000))
}

function Invoke-WatchdogMode {
  if (Test-InstallerTransactionComplete) { return $true }
  [void](Assert-InstallerMaintenanceBootRecovery -StageDirectory $StageDirectory)
  $deadlinePath = Join-Path $StageDirectory "watchdog-deadline.txt"
  $deadline = [DateTime]::Parse((Get-Content -LiteralPath $deadlinePath -Raw), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
  $waitingState = Get-ValidatedMaintenanceRecoveryState -Stage $StageDirectory
  $maximumSeconds = 1200
  if ($waitingState.PSObject.Properties['watchdogTimeoutSeconds']) { $maximumSeconds = [int]$waitingState.watchdogTimeoutSeconds }
  $waitMilliseconds = Get-InstallerWatchdogWaitMilliseconds -Deadline $deadline -MaximumSeconds $maximumSeconds
  $waitingElapsed = [Diagnostics.Stopwatch]::StartNew()
  while ($waitingElapsed.ElapsedMilliseconds -lt $waitMilliseconds) {
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

function Enter-InstallerWorkerLease {
  param([Threading.Mutex]$Mutex, [ValidateRange(0, 1200000)][int]$WaitMilliseconds = 0)
  $elapsed = [Diagnostics.Stopwatch]::StartNew()
  do {
    Assert-InstallerNotCancelled
    $remaining = [Math]::Max(0, $WaitMilliseconds - [int]$elapsed.ElapsedMilliseconds)
    try {
      if ($Mutex.WaitOne([Math]::Min(250, $remaining))) { return $true }
    } catch [Threading.AbandonedMutexException] { return $true }
  } while ($elapsed.ElapsedMilliseconds -lt $WaitMilliseconds)
  return $false
}

function Resolve-PreviousReinstallStage {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { throw 'The inherited installer stage is missing.' }
  $stage = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $base = [IO.Path]::GetFullPath((Join-Path (Get-InstallerCommonDataRoot) 'EgoistShieldInstaller\DeferredRuns')).TrimEnd('\')
  if (-not [string]::Equals([IO.Path]::GetDirectoryName($stage), $base, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($stage) -notmatch '^[a-fA-F0-9]{32}$') {
    throw 'The previous installer stage is outside the canonical observer scope.'
  }
  [void](Assert-PlainWrapperMigrationPath -Path $stage -Root (Get-InstallerCommonDataRoot))
  return $stage
}

function ConvertFrom-PreviousReinstallLaunchPreference {
  param([Parameter(Mandatory=$true)][string]$Json)
  try { $previous = $Json | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'Legacy launch preference state is not valid JSON.' }
  if (-not $previous -or $previous -is [array]) { throw 'Legacy launch preferences require a state object.' }
  $schema = $previous.PSObject.Properties['schemaVersion']
  $owner = $previous.PSObject.Properties['owner']
  $run = $previous.PSObject.Properties['runAfter']
  $minimized = $previous.PSObject.Properties['minimizedAfter']
  if (-not $schema -or ($schema.Value -isnot [int] -and $schema.Value -isnot [long]) -or $schema.Value -ne 1 -or
      -not $owner -or $owner.Value -isnot [string] -or $owner.Value -cne 'EgoistShield' -or
      -not $run -or $run.Value -isnot [bool] -or ($minimized -and $minimized.Value -isnot [bool])) {
    throw 'Legacy launch preferences require schema 1, verified product owner, runAfter boolean and an optional minimizedAfter boolean.'
  }
  # Original 3.7.8 schema 1 did not store a minimized launch preference.
  $minimizedValue = if ($minimized) { $minimized.Value } else { $false }
  return [pscustomobject]@{runAfter=$run.Value; minimizedAfter=$minimizedValue}
}

function Get-PreviousReinstallLaunchPreference {
  param([Parameter(Mandatory=$true)][string]$Stage)
  $previousStage = Resolve-PreviousReinstallStage -Path $Stage
  $statePath = Assert-PlainWrapperMigrationPath -Path (Join-Path $previousStage 'state.json') -Root $previousStage
  $item = Get-Item -LiteralPath $statePath -Force -ErrorAction Stop
  if ($item.PSIsContainer -or $item.Length -le 0 -or $item.Length -gt 4194304) { throw 'Legacy launch preference state is missing, not a file or exceeds 4 MiB.' }
  Assert-InstallerBootRecoveryFileProtection -Path $previousStage -Directory
  Assert-InstallerBootRecoveryFileProtection -Path $statePath
  $stream = [IO.File]::Open($statePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try {
    if ($stream.Length -le 0 -or $stream.Length -gt 4194304) { throw 'Legacy launch preference state exceeds its read limit.' }
    $reader = [IO.StreamReader]::new($stream,[Text.UTF8Encoding]::new($false,$true),$true,4096,$true)
    try { $json = $reader.ReadToEnd() } finally { $reader.Dispose() }
    return ConvertFrom-PreviousReinstallLaunchPreference -Json $json
  } finally { $stream.Dispose() }
}

function Test-PreviousReinstallProcess {
  param([object]$Process, [string]$Stage, [string]$PowerShellPath)
  if (-not [string]::Equals([string]$Process.ExecutablePath, $PowerShellPath, [StringComparison]::OrdinalIgnoreCase)) { return $false }
  $scriptPath = Join-Path $Stage 'invoke-final-silent-reinstall.ps1'
  $scriptArgument = [regex]::Escape($scriptPath)
  $stageArgument = [regex]::Escape($Stage)
  $command = [string]$Process.CommandLine
  return $command -match ('(?i)(?:^|\s)-File\s+(?:"' + $scriptArgument + '"|' + $scriptArgument + ')(?=\s|$)') -and
    $command -match '(?i)(?:^|\s)-(?:Worker|Watchdog)(?=\s|$)' -and
    $command -match ('(?i)(?:^|\s)-StageDirectory\s+(?:"' + $stageArgument + '"|' + $stageArgument + ')(?=\s|$)')
}

function Wait-PreviousReinstallProcesses {
  param([string]$Stage, [ValidateRange(1, 60000)][int]$WaitMilliseconds = 60000)
  $stage = Resolve-PreviousReinstallStage $Stage
  $powerShell = Get-NativePowerShellPath
  $elapsed = [Diagnostics.Stopwatch]::StartNew()
  do {
    Assert-InstallerNotCancelled
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -Property ProcessId,ExecutablePath,CommandLine -OperationTimeoutSec 3 -ErrorAction Stop |
      Where-Object { Test-PreviousReinstallProcess -Process $_ -Stage $stage -PowerShellPath $powerShell })
    if ($processes.Count -eq 0) { return }
    if ($processes.Count -gt 8) { throw 'Too many previous installer observers; the new handoff has not started.' }
    Start-Sleep -Milliseconds 250
  } while ($elapsed.ElapsedMilliseconds -lt $WaitMilliseconds)
  throw 'Previous installer worker or watchdog is still active; the new handoff has not started.'
}

function Assert-PreviousReinstallRestored {
  param([object]$State)
  foreach ($record in @($State.services)) {
    if ([string]$record.startMode -eq 'Auto' -and $record.wasRunning -ne $true) {
      throw "Previous installer did not restore automatic service $($record.name); the new handoff has not started."
    }
  }
  if (-not (Test-LoopbackDnsReady -State $State)) {
    throw 'Previous installer did not restore the local DNS path; the new handoff has not started.'
  }
}

function Invoke-WorkerMode {
  if (-not (Test-IsAdministrator)) { throw "Deferred reinstall worker requires an elevated administrator token." }
  Assert-SupportedServiceFramework
  $statePath = Join-Path $StageDirectory "state.json"
  $state = Get-Content -LiteralPath $statePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  $release = Get-ValidatedRelease -Installer ([string]$state.installer) -Manifest ([string]$state.manifest) -Version ([string]$state.version) -Sha256 ([string]$state.sha256) -AllowStagedPair
  $mutex = New-Object Threading.Mutex($false, "Global\EgoistShield.DeferredReinstall")
  $previousWait = 0
  if ($state.PSObject.Properties['previousReinstallWaitMilliseconds']) {
    $previousWait = [int]$state.previousReinstallWaitMilliseconds
  }
  try { $acquired = Enter-InstallerWorkerLease -Mutex $mutex -WaitMilliseconds $previousWait }
  catch { $mutex.Dispose(); throw }
  if (-not $acquired) {
    Add-ReceiptEvent -Stage "worker" -Status "failed" -Message "Another protected Egoist Shield reinstall is already running."
    Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "dispatch-failed" -Encoding ASCII -Force
    $mutex.Dispose()
    throw "Another deferred Egoist Shield reinstall is already running."
  }
  try {
    Add-ReceiptEvent -Stage "worker" -Status "waiting" -Message "Validated elevated worker is waiting before the final handoff."
    if ($previousWait -gt 0) { Wait-PreviousReinstallProcesses -Stage ([string]$state.previousReinstallStage) }
    Start-Sleep -Seconds ([int]$state.delaySeconds)
    Assert-InstallerNotCancelled
    Resume-InterruptedServiceMaintenance
    $state.handoffStarted = $false
    $state.services = @(Get-OwnedServiceSnapshot -Stage $StageDirectory)
    $state.userState = @(Backup-UserActivationState -Stage $StageDirectory)
    $state.criticalDns = @(Backup-CriticalDnsState -Stage $StageDirectory)
    if ($previousWait -gt 0) { Assert-PreviousReinstallRestored -State $state }
    $state.installationId = Get-InstalledIdentity
    $state.zapretProfile = [string](Get-ItemProperty -LiteralPath "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\EgoistShieldZapret" -Name EgoistShieldProfile -ErrorAction SilentlyContinue).EgoistShieldProfile
    Invoke-RobocopyDirectory -Source $script:RuntimeRoot -Destination (Join-Path $StageDirectory "runtime-backup")
    Write-JsonAtomic -Path $statePath -Value $state
    $deadline = [DateTime]::UtcNow.AddSeconds([int]$state.watchdogTimeoutSeconds).ToString("o")
    Set-Content -LiteralPath (Join-Path $StageDirectory "watchdog-deadline.txt") -Value $deadline -Encoding ASCII -Force
    Write-Heartbeat -Stage $StageDirectory -Phase "preparing"
    Protect-InstallerStageTree -Stage $StageDirectory
    [void](Register-InstallerMaintenanceBootRecovery -StageDirectory $StageDirectory)
    $keepDns = @($state.services | Where-Object { $_.name -eq 'EgoistShieldSystemDoH' -and $_.wasRunning -eq $true }).Count -gt 0 -and
      (Test-PreservedPrivateDnsIntent -State $state)
    if ($keepDns) {
      $continuity = Test-OwnedSystemDohRecoveryRuntime -State $state -PreservedRuntimeRecovery -AsEvidence
      if (-not $continuity -or $continuity -is [bool]) { throw 'The running private resolver could not be pinned before handoff; no payload mutation was started.' }
      $state | Add-Member -NotePropertyName payloadContinuity -NotePropertyValue $continuity -Force
      Write-JsonAtomic -Path $statePath -Value $state
    }
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
    $quiescentServices = if ($keepDns) { @($state.services | Where-Object { $_.name -ne 'EgoistShieldSystemDoH' }) } else { @($state.services) }
    Suspend-InstallerServiceRestarts -Records $quiescentServices -SnapshotPath $statePath -OwnPath {
      param($path) Test-OwnedServicePath $path
    } -StopCore { param($name) Stop-OwnedServiceForInstall -Name $name }
    foreach ($name in @($state.services | Where-Object { $_.name -notin @("EgoistShieldCore", "EgoistShieldSystemDoH") } | ForEach-Object { $_.name })) {
      Assert-InstallerNotCancelled
      Stop-OwnedServiceForInstall -Name $name
    }
    if ($keepDns) {
      [void](Assert-SystemDohPayloadContinuity -State $state)
      Add-ReceiptEvent -Stage 'handoff' -Status 'dns-preserved' -Message 'The exact independently installed private resolver remains running through payload publication.'
    } else {
      Stop-OwnedServiceForInstall -Name 'EgoistShieldSystemDoH'
      Add-ReceiptEvent -Stage 'handoff' -Status 'dns-stopped' -Message 'No enabled running private resolver was selected for continuity; optional service handoff is starting.'
    }
    Assert-InstallerNotCancelled
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
    Restore-PreservedState -State $state -PreserveSystemDohRuntime:$keepDns
    Update-PreservedRuntimeReliability -State $state -PreserveSystemDohRuntime:$keepDns
    Update-PreservedServiceWrappers -State $state -PreserveSystemDohRuntime:$keepDns
    Reconcile-PreservedZapretProfile -State $state
    Restore-InstalledIdentity -State $state
    Restore-PreservedServiceStartModes -State $state
    $dnsMigrationDeferred = $false
    if ($keepDns) { $dnsMigrationDeferred = -not (Invoke-SystemDohRuntimeMigration -State $state) }
    else { Write-VerifiedSystemDohRecoveryRuntime -State $state }
    $state | Add-Member -NotePropertyName dnsMigrationDeferred -NotePropertyValue $dnsMigrationDeferred -Force
    Write-JsonAtomic -Path $statePath -Value $state
    Start-PreservedServices -State $state -PreservedRuntimeRecovery:$dnsMigrationDeferred
    $installedExe = Join-Path $script:OwnedInstallRoot "EgoistShield.exe"
    if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) { throw "Installed EgoistShield.exe is missing." }
    $installedVersion = [string](Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion
    if ($installedVersion -notlike "$($state.version)*") { throw "Installed version is $installedVersion, expected $($state.version)." }
    if (@($state.services | Where-Object { $_.name -eq 'EgoistShieldSystemDoH' -and $_.wasRunning -eq $true }).Count -gt 0 -and
        -not (Test-OwnedSystemDohRecoveryRuntime -State $state -PreservedRuntimeRecovery:$dnsMigrationDeferred)) { throw "Installed SystemDoH local ownership or verified runtime did not pass readback." }
    $privateUpstreamReady = Test-LoopbackDnsReady -State $state
    if ($privateUpstreamReady) {
      Restore-CriticalAdapterDns -State $state
      if (-not (Test-LoopbackDnsReady -State $state)) { throw "Restored adapter DNS did not pass readback." }
    } elseif (Test-OwnedSystemDohRecoveryRuntime -State $state -PreservedRuntimeRecovery:$dnsMigrationDeferred) {
      Add-ReceiptEvent -Stage 'verify' -Status 'private-dns-degraded' -Message 'dns-private-degraded: Installed owned private runtime passed local generation and ownership checks; the private upstream is currently unavailable. Adapter DNS was retained and Core may recover the same operator.'
    } else { throw "Installed SystemDoH local ownership or verified runtime did not pass readback." }
    Complete-InstallerServiceMaintenance
    [void](Unregister-InstallerMaintenanceBootRecovery -StageDirectory $StageDirectory -RestorationVerified:$true)
    if ($state.runAfter -ne $false) { Start-InstalledDesktop -State $state }
    Add-ReceiptEvent -Stage "verify" -Status "succeeded" -Message "Installer, version, Core and owned private runtime passed readback; private upstream availability and deferred migration were reported separately." -Data @{ installedVersion = $installedVersion; privateUpstreamReady = $privateUpstreamReady; dnsMigrationDeferred = $dnsMigrationDeferred }
    $updateMessage = if ($privateUpstreamReady) { "Обновление до $installedVersion установлено; службы и DNS проверены." } else { "Обновление до $installedVersion установлено; службы восстановлены. Приватный DNS ожидает доступности сервера без смены оператора." }
    Write-DesktopUpdateResult -State $state -Ok $true -Message $updateMessage
    Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "success" -Encoding ASCII -Force
  } catch {
    $primaryWorkerError = $_
    $primaryWorkerReason = [string]$primaryWorkerError.Exception.Message
    try {
      Add-ReceiptEvent -Stage 'worker' -Status 'failed' -Message $primaryWorkerReason -Data @{ errorId = [string]$primaryWorkerError.FullyQualifiedErrorId }
    } catch { Write-Warning ("Original worker failure could not be persisted: " + $primaryWorkerReason + " | receipt: " + $_.Exception.Message) }
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
        $recoveryComplete = Invoke-InstallerRecoveryAttempts -State $state -Reason $primaryWorkerReason -Attempts 2 -RetrySeconds 2
      } else {
        $recoveryComplete = $true
      }
      Write-DesktopUpdateResult -State $state -Ok $false -Message "Обновление не завершилось. Результат восстановления служб и DNS сохранён в журнале установки."
    } catch {
      $secondaryReason = [string]$_.Exception.Message
      try { Add-ReceiptEvent -Stage 'fatal' -Status 'failed' -Message $secondaryReason -Data @{ primaryFailure = $primaryWorkerReason } }
      catch { Write-Warning ("Worker recovery failure could not be persisted: " + $secondaryReason + " | primary: " + $primaryWorkerReason) }
    }
    try {
      if ($recoveryComplete -eq $true -and -not (Test-InstallerServiceMaintenanceOwner)) {
        [void](Unregister-InstallerMaintenanceBootRecovery -StageDirectory $StageDirectory -RestorationVerified:$true)
        Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "failed-recovered" -Encoding ASCII -Force
      } else {
        Write-PendingInstallerRecovery -Reason ("Worker stopped before verified recovery; watchdog/boot recovery must retry. Primary failure: " + $primaryWorkerReason) -Attempts 2
      }
    } catch {
      $secondaryReason = [string]$_.Exception.Message
      try { Add-ReceiptEvent -Stage 'worker-finalization' -Status 'failed' -Message $secondaryReason -Data @{ primaryFailure = $primaryWorkerReason } }
      catch { Write-Warning ("Worker finalization failure could not be persisted: " + $secondaryReason + " | primary: " + $primaryWorkerReason) }
    }
    throw $primaryWorkerError
  } finally {
    try { $mutex.ReleaseMutex() } catch { Write-Verbose "Deferred reinstall mutex was not owned: $($_.Exception.Message)" }
    $mutex.Dispose()
  }
}

if ($ProbePayloadContinuity) {
  $StageDirectory = Resolve-FullPath -Path $StageDirectory -MustExist
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $script:PayloadContinuityDiagnosticSubstage = 'probe-start'
  $script:SystemDohRecoveryDiagnosticFailure = $null
  try {
    $result = Invoke-PayloadContinuityProbe | ConvertTo-Json -Depth 8 -Compress
    if ([Text.Encoding]::UTF8.GetByteCount($result) -gt 65536) { throw 'Continuity proof exceeds its output limit.' }
    [Console]::Out.WriteLine($result)
    exit 0
  }
  catch {
    $probeFailure = $_
    $diagnosticJson = '{"schemaVersion":1,"purpose":"private-dns-payload-continuity-failure","exceptionType":"System.InvalidOperationException","errorId":"ContinuityDiagnosticUnavailable","line":0,"substage":"probe-diagnostic","errorMessage":"Private DNS payload continuity ownership could not be confirmed."}'
    try {
      $diagnostic = $null
      $proofFailure = Get-Variable -Name SystemDohRecoveryDiagnosticFailure -Scope Script -ErrorAction SilentlyContinue
      if ($proofFailure -and $proofFailure.Value) { $diagnostic = $proofFailure.Value }
      if (-not $diagnostic) { $diagnostic = New-InstallerFailureDiagnostic -Failure $probeFailure -Substage $script:PayloadContinuityDiagnosticSubstage }
      $candidateJson = $diagnostic | ConvertTo-Json -Depth 4 -Compress
      if ([Text.Encoding]::UTF8.GetByteCount($candidateJson) -le 8192) { $diagnosticJson = $candidateJson }
    } catch { }
    try { [Console]::Error.WriteLine($diagnosticJson) } catch { }
    exit 2
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
    $outerWorkerError = $_
    if (-not (Test-Path -LiteralPath (Join-Path $StageDirectory "complete.flag")) -and -not (Test-InstallerServiceMaintenanceOwner)) {
      try {
        Add-ReceiptEvent -Stage "worker" -Status "failed" -Message ([string]$outerWorkerError.Exception.Message)
      } catch {
        Write-Warning "Worker receipt could not be recorded: $($_.Exception.Message)"
        Write-BrandedInstallerStatus -Stage "worker" -Status "failed" -Message ([string]$outerWorkerError.Exception.Message)
      }
      try {
        Set-Content -LiteralPath (Join-Path $StageDirectory "complete.flag") -Value "worker-failed" -Encoding ASCII -Force
      } catch { Write-Warning "Worker failure could not be recorded: $($_.Exception.Message)" }
    }
    throw $outerWorkerError
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

if ($WaitForPreviousReinstall -and (-not $EmbeddedRelease -or -not (Test-IsAdministrator))) {
  throw 'Waiting for a legacy installer is restricted to the embedded elevated Setup entrypoint.'
}
$previousReinstallStage = ''
$previousLaunchPreferences = $null
if ($WaitForPreviousReinstall) {
  $previousReinstallStage = Resolve-PreviousReinstallStage $env:EGOIST_PROTECTED_REINSTALL_STAGE
  $previousLaunchPreferences = Get-PreviousReinstallLaunchPreference -Stage $previousReinstallStage
}
$runningMutex = New-Object Threading.Mutex($false, "Global\EgoistShield.DeferredReinstall")
try {
  try { $previousAvailable = $runningMutex.WaitOne(0) }
  catch [Threading.AbandonedMutexException] { $previousAvailable = $true }
  if ($previousAvailable) {
    $runningMutex.ReleaseMutex()
    if ($WaitForPreviousReinstall) { throw 'There is no active installer to hand off from.' }
  } elseif (-not $WaitForPreviousReinstall) {
    throw "Защищённая переустановка Egoist Shield уже выполняется."
  }
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
$minimizedAfterValue = [bool]$MinimizedAfter
if ($WaitForPreviousReinstall) {
  $runAfter = $previousLaunchPreferences.runAfter
  $minimizedAfterValue = $previousLaunchPreferences.minimizedAfter -or [bool]$MinimizedAfter
}
if (-not [string]::IsNullOrWhiteSpace($RunAfterPath)) {
  if (-not $brandedUi) { throw "RunAfterPath requires branded installer handoff." }
  $RunAfterPath = Resolve-FullPath -Path $RunAfterPath -MustExist -Leaf
  if ([IO.Path]::GetFileName($RunAfterPath) -ne "run_after.txt" -or
      [IO.Path]::GetDirectoryName($RunAfterPath) -ne [IO.Path]::GetDirectoryName($HandoffSignalPath)) {
    throw "Installer launch preference path is invalid."
  }
  $runAfterValue = ([IO.File]::ReadAllText($RunAfterPath, [Text.Encoding]::UTF8)).Trim()
  if ($runAfterValue -notin @("0", "1")) { throw "Installer launch preference is invalid." }
  if ($WaitForPreviousReinstall) { $runAfter = $runAfter -and ($runAfterValue -eq "1") }
  else { $runAfter = $runAfterValue -eq "1" }
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
  $elevatedPreparation = $null
  try {
    $elevatedPreparation = Start-Process -FilePath (Get-NativePowerShellPath) -ArgumentList $dispatchCommandLine -Verb RunAs -WindowStyle Hidden -PassThru -ErrorAction Stop
    $preparationExitCode = Wait-InstallerElevatedPreparation -Process $elevatedPreparation
    if ($preparationExitCode -ne 0) { exit $preparationExitCode }
    [pscustomobject]@{ dispatched = $true; elevatedPreparationCompleted = $true; version = $release.version } | ConvertTo-Json
    exit 0
  } finally {
    if ($null -ne $elevatedPreparation) { $elevatedPreparation.Dispose() }
  }
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
$guiStartupHash = Get-FileSha256 $script:GuiLoginStartupScript
$stagedGuiStartup = Join-Path $StageDirectory "gui-login-startup.ps1"
Copy-Item -LiteralPath $script:GuiLoginStartupScript -Destination $stagedGuiStartup -Force -ErrorAction Stop
if ((Get-FileSha256 $stagedGuiStartup) -cne $guiStartupHash -or (Get-FileSha256 $script:GuiLoginStartupScript) -cne $guiStartupHash) { throw "Staged GUI login startup helper failed immutable SHA-256 readback." }
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
  minimizedAfter = $minimizedAfterValue
  fromVersion = $FromVersion
  watchdogTimeoutSeconds = $WatchdogTimeoutSeconds
  previousReinstallWaitMilliseconds = $(if ($WaitForPreviousReinstall) { 1200000 } else { 0 })
  previousReinstallStage = $previousReinstallStage
  guiLoginStartupHelperSha256 = $guiStartupHash
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
    $readyElapsed = [Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-Path -LiteralPath $readyFlag -PathType Leaf)) {
      if ($uiProcess.HasExited) { throw "Branded installer window exited before it became ready." }
      if ($readyElapsed.Elapsed.TotalSeconds -ge 15) { throw "Branded installer window did not become ready." }
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
