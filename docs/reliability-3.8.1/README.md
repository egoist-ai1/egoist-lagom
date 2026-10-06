# Reliability cycle 3.8.1

The accepted scope is daily reliability, safe local state recovery and autonomous Core/DNS/DPI/Telegram services. Normal screens remain available for viewing during storage failure, with a persistent reason, manual retry and bounded automatic reload. Isolated Windows acceptance must precede the authorized ordinary UAC upgrade. No monetization, accounts, telemetry or new cloud dependency is part of the product.

| Product change | Required behavior |
| --- | --- |
| StateStore separates missing, unavailable and corrupt data | A temporary read failure cannot replace profiles or a verified backup |
| Current profile is authoritative; legacy migration is atomic and one-time | Deleted subscriptions stay deleted across restarts |
| Snapshot/retry IPC and readonly guards in the window and miniature shield | Recovery restores editing without restart; stale reads cannot replace an acknowledged revision |
| Generation-fenced reconnect and verified DPI suspension | Manual OFF persists; failed SCM stop cannot report ready |
| Held-child heartbeat and native ownership checks | Path, process birth and ownership remain mandatory |
| Telegram OFF completion is distinct from later foreign-port readiness | Completed OFF stays successful; cleanup failures remain failures and the next ON refuses a foreign listener |

The most recent completed immutable run, [37451252115](https://github.com/egoist-ai1/egoist-lagom/actions/runs/37451252115), used source `8565a9b9a9f7457eadd2347778283873e2bf4083`. Source checks passed 1637/1652 with 0 failures and 15 pre-package skips; bundled-runtime checks passed 1648/1652 with 0 failures and 4 skips. Core (27 groups) and DoH (39 groups) passed. Actual bundled Xray26.5.3 answered 128 loopback DNS queries at concurrency 16. These establish local packaged behavior, not external reachability or a performance improvement over a different VM.

Native acceptance did not pass. The actual protected 3.8.0-to-3.8.1 upgrade completed in 87.84s with its recovery task removed; the installed Telegram listener persisted without GUI. Telegram's occupied-port attempt was refused by Core for the actual retained actor, but the GUI observer did not recognize the Electron-wrapped error. Native UIA text rows were not captured, so this mismatch is not claimed as the only native cause. Core recovery, reinstall, the 120-minute observation and full final ownership/network baseline were not all reached or confirmed.

The separate DPI instance refused its first installService identity check at the unchanged 8000ms bound, before a completed start/stop pair. Its cause remains unknown: exact-eight-variable local reproductions did not reproduce the hosted 8039ms timeout. Final readonly children also showed a 21-to-24.7s bootstrap delay before parameters were captured. An ordinary uninstall and empty final service list were observed, but unavailable task/driver/process/network snapshots prevent a full cleanup claim. This unsigned payload is not admitted to the user's PC.

The next candidate preserves the existing architecture, pinned engines, signatures, anti-rollback requirements and all failure/ownership gates. Its narrow changes are:

- DPI LibraryOnly parameter capture/restore uses language/runtime operations without discovering Utility cmdlets. Both trace and default silent paths preserve the original arguments and function bodies.
- The production identity query explicitly imports absolute native Utility and then Cim manifests with child-session autoload disabled. It retains the same executable, argv/environment, 8000ms limit, SCM image and process-birth checks. This limits module discovery; it does not prove the hosted timeout is fixed.
- Only this identity query emits fixed local stderr stage/time markers. On failure the worker may return an observed whitelisted stage and elapsed 0..8000ms, with a 4KiB parser bound and ordered monotonic records. Raw text, commands, paths, profile, cause and PID do not leave the worker. Missing markers mean unobserved.
- Telegram's observer accepts only the exact start/CoreServiceRequestError envelope or the bare Core reason, with the configured host/port and retained actor's exact PID. It keeps OFF ACK, stale-error, readiness and cleanup guards. Last GUI evidence contains bounded counts and matcher outcome, with no raw UIA text.
- The storage banner says that already-running background services continue, so it does not imply a stopped service is running.

Local checks for these changes pass: 14 DPI Node checks, including 17 readonly trace assertions each on Windows PowerShell 5 and 7; 38 Telegram Node checks, including 43 occupied-port cases per edition; 65 identity/diagnostic/lifecycle Node checks. Independently replayed renderer functions reproduce the old observer refusal and new exact-envelope acceptance. Both complete GUI observer functions were checked against inert UIA adapters, six cases per edition with 69 other function extents unchanged. Actual own-process identity queries and natural child retirement passed without querying live services. These are source reproductions, not native acceptance.

Fresh compiled-renderer checks pass 29/29 with inert IPC, including readonly states, automatic/manual retry, keyboard focus, miniature shield, reduced motion, narrow widths and stress zoom equivalents. Renderer errors, external requests and asset drift were 0. The native full-window policy remains minimum width 1000 and zoomFactor 1; the 360CSS test is outside that policy, not native Windows zoom certification.

The earlier unauthenticated build API rate-limit failure is resolved in the completed8565 run. Optional short-lived CI read credentials stay confined to the fixed no-redirect metadata API and exact component child. Other child environments and archive downloads receive no token; known token bytes are redacted before diagnostic truncation. Release pins and offline/archive/binary verification remain mandatory.

A new exact-source installer and both mandatory native gates are required. The lifecycle gate includes the authenticated original 3.8.0, recovery, reinstall and two hours of autonomous Core/Telegram. The separate DPI gate requires 20 bounded local start/stop pairs and explicit retirement/baseline. Hosted Windows Server is not certification of Windows 10/11, physical sleep/link changes, private upstreams, large native GUI workloads or months of use.

Build: `npm ci`, `npm run build`, `npm run package:win`. Exact native prerequisites and `global.json` remain authoritative; bootstrap inputs are checksum pinned. Tests: `npm test`; native acceptance scripts refuse unsupported hosts before mutations. Project receipts, source-bound CI and the companion review board retain actual outcomes and neutral answers. Ed25519 trust and minimum automatic-update version 3.7.8 remain unchanged. Signing and local UAC remain conditional on complete acceptance; public release publication is outside this cycle.
