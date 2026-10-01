# Состояние готовности 3.8.0

Этот документ фиксирует выполненные проверки и условия допуска; он не объявляет новый публичный stable релиз. База — 3.7.9. Исправления и полноценный кандидат 3.8.0 подготовлены на отдельной ветке.

## Приёмка

| Проверка | Наблюдение | Статус |
|---|---|---|
| Сеть/IPC/state | Полный Node-набор с локальными HTTP/TLS и настоящим packaged Xray; отказные сценарии и отмена | 633/633, 0 fail/skip; настоящий installer PlanOnly и packaged Xray |
| Core | 27 групп после исправлений scope/root/bootstrap/clock; свежая production build | PASS |
| Native DoH | 17 групп и read-only CLI на настоящем Windows host | PASS |
| Wrapper logs | 10 групп:144 ротации, native sharing, NTFS ACL, junction paths, предупреждения настоящего Core | PASS |
| Actual packaged Core | Собранный EXE `--self-test`: protocol 1/version 3.8.0 | PASS |
| UI | 24 экран/размер/zoom комбинации,7interactions,10layout/scroll checks и About | PASS в изолированном профиле |
| Renderer recovery | Одна настоящая авария:390 мс до did-finish-load, новый PID; ограниченные повторные попытки отдельно в unit tests | PASS с указанной границей |
| Artifact | Первый installer:201014141B;85payload,276license/inventory,126ASAR build files,8font files | PASS; окончательный source-bound readback отдельно |
| Source companion | 220548158B,144 архива; SHA5e6e0e65…49ff4 | Integrity PASS; coverage неполная |
| npm audit | 0 известных уязвимостей в npm-охвате | PASS в проверенной выборке |
| CI definition | actionlint,17PowerShell-блоков и whitespace owned-code check | PASS локально |
| Hosted CI | GitHub Actions на финальном PR | Tool resolution исправлен; следующая fixture cleanup race воспроизведена/исправлена; результат следующего run в final receipt |
| Windows install/reboot | Чистая установка, upgrade, rollback/uninstall и boot на отдельной ОС | Не выполнено для 3.8.0 |
| Long soak | RSS/handles/threads/disk/network transitions72 ч, затем 7–14 дней pilot | Не выполнено |
| Installed connected UI | Новая installed3.8 connected/foreground/DPI/FPS acceptance | Не выполнено |
| Dependency maintenance | WinSW/log4net2.x EOL; vulnerable XML layout path не используется | Открыто |
| Native source/build | Весь Chromium/sysroot/toolchain/transitive inventory и byte correspondence | Открыто |
| Windows publisher | Authenticode certificate | Отсутствует |

Числа первого installer приведены только как свидетельство завершённой упаковки. Окончательный EXE после финального commit определяется `dist/package-integrity.json`, а не этими промежуточными числами. Финальный машинный receipt хранится рядом с артефактом.

## Практическое поведение

Установленные Core/SystemDoH/Telegram/Zapret запускаются Windows независимо от GUI. Supervisor действует по сохранённому намерению, ownership и readiness; ручное выключение и Disabled имеют приоритет. Блокировки maintenance не требуют перезапуска службы. Все проверки новой версии здесь не означают, что новые службы уже установлены на машине владельца.

Проверка обновлений и текущий VPN/TUN требуют работающего приложения, в том числе в трее. Для 3.7.8/3.7.9 сохраняется подписанный путь обновления. 3.7.7 и ранее требуют ручной миграции доверия; отсутствующий прежний private key не заменяется обходом проверки подписи.

После UI-приёмки собственный процесс кандидата закрыт настоящей кнопкой X. Установленные службы 3.7.9 остались Running/Auto с прежними PID; пользовательское окно и DNS-настройки сохранены.

## Почему stable не объявлен

Новый публичный stable с обещанием непрерывной работы месяцами нельзя обосновать несколькими минутами лабораторий. Следующий проверяемый шаг — отдельная Windows-матрица и 72 часовой soak, затем pilot. EOL service wrapper и полная source/build coverage требуют отдельного решения и подтверждения.

Сборка Core имеет 141 унаследованное предупреждение компилятора; они не считаются исправленными по успешному build. Восстановленный renderer остаётся монолитом. [План](production-plan.md) предусматривает постепенный перенос модулей, устранение предупреждений с behavioural checks и поддерживаемый service host; это будущая работа.

[Содержание аудита](README.md), [дизайн-система](../../DESIGN.md), [нативные снимки/метрики](native-ui-acceptance.md) дают подробности и точные пределы доказательств.
