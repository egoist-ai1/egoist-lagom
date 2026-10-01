# Аудит фоновых служб — 30 сентября 2026

Базовый код: `d56eb9327fa75a88e91fae62b8d7ea3ed095dcf2` (публичный 3.7.9). Область: `src/service/**`, соответствующие C# harnesses, граница Node component worker. Проверка выполнена из отдельных временных проектов против исходников приложения на .NET 10.0.12; установленная система, SCM и сетевые параметры не изменялись. В тестах использовались собственные дочерние процессы, loopback listeners и подменённые системные команды. Это проверка исходников и контрактов, не испытание месячной работы настоящих служб.

## Исходная проверка

| Проверка | Результат | Реальная граница |
|---|---|---|
| CoreServiceReliabilityRegression | 24 группы, PASS; 3,47 с внутри harness | Сериализация SCM-переходов, deadlines, ownership, 1 440 искусственных циклов отказов, реальные loopback/TCP tables и собственные дочерние процессы |
| NativeDohConfigurationRegression | 15 групп, PASS; 4,32 с внутри harness | Генерируемый PowerShell с тестовыми DNS cmdlets, rollback/ownership model, настоящий read-only native TCP snapshot |
| AtomicJsonFileLockRegression | PASS | Реальные Windows file-share locks, replacement, bounded retry и cancellation в собственном каталоге |
| DnsOwnedRestoreRegression | PASS | Восстановление своей семьи DNS с сохранением внешней семьи |
| Service self-test | PASS; protocol 1, version 3.7.9 | IPC parser, isolated pipe, worker framing, journal, durable idempotency; настоящий read-only native DoH readback |

Шесть часов в stress harness — искусственный ход времени, не шестичасовой прогон ОС. C# build сообщает существующие nullable и P/Invoke layout warnings; они не стали runtime failures.

## Подтверждённые дефекты

Данные минимальных воспроизведений: [services/reproduction-before.json](services/reproduction-before.json); исходник: [services/ServiceAuditReproduction.cs](services/ServiceAuditReproduction.cs). Вызовы идут в реальные классы приложения, а не в копии их логики.

### SVC-01 · P1 для custom native DoH: обновление bootstrap не достигает worker

- `src/service/EgoistShield.Service/OperationDispatcher.cs:154` вызывает `SystemDoH.bootstrapServers` с `query=true`; `src/service/EgoistShield.Service/ComponentWorker.cs:77` не включает этот метод в список запросов. Node-контракт в `src/component-protocol.js:42` этот чистый запрос разрешает.
- Триггер: автоматическое обновление bootstrap адресов собственного native DoH. Возникает `A mutation cannot use the component query endpoint.` до запуска worker. Старые адреса остаются; scheduler повторяет попытку после cooldown, но тот же контракт снова её запрещает.
- Реально воспроизведено: 0 запусков worker и именно эта ошибка на валидном envelope.
- Пробел тестов: native bootstrap regression подменяет `_executeComponent`, тем самым обходит настоящий `ComponentWorker` и ошибочную whitelist.
- Минимальная правка: согласовать C# whitelist с чистым Node-запросом и пройти настоящий C# worker boundary в регрессии. Настоящая ротация DNS в установленной системе этим воспроизведением не проверена.

### SVC-02 · P2: scope identity probe обходит response caches

- `src/service/EgoistShield.Service/OperationDispatcher.cs:314–338` возвращает memory/durable responses до ограничения `IdentityProbe` в `ExecuteAsync` (`:552`).
- Триггер: probe-клиент повторяет ID/содержимое ранее успешно выполненного запроса, которому этот probe не имеет доступа.
- Реально воспроизведено: свежий `service.status` получает `IDENTITY_PROBE_SCOPE`, тот же ранее закэшированный запрос разрешён; после создания нового dispatcher разрешён и durable replay тестовой мутации.
- Это обход ограничения выдачи результата, не доказательство нового выполнения мутации, произвольного запуска кода или удалённого exploit. Для replay нужно знать совпадающий request ID и payload.
- Пробел тестов: idempotency и probe policy проверялись по отдельности.
- Минимальная правка: проверять scope до memory cache, durable cache и регистрации in-flight запроса; покрыть memory и restart/durable replay.

### SVC-03 · P2: перевод системных часов назад отключает восстановление

- `src/service/EgoistShield.Service/OwnedServiceSupervisor.cs:143`: `UtcNow - LastRecoveryAt < 5 minutes` считает отрицательный возраст недавним событием.
- Триггер: успешная запись recovery timestamp при неверно выставленном будущем времени, затем коррекция часов назад; либо сохранённый future timestamp после restart.
- Реально воспроизведено на injected clock класса: 100 проверок остановленной желаемой Auto-службы и 0 восстановлений; восстановление появляется только когда время догоняет timestamp. Никаких настоящих часов/служб не менялось.
- Пробел тестов: сохранение cooldown после restart проверяется при строго растущих часах.
- Минимальная правка: считать «недавним» только неотрицательный возраст, сохранять существующий монотонный backoff внутри процесса. После коррекции нужна одна ограниченная попытка, без storm.

### SVC-04 · P2: та же ошибка часов в DNS bootstrap scheduler

- `src/service/EgoistShield.Service/DnsBootstrapRefreshScheduler.cs:40–41`: отрицательный возраст попадает в hour/15-minute cooldown.
- Триггер: часы корректируются назад после записанной попытки. Автообновление bootstrap откладывается до старого будущего времени, потенциально на дни.
- Реально воспроизведено: первая попытка завершается; после перевода injected clock назад на 14 дней следующая не запускается.
- Пробел тестов: concurrency/restart проверяются при растущем времени.
- Минимальная правка: отрицательный возраст не должен означать действующий cooldown; новая попытка записывает текущее время до вызова worker.

### SVC-05 · P1, source-only путь выполнения: fail-closed ACL guard не покрывает SCM start

- `ServiceEngine.cs:37,69,73` сохраняет controller с `productDataRootVerified=false` после неудачного ACL hardening. Guard находится лишь в `OwnedServiceController.RunOwnedExecutableAsync` (`:440`); `StartAsync` (`:82`), repair (`:381`), повторная install и восстановление Auto могут вызвать SCM без этого guard.
- Триггер: ACL защищённого runtime root не подтверждены, регистрация собственной службы уже существует, её allowlisted image path всё ещё находится внутри runtime root. Команда SCM может запустить бинарник или восстановить автоматический запуск из каталога с неподтверждёнными правами.
- Безопасное до/после доказательство guard: методы вызваны с отдельным unverified root; исходная версия не возвращает `PROTECTED_ROOT_UNVERIFIED` до доступа к SCM metadata/path. Trusted-path/missing-file checks перехватывают операции; **SCM start/exploit не выполнялся**.
- Пробел тестов: worker-owned execution guard не проверяет запуск уже зарегистрированной службы через SCM.
- Минимальная правка: до metadata/commands блокировать Start/Install/repair/Auto restoration при unverified root. Чтение состояния, Stop и безопасное выключение сохраняют возможность восстановления.

## Что уже сделано правильно

Доступ в Core привязан к installed executable; native probe сверяет pipe PID со SCM PID. Операции принимают фиксированные команды и validated payloads. TrustedPath исключает reparse-компоненты и выход из разрешённых каталогов. Мутации сериализованы; незавершённый durable marker препятствует новым мутациям. Проверенный terminal response можно завершить без повторного изменения сети. Explicit Stop и Disabled выигрывают у recovery. TCP ownership проверяет ancestry, birth time и endpoint; чужой Telegram listener не запускает recovery storm. Worker frames и I/O ограничены; timeout не повторяет команду. Optional log locking не превращает сетевой результат в отказ. DNS ownership сохраняется по GUID и отдельно по address family.

## Границы готовности

Нет нового реального reboot, power-loss/disk-full испытания, многодневного soak, проверки VPN/Telegram traffic delivery или гарантии восстановления произвольного внешнего Windows конфликта. DNS SERVFAIL считается доказательством локальной живости, поэтому это не доказательство работоспособности upstream DoH. Zapret supervision подтверждает SCM Running, не полноту фильтрации трафика. Worker timeout/cancellation остаётся операцией с потенциально неопределённым внешним результатом: после неё требуется чтение фактического состояния, а не автоматический replay. Реальные process faults и установленная система проверяются отдельно родительской интеграционной работой.

## Исправления и повторная проверка

SVC-01—05 исправлены в текущей production-audit ветке; публичный тег 3.7.9 не изменялся. Исправлены только пять служебных классов и два C# harnesses:

- `ComponentWorker`: чистый `bootstrapServers` достигает worker; запрос `apply` по-прежнему запрещён на query endpoint.
- `OperationDispatcher`: scope probe проверяется до любого replay/cache/in-flight lookup. Отказ scope не загрязняет cache авторизованного клиента; `hello` остаётся разрешённым.
- `OwnedServiceSupervisor`: future timestamp не отключает восстановление, но новый recovery по-прежнему выдерживает пять минут и сохраняется при restart.
- `DnsBootstrapRefreshScheduler`: после коррекции часов разрешена одна попытка, затем вновь действует сохранённый hour/15-minute cooldown; 100 одновременных checks не повторяют попытку.
- `OwnedServiceController`: неподтверждённые права runtime root блокируют start/install/recovery policy/Auto restoration до SCM metadata/commands. Проверены 12 вызовов для трёх собственных служб. Read-only и Stop не получили нового запрета.

Для независимой проверки старые исходники извлечены `git archive` из неизменяемого `d56eb9…` в собственный временный каталог. Те же пять новых регрессионных методов выполнялись отдельно, чтобы первый отказ не скрывал остальные. **На исходной версии 0/5 PASS (все пять ожидаемо упали), на исправленной 5/5 PASS.** Результаты: [regressions-before.json](services/regressions-before.json), [regressions-after.json](services/regressions-after.json).

Полный Core regression после исправлений: **27 групп PASS, 3,83 с**; native DoH/Core: **17 групп PASS, 3,77 с**, runtime .NET 10.0.12. Сохранились прежние bounded stress результаты: 1 440 проверок с 14 попытками восстановления и 14 warnings; при 1 440 Running и 1 440 Stopped проверках чужого Telegram listener — 0 recoveries, 0 warnings. Service self-test повторно PASS, protocol 1. Измерения, SHA-256 журналов и семи изменённых исходников: [validation.json](services/validation.json).

Это свидетельства исправленного поведения исходников и контрактов. Новый установщик, reboot и публичная загрузка updater этой частью аудита не проверялись; их результат должен сопровождать финальную интеграционную сборку.

## Дополнение: оболочки фоновых служб и безопасное обновление

### SVC-06 · P1 для полноты обновления runtime: сохранённые WinSW не заменяются новым payload

Источник: `system-doh-service-manager.js:959` и `telegram-proxy-manager.js:1079` копируют общую оболочку только при отсутствии файла. Защищённая переустановка восстанавливает прежний ProgramData Runtime (`invoke-final-silent-reinstall.ps1:521`), поэтому новая оболочка в установочном файле сама по себе не обновляет уже созданные DoH/Telegram/Zapret aliases. Найденный прежний WinSW 2.12.0 содержит самостоятельный .NET 6.0.13; анализ бинарной поставки описан в [release-audit.md](release-audit.md).

Исправление ограничено `scripts/invoke-final-silent-reinstall.ps1` и installer fixtures. Проверка установленного .NET Framework выполняется в dispatcher и worker до передачи управления и остановок (`:115,:1015,:1145`); порог **Release >= 528040**, то есть 4.8+. [Microsoft рекомендует проверять версию сравнением `Release` с минимальным порогом](https://learn.microsoft.com/en-us/dotnet/framework/install/how-to-determine-which-versions-are-installed). На текущем host настоящий read-only вызов новой функции вернул **533509**. Root добавил тот же предварительный gate в `.onInit` обычного NSIS установщика, до распаковки/CheckInstallSafety.

`Update-PreservedServiceWrappers` (`:625`) выполняется после восстановления и проверки прежних конфигураций, до запуска служб. Разрешены ровно три имени и соответствующие пути под `Runtime/<component>/service-wrapper`. Перед первой записью проверяются остановленное состояние и текущая SCM регистрация, сохранённая регистрация, SHA исходной резервной копии, SHA текущего файла, отсутствие reparse points и неоднозначных записей. Источник должен совпадать одновременно с записью установленного manifest данной версии и закреплёнными **655872 bytes / SHA-256 b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f** официального WinSW.NET461.exe. Это защита от случайной/непроверенной подмены файла, не новая подпись upstream издателя.

Замена атомарна для каждого файла, с SHA readback. До первой замены сохраняется `wrapperMigrationPending`; при последующем отказе восстановление сначала останавливает собственные aliases, затем возвращает резервный Runtime (`:666,:948`). Ошибка CIM запроса не считается отсутствующей службой. Изменённое внешним процессом владение не разрешает остановку. Исходные XML/arguments и намерение оставить службу выключенной сохраняются.

Доказательство: тот же fixture выполняет реальные post-restore statements прежнего и нового `Invoke-WorkerMode` с настоящими файлами и тестовым SCM. **d56 baseline FAIL: остаётся старая оболочка SystemDoH; candidate PASS: обновлены три aliases.** В Windows PowerShell 5.1 пройдены **21 проверки**: idempotency, работающая третья служба, подмена обоих регистрационных путей, отказ CIM, изменённые manifest/source/backup/current binary, дубликаты, реальный sharing violation на втором файле, возврат трёх исходных файлов, настоящий junction, выход за root, framework thresholds, отсутствие остановки при раннем отказе. Существующие **5 XML/DNS migration проверок PASS**, включая настоящий `Xray run -test`. [Санитизированный receipt](services/installer-wrapper-validation.json); исполняемый fixture — `tests/installer-wrapper-migration.ps1` с абсолютным task-scoped `LAGOM_TEST_TEMP`.

Сам официальный новый EXE дополнительно выполнен в собственном каталоге под тремя реальными alias filenames: `version` → **WinSW 2.12.0.0**, `status` → **NonExistent**, все exit code 0. [Документация WinSW v2 описывает варианты .NET Framework и совпадающие имена EXE/XML](https://winsw.github.io/v2/). Эти команды подтверждают запуск CLR и совместимость имени/чтения XML. Start/install/restart, SCM failure recovery, child engine и загрузка драйвера ими не проверяются. Живые службы/установленное приложение не менялись.

### SVC-07 · P2: ошибка до handoff запускает ненужное восстановление

Прежний worker catch всегда вызывал `Invoke-Recovery`; тот сразу останавливал Core. Отказ snapshot/backup мог таким образом остановить службу до готовности резервной копии, хотя сам install ещё не начался. Теперь `handoffStarted=false` сохраняется в исходном state и меняется на true до первой остановки (`:1042`). Worker, watchdog и recovery различают эти этапы; ранний отказ не запускает системное восстановление, state старого формата без marker продолжает поддерживать recovery. `installer-recovery-reporting.ps1` проверяет post-handoff pending/committed rollback, ранний отказ без stop/launch и обратную совместимость. Незавершённый payload rollback по-прежнему сообщает `recovery-warning` и блокирует запуск desktop.

## Дополнение: изоляция проверки интерфейса и обработчик падения renderer

Read-only review изменений root в `main.js`, `app-paths.js` и `renderer-recovery-controller.js`: в production сохраняются прежний каталог данных, установка Core client, startup reconciliation, login items, восстановление фоновых функций, updater и шаги graceful shutdown. Исключён повторный `StateStore.load()`: `registerIpcHandlers` уже ожидает первую загрузку, последующий `get()` читает то же подтверждённое состояние. В `NODE_ENV=test` DNS journal/runtime принадлежат тестовому профилю, автозапуск/автообновление/reconciliation выключены; root guard `performGracefulShutdown` (`main.js:392`) возвращается до системных cleanup calls. Оставшиеся before-quit действия отменяют таймеры/собственный traffic request. Это проверка автоматического lifecycle: разрешение произвольных ручных privileged IPC вызовов отдельной UI сессии не выводится из изоляции профиля.

Для обработчика renderer исполнен именно извлечённый старый/новый `render-process-gone` callback в VM, с fake window и управляемым временем; настоящий Electron/GUI не падал. Ограниченный производитель crash events даёт baseline **10 немедленных reloads**, candidate **3 reloads за первые 59999 ms**, затем cooldown. OOM: baseline **0**, candidate **1 после 5000 ms**. [Receipt](services/renderer-callback-validation.json), [исполняемое воспроизведение](services/RendererCallbackReproduction.mjs). Это доказательство логики callback/backoff, не измерение реальной частоты падений или фактического восстановления окна. Root runtime suite отдельно проверяет отмену retired window, coalescing и сохранение production shutdown.

Повторное чтение неизменяемого d56 уточнило первоначальный вывод о manual reinstall: уже 3.7.9 направляет распознанную существующую установку в protected helper, даже если DoH не работает. Clean-install очистка применяется к прямому разрешённому пути; её нельзя приписывать штатному подтверждённому ручному обновлению. Следующее дополнение проверяет и усиливает доказательство идентичности/отказа, а не заявляет уже существующий handoff новой функцией.

## Финализация установщика: реальные версии и точное разрешение handoff

Root дополнительно передал исключительное владение `src/installer/owned-cleanup.ps1`, `src/installer/setup.nsi` и installer fixtures. В этой фазе исправлены два подтверждённых дефекта; финальный `Invoke-final-silent-reinstall` и C# service fixes не менялись.

### SVC-08 · P2: installation.json публикует чужую версию релиза

В исходном d56 настоящие `PostInstall` и `Recover` writers содержат literal `3.7.8`, независимо от установленного EXE/manifest. Новая `Get-ValidatedInstalledProductVersion` (`owned-cleanup.ps1:2454`) сверяет schema1/packageVersion manifest с **обоими** PE ProductVersion/FileVersion и ProductName `Egoist Lagom`/`Egoist Shield`, принимая только числовой релиз и допустимую нулевую четвёртую часть. Пути и предки должны быть обычными файлами/каталогами. `Write-ValidatedInstallationIdentity` (`:2479`) публикует эту версию и свежий UUID вместо literal. `PostInstall` и production `Recover` проверяют версию до своих сетевых cleanup/identity/commit действий; существующий полноразмерный runtime inventory health gate сохранён.

Доказательство: реальный harmless PE с ProductVersion3.8.0/FileVersion3.8.0.0 компилируется в собственном каталоге Windows Framework compiler; actual phase publication statement d56 создаёт JSON3.7.8 и FAIL. Candidate statements обоих фаз создают JSON3.8.0. Смена продукта, PE3.7.9 при manifest3.8.0 и отсутствие version отклоняются с сохранением прежнего identity. Ни один fixture PE не исполняется.

### SVC-09 · P2: небезопасный отказ имеет тот же handoff код, что подтверждённое обновление

Уже существующий handoff основан лишь на именах файлов и размере EXE. `CheckInstallSafety` в d56 возвращает54 для любого отказа, а интерактивный NSIS отправляет54 в helper. Так ошибка DNS проверки/недоказанная идентичность не отличается от разрешения protected update. Новая проверка (`:664`) допускает только точный native ProgramFiles/EgoistShield без reparse points. Непустая существующая установка обязана пройти реальный runtime inventory health check и PE/manifest identity/version. Только такой объект без действующего protected stage выставляет `installSafetyHandoffAllowed=true` и получает54. Неопознанный непустой target, неправильный путь, чужой PE, checksum/version failure или DNS preflight failure получают58 без handoff. Отсутствующий/пустой canonical target остаётся первой установкой; verified protected stage возвращает0. Worker `/S` по-прежнему не входит в интерактивную dispatch ветвь. Неизвестная ошибка исполнения phase сохраняет ненулевой54, вместо преобразования строки ошибки в успешный exit0.

Доказательство actual `CheckInstallSafety`, исполненного в отдельном Windows PowerShell5.1 процессе с собственными файлами: foreign-product PE **d56 exit54 → candidate exit58**; candidate verified existing54, unsafe58, fresh0, authenticated worker0. Valid inactive-DoH handoff уже существовал и проходит на baseline; его не включаем в число новых исправленных дефектов.

Финальные проверки: **13 PE/file scenarios PASS**, **4 настоящих phase exit dispositions PASS**, **3 finalize rollback/commit scenarios PASS**, **18 связанных Node tests PASS**, прежние protected-stage hash/worker identity **5 PASS**. UTF-8 BOM cleanup сохранён, `git diff --check` PASS. [Receipt и SHA исходников](services/installer-finalize-validation.json); исполняемые fixtures — `tests/installer-version-handoff.ps1` и `tests/installer-finalize-regressions.ps1`.

Production `setup.nsi` скомпилирован настоящим NSIS3.0.4.1 с минимальным payload в собственном каталоге: **exit0**. Полученный EXE имеет реальную installer PE identity/version3.8.0 и принят read-only `EmbeddedRelease -PlanOnly`: **exit0/ready=true**. Этот EXE не запускался. Это проверка компиляции/control contracts, не полноценная установка кандидатного Electron/runtime payload. Framework4.8 gate root, branded UI/mutex и launch preference сохранены. Живые службы, registry, adapters и пользовательская 3.7.9 не менялись.

## Дополнение: elevated GUI и явное намерение автозапуска

### SVC-10 · P2: прежняя Run-key регистрация несовместима с новым requireAdministrator GUI

Смена GUI manifest на requireAdministrator — явное решение пользователя/Root. Прежний Electron setLoginItemSettings регистрирует Run key, который не подтверждает фактический запуск приложения с таким manifest. Исправление сохраняет существующий opt-in: только settings.autoStart=true создаёт per-user задачу входа с HighestAvailable и InteractiveToken текущего интерактивного SID. Ручной запуск GUI остаётся штатным UAC. GUI-служба/SYSTEM-сеанс, чужие credentials и обход UAC не вводятся. Регистрация выполняется уже подтверждённым elevated GUI; положительное настоящее Scheduler выполнение пока является отдельным hosted gate.

Новый gui-login-startup.ps1 проверяет canonical native ProgramFiles action, фиксированные arguments, текущий session SID/admin, защищённые owner/ACL, protected per-SID receipt и закреплённый GUI inventory с настоящими SHA/size readback. Создание task строго create-only, первоначально disabled; включение следует после проверки XML/SD. Чужая задача, одна совпавшая строка имени, несовпавший receipt, дополнительные действия/триггеры, подменённый executable или SID не разрешают overwrite/delete. Legacy fixed-name задача удаляется только после доказательства exact direct GUI action, principal SID, author и защищённого Task ACL. ExecutionTimeLimit=PT0S, IgnoreNew; restart-loop не добавлен.

main ожидает startup readback. StateStore hook выполняет scheduler side effect только при изменении autoStart и ожидает его до commit; ошибка дисковой записи вызывает rollback прежнего известного намерения. Смена notifications/DNS/профиля не пишет scheduler. Electron Run запись выключается только после подтверждённого нового результата. Обычная установка не создаёт per-user opt-in за пользователя.

Защищённый reinstall сохраняет durable suspended/resumeEnabled до отключения own task и перед остановкой runtime. Resume отложен до удаления service-maintenance marker и проверки нового/восстановленного GUI inventory; исходное enabled состояние и registration URI сохраняются. Uninstall удаляет только доказанно свою задачу. Чужая/изменённая задача не переписывается даже при восстановлении.

Новые boot-recovery stages требуют ровно четыре закреплённых helper. Предыдущий protected stage с тремя файлами допускается только для read-only проверки/retirement, когда GUI helper отсутствует, сам pinned старый module содержит exact прежний immutableNames контракт и не содержит новой GUI capability. Register никогда не допускает три файла. Fixtures проверяют legacy3 verify/retire, отказ новой4 регистрации без helper, hash tamper каждого из четырёх helper и отказ маскировки GUI-capable module старым3 inventory.

Проверки: 22 focused Node PASS, 0 FAIL/skip; отдельные 18 ordinary Core PASS. Windows PowerShell5.1 GUI fixture: 18 групп / 51 assertions; native task reads/creates/updates/deletes/actions и native ACL writes равны0. Реальные fixture файлы/хэши использованы; Scheduler и ACL descriptors контролируются fixture. Сам CLI из неканонического project пути отказывает до native session/COM. Подробные хеши и сырые результаты сохранены локально; исполняемые проверки — `tests/gui-login-startup-guards.ps1` и `tests/installer-boot-recovery.ps1`.

Native helper требует Windows PowerShell5.1/.NET Framework: classic MutexSecurity/GetAccessControl API не заменены PS7. Реальный elevated COM create/readback, installer task quiescence/restoration и opt-out остаются обязательным отдельным native acceptance gate. Логон, reboot и месяцы непрерывной работы этими fixtures не доказаны. Background службы не зависят от запуска GUI; updater проверяется при работающем GUI/следующем запуске. Проверка защищённого installer inventory не является утверждением об Authenticode-подписи.
