# Проверка настоящего обновления 3.7.9 → 3.8.0

Сценарий подготовлен для отдельного одноразового GitHub-hosted Windows job. Локально выполнены только проверки кода, криптографии над существующими подписанными публичными данными и запрета запуска на неподходящем host. **Настоящих установок этим сценарием пока 0; изменений локальных SCM, DNS, Task Scheduler и registry — 0.** Сам сценарий после успешного native запуска сохраняет `releaseReady=false`: эта проверка не доказывает многомесячную эксплуатацию или весь публичный auto-update flow.

Исходники: `tests/windows-production-legacy-upgrade.ps1`, `tests/windows-production-legacy-upgrade.mjs`, `tests/windows-production-legacy-guard.test.mjs`. Скрипт импортирует только определения функций существующего `windows-production-acceptance.ps1` через `-LibraryOnly`; ранее замороженные acceptance файлы и workflow не изменены. Входы и инструкция ниже относятся к настоящим байтам релизов, без сгенерированных ключей, подмены IPC, результатов SCM или debug исключений в Core.

## Входы отдельного CI job

Сначала выполнить обычный `npm ci` на checkout со сценарием. Нужны PowerShell 7 x64, Node из CI toolchain, действительный повышенный administrator token, штатный native Windows PowerShell 5.1, .NET Framework 4.8 и доступные Windows UIAutomation providers. Сценарий требует точные `GITHUB_ACTIONS=true`, `CI=true`, `RUNNER_ENVIRONMENT=github-hosted`, `RUNNER_OS=Windows`, `GITHUB_REPOSITORY=egoist-ai1/egoist-lagom`, настоящий run ID/attempt и SHA job. Self-hosted, физический локальный host и неадминистратор отвергаются до входов и изменений.

Под `$RUNNER_TEMP` должны находиться два обычных каталога без junction/reparse ancestors:

- `lagom-legacy-old`: точный официальный `EgoistShield-Setup-3.7.9.exe`, `release-manifest.json`, `release-manifest.json.sig`, `release-key-registry.json`, `release-key-registry.json.sig`.
- `lagom-signed-candidate`: точный подписанный `EgoistShield-Setup-3.8.0.exe`, те же четыре metadata файла и точный `package-integrity.json` от этой же сборки. Ни повторная сборка, ни приватный ключ в CI не нужны.

Подписанный candidate `release-manifest.json` schema v2 должен дополнительно содержать `sourceCommit` с полным SHA исходной сборки и `integrityManifestSha256` с SHA-256 точных байтов `package-integrity.json`. Оба поля входят в настоящую Ed25519 подпись. Старый валидатор допускает дополнительные поля. Сценарий сверяет их с явно переданным build SHA, `integrity.source.commit`, установщиком и полным установленным payload. SHA сборки может отличаться от SHA job, содержащего более новый acceptance harness; оба сохраняются в receipt.

Registry проверяется только закреплённым публичным корнем из project `resources/release/root-public-key.pem` (SHA-256 `30c069d617b6e6b1792e7fb6e0f73c17fb659676dd90f6a55d50bc537ac862e7`). Поставляемого извне корня нет. Проверяются подписи оригинальных байтов, schema, canonical tag/URL, key status и validity interval, anti-rollback/material continuity, SHA-256, SHA-512 и размер обоих EXE. Ключ candidate должен быть доверен уже старым bundled registry, а затем — фактически установленным старым registry. Remote registry migration этой проверкой не утверждается.

Официальный 3.7.9 Setup дополнительно закреплён SHA-256 `eb8db40e80201f5e9bf153368da8131325c0253bbc13a842c95f3f2725e04cc6`, соответствующим принятому `docs/reliability-3.7.9/network/publication-3.7.9.json`. Штатный установленный старый helper закреплён SHA-256 `f6c232fa15e4e8f1d78c149f973df8b807d58cabd8ef5898b8b5ce0d2279da8e` из read-only `docs/product-review-2026-09-30/installer/legacy-installed-helper-probe.json`. Несовпадение требует расследования; fallback на новый helper отсутствует.

Точная команда при заполненном `LAGOM_SIGNED_CANDIDATE_SOURCE_SHA`:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File tests/windows-production-legacy-upgrade.ps1 `
  -OldReleaseAssetsDirectory (Join-Path $env:RUNNER_TEMP 'lagom-legacy-old') `
  -CandidateReleaseAssetsDirectory (Join-Path $env:RUNNER_TEMP 'lagom-signed-candidate') `
  -IntegrityManifestPath (Join-Path $env:RUNNER_TEMP 'lagom-signed-candidate\package-integrity.json') `
  -ExpectedSourceCommit $env:LAGOM_SIGNED_CANDIDATE_SOURCE_SHA `
  -EvidenceDirectory (Join-Path $env:RUNNER_TEMP 'lagom-legacy-evidence')
```

Каталоги work `lagom-legacy-native-<run>-<attempt>` и evidence должны быть свежими. До создания work или исполнения EXE проверяется отсутствие всех старых продуктовых/shared-name служб, продуктовых задач/процессов, canonical installation/data/profile и registry registration во всех HKLM/HKCU 32/64 views. Сценарий не удаляет обнаруженное чужое состояние ради старта.

## Что делает настоящий native Run

1. Аутентифицирует оба набора оригинальных release assets. Запускает настоящий официальный old Setup `/S`, проверяет Core SCM path/account/automatic startup/failure policies и отсутствие сетевых изменений.
2. Сверяет установленный публичный корень, registry и старый helper. Запускает настоящий старый canonical GUI без специальных argv и через Windows UIAutomation нажимает штатные Telegram controls. Обычное native window close должно завершить GUI с exit 0. После закрытия проверяет реальную SCM службу, loopback-only listener, PID/birth/parent ancestry до службы и настоящее TCP соединение с этим listener.
3. Копирует уже аутентифицированный новый Setup и создаёт минимальный SHA/size/path handoff JSON того же schema, который генерирует официальный старый updater. Оригинальные подписанные metadata и integrity файл остаются неизменными. Это подготовка валидных входов настоящего old helper, а не подпись нового manifest или замена старого helper.
4. Исполняет именно установленный helper 3.7.9. Наблюдает настоящий старый Worker и Watchdog по native PowerShell path, exact script/stage arguments, PID и birth; обнаруживает новый canonical stage, связанный через `previousReinstallStage`. Требует старый installer exit 62, `failed-recovered`, затем новый `success` и единственный фактический `verify/succeeded` event.
5. Наблюдает новую protected SYSTEM boot Task по реальным Task Scheduler principal/export XML/action/boot-trigger. При её появлении старые worker/watchdog должны уже отсутствовать. Проверяет immutable stage ACL, завершение обеих пар worker/watchdog и удаление recovery Task. Регистрация и удаление Task проверяются реально; reboot и запуск этой Task на boot не выполнены.
6. Проверяет весь фактически установленный candidate payload, Worker inventory, GUI/Worker fuses, ASAR embedded header pin, manifests, ACL и отсутствие forced GUI elevation. Проверяет сохранность точных байтов приватной Telegram конфигурации, её новые приватные ACL, Core/TG startup/failure policies и работу Telegram без GUI. Новый canonical GUI дополнительно открывается и закрывается штатно, с настоящей проверкой Core worker SYSTEM identity.
7. Исполняет настоящий новый uninstaller; проверяет отсутствие продуктовых служб/Tasks/GUI, удаление owned private component state и неизменность DNS/default routes/IPv6 bindings/user proxy/WinHTTP и unrelated service registration/task names.

Сценарий не отключает SCM failure policies для удобства теста и не создаёт отдельную тестовую службу. Все защищённые процессы и задачи создаёт сам продукт. Native GUI не использует CDP, remote-debugging, RunAsNode, renderer flags, dev profile или особую авторизацию Core.

Существующий legacy bridge по прочитанному source может запустить новый GUI несмотря на `-NoRunAfter` старого helper. Сценарий сохраняет реально наблюдённый `bridgeLaunchPreference`; если новый GUI стартовал, он закрывает точно этот canonical GUI обычным native WindowPattern перед проверкой фоновой работы. **Сохранность старого выбора «не запускать приложение» при этом не объявляется доказанной.**

## Evidence и cleanup

`windows-production-legacy-upgrade.json` содержит actual mutation list, source/harness hashes, оба SHA, host/run, реальные SCM/process/Task/ACL/network readbacks и оставшиеся release gates. Сохраняются оригинальные bounded installer/worker stdout/stderr и receipt/heartbeat/Task XML; приватные Runtime backups, сырые state snapshots и содержимое конфигурации не экспортируются.

На успехе выполняется штатный uninstall. На сбое сохраняются результаты и ошибки; force-cleanup не конкурирует с ещё работающим old/new recovery. Одноразовую машину затем уничтожает Actions. `uninstalled=false` на сбое не заменяется вымышленным успешным cleanup.

## Проверено локально

На Node 24.19.0 и PowerShell 7.6.5: **5/5 guard/contract tests PASS, 0 skipped**, 1816.0908 ms; PowerShell parser 0 errors, PSScriptAnalyzer 0 errors / 0 warnings / 0 informational; оба новых JS файла прошли `node --check`. Положительная криптографическая проверка использует существующие настоящие подписанные публичные metadata 3.7.8; отрицательные случаи меняют входные байты/поля и проверяют отказ. Pure source-binding boundary содержит явно обозначенные искусственные данные без подписей. Это не native установка 3.7.8/3.7.9/3.8.0 и не доказательство новой подписи до появления signed candidate.

Прямой запуск настоящего legacy script/helper в текущем не-hosted процессе отвергнут до чтения входов и mutation. Source-bound локальные результаты и хэши находятся в `legacy-harness-receipt.json`, `legacy-guard-tests.txt`, `legacy-validation.json`, `legacy-analyzer.json`.

Отдельно остаются непроверенными: публичное latest-feed обнаружение и actual old GUI updater initiation; 3.7.7/3.7.8 auto-update trust; реальный reboot/interrupted recovery; DNS/TUN/driver endpoints; actual standard-user token; длительный soak. Ни bounded лабораторные tests, ни один успешный native Run не дают гарантии месяцев без сбоев.
