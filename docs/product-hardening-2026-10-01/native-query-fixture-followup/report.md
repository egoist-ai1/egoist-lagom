# Проверка старого Telegram fixture после native schema v2

**Заморожено:** изменён только `tests/telegram-native-listener.test.mjs`, база `15aea7863c8bfaa59fec2ac8c68924ef46ad12a7`. Производственные шесть native/manager файлов и существующий `native-process-query.test.mjs` совпадают с этой базой при нормализации LF. `git diff --check` PASS. Diff: 81 вставка, 24 удаления.

До изменения отдельный RED воспроизвёл ровно **7 отказов: 11/18 PASS**, exit 1, **1107.4326 ms**. После изменения два focused файла: **30/30 PASS**, exit 0, **2827.0225 ms**, 0 skipped. Это 21 Telegram fixture test и 9 native tests. Новый запуск настоящего EXE/API включил **21/21 проверку**. Компиляция: **0 ошибок, 136 предупреждений**, 00:00:01.74; весь исходный compiler log сохранён без подавления.

## Подтверждённая причина

Fixture возвращал schema v1 без обязательных в v2 root birth, согласованных внутренних SCM headers, parent PID, executable path и owner/root creation times. Валидные сценарии отвергались до проверки своих условий. Десять mutation negatives могли выдавать ложный GREEN, потому что уже первый неизменённый ответ был невалиден и второй не читался. Тест standalone также ожидал удалённый PowerShell маршрут. Production не изменялся ради этих ожиданий.

## Сохранённые и усиленные проверки

- Service readiness по-прежнему требует два свежих native чтения с общим deadline, canonical EXE, точными fixed CLI arguments, windowsHide и buffer limit.
- Foreign IPv6/PID/name и отказ pending-to-running остаются обязательными; оба native чтения теперь содержат полноценные foreign metadata и TCP rows. `calls===2` соответствует текущему контракту двух доказательств.
- Explicit IPv6 теперь проверяется на фоне чужого IPv4: ошибочный выбор семейства не может дать PASS.
- Saved standalone PID/birth guard переходит на два native доказательства с точными paired arguments и одобренным runtime-путём; owned/PID ожидания сохранены. PowerShell fallback не допускается.
- Missing fixture содержит действительно пустой список TCP endpoints; открытый по отдельной проверке порт всё ещё даёт unknown/ready=false.
- Все mutation negatives обязаны принять первое валидное состояние и дойти до второго ответа (`calls===2`). PID reuse меняет согласованные времена, чтобы проверить изменение идентичности между чтениями.
- Добавлены три отрицательных случая: obsolete schema, противоречивый SCM snapshot, отсутствующая ancestry. Ошибка CLI всё ещё остаётся unknown без owner PID/name и без fallback.

[RED](red.txt), [GREEN](green.txt), [compile](compile.txt), [настоящий native EXE/API результат](actual-native.txt), [исходный fixture из базы](telegram-native-listener.before.mjs), [точный diff](fixture.patch) и [машиночитаемый отчёт](report.json) содержат исходные результаты и hashes.

SHA-256 изменённого файла: `700d78d511fb597edb1dcd31617848da1f3993c6be0996b5896c350030e5dc7e`. SHA-256 исходного Git blob: `dfd1c45cab2829d0c64e53a2be5ef917e6c46581fa622d74cf73d56a6dea99b6`.

Настоящий probe использует только свой harmless child с эфемерными loopback IPv4/IPv6 endpoints и запускает production fixed CLI через изолированный EXE. Единственный локальный замер: WinWS CLI **110.6176 ms**, Telegram **120.2798 ms**; это не SLA/benchmark. SYSTEM SCM root обычному токену всё ещё недоступен: available=true/stable=false/unknown; stopped-SCM classifier остаётся явным inert fixture. Никаких физических SCM/DNS/registry/GUI изменений, установки, подписи, публикации или повышения привилегий не было. Ограничение первого SDK welcome про создание/повторное использование certificate остаётся в предыдущем native-query-analysis; certificate-store действий не выполнялось.

Полный source-bound набор и окончательный sealed candidate проверяет parent после commit; эти 30 тестов не доказывают здоровье установленной службы или месяцы непрерывной работы.
