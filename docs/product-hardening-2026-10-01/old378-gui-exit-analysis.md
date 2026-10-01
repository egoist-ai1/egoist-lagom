# Original 3.7.8 GUI: read-only exit analysis

Run **36834226795 / attempt 1**, candidate and harness commit `466862cc00b36277460ccc94cb47f4df891ac14b`, failed before the original 3.7.8 GUI exposed a nonzero native `MainWindowHandle`. **The exit cause is not established.** The artifact has no GUI PID/start timestamp, exit code, stdout/stderr, application log or crash event. The generic wait loop catches the terminal exit and retries until its 90-second deadline, so the reported timeout does not show how long the child actually ran.

The original local 3.7.8 installer was authenticated against its preserved manifest and installed on the disposable hosted runner. Old Core was Running with Auto start and the recorded recovery policy. Its installed trust root/registry/helper matched the old generation and accepted the candidate manifest. The old generation has **an authenticated Ed25519 manifest**, with `authenticodeStatus=not-signed`; public old-release origin and feed discovery were not verified. The candidate 3.8.0 installer and the old helper/new bridge were never reached. This failure cannot substantiate a legacy upgrade pass or be attributed to the new bridge.

The run-bound launcher starts `C:\Program Files\EgoistShield\EgoistShield.exe` with that install directory as cwd, **empty argv**, `UseShellExecute=false`, `CreateNoWindow=true`, and `NODE_ENV=production`. It removes RunAsNode/Node preload/test override variables using the exact regex recorded in the companion JSON. No `--minimized`, CDP, headless argument, helper override or supplied authentication PID is passed. `CreateNoWindow` is a process-launch setting; it is not an application argument. The pre-launch `Assert-NativeNoGui` snapshot found no `EgoistShield.exe` processes, which limits—but does not prove or disprove—the single-instance hypothesis.

The original main bytes were read without execution from the locally preserved ASAR. An independent offline extraction of `resources/app.asar` directly from the authenticated Setup produced the same SHA256 as the baseline and preserved ASAR. The main member matches the original baseline. Its package is ESM (`type=module`); a Node 24.19.0 syntax-only check returns 0. This excludes a syntax parse error under that parser; it does not test native Electron startup. All 13 raw-artifact members match the accepted extracted evidence byte hashes. The four run-bound harness files match their Git blobs or Windows CRLF checkouts; current working files already include parent diagnostic edits and were not substituted for the failed-run source.

| Original payload | SHA256 |
| --- | --- |
| Setup 3.7.8, 194405835 bytes | `34136729f0924e95af65b7fefd2792763c29694056b8ff76a79c9fe0e325f927` |
| Setup-extracted ASAR, 11664308 bytes | `08db1827d678faedab285711f180e6296a8984f122d0c13ed224155d482c9985` |
| `.vite/build/main.js`, 2537193 bytes | `1e15edc490d1d52a789ffc57a23d822d21ef8c11a3346cc922b56c27a88e24e2` |

The exact profile contract in that authenticated main is `app.getPath("appData")\Egoist Shield`. For this packaged production launch, it has **no `-dev` or `-test-<pid>` suffix**. `configureLoggerPaths` writes **`app.getPath("appData")\Egoist Shield\logs\main.log`**, normally **`%APPDATA%\Egoist Shield\logs\main.log`** on Windows. Use the GUI launcher's actual profile/environment to resolve it; do not substitute the Core SYSTEM profile. Main line anchors: runtime/profile 37488–37500 and 58168–58180; log 37689–37692.

The main has three relevant explicit exit paths: failure to acquire `requestSingleInstanceLock` calls `app.quit()` at 59244 without a branch-specific log; an exception in the `whenReady` startup block logs `[boot] app startup failed:` with stack, shows the startup error dialog and quits at 59268–59272; `window-all-closed` quits on Windows at 59276–59277. It creates the BrowserWindow with `show:false` and shows it on `ready-to-show` unless argv contains `--minimized`. Empty argv does not request a hidden startup. Logged stages bracket BrowserWindow construction, managers, Core availability, IPC registration, persisted state and renderer loading. Core availability errors are caught and warned; Running Core alone neither proves GUI completion nor identifies this exit.

Possible causes remain an early JavaScript/native startup error, a single-instance rejection, or a hosted desktop/graphics failure. Inherited environment is also unobserved: the launcher strips `EGOIST_.*`, which does **not** match `EGOISTSHIELD_*`; `VITEST` and `VITE_DEV_SERVER_URL` are not recorded either. Their presence or effect is not established, and the observed production `NODE_ENV` does not justify calling this a mock/headless run. `show:false` alone cannot explain an exited process. No hypothesis is presented as the cause.

Minimal next observation, owned by the parent:

1. Keep the original bytes, empty argv and normal identity. Record the child PID/UTC start, actual safe launch-affecting environment fields and a bounded process/session snapshot before waiting.
2. Redirect and asynchronously drain bounded own GUI stdout/stderr. Persist raw exit code, UTC exit and observed HWND in failure `finally`; treat terminal exit as terminal instead of silently retrying it until 90 seconds.
3. Copy only that GUI profile's bounded recent `logs/main.log`/rotated logs. Preserve the `[paths]`, `[boot]` and `[window]` lines and any original stack.
4. If needed, read time-bounded Application Error/WER events attributable to this exact executable/PID. Record absent logs/events explicitly. No logging flags, RunAsNode, CDP, forged version, helper replacement or trust exception is required.
5. Evaluate the observed branch before retrying mutations: a boot stack identifies a failed stage; no JS boot log suggests failure before logger/startup; exit 0 alone does not establish single-instance rejection.

Only this Markdown and its JSON receipt were added to the project by this diagnosis. No application/installer/helper was executed locally; no production source, SCM/DNS/registry/UI, trust or external API was changed. This is evidence review and a diagnostic contract, not a validated production fix.
