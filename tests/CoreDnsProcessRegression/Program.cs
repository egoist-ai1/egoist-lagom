using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Text.Json;
using EgoistShield.Service;

namespace CoreDnsProcessRegression;
internal static class Program
{
    private static readonly List<object> Checks = new();
    private static readonly Dictionary<Process, SafeProcessHandle> CreatedHandles = new();
    internal static async Task<int> Main(string[] args)
    {
        if (args is ["--fixture-child"]) { Console.WriteLine(Environment.ProcessId); await Console.In.ReadLineAsync(); return 0; }
        string? callerWork = null;
        if (args is ["--work", var selectedWork])
        {
            if (!Path.IsPathFullyQualified(selectedWork) || !Directory.Exists(selectedWork)) throw new ArgumentException("Existing absolute caller-owned work required.");
            callerWork = Path.GetFullPath(selectedWork);
        }
        else if (args.Length > 0) return await EgoistShield.Service.Program.Main(args);
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        string temp = callerWork ?? Path.GetFullPath(Environment.GetEnvironmentVariable("TEMP") ?? throw new ArgumentException("Caller-owned temp required."));
        string root = callerWork != null ? Path.Combine(callerWork, "core-dns-process-" + Guid.NewGuid().ToString("N")) :
            Path.GetFullPath(Environment.GetEnvironmentVariable("LAGOM_CORE_DNS_PROCESS_TEST_ROOT") ?? throw new ArgumentException("Caller-owned fixture root required."));
        if (!root.StartsWith(temp.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || Directory.Exists(root))
            throw new ArgumentException("New fixture must be below caller-owned temp.");
        Directory.CreateDirectory(root);
        string foreignDir = Path.Combine(root, "foreign"); Directory.CreateDirectory(foreignDir);
        string self = Environment.ProcessPath!;
        string name = "ec-" + Guid.NewGuid().ToString("N") + ".exe";
        string ownedDir = Path.Combine(root, "owned"); Directory.CreateDirectory(ownedDir);
        string ownedPath = Path.Combine(ownedDir, name);
        string foreignPath = Path.Combine(foreignDir, name);
        foreach (string file in Directory.GetFiles(Path.GetDirectoryName(self)!))
        {
            File.Copy(file, Path.Combine(ownedDir, Path.GetFileName(file)));
            File.Copy(file, Path.Combine(foreignDir, Path.GetFileName(file)));
        }
        File.Copy(self, ownedPath);
        File.Copy(self, foreignPath);
        using var owned = Child(ownedPath, root);
        using var foreign = Child(foreignPath, root);
        using var restarted = Child(ownedPath, root);
        SafeProcessHandle? ownedHeld = null, foreignHeld = null, restartedHeld = null;
        try
        {
            var policy = new WindowsServiceRecoverySnapshot.Observation("EgoistShieldSystemDoH", true, 16, 2, "fixed.exe", "LocalSystem", false, 3600,
                new[] { new WindowsServiceRecoverySnapshot.Action(1, 5000), new WindowsServiceRecoverySnapshot.Action(1, 10000) }, true);
            var suppressed = WindowsServiceRecoverySnapshot.SystemDohSuppressedPolicy(policy);
            Require(suppressed.Actions is [{ Type: 0, DelayMs: 0 }] && suppressed.ResetPeriodSeconds == 3600 &&
                !suppressed.FailureActionsOnNonCrashFailures && suppressed.StartType == policy.StartType && suppressed.BinaryCommand == policy.BinaryCommand,
                "SC_ACTION_NONE suppression preserves recovery reset period and service identity without zero-count deletion");
            Require(StartOwnChild(owned) && StartOwnChild(foreign), "two caller-owned harmless children start");
            ownedHeld = HoldOwnChild(owned); foreignHeld = HoldOwnChild(foreign);
            int ownPid = int.Parse(await owned.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(8)) ?? "0");
            int foreignPid = int.Parse(await foreign.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(8)) ?? "0");
            Require(ownPid == owned.Id && foreignPid == foreign.Id && !owned.HasExited && !foreign.HasExited, "readiness identifies held own children");
            using var readDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            int transientAttempts = 0;
            var transientClock = Stopwatch.StartNew();
            var recovered = OwnedSystemDohProcess.ReadRuntimeIdentity(foreignHeld!, readDeadline.Token,
                attempt => { transientAttempts++; return attempt == 1 ? 5 : null; });
            Require(recovered.Path == foreignPath && recovered.Born == new DateTimeOffset(foreign.StartTime.ToUniversalTime()) &&
                transientAttempts >= 2 && !foreign.HasExited, "controlled image fault recovers only real path and birth on the same live held handle", transientClock.Elapsed.TotalMilliseconds);
            int persistentAttempts = 0;
            var persistentClock = Stopwatch.StartNew();
            try
            {
                OwnedSystemDohProcess.ReadRuntimeIdentity(foreignHeld!, readDeadline.Token,
                    attempt => { persistentAttempts++; return 5; });
                throw new Exception("Persistent live unknown image must refuse.");
            }
            catch (IOException error)
            {
                Require(error.Message.Contains("stage=image") && error.Message.Contains("win32=5") && error.Message.Contains("wait=258") &&
                    persistentAttempts >= 2 && persistentAttempts <= 11 && !foreign.HasExited,
                    "controlled persistent image fault stays bounded and refuses actual live unknown process", persistentClock.Elapsed.TotalMilliseconds);
            }
            using var readCancellation = new CancellationTokenSource();
            ExpectRefusal(() => OwnedSystemDohProcess.ReadRuntimeIdentity(foreignHeld!, readCancellation.Token,
                attempt => { readCancellation.Cancel(); return 5; }), "controlled image retry observes cancellation without clearing ownership");
            Require(!foreign.HasExited && !owned.HasExited, "all controlled query faults preserve real live own and foreign children");
            using (var unreadableIdentity = OpenProcess(0x100000U, false, foreign.Id))
            {
                Require(!unreadableIdentity.IsInvalid, "actual own-child SYNCHRONIZE-only handle opens without changing process permissions");
                int creationImageQueries = 0;
                try
                {
                    OwnedSystemDohProcess.ReadRuntimeIdentity(unreadableIdentity, readDeadline.Token,
                        attempt => { creationImageQueries++; return null; });
                    throw new Exception("Actual unavailable creation identity must refuse.");
                }
                catch (IOException error)
                {
                    Require(error.Message.Contains("stage=creation") && error.Message.Contains("win32=5") && error.Message.Contains("wait=258") &&
                        creationImageQueries == 0 && !foreign.HasExited,
                        "actual GetProcessTimes access denial refuses before image retry and keeps live process untouched");
                }
            }
            var birth = new DateTimeOffset(owned.StartTime.ToUniversalTime());
            OwnedSystemDohProcess.VerifyRuntimeProcessIdentity(ownPid, ownedPath, birth);
            Require(true, "actual native handle path birth and liveness match owned child");
            ExpectRefusal(() => OwnedSystemDohProcess.VerifyRuntimeProcessIdentity(ownPid, foreignPath, birth), "foreign expected path is refused");
            ExpectRefusal(() => OwnedSystemDohProcess.VerifyRuntimeProcessIdentity(ownPid, ownedPath, birth.AddTicks(1)), "stale creation identity is refused");
            Require(!owned.HasExited && !foreign.HasExited, "identity refusals leave both real children alive");
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            ExpectRefusal(() => OwnedSystemDohProcess.StopProcessesUsingExecutable(ownedPath, cancelled.Token), "cancelled cleanup refuses before termination");
            Require(!owned.HasExited && !foreign.HasExited, "cancelled cleanup leaves both children alive");
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var clock = Stopwatch.StartNew();
            var stopped = OwnedSystemDohProcess.StopProcessesUsingExecutable(ownedPath, deadline.Token);
            double elapsed = clock.Elapsed.TotalMilliseconds;
            await owned.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3));
            Require(stopped.Length == 1 && stopped[0].ProcessId == ownPid && stopped[0].CreatedAt == birth && stopped[0].ExecutablePath == ownedPath,
                "actual native cleanup stops exact held owned identity", elapsed);
            Require(!foreign.HasExited, "same-name foreign path child survives actual termination");
            Require(StartOwnChild(restarted), "actual replacement child starts at the same owned executable path");
            restartedHeld = HoldOwnChild(restarted);
            int replacementPid = int.Parse(await restarted.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(8)) ?? "0");
            Require(replacementPid == restarted.Id && !restarted.HasExited, "replacement readiness identifies the held new child");
            ExpectRefusal(() => OwnedSystemDohProcess.VerifyRuntimeQuiescent(ownedPath, deadline.Token), "actual replacement process makes publication quiescence fail closed");
            Require(!restarted.HasExited && !foreign.HasExited, "quiescence refusal preserves replacement and foreign child without kill loop");
            using var exitReadDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            IOException? exitReadError = null;
            try
            {
                OwnedSystemDohProcess.ReadRuntimeIdentity(restartedHeld!, exitReadDeadline.Token, attempt =>
                {
                    if (attempt == 1) restarted.StandardInput.WriteLine("exit");
                    return 5;
                });
                throw new Exception("Exited image cannot be returned as a verified live identity.");
            }
            catch (IOException error) { exitReadError = error; }
            Require(exitReadError.Message.Contains("stage=image") && exitReadError.Message.Contains("win32=5") &&
                (exitReadError.Message.Contains("wait=0") || exitReadError.Message.Contains("wait=258")),
                "controlled own-exit fault returns only actual exit proof or bounded live-unknown refusal");
            // Fixture lifecycle can take longer under a loaded scheduler. No
            // production success is inferred from exceeding the image budget.
            await restarted.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8));
            await ExitOwnChild(restarted, restartedHeld);
            using var quiescenceDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            clock.Restart();
            Require(OwnedSystemDohProcess.StopProcessesUsingExecutable(ownedPath, quiescenceDeadline.Token).Length == 0,
                "native recheck proves owned runtime quiescent without restarting a kill loop", clock.Elapsed.TotalMilliseconds);
            Require(OwnedSystemDohProcess.StopProcessesUsingExecutable(Path.Combine(root, "absent", name), quiescenceDeadline.Token).Length == 0 && !foreign.HasExited,
                "missing destination enumerates matching real rows and preserves foreign path");
            using (var captured = Child(ownedPath, root))
            {
                SafeProcessHandle? capturedHeld = null;
                try
                {
                    Require(StartOwnChild(captured), "controlled quiescence-gap own harmless child starts");
                    capturedHeld = HoldOwnChild(captured);
                    int capturedPid = int.Parse(await captured.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(8)) ?? "0");
                    Require(capturedPid == captured.Id && WaitForSingleObject(capturedHeld!, 0) == 258,
                        "controlled quiescence-gap readiness identifies actual live held child");
                    var capturedBirth = new DateTimeOffset(captured.StartTime.ToUniversalTime());
                    OwnedSystemDohProcess.VerifyRuntimeProcessIdentity(capturedPid, ownedPath, capturedBirth);
                    using var gapDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                    bool callbackObserved = false;
                    OwnedSystemDohProcess.VerifyRuntimeQuiescent(ownedPath, gapDeadline.Token, () =>
                    {
                        callbackObserved = true;
                        Require(WaitForSingleObject(capturedHeld!, 0) == 258,
                            "controlled lifecycle gap begins with real live held child");
                        ExitOwnChild(captured, capturedHeld).GetAwaiter().GetResult();
                        uint signal = WaitForSingleObject(capturedHeld!, 0);
                        Require(signal == 0, "controlled lifecycle gap exits exact own child and observes its native signal");
                        Console.Error.WriteLine(JsonSerializer.Serialize(new { kind = "controlled-native-quiescence-gap",
                            processId = capturedPid, createdAt = capturedBirth, executablePath = ownedPath, waitResult = signal,
                            fabricatedIdentityData = false, liveForeignPreserved = !foreign.HasExited }));
                    });
                    Require(callbackObserved && WaitForSingleObject(capturedHeld!, 0) == 0 && !foreign.HasExited,
                        "completed held identity is omitted at final quiescence without killing live foreign child");
                }
                finally { try { await ExitOwnChild(captured, capturedHeld); } finally { capturedHeld?.Dispose(); } }
            }
            using var gapCancellation = new CancellationTokenSource();
            bool cancellationCallbackObserved = false;
            try
            {
                OwnedSystemDohProcess.VerifyRuntimeQuiescent(ownedPath, gapCancellation.Token,
                    () => { cancellationCallbackObserved = true; gapCancellation.Cancel(); });
                throw new Exception("Post-capture cancellation must refuse.");
            }
            catch (OperationCanceledException error) when (error.CancellationToken == gapCancellation.Token)
            {
                Require(cancellationCallbackObserved && gapCancellation.IsCancellationRequested,
                    "post-capture cancellation refuses even when no live owned row remains");
            }
            Require(!foreign.HasExited, "post-capture cancellation preserves actual live foreign child");
            // Repeat actual exit/capture overlap while retaining the caller's
            // Process handle. A dead process may remain in a Toolhelp snapshot.
            for (int iteration = 0; iteration < 12; iteration++)
            {
                using var retiring = Child(ownedPath, root);
                SafeProcessHandle? retiringHeld = null;
                try
                {
                    Require(StartOwnChild(retiring), "exit-race harmless child starts " + iteration);
                    retiringHeld = HoldOwnChild(retiring);
                    int retiringPid = int.Parse(await retiring.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(8)) ?? "0");
                    Require(retiringPid == retiring.Id && !retiring.HasExited, "exit-race readiness belongs to held child " + iteration);
                    await ExitOwnChild(retiring, retiringHeld);
                    using var cycleDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                    OwnedSystemDohProcess.VerifyRuntimeQuiescent(ownedPath, cycleDeadline.Token);
                    Require(OwnedSystemDohProcess.StopProcessesUsingExecutable(ownedPath, cycleDeadline.Token).Length == 0 && !foreign.HasExited,
                        "actual exited-child capture preserves quiescence and live foreign process " + iteration);
                }
                finally { try { await ExitOwnChild(retiring, retiringHeld); } finally { retiringHeld?.Dispose(); } }
            }
            Require(await EgoistShield.Service.Program.Main(["--telegram-runtime-cleanup", "--runtime", "C:\\Foreign\\arbitrary.exe"]) != 0,
                "actual CLI refuses arbitrary target before native cleanup");
            Require(await EgoistShield.Service.Program.Main(["--telegram-runtime-cleanup", "--runtime", "primary", "--console"]) != 0,
                "actual CLI refuses mixed service mode before native cleanup");
            Console.WriteLine(JsonSerializer.Serialize(new { kind = "actual-harmless-native-runtime-cleanup", actualNativeApis = true, checks = Checks,
                controlledApiErrorSeamUsed = true, fabricatedIdentityData = false,
                scmWrites = false, dnsWrites = false, registryWrites = false, serviceInstallationVerified = false }));
            return 0;
        }
        finally
        {
            try { await ExitOwnChild(owned, ownedHeld); }
            finally
            {
                try { await ExitOwnChild(foreign, foreignHeld); }
                finally
                {
                    try { await ExitOwnChild(restarted, restartedHeld); }
                    finally { ownedHeld?.Dispose(); foreignHeld?.Dispose(); restartedHeld?.Dispose(); }
                }
            }
        }
    }
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, int processId);

    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(SafeProcessHandle handle, uint milliseconds);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(IntPtr sourceProcess, SafeProcessHandle source, IntPtr targetProcess,
        out SafeProcessHandle target, uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint options);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(SafeProcessHandle handle, uint exitCode);

    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(SafeProcessHandle handle, out long created, out long exited, out long kernel, out long user);

    private static Process Child(string executable, string root)
    {
        var child = new Process { StartInfo = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true,
            WorkingDirectory = root, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        child.StartInfo.ArgumentList.Add("--fixture-child"); return child;
    }
    private static bool StartOwnChild(Process child)
    {
        string executable = child.StartInfo.FileName;
        if (!Path.IsPathFullyQualified(executable) || executable.Length > 240 || !File.Exists(executable))
            throw new IOException("Own fixture executable must exist at a bounded ordinary absolute path.");
        if (!child.Start()) return false;
        SafeProcessHandle original = child.SafeHandle;
        if (!DuplicateHandle((IntPtr)(-1), original, (IntPtr)(-1), out var created, 0, false, 2))
        {
            int error = Marshal.GetLastWin32Error(); created.Dispose();
            TerminateProcess(original, 1); WaitForSingleObject(original, 3000);
            throw new System.ComponentModel.Win32Exception(error, "Hold the exact created fixture process.");
        }
        CreatedHandles.Add(child, created); return true;
    }
    private static SafeProcessHandle HoldOwnChild(Process child)
    {
        var handle = OpenProcess(0x100000U | 0x1000U, false, child.Id);
        try
        {
            if (handle.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            OwnedSystemDohProcess.VerifyRuntimeIdentity(handle, child.StartInfo.FileName, new DateTimeOffset(child.StartTime.ToUniversalTime()));
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }
    private static async Task ExitOwnChild(Process child, SafeProcessHandle? held)
    {
        CreatedHandles.TryGetValue(child, out SafeProcessHandle? created);
        SafeProcessHandle? selected = held ?? created;
        if (selected is null) return; // Start never created a fixture process.
        var clock = Stopwatch.StartNew();
        try
        {
            uint initial = WaitForSingleObject(selected, 0);
            int initialError = initial == uint.MaxValue ? Marshal.GetLastWin32Error() : 0;
            if (initial == 0) return;
            if (initial != 258) throw new System.ComponentModel.Win32Exception(initialError, "Own held fixture exit wait failed.");
            if (!GetProcessTimes(selected, out long bornFileTime, out _, out _, out _))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Read exact held own-child birth before exit.");
            var birth = DateTimeOffset.FromFileTime(bornFileTime).ToUniversalTime();
            string executablePath = child.StartInfo.FileName;
            if (!child.HasExited) await child.StandardInput.WriteLineAsync("exit");
            await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3));
            uint independentWait = WaitForSingleObject(selected, 0);
            int independentError = independentWait == uint.MaxValue ? Marshal.GetLastWin32Error() : 0;
            uint? wrapperWait = null; int? wrapperError = null; string? wrapperUnavailable = null;
            try { wrapperWait = WaitForSingleObject(child.SafeHandle, 0); if (wrapperWait == uint.MaxValue) wrapperError = Marshal.GetLastWin32Error(); }
            catch (InvalidOperationException error) { wrapperUnavailable = error.Message; }
            Console.Error.WriteLine(JsonSerializer.Serialize(new { kind = "managed-exit-vs-held-native-signal", processId = child.Id,
                createdAt = birth, executablePath, independentWait, independentError, wrapperWait, wrapperError, wrapperUnavailable,
                elapsedMilliseconds = clock.Elapsed.TotalMilliseconds, observedAtUtc = DateTimeOffset.UtcNow }));
            if (independentWait == 0) return;
            if (independentWait != 258) throw new System.ComponentModel.Win32Exception(independentError, "Own independent exit wait failed.");
            while (true)
            {
                int remaining = 3000 - (int)clock.ElapsedMilliseconds;
                if (remaining <= 0) throw new TimeoutException("Own child native signal deadline exceeded.");
                uint wait = WaitForSingleObject(selected, (uint)Math.Min(100, remaining));
                int error = wait == uint.MaxValue ? Marshal.GetLastWin32Error() : 0;
                if (wait == 0)
                {
                    Console.Error.WriteLine(JsonSerializer.Serialize(new { kind = "held-native-signal-after-managed-exit", processId = child.Id,
                        createdAt = birth, executablePath, waitResult = wait, nativeError = 0, elapsedMilliseconds = clock.Elapsed.TotalMilliseconds,
                        observedAtUtc = DateTimeOffset.UtcNow }));
                    return;
                }
                if (wait != 258) throw new System.ComponentModel.Win32Exception(error, "Own held fixture signal failed.");
            }
        }
        catch (TimeoutException)
        {
            if (created is null) throw new IOException("Own fixture creation handle is unavailable for timeout cleanup.");
            bool terminated = TerminateProcess(created, 1);
            int terminateError = terminated ? 0 : Marshal.GetLastWin32Error();
            if (!terminated && WaitForSingleObject(created, 0) != 0)
                throw new System.ComponentModel.Win32Exception(terminateError, "Terminate only the exact created fixture handle.");
            uint wait = WaitForSingleObject(created, 3000);
            if (wait != 0) throw new IOException("Own timeout cleanup did not produce a native process signal: " + wait);
        }
        finally { if (CreatedHandles.Remove(child, out var original)) original.Dispose(); }
    }
    private static void ExpectRefusal(Action action, string name)
    {
        try { action(); } catch (Exception error) when (error is IOException or InvalidDataException or OperationCanceledException or System.ComponentModel.Win32Exception or ArgumentException)
        { Require(true, name); return; }
        throw new Exception("Expected refusal: " + name);
    }
    private static void Require(bool success, string name, double? milliseconds = null)
    { if (!success) throw new Exception(name); Checks.Add(new { name, passed = true, milliseconds }); }
}


