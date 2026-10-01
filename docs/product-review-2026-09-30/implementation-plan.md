# План реализации, проверки и выпуска Egoist Lagom

База плана: кандидат 3.8.0, commit 199236e3b227f9885c2beef64faffbe9e9a35583. Дата: 30 сентября 2026 года. По результатам аудита реализованы в исходниках R27–R30 и R32: обслуживание служб, сохранение policy, защищённое boot recovery, зависший worker, безопасный uninstall и журнал. Regression/self-test проверки прошли; privileged native приёмка ожидается. Старый updater bootstrap R31 и остальные задачи, включая внедрение отдельного дизайн-макета, остаются открытыми. [Приоритеты и evidence](prioritized-findings.json), [общий вывод](README.md), [installer fix](installer-fix.md).

## Целевое поведение

Пользователь выбирает, какие компоненты устанавливаются как фоновые службы. После успешной установки они запускаются Windows и восстанавливаются по своему сохранённому намерению без открытия приложения. GUI отображает факты и управляет этим намерением. Закрытие окна, потеря сети и отказ внешнего DNS не должны сами менять выбранный режим.

Следует различать запуск процесса, локальную готовность компонента, доступность внешней сети и доказанный маршрут трафика. Running в SCM не равен работающему DNS; успешный запрос IP не равен подтверждённому полному TUN. В интерфейсе частичный отказ виден по соответствующему компоненту. Неизвестный или устаревший результат не превращается в «подключено» или «выключено».

Безошибочная работа месяцами не является проверяемым обещанием одного выпуска. Проверяемый результат — ограниченные операции, безопасное поведение при конкретных отказах, сохранность чужих настроек, достаточная диагностика и наблюдавшийся период эксплуатации.

### Пользовательские сценарии, которые должны пройти

1. Установить фоновые DNS/DPI/TG; закрыть GUI, перезагрузить Windows и проверить фактическую готовность без открытия GUI.
2. Включить уже установленный DPI-профиль из Обзора; сохранить Auto/service mode после закрытия и reboot.
3. Явно выключить службу; она остаётся выключенной после reconnect, сбоя watchdog и reboot.
4. Потерять upstream/интернет; локальный процесс остаётся исправным, статус показывает внешнюю причину, повторные попытки ограничены.
5. Аварийно завершить собственный engine; supervisor восстанавливает только выбранный работающий компонент с backoff.
6. Повредить собственный журнал или запретить запись; диагностика доступна, новые мутации заблокированы, неизвестный результат не повторяется вслепую.
7. Изменить DNS/маршруты другим приложением после нашей установки; восстановление не перезаписывает чужое изменение.
8. Одновременно обновить подписку и настройку; сохранить обе операции.
9. Выбрать вторую подписку; показать и удалить именно её с указанием цели.
10. Установить/обновить компонент при медленной сети, locked file и disk-full; предыдущая работоспособная версия сохраняется.
11. Использовать full/mini, клавиатуру, 100/125/150/200% DPI и reduced motion; действие и его область понятны во всех состояниях.
12. Обновить доверенный клиент 3.7.8/3.7.9 через настоящую release chain; отказ проверки подписи не приводит к установке.

## Единый контракт состояния

Владельцем фонового lifecycle становится Core. GUI не должен поддерживать параллельную независимую картину SCM/DNS и записывать весь устаревший state.

| Слой | Минимальные данные | Условие показа |
| --- | --- | --- |
| Намерение пользователя | enabled, выбранный service/temporary mode, точный component/profile ID, revision | Это выбор, даже если компонент ещё не работает |
| Конфигурация | сохранённый и применённый revision, endpoint/profile, версия runtime | Preview и применённый результат показаны раздельно |
| Установка | absent/installed/unavailable; version и protected path | Отсутствие ответа не означает absent |
| Выполнение | inactive/starting/running/stopping/failed/unknown | Из доверенного наблюдения, с generation |
| Локальная готовность | ready/not-ready/unknown, evidence source | Собственный процесс/port/protocol; недостаточно только SCM Running |
| Внешняя проверка | succeeded/failed/not-checked, причина | Потеря внешнего endpoint не является доказательством сломанного локального процесса |
| Свежесть | checkedAt, монотонный возраст, staleAfter, lastError | Старый снимок сохраняется как старый; новый запрос не стирает ошибку |
| Операция | requestId, fingerprint, ожидаемый revision, pending/result/outcome-unknown | Поздний результат старого поколения не заменяет новое состояние |

Поля протокола не нужно выводить пользователю повсюду. Основные статусы: «Работает», «Запускается», «Остановлена», «Проверка недоступна», «Есть проблема» и время последней проверки при необходимости. Подробности доступны по раскрытию.

Дедупликация requestId не равна гарантии exactly-once произвольного внешнего действия. Для каждого метода определить, что допускает безопасное повторение, какой readback доказывает результат и когда требуется остановка с outcome-unknown.

## Этап M0 — превратить новые находки в регрессии

**Результат:** безопасные тесты, которые проверяют правильное поведение и падают на нынешнем дефектном снимке. Существующие audit-harness подтверждают наличие дефекта; нельзя оставить их зелёный результат как доказательство исправления.

- Сохранить воспроизводимость state race, DNS path secret, header-only DNS, порта 40123/40301, IPv6 aliases, stalled body/open failure и clock rollback.
- Использовать настоящие классы Core, NTFS и pipe; dangerous network/SCM методы в unit stress по-прежнему запрещены. Windows integration оставить отдельным уровнем.
- Перенести corrupted-marker и persistence-after-effect случаи в поддерживаемые тесты без подмены dispatcher.
- Выделить tests для выбора второй подписки, service-preserving quick-on и stale/unknown UI.
- Сохранить source/fixture hashes и критерий, который отличает исправленное поведение от baseline.

**Переход:** все приоритетные находки имеют reproduction, ожидаемый результат, владельца модуля и acceptance. Непроведённый реальный сценарий помечен как gate, а не PASS.

## Этап M1 — persistence, восстановление и фоновые службы

Задачи R01–R06, R27–R30, R32. Это фундамент дальнейших изменений. R27: общий quiesce helper, Core-first, durable original snapshot, explicit Disabled, verified stop/PID, Core maintenance barrier и scoped retry прежней stage реализованы; 43 helper cases, 9 lifecycle groups и Core self-test прошли. R28: recovery-only repair теперь сохраняет startup/delayed-auto, явная установка задаёт прежние defaults; compiled self-test проверяет режимы, supervisor, гонки, ошибки и отмену. Требуются native queue/upgrade/rollback и policy readback.

R29 и R30 реализованы в исходниках. До Disabled worker защищает дерево snapshots и регистрирует проверенную SYSTEM boot task: delay 30 s, execution limit 20 min, три повтора через 2 min. Task привязана к canonical stage, владельцам/ACL и SHA worker/helper/module. Нормальное завершение удаляет только свою task после verified restoration. Timeout recovery создаёт cancel flag, ограниченно ждёт, удерживает проверенный handle/creation-time/executable собственных процессов перед Kill/Wait и не запускает recovery одновременно с mutation owner. Incomplete recovery сохраняет marker, snapshot и pending state вместо ложного complete.flag. Watchdog удерживает общую lease до retirement и terminal write. 22/490 boot и 8 timeout групп прошли; это controlled native boundaries, а не действительная установка/reboot Windows. Uninstall отказывает при активной lease или pending marker/backup, прежде чем трогать службы.

R32: атомарного rename недостаточно для read/modify/write журнала. Добавлена отдельная защищённая stage-specific mutex на весь append/flush/status; четыре группы с настоящими runspaces/mutex/files подтверждают сохранение обоих конкурирующих событий. Ошибка журнала до handoff не блокирует failed UI/flag, а acquired maintenance marker по-прежнему не терминализируется при incomplete recovery. Русские сообщения проверены непосредственно в WinPS5.1. [Исправление и receipts](installer-fix.md).

### Чтение и восстановление

AtomicJsonFile должен различать Missing, Valid, Unavailable и Corrupt. Убрать File.Exists как окончательное доказательство отсутствия до retry: открывать файл внутри bounded retry. При реальном File.Replace окно чтения не должно превращать действующий журнал в пустое состояние. Стабилизация Missing или собственная координация чтения/записи должна иметь ясный бюджет.

Повреждённый marker сохранять для диагностики. Core открывает авторизованный read-only health/recovery pipe даже при повреждении журнала; переход в degraded блокирует мутации. Не удалять незнакомый marker и не выполнять широкое восстановление DNS/SCM без доказательства владения. Recovery строится из проверенного installed/desired/observed state.

### Повторные операции

Перед side effect сохранять durable dispatch intent с requestId, fingerprint и preconditions. После исполнения сохранять проверяемый результат. Если результат нельзя записать, сохранять/восстанавливать неопределённость и сверять фактическое состояние перед любым повтором. Для component.execute нужен методоспецифичный reconciliation; один in-memory cache не закрывает crash window.

Общий mutation serialization сохраняется там, где ресурс общий. Независимые read-only запросы должны оставаться доступными. Не вводить второй watchdog с теми же обязанностями.

### Настройки и служебный режим

Renderer использует узкие settings:patch, node:select и отдельные операции подписок с expectedRevision. StateStore обновляет данные атомарно. Проверить все callers get()+set(), включая rename/delete/import; исправление одного toggle недостаточно.

Быстрое включение установленного DPI-профиля вызывает startService и сохраняет Auto. Standalone — отдельная явно временная команда. Отключённое пользователем намерение не восстанавливается автоматически. Выбор/удаление подписки всегда связан с её стабильным ID.

**Приёмка M1:**

- Corrupt/truncated/wrong-schema/inaccessible marker: диагностика доступна, unsafe mutation отклонена, исходное evidence сохранено.
- File.Replace concurrency: ни один ответ не сообщает false no-recovery из временной недоступности; финальные данные целы.
- Fault до/после side effect и до/после response persistence: повторный requestId не выполняет непроверенный повтор; другой payload с тем же ID отклонён.
- Concurrent settings/subscription/node actions: нет потерянных изменений; conflict имеет явный результат.
- Реальный quick-on установленного профиля: Auto/Running/readiness, GUI exit и reboot сохраняют режим.

## Этап M2 — границы привилегий, runtime и приватность

Задачи R09–R12, R21–R22. Реализовать до переноса новых engine lifecycle в службу.

### Исполнение компонентов

GUI запускается с обычными правами. Привилегированные операции проходят через ограниченный Core contract. Runtime, DLL, скрипты и конфигурации для privileged execution размещаются в защищённой области, проверяются по pinned digest/подписанной метаинформации и не выбираются из writable userData по одному exists.

Проверить ACL, reparse points, locked replacement, путь DLL resolution и окно между verification и execution. Custom runtime оставить отдельной явной функцией с известной областью доверия и правами; пользовательский выбор не становится скрытым System execution.

### GUI и worker

Текущий ComponentWorker использует ELECTRON_RUN_AS_NODE=1. Сначала создать отдельный защищённый worker host с узким контрактом и собственной идентичностью. Worker не получает права разрешённого GUI-клиента автоматически. Затем отключить у production GUI inspector/Node options/RunAsNode и ASAR fallback, включить совместимую проверку ASAR.

Прочитать fuses **готового PE**, а не только build config. Path authorization дополняется проверяемой protected installation/process/session boundary. Native pipe ACL сама по себе не идентифицирует доверенный GUI. Реальные SystemDoH/Zapret/TG worker operations обязаны пройти после смены host.

### Загрузки и URL

Объединить общие component downloads и updater вокруг bounded transport: header/body/idle deadline, cancellation, максимальный размер, точная длина, digest, redirect policy до каждого запроса. Reader и file handle закрываются в finally, partial удаляется после закрытия. Open/write/rename failure не блокирует следующие операции.

Разрешённые release URL: HTTPS, без userinfo, обычный порт 443, точный host/repository/path. IPC принимает только ожидаемый packaged document/main frame; foreign file hosts/UNC и ambiguous paths отклоняются.

### Диагностика

Структурно редактировать секреты в URL, включая path, query, userinfo и fragment. В диагностике сохранять безопасные host/тип/ошибку и нужную версию, не credentials. Не менять рабочий endpoint ради redaction. Тест проверяет весь exported ZIP, логи и вложенные JSON на синтетические sentinels.

**Приёмка M2:** изменённые writable bytes не исполняются привилегированным host; пользовательский Node script не проходит как GUI Core client; worker functions сохранены; downloader fault matrix завершается в бюджете с закрытыми handles; sentinel отсутствует в полном архиве.

## Этап M3 — достоверность сети и ограниченное восстановление

Задачи R07–R08, R13, R15–R19, R24.

### DNS и режимы шифрования

Разбирать question/answer sections с bounds, compression-loop limits и проверкой ID/QNAME/QTYPE/QCLASS/source. Header-only, truncated, foreign source и неполные records не подтверждают DNS. Поддержку CNAME/TCP fallback реализовать явно, иначе возвращать not-verified.

Проверка собственного listener, корректного ответа, внешнего разрешения и encrypted configuration — разные факты. Generic DoH URL и DoT hostname не смешиваются: либо реализовать отдельный DoT contract с корректным TLS/SNI/bootstrap, либо убрать неверную подпись в generic поле.

Политика encrypted-only/fallback определяется пользователем и не меняется незаметно. Captive portal/local names/недоступный bootstrap требуют понятного состояния; plaintext fallback имеет отдельное разрешение и отображение.

### VPN, маршруты и адреса

В TUN direct request без binding может тоже идти через tunnel. Нужны доверенные Windows interface/route observations и проверяемая physical-path probe, либо verdict unknown. Разница внешних IP не доказывает покрытие всех приложений. Одинаковые IP не доказывают bypass без проверки контекста.

Канонизировать IPv4/IPv6 для сравнения адресов, сохраняя исходную строку для отображения и точный server/SNI для подключения. Не нормализовать hostname/SNI до другого значения. Недоступный route inspector не даёт protected.

### Восстановление и время

Reconnect классифицирует structured HTTP status/error code, а не цифры в произвольном тексте. Port 40123/40301 не означает auth failure. Cancellation и поколения ручного disconnect сохраняются.

TTL, backoff и elapsed budgets используют монотонные часы; wall time нужен для отчёта. Защитить cache на случай future timestamp/rollback. NETWORK readiness не выводится только из DNS resolve одного внешнего домена.

CONNECT имеет абсолютный срок операции, idle deadline, header cap и AbortSignal; медленный drip не продлевает работу бесконечно. Локально неисправный процесс и внешняя сеть требуют разных recovery actions. Retry budgets, jitter и cooldown предотвращают restart storm. «Остановлена пользователем» никогда не становится auto-restart.

### Speedtest

Правильно декодировать HTTP framing; считать полезные bytes, не chunk headers. Быстрый тест имеет явный byte/time budget. Большой тест с расходом трафика — отдельный осознанный режим. Нынешний верхний расчёт download достигает 3,072 GB; это source estimate, не выполненная внешняя нагрузка.

**Приёмка M3:** неправильный DNS не проходит; TUN без route evidence не protected; IPv6 aliases сравниваются равными; structured auth классифицируется точно; все долгие операции завершаются/отменяются; clock rollback не замораживает старый running; поздний ответ не стирает unknown/error.

## Этап M4 — последовательный чёрно-белый интерфейс и производительность

Задачи R13–R14, R20, R23. Backend contracts из M1–M3 используются в UI, затем выполняется визуальная миграция.

### Структура и компоненты

Сохранить шесть экранов: Обзор, Соединение, DNS, Профили, Telegram, Настройки. В Обзоре видно, что делает щит и что делает VPN. Профили DPI и правила маршрутизации имеют разные названия. Подробные адреса/диагностика/обслуживание находятся в соответствующем разделе, без удаления функций.

В mini: одна кнопка щита, наблюдаемое состояние компонентов, отдельные checkbox intent «Включать вместе со щитом» и переход к полному окну. Unknown сначала предлагает read-only проверку; после неё действие определяется подтверждённым состоянием. Не ставить включённый switch там, где он не меняет фактическое состояние сразу. Это согласуется с [рекомендациями Windows для toggles](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/toggles).

Действия destructive показывают точную цель. Pending виден сразу, операция не дублируется, отмена имеет определённый контракт. Error сообщает причину и доступное следующее действие. Preview endpoint нельзя оформлять как уже применённый DNS.

### Дизайн-система

Предложенный единственный источник токенов: [tokens-proposal.css](design/tokens-proposal.css). На этапе внедрения обновить корневой DESIGN.md, перенести semantic aliases и убрать конкурирующие стили. До внедрения действующая authority не меняется.

| Параметр | Предложение |
| --- | --- |
| Цвета | canvas #090909, panel #121212, raised #1b1b1b; ink #f5f5f5, muted #b8b8b8, dim #a0a0a0 |
| Границы | #333333 декоративные; #737373 для значимых controls |
| Текст | Manrope body 14, caption 12, section 16; Unbounded title 24; monospace для адресов |
| Размеры | Controls 40 px; icon target 32 px; icon 20 px, stroke 1,8 |
| Layout | Sidebar 192 / collapsed 64, titlebar 40, content max 1160; mini 320, minimum height 400 |
| Шаги | 4/8/12/16/20/24/32; radius 6/10/12; focus 2 с offset 3 |
| Motion | 100/140/180 ms, opacity/transform по состоянию; reduced motion отключает перемещение |

32/40 px — проектный выбор размеров, не утверждение универсального WCAG minimum 44 px. [WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) задаёт минимум 24 CSS px с исключениями. Контраст обычного текста проверяется на реальных computed backgrounds; текущие DNS labels 3,991:1 заменить на читаемые semantic tokens.

SVG наследуют currentColor, используют одинаковый viewBox/stroke, имеют понятные labels у icon-only buttons. Иконку выбирать по ID действия, не regex по русской подписи. Декоративные glyph скрыты от screen reader. Галочка подключённого щита и power glyph взаимоисключаются при hover/focus, без наложения во время перехода.

### Производительность

Предварительно измерить 0/60/500/2 000 узлов, большой список подписок, full/mini/tray/hidden. Лабораторный прогон текущего пустого UI показал рост working set 414,68→486,69 MiB; его причина пока не установлена.

Уменьшать polling по видимости и потребности экрана, coalesce статусы в один snapshot, отменять obsolete ping batches, применять virtualization после проверки профилем. Не менять force-read semantics ради красивой цифры. Профилировать main/renderer/GPU отдельно; рекомендации [Electron по производительности](https://www.electronjs.org/docs/latest/tutorial/performance) требуют измерения узкого места.

У response cache в Core должен быть byte cap, а не только 512 записей. Логи/история/owned orphan temp имеют понятные retention/size limits. Cleanup не затрагивает чужие файлы и recovery evidence.

**Приёмка M4:** все 45 функций сохранены; normal/hover/focus/pressed/pending/disabled/error/unknown/stale проверены в full/mini/collapsed; keyboard/Escape работают; реальные DPI и reduced motion проверены; foreground traces подтверждают выбранные performance targets.

## Этап M5 — автономность всех требуемых функций

Задача R25. Текущее приложение не подтверждает обещание «все функции без GUI»: VPN lifecycle связан с процессом приложения, NetworkCombinator не является полным executor.

Если требование всех функций без GUI сохраняется, перенести VPN lifecycle в защищённый service host после M1–M3. Хранение credentials/config, TUN privilege и client authorization проектируются вместе. GUI присоединяется к уже работающему engine, а не создаёт второй процесс при открытии.

NetworkCombinator получает конкретные supported operations, ownership/preconditions, transaction/recovery и фактический readback. Незавершённая функция остаётся явно недоступной, вместо успешного ответа applied:false, оформленного как выполненное изменение.

Фоновая служба сохраняет желаемое состояние и ограниченные health checks. Обновление engine не должно оставлять второй владелец routes/DNS. При завершении worker результат сверяется; SCM failure policy и Core supervision распределяют обязанности без конкурирующих restart loops.

**Приёмка M5:** boot без GUI, crash GUI, crash engine, sleep/wake, смена адаптера и network loss; одна owned instance, известный route/DNS owner, disabled остаётся disabled. Только после этого можно заявлять автономность соответствующих функций.

## Этап M6 — установка, обновление и выпуск

Задачи R26, R31 и release gates из всех субаудитов. Исправленный source коммитится, собирается заново и связывается с новым commit/tree и hashes. Старый EXE 3.8.0 не правится вручную и не переименовывается как исправленный.

### Trust и обновление старых версий

Сохранять root-pinned Ed25519 и проверки версии/имени/размера/SHA. **R31 ещё требует реализации:** проверенная установленная 3.7.9 выбирает собственный старый helper; 3.7.8 требует отдельной проверки исторического кода и миграции. Read-only probe фактически установленной 3.7.9 подтвердил отсутствие нового boot recovery, checked registration и maintenance lease. Нельзя принять старую unverified stage ради прохождения установки. Нужен подписанный bootstrap bridge до service mutations либо проверенная передача управления новому worker с защищённым inventory. Только затем проверить настоящие переходы 3.7.8/3.7.9 с работающими фоновыми службами и закрытым GUI. Проверить отказ revoked/unknown/expired key, rollback manifest, interrupted body/install и отмену UAC.

Для 3.7.7 без старого доверенного приватного ключа предусмотреть однократную ручную миграцию. Не принимать новый root из сети без прежнего доверия и не отключать подпись. В интерфейсе объяснить ограничение кратко и дать безопасный официальный путь.

Отдельно определить политику архивной подписи и разрешения нового update: backdated publishedAt не должен неявно подменять текущую допустимость ключа. Offline невозможность узнать новый отзыв отображается как предел freshness, без фиктивного обновления registry.

Authenticode требует настоящей идентичности издателя и сертификата. Самоподписанный локальный сертификат не делает издателя доверенным Windows. Состояние подписи готового Setup и оставшиеся ограничения явно включаются в release notes.

Electron 44.5.1 и sing-box 1.14.2 доступны по первоисточнику на дату аудита, но latest сам по себе не доказывает безопасность/совместимость. Обновлять через отдельный проверяемый diff и повторную runtime acceptance. Миграцию EOL WinSW/log4net выполнять отдельно с проверкой service XML, ACL, recovery и rollback.

### Матрица настоящей Windows-приёмки

Использовать чистые изолированные VM с обслуживаемыми Windows и зафиксированными build/patch/архитектурой. Реальные DNS/SCM/registry/routes/Wintun-изменения выполняются там, где их последствия наблюдаемы и обратимы.

| Группа | Обязательные случаи | Доказательство |
| --- | --- | --- |
| Установка | Clean install, обычный пользователь, UAC success/cancel, двойной запуск, occupied ports | Фактические files/ACL/SCM/pipe/readiness; при отказе прежняя система сохранена |
| Обновление | 3.7.8/3.7.9, разные выбранные службы, background GUI closed, held files, ENOSPC | State/DNS/runtime сохранены; новая версия проверена; rollback восстанавливает прежнее |
| Прерывание | Crash/выключение VM на каждой persisted phase install/component/DNS | Startup recovery читается; операция не повторяется вслепую |
| Lifecycle | Exit GUI, reboot, engine/Core crash, supervisor failure, disabled intent | Реальная готовность без GUI; нет второго процесса и restart storm |
| Сеть | Wi-Fi/Ethernet/DHCP, sleep/wake, offline/reconnect, IPv4/IPv6/dual stack | Route/interface/DNS evidence; неизвестность видна; deadlines соблюдены |
| DNS policy | Endpoint down, TLS expiry, bootstrap failure, captive portal, local domains | Выбранная encrypted/fallback политика сохранена |
| Конфликты | Другой VPN/DNS/proxy, внешний DNS change, занятые порты | Чужое состояние не перезаписано при restore |
| UI | Full/mini/collapsed, DPI 100/125/150/200%, длинные URL/кириллица, keyboard | Снимки и foreground traces; отсутствуют наложения, clipping и ложные статусы |
| Uninstall | Работающие/выключенные службы, внешние изменения, interrupted uninstall | Удалены только owned resources; восстановление соответствует ownership |

Короткая лабораторная серия и эта матрица имеют разные scopes. Нельзя объявить все Windows-сценарии пройденными по harness с injected harmless executor.

### Длительная эксплуатация и наблюдаемость

После функциональных gates: **72 часа** fault injection на стенде, затем **7–14 дней** пилота с реальными background services. Для утверждения наблюдавшегося месяца нужен минимум фактический месяц; для нескольких месяцев — соответствующая история.

Собирать безопасные локальные метрики: возраст последнего успешного health, причины/счётчик рестартов, pending/unknown operations, CPU/working set/private bytes/handles, размер logs/cache/temp и время восстановления. Credentials, URL tokens и список пользовательских адресов не отправляются автоматически.

Следить за трендом после прогрева и повторяемых нагрузок, а не одной конечной цифрой. Ресурсный рост объясняется профилем; непонятный устойчивый рост блокирует продвижение. Offline и плановый reboot фиксируются отдельно от аварии локального engine. Автоматика не превращает намеренное отключение в failure.

## Предлагаемые измеримые бюджеты

Эти значения — **цели для калибровки**, не результат уже проведённого измерения или обещание на любом ПК.

| Контракт | Цель | Как принять |
| --- | --- | --- |
| UI feedback | Pending/ошибка начинается в пределах 100–200 ms | Foreground input-to-first-frame trace на указанном стенде |
| Degraded Core | Read-only диагностика доступна до 5 s после старта с corrupt marker | Native pipe probe, без безопасностного обхода |
| Network/download | Ограниченный header/body/idle/total budget каждой операции | Сценарии hang/drip/cancel/open/write; нет бесконечного pending |
| Recovery | Отдельный RTO для process crash, sleep/network change и upstream failure | Сначала измерить baseline; настроить detection/backoff по каждому виду отказа |
| Достоверность | 0 ложных «подключено/защищено» в матрице unknown/malformed/stale/route skipped | Expected evidence для каждого success |
| Сохранность | 0 потерянных acknowledged updates и 0 чужих изменений при restore | Concurrency/fault matrix и native ownership readback |
| Ресурсы | Bounded cache/logs/handles, объяснённый тренд памяти | Длительный пилот и профили по этапам |

«Никто не перебивает службы» нельзя гарантировать относительно администратора, Windows, антивируса или другого сетевого продукта. Приложение должно обнаруживать конфликт, беречь чужое состояние и показывать проверяемую причину вместо скрытого соревнования за настройки.

## Решение о публикации

Stable становится допустимым после закрытия release-blocking дефектов, реальной Windows-матрицы, trust/upgrade проверки, визуальной/foreground acceptance и пилота без необъяснённых отказов. Релизные заметки перечисляют измеренные улучшения и оставшиеся ограничения.

Готовность не определяется названием AAA+, числом тестов или отсутствием ошибки в коротком запуске. На данном этапе завершены аудит и проект доработок; применение плана, новый source-bound build, установка и окончательная публикация требуют выполнения описанных gates.
