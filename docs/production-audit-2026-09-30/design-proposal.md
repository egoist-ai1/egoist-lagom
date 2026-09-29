# Предлагаемый контракт дизайна Lagom

Статус: предложение к реализации после исходного аудита, 30.09.2026. Этот документ не создаёт вторую текущую дизайн-систему: после проверки кандидата решения следует перенести в проектный `DESIGN.md` и один источник токенов. Авторитетный исходный продукт — Egoist Lagom 3.7.9; мини-щит и чёрно-белая идентичность сохраняются.

## Назначение и направление

Главная задача — понимать, что действительно работает, включать нужный сетевой компонент и видеть понятную причину отказа. Основная поверхность — операционный инструмент Windows, который остаётся читаемым в маленьком окне. Визуальный язык: глубокий тёмный фон, различимые нейтральные поверхности, белая primary action, лёгкая сетка, спокойные SVG. Акцент нужен действию; состояние подтверждается текстом и формой.

## Токены

Все точные значения определить в `src/brand/tokens.css`; прочие файлы используют семантические роли.

| Role | Значение | Назначение |
|---|---|---|
| `--canvas` | `#07080b` | Фон рабочего поля |
| `--sidebar` | `#0a0b0f` | Навигация и chrome |
| `--panel` | `#0d0e12` | Секция с настройками |
| `--panel-raised` | `#14151b` | Вложенные control/list rows |
| `--panel-hover` | `#1b1c23` | Hover нейтральных действий |
| `--ink` | `#f6f6f8` | Основной текст |
| `--muted` | `#b2b2b8` | Вторичный enabled текст |
| `--dim` | `#92939b` | Терциарные подписи, не ошибки |
| `--line` | `#2c2d35` | Структурные разделители |
| `--control-line` | `#63646e` | Контур input/control, если он нужен для идентификации |
| `--line-hover` | `#82838d` | Hover input/control |
| `--ruby` / `--action` | `#ffffff` | Primary action/selected state compatibility |
| `--ruby-hover` / `--action-hover` | `#e4e5eb` | Primary hover |
| `--action-ink` | `#07080b` | Текст primary action |
| `--focus-ring` | `#ffffff` | Focus-visible 2px + offset 3px |
| `--status-ready` | `#ffffff` | Подтверждённая готовность, check + текст |
| `--status-warning` | `#d6d7de` | Требуется проверка, triangle + текст |
| `--status-error` | `#f0f0f4` | Ошибка, alert/outlined treatment + текст |

Семантическая ошибка должна отличаться иконкой, словом, контуром и расположением, даже в монохроме. Не понижать её до dim. Структурные разделители не обязаны конкурировать с текстом; meaningful controls получают контур и focus. Предварительный расчёт `muted/panel` 9.143:1, `dim/panel-raised` 5.958:1; это заданные пары, которые необходимо проверить в computed style вместе с opacity.

Crosswalk: `--bg-0 → --canvas`, `--bg-1 → --panel`, `--bg-3 → --panel-raised`, `--text-main/--text-strong → --ink`, `--text-muted/--compact-muted → --muted`, `--text-dim → --dim`, `--primary-button/--red-500/--compact-accent → --action`, `--border-default → --control-line`. `--text-faint` остаётся alias `--dim` до удаления callers; `--compact-*` сохраняются как aliases, чтобы миграция не ломала невидимые состояния. Старые цветные названия не использовать в новых компонентах.

## Типографика

- Brand mark и крупные page headings: Unbounded, 550–650, 22–24px / 1.25; wordmark 11px. Это узнаваемая часть Lagom.
- Body/navigation/forms/tables/dialog copy: локальный Manrope variable, 13–14px / 1.5, normal weight 450–500, action/section heading 600–650. Минимум 12px для вторичных важных пояснений; 11px только метаданные, не единственный источник ошибки.
- IP, IPv6, URL, host:port, CIDR, path и сообщения журнала: `ui-monospace, 'Cascadia Code', Consolas, monospace`, 12–13px / 1.5. Длинные значения wrap-anywhere; короткие статистические числа — tabular-nums.
- Не использовать глобальную звёздочку с `font-family:... !important`; controlled component roles остаются переопределяемыми. У body font-stack Manrope/Segoe UI и кириллические subsets. Unbounded и Manrope уже есть в package dependencies; проверить/упаковать OFL и локальные latin/cyrillic fonts.

## Компоновка и плотность

Окно: titlebar 40px, sidebar 184–192px, main padding 24px; большой экран ограничить content width 1440px с честным заполнением. Sidebar остаётся recognisable icon+label. При CSS width ≤900px — rail 64px с accessible name/title; ≤720px — одна колонка. Минимальное нативное большое окно 1000×680 остаётся достижимым; 200% zoom проверяется отдельно. Главный scroll принадлежит screen-stage, вложенный scroll нужен только длинным спискам/logs.

Панели: radius 10–12px, layout gap 16px, padding 20px (16px в плотном окне), линии отделяют группы. Один блок primary action на действие; maintenance и destructive actions ниже/позже рабочего сценария. Группы настроек размещать сверху вниз; отказаться от принудительного `space-around`, который разносит короткие настройки по пустой высоте. Длинный hint должен увеличивать row height, а не обрезаться.

`Обзор`: primary route card с выбором сервера/результатом/подключением; рядом external IP/проверка выхода; под ним компактный перечень компонентов с настоящими status text и shortcut «Настроить»; traffic — измеренные данные или «Нет данных»; recovery — secondary action с точным preview изменяемых настроек.

`Соединение`: список серверов с полноценной строкой (name, protocol, latency status), connect action, избранное; subscription/import ниже или рядом. Empty state даёт один понятный следующий шаг «Импортировать подписку»; IP/CIDR читается моноширинным текстом.

`DNS`: основной сервер/DoH URL и реальная применённая конфигурация; secondary test/recover. Отличать configured, listener ready, проверено, не проверено, failed и внешний DNS query. IPv6 не обрезать в одну строку без доступного полного значения.

`Профили`: ready/running статус, выбор и подключение, автоподбор с настоящим coverage и историей; destructive maintenance отделить. History/Routes — реальные accessible tabs. Рекомендованный профиль не объявлять универсально лучшим: показывать measured scope/time.

`Telegram`: installed/running/listener/route разные строки; установка, start/stop, добавление ссылки; advanced collapse с unsaved conflict, secret остаётся password. Logs — preview + keyboard раскрытие, полный текст без отдельного запуска редактора, внутренний scroll. Network addresses mono.

`Настройки`: поведение, connection/reconnect, privacy, update/diagnostics. Короткие подсказки важных ограничений видимы (в том числе работа GUI для проверки обновления). Advanced explanations доступны help. Версия выводится фактическая. Firmware/runtime и приложение не объединять в неясное «всё обновлено».

## Компоненты и состояния

Controls: primary/input 40px; secondary 36px; compact button/icon minimum 32px; toggle hit box 40px с треком 32×18. Редкие destructive действия показывают понятную надпись и confirmation scope. Не переносить всё в icon-only ради внешней чистоты.

Сетевой component row: icon, title, short purpose, **status**, configure action, switch. Status имеет unknown / off / pending / ready / failed / degraded, серверный `lastError` выводится доступно. Switch true только при подтверждённом readiness. При unknown не выдавать false за «точно выключено». Последний удачный статус при потере IPC можно оставить только с явной пометкой «Состояние не обновлено», временем и retry.

Dialogs: dialog role, labelled heading, description, focus trap, close/Cancel, Escape, restore focus; backdrop блокирует фон. Tooltips: доступны hover/focus, Escape, не меняют фактическое действие, в крайних положениях входят в окно. Log disclosure: реальный button или details summary, expanded/full текст, collapsed capped preview; timestamp/level всегда видимы.

Mini-widget: размеры/контур бренда и готовность настоящих служб сохраняются. Connected check → hover whitepower — без overlap; focus даёт одинаково понятный action. Включённый checkbox preference при idle не равен реально работающему DNS: пояснить намерение и действующее состояние. Error/retry всегда достижимы в маленькой высоте, при 200% zoom.

## SVG и motion

Существующие собственные SVG с viewBox24/outline1.65 уже согласованы, не заменять качественный каталог лишь ради слова «новый». Переданные icon names должны соответствовать semantic action. Новые glyphs рисовать вручную в SVG (вектор), stroke1.65, roundcaps, optical bounds20px; logo сохраняет узнаваемый щит. Проверить warning glyph: нынешний дополнительный рисунок линий усложняет маленький знак; если rendered 16px не читается, упростить до triangle+exclamation.

Motion: hover background/border/opacity 120–150ms ease-out; press translateY1px 80ms; screen switch opacity120ms; modal opacity+translateY4px 160ms (без bounce); component progress только по backend phase. Не делать имитационный процент и не превращать unknown в completed ради плавности. При prefers-reduced-motion убрать перемещение/scale/decorative loops; spinner может стать статичным icon+«Выполняется». При hidden отключать idle animation и не стартовать тяжёлую entrance timeline; новое состояние остаётся сразу корректным после возврата. Foreground FPS измеряется отдельно — скрытые capturePage кадры этого не доказывают.

## Проверка внедрения

Исправления контракта window-close/tab/log и отображения ошибки проверять поведением, не зеркальными regex тестами только на classname. Root запускает настоящий собранный кандидат в точном скрытом instance, без изменения системного фокуса и without fake IPC. Font hashes и source provenance связать с пакетом. Новые fixtures допустимы как отдельные renderer unit checks, но подписывать их как tests, а не как работа настоящей сети.

Приёмочная матрица, ограничения evidence и приоритеты приведены в [ui-audit.md](ui-audit.md). Design cleanup не должен менять сетевую конфигурацию или означать долговременную стабильность автоматически.
