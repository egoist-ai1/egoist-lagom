# Локальная проверка окружения WinPS

Отказ не воспроизведён. Под фактическим обычным токеном пользователя оба запуска фиксированного `Get-CimInstance Win32_Process -Filter "Name='winws.exe'"` завершились успешно. Изменение среды production worker по этим данным не обосновано.

| Среда | Длительность | code / killed / signal | stdout | stderr | Валидных результатов |
|---|---:|---|---:|---:|---:|
| Обычная наследуемая, 77 ключей | 405.064 мс | 0 / false / null | 103 байта | 0 байт | 1 |
| Эквивалент worker, ровно 8 ключей | 400.520 мс | 0 / false / null | 103 байта | 0 байт | 1 |

Использованы штатный абсолютный путь WinPS, аргументы `-NoProfile -NonInteractive -Command`, исходная проекция запроса и бюджет 12 000 мс. Вторая среда содержала только ELECTRON_RUN_AS_NODE, NODE_ENV, ProgramData, SystemRoot, PATH, COMSPEC, TEMP и TMP. windir, USERPROFILE и PSModulePath отсутствовали. Cwd и TEMP заменены собственными изолированными путями задачи в обоих случаях. Сохранены только метаданные: поля процессов, пути исполняемых файлов и CommandLine не записывались.

Это не проверка под SYSTEM: admin=false, system=false, физический Windows10.0.26200.0, внешний Node24.19.0. Обычная среда действительно наследует PSModulePath от PS7.6.5; это не среда Explorer. Проведены два последовательных запуска, поэтому цифры не являются benchmark или доказательством работы месяцами.

Исходные контракты: [ComponentWorker.cs](<C:/Users/Egoist/Desktop/Проекты/Приложения/Egoist Lagom/src/service/EgoistShield.Service/ComponentWorker.cs:157>) и [zapret-manager.js](<C:/Users/Egoist/Desktop/Проекты/Приложения/Egoist Lagom/src/recovered/electron/ipc/zapret-manager.js:2253>). Точные SHA256 и исходные безопасные receipts находятся в соседнем JSON. Источник на момент проверки: `5086586140306a7401ebe6d52e94211b2278633e`.

Следующая решающая проверка — исходные code/killed/signal/elapsed/byte counts до перепаковки исключения непосредственно в штатном SYSTEM worker на hosted runner. Если отказ там повторится, нужны раздельные безопасные маркеры запуска, импорта и CIM, прежде чем менять среду или timeout.

Расширять наследование сейчас не следует. Особенно PSModulePath с пользовательскими каталогами может направить привилегированный worker к недоверенному модулю. При доказанной необходимости добавлять конкретный ключ нужно из доверенного системного пути или API учётной записи службы. [Microsoft описывает построение PSModulePath при запуске](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath?view=powershell-7.5), [Node — параметры env/timeout и исходные поля child error](https://nodejs.org/download/release/v24.19.0/docs/api/child_process.html#child_processexecfilefile-args-options-callback); [локальный CIM использует WMI/COM](https://learn.microsoft.com/en-us/powershell/module/cimcmdlets/get-ciminstance?view=powershell-5.1).

Приложение, Setup и службы не запускались; настройки SCM/DNS/Tasks/registry и существующие исходники не менялись. releaseReady=false: hosted причина остаётся открытой.
