Исправление самостоятельного бюджета чтения DNS в текущем 3.8.0, основа 168115e.

В native run 36875880105 DNS boot остановился на общем сборе владельцев через 30 секунд. Telegram владеет отдельным портом; component.query выполняется параллельно его установке. Конкретный исторический blocking provider не установлен: лог не содержал времени отдельных проверок.

OperationDispatcher.cs:1015 теперь ограничивает dns.doh.status отдельным linked budget 20 секунд. Токен передаётся в atomic ownership read, DNS snapshot, DoH registrations, route semaphore и настоящий ProcessRunner. Глобальные 120 секунд PowerShell для мутаций сохранены. Истечение возвращает DNS_DOH_QUERY_TIMEOUT без успешного статуса и без автоматического повтора клиента.

Подтверждённый Missing проверяется перед snapshot: лишний снимок DNS adapters/registrations пропускается, настоящая IPv6 route capability остаётся проверяемой. После route ownership повторно читается: новая конфигурация возвращает DNS_DOH_OWNERSHIP_CHANGED. Corrupt, null JSON, unavailable и неподдерживаемый owner/schema не считаются выключенным DNS. Ошибка либо неразбираемый route result не кешируется как false.

Coordinator добавляет bounded provider IDs, elapsedMs, состояние проверки и стабильные error IDs. Общий timeout сообщает pending provider IDs; медленные, деградировавшие и ошибочные проверки пишут диагностику в main log. Правила владения и взаимного исключения сохранены, произвольные адреса и тексты provider errors в новые строки не копируются.

RED: существующий C# harness собрался с 0 ошибок и воспроизвёл «Missing ownership launched an unnecessary DNS snapshot»; два новых source-extracted diagnostics теста — 0 PASS/2 FAIL. GREEN: native query 5/5 групп, полный существующий NativeDoH/Core harness 22/22 групп, coordinator/network 24/24 теста, 0 FAIL/0 SKIP; git diff --check прошёл. SDK10.0.401, runtime .NET10.0.12; сборка имеет 135 предупреждений и 0 ошибок.

Настоящий собственный Windows PowerShell child с Start-Sleep отменён через тот же ProcessRunner/token при тестовом бюджете 2 секунды: PID27592, cancellationObserved=true, exited=true, elapsed2026ms. Это проверяет прекращение held child; тестовые DNS runners не выполняли настоящие изменения DNS. Fixtures/obj/bin размещены только в runtime текущей задачи. Полный harness дополнительно запустил read-only native listener CLI; unknown результат допускается и не доказывает владельца либо связность.

Исправлен бюджет dns.doh.status; другие providers сохраняют свои бюджеты. Coordinator не выдаёт неизвестное чтение за безопасное состояние. Product Setup, SCM lifecycle и cleanup здесь не запускались. Следующая настоящая disposable native установка/GUI/Telegram/network проверка относится к родительской задаче; релиз и стабильность месяцами здесь не заявляются.

Пять замороженных файлов и SHA256 перечислены в report.json; полный build/test output и actual cancellation receipt лежат рядом.

