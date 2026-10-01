# Настоящая Windows-приёмка 9617624: отказы

Запуск 36856686510 проверял точный подписанный Setup SHA256 d77eb1b2ecac06df191cf2953653213377068beaaa3b0e447297e17f468b026c из unpublished draft400907438. Все три установочных job завершились отказом; публикация и физическая установка не выполнялись.

Fresh Setup установился и настоящий GUI дошёл до telegram-proxy:install-service. Ошибка пустого secret больше не наблюдалась. Установка службы отменена, поскольку владелец порта не был проверен. Отдельная диагностика WinWS показывает настоящий PowerShell timeout12s/SIGTERM, 0stdout/0stderr; причина SYSTEM-исполнения ещё требует проверки.

Оба восстановленных оригинала прошли полные payload/readback и original Core registration с настоящим SCM, result baseline-ready. Старые GUI 3.7.8 и3.7.9 завершились с GPU process launch error18 и FATAL GPU isn't usable, до helperhandoff. Original clean Setup не выполнялся. Это не успешное обновление и не доказанная неисправность новой версии.

RawZIP, журналы job, GUI/SCM/metadata receipts и их хеши сохранены. [Машинный отчёт](summary.json).
