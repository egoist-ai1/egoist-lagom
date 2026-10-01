# Общая интеграция и обслуживание служб

## Установка и обновление

Новый helper использует bounded legacy handoff: код 54 сообщает о старой stage, новый embedded helper ожидает освобождения прежнего deferred lease и завершения точно установленного watchdog. Код 62 завершает старый worker после восстановления прежних служб/DNS. Новый worker делает собственный snapshot и preflight. Содержимое старого неаутентифицированного backup не становится доверенным input. Неизвестный результат не разрешает опасную очистку.

При restore Runtime/Vpn и Runtime/TelegramProxy сначала получают полный DACL SYSTEM/Administrators, затем Robocopy копирует данные без замены destination ACL. Конфигурация Service/Vpn сохраняется при upgrade. Полный uninstall удаляет именно этот подкаталог только после подтверждения отсутствия EgoistShieldVpn; соседние файлы и компоненты не удаляются этим правилом.

Wait-OwnedVpnReady использует фиксированный packaged Core --vpn-service-status, ограниченный output/time, собственное serviceName, observed, SCM Running, localHealth responsive, SOCKS 10838 и положительный PID. SCM Running без этого не считается восстановленной службой.

Таймеры worker/watchdog и readiness используют Stopwatch. Длительность, выведенная из сохраняемого UTC deadline, сначала ограничена утверждённым бюджетом; изменение системных часов не продлевает работу бесконечно.

AutoStart GUI не включает autoConnect. Миграция совместимости удаляет только RUNASADMIN у подтверждённого canonical GUI и сохраняет остальные flags. Новая сборка имеет asInvoker manifest.

## Координация и закрытие GUI

Main создаёт VpnServiceManager, направляет privileged операции через Core и подключает background facade к VpnManager. Preload содержит пять фиксированных методов; install принимает точный ID выбранного сервера. Worker имеет необходимые native-runtime-trust imports и production schemas.

GUI shutdown вызывает shutdownApplicationRuntime. Неизвестная или включённая фоновая служба сохраняет Zapret suspension. Public disconnect действительно выключает фон через Core и проверяет Stopped + Disabled, а не просто завершает GUI child.

VPN inspector сохраняет traffic-route/dns-verify/zapret-suspend, пока фон потенциально запускается. Фоновый SOCKS не владеет Windows system-proxy или GUI kill switch. Service transitions могут управлять steady Zapret suspension только при владении zapret-suspend; параллельная активная Zapret mutation по-прежнему исключена. Это не зависит от elevated GUI token: права реальной операции проверяет Core.

Координатор ограничивает pending mutations 128, plans 64/5 минут. Cache, ожидание и истечение используют elapsed clock. Диагностические apply/rollback без исполнителя возвращают неподдерживаемое действие; verification остаётся skipped.

## Проверки и ограничения

- Полный Node-набор: 797/797 без пропусков; desktop main/preload/renderer/worker build PASS.
- Дополнительные 45 coordinator/module/lifecycle checks PASS, включая конфликт включённой неготовой службы и live Zapret mutation.
- Layout regression проверяет 26 условий, включая dist/generation и updates paths, изменение bytes, traversal/ADS/absolute refusal, preservation compatibility flags и конечные watchdog budgets.
- VPN preservation regression проверяет 17 условий. Собственные файловые copy/remove выполнены; ACL/status/SCM boundaries контролируемые, фактические изменения ACL/SCM этим тестом не выполнялись.
- Legacy regression использует production AST и собственные Windows mutex/processes. Реальный старый updater с новым подписанным пакетом проверяется отдельно.
- actionlint 1.7.12 завершился exit 0. В workflow добавлены frozen Core persistence stress и opt-in native acceptance. Нативная приёмка запрещена на физическом host до какой-либо мутации.
- Signed legacy acceptance вынесена в отдельный одноразовый Windows job. Signed manifest связывает sourceCommit и точные integrity bytes; 10 release-metadata tests и 5 legacy guards PASS. Приватный ключ не передаётся runner. Предварительная проверка draft не доказывает public latest-feed discovery.

Это source/lab evidence. Fresh install, actual ordinary-token GUI, recovery task execution, 3.7.9 transition, reboot и продолжительный pilot нельзя подменять им.
