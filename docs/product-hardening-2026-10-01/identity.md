# Runtime и идентичность процессов

Проверено 1 октября 2026 года. Это результат проверки исходников и собственных копий исполняемых файлов. Установку служб, обычный пользовательский токен в установленном приложении и длительную работу проверяет отдельный этап приёмки.

## Изменения

- Electron обновлён с 44.4.5 до 44.5.1. Официальный GitHub API подтверждает release `399599493`, опубликованный `2026-09-30T02:12:03Z`; архив Windows x64 содержит 157 998 329 байт, SHA256 `9b382492dcfee91f8f9e92c91f7972550a1b95d2299cac72279dab33a600d7db`. Проверены GitHub asset.digest, официальный SHASUMS256 и SHA256 всех 73 извлечённых файлов. Старый кэш сохранён.
- GUI запускается как `asInvoker`. Его fuse wire `000011011` отключает RunAsNode, NODE_OPTIONS и Node CLI inspector, включает проверку ASAR и загрузку только из ASAR. Отдельный `EgoistShield.Worker.exe` имеет wire `100011011`: Node нужен этому фиксированному фоновому протоколу. Worker не получает права интерактивного GUI на pipe Core.
- Хеш заголовка ASAR записывается в настоящий Windows PE resource `INTEGRITY/ELECTRONASAR` и считывается обратно Win32 API. Инвентарь установщика содержит SHA256/размеры GUI, ASAR, worker, общих DLL, Core и встроенных runtime.
- До запуска привилегированного кода Core проверяет владельцев/DACL всех родителей, reparse points, хеши, набор DLL и число NTFS ссылок. Открытые `FileShare.Read` удерживают проверенные файлы до завершения дочернего процесса. Пользовательские и custom runtime допускаются только без повышения.
- Проверка Windows токена использует каталог трёх реально загруженных KnownDLL: ntdll, kernel32, kernelbase. PATH/SystemRoot из среды не выбирают исполняемый проверяющий хост. Неудачная проверка оставляет привилегии неизвестными. Среда привилегированного native child исключает Node/.NET/CoreCLR/COMPlus/OpenSSL startup injection.
- Core также проверяет настоящую Windows command line GUI. Допустимы только обычный запуск, `--minimized`, `--background` и их единственная комбинация. Electron child `--type`, Chromium CDP, альтернативный app, user-data-dir, extension и JS switches не получают права GUI. PID и время рождения перепроверяются. В программе отсутствует тестовый обход этой политики.
- Фиксированные VPN hooks подключены к Program и worker. Worker передаёт только три заранее определённых кода ошибки VPN. Неподтверждённый rollback превращается в `OPERATION_OUTCOME_UNKNOWN`, чтобы Core сохранил durable intent и не повторил мутацию. Некорректный тип/чужой код ошибки тоже завершается неизвестным результатом.

## Реальные проверки

`identity.json` связывает исходники, команды и принятые evidence. Node проверки: 28/28, без пропусков. Native C# проверки: 8/8 групп, настоящие NTFS, ACL, pipe и собственные процессы. Проверены 14 native argv children (4 допустимых/10 отклонённых), реальный pipe PID/SID, блокировка 4 записей/1 перемещения открытыми файлами, освобождение handles после ошибки, hardlink и лишняя DLL, точный bundled path/hash и пять структурированных worker replies.

Native Electron проверки: 11/11. На исходном GUI wire `101100011` собственный внешний Node script действительно выполнился. После изменения GUI выполнил только проверенный ASAR: не выполнились внешний script, NODE_OPTIONS preload и `--app` из другого каталога. Два Node inspector флага не открыли порт: 0 успешных подключений из 28 проб. Изменение ASAR заголовка завершило процесс кодом `4294930435` до исполнения любого marker.

Chromium CDP остаётся отдельной возможностью Electron: на собственной скрытой копии он действительно выполнил JavaScript renderer. Для того же настоящего процесса production C# launch policy отказала в правах GUI. Обычный запуск собственной копии этим native policy принят. Сам renderer не объявлен защитой от всех программ, уже работающих под тем же Windows пользователем.

Проверка KnownDLL и токена выполнена также настоящим Electron worker 44.5.1 / Node 24.21.0: каталог `C:\WINDOWS\SYSTEM32`, фактический `isAdmin=false`. Привилегированный fake verifier из пользовательского каталога отклонён до его исполнения.

## Границы доказательства

Эти проверки не устанавливают приложение и не меняют SCM, DNS, задания или реестр. Байтные C# fixtures используют compile-time seam только вместо проверки установочного ACL; настоящий ACL validator проверен отдельно на OS descriptor, собственном NTFS файле и Windows security descriptors. Успешная авторизация установленного GUI с обычным токеном требует отдельной проверки готового установщика. Файлы native Electron являются собственной копией аутентифицированного upstream, с небольшим ASAR для проверки механизмов; это не проверка всех экранов продукта.

Период работы месяцы этими проверками не доказан. Также не обещается защита от внедрения в память GUI другой программой с тем же пользовательским токеном. Privileged API остаётся ограниченным валидированными операциями; произвольный shell/executable из IPC не добавлен.

## Воспроизведение

В существующем task-owned каталоге задайте `LAGOM_TEST_TEMP`, `EGOIST_PACKAGING_TEST_DIR`, `SHIELD_PYTHON`; выполните `node --test tests/production-runtime-identity.test.mjs tests/electron-runtime-packaging.test.mjs`.

Для настоящих Windows API: `tests/runtime-identity-production.ps1 -WorkRoot <absolute-work>`. Скрипт замораживает девять production C# файлов и сообщает путь `NATIVE_ARGUMENT_PROBE`. Он использует точный SDK проекта, либо явно выбранный `SHIELD_DOTNET`.

Для настоящего Electron PE: `node tests/runtime-identity-native.mjs --work <absolute-work> --argument-probe <NATIVE_ARGUMENT_PROBE>`. Требуется заранее проверенный кэш из `scripts/fetch-electron-runtime.py --work-dir <absolute-work>`. Копии и процессы остаются внутри своего task work; установленное приложение не используется.

Первичные контракты: [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses), [ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity), [официальный релиз 44.5.1](https://github.com/electron/electron/releases/tag/v44.5.1).
