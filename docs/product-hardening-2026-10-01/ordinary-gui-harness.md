# Проверка обычного токена установленного GUI

Новый harness находится в `tests/windows-ordinary-gui.cs` и `tests/windows-ordinary-gui.ps1`. Производственные исходники, авторизатор, установщик и основная приёмка этим изменением не менялись. Локально проверены настоящие токены, процессы и Job Object Windows. Успешный запуск **установленного** приложения из повышенного hosted runner и настоящий GUI → Core запрос требуют отдельного запуска общей приёмки; они здесь не объявлены пройденными.

## Контракт общей приёмки

PowerShell 7 x64; .NET SDK 10.0.401. `SHIELD_DOTNET` указывает на SDK, уже выбранный общей CI; без него используется проектный `.tools/dotnet-10.0.401/dotnet.exe`. Сборка замораживает семь неизменённых производственных исходников проверки путей/GUI и собственный harness в новом каталоге WorkRoot, сохраняет их SHA256 и журнал компиляции.

`Start-OrdinaryGuiLease` принимает:

- `CanonicalInstalledGuiPath`: только фактический `Program Files/EgoistShield/EgoistShield.exe`.
- `IntegrityManifestPath`: source-bound `package-integrity.json` внутри фактического `GITHUB_WORKSPACE`. `source.commit` должен совпасть с `ExpectedSourceCommit` и фактическим `GITHUB_SHA`.
- `WorkRoot`: существующий обычный каталог строго внутри фактического `RUNNER_TEMP`.
- `EvidenceDirectory`: существующий обычный каталог строго внутри WorkRoot и RUNNER_TEMP. В нём появляется уникальный receipt и фиксированный запрос завершения конкретной lease.
- `LeaseSeconds`: 10–600 секунд, по умолчанию 420. Ожидание окна ограничено 90 секундами; обёртка ожидает receipt не более 105 секунд.

До сборки/запуска требуется существующий hosted guard: настоящие значения GitHub Actions, repository `egoist-ai1/egoist-lagom`, положительные run ID/attempt, Windows и повышенный runner. Проверки путей и окружения взяты из `windows-production-acceptance.ps1 -LibraryOnly` в изолированной дочерней области. Установка, SCM, DNS, Tasks и registry-write entry points библиотеки не вызываются. Параметры библиотеки не заменяют Mode/source/evidence родительской приёмки.

Пример интеграции после установки и до повторного запуска установщика:

```powershell
. (Join-Path $PSScriptRoot 'windows-ordinary-gui.ps1') -LibraryOnly
$ordinaryEvidence = Join-Path $script:Work 'ordinary-evidence'
[void][IO.Directory]::CreateDirectory($ordinaryEvidence)
$lease = Start-OrdinaryGuiLease `
  -CanonicalInstalledGuiPath (Join-Path $script:InstallRoot 'EgoistShield.exe') `
  -IntegrityManifestPath $script:ManifestPath `
  -ExpectedSourceCommit $script:SourceCommit `
  -WorkRoot $script:Work -EvidenceDirectory $ordinaryEvidence
$actualGui = $null
try {
  $actualGui = [Diagnostics.Process]::GetProcessById([int]$lease.Receipt.processId)
  if ($actualGui.StartTime.ToUniversalTime().ToString('O') -cne $lease.Receipt.startTimeUtc) {
    throw 'GUI PID/start time identity changed.'
  }
  $root = [Windows.Automation.AutomationElement]::FromHandle(
    [IntPtr][long]$lease.Receipt.mainWindowHandle)
  if ($root.Current.ProcessId -ne $lease.Receipt.processId) {
    throw 'UIA root belongs to another process.'
  }
  # Caller observes genuine shipped labels, invokes actual Telegram buttons,
  # verifies real Core/SCM result, then closes the actual WindowPattern.
  # A visible window alone does not prove Core readiness.
} finally {
  if ($actualGui) { $actualGui.Dispose() }
  $final = Stop-OrdinaryGuiLease -Lease $lease
}
# For a normal close also require $final.exitedNormally and $final.exitCode == 0.
# Always require $final.cleanup.noOrphans and $final.cleanup.activeProcesses == 0.
# Only after Stop may the parent copy ordinary-evidence to accepted artifacts.
```

Вызов возвращает `Guardian` (собственный `Diagnostics.Process`), `Receipt`, `ReceiptPath`, задачи stdout/stderr и `Build`. В launch receipt находятся точные PID, UTC-время создания, путь, HWND, **пустой** массив аргументов, доказательство реального токена, использованные native API и token method, source/resource hashes. `coreReady` имеет значение null: состояние Core подтверждает вызывающая UIA/SCM приёмка. Входного PID, токена, CLI-исключения, тестового доверия, CDP и ключей подписи нет.

Guardian удерживает read-only lease `ProtectedExecutable.OpenHost(root, "gui")`: настоящий защищённый установочный inventory, GUI, ASAR, DLL, fuse policy, ACL/владельцы, отсутствие reparse/hardlinks. Все выбранные GUI inventory entries и сам inventory дополнительно сопоставляются с source-bound payload. Поэтому установщик нельзя запускать повторно до завершения lease и закрытия удержанных файлов.

## Токен и удержание процесса

Выбирается limited linked token повышенного runner; если он недоступен/неподходящ, проверяются SAFER NORMALUSER и `CreateRestrictedToken(LUA_TOKEN | DISABLE_MAX_PRIVILEGE)` с deny-only Administrators/Power Users. Используются Windows API, а не новый зарегистрированный пользователь и не подмена ответа приложения. Любой кандидат **до запуска** и настоящий primary token приостановленного дочернего процесса должны иметь:

- TokenElevation=false; Administrators не enabled.
- Integrity=S-1-16-8192, ровно medium; UIAccess=false; TokenType=primary.
- Тот же пользователь и сеанс; отсутствие включённых перечисленных административных privileges.

Приложение запускается нативно с единственным argv[0]; GUI LaunchPolicy дополнительно читает настоящую командную строку перед ResumeThread. `CreateProcessAsUserW` предпочтителен; только при privilege-not-held пробуется `CreateProcessWithTokenW` с тем же проверенным токеном и той же атомарной JOB_LIST. Повышенного Process.Start/ShellExecute/UAC fallback нет. Исходы не поддерживаемого системой создания/токена/окна — fail, не success/skip.

Обе нативные ветви требуют STARTUPINFOEX JOB_LIST при **создании**, затем фактическое `IsProcessInJob` до первой инструкции. Job Object имеет kill-on-close и не передаёт свой handle дочерним процессам. В нормальном завершении/nonce stop/смерти настоящего родителя/истечении lease уничтожается только этот Job Object, затем читается ActiveProcesses=0. Аварийное завершение guardian закрывает job на уровне ядра. Чужие GUI и SCM-процессы не выбираются для завершения.

Окружение GUI создаётся Windows для выбранного пользователя без загрузки нового профиля, без inherited environment. Profile/AppData взяты из этого блока; SystemRoot/PATH/ComSpec и ProgramData/ProgramFiles — из системных API/known folders. Node/.NET/разработческие overrides не передаются. Только собственный managed fixture получает точный уже загруженный .NET runtime для воспроизводимого локального теста.

## Локальная проверка 2026-10-01

Реальный исходный токен машины был **не elevated**, Administrators disabled, medium, session 1. Поэтому положительная ветвь full-runner → limited linked token и CreateProcessWithTokenW здесь не выполнены: их должен подтвердить hosted runner. SAFER и restricted LUA успешно создали настоящих детей через CreateProcessAsUserW. При чтении реального токена обнаружен однобайтовый TokenHasRestrictions; scalar reader обрабатывает размеры 1 и ≥4 без чтения за границей.

Первый собственный managed child завершился из-за отсутствия .NET 10 в очищенном окружении. Для fixture добавлена привязка к реально загруженному runtime; GUI не получает эту привязку. После исправления прошли обычная очистка, отдельные SAFER/LUA запуски и принудительное завершение guardian. Фиксированный безвредный child только ожидал; приложения/службы/сеть не запускались и не изменялись.

- Компиляция: **0 ошибок, 5 существующих nullable warnings** в неизменённых TrustedPath/ClientAuthorizer.
- LibraryOnly не изменил контрольные параметры родителя Mode/LibraryOnly/EvidenceDirectory.
- Hosted guard отказал на этой физической не hosted машине **до сборки и GUI запуска**.
- Проверка собственных OrdinaryGuiHarness процессов после тестов: **0**.
- Installed ordinary GUI → Core/Telegram/SCM acceptance: **pending**, не проверена этим receipt.

Повторить безопасную локальную проверку:

```powershell
./tests/windows-ordinary-gui.ps1 -Mode SelfTest -WorkRoot <absolute-own-task-work>
```

SelfTest запрещает installed GUI/source input и может запускать только этот source-built harness с фиксированным `--proof-child`. Fixture-only наследование уже обычного токена допускается только при отсутствии alternate-token privilege и явно отмечается в receipt; в приведённой проверке оно **не понадобилось**. Mode Launch этого fallback не имеет.

## Source-bound receipt рабочей копии

Ниже записаны реальные значения последнего native self-test. Source hashes относятся к замороженным файлам, участвовавшим в этой сборке, до коммита нового harness. PID/время и SID служат идентификаторами конкретного локального опыта, а не входом авторизации. Байтовые SHA256 исходного JSON и build log:

- self-test.json: `43BA4E9099C83584B95C92308B2C8F88DC9E0247DA6D56D78B5643FA6B7D799C`
- build.txt: `D4ACCBA3EF1D580B42850FC6B23854DCAD3FD04873F2397E030A804DE968B77C`

| Frozen source | SHA256 |
|---|---|
| `src/service/EgoistShield.Service/ProtectedExecutable.cs` | `815F4CC8D0E68DAA8FF9F7C192E8ED12AA8B0DE3E539BF2D4A14291AADACE21F` |
| `src/service/EgoistShield.Service/ClientAuthorizer.cs` | `21FAAAE25C505374277B241E3BEE7B9190315870826F6456DCF688AE540F1B18` |
| `src/service/EgoistShield.Service/ClientIdentity.cs` | `7D6450032A5D0AEF10AA90B97F8587B892FE28D023FC937CAC5821C651E85186` |
| `src/service/EgoistShield.Service/ServiceOptions.cs` | `87565B25954EB8BE58CE1754D6C2FDE310DF85443C35CBD60EEC3F7CCF658694` |
| `src/service/EgoistShield.Service/ServiceConfig.cs` | `782FD934EE0CAAC6D1CC0AC4A9D46E2E03FFBBE60FBF74F1A2ACECC7D06B81F0` |
| `src/service/EgoistShield.Service/TrustedPath.cs` | `923775BABB3639DE1A08B00E8851681671CE08CF8654CED4857A7ED41AFE3609` |
| `src/service/EgoistShield.Service/GuiLaunchPolicy.cs` | `402A7B6E1203F7ED27FC05DFDE526F8951E78D367036B974488277A9F0D84543` |
| `tests/windows-ordinary-gui.cs` | `8C131C0862DBFBB967CB98E4CDB59ACF60DE52D085606F6A564AD665858E6FAF` |
| `tests/windows-ordinary-gui.ps1` | `C757634A33B8A7EB0D0C86AC816E55BF0406407DF6BF8B599E50248531E64D73` |

```json
{
  "schemaVersion": 1,
  "stage": "self-test",
  "ok": true,
  "productLaunched": false,
  "runnerToken": {
    "userSid": "S-1-5-21-3279901756-838163169-2704092079-1000",
    "elevated": false,
    "administratorsEnabled": false,
    "integrityRid": 8192,
    "integritySid": "S-1-16-8192",
    "sessionId": 1,
    "elevationType": 3,
    "restricted": false,
    "uiAccess": false,
    "tokenType": 1,
    "hasRestrictions": true,
    "enabledPrivileges": [
      "SeChangeNotifyPrivilege"
    ]
  },
  "token": {
    "userSid": "S-1-5-21-3279901756-838163169-2704092079-1000",
    "elevated": false,
    "administratorsEnabled": false,
    "integrityRid": 8192,
    "integritySid": "S-1-16-8192",
    "sessionId": 1,
    "elevationType": 3,
    "restricted": false,
    "uiAccess": false,
    "tokenType": 1,
    "hasRestrictions": true,
    "enabledPrivileges": [
      "SeChangeNotifyPrivilege"
    ]
  },
  "tokenMethod": "safer-normal-user",
  "launchApi": "CreateProcessAsUserW",
  "processId": 6756,
  "startTimeUtc": "2026-10-01T00:30:09.4716425Z",
  "attempts": [
    {
      "method": "linked",
      "accepted": false,
      "error": "The current token is not full/elevated; no limited linked-token candidate is requested.",
      "nativeError": null
    },
    {
      "method": "safer-normal-user",
      "accepted": true,
      "token": {
        "userSid": "S-1-5-21-3279901756-838163169-2704092079-1000",
        "elevated": false,
        "administratorsEnabled": false,
        "integrityRid": 8192,
        "integritySid": "S-1-16-8192",
        "sessionId": 1,
        "elevationType": 3,
        "restricted": false,
        "uiAccess": false,
        "tokenType": 1,
        "hasRestrictions": true,
        "enabledPrivileges": [
          "SeChangeNotifyPrivilege"
        ]
      }
    }
  ],
  "aliveBeforeCleanup": true,
  "noOrphans": true,
  "activeProcesses": 0,
  "candidateCases": [
    {
      "method": "safer-normal-user",
      "passed": true,
      "token": {
        "userSid": "S-1-5-21-3279901756-838163169-2704092079-1000",
        "elevated": false,
        "administratorsEnabled": false,
        "integrityRid": 8192,
        "integritySid": "S-1-16-8192",
        "sessionId": 1,
        "elevationType": 3,
        "restricted": false,
        "uiAccess": false,
        "tokenType": 1,
        "hasRestrictions": true,
        "enabledPrivileges": [
          "SeChangeNotifyPrivilege"
        ]
      },
      "launchApi": "CreateProcessAsUserW",
      "observedAlive": true,
      "noOrphans": true,
      "activeProcesses": 0
    },
    {
      "method": "restricted-lua",
      "passed": true,
      "token": {
        "userSid": "S-1-5-21-3279901756-838163169-2704092079-1000",
        "elevated": false,
        "administratorsEnabled": false,
        "integrityRid": 8192,
        "integritySid": "S-1-16-8192",
        "sessionId": 1,
        "elevationType": 3,
        "restricted": false,
        "uiAccess": false,
        "tokenType": 1,
        "hasRestrictions": true,
        "enabledPrivileges": [
          "SeChangeNotifyPrivilege"
        ]
      },
      "launchApi": "CreateProcessAsUserW",
      "observedAlive": true,
      "noOrphans": true,
      "activeProcesses": 0
    }
  ],
  "guardianCrash": {
    "passed": true,
    "guardianProcessId": 36288,
    "childProcessId": 31324,
    "childStartTimeUtc": "2026-10-01T00:30:09.9622334Z",
    "token": {
      "userSid": "S-1-5-21-3279901756-838163169-2704092079-1000",
      "elevated": false,
      "administratorsEnabled": false,
      "integrityRid": 8192,
      "integritySid": "S-1-16-8192",
      "sessionId": 1,
      "elevationType": 3,
      "restricted": false,
      "uiAccess": false,
      "tokenType": 1,
      "hasRestrictions": true,
      "enabledPrivileges": [
        "SeChangeNotifyPrivilege"
      ]
    },
    "aliveBeforeGuardianCrash": true,
    "guardianExited": true,
    "childExitedAfterGuardianCrash": true,
    "noOrphans": true,
    "containment": "atomic JOB_LIST; kill-on-close; no finally or child PID termination in the tested path"
  },
  "installedGuiAcceptance": "not executed; own fixed harmless child only"
}
```

Нативные контракты проверены по первоисточникам Microsoft:

- [Restricted tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens): ограничения токена и исключение AssignPrimaryToken для restricted версии собственного primary token.
- [CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken): LUA_TOKEN, DISABLE_MAX_PRIVILEGE, deny-only SID.
- [SaferCreateLevel](https://learn.microsoft.com/en-us/windows/win32/api/winsafer/nf-winsafer-safercreatelevel): NORMALUSER.
- [CreateProcessAsUserW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw), [CreateProcessWithTokenW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithtokenw), [Process creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags): primary token, privileges, Unicode environment и extended startup.
- [Atomic job assignment](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812): назначение JOB_LIST до выполнения первой инструкции.

Эта проверка не доказывает многомесячную стабильность, все варианты Windows/антивирусов, новый профиль другой учётной записи или успех реальной сетевой службы. Production доверие не ослаблено для тестирования.
