# Telegram: финальная ограниченная visual QA

Проверены **12 состояний** на built production renderer: первое чтение, отказ status, read-only retry в ожидании, конфликт черновика, ожидание dirty-save и ожидание install. Два размера: 1060×760 (DPR 1) и 400×600 (DPR 2). Headless Chromium 151.0.7922.34, Playwright 1.62.1.

Все ответы `egoistAPI` — явно обозначенные **IPC fixtures**. Ни служба Windows, ни привилегированный IPC, ни реальная сеть здесь не проверялись. Изображения не являются доказательством native service PASS.

## Наблюдения

- 46 проверок центров доступных элементов после обычной DOM-прокрутки: 0 перекрытых или недоступных центров. Это повторные наблюдения по состояниям, не 46 разных кнопок.
- 0 горизонтальных выходов документа, элементов и видимых текстовых диапазонов; вертикальная прокрутка компактной формы ожидаема.
- 0 renderer exceptions, внешних запросов или изменений source/build во время принятого прохода.
- Unknown/rejected/pending не создают зелёной готовности в Telegram-form. Поля и config-dependent действия недоступны до подтверждения и во время save/install.
- Tab → Shift+Tab показывает keyboard focus на retry и выборе конфликта; Enter вызывает именно эти обычные действия. Read-only retry не вызывает save/install. Черновик 2443/12 сохранён при внешнем наблюдении порта 3443; после явного выбора он сохраняется один раз и install начинается лишь после подтверждённого readback fixture.
- `prefers-reduced-motion: reduce` активен в обеих ширинах; при 12 измерениях активных CSS/Web Animations не обнаружено. Это не измерение плавности native Electron или скорости настоящей установки.

Первый вспомогательный проход ошибочно трактовал `scrollWidth` focus-псевдоэлемента и внутреннюю прокрутку password-input как clipping. В принятом проходе измеряются реальные границы документа/элементов и видимые текстовые Range; внутренний input scroll оставлен в `internalScroll` измерений. Production не менялся.

Небольшая реальная несогласованность текста передана родителю: shared HUD для `tg-install` показывает «Установка службы оптимизатора» и «owned службу» вместо обычного названия службы Telegram. Она видна на pending-снимках и не блокирует этот сценарий. Визуальная QA сама не изменяла этот текст.

## Evidence и граница source

[Измерения](measurements.json), [receipt](receipt.json), [сырой вывод](run.txt) и [task-owned harness](telegram-final-visual-qa.mjs). Harness использует asset snapshot/server/fixture preamble существующего `scripts/check-compact-ui.mjs`; полные 31 старых кейса и 47 Node checks не повторялись. Все 12 PNG, их SHA-256, source/build manifest находятся в receipt/measurements.

Вручную просмотрены: [first-load 400](fixture-400-first-load.png), [rejected focus 1060](fixture-1060-rejected-focus.png), [conflict focus 400](fixture-400-conflict-focus.png), [dirty save pending 400](fixture-400-dirty-save-pending.png), [install pending 1060](fixture-1060-install-pending.png).

Renderer LF SHA-256 этого визуального прохода: `947836bac950728a674bdc35fede32a03d7eb2bcfbaaf2019c061235704852f4`. Снимки привязаны к предварительной сборке **до отдельного точечного исправления нормализации raw32-secret, начинающегося на dd**. Этот subsequent secret-only change требует собственных callback/contract tests и финальной сборки; данные изображения не переобозначаются как её native acceptance. Полная UI-галерея, packaged/native UIA и месяцы непрерывной работы этим ограниченным проходом не подтверждаются.
