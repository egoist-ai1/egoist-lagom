# Сохранение выбора запуска при legacy обновлении

Исправлен конкретный дефект: штатный helper 3.7.9 с `-NoRunAfter` сохраняет `runAfter=false` в своём stage, а embedded legacy bridge новой версии ранее создавал свой stage с `runAfter=true`. Поэтому после успешного обновления могло открыться приложение вопреки выбранному запрету запуска.

Новый helper наследует `runAfter` и `minimizedAfter` через узкую проверяемую проекцию. Вариант обычной установки сохраняет прежние defaults. Lease, watchdog, сервисные snapshots и порядок восстановления не изменены.

## Контракт чтения

- Чтение выполняется только для elevated embedded `-WaitForPreviousReinstall` и только из `state.json` прямого canonical `EgoistShieldInstaller\DeferredRuns\<32 hex GUID>` stage, переданного через существующий handoff.
- Stage/file и их ancestors должны быть обычными путями без reparse points. Файл должен быть обычным непустым leaf размером не более 4 MiB; длина повторно ограничена после открытия. На время чтения file handle разрешает только sharing для чтения.
- Используется существующая production проверка boot-recovery file protection: owner SYSTEM или Administrators; защищённый DACL stage directory; обязательный full control SYSTEM/Administrators; отсутствие чужих write/delete/ChangePermissions/TakeOwnership rights и unsupported deny ACE.
- JSON должен быть объектом с integer `schemaVersion=1`, точным `owner="EgoistShield"` и настоящими JSON boolean `runAfter`/`minimizedAfter`. Строки `"false"`, числа, null, пропущенные поля и чужой owner отвергаются.
- Возвращаются ровно два bool. Installer paths, scripts, services, runtime backups, DNS snapshots и остальные поля старого state не импортируются. Ошибка синтаксиса не выводит содержимое старого JSON.
- Отказ происходит до создания нового receipt/stage, worker или Task. Не выполняется repair чужих прав ради продолжения. Старый worker получает неуспешный handoff и сохраняет свой существующий путь восстановления.

Унаследованное `runAfter=false` нельзя включить новым branded `run_after.txt=1`. При унаследованном true новый выбор `0` может дополнительно запретить запуск. Явный `-NoRunAfter` всегда имеет приоритет. `minimizedAfter` сохраняется; явный `-MinimizedAfter` может дополнительно выбрать свёрнутый запуск. Когда запуск запрещён, этот флаг сам по себе GUI не запускает.

## Проверки и их пределы

Тест `tests/installer-legacy-bootstrap.test.mjs` прошёл без пропусков на Node 24.19.0 с PowerShell 7.6.5 и со штатным Windows PowerShell 5.1. **14 групп** в обоих receipts включают прежние lease/watchdog cases и новые проверки:

1. Точный production AST сохранённого кода до правки воспроизводит `false → true`; AST исправленного dispatch сохраняет `false` при том же входе.
2. Production bool projection читает собственные реальные JSON fixtures, возвращает только два поля и отвергает неправильный schema/owner/type/JSON. Поля с условными foreign paths/services остаются неиспользованными.
3. Реальные Windows security descriptor objects в памяти проходят штатный production ACL validator; отдельно отвергаются чужой owner/write/delete/DACL/owner rights, отсутствие SYSTEM control и незакрытое наследование stage directory. Эти descriptors подаёт ограниченный fixture `Get-Acl` leaf только для собственных тестовых путей. **Это проверка политики, а не утверждение, что fixture на текущем неадминистративном host имеет native доверенного владельца.**
4. Native ACL собственных файлов читается без изменений; фактический untrusted owner отвергается. Реальный собственный файл >4 MiB отвергается до чтения. Реальный собственный junction с canonical-looking GUID отвергается; удаляется только junction, без рекурсии, с проверкой сохранности target.
5. Точный dispatch prefix на malformed bool state отказывает до попытки создать deferred lease/подготовить изменения. Проверяется приоритет explicit `NoRunAfter`, сохранение minimized bool и запрет повторного включения через branded choice. Обычная установка сохраняет default поведения.

Итог финальных запусков: PowerShell 7 — 1/1 Node test PASS, 14 groups, 5663.8624 ms; Windows PowerShell 5.1 — 1/1 PASS, 14 groups, 4629.2704 ms. В test child native PowerShell 5.1 очищается только унаследованный `PSModulePath`, чтобы Core modules от запускающего pwsh не подменяли штатные Desktop modules. Shared environment и host settings не меняются.

PowerShell parser для трёх затронутых `.ps1` — 0 errors; `node --check` теста — PASS; PSScriptAnalyzer для новых production preference functions — 0 findings; `git diff --check` — PASS. Лабораторные данные используют существующий controlled DNS leaf только в прежней recovery-preflight проверке. **Live SCM/DNS/Task/registry/host ACL writes — 0; native installer acceptance runs — 0.**

Настоящий legacy native сценарий теперь требует false bool в новом stage и отсутствие GUI после передачи старого `-NoRunAfter`. Он больше не закрывает неожиданно запущенный GUI для получения PASS: такой запуск завершает проверку ошибкой. Для начального widget используется root-owned shared native navigation: настоящая кнопка «Настройки», затем настоящая «Telegram». Debug flags и привилегированного обхода Core нет.

Результат настоящей установки/обновления на disposable Windows runner ещё должен подтвердить этот контракт с реальным native owner/ACL. Этот документ уточняет прежнюю оговорку о возможном relaunch в `legacy-harness.md`; старые raw receipts сохраняют свой прежний source scope.

## Frozen байты перед handoff

| Файл | SHA-256 |
| --- | --- |
| `scripts/invoke-final-silent-reinstall.ps1` | `cf46d0d48e4b2facaa45855e1484fa8592ed6791d8a565be2d447d14056ec004` |
| `tests/installer-legacy-bootstrap.ps1` | `a595decddb5724dc81589986ffc9af41b39f1bac73225e8ccb2c5f1c4d1bd99b` |
| `tests/installer-legacy-bootstrap.test.mjs` | `a2beeab1c0441a7f5e2cb9fa500c6ababd62e03b8a3ada7f8c0687d28a01915e` |
| `tests/windows-production-legacy-upgrade.ps1` | `499300908d215d72e641e19bd1f6550ebd08157ed2b4f40290d33bb8ca25a367` |

Сохранённый actual before source: `a552d42f5ab52b26dd209173b3c3c7458004ccaa1840df20f3145dec6a5653b3`. Хэши относятся к локальным точным байтам на момент передачи. Native Actions receipt должен записать фактические байты своего checkout и signed build SHA.

Для повторения before/after regression следует явно передать собственный сохранённый pre-fix source через `LAGOM_LEGACY_LAUNCH_BEFORE_SOURCE`; ни скачивание чужого скрипта, ни исполнение полного сохранённого installer helper не требуется. Выполняются только извлечённые проверенные AST фрагменты. Без этого параметра весь набор текущих контрактов остаётся обязательным; исходный before/after replay просто не объявляется выполненным.
