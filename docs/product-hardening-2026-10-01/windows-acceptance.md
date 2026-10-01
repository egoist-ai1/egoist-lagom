# Genuine Windows acceptance harness

The native scenario is implemented, but it has **not run on an elevated disposable Windows runner yet**. Local checks prove the harness parses and refuses an unsafe host. They do not prove installation, SCM recovery, GUI behavior, or upgrade compatibility.

`windows-harness-receipt.json` pins all three new test sources by SHA-256. Its base commit is the existing branch head; these changes were uncommitted when this receipt was captured. A native run requires the package integrity commit to equal that Actions run's actual `GITHUB_SHA`.

## Invocation

Run after packaging in the `windows-latest` candidate job, with PowerShell 7 x64:

```powershell
./tests/windows-production-acceptance.ps1 `
  -IntegrityManifestPath (Join-Path $env:GITHUB_WORKSPACE 'dist/package-integrity.json') `
  -ExpectedSourceCommit $env:GITHUB_SHA `
  -EvidenceDirectory (Join-Path $env:SHIELD_EVIDENCE_DIR 'native')
```

For a generation-specific package, pass its actual `dist/<generation>/package-integrity.json`. The manifest identifies the actual installer; there is no filename-only fallback. No signing key is required or embedded in this CI scenario.

The work directory is `$RUNNER_TEMP/lagom-native-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT`. The script copies its receipt, exact native stdout/stderr, payload verification, Task XML and reinstall evidence into `EvidenceDirectory`. Include that directory in the existing evidence upload even if the step fails.

## Safety boundary

Before any machine mutation, the script requires `GITHUB_ACTIONS=true`, `CI=true`, `RUNNER_ENVIRONMENT=github-hosted`, `RUNNER_OS=Windows`, the exact repository `egoist-ai1/egoist-lagom`, valid run/attempt/commit identities and a real elevated administrator token. Workspace, temporary directories, installer and integrity paths must be ordinary paths without reparse points. Source commit, installer size and SHA-256 must match the package receipt.

It refuses pre-existing product or shared-name services, product Tasks, product processes, canonical install/data/profile directories and product registration. It refuses an already-used acceptance work directory. It does not install over a person's local application or run on a self-hosted runner.

Failures retain the production recovery state and logs. The harness does not broad-kill processes, overwrite an existing VPN connection, manually reset the runner's network, or erase a failure by attempting an unverified repair.

## Actual operations in the planned native run

1. Run the generated Setup `/S` and read the installed files back against the complete package and protected worker inventories.
2. Read actual GUI/Worker PE manifests, embedded ASAR header integrity, Electron fuse wires, file owners/DACLs and the Start Menu shell-link flag. Both PE manifests must be `asInvoker`; no canonical AppCompat value may retain `RUNASADMIN`.
3. Launch the actual installed GUI with an empty argument list. Windows UIAutomation invokes the shipped `Telegram` navigation and `Установить фоновую службу` button, then the actual native window close control. No CDP, debugger, accessibility CLI flag, RunAsNode, development identity or special Core authority is used.
4. Verify the actual Core-owned component worker is LocalSystem; verify Telegram SCM Auto/LocalSystem state, a loopback-only TCP listener and its birth-checked process ancestry. Close the GUI and require Core/Telegram to remain running.
5. Hold the exact reviewed Core process handle, verify its path/birth/hash, crash that one process and require actual SCM restart with a new PID/birth. Verify the recovered named-pipe server using the installed read-only verifier and confirm Telegram remains ready.
6. Exercise the installed new helper's same-version protected reinstall while Core/Telegram have automatic recovery. Observe actual SYSTEM boot Task registration, action, principal, trigger and protected stage DACLs; require the successful verify receipt and Task removal. This tests registration/removal, **not an actual reboot or SYSTEM recovery execution**.
7. Seed only the canonical HKCU GUI layer with `~ HIGHDPIAWARE RUNASADMIN`. Require the reinstall to remove `RUNASADMIN` and preserve `HIGHDPIAWARE`.
8. Inspect Telegram credential-state ACLs before backup. Create a private inactive `.native-acceptance-sentinel` under `Service/Vpn`, preserve its exact bytes and private DACL through the actual installer, then require owned private VPN/Telegram paths to disappear after actual uninstall. This is an installer filesystem fixture; it does not configure, connect or validate a VPN.
9. At each boundary compare real adapter DNS, default routes, IPv6 bindings, user proxy and WinHTTP registry fingerprints. Require actual uninstall to remove the owned SCM/Task records while preserving that fingerprint.

Only the hosted runner can execute these operations. Native UIAutomation availability is an acceptance condition: if the real controls cannot be found or invoked, the native step fails. There is no mocked API fallback.

## Local evidence

- Four focused guard tests passed, zero failures/skips, 1,787.5895 ms, Node 24.19.0.
- PowerShell parser: zero errors. Node helper syntax check: passed.
- PSScriptAnalyzer: zero errors, ten advisory warnings (naming, script-parameter scope analysis and `ShouldProcess` conventions for a guarded test harness).
- A real local `GuardOnly` child refused the non-hosted, non-administrator environment before input processing or mutations.
- UIAutomation assemblies loaded successfully; no UIAutomation query or operation was invoked on the local machine.
- Local SCM/DNS/Task/registry mutations: zero. Actual native acceptance runs: zero.

The source was saved with a UTF-8 BOM after the guard run for Windows PowerShell compatibility; its semantic text did not change. The receipt contains the final byte hashes. The retained test output and analyzer report distinguish this preparation from a real native run.

## Unclosed release gates

The native receipt deliberately reports `releaseReady=false`. This scenario cannot close actual reboot/interrupted-install SYSTEM recovery, provider-backed background VPN/TUN, system DNS changes, driver-backed Zapret, the authentic 3.7.9 old-helper update chain, 3.7.7/3.7.8 trust compatibility, standard-user-token GUI authorization, or a 72-hour/7-day pilot and month-scale stability. The administrator hosted-runner token does not become a standard-user token merely because the PE manifest is `asInvoker`.

No native success is claimed until the generated candidate's actual run and its source-bound artifacts are inspected.
