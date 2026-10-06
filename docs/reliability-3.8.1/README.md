# Reliability cycle 3.8.1

The selected scope is daily reliability, safe local state recovery and autonomous Core/DNS/DPI/Telegram services. The user chose normal read-only screens with bounded automatic reload when storage is unavailable, followed by isolated Windows acceptance before an ordinary UAC upgrade of the existing installation. No monetization, account requirement, telemetry or cloud dependency was introduced.

| Change | Acceptance scenario |
| --- | --- |
| StateStore distinguishes missing, inaccessible and corrupt bytes | Access failure cannot replace profiles or a verified backup; recovery retains confirmed state |
| Current profile is authoritative; legacy import is atomic and one-time | Deleted legacy subscriptions stay deleted through repeated restarts |
| Full activation and native admission share the mutation queue | No premature writable status; the latest manual startup choice wins |
| Snapshot/retry IPC, persistent readonly banner and miniature shield guard | Retry restores editing without a restart; stale snapshots retain the acknowledged profile revision |
| Generation-fenced reconnect and verified DPI suspension | Manual OFF persists; failed SCM stop does not report VPN readiness |
| Held-child heartbeat and native ownership guards | Path and process birth remain mandatory; failed inspection is not accepted |

Local source checks passed 1569 of 1575 tests, with no failures and six environment skips. The production DNS matrix and state regressions use real controllers with inert OS/filesystem adapters. Headless Edge checks use the real renderer with inert IPC; they do not establish native installed behavior.

The source-bound CI builds an immutable installer, tests its bundled runtime, upgrades the exact original 3.8.0 on a disposable hosted Windows instance and runs two hours of autonomous Core/Telegram observation. A separate fresh instance exercises twenty bounded loopback DPI start/stop pairs through the unchanged protected production Worker, SCM and driver. Its filter, process identity, lifecycle and network baseline must be observed, not inferred from source. Core RPC/cancellation/journal and blocked-site bypass are not covered by that DPI fixture.

At this source freeze those native receipts and local delivery remain pending. Hosted Windows Server does not certify Windows 10/11; unavailable target systems must be explicitly left unverified. The project ledger, evidence and companion feedback board will record actual results and exact payload hashes. Signed sidecar manifests retain the existing pinned Ed25519 trust and anti-rollback policy. Public release publication is outside this cycle.

Build: `npm ci`, `npm run build`, `npm run package:win`. Exact native prerequisites and `global.json` remain authoritative; the CI prepares checksum-verified recovery inputs. Tests: `npm test`; the disposable native scripts refuse unsupported hosts before mutations.
