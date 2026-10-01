# Проверка смысла правил и предварительного запуска runtime

Проверено 2026-10-01 на Windows, Node 24.19.0. Исправлен конкретный дефект: обычный `example.org` означал подстроку в Xray, но домен с поддоменами в sing-box. До исправления настоящий Xray направлял `notexample.org` по правилу `example.org`. После исправления оба движка направляют `example.org` и `www.example.org` по правилу, а `notexample.org` и `example.org.evil` — по следующему маршруту. Это подтверждено реальными TCP/SOCKS соединениями с собственными loopback серверами, без внешнего DNS.

| Сохранённое значение | Смысл приложения | Xray | sing-box |
| --- | --- | --- | --- |
| `example.org`, `domain:example.org` | Домен и его поддомены с границей метки | `domain:example.org` | `domain_suffix` |
| `full:example.org` | Точный домен | `full:example.org` | `domain` |
| `keyword:needle` | Подстрока | `keyword:needle` | `domain_keyword` |
| `regexp:...` | Регулярное выражение, принятое самим движком | `regexp:...` | `domain_regex` |
| `geosite:...`, непустой `dotless:...` | Только поддерживаемый Xray формат | Токен сохраняется; native check проверяет применимость | Явный отказ до переключения |

Для обычного домена и `full:`/`domain:` проверяются IDNA, длина имени и меток, отсутствие IP/CIDR, URL, пути, звёздочек и неизвестного префикса. Регистр имени и завершающая точка нормализуются. `keyword:` и `regexp:` остаются отдельными условиями. Неизвестный режим не становится автоматически `direct`. Порядок правил сохраняется: процессы перед доменами; VPN, direct и block получают соответствующие действия. Параметры каждого сохранённого массива ограничены 256 правилами и 512 символами значения; API сохранения имеет отдельный структурный и ревизионный [контракт](rules-contract.md).

Смысл исходного Xray подтверждён его [документацией маршрутизации](https://xtls.github.io/en/config/routing.html) и [парсером версии 26.5.3](https://raw.githubusercontent.com/XTLS/Xray-core/v26.5.3/infra/conf/router.go). Раздельные поля sing-box сверены с [документацией](https://sing-box.sagernet.org/configuration/route/rule/) и [точным исходником shipped 1.14.0](https://raw.githubusercontent.com/SagerNet/sing-box/0b8995879f29a9b98ee027bc17b75e101445b238/route/rule/rule_item_domain.go); проверка исполняемыми файлами приведена ниже.

Правило процесса применяется приложением только в TUN. Для общего интерфейса используется точное имя `.exe`; регистр сохраняется, обещания нечувствительного к регистру совпадения нет. Xray сохраняет поддерживаемые абсолютные пути Windows и свои `self/`/`xray/`. sing-box явно отклоняет пути и имена без `.exe`, вместо прежнего молчаливого превращения пути в имя файла. Его [matcher 1.14.0](https://raw.githubusercontent.com/SagerNet/sing-box/0b8995879f29a9b98ee027bc17b75e101445b238/route/rule/rule_item_process_name.go) сравнивает basename фактически найденного процесса. В лабораторном loopback тесте настоящий Windows lookup обоих движков отличил наш `node.exe` от постороннего имени. Этот тест не запускал TUN и не доказывает захват всех процессов через установленный TUN.

`VpnRuntimeManager._connect` обязательно проверяет правила выбранного runtime до очистки handoff, остановки старого TUN и подготовки замены. При наличии действующих правил он использует фактически разрешённый путь движка, строит конфигурацию, исключает TUN inbound из проверки и вызывает проверенный native CLI. Неподдерживаемый токен и неправильное Go regular expression дают отказ с сохранением старой сессии. Дополнительная проверка занимает один native запуск; нулевая задержка или готовность туннеля этим не обещаются. Пустые списки правил этот дополнительный native запуск не требуют.

Новый preflight передаёт конфигурацию только через stdin: Xray `run -test -c stdin:`, sing-box `check -c stdin`. Ранее добавленный `rule_check_*.json` убран: создание, удаление и остаточный файл после аварии отсутствуют. Вход ограничен 1 MiB, вывод 64 KiB, выполнение 15 секундами; штатный verifier lease удерживается до завершения дочернего процесса. Ошибка stdin является ошибкой проверки даже при коде завершения 0; собственный checker отменяется и дожидается завершения. Native stderr и конфигурация не входят в сообщение пользователю. Поддержка stdin подтверждена [загрузчиком Xray 26.5.3](https://raw.githubusercontent.com/XTLS/Xray-core/v26.5.3/main/confloader/external/external.go), [sing-box 1.14.0](https://raw.githubusercontent.com/SagerNet/sing-box/0b8995879f29a9b98ee027bc17b75e101445b238/cmd/sing-box/cmd_run.go) и actual CLI. Его [check implementation](https://raw.githubusercontent.com/SagerNet/sing-box/0b8995879f29a9b98ee027bc17b75e101445b238/cmd/sing-box/cmd_check.go) создаёт и закрывает конфигурацию без `Start`; в preflight дополнительно удалён TUN inbound.

| Проверка | Наблюдаемый результат |
| --- | --- |
| До изменения, шесть проверок mapping | 0/6; неправильная Xray строка, literal prefix sing-box, неверный fallback режима, отсутствующий validator |
| До изменения, настоящий Xray loopback | RED: `notexample.org` получил MATCH вместо MISS |
| Итоговый routing suite и шесть соседних suites | 76/76, 0 пропусков, 6.224 с; из них routing 12/12 |
| Shipped sing-box 1.14.0 + Xray 26.5.3 | 10 принятых и 2 отклонённых stdin CLI конфигурации; 24 проверенных loopback решения в 12 сессиях движков |
| Preflight через оба настоящих CLI | 2 принятия и 2 отказа; старый собственный процесс жив; 0 teardown mutations; 0 операций записи конфигурации |
| Credential sentinel в preflight | Присутствует в stdin; отсутствует в argv и captured native output; checker children завершены |
| Реальный собственный child с незавершённым buffered stdin | Windows EOF при exit 0 даёт checked failure за 1.053 с, старый child сохранён; input больше 1 MiB отклонён до spawn |
| Отдельный backward профиль sing-box 1.13.12 | 6/6 native/loopback/pipe проверок, 0 пропусков, 5.831 с |
| Девять фоновых конфигураций на shipped 1.14.0 | 9 CLI check: VLESS, VMess, Trojan, Shadowsocks, SOCKS, HTTP, Hysteria2, TUIC, WireGuard; без запуска TUN |
| Синтаксис пяти изменённых source/test файлов и `git diff --check` | PASS |

Каждый native исполняемый файл проверяется по размеру и SHA-256 до запуска. Итоговая версия берётся из подготовленного component candidate или итогового каталога out; старый recovery 1.13.12 используется только по явному тестовому флагу. Production код не фиксирует старую версию.

| Проверенный binary | Bytes | SHA-256 |
| --- | ---: | --- |
| sing-box 1.14.0, revision `0b8995879f29a9b98ee027bc17b75e101445b238` | 81819136 | `aad0ede010eafa7b277e520464f3a66fde820103d737eff739f40f3cc9451dcc` |
| sing-box 1.13.12, backward fixture | 44954624 | `64b1dfaed6fa758295233fd0bec8b32cf2115f29773adbf38e0f026c3c7986f2` |
| Xray 26.5.3 | 35819008 | `47f612eff0a553c982a3e2806e54f94bee0639d0f3f0fa11116a11bbd6abda3f` |

Локальный `recovery/native-sources/sing-box-1.14.0-source.zip` действительно совпал с source descriptor: 2840768 bytes, SHA-256 `73dc416c1eb825100dd6f1e300d8805222e9459cbe934b8f9fc8f1e5b510b87b`. Descriptor и actual binary называют одинаковый commit. Это проверка pin и исходного контракта, не доказательство воспроизводимой сборки native binary.

SHA-256 изменённых файлов, соответствующие LF hashes, бинарные pins, команды, отрицательный baseline и полные журналы закреплены в [machine receipt](routing-rule-contract.json) и каталоге [evidence](routing-rule-evidence/routing-final-production-adjacent.txt). Этот receipt заменяет часть старого network receipt, относящуюся к изменённому `vpn-manager.js`; старые доказательства остальных неизменённых сетевых методов сохраняют свой исходный scope.

Границы проверки: recovered классы загружены в Node VM, native доверие preflight fixture задано контролируемой границей, а exe, parser, stdin, TCP и Windows process lookup настоящие. Проверка не меняла физические SCM, DNS, TUN, задачи или registry. Оба маршрута лаборатории завершаются на собственных SOCKS peers; внешний сервер и весь интернет этим не проверены. Сохранившийся GUI running-session `config_*.json` относится к существующему corridor и не получает нового утверждения об ACL/no-reparse от этой правки. Сохранение правил не меняет текущую работающую конфигурацию: нужно явное переподключение, а фоновой службе — обновление её снимка. Реальная установка, reboot, TUN capture, failover при смене сети, обновление подписанного пакета и непрерывная работа месяцами требуют отдельного принятия; эти конечные тесты их не доказывают.
