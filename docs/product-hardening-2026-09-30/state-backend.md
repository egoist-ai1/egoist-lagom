# Сохранение состояния, подписки и приватность диагностики

R02, backend R06, R09 и backend R20 исправлены в исходниках кандидата 3.8.0. Установленная и публичная 3.7.9 этим этапом не менялась.

## Изменённое поведение

- **R02.** Состояние возвращает `stateRevision`, сохранённый вместе с данными. Полный `state:set` требует ревизию снимка и отвергает устаревшую замену до изменения Windows login item. Настройки применяются через `state:patch-settings`, выбор/избранное/удаление сервера — отдельными командами к свежему состоянию. Rename/delete подписок больше не используют `get()+set()`.
- **R02.** Запись, login sync и rollback выполняются внутри одной очереди. Память и ревизия публикуются после подтверждённой записи. Ошибка записи или login sync возвращает явный отказ; конфликт возвращает актуальное состояние. `save()` использует ту же очередь. Обычная загрузка восстанавливает сохранённую ревизию; это не межпроцессная блокировка файла.
- **R06.** `subscription:delete-by-id` удаляет только подтверждённый ID и его узлы. Старый URL API совместим, но связывает цель с ID до ожидания очереди. Завершившийся старый refresh не возвращает удалённую подписку и не применяет её квоту к новой подписке с тем же URL.
- **R09.** В диагностике и центральных JS логах скрываются нестандартный DNS path, query/hash/userinfo, URI и поля с credentials. Scheme/host/port, точный стандартный `/dns-query` и безопасные error codes остаются. Скрываются quoted/неполные assignments и незавершённые/длинные PEM блоки. Глубокие структуры и циклы в логах имеют явные placeholders; полезное поле `security` не принимается за URI.
- **R20.** Подключение щита сохраняет профиль Zapret; пользовательские `autoStart/startMinimized/minimizeToTray` не изменяются этим callback.

## Контракт renderer/preload

| Метод `window.egoistAPI` | IPC | Результат |
| --- | --- | --- |
| `state.patchSettings(patch, expectedRevision)` | `state:patch-settings` `{patch, expectedRevision}` | `{ok, conflict, revision, state, error?}` |
| `node.select(id)` | `node:select` `{id}` | актуальное состояние |
| `node.setFavorite(id, favorite)` | `node:set-favorite` `{id, favorite}` | актуальное состояние |
| `node.delete(id)` | `node:delete` `{id}` | актуальное состояние |
| `subscription.deleteById(id)` | `subscription:delete-by-id` `{id}` | boolean |

Конфликт settings: `ok:false`, `conflict:true`, `error:"STATE_REVISION_CONFLICT"`; ошибка записи/login sync: `ok:false`, `conflict:false`, `error:"STATE_WRITE_FAILED"`. `revision` соответствует `state.stateRevision`. UI читает актуальное состояние и сообщает конфликт; автоматического полного сохранения старого снимка нет. Безопасные IPC settings patches содержат только известные поля и требуют revision.

## Проверка

Сначала сохранён [исходный отказ](state-before.txt): 16 сценариев не проходили, включая отсутствие новых APIs. Это не число независимых пользовательских инцидентов. После исправления [25/25 проходят](state-after.txt): 19 новых случаев и шесть прежних StateStore tests, 0 fail/skip/cancel.

В 30 пакетах из 120 interleaved acknowledged commands сохранены 30 узлов, 30 подписок и 30 history records; ревизия выросла ровно на 120, фактический файл равен memory readback. Проверены stale whole snapshot, явный settings conflict, node select/favorite/rename/delete, одновременно выполняемые независимые изменения, disk/login failure, удаление второго ID и late refresh с новой подпиской на том же URL.

Настоящая `exportDiagnosticsBundle` создала архив штатным Windows `Compress-Archive`. Все пять entries прочитаны native ZIP reader: восемь synthetic sentinels отсутствуют; исходная конфигурация и лог сохранились. В отдельном [сравнении настоящего logger hook](state-logger-before-after.json) старый код оставлял bare/deep credentials и не сериализовал цикл; новый скрывает их и сохраняет пригодный JSON. Проверены оба export catch пути. Восемь source files проходят `node --check`; `git diff --check` без ошибок.

Проверки использовали собственные NTFS/ZIP файлы. SCМ/DNS/Tasks/реальный login item/установленный профиль/пользовательские процессы не менялись; сетевых запросов нет. Менеджеры статуса и login/transport/fetch failure leaves заданы явно в fixtures. Реальное обслуживание служб, reboot без GUI, подпись/updater и месяцы непрерывной работы этим этапом не подтверждены. Windows readback login item и rollback при OS failure нужны в интеграционной проверке. Проверен текущий архив из пяти entries и центральный JS logger; отдельные runtime/Core журналы и любое возможное кодирование credentials не объявляются безопасными.

Подробный receipt с точными SHA256 исходников, тестов и границами — [state-backend.json](state-backend.json). UI selectedSubscription/confirmation и main startup принадлежат отдельным исполнителям; их интеграцию проверяет root.
