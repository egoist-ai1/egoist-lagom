# Egoist Lagom — независимый аудит дизайна и предложение миграции

30 сентября 2026 года. Аудируемый source: `199236e3b227f9885c2beef64faffbe9e9a35583`, кандидат 3.8.0. Установленная и публичная версия 3.7.9 не изменялась этим исполнителем. Применён skill design-architect. Этот документ — отдельный проект изменения; действующим контрактом кандидата остаётся корневой `DESIGN.md`. Предложенные CSS не входят в сборку.

## Вывод

Существующий монохромный интерфейс имеет понятную навигацию, локальные шрифты, согласованные SVG, видимые описания настроек и уже исправленную компоновку основных экранов при 200%. Полное переизобретение бренда и декоративные эффекты не нужны. Главные оставшиеся задачи — убрать двойной смысл mini-переключателей, сохранить неизвестное состояние вместо ложного «выключено», повысить читаемость DNS и явно разделить щит, VPN, фоновые службы и приложение.

Разумный редизайн — последовательная миграция шести существующих экранов с сохранением действий backend. Проектный макет показывает предложенную структуру и проверен как отдельный HTML. Он не доказывает работу служб, успешное соединение или длительную стабильность.

## Что действительно изучено

- Проверен путь сборки: `scripts/build.mjs:48` включает ShieldWidget/CompactRuby; `:90` подключает tokens, compact-ruby, compact-surfaces, shield-widget, final-polish. `interface.css`, `obsidian.css` и Obsidian.jsx в этот путь не включены; их старые цветные декларации не выданы за дефекты живого UI.
- Прочитаны `DESIGN.md`, действующие tokens, компоненты и пользовательские ветви восстановленного renderer. Посмотрены сохранённые screenshots: wide-settings, mini-idle, DNS/соединение/профили/Telegram при 200%. До/после снимки не смешивались.
- Исторический `docs/production-audit-2026-09-30/native-ui/acceptance.json` содержит 24 комбинации размера/экрана/масштаба, взаимодействия и scroll checks. Это предыдущие геометрические свидетельства. В handlers-system.js существуют ветви NODE_ENV=test с createMockSystemDohStatus (`:1047`, `:1119`, `:1264`); прежнюю декларацию «no mocked IPC» нельзя считать доказательством production DNS-readiness. Настоящую readiness проверяет отдельный системный аудит.
- Новый локальный макет: 36 случаев — девять страниц при wide/minimum и двух CSS viewport equivalents для 200%. В этих случаях не найдено горизонтального overflow, page errors или внешних HTTP-запросов; проверены переключение табов клавиатурой и отсутствие действий при demo-click. Это headless HTML-проверка, не новая native Electron-приёмка и не foreground FPS.
- После адресной доработки mini повторены только четыре mini-layout случая. Его карточка теперь **320×415 CSS px**, имеет один primary power-button с accessible name «Проверить состояние щита», отдельные intent/status и выход в полный режим. Нижний visible control достижим после scroll во всех четырёх случаях; wide и минимальный 200%-equivalent render обновлены. Остальные 32 строки матрицы сохранены от первого прогона; это явно записано в latestRound receipt.
- Рассчитаны реальные непрозрачные пары цветов действующего CSS и предложения. Это адресные измерения, не сертификат соответствия всего продукта WCAG.

## Находки

P1 — исправить до следующего stable, P2 — включить в ближайшую управляемую миграцию. «Наблюдалось» означает screenshot либо детерминированное измерение; «код» — достижимый риск из source без заявленного воспроизведения production отказа; «предложение» — дизайнерское решение, требующее приёмки.

| ID / приоритет | Триггер и эффект | Свидетельство / точный locator | Изменение и проверка |
|---|---|---|---|
| D01 / P1 | Щит idle, DNS/TG intent включён. Белый ON и aria-checked=true выглядят как работающая служба, хотя нажатие меняет будущий выбор. | Наблюдалось в mini-idle-zoom1.png; код ShieldWidget.jsx:160–202, :293 и :308. Только container title объясняет «включится при подключении». | Отдельная подпись «Включить вместе со щитом» и постоянный observed state DNS/TG. Проверить idle, connected, отдельную работающую службу при выключенном щите, ошибку и unknown мышью/клавиатурой. |
| D02 / P1 | DNS labels мелкие и недостаточно контрастные. | Наблюдалось; compact-surfaces.css:878–885. `#71717a` на `#0d0e12` = **3.9913:1** для обычного текста. | Использовать semantic dim/muted, увеличить основной status text до body/caption из proposal. Проверить computed foreground/background при default, hover и вложенной панели. |
| D03 / P1 | Ответ статуса отсутствует. DNS renderer выводит «Не установлена» и «Шифрование: Выключено» из Boolean false fallback. | Код renderer.js:11227 и :11238; h2/g2/p2 вычисляются из отсутствующего snapshot как false, ie2=p2. Production failure-path здесь не запускался. | Явный unknown; показать последнюю достоверную проверку и ошибку чтения. Ни «Да», ни «Нет» до факта. Проверить недоступный Core/IPC и поздний устаревший ответ. |
| D04 / P1 | Общий щит и отдельный VPN имеют одинаковые слова подключения/защиты; пользователь может считать щит подтверждением всех функций. | Код ShieldWidget.jsx:147, :227, :251; CompactRuby.jsx:93–122. Щит вызывает shield.connect, обзор — vpn.connect. | Показать область операции: профиль DPI плюс выбранные DNS/TG; VPN отдельно. Общий статус не скрывает failed/degraded компоненты. Нужна проверка понимания пользователями, её ещё нет. |
| D05 / P2 | DNS side-stack использует 10.5px, некоторые метаданные 9.5px. Длинные русские подписи тяжело читать и сканировать. | Код compact-surfaces.css:825, :878, :883, :890; screenshot DNS 200%. | Caption для метаданных, body для состояния/действий. Величина не объявлена обязательным WCAG font minimum: проблема читаемости и иерархии. |
| D06 / P2 | Подсказка повторяет уже видимое описание всех семи настроек; одинаковые help icons добавляют шум и отдельные Tab stops. | Наблюдалось wide-settings.png; renderer.js:11463. | Видимые описания сохранить. Help оставить для дополнительной причины/последствий, которой нет в строке. Не удалять важную информацию из accessible description. |
| D07 / P2 | Telegram управление соединяет установку/переустановку, запуск, внешнюю ссылку и удаление в одной группе. | Код renderer.js:11328; CSS compact-surfaces.css:1312–1327. | Порядок «служба → локальная готовность → настройка Telegram». Переустановку и удаление перенести в обслуживание. Не заявлять «Telegram принял настройку» после успешного openLink. |
| D08 / P2 | Обычный DNS и DNS-ссылка одновременно предлагают разные основные действия; mode/application/measurement плохо разделены. | Код renderer.js:11228–11238. | Одна выбранная конфигурация, parsed preview отдельно от applied state. Старые дополнительные функции сохранить в раскрываемой области до достижения полного parity. |
| D09 / P2 | «Профили» и «Маршруты» пересекаются с VPN, native названия WinWS/IPSet появляются без объяснения задачи. | Наблюдалось Profiles screenshot; CompactRuby.jsx:3; renderer.js:11293. | Назвать раздел «Профили DPI», вкладку с правилами — «Правила», коротко указать домены/IP. Не переименовывать протоколы/адреса и не менять формат backend. |
| D10 / P2 | Иконка действия определяется regex русской подписи; изменение текста может незаметно изменить или убрать glyph. | Код CompactRuby.jsx:41–60. | Явный actionId/iconName в новом component API. Не переписывать весь renderer ради этого; мигрировать изменяемую поверхность. |
| D11 / P2 | Высокая зависимость от последовательности CSS overrides усложняет проверку состояний и размеров. | Измерено: 243589 bytes source CSS, 242 `!important` в шести реально участвующих файлах. Это не доказательство FPS-регрессии. | По одному компоненту перенести anatomy/state styles и удалить только заменённые selectors. Сохранить семантические aliases до удаления всех callers; compile+render после каждой границы. |
| D12 / P2 | Compact при 200% имеет отдельную историческую неполноту приёмки нижних элементов; full-screen PASS не закрывает mini. | Предыдущий native receipt limitations; shield-widget.css:1–17 прячет scrollbar/overflow; новая native проверка поручена root. | Разрешить доступную вертикальную прокрутку mini при крупном масштабе; последняя кнопка и раскрытая ошибка достижимы Tab/scroll, не обрезаются. |
| D13 / P2 | Чёрно-белая палитра требует разных символов и текста для ready/degraded/error, а не близких серых dots. | Код compact-surfaces.css:308–337; screenshots Telegram/DNS. | Символ + слово + область/причина. Белая заливка выделяет действие, не гарантирует «всё защищено». Decorative glow не несёт единственный смысл. |
| D14 / P1 | Quick-on профиля в полном Обзоре запускает standalone вместо уже установленной службы и снимает постоянный запуск. | Подтверждён независимым feature audit FC-03; CompactRuby.jsx:126–128, zapret-manager.js:991–997. Здесь Windows SCM не изменялся. | Сохранять background mode: quick-on установленного компонента → startService → Running/Auto/readiness; временный запуск только отдельной явно названной командой. Приёмка exit/reboot без GUI обязательна. |

Ранее исправленная чёрная галочка под белым выключателем не объявлена вновь неисправной: shield-widget.css:207–227 содержит hover/focus-visible paint rules. Для connected 3.8 нужна отдельная actual-state приёмка; макет и предыдущий 3.7.9 hover её не заменяют.

## Предложение системы

Сохранить бренд, щит, шесть разделов и локальные Manrope/Unbounded. Использовать чистые нейтральные серые фоны, спокойные поверхности, тонкие разделители, белый primary и читаемые outline controls. Heading font остаётся брендовым; обычные сообщения, ошибки и настройки используют Manrope. Адреса/правила/журналы — mono, selectable, wrap-anywhere; secret URI не показывать целиком.

Точные новые значения — только [tokens-proposal.css](design/tokens-proposal.css). `preview.css` — anatomy демонстрационного документа. Геометрия standalone schematic не является отдельным источником runtime tokens. Цветовое кодирование ошибок не требуется для принятого black/white направления: обязательны слово, символ, причина и доступное действие.

| Старый semantic role / компонент | Новый role / компонент | Миграция и условие удаления |
|---|---|---|
| canvas/sidebar/panel/panel-raised | Те же semantic names, нейтральные значения | Сначала изменить одну новую поверхность. Старые screen selectors не удалять до native сравнения. |
| ink/muted/dim | Primary / description / metadata | Убрать hard-coded DNS grey только после readback пары и сравнения всех status rows. |
| line/control-line/line-hover | Декоративный разделитель / actionable boundary / hover boundary | Декоративные границы не обязаны быть яркими; границы, необходимые для узнавания controls, проверяются отдельно. |
| ruby/red-*/compact-accent | Compatibility aliases к action/status/surface | Старые callers оставить до migration parity; новые компоненты не добавляют red/ruby aliases. |
| btn-primary/secondary/danger | Один основной action / обычное действие / maintenance action с последствиями | Action ID и iconName задаются явно. Danger отличается текстом/знаком и размещением. |
| toggle showing actual OR on-connect choice | Preference control + independent observed status | Не объединять два значения в aria-checked. Backend intent и текущая работа хранятся раздельно. |
| dot good/idle/warn/bad | StateBadge с symbol, label, last checked | Ready только по контракту компонента. Last known != current confirmed. |
| ruby-page-heading + duplicated panel titles | Один screen heading + task sections | Длинная русская строка переносится без fixed-height crop. |
| implicit regex glyph / recovered raw buttons | ActionButton с explicit identity | Миграция screen-by-screen, без нового UI framework и без замены всей функции связи со службами. |

## Полные пользовательские потоки

| Экран | Пользовательский результат | Последовательность и завершение | Empty / error / background |
|---|---|---|---|
| Обзор | Понять, что включено, и выполнить одно выбранное действие | Scope щита → профиль и опции → реальная фаза → готовность каждого компонента | Нет status: проверка; сбой одного компонента: видимая строка с причиной. VPN показывается отдельно. |
| Соединение | Импортировать, выбрать и проверить VPN | Импорт → проверка format → узлы → выбор → connect → route readiness | Нет узлов: импорт; старый ping имеет время. App close contract виден. Нет invented throughput/egress. |
| DNS | Применить одну DNS-конфигурацию и проверить разрешение | Mode → endpoint → parsed result → scope adapters → apply → readback → DNS/connection measurement | Unknown и encrypted=false не смешивать. Restore описывает собственный snapshot и чужие изменения. |
| Профили DPI | Выбрать профиль по реальным тестам, сохранить правила и service intent | Выбор/подбор с отменой → все targets/result → apply → installed/running/ready | Неполный подбор не даёт «лучший». Domain/CIDR validation не подменяет адрес. Stop сохраняет off intent. |
| Telegram | Подготовить локальный proxy и явно добавить его в Telegram | Install → local listener readiness → open link → пользователь/доступный проверяемый сигнал подтверждает Telegram | openLink — открыта ссылка, не доставка сообщения. Reinstall/remove в maintenance. Secret masked. |
| Настройки | Понять, какие функции требуют app, и получить диагностический результат | App startup отдельно от service startup → scope updater → verify → install phase → result | Unknown rights/status не success. Требование app/tray для updater остаётся видимым. Export возвращает реальный путь. |
| Mini | Быстро подключить щит и видеть границы операции | Checked state → primary action → pending/cancel → component facts | «Включить вместе со щитом» задаёт intent; отдельно факт DNS/TG. Full settings доступны напрямую. |
| Tray / закрыто | Понимать lifecycle, не потерять наблюдение | Hide-to-tray != exit; exit прекращает app-dependent функции | Службы продолжают только установленный on intent; выход не обещает автономный VPN/updater. Native сценарий требует отдельной проверки. |

Экран «Closed» в HTML — описание сценария; он не закрывает ничего. Заголовок «State-spec» — контракт будущих состояний, не mock соединения. Prototype не воспроизводит все профили, raw configs, импорт файлов, лицензии/about и реальные системные диалоги: существующие функции сохраняются до полной migration parity.

### Сохранение всех 45 функций

[feature-preservation.json](design/feature-preservation.json) сопоставляет каждый F01–F45 из независимого [каталога функций](feature-contracts.json) с местом в шести экранах, mini или уже существующем API-only контракте. У каждой функции указан доступ и guard. Большая часть prototype coverage намеренно partial: наличие схемы не означает, что функция перенесена в runtime.

Обзор сохраняет прямые выбор/connect/disconnect VPN, quick-команды текущих DNS/DPI/TG, адрес/провайдера, measured traffic/скорость/отмену и scoped repair. В макете для части этих действий пока показан entrypoint, а функциональная миграция обязана сохранить прямые команды. Mini сохраняет actual DNS/TG start/stop отдельно от on-connect preference; mock-layout не является поводом удалить эти команды. About, лицензии, titlebar controls, ordinary DNS presets/fields, все profile rules/game filter/IPSet/runtime update и полный Telegram config/log/update остаются доступными в своих main/advanced областях. API-only plan/advanced capabilities не превращаются в обещание работающей экранной функции.

Любое действие при неизвестном ownership сначала читает статус и проверяет границу, затем допускает mutation. В mini это прямо названо «Проверить состояние»; в общем connect-flow обязательный preflight прописан до начала изменения сети. Нельзя отбирать такую проверку ради скорости анимации. Installed service quick-on сохраняет фоновый mode; UI не переключает его на standalone и не включает GUI startup/tray настройку без выбора пользователя. FC-01/FC-02/FC-03/FC-09 должны закрываться вместе с контрактами backend, до принятия migration parity.

## Размеры, элементы и адаптация

Wide использует sidebar и максимум content-width из tokens; компактная ширина заменяет подписи навигации на rail с accessible names и видимой focus indication. У одиночной задачи одна main-scroll область; длинные списки могут иметь отдельную ограниченную прокрутку. Не фиксировать высоту формы/панели ради заполнения экрана. Header и кнопки не должны попадать в ту же область, где scrollbar обрезает их focus ring.

Минимальное product окно и настоящий масштаб Electron проверяются независимо. CSS equivalents 680×450 и 500×340 помогают подготовить layout, но не доказывают правильную физическую геометрию BrowserWindow. Для mini нужен собственный zoom/size договор: если содержимое не влезает, доступный scroll и full-mode, без сжатия текста ниже caption. Новую native размерную политику нельзя выбрать по одному макету — root измеряет реальные возможности desktop.

SVG: общая сетка, одинаковые caps/joins, weight и оптическое выравнивание; navigation/action/state отличаются назначением. [Оригинальные образцы](design/icons-proposal.svg) и [схема](design/layout-map.svg) созданы для проекта. Existing good SVG не нужно регенерировать только ради новизны. Fonts сохранены с OFL в `design/assets/`; новые изображения не заменяют доступный текст.

## Движение и состояния

| Событие | Цель / свойства | Прерывание / reduced motion |
|---|---|---|
| Hover / press | Подтвердить actionable hit area цветом/border; короткая обратная связь | Mouse leave немедленно возвращает paint. Статус службы не изменяется; без постоянной idle-пульсации. |
| Навигация | Короткая смена content, не изменение высоты экрана | Новая навигация заменяет старый переход; focus имеет адресное место. Reduced motion — мгновенно. |
| Реальная операция | StateBadge, actual phase; bytes только измеренные | Нельзя установить «готово» по окончанию animation. Cancel ждёт backend acknowledgement. |
| Dialog / tooltip | Контекст и восстановление фокуса | Escape закрывает; Tab не уходит под modal. Новый ответ не оставляет старый overlay. Reduced motion выключает transform. |
| Connected shield hover/focus | Показать действие отключения, скрыв декоративный check | Один glyph paint; pointer exit возвращает checked glyph, только если state по-прежнему connected. |
| Hidden / renderer recovery | Не тратить постоянные frames; восстановить последнее настоящее состояние | Не возобновлять старую entrance анимацию в неверной фазе. Получить актуальный status перед подтверждением готовности. |

Не добавлять третью библиотеку анимации. CSS достаточно для controls; сохранить имеющийся совместимый runtime переходов до постепенной миграции. Нормативный предел native FPS здесь не измерен. Для полноты проверки нужны frame timings во foreground на представительных low/mid devices и отключённое/degraded network окружение.

## Практическая приёмка редизайна

1. До стабильного выпуска: D01–D04; все системные статусы имеют unknown, pending, confirmed, off и meaningful degraded/error. Отрицательный тест должен поймать известную неверную fallback/checked ситуацию.
2. Каждый основной screen: min/wide, 100/200%, длинный русский текст, длинный endpoint/CIDR, empty/list/error, keyboard. Достижимы последний control, полное сообщение и focus ring; соседние sections не пересекаются. Снимок clean idle не заменяет failure acceptance.
3. Mini: idle/connected/error/unknown/pending + самостоятельные DNS/TG; hover и keyboard focus показывают один action glyph. Отмена не создаёт нового подключения. При 200% раскрытая ошибка и Settings достижимы.
4. Цветовые пары ordinary text ≥4.5:1, крупного text и meaningful non-text ≥3:1; отчёт по computed styles и фактическим backgrounds. Disabled/decorative exceptions отмечаются отдельно. Новый monochrome state различим словом/символом.
5. Lifecycle: actual hide, actual tray, actual exit, user stop, reboot, renderer crash. Контракт автономности подтверждается отдельными service/network проверками. Новый дизайн не объявляется принятым лишь по HTML PASS.
6. Usability: небольшая практическая проверка задач «DNS включён сейчас?», «будет ли VPN работать после выхода?», «почему Telegram не готов?» без подсказки исследователя. Зафиксировать ошибки и время; результаты пока отсутствуют.

## Порядок внедрения

Сначала state semantics и адресные контрастные исправления. Затем мини-щит и overview scope с сохранением controller contracts. Следом Telegram/DNS task layout, после этого connection/profiles/settings и удаление заменённых CSS overrides. Новые controls не должны пересоздавать IPC/API и не требуют массовой переработки сети ради дизайна. Root объединяет утверждённые решения в существующий `DESIGN.md`; этот proposal не становится второй authority автоматически.

На этом этапе дизайн-план конкретен и проверяем, но новый продуктовый runtime не реализован и не принят. Никакого обещания «идеально», безошибочного многомесячного исполнения или доказанной эффективности анимаций здесь нет.

## Артефакты и источники

[Интерактивный локальный макет](design/preview.html), [точные tokens](design/tokens-proposal.css), [проверки макета](design/validation.json), [схема](design/layout-map.svg), [overview render](design/screenshots/wide-overview.png), [mini render](design/screenshots/wide-mini.png). Макет выполняет только навигацию, local form choice и сообщение об inert demo action; сетевые/системные вызовы отсутствуют.

Для повторения проверок сохранён [verify-preview.mjs](design/verify-preview.mjs). Перед запуском задать `LAGOM_DESIGN_WORK_DIR` своим task work из Brain, `LAGOM_PLAYWRIGHT_MODULE` — доступным установленным Playwright (или иметь его в resolution path). Затем запустить script имеющимся Node; TEMP/TMP контролируемого браузера направляются в этот work. Script не устанавливает браузеры/зависимости, не открывает пользовательский browser profile, не поднимает приложение и не вызывает службы. Он обновляет только proposal receipt/renders. Настоящий OS reduced-motion preference в этом прогоне не переключался; проверено наличие соответствующего правила source.

Критерии измерения основаны на первоисточниках W3C, проверенных 30 сентября 2026: [Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [Switch Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/switch/). Minimum target size учитывает исключения и расстояние между целями; предложенный более удобный target — продуктовый выбор, не заявление о новом обязательном стандарте. Primary source не подтверждает вкусовую оценку, качество всего приложения или market superiority.
