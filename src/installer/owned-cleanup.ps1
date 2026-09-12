param(
  [ValidateSet("PreInstall", "PostInstall", "VerifyInstall", "Uninstall", "RollbackUpgrade", "Recover", "FreeFiles", "GuardFiles", "StartServices", "InstallCoreService", "RegistrationSelfTest", "QuarantineRetrySelfTest", "SelfTest")]
  [string]$Phase = "PreInstall",
  [string]$InstallRoot = "",
  # Для фазы StartServices: имена служб, которые работали до установки.
  [string[]]$Services = @(),
  # GuardFiles живёт, пока существует процесс-владелец и не появился stop-file.
  [int]$GuardPid = 0,
  [string]$GuardStopFile = "",
  [ValidateRange(1, 1800)]
  [int]$GuardMaxSeconds = 600
)

# ============================================================================
# Ownership-aware очистка Egoist Shield.
#
# Правило, которое нельзя ослаблять: НИ ОДНА служба, процесс, драйвер, ярлык
# или каталог не останавливается и не удаляется по одному лишь имени, если это
# имя может принадлежать чужому продукту. Обязательно доказательство владения:
#   * исполняемый путь службы (ImagePath) или процесса (ExecutablePath) лежит
#     внутри owned root;
#   * либо имя принадлежит эксклюзивному пространству имён EgoistShield*,
#     которое чужие продукты не используют.
#
# Второе правило: обновление транзакционно. Прошлая установка переносится в
# карантин, новая проверяется, и только после успешной проверки карантин
# удаляется. При любой ошибке карантин возвращается на место.
# ============================================================================

$ErrorActionPreference = "Continue"
$installRoot = if ($InstallRoot) {
  $sanitizedParam = [string]$InstallRoot
  $sanitizedParam = $sanitizedParam.Trim("`t`r`n `"`'").Trim([char]0xFEFF)
  [System.IO.Path]::GetFullPath($sanitizedParam).TrimEnd("\")
} else {
  Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

<#
.SYNOPSIS
  Переменная окружения с гарантированным непустым значением.
.DESCRIPTION
  NSIS и SCM запускают скрипт в урезанном окружении: ProgramData, LOCALAPPDATA
  или APPDATA могут отсутствовать. Раньше Join-Path на $null падал ещё на
  формировании списка owned roots, список оставался пустым, и КАЖДАЯ проверка
  владения возвращала «не наше» — то есть очистка тихо не делала ничего,
  а карантин и rollback не работали вовсе. Fallback через Environment
  +SpecialFolder и SystemDrive убирает этот класс отказа.
#>
function Get-EnvPath {
  param(
    [string]$Name,
    [System.Environment+SpecialFolder]$SpecialFolder,
    [string]$RelativeToSystemDrive
  )
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ($value) { return $value }
  if ($SpecialFolder) {
    try {
      $resolved = [Environment]::GetFolderPath($SpecialFolder)
      if ($resolved) { return $resolved }
    } catch {
      # Ниже остаётся жёсткий fallback на системный диск.
    }
  }
  if ($RelativeToSystemDrive) {
    $drive = [Environment]::GetEnvironmentVariable("SystemDrive")
    if (-not $drive) { $drive = "C:" }
    return (Join-Path $drive $RelativeToSystemDrive)
  }
  return $null
}

$programDataRoot = Get-EnvPath "ProgramData" ([Environment+SpecialFolder]::CommonApplicationData) "ProgramData"

# UAC can run this script under a different administrator token.  In that
# case APPDATA/LOCALAPPDATA and HKCU describe the administrator profile even
# though the installed application belongs to the interactive user.  Resolve
# that user's profile and SID from the machine's interactive session so
# cleanup and the persisted opt-in state use the same per-user locations as
# the application.  If the session cannot be resolved (for example during a
# service-only recovery), retain the normal environment fallback.
$interactiveUserSid = $null
$interactiveProfileRoot = $null
try {
  $interactiveUserName = [string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName
  if ($interactiveUserName) {
    $interactiveUserSid = ([System.Security.Principal.NTAccount]$interactiveUserName).Translate(
      [System.Security.Principal.SecurityIdentifier]).Value
    $profileKey = "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$interactiveUserSid"
    $profileValue = (Get-ItemProperty -LiteralPath $profileKey -Name ProfileImagePath -ErrorAction Stop).ProfileImagePath
    if ($profileValue) {
      $expandedProfile = [Environment]::ExpandEnvironmentVariables([string]$profileValue)
      if (Test-Path -LiteralPath $expandedProfile -PathType Container) { $interactiveProfileRoot = $expandedProfile }
    }
  }
} catch {
  $interactiveUserSid = $null
  $interactiveProfileRoot = $null
}
$script:shieldUserRegistryRoot = if ($interactiveUserSid) {
  "Registry::HKEY_USERS\$interactiveUserSid"
} else {
  "HKCU:"
}
$localAppDataRoot = if ($interactiveProfileRoot) {
  Join-Path $interactiveProfileRoot "AppData\Local"
} else {
  Get-EnvPath "LOCALAPPDATA" ([Environment+SpecialFolder]::LocalApplicationData) $null
}
$roamingAppDataRoot = if ($interactiveProfileRoot) {
  Join-Path $interactiveProfileRoot "AppData\Roaming"
} else {
  Get-EnvPath "APPDATA" ([Environment+SpecialFolder]::ApplicationData) $null
}

function Join-IfSet {
  param([string]$Base, [string]$Child)
  if (-not $Base) { return $null }
  return (Join-Path $Base $Child)
}

$ownedRoots = @(
  $installRoot,
  (Join-IfSet $programDataRoot "EgoistShield"),
  (Join-IfSet $localAppDataRoot "EgoistShield"),
  (Join-IfSet $localAppDataRoot "Egoist Shield"),
  (Join-IfSet $roamingAppDataRoot "EgoistShield"),
  (Join-IfSet $roamingAppDataRoot "Egoist Shield")
) | Where-Object { $_ } | ForEach-Object {
  try { [System.IO.Path]::GetFullPath($_).TrimEnd("\") } catch { $null }
} | Where-Object { $_ } | Select-Object -Unique
# Один элемент PowerShell вернул бы строкой, и foreach прошёл бы по символам.
$ownedRoots = @($ownedRoots)

if (-not $ownedRoots -or $ownedRoots.Count -eq 0) {
  # Без owned roots любая проверка владения бессмысленна: лучше явно упасть,
  # чем выполнить очистку с недоказуемым владением.
  Write-Error "Cannot determine EgoistShield-owned roots; refusing to run cleanup."
  exit 40
}

# Эксклюзивное пространство имён: приставка EgoistShield не используется
# сторонними продуктами, поэтому такие службы можно трогать и без ImagePath
# (он может отсутствовать, если запись службы уже повреждена).
$exclusiveServiceNamePattern = '^(EgoistShield|EGISShield)'

$ownedServices = @(
  "EgoistShieldCore",
  "EgoistShieldTelegramProxy",
  "EgoistShieldZapret",
  "EgoistShieldGravitylessDNS",
  "EgoistShieldSystemDoH"
)

$legacyOwnedServices = @(
  "EgoistShieldDNS",
  "EgoistShieldProxy",
  "EGISShieldDNS"
)

# Службы с ОБЩИМ именем: легально принадлежат сторонним продуктам
# (dnscrypt-proxy — самостоятельный OSS-резолвер). Только с ImagePath-proof.
$sharedNameServices = @(
  "dnscrypt-proxy",
  "NetguardDNS"
)

# Процессы с эксклюзивным именем: собственные сборки рантаймов.
$ownedProcesses = @(
  "EgoistShield.Service.exe",
  "egoistshield-telegram-proxy-service.exe",
  "egoistshield-tg-ws-proxy.exe",
  "egoistshield-zapret-service.exe",
  "egoistshield-system-doh-service.exe"
)

# Процессы с ОБЩИМ именем: те же бинарники используют чужие продукты.
# Только после доказательства ExecutablePath внутри owned root.
$sharedNameProcesses = @(
  "winws.exe",
  "dnscrypt-proxy.exe",
  "xray-system-doh.exe",
  "xray.exe",
  "sing-box.exe",
  "EgoistShield.exe"
)

# Каталог журнала транзакции обновления. Переопределяется только тестом
# (scripts/check-upgrade-rollback.mjs), чтобы fault-injection выполнялся на
# временной копии и не касался реального ProgramData. Продакшн переменную не
# устанавливает никогда.
$upgradeStateDirectory = if ($env:EGOISTSHIELD_INSTALLER_STATE_DIR) {
  $env:EGOISTSHIELD_INSTALLER_STATE_DIR
} else {
  Join-Path $programDataRoot "EgoistShield\installer"
}
$upgradeMarkerPath = Join-Path $upgradeStateDirectory "pending-upgrade-quarantine.txt"
$script:committedUpgradeMarkerPrefix = "COMMITTED|"
$upgradeJournalPath = Join-Path $upgradeStateDirectory "upgrade-journal.json"
$registrationBackupDirectory = Join-Path $upgradeStateDirectory "registration-backup"
$registrationBackupManifestPath = Join-Path $registrationBackupDirectory "manifest.json"
$networkBaselinePath = Join-Path $upgradeStateDirectory "network-baseline.json"
$userStateBackupDirectory = Join-Path $upgradeStateDirectory "user-state-backup"
$userStateBackupManifestPath = Join-Path $userStateBackupDirectory "manifest.json"
$serviceBackupDirectory = Join-Path $upgradeStateDirectory "service-backup"
$serviceBackupManifestPath = Join-Path $serviceBackupDirectory "manifest.json"
$runtimeQuarantineManifestPath = Join-Path $upgradeStateDirectory "runtime-quarantine.json"
$telegramProxyServiceName = "EgoistShieldTelegramProxy"
$telegramProxyComponentRoot = Join-Path $programDataRoot "EgoistShield\Runtime\TelegramProxy"
$telegramProxyWrapperPath = Join-Path $telegramProxyComponentRoot "service-wrapper\egoistshield-telegram-proxy-service.exe"
$telegramProxyRuntimePath = Join-Path $telegramProxyComponentRoot "runtime\egoistshield-tg-ws-proxy.exe"

# Минимальная сигнатура нужна только для доказательства «это действительно
# наша установка» перед карантином. Полный health-check новой версии ниже
# намеренно строже: оболочка без Core/runtime не может быть закоммичена.
$installIdentityRequiredFiles = @(
  "EgoistShield.exe",
  "resources\app.asar"
)

$installHealthRequiredFiles = @(
  "EgoistShield.exe",
  "resources\app.asar",
  "resources\component-worker.cjs",
  "resources\core-service\win-x64\EgoistShield.Service.exe",
  "resources\runtime\manifest.json",
  "resources\gravityless-dns\dnscrypt-proxy.exe",
  "resources\gravityless-dns\dnscrypt-proxy.toml",
  "resources\installer\owned-cleanup.ps1"
)

function Write-Journal {
  param([string]$Stage, [hashtable]$Extra = @{})
  try {
    New-Item -ItemType Directory -Path $upgradeStateDirectory -Force -ErrorAction Stop | Out-Null
    $record = @{
      stage       = $Stage
      phase       = $Phase
      installRoot = $installRoot
      timestamp   = (Get-Date).ToString("o")
    }
    foreach ($key in $Extra.Keys) { $record[$key] = $Extra[$key] }
    ($record | ConvertTo-Json -Compress -Depth 4) |
      Add-Content -LiteralPath $upgradeJournalPath -Encoding UTF8 -ErrorAction Stop
  } catch {
    # Журнал диагностический: его недоступность не должна ломать установку.
  }
}

function Write-Utf8NoBomFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
  )
  # Windows PowerShell 5.1 пишет BOM для Set-Content -Encoding UTF8.
  # JSON.parse в Electron ожидает JSON-текст без U+FEFF, поэтому пользовательский
  # state записываем явно как UTF-8 без BOM. Временный файл по-прежнему
  # атомарно заменяет исходный ниже через Move-Item.
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function ConvertFrom-JsonCollectionCompat {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Json)
  if ([string]::IsNullOrWhiteSpace($Json)) { return }
  $parsed = $Json | ConvertFrom-Json -ErrorAction Stop
  if ($null -eq $parsed) { return }
  # Windows PowerShell 5.1 emits a JSON array as one non-enumerated Object[].
  # Wrapping ConvertFrom-Json directly in @() therefore creates a nested array
  # and turns record.source into System.Object[]. Flatten exactly one JSON
  # collection level while leaving each record object intact.
  if ($parsed -is [System.Array]) {
    foreach ($item in $parsed) {
      if ($null -ne $item) { Write-Output $item }
    }
    return
  }
  Write-Output $parsed
}

function Resolve-NormalizedPath {
  param([string]$Path)
  if (-not $Path) { return $null }
  $value = $Path.Trim().Trim('"')
  # Пути драйверов и служб приходят в NT-форме. Без нормализации проверка
  # владения не срабатывает и код уходит в небезопасную ветку «имя совпало».
  if ($value -match '^\\\?\?\\') { $value = $value.Substring(4) }
  $systemRoot = [Environment]::GetEnvironmentVariable("SystemRoot")
  if (-not $systemRoot) { $systemRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows) }
  if (-not $systemRoot) { $systemRoot = "C:\Windows" }
  if ($value -match '^\\SystemRoot\\') {
    $value = Join-Path $systemRoot $value.Substring(12)
  }
  if ($value -match '^[Ss]ystem32\\') {
    $value = Join-Path (Join-Path $systemRoot "System32") $value.Substring(9)
  }
  $expanded = [Environment]::ExpandEnvironmentVariables($value)
  try { return [System.IO.Path]::GetFullPath($expanded).TrimEnd("\") } catch { return $null }
}

function Get-ExecutableFromCommandLine {
  param([string]$CommandLine)
  if (-not $CommandLine) { return $null }
  $trimmed = $CommandLine.Trim()
  if ($trimmed -match '^\s*"([^"]+)"') { return $Matches[1] }
  # Без кавычек путь может содержать пробелы. Берём самый длинный префикс,
  # который существует как файл; иначе — до первого пробела.
  $tokens = $trimmed -split '\s+'
  for ($i = $tokens.Count; $i -ge 1; $i--) {
    $candidate = ($tokens[0..($i - 1)] -join ' ')
    $normalized = Resolve-NormalizedPath $candidate
    if ($normalized -and (Test-Path -LiteralPath $normalized -PathType Leaf)) { return $normalized }
  }
  # During rollback the binary can already live in quarantine, so Test-Path
  # against its original SCM ImagePath is expected to fail. SCM registrations
  # are often unquoted; retain the complete executable suffix instead of
  # truncating C:\Program Files\... to C:\Program.
  if ($trimmed -match '^(.+?\.(?:exe|com|bat|cmd))(?:\s+.*)?$') {
    return $Matches[1]
  }
  return $tokens[0]
}

function Test-OwnedPath {
  param([string]$Path)
  $normalized = Resolve-NormalizedPath $Path
  if (-not $normalized) { return $false }
  # Reparse-escape: путь вида C:\Program Files\Egoist Shield\..\Other уже
  # нормализован GetFullPath, поэтому сравнение префикса безопасно.
  foreach ($root in $ownedRoots) {
    if ($normalized.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
        $normalized.StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }
  return $false
}

function Assert-OwnedPath {
  # $Because попадает в сообщение об ошибке. Раньше вызывающий код передавал
  # второй аргумент функции с одним параметром: при $ErrorActionPreference =
  # 'Continue' это давало ParameterBindingException, а проверка владения
  # фактически не выполнялась.
  param([string]$Path, [string]$Because = "owned path")
  $normalized = Resolve-NormalizedPath $Path
  if (-not $normalized) { throw "Owned path is empty or invalid ($Because)." }
  if (Test-OwnedPath $normalized) { return $normalized }
  throw "Refusing cleanup outside EgoistShield-owned roots ($Because): $normalized"
}

function Test-ExclusiveOwnedServiceName {
  param([string]$Name)
  return [bool]($Name -match $exclusiveServiceNamePattern)
}

function Get-ServiceImagePath {
  param([string]$Name)
  try {
    return (Get-ItemProperty -LiteralPath "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\$Name" -Name ImagePath -ErrorAction Stop).ImagePath
  } catch {
    return $null
  }
}

function Convert-ServiceStartValueToMode {
  param([int]$Start)
  switch ($Start) {
    0 { return "Boot" }
    1 { return "System" }
    2 { return "Auto" }
    3 { return "Manual" }
    4 { return "Disabled" }
    default { return "Unknown" }
  }
}

function Get-ServiceRecordFromRegistry {
  # WMI/CIM can be unavailable on a healthy Windows installation (for example
  # while its provider is recovering). Upgrade intent must still be readable
  # from SCM's canonical registry record; Get-Service supplies the live state.
  param([string]$Name)
  $serviceKey = "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\$Name"
  try {
    $key = Get-Item -LiteralPath $serviceKey -ErrorAction Stop
    $imagePath = [string]$key.GetValue("ImagePath", "")
    if ([string]::IsNullOrWhiteSpace($imagePath)) { return $null }
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    return [pscustomobject]@{
      name = $Name
      displayName = [string]$key.GetValue("DisplayName", $Name)
      pathName = $imagePath
      startMode = Convert-ServiceStartValueToMode ([int]$key.GetValue("Start", -1))
      startName = [string]$key.GetValue("ObjectName", "LocalSystem")
      serviceType = [string]$key.GetValue("Type", 0)
      state = if ($service) { [string]$service.Status } else { "Unknown" }
    }
  } catch {
    return $null
  }
}

<#
.SYNOPSIS
  Останавливает службу только при доказанном владении.
.DESCRIPTION
  Владение доказывается одним из двух способов:
    1. ImagePath находится внутри owned root;
    2. имя службы принадлежит эксклюзивному пространству EgoistShield*.
  Служба с общим именем (dnscrypt-proxy) без ImagePath-proof НЕ трогается —
  это может быть самостоятельная установка постороннего резолвера.
#>
function Stop-OwnedService {
  param(
    [string]$Name,
    [bool]$Delete
  )
  $imagePath = Get-ServiceImagePath $Name
  $exclusiveName = Test-ExclusiveOwnedServiceName $Name

  if (-not $imagePath) {
    # Записи службы нет вовсе — нечего останавливать.
    if (-not (Get-Service -Name $Name -ErrorAction SilentlyContinue)) { return }
    if (-not $exclusiveName) {
      Write-Warning "Skipped $Name : no ImagePath proof and the name is not exclusive to EgoistShield."
      return
    }
  } else {
    $executable = Get-ExecutableFromCommandLine $imagePath
    if (-not (Test-OwnedPath $executable)) {
      if ($exclusiveName) {
        # Эксклюзивное имя, но путь чужой: это подмена или ручной перенос.
        # Не удаляем — сообщаем конфликт, чтобы не сломать чужой бинарник.
        Write-Warning "Service $Name points outside owned roots ($executable); left untouched."
        return
      }
      Write-Warning "Skipped third-party service $Name ($executable)."
      return
    }
  }

  & sc.exe stop $Name | Out-Null

  $stopDeadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $stopDeadline) {
    $current = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $current -or $current.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Stopped) { break }
    Start-Sleep -Milliseconds 250
  }

  $remainingService = Get-Service -Name $Name -ErrorAction SilentlyContinue
  $remaining = if ($remainingService -and
      $remainingService.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
    Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
  } else { $null }
  if ($remaining -and [int]$remaining.ProcessId -gt 0) {
    # ImagePath has already passed the ownership proof above. If a broken
    # service ignores SCM stop, terminate only its proven process.
    Stop-Process -Id ([int]$remaining.ProcessId) -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }

  if ($Delete) {
    & sc.exe delete $Name | Out-Null
    $deleteDeadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deleteDeadline) {
      if (-not (Get-Service -Name $Name -ErrorAction SilentlyContinue)) { return }
      Start-Sleep -Milliseconds 250
    }
    throw "Owned service $Name is still registered after stop/delete."
  }
}

<#
.SYNOPSIS
  Останавливает процесс и его дочернее дерево только при доказанном пути.
.DESCRIPTION
  Дети Electron (GPU/renderer/utility) запускаются из того же exe, поэтому их
  ExecutablePath тоже лежит в owned root. Дополнительно снимаются потомки по
  ParentProcessId: у некоторых utility-процессов путь не читается, но родитель
  уже доказан. Чужие одноимённые процессы не затрагиваются никогда.
#>
function Stop-OwnedProcessByPath {
  param(
    [string]$Name,
    [switch]$QuietForeign
  )
  $matched = @(Get-CimInstance Win32_Process -Filter "Name='$Name'" -ErrorAction SilentlyContinue)
  if ($matched.Count -eq 0) { return }

  $ownedPids = New-Object System.Collections.Generic.HashSet[int]
  foreach ($process in $matched) {
    if (Test-OwnedPath $process.ExecutablePath) {
      [void]$ownedPids.Add([int]$process.ProcessId)
    } elseif (-not $QuietForeign) {
      Write-Warning "Skipped third-party $Name process PID $($process.ProcessId)."
    }
  }
  if ($ownedPids.Count -eq 0) { return }

  # Потомки доказанных процессов: обход в ширину по ParentProcessId.
  $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Select-Object ProcessId, ParentProcessId)
  $queue = New-Object System.Collections.Generic.Queue[int]
  foreach ($id in $ownedPids) { $queue.Enqueue($id) }
  while ($queue.Count -gt 0) {
    $parent = $queue.Dequeue()
    foreach ($child in ($allProcesses | Where-Object { $_.ParentProcessId -eq $parent })) {
      if ($ownedPids.Add([int]$child.ProcessId)) { $queue.Enqueue([int]$child.ProcessId) }
    }
  }

  foreach ($id in $ownedPids) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
}

<#
.SYNOPSIS
  Не даёт внешнему watchdog повторно открыть старый Egoist Shield во время
  замены файлов.
.DESCRIPTION
  FreeFiles гарантирует только моментальный снимок. На машине может работать
  supervisor, который после остановки приложения тут же запускает его снова.
  GuardFiles держит узкое окно обслуживания до завершения installer engine:
  каждые 125 мс он завершает только EgoistShield.exe с ExecutablePath внутри
  доказанного install/data root. Процесс с тем же именем из чужого каталога не
  затрагивается. Ограничение времени и PID владельца не дают guard осиротеть.
#>
function Invoke-OwnedFileGuard {
  param(
    [int]$OwnerPid,
    [string]$StopFile,
    [int]$MaxSeconds
  )

  if ($OwnerPid -le 0) {
    Write-Error "GuardFiles requires a positive GuardPid."
    exit 44
  }

  $deadline = (Get-Date).AddSeconds([Math]::Min([Math]::Max($MaxSeconds, 1), 1800))
  $stopped = 0
  Write-Output "GUARD:READY"

  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)) { break }
    if ($StopFile -and (Test-Path -LiteralPath $StopFile -PathType Leaf)) { break }

    $owned = @(Get-CimInstance Win32_Process -Filter "Name='EgoistShield.exe'" -ErrorAction SilentlyContinue |
      Where-Object { Test-OwnedPath $_.ExecutablePath })
    if ($owned.Count -gt 0) {
      $pids = @($owned | ForEach-Object { [int]$_.ProcessId })
      Stop-OwnedProcessByPath "EgoistShield.exe" -QuietForeign
      $stopped += $pids.Count
      Write-Output ("GUARD:STOPPED:" + ($pids -join ","))
    }
    Start-Sleep -Milliseconds 125
  }

  Write-Output "GUARD:DONE:$stopped"
}

function Stop-AllProcessesFromOwnedRoots {
  $names = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { [int]$_.ProcessId -ne $PID -and (Test-OwnedPath $_.ExecutablePath) } |
    ForEach-Object { [string]$_.Name } |
    Where-Object { $_ } |
    Select-Object -Unique)
  foreach ($name in $names) { Stop-OwnedProcessByPath $name -QuietForeign }
  if ($names.Count -gt 0) { Write-Journal "owned-root-processes-stopped" @{ names = @($names) } }
}

function Stop-AllServicesFromOwnedRoots {
  $known = @($ownedServices + $legacyOwnedServices + $sharedNameServices)
  foreach ($service in @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue)) {
    $name = [string]$service.Name
    if (-not $name -or $known -contains $name) { continue }
    $executable = Get-ExecutableFromCommandLine ([string]$service.PathName)
    if (-not $executable -or -not (Test-OwnedPath $executable)) { continue }
    Stop-OwnedService $name $true
    Write-Journal "owned-root-service-removed" @{ service = $name }
  }
}

function Stop-AllOwnedRuntimes {
  foreach ($service in $legacyOwnedServices) { Stop-OwnedService $service $true }
  foreach ($service in $sharedNameServices) { Stop-OwnedService $service $true }
  foreach ($service in $ownedServices) { Stop-OwnedService $service $false }
  Stop-AllServicesFromOwnedRoots
  foreach ($process in $ownedProcesses) { Stop-OwnedProcessByPath $process }
  foreach ($process in $sharedNameProcesses) { Stop-OwnedProcessByPath $process }
  Stop-AllProcessesFromOwnedRoots
}

function Remove-OrphanedOwnedServices {
  $known = @($ownedServices + $legacyOwnedServices + $sharedNameServices)
  $serviceRoot = "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services"
  foreach ($key in @(Get-ChildItem -LiteralPath $serviceRoot -ErrorAction SilentlyContinue)) {
    $name = $key.PSChildName
    if ($known -contains $name) { continue }
    if (-not (Test-ExclusiveOwnedServiceName $name)) { continue }
    Stop-OwnedService $name $true
    Write-Journal "orphan-service-removed" @{ service = $name }
  }
}

function Remove-IncompatibleOwnedServices {
  # 3.0/ранние 3.3 создавали LocalSystem wrappers под AppData. Новый Core
  # намеренно не исполняет и не удаляет такие файлы, поэтому точечная миграция
  # выполняется установщиком: только известное имя + ImagePath внутри owned
  # root + несовпадение с каноническим защищённым путём. Чужая служба с тем же
  # общим именем остаётся нетронутой.
  $canonical = @{
    "EgoistShieldCore" = Join-Path $installRoot "resources\core-service\win-x64\EgoistShield.Service.exe"
    "EgoistShieldTelegramProxy" = Join-Path $programDataRoot "EgoistShield\Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe"
    "EgoistShieldZapret" = Join-Path $programDataRoot "EgoistShield\Runtime\Zapret\service-wrapper\egoistshield-zapret-service.exe"
    "EgoistShieldSystemDoH" = Join-Path $programDataRoot "EgoistShield\Runtime\SystemDoH\service-wrapper\egoistshield-system-doh-service.exe"
    "EgoistShieldGravitylessDNS" = Join-Path $programDataRoot "EgoistShield\GravitylessDNS\dnscrypt-proxy.exe"
    "dnscrypt-proxy" = Join-Path $programDataRoot "EgoistShield\GravitylessDNS\dnscrypt-proxy.exe"
  }

  foreach ($name in $canonical.Keys) {
    $imagePath = Get-ServiceImagePath $name
    if (-not $imagePath) { continue }
    $executable = Resolve-NormalizedPath (Get-ExecutableFromCommandLine $imagePath)
    $expected = Resolve-NormalizedPath $canonical[$name]
    if ($executable -and $expected -and $executable.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
      continue
    }
    if (-not $executable -or -not (Test-OwnedPath $executable)) {
      Write-Warning "Service $name has a non-canonical path without ownership proof and was left untouched."
      continue
    }

    Stop-OwnedService $name $true
    Write-Journal "legacy-service-registration-removed" @{
      service = $name
      previousExecutable = "$executable"
      expectedExecutable = "$expected"
    }
  }
}

function Get-VerifiedOwnedServiceRecords {
  $records = New-Object System.Collections.Generic.List[object]
  foreach ($service in @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue)) {
    $name = [string]$service.Name
    $known = ($ownedServices + $legacyOwnedServices + $sharedNameServices) -contains $name
    $exclusive = Test-ExclusiveOwnedServiceName $name
    if (-not $known -and -not $exclusive) { continue }
    $executable = Get-ExecutableFromCommandLine ([string]$service.PathName)
    if ($executable -and -not (Test-OwnedPath $executable)) {
      Write-Warning "Service $name uses an EgoistShield-compatible name but points outside owned roots; it is not part of the upgrade transaction."
      continue
    }
    if (-not $exclusive -and -not $executable) { continue }
    $records.Add([pscustomobject]@{
      name = $name
      displayName = [string]$service.DisplayName
      pathName = [string]$service.PathName
      startMode = [string]$service.StartMode
      startName = [string]$service.StartName
      serviceType = [string]$service.ServiceType
      state = [string]$service.State
    })
  }
  # Preserve a canonical Automatic Telegram service even if Win32_Service is
  # temporarily unavailable. This is the exact user opt-in that an in-place
  # upgrade must not silently erase; the registry path remains ownership-gated.
  if (-not @($records | Where-Object { [string]$_.name -eq $telegramProxyServiceName })) {
    $telegram = Get-ServiceRecordFromRegistry $telegramProxyServiceName
    if ($telegram) {
      $executable = Get-ExecutableFromCommandLine ([string]$telegram.pathName)
      if ($executable -and (Test-OwnedPath $executable)) {
        $records.Add($telegram)
      } else {
        Write-Warning "Telegram Proxy service registration was not backed up because its ImagePath is not owned."
      }
    }
  }
  return @($records.ToArray() | Sort-Object name -Unique)
}

function Backup-OwnedServiceRegistrations {
  param([string[]]$PreviouslyRunning = @())
  if (Test-Path -LiteralPath $serviceBackupManifestPath -PathType Leaf) { return }
  New-Item -ItemType Directory -Path $serviceBackupDirectory -Force -ErrorAction Stop | Out-Null
  $running = @(Normalize-ServiceNames $PreviouslyRunning)
  $records = New-Object System.Collections.Generic.List[object]
  foreach ($service in @(Get-VerifiedOwnedServiceRecords)) {
    $fileName = "service-$($records.Count).reg"
    $nativeKey = "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\$($service.name)"
    $backupPath = Join-Path $serviceBackupDirectory $fileName
    & reg.exe export $nativeKey $backupPath /y | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
      throw "Failed to export owned service registration $($service.name)."
    }
    $records.Add([pscustomobject]@{
      name = $service.name
      displayName = $service.displayName
      pathName = $service.pathName
      startMode = $service.startMode
      startName = $service.startName
      serviceType = $service.serviceType
      wasRunning = ($service.state -eq "Running" -or $running -contains $service.name)
      fileName = $fileName
    })
  }
  ConvertTo-Json -InputObject @($records.ToArray()) -Depth 5 |
    Set-Content -LiteralPath $serviceBackupManifestPath -Encoding UTF8 -Force -ErrorAction Stop
  Write-Journal "service-registrations-backed-up" @{ services = $records.Count }
}

function Remove-OptionalOwnedServices {
  foreach ($name in @($legacyOwnedServices + $sharedNameServices + ($ownedServices | Where-Object { $_ -ne "EgoistShieldCore" }))) {
    Stop-OwnedService $name $true
  }
  $serviceRoot = "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services"
  foreach ($key in @(Get-ChildItem -LiteralPath $serviceRoot -ErrorAction SilentlyContinue)) {
    $name = [string]$key.PSChildName
    if ($name -eq "EgoistShieldCore" -or -not (Test-ExclusiveOwnedServiceName $name)) { continue }
    Stop-OwnedService $name $true
  }
  Write-Journal "optional-owned-services-removed" @{}
}

function Restore-OwnedServiceRegistrations {
  if (-not (Test-Path -LiteralPath $serviceBackupManifestPath -PathType Leaf)) { return }
  $records = @(ConvertFrom-JsonCollectionCompat (
    Get-Content -LiteralPath $serviceBackupManifestPath -Raw -ErrorAction Stop))
  foreach ($record in $records) {
    if ([string]$record.name -notmatch '^[A-Za-z0-9_.-]+$' -or
        [string]$record.fileName -notmatch '^service-\d+\.reg$') {
      throw "Invalid owned service backup record."
    }
    $existingPath = Get-ServiceImagePath ([string]$record.name)
    if ($existingPath) {
      $existingExecutable = Get-ExecutableFromCommandLine $existingPath
      if (-not (Test-OwnedPath $existingExecutable)) {
        throw "Cannot restore $($record.name): the name is now owned by a foreign binary."
      }
      Stop-OwnedService ([string]$record.name) $true
    }

    if ([string]::IsNullOrWhiteSpace([string]$record.pathName)) {
      throw "Cannot restore owned service $($record.name): its previous ImagePath was empty."
    }
    $start = switch ([string]$record.startMode) {
      "Auto" { "auto" }
      "Disabled" { "disabled" }
      default { "demand" }
    }
    $createArguments = @(
      "create", [string]$record.name,
      "binPath=", [string]$record.pathName,
      "start=", $start,
      "DisplayName=", [string]$record.displayName
    )
    [void](Invoke-CheckedExternal (Join-Path $env:SystemRoot "System32\sc.exe") $createArguments "restore-service-$($record.name)")
    $backupPath = Join-Path $serviceBackupDirectory ([string]$record.fileName)
    & reg.exe import $backupPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to import service backup for $($record.name)." }
  }

  foreach ($record in $records) {
    if ($record.wasRunning -eq $true) {
      & sc.exe start ([string]$record.name) | Out-Null
    }
  }
  Remove-Item -LiteralPath $serviceBackupDirectory -Recurse -Force -ErrorAction Stop
  Write-Journal "service-registrations-restored" @{ services = $records.Count }
}

function Complete-OwnedServiceRegistrations {
  if (-not (Test-Path -LiteralPath $serviceBackupDirectory)) { return }
  Assert-PlainOwnedDirectoryTree $serviceBackupDirectory "Owned service backup"
  Remove-Item -LiteralPath $serviceBackupDirectory -Recurse -Force -ErrorAction Stop
  if (Test-Path -LiteralPath $serviceBackupDirectory) {
    throw "Owned service backup remained after commit: $serviceBackupDirectory"
  }
}

function Test-PersistedTelegramProxyServiceRecord {
  param([object]$Record)
  if ($null -eq $Record -or [string]$Record.name -ne $telegramProxyServiceName) { return $false }
  $startMode = [string]$Record.startMode
  if ($startMode -notin @("Auto", "Automatic")) { return $false }
  $startName = [string]$Record.startName
  if ($startName -notin @("LocalSystem", "NT AUTHORITY\SYSTEM")) { return $false }
  $actualExecutable = Resolve-NormalizedPath (Get-ExecutableFromCommandLine ([string]$Record.pathName))
  $expectedExecutable = Resolve-NormalizedPath $telegramProxyWrapperPath
  return [bool]($actualExecutable -and $expectedExecutable -and
    $actualExecutable.Equals($expectedExecutable, [StringComparison]::OrdinalIgnoreCase))
}

function Get-PersistedTelegramProxyServiceRecord {
  if (-not (Test-Path -LiteralPath $serviceBackupManifestPath -PathType Leaf)) { return $null }
  $records = @(ConvertFrom-JsonCollectionCompat (
    Get-Content -LiteralPath $serviceBackupManifestPath -Raw -ErrorAction Stop))
  $matches = @($records | Where-Object { [string]$_.name -eq $telegramProxyServiceName })
  if ($matches.Count -eq 0) { return $null }
  if ($matches.Count -ne 1) {
    throw "Refusing an ambiguous Telegram Proxy service persistence record."
  }
  if (-not (Test-PersistedTelegramProxyServiceRecord $matches[0])) {
    Write-Journal "telegram-proxy-autostart-not-preserved" @{ reason = "record-not-canonical-automatic" }
    return $null
  }
  return $matches[0]
}

function Get-QuarantinedTelegramProxyComponent {
  $componentRoot = Resolve-NormalizedPath $telegramProxyComponentRoot
  $runtimeRoot = Resolve-NormalizedPath (Split-Path -Parent $telegramProxyComponentRoot)
  foreach ($record in @(Read-OwnedRuntimeQuarantine)) {
    $recordSource = Resolve-NormalizedPath ([string]$record.source)
    $candidate = $null
    if ($recordSource -and $recordSource.Equals($componentRoot, [StringComparison]::OrdinalIgnoreCase)) {
      $candidate = Resolve-NormalizedPath ([string]$record.destination)
    } elseif ($recordSource -and $recordSource.Equals($runtimeRoot, [StringComparison]::OrdinalIgnoreCase)) {
      $candidate = Resolve-NormalizedPath (Join-Path ([string]$record.destination) "TelegramProxy")
    }
    if (-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Container)) { continue }

    # Previous releases harden ProgramData recursively. Repair access only for
    # the already validated sibling quarantine, then reject every reparse point
    # before copying a tightly allowlisted subset into the new live component.
    Repair-OwnedRuntimeQuarantineAccess $record
    Assert-PlainOwnedDirectoryTree $candidate "Quarantined Telegram Proxy component"
    return [pscustomobject]@{ record = $record; component = $candidate }
  }
  return $null
}

function Copy-VerifiedInstallerFile {
  param([string]$Source, [string]$Destination, [string]$Stage)
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "$Stage source is missing: $Source"
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force -ErrorAction Stop | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
  $sourceHash = Get-FileSha256 $Source
  $destinationHash = Get-FileSha256 $Destination
  if (-not $sourceHash -or -not $destinationHash -or $sourceHash -ne $destinationHash) {
    throw "$Stage failed SHA-256 readback."
  }
}

function Assert-TelegramProxyWrapperConfiguration {
  param([string]$ComponentRoot)
  $xmlPath = Join-Path $ComponentRoot "service-wrapper\egoistshield-telegram-proxy-service.xml"
  if (-not (Test-Path -LiteralPath $xmlPath -PathType Leaf)) {
    throw "Telegram Proxy service configuration is missing from the previous working component."
  }
  [xml]$configuration = Get-Content -LiteralPath $xmlPath -Raw -ErrorAction Stop
  $expectedRuntime = Resolve-NormalizedPath $telegramProxyRuntimePath
  $expectedWorkingDirectory = Resolve-NormalizedPath (Split-Path -Parent $telegramProxyRuntimePath)
  $actualRuntime = Resolve-NormalizedPath ([string]$configuration.service.executable)
  $actualWorkingDirectory = Resolve-NormalizedPath ([string]$configuration.service.workingdirectory)
  if ([string]$configuration.service.id -ne $telegramProxyServiceName -or
      [string]$configuration.service.startmode -ne "Automatic" -or
      [string]$configuration.service.delayedAutoStart -ne "false" -or
      [string]::IsNullOrWhiteSpace([string]$configuration.service.arguments) -or
      -not $actualRuntime -or -not $actualRuntime.Equals($expectedRuntime, [StringComparison]::OrdinalIgnoreCase) -or
      -not $actualWorkingDirectory -or
      -not $actualWorkingDirectory.Equals($expectedWorkingDirectory, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Telegram Proxy service configuration failed the canonical-path/autostart validation."
  }
}

function Assert-TelegramProxyServicePersistence {
  $service = Get-ServiceRecordFromRegistry $telegramProxyServiceName
  if (-not $service) { throw "Telegram Proxy service registration is missing after installation." }
  $actualExecutable = Resolve-NormalizedPath (Get-ExecutableFromCommandLine ([string]$service.pathName))
  $expectedExecutable = Resolve-NormalizedPath $telegramProxyWrapperPath
  if (-not $actualExecutable -or -not $actualExecutable.Equals($expectedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Telegram Proxy service ImagePath does not match the canonical wrapper."
  }
  if ([string]$service.startMode -notin @("Auto", "Automatic") -or
      [string]$service.startName -notin @("LocalSystem", "NT AUTHORITY\SYSTEM")) {
    throw "Telegram Proxy service is not configured for Automatic LocalSystem startup."
  }

  $serviceKey = "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\$telegramProxyServiceName"
  $key = Get-Item -LiteralPath $serviceKey -ErrorAction Stop
  $start = [int]$key.GetValue("Start", -1)
  $delayed = [int]$key.GetValue("DelayedAutoStart", 0)
  $failureActions = $key.GetValue("FailureActions", $null)
  $failureFlag = [int]$key.GetValue("FailureActionsOnNonCrashFailures", 0)
  $dependencies = @($key.GetValue("DependOnService", @()) | ForEach-Object { "$_" })
  if ($start -ne 2 -or $delayed -ne 0 -or
      -not ($failureActions -is [byte[]]) -or $failureActions.Length -le 0 -or
      $failureFlag -ne 1 -or $dependencies -notcontains "Tcpip" -or $dependencies -notcontains "Afd") {
    throw "Telegram Proxy SCM persistence/recovery readback did not match the required boot contract."
  }
}

function Wait-TelegramProxyServiceReady {
  param([int]$Port, [int]$TimeoutSeconds = 45)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $service = Get-Service -Name $telegramProxyServiceName -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running) {
      $client = New-Object Net.Sockets.TcpClient
      try {
        $connect = $client.ConnectAsync("127.0.0.1", $Port)
        if ($connect.Wait(750) -and $client.Connected) { return $true }
      } catch {
        # Retry until both SCM and the listener report readiness.
      } finally {
        $client.Dispose()
      }
    }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Restore-PersistedTelegramProxyService {
  $intent = Get-PersistedTelegramProxyServiceRecord
  if ($null -eq $intent) {
    Write-Journal "telegram-proxy-autostart-not-requested" @{}
    return
  }

  $quarantined = Get-QuarantinedTelegramProxyComponent
  if ($null -eq $quarantined) {
    throw "Automatic Telegram Proxy was enabled before upgrade, but its protected runtime backup is missing."
  }

  $sourceComponent = [string]$quarantined.component
  $sourceConfig = Join-Path $sourceComponent "config.json"
  $sourceXml = Join-Path $sourceComponent "service-wrapper\egoistshield-telegram-proxy-service.xml"
  if (-not (Test-Path -LiteralPath $sourceConfig -PathType Leaf) -or
      -not (Test-Path -LiteralPath $sourceXml -PathType Leaf)) {
    throw "Automatic Telegram Proxy backup is incomplete; refusing a false-success upgrade."
  }

  if (Test-Path -LiteralPath $telegramProxyComponentRoot) {
    Remove-Item -LiteralPath (Assert-OwnedPath $telegramProxyComponentRoot "partial Telegram Proxy migration") `
      -Recurse -Force -ErrorAction Stop
  }
  New-Item -ItemType Directory -Path $telegramProxyComponentRoot -Force -ErrorAction Stop | Out-Null
  # Copy the repaired protected DACL before writing config.json (contains the
  # proxy secret). Users outside Administrators/SYSTEM never receive access.
  Set-Acl -LiteralPath $telegramProxyComponentRoot -AclObject (Get-Acl -LiteralPath $sourceComponent -ErrorAction Stop) -ErrorAction Stop

  Copy-Item -LiteralPath $sourceConfig -Destination (Join-Path $telegramProxyComponentRoot "config.json") -Force -ErrorAction Stop
  if (Test-Path -LiteralPath (Join-Path $sourceComponent ".first_run_done_mtproto") -PathType Leaf) {
    Copy-Item -LiteralPath (Join-Path $sourceComponent ".first_run_done_mtproto") `
      -Destination (Join-Path $telegramProxyComponentRoot ".first_run_done_mtproto") -Force -ErrorAction Stop
  }
  New-Item -ItemType Directory -Path (Join-Path $telegramProxyComponentRoot "runtime") -Force -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $telegramProxyComponentRoot "service-wrapper") -Force -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $telegramProxyComponentRoot "service-logs") -Force -ErrorAction Stop | Out-Null
  Copy-Item -LiteralPath $sourceXml -Destination (
    Join-Path $telegramProxyComponentRoot "service-wrapper\egoistshield-telegram-proxy-service.xml") -Force -ErrorAction Stop

  $bundledRuntimeRoot = Join-Path $installRoot "resources\runtime\tg-ws-proxy"
  Copy-VerifiedInstallerFile (Join-Path $bundledRuntimeRoot "egoistshield-tg-ws-proxy.exe") `
    $telegramProxyRuntimePath "telegram-proxy-runtime-refresh"
  foreach ($metadataName in @("VERSION.txt", "RUNTIME_FLAVOR.txt")) {
    Copy-VerifiedInstallerFile (Join-Path $bundledRuntimeRoot $metadataName) `
      (Join-Path (Split-Path -Parent $telegramProxyRuntimePath) $metadataName) "telegram-proxy-$metadataName-refresh"
  }
  $bundledWrapper = Join-Path $installRoot "resources\runtime\zapret\service-wrapper\egoistshield-zapret-service.exe"
  Copy-VerifiedInstallerFile $bundledWrapper $telegramProxyWrapperPath "telegram-proxy-wrapper-refresh"
  Assert-TelegramProxyWrapperConfiguration $telegramProxyComponentRoot

  [void](Invoke-CheckedExternal $telegramProxyWrapperPath @("install") "telegram-proxy-service-install")
  $sc = Join-Path $env:SystemRoot "System32\sc.exe"
  [void](Invoke-CheckedExternal $sc @("config", $telegramProxyServiceName, "start=", "auto") "telegram-proxy-service-auto")
  [void](Invoke-CheckedExternal $sc @("config", $telegramProxyServiceName, "depend=", "Tcpip/Afd") "telegram-proxy-service-dependencies")
  [void](Invoke-CheckedExternal $sc @(
    "failure", $telegramProxyServiceName, "reset=", "86400", "actions=", "restart/5000/restart/15000/restart/30000"
  ) "telegram-proxy-service-recovery")
  [void](Invoke-CheckedExternal $sc @("failureflag", $telegramProxyServiceName, "1") "telegram-proxy-service-failureflag")
  [void](Invoke-CheckedExternal (Join-Path $env:SystemRoot "System32\reg.exe") @(
    "add", "HKLM\SYSTEM\CurrentControlSet\Services\$telegramProxyServiceName",
    "/v", "DelayedAutoStart", "/t", "REG_DWORD", "/d", "0", "/f"
  ) "telegram-proxy-service-nondelayed")
  Assert-TelegramProxyServicePersistence

  if ($intent.wasRunning -eq $true) {
    [void](Invoke-CheckedExternal $sc @("start", $telegramProxyServiceName) "telegram-proxy-service-start" @(0, 1056))
    $config = Get-Content -LiteralPath (Join-Path $telegramProxyComponentRoot "config.json") -Raw -ErrorAction Stop |
      ConvertFrom-Json -ErrorAction Stop
    $port = [int]$config.port
    if ($port -lt 1 -or $port -gt 65535 -or -not (Wait-TelegramProxyServiceReady $port 45)) {
      throw "Telegram Proxy service did not reach Running/listening state after the upgrade."
    }
  }

  Write-Journal "telegram-proxy-autostart-restored" @{
    service = $telegramProxyServiceName
    startMode = "Automatic"
    wasRunning = [bool]$intent.wasRunning
  }
}

function Remove-OwnedStartupArtifacts {
  if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
    foreach ($taskName in @("EgoistShieldStartup")) {
      $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      if ($task) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
        Write-Journal "startup-task-removed" @{ task = $taskName }
      }
    }
  }

  $userRegistryRoot = if ($script:shieldUserRegistryRoot) { [string]$script:shieldUserRegistryRoot } else { "Registry::HKEY_CURRENT_USER" }
  foreach ($runKey in @(
    (Join-Path $userRegistryRoot "Software\Microsoft\Windows\CurrentVersion\Run"),
    "Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Run"
  )) {
    $values = Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue
    if (-not $values) { continue }
    foreach ($name in @("Egoist Shield", "EgoistShield", "egoistshield-1-desktop")) {
      $command = $values.$name
      if (-not $command) { continue }
      $executable = Get-ExecutableFromCommandLine "$command"
      if (-not (Test-OwnedPath $executable)) {
        Write-Warning "Startup entry $name points outside owned roots; left untouched."
        continue
      }
      Remove-ItemProperty -LiteralPath $runKey -Name $name -ErrorAction Stop
      Write-Journal "startup-entry-removed" @{ name = $name; executable = "$executable" }
    }
  }
}

function Invoke-CoreServiceOfflineRecovery {
  $serviceExe = Join-Path $installRoot "resources\core-service\win-x64\EgoistShield.Service.exe"
  if (-not (Test-Path -LiteralPath $serviceExe -PathType Leaf)) {
    return
  }
  $stateRoot = Join-Path $env:ProgramData "EgoistShield\Service"
  & $serviceExe --recover-active --state-root $stateRoot
  if ($LASTEXITCODE -ne 0) {
    throw "EgoistShieldCore offline recovery failed with exit code $LASTEXITCODE."
  }
}

function Invoke-CoreOwnedDnsCleanup {
  param([switch]$LegacyOnly)
  $stateRoot = Join-Path $env:ProgramData "EgoistShield\Service"
  $serviceExe = Join-Path $installRoot "resources\core-service\win-x64\EgoistShield.Service.exe"
  $stateNames = if ($LegacyOnly) { @("owned-dns.json") } else { @("dns-owned-state.json", "owned-dns.json") }
  foreach ($stateName in $stateNames) {
    $statePath = Join-Path $stateRoot $stateName
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { continue }
    $owned = Get-Content -LiteralPath $statePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($null -eq $owned) { continue }
    if (-not (Test-Path -LiteralPath $serviceExe -PathType Leaf)) { throw "Owned DNS state exists but its recovery binary is missing." }
    & $serviceExe --restore-owned-dns --state-root $stateRoot
    if ($LASTEXITCODE -ne 0) { throw "Owned DNS restoration failed; resolver files and ownership state must be preserved." }
    $remaining = Get-Content -LiteralPath $statePath -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json -ErrorAction Stop
    if ($null -ne $remaining) { throw "Owned DNS adapters still require restoration. Reconnect the adapter and retry." }
    Write-Journal "owned-dns-restored" @{ state = $stateName }
  }
}
function Invoke-CoreNativeDohCleanup {
  $stateRoot = Join-Path $env:ProgramData "EgoistShield\Service"
  $statePath = Join-Path $stateRoot "native-doh-state.json"
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    return
  }
  $serviceExe = Join-Path $installRoot "resources\core-service\win-x64\EgoistShield.Service.exe"
  if (-not (Test-Path -LiteralPath $serviceExe -PathType Leaf)) {
    throw "Native DoH ownership exists, but EgoistShieldCore cleanup binary is missing: $serviceExe"
  }
  & $serviceExe --remove-native-doh --state-root $stateRoot
  if ($LASTEXITCODE -ne 0) {
    throw "EgoistShieldCore native DoH cleanup failed with exit code $LASTEXITCODE."
  }
  if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    throw "EgoistShieldCore reported success but native DoH ownership state remains."
  }
  Write-Journal "native-doh-removed" @{}
}

function Invoke-CheckedExternal {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$Stage,
    [int[]]$AllowedExitCodes = @(0)
  )
  $output = @(& $FilePath @Arguments 2>&1 | ForEach-Object { "$_" })
  $exitCode = $LASTEXITCODE
  $summary = (($output -join " ") -replace '\s+', ' ').Trim()
  if ($summary.Length -gt 800) { $summary = $summary.Substring(0, 800) }
  Write-Journal "external-command" @{
    command = [System.IO.Path]::GetFileName($FilePath)
    exitCode = $exitCode
    output = $summary
    stage = $Stage
  }
  if ($AllowedExitCodes -notcontains $exitCode) {
    throw "$Stage failed with exit code $exitCode$(if ($summary) { ": $summary" } else { "." })"
  }
  return @($output)
}

function Install-CoreService {
  $principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Installing EgoistShieldCore requires an elevated administrator token."
  }

  $serviceName = "EgoistShieldCore"
  $serviceExe = Join-Path $installRoot "resources\core-service\win-x64\EgoistShield.Service.exe"
  if (-not (Test-Path -LiteralPath $serviceExe -PathType Leaf)) {
    throw "EgoistShieldCore executable is missing: $serviceExe"
  }
  Assert-OwnedPath $serviceExe "core service executable" | Out-Null

  $scExe = Join-Path $env:SystemRoot "System32\sc.exe"
  if (-not (Test-Path -LiteralPath $scExe -PathType Leaf)) {
    $scExe = "sc.exe"
  }

  Write-Journal "core-service-install-started" @{ binary = $serviceExe }
  try {
    [void](Invoke-CheckedExternal $serviceExe @(
      "configure", "--install-root", $installRoot
    ) "core-configure")

    # Recreate instead of mutating an unknown half-installed record. Ownership
    # is proven by Stop-OwnedService before deletion; a foreign path is left
    # untouched and the explicit conflict check below aborts safely.
    Stop-OwnedService $serviceName $true
    if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
      throw "A conflicting EgoistShieldCore service is still registered."
    }

    [void](Invoke-CheckedExternal $scExe @(
      "create", $serviceName,
      "binPath=", "`"$serviceExe`"",
      "start=", "auto",
      "DisplayName=", "Egoist Shield Core Service"
    ) "core-create")
    [void](Invoke-CheckedExternal $scExe @(
      "description", $serviceName,
      "Transactional control of Egoist Shield DNS and owned background services"
    ) "core-description")
    [void](Invoke-CheckedExternal $scExe @(
      "failure", $serviceName,
      "reset=", "86400",
      "actions=", "restart/5000/restart/15000/restart/30000"
    ) "core-failure-actions")
    [void](Invoke-CheckedExternal $scExe @(
      "failureflag", $serviceName, "1"
    ) "core-failure-flag")
    [void](Invoke-CheckedExternal $scExe @(
      "start", $serviceName
    ) "core-start" @(0, 1056))

    $deadline = (Get-Date).AddSeconds(20)
    do {
      $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
      if ($service -and $service.Status -eq "Running") {
        Write-Journal "core-service-installed" @{ binary = $serviceExe; status = "Running" }
        Write-Output "CORE-SERVICE: installed-and-running"
        return
      }
      Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)

    $status = if ($service) { "$($service.Status)" } else { "missing" }
    throw "EgoistShieldCore did not reach Running within 20 seconds (status: $status)."
  } catch {
    Write-Journal "core-service-install-failed" @{ binary = $serviceExe; error = "$_" }
    try { Stop-OwnedService $serviceName $true } catch { Write-Warning $_ }
    throw
  }
}

function Assert-InstalledCandidateRuntime {
  param([switch]$BeforeCommit)
  if (-not (Test-InstallRootHealthy $installRoot)) {
    throw "Installed payload failed the final health check."
  }

  $serviceName = "EgoistShieldCore"
  $expectedExecutable = Resolve-NormalizedPath (
    Join-Path $installRoot "resources\core-service\win-x64\EgoistShield.Service.exe")
  $serviceKeyPath = "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\$serviceName"
  $serviceKey = Get-Item -LiteralPath $serviceKeyPath -ErrorAction Stop
  $imagePath = [string]$serviceKey.GetValue("ImagePath", "")
  $actualExecutable = Resolve-NormalizedPath (Get-ExecutableFromCommandLine $imagePath)
  $start = [int]$serviceKey.GetValue("Start", -1)
  $objectName = [string]$serviceKey.GetValue("ObjectName", "")
  $failureActions = $serviceKey.GetValue("FailureActions", $null)
  $failureFlag = [int]$serviceKey.GetValue("FailureActionsOnNonCrashFailures", 0)
  if (-not $actualExecutable -or -not $expectedExecutable -or
      -not $actualExecutable.Equals($expectedExecutable, [StringComparison]::OrdinalIgnoreCase) -or
      $start -ne 2 -or $objectName -notin @("LocalSystem", "NT AUTHORITY\SYSTEM") -or
      -not ($failureActions -is [byte[]]) -or $failureActions.Length -le 0 -or $failureFlag -ne 1) {
    throw "EgoistShieldCore final SCM registration readback does not match the required Automatic LocalSystem contract."
  }

  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $service -or $service.Status -ne "Running") {
    $status = if ($service) { "$($service.Status)" } else { "missing" }
    throw "EgoistShieldCore is not Running after the complete install transaction (status: $status)."
  }

  $transactionResidue = @(
    $registrationBackupDirectory,
    $networkBaselinePath,
    $userStateBackupDirectory,
    $serviceBackupDirectory,
    $runtimeQuarantineManifestPath
  ) | Where-Object { Test-Path -LiteralPath $_ }
  if (-not $BeforeCommit -and $transactionResidue.Count -gt 0) {
    throw "Installer external transaction state remained after commit: $($transactionResidue -join ', ')"
  }

  Write-Journal "installed-candidate-verified" @{ coreStatus = "Running"; start = $start }
  Write-Output "VERIFY-INSTALL: payload-healthy, core-running-auto, transaction-state-clean"
}

<#
.SYNOPSIS
  Имена работающих СОБСТВЕННЫХ служб — чтобы поднять их после установки.
.DESCRIPTION
  В список попадают только службы с доказанным владением. Прежняя реализация
  оболочки записывала сюда и dnscrypt-proxy по имени, поэтому после установки
  запускала чужой резолвер (или пыталась запустить уже работающий чужой).
#>
function Get-RunningOwnedServiceNames {
  $running = @()
  foreach ($name in ($ownedServices + $sharedNameServices)) {
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $service -or $service.Status -ne "Running") { continue }
    $imagePath = Get-ServiceImagePath $name
    $exclusive = Test-ExclusiveOwnedServiceName $name
    $ownedByPath = $imagePath -and (Test-OwnedPath (Get-ExecutableFromCommandLine $imagePath))
    if ($ownedByPath -or ($exclusive -and -not $imagePath)) { $running += $name }
  }
  return $running
}

<#
.SYNOPSIS
  Запускает ранее работавшие собственные службы (desiredRunning после установки).
.DESCRIPTION
  Порядок обратный порядку остановки: DNS поднимается первым, чтобы разрешение
  имён восстановилось раньше остальных модулей. Каждое имя заново проходит
  проверку владения: список приходит извне и мог быть подменён.
#>
function Normalize-ServiceNames {
  param([string[]]$Names)
  # Внешний powershell.exe передаёт comma-separated значение string[] как
  # один элемент. Нормализуем оба допустимых представления и затем снова
  # проверяем каждое имя по allowlist/path proof.
  return @($Names | ForEach-Object { "$_" -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Start-OwnedServices {
  param([string[]]$Names)
  if (-not $Names -or $Names.Count -eq 0) { return }
  $ordered = @(Normalize-ServiceNames $Names)
  [array]::Reverse($ordered)
  foreach ($name in $ordered) {
    if (-not $name) { continue }
    if (($ownedServices + $sharedNameServices) -notcontains $name) {
      Write-Warning "Refusing to start a service outside the owned list: $name"
      continue
    }
    $imagePath = Get-ServiceImagePath $name
    $exclusive = Test-ExclusiveOwnedServiceName $name
    if ($imagePath -and -not (Test-OwnedPath (Get-ExecutableFromCommandLine $imagePath))) {
      Write-Warning "Refusing to start a third-party service: $name"
      continue
    }
    if (-not $imagePath -and -not $exclusive) { continue }
    if (-not (Get-Service -Name $name -ErrorAction SilentlyContinue)) { continue }
    & sc.exe start $name | Out-Null
    Start-Sleep -Milliseconds 400
  }
}

<#
.SYNOPSIS
  Выгружает ТОЛЬКО собственный драйвер WinDivert.
.DESCRIPTION
  Прежняя реализация удаляла все службы драйверов по маске WinDivert*, из-за
  чего сносила драйвер стороннего продукта (GoodbyeDPI, Zapret-сборки,
  корпоративные фильтры) и оставляла его неработоспособным. Теперь для каждой
  найденной службы читается BinaryPathName, и действие выполняется только если
  .sys лежит внутри owned root. Чужой драйвер лишь протоколируется.
#>
function Unload-OwnedWinDivertDriver {
  $names = New-Object System.Collections.Generic.HashSet[string] ([StringComparer]::OrdinalIgnoreCase)
  try {
    $query = & sc.exe query type= driver state= all 2>$null
    foreach ($match in ([regex]::Matches(($query -join "`n"), 'SERVICE_NAME:\s*(WinDivert\S*)'))) {
      [void]$names.Add($match.Groups[1].Value)
    }
  } catch {
    # sc.exe недоступен: перебираем известные имена ниже.
  }
  foreach ($known in @("WinDivert", "WinDivert1.4", "WinDivert14")) { [void]$names.Add($known) }

  $sc = if ($env:SystemRoot) { Join-Path $env:SystemRoot "System32\sc.exe" } else { "sc.exe" }

  foreach ($name in $names) {
    $imagePath = Get-ServiceImagePath $name
    if (-not $imagePath) { continue }
    $binary = Get-ExecutableFromCommandLine $imagePath
    if (-not (Test-OwnedPath $binary)) {
      Write-Warning "Third-party WinDivert driver left untouched: $name ($binary)."
      continue
    }
    [void](Invoke-CheckedExternal $sc @("stop", $name) "windivert-stop-$name" @(0, 1062, 1060))
    Start-Sleep -Milliseconds 250
    $stopDeadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $stopDeadline) {
      $current = Get-Service -Name $name -ErrorAction SilentlyContinue
      if (-not $current -or $current.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Stopped) { break }
      Start-Sleep -Milliseconds 250
    }
    $remaining = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($remaining -and $remaining.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
      throw "Owned WinDivert service $name did not stop; refusing to delete it."
    }
    [void](Invoke-CheckedExternal $sc @("delete", $name) "windivert-delete-$name" @(0, 1072, 1060))
    $deleteDeadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deleteDeadline) {
      if (-not (Get-Service -Name $name -ErrorAction SilentlyContinue) -and -not (Get-ServiceImagePath $name)) { break }
      Start-Sleep -Milliseconds 250
    }
    if ((Get-Service -Name $name -ErrorAction SilentlyContinue) -or (Get-ServiceImagePath $name)) {
      throw "Owned WinDivert service $name is still registered after stop/delete."
    }
    Write-Journal "windivert-unloaded" @{ service = $name; binary = "$binary" }
  }
}

function Remove-OwnedShortcut {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  try {
    $shell = New-Object -ComObject WScript.Shell
    $target = $shell.CreateShortcut($Path).TargetPath
    Assert-OwnedPath $target | Out-Null
    Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
  } catch {
    Write-Warning "Skipped non-owned shortcut: $Path"
  }
}

function Remove-OwnedShortcuts {
  $shortcutNames = @("Egoist Lagom.lnk", "Egoist Shield.lnk", "EgoistShield.lnk", "EGIS Shield.lnk")
  foreach ($name in $shortcutNames) {
    Remove-OwnedShortcut (Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) $name)
    Remove-OwnedShortcut (Join-Path ([Environment]::GetFolderPath("DesktopDirectory")) $name)
    Remove-OwnedShortcut (Join-Path ([Environment]::GetFolderPath("CommonPrograms")) $name)
    Remove-OwnedShortcut (Join-Path ([Environment]::GetFolderPath("Programs")) $name)
  }
}

function Restore-RegistrySnapshotValue {
  param(
    [string]$RegistryPath,
    [string]$Name,
    $Snapshot
  )
  if ($Snapshot.exists -eq $true) {
    $kind = if ($Name -eq "ProxyEnable") { "DWord" } else { "String" }
    New-ItemProperty -LiteralPath $RegistryPath -Name $Name -Value $Snapshot.value -PropertyType $kind -Force -ErrorAction Stop | Out-Null
  } else {
    # Removing an already absent value is an idempotent success.  A real
    # provider/ACL failure still throws and keeps the rollback journal.
    $key = Get-Item -LiteralPath $RegistryPath -ErrorAction Stop
    if ($key.GetValueNames() -contains $Name) {
      Remove-ItemProperty -LiteralPath $RegistryPath -Name $Name -ErrorAction Stop
    }
  }
}

function Get-RegistryValueSnapshot {
  param([string]$RegistryPath, [string]$Name)
  try {
    $key = Get-Item -LiteralPath $RegistryPath -ErrorAction Stop
    if ($key.GetValueNames() -notcontains $Name) {
      return [pscustomobject]@{ exists = $false; kind = $null; value = $null }
    }
    $kind = $key.GetValueKind($Name).ToString()
    $value = $key.GetValue(
      $Name,
      $null,
      [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if ($kind -eq "Binary") {
      $value = [Convert]::ToBase64String([byte[]]$value)
    }
    return [pscustomobject]@{ exists = $true; kind = $kind; value = $value }
  } catch {
    return [pscustomobject]@{ exists = $false; kind = $null; value = $null }
  }
}

function Restore-RegistrySnapshotRecord {
  param([string]$RegistryPath, [string]$Name, $Snapshot)
  if (-not $Snapshot -or $Snapshot.exists -ne $true) {
    Remove-ItemProperty -LiteralPath $RegistryPath -Name $Name -ErrorAction SilentlyContinue
    return
  }
  if (-not (Test-Path -LiteralPath $RegistryPath)) {
    New-Item -Path $RegistryPath -Force -ErrorAction Stop | Out-Null
  }
  $kind = [string]$Snapshot.kind
  $value = $Snapshot.value
  if ($kind -eq "Binary") {
    $value = [Convert]::FromBase64String([string]$value)
  }
  $propertyType = switch ($kind) {
    "DWord" { "DWord" }
    "QWord" { "QWord" }
    "Binary" { "Binary" }
    "MultiString" { "MultiString" }
    "ExpandString" { "ExpandString" }
    default { "String" }
  }
  New-ItemProperty -LiteralPath $RegistryPath -Name $Name -Value $value `
    -PropertyType $propertyType -Force -ErrorAction Stop | Out-Null
}

function Get-UplinkNetworkAdapters {
  # Use the same safety corridor as the Core DNS controller: connected uplinks
  # are included, while VPN/TUN/capture/loopback adapters are excluded. Windows
  # Sandbox exposes its uplink as a virtual Hyper-V NIC, so HardwareInterface
  # alone is not a reliable definition of the actual internet adapter.
  return @(Get-NetAdapter -ErrorAction Stop | Where-Object {
    $identity = ([string]$_.Name + " " + [string]$_.InterfaceDescription)
    $_.Status -eq "Up" -and
      $identity -notmatch 'WireGuard|Wintun|Cloudflare\s+WARP|VPN|Loopback|isatap|Teredo|Pseudo|Npcap|Bluetooth|(^|[\s_-])(TAP|TUN)([\s_-]|$)|egoist-tun'
  } | Sort-Object ifIndex -Unique)
}

function Save-SystemNetworkBaseline {
  if (Test-Path -LiteralPath $networkBaselinePath -PathType Leaf) { return }

  $userRegistryRoot = if ($script:shieldUserRegistryRoot) { [string]$script:shieldUserRegistryRoot } else { "Registry::HKEY_CURRENT_USER" }
  $internetSettings = Join-Path $userRegistryRoot "Software\Microsoft\Windows\CurrentVersion\Internet Settings"
  $winHttpSettings = "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings\Connections"
  $proxyValues = [ordered]@{}
  foreach ($name in @("ProxyEnable", "ProxyServer", "ProxyOverride", "AutoConfigURL", "AutoDetect")) {
    $proxyValues[$name] = Get-RegistryValueSnapshot $internetSettings $name
  }

  $adapters = @(
    foreach ($adapter in @(Get-UplinkNetworkAdapters)) {
      $ipv4 = @(Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction Stop |
        Select-Object -ExpandProperty ServerAddresses)
      $ipv6 = @(Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv6 -ErrorAction Stop |
        Select-Object -ExpandProperty ServerAddresses)
      $guid = [string]$adapter.InterfaceGuid
      $ipv4NameServer = (Get-ItemProperty -LiteralPath "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$guid" -Name NameServer -ErrorAction SilentlyContinue).NameServer
      $ipv6NameServer = (Get-ItemProperty -LiteralPath "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters\Interfaces\$guid" -Name NameServer -ErrorAction SilentlyContinue).NameServer
      [pscustomobject]@{
        interfaceIndex = [int]$adapter.ifIndex
        interfaceGuid = $guid
        name = [string]$adapter.Name
        ipv4 = @($ipv4)
        ipv6 = @($ipv6)
        ipv4Static = -not [string]::IsNullOrWhiteSpace([string]$ipv4NameServer)
        ipv6Static = -not [string]::IsNullOrWhiteSpace([string]$ipv6NameServer)
      }
    }
  )

  $baseline = [ordered]@{
    schemaVersion = 1
    owner = "EgoistShield"
    capturedAt = (Get-Date).ToString("o")
    proxy = $proxyValues
    winHttpSettings = Get-RegistryValueSnapshot $winHttpSettings "WinHttpSettings"
    adapters = $adapters
  }
  New-Item -ItemType Directory -Path $upgradeStateDirectory -Force -ErrorAction Stop | Out-Null
  $temporary = "$networkBaselinePath.tmp"
  $baseline | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8 -Force -ErrorAction Stop
  Move-Item -LiteralPath $temporary -Destination $networkBaselinePath -Force -ErrorAction Stop
  Write-Journal "network-baseline-captured" @{ adapters = $adapters.Count }
}

function Notify-SystemProxyChanged {
  try {
    if (-not ("EgoistShield.Native.WinInet" -as [type])) {
      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace EgoistShield.Native {
  public static class WinInet {
    [DllImport("wininet.dll", SetLastError=true)]
    public static extern bool InternetSetOption(IntPtr hInternet, int option, IntPtr buffer, int length);
  }
}
"@ -ErrorAction Stop
    }
    [void][EgoistShield.Native.WinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0)
    [void][EgoistShield.Native.WinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0)
  } catch {
    Write-Warning "WinINet settings-change notification failed: $_"
  }
}

function Remove-OwnedTunnelAdapters {
  foreach ($adapter in @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "egoist-tun" -or
      $_.Name -match '^Egoist[ -]?Shield.*(?:TUN|VPN)' -or
      $_.InterfaceDescription -match '^Egoist[ -]?Shield.*(?:TUN|Wintun|VPN)'
  })) {
    $device = Get-CimInstance Win32_NetworkAdapter -Filter "InterfaceIndex=$([int]$adapter.ifIndex)" -ErrorAction SilentlyContinue
    $instanceId = [string]$device.PNPDeviceID
    if (-not $instanceId) {
      throw "Owned tunnel adapter has no PnP identity and could not be removed: $($adapter.Name)"
    }
    Disable-NetAdapter -InterfaceIndex $adapter.ifIndex -Confirm:$false -ErrorAction SilentlyContinue
    [void](Invoke-CheckedExternal (Join-Path $env:SystemRoot "System32\pnputil.exe") @(
      "/remove-device", $instanceId
    ) "remove-owned-tunnel-adapter")
    Write-Journal "owned-tunnel-adapter-removed" @{ name = [string]$adapter.Name; instanceId = $instanceId }
  }
}

function Reset-WindowsNetworkBaseline {
  param([switch]$CaptureForRollback)
  if ($CaptureForRollback) { Save-SystemNetworkBaseline }
  Reset-OwnedNetworkState
  Restore-OwnedDnsTransaction
  Remove-OwnedTunnelAdapters
  Write-Journal "owned-network-reset" @{ foreignConfiguration = "preserved" }
  Write-Output "NETWORK: restored owned DNS/proxy changes; external network configuration preserved."
}

function Restore-SystemNetworkBaseline {
  if (-not (Test-Path -LiteralPath $networkBaselinePath -PathType Leaf)) { return }
  $baseline = Get-Content -LiteralPath $networkBaselinePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ($baseline.schemaVersion -ne 1 -or $baseline.owner -ne "EgoistShield") {
    throw "Installer network baseline is invalid or not owned by EgoistShield."
  }

  $userRegistryRoot = if ($script:shieldUserRegistryRoot) { [string]$script:shieldUserRegistryRoot } else { "Registry::HKEY_CURRENT_USER" }
  $internetSettings = Join-Path $userRegistryRoot "Software\Microsoft\Windows\CurrentVersion\Internet Settings"
  foreach ($name in @("ProxyEnable", "ProxyServer", "ProxyOverride", "AutoConfigURL", "AutoDetect")) {
    Restore-RegistrySnapshotRecord $internetSettings $name $baseline.proxy.$name
  }
  $winHttpSettings = "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings\Connections"
  Restore-RegistrySnapshotRecord $winHttpSettings "WinHttpSettings" $baseline.winHttpSettings
  Notify-SystemProxyChanged

  $restored = 0
  foreach ($saved in @($baseline.adapters)) {
    $adapter = Get-NetAdapter -ErrorAction SilentlyContinue |
      Where-Object { [string]$_.InterfaceGuid -eq [string]$saved.interfaceGuid } |
      Select-Object -First 1
    if (-not $adapter) { continue }
    foreach ($family in @("ipv4", "ipv6")) {
      $addresses = @(if ($family -eq "ipv4") { $saved.ipv4 } else { $saved.ipv6 })
      $isStatic = if ($family -eq "ipv4") { $saved.ipv4Static -eq $true } else { $saved.ipv6Static -eq $true }
      if (-not $isStatic -or $addresses.Count -eq 0) {
        [void](Invoke-CheckedExternal (Join-Path $env:SystemRoot "System32\netsh.exe") @(
          "interface", $family, "set", "dnsservers", "name=$([int]$adapter.ifIndex)", "source=dhcp", "validate=no"
        ) "restore-$family-dns-dhcp")
      } else {
        [void](Invoke-CheckedExternal (Join-Path $env:SystemRoot "System32\netsh.exe") @(
          "interface", $family, "set", "dnsservers", "name=$([int]$adapter.ifIndex)", "source=static", "address=$($addresses[0])", "validate=no"
        ) "restore-$family-dns-primary")
        for ($i = 1; $i -lt $addresses.Count; $i++) {
          [void](Invoke-CheckedExternal (Join-Path $env:SystemRoot "System32\netsh.exe") @(
            "interface", $family, "add", "dnsservers", "name=$([int]$adapter.ifIndex)", "address=$($addresses[$i])", "index=$($i + 1)", "validate=no"
          ) "restore-$family-dns-secondary")
        }
      }
    }
    $restored++
  }
  $ipconfig = if ($env:SystemRoot) { Join-Path $env:SystemRoot "System32\ipconfig.exe" } else { "ipconfig.exe" }
  [void](Invoke-CheckedExternal $ipconfig @("/flushdns") "restore-network-dns-cache")
  Remove-Item -LiteralPath $networkBaselinePath -Force -ErrorAction Stop
  Write-Journal "network-baseline-restored" @{ adapters = $restored }
}

function Complete-SystemNetworkBaseline {
  if (-not (Test-Path -LiteralPath $networkBaselinePath)) { return }
  $item = Get-Item -LiteralPath $networkBaselinePath -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "System network baseline must not be a reparse point: $networkBaselinePath"
  }
  Remove-Item -LiteralPath $networkBaselinePath -Force -ErrorAction Stop
  if (Test-Path -LiteralPath $networkBaselinePath) {
    throw "System network baseline remained after commit: $networkBaselinePath"
  }
}

function Backup-AndResetPersistedNetworkActivation {
  if (Test-Path -LiteralPath $userStateBackupManifestPath -PathType Leaf) { return }
  New-Item -ItemType Directory -Path $userStateBackupDirectory -Force -ErrorAction Stop | Out-Null
  $records = New-Object System.Collections.Generic.List[object]
  $candidates = @(
    (Join-IfSet $roamingAppDataRoot "Egoist Shield\egoistshield-state.json"),
    (Join-IfSet $roamingAppDataRoot "Egoist Shield\egoistshield-state.json.bak"),
    (Join-IfSet $roamingAppDataRoot "EgoistShield\egoistshield-state.json"),
    (Join-IfSet $roamingAppDataRoot "EgoistShield\egoistshield-state.json.bak")
  ) | Where-Object { $_ } | Select-Object -Unique

  foreach ($source in $candidates) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    Assert-OwnedPath $source "persisted network activation state" | Out-Null
    $index = $records.Count
    $backupName = "state-$index.json"
    Copy-Item -LiteralPath $source -Destination (Join-Path $userStateBackupDirectory $backupName) -Force -ErrorAction Stop
    try { $state = Get-Content -LiteralPath $source -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop }
    catch {
      $records.Add([pscustomobject]@{ source = $source; backupName = $backupName })
      Write-Warning "Unreadable previous user state backed up; the application will recover from its valid backup or defaults."
      continue
    }
    if (-not $state.settings) { $state | Add-Member -MemberType NoteProperty -Name settings -Value ([pscustomobject]@{}) }
    foreach ($entry in ([ordered]@{
      autoStart = $false
      autoConnect = $false
      useTunMode = $false
      killSwitch = $false
      systemDohEnabled = $false
      systemDnsServers = ""
      customDnsUrl = ""
      systemDohUrl = ""
      systemDohLocalAddress = ""
    }).GetEnumerator()) {
      if ($state.settings.PSObject.Properties.Name -contains $entry.Key) {
        $state.settings.$($entry.Key) = $entry.Value
      } else {
        $state.settings | Add-Member -MemberType NoteProperty -Name $entry.Key -Value $entry.Value
      }
    }
    $temporary = "$source.install-reset.tmp"
    $serializedState = $state | ConvertTo-Json -Depth 32
    Write-Utf8NoBomFile -Path $temporary -Content $serializedState
    Move-Item -LiteralPath $temporary -Destination $source -Force -ErrorAction Stop
    $records.Add([pscustomobject]@{ source = $source; backupName = $backupName })
  }
  ConvertTo-Json -InputObject @($records.ToArray()) -Depth 4 |
    Set-Content -LiteralPath $userStateBackupManifestPath -Encoding UTF8 -Force -ErrorAction Stop
  Write-Journal "persisted-network-activation-reset" @{ files = $records.Count }
}

function Restore-PersistedNetworkActivation {
  if (-not (Test-Path -LiteralPath $userStateBackupManifestPath -PathType Leaf)) { return }
  $records = @(ConvertFrom-JsonCollectionCompat (
    Get-Content -LiteralPath $userStateBackupManifestPath -Raw -ErrorAction Stop))
  foreach ($record in $records) {
    Assert-OwnedPath ([string]$record.source) "persisted network activation rollback" | Out-Null
    if ([string]$record.backupName -notmatch '^state-\d+\.json$') { throw "Invalid user-state backup record." }
    Copy-Item -LiteralPath (Join-Path $userStateBackupDirectory $record.backupName) `
      -Destination ([string]$record.source) -Force -ErrorAction Stop
  }
  Remove-Item -LiteralPath $userStateBackupDirectory -Recurse -Force -ErrorAction Stop
  Write-Journal "persisted-network-activation-restored" @{ files = $records.Count }
}

function Complete-PersistedNetworkActivation {
  if (-not (Test-Path -LiteralPath $userStateBackupDirectory)) { return }
  Assert-PlainOwnedDirectoryTree $userStateBackupDirectory "Persisted network activation backup"
  Remove-Item -LiteralPath $userStateBackupDirectory -Recurse -Force -ErrorAction Stop
  if (Test-Path -LiteralPath $userStateBackupDirectory) {
    throw "Persisted network activation backup remained after commit: $userStateBackupDirectory"
  }
}

<#
.SYNOPSIS
  Восстанавливает системный прокси из собственного rollback-снимка.
.DESCRIPTION
  Владение подтверждается совпадением текущего ProxyServer с ЛЮБЫМ из
  managed-endpoint'ов сессии (при make-before-break порт меняется, поэтому
  сверка с одним первым портом теряла rollback — HIGH-01). Если текущая
  конфигурация не принадлежит нам, снимок не применяется: пользовательский
  или корпоративный прокси остаётся как есть.
#>
function Reset-OwnedNetworkState {
  $userRegistryRoot = if ($script:shieldUserRegistryRoot) { [string]$script:shieldUserRegistryRoot } else { "Registry::HKEY_CURRENT_USER" }
  $registryPath = Join-Path $userRegistryRoot "Software\Microsoft\Windows\CurrentVersion\Internet Settings"
  $failures = New-Object System.Collections.Generic.List[string]
  foreach ($root in $ownedRoots) {
    $rollbackPath = Join-Path $root "system-proxy-rollback.json"
    if (-not (Test-Path -LiteralPath $rollbackPath)) { continue }
    try {
      $rollback = Get-Content -Raw -LiteralPath $rollbackPath | ConvertFrom-Json
      $currentProxy = (Get-ItemProperty -LiteralPath $registryPath -Name ProxyServer -ErrorAction SilentlyContinue).ProxyServer
      $managed = @()
      if ($rollback.managedEndpoints) { $managed += $rollback.managedEndpoints }
      if ($rollback.proxyServer) { $managed += $rollback.proxyServer }
      $owned = $rollback.schemaVersion -ge 1 -and
        $rollback.owner -eq "EgoistShield" -and
        ($managed -contains $currentProxy)
      if (-not $owned) {
        Write-Warning "System proxy is no longer owned by EgoistShield; user configuration preserved."
        Remove-Item -LiteralPath $rollbackPath -Force -ErrorAction SilentlyContinue
        continue
      }
      foreach ($name in @("ProxyEnable", "ProxyServer", "ProxyOverride", "AutoConfigURL")) {
        Restore-RegistrySnapshotValue $registryPath $name $rollback.values.$name
      }
      Remove-Item -LiteralPath $rollbackPath -Force -ErrorAction Stop
      Write-Journal "proxy-restored" @{ source = "$rollbackPath" }
    } catch {
      Write-Warning "Owned proxy rollback could not be restored from $rollbackPath"
      [void]$failures.Add("${rollbackPath}: $($_.Exception.Message)")
    }
  }
  # Сброс кэша DNS не меняет выбранные сервера и безопасен для чужой настройки.
  $ipconfig = if ($env:SystemRoot) { Join-Path $env:SystemRoot "System32\ipconfig.exe" } else { "ipconfig.exe" }
  [void](Invoke-CheckedExternal $ipconfig @("/flushdns") "flush-dns-cache")
  if ($failures.Count -gt 0) {
    throw ("Owned proxy rollback failed; rollback journal was preserved: " + ($failures -join "; "))
  }
}

<#
.SYNOPSIS
  Доводит до конца незавершённую транзакцию DNS приложения.
.DESCRIPTION
  HIGH-03: раньше текст установщика обещал восстановление DNS, но owned cleanup
  только сбрасывала управляемую конфигурацию и кэш — точный исходный per-adapter
  снимок IPv4/IPv6 не возвращался. Теперь приложение пишет durable-журнал
  транзакции, и установщик применяет его при удалении. Восстанавливается ТОЛЬКО
  наш собственный журнал; чужие настройки не затрагиваются.
#>
function Restore-OwnedDnsTransaction {
  $journal = Join-Path $programDataRoot "EgoistShield\transactions\dns-transaction.json"
  if (-not (Test-Path -LiteralPath $journal)) { return }
  try {
    $transaction = Get-Content -Raw -LiteralPath $journal | ConvertFrom-Json
  } catch {
    Write-Warning "DNS transaction journal is unreadable; left untouched: $journal"
    return
  }
  if ($transaction.owner -ne "EgoistShield" -or $transaction.resource -ne "dns") {
    Write-Warning "DNS transaction journal does not belong to EgoistShield; left untouched."
    return
  }
  if (-not $transaction.original) {
    Remove-Item -LiteralPath $journal -Force -ErrorAction SilentlyContinue
    return
  }

  # Обратный порядок: последний изменённый адаптер возвращается первым.
  $adapters = @($transaction.original)
  [array]::Reverse($adapters)
  $netsh = if ($env:SystemRoot) { Join-Path $env:SystemRoot "System32\netsh.exe" } else { "netsh.exe" }
  $ipconfig = if ($env:SystemRoot) { Join-Path $env:SystemRoot "System32\ipconfig.exe" } else { "ipconfig.exe" }
  $restored = 0
  foreach ($adapter in $adapters) {
    $index = [int]$adapter.interfaceIndex
    if ($adapter.interfaceGuid) {
      $found = Get-NetAdapter -ErrorAction SilentlyContinue |
        Where-Object { [string]$_.InterfaceGuid -eq [string]$adapter.interfaceGuid } |
        Select-Object -First 1
      if ($found) {
        $index = [int]$found.ifIndex
      } else {
        # Адаптера больше нет: применять его настройки к другому индексу нельзя.
        continue
      }
    }
    $current = @(Get-DnsClientServerAddress -InterfaceIndex $index -ErrorAction Stop | Select-Object -ExpandProperty ServerAddresses | Where-Object { $_ })
    $desired = @($transaction.desiredServers | Where-Object { $_ })
    if ($desired.Count -eq 0 -or $current.Count -eq 0 -or @(Compare-Object ($current | Sort-Object -Unique) ($desired | Sort-Object -Unique)).Count -gt 0) {
      Write-Warning "DNS on adapter $index no longer matches Shield ownership; preserved."
      continue
    }
    foreach ($family in @("ipv4", "ipv6")) {
      $addresses = @(if ($family -eq "ipv4") { $adapter.ipv4 } else { $adapter.ipv6 })
      $isStatic = if ($family -eq "ipv4") { $adapter.ipv4Static -eq $true } else { $adapter.ipv6Static -eq $true }
      if (-not $isStatic -or $addresses.Count -eq 0) {
        [void](Invoke-CheckedExternal $netsh @(
          "interface", $family, "set", "dnsservers", "name=$index", "source=dhcp", "validate=no"
        ) "restore-$family-dns-dhcp")
        continue
      }
      [void](Invoke-CheckedExternal $netsh @(
        "interface", $family, "set", "dnsservers", "name=$index", "source=static", "address=$($addresses[0])", "validate=no"
      ) "restore-$family-dns-primary")
      for ($i = 1; $i -lt $addresses.Count; $i++) {
        [void](Invoke-CheckedExternal $netsh @(
          "interface", $family, "add", "dnsservers", "name=$index", "address=$($addresses[$i])", "index=$($i + 1)", "validate=no"
        ) "restore-$family-dns-secondary")
      }
    }
    $restored++
  }
  # Keep the transaction journal until every adapter and the cache flush have
  # succeeded.  A netsh failure must remain retryable after reboot/uninstall.
  [void](Invoke-CheckedExternal $ipconfig @("/flushdns") "restore-dns-cache")
  Remove-Item -LiteralPath $journal -Force -ErrorAction Stop
  Write-Journal "dns-restored" @{ adapters = $restored }
  Write-Output ("DNS: restored $restored adapter(s) from the owned transaction journal.")
}

function Remove-OwnedFirewallRules {
  if (-not (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue)) { return }
  $rules = @(Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object {
    [string]$_.Name -match '^(EgoistShield|EGISShield)(?:-|$)' -or
      [string]$_.DisplayName -match '^(Egoist Shield|EgoistShield|EGIS Shield)(?:\s|-|$)'
  })
  foreach ($rule in $rules) {
    Remove-NetFirewallRule -Name $rule.Name -ErrorAction Stop
  }
  if ($rules.Count -gt 0) { Write-Journal "owned-firewall-rules-removed" @{ rules = $rules.Count } }
}

function Discard-OwnedNetworkArtifacts {
  $dnsJournal = Join-Path $programDataRoot "EgoistShield\transactions\dns-transaction.json"
  if (Test-Path -LiteralPath $dnsJournal -PathType Leaf) {
    $transaction = Get-Content -LiteralPath $dnsJournal -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($transaction.owner -ne "EgoistShield" -or $transaction.resource -ne "dns") {
      throw "Refusing to discard an unowned DNS transaction journal."
    }
    Remove-Item -LiteralPath $dnsJournal -Force -ErrorAction Stop
  }
  foreach ($root in $ownedRoots) {
    $rollbackPath = Join-Path $root "system-proxy-rollback.json"
    if (-not (Test-Path -LiteralPath $rollbackPath -PathType Leaf)) { continue }
    $rollback = Get-Content -LiteralPath $rollbackPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($rollback.owner -ne "EgoistShield") {
      throw "Refusing to discard an unowned proxy rollback record: $rollbackPath"
    }
    Remove-Item -LiteralPath $rollbackPath -Force -ErrorAction Stop
  }
  Write-Journal "owned-network-artifacts-discarded" @{}
}

function Get-OwnedRuntimeDirectories {
  $directories = @(
    (Join-IfSet $programDataRoot "EgoistShield\runtime"),
    (Join-IfSet $programDataRoot "EgoistShield\GravitylessDNS"),
    (Join-IfSet $programDataRoot "EgoistShield\Zapret"),
    (Join-IfSet $programDataRoot "EgoistShield\TelegramProxy"),
    (Join-IfSet $localAppDataRoot "EgoistShield\runtime"),
    (Join-IfSet $localAppDataRoot "EgoistShield\gravityless-dns"),
    (Join-IfSet $localAppDataRoot "EgoistShield\zapret"),
    (Join-IfSet $localAppDataRoot "EgoistShield\tg-ws-proxy"),
    (Join-IfSet $roamingAppDataRoot "Egoist Shield\runtime"),
    (Join-IfSet $roamingAppDataRoot "Egoist Shield\system-doh"),
    (Join-IfSet $roamingAppDataRoot "Egoist Shield\telegram-proxy"),
    (Join-IfSet $roamingAppDataRoot "Egoist Shield\zapret"),
    (Join-IfSet $roamingAppDataRoot "Egoist Shield\gravityless-dns"),
    (Join-IfSet $roamingAppDataRoot "EgoistShield\runtime"),
    (Join-IfSet $roamingAppDataRoot "EgoistShield\system-doh"),
    (Join-IfSet $roamingAppDataRoot "EgoistShield\telegram-proxy"),
    (Join-IfSet $roamingAppDataRoot "EgoistShield\zapret")
  ) | Where-Object { $_ } | Select-Object -Unique
  return @($directories | Where-Object { $_ } | Select-Object -Unique)
}

function Write-RuntimeQuarantineManifest {
  param([object[]]$Records)
  New-Item -ItemType Directory -Path $upgradeStateDirectory -Force -ErrorAction Stop | Out-Null
  $temporary = "$runtimeQuarantineManifestPath.tmp"
  $validRecords = @($Records | Where-Object { $null -ne $_ })
  $json = if ($validRecords.Count -eq 0) {
    "[]"
  } else {
    ConvertTo-Json -InputObject $validRecords -Depth 4
  }
  Set-Content -LiteralPath $temporary -Value $json -Encoding UTF8 -Force -ErrorAction Stop
  Move-Item -LiteralPath $temporary -Destination $runtimeQuarantineManifestPath -Force -ErrorAction Stop
}

function Merge-StaleOwnedRuntimeDirectory {
  param([string]$Source, [string]$Destination)
  # Validate every collision before moving anything. A split directory is not
  # evidence that either of two different configuration files is disposable.
  foreach ($oldFile in @(Get-ChildItem -LiteralPath $Destination -Recurse -File -Force -ErrorAction Stop)) {
    $relative = $oldFile.FullName.Substring($Destination.TrimEnd('\').Length + 1)
    $liveFile = Join-Path $Source $relative
    if (Test-Path -LiteralPath $liveFile) {
      $oldHash = Get-FileSha256 $oldFile.FullName
      $liveHash = Get-FileSha256 $liveFile
      if (-not (Test-Path -LiteralPath $liveFile -PathType Leaf) -or -not $oldHash -or -not $liveHash -or $liveHash -ne $oldHash) {
        throw "Different runtime files require recovery; both copies preserved: $liveFile; $($oldFile.FullName)"
      }
    }
  }
  foreach ($item in @(Get-ChildItem -LiteralPath $Destination -Force -ErrorAction Stop)) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Stale runtime quarantine contains a reparse point: $($item.FullName)"
    }
    $target = Join-Path $Source $item.Name
    if (-not (Test-Path -LiteralPath $target)) {
      if ($item.PSIsContainer) { [IO.Directory]::Move($item.FullName, $target) }
      else { [IO.File]::Move($item.FullName, $target) }
      continue
    }
    $targetItem = Get-Item -LiteralPath $target -Force -ErrorAction Stop
    if ($item.PSIsContainer -and $targetItem.PSIsContainer) {
      Merge-StaleOwnedRuntimeDirectory $target $item.FullName
      continue
    }
    if ($item.PSIsContainer -ne $targetItem.PSIsContainer) {
      throw "Runtime file/directory conflict; both copies preserved: $target"
    }
    # Only byte-identical duplicate files reach this branch.
    Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction Stop
  }
  if (@(Get-ChildItem -LiteralPath $Destination -Force -ErrorAction Stop).Count -eq 0) {
    Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction Stop
  }
}

function Repair-StaleOwnedRuntimeQuarantine {
  # A crash during PreInstall can leave runtime-quarantine.json without an
  # active upgrade marker. Treat that as an interrupted preparation, not as a
  # live rollback: preserve anything already recreated in the source tree,
  # merge only missing files from the owned sibling quarantine, then clear the
  # stale manifest so the next install can start cleanly.
  $records = @(Read-OwnedRuntimeQuarantine)
  foreach ($record in $records) {
    $source = Assert-OwnedPath ([string]$record.source) "stale runtime source"
    $destination = Resolve-NormalizedPath ([string]$record.destination)
    if (-not $destination -or
        (Split-Path -Parent $destination) -ne (Split-Path -Parent $source) -or
        -not $destination.StartsWith("$source.upgrade-old-", [StringComparison]::OrdinalIgnoreCase)) {
      throw "Invalid stale runtime quarantine record: $destination"
    }
    $sourceExists = Test-Path -LiteralPath $source -PathType Container
    $destinationExists = Test-Path -LiteralPath $destination -PathType Container
    if ($destinationExists) { Assert-PlainOwnedDirectoryTree $destination "stale runtime quarantine" }
    if (-not $sourceExists -and $destinationExists) {
      [IO.Directory]::Move($destination, $source)
      continue
    }
    if (-not $destinationExists) { continue }
    Assert-PlainOwnedDirectoryTree $source "stale runtime source"
    Assert-PlainOwnedDirectoryTree $destination "stale runtime quarantine"
    Merge-StaleOwnedRuntimeDirectory $source $destination
    if (Test-Path -LiteralPath $destination) { throw "Stale runtime quarantine could not be reconciled: $destination" }
  }
  Remove-Item -LiteralPath $runtimeQuarantineManifestPath -Force -ErrorAction Stop
  Write-Journal "stale-runtime-quarantine-reconciled" @{ records = $records.Count }
}

function New-OwnedRuntimeQuarantine {
  if (Test-Path -LiteralPath $runtimeQuarantineManifestPath -PathType Leaf) {
    $pending = Get-ValidatedUpgradeQuarantine
    if ($pending -and (Test-Path -LiteralPath $pending -PathType Container)) { return }
    Repair-StaleOwnedRuntimeQuarantine
  }
  $records = New-Object System.Collections.Generic.List[object]
  foreach ($directory in @(Get-OwnedRuntimeDirectories)) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { continue }
    $source = Assert-OwnedPath $directory "optional runtime quarantine"
    $destination = "$source.upgrade-old-$([Guid]::NewGuid().ToString('N'))"
    if ((Split-Path -Parent $destination) -ne (Split-Path -Parent $source) -or
        -not $destination.StartsWith("$source.upgrade-old-", [StringComparison]::OrdinalIgnoreCase)) {
      throw "Invalid optional runtime quarantine path: $destination"
    }
    $records.Add([pscustomobject]@{ source = $source; destination = $destination })
  }
  Write-RuntimeQuarantineManifest @($records.ToArray())
  try {
    foreach ($record in $records) {
      # Same-volume rename is atomic; Move-Item can move individual children
      # and leave a split runtime when one protected file cannot be moved.
      Move-OwnedDirectoryWithRetry $record.source $record.destination
    }
  } catch {
    $moveError = $_
    Write-Journal "optional-runtime-quarantine-failed" @{ error = "$($moveError.Exception.Message)" }
    try {
      Restore-OwnedRuntimeQuarantine
      # Optional runtimes live outside Program Files and are not overwritten by
      # NSIS. If a scanner briefly holds one, keeping it in place is safer than
      # aborting an otherwise valid application update.
      Write-Warning "Optional runtime quarantine was skipped because a file is busy: $moveError"
      Write-Journal "optional-runtime-quarantine-skipped" @{ error = "$($moveError.Exception.Message)" }
      return
    } catch {
      throw "Optional runtime quarantine failed and could not be restored: $($_.Exception.Message)"
    }
  }
  Write-Journal "optional-runtime-quarantined" @{ directories = $records.Count }
}

function Move-OwnedDirectoryWithRetry {
  param([string]$Source, [string]$Destination, [int]$Attempts = 4)
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      [IO.Directory]::Move($Source, $Destination)
      return
    } catch {
      $reason = $_.Exception
      while ($reason.InnerException) { $reason = $reason.InnerException }
      $retryable = $reason -is [IO.IOException] -or $reason -is [UnauthorizedAccessException]
      if (-not $retryable -or $attempt -ge $Attempts) { throw }
      Start-Sleep -Milliseconds 250
    }
  }
}

function Read-OwnedRuntimeQuarantine {
  if (-not (Test-Path -LiteralPath $runtimeQuarantineManifestPath -PathType Leaf)) { return @() }
  $records = @(ConvertFrom-JsonCollectionCompat (
    Get-Content -LiteralPath $runtimeQuarantineManifestPath -Raw -ErrorAction Stop))
  foreach ($record in $records) {
    if ($null -eq $record) { continue }
    $sourceValue = [string]$record.source
    $destinationValue = [string]$record.destination
    # Windows PowerShell 5.1 can materialize an empty JSON collection as a
    # null/empty object. It means there was no optional runtime to quarantine.
    if ([string]::IsNullOrWhiteSpace($sourceValue) -and
        [string]::IsNullOrWhiteSpace($destinationValue)) { continue }
    if ([string]::IsNullOrWhiteSpace($sourceValue) -or
        [string]::IsNullOrWhiteSpace($destinationValue)) {
      throw "Incomplete optional runtime quarantine record."
    }
    $source = Assert-OwnedPath $sourceValue "optional runtime rollback source"
    $destination = Resolve-NormalizedPath $destinationValue
    if (-not $destination -or (Split-Path -Parent $destination) -ne (Split-Path -Parent $source) -or
        -not $destination.StartsWith("$source.upgrade-old-", [StringComparison]::OrdinalIgnoreCase)) {
      throw "Invalid optional runtime quarantine record."
    }
    Write-Output ([pscustomobject]@{ source = $source; destination = $destination })
  }
}

function Restore-OwnedRuntimeQuarantine {
  $records = @(Read-OwnedRuntimeQuarantine)
  [array]::Reverse($records)
  foreach ($record in $records) {
    if (-not (Test-Path -LiteralPath $record.destination -PathType Container)) { continue }
    if (Test-Path -LiteralPath $record.source) {
      Assert-PlainOwnedDirectoryTree $record.source "runtime rollback source"
      Assert-PlainOwnedDirectoryTree $record.destination "runtime rollback quarantine"
      Merge-StaleOwnedRuntimeDirectory $record.source $record.destination
    } else {
      Move-OwnedDirectoryWithRetry $record.destination $record.source
    }
  }
  Remove-Item -LiteralPath $runtimeQuarantineManifestPath -Force -ErrorAction SilentlyContinue
  Write-Journal "optional-runtime-restored" @{ directories = $records.Count }
}

function Assert-PlainOwnedDirectoryTree {
  param([string]$Path, [string]$Because)
  $root = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (-not $root.PSIsContainer) { throw "$Because must be a directory: $Path" }
  if (($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Because must not itself be a reparse point: $($root.FullName)"
  }

  # Traverse one level at a time and never enqueue a reparse point. A recursive
  # ACL tool must not be allowed to follow a junction/symlink outside the exact
  # validated quarantine, even though the manifest itself is protected.
  $pending = New-Object 'System.Collections.Generic.Queue[string]'
  $pending.Enqueue($root.FullName)
  while ($pending.Count -gt 0) {
    $current = $pending.Dequeue()
    foreach ($item in @(Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop)) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Because contains a reparse point: $($item.FullName)"
      }
      if ($item.PSIsContainer) { $pending.Enqueue($item.FullName) }
    }
  }
}

function Repair-OwnedRuntimeQuarantineAccess {
  param([object]$Record)
  $source = Assert-OwnedPath ([string]$Record.source) "optional runtime cleanup source"
  $destination = Resolve-NormalizedPath ([string]$Record.destination)
  if (-not $destination -or
      (Split-Path -Parent $destination) -ne (Split-Path -Parent $source) -or
      -not $destination.StartsWith("$source.upgrade-old-", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to repair ACLs for an invalid optional runtime quarantine: $destination"
  }
  if (-not (Test-Path -LiteralPath $destination -PathType Container)) { return }

  Assert-PlainOwnedDirectoryTree $destination "Optional runtime quarantine"

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $identity.User) { throw "Could not resolve the installer identity SID for runtime cleanup." }
  $installerIdentitySid = $identity.User.Value
  $administratorsSid = New-Object Security.Principal.SecurityIdentifier("S-1-5-32-544")
  $systemSid = New-Object Security.Principal.SecurityIdentifier("S-1-5-18")

  if (-not $env:EGOISTSHIELD_INSTALLER_STATE_DIR) {
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      throw "Repairing an owned runtime quarantine requires an elevated administrator token."
    }
    $takeown = Join-Path $env:SystemRoot "System32\takeown.exe"
    [void](Invoke-CheckedExternal $takeown @(
      "/F", $destination, "/A", "/R", "/D", "Y"
    ) "runtime-quarantine-takeown")
  }

  # Old Core versions could leave explicit child DACLs that deny even an
  # elevated installer. icacls /C can return zero while merely reporting that
  # one protected child was skipped, which recreates the exact VERSION.txt
  # failure on the following Remove-Item. Set a complete DACL per item through
  # .NET instead: any failure is an exception and therefore remains fail-closed.
  $installerSid = New-Object Security.Principal.SecurityIdentifier($installerIdentitySid)
  $allowedSids = @($systemSid, $administratorsSid, $installerSid) |
    Group-Object Value | ForEach-Object { $_.Group[0] }

  $pending = New-Object 'System.Collections.Generic.Queue[string]'
  $pending.Enqueue($destination)
  while ($pending.Count -gt 0) {
    $current = $pending.Dequeue()
    $directoryAcl = New-Object Security.AccessControl.DirectorySecurity
    $directoryAcl.SetAccessRuleProtection($true, $false)
    foreach ($sid in $allowedSids) {
      $rule = New-Object Security.AccessControl.FileSystemAccessRule(
        $sid,
        [Security.AccessControl.FileSystemRights]::FullControl,
        ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow)
      [void]$directoryAcl.AddAccessRule($rule)
    }
    [IO.Directory]::SetAccessControl($current, $directoryAcl)

    foreach ($item in @(Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop)) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Repaired optional runtime quarantine contains a reparse point: $($item.FullName)"
      }
      if ($item.PSIsContainer) {
        $pending.Enqueue($item.FullName)
        continue
      }
      $fileAcl = New-Object Security.AccessControl.FileSecurity
      $fileAcl.SetAccessRuleProtection($true, $false)
      foreach ($sid in $allowedSids) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
          $sid,
          [Security.AccessControl.FileSystemRights]::FullControl,
          [Security.AccessControl.AccessControlType]::Allow)
        [void]$fileAcl.AddAccessRule($rule)
      }
      [IO.File]::SetAccessControl($item.FullName, $fileAcl)
    }
  }

  Assert-PlainOwnedDirectoryTree $destination "Repaired optional runtime quarantine"
}

function Complete-OwnedRuntimeQuarantine {
  foreach ($record in @(Read-OwnedRuntimeQuarantine)) {
    if (Test-Path -LiteralPath $record.destination) {
      Repair-OwnedRuntimeQuarantineAccess $record
      Remove-Item -LiteralPath $record.destination -Recurse -Force -ErrorAction Stop
    }
  }
  if (Test-Path -LiteralPath $runtimeQuarantineManifestPath) {
    $manifestItem = Get-Item -LiteralPath $runtimeQuarantineManifestPath -Force -ErrorAction Stop
    if (($manifestItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Optional runtime quarantine manifest must not be a reparse point: $runtimeQuarantineManifestPath"
    }
    Remove-Item -LiteralPath $runtimeQuarantineManifestPath -Force -ErrorAction Stop
  }
  if (Test-Path -LiteralPath $runtimeQuarantineManifestPath) {
    throw "Optional runtime quarantine manifest remained after commit: $runtimeQuarantineManifestPath"
  }
}

function Remove-OwnedRuntimeDirectories {
  foreach ($directory in @(Get-OwnedRuntimeDirectories)) {
    if (-not (Test-Path -LiteralPath $directory)) { continue }
    $ownedDirectory = Assert-OwnedPath $directory "owned runtime removal"
    Remove-Item -LiteralPath $ownedDirectory -Recurse -Force -ErrorAction Stop
  }
}

function Update-ShellIconCache {
  & ie4uinit.exe -ClearIconCache | Out-Null
  & ie4uinit.exe -show | Out-Null
}

# ============================================================================
# Транзакционное обновление: prepare -> quarantine -> install -> verify ->
# commit, с возвратом прошлой версии при любой ошибке.
# ============================================================================

function Get-FileSha256 {
  param([string]$Path)
  $stream = $null
  $hasher = $null
  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    if ($hasher) { $hasher.Dispose() }
    if ($stream) { $stream.Dispose() }
  }
}

function Test-InstallRootIdentified {
  param([string]$Root)
  if (-not $Root -or -not (Test-Path -LiteralPath $Root -PathType Container)) { return $false }
  foreach ($required in $installIdentityRequiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $required) -PathType Leaf)) { return $false }
  }
  try {
    $exe = Get-Item -LiteralPath (Join-Path $Root "EgoistShield.exe") -ErrorAction Stop
    return $exe.Length -ge 1MB
  } catch {
    return $false
  }
}

function Test-InstallRootHealthy {
  param([string]$Root)
  $fail = {
    param([string]$Reason)
    Write-Warning "Install health-check failed: $Reason"
    return $false
  }
  if (-not (Test-InstallRootIdentified $Root)) { return (& $fail "install root identity is missing or truncated") }
  foreach ($required in $installHealthRequiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $required) -PathType Leaf)) { return (& $fail "missing $required") }
  }

  try {
    $manifestPath = Join-Path $Root "resources\runtime\manifest.json"
    $runtimeRoot = Split-Path -Parent $manifestPath
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ([int]$manifest.schemaVersion -ne 1) { return (& $fail "unsupported runtime manifest schema") }
    $requiredComponents = @("xray", "sing-box", "zapret", "tg-ws-proxy")
    $presentComponents = @($manifest.components | Where-Object { $_.present -eq $true })
    foreach ($requiredComponent in $requiredComponents) {
      if (-not ($presentComponents | Where-Object { $_.name -eq $requiredComponent } | Select-Object -First 1)) {
        return (& $fail "runtime component $requiredComponent is missing")
      }
    }
    foreach ($component in $presentComponents) {
      $files = @($component.files)
      if ($files.Count -eq 0 -or [int]$component.fileCount -ne $files.Count) { return (& $fail "runtime component $($component.name) has an invalid file inventory") }
      foreach ($file in $files) {
        if (-not $file.path -or "$($file.sha256)" -notmatch '^[a-fA-F0-9]{64}$') { return (& $fail "runtime component $($component.name) has invalid metadata") }
        $candidate = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot "$($file.path)"))
        if (-not $candidate.StartsWith("$runtimeRoot\", [StringComparison]::OrdinalIgnoreCase)) { return (& $fail "runtime path escapes the package root: $($file.path)") }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return (& $fail "runtime file is missing: $($file.path)") }
        $actualHash = Get-FileSha256 $candidate
        if (-not $actualHash.Equals("$($file.sha256)", [StringComparison]::OrdinalIgnoreCase)) { return (& $fail "runtime checksum mismatch: $($file.path)") }
      }
    }

    $zapretProfiles = @(Get-ChildItem -LiteralPath (Join-Path $runtimeRoot "zapret\core") -Filter "*.bat" -File -ErrorAction Stop)
    if ($zapretProfiles.Count -lt 10) { return (& $fail "Zapret profile set is incomplete") }
  } catch {
    return (& $fail "runtime manifest validation failed: $($_.Exception.Message)")
  }
  return $true
}

function Test-EmptyPlainDirectory {
  param([string]$Root)
  if (-not $Root -or -not (Test-Path -LiteralPath $Root -PathType Container)) { return $false }
  try {
    $item = Get-Item -LiteralPath $Root -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    return $null -eq (Get-ChildItem -LiteralPath $Root -Force -ErrorAction Stop | Select-Object -First 1)
  } catch {
    return $false
  }
}

function Test-InstallRootUnderProgramFiles {
  param([string]$Root)
  if (-not $Root) { return $false }
  $cleanRoot = [string]$Root
  $cleanRoot = $cleanRoot.Trim("`t`r`n `"`'").Trim([char]0xFEFF)
  $normalized = Resolve-NormalizedPath $cleanRoot
  if (-not $normalized) { return $false }
  if (-not [System.IO.Path]::IsPathRooted($normalized)) { return $false }
  if ($normalized -notmatch '^[A-Za-z]:\\') { return $false }

  # Must not be a bare drive root (e.g. C:\ or D:\)
  $driveRoot = [System.IO.Path]::GetPathRoot($normalized).TrimEnd("\") + "\"
  if ($normalized.TrimEnd("\") -eq $driveRoot.TrimEnd("\")) { return $false }

  # Must not be under Windows or System32
  if ($env:SystemRoot) {
    $winDir = [System.IO.Path]::GetFullPath($env:SystemRoot).TrimEnd("\")
    if ($normalized.Equals($winDir, [StringComparison]::OrdinalIgnoreCase) -or
        $normalized.StartsWith("$winDir\", [StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }
  }

  # Must not be under temporary folders
  $tempRoots = New-Object System.Collections.Generic.List[string]
  foreach ($candidate in @([System.IO.Path]::GetTempPath(), $env:TEMP, $env:TMP)) {
    if ($candidate) {
      try { $tempRoots.Add(([System.IO.Path]::GetFullPath($candidate)).TrimEnd("\")) } catch { }
    }
  }
  if ($env:SystemRoot) {
    try { $tempRoots.Add(([System.IO.Path]::GetFullPath((Join-Path $env:SystemRoot "Temp"))).TrimEnd("\")) } catch { }
  }
  if ($localAppDataRoot) {
    try { $tempRoots.Add(([System.IO.Path]::GetFullPath((Join-Path $localAppDataRoot "Temp"))).TrimEnd("\")) } catch { }
  }

  foreach ($t in $tempRoots) {
    if ($normalized.Equals($t, [StringComparison]::OrdinalIgnoreCase) -or
        $normalized.StartsWith("$t\", [StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }
  }

  # Must not be user profiles root itself or the exact user profile root
  $userProfileRoots = New-Object System.Collections.Generic.List[string]
  if ($env:USERPROFILE) {
    try {
      $parentProfile = Split-Path -Parent $env:USERPROFILE
      if ($parentProfile) { $userProfileRoots.Add(([System.IO.Path]::GetFullPath($parentProfile)).TrimEnd("\")) }
      $userProfileRoots.Add(([System.IO.Path]::GetFullPath($env:USERPROFILE)).TrimEnd("\"))
    } catch { }
  }

  foreach ($u in $userProfileRoots) {
    if ($normalized.Equals($u, [StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }
  }

  # Must not be ProgramData root itself
  if ($programDataRoot) {
    $pd = try { [System.IO.Path]::GetFullPath($programDataRoot).TrimEnd("\") } catch { $null }
    if ($pd -and $normalized.Equals($pd, [StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }
  }

  return $true
}

function Test-ValidQuarantinePath {
  param([string]$Candidate, [string]$Root)
  if (-not $Candidate -or -not $Root) { return $false }
  $parent = Split-Path -Parent $Root
  $leaf = Split-Path -Leaf $Root
  if (-not $parent -or -not $leaf) { return $false }
  if (-not $Candidate.StartsWith("$parent\$leaf.upgrade-old-", [StringComparison]::OrdinalIgnoreCase)) { return $false }
  if ((Split-Path -Parent $Candidate) -ne $parent) { return $false }
  return $true
}

function Get-ValidatedUpgradeQuarantine {
  if (-not (Test-Path -LiteralPath $upgradeMarkerPath)) { return $null }
  $raw = (Get-Content -LiteralPath $upgradeMarkerPath -Raw -ErrorAction Stop).Trim()
  $committedPrefix = if ($script:committedUpgradeMarkerPrefix) { [string]$script:committedUpgradeMarkerPrefix } else { "COMMITTED|" }
  if ($raw.StartsWith($committedPrefix, [StringComparison]::Ordinal)) {
    # A committed candidate must never be treated as an active rollback.  The
    # old quarantine may remain temporarily when deletion hit a sharing lock,
    # but the marker is deliberately stateful so a later PreInstall cannot
    # downgrade a healthy, already-committed installation.
    $committed = Get-CommittedUpgradeQuarantine
    return $null
  }
  $candidate = Resolve-NormalizedPath $raw
  if (-not (Test-ValidQuarantinePath $candidate $installRoot)) {
    throw "Invalid pending upgrade quarantine path: $candidate"
  }
  return $candidate
}

function Get-CommittedUpgradeQuarantine {
  if (-not (Test-Path -LiteralPath $upgradeMarkerPath -PathType Leaf)) { return $null }
  $raw = (Get-Content -LiteralPath $upgradeMarkerPath -Raw -ErrorAction Stop).Trim()
  $committedPrefix = if ($script:committedUpgradeMarkerPrefix) { [string]$script:committedUpgradeMarkerPrefix } else { "COMMITTED|" }
  if (-not $raw.StartsWith($committedPrefix, [StringComparison]::Ordinal)) { return $null }
  $committed = Resolve-NormalizedPath $raw.Substring($committedPrefix.Length)
  if (-not (Test-ValidQuarantinePath $committed $installRoot)) {
    throw "Invalid committed upgrade quarantine path: $committed"
  }
  return $committed
}

function Repair-UpgradeStateAccess {
  # Older branded installers protected the parent Installer directory but did
  # not replace explicit ACLs already present on children. A stale marker could
  # therefore remain unreadable even to the next elevated cleanup process and
  # fail PreInstall before recovery began. Repair only this exact product-owned
  # state root; test fixtures keep their caller-owned ACLs.
  if ($env:EGOISTSHIELD_INSTALLER_STATE_DIR) {
    New-Item -ItemType Directory -Path $upgradeStateDirectory -Force -ErrorAction Stop | Out-Null
    return
  }

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Repairing the installer transaction state requires an elevated administrator token."
  }
  if (-not $identity.User) {
    throw "Could not resolve the elevated installer identity SID."
  }
  $installerIdentitySid = $identity.User.Value

  $expected = Resolve-NormalizedPath (Join-Path $programDataRoot "EgoistShield\installer")
  $actual = Resolve-NormalizedPath $upgradeStateDirectory
  if (-not $expected -or -not $actual -or
      -not $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to repair ACLs outside the owned installer state root: $upgradeStateDirectory"
  }

  New-Item -ItemType Directory -Path $upgradeStateDirectory -Force -ErrorAction Stop | Out-Null
  $stateItem = Get-Item -LiteralPath $upgradeStateDirectory -Force -ErrorAction Stop
  if (($stateItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Installer state root must not be a reparse point: $upgradeStateDirectory"
  }

  $takeown = Join-Path $env:SystemRoot "System32\takeown.exe"
  # Never recurse through the Installer parent. It also contains Logs and the
  # currently executing SecureWork payload. A previous /T repair rewrote the
  # ACL of owned-cleanup.ps1 between Recover and FreeFiles, so the installer
  # denied access to its own next phase on a clean machine.
  [void](Invoke-CheckedExternal $takeown @(
    "/F", $upgradeStateDirectory, "/A"
  ) "installer-state-root-takeown")

  $systemSid = New-Object Security.Principal.SecurityIdentifier("S-1-5-18")
  $administratorsSid = New-Object Security.Principal.SecurityIdentifier("S-1-5-32-544")
  $installerSid = New-Object Security.Principal.SecurityIdentifier($installerIdentitySid)
  $allowedSids = @($systemSid, $administratorsSid, $installerSid) |
    Group-Object Value | ForEach-Object { $_.Group[0] }
  $setDirectoryAcl = {
    param([string]$Path)
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    # takeown.exe above is the only owner-changing primitive. Re-applying the
    # owner through DirectorySecurity/FileSecurity requires SeRestorePrivilege
    # on some Home/Pro systems even for an elevated administrator and caused the
    # 3.5.3 UnauthorizedAccessException upgrade regression.
    foreach ($sid in $allowedSids) {
      $rule = New-Object Security.AccessControl.FileSystemAccessRule(
        $sid,
        [Security.AccessControl.FileSystemRights]::FullControl,
        ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow)
      [void]$acl.AddAccessRule($rule)
    }
    try {
      [IO.Directory]::SetAccessControl($Path, $acl)
    } catch {
      throw "Failed to repair installer transaction directory DACL '$Path': $($_.Exception.Message)"
    }
  }
  $setFileAcl = {
    param([string]$Path)
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in $allowedSids) {
      $rule = New-Object Security.AccessControl.FileSystemAccessRule(
        $sid,
        [Security.AccessControl.FileSystemRights]::FullControl,
        [Security.AccessControl.AccessControlType]::Allow)
      [void]$acl.AddAccessRule($rule)
    }
    try {
      [IO.File]::SetAccessControl($Path, $acl)
    } catch {
      throw "Failed to repair installer transaction file DACL '$Path': $($_.Exception.Message)"
    }
  }
  & $setDirectoryAcl $upgradeStateDirectory

  # Repair only the three legacy transaction artifacts which older releases
  # may have left with explicit child ACLs. Exact-name selection prevents this
  # compatibility path from touching Logs, SecureWork, or unrelated children.
  $repairNames = @(
    [System.IO.Path]::GetFileName($upgradeMarkerPath),
    [System.IO.Path]::GetFileName($upgradeJournalPath),
    [System.IO.Path]::GetFileName($registrationBackupDirectory),
    [System.IO.Path]::GetFileName($networkBaselinePath),
    [System.IO.Path]::GetFileName($userStateBackupDirectory),
    [System.IO.Path]::GetFileName($serviceBackupDirectory),
    [System.IO.Path]::GetFileName($runtimeQuarantineManifestPath)
  )
  $repairItems = @(Get-ChildItem -LiteralPath $upgradeStateDirectory -Force -ErrorAction Stop |
    Where-Object { $repairNames -contains $_.Name })
  foreach ($repairItem in $repairItems) {
    if (($repairItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Installer transaction artifact must not be a reparse point: $($repairItem.FullName)"
    }
    $takeownArguments = @("/F", $repairItem.FullName, "/A")
    if ($repairItem.PSIsContainer) {
      $takeownArguments += @("/R", "/D", "Y")
    }
    [void](Invoke-CheckedExternal $takeown $takeownArguments "installer-state-child-takeown")
    # icacls /C can return success while reporting a skipped protected child.
    # Apply a complete DACL with .NET instead: every skipped item is now a hard
    # exception, and the exact elevated identity remains usable after Core has
    # recursively hardened ProgramData between InstallCoreService/PostInstall.
    if ($repairItem.PSIsContainer) {
      $pending = New-Object 'System.Collections.Generic.Queue[string]'
      $pending.Enqueue($repairItem.FullName)
      while ($pending.Count -gt 0) {
        $current = $pending.Dequeue()
        & $setDirectoryAcl $current
        foreach ($child in @(Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop)) {
          if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Installer transaction artifact must not contain a reparse point: $($child.FullName)"
          }
          if ($child.PSIsContainer) {
            $pending.Enqueue($child.FullName)
          } else {
            & $setFileAcl $child.FullName
          }
        }
      }
    } else {
      & $setFileAcl $repairItem.FullName
    }
  }
}

function Get-OwnedInstallRegistrationKeys {
  $result = New-Object System.Collections.Generic.List[object]
  $testRegistryRoot = [Environment]::GetEnvironmentVariable("EGOISTSHIELD_INSTALLER_TEST_REGISTRY_ROOT")
  $hives = if ($testRegistryRoot) {
    if ($testRegistryRoot -notmatch '^HKEY_CURRENT_USER\\Software\\EgoistShieldInstallerTests\\[A-Za-z0-9-]+$') {
      throw "Invalid installer registry test root."
    }
    @(@{
      Provider = "Registry::$testRegistryRoot"
      Native = $testRegistryRoot
      UninstallRelative = "Uninstall"
      InstallRelative = "Install"
    })
  } else {
    @(
      @{
        Provider = "Registry::HKEY_LOCAL_MACHINE"
        Native = "HKEY_LOCAL_MACHINE"
        UninstallRelative = "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
        InstallRelative = "SOFTWARE"
      },
      @{
        Provider = "Registry::HKEY_LOCAL_MACHINE"
        Native = "HKEY_LOCAL_MACHINE"
        UninstallRelative = "SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
        InstallRelative = "SOFTWARE\WOW6432Node"
      },
      @{
        Provider = "Registry::HKEY_CURRENT_USER"
        Native = "HKEY_CURRENT_USER"
        UninstallRelative = "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
        InstallRelative = "SOFTWARE"
      }
    )
  }

  foreach ($hive in $hives) {
    $uninstallBaseProvider = "$($hive.Provider)\$($hive.UninstallRelative)"
    $uninstallBaseNative = "$($hive.Native)\$($hive.UninstallRelative)"
    foreach ($key in @(Get-ChildItem -LiteralPath $uninstallBaseProvider -ErrorAction SilentlyContinue)) {
      $values = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
      if (-not $values -or "$($values.DisplayName)" -notmatch '^(Egoist\s*Shield|EgoistShield|EGIS\s*Shield)$') { continue }
      $uninstaller = Get-ExecutableFromCommandLine "$($values.UninstallString)"
      $uninstallerName = if ($uninstaller) { [System.IO.Path]::GetFileName($uninstaller) } else { "" }
      $displayInstallRoot = Resolve-NormalizedPath "$($values.InstallLocation)"
      $ownedUninstaller = (Test-OwnedPath $uninstaller) -and
        $uninstallerName -match '^Uninstall.*Egoist\s*Shield.*\.exe$'
      $ownedInstallLocation = $displayInstallRoot -and
        $displayInstallRoot.Equals($installRoot, [StringComparison]::OrdinalIgnoreCase)
      if (-not $ownedUninstaller -and -not $ownedInstallLocation) {
        Write-Warning "Skipped unverified Egoist Shield uninstall registration: $($key.PSPath)"
        continue
      }

      $leaf = $key.PSChildName
      $result.Add([pscustomobject]@{
        ProviderPath = $key.PSPath
        NativePath = "$uninstallBaseNative\$leaf"
      })

      $installProvider = "$($hive.Provider)\$($hive.InstallRelative)\$leaf"
      $installNative = "$($hive.Native)\$($hive.InstallRelative)\$leaf"
      $installValues = Get-ItemProperty -LiteralPath $installProvider -ErrorAction SilentlyContinue
      $registeredRoot = if ($installValues) { Resolve-NormalizedPath "$($installValues.InstallLocation)" } else { $null }
      if ($registeredRoot -and $registeredRoot.Equals($installRoot, [StringComparison]::OrdinalIgnoreCase)) {
        $result.Add([pscustomobject]@{
          ProviderPath = $installProvider
          NativePath = $installNative
        })
      }
    }
  }
  return @($result.ToArray() | Sort-Object NativePath -Unique)
}

function Backup-OwnedInstallRegistration {
  if (Test-Path -LiteralPath $registrationBackupManifestPath -PathType Leaf) {
    $activeQuarantine = $null
    try { $activeQuarantine = Get-ValidatedUpgradeQuarantine } catch { }
    if (-not $activeQuarantine) {
      [void](Reconcile-OrphanedInstallRegistrationBackup)
    }
    if (Test-Path -LiteralPath $registrationBackupManifestPath -PathType Leaf) {
      throw "An install-registration backup already exists for an active upgrade."
    }
  }
  $keys = @(Get-OwnedInstallRegistrationKeys)
  if ($keys.Count -eq 0) { return }

  New-Item -ItemType Directory -Path $registrationBackupDirectory -Force -ErrorAction Stop | Out-Null
  $records = New-Object System.Collections.Generic.List[object]
  try {
    for ($index = 0; $index -lt $keys.Count; $index++) {
      $fileName = "key-$index.reg"
      $backupPath = Join-Path $registrationBackupDirectory $fileName
      & reg.exe export $keys[$index].NativePath $backupPath /y | Out-Null
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
        throw "Failed to export owned registration $($keys[$index].NativePath)."
      }
      $records.Add([pscustomobject]@{
        providerPath = $keys[$index].ProviderPath
        nativePath = $keys[$index].NativePath
        fileName = $fileName
      })
    }
    $temporaryManifest = "$registrationBackupManifestPath.tmp"
    @($records.ToArray()) | ConvertTo-Json -Depth 4 |
      Set-Content -LiteralPath $temporaryManifest -Encoding UTF8 -Force -ErrorAction Stop
    Move-Item -LiteralPath $temporaryManifest -Destination $registrationBackupManifestPath -Force -ErrorAction Stop
  } catch {
    Remove-Item -LiteralPath $registrationBackupDirectory -Recurse -Force -ErrorAction SilentlyContinue
    throw
  }
}

function Read-OwnedInstallRegistrationBackup {
  if (-not (Test-Path -LiteralPath $registrationBackupManifestPath -PathType Leaf)) { return @() }
  $records = Get-Content -LiteralPath $registrationBackupManifestPath -Raw -ErrorAction Stop | ConvertFrom-Json
  foreach ($record in $records) {
    if (-not $record.providerPath -or -not $record.nativePath -or -not $record.fileName) {
      throw "Invalid install-registration backup manifest."
    }
    if ($record.fileName -notmatch '^key-\d+\.reg$') {
      throw "Invalid install-registration backup filename."
    }
    Write-Output $record
  }
}

function Remove-OwnedInstallRegistration {
  foreach ($record in @(Read-OwnedInstallRegistrationBackup)) {
    Remove-Item -LiteralPath $record.providerPath -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Restore-OwnedInstallRegistration {
  foreach ($record in @(Read-OwnedInstallRegistrationBackup)) {
    $backupPath = Join-Path $registrationBackupDirectory $record.fileName
    if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
      throw "Install-registration backup is incomplete: $backupPath"
    }
    Remove-Item -LiteralPath $record.providerPath -Recurse -Force -ErrorAction SilentlyContinue
    & reg.exe import $backupPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to restore owned registration $($record.nativePath)."
    }
  }
}

function Remove-OwnedInstallRegistrationBackup {
  if (Test-Path -LiteralPath $registrationBackupDirectory) {
    Remove-Item -LiteralPath $registrationBackupDirectory -Recurse -Force -ErrorAction Stop
  }
}

function Retire-OrphanedInstallRegistrationBackup {
  if (-not (Test-Path -LiteralPath $registrationBackupDirectory)) { return $null }
  try {
    Remove-OwnedInstallRegistrationBackup
    return $null
  } catch {
    # PowerShell 5.1 can keep returning UnauthorizedAccess for a protected
    # legacy child even after takeown/icacls have successfully repaired its
    # DACL. Renaming the owned directory is an atomic metadata operation on the
    # already-repaired parent and frees the reserved live name without reading
    # or trusting the stale payload.
    $retiredPath = Join-Path $upgradeStateDirectory (
      "registration-backup.discarded-" + [Guid]::NewGuid().ToString("N"))
    [System.IO.Directory]::Move($registrationBackupDirectory, $retiredPath)
    Write-Warning "Orphaned install-registration backup was retired for deferred cleanup: $retiredPath"
    return $retiredPath
  }
}

function Reconcile-OrphanedInstallRegistrationBackup {
  # A backup without a quarantine marker cannot participate in an active
  # rollback. Older/interrupted cleanup versions could leave it under the live
  # name, making every later PreInstall fail with "backup already exists".
  if (-not (Test-Path -LiteralPath $registrationBackupDirectory)) { return "none" }
  if (-not (Test-Path -LiteralPath $registrationBackupManifestPath -PathType Leaf)) {
    Remove-OwnedInstallRegistrationBackup
    Write-Journal "orphaned-registration-backup-discarded" @{ reason = "manifest-missing" }
    return "discarded-incomplete"
  }

  $outcome = "discarded"
  try {
    $currentKeys = @(Get-OwnedInstallRegistrationKeys)
    # When a current owned registration exists, the markerless backup is stale
    # by definition. Do not parse a previous installer's protected payload.
    if ($currentKeys.Count -eq 0) {
      $records = @(Read-OwnedInstallRegistrationBackup)
      if ($records.Count -gt 0 -and (Test-InstallRootIdentified $installRoot)) {
        Restore-OwnedInstallRegistration
        $restoredKeys = @(Get-OwnedInstallRegistrationKeys)
        if ($restoredKeys.Count -eq 0) {
          throw "Install registration remained absent after orphaned-backup recovery."
        }
        $outcome = "restored"
      }
    }
  } catch {
    # Without a marker there is no verified quarantine to restore. An invalid
    # orphan must not keep a reserved live name forever; retain the diagnostic
    # in the journal and let the new transactional backup start cleanly.
    Write-Warning "Orphaned install-registration backup is unusable and will be discarded: $_"
    Write-Journal "orphaned-registration-backup-invalid" @{ error = "$($_.Exception.Message)" }
    $outcome = "discarded-invalid"
  }
  $retiredPath = Retire-OrphanedInstallRegistrationBackup
  Write-Journal "orphaned-registration-backup-reconciled" @{
    outcome = $outcome
    retiredPath = if ($retiredPath) { $retiredPath } else { "" }
  }
  return $outcome
}

function New-UpgradeQuarantine {
  $pending = Get-ValidatedUpgradeQuarantine
  if ($pending) {
    if ((Test-Path -LiteralPath $pending) -and -not (Test-Path -LiteralPath $installRoot)) { return }
    throw "Pending upgrade quarantine conflicts with the current install root: $pending"
  }
  if (-not (Test-Path -LiteralPath $installRoot)) { return }

  # NSIS creates $INSTDIR before customInit on a clean install. An empty,
  # non-reparse directory is not a previous product and must not be
  # quarantined. NSIS keeps it as its working directory, so it cannot be
  # removed here. Reset its ACL to inherited Program Files permissions instead.
  # Any non-empty or reparse root remains fail-closed.
  if (Test-EmptyPlainDirectory $installRoot) {
    & icacls.exe $installRoot /inheritancelevel:e /q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to enable inherited ACLs on the clean install root." }
    & icacls.exe $installRoot /reset /q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to reset the clean install root ACL." }
    return
  }

  # Карантин только положительно опознанной установки Egoist Shield. Перенос
  # каталога в пределах тома атомарен: внешние watchdog'и сразу теряют старый
  # путь к exe, а неудачная установка сохраняет полную копию для возврата.
  if (-not (Test-InstallRootIdentified $installRoot)) {
    throw "Refusing to quarantine an unverified or truncated install root."
  }
  $parent = Split-Path -Parent $installRoot
  $leaf = Split-Path -Leaf $installRoot
  if (-not $parent -or -not $leaf -or $installRoot -eq [System.IO.Path]::GetPathRoot($installRoot)) {
    throw "Refusing to quarantine a broad install root: $installRoot"
  }

  $quarantine = Join-Path $parent ("{0}.upgrade-old-{1}" -f $leaf, [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $upgradeStateDirectory -Force -ErrorAction Stop | Out-Null
  Set-Content -LiteralPath $upgradeMarkerPath -Value $quarantine -Encoding UTF8 -Force -ErrorAction Stop
  try {
    Move-InstallRootToQuarantineWithRetry -Destination $quarantine
  } catch {
    Remove-Item -LiteralPath $upgradeMarkerPath -Force -ErrorAction SilentlyContinue
    throw
  }
  Write-Journal "quarantined" @{ quarantine = "$quarantine" }
}

function Restore-InstallerExternalBaseline {
  Restore-OwnedRuntimeQuarantine
  Restore-PersistedNetworkActivation
  Restore-SystemNetworkBaseline
  Restore-OwnedServiceRegistrations
}

function Complete-InstallerExternalBaseline {
  Complete-OwnedRuntimeQuarantine
  Complete-PersistedNetworkActivation
  Complete-SystemNetworkBaseline
  Complete-OwnedServiceRegistrations
}

function Reconcile-OrphanedExternalBaseline {
  $externalArtifacts = @(
    $networkBaselinePath,
    $userStateBackupManifestPath,
    $serviceBackupManifestPath,
    $runtimeQuarantineManifestPath
  ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
  if ($externalArtifacts.Count -eq 0) { return "none" }

  if (-not (Test-InstallRootHealthy $installRoot)) {
    Restore-InstallerExternalBaseline
    return "restored"
  }

  # With no quarantine marker these files can only be either a pre-quarantine
  # snapshot from an interrupted preparation or stale residue from an older,
  # already committed install. Compare durable file timestamps instead of
  # invoking the previous version's Core binary, which is outside the new
  # installer's compatibility boundary.
  $payloadTimestamp = @($installIdentityRequiredFiles | ForEach-Object {
    $path = Join-Path $installRoot $_
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      (Get-Item -LiteralPath $path -ErrorAction Stop).LastWriteTimeUtc
    }
  } | Sort-Object -Descending | Select-Object -First 1)
  $externalTimestamp = @($externalArtifacts | ForEach-Object {
    (Get-Item -LiteralPath $_ -ErrorAction Stop).LastWriteTimeUtc
  } | Sort-Object -Descending | Select-Object -First 1)

  if ($payloadTimestamp.Count -gt 0 -and
      $externalTimestamp.Count -gt 0 -and
      $externalTimestamp[0] -le $payloadTimestamp[0]) {
    Complete-InstallerExternalBaseline
    Write-Journal "orphaned-external-baseline-discarded" @{
      payloadTimestamp = $payloadTimestamp[0].ToString("o")
      externalTimestamp = $externalTimestamp[0].ToString("o")
    }
    return "discarded-stale"
  }

  Restore-InstallerExternalBaseline
  return "restored"
}

<#
.SYNOPSIS
  Возвращает прошлую установку из карантина (rollback неудачного обновления).
.DESCRIPTION
  CRIT-02: раньше карантин только УДАЛЯЛСЯ в PostInstall, а функции возврата
  не существовало вовсе — после сбоя новой установки рабочая версия исчезала
  безвозвратно. Теперь: незавершённая новая установка удаляется, карантин
  переносится назад, маркер снимается.

  Возвращает одно из значений:
    restored           — прошлая версия снова на своём месте;
    deferred           — частичная установка физически заблокирована другим
                         процессом; КАРАНТИН И МАРКЕР СОХРАНЕНЫ, поэтому
                         следующий запуск фазы Recover (например, после
                         перезагрузки) доведёт откат до конца. Ничего не
                         потеряно — это отложенный, а не проваленный откат;
    nothing-to-restore — активной транзакции нет.
#>
function Restore-UpgradeQuarantine {
  param([switch]$SkipRuntimeCleanup)
  $pending = $null
  try { $pending = Get-ValidatedUpgradeQuarantine } catch { Write-Warning $_ }
  if (-not $pending) {
    Restore-InstallerExternalBaseline
    return "nothing-to-restore"
  }
  if (-not (Test-Path -LiteralPath $pending)) {
    # Карантина уже нет: маркер устарел, снимаем его, чтобы он не блокировал
    # следующую установку.
    Remove-Item -LiteralPath $upgradeMarkerPath -Force -ErrorAction SilentlyContinue
    Remove-OwnedInstallRegistrationBackup
    Restore-InstallerExternalBaseline
    return "nothing-to-restore"
  }

  Write-Journal "rollback-started" @{ quarantine = "$pending" }
  # Останавливаем только НОВЫЕ owned-компоненты, чтобы освободить partial root.
  $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd("\")
  $isolatedFixture = $env:EGOISTSHIELD_INSTALLER_TEST_DISABLE_RUNTIME_CLEANUP -eq "1" -and
    $env:EGOISTSHIELD_INSTALLER_STATE_DIR -and
    (Resolve-NormalizedPath $env:EGOISTSHIELD_INSTALLER_STATE_DIR).StartsWith(
      "$temporaryRoot\",
      [StringComparison]::OrdinalIgnoreCase) -and
    $installRoot.StartsWith("$temporaryRoot\", [StringComparison]::OrdinalIgnoreCase)
  if (-not $SkipRuntimeCleanup -and -not $isolatedFixture) {
    Stop-AllOwnedRuntimes
    Start-Sleep -Milliseconds 600
  }

  if (Test-Path -LiteralPath $installRoot) {
    try {
      Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction Stop
    } catch {
      # Частичная установка держится файлами: переносим её в сторону, чтобы
      # карантин всё равно вернулся на рабочий путь.
      $parent = Split-Path -Parent $installRoot
      $leaf = Split-Path -Leaf $installRoot
      $failed = Join-Path $parent ("{0}.failed-{1}" -f $leaf, [Guid]::NewGuid().ToString("N"))
      try {
        Move-Item -LiteralPath $installRoot -Destination $failed -ErrorAction Stop
        Write-Warning "Partial install could not be deleted; moved to $failed"
      } catch {
        # Отложенный откат: карантин и маркер СОХРАНЯЮТСЯ, поэтому прошлая
        # версия не потеряна. Следующий Recover (после перезагрузки или после
        # завершения держателя файла) доведёт возврат до конца.
        Write-Warning "Rollback deferred: partial install root is locked ($installRoot). The previous version is kept in quarantine."
        Write-Journal "rollback-deferred" @{ reason = "partial-root-locked"; quarantine = "$pending" }
        return "deferred"
      }
    }
  }

  try {
    Restore-OwnedInstallRegistration
  } catch {
    Write-Warning "Rollback deferred: install registration could not be restored: $_"
    Write-Journal "rollback-deferred" @{ error = "$_"; quarantine = "$pending"; reason = "registration-restore" }
    return "deferred"
  }

  try {
    Move-Item -LiteralPath $pending -Destination $installRoot -ErrorAction Stop
  } catch {
    Write-Warning "Rollback deferred: previous install could not be moved back yet: $_"
    Write-Journal "rollback-deferred" @{ error = "$_"; quarantine = "$pending" }
    return "deferred"
  }

  $restoredCoreBinary = Join-Path $installRoot "resources\core-service\win-x64\EgoistShield.Service.exe"
  if (-not (Test-Path -LiteralPath $restoredCoreBinary -PathType Leaf)) {
    # The failed candidate may have created Core while the restored version
    # predates it. Do not leave a service pointing at a binary that rollback
    # has removed.
    try {
      Stop-OwnedService "EgoistShieldCore" $true
      Write-Journal "rollback-removed-new-core-service" @{}
    } catch {
      Write-Warning "Rollback restored files but could not remove the candidate Core service: $_"
    }
  }

  try {
    Restore-InstallerExternalBaseline
  } catch {
    Write-Warning "Rollback restored application files but the external network/service baseline is still pending: $_"
    Write-Journal "rollback-deferred" @{ error = "$_"; quarantine = "$pending"; reason = "external-baseline-restore" }
    return "deferred"
  }

  Remove-Item -LiteralPath $upgradeMarkerPath -Force -ErrorAction SilentlyContinue
  Remove-OwnedInstallRegistrationBackup
  # Rollback may legitimately restore 3.0/3.2, which predates Core/runtime
  # manifests. Require the historical product identity here; the strict full
  # payload gate applies only to the newly installed candidate in PostInstall.
  $healthy = Test-InstallRootIdentified $installRoot
  Write-Journal "rollback-completed" @{ restoredHealthy = $healthy }
  if (-not $healthy) {
    Write-Warning "Previous version was restored but does not pass the health check."
  }
  return "restored"
}

function Complete-UpgradeQuarantine {
  $pending = Get-ValidatedUpgradeQuarantine
  if (-not $pending) {
    # A committed marker is intentionally invisible to rollback selection, but
    # it still records an old sibling whose deletion was deferred.  Retry that
    # exact validated path here so Recover can eventually reclaim it without
    # ever treating it as a candidate for downgrade.
    $pending = Get-CommittedUpgradeQuarantine
  }
  Complete-InstallerExternalBaseline
  $quarantineCleanupDeferred = $false
  if ($pending -and (Test-Path -LiteralPath $pending)) {
    try {
      Remove-Item -LiteralPath $pending -Recurse -Force -ErrorAction Stop
    } catch {
      # Candidate health is already proven. Mark the quarantine as committed
      # before leaving it for a later cleanup retry.  A plain pending marker
      # here is dangerous: the next PreInstall can mistake the healthy current
      # candidate for a failed upgrade and roll it back to this old directory.
      $quarantineCleanupDeferred = $true
      Write-Warning "The verified candidate is committed; old install quarantine cleanup is deferred: $_"
      $committedPrefix = if ($script:committedUpgradeMarkerPrefix) { [string]$script:committedUpgradeMarkerPrefix } else { "COMMITTED|" }
      $temporaryMarker = "$upgradeMarkerPath.committed.tmp"
      Write-Utf8NoBomFile -Path $temporaryMarker -Content ($committedPrefix + $pending)
      Move-Item -LiteralPath $temporaryMarker -Destination $upgradeMarkerPath -Force -ErrorAction Stop
      Write-Journal "old-install-quarantine-deferred" @{
        quarantine = "$pending"
        error = "$($_.Exception.Message)"
      }
    }
  }
  if (-not $quarantineCleanupDeferred) {
    Remove-Item -LiteralPath $upgradeMarkerPath -Force -ErrorAction SilentlyContinue
  }
  $retiredRegistration = Retire-OrphanedInstallRegistrationBackup
  Write-Journal "committed" @{
    quarantineCleanupDeferred = $quarantineCleanupDeferred
    retiredRegistration = if ($retiredRegistration) { $retiredRegistration } else { "" }
  }
}

function Wait-OwnedFilesReleased {
  param([int]$TimeoutSeconds = 20)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $alive = @()
  while ((Get-Date) -lt $deadline) {
    $alive = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { [int]$_.ProcessId -ne $PID -and (Test-OwnedPath $_.ExecutablePath) })
    if ($alive.Count -eq 0) { return $true }
    Stop-AllProcessesFromOwnedRoots
    Start-Sleep -Milliseconds 400
  }
  # Код 32 без PID/пути раньше не позволял отличить реальный старый runtime
  # от ложного совпадения в чистой VM. Печатаем только уже доказанные owned
  # процессы; чужие процессы и их командные строки в журнал не попадают.
  foreach ($process in @($alive | Sort-Object ProcessId -Unique)) {
    $safeName = [string]$process.Name
    $safePath = [string]$process.ExecutablePath
    Write-Output ("BUSY_OWNED_PROCESS:name={0};pid={1};path={2}" -f $safeName, [int]$process.ProcessId, $safePath)
  }
  return $false
}

function Initialize-RestartManagerApi {
  if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) { return $false }
  if ("EgoistShieldRestartManager" -as [type]) { return $true }
  try {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

public static class EgoistShieldRestartManager
{
    private const int ERROR_MORE_DATA = 234;
    private const int CCH_RM_SESSION_KEY = 32;
    private const int CCH_RM_MAX_APP_NAME = 255;
    private const int CCH_RM_MAX_SVC_NAME = 63;

    [StructLayout(LayoutKind.Sequential)]
    private struct RM_UNIQUE_PROCESS
    {
        public int dwProcessId;
        public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
    }

    private enum RM_APP_TYPE
    {
        RmUnknownApp = 0,
        RmMainWindow = 1,
        RmOtherWindow = 2,
        RmService = 3,
        RmExplorer = 4,
        RmConsole = 5,
        RmCritical = 1000
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct RM_PROCESS_INFO
    {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)]
        public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)]
        public string strServiceShortName;
        public RM_APP_TYPE ApplicationType;
        public uint AppStatus;
        public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bRestartable;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmStartSession(out uint sessionHandle, int sessionFlags, StringBuilder sessionKey);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmRegisterResources(uint sessionHandle, uint fileCount, string[] fileNames,
        uint applicationCount, IntPtr applications, uint serviceCount, string[] serviceNames);
    [DllImport("rstrtmgr.dll")]
    private static extern int RmGetList(uint sessionHandle, out uint needed, ref uint count,
        [In, Out] RM_PROCESS_INFO[] affectedApps, ref uint rebootReasons);
    [DllImport("rstrtmgr.dll")]
    private static extern int RmEndSession(uint sessionHandle);

    public static int[] GetLockingProcessIds(string[] paths)
    {
        if (paths == null || paths.Length == 0) return Array.Empty<int>();
        uint handle;
        var key = new StringBuilder(CCH_RM_SESSION_KEY + 1);
        int result = RmStartSession(out handle, 0, key);
        if (result != 0) throw new Win32Exception(result, "RmStartSession failed");
        try
        {
            result = RmRegisterResources(handle, (uint)paths.Length, paths, 0, IntPtr.Zero, 0, null);
            if (result != 0) throw new Win32Exception(result, "RmRegisterResources failed");
            uint needed = 0, count = 0, reasons = 0;
            result = RmGetList(handle, out needed, ref count, null, ref reasons);
            if (result == 0) return Array.Empty<int>();
            if (result != ERROR_MORE_DATA) throw new Win32Exception(result, "RmGetList sizing failed");
            var owners = new RM_PROCESS_INFO[needed];
            count = needed;
            result = RmGetList(handle, out needed, ref count, owners, ref reasons);
            if (result != 0) throw new Win32Exception(result, "RmGetList failed");
            var ids = new HashSet<int>();
            for (int index = 0; index < count; index++) ids.Add(owners[index].Process.dwProcessId);
            var output = new int[ids.Count];
            ids.CopyTo(output);
            return output;
        }
        finally
        {
            RmEndSession(handle);
        }
    }
}
'@ -ErrorAction Stop
    return $true
  } catch {
    Write-Warning "Restart Manager API unavailable: $_"
    return $false
  }
}

function Get-InstallRootLockOwners {
  if (-not (Test-Path -LiteralPath $installRoot -PathType Container)) { return @() }
  if (-not (Initialize-RestartManagerApi)) { return @() }
  try {
    $files = @(Get-ChildItem -LiteralPath $installRoot -Recurse -File -Force -ErrorAction SilentlyContinue |
      Select-Object -First 1024 -ExpandProperty FullName)
    if ($files.Count -eq 0) { return @() }
    $pids = @([EgoistShieldRestartManager]::GetLockingProcessIds([string[]]$files))
    $owners = @()
    foreach ($id in $pids) {
      if ([int]$id -eq $PID) { continue }
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$id)" -ErrorAction SilentlyContinue
      if (-not $process) { continue }
      $owners += [pscustomobject]@{
        Name = [string]$process.Name
        ProcessId = [int]$process.ProcessId
        ExecutablePath = [string]$process.ExecutablePath
        Owned = [bool](Test-OwnedPath $process.ExecutablePath)
      }
    }
    return @($owners | Sort-Object ProcessId -Unique)
  } catch {
    Write-Warning "Restart Manager lock query failed: $_"
    return @()
  }
}

function Move-InstallRootToQuarantineWithRetry {
  param([string]$Destination, [int]$MaxAttempts = 12)
  $lastError = $null
  $lastOwners = @()
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      [System.IO.Directory]::Move($installRoot, $Destination)
      if ($attempt -gt 1) {
        Write-Journal "quarantine-retry-succeeded" @{ attempt = $attempt }
      }
      return
    } catch {
      $lastError = $_
      $lastOwners = @(Get-InstallRootLockOwners)
      foreach ($owner in $lastOwners) {
        $safePath = if ($owner.ExecutablePath) { $owner.ExecutablePath } else { "unavailable" }
        if ($owner.Owned) {
          Stop-Process -Id $owner.ProcessId -Force -ErrorAction SilentlyContinue
          Write-Output ("BUSY_OWNED_HANDLE:name={0};pid={1};path={2};attempt={3}" -f $owner.Name, $owner.ProcessId, $safePath, $attempt)
        } else {
          Write-Output ("BUSY_FOREIGN_HANDLE:name={0};pid={1};path={2};attempt={3}" -f $owner.Name, $owner.ProcessId, $safePath, $attempt)
        }
      }
      if ($attempt -lt $MaxAttempts) {
        Start-Sleep -Milliseconds ([Math]::Min(250 + ($attempt * 125), 1200))
      }
    }
  }

  $ownerSummary = if ($lastOwners.Count -gt 0) {
    ($lastOwners | ForEach-Object { "{0} PID {1} ({2})" -f $_.Name, $_.ProcessId, $(if ($_.Owned) { "owned" } else { "foreign" }) }) -join "; "
  } else {
    "Restart Manager did not report a surviving owner"
  }
  throw "INSTALL_ROOT_LOCKED: install root remained locked after $MaxAttempts attempts. Owners: $ownerSummary. Last error: $lastError"
}

# ============================================================================
# SelfTest: проверяет чистую логику владения без единой системной мутации.
# Вызывается из scripts/check-installer-ownership.mjs, поэтому регрессия в
# правилах владения падает на обычном прогоне тестов, а не на чужой машине.
# ============================================================================
function Invoke-SelfTest {
  $failures = New-Object System.Collections.Generic.List[string]
  function Should {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { $script:selfTestFailures.Add($Message) }
  }
  $script:selfTestFailures = $failures

  $root = $ownedRoots[0]

  # 1. Пути внутри install root принадлежат нам.
  Should (Test-OwnedPath (Join-Path $root "EgoistShield.exe")) "own exe must be owned"
  Should (Test-OwnedPath (Join-Path $root "resources\zapret\winws.exe")) "own runtime must be owned"

  # 2. Чужие пути с теми же именами — нет.
  Should (-not (Test-OwnedPath "C:\Program Files\GoodbyeDPI\winws.exe")) "third-party winws must not be owned"
  Should (-not (Test-OwnedPath "C:\Program Files\dnscrypt-proxy\dnscrypt-proxy.exe")) "third-party dnscrypt must not be owned"
  Should (-not (Test-OwnedPath "C:\Program Files\Xray\xray.exe")) "third-party xray must not be owned"
  Should (-not (Test-OwnedPath "C:\Windows\System32\drivers\WinDivert64.sys")) "system WinDivert must not be owned"

  # 3. NT-формы путей нормализуются, иначе владение не доказывается и код
  #    ушёл бы в небезопасную ветку.
  Should (Test-OwnedPath ("\??\" + (Join-Path $root "resources\zapret\WinDivert64.sys"))) "\??\ prefix must normalize"
  Should (-not (Test-OwnedPath "\??\C:\Other\WinDivert64.sys")) "\??\ third-party must stay foreign"

  # 4. Reparse-escape не должен выводить за owned root.
  Should (-not (Test-OwnedPath (Join-Path $root "..\Other\winws.exe"))) "parent escape must not be owned"

  # 5. Разбор ImagePath с кавычками и аргументами.
  $quoted = '"' + (Join-Path $root "svc.exe") + '" --run'
  Should ((Get-ExecutableFromCommandLine $quoted) -eq (Join-Path $root "svc.exe")) "quoted ImagePath must parse"
  Should (Test-OwnedPath (Get-ExecutableFromCommandLine $quoted)) "quoted owned ImagePath must be owned"
  Should (-not (Test-OwnedPath (Get-ExecutableFromCommandLine '"C:\Other\svc.exe" --run'))) "quoted foreign ImagePath must be foreign"
  $missingUnquoted = (Join-Path $root "resources\core-service\win-x64\EgoistShield.Service.exe") + " --service"
  Should ((Get-ExecutableFromCommandLine $missingUnquoted) -eq (Join-Path $root "resources\core-service\win-x64\EgoistShield.Service.exe")) "unquoted missing owned ImagePath with spaces must not truncate to C:\Program"

  # 6. Эксклюзивное пространство имён служб.
  Should (Test-ExclusiveOwnedServiceName "EgoistShieldZapret") "EgoistShield* must be exclusive"
  Should (-not (Test-ExclusiveOwnedServiceName "dnscrypt-proxy")) "dnscrypt-proxy must not be exclusive"
  Should (-not (Test-ExclusiveOwnedServiceName "WinDivert")) "WinDivert must not be exclusive"

  # 7. Валидация пути карантина: только сосед install root с нашим префиксом.
  $parent = Split-Path -Parent $root
  $leaf = Split-Path -Leaf $root
  Should (Test-ValidQuarantinePath (Join-Path $parent ("$leaf.upgrade-old-abc")) $root) "valid quarantine must pass"
  Should (-not (Test-ValidQuarantinePath (Join-Path $parent "SomethingElse") $root)) "foreign quarantine must fail"
  Should (-not (Test-ValidQuarantinePath "C:\Windows" $root)) "system dir must never be a quarantine"

  # 8. Health-check отвергает несуществующий и пустой каталог.
  $tempRoot = [System.IO.Path]::GetTempPath()
  Should (-not (Test-InstallRootHealthy (Join-Path $tempRoot ([Guid]::NewGuid().ToString("N"))))) "missing root must be unhealthy"
  $emptyRoot = Join-Path $tempRoot ("egoist-empty-root-" + [Guid]::NewGuid().ToString("N"))
  try {
    New-Item -ItemType Directory -Path $emptyRoot -Force | Out-Null
    Should (Test-EmptyPlainDirectory $emptyRoot) "plain empty root must be accepted for clean install"
    Set-Content -LiteralPath (Join-Path $emptyRoot "foreign.txt") -Value "foreign" -Encoding UTF8
    Should (-not (Test-EmptyPlainDirectory $emptyRoot)) "non-empty unverified root must stay fail-closed"
  } finally {
    try { [System.IO.Directory]::Delete($emptyRoot, $true) } catch { }
  }
  Should (Test-InstallRootUnderProgramFiles $installRoot) "configured install root must be accepted"
  Should (Test-InstallRootUnderProgramFiles "D:\EgoistShield") "non-C drive directory must be accepted"
  Should (Test-InstallRootUnderProgramFiles "E:\Games\EgoistShield") "nested non-C drive directory must be accepted"
  Should (-not (Test-InstallRootUnderProgramFiles "D:\")) "drive root must be rejected"
  Should (-not (Test-InstallRootUnderProgramFiles (Join-Path $tempRoot "EgoistShield"))) "temporary install root must be rejected"
  Should (-not (Test-InstallRootUnderProgramFiles "C:\Windows\System32\EgoistShield")) "system directory must be rejected"

  # 9. Owned roots действительно вычислены (иначе очистка молча ничего не делает).
  Should ($ownedRoots.Count -ge 2) "owned roots must include install root and at least one data root"
  foreach ($ownedRoot in $ownedRoots) {
    Should ([System.IO.Path]::IsPathRooted($ownedRoot)) "owned root must be absolute: $ownedRoot"
    Should ($ownedRoot -ne [System.IO.Path]::GetPathRoot($ownedRoot)) "owned root must never be a drive root: $ownedRoot"
  }

  # 10. Список служб одинаково разбирается из массива и comma-separated
  # аргумента внешнего powershell.exe.
  $normalizedServices = @(Normalize-ServiceNames @("EgoistShieldTelegramProxy,EgoistShieldZapret", " EgoistShieldSystemDoH "))
  Should ($normalizedServices.Count -eq 3) "comma-separated service restore list must split into three names"
  Should ($normalizedServices[0] -eq "EgoistShieldTelegramProxy") "first restored service name must be normalized"
  Should ($normalizedServices[2] -eq "EgoistShieldSystemDoH") "last restored service name must be trimmed"

  # SCM Start values are stable even when WMI/CIM is unavailable. The
  # Telegram persistence fallback must never confuse demand-start with Auto.
  Should ((Convert-ServiceStartValueToMode 2) -eq "Auto") "SCM Start=2 must map to Automatic"
  Should ((Convert-ServiceStartValueToMode 3) -eq "Manual") "SCM Start=3 must stay demand-start"
  Should ((Convert-ServiceStartValueToMode 4) -eq "Disabled") "SCM Start=4 must stay disabled"

  # 11. Windows PowerShell 5.1 must flatten a multi-record JSON array once.
  $jsonRecords = @(ConvertFrom-JsonCollectionCompat '[{"id":1},{"id":2},{"id":3}]')
  Should ($jsonRecords.Count -eq 3) "JSON collection compatibility parser must return three records"
  Should ([int]$jsonRecords[1].id -eq 2) "JSON collection compatibility parser must preserve record properties"

  # 12. Успешное обновление сохраняет только явно установленную Automatic
  # Telegram-службу из канонического защищённого каталога. Чистая установка,
  # demand-start и подмена ImagePath не должны превращаться в автозапуск.
  $validTelegramRecord = [pscustomobject]@{
    name = $telegramProxyServiceName
    pathName = ('"' + $telegramProxyWrapperPath + '"')
    startMode = "Auto"
    startName = "LocalSystem"
    wasRunning = $true
  }
  Should (Test-PersistedTelegramProxyServiceRecord $validTelegramRecord) "canonical automatic Telegram Proxy service intent must be preserved"
  $manualTelegramRecord = $validTelegramRecord.PSObject.Copy()
  $manualTelegramRecord.startMode = "Manual"
  Should (-not (Test-PersistedTelegramProxyServiceRecord $manualTelegramRecord)) "manual Telegram Proxy service must not be promoted to autostart"
  $foreignTelegramRecord = $validTelegramRecord.PSObject.Copy()
  $foreignTelegramRecord.pathName = '"C:\Other\egoistshield-telegram-proxy-service.exe"'
  Should (-not (Test-PersistedTelegramProxyServiceRecord $foreignTelegramRecord)) "foreign Telegram Proxy ImagePath must not be restored"

  if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Output "SELFTEST FAIL: $failure" }
    Write-Output "SELFTEST RESULT: FAILED ($($failures.Count))"
    exit 1
  }
  Write-Output "SELFTEST RESULT: PASSED"
  exit 0
}

# ============================================================================
# Диспетчер фаз.
# ============================================================================
if ($Phase -in @("PreInstall", "PostInstall", "VerifyInstall", "RollbackUpgrade", "Recover")) {
  Repair-UpgradeStateAccess
}

switch ($Phase) {
  "SelfTest" {
    Invoke-SelfTest
  }
  "PreInstall" {
    if (-not (Test-InstallRootUnderProgramFiles $installRoot)) {
      Write-Error "Install root must be a dedicated non-system directory: $installRoot"
      exit 45
    }
    # Незавершённое предыдущее обновление доводится до конца ДО нового:
    # иначе маркер карантина заблокировал бы установку, а старая версия
    # осталась бы лежать в стороне.
    $pendingBefore = $null
    $pendingPreparedForEngine = $false
    try { $pendingBefore = Get-ValidatedUpgradeQuarantine } catch { Write-Warning $_ }
    if ($pendingBefore) {
      if (Test-InstallRootHealthy $installRoot) {
        try { Complete-UpgradeQuarantine } catch { Write-Warning $_ }
      } elseif (-not (Test-Path -LiteralPath $installRoot) -or (Test-EmptyPlainDirectory $installRoot)) {
        # Фирменная оболочка уже перенесла прошлую версию до запуска NSIS.
        # customInit вызывается после того, как NSIS создаёт/открывает пустой
        # $INSTDIR. Это не partial install и не причина отката: карантин нужно
        # сохранить до PostInstall, а движку разрешить заполнить пустой root.
        $pendingPreparedForEngine = $true
        Write-Journal "prepared-upgrade-reused" @{ quarantine = "$pendingBefore" }
      } else {
        $recoveryStatus = Restore-UpgradeQuarantine
        if ($recoveryStatus -eq "deferred") {
          # Прошлая версия ещё в карантине и её нельзя вернуть. Ставить новую
          # поверх нельзя: карантин был бы перезаписан новым, и рабочая версия
          # исчезла бы. Прерываем установку с понятным кодом.
          Write-Error "A previous upgrade is still pending rollback; restart Windows and run the installer again."
          exit 43
        }
      }
    }

    if ($pendingPreparedForEngine) {
      Write-Output "PREINSTALL: upgrade already prepared by the branded installer; NSIS may populate the empty install root."
      exit 0
    }

    # Finish interrupted preparation before taking a new service/DNS snapshot.
    # Otherwise the second attempt would capture already stopped components.
    [void](Reconcile-OrphanedExternalBaseline)

    # Capture every reversible external mutation before the first stop/reset.
    # The branded wrapper passes the services which were running before its
    # FreeFiles phase; direct NSIS installs capture their live state here.
    Backup-OwnedServiceRegistrations $Services
    Save-SystemNetworkBaseline
    Backup-AndResetPersistedNetworkActivation

    Stop-AllOwnedRuntimes
    try {
      Invoke-CoreOwnedDnsCleanup -LegacyOnly
    } catch {
      # A pre-upgrade Core may not understand the current journal yet. The
      # new Core is validated below and will retry this cleanup after payload
      # publication; keep the transaction recoverable instead of aborting on
      # an old command-line surface.
      Write-Warning "Previous Core DNS cleanup deferred until the new Core is installed: $_"
      Write-Journal "owned-dns-cleanup-deferred" @{ error = "$($_.Exception.Message)" }
    }
    Unload-OwnedWinDivertDriver
    if (-not (Wait-OwnedFilesReleased 20)) {
      Write-Error "Owned runtimes did not release their files within 20 seconds."
      exit 32
    }
    # This executable belongs to the previous installed version by definition.
    # Its recovery implementation may be incompatible or fail hardening. The
    # new installer must record that failure and continue with its own
    # ownership-aware cleanup instead of making the old binary an upgrade gate.
    try {
      Invoke-CoreServiceOfflineRecovery
    } catch {
      Write-Warning "Previous EgoistShieldCore offline recovery failed and was skipped: $_"
      Write-Journal "previous-core-recovery-skipped" @{ error = "$($_.Exception.Message)" }
    }
    Start-Sleep -Milliseconds 900
    Remove-IncompatibleOwnedServices
    New-OwnedRuntimeQuarantine
    Reset-WindowsNetworkBaseline -CaptureForRollback
    Remove-OwnedFirewallRules
    Remove-OwnedShortcuts
    Remove-OrphanedOwnedServices

    # electron-builder normally invokes the previous uninstaller after customInit.
    # Our transactional quarantine moves that uninstaller first, so its two
    # registry entries must be snapshotted and hidden before the standard NSIS
    # install section runs. Rollback restores both files and registration.
    try {
      Backup-OwnedInstallRegistration
      New-UpgradeQuarantine
      $pendingNow = Get-ValidatedUpgradeQuarantine
      if ($pendingNow -and (Test-Path -LiteralPath $pendingNow)) {
        Remove-OwnedInstallRegistration
      }
    } catch {
      $quarantineError = $_
      $failedPending = $null
      try { $failedPending = Get-ValidatedUpgradeQuarantine } catch { }
      if ($failedPending -and (Test-Path -LiteralPath $failedPending)) {
        [void](Restore-UpgradeQuarantine)
      } else {
        Remove-OwnedInstallRegistrationBackup
      }
      if ($quarantineError.Exception.Message -like "INSTALL_ROOT_LOCKED:*") {
        Write-Error $quarantineError.Exception.Message
        exit 53
      }
      throw $quarantineError
    }
  }
  "PostInstall" {
    # Commit только после доказанной работоспособности новой установки.
    # Раньше карантин удалялся безусловно, поэтому сбой на этом шаге оставлял
    # систему без рабочей версии.
    if (Test-InstallRootHealthy $installRoot) {
      try {
        # New Core is now present, so native DoH cleanup no longer depends on
        # the potentially incompatible binary from the previous release.
        Invoke-CoreNativeDohCleanup
        Invoke-CoreOwnedDnsCleanup
        Remove-OptionalOwnedServices
        # Every successful install requires a new explicit connection choice.
        Write-Utf8NoBomFile -Path (Join-Path $installRoot "resources\installation.json") -Content (@{ id = [Guid]::NewGuid().ToString(); version = "3.7.0" } | ConvertTo-Json -Compress)
        Write-Journal "optional-components-left-off" @{}
        Assert-InstalledCandidateRuntime -BeforeCommit
        Discard-OwnedNetworkArtifacts
      } catch {
        Write-Warning "The new payload is healthy, but the clean network baseline could not be finalized; rolling back: $_"
        $status = Restore-UpgradeQuarantine
        Update-ShellIconCache
        Write-Output "POSTINSTALL: baseline-rollback-$status"
        if ($status -eq "restored" -or $status -eq "nothing-to-restore") { exit 41 }
        exit 42
      }
      # Deleting a now-unused quarantine may be retried by Recover. A cleanup
      # sharing violation here must not replace a verified working candidate
      # with a generic installation failure.
      try { Complete-UpgradeQuarantine } catch {
        Write-Warning "The verified installation is active; stale quarantine cleanup is deferred: $_"
        Write-Journal "commit-cleanup-deferred" @{ error = "$($_.Exception.Message)" }
      }
      try { Remove-OwnedStartupArtifacts } catch { Write-Warning $_ }
      Update-ShellIconCache
    } else {
      Write-Warning "New install failed the health check; rolling back to the previous version."
      $status = Restore-UpgradeQuarantine
      Update-ShellIconCache
      Write-Output "POSTINSTALL: rollback-$status"
      if ($status -eq "restored") { exit 41 }
      exit 42
    }
  }
  "VerifyInstall" {
    Assert-InstalledCandidateRuntime
    exit 0
  }
  "FreeFiles" {
    # Освобождение файлов БЕЗ карантина и без сетевых мутаций.
    # Вызывается фирменной оболочкой мастера до запуска движка: раньше она
    # дублировала эту логику своим inline-скриптом, который глушил процессы и
    # удалял драйверы WinDivert по одному имени. Теперь оболочка и NSIS
    # используют один и тот же ownership-aware код.
    $running = Get-RunningOwnedServiceNames
    Stop-AllOwnedRuntimes
    Unload-OwnedWinDivertDriver
    $released = Wait-OwnedFilesReleased 25
    Write-Output ("RESTORE:" + ($running -join ","))
    Write-Output ("RELEASED:" + $released)
    if (-not $released) { exit 32 }
    exit 0
  }
  "GuardFiles" {
    Invoke-OwnedFileGuard -OwnerPid $GuardPid -StopFile $GuardStopFile -MaxSeconds $GuardMaxSeconds
    exit 0
  }
  "StartServices" {
    Start-OwnedServices $Services
    Write-Output "SERVICES: restored"
    exit 0
  }
  "InstallCoreService" {
    Install-CoreService
    exit 0
  }
  "RegistrationSelfTest" {
    if (-not $env:EGOISTSHIELD_INSTALLER_TEST_REGISTRY_ROOT -or
        -not $env:EGOISTSHIELD_INSTALLER_STATE_DIR) {
      Write-Error "RegistrationSelfTest requires isolated registry and state roots."
      exit 46
    }
    Backup-OwnedInstallRegistration
    New-UpgradeQuarantine
    Remove-OwnedInstallRegistration
    $pending = Get-ValidatedUpgradeQuarantine
    if (-not $pending -or -not (Test-Path -LiteralPath $pending) -or
        (Test-Path -LiteralPath $installRoot)) {
      Write-Error "RegistrationSelfTest quarantine step failed."
      exit 47
    }
    foreach ($record in @(Read-OwnedInstallRegistrationBackup)) {
      if (Test-Path -LiteralPath $record.providerPath) {
        Write-Error "RegistrationSelfTest did not remove $($record.providerPath)."
        exit 48
      }
    }
    $status = Restore-UpgradeQuarantine -SkipRuntimeCleanup
    if ($status -ne "restored" -or -not (Test-InstallRootIdentified $installRoot)) {
      Write-Error "RegistrationSelfTest rollback failed: $status"
      exit 49
    }
    foreach ($record in @(Get-OwnedInstallRegistrationKeys)) {
      if (-not (Test-Path -LiteralPath $record.ProviderPath)) {
        Write-Error "RegistrationSelfTest did not restore $($record.ProviderPath)."
        exit 50
      }
    }
    Write-Output "REGISTRATION-SELFTEST: PASSED"
    exit 0
  }
  "QuarantineRetrySelfTest" {
    if (-not $env:EGOISTSHIELD_INSTALLER_STATE_DIR -or
        $env:EGOISTSHIELD_INSTALLER_TEST_DISABLE_RUNTIME_CLEANUP -ne "1") {
      Write-Error "QuarantineRetrySelfTest requires isolated installer state and disabled runtime cleanup."
      exit 51
    }
    New-UpgradeQuarantine
    $pending = Get-ValidatedUpgradeQuarantine
    if (-not $pending -or -not (Test-Path -LiteralPath $pending -PathType Container) -or
        (Test-Path -LiteralPath $installRoot)) {
      Write-Error "QuarantineRetrySelfTest did not move the verified install root."
      exit 52
    }
    Write-Output "QUARANTINE-RETRY-SELFTEST:PASSED"
    exit 0
  }
  "RollbackUpgrade" {
    $status = Restore-UpgradeQuarantine
    Write-Output "ROLLBACK: $status"
    if ($status -eq 'deferred') { exit 42 }
    exit 0
  }
  "Recover" {
    # Вызывается при старте установщика/приложения: доводит до конца
    # транзакцию, прерванную выключением питания или падением процесса.
    $pending = $null
    try { $pending = Get-ValidatedUpgradeQuarantine } catch { Write-Warning $_ }
    if (-not $pending) {
      try {
        $committedQuarantine = Get-CommittedUpgradeQuarantine
        if ($committedQuarantine -and (Test-Path -LiteralPath $committedQuarantine)) {
          Remove-Item -LiteralPath $committedQuarantine -Recurse -Force -ErrorAction Stop
          Remove-Item -LiteralPath $upgradeMarkerPath -Force -ErrorAction Stop
          Write-Journal "committed-quarantine-cleaned" @{ quarantine = $committedQuarantine }
        }
      } catch {
        Write-Warning "Committed upgrade quarantine cleanup remains deferred: $_"
      }
      $registrationRecovery = Reconcile-OrphanedInstallRegistrationBackup
      if ($registrationRecovery -ne "none") {
        Write-Output "RECOVER: orphaned-registration-$registrationRecovery"
      }
      $externalRecovery = Reconcile-OrphanedExternalBaseline
      if ($externalRecovery -eq "none") {
        Write-Output "RECOVER: no-pending-transaction"
      } else {
        Write-Output "RECOVER: $externalRecovery-external-baseline"
      }
      exit 0
    }
    if (Test-InstallRootHealthy $installRoot) {
      if ($env:EGOISTSHIELD_INSTALLER_TEST_DISABLE_RUNTIME_CLEANUP -eq "1") {
        Complete-UpgradeQuarantine
        Write-Output "RECOVER: committed"
        exit 0
      }
      Install-CoreService
      Invoke-CoreNativeDohCleanup
      Invoke-CoreOwnedDnsCleanup
      Remove-OptionalOwnedServices
      Write-Journal "optional-components-left-off" @{}
      Discard-OwnedNetworkArtifacts
      Write-Utf8NoBomFile -Path (Join-Path $installRoot "resources\installation.json") -Content (@{ id = [Guid]::NewGuid().ToString(); version = "3.7.0" } | ConvertTo-Json -Compress)
      Complete-UpgradeQuarantine
      Write-Output "RECOVER: committed"
      exit 0
    }
    $status = Restore-UpgradeQuarantine
    Write-Output ("RECOVER: " + $(if ($status -eq "restored") { "rolled-back" } else { $status }))
    exit 0
  }
  "Uninstall" {
    Stop-AllOwnedRuntimes
    try { Invoke-CoreServiceOfflineRecovery } catch { Write-Warning $_ }
    # Удаление committed native DoH выполняется до каталогов ProgramData:
    # Core сравнивает текущий DNS с owned-состоянием, возвращает DHCP только
    # при точном совпадении и восстанавливает заранее существовавшие DoH-записи.
    Invoke-CoreNativeDohCleanup
    Invoke-CoreOwnedDnsCleanup
    Unload-OwnedWinDivertDriver
    foreach ($service in $ownedServices) { Stop-OwnedService $service $true }
    Remove-OrphanedOwnedServices
    # Restore only settings still owned by Shield; preserve later user changes.
    Reset-WindowsNetworkBaseline
    Remove-OwnedFirewallRules
    Discard-OwnedNetworkArtifacts
    Remove-OwnedStartupArtifacts
    Remove-OwnedShortcuts
    Remove-OwnedRuntimeDirectories
  }
}

# Сторонние сетевые продукты не удаляются никогда. Процессы и службы с общим
# именем (winws.exe, dnscrypt-proxy.exe, xray.exe, sing-box.exe, WinDivert*)
# останавливаются исключительно после доказательства исполняемого пути внутри
# owned root — см. Test-OwnedPath и SelfTest выше.
