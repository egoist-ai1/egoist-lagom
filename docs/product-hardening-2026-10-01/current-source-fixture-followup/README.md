Полный набор исходника ac817bc6a2534aaa47cf21798041d3cfa41bbaca: 982/984 PASS, 2 FAIL, 0 SKIP; неизменность source подтверждена receipt. Этот набор не даёт разрешения на сборку либо публикацию.

Первый отказ — прежний Telegram fixture без process/ProgramData и с ожиданием CIM. Fixture обновлён для fixed native cleanup; строгие проверки отказа и сохранения состояния остаются. Второй отказ — EBUSY при удалении собственного временного NSIS EXE уже после assertions rollback/exit. Добавлен только ограниченный стандартный fs.rm retry: maxRetries10/retryDelay100. Причина временной блокировки не установлена; ни один чужой процесс не завершается и ошибка не игнорируется.

Целевой installer file: 12/12 PASS, 0 SKIP. Production source этих исправлений не меняется. Новый общий commit требует полного source-bound набора и настоящего Windows CI до подписи и native установки.
