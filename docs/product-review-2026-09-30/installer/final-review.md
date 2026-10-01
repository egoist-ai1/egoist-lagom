# Проверка восстановления регистраций служб

30 сентября 2026 года. Независимый review и реализация generic-registration восстановления в `scripts/invoke-final-silent-reinstall.ps1`. Проверенная frozen-ревизия исходника: SHA256 `3AD1A0FD65B3A8F42B2644C6CF8B375BC92981A504F5050C486AD769F26475FD`, база `199236e3b227f9885c2beef64faffbe9e9a35583`. Это результат проверки исходников и изолированных fixtures. Новый installer не запускался, установленное приложение не заменялось, выпуск не публиковался.

## Исправленные отказы

Раньше восстановление отсутствующей регистрации считало любую сохранённую службу WinSW-wrapper и запускало её путь с `install`. У legacy dnscrypt-proxy полноценный `ImagePath` содержит аргументы; это не путь к wrapper-файлу и не контракт WinSW. Теперь SCM получает точный сохранённый `binPath`, включая аргументы, без исполнения сохранённого service exe. При существующей остановленной собственной регистрации используется `config`, при отсутствии — `create`.

До первой остановки snapshot проверяет own-process `Type=16`, LocalSystem, `ErrorControl`, исходный нерасширенный `ImagePath`, display name, load-order group, service/group dependencies. Снимок сохраняет эти metadata и SHA256 исходного `.reg` backup; команда сверяется с CIM и startup-policy readback. Ошибка provider, неподдержанный тип/account или drift регистрации прерывает подготовку.

Ранее чужая регистрация с тем же именем могла получить сохранённый registry import. Теперь есть общий preflight перед восстановлением пользовательских файлов/DNS ownership и свежие проверки пути перед SCM/import/start. Имена aliases с `[]`, `*`, `?` проходят через фактический literal-escaped `Get-InstallerServiceState`, с проверкой точного `ServiceName`. Чужая wildcard-compatible служба не считается готовностью нужной службы.

При восстановлении SCM получает `start=disabled`. Для registry import создаётся отдельная UTF-16 копия с `Start=4`; исходный backup и его checksum сохраняются. Все registry sections ограничены собственным service key/subkeys. Команда и Disabled проверяются после SCM и import; исходные startup modes возвращает общий policy-resume. Сохранённая служба в состоянии Running отклоняется на границе восстановления.

Старые stage без проверенных registration metadata или checksum явно отклоняются с сохранением backup. Восстановление отсутствующей регистрации не угадывает LocalSystem. Shared/interactive/driver registrations, произвольные service accounts, неоднозначные unquoted пути с пробелами и service names с кавычкой остаются неподдержанными. Это ограничение совместимости, а не заявленная миграция всех исторических установок.

Основные source locators в проверенной ревизии: native runner — строка 134; metadata/preflight — 178/208; snapshot — 494; общий restore preflight — 771; проверка backup/Disabled import — 798/811; SCM restore — 838; literal start — 1131. Сохранён исправленный root guard `handoffStarted OR own marker` в worker catch, строка 1456.

## Что выполнено и что было настоящим

[Полный receipt, cases и hashes](registration-regressions.json) фиксирует 38/38 PASS в Windows PowerShell 5.1.26100.9168. Node compatibility suite: 11/11 PASS, 0 fail/skip, 7420.18 ms; registration, final silent reinstall, wrapper migration, lifecycle и recovery reporting. Прошли прежние проверки catch/maintenance/startup modes и совместимости staged worker.

SCM, registry, start/stop, service readiness и restart queue в registration fixtures находятся на контролируемых границах. **Настоящих SCM, registry, DNS/network mutations — 0. Чужих/system process kills — 0.** Файлы создавались только внутри собственной task work; это не native upgrade приёмка.

Native argument passing проверен настоящим собственным harmless C# EXE через production `ProcessStartInfo` runner, под WinPS5.1. На один fixture run: четыре запуска этого EXE — два argument echo, один exit-code=7, один timeout. Timeout действительно завершил один удерживаемый собственный child handle. Direct и Node выполнили fixture дважды: восемь таких запусков, два собственных timeout kills. Эти числа не включают запускающие test-host процессы.

Каждый из 148 аргументов на fixture run сверялся Ordinal после UTF-8/base64 round-trip: 130 крайних значений и полный 18-element SCM argv. Проверены пустые значения group/depend, Unicode, вложенные кавычки, backslashes перед кавычками, конечные backslashes и literal shell metacharacters. Подтверждён Unicode в WinPS source: первый code point `Привет` — 1055. Это проверяет передачу argv; SCM interpretation и cache visibility этим echo не проверяются.

| Файл | SHA256 |
| --- | --- |
| `scripts/invoke-final-silent-reinstall.ps1` | `3AD1A0FD65B3A8F42B2644C6CF8B375BC92981A504F5050C486AD769F26475FD` |
| `tests/installer-service-registration.ps1` | `F65912B0B51C934FE739A19131F36BE235AE92371B6681D3D6E65F6D301DD26E` |
| `tests/installer-service-registration.test.mjs` | `4EEC6DAE5631A78FF3E24DEAC9917F4C817C6B6BADA673980EF35C50DEBD5671` |

## Подтверждённый оставшийся control-flow дефект

На указанной frozen-ревизии `Invoke-Recovery` при recoveryErrors записывает `recovery-warning`, оставляет maintenance marker и возвращает normally, строки 1318–1323. Watchdog затем пишет `complete.flag=watchdog-recovered`, строка 1364; worker catch пишет `failed-recovered`, строка 1463, в том числе после исключения восстановления. Watchdog в строках 1335/1346 выходит при любом `complete.flag`.

Отказ воспроизведён фактическими production `Invoke-Recovery`/`Invoke-WatchdogMode` под WinPS5.1, с controlled lease/SCM/marker и реальными собственными isolated files: transient stop failure дал `recovering`, `recovery-warning`; marker оставался активным; terminal flag стал `watchdog-recovered`; второй watchdog вызов не сделал попытку восстановления — счётчик остался 1. Реальные SCM/registry/network/process kills в этом probe — 0. Bounded результат и SHA probe сохранены в receipt как pre-fix evidence.

Это реализационный дефект autonomous retry, а не непроведённый стресс-тест. Минимальный контракт исправления: явный recovery outcome; recovered terminal допускается только после снятия marker; неуспешный recovery сохраняет attention/nonterminal state, с bounded retry после освобождения lease. Root принял эту часть в продолжение R30 и выполняет исправление отдельно; этот report и receipt сохраняют результат до исправления. После последующей правки нужны новый source hash и повторная проверка.

## Открытые gates перед выпуском

R29: boot/power-loss recovery не зарегистрирован; обычные worker/watchdog исчезают при перезапуске, а уже Disabled службы требуют новой попытки установки. R30: живой зависший worker удерживает mutex; у watchdog нет завершённого cancellation/verified-termination/bounded-retry контракта. Оба — пробелы реализации; устранение только terminal flag не закрывает весь R30.

После реализации этих gates требуется native приёмка в отдельной Windows среде: реальная SCM restart queue, `create/config` с точными arguments и пустыми group/depend, зависимости, effective startup/delayed policy, `.reg` import/failure actions и SCM cache visibility, recreation старых LocalSystem own-process aliases, locked payload, worker/installer crash, перезапуск и power loss. Не проводилась длительная проверка месяцами. Ни 38 registration cases, ни 11 Node tests не доказывают круглосуточную стабильность установленного выпуска.

Общий статус и остальные gates: [installer fix](../installer-fix.md). Этот узкий review не заменяет полный product audit и не разрешает публикацию автоматически.
