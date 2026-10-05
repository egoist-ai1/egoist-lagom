using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using EgoistShield.Service;
using Microsoft.Win32.SafeHandles;

namespace OrdinaryGuiHarness;

internal sealed record Options(string Mode, string WorkRoot, string ReceiptPath,
    string CanonicalInstalledGuiPath = "", string IntegrityManifestPath = "", string ExpectedSourceCommit = "",
    int LeaseSeconds = 420, int WindowTimeoutSeconds = 90, string ExpectedHarnessSourceCommit = "", bool CaptureStandardStreams = true, string LaunchPolicy = "ordinary");
internal sealed record TokenProof(string UserSid, bool Elevated, bool AdministratorsEnabled,
    int IntegrityRid, string IntegritySid, int SessionId, int ElevationType, bool Restricted,
    bool UiAccess, int TokenType, bool HasRestrictions, string[] EnabledPrivileges)
{
    internal bool Ordinary => !Elevated && !AdministratorsEnabled && IntegrityRid == 0x2000 && !UiAccess && TokenType == 1 &&
        UserSid is not ("S-1-5-18" or "S-1-5-19" or "S-1-5-20") &&
        !EnabledPrivileges.Any(name => name is "SeDebugPrivilege" or "SeImpersonatePrivilege" or
            "SeAssignPrimaryTokenPrivilege" or "SeTcbPrivilege" or "SeCreateTokenPrivilege" or
            "SeBackupPrivilege" or "SeRestorePrivilege" or "SeLoadDriverPrivilege" or
            "SeTakeOwnershipPrivilege" or "SeIncreaseQuotaPrivilege" or "SeRelabelPrivilege" or "SeSecurityPrivilege");
    internal bool ElevatedManagement => Elevated && AdministratorsEnabled && IntegrityRid >= 0x3000 && !UiAccess && TokenType == 1 && SessionId > 0 &&
        UserSid is not ("S-1-5-18" or "S-1-5-19" or "S-1-5-20");
}
internal sealed record TokenCandidate(string Method, SafeAccessTokenHandle Handle) : IDisposable
{ public void Dispose() => Handle.Dispose(); }

internal static class Program
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    private const uint TokenAccess = 0x000B; // QUERY | DUPLICATE | ASSIGN_PRIMARY
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--proof-exit-child") { Console.Write("ordinary-diag-stdout\n"); Console.Error.Write("ordinary-diag-stderr\n"); return 37; }
        if (args.Length == 1 && args[0] == "--proof-child") { Thread.Sleep(120000); return 0; }
        if (args.Length != 2 || args[0] != "--options") { Console.Error.WriteLine("Use the fixed options-file contract."); return 2; }
        Options? options = null;
        try
        {
            if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess) throw new PlatformNotSupportedException("Windows x64 required.");
            string input = Path.GetFullPath(args[1]); OrdinaryPath(input, leaf: true);
            using var stream = new FileStream(input, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (stream.Length > 16384) throw new InvalidDataException("Oversized harness options.");
            options = JsonSerializer.Deserialize<Options>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true, UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow }) ?? throw new InvalidDataException("Missing options.");
            CheckOptions(options);
            return options.Mode switch { "self-test" => SelfTest(options), "fixture-guardian" => FixtureGuardian(options), _ => LaunchGui(options) };
        }
        catch (Exception error)
        {
            var failure = new { schemaVersion = 1, stage = "failed", ok = false, error = error.Message,
                nativeError = error is Win32Exception win32 ? win32.NativeErrorCode : (int?)null, productLaunched = false };
            Console.Error.WriteLine(JsonSerializer.Serialize(failure, Json));
            // A pre-launch failure never selects a process by name/PID for cleanup.
            if (options is not null && ValidReceiptLocation(options)) Save(options.ReceiptPath, failure);
            return 1;
        }
    }

    private static void CheckOptions(Options options)
    {
        if (options.Mode is not ("launch" or "self-test" or "fixture-guardian") || options.LaunchPolicy is not ("ordinary" or "elevated") || options.LeaseSeconds is < 10 or > 600 || options.WindowTimeoutSeconds is < 1 or > 120)
            throw new InvalidDataException("Invalid harness mode or time limit.");
        if (!Path.IsPathFullyQualified(options.WorkRoot) || !Path.IsPathFullyQualified(options.ReceiptPath)) throw new InvalidDataException("Absolute owned paths required.");
        OrdinaryPath(options.WorkRoot, leaf: false);
        _ = Within(options.ReceiptPath, options.WorkRoot);
        OrdinaryPath(Path.GetDirectoryName(options.ReceiptPath)!, leaf: false);
        if (File.Exists(options.ReceiptPath)) throw new IOException("A receipt already exists; inspect the previous attempt.");
        if (options.Mode is "self-test" or "fixture-guardian")
        {
            if (options.CanonicalInstalledGuiPath.Length != 0 || options.IntegrityManifestPath.Length != 0 || options.ExpectedSourceCommit.Length != 0 || options.ExpectedHarnessSourceCommit.Length != 0)
                throw new InvalidDataException("Self-test cannot select any installed product.");
            return;
        }
        HostedGuard(ResolveHarnessSourceCommit(options));
        if (!options.CaptureStandardStreams && (options.ExpectedHarnessSourceCommit.Length == 0 || ResolveHarnessSourceCommit(options) == options.ExpectedSourceCommit))
            throw new UnauthorizedAccessException("Original stream/inheritance mode requires explicit diagnostic harness source.");
        _ = Within(options.WorkRoot, Environment.GetEnvironmentVariable("RUNNER_TEMP")!);
        _ = Within(options.ReceiptPath, Environment.GetEnvironmentVariable("RUNNER_TEMP")!);
        _ = Within(options.IntegrityManifestPath, Environment.GetEnvironmentVariable("GITHUB_WORKSPACE")!);
        string canonical = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "EgoistShield", "EgoistShield.exe");
        if (!Path.GetFullPath(options.CanonicalInstalledGuiPath).Equals(canonical, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("Only the canonical installed GUI can be selected.");
        OrdinaryPath(canonical, leaf: true);
    }

    private static string ResolveHarnessSourceCommit(Options options)
    {
        string harness = options.ExpectedHarnessSourceCommit.Length == 0 ? options.ExpectedSourceCommit : options.ExpectedHarnessSourceCommit;
        foreach (string commit in new[] { options.ExpectedSourceCommit, harness })
            if (commit.Length != 40 || commit.Any(c => c is not (>= '0' and <= '9') and not (>= 'a' and <= 'f')))
                throw new UnauthorizedAccessException("Artifact and harness source commits must be exact lowercase40hex.");
        return harness;
    }
    private static void HostedGuard(string expected)
    {
        foreach (var pair in new Dictionary<string, string> { ["GITHUB_ACTIONS"] = "true", ["CI"] = "true", ["RUNNER_ENVIRONMENT"] = "github-hosted", ["RUNNER_OS"] = "Windows", ["GITHUB_REPOSITORY"] = "egoist-ai1/egoist-lagom" })
            if (Environment.GetEnvironmentVariable(pair.Key) != pair.Value) throw new UnauthorizedAccessException("Hosted guard refused: " + pair.Key);
        foreach (string key in new[] { "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT" })
            if (!ulong.TryParse(Environment.GetEnvironmentVariable(key), out ulong number) || number == 0) throw new UnauthorizedAccessException("Invalid hosted run identity.");
        if (expected.Length != 40 || expected.Any(c => c is not (>= '0' and <= '9') and not (>= 'a' and <= 'f')) || expected != Environment.GetEnvironmentVariable("GITHUB_SHA"))
            throw new UnauthorizedAccessException("Source commit does not match the actual hosted run.");
    }

    private static int LaunchGui(Options options)
    {
        string gui = Path.GetFullPath(options.CanonicalInstalledGuiPath), root = Path.GetDirectoryName(gui)!;
        foreach (Process existing in Process.GetProcessesByName("EgoistShield"))
        {
            using (existing)
                if (!existing.HasExited && Path.GetFullPath(existing.MainModule!.FileName).Equals(gui, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("The installed GUI is already running; ordinary-token acceptance requires a fresh main process.");
        }
        using ProtectedExecutable protectedFiles = ProtectedExecutable.OpenHost(root, "gui");
        object source = VerifySource(options, root);
        string? guiRequestedExecutionLevel = options.LaunchPolicy == "elevated" ? RequireElevatedGuiManifest(gui) : null;
        using SafeAccessTokenHandle original = OpenOwnToken();
        TokenProof runner = ReadToken(original);
        using SafeKernelHandle parent = Native.OpenParent();
        using NativeJob job = NativeJob.Create();
        var attempts = new List<object>();
        using LaunchedProcess child = options.LaunchPolicy == "elevated"
            ? LaunchWithElevatedCurrentToken(original, gui, "\"" + gui + "\"", root, options.WorkRoot, job, selfTest: false, captureStandardStreams: options.CaptureStandardStreams)
            : LaunchWithOrdinaryToken(original, gui, "\"" + gui + "\"", root, options.WorkRoot, job, attempts, selfTest: false, captureStandardStreams: options.CaptureStandardStreams);
        string stopNonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        string stopPath = Path.Combine(Path.GetDirectoryName(options.ReceiptPath)!, "stop-" + stopNonce + ".txt");
        IntPtr window = IntPtr.Zero; var windowWatch = new Stopwatch();
        try
        {
            using (Process exactChild = Process.GetProcessById(child.Pid)) GuiLaunchPolicy.RequireMainProcess(exactChild);
            child.Resume();
            var watch = Stopwatch.StartNew(); windowWatch.Start();
            while (watch.Elapsed.TotalSeconds < options.WindowTimeoutSeconds && child.Alive)
            {
                window = FindWindow(child.Pid);
                if (window != IntPtr.Zero) break;
                Thread.Sleep(100);
            }
            if (window == IntPtr.Zero) throw new IOException("The exact ordinary-token GUI did not expose a native window.");
            var ready = new { schemaVersion = 1, stage = "launched", ok = true, productLaunched = true,
                processId = child.Pid, startTimeUtc = child.StartUtc, executable = gui, arguments = Array.Empty<string>(),
                mainWindowHandle = window.ToInt64(), token = child.Proof, tokenMethod = child.TokenMethod, launchApi = child.LaunchApi,
                source, artifactSourceCommit = options.ExpectedSourceCommit, harnessSourceCommit = ResolveHarnessSourceCommit(options),
                diagnosticSourceMode = ResolveHarnessSourceCommit(options) != options.ExpectedSourceCommit, captureStandardStreams = options.CaptureStandardStreams,
                launchPolicy = options.LaunchPolicy, elevatedGui = options.LaunchPolicy == "elevated", guiRequestedExecutionLevel,
                launchEnvironment = child.LaunchEnvironment, desktop = Native.DesktopMetadata(child.ThreadId),
                windowWaitElapsedMilliseconds = windowWatch.ElapsedMilliseconds, runnerToken = runner, attempts, stopPath, stopNonce, guardianProcessId = Environment.ProcessId,
                leaseSeconds = options.LeaseSeconds, coreReady = (bool?)null, coreReadyEvidence = "UIA observation belongs to the caller; a visible window does not prove Core readiness." };
            Save(options.ReceiptPath, ready); Console.WriteLine(JsonSerializer.Serialize(ready)); Console.Out.Flush();
            while (child.Alive && Native.WaitForSingleObject(parent, 0) == 0x102 && watch.Elapsed.TotalSeconds < options.LeaseSeconds && !StopRequested(stopPath, stopNonce)) Thread.Sleep(100);
            bool exitedNormally = !child.Alive;
            uint? exitCode = exitedNormally ? child.ExitCode : null;
            object originalChild = child.Observe();
            job.Terminate();
            bool noOrphans = job.WaitEmpty(10000);
            object streams = child.Output.Finish();
            Save(options.ReceiptPath, new { schemaVersion = 1, stage = "completed", ok = noOrphans, launch = ready,
                exitedNormally, exitCode, originalChild, streams, profileMainLog = Program.ProfileLog(child.LaunchEnvironment, child.StartUtc), cleanup = new { scope = "only this launch's Job Object", noOrphans, activeProcesses = job.ActiveProcesses },
                actualInstalledOrdinaryGui = options.LaunchPolicy == "ordinary", actualInstalledElevatedGui = options.LaunchPolicy == "elevated", coreAuthorityAcceptance = "Must be supported by caller UIA/SCM receipt, not inferred from token or window." });
            return noOrphans ? 0 : 1;
        }
        catch (Exception error)
        {
            object originalChild = child.Observe(); object desktop = Native.DesktopMetadata(child.ThreadId);
            bool noOrphans = false; string? cleanupError = null;
            try { job.Terminate(); noOrphans = job.WaitEmpty(10000); } catch (Exception cleanup) { cleanupError = cleanup.Message; }
            object streams = child.Output.Finish();
            Save(options.ReceiptPath, new { schemaVersion = 1, stage = "failed", ok = false, productLaunched = true,
                processId = child.Pid, startTimeUtc = child.StartUtc, token = child.Proof, error = error.Message,
                originalChild, cleanupChild = child.Observe(), windowWaitElapsedMilliseconds = windowWatch.ElapsedMilliseconds,
                tokenMethod = child.TokenMethod, launchApi = child.LaunchApi, attempts, source, runnerToken = runner,
                artifactSourceCommit = options.ExpectedSourceCommit, harnessSourceCommit = ResolveHarnessSourceCommit(options),
                diagnosticSourceMode = ResolveHarnessSourceCommit(options) != options.ExpectedSourceCommit, captureStandardStreams = options.CaptureStandardStreams,
                launchPolicy = options.LaunchPolicy, elevatedGui = options.LaunchPolicy == "elevated", guiRequestedExecutionLevel,
                launchEnvironment = child.LaunchEnvironment, desktop, streams, profileMainLog = Program.ProfileLog(child.LaunchEnvironment, child.StartUtc),
                cleanup = new { noOrphans, activeProcesses = job.ActiveProcesses, error = cleanupError } });
            Console.Error.WriteLine(error.Message); return 1;
        }
    }

    private static object VerifySource(Options options, string installRoot)
    {
        OrdinaryPath(options.IntegrityManifestPath, leaf: true);
        using var source = new FileStream(options.IntegrityManifestPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (source.Length > 8 * 1024 * 1024) throw new InvalidDataException("Oversized source inventory.");
        string sourceHash = Convert.ToHexString(SHA256.HashData(source)); source.Position = 0;
        using JsonDocument document = JsonDocument.Parse(source, new JsonDocumentOptions { MaxDepth = 32 });
        JsonElement manifest = document.RootElement;
        if (manifest.GetProperty("product").GetString() != "Egoist Lagom" || manifest.GetProperty("source").GetProperty("commit").GetString() != options.ExpectedSourceCommit)
            throw new UnauthorizedAccessException("Candidate source/resource identity mismatch.");
        JsonElement payload = manifest.GetProperty("payload");
        if (payload.ValueKind != JsonValueKind.Array || payload.GetArrayLength() is < 1 or > 4096) throw new InvalidDataException("Invalid source payload inventory.");
        var entries = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (JsonElement entry in payload.EnumerateArray())
        {
            string key = entry.GetProperty("path").GetString() ?? "";
            if (!entries.TryAdd(key, entry)) throw new InvalidDataException("Duplicate source inventory entry.");
        }
        string inventoryPath = Path.Combine(installRoot, "resources", "worker-host-integrity.json");
        VerifyEntry("resources/worker-host-integrity.json", entries, installRoot);
        using JsonDocument inventory = JsonDocument.Parse(File.ReadAllBytes(inventoryPath));
        int checkedFiles = 1;
        foreach (JsonElement entry in inventory.RootElement.GetProperty("files").EnumerateArray())
            if (entry.GetProperty("roles").EnumerateArray().Any(role => role.GetString() == "gui"))
            { VerifyEntry(entry.GetProperty("path").GetString()!, entries, installRoot); checkedFiles++; }
        return new { commit = options.ExpectedSourceCommit, version = manifest.GetProperty("version").GetString(),
            integrityManifestSha256 = sourceHash, installedInventorySha256 = FileHash(inventoryPath), checkedFiles };
    }
    private static void VerifyEntry(string relative, Dictionary<string, JsonElement> entries, string root)
    {
        if (!entries.TryGetValue(relative, out JsonElement entry)) throw new InvalidDataException("Source inventory does not pin: " + relative);
        string path = Within(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)), root);
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length != entry.GetProperty("bytes").GetInt64() || !Convert.ToHexString(SHA256.HashData(file)).Equals(entry.GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("Installed input differs from source-bound inventory: " + relative);
    }

    private static string RequireElevatedGuiManifest(string executable)
    {
        IntPtr module = Native.LoadLibraryEx(executable, IntPtr.Zero, 0x22); // data/image resource only; no code execution
        if (module == IntPtr.Zero) throw Native.Error("Read authenticated GUI manifest");
        try
        {
            IntPtr resource = Native.FindResource(module, (IntPtr)1, (IntPtr)24);
            if (resource == IntPtr.Zero) throw Native.Error("Find authenticated GUI manifest");
            uint size = Native.SizeofResource(module, resource);
            if (size is < 1 or > 131072) throw new InvalidDataException("Invalid GUI manifest size.");
            IntPtr loaded = Native.LoadResource(module, resource), data = Native.LockResource(loaded);
            if (loaded == IntPtr.Zero || data == IntPtr.Zero) throw Native.Error("Load authenticated GUI manifest");
            byte[] bytes = new byte[size]; Marshal.Copy(data, bytes, 0, bytes.Length);
            using var stream = new MemoryStream(bytes);
            using var xml = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 131072 });
            XElement[] levels = XDocument.Load(xml).Descendants().Where(node => node.Name.LocalName == "requestedExecutionLevel").ToArray();
            if (levels.Length != 1 || (string?)levels[0].Attribute("level") != "asInvoker" || (string?)levels[0].Attribute("uiAccess") is not (null or "false"))
                throw new UnauthorizedAccessException("Authenticated elevated GUI must embed asInvoker with uiAccess=false; native entry and actual token enforce administrator admission.");
            return "asInvoker";
        }
        finally { Native.FreeLibrary(module); }
    }

    private static LaunchedProcess LaunchWithElevatedCurrentToken(SafeAccessTokenHandle original, string executable, string commandLine,
        string directory, string work, NativeJob job, bool selfTest, bool captureStandardStreams = true)
    {
        if (!ReadToken(original).ElevatedManagement) throw new UnauthorizedAccessException("Actual current Windows token is not an elevated interactive administrator.");
        return job.Start(original, executable, commandLine, directory, work, "current-elevated", true, selfTest, captureStandardStreams, requireElevated: true);
    }

    private static int ElevatedSelfTest(Options options, SafeAccessTokenHandle original, TokenProof current)
    {
        using NativeJob job = NativeJob.Create();
        if (!current.ElevatedManagement)
        {
            uint active = job.ActiveProcesses;
            var refusal = new { schemaVersion = 1, stage = "elevated-fixture-refused", ok = false, productLaunched = false, childCreated = false,
                launchPolicy = "elevated", failureCode = "current-token-not-elevated", runnerToken = current, noOrphans = active == 0, activeProcesses = active,
                error = "Actual current Windows token is not an elevated interactive administrator; no token filtering or elevation was attempted." };
            Save(options.ReceiptPath, refusal); Console.WriteLine(JsonSerializer.Serialize(refusal, Json)); return 1;
        }
        object early = EarlyExitProof(options, original, out bool earlyPassed);
        object baseline = EarlyExitProof(options, original, out bool baselinePassed, capture: false);
        object crash = CrashProof(options, out bool crashPassed);
        uint remaining = job.ActiveProcesses;
        var receipt = new { schemaVersion = 1, stage = "self-test", ok = earlyPassed && baselinePassed && crashPassed && remaining == 0,
            productLaunched = false, launchPolicy = "elevated", elevatedGui = false, runnerToken = current, earlyExit = early, originalEarlyExit = baseline,
            guardianCrash = crash, noOrphans = remaining == 0, activeProcesses = remaining,
            installedGuiAcceptance = "not executed; actual current elevated token and own fixed harmless child only" };
        Save(options.ReceiptPath, receipt); Console.WriteLine(JsonSerializer.Serialize(receipt, Json)); return receipt.ok ? 0 : 1;
    }

    private static int SelfTest(Options options)
    {
        using SafeAccessTokenHandle original = OpenOwnToken(); TokenProof current = ReadToken(original);
        if (options.LaunchPolicy == "elevated") return ElevatedSelfTest(options, original, current);
        using NativeJob job = NativeJob.Create(); var attempts = new List<object>();
        string executable = Environment.ProcessPath!;
        using LaunchedProcess child = LaunchWithOrdinaryToken(original, executable, "\"" + executable + "\" --proof-child", Path.GetDirectoryName(executable)!, options.WorkRoot, job, attempts, selfTest: true);
        child.Resume(); Thread.Sleep(100);
        bool aliveBefore = child.Alive;
        job.Terminate(); bool empty = job.WaitEmpty(10000);
        var candidateCases = new List<object>(); bool candidateCasesPassed = true;
        foreach (string method in new[] { "safer-normal-user", "restricted-lua" })
        {
            using TokenCandidate candidate = MakeCandidate(original, method); TokenProof proof = ReadToken(candidate.Handle);
            using NativeJob candidateJob = NativeJob.Create();
            using LaunchedProcess candidateChild = candidateJob.Start(candidate.Handle, executable, "\"" + executable + "\" --proof-child", Path.GetDirectoryName(executable)!, options.WorkRoot, method, false, true);
            candidateChild.Resume(); Thread.Sleep(100); bool observedAlive = candidateChild.Alive;
            candidateJob.Terminate(); bool zero = candidateJob.WaitEmpty(10000);
            bool passed = proof.Ordinary && candidateChild.Proof.Ordinary && observedAlive && zero;
            candidateCasesPassed &= passed;
            candidateCases.Add(new { method, passed, token = candidateChild.Proof, launchApi = candidateChild.LaunchApi, observedAlive, noOrphans = zero, activeProcesses = candidateJob.ActiveProcesses });
        }
        object earlyExit = EarlyExitProof(options, original, out bool earlyExitPassed);
        object originalEarlyExit = EarlyExitProof(options, original, out bool originalEarlyExitPassed, capture: false);
        object crash = CrashProof(options, out bool crashPassed);
        var receipt = new { schemaVersion = 1, stage = "self-test", ok = aliveBefore && empty && child.Proof.Ordinary && candidateCasesPassed && crashPassed && earlyExitPassed && originalEarlyExitPassed,
            productLaunched = false, runnerToken = current, token = child.Proof, tokenMethod = child.TokenMethod,
            launchApi = child.LaunchApi, processId = child.Pid, startTimeUtc = child.StartUtc, attempts,
            aliveBeforeCleanup = aliveBefore, noOrphans = empty, activeProcesses = job.ActiveProcesses, candidateCases, guardianCrash = crash, earlyExit, originalEarlyExit,
            installedGuiAcceptance = "not executed; own fixed harmless child only" };
        Save(options.ReceiptPath, receipt); Console.WriteLine(JsonSerializer.Serialize(receipt, Json));
        return receipt.ok ? 0 : 1;
    }

    private static object EarlyExitProof(Options options, SafeAccessTokenHandle original, out bool passed, bool capture = true)
    {
        using NativeJob job = NativeJob.Create(); var attempts = new List<object>(); string executable = Environment.ProcessPath!;
        using LaunchedProcess child = options.LaunchPolicy == "elevated"
            ? LaunchWithElevatedCurrentToken(original, executable, "\"" + executable + "\" --proof-exit-child", Path.GetDirectoryName(executable)!, options.WorkRoot, job, selfTest: true, captureStandardStreams: capture)
            : LaunchWithOrdinaryToken(original, executable, "\"" + executable + "\" --proof-exit-child", Path.GetDirectoryName(executable)!, options.WorkRoot, job, attempts, selfTest: true, captureStandardStreams: capture);
        child.Resume(); uint wait = Native.WaitForSingleObject(child.Process, 10000);
        ChildObservation before = child.Observe(); job.Terminate(); bool empty = job.WaitEmpty(10000); OutputProof streams = child.Output.Finish();
        bool streamsAccepted = streams.CaptureAvailable ? streams.Stdout.Text == "ordinary-diag-stdout\n" && streams.Stderr.Text == "ordinary-diag-stderr\n" && streams.Stdout.Completed && streams.Stderr.Completed : !string.IsNullOrEmpty(streams.UnavailableReason);
        passed = wait == 0 && before.WaitResult == 0 && before.ExitCode == 37 && empty && (options.LaunchPolicy == "elevated" ? child.Proof.ElevatedManagement : child.Proof.Ordinary) && streamsAccepted;
        return new { passed, productLaunched = false, processId = child.Pid, startTimeUtc = child.StartUtc, token = child.Proof, launchPolicy = options.LaunchPolicy,
            tokenMethod = child.TokenMethod, launchApi = child.LaunchApi, originalChild = before, cleanupChild = child.Observe(), streams,
            desktop = Native.DesktopMetadata(child.ThreadId), launchEnvironment = child.LaunchEnvironment, noOrphans = empty, activeProcesses = job.ActiveProcesses };
    }
    internal static Dictionary<string, string> EnvironmentMetadata(string block) => block.Split('\0', StringSplitOptions.RemoveEmptyEntries)
        .Select(value => value.Split('=', 2)).Where(pair => pair.Length == 2 && pair[0] is "USERPROFILE" or "APPDATA" or "LOCALAPPDATA" or "TEMP" or "TMP")
        .ToDictionary(pair => pair[0], pair => pair[1], StringComparer.OrdinalIgnoreCase);
    internal static object ProfileLog(Dictionary<string, string> environment, string started)
    {
        string? path = null;
        try
        {
            if (!environment.TryGetValue("APPDATA", out string? appData) || !Path.IsPathFullyQualified(appData) || appData.StartsWith(@"\\")) return new { status = "unavailable", reason = "No local canonical target APPDATA." };
            path = Within(Path.Combine(appData, "Egoist Shield", "logs", "main.log"), appData);
            if (!File.Exists(path)) return new { status = "missing", path };
            OrdinaryPath(path, true); using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            long offset = Math.Max(0, file.Length - 32768); file.Seek(offset, SeekOrigin.Begin); byte[] bytes = new byte[32768]; int count = file.Read(bytes);
            DateTime written = File.GetLastWriteTimeUtc(path);
            return new { status = "available", path, modifiedSinceLaunch = written >= DateTime.Parse(started).ToUniversalTime(), lastWriteUtc = written,
                bytes = count, truncated = offset != 0, text = Encoding.UTF8.GetString(bytes, 0, count), attribution = "Shared canonical profile log; not PID-bound." };
        }
        catch (Exception error) { return new { status = "unavailable", path, error = error.Message }; }
    }
    private static int FixtureGuardian(Options options)
    {
        using SafeAccessTokenHandle original = OpenOwnToken();
        using NativeJob job = NativeJob.Create(); string executable = Environment.ProcessPath!;
        using LaunchedProcess child = options.LaunchPolicy == "elevated"
            ? LaunchWithElevatedCurrentToken(original, executable, "\"" + executable + "\" --proof-child", Path.GetDirectoryName(executable)!, options.WorkRoot, job, selfTest: true)
            : LaunchOrdinaryFixtureGuardian(original, executable, options.WorkRoot, job);
        child.Resume();
        Save(options.ReceiptPath, new { stage = "fixture-launched", processId = child.Pid, startTimeUtc = child.StartUtc, token = child.Proof, activeProcesses = job.ActiveProcesses });
        // The outer self-test terminates only this exact guardian handle.
        Thread.Sleep(120000); return 0;
    }

    private static LaunchedProcess LaunchOrdinaryFixtureGuardian(SafeAccessTokenHandle original, string executable, string work, NativeJob job)
    {
        using TokenCandidate candidate = MakeCandidate(original, "restricted-lua");
        if (!ReadToken(candidate.Handle).Ordinary) throw new UnauthorizedAccessException("Fixture token failed ordinary proof.");
        return job.Start(candidate.Handle, executable, "\"" + executable + "\" --proof-child", Path.GetDirectoryName(executable)!, work, "restricted-lua", false, true);
    }

    private static object CrashProof(Options options, out bool passed)
    {
        string directory = Path.Combine(options.WorkRoot, "ordinary-crash-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
        string receiptPath = Path.Combine(directory, "child.json"), input = Path.Combine(directory, "options.json");
        File.WriteAllText(input, JsonSerializer.Serialize(new Options("fixture-guardian", options.WorkRoot, receiptPath, LeaseSeconds: 10, WindowTimeoutSeconds: 1, LaunchPolicy: options.LaunchPolicy), Json), new UTF8Encoding(false));
        var info = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (string key in info.Environment.Keys.ToArray()) if (key.StartsWith("DOTNET_", StringComparison.OrdinalIgnoreCase) || key.StartsWith("COMPLUS_", StringComparison.OrdinalIgnoreCase) || key.StartsWith("CORECLR_", StringComparison.OrdinalIgnoreCase)) info.Environment.Remove(key);
        string runtimeRoot = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(typeof(object).Assembly.Location)!, "..", "..", ".."));
        info.Environment["DOTNET_ROOT"] = runtimeRoot; info.Environment["DOTNET_ROOT_X64"] = runtimeRoot;
        info.ArgumentList.Add("--options"); info.ArgumentList.Add(input);
        using Process guardian = Process.Start(info) ?? throw new IOException("Own fixture guardian did not start.");
        Task<string> output = guardian.StandardOutput.ReadToEndAsync(), errors = guardian.StandardError.ReadToEndAsync();
        SafeKernelHandle? child = null;
        try
        {
            var watch = Stopwatch.StartNew();
            while (!File.Exists(receiptPath) && !guardian.HasExited && watch.ElapsedMilliseconds < 10000) Thread.Sleep(50);
            if (!File.Exists(receiptPath)) throw new IOException("Own crash fixture guardian failed: " + (guardian.HasExited ? errors.GetAwaiter().GetResult() : "timeout"));
            using JsonDocument document = JsonDocument.Parse(File.ReadAllBytes(receiptPath)); JsonElement receipt = document.RootElement;
            int pid = receipt.GetProperty("processId").GetInt32(); string created = receipt.GetProperty("startTimeUtc").GetString()!;
            child = new SafeKernelHandle(Native.OpenProcess(0x00101001, false, checked((uint)pid)));
            if (child.IsInvalid || !Native.GetProcessTimes(child, out long childCreated, out _, out _, out _) || DateTime.FromFileTimeUtc(childCreated).ToString("O", System.Globalization.CultureInfo.InvariantCulture) != created)
                throw new IOException("Own crash fixture child identity changed.");
            using SafeAccessTokenHandle childToken = OpenChildToken(child); TokenProof proof = ReadToken(childToken);
            bool alive = Native.WaitForSingleObject(child, 0) == 0x102;
            guardian.Kill(); bool guardianExited = guardian.WaitForExit(5000);
            bool childExited = Native.WaitForSingleObject(child, 10000) == 0;
            passed = alive && guardianExited && childExited && (options.LaunchPolicy == "elevated" ? proof.ElevatedManagement : proof.Ordinary);
            return new { passed, guardianProcessId = guardian.Id, childProcessId = pid, childStartTimeUtc = created, token = proof,
                aliveBeforeGuardianCrash = alive, guardianExited, childExitedAfterGuardianCrash = childExited, noOrphans = childExited,
                containment = "atomic JOB_LIST; kill-on-close; no finally or child PID termination in the tested path" };
        }
        finally
        {
            if (!guardian.HasExited) { guardian.Kill(); guardian.WaitForExit(5000); }
            // Failure cleanup is limited to the handle whose creation time was
            // checked above. It never selects an existing product process.
            if (child is not null) { if (!child.IsInvalid && Native.WaitForSingleObject(child, 0) == 0x102) Native.TerminateProcess(child, 1); child.Dispose(); }
            if (guardian.HasExited) { _ = output.GetAwaiter().GetResult(); _ = errors.GetAwaiter().GetResult(); }
        }
    }

    private static LaunchedProcess LaunchWithOrdinaryToken(SafeAccessTokenHandle original, string executable, string commandLine,
        string directory, string work, NativeJob job, List<object> attempts, bool selfTest, bool captureStandardStreams = true)
    {
        TokenProof source = ReadToken(original);
        foreach (string method in new[] { "linked", "safer-normal-user", "restricted-lua" })
        {
            try
            {
                using TokenCandidate candidate = MakeCandidate(original, method);
                TokenProof proof = ReadToken(candidate.Handle);
                if (!proof.Ordinary || proof.UserSid != source.UserSid || proof.SessionId != source.SessionId) throw new UnauthorizedAccessException("Candidate is not an ordinary medium token of the same interactive user.");
                LaunchedProcess child = job.Start(candidate.Handle, executable, commandLine, directory, work, method, false, selfTest, captureStandardStreams);
                attempts.Add(new { method, accepted = true, token = proof }); return child;
            }
            catch (Exception error) { attempts.Add(new { method, accepted = false, error = error.Message, nativeError = error is Win32Exception win32 ? win32.NativeErrorCode : (int?)null }); }
        }
        // Local non-admin fixture can still exercise atomic containment. This is
        // explicitly never an installed-GUI launch or an elevated fallback.
        if (selfTest && source.Ordinary)
        {
            attempts.Add(new { method = "current-medium-fixture-only", accepted = true, limitation = "No alternate-token creation privilege on this host." });
            return job.Start(original, executable, commandLine, directory, work, "current-medium-fixture-only", true, true, captureStandardStreams);
        }
        throw new UnauthorizedAccessException("No verified ordinary medium token could launch the child. No elevated fallback was attempted. " + JsonSerializer.Serialize(attempts));
    }

    private static TokenCandidate MakeCandidate(SafeAccessTokenHandle original, string method)
    {
        SafeAccessTokenHandle token;
        if (method == "linked")
        {
            if (TokenInt(original, 18) != 2) throw new InvalidOperationException("The current token is not full/elevated; no limited linked-token candidate is requested.");
            using NativeBuffer linked = TokenBuffer(original, 19); IntPtr handle = Marshal.ReadIntPtr(linked.Pointer);
            using var linkedToken = new SafeAccessTokenHandle(handle);
            if (!Native.DuplicateTokenEx(linkedToken, 0x02000000, IntPtr.Zero, 2, 1, out token)) throw Native.Error("Duplicate linked primary token");
        }
        else if (method == "safer-normal-user")
        {
            if (!Native.SaferCreateLevel(1, 0x20000, 1, out IntPtr level, IntPtr.Zero)) throw Native.Error("SaferCreateLevel NORMALUSER");
            try { if (!Native.SaferComputeTokenFromLevel(level, original, out token, 0, IntPtr.Zero)) throw Native.Error("SaferComputeTokenFromLevel"); }
            finally { Native.SaferCloseLevel(level); }
        }
        else
        {
            using NativeBuffer ba = SidBuffer("S-1-5-32-544"), power = SidBuffer("S-1-5-32-547");
            var denied = new[] { new Native.SidAndAttributes { Sid = ba.Pointer }, new Native.SidAndAttributes { Sid = power.Pointer } };
            if (!Native.CreateRestrictedToken(original, 5, (uint)denied.Length, denied, 0, IntPtr.Zero, 0, IntPtr.Zero, out token)) throw Native.Error("CreateRestrictedToken LUA/MAX_PRIVILEGE");
        }
        try
        {
            TokenProof proof = ReadToken(token);
            if (proof.IntegrityRid > 0x2000)
            {
                using NativeBuffer medium = SidBuffer("S-1-16-8192");
                var label = new Native.SidAndAttributes { Sid = medium.Pointer, Attributes = 0x20 };
                if (!Native.SetTokenInformation(token, 25, ref label, (uint)(Marshal.SizeOf<Native.SidAndAttributes>() + medium.Length))) throw Native.Error("Lower token integrity to medium");
            }
            return new TokenCandidate(method, token);
        }
        catch { token.Dispose(); throw; }
    }

    internal static TokenProof ReadToken(SafeAccessTokenHandle token)
    {
        using NativeBuffer user = TokenBuffer(token, 1), groups = TokenBuffer(token, 2), integrity = TokenBuffer(token, 25), privileges = TokenBuffer(token, 3);
        string userSid = new SecurityIdentifier(Marshal.ReadIntPtr(user.Pointer)).Value;
        int count = Marshal.ReadInt32(groups.Pointer), stride = Marshal.SizeOf<Native.SidAndAttributes>(), offset = IntPtr.Size == 8 ? 8 : 4;
        if (count < 0 || count > 2048 || offset + count * stride > groups.Length) throw new InvalidDataException("Malformed token groups.");
        bool ba = false;
        for (int i = 0; i < count; i++)
        {
            var group = Marshal.PtrToStructure<Native.SidAndAttributes>(groups.Pointer + offset + i * stride);
            if (new SecurityIdentifier(group.Sid).Value == "S-1-5-32-544") ba |= (group.Attributes & 4) != 0 && (group.Attributes & 16) == 0;
        }
        string integritySid = new SecurityIdentifier(Marshal.ReadIntPtr(integrity.Pointer)).Value;
        int rid = int.Parse(integritySid.Split('-')[^1], System.Globalization.CultureInfo.InvariantCulture);
        int privilegeCount = Marshal.ReadInt32(privileges.Pointer); var enabled = new List<string>();
        if (privilegeCount < 0 || privilegeCount > 128 || 4 + privilegeCount * 12 > privileges.Length) throw new InvalidDataException("Malformed token privileges.");
        for (int i = 0; i < privilegeCount; i++)
        {
            IntPtr row = privileges.Pointer + 4 + 12 * i;
            if ((Marshal.ReadInt32(row + 8) & 2) == 0) continue;
            var luid = new Native.Luid { Low = unchecked((uint)Marshal.ReadInt32(row)), High = Marshal.ReadInt32(row + 4) };
            uint size = 128; var name = new StringBuilder((int)size);
            if (!Native.LookupPrivilegeName(null, ref luid, name, ref size)) throw Native.Error("Read token privilege name");
            enabled.Add(name.ToString());
        }
        return new TokenProof(userSid, TokenInt(token, 20) != 0, ba, rid, integritySid, TokenInt(token, 12), TokenInt(token, 18), Native.IsTokenRestricted(token), TokenInt(token, 26) != 0, TokenInt(token, 8), TokenInt(token, 21) != 0, enabled.ToArray());
    }
    private static int TokenInt(SafeAccessTokenHandle token, int kind)
    { using NativeBuffer value = TokenBuffer(token, kind); return value.Length == 1 ? Marshal.ReadByte(value.Pointer) : value.Length >= 4 ? Marshal.ReadInt32(value.Pointer) : throw new InvalidDataException("Unexpected scalar token information size."); }
    private static NativeBuffer TokenBuffer(SafeAccessTokenHandle token, int kind)
    {
        Native.GetTokenInformation(token, kind, IntPtr.Zero, 0, out uint size);
        if (size is < 1 or > 65536) throw new InvalidDataException($"Invalid token information size ({kind}: {size}).");
        var buffer = new NativeBuffer((int)size);
        if (!Native.GetTokenInformation(token, kind, buffer.Pointer, size, out _)) { buffer.Dispose(); throw Native.Error("Read token information"); }
        return buffer;
    }
    private static SafeAccessTokenHandle OpenOwnToken()
    { if (!Native.OpenProcessToken(Native.GetCurrentProcess(), TokenAccess | 0x80, out SafeAccessTokenHandle token)) throw Native.Error("Open caller token"); return token; }
    internal static SafeAccessTokenHandle OpenChildToken(SafeKernelHandle process)
    { if (!Native.OpenProcessToken(process.DangerousGetHandle(), 8, out SafeAccessTokenHandle token)) throw Native.Error("Open actual child token"); return token; }
    private static NativeBuffer SidBuffer(string value)
    { var sid = new SecurityIdentifier(value); byte[] bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0); var buffer = new NativeBuffer(bytes.Length); Marshal.Copy(bytes, 0, buffer.Pointer, bytes.Length); return buffer; }
    internal static string EnvironmentBlock(SafeAccessTokenHandle token, string work, bool managedFixture)
    {
        if (!Native.CreateEnvironmentBlock(out IntPtr environment, token, false)) throw Native.Error("Create target user's environment");
        var values = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            int position = 0;
            while (position < 65536)
            {
                if (Marshal.ReadInt16(environment + position * 2) == 0) break;
                int end = position;
                while (end < 65536 && Marshal.ReadInt16(environment + end * 2) != 0) end++;
                if (end == 65536) throw new InvalidDataException("Target environment exceeded bounds.");
                string text = Marshal.PtrToStringUni(environment + position * 2, end - position)!; position = end + 1;
                int separator = text.IndexOf('='); if (separator <= 0) continue;
                string name = text[..separator];
                if (name is "USERPROFILE" or "APPDATA" or "LOCALAPPDATA" or "HOMEDRIVE" or "HOMEPATH" or "USERNAME" or "USERDOMAIN" or "COMPUTERNAME" or "SESSIONNAME") values[name] = text[(separator + 1)..];
            }
        }
        finally { Native.DestroyEnvironmentBlock(environment); }
        var system = new StringBuilder(32768); if (Native.GetSystemDirectory(system, (uint)system.Capacity) == 0) throw Native.Error("Get actual system directory");
        string windows = Directory.GetParent(system.ToString())!.FullName;
        string systemDrive = Path.GetPathRoot(windows)?.TrimEnd('\\', '/') ?? "";
        if (systemDrive.Length != 2 || !char.IsAsciiLetter(systemDrive[0]) || systemDrive[1] != ':') throw new InvalidDataException("Actual Windows drive is unavailable.");
        values["SystemDrive"] = systemDrive;
        values["PATH"] = system.ToString(); values["SystemRoot"] = windows; values["WINDIR"] = windows;
        values["ProgramData"] = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        values["ALLUSERSPROFILE"] = values["ProgramData"];
        values["ProgramFiles"] = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        values["ProgramFiles(x86)"] = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        values["ProgramW6432"] = values["ProgramFiles"];
        values["ComSpec"] = Path.Combine(system.ToString(), "cmd.exe");
        values["TEMP"] = work; values["TMP"] = work; values["NODE_ENV"] = "production";
        if (managedFixture)
        {
            // Only this source-built harmless fixture needs the exact already
            // loaded .NET runtime. No installed GUI receives .NET overrides.
            string runtimeRoot = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(typeof(object).Assembly.Location)!, "..", "..", ".."));
            values["DOTNET_ROOT"] = runtimeRoot; values["DOTNET_ROOT_X64"] = runtimeRoot;
        }
        return string.Join('\0', values.Select(pair => pair.Key + "=" + pair.Value)) + "\0\0";
    }
    private static IntPtr FindWindow(int pid)
    {
        IntPtr found = IntPtr.Zero;
        Native.EnumWindows((window, _) => { Native.GetWindowThreadProcessId(window, out uint owner); if (owner == pid && Native.IsWindowVisible(window)) { found = window; return false; } return true; }, IntPtr.Zero);
        return found;
    }
    private static bool StopRequested(string path, string nonce)
    { if (!File.Exists(path)) return false; using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite); return file.Length <= 128 && new StreamReader(file).ReadToEnd() == "stop:" + nonce; }
    internal static string Within(string path, string root)
    {
        if (!Path.IsPathFullyQualified(path) || !Path.IsPathFullyQualified(root)) throw new InvalidDataException("Absolute scoped paths required.");
        string full = Path.GetFullPath(path), container = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        if (!full.StartsWith(container + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("Harness path escaped its scope."); return full;
    }
    private static bool ValidReceiptLocation(Options options)
    { try { _ = Within(options.ReceiptPath, options.WorkRoot); OrdinaryPath(options.WorkRoot, false); OrdinaryPath(Path.GetDirectoryName(options.ReceiptPath)!, false); return !File.Exists(options.ReceiptPath); } catch { return false; } }
    internal static void OrdinaryPath(string path, bool leaf)
    {
        string current = Path.GetFullPath(path); bool first = true;
        while (!string.IsNullOrEmpty(current))
        {
            FileAttributes attributes = File.GetAttributes(current);
            if ((attributes & FileAttributes.ReparsePoint) != 0 || first && ((attributes & FileAttributes.Directory) != 0) == leaf) throw new UnauthorizedAccessException("Reparse/type mismatch in harness path.");
            string? parent = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(current)); if (parent == current) break; current = parent ?? ""; first = false;
        }
    }
    private static string FileHash(string path) { using var file = File.OpenRead(path); return Convert.ToHexString(SHA256.HashData(file)); }
    private static void Save(string path, object receipt)
    { string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp"; File.WriteAllText(temporary, JsonSerializer.Serialize(receipt, Json), new UTF8Encoding(false)); File.Move(temporary, path, true); }
}

internal sealed class NativeBuffer(int length) : IDisposable
{
    internal IntPtr Pointer { get; } = Marshal.AllocHGlobal(length);
    internal int Length { get; } = length;
    public void Dispose() => Marshal.FreeHGlobal(Pointer);
}
internal sealed class SafeKernelHandle : SafeHandleZeroOrMinusOneIsInvalid
{
    internal SafeKernelHandle(IntPtr value) : base(true) => SetHandle(value);
    protected override bool ReleaseHandle() => Native.CloseHandle(handle);
}
internal sealed record ChildObservation(uint WaitResult, int? WaitNativeError, uint? ExitCode, int? ExitCodeNativeError, string ObservedAtUtc, string? ProcessStartUtc, string? ProcessExitUtc, int? ProcessTimesNativeError);
internal sealed record CapturedStream(string Text, long ObservedBytes, bool Truncated, bool Completed, int? NativeError);
internal sealed record OutputProof(bool CaptureAvailable, string? UnavailableReason, CapturedStream Stdout, CapturedStream Stderr);
internal sealed class NativeChildOutput : IDisposable
{
    internal readonly SafeFileHandle Input, OutRead, OutWrite, ErrRead, ErrWrite;
    private readonly CancellationTokenSource _stop = new(); private Task<CapturedStream>? _stdout, _stderr;
    private bool _enabled; private string? _reason; private int _disposed;
    internal IntPtr[] InheritedHandles => new[] { Input.DangerousGetHandle(), OutWrite.DangerousGetHandle(), ErrWrite.DangerousGetHandle() };
    internal NativeChildOutput(bool create)
    {
        if (!create) { Input = new(IntPtr.Zero, false); OutRead = new(IntPtr.Zero, false); OutWrite = new(IntPtr.Zero, false); ErrRead = new(IntPtr.Zero, false); ErrWrite = new(IntPtr.Zero, false); return; }
        var security = new Native.SecurityAttributes { Length = Marshal.SizeOf<Native.SecurityAttributes>(), Inherit = 1 };
        Input = Native.CreateFile("NUL", 0x80000000, 3, ref security, 3, 0, IntPtr.Zero);
        if (Input.IsInvalid) throw Native.Error("Open owned NUL stdin");
        try
        {
            if (!Native.CreatePipe(out OutRead, out OutWrite, ref security, 4096) || !Native.CreatePipe(out ErrRead, out ErrWrite, ref security, 4096)) throw Native.Error("Create owned diagnostic pipes");
            if (!Native.SetHandleInformation(OutRead, 1, 0) || !Native.SetHandleInformation(ErrRead, 1, 0)) throw Native.Error("Clear diagnostic read-handle inheritance");
        }
        catch { Input.Dispose(); OutRead?.Dispose(); OutWrite?.Dispose(); ErrRead?.Dispose(); ErrWrite?.Dispose(); throw; }
    }
    internal void Start(bool enabled, string? unavailable)
    {
        _enabled = enabled; _reason = unavailable;
        Input.Dispose(); OutWrite.Dispose(); ErrWrite.Dispose();
        if (enabled) { _stdout = Task.Run(() => Drain(OutRead)); _stderr = Task.Run(() => Drain(ErrRead)); }
    }
    private CapturedStream Drain(SafeFileHandle read)
    {
        using var kept = new MemoryStream(); byte[] buffer = new byte[4096]; long total = 0; int? error = null; bool completed = false;
        try { while (!_stop.IsCancellationRequested)
        {
            if (!Native.PeekNamedPipe(read, IntPtr.Zero, 0, IntPtr.Zero, out uint available, IntPtr.Zero))
            { int code = Marshal.GetLastWin32Error(); completed = code == 109; error = completed ? null : code; break; }
            if (available == 0) { Thread.Sleep(20); continue; }
            if (!Native.ReadFile(read, buffer, Math.Min(available, (uint)buffer.Length), out uint count, IntPtr.Zero)) { error = Marshal.GetLastWin32Error(); break; }
            total += count; int keep = (int)Math.Min(count, 32768 - kept.Length); if (keep > 0) kept.Write(buffer, 0, keep);
        }
        } catch (Exception failure) { error = failure is Win32Exception native ? native.NativeErrorCode : failure.HResult; }
        return new CapturedStream(Encoding.UTF8.GetString(kept.ToArray()), total, total > 32768, completed, error);
    }
    internal OutputProof Finish()
    {
        if (!_enabled) return new(false, _reason ?? "Capture was not started.", new("", 0, false, true, null), new("", 0, false, true, null));
        Task[] tasks = new Task[] { _stdout!, _stderr! }; bool complete = false;
        try { complete = Task.WaitAll(tasks, 2000); if (!complete) { _stop.Cancel(); complete = Task.WaitAll(tasks, 500); } }
        catch (Exception failure) { _reason = "Owned diagnostic drain failed: " + failure.Message; _stop.Cancel(); }
        return new(true, _reason ?? (complete ? null : "Owned pipe drains did not finish inside their bound."),
            _stdout!.IsCompletedSuccessfully ? _stdout.Result : new("", 0, false, false, null), _stderr!.IsCompletedSuccessfully ? _stderr.Result : new("", 0, false, false, null));
    }
    public void Dispose() { if (Interlocked.Exchange(ref _disposed, 1) != 0) return; _stop.Cancel(); Input.Dispose(); OutWrite.Dispose(); ErrWrite.Dispose(); OutRead.Dispose(); ErrRead.Dispose(); _stop.Dispose(); }
}
internal sealed class NativeChildAttributes : IDisposable
{
    private readonly NativeBuffer _attributes, _job, _handles;
    internal IntPtr Pointer => _attributes.Pointer;
    internal NativeChildAttributes(SafeKernelHandle job, IntPtr[]? inherited)
    {
        int count = inherited is null ? 1 : 2; IntPtr bytes = IntPtr.Zero; Native.InitializeProcThreadAttributeList(IntPtr.Zero, count, 0, ref bytes);
        _attributes = new NativeBuffer(checked((int)bytes)); _job = new NativeBuffer(IntPtr.Size); _handles = new NativeBuffer(3 * IntPtr.Size);
        bool initialized = false;
        try
        {
            if (!Native.InitializeProcThreadAttributeList(Pointer, count, 0, ref bytes)) throw Native.Error("Initialize atomic child attributes");
            initialized = true; Marshal.WriteIntPtr(_job.Pointer, job.DangerousGetHandle());
            if (!Native.UpdateProcThreadAttribute(Pointer, 0, (IntPtr)0x2000d, _job.Pointer, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) throw Native.Error("Set atomic JOB_LIST");
            if (inherited is not null)
            {
                for (int index = 0; index < inherited.Length; index++) Marshal.WriteIntPtr(_handles.Pointer, index * IntPtr.Size, inherited[index]);
                if (!Native.UpdateProcThreadAttribute(Pointer, 0, (IntPtr)0x20002, _handles.Pointer, (IntPtr)(3 * IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) throw Native.Error("Set exact standard-handle inheritance list");
            }
        }
        catch { if (initialized) Native.DeleteProcThreadAttributeList(Pointer); _handles.Dispose(); _job.Dispose(); _attributes.Dispose(); throw; }
    }
    public void Dispose() { Native.DeleteProcThreadAttributeList(Pointer); _handles.Dispose(); _job.Dispose(); _attributes.Dispose(); }
}
internal sealed class LaunchedProcess : IDisposable
{
    internal readonly SafeKernelHandle Process, Thread;
    internal readonly int Pid; internal readonly uint ThreadId; internal readonly string StartUtc, TokenMethod, LaunchApi; internal readonly TokenProof Proof;
    internal readonly NativeChildOutput Output; internal readonly Dictionary<string, string> LaunchEnvironment;
    internal LaunchedProcess(Native.ProcessInformation info, string method, string api, string executable, NativeChildOutput output, Dictionary<string, string> environment, bool requireElevated)
    {
        Process = new(info.Process); Thread = new(info.Thread); Pid = checked((int)info.ProcessId); ThreadId = info.ThreadId; TokenMethod = method; LaunchApi = api; Output = output; LaunchEnvironment = environment;
        try
        {
            using SafeAccessTokenHandle token = Program.OpenChildToken(Process); Proof = Program.ReadToken(token);
            if (!(requireElevated ? Proof.ElevatedManagement : Proof.Ordinary)) throw new UnauthorizedAccessException(requireElevated ? "Actual suspended child token is not an elevated interactive administrator." : "Actual suspended child token is not ordinary medium.");
            var path = new StringBuilder(32768); uint length = (uint)path.Capacity;
            if (!Native.QueryFullProcessImageName(Process, 0, path, ref length) || !path.ToString().Equals(executable, StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("Actual suspended child executable mismatch.");
            if (!Native.GetProcessTimes(Process, out long created, out _, out _, out _)) throw Native.Error("Get actual process creation time");
            StartUtc = DateTime.FromFileTimeUtc(created).ToString("O", System.Globalization.CultureInfo.InvariantCulture);
        }
        catch { Native.TerminateProcess(Process, 1); Dispose(); throw; }
    }
    internal ChildObservation Observe()
    {
        uint wait = Native.WaitForSingleObject(Process, 0); int? waitError = wait == uint.MaxValue ? Marshal.GetLastWin32Error() : null;
        bool read = Native.GetExitCodeProcess(Process, out uint code); int? exitError = read ? null : Marshal.GetLastWin32Error();
        bool timesRead = Native.GetProcessTimes(Process, out long created, out long exited, out _, out _);
        int? timesError = timesRead ? null : Marshal.GetLastWin32Error();
        string? startUtc = timesRead ? DateTime.FromFileTimeUtc(created).ToString("O", System.Globalization.CultureInfo.InvariantCulture) : null;
        string? exitUtc = timesRead && exited > 0 ? DateTime.FromFileTimeUtc(exited).ToString("O", System.Globalization.CultureInfo.InvariantCulture) : null;
        return new(wait, waitError, read ? code : null, exitError, DateTimeOffset.UtcNow.ToString("o"), startUtc, exitUtc, timesError);
    }
    internal bool Alive => Native.WaitForSingleObject(Process, 0) == 0x102;
    internal uint ExitCode { get { if (!Native.GetExitCodeProcess(Process, out uint code)) throw Native.Error("Get child exit code"); return code; } }
    internal void Resume() { if (Native.ResumeThread(Thread) == uint.MaxValue) throw Native.Error("Resume verified ordinary child"); }
    public void Dispose() { Output.Dispose(); Thread.Dispose(); Process.Dispose(); }
}
internal sealed class NativeJob : IDisposable
{
    private readonly SafeKernelHandle _handle;
    private NativeJob(SafeKernelHandle handle) => _handle = handle;
    internal static NativeJob Create()
    {
        var handle = new SafeKernelHandle(Native.CreateJobObject(IntPtr.Zero, null));
        if (handle.IsInvalid) throw Native.Error("Create owned Job Object");
        var limits = new Native.JobExtendedLimits(); limits.Basic.LimitFlags = 0x2000;
        if (!Native.SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf<Native.JobExtendedLimits>())) { handle.Dispose(); throw Native.Error("Set kill-on-close job"); }
        return new NativeJob(handle);
    }
    internal LaunchedProcess Start(SafeAccessTokenHandle token, string executable, string commandLine, string directory, string work, string method, bool fixtureInherited, bool managedFixture, bool captureStandardStreams = true, bool requireElevated = false)
    {
        var output = new NativeChildOutput(captureStandardStreams); bool transferred = false;
        try
        {
            using var attributes = new NativeChildAttributes(_handle, captureStandardStreams ? output.InheritedHandles : null);
            var startup = new Native.StartupInfoEx { Startup = new Native.StartupInfo { Size = Marshal.SizeOf<Native.StartupInfoEx>(), Flags = captureStandardStreams ? 0x100u : 0u,
                StandardInput = output.Input.DangerousGetHandle(), StandardOutput = output.OutWrite.DangerousGetHandle(), StandardError = output.ErrWrite.DangerousGetHandle() }, Attributes = attributes.Pointer };
            string environment = Program.EnvironmentBlock(token, work, managedFixture); IntPtr environmentPointer = Marshal.StringToHGlobalUni(environment);
            try
            {
                const uint flags = 0x00080000 | 0x00000400 | 0x00000004; // EXTENDED | UNICODE | SUSPENDED
                Native.ProcessInformation info; bool ok; string api; bool captured = captureStandardStreams;
                if (fixtureInherited) { api = managedFixture ? "CreateProcessW-fixture" : "CreateProcessW"; ok = Native.CreateProcess(executable, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, captureStandardStreams, flags | (managedFixture ? 0x08000000u : 0u), environmentPointer, directory, ref startup, out info); }
                else
                {
                    api = "CreateProcessAsUserW";
                    ok = Native.CreateProcessAsUser(token, executable, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, captureStandardStreams, flags, environmentPointer, directory, ref startup, out info);
                    int error = ok ? 0 : Marshal.GetLastWin32Error();
                    if (!ok && error == 1314)
                    {
                        using var originalAttributes = new NativeChildAttributes(_handle, null);
                        var originalStartup = new Native.StartupInfoEx { Startup = new Native.StartupInfo { Size = Marshal.SizeOf<Native.StartupInfoEx>() }, Attributes = originalAttributes.Pointer };
                        api = "CreateProcessWithTokenW"; captured = false;
                        ok = Native.CreateProcessWithToken(token, 0, executable, new StringBuilder(commandLine), flags, environmentPointer, directory, ref originalStartup, out info);
                    }
                }
                if (!ok) throw Native.Error(api + " with atomic JOB_LIST");
                output.Start(captured, captured ? null : captureStandardStreams ? "Original CreateProcessWithTokenW fallback retained; no documented bInheritHandles/HANDLE_LIST contract." : "Capture disabled: original JOB_LIST-only, zero standard handles and inherit=false retained.");
                var child = new LaunchedProcess(info, method, api, executable, output, Program.EnvironmentMetadata(environment), requireElevated); transferred = true;
                if (!Native.IsProcessInJob(child.Process, _handle, out bool contained) || !contained)
                { Native.TerminateProcess(child.Process, 1); child.Dispose(); throw new UnauthorizedAccessException("Actual suspended child was not atomically assigned to the owned job."); }
                TokenProof expected = Program.ReadToken(token);
                if (child.Proof.UserSid != expected.UserSid || child.Proof.SessionId != expected.SessionId)
                { Native.TerminateProcess(child.Process, 1); child.Dispose(); throw new UnauthorizedAccessException("Actual suspended child user/session changed."); }
                return child;
            }
            finally { Marshal.FreeHGlobal(environmentPointer); }
        }
        finally { if (!transferred) output.Dispose(); }
    }
    internal uint ActiveProcesses
    { get { if (!Native.QueryInformationJobObject(_handle, 1, out Native.JobAccounting accounting, (uint)Marshal.SizeOf<Native.JobAccounting>(), out _)) throw Native.Error("Read owned job accounting"); return accounting.ActiveProcesses; } }
    internal void Terminate() { if (!Native.TerminateJobObject(_handle, 1)) throw Native.Error("Terminate only owned job"); }
    internal bool WaitEmpty(int milliseconds) { var watch = Stopwatch.StartNew(); while (watch.ElapsedMilliseconds < milliseconds) { if (ActiveProcesses == 0) return true; Thread.Sleep(50); } return ActiveProcesses == 0; }
    public void Dispose() => _handle.Dispose();
}
internal static class Native
{
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", EntryPoint = "LoadLibraryExW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr LoadLibraryEx(string path, IntPtr file, uint flags);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", EntryPoint = "FindResourceW", SetLastError = true)] internal static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint SizeofResource(IntPtr module, IntPtr resource);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr LockResource(IntPtr resource);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool FreeLibrary(IntPtr module);
    internal static Win32Exception Error(string operation) => new(Marshal.GetLastWin32Error(), operation + " failed (Win32 " + Marshal.GetLastWin32Error() + ").");
    [StructLayout(LayoutKind.Sequential)] internal struct SecurityAttributes { internal int Length; internal IntPtr Descriptor; internal int Inherit; }
    internal static object DesktopMetadata(uint thread)
    {
        object Name(IntPtr value)
        {
            if (value == IntPtr.Zero) return new { name = (string?)null, nativeError = Marshal.GetLastWin32Error() };
            var text = new StringBuilder(1024);
            return GetUserObjectInformation(value, 2, text, (uint)(text.Capacity * 2), out _) ? (object)new { name = text.ToString(), nativeError = (int?)null } : new { name = (string?)null, nativeError = Marshal.GetLastWin32Error() };
        }
        return new { guardianWindowStation = Name(GetProcessWindowStation()), childThreadDesktop = Name(GetThreadDesktop(thread)), startupDesktop = "null (unchanged inherited default)" };
    }
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafeFileHandle CreateFile(string name, uint access, uint share, ref SecurityAttributes security, uint creation, uint flags, IntPtr template);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write, ref SecurityAttributes security, uint size);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetHandleInformation(SafeFileHandle handle, uint mask, uint flags);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool PeekNamedPipe(SafeFileHandle pipe, IntPtr data, uint size, IntPtr read, out uint available, IntPtr left);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool ReadFile(SafeFileHandle file, [Out] byte[] data, uint length, out uint read, IntPtr overlapped);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetProcessWindowStation();
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetThreadDesktop(uint thread);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool GetUserObjectInformation(IntPtr value, int kind, StringBuilder text, uint bytes, out uint needed);
    [StructLayout(LayoutKind.Sequential)] internal struct SidAndAttributes { internal IntPtr Sid; internal uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] internal struct Luid { internal uint Low; internal int High; }
    [StructLayout(LayoutKind.Sequential)] internal struct ProcessInformation { internal IntPtr Process, Thread; internal uint ProcessId, ThreadId; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct StartupInfo { internal int Size; internal string? Reserved, Desktop, Title; internal uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags; internal short ShowWindow, ReservedSize; internal IntPtr ReservedPointer, StandardInput, StandardOutput, StandardError; }
    [StructLayout(LayoutKind.Sequential)] internal struct StartupInfoEx { internal StartupInfo Startup; internal IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] internal struct JobBasicLimits { internal long PerProcessUserTime, PerJobUserTime; internal uint LimitFlags; internal UIntPtr MinimumWorkingSet, MaximumWorkingSet; internal uint ActiveProcessLimit; internal UIntPtr Affinity; internal uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] internal struct IoCounters { internal ulong ReadOperation, WriteOperation, OtherOperation, ReadTransfer, WriteTransfer, OtherTransfer; }
    [StructLayout(LayoutKind.Sequential)] internal struct JobExtendedLimits { internal JobBasicLimits Basic; internal IoCounters Io; internal UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
    [StructLayout(LayoutKind.Sequential)] internal struct JobAccounting { internal long TotalUserTime, TotalKernelTime, ThisPeriodUserTime, ThisPeriodKernelTime; internal uint PageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
    [StructLayout(LayoutKind.Sequential)] private struct BasicProcessInformation { internal IntPtr ExitStatus, Peb, Affinity, Priority, ProcessId, ParentProcessId; }
    internal static SafeKernelHandle OpenParent()
    {
        int status = NtQueryInformationProcess(GetCurrentProcess(), 0, out BasicProcessInformation info, Marshal.SizeOf<BasicProcessInformation>(), out _);
        if (status < 0 || info.ParentProcessId.ToInt64() is <= 0 or > uint.MaxValue) throw new IOException("Cannot identify the actual guardian parent.");
        var parent = new SafeKernelHandle(OpenProcess(0x00101000, false, (uint)info.ParentProcessId.ToInt64()));
        if (parent.IsInvalid) { parent.Dispose(); throw Error("Open actual guardian parent"); }
        using Process own = Process.GetCurrentProcess();
        if (!GetProcessTimes(parent, out long parentCreated, out _, out _, out _) || parentCreated > own.StartTime.ToUniversalTime().ToFileTimeUtc())
        { parent.Dispose(); throw new IOException("The guardian parent PID was reused."); }
        return parent;
    }
    internal delegate bool EnumWindow(IntPtr window, IntPtr data);
    [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool OpenProcessToken(IntPtr process, uint access, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool GetTokenInformation(SafeAccessTokenHandle token, int kind, IntPtr data, uint length, out uint needed);
    [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool DuplicateTokenEx(SafeAccessTokenHandle token, uint access, IntPtr attributes, int level, int type, out SafeAccessTokenHandle result);
    [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool SetTokenInformation(SafeAccessTokenHandle token, int kind, ref SidAndAttributes data, uint length);
    [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool CreateRestrictedToken(SafeAccessTokenHandle token, uint flags, uint count, [In] SidAndAttributes[] denied, uint deletedCount, IntPtr deleted, uint restrictedCount, IntPtr restricted, out SafeAccessTokenHandle result);
    [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool IsTokenRestricted(SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool SaferCreateLevel(uint scope, uint level, uint flags, out IntPtr result, IntPtr reserved);
    [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool SaferComputeTokenFromLevel(IntPtr level, SafeAccessTokenHandle token, out SafeAccessTokenHandle result, uint flags, IntPtr reserved);
    [DllImport("advapi32.dll")] internal static extern bool SaferCloseLevel(IntPtr level);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool LookupPrivilegeName(string? system, ref Luid luid, StringBuilder name, ref uint length);
    [DllImport("advapi32.dll", EntryPoint = "CreateProcessAsUserW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcessAsUser(SafeAccessTokenHandle token, string executable, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation info);
    [DllImport("advapi32.dll", EntryPoint = "CreateProcessWithTokenW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcessWithToken(SafeAccessTokenHandle token, uint logonFlags, string executable, StringBuilder command, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation info);
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcess(string executable, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation info);
    [DllImport("userenv.dll", SetLastError = true)] internal static extern bool CreateEnvironmentBlock(out IntPtr environment, SafeAccessTokenHandle token, bool inherit);
    [DllImport("userenv.dll")] internal static extern bool DestroyEnvironmentBlock(IntPtr environment);
    [DllImport("kernel32.dll")] internal static extern IntPtr GetCurrentProcess();
    [DllImport("ntdll.dll")] private static extern int NtQueryInformationProcess(IntPtr process, int kind, out BasicProcessInformation info, int length, out int returned);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(SafeKernelHandle handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateProcess(SafeKernelHandle process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(SafeKernelHandle thread);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetExitCodeProcess(SafeKernelHandle process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetProcessTimes(SafeKernelHandle process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool QueryFullProcessImageName(SafeKernelHandle process, uint flags, StringBuilder path, ref uint length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern uint GetSystemDirectory(StringBuilder path, uint length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CreateJobObject(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetInformationJobObject(SafeKernelHandle job, int kind, ref JobExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool QueryInformationJobObject(SafeKernelHandle job, int kind, out JobAccounting info, uint size, out uint returned);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateJobObject(SafeKernelHandle job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool IsProcessInJob(SafeKernelHandle process, SafeKernelHandle job, out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool InitializeProcThreadAttributeList(IntPtr attributes, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool UpdateProcThreadAttribute(IntPtr attributes, uint flags, IntPtr kind, IntPtr value, IntPtr size, IntPtr old, IntPtr returned);
    [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(IntPtr attributes);
    [DllImport("user32.dll")] internal static extern bool EnumWindows(EnumWindow callback, IntPtr data);
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr window);
}
