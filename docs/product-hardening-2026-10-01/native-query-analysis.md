# Native query: точечное исправление и границы проверки

Производственные изменения заморожены на базе `9617624b888d9e8bd2b1df1e60ca4a21947f5c2d` в рабочем дереве. Изолированная компиляция: **0 ошибок, 136 предупреждений**, все предупреждения сохранены, без подавления. Финальный совместный набор: **56/56 PASS**. После изменения только способа запуска тестового CLI повторная проверка: **9/9 PASS**, включая **21 проверку настоящих Windows API и EXE**. Это не подтверждение установки/работы финального подписанного приложения под SYSTEM.

## Подтверждённый дефект

Нативная проверка Telegram вызывалась только при уже работающей SCM-службе. Проверка перед новой установкой или при остановленной службе попадала в PowerShell CIM/TCP. Поэтому проблема 1443 могла остановить установку ещё до появления новой службы. WinWS также проверял процессы через `Get-CimInstance`. В принятых логах подписанной версии 961 запросы Core завершались по 12-секундному timeout с нулевыми stdout/stderr. **Причина исходного зависания PowerShell/CIM не установлена**; увеличение timeout, расширение среды и предположения о job object не применялись.

Независимо воспроизведён небезопасный контракт WinWS: пустой путь/командная строка могли считаться своим процессом при `serviceRunning=true`. Теперь такого допуска нет.

## Что исправлено

- Telegram всегда использует ограниченный нативный CLI `--telegram-listener-snapshot --port N`, в том числе при отсутствующей/остановленной службе. Отсутствие SCM-службы не подменяет проверку настоящих TCP-строк.
- Новый фиксированный `--winws-process-snapshot` перечисляет только `winws.exe`, без произвольного запроса/имени. Пути, PID и время создания берутся из Toolhelp/процессных handles. Командные строки не собираются.
- Пары managed PID/сохранённого времени запуска проверяются вместе, допустимы только фиксированные runtime-пути. Снимок Telegram имеет schema v2, WinWS v1; неизвестные/неполные/противоречивые данные отклоняются.
- Владение Telegram требует подтверждённых пути, времени создания и цепочки родителей; PID reuse/нечитаемые родители дают unknown. Между двумя снимками сравниваются все строки endpoint, а не только первый выбранный владелец.
- Все нечитаемые совпавшие WinWS-процессы остаются в ответе как неполные строки. JS требует `identityComplete === true` плюс проверяет каждую строку; чужой или пустой путь не считается своим.
- Живой процесс подтверждается удерживаемым `QUERY_LIMITED_INFORMATION | SYNCHRONIZE` handle и `WaitForSingleObject(..., 0) == WAIT_TIMEOUT`. Running exit FILETIME не используется: [Microsoft определяет его как неопределённый для работающего процесса](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes). TCP PID получаются через [GetExtendedTcpTable](https://learn.microsoft.com/en-us/windows/win32/api/iphlpapi/nf-iphlpapi-getextendedtcptable), путь через [QueryFullProcessImageNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew).
- Безопасная диагностика отказа сохранена: тип, известный код, PID, длительность и размеры вывода; payload/команда не выдаются пользователю. Продуктовые timeout и среда не расширялись.

## Проверка и сохранённые отказы

| Проверка | Результат | Время |
|---|---:|---:|
| Inert RED до исправления маршрутизации/владения | 1/4 PASS, 3 FAIL, exit 1 | 60.104 ms |
| Два промежуточных запуска: сбой изолированного compile launcher | 32/33 PASS, exit 1 каждый | 2248.521 / 2106.5365 ms |
| Промежуточный focused GREEN | 33/33 PASS, exit 0 | 2324.7462 ms |
| Устаревшая инъекция PowerShell в lifecycle fixture | 22/23 PASS, exit 1 | 11429.6961 ms |
| Финальные четыре файла тестов | **56/56 PASS**, exit 0 | **11489.9583 ms** |
| Финальный запуск настоящих дочерних CLI EXE | **9/9 PASS**, exit 0 | **3851.8002 ms** |
| Последняя изолированная компиляция всех service C# | **0 ошибок, 136 предупреждений** | **00:00:02.83** |

Сбой compile launcher содержал MSB3030/отсутствующий `System.ServiceProcess.ServiceController.dll` в длинном task-local package path. Исправлены прямые slash аргументы MSBuild и выбран короткий task-local NuGet cache. Единственная точная причинная связь именно с quoting не доказана. В lifecycle заменён устаревший CIM stub на новый нативный отказ с сохранением проверки cause/privacy и partial identity.

Исходные RED, ошибки Win32 access denied, неудачный full-SCM assertion, оба 32/33 запуска, полный compiler log и окончательные GREEN сохранены в [native-query-proof](native-query-proof/). [Машиночитаемый отчёт](native-query-analysis.json) содержит SHA-256 всех исходников/логов, стадии, exit codes, неподменённые API-результаты и hashes изолированного EXE/DLL.

## Что настоящая проверка показала

Тест с обычным токеном создал только свой временный процесс `winws.exe` и IPv4/IPv6 loopback listeners на эфемерных портах. Toolhelp, путь, время создания и настоящие TCP PID подтверждены. Процесс завершился, listeners исчезли из настоящей TCP-таблицы. Фиксированные read-only CLI запускались как настоящие дочерние EXE с производственным `Program.Main`; произвольные аргументы и совмещение со service mode отклонены.

Из последнего единичного замера: Toolhelp/path/birth **10.9355 ms**, IPv4 **1.8121 ms**, IPv6 **1.6107 ms**, snapshot **30.5927 ms**; настоящий WinWS CLI EXE **97.9391 ms**, Telegram CLI EXE **115.4028 ms**. Это локальные наблюдения одного запуска, не p95/benchmark/SLA.

На этом host обычный токен не читает существующий SYSTEM SCM root. Фактическое наблюдение: `available=true`, `stable=false`, свой child прочитан, его birth совпадает, SCM state Running, SCM root нечитаем. Результат остаётся **unknown**; привилегии не повышались. Нечитаемые SYSTEM WinWS строки также остаются partial, а не исчезают. Отдельная проверка classifier с stopped-SCM — **явный inert объект**, содержащий настоящие child/TCP-данные; это не проверка физической остановки/установки службы. Физический Telegram CLI отказал неразрешённому пути тестового EXE, как требуется.

EXE доказательства — изолированный `NativeQueryRegression.exe`, собирающий настоящие исходники службы и делегирующий фиксированные CLI в производственный entrypoint. Это **не окончательный sealed release EXE**. Хэши ниже фиксируют наши файлы рабочего дерева; весь интегрированный проект должен получить отдельную привязку к commit и финальному артефакту в проверках parent.

## Границы и оставшиеся обязательные проверки

Тестовый код не менял SCM, DNS, реестр или GUI; shared package, подпись, установка и публикация не выполнялись. Работали только свои процессы и локальные эфемерные TCP endpoints. В первом SDK запуске был стандартный welcome-текст об установленном ASP.NET development certificate: **создание нового сертификата или использование существующего не установлено**. Сертификаты не удалялись, хранилище не менялось вручную; финальный helper отключает first-use generation, его среда только task-local. Поэтому общий тезис «никаких побочных OS действий» не заявляется.

Для релиза остаются: commit/integration parent; сборка и sealing точного исходного commit; реальные native status/install/upgrade/rollback под предполагаемой SYSTEM authority Core worker; восстановление после перезапуска без GUI; независимая DNS диагностика и проверка maintenance/recovery при замене старых служб. Подписанный native run 961 остаётся FAILED в принятом evidence. Ни месяцы непрерывной работы, ни remote connectivity, ни здоровье всех установленных служб этими тестами не подтверждены.

## Замороженные файлы: SHA-256 точных bytes

| Файл | SHA-256 |
|---|---|
| `src/service/EgoistShield.Service/WindowsServiceListenerSnapshot.cs` | `a85748fb3630794043d5fc88f11c872aad5d343d99b38f37261641712ef1c379` |
| `src/service/EgoistShield.Service/TelegramListenerSnapshotCommand.cs` | `44af45ecfd113e0ef4eeb3eeae61fed838e0b6e995c1cefcaa9676f0f81d562e` |
| `src/service/EgoistShield.Service/Program.cs` | `66e15e519d3ea1243da8cd706aff7fe8aa7a4b74806f0c5327649280259d7977` |
| `src/service/EgoistShield.Service/WinwsProcessSnapshotCommand.cs` | `7499792dc20249b5da61704f69fc44fb78455f458fceed7ac04dd724ec5e795b` |
| `src/recovered/electron/ipc/telegram-proxy-manager.js` | `63296162c5942d6f5b914be94538997b2f27832b515c2da08bb75c4c84fa5b3b` |
| `src/recovered/electron/ipc/zapret-manager.js` | `3e48d9a6f282ceeacd7039e9852a8790e70180fd56f3413566db77bdbf264fd1` |
| `tests/zapret-query-diagnostics.test.mjs` | `bba602b3c00c3b60c93c9abbfc3d87829b75e1fee639f8f60687a678f91faaa9` |
| `tests/telegram-listener-ownership.test.mjs` | `11f1630e96f60c73518f9441e5284c509aff40fc6738cd3dfeecf6a3caeaad46` |
| `tests/zapret-selection-lifecycle.test.mjs` | `3c54e9a9bc60d3922f0e7cda1f9e3e0eacb2d63b374ebed61c016951b68a7523` |
| `tests/native-process-query.test.mjs` | `6d8efe1e2fee1d3950ecf416fa4cbfab932bac7df6e2f093a145a94555c4b74f` |
| `tests/NativeQueryRegression/NativeQueryRegression.csproj` | `0f0ce100d6e887eb2bb15b2f8870cba6ff5f455124118ffd9c314b0cbc07aab5` |
| `tests/NativeQueryRegression/Program.cs` | `fffd7bcc21bde0a9503b7e4f0818c3b78539271af205eddea74ed23b9ed9f88e` |
