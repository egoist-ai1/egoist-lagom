# Практическое исследование рынка для Egoist Lagom

Проверено 30 сентября 2026 года. Локальная база: исходники кандидата 3.8.0, commit `199236e3b227f9885c2beef64faffbe9e9a35583`. Это исследование документации и исходников, без установки конкурентов, платных подписок или сравнительного измерения их скорости и uptime. Реестр первоисточников, даты и границы доказательств: [market-sources.json](market-sources.json).

## Вывод для продукта

Полезная задача Lagom — управлять выбранными сетевыми компонентами Windows с понятными состояниями, безопасным восстановлением и сохранением внешних настроек. Для неё важнее единый владелец сетевого состояния и проверяемая работа без GUI, чем больше протоколов, анимаций и кнопок. Это вывод из сравнения архитектур и текущего кода, а не оценка доли рынка или доказательство превосходства.

Mullvad и Proton — клиенты собственных VPN-провайдеров. Clash Verge Rev, FlClash и v2rayN — клиенты для конфигураций сторонних прокси. AdGuard — фильтрация приложений и DNS. DNSCrypt и NextDNS дают ориентиры для DNS-службы. Их ответственность и внешние зависимости различаются; общий рейтинг «самый стабильный» здесь не обоснован.

Из проверенных источников не следует, что какой-либо продукт способен работать без отказов месяцами в любой Windows-среде. Свежие changelog описывают исправления служб, маршрутов, DNS, установщиков и загрузчиков. Эти случаи помогают выбрать проверки Lagom, но не измеряют частоту отказов конкурентов.

## Что есть в Lagom по коду

| Функция | Подтверждённый контракт | Ограничение, которое нужно сохранить в интерфейсе |
|---|---|---|
| DNS/DoH | Применение адресов, readback, journal и восстановление принадлежащих приложению настроек; native Windows DoH и локальный DNS runtime | Запущенный процесс, локальный listener, корректная конфигурация и ответ внешнего resolver — разные проверки |
| Telegram Proxy | Отдельные команды конфигурации, runtime и установки/запуска/остановки/удаления службы | Доступный локальный порт ещё не подтверждает доставку сообщений Telegram |
| Zapret | Профили, dry-run, пользовательские списки, service/standalone, выбор профиля и диагностика | Перехват пакетов и работа целевого ресурса нельзя обозначать одним неподтверждённым успехом |
| VPN/профили | Подключение выбранного узла, диагностика, route probe, speed test, main-process reconnect с backoff/cooldown и отменой при ручном отключении | VPN и supervisor требуют живого приложения; background service DNS/TG/Zapret это ограничение не снимает |
| Core | Persisted running intent, ownership, проверки автоматических служб и локальной готовности, интервалы восстановления и уважение ручного выключения | `OwnedServiceSupervisor.Describe()` прямо сообщает `remoteConnectivityVerified=false`; он не контролирует качество внешнего сервера |
| Согласование изменений | NetworkCombinator координирует занятые ресурсы и инспекцию модулей | `apply()` и `rollback()` планов возвращают `applied:false`: API плана не является готовым универсальным исполнителем |
| Обновления | Подписанный канал с registry, pinning, ограничениями загрузки и проверкой артефактов | Проверка обновлений живёт в приложении; для 3.7.7 нужна ручная миграция; отдельная фоновая служба обновлений ещё не подтверждена |

Основания: `README.md`, `package.json`, `DESIGN.md`, `src/recovered/electron/ipc/handlers-{vpn,system,zapret,telegram-proxy,network-combinator}.js`, `vpn-reconnect-supervisor.js`, `network-combinator-manager.js`, `src/service/EgoistShield.Service/OwnedServiceSupervisor.cs`, `OwnedServiceIntentStore.cs`. Это наблюдение исходников, а не новая Windows-приёмка этих функций.

## Версии и актуальность

Дата публикации из GitHub REST API проверена отдельно от относительного текста страниц. Для AdGuard использована официальная история выпусков. Версия NextDNS CLI не является версией их Windows GUI.

| Продукт | Проверенная опубликованная версия | Дата UTC / дата производителя | Основание |
|---|---|---|---|
| Mullvad Windows | 2026.5 | 2026-09-14 06:02:38 UTC | [Windows download](https://mullvad.net/en/download/vpn/windows), [desktop release](https://github.com/mullvad/mullvadvpn-app/releases/tag/2026.5) |
| Proton VPN Windows | 5.1.8 | 2026-09-22 11:46:58 UTC | [Release](https://github.com/ProtonVPN/win-app/releases/tag/v5.1.8) |
| AdGuard Windows | 8.0.1 | 2026-09-09, время не опубликовано | [История версий](https://adguard.com/en/versions/windows/release.html) |
| Clash Verge Rev | 2.5.6 | 2026-09-26 04:11:55 UTC | [Release](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/v2.5.6) |
| FlClash | 0.8.98 | 2026-09-14 03:20:30 UTC | [Release](https://github.com/chen08209/FlClash/releases/tag/v0.8.98) |
| v2rayN | 7.24.9 | 2026-08-29 02:47:27 UTC | [Release](https://github.com/2dust/v2rayN/releases/tag/7.24.9) |
| dnscrypt-proxy | 2.1.18 | 2026-07-18 12:14:35 UTC | [Release](https://github.com/DNSCrypt/dnscrypt-proxy/releases/tag/2.1.18) |
| NextDNS CLI | 1.47.3 | 2026-06-03 18:46:57 UTC | [Release](https://github.com/nextdns/nextdns/releases/tag/v1.47.3) |

В общем репозитории Mullvad `/releases/latest` на дату проверки ведёт на `android/2026.11`. Использовать этот endpoint как «последнюю Windows-версию» было бы ошибкой. Windows-версия подтверждена платформенной страницей и наличием Windows EXE в desktop release. Для Windows GUI NextDNS актуальную версию по доступным источникам не подтверждали.

## Служба, намерение пользователя и восстановление

| Решение | Что подтверждено | Что брать в Lagom | Что не приписывать без проверки |
|---|---|---|---|
| Mullvad | Отдельный daemon принимает команды GUI/CLI; tunnel state machine отличает Connecting/Connected/Disconnecting/Error; Connected следует после проверки соединения. Windows offline monitor учитывает default route и suspend/wakeup. [Архитектура](https://github.com/mullvad/mullvadvpn-app/blob/main/docs/architecture.md) | Системный хозяин состояния, события сети/питания, отменяемые команды и состояния с причинами | Документ архитектуры `main` не является доказательством месячного uptime конкретного EXE |
| Proton | Документирует автоматический reconnect после случайного разрыва. Advanced kill switch сохраняет WFP-фильтры после reboot и блокирует сеть даже при ручном disconnect. [Контракт kill switch](https://protonvpn.com/support/advanced-kill-switch) | Явно объяснять разницу между автоматическим восстановлением, ручным выключением и блокировкой сети | Постоянные фильтры не равны автоматическому VPN без GUI. [README](https://github.com/ProtonVPN/win-app/blob/master/README.md) описывает управление service из GUI и старую OpenVPN-архитектуру; lifecycle нового 5.x по нему не подтверждён |
| AdGuard | В 7.x документировалась опция фильтрации при старте ОС без запуска приложения. В 8.x отдельно видны home protection, модули и расширенные настройки. [История](https://adguard.com/en/versions/windows/release.html), [текущий интерфейс](https://adguard.com/kb/adguard-for-windows/) | Отдельная настройка «работать после входа/старта ОС» с реальным эффектом; разделять GUI и обработчик сети | Поведение старого 7.x не считается новой runtime-проверкой 8.0.1; закрытие окна/выход из трея/остановка службы надо проверять отдельно |
| Clash Verge Rev / Mihomo | Есть system proxy и TUN, guard, профили и редактор правил. Quickstart различает приложения, использующие системный proxy, и приложения, которым нужен TUN. [Функции](https://www.clashverge.dev/), [Quickstart](https://www.clashverge.dev/guide/quickstart.html) | Объяснить охват каждого режима и результат изменения маршрута | Наличие Service Mode не доказывает самостоятельное reconnect после выхода GUI. Полный headless lifecycle версии 2.5.6 в этой работе не проверялся |
| v2rayN | GUI для Xray/sing-box и других cores; release 7.24.9 содержит TUN/DNS/IPv6-изменения. [README](https://github.com/2dust/v2rayN), [Release](https://github.com/2dust/v2rayN/releases/tag/7.24.9) | Интероперабельность импорта, различение выбранного core и transport, корректность IPv6 | «Core запущен» не равен system-wide VPN; boot/GUI independence не установлены исследованием |
| dnscrypt-proxy | Документирует Windows system service install/start/stop/restart, CLI `-resolve`; GUI не нужен служебному режиму. [Windows installation](https://github.com/DNSCrypt/dnscrypt-proxy/wiki/Installation-Windows) | Установка отдельно от включения, проверка DNS отдельно от SCM, понятный возврат исходных DNS | Инструкция не доказывает транзакционный rollback чужих настроек и обновление без краткого перерыва |
| NextDNS | CLI документирован как DoH-клиент без GUI со split horizon и Windows support. На официальном Help Center опубликован отдельный старый guide с MSI service/UI properties. [CLI](https://github.com/nextdns/nextdns), [Deployment guide](https://help.nextdns.io/t/83hsj8t/windows-client-mass-deployment-guide) | Работа service без панели — отдельный приёмочный сценарий; split DNS для локальных доменов | Актуальное поведение Windows GUI/MSI здесь не проверено; автор исходного help-center guide не идентифицирован независимо. Корпоративный запрет выключения не нужно переносить в пользовательский Lagom |

Пример рыночной ошибки, полезный для тестов: Clash Verge Rev 2.5.6 исправляет остатки Windows service state, неверную классификацию изоляционных прав и задержку окна около двух минут при остановленной службе; также улучшает показ причины отказа. Это опубликованный changelog, а не наш замер или оценка частоты проблемы. [Release 2.5.6](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/v2.5.6).

## Конфликты маршрутов, DNS и доступность

Официальная документация Mullvad описывает атомарные изменения firewall policy и различает Error с блокировкой трафика от Disconnected. Такой контракт полезен при будущей переработке VPN Lagom: последовательность изменений и режим при отказе должны быть заранее определены. Он не означает, что стоит включать постоянную блокировку для обычного DNS/TG-пользователя. [Mullvad security](https://github.com/mullvad/mullvadvpn-app/blob/main/docs/security.md).

У AdGuard 8.0 routing, filtering и HTTPS interception являются отдельными слоями. Совместимость определяется проверенными списками и исключениями; для неизвестных приложений HTTPS interception автоматически не включается. Применимый вывод: Lagom должен показывать охват действия и известный конфликт, а не переключать все компоненты ради одной кнопки. Перехват HTTPS и собственная CA не нужны для текущей задачи Lagom. [App management 8.0](https://adguard.com/kb/adguard-for-windows/app-management/).

DNS bootstrap и резервный resolver — разные вещи. Архивная инструкция AdGuard объясняет, как обращения к system bootstrap/fallback могут появиться как незашифрованный DNS. NextDNS CLI прямо предупреждает, что captive-portal fallback на system DNS может быть вынужден внешним воздействием. DNSCrypt Windows guide также объясняет приватностную цену системного резервного DNS. Брать нужно явный пользовательский выбор политики и отдельную диагностику; скрытый «починим интернет, отключив шифрование» не соответствует обещанию пользователя. [AdGuard DNS leaks, архив 7.x](https://adguard.com/kb/archive/adguard-for-windows/solving-problems/dns-leaks/), [NextDNS configuration](https://github.com/nextdns/nextdns/wiki/Configuration), [DNSCrypt Windows](https://github.com/DNSCrypt/dnscrypt-proxy/wiki/Installation-Windows).

dnscrypt-proxy предлагает cache, выбор быстрых доступных resolvers и обновление resolver lists. NextDNS CLI имеет ограничение числа одновременных DNS-запросов, request timeout и явно управляемый cache. Это идеи для нагрузки и bounded resources, а не повод без измерений добавлять ещё один DNS engine в Lagom. [dnscrypt-proxy 2.1.18 README](https://github.com/DNSCrypt/dnscrypt-proxy/blob/2.1.18/README.md), [NextDNS configuration](https://github.com/nextdns/nextdns/wiki/Configuration).

Во время конфликта с внешним VPN/DNS/proxy приложение должно назвать занятый ресурс, показать свой план и предложить доступный вариант. Публичные материалы рассмотренных продуктов не подтверждают универсальное согласование всех сторонних приложений. Такая capability у Lagom тоже не доказана. Не следует автоматически удалять адаптеры, выключать firewall или завершать сторонние процессы по рецептам troubleshooting.

## Обновления, диагностика и приватность

| Аспект | Наблюдение рынка | Практический контракт Lagom |
|---|---|---|
| Проверенный источник обновления | Mullvad показывает changelog, download, verification и запуск installer отдельно. [User guide](https://mullvad.net/en/help/using-mullvad-vpn-app) | Показывать фазу, версию и причину отказа; новый GUI не считать успешно установленным до readback служб и версии |
| Подпись против checksum | v2rayN документирует GPG release signatures; CVR описывает pinned Minisign verification. [v2rayN README](https://github.com/2dust/v2rayN), [CVR privacy policy](https://www.clashverge.dev/privacy.html) | Сохранить подпись и доверенный корень; SHA-256 сам по себе не аутентифицирует издателя |
| Ошибки загрузчика | Release v2rayN 7.24.9 объявляет срочное исправление MITM в старом встроенном downloader. [Release](https://github.com/2dust/v2rayN/releases/tag/7.24.9) | Проверять trust до установки, fail closed при подписи/rollback/неизвестном ключе; приёмка старых версий обязательна |
| Доступность обновления | Proton описывает update через Settings → Support → About. Это не документ автономного updater без приложения. [Update guide](https://protonvpn.com/support/vpn-update) | Называть отдельно обновление GUI и работу сетевых служб; не обещать обновление при полностью закрытом приложении |
| Диагностика | CVR документирует local config/logs и очистку app logs с default retention 7 дней; logs могут содержать domains, IP и subscription token. [Privacy policy](https://www.clashverge.dev/privacy.html) | Ограничить размер/возраст, отделить безопасный health summary от полного журнала, redaction перед экспортом |
| Сетевые обращения самого клиента | CVR перечисляет update, IP, subscription, latency, DNS, WebDAV и локальные listeners по назначению; часть запросов включена по умолчанию. [Privacy policy](https://www.clashverge.dev/privacy.html) | Политика приватности должна перечислять реальные автоматически выполняемые действия и endpoints; «всё локально» нельзя использовать как обещание отсутствия сетевых запросов |

Подпись release manifest и Windows Authenticode решают разные задачи. Сравнение подписей конкурентов не отменяет отдельную проверку происхождения внутренних DLL/driver/EXE и политики подписи установщика Lagom. Это вывод для release-плана, не утверждение о найденной эксплуатации.

## Интерфейс: что использовать в чёрно-белом стиле

Mullvad показывает основной connection state и раскрываемые connection details; продвинутые параметры вынесены отдельно. AdGuard 8.0 разделяет основное включение, конкретные модули, app management и advanced settings. FlClash прямо описывает адаптацию размеров экранов и Material You; это заявленные принципы, их фактическая читаемость в Windows здесь не измерена. [Mullvad guide](https://mullvad.net/en/help/using-mullvad-vpn-app), [AdGuard overview](https://adguard.com/kb/adguard-for-windows/), [AdGuard settings](https://adguard.com/kb/adguard-for-windows/settings/), [FlClash README](https://github.com/chen08209/FlClash).

Для Lagom предлагается сохранить монохром и передать дизайн-архитектору следующий продуктовый brief:

- Главная страница: выбранный сценарий, одно основное действие, подтверждённое состояние, краткие отдельные строки DNS/TG/Zapret/VPN. Не показывать неподтверждённый общий успех.
- Деталь компонента: что включено, действует ли без GUI/после reboot, когда и как проверено, последнее событие восстановления, доступное действие. Причина отказа остаётся видимой после исчезновения toast.
- Навигация строится по задачам: подключение, профили, компоненты, диагностика, настройки. Окончательное число разделов определяется текущими сценариями; не делать новый пункт для каждой внутренней подсистемы.
- Белая заливка обозначает одно основное действие в группе; серый фон и границы — вторичные. Состояния различаются текстом и формой glyph, не одним цветом. Иконки помогают подписи, самостоятельная icon-only кнопка имеет accessible name и понятную область нажатия.
- Технические адреса и длинные ошибки доступны полностью и копируются через явное действие. Секреты скрыты. Числа без реального измерения обозначаются как отсутствие данных.
- Свёрнутый режим даёт status и безопасное основное действие. Hover/focus меняет glyph без наложения connected check. Детальные настройки остаются в полном окне.
- В обычном режиме важнее стабильная геометрия и читаемость, чем постоянное движение. Короткие hover/press и phase transitions допустимы; loop animation в idle и тяжёлое свечение щита не нужны для подтверждения работы.

Не стоит переносить карты стран VPN-провайдера, рекламные карточки подписок, CSS injection, облачную синхронизацию секретов и несколько параллельных наборов тем ради «современности». Пользовательский запрос — спокойное локальное обслуживание, быстрые действия и работа без постоянного внимания. Это продуктовые рекомендации, не результаты пользовательского исследования.

## Приоритеты и сценарии приёмки

| Приоритет | Задача | Как принять результат |
|---|---|---|
| P0 | Единый контракт состояния: intent/configured/installed/running/local ready/external result/unknown | Каждый статус имеет источник и время; отказ внешнего сервера не выдаётся за остановку службы; partial state виден в полном и мини-режиме |
| P0 | Работа включённых автоматических DNS/TG/Zapret без GUI и уважение ручного Stop | Cold boot, sign-out, закрытие GUI, остановка/сбой own runtime, сетевой offline, последующее восстановление; не поднимать intentional-off и не менять external Disabled |
| P0 | Проверенный upgrade и recovery | Миграции 3.7.7/3.7.8/3.7.9, повреждённая подпись/пакет/registry, interrupted install, старый путь и service leftover; результаты и rollback проверяются в отдельной Windows-среде |
| P1 | Автономный VPN, если обещание «всё без приложения» сохраняется | Вынести lifecycle в system service с authenticated IPC и безопасным хранением секрета; проверить tunnel/readiness/routes после reboot без открытия GUI. До этого честно показывать зависимость |
| P1 | Конфликты сети и владение | Совместная работа с внешним VPN/DNS/proxy, occupied ports, Wi-Fi↔Ethernet, DHCP update, sleep/wake, IPv4-only/IPv6-only/dual stack; restore не трогает внешние изменения |
| P1 | Явная DNS fallback policy | DNS endpoint down/TLS expired/bootstrap unavailable/captive portal/local names; выбранная политика не меняется незаметно ради фиктивного успеха |
| P1 | Ресурсные пределы и полезная наблюдаемость | Burst запросов, медленный/зависший upstream, cache saturation, retry storm, рост wrapper/application logs, CPU/RAM/handles/FD trends; разные причины дают разные recovery actions |
| P1 | Последовательный монохромный UI | 100/125/150/200%, minimum/full/mini, длинная кириллица и URL, hover/focus/disabled/pending/error, keyboard/Escape/reduced motion; измерить actual foreground interaction отдельно от скрытого screenshot |
| P2 | Отдельная фоновая доставка обновлений | Только если нужна отдельная capability: service updater, staged activation, signed policy и recovery. Работа DNS без GUI не доказывает существование такого updater |

Стресс-проверки алгоритмов, виртуальное время и повторения unit tests проверяют конкретные инварианты. Они не заменяют cold boot, GUI-less эксплуатацию, фактический внешний маршрут и длительную работу реального установщика. Для итогового плана нужны 72 часа soak с неисправностями и затем 7–14 дней пилота; месяцы надёжности можно оценивать после соответствующего наблюдения, а не объявлять заранее.

Новая архитектура не должна вводиться одним большим переписыванием. Последовательность: зафиксировать статусы и ownership; принять реальный installer/runtime; вывести недостающий VPN lifecycle из GUI; затем переносить recovered UI по одному экрану на единую систему компонентов. Сравнение рынка поддерживает эти направления, но выбор library или нового native engine требует отдельного измерения и совместимости.

## Границы исследования

Не выполнены сравнительные live installations, платные аккаунты, пользовательские интервью, Windows benchmarks конкурентов, проверка их бинарных подписей или месячный soak. Source documents `main`/`master` показывают текущее описание или реализацию, но могут расходиться с последним бинарным релизом. Архивные материалы AdGuard помечены отдельно; Proton README содержит прежнюю архитектуру, поэтому не используется для утверждения headless поведения 5.x. Windows GUI NextDNS и CLI не смешаны.

По нескольким дополнительным страницам AdGuard прямое чтение завершилось TLS timeout; один поздний пакет web-запросов завершился connection failure. Неудачная загрузка не считается доказательством отсутствия функции. Приоритеты основаны на успешно прочитанных документах/репозиториях и локальном коде; неизвестные свойства явно оставлены неизвестными.
