using System.ComponentModel;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;
namespace OrdinaryGuiHarness;
internal static class WinPsRequestBoundaryProbe
{
    private const string SourceCommit = "247cb3c8f3a171202613b5b679ebab400f040ca7";
    private static string ElectronImage => Path.Combine(ProbeRoot, "dist", "asInvoker.exe");
    private const string ElectronSha256 = "49b61a030a520fc36a4b8fa5cce53fb4e935a7bdbbe4b80e9222f598e49cc7fa";
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    private static string ProbeRoot => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", ".."));
    private static string Clean(string? value)
    {
        string text = (value ?? "").Replace('\r', ' ').Replace('\n', ' ').Replace('\t', ' ');
        text = Regex.Replace(text, @"[A-Za-z]:[\\/][^""'<>|]*", "[path]");
        text = Regex.Replace(text, @"(?i)(bearer\s+|(?:token|password|secret)\s*[=:]\s*)\S+", "$1[redacted]");
        return text[..Math.Min(text.Length, 384)];
    }
    private static string Hash(Stream file) { file.Position = 0; string hash = Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant(); file.Position = 0; return hash; }
    private static FileStream Lease(string path, string expected)
    {
        Program.OrdinaryPath(path, leaf: true);
        FileStream file = new(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        try { if (Hash(file) != expected) throw new InvalidDataException("Reviewed file hash changed."); return file; }
        catch { file.Dispose(); throw; }
    }
    private static List<FileStream> Leases()
    {
        var leases = new List<FileStream>();
        try
        {
            leases.Add(Lease(ElectronImage, ElectronSha256));
            string manifest = Path.Combine(ProbeRoot, "probe-review-hashes.json");
            Program.OrdinaryPath(manifest, leaf: true);
            var manifestLease = new FileStream(manifest, FileMode.Open, FileAccess.Read, FileShare.Read); leases.Add(manifestLease);
            if (manifestLease.Length > 1048576) throw new InvalidDataException("Reviewed seal exceeds metadata bound.");
            using var document = JsonDocument.Parse(manifestLease);
            if (document.RootElement.GetProperty("sourceCommit").GetString() != SourceCommit) throw new InvalidDataException("Frozen source commit differs.");
            foreach (JsonElement entry in document.RootElement.GetProperty("engineInputs").EnumerateArray())
                leases.Add(Lease(Program.Within(entry.GetProperty("absolute").GetString()!, Path.Combine(ProbeRoot, "dist")), entry.GetProperty("sha256").GetString()!));
            foreach (JsonElement entry in document.RootElement.GetProperty("inputs").EnumerateArray())
            {
                string relative = entry.GetProperty("relative").GetString()!;
                string file = Program.Within(Path.Combine(ProbeRoot, relative), ProbeRoot);
                leases.Add(Lease(file, entry.GetProperty("sha256").GetString()!));
            }
            return leases;
        }
        catch { foreach (FileStream lease in leases) lease.Dispose(); throw; }
    }
    private static object StreamMetadata(CapturedStream stream) => new { stream.ObservedBytes, stream.Truncated, stream.Completed, stream.NativeError };
    private static List<Dictionary<string, object?>> Events(string text)
    {
        var events = new List<Dictionary<string, object?>>();
        var stages = new HashSet<string>(["entry", "measurement-start", "measurement-result", "setup-failed"]);
        var codes = new HashSet<string>(["PASS", "TIMEOUT", "SPAWN_FAILED", "NO_RESPONSE", "RESPONSE_LIMIT", "PS_EXCEPTION", "INVALID_RESPONSE", "SETUP_FAILED", "FULL_READ_RESULT", "FULL_REJECTED"]);
        var phases = new HashSet<string>(["command-start", "before-base64", "base64-decoded", "utf8-decoded", "before-clr-compare", "before-json", "before-security-import", "security-imported", "request-decoded", "result-flushed", "probe-exception", "protected-root", "inventory-open", "inventory-valid", "code-validation", "code-validated"]);
        foreach (string line in text.Split('\n').Take(16))
        {
            if (string.IsNullOrWhiteSpace(line) || line.Length > 8192) continue;
            try
            {
                using var document = JsonDocument.Parse(line);
                JsonElement value = document.RootElement;
                string stage = value.GetProperty("stage").GetString() ?? "";
                string mode = value.GetProperty("mode").GetString() ?? "";
                if (!stages.Contains(stage) || value.GetProperty("schemaVersion").GetInt32() != 1 ||
                    mode is not ("clr" or "pipeline" or "parameter" or "pipeline-progress-silent" or "security" or "full-bootstrap" or "pipeline-qualified" or "parameter-unqualified" or "full-bootstrap-qualified-pipeline" or "full-bootstrap-qualified-parameter")) continue;
                var item = new Dictionary<string, object?> { ["schemaVersion"] = 1, ["mode"] = mode, ["stage"] = stage };
                foreach (string name in new[] { "elapsedMs", "outcomeElapsedMs", "responseBytes", "stderrBytes", "markerBytes", "windowsCreated", "responseBudgetMs", "releaseKillBudgetMs", "commandUtf16Bytes", "encodedCommandCharacters", "requestUtf8Bytes", "childPid", "exitCode", "exitCodeAtOutcome", "errorHresult" })
                    if (value.TryGetProperty(name, out JsonElement number))
                    {
                        if (number.ValueKind == JsonValueKind.Null && name is "childPid" or "exitCode" or "exitCodeAtOutcome" or "errorHresult") item[name] = null;
                        else if (number.TryGetInt64(out long parsed) && parsed >= (name.StartsWith("exitCode") || name == "errorHresult" ? -2147483648L : 0L) && parsed <= 2147483647L) item[name] = parsed;
                    }
                foreach (string name in new[] { "readyAtEntry", "ready", "readyBeforeCheck", "readyAfterCheck", "packaged", "defaultApp", "ownedProfile", "knownDllIdentity", "requestEmbedded", "modulePathFixed", "systemDrivePresent", "processorArchitecturePresent", "processorArchiteW6432Present", "numberOfProcessorsPresent", "requestMatched", "responseValid", "exitObserved", "exitObservedAtOutcome", "closeObserved", "streamCloseWithinBudget", "stdinEndedBeforeOutcome", "stdinDeliberatelyOpen", "stdinReleasedAfterOutcome", "spawnObserved", "measurementComplete", "rawStdoutPersisted", "rawStderrPersisted", "scopeInstalledResourcesRead", "coreInvoked", "protectedBootstrapReached", "clixmlObserved", "preparingModulesProgressObserved" })
                    if (value.TryGetProperty(name, out JsonElement flag) && flag.ValueKind is JsonValueKind.True or JsonValueKind.False) item[name] = flag.GetBoolean();
                if (value.TryGetProperty("code", out JsonElement code) && code.ValueKind == JsonValueKind.String && codes.Contains(code.GetString()!)) item["code"] = code.GetString();
                foreach (string name in new[] { "lastPhase", "lastPhaseAtOutcome" })
                    if (value.TryGetProperty(name, out JsonElement phase) && phase.ValueKind == JsonValueKind.Null) item[name] = null;
                    else if (phase.ValueKind == JsonValueKind.String && phases.Contains(phase.GetString()!)) item[name] = phase.GetString();
                if (value.TryGetProperty("stages", out JsonElement sequence) && sequence.ValueKind == JsonValueKind.Array)
                {
                    var sequenceProof = new List<object>();
                    foreach (JsonElement step in sequence.EnumerateArray().Take(32))
                        if (step.TryGetProperty("phase", out JsonElement phase) && phase.ValueKind == JsonValueKind.String && phases.Contains(phase.GetString()!) &&
                            step.TryGetProperty("elapsedMs", out JsonElement elapsed) && elapsed.TryGetInt32(out int parsed) && parsed >= 0)
                            sequenceProof.Add(new { phase = phase.GetString(), elapsedMs = parsed });
                    item["stages"] = sequenceProof;
                }
                if (value.TryGetProperty("metadata", out JsonElement metadata) && metadata.ValueKind == JsonValueKind.Object)
                {
                    var proof = new Dictionary<string, object?>();
                    foreach (string name in new[] { "byteCount", "charCount", "errorCategory", "hresult", "innerHresult" })
                        if (metadata.TryGetProperty(name, out JsonElement number))
                        {
                            if (number.ValueKind == JsonValueKind.Null && name == "innerHresult") proof[name] = null;
                            else if (number.TryGetInt32(out int parsed)) proof[name] = parsed;
                        }
                    item["metadata"] = proof;
                }
                events.Add(item);
            }
            catch (Exception error) when (error is JsonException or KeyNotFoundException or InvalidOperationException or FormatException) { }
        }
        return events;
    }
    private static string HostedScope(string? work = null)
    {
        foreach (var pair in new Dictionary<string, string> { ["GITHUB_ACTIONS"] = "true", ["CI"] = "true", ["RUNNER_ENVIRONMENT"] = "github-hosted", ["RUNNER_OS"] = "Windows", ["GITHUB_REPOSITORY"] = "egoist-ai1/egoist-lagom" })
            if (Environment.GetEnvironmentVariable(pair.Key) != pair.Value) throw new UnauthorizedAccessException("Hosted diagnostic guard refused.");
        foreach (string key in new[] { "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT" })
            if (!ulong.TryParse(Environment.GetEnvironmentVariable(key), out ulong number) || number == 0) throw new UnauthorizedAccessException("Hosted run identity absent.");
        string commit = Environment.GetEnvironmentVariable("GITHUB_SHA") ?? "";
        if (commit.Length != 40 || commit.Any(c => c is not (>= '0' and <= '9') and not (>= 'a' and <= 'f'))) throw new UnauthorizedAccessException("Hosted source identity absent.");
        string temp = Environment.GetEnvironmentVariable("RUNNER_TEMP") ?? "";
        if (!Path.IsPathFullyQualified(temp)) throw new UnauthorizedAccessException("Hosted temporary root absent.");
        Program.OrdinaryPath(temp, leaf: false);
        string expected = Path.GetFullPath(Path.Combine(temp, "lagom-sandbox-diagnostic", "winps-request-boundary"));
        if (!ProbeRoot.Equals(expected, StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("Prepared supervisor root differs.");
        _ = Program.Within(ProbeRoot, temp);
        if (work is not null && (!Path.GetDirectoryName(work)!.Equals(ProbeRoot, StringComparison.OrdinalIgnoreCase) || Path.GetFileName(work) is not ("run-first" or "run-clr" or "run-pipeline" or "run-parameter" or "run-progress" or "run-security" or "run-second" or "run-qualified-pipeline" or "run-unqualified-parameter" or "run-full-qualified-pipeline" or "run-full-qualified-parameter")))
            throw new UnauthorizedAccessException("Measurement work is outside the prepared case subtree.");
        return commit;
    }
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--review-only")
        {
            _ = HostedScope();
            using var review = new LeaseSet(Leases());
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = 1, sourceCommit = SourceCommit, immutableInputsVerified = true, electronImage = ElectronImage, electronSha256 = ElectronSha256, startupObject = "OrdinaryGuiHarness.WinPsRequestBoundaryProbe", reviewedSealSha256 = review.ManifestHash, highProbeExecuted = false, childLaunched = false }, Json));
            return 0;
        }
        if (args.Length != 4 || args[0] != "--case" || args[1] is not ("clr" or "pipeline" or "parameter" or "pipeline-progress-silent" or "security" or "full-bootstrap" or "pipeline-qualified" or "parameter-unqualified" or "full-bootstrap-qualified-pipeline" or "full-bootstrap-qualified-parameter") || args[2] != "--work" || !Path.IsPathFullyQualified(args[3])) { Console.Error.WriteLine("Use --case clr, pipeline, parameter, pipeline-progress-silent, security, or full-bootstrap --work absolute-owned-directory."); return 2; }
        string mode = args[1];
        string work;
        try { work = Path.GetFullPath(args[3]); _ = HostedScope(work); Program.OrdinaryPath(work, leaf: false); }
        catch { Console.Error.WriteLine("Owned work must be an existing ordinary absolute directory."); return 2; }
        string receiptPath = Path.Combine(work, "winps-boundary-" + mode + ".json");
        if (File.Exists(receiptPath)) { Console.Error.WriteLine("Fixed receipt already exists; use a fresh owned work directory."); return 2; }
        NativeJob? job = null; LaunchedProcess? child = null; SafeAccessTokenHandle? original = null; LeaseSet? leases = null;
        var receipt = new Dictionary<string, object?> {
            ["schemaVersion"] = 1, ["kind"] = "read-only-high-original-token-packed-electron-winps-request-boundary", ["sourceCommit"] = SourceCommit, ["supervisorSourceCommit"] = "622db4ccc208cb4cc4c04e8b9005eb338f13903d", ["mode"] = mode,
            ["success"] = false, ["scope"] = "Windowless owned SDK ASAR application measures fixed WinPS5 request decoding only. Short controls make no installed resource or ACL reads. Optional full-bootstrap performs unchanged protected file/ACL/hash reads; no Core, installed GUI launch, SCM, DNS or network commands. Owned profile/receipts only. Success means measurement transport completed; PS outcome is separate. SDK image unchanged; production fuses/ASAR integrity are outside this control.",
            ["workflowCommit"] = HostedScope(work), ["createdAtUtc"] = DateTimeOffset.UtcNow.ToString("o"), ["phase"] = "caller-guard", ["highProbeExecuted"] = false, ["childLaunched"] = false,
            ["caller"] = null, ["child"] = null, ["events"] = Array.Empty<object>(), ["errors"] = new List<object>(), ["cleanup"] = null
        };
        var errors = (List<object>)receipt["errors"]!;
        bool naturalExit = false; uint? exitCode = null; bool measurementComplete = false, streamsComplete = false; bool noOrphans = true; uint? active = null; var elapsed = Stopwatch.StartNew();
        try
        {
            if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess) throw new PlatformNotSupportedException("Windows x64 required.");
            if (!Native.OpenProcessToken(Native.GetCurrentProcess(), 0x008B, out original)) throw Native.Error("Open original caller token");
            TokenProof caller = Program.ReadToken(original);
            receipt["caller"] = new { caller.UserSid, caller.SessionId, caller.Elevated, caller.AdministratorsEnabled, caller.IntegrityRid, caller.Restricted, caller.TokenType, caller.UiAccess, actualHighRequired = true };
            if (!caller.ElevatedManagement || caller.Restricted) throw new UnauthorizedAccessException("Actual unrestricted interactive High administrator caller required.");
            leases = new LeaseSet(Leases()); receipt["reviewedSealSha256"] = leases.ManifestHash;
            string command = "\"" + ElectronImage + "\" --case " + mode + " --work \"" + work + "\"";
            job = NativeJob.Create(); noOrphans = false; receipt["phase"] = "start-owned-electron";
            child = job.Start(original, ElectronImage, command, ProbeRoot, work, "current-elevated-read-only-electron", fixtureInherited: true, managedFixture: false, captureStandardStreams: true, requireElevated: true);
            receipt["childLaunched"] = true; receipt["highProbeExecuted"] = true;
            if (child.Proof.Restricted) throw new UnauthorizedAccessException("Actual suspended child token is restricted.");
            receipt["child"] = new { child.Pid, child.StartUtc, child.LaunchApi, child.TokenMethod, child.Proof.UserSid, child.Proof.SessionId, child.Proof.Elevated, child.Proof.AdministratorsEnabled, child.Proof.IntegrityRid, child.Proof.Restricted, exactReviewedImage = true, electronSha256 = ElectronSha256, createProcessFlags = 0x00080404u, createNoWindow = false, requireElevated = true, captureStandardStreams = true, managedFixture = false, atomicJobList = true, originalCallerTokenInherited = true };
            receipt["environment"] = new { builder = "unchanged OrdinaryGuiHarness.Program.EnvironmentBlock", managedFixture = false, ancestorStdinNul = true, tempEqualsOwnedWork = child.LaunchEnvironment.GetValueOrDefault("TEMP") == work, dotnetOverridesPresent = child.LaunchEnvironment.Keys.Any(key => key.StartsWith("DOTNET_", StringComparison.OrdinalIgnoreCase)) };
            child.Resume(); receipt["phase"] = "wait-owned-electron";
            uint wait = Native.WaitForSingleObject(child.Process, 45000);
            if (wait == uint.MaxValue) throw Native.Error("Wait for held owned Electron");
            naturalExit = wait == 0; if (naturalExit) exitCode = child.ExitCode;
            receipt["wait"] = new { millisecondsBound = 45000, result = wait, naturalExit, timedOut = !naturalExit, exitCode, observation = child.Observe() };
            if (!naturalExit) errors.Add(new { phase = "wait-owned-electron", errorName = "Timeout", code = "OWNED_CHILD_TIMEOUT" });
        }
        catch (Exception error)
        {
            errors.Add(new { phase = receipt["phase"], errorName = error.GetType().Name, code = "SUPERVISOR_OPERATION_FAILED", hresult = error.HResult, nativeError = error is Win32Exception native ? native.NativeErrorCode : (int?)null });
        }
        finally
        {
            if (job is not null)
            {
                try { job.Terminate(); } catch (Exception error) { errors.Add(new { phase = "terminate-owned-job", errorName = error.GetType().Name, code = "SUPERVISOR_OPERATION_FAILED", hresult = error.HResult }); }
                try { noOrphans = job.WaitEmpty(3500); active = job.ActiveProcesses; } catch (Exception error) { noOrphans = false; errors.Add(new { phase = "owned-job-accounting", errorName = error.GetType().Name, code = "SUPERVISOR_OPERATION_FAILED", hresult = error.HResult }); }
            }
            if (child is not null)
            {
                try {
                    OutputProof streams = child.Output.Finish(); var events = Events(streams.Stdout.Text); receipt["events"] = events;
                    streamsComplete = streams.CaptureAvailable && streams.Stdout.Completed && streams.Stderr.Completed && !streams.Stdout.Truncated && !streams.Stderr.Truncated;
                    measurementComplete = events.Any(value => Equals(value.GetValueOrDefault("stage"), "measurement-result") && Equals(value.GetValueOrDefault("mode"), mode) && Equals(value.GetValueOrDefault("measurementComplete"), true) && Equals(value.GetValueOrDefault("packaged"), true) && Equals(value.GetValueOrDefault("defaultApp"), false) && Equals(value.GetValueOrDefault("windowsCreated"), 0L) && Equals(value.GetValueOrDefault("stdinEndedBeforeOutcome"), false));
                    receipt["streams"] = new { streams.CaptureAvailable, unavailableReasonPresent = streams.UnavailableReason is not null, stdout = StreamMetadata(streams.Stdout), stderr = StreamMetadata(streams.Stderr), rawTextPersisted = false };
                } catch (Exception error) { errors.Add(new { phase = "bounded-stream-finish", errorName = error.GetType().Name, code = "SUPERVISOR_OPERATION_FAILED", hresult = error.HResult }); }
                child.Dispose();
            }
            receipt["cleanup"] = new { scope = "only the retained owned Job Object; never name/PID cleanup", jobCreated = job is not null, terminateAttempted = job is not null, waitEmptyBoundMs = 3500, noOrphans, activeProcesses = active, killOnClose = job is not null };
            job?.Dispose(); original?.Dispose(); leases?.Dispose();
        }
        receipt["elapsedMs"] = elapsed.ElapsedMilliseconds;
        receipt["measurementComplete"] = measurementComplete; receipt["streamsComplete"] = streamsComplete;
        receipt["success"] = naturalExit && exitCode == 0 && noOrphans && streamsComplete && measurementComplete && errors.Count == 0;
        receipt["phase"] = (bool)receipt["success"]! ? "completed" : "failed";
        string output = JsonSerializer.Serialize(receipt, Json);
        using (var file = new FileStream(receiptPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) { byte[] bytes = Encoding.UTF8.GetBytes(output + "\n"); file.Write(bytes); file.Flush(true); }
        Console.WriteLine(output);
        return (bool)receipt["success"]! ? 0 : 1;
    }
    private sealed class LeaseSet(List<FileStream> files) : IDisposable { internal string ManifestHash => Hash(files.Single(file => file.Name.Equals(Path.Combine(ProbeRoot, "probe-review-hashes.json"), StringComparison.OrdinalIgnoreCase))); public void Dispose() { foreach (FileStream file in files) file.Dispose(); } }
}
