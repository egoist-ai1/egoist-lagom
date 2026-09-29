# Аудит Egoist Lagom 3.8.0

30.09.2026. База — публичная 3.7.9, commit `d56eb9327fa75a88e91fae62b8d7ea3ed095dcf2`; работа — `codex/lagom-production-audit`. Публичная версия и настройки владельца сохраняются.

## Реализованные изменения

| Контур | Результат |
|---|---|
| Сеть | Deadline полного HTTP body, ограничения размера, строгая IP-проверка, отменяемый backoff, освобождение собственных sockets |
| Адреса/статус | Точные server/URI/SNI без скрытой подмены; отказ при потерянном explicit ID; unknown SCM отдельно от stopped; фактическая версия |
| Core | Scope до replay/cache, отказ запуска из неподтверждённого protected root, согласованный bootstrap query, scheduling после обратного скачка часов |
| Длительная работа | Три точных wrapper logs: порог 5 MiB, один предыдущий архив, reparse/ownership guards, отсрочка lock без остановки службы |
| Renderer | Ограниченный recovery controller; тестовый профиль не изменяет production DNS и автозапуск |
| Installer | Fail-closed принадлежность и PE/manifest version; разные refusal/handoff exit codes; проверенная замена сохранённых WinSW с rollback; Framework 4.8 preflight |
| Обновления | Подписанный remote registry, отзыв ключей, authenticated cache/rollback floor; повреждённое доверие не обходится fallback; cleanup download |
| Упаковка | Единые pins и ZIP inventory, чистый commit/tree, свежая desktop build, native-source companion, лицензии и точный SDK |
| UI | Manrope/Unbounded/mono, ясные ошибки и unknown traffic, keyboard tabs, постоянные descriptions/help/Escape; исправлены наложения 200% |
| CI | Явные TLS tools и реальные Core/DoH/log tests; opt-in unsigned package; postpackage проверки до upload |

Изменения опираются на воспроизведения. Установленные DNS/Telegram/Zapret службы обслуживаются независимо от окна; ручное выключение сохраняет приоритет. GUI нужен для текущего VPN/TUN и проверки обновлений приложения.

## Подтверждение

Общий Node-прогон с настоящим новым пакетом, OpenSSL и packaged Xray: **632 теста, 632 прошли, 0 ошибок и пропусков**. Три реальных installer PlanOnly проверки теперь включены. Свежий `npm audit`: 0 известных уязвимостей в его охвате; это не полный native/transitive аудит.

Настоящий собранный UI: **24 сочетания экран/размер/масштаб**, 7 взаимодействий, 10 геометрических/scroll checks и диалог. Ошибок страницы и горизонтального переполнения нет; исходные вертикальные наложения исправлены. Один настоящий renderer crash восстановился до `did-finish-load` за 390 мс, без оценки первого кадра или многодневного SLA.

Core: 27 групп и Native DoH: 17 групп прошли. Wrapper guard: 10 групп прошли, включая 144 настоящие ротации, ACL, sharing failures и native junction paths; test harness исправлен для PowerShell 7 и длинных путей. Первый source-bound EXE, Core self-test и полный postpackage набор прошли. Окончательный артефакт повторно собирается после последней поправки release SHA contract; его точные хеши находятся в dist/package-integrity.json и dist/production-audit-3.8.0.json.

## Материалы

- [Готовность и оставшиеся gates](readiness.md), [сводная проверка](validation.json).
- [План выпуска, архитектура и следующая итерация](production-plan.md).
- [Принятая дизайн-система](../../DESIGN.md), [направление дизайна](design-proposal.md).
- [Настоящая UI-приёмка и снимки](native-ui-acceptance.md), [UI-аудит](ui-audit.md).
- [Сетевой аудит](network-audit.md), [wrapper logs](network/wrapper-log-maintenance.md).
- [Службы и installer](services-audit.md).
- [Доверие обновлений](trust-audit.md), [WinSW dependency risk](wrapper-risk.md).
- [Упаковка/источники/лицензии](release-audit.md), [CI](ci-audit.md).

## Открытые release gates

Чистая установка/upgrade/uninstall/reboot в отдельной Windows, внешняя VPN/Telegram-доставка, смена сети и длительный soak для 3.8.0 ещё не пройдены. План предусматривает 72 ч наблюдения и 7–14 дней pilot; заявления о месяцах требуют соответствующего времени.

WinSW содержит EOL log4net 2.x. XML log layouts не используются, но это не исправление зависимости. Native-source ZIP содержит 144 архива и подтверждённые inputs; полная transitive corresponding-source/build coverage и идентичная пересборка не доказаны. Поддерживаемая service-host замена и source проверка остаются gates.

Подпись обновлений обязательна. 3.7.8/3.7.9 обновляются при работающем приложении, в том числе в трее. 3.7.7 и ранее требуют ручной миграции: прежний закрытый ключ отсутствует. Windows Authenticode-сертификат издателя отсутствует.

Кандидат и успешные лаборатории не выдаются за готовый публичный stable релиз или гарантию отсутствия отказов.
