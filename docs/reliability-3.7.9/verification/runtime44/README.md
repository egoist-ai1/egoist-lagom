# Проверки Electron 44.4.5

В исходной сборке реальный `Test-InstallRootHealthy` отклонял Electron inventory: путь `../../version` выходил за `resources/runtime`. Provenance перенесён в `resources/runtime/electron/provenance.json`; компонент Electron содержит один файл `electron/provenance.json`. Ограничение installer guard сохранено. Тот же guard после исправления вернул `healthy: true` для каталога сборки `out/EgoistShield-3.7.9-win-x64`.

Проверены размеры и SHA256 всех 72 файлов упакованного Electron runtime и всех 73 файлов исходного cache. Разница — исключённый демонстрационный `resources/default_app.asar`, который заменяется ASAR продукта. Официальный ZIP имеет размер 158184819 байт и SHA256 `11c395820a5aaa8ebcc0686b476d0ac98a730274ebfbdc8cf5538a7c2815cb5d`; digest GitHub asset и официальный SHASUMS256 совпадают. [Официальный релиз](https://github.com/electron/electron/releases/tag/v44.4.5).

Electron health inventory проверяет хеш provenance. Полные хеши runtime и корневой файл `version` сохраняются в package integrity и отдельно проверены в этих receipts. Проверка provenance сама по себе не перечитывает все runtime DLL при каждом health запросе.

Новый packaging preflight запускает только три извлечённые через AST функции реального installer guard и два required-file массива. Он требует строгий Boolean `true`, сверяет абсолютный каталог и хеш исходника, останавливает сборку до NSIS compression при отказе и пишет `install-health-preflight.json` в каталог evidence. Для промежуточного пакета compression уже шла при добавлении gate; эквивалентный read-only preflight отдельно выполнен на готовом payload. Последний пакет с окончательным текстом интерфейса прошёл обязательный gate **до** compression: [реальный receipt](final-precompression-health.json). Весь installer script при этом не исполнялся.

17 scoped tests прошли без ошибок и пропусков. Среди проверок — исходный path escape, абсолютные и относительные пути, изменение/удаление/добавление runtime файлов, небезопасные ZIP записи и порядок health gate перед compression. Эти receipts описывают проверку каталога сборки и cache; установку, состояние служб и запуск интерфейса отражают отдельные отчёты.

- [Исходный отказ](installer-health-before.json)
- [Успешный реальный health check](installer-health-after.json)
- [Полный исходный cache: 73 файла](cache-runtime-inventory.json)
- [Полный упакованный runtime: 72 файла](packaged-runtime-inventory.json)
- [Тесты и хеши исходников](scoped-tests.json)
- [Проверенные факты](verification-summary.json)

Пути в receipts приведены относительно проекта; локальные пути профиля и runtime задачи удалены. `recordedAt` обозначает время записи receipt, `verifiedAt` — время соответствующей проверки.
