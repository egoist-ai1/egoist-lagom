# Проверка исходников перед подписанной установкой 3.8.0

1 октября 2026 года. Полный итоговый Node-набор: **855/855 PASS, 0 пропусков, 25.77 секунды**. Сборка main/preload/renderer/component worker успешна. [Receipt](final-source-validation.json) содержит точные raw/LF SHA-256 912 исходных файлов и хеши [полного лога](final-source-node.txt), [сборки](final-source-build.txt) и [18 проверок установочного стенда](final-native-guards.txt). Снимок снят до финального коммита; точный commit/tree самого установщика будет записан в package-integrity.json и подписанной release-manifest.

## Последние исправления

- Настоящий PreInstall отказывал на Windows с активным виртуальным адаптером без DNS client rows. Инвентаризация теперь снимается целиком, отсутствие семейства отмечается явно. После исправления source phase прошла на GitHub-hosted Windows с сохранением DNS, маршрутов, IPv6 и proxy. Неудачный запуск с кодом 41 также сохранён в [before/after evidence](native-first-run.md).
- Обычный установленный GUI получал отказ пяти DNS-обработчиков из-за прежней проверки административного токена. Допуск теперь требует зарегистрированный facade и настоящий authenticated Core hello с PID текущего GUI. Отказ или неизвестная Core блокируют snapshot и teardown; прямого production fallback нет. [58 проверок и границы](ordinary-core-operations.md).
- Правила доменов/процессов сохраняются через узкий CAS endpoint с disk-first подтверждением. Plain/domain: сопоставляют границу DNS-метки, full/keyword/regex сохраняют разные значения. Неподдерживаемые правила и ошибка проверки движка отклоняются до остановки действующего соединения. Реальные Xray и sing-box получают новую preflight-конфигурацию через stdin; новый credentials-файл не создаётся. [Контракт](rules-contract.md), [76 focused и 6 backward проверок](routing-rule-contract.md).
- В интерфейсе доступны маршрутизация, DNS VPN, TUN и упорядоченные правила. Сохранение настроек и применение фонового snapshot разделены. Диалог сохраняет focus, конфликт ревизии не перезаписывает данные, неизвестное состояние блокирует сохранение. Уведомления больше не перекрывают нижние кнопки при ширине 400 px. [20 состояний, 11 групп взаимодействий и снимки](ui-network-settings.md).
- Старое защищённое `runAfter=false` наследуется новым helper; branded preference не включает приложение обратно. Подтверждены реальные PS7/Windows PowerShell 5.1 файловые сценарии. [Отчёт](legacy-launch-preference.md).
- Установочный стенд использует настоящий medium GUI с пустыми argv и проверенными PID/start time/HWND. DNS и VPN запускаются отдельными процессами до private-fixture/reinstall. Тайм-аут сохраняет ограниченные stdout/stderr и failed receipt после остановки только собственного child; это проверено настоящим зависшим процессом.

## Следующий наблюдаемый результат

Установщик будет собран только из чистого коммита. Подписанный draft сначала получает шесть неизменяемых acceptance inputs. Два независимых Windows jobs проверяют этот **точный подписанный Setup**: fresh installation с ordinary GUI/DNS/TUN/recovery/reinstall/uninstall и old official 3.7.9 helper handoff. Изменить installer, source companion, trust или signed metadata при финализации отчёта нельзя; обновляется только ещё не загруженный validation document.

На момент этого source receipt реальные generated Setup/DNS/TUN/old-helper gates **pending**, `releaseReady=false`. Результат исходников и безопасных стендов не выдаётся за установленное приложение. Все изменения физического SCM/DNS/Tasks/registry — 0.

## Пределы

Аварийная CI-страховка никогда не считается штатным успехом. Native gate требует настоящего GUI reset/OFF и возврата baseline. Тест TUN использует управляемый loopback SOCKS endpoint и настоящий отдельный TCP probe: он проверяет локальный TUN/runtime, а не доступность чужого VPN-провайдера. Native DNS gate отдельно фиксирует policy, cache-bypassing Windows query и ограниченные TLS captures; зашифрованный payload не читается.

Реальная перезагрузка, Windows 10 local resolver, WinDivert на контрольном маршруте runner, отсоединение адаптера/DHCP, custom-hostname rotation и 72-hour/7-day/month pilot не выполнены. Для 3.7.8 нужен отдельный native old-helper результат; минимальная версия и действующая цепочка доверия сами по себе его не заменяют. Для 3.7.7 без принятого старого private key нужна однократная ручная миграция. Подпись не отключается. Многомесячная бесперебойность не объявляется результатом коротких стрессов.

Ранее полученные Core persistence/crash, native job/ACL и UI performance результаты сохраняют свои исходные scopes и hashes в соседних отчётах. Сборка Core имеет 137 предупреждений и 0 ошибок; предупреждения не объявлены устранёнными. Установщик не имеет Authenticode; Ed25519 подписывает метаданные обновления и связывает точные installer/source/integrity bytes.

GitHub ограничивает видимость draft releases участниками с push access ([официальный контракт](https://docs.github.com/en/rest/releases/releases#list-releases)). Только вручную запущенные signed acceptance jobs имеют соответствующий `contents:write`; private signing key остаётся локально. Обычные проверки и unsigned candidate job сохраняют read-only разрешение.
