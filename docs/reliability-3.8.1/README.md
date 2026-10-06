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

The most recent completed immutable run, [37425833157](https://github.com/egoist-ai1/egoist-lagom/actions/runs/37425833157), used source `75a1e8adfe7f1feb9b52a6e5187482f06ce0abf3`. Source checks passed1589/1604 with0fail/15pre-package skips; bundled-runtime checks passed1600/1604 with0fail/4skips. Actual bundled Xray26.5.3 answered128 loopback DNS queries at concurrency16. These establish local packaged behavior, not external reachability.

Native acceptance did not pass. The actual protected3.8.0→3.8.1 upgrade succeeded in102.46s, removed its recovery task and preserved synthetic profiles; the installed Telegram listener persisted without GUI. Later Telegram acceptance stopped at an earlier GUI action error, and the separate DPI instance refused its first installService identity check before any complete pair. Core recovery, nested network scenarios, reinstall, the120-minute observation and full final ownership/network baseline were not all reached or confirmed. That unsigned payload is not admitted to the user's PC.

The next candidate addresses the confirmed Telegram action/readiness conflation and waits for actual GUI OFF completion before its own occupied-port fixture is bound. It preserves the original pre-ON visible-error guard and all foreign-port/cleanup refusals. Source reproductions execute the real manager and renderer with inert OS leaves; they do not certify native integration.

The original DPI refusal lost its existing safe PowerShell failure metadata. Optional worker diagnostics now contain only public classifications, bounded codes, timings and output byte counts; PID, raw text, commands, arguments, profile and cause objects remain in-process. Both Russian refusal messages, path/birth checks,8000ms query bound and fail-closed behavior are retained. Its native primary cause remains unknown.

Explicit LibraryOnly readback children have fixed stage/time stderr markers at library initialization boundaries. Default execution remains silent. This changes observation only: no environment, retry, deadline, held-process, Worker or cleanup guard is relaxed. Hosted delays not reproduced locally remain unexplained.

The subsequent [37444485427](https://github.com/egoist-ai1/egoist-lagom/actions/runs/37444485427) source gate for bcd93c5 passed1636/1651 Node tests with0fail/15pre-package skips, Core27 and DoH/Core39 groups. Packaging stopped before creating Setup: an unauthenticated official release metadata request returned HTTP403 rate limit exceeded. The optional short-lived CI read token is now confined to the fixed no-redirect metadata API and exact component child. Other child environments and archive downloads receive no such token; known token bytes are redacted before diagnostic truncation. Release pins, offline cache verification and archive/binary checks remain mandatory. Targeted independent25/25 checks pass; actual hosted authentication still requires a new run.

Keyboard Retry keeps focus while busy, prevents duplicate activation and restores it only for the focused manual request. Automatic retry, Tab away and navigation do not claim focus. A narrow existing Profiles status grid no longer overflows at360CSSpx. Fresh compiled-renderer checks pass29/29 with inert IPC, including motion, miniature shield and stress zoom equivalents. The native full-window policy remains minimum1000 and zoomFactor1; the360CSS test is outside that policy, not native Windows zoom certification.

A new exact-source installer and both mandatory native gates are required. The lifecycle gate includes the exact authenticated original3.8.0, recovery, reinstall and two hours of autonomous Core/Telegram; the separate DPI gate requires20 bounded local start/stop pairs and explicit retirement/baseline. Hosted Windows Server is not certification of Windows10/11, physical sleep/link changes, private upstreams, large native GUI workloads or months of use.

Build: `npm ci`, `npm run build`, `npm run package:win`. Exact native prerequisites and `global.json` remain authoritative; bootstrap inputs are checksum pinned. Tests: `npm test`; native acceptance scripts refuse unsupported hosts before mutations. The source-bound CI, project evidence and companion review board bind actual outcomes to source SHA and payload digests. Existing Ed25519 trust and minimum automatic-update version3.7.8 are retained. Signing and local UAC remain conditional on complete acceptance; public release publication is outside this cycle.
