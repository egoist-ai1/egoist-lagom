# Current 3.8 updater review

Scope: maintained 3.8.0 updater and future stable 3.8.1+ path. No old GUI investigation, product launch, SCM mutation, installation or publication was performed. This report is source review and regression evidence, not native update acceptance.

## Fixed: automatic cancellation

Before the change, switching auto-update off during download did not stop the handoff. The scheduler checked the setting before calling `checkAndInstall()`; the later VPN/idle check did not include that setting. Five focused tests reproduced this defect against the original source; two control cases passed.

Automatic attempts now carry a synchronous continuation predicate bound to the preference generation. Turning the setting off invalidates the active attempt immediately in memory, before settings persistence finishes. Turning it back on does not revive that attempt. The updater checks this predicate before download, between stream chunks and retry attempts, after download, around asynchronous installation readiness and immediately before launching the helper. Manual installation does not carry the automatic predicate and remains available with auto-update off.

A cancelled automatic attempt returns failure code `cancelled`. If the user has re-enabled automatic updates, the scheduler schedules a fresh check at zero delay after the old run settles. The regression explicitly fires another timer while the old download remains in flight and confirms that its replacement is retained. Network retry backoff is unchanged.

Cancellation cannot recall a helper that has already been spawned. A preference change while a silent body read is pending is checked when that read settles; the existing 30-second idle deadline bounds that read. Tests use extracted production source, real temporary-file streaming and SHA-256/SHA-512 calculation; network responses, authentication input and helper execution are inert fixtures. No test result is represented as actual Setup, service or published-release success.

## Remaining concrete finding: preparation is mistaken for handoff readiness

`scripts/invoke-final-silent-reinstall.ps1:2076–2078` launches elevated preparation without waiting, reports `elevatedPreparationPending=true`, and exits zero. `desktop-updater.js` accepts that outer exit code as `restarting`; `main.js` schedules application exit after 750 ms. The updater passes `HandoffSignalPath` but never reads it.

On a normal token, a failure in the elevated phase before UI readiness, worker dispatch or signal creation can therefore occur after the application has accepted the handoff and closed. Concrete failure boundaries include protected staging/copy/readback and the existing 15-second UI-ready deadline. This is a confirmed source-contract mismatch; it has not been reproduced by running a native installer here. The parent was notified before further changes. A bounded ready acknowledgement or propagation of the elevated preparation result is required; the installer script is outside this task's edit scope.

## Future release contracts and limits

- Offer: stable tag `v3.8.1`, asset `EgoistShield-Setup-3.8.1.exe`, exact canonical GitHub URL, higher semantic version and compatible `minimumAppVersion`. The package currently declares minimum 3.7.8; a future release may retain that floor or choose a new signed floor.
- Trust: manifest schema 2, detached Ed25519 signature, key from the locally pinned root-signed registry, publication within key validity and at most 15 minutes into the future. Registry refresh supports new key IDs, retained revocations and generation rollback protection; it does not adopt a remote root. The API path also checks GitHub's asset digest. Signed stable-channel fallback covers transport/API failure rather than an invalid signature.
- Download: 1 GiB cap, exact signed size, SHA-256 and SHA-512, Range/If-Range resume validation, three body attempts, 60-second header budget per retry attempt, 20-minute body budget and 30-second idle budget. The candidate is resolved and authenticated again before handoff; a changed candidate is refused.
- Scheduling: packaged Electron main process only, first check after 10 seconds, then daily. Retry delays are 5 minutes, 15 minutes, 1 hour, 3 hours and 1 day. A busy VPN/component transition defers automatic installation by 15 minutes. An observed, stable background VPN service may remain active for the maintenance handoff; temporary runtime, unknown service state, pending recovery or mutation prevents it.
- Closing Electron stops its updater scheduler. Windows services may continue independently, but they do not implement this desktop updater. There is no demonstrated autonomous desktop update while the application process is absent.
- An unavailable remote registry can use authenticated bundled/cached keys and surfaces a warning that new revocations may be unknown. UAC/SmartScreen may still require interaction: accepted Ed25519 release trust does not imply Authenticode signing.
- A future public 3.8.1 package does not exist in this evidence. Valid future signing, publication assets, actual elevation, native handoff, restart and long-running stability are not proved by these tests.

## Checks

Focused RED: 7 tests, 2 passed, 5 failed before source changes. Focused GREEN plus existing scheduler, retry and stream tests: 23 passed, 0 failed, 0 skipped. The off→on/in-flight-timer regression passed in the final run.

Trust/download expansion: 70 tests, 69 passed, 0 failed, 1 skipped. The skipped case explicitly requires `LAGOM_DNS_TEST_PYTHON` or `LAGOM_DNS_TEST_OPENSSL` for its task-owned concurrent TLS lab. An initial expansion was rejected by the registry suite's missing own-work-directory guard; it was rerun with the actual task work path. Existing test sources were not edited.
