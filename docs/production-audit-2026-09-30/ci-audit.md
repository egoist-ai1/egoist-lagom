# CI audit and candidate build contract — 2026-09-30

Scope: `.github/workflows/ci.yml`. This audit changes CI configuration only. It does not dispatch a hosted run, publish a release, sign binaries, install services, or establish redistribution/licensing completeness.

Reviewed final workflow SHA256 after Core/log-guard integration: `2769139E522751314B85F1939911B50F59F61ECD47C418E986427032C2567FD8`. This final validation was read-only; only this report was updated after the root executor changed the workflow.

## Findings and changes

1. **The previous `10.0.x` SDK selection could differ from the packaging contract.** Both jobs now read the exact stable SDK from `global.json` (currently `10.0.401`) and install it into a job-owned directory under `RUNNER_TEMP`. The tests also install `8.0.x` for existing regression targets. Each job checks the actual SDK executable version before further work. This isolation matters because `global.json` allows `latestPatch`: setup-dotnet's `global-json-file` option honors that roll-forward policy, while an explicit `A.B.C` version installs that exact SDK. [Official setup-dotnet v6 contract](https://github.com/actions/setup-dotnet/blob/v6/README.md).
2. **The TLS fixture previously depended on an implicitly available certificate tool.** Checks now resolve the current Git installation's `usr/bin/openssl.exe`, require that file, verify `openssl version` succeeds, and set `LAGOM_DNS_TEST_OPENSSL` plus `LAGOM_DNS_TEST_WORK`. This enables the existing local TLS fixture with generated certificates; it does not change production certificate validation. Missing or unusable OpenSSL fails the job explicitly.
3. **CI did not build a reviewable installer candidate.** `workflow_dispatch` now offers a boolean `package_candidate`, default `false`. The candidate job runs only for an explicit dispatch with that option enabled and after the checks job succeeds. It invokes the existing checksum-verifying `scripts/bootstrap-build-inputs.py` with an explicit 7-Zip executable and runner-owned work directory, then builds and runs the existing Windows packager.
4. **Failures must stop packaging and upload.** Every added native command checks `$LASTEXITCODE`; required tool paths, stable metadata, SDK version, source timestamp and final installer integrity are asserted. The workflow compares the produced installer's SHA256 and byte length with `dist/package-integrity.json` before uploading the candidate. The mandatory native-source ZIP is also checked against `nativeSources.sha256` and `nativeSources.bytes` after the complete test suite and before upload.
5. **Artifacts need a clear trust boundary.** Workflow and candidate job permissions are `contents: read`; checkout does not persist credentials. No signing key, secret, release-upload or publishing step was added. The candidate artifact contains the versioned unsigned setup EXE and SHA256, versioned native-source companion ZIP and SHA256, plus package integrity JSON. Build evidence is a separate artifact, retained for seven days and uploaded after preparation even when later build steps fail. Whole workspaces, arbitrary recovered input trees and local credentials are not uploaded; the source companion is produced by the dedicated packager.
6. **Artifact-dependent tests require an actual package.** The optional candidate job now runs the complete `npm test` again after packaging, before uploading the unsigned candidate. All release/packaging/trust/TLS fixture paths are under the candidate runner's work directory, with explicit Python, Git OpenSSL and actual packaged Xray paths. This enables the three real-installer `PlanOnly` regressions that ordinary source checks skip without `dist` artifacts, along with real Xray config/fault tests. Missing artifacts or runtime tools fail before the suite. The suite's exit status gates unsigned upload; its log and test-input metadata go to build evidence. Installer hash/size is checked again after tests.
7. **The log-maintenance guard needs the actual Core assembly and native filesystem fixtures.** Checks now build `src/service/EgoistShield.Service.csproj` in their runner-owned `LAGOM_TEST_TEMP` intermediate/output directories, with `RestoreLockedMode=true`, `PublishSingleFile=true` and `SelfContained=true`. The workflow requires the resulting `EgoistShield.Service.dll`, then passes that exact assembly to `OwnedWrapperLogMaintenanceRegression --core`. It sets `LAGOM_TEST_POWERSHELL` to `$PSHOME/pwsh.exe` and requires that file for the native long-path/junction fixtures. Build and regression exit codes fail the job explicitly. This is an inspected execution contract, not a claim that the hosted filesystem/Core test already passed.

Existing action major versions were preserved: checkout v4, setup-node v4, setup-dotnet v6 and setup-python v5. The new artifact uploads use upload-artifact v4.

## Packaging interface inspected

- `scripts/bootstrap-build-inputs.py` requires an explicit full `--seven-zip` path and an absolute existing `--work-dir`. It checksum-verifies the pinned upstream recovery installer before extracting build inputs and delegates pinned component/runtime recovery. It does not execute that recovery installer.
- `scripts/package-windows.mjs` requires the SDK version selected by `global.json` and an absolute `SHIELD_EVIDENCE_DIR`. Candidate CI provides `SHIELD_DOTNET`, `SHIELD_MAKENSIS`, `SHIELD_SEVEN_ZIP`, evidence and temporary paths from its own runner.
- Core packaging performs `dotnet restore --locked-mode -r win-x64`, followed by `dotnet publish --no-restore`, and records restore/publish diagnostics. CI invokes that same packager rather than introducing a second packaging implementation.
- The Windows packager now requires `dist/Egoist-Lagom-$version-native-sources.zip` and its SHA256 file, records path/bytes/digest/sourceArchives/coverage under `package-integrity.nativeSources`, and checks readback after NSIS. Candidate CI requires that exact versioned path and both files before tests, then independently checks the ZIP digest/size after tests. Packaging or CI checks were not run as hosted jobs here. Archive presence and integrity do not certify that every licensing obligation is satisfied.
- `SOURCE_DATE_EPOCH` is derived from the source commit. Artifact names include package version and commit SHA. These help associate a candidate with its inputs; they do not prove byte-for-byte reproducibility.
- Node dependencies use `npm ci`; the bootstrap retains the existing pinned digests and component descriptors. No bootstrap, installer, service or release-signing source was changed by this CI task.

## Local verification

| Check | Result | Scope |
|---|---|---|
| Existing workflow actionlint before change | PASS | Baseline syntax/schema |
| Updated workflow actionlint 1.7.12 | PASS, exit 0 | GitHub Actions syntax, expressions and job context rules; shellcheck/pyflakes disabled |
| PowerShell parser on every `run` block | PASS, 17 scripts, zero parse errors | Every final run block, including the Core/log-guard step, parsed locally; commands were not executed as hosted jobs |
| `git diff --check -- .github/workflows/ci.yml` | PASS | Whitespace; Git may warn about normal LF/CRLF conversion |
| Frozen workflow SHA256 readback | Matches hash above before and after validation | Exact reviewed final CI file remained unchanged throughout actionlint/parser checks |

An initial local lint failure caught an invalid `runner` context in job-level environment values. The final workflow sets those paths through `GITHUB_ENV` in a preceding step; the final checks above passed after that correction.

## Evidence limits and required follow-up

No hosted GitHub Actions run or candidate dispatch was executed during this task. Local parser/linter success does not establish that downloads, Chocolatey tools, runner image contents, NSIS compression, artifact upload or all tests will succeed on a hosted runner. After integrating the change, run checks on the intended commit and dispatch the optional candidate job once; retain its successful job URL and artifacts as hosted evidence before using this CI path for release preparation.

The ordinary checks job supplies OpenSSL to the TLS fixture, but this report does not claim hosted TLS tests ran. The ordinary checks job does not build an installer or recover a real Xray binary. The opt-in candidate job supplies both after verified packaging and invokes the full suite with them. Real Xray tests use bounded local laboratory upstreams and unprivileged listener ports; installer artifact tests use `PlanOnly`. These checks do not establish production service installation or external DNS reliability.

The full toolchain is not immutable: `windows-latest`, Node 24, .NET 8.0.x, Python 3.12, Chocolatey packaging tools and action major tags can change. Exact packaging SDK, dependency locks, source timestamp and verified downloaded inputs reduce drift, but an unsigned candidate remains a review artifact. Its existence is not a signed-update trust proof, licensing approval, production deployment approval, native installation validation or evidence of months of continuous service uptime.
