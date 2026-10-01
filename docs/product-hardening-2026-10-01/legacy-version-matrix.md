# Настоящие обновления 3.7.8 и 3.7.9

`windows-production-legacy-upgrade.ps1` принимает `-ExpectedOldVersion 3.7.8|3.7.9`, по умолчанию `3.7.9`. Каждый вариант выполняется на отдельном одноразовом GitHub-hosted Windows runner. Каталог old assets содержит только оригинальные Setup, manifest/signature и registry/signature выбранной версии. Node `verify-assets` требует явное JSON-поле `oldVersion`; несовпадение версии, tag, URL, имени EXE, подписи, SHA-256/SHA-512 или размера прерывает проверку. Проверяется также, что подписанный `minimumAppVersion` candidate допускает именно выбранную старую версию.

| Версия | SHA-256 оригинального Setup | SHA-256 оригинального installed helper |
| --- | --- | --- |
| 3.7.8 | `34136729f0924e95af65b7fefd2792763c29694056b8ff76a79c9fe0e325f927` | `e33bca4550b6e130287c8bb2d5c0dccf30b76e033bf99520e81d6c2acda609f5` |
| 3.7.9 | `eb8db40e80201f5e9bf153368da8131325c0253bbc13a842c95f3f2725e04cc6` | `f6c232fa15e4e8f1d78c149f973df8b807d58cabd8ef5898b8b5ce0d2279da8e` |

Pin 3.7.8 получен извлечением только installer helper и трёх trust-файлов из настоящего локального Setup с указанными подписанными SHA-256, SHA-512 и размером 194405835 байт. Использован установленный 7-Zip; Setup не исполнялся, файлы извлечены только в work текущей задачи. Pin 3.7.9 сохранён из принятого read-only [installed helper probe](../product-review-2026-09-30/installer/legacy-installed-helper-probe.json). Положительные crypto tests используют существующий [оригинальный подписанный manifest 3.7.8](../reliability-3.7.9/network/public-artifacts/candidate/release-manifest.json) и точные 785 байт [публичного manifest 3.7.9](https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.7.9/release-manifest.json), сохранённые вместе с его настоящей detached signature внутри guard test. Оба оригинальных registry/signature совпали побайтово. Поддельные ключи и подписи не создаются.

Команда для одного варианта matrix; `LAGOM_OLD_VERSION` задаётся ровно `3.7.8` либо `3.7.9`:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File tests/windows-production-legacy-upgrade.ps1 `
  -ExpectedOldVersion $env:LAGOM_OLD_VERSION `
  -OldReleaseAssetsDirectory (Join-Path $env:RUNNER_TEMP 'lagom-legacy-old') `
  -CandidateReleaseAssetsDirectory (Join-Path $env:RUNNER_TEMP 'lagom-signed-candidate') `
  -IntegrityManifestPath (Join-Path $env:RUNNER_TEMP 'lagom-signed-candidate\package-integrity.json') `
  -ExpectedSourceCommit $env:LAGOM_SIGNED_CANDIDATE_SOURCE_SHA `
  -EvidenceDirectory (Join-Path $env:RUNNER_TEMP 'lagom-legacy-evidence')
```

Сохраняются прежние strict hosted/admin/clean-start/path guards, текущая цепочка Ed25519 доверия, исходный installed helper каждой версии, штатные UIAutomation controls, настоящий old worker/watchdog → new protected bridge, `-NoRunAfter`, приватная Telegram конфигурация/ACL, Core/TG без GUI, отсутствие чужих сетевых изменений и реальный uninstall. Перед dispatch helper повторно сверяется с уже аутентифицированным installed pin; `-FromVersion`, GUI ProductVersion и receipts привязаны к выбранной версии. Prefix вроде `3.7.90` не считается 3.7.9.

Оригинальный schema-1 state helper 3.7.8 содержит Boolean `runAfter`, но не содержит `minimizedAfter`. Отдельное production исправление сохраняет историческую семантику отсутствующего поля как `false`; присутствующее поле обязано быть настоящим Boolean. Native сценарий по-прежнему требует в новом state оба точных Boolean `runAfter=false`, `minimizedAfter=false` и отсутствие неожиданно запущенного GUI. Stage protection, lease, watchdog и запрет импорта остальных полей не ослаблены.

Локально: 8/8 focused tests, 0 skipped, на Node 24.19.0 с PowerShell 7.6.5 и Windows PowerShell 5.1. Проверены настоящие оригинальные подписи обеих версий, перепутанные manifests/signatures, неподдерживаемые версии, version-specific minimum, inert library import, точный ProductVersion и фактический отказ `Run`/`GuardOnly` для обеих версий до inputs/mutations на текущем non-hosted host. PowerShell parser: 0 errors; PSScriptAnalyzer: 0 errors / 0 warnings / 0 informational; оба JS прошли `node --check`, scoped `git diff --check` прошёл. Эти результаты относятся к source/contract guards, а не к установленному обновлению.

Native matrix пока не выполнена. Предыдущий signed CI 36807040747 source `9bf77129ccc2aeac741bf109b8ab6c9368fac558` остановился на получении draft release metadata до установщика. Публичное latest-feed обнаружение и инициирование обновления старым GUI остаются отдельной проверкой; прямой запуск оригинального old helper их не доказывает. Реальные reboot/interrupted recovery и длительная работа месяцами этим сценарием также не подтверждаются. Локальных SCM/DNS/TUN/Task/registry/clipboard изменений при подготовке matrix: 0.
