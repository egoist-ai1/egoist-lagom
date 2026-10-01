# Диагностика PowerShell в Zapret

Исправлена потеря метаданных дочернего процесса. В ошибке штатного execFile теперь остаются kind, code, killed, signal, elapsedMs, timeoutMs, PID и размеры stdout/stderr. Существующий worker/Core получает их через безопасное сообщение. Исходная причина сохранена в цепочке cause внутри процесса. Команда, аргументы, вывод и настройки пользователя в сообщение не попадают; ошибочный JSON получает фиксированный текст без фрагмента ответа.

Изменены только два согласованных метода [zapret-manager.js](<C:/Users/Egoist/Desktop/Проекты/Приложения/Egoist Lagom/src/recovered/electron/ipc/zapret-manager.js:2253>). Таймауты, повторы, окружение, владение службами и worker/Core protocol прежние.

[Новый regression](<C:/Users/Egoist/Desktop/Проекты/Приложения/Egoist Lagom/tests/zapret-query-diagnostics.test.mjs>) использует только собственные harmless Node children. До изменения: 1/7 PASS, 6 FAIL, exit1. После: 7/7 PASS, exit0, 495.6971 мс. Проверены реальный exit7, остановка собственного child по 200 мс budget, ENOENT при отсутствующем fixture executable, ограничение вывода 1 MiB, успех, безопасный parse error и неизвестные строковые поля. Cause и реальный PID сравниваются с исходным execFile результатом.

Совместно с четырьмя существующими Zapret/network файлами: завершённый TAP66/66 PASS, 0 failed/cancelled/skipped, 11 463.164 мс. Отдельный process-exit receipt для этого общего запуска не сохранён; у самостоятельных семи групп exit0 подтверждён отдельным receipt. diffcheck=0.

Source SHA256: `142367C88F2697AE1F9D95AB320CEE7938AD8BB7F07393CA21EEC4FB97ECCFE2`. Test SHA256: `A2D8E7736637304E3303A6E30FB9BA6A048E83CA07BC13BDC4B942771D0B1A77`. Точные receipts и hashes находятся в соседнем JSON. Production/test заморожены.

Счётчики для Buffer означают исходную длину; для строк — размер UTF8 представления уже декодированного результата API. Это не гарантия идентичности исходной кодировки pipe. kind=terminated не выдаётся за доказанную причину CIM: следующий настоящий SYSTEM запуск должен показать код, сигнал, killed и измеренную длительность. [Контракт Node execFile и его child/error описан в первичной документации](https://nodejs.org/download/release/v24.19.0/docs/api/child_process.html#child_processexecfilefile-args-options-callback).

Новый hosted SYSTEM запуск, сборка и подпись относятся к дальнейшей интеграции родителя. Локальная A/B проверка WinPS уже показала успех обеих сред, поэтому whitelist не расширен. releaseReady=false; первопричина hosted CIM остаётся открытой.
