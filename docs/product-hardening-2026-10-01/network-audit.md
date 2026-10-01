**Сетевой аудит Egoist Lagom — 2026-10-01**

Принят участок сетевых исходников кандидата 3.8.0: DNS readiness, проверка маршрута, HTTP CONNECT/TLS замеры, привилегии запуска и переходы между временным VPN и фоновой службой. Итоговый адресный запуск: **56/56 прошли, 0 отказов и 0 пропусков**, 2786.122 мс. Отдельная проверка фонового режима, TUN lifecycle и строгой готовности UI: **27/27 прошли**, 0 пропусков. Syntax проверен у 11 изменённых файлов; `git diff --check` не обнаружил ошибок. Полные журналы и SHA-256 исходников/тестов находятся в [network-receipt.json](network-receipt.json) и [network-evidence](network-evidence/).

Эта приёмка относится к исходникам в рабочей ветке `codex/lagom-production-audit`, базовый commit `5d0d58b44076843e639723ef267e7b8d2605e481`. Кандидат этим запуском не установлен и не опубликован. Сборка, подпись, штатная установка, перезагрузка и нативная приёмка SCM/TUN проверяются отдельно общим процессом релиза.

| Реальная проблема или неоднозначность | Изменение и наблюдаемый результат |
| --- | --- |
| DNS мог принимать ответ с чужим source endpoint, несовпадающим ID/question, некорректной компрессией или неполной записью. | UDP учитывает адрес и порт отправителя. Парсер проверяет ID, QR/opcode/rcode/TC, полный вопрос, IN/A, CNAME цепочку, ограничения имён/указателей и длину всего пакета; циклы и CNAME+A на одном owner отклоняются. |
| Рабочий DNS на localhost мог объявить нашу остановленную/неизвестную службу работающей. До правки регрессия воспроизвела `true` вместо `false`. | Readiness требует одновременно SCM Running и проверенный ответ. `serviceRunning`, `resolutionVerified` и `resolverIdentityVerified` разделены; принадлежность resolver остаётся неподтверждённой. |
| Проверялась только UDP готовность DNS. | Добавлен DNS over TCP с фрагментированной length-prefix рамкой, exact ID/question и абсолютным deadline. Локальная готовность требует UDP и TCP; ошибка одного отменяет другой. |
| Повторный sample одной TUN цели мог выглядеть как полное покрытие маршрута. До правки `partial` возвращался вместо `inconclusive`. | Нужны два различных фиксированных control destination, matching interface и IPv4 prefix, который включает destination. Отсутствие actual route observation остаётся `inconclusive`. |
| Совпавший public IP или внешний recursor ошибочно давали вывод о bypass/защите. | IPv6 адреса нормализуются; разные семейства IP и общий exit не доказывают bypass. External recursor — наблюдение. Даже совпадение ожидаемого recursor не доказывает управление DNS всех приложений. |
| Перевод системных часов или поздний ответ старого runtime мог продлить готовность. | TTL/deadlines используют monotonic time. Старые DNS generation не перезаписывают новые, egress привязан к runtime instance; background proof истекает через 60 с monotonic time. |
| CONNECT drip мог продлевать inactivity timeout; отмена могла оставить ресурсы. | Отдельный absolute handshake budget и общий cleanup. Запрос, socket, listeners и timers освобождаются при ошибке/отмене. |
| HTTP framing мог засчитываться в скорость, а лишние bytes после Content-Length принимались. До правки TLS регрессия не получила ожидаемый отказ. | Скорость считает decoded payload; chunk extensions/trailers и Content-Length обрабатываются строго. Malformed/truncated/ambiguous/excess framing не даёт завершённого sample. Shared data reservation освобождается во всех выходах. |
| Цифры 401/403 в порте или адресе могли отключить reconnect. | Авторизационная ошибка требует структурированного HTTP status, а не совпадения цифр в произвольной строке. |
| Отказ нативной проверки токена превращался в cached false. | Ошибка остаётся Unknown/fail closed и повторяется при следующей проверке. Успешный ordinary-user result можно кешировать. Проверенные runtime lease/environment передаются при запуске. |
| GUI shutdown мог выключить установленную фоновую VPN службу, а временный TUN — конкурировать с ней. | `shutdownApplicationRuntime()` завершает только собственный временный child/config. Background intent/SCM не меняет; при Unknown сохраняет suspension policy. Временный запуск требует наблюдённого Stopped+Disabled, отключённого intent и unresponsive фонового listener. Foreign/orphan listener не завершается принудительно. |
| Service IPC мог принять произвольный privileged config либо объявить успешную остановку без readback. | Пять строгих IPC. Установка принимает только ID существующего выбранного node, backend снимок settings/rules и проверку перед teardown. После install/start/stop/remove обязателен fresh actual status; неизвестное состояние запрещает mutation. |
| Неудачный `service-start` оставлял Zapret suspended. До правки новая регрессия воспроизвела отказ. | После install/start failure прежнее временное подключение либо Zapret восстанавливается только при подтверждённо inactive службе. При Unknown/конфликте второй runtime не запускается и статус не выдаёт успех. |
| Packaged runtime мог прочитать переменные тестового mock. | `app.isPackaged === true` запрещает mock независимо от NODE_ENV/VITEST/EGOISTSHIELD_MOCK_RUNTIME; packaged process также не пишет debug credentials из env. Negative case прошёл. |
| Watchdog оставлял power wake listeners после закрытия GUI. | Before-quit прекращает новые schedule и удаляет resume/unlock handlers; уже начатый bounded probe завершается в пределах своего timeout. |

**Фактические стресс проверки на собственных loopback peers**

| Нагрузка | Измеренный исход последнего запуска |
| --- | --- |
| UDP DNS: 256 вопросов, 1536 peer пакетов, из них 1280 foreign/malformed/mismatched/cyclic | 256 корректных результатов; собственных client sockets осталось 0; 527.125 мс. |
| UDP/TCP DNS отмены | 64/64 отменены; client UDP и server TCP sockets осталось 0. |
| CONNECT drip при budget 70 мс | Завершился через 80.396 мс с учётом планировщика/cleanup; server sockets осталось 0. Это измерение, а не обещание жёсткой real-time границы. |
| Stalled CONNECT отмены | 64/64 отменены; client/server sockets 0; 152.682 мс. |
| TLS: 80 запросов | 48 completed, 16 malformed rejected, 16 cancelled; decoded 48000 B, used budget 48800 B включая полученные перед отменой bytes; reserved 0, server sockets 0; 264.653 мс. |

TLS peers используют собственный CA с включённой проверкой сертификата. UDP/TCP/HTTP/TLS транспорт здесь реальный. Проверка GUI exit запустила и завершила собственный безвредный Node child и удалила его actual NTFS config. Служебная граница SCM в этих IPC тестах контролируется fixture: она проверяет порядок действий/контракты и не доказывает штатную установку Windows службы.

В ранних нагрузочных запусках тестовые TCP/HTTP серверы оставляли half-open peer socket из-за непрочитанных данных/default allowHalfOpen. Исправлен именно стенд: данные потребляются, peer завершает FIN, клиентские сокеты учитываются отдельно. Эти ранние отказы не объявлены утечкой продукта. Ранний общий запуск имел 115/116: единственное оставшееся UI ожидание разрешало undefined DNS verification. Владелец UI исправил это ожидание; текущая отдельная совместная проверка 27/27 подтверждает строгую готовность.

**Воспроизведение**

Выделить короткий временный каталог для текущей задачи и передать `LAGOM_TEST_TEMP`, `LAGOM_DNS_TEST_WORK`, `LAGOM_DNS_TEST_PYTHON` (Python с cryptography либо вместо Python `LAGOM_DNS_TEST_OPENSSL`) и `LAGOM_NETWORK_EVIDENCE_PATH`. Запуск из корня выбранного проекта:

```powershell
node --test tests/production-network-protocols.test.mjs tests/production-vpn-background-integration.test.mjs tests/admin-runtime.test.mjs tests/vpn-runtime-selection.test.mjs tests/vpn-tun-lifecycle.test.mjs
node --test tests/production-vpn-background-integration.test.mjs tests/vpn-tun-lifecycle.test.mjs tests/ui-service-readiness.test.mjs
```

Без TLS prerequisites тест сообщает skip: такой запуск не эквивалентен этой приёмке, где skips=0. Source receipt содержит raw SHA-256 и LF normalized SHA-256 для различения изменения кода и перевода строк Windows.

**Практические пределы**

Этот участок не менял SCM, DNS adapters, task scheduler, registry или реальные TUN routes host. Не выполнялась перезагрузка и не проводился месячный soak. Матрица маршрутов проверяет actual observation inputs, а не все приложения или Windows routing table на чужом устройстве. Public IP, ответ DNS и доступный local port сами по себе не доказывают полного tunnel coverage. Background service — явный opt-in с встроенным pinned sing-box TUN; custom runtime и GUI Kill Switch отклоняются до изменения действующего подключения. Проверка внешнего egress данным GUI watchdog требует работающего GUI; нативное восстановление Core/SCM и фонового runtime имеют отдельные проверки владельца службы. Нет гарантии непрерывной работы провайдера, Windows, сервера или сетевого оборудования месяцами. Устранены воспроизведённые ошибки и ограничены проверенные paths; обещания «идеально» не используются.
