# Upgrade при самовосстанавливающихся службах: проверка и regression plan

Дата: 2026-09-30. Исходная версия анализа: `199236e3b227f9885c2beef64faffbe9e9a35583` / 3.8.0. Это план проверки исправления установщика и результат узкого воспроизведения старого control flow. Ниже явно отделены выполненные проверки от будущих тестов. Код продукта, реальные службы, реестр и сетевые настройки этим исследованием не изменялись.

## Подтверждённый пробел

`Stop-OwnedService` в [owned-cleanup.ps1](../../src/installer/owned-cleanup.ps1) запрашивает SCM stop, ждёт до 15 секунд, затем может принудительно завершить процесс. При `Delete=false` после kill функция не требует повторного подтверждения остановки. В ней нет временного отключения запуска и recovery. Если SCM успевает перезапустить завершённую службу, функция может закончиться без ошибки при `Running`; следующие операции сталкиваются с повторно занятыми файлами. Узкий тест доказывает это поведение функции при смоделированном SCM restart, а не частоту реальных отказов Windows.

Защищённый worker [invoke-final-silent-reinstall.ps1](../../scripts/invoke-final-silent-reinstall.ps1) также останавливает Telegram/Zapret/Gravityless перед Core, после чего останавливает SystemDoH последней. Пока Core работает, его supervisor может восстановить уже остановленный компонент. Отключать восстановление нужно до первого stop/kill, а Core следует останавливать до управляемых им служб. DNS last остаётся отдельным требованием для сокращения перерыва резолвинга.

Есть важное различие между будущими и уже запланированными SCM действиями. Microsoft указывает, что уже queued restart нельзя отменить изменением failure actions; для предотвращения такого запуска требуется явно отключить службу. Поэтому тест с `actions=none` должен одновременно проверять `Start=Disabled` и readback до остановки. [ChangeServiceConfig2W](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-changeserviceconfig2w).

`FailureActionsOnNonCrashFailures=false` не отменяет crash recovery: оно меняет дополнительные условия запуска действий, а документированное применение флага связано с перезапуском системы. Не считать `failureflag=0` самостоятельным барьером upgrade. [SERVICE_FAILURE_ACTIONS_FLAG](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_failure_actions_flag).

При очистке failure actions есть и контракт указателя: `cActions=0` удаляет действия только при ненулевом `lpsaActions`; NULL оставляет соответствующие поля без изменения. Это нужно проверить в marshaling нового native helper. [SERVICE_FAILURE_ACTIONSW](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_failure_actionsw).

## Выполненное безопасное воспроизведение

Windows PowerShell 5.1, настоящий текст `Stop-OwnedService`, извлечённый `FunctionDefinitionAst` из production source. Подменены только границы: SCM/registry lookup, process termination, ожидание и часы. Исходные top-level statements и installer phases не запускались. Реальных SCM writes и process kills: 0.

| Проверка | Результат |
| --- | --- |
| Owned service игнорирует stop; kill немедленно вызывает recovery restart | Функция вернулась без ошибки; конечное состояние fixture `Running`; recovery disable не было |
| Exclusive имя `EgoistShieldCore`, но ImagePath вне owned root | Служба оставлена нетронутой; stop/kill trace пуст |

Квитанция первого теста:

```json
{
  "sourceSha256": "EEE3C5F526D87B3C3B525E0D9CE8CE6593A3BBEAFDB36F2F9E0AB4DD576293DD",
  "functionSource": "src/installer/owned-cleanup.ps1:Stop-OwnedService",
  "simulatedRestarts": 1,
  "finalStatus": "Running",
  "returnedWithoutError": true,
  "commands": ["sc:stop:EgoistShieldCore", "force-kill:9911"],
  "realScmWrites": 0,
  "realProcessKills": 0
}
```

Первый запуск harness потребовал явного `Add-Type -AssemblyName System.ServiceProcess`, поскольку до вызова `Get-Service` соответствующий enum ещё не был загружен. Это исправление тестовой среды; к дефектам установщика оно не относится. После этого оба bounded cases завершены.

Этот repro не требует, чтобы каждый низкоуровневый stop самостоятельно менял policy. Допустим единый quiesce coordinator перед stop, если все пути stop/kill проходят его барьер. Regression после исправления должен проверять весь этот путь, иначе прямой вызов старого leaf вне нового контракта даст ложный отрицательный результат.

## Что уже умеют существующие tests

| Файл | Фактически проверяемая граница | Что добавить для нового дефекта |
| --- | --- | --- |
| [installer-owned-root-force-stop.ps1](../../tests/installer-owned-root-force-stop.ps1) | Настоящий owned-root discovery, CIM fixture, остановка только собственного legacy alias | Один discovery set для snapshot и quiesce; queued restart и readback policy |
| [installer-wrapper-migration.ps1](../../tests/installer-wrapper-migration.ps1) | Production wrapper migration, реальные isolated bytes/locks, SCM fixtures; rollback и pre-handoff guards | Проверка Disabled до замены; исходный policy snapshot не заменяется снимком уже quiesced регистрации |
| [installer-finalize-regressions.ps1](../../tests/installer-finalize-regressions.ps1) | Настоящий PostInstall phase; runtime/version gate до commit | Policy resume только после здоровья payload, прекращение guard до восстановления policy, неизменность новой ImagePath |
| [installer-recovery-reporting.ps1](../../tests/installer-recovery-reporting.ps1) | Production recovery; pending rollback не выдаётся за полное восстановление | Partial quiesce/crash recovery, сохранившийся journal и truthful status при ошибке восстановления policy |
| [installer-protected-upgrade.ps1](../../tests/installer-protected-upgrade.ps1), [installer-version-handoff.ps1](../../tests/installer-version-handoff.ps1) | Исходные safety/version predicates; isolated files, hashes, worker PID/start time | Только authenticated stage может создавать maintenance intent; invalid marker не позволяет stop/kill |
| [installer-dns-safety.ps1](../../tests/installer-dns-safety.ps1), [installer-telegram-ownership.ps1](../../tests/installer-telegram-ownership.ps1) | DNS sole dependency; Telegram listener ownership, настоящий local TCP | DNS last, foreign listener не readiness после policy resume; failure не скрывается успешной установкой |
| [installer-execution.test.mjs](../../tests/installer-execution.test.mjs) | Реальная компиляция extracted NSIS macro; harmless cleanup stub; rollback/mutex/handoff | Packaging общего helper, Windows PowerShell 5.1, независимость от cwd, отказ фазы вызывает rollback policy |
| [final-silent-reinstall.test.mjs](../../tests/final-silent-reinstall.test.mjs) | Настоящий PlanOnly валидирует готовый пакет | Счётчики host mutations должны оставаться нулевыми; packaged dependencies нового helper присутствуют |

Таблица описывает существующую реализацию тестов. Она не означает, что все эти тесты были повторно выполнены в этой подзадаче. Единственная новая выполненная динамическая проверка здесь — два bounded cases выше.

## Полезные regression cases после реализации

Приоритет первых 12 cases — блокировка публикации исправления. Остальные защищают recovery, packaging и границы владения. Во всех cases проверяется результат и trace причинно значимых действий, а не совпадение строк с новой реализацией.

| ID | Сценарий | Наблюдаемый критерий |
| --- | --- | --- |
| IQ-01 | Auto/Manual/Disabled службы; часть Running, часть Stopped | До первого policy mutation сохранён и проверен исходный snapshot. Running intent и исходные startup/recovery поля не потеряны |
| IQ-02 | Core supervisor поднимает Telegram/Zapret после stop | Все нужные службы сначала Disabled; Core остановлен раньше компонентов; supervisor не поднимает их во время замены |
| IQ-03 | Уже queued SCM restart | Fixture запускает restart по таймеру независимо от текущего FailureActions. Disabled предотвращает запуск; stop-only/actions-only вариант red |
| IQ-04 | Служба игнорирует stop и требует kill | Завершён только заново подтверждённый owned PID; после kill доказаны Stopped и отсутствие принадлежащего ей процесса в bounded drain window |
| IQ-05 | Новая PID/registration между ownership lookup и kill | Сменившаяся identity не завершена; замена payload не продолжается без нового подтверждения |
| IQ-06 | Known и arbitrary legacy aliases с собственным ImagePath | Snapshot, disable и stop используют один discovery set; alias под owned root не удаляется без rollback snapshot |
| IQ-07 | Чужие Proxy/DNS/Xray/Zapret с таким же basename | Ноль policy changes/stop/kill/delete/driver cleanup. Exclusive имя с foreign ImagePath также сохранено |
| IQ-08 | У snapshot export, native policy query, write или readback AccessDenied | Ошибка до первого stop, если подготовка не завершена; уже изменённые policy восстановлены из original snapshot; journal сохранён при partial recovery |
| IQ-09 | Worker quiesce → отдельный NSIS PreInstall | NSIS не заменяет original policy snapshot значениями Disabled/empty recovery; повторный вход идемпотентен |
| IQ-10 | Установка прошла, новый wrapper имеет другую ImagePath | Resume меняет только допустимые startup/recovery поля, не импортирует весь старый .reg поверх новой регистрации; новый verified wrapper остаётся выбран |
| IQ-11 | Success, runAfter=false, ранее Auto+Running | GUI не запускается; службы работают, policy восстановлен по выбранному контракту и readback. Нужный background intent сохранён |
| IQ-12 | Manual+Stopped или Disabled до установки | Не превращаются в Auto/Running только из-за upgrade; UI и Core не включают отключённый пользователем компонент |
| IQ-13 | Throw после каждого отдельного disable/stop/copy/start | Каждая граница восстанавливается отдельно: partial snapshot не считается полным; исходные регистрации/bytes/policies доступны до commit |
| IQ-14 | Worker exit/kill после durable snapshot, после первого disable, после Core stop | Recovery/watchdog читает один protected journal, возвращает исходный policy, не запускает unverified payload; failed recovery остаётся retryable |
| IQ-15 | Два install/recovery процесса | Mutex/lease исключает перекрёстное восстановление. Старый процесс не re-enable службы во время чужой замены |
| IQ-16 | GuardFiles продолжает kill после завершения install | Guard завершён/lease освобождена до policy resume. Возобновлённые службы не попадают в старый process-kill loop |
| IQ-17 | Reboot во время maintenance | Подтверждены путь boot recovery и владельцы journal. Система не остаётся бессрочно без ранее выбранного DNS; чужие настройки не перезаписываются |
| IQ-18 | Rollback с временно locked old root и repeated Recover | Маркер и original snapshot остаются; после release восстановление завершается, второй Recover не меняет уже восстановленное состояние |
| IQ-19 | PlanOnly / checksum mismatch / missing helper | Нулевые SCM/registry/network/process mutations; пакет не dispatch-ится с отсутствующей зависимостью |
| IQ-20 | Quiesce native marshaling: zero actions, reset period, strings, 32/64-bit buffers | Query/serialize/change/readback согласованы; zero actions с ненулевым pointer действительно означает очистку; пустые/NULL строки не теряют данные |
| IQ-21 | Свой service в shared process либо driver registration | Нельзя kill общего процесса по одному ImagePath record. Поддерживаемые типы обрабатываются явно; неизвестный тип fail-closed до file replacement |
| IQ-22 | StopPending/StartPending/MarkedForDeletion/CIM unavailable | Отсутствие и недоступность различаются; deadline ограничен; никакой false successful drain или удаления snapshots |
| IQ-23 | Старый SCM restart delay больше быстрого quiesce interval | Проверка продолжается через policy resume: re-enable не объявляется отменой старого queued action. Это native VM case, а не только mock |
| IQ-24 | Кастомная service account, dependencies, delayed auto start | Существующая account/credentials/dependencies не разрушаются временной паузой; если recreate без пароля нельзя доказанно восстановить, отказ до разрушения регистрации |

В startup/recovery snapshot нужны как минимум Start type, DelayedAutoStart, failure actions (типы/задержки/период сброса/command/reboot message), non-crash flag, wasRunning и identity, к которой policy применяется. При success нельзя считать полный `.reg` import безопасной заменой ограниченному policy restore: старый export содержит ImagePath и может отменить миграцию wrapper. Full registration rollback и policy resume имеют разные назначения.

## Как тестировать production functions

1. `Parser.ParseFile` читает настоящий production PS1; тест требует zero parse errors. Затем `FunctionDefinitionAst` извлекает только нужные функции quiesce/recovery/coordinator. Нельзя dot-source весь `owned-cleanup.ps1`: top-level phase выполняет настоящие действия.
2. Для управляющей фазы применяется существующий pattern `SwitchStatementAst` с condition `$Phase`: берётся body нужной clause. `exit N` превращается только в catchable test signal с тем же N; все остальные statements остаются production text. Успех и failure code в harness проверяются явно.
3. Native query/change/write wrappers — leaf seam. Fake SCM хранит `{identity, startMode, delayedAutoStart, recovery, state, pid, queuedRestartAt}` и независимую очередь уже назначенных restart actions. Вместо реальных P/Invoke все wrappers читают/изменяют эту таблицу; `Start=Disabled` отклоняет restart, а пустые FailureActions сами по себе очередь не очищают.
4. Trace хранит snapshot-durable, policy-change, policy-readback, core-stop, component-stop, payload-copy, runtime-gate, guard-release, policy-resume и commit. Assertions проверяют причинный порядок: ни одного stop/copy до успешного snapshot/readback; ни одного resume до прекращения guard и выполнения нужных gates.
5. Для file/journal seams используются реальные isolated файлы в `LAGOM_TEST_TEMP`, включающие пробелы, кириллицу и `[x]`, реальные SHA256 и locked file handles. OS boundary counters должны оставаться нулевыми. Разрушительные shell operations и native service calls запрещаются fail-fast stubs, а не незаметно уходят в host.
6. `Invoke-WorkerMode`, `Invoke-Recovery`, `Stop-PreservedWrappersForRecovery`, `Stop-AllOwnedRuntimes`, `PreInstall`, `FreeFiles`, `Recover` и `PostInstall` надо проверить на том же state-machine fixture. Изменение только одного leaf при другом обходном install path не закрывает дефект.
7. Native struct parsing можно отдельно проверить в allocated buffers без SCM. Это проверяет marshaling/serialization, но не эффективную policy Windows. Не подменять этой проверкой readback SCM в отдельной VM.

Первый repro выполнен по этому pattern: fixture игнорировал stop и возвращал Running после force kill; настоящая production функция дошла до конца. Для нового исправления этот fixture должен запускаться через полный coordinator с recovery уже погашенным, а попытка обойти quiesce должна блокироваться.

## NSIS и доставка helper

Если quiesce вынесен в отдельный script/module, проверить три независимых места:

- [package-windows.mjs](../../scripts/package-windows.mjs) копирует helper в `resources/installer` и добавляет его в integrity inventory.
- [setup.nsi](../../src/installer/setup.nsi) извлекает его в `$PLUGINSDIR` до вызова cleanup/reinstall; uninstaller также получает нужную dependency.
- Protected worker staging переносит helper рядом со staged script. Import использует `$PSScriptRoot`, а не текущий каталог или writable PATH.

Существующий NSIS regression pattern подходит: извлечь настоящий `RunPhase` macro, скомпилировать harmless user-level silent fixture и подложить cleanup, который импортирует helper и пишет только marker в own work. Запуск не должен устанавливать настоящую службу или исполнять engine. Проверяются Windows PowerShell 5.1, UTF-8/кириллица, 32-bit NSIS → native 64-bit PowerShell, отличающийся cwd, missing dependency и возврат кода отказа в rollback.

## Что требует отдельной Windows VM

Обязательны хотя бы Windows 10/11 с поддерживаемыми security settings и реальный installer upgrade from 3.7.8/3.7.9, плюс старые версии с обнаруженными legacy registrations. В изолированной VM создаются лишь тестовые service binaries или устанавливается предыдущая наша версия. Source/EXE hashes, сервисные регистрации и DNS baseline фиксируются до каждого опыта.

Native cases должны проверить настоящий SCM restart queue, время фактической остановки, PID/creation identity, effective Start/FailureActions readback, locked executable replacement и отсутствие recovery restart во время copy. Прерывания installer/worker/whole VM, real reboot и последующий recovery — отдельные проверки. Изменение только registry blob не доказывает применение policy SCM: Windows может держать конфигурацию в памяти.

Проверять нужно не только окно установки, но и момент возобновления original policies: давно queued action может сработать позже короткого mock drain. Для ранее Stopped/Disabled компонентов требуется доказать сохранение user intent. Для ранее активного DNS — реальные resolution/ownership readback после возврата, без счёта чужого listener за наш.

Критерий готовности этого исправления: красный до изменения/зелёный после meaningful regression, все affected installer tests, реальная компиляция packaged NSIS и native upgrade/rollback/readback на VM. Ни два выполненных здесь cases, ни весь unit suite не являются доказательством беспрерывной работы месяцами. Продолжительный soak и общий release audit остаются отдельными gates.


## Дополнительная native приёмка R29–R32 и legacy bridge

| ID | Сценарий | Критерий |
| --- | --- | --- |
| IQ-25 | SYSTEM boot task до Disabled, владельцы stage/backup/scripts, principal/SD/readback | Привилегированная реальная регистрация; Create-only collision refusal; обычный пользователь не меняет inventory/backup/argv |
| IQ-26 | Выключение VM после marker, каждого Disabled, copy и restoration; boot без GUI | Actual protected recovery под SYSTEM возвращает supported original intent, DNS готов; duration/retries соблюдены; свой task удалён после verified restoration |
| IQ-27 | Реальный зависший installer/worker удерживает Global lease после deadline | Cooperative cancel, затем только pinned verified owned handle Kill/Wait; recovery не пересекается с mutations и не выдаёт incomplete за terminal |
| IQ-28 | Transient permanent recovery error; следующий boot; stale/malformed markers | Limited retry, retained original snapshot/registration, honest pending; malformed/foreign stage не воспроизводится |
| IQ-29 | Uninstall во время worker, pending maintenance и service backup | Отказ до destructive действий, files/settings сохранены; после verified recovery uninstall работает без воскресших служб |
| IQ-30 | Privileged worker/watchdog/SYSTEM одновременно пишут журнал, sharing/write failure | SY/BA Global mutex доступен только intended identities, no lost committed events, abandoned recovery; pre-handoff failure UI виден без false terminal active recovery |
| IQ-31 | Настоящие подписанные 3.7.8/3.7.9 через старый installed helper | Реализованный bridge проверен под старым trust до stop/disable; cancel/crash/upgrade preserve prior services/DNS; новая stage/registration verified |
| IQ-32 | Обычный пользователь: elevation до stage, UAC cancel, русский branded error | Нет unprotected privileged stage; cancel сохраняет существующую систему; WinPS5.1 текст читается, ранняя ошибка не оставляет бесконечный monitor |

Новые source/fixture проверки и результаты описаны в [installer-fix.md](installer-fix.md). In-memory Windows Task XML parser не доказывает registration ACL, работу boot trigger или recovery после reboot. R31 bridge остаётся реализационным пробелом; нельзя пометить IQ-31 passed по новому guard, который лишь отклоняет старую stage.
