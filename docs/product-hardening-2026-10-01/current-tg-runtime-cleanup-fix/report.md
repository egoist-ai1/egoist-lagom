# Telegram runtime cleanup: targeted fix and evidence

The fresh 3.8.0 native acceptance for source `168115e7304caa5154370bb8e3021ed6c9ed5c74` failed before Telegram SCM registration. The accepted failure artifact and existing source identify `stopProcessesUsingManagedRuntime`: a whole-host CIM/PowerShell query followed by PID-only Stop-Process. The original inert RED reproduced three defects: the old PowerShell dependency, arbitrary-path acceptance, and clearing saved state after an unknown cleanup response.

## Change

The caller now uses `EgoistShield.Service.exe --telegram-runtime-cleanup --runtime primary|legacy`. The CLI accepts exactly the two fixed product runtime selectors beneath Windows CommonApplicationData; it exposes no PID, arbitrary path, wildcard or service-mode combination. The existing Core worker already explicitly sets ProgramData from CommonApplicationData, so no environment widening was added.

Native Toolhelp enumeration filters the selected basename before opening process handles. Every live matching candidate must expose its actual image path, creation time and liveness. Readable foreign paths receive no terminate rights. Exact matching processes retain query handles; all termination handles are prepared and identity-checked before the first termination, then revalidated immediately before TerminateProcess. Termination waits for the held handle to become signaled. The operation has an overall 8-second native deadline and the existing 10-second JS child limit. Final native quiescence refuses a replacement process, without a repeated kill loop. A successful proof is required before clearing saved state or deleting/copying a runtime file. A missing disk destination is never used as evidence that no process exists.

A real native boundary failure during the replacement test showed Toolhelp may still enumerate an already exited process while a caller retains its handle. Only an explicitly signaled SYNCHRONIZE handle permits that exited row to be excluded. Unreadable handles, failed waits and unknown live identity still refuse cleanup.

## Verification

- Original targeted RED: 0/3 pass, all three failures preserved.
- Final focused tests: **52/52 pass, 0 skip** (new cleanup tests plus existing Telegram listener ownership and native listener tests).
- Isolated C# compile: **0 errors, 136 existing warnings**, complete raw output preserved without suppression.
- Actual Windows native regression: **18/18 checks**. It created only caller-owned harmless children with a unique executable basename, verified real path/birth/liveness, refused foreign path and stale birth, refused cancellation, terminated only the exact owned child, preserved a same-name foreign child, and refused publication after an actual replacement child started at the owned path. The replacement and foreign children survived that refusal. The same production quiescence boundary was exercised; this is not a timed SCM recovery experiment.
- Actual compiled EXE with the CI interface `--work <absolute caller-owned directory>`: **exit 0, 18 checks**. All copied executables and child data were inside its new own work subdirectory.
- Measured native timings are in the raw JSON. The --work run measured exact owned termination at **20.5871 ms** and the later quiescent check at **9.5783 ms**. These are single local measurements, not sustained-load claims.
- `git diff --check` passed for the production diff. The intermediate fixture-copy, exception-type, invalid-CLI and signaled-row failures are retained alongside the final GREEN.

## Boundaries

No valid production cleanup CLI was run on the physical host. No physical SCM, DNS, registry, network configuration, GUI or installed application was modified. Only the test's held harmless children were affected. Protected/unreadable live-process and failed native snapshot cases remain fail-closed in source and JS negative contract fixtures; an actual protected-process experiment was not performed. No certificate-store operation was requested; DOTNET_GENERATE_ASPNET_CERTIFICATE=false and isolated SDK/cache paths were used for this diagnostic compile. Prior .NET first-use side-effect uncertainty is not converted into a claim about the certificate store.

Root must build the frozen source into a signed candidate and repeat actual fresh install/current-candidate acceptance in disposable Windows. This fix and these bounded checks do not establish months of uninterrupted operation or a successful final release. No installation or publication is claimed.

Frozen file SHA256 and raw evidence hashes are recorded in `report.json`. Previous freezes/reports were not modified.
