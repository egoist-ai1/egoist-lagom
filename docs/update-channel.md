# Обновления Egoist Lagom

Версии 3.7.8 и новее содержат ключ восстановления подписанного канала, используемый опубликованным релизом 3.7.9. Для 3.7.7 и более ранних требуется один ручной запуск официального установщика: прежний закрытый ключ не найден, и новые метаданные нельзя безопасно подписать от его имени. Не отключайте проверку подписи ради перехода.

Автоматическая проверка и установка обновлений выполняются, когда запущен процесс приложения, в том числе в свёрнутом состоянии. Фоновые службы работают без интерфейса, но самостоятельно приложение не обновляют. Установка откладывается при активном VPN, изменении компонентов или восстановлении после запуска. Неудачная загрузка возобновляется с проверкой диапазона, размера и SHA-256/SHA-512. Успешная передача установщику ещё не означает успешное завершение установки; итог подтверждается отдельной записью установщика и проверкой служб/DNS.

Проверка подписи, размера файла и контрольных сумм сохраняется. Ошибка проверки или недоступность канала не считаются подтверждением актуальности версии. Подпись метаданных Ed25519 не является Authenticode-подписью EXE: Windows может показать штатное предупреждение о неизвестном издателе.

## Подготовка релиза разработчиком

Локальные закрытые ключи находятся в `.local/release-secrets`, исключены из Git и защищены ACL. Не публикуйте эту папку. Публичный идентификатор текущего ключа — `release-2026-09-recovery`; его наличие и срок проверяются по подписанному `resources/release/release-key-registry.json`. Скрипт требует явный абсолютный путь к закрытому ключу и сверяет его с этим реестром до записи релизных файлов. Отсутствующий ключ не регенерируется автоматически.

```powershell
node scripts/prepare-release-assets.mjs --private-key "<absolute-path-to-release.private.pem>" --key-id release-2026-09-recovery
node scripts/prepare-release-assets.mjs --verify-only true
python scripts/release-github.py verify
```

Финальная публикация выполняется после проверки нового установщика в Windows 10 и Windows 11. До этой приёмки локальная сборка остаётся кандидатом.

## Входы чистой сборки

Закреплённые версии sing-box, Flowseal и Wintun находятся в `scripts/component-inputs.json`. Bootstrap и упаковка читают один файл; существование ZIP или распакованной папки само по себе не считается проверкой. До копирования упаковка сверяет каждый файл с ZIP, а после копирования проверяет получившиеся байты. Изменённый кеш отвергается, не исправляется поверх него автоматически.

Для новой рабочей копии нужны Node.js 24, Python 3.11+, .NET SDK из `global.json`, NSIS и полный 7-Zip. `SHIELD_EVIDENCE_DIR` должен указывать на существующий абсолютный рабочий каталог текущей задачи; временные загрузки и распаковки остаются там. Восстановленный установщик 3.5.4 используется только как закреплённый ресурс для извлечения, не запускается.

```powershell
npm ci
python scripts/bootstrap-build-inputs.py --seven-zip "<absolute-path-to-7z.exe>" --work-dir "$env:SHIELD_EVIDENCE_DIR"
npm run build
npm run package:win
```

Bootstrap включает закреплённый Electron. Для уже полученных компонентных архивов доступны отдельные проверки `download-component-candidates.py --offline --work-dir ...` и `download-wintun.py --offline --work-dir ...`; сетевой запрос и новая загрузка при этом не выполняются. Это проверяет архивы и извлечённые файлы, а не установку на целевой Windows.
# Native distribution acceptance

`component-inputs.json` also pins official WinSW `2.12.0` `WinSW.NET461.exe`.
Packaging authenticates its size/hash before copying and records it in the
runtime manifest. This variant uses installed Windows .NET Framework 4.8 or
newer; the installer must check that prerequisite before touching services.

Full native notices and exact source input hashes are under `resources/licenses`.
Before offline release packaging, hydrate the bounded source companion once:

```powershell
python scripts/prepare-native-sources.py --work-dir $taskWork
python scripts/prepare-native-sources.py --work-dir $taskWork --offline
```

The command uses project `recovery/native-sources`, writes
`dist/Egoist-Lagom-<version>-native-sources.zip` and its SHA-256 file, and returns
one JSON object containing `path`, `bytes`, `sha256`, `sourceArchives` and
`coverage`. `--output` accepts an absolute alternate ZIP path. Release preflight
for `3.8.0+` requires the companion to match `package-integrity.nativeSources`.

The companion includes all 135 modules recorded in shipped sing-box, its exact
source commit, and Cronet's exact native builder and naiveproxy gitlink source.
This does not mean external Chromium `DEPS`, toolchains and sysroots have been
hydrated or rebuilt. `SOURCE-DIRECTIONS.txt` describes the precise limits;
neither package checks nor this inventory assert complete legal compliance.
