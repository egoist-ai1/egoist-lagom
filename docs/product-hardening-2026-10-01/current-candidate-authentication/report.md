# Authentication текущего signed candidate 3.8.0

**Готово и заморожено.** Изменён только существующий authentication harness, добавлен новый portable test. Производственный updater и прежние freeze/reports не изменялись. База `15aea7863c8bfaa59fec2ac8c68924ef46ad12a7`. `git diff --check` PASS.

## Интерфейс для workflow

`node tests/windows-production-legacy-upgrade.mjs verify-current-assets <absolute-options.json>`

JSON содержит ровно четыре поля: `candidateAssets`, `integrityPath`, `sourceCommit`, `output`. Все пути абсолютные. Options/output остаются внутри `RUNNER_TEMP/lagom-legacy-native-ID-attempt`; candidateAssets и integrityPath — внутри собственного RUNNER_TEMP. `sourceCommit` обязан точно совпадать с `GITHUB_SHA`. Старые assets/version и внешние pin/key options отклоняются; старые установщики не читаются и не загружаются.

CLI сначала проверяет Windows и прежний disposable GitHub-hosted environment contract; до этого input/output не читаются/не записываются. Затем применяются прежние scope/ordinary-path/bounded-read guards. Успешный отчёт создаётся через `wx`, существующий файл не заменяется.

## Trust и результат

Baseline — только bundled `resources/release/root-public-key.pem`, `release-key-registry.json/.sig`; неизменный настоящий root pin `30c069d617b6e6b1792e7fb6e0f73c17fb659676dd90f6a55d50bc537ac862e7`. Реестр candidate проверяется Ed25519 и обязан быть допустимым successor baseline без rollback, замены существующих ключей или возврата revoked key.

Повторно используются существующие строгие validators schema2 stable 3.8.0, canonical installer URL/name/tag, подписи/сроки ключа, signed source/integrity и SHA256+SHA512+size потокового чтения настоящего installer файла. CLI не принимает supplied trust/pin. Только экспортированная чистая граница для portable tests позволяет явно указать digest своего fixture root; CLI вызывает default project pin.

Успех: `ok=true`, `kind=current-candidate-authentication`, `candidate`, `sourceCommit`, root/bundledRegistry/candidateRegistry/candidateManifest/integrity hashes и `installer={sha256,sha512,bytes}`. Криптографическая подпись release metadata не подменяет Authenticode: прежняя политика manifest `valid/not-signed` не менялась.

## Проверка

**14/14 PASS**, exit 0, **162.0147 ms**, 0 skipped. [Полный финальный log](final-14-pass.txt), [промежуточные 13/13](intermediate-13-pass.txt), [harness diff](authentication.patch), [машиночитаемый отчёт/хэши](report.json).

Настоящие public root/registry bytes проекта прошли реальную Ed25519 проверку. Положительный candidate fixture использует настоящие криптографические Ed25519 операции с **явно сгенерированными inert test keys/pin** и синтетическим payload 4096 bytes; private keys остаются в памяти. Это не настоящий опубликованный/собранный 3.8 installer. Default project pin отдельно отказал этой fixture.

Отрицательные проверки: tamper manifest/registry signatures, integrity bytes, source commit, действительно root-signed registry rollback, installer bytes, каждый SHA256/SHA512/size; дополнительные старые/внешние trust options, несовпадение GITHUB_SHA, выход путей/relative candidate. Настоящий local CLI с declared non-hosted environment отказал до разбора заведомо malformed input и не создал output. Hosted guard остаётся прежним контрактом окружения, не независимой аттестацией hardware host.

Локально не выполнялись full native old versions, download/access старых installer файлов, установка, службы/DNS/реестр/GUI, build/sign/publication. **Настоящие шесть signed candidate assets обязан проверить hosted workflow**. Future updater принадлежит другому agent; этот режим проверяет текущую 3.8.0.

## Frozen SHA-256

- `tests/windows-production-legacy-upgrade.mjs`: `ff0568677b6071b3830816707c6fe4cda23016671c5860c3fb8f82a875b6612a`
- `tests/windows-signed-current-assets.test.mjs`: `e10d2948dc2f6f854b922f2f6cd30d615dd9149a2a8bd9434804490e7f44c879`
