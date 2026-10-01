# Первая проверка подписанного draft 3.8.0

[Run 36807040747](https://github.com/egoist-ai1/egoist-lagom/actions/runs/36807040747), исходники `9bf77129ccc2aeac741bf109b8ab6c9368fac558`, draft release ID `400603816`.

Обычный Windows test job прошёл, включая Node, Core fault/recovery, полный persistence/crash stress, wrapper integration и установочную безопасность Windows PowerShell. Два установочных jobs остановились на HTTP 404 при получении draft. Сам Setup, ordinary GUI, DNS и TUN в этом запуске **не выполнялись**. Это не результат проверки установленного приложения.

Точный повтор API чтения сохранён в [receipt](signed-native-first-run/receipt.json): существующий draft по release ID возвращается успешно, опубликованный tag endpoint возвращает 404, GraphQL pending tag возвращает тот же ID `400603816`, `v3.8.0`, `isDraft=true`. Полные [fresh](signed-native-first-run/signed-candidate.txt) и [legacy](signed-native-first-run/legacy.txt) логи сохранены с SHA-256.

[GitHub REST contract](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name) определяет tag endpoint как поиск опубликованного релиза. [Официальный GitHub CLI](https://github.com/cli/cli/blob/trunk/pkg/cmd/release/shared/fetch.go) отдельно разрешает pending draft tags через GraphQL. Workflow теперь использует этот путь и требует совпадения точного release ID, tag и draft flag. Проверка подписанных installer/source/integrity bytes остаётся обязательной до установки.

Неудачный кандидат сохранён локально. Следующая сборка получит собственный commit/tree и новые подписанные receipts. Публичный канал и установленная у пользователя 3.7.9 в этом запуске не менялись.
