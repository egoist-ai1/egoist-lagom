# Исправление установки и восстановления служб

База — commit 199236e3b227f9885c2beef64faffbe9e9a35583, кандидат 3.8.0. Новая реализация находится в ветке codex/lagom-production-audit. **Установленная/опубликованная 3.7.9 и прежний Setup 3.8.0 не заменены.** Новый Core скомпилирован для self-test; полный исправленный установщик ещё не собран, не установлен и не опубликован.

## Причина блокировки обновления

Старый worker останавливал компоненты раньше Core. Supervisor мог поднять их обратно; SCM также мог выполнить уже назначенный restart. Прежняя production stop-функция в контролируемом сценарии вернулась без ошибки при Running. Это конкретный пропуск control flow; частота отказов на всех устройствах не измерялась. [Исходный анализ](installer-upgrade-analysis.md).

Изменение recovery actions само по себе не отменяет уже назначенный restart; Windows указывает explicit Disabled для предотвращения такого запуска. Исправление проверяет результат SCM config и действительную остановку. [Microsoft: ChangeServiceConfig2W](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-changeserviceconfig2w), [sc.exe config](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/sc-config).

## Реализованное поведение

1. До остановки сохраняются проверенные собственные регистрации, startup/delayed-auto и running intent, registry backup/hash, runtime и настройки. Ошибка discovery/export/readback останавливает подготовку. Чужое имя или совпадение basename не доказывают владение. Unsupported shared-process/driver/custom-account registrations отклоняются до destructive действий.
2. Привилегированная подготовка использует canonical ProgramData и Program Files. Stage, родители, snapshots и staged scripts получают защиту SYSTEM/Administrators; reparse и непроверенные владельцы/ACL отклоняются. JSON пишется через защищённый temporary FileStream, Flush(true) и atomic replace. Обычный пользователь получает elevation до защищённой подготовки.
3. **До первого Disabled регистрируется boot recovery.** SYSTEM task запускает только проверенный staged worker с `-Recover`; SHA worker/helper/module и идентичность task проверяются readback. Boot delay 30 s, execution limit 20 min, три повтора через 2 min. Это ограниченный механизм; он не обещает бесконечных скрытых попыток при испорченном snapshot.
4. Core переводится в Disabled и останавливается первым. Затем остальные собственные службы переводятся в Disabled и устойчивое Stopped. SystemDoH останавливается последней. Force kill возможен только с удерживаемым process handle и свежими path/PID/creation-time/service доказательствами; shared/foreign PID отклоняется.
5. Новый Core ждёт окончания maintenance до startup recovery/pipe/supervision; IPC mutation и component.query также блокируются. Узкий внутренний offline restore-owned-dns остаётся доступен установщику, без IPC bypass.
6. Startup/delayed-auto возвращаются по исходному policy с readback; прежний stopped/Disabled intent не включается автоматически. Recovery-only repair Core больше не записывает Start или DelayedAutoStart. Явная установка сохраняет intended defaults.
7. Worker проверяет cancel flag между значимыми шагами. После deadline watchdog даёт время на cooperative exit; при необходимости завершает только зафиксированные собственные installer/worker через held handle и bounded Wait. Recovery использует общую mutation lease; watchdog удерживает её до удаления своей task и terminal write.
8. Recovery возвращает явный результат. Ошибка сохраняет original snapshot, marker, boot registration и recovery-pending.json; complete.flag не выдаёт восстановление за завершённое. Шесть ограниченных попыток допускают transient recovery; последующий запуск может повторить unresolved состояние. Повреждённый marker не приравнивается к absent. Уже закрытая транзакция не воспроизводит старый snapshot.
9. Uninstall получает ту же lease и отказывает при активной установке, marker обслуживания или pending backup до первого destructive действия. Это предотвращает соревнование удаления с восстановлением.
10. Журнал событий сериализован отдельной защищённой mutex конкретной stage на весь read/append/flush/status. Atomic rename сам по себе не предотвращал потерю одного из двух событий. Ошибка журнала до handoff не подавляет failed UI/terminal flag и исходное исключение; acquired maintenance по-прежнему остаётся retryable. UTF-8 BOM сохраняет русские сообщения WinPS5.1.
11. Service helper и boot module обязательны в NSIS, uninstaller, staged worker и package integrity inventory. Missing/damaged/incomplete import вызывает terminating отказ до cleanup initialization.

Исходники: [worker](../../scripts/invoke-final-silent-reinstall.ps1), [service helper](../../src/installer/service-maintenance.ps1), [boot module](../../src/installer/maintenance-boot-recovery.ps1), [cleanup](../../src/installer/owned-cleanup.ps1), [Core barrier](../../src/service/EgoistShield.Service/InstallerServiceMaintenance.cs), [recovery policy](../../src/service/EgoistShield.Service/OwnedServiceController.cs), [NSIS](../../src/installer/setup.nsi), [packager](../../scripts/package-windows.mjs).

## Проверки текущих исходников

| Проверка | Фактический результат | Scope |
| --- | --- | --- |
| Общий Node suite | **644/644 PASS**, 0 fail/skip/cancel; **19 570,9442 ms** | Текущий diff; PlanOnly и packaged runtime checks относятся к прежнему PE 3.8.0 |
| Quiesce helper | **43/43** | Production WinPS5.1 функции; SCM/registry/process границы controlled, live mutations 0 |
| Installer lifecycle | **9 групп** | Реальные isolated files/mutex; policy, marker, resume, durable handoff write failure; service boundaries controlled |
| Регистрации | **38/38**, **148 actual native argv probes** | Literal aliases, raw ImagePath, checked metadata/backup, create/config/readback; реальные SCM/import/start 0 |
| Boot recovery | **22 группы / 490 assertions** | Production module и COM adapter через fake factory; реальные files/hash/flush/rename/reparse/Windows argv; native task writes 0 |
| Native Task XML | **Accepted** | Настоящий Schedule.Service.NewTask(0).XmlText в памяти; task register/start/delete 0 |
| Timeout recovery | **8 групп** | Настоящий before/after AST, свои скрытые child processes, held handle/mutex/files; SCM/DNS/task writes 0; grace/retry сокращены в fixture |
| Uninstall guard | **4 группы** | Actual Uninstall AST, реальные own markers/local mutex; destructive leaves controlled |
| Журнал | **4 группы** | Настоящие runspaces/Local mutex/FileStream/replace; old lost-event red, new retained events green, parse/write/abandoned paths |
| Ранний failed UI | **4 branded tests** | Actual worker и actual WorkerIf AST; logging failure не скрывает ошибку, русский текст проверен WinPS5.1 |
| Profile/DNS restoration | **3 группы** | Production функции, настоящий own File.Replace и controlled GUID-matched IPv4/IPv6 adapter/readback; host DNS writes 0 |
| Mandatory imports | **7 случаев** | Actual WinPS import prefix: missing/damaged/incomplete обоих модулей и valid pair |
| Protected-upgrade guard | **6 случаев** | Actual cleanup guard; verified boot proof controlled; старый helper без него отклонён |
| Core generation 3 | **0 errors**, **141 existing warnings**, EXE и SDK+DLL self-test **exit 0** | 67 текущих production source hashes совпали; installed Core не заменён |
| Core barrier | 6 markers, 84 mutation + 1 queued rejection, 12 query rejections, 6 offline empty-state restores, 24 separator assertions | Настоящие NTFS/locks/named pipe и production engine; harmless mutation executor |
| Core recovery policy | 4 modes, repeated repair/supervisor/races/errors/cancellation, regressive startup-write mutant | Production flow; controlled SCM runner, native policy readback ещё не выполнен |
| PowerShell static analysis | **0 errors**, **220 warnings** в десяти checked files | Предупреждения и rule counts сохранены; успешный анализ не равен отсутствию дефектов |
| NSIS | Полная compile/link проверка на inert payload, missing dependencies red | Этот compile fixture EXE никогда не устанавливается |
| Installed 3.7.9 | Четыре службы Running/Auto, marker отсутствует, 18:06 UTC | Один read-only snapshot; readiness/uptime/отсутствие рестартов не доказаны |

Локальный privileged token отсутствует. Production ACL objects проверены в памяти; в реальном fixture I/O используются только разрешённые test-SID factories и unique Local mutex. Чужие процессы не завершались; timeout fixture создаёт и завершает только собственные безвредные скрытые children. Это **не реальные SCM/Windows boot/update испытания**.

В общем прогоне был пойман дополнительный regression: 641/642 PASS, ранний worker failure не записал complete/status из-за ошибки журнала. Он исправлен и покрыт actual WorkerIf AST и реальным неуспешным worker. Independent review подтвердил lost-event before/after, lease до terminal, malformed marker refusal, uninstall, journal и early-error paths. [Отчёт](installer/post-recovery-review.md).

[Общий тестовый output](installer/full-node-test-output.txt), [Node summary](installer/node-suite-summary.json), [текущие source hashes](installer/source-fix-provenance.json), [Core receipt](installer/core-maintenance-receipt.json), [registration current](installer/registration-current.json), [boot receipt](installer/boot-recovery.json), [native XML receipt](installer/boot-xml-native-parser.json), [recovery proof](installer/recovery-fix.json), [static analysis](installer/powershell-analysis.json).

## Нерешённая миграция старого updater — R31

Проверенная установленная 3.7.9 выбирает installed helper через desktop-updater helperPath. Код самого старого 3.7.8 здесь не прочитан; его native миграция также не проверена. Read-only проверка фактически установленной 3.7.9 обнаружила helper SHA F6C232FA… без новых boot/checked-registration/maintenance функций. Новый installer требует verified boot registration; production guard отклоняет старую stage без неё. **Нельзя обещать автоматический переход старых клиентов: подписанный bootstrap/передача управления ещё не реализованы.**

Bridge должен проверяться под прежним accepted trust до service mutations, защищать snapshot и передавать управление новому worker. Ослабление guard, доверие непроверенному старому snapshot или отключение подписи не являются завершением миграции. [Installed helper probe](installer/legacy-installed-helper-probe.json), [фактический updater из установленного ASAR](installer/legacy-installed-updater-asar.json), [план](implementation-plan.md). Для 3.7.7 без старого accepted private key остаётся однократная ручная trust migration.

## Условия выпуска

R27–R30 и R32 имеют статус «реализованы в исходниках, fixture/self-test проверены, native acceptance ожидается». Требуются настоящие SCM queued restart и policy resume, privileged task/ACL/SYSTEM recovery, held payload replacement, native hang/crash, reboot/power loss и old-version upgrade/uninstall matrix. Unsupported external ReceiptRoot, user-writable old wrappers и custom-account credentials не становятся безопасными из-за наличия .reg backup.

Остаются P1 полного аудита: state persistence, corrupt Core diagnostics, operation replay, network verdicts, downloader, runtime/GUI trust, достоверные UI состояния и автономность VPN. Новый дизайн — отдельный проверенный inert макет. [32 задачи](prioritized-findings.json), [native test plan](installer-test-plan.md). Исправление установщика не делает весь выпуск готовым и не подтверждает месяцы непрерывной эксплуатации.
