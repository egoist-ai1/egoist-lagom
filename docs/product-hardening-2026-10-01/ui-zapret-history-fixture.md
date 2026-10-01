# Дополнение: окружение теста истории Zapret

Изменён только `tests/zapret-history.test.mjs`: VM-окружение реального извлечённого callback теперь получает `readGeneration` и `updateRevision` с `current: 0`, как `useRef(0)` в компоненте. Проверки истории, отмены и ошибок сохранены. Runtime UI не изменён; все 11 исходников и harness совпали по LF SHA-256 с `ui-receipt.json`.

До исправления: 8 из 9 тестов, exit 1; отсутствующая `readGeneration` вызывала ReferenceError до запуска callback, поэтому `finish` не устанавливался. После исправления: 9 из 9, exit 0, без пропусков, 177.4317 мс. Команда: `node --test tests/zapret-history.test.mjs`; временные файлы направлены в runtime этой задачи.

Хеши исходников и журналов: [receipt](ui-zapret-history-fixture.json). Полные журналы: [до](ui-zapret-history-before.txt), [после](ui-zapret-history-after.txt). Это проверка извлечённого production callback и файловой истории, а не подтверждение работы установленных сетевых служб.
