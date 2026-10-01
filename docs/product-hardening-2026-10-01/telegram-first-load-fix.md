# Telegram: исправление первого чтения и установки

UI больше не сохраняет пустые стартовые значения перед установкой Telegram-службы. Конфигурация принимается сразу после Telegram-ответа, независимо от медленного чтения других компонентов. Неизменённый подтверждённый config не перезаписывается перед установкой, запуском или добавлением прокси в Telegram.

Исходная ошибка подтверждена подписанной диагностикой 466: реальный UIA-клик вызвал `telegram-proxy:save-config`, который завершился `_ZodError` по полю `secret`. Принятый [stderr диагностики](native-466862-gui-diagnostic-5086586/diagnostic-gui.stderr.txt) содержит этот отказ. Новая signed GUI/SCM acceptance **ещё не выполнена этим отчётом**; исправление проверено на actual source callbacks и настоящих схемах/IPC handlers с явно изолированными fixtures.

## Что изменилось

- В `src/recovered/renderer.js` один исходный TG-status Promise участвует в обычной пачке и отдельно публикует Telegram-наблюдение. Поздняя пачка больше не принимает TG-config повторно. Сохранены общий generation fence и дополнительный TG sequence: старый успешный ответ не отменяет более новый отказ.
- Поллинг UI приостанавливается на время операции `telegram-sidecar` или отдельного чтения TG-конфигурации. Иначе эффект смены «занято» мог запустить новую пачку и отменить preflight той же установки. Это пауза наблюдения UI; Windows-службы не останавливаются.
- Lifetime cleanup инвалидирует generation/sequence. Закрытый UI не начинает новые статусные чтения и не принимает поздние результаты текущих.
- В `Ep` install/start/open и редактирование проверяют свежесть и полную допустимость конфигурации, а также pending/conflict. Проверка выполняется и в кнопке, и в callback. Неизвестная, устаревшая или неполная конфигурация не превращается в default config для записи.
- Добавлена обычная кнопка **«Перепроверить конфигурацию»**: она вызывает настоящий status API, показывает pending/причину отказа и не выполняет save/install. Стиль и существующие имена основных кнопок сохранены. Native UIA должна дождаться enabled для установки.
- Pristine-конфигурация проходит свежий preflight и используется backend без `saveConfig`. Dirty-черновик проверяется, сравнивается с последним config, сохраняется один раз и проверяется по ответу и повторному чтению. Rejected-save, `{ok:false}` и несовпавший readback прекращают установку, сохраняя черновик. Явные варианты разрешения конфликта сохранены.
- Во время async-операции поля недоступны, обработчики защищены ref-lock: старое сохранение не очищает новую правку. Пустое/неверное значение не подменяется старым secret молча.
- Известную работающую службу можно остановить, а установленную удалить без наличия secret. Это не зависит от готовности listener. Cached autostart не окрашивается зелёным при unknown/stale observation.
- `src/brand/ShieldWidget.jsx` содержит чистую проверку config по действующему пересечению IPC/manager-контрактов: loopback, порт 1024–65535, 32 hex secret, DC 1–5 с настоящим IP, буфер 64–4096, пул 1–32, лог 1–100 и оба boolean-параметра. Backend, IPC, порт 1443, main, CI и конфигурации служб не изменены.

## Проверки и пределы

[Новый тест](../../tests/telegram-first-load.test.mjs) извлекает настоящие `Ep`, `v2/y2`, read/retry callbacks, polling/lifetime cleanup и `S2`, выполняет действующую строгую схему и actual IPC handler. Native manager side effects заменены счётчиками и состоянием fixture; валидация manager извлечена из production. React hooks/JSX представлены минимальным VM-adapter. Это проверка логики, а не native GUI/IPC privilege/SCM evidence.

Final targeted: **47/47 PASS**, 19 новых +28 существующих, 0 skipped, 304.0813 ms. Покрыты delayed/rejected/stale/malformed config, раннее принятие до конца пачки, реальный read-only retry, pristine/dirty/save rejection/readback conflict, повторная операция, остановка/удаление без config, старые ответы, смена generation, busy polling и unmount. [Полный лог](telegram-first-load-fix-tests.txt).

Проверка чувствительности: **4/4 FAIL на исходных frozen UI-файлах**, именно по раннему чтению, disabled при delayed/rejected и лишнему pristine-save. [Лог исходной версии](telegram-first-load-fix-original-negative.txt). Отдельный **source-only negative fixture**, полученный из итогового исходника отключением лишь lifetime/poll guards, даёт **2/2 FAIL** по обеим гонкам; [лог](telegram-first-load-fix-guards-negative.txt). Процедура, контрольные суммы и точные преобразования fixture находятся в [receipt](telegram-first-load-fix.json). Negative fixtures не входят в production и ничего не эмулируют в настоящем приложении.

`node --check src/recovered/renderer.js` и `git diff --check` завершились с кодом 0. Точный [production diff](telegram-first-load-fix.diff) меняет только два UI-файла; новый тест и этот отчёт добавлены отдельно. Тесты не запускали приложение/браузер и не меняли native SCM/DNS/registry/tasks. Предыдущие screenshots/performance receipts остаются исторически привязанными к своим source hashes.

Финальный renderer LF SHA-256: `947836bac950728a674bdc35fede32a03d7eb2bcfbaaf2019c061235704852f4`. Все raw/LF hashes, файлы и результаты — в JSON receipt.

Preflight/readback не добавляет атомарный CAS к существующему TG-config API. Независимая внешняя запись между чтением и сохранением остаётся возможной; несовпадение при readback требует повторения и явного разрешения конфликта. Подписанная fresh GUI/SCM acceptance, полная suite/build и длительная эксплуатация выполняются отдельно родителем. Native GUI PASS, отсутствие всех возможных конфликтов и месяцы непрерывной работы этим UI-fix не заявляются.
