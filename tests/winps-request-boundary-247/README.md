# WinPS request boundary controls — prepare only

Frozen source: 247cb3c8f3a171202613b5b679ebab400f040ca7.
NativeJob/NativeChildOutput and eight dependencies: unchanged 622db4ccc208cb4cc4c04e8b9005eb338f13903d.
Frozen terminal CI receipt: ci-native-uac-247cb3c-readback.json, SHA256 0a666d030621ddfd71c18d399f270bb4d629f475e5ba3f64b7d366d239e2b653.
No diagnostic, Electron, High, installed GUI, Core or SDK build has been executed by this preparation.

## Evidence and remaining uncertainty

The hosted receipt establishes command-start, zero response bytes, no exit, and timeout at 30076ms. Frozen src/native-runtime-trust.js:114 puts CLR Base64 decoding, UTF8 decoding, command resolution/module auto-loading and JSON conversion between that marker and request-decoded. It does not isolate the ConvertFrom-Json program counter or prove an stdin EOF wait.

The request is embedded in -EncodedCommand. The only intentional Console.In.ReadLine in protectedVerifierProbe is after the successful response and result-flushed. Source lines 116–120 explicitly replace PSModulePath with the actual KnownDLL System32 WindowsPowerShell Modules directory. A missing guardian PSModulePath does not by itself explain failed resolution. NativeJob's EnvironmentBlock (windows-ordinary-gui.cs:509–546) intentionally excludes SystemDrive and processor scalars. Root's local WinPS5 controls passed without SystemDrive; those scalar omissions are not a universal failure cause in that local context.

The earlier Get-Acl / Microsoft.PowerShell.Security warning is not bound to the failed PID and predates the second GUI. Its underlying import exception is absent. Treat it as a module-loading clue, not the cause. Local Utility/Security manifests have no SystemDrive/processor-scalar references; the Utility script references TEMP only in New-TemporaryFile. This does not prove dependencies in the native module DLL are independent of those scalars.

Windows PowerShell 5.1 ConvertFrom-Json uses JavaScriptSerializer and supports pipeline or explicit InputObject:
https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/convertfrom-json?view=powershell-5.1
Automatic module loading begins at first use, including in no-profile sessions:
https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/import-module?view=powershell-5.1
ProgressPreference controls progress display; it does not replace ErrorActionPreference:
https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables?view=powershell-5.1
The .NET Framework serializer accepts a finite string; its public entry path is not an OS stdin reader:
https://github.com/microsoft/referencesource/blob/main/System.Web.Extensions/Script/Serialization/JavaScriptSerializer.cs

No public PowerShell 6/7 source is asserted to describe the precise closed Windows PowerShell 5.1 implementation. Progress/ConsoleHost interaction, module discovery/cache/assembly loading and a later marker-delivery failure remain hypotheses until the matched hosted control reports a boundary.

## Controls

Each case is a fresh asInvoker SDK Electron 44.5.1 ASAR application in the retained owned Job, launched from an actual unrestricted interactive High original token. No BrowserWindow, session API, installed GUI launch, admission/UI/Core call, SCM/DNS or explicit network operation is present.

- clr: split Base64 bytes → UTF8 text → fixed literal equality; no PowerShell cmdlet.
- pipeline: split CLR stage markers, then the exact original combined Base64→UTF8 pipeline expression.
- parameter: same split markers, then Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject.
- pipeline-progress-silent: byte-identical pipeline case except ProgressPreference='SilentlyContinue'.
- security (optional): explicit built-in Security import; fixed numeric category/HRESULT on failure; no Get-Acl.
- full-bootstrap (optional): exact frozen original command template and protectedVerifierProbe, unchanged, with the actual resources request. It permits protected file/ACL/hash reads and retains the original JSON error handling. It never invokes Core. Missing inventory should produce a later rejection. protectedBootstrapReached=true means request-decoded was observed; it never establishes admission.

The short pipeline case decodes the request once for isolated markers before evaluating the original combined expression. It therefore warms CLR decoding. The qualified parameter control changes both qualification and input binding. A differential result suggests the next narrower axis to test; it alone does not prove which mechanism failed.

Full-bootstrap has the original 5587 UTF8-byte protected script, 12210 UTF16 command bytes and 16280 encoded-command characters. See source-command-shape.json. It closes the short-script AST/size-context gap. Original marker text and script contents are frozen from exact Git source.

The guardian reuses all nine frozen C# unchanged: flags 0x80404, original CreateProcessW, atomic JOB_LIST/HANDLE_LIST, NUL ancestor stdin, inherited stdout/stderr, managedFixture=false, no added DOTNET environment. The Electron-created PowerShell child has an owned pipe stdin intentionally kept open until response/timeout, the original verifier environment rewrite, the same -NoProfile/-NonInteractive/ExecutionPolicy/-EncodedCommand and cwd, 30s response / 3s release-kill budget. Guardian waits at most 45s; cleanup only terminates its retained owned Job and waits 3500ms for zero active processes.

SDK image bytes are unchanged and asInvoker; resources/app.asar is used, resources/default_app.asar is omitted. All engine assets, ASAR, payload and frozen sources are read-leased and hashed before launch. This SDK control does not reproduce production fuse/ASAR-integrity modifications. The actual app.isReady / isPackaged / defaultApp values are recorded. App profile paths are set synchronously to owned work. The inherited native user's module-cache context is preserved; no cache/environment workaround is inserted.

Only fixed schema, phase names, counts, booleans, integer error category/HRESULT, PID/token identity and timing survive receipt serialization. Original PowerShell full-response strings are parsed transiently then discarded. Raw stderr/stdout, environment, paths from exceptions and stack traces are not persisted. The Preparing-modules boolean detects only that fixed English phrase in the bounded stderr input; false does not prove absence in another language or beyond the byte limit.

success=true means the bounded measurement transport, exact token/image contract, complete streams and zero orphan count passed. Read events[].code and protectedBootstrapReached separately; a measured PowerShell timeout is not an admission success.

## Root integration commands (review before running)

The current sandbox-image-diagnostic job already stages verified runtime-input.json and locked @electron/asar 3.4.1. It does not set up .NET: add actions/setup-dotnet@v6 with dotnet-version: '10.0.401' before building this isolated guardian. Copy this explicit reviewed bundle into a project-owned diagnostic directory. These commands are provided only; none were run here.

    $bundle = Join-Path $env:GITHUB_WORKSPACE 'tests\winps-request-boundary-247'
    $probeWork = Join-Path $env:RUNNER_TEMP 'lagom-sandbox-diagnostic'
    $text = & node (Join-Path $bundle 'prepare-diagnostic.mjs') --project $env:GITHUB_WORKSPACE --runtime-receipt (Join-Path $probeWork 'runtime-input.json') --work $probeWork --bundle $bundle
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $prepared = ($text -join [char]10) | ConvertFrom-Json
    if ($prepared.applicationTargetExecutions -ne 0) { throw 'Unexpected preparation execution.' }
    & dotnet build $prepared.projectFile -c Release --nologo
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $exe = Join-Path $prepared.root 'bin\Release\net10.0-windows\WinPsRequestBoundaryProbe.exe'
    & $exe --review-only
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

After root review, run each selected case from the existing actual High hosted caller, without RunAs/UAC inside the diagnostic:

    foreach ($case in @('clr','pipeline','parameter','pipeline-progress-silent','full-bootstrap')) {
      $caseWork = Join-Path $prepared.root ('run-'+$case)
      New-Item -ItemType Directory -Path $caseWork -ErrorAction Stop | Out-Null
      & $prepared.runScript -Executable $exe -Case $case -Work $caseWork
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

Upload only run-*\winps-boundary-*.json plus reviewed seal/static proof. Do not upload owned Electron profiles, raw build/native stream logs or environment. If the hosted caller fails the actual token guard, record that explicit failure; do not emulate elevation or weaken the token policy.

Interpretation: CLR stalls isolates an earlier decode/host boundary. CLR pass + pipeline stall + parameter pass points to discovery/input-pipeline differences. Pipeline stall + identical pipeline-progress-silent pass narrows progress interaction; it is still not proof of production cause without full-bootstrap replication. Full-bootstrap request-decoded observes the full production bootstrap interval completed even if later inventory is absent. All controls passing leaves the intermittent hosted failure unreproduced.
