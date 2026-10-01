# Runtime exit race: narrow fix

Source baseline: `d8a899095bd71a0bcb6409a3c39019b25a3f5a27`. Root's actual full suite was **983/984 PASS, 0 skip**. The preserved native failure was `Runtime executable identity is unavailable` after the harmless replacement child exited: a process could exit between the initial held-handle wait and image-path read. Root's full accepted RED is preserved unchanged as `root-full-source-d8a899-red.txt/.json`.

Only `WindowsServiceListenerSnapshot.cs` and the exact native regression harness were changed. An identity-read IOException now permits excluding the row only when a repeated wait on **that same held SYNCHRONIZE handle** returns WAIT_OBJECT_0. An unreadable handle, a live process or a failed wait still refuses cleanup. The adjacent pre-termination race receives the same treatment: the original held query handle proves exit before/after a failed terminate-handle open, and the held termination handle proves exit following an identity-read or TerminateProcess failure. The exact path and birth checks are unchanged. The final quiescence boundary still refuses an actual replacement; no kill loop was added. No read-only listener/WinWS ownership behavior was changed.

The harness adds twelve bounded cycles of actual caller-owned child exit followed by native capture/quiescence while its Process object remains held. Each cycle starts its own eight-second CTS after child readiness/exit, so fixture startup time does not consume another request budget; the production eight-second deadline is unchanged. Foreign same-name processes survive all cycles. Fixed selectors, cancellation, stale birth/foreign path and actual replacement refusal checks remain.

Verification:

- Local pre-fix run with the new twelve-cycle harness: **14/14 PASS**, 0 skip. The root transient was not reproduced locally in this run; it is not relabeled a local RED.
- Final focused post-fix file after the fixture budget correction: **14/14 PASS**, 0 skip, 3806.391 ms; the final actual native harness passed **54/54 checks** including **12 own-child exit/capture cycles**.
- Isolated compile: **0 errors, 136 warnings**, raw preserved without suppressions.
- Earlier actual post-fix native runs before the fixture budget correction: **five runs × 54 checks = 270 passing checks**, including **60 actual own-child exit/capture cycles**. The first run came from the focused Node test; four further runs used the same compiled EXE with caller-owned `--work`, without repeated builds. These are evidence for the unchanged production fix and the earlier harness, not misattributed to the final harness hash. Final focused/compile/native raw files use `*-final*` names.
- `git diff --check` passed. Frozen file and evidence SHA256 hashes are in `report.json`.

These are actual Windows API checks on harmless own children. They do not prove that every local run hit the narrow late-query catch branch or exhaust all scheduling interleavings. No valid production cleanup CLI, physical SCM/DNS/registry/network/GUI change, candidate packaging, install or publication was performed. Root must rerun the full source suite and signed current-candidate acceptance. Previous reports and root RED files were not changed.
