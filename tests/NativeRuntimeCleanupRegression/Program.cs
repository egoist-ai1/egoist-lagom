using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Text.Json;
using EgoistShield.Service;

namespace NativeRuntimeCleanupRegression;
internal static class Program
{
    private static readonly List<object> Checks = new();
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
        string root = callerWork != null ? Path.Combine(callerWork, "native-runtime-cleanup-" + Guid.NewGuid().ToString("N")) :
            Path.GetFullPath(Environment.GetEnvironmentVariable("LAGOM_NATIVE_RUNTIME_CLEANUP_TEST_ROOT") ?? throw new ArgumentException("Caller-owned fixture root required."));
        if (!root.StartsWith(temp.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || Directory.Exists(root))
            throw new ArgumentException("New fixture must be below caller-owned temp.");
        Directory.CreateDirectory(root);
        string foreignDir = Path.Combine(root, "foreign"); Directory.CreateDirectory(foreignDir);
        string self = Environment.ProcessPath!;
        string name = "egoist-cleanup-fixture-" + Guid.NewGuid().ToString("N") + ".exe";
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
        try
        {
            Require(owned.Start() && foreign.Start(), "two caller-owned harmless children start");
            int ownPid = int.Parse(await owned.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(8)) ?? "0");
            int foreignPid = int.Parse(await foreign.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(8)) ?? "0");
            Require(ownPid == owned.Id && foreignPid == foreign.Id && !owned.HasExited && !foreign.HasExited, "readiness identifies held own children");
            using var readDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            int transientAttempts = 0;
            var transientClock = Stopwatch.StartNew();
            var recovered = WindowsServiceListenerSnapshot.ReadRuntimeIdentity(foreign.SafeHandle, readDeadline.Token,
                attempt => { transientAttempts++; return attempt == 1 ? 5 : null; });
            Require(recovered.Path == foreignPath && recovered.Born == new DateTimeOffset(foreign.StartTime.ToUniversalTime()) &&
                transientAttempts >= 2 && !foreign.HasExited, "controlled image fault recovers only real path and birth on the same live held handle", transientClock.Elapsed.TotalMilliseconds);
            int persistentAttempts = 0;
            var persistentClock = Stopwatch.StartNew();
            try
            {
                WindowsServiceListenerSnapshot.ReadRuntimeIdentity(foreign.SafeHandle, readDeadline.Token,
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
            ExpectRefusal(() => WindowsServiceListenerSnapshot.ReadRuntimeIdentity(foreign.SafeHandle, readCancellation.Token,
                attempt => { readCancellation.Cancel(); return 5; }), "controlled image retry observes cancellation without clearing ownership");
            Require(!foreign.HasExited && !owned.HasExited, "all controlled query faults preserve real live own and foreign children");
            using (var unreadableIdentity = OpenProcess(0x100000U, false, foreign.Id))
            {
                Require(!unreadableIdentity.IsInvalid, "actual own-child SYNCHRONIZE-only handle opens without changing process permissions");
                int creationImageQueries = 0;
                try
                {
                    WindowsServiceListenerSnapshot.ReadRuntimeIdentity(unreadableIdentity, readDeadline.Token,
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
            WindowsServiceListenerSnapshot.VerifyRuntimeProcessIdentity(ownPid, ownedPath, birth);
            Require(true, "actual native handle path birth and liveness match owned child");
            ExpectRefusal(() => WindowsServiceListenerSnapshot.VerifyRuntimeProcessIdentity(ownPid, foreignPath, birth), "foreign expected path is refused");
            ExpectRefusal(() => WindowsServiceListenerSnapshot.VerifyRuntimeProcessIdentity(ownPid, ownedPath, birth.AddTicks(1)), "stale creation identity is refused");
            Require(!owned.HasExited && !foreign.HasExited, "identity refusals leave both real children alive");
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            ExpectRefusal(() => WindowsServiceListenerSnapshot.StopProcessesUsingExecutable(ownedPath, cancelled.Token), "cancelled cleanup refuses before termination");
            Require(!owned.HasExited && !foreign.HasExited, "cancelled cleanup leaves both children alive");
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var clock = Stopwatch.StartNew();
            var stopped = WindowsServiceListenerSnapshot.StopProcessesUsingExecutable(ownedPath, deadline.Token);
            double elapsed = clock.Elapsed.TotalMilliseconds;
            await owned.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3));
            Require(stopped.Length == 1 && stopped[0].ProcessId == ownPid && stopped[0].CreatedAt == birth && stopped[0].ExecutablePath == ownedPath,
                "actual native cleanup stops exact held owned identity", elapsed);
            Require(!foreign.HasExited, "same-name foreign path child survives actual termination");
            Require(restarted.Start(), "actual replacement child starts at the same owned executable path");
            int replacementPid = int.Parse(await restarted.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(8)) ?? "0");
            Require(replacementPid == restarted.Id && !restarted.HasExited, "replacement readiness identifies the held new child");
            ExpectRefusal(() => WindowsServiceListenerSnapshot.VerifyRuntimeQuiescent(ownedPath, deadline.Token), "actual replacement process makes publication quiescence fail closed");
            Require(!restarted.HasExited && !foreign.HasExited, "quiescence refusal preserves replacement and foreign child without kill loop");
            using var exitReadDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            IOException? exitReadError = null;
            try
            {
                WindowsServiceListenerSnapshot.ReadRuntimeIdentity(restarted.SafeHandle, exitReadDeadline.Token, attempt =>
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
            using var quiescenceDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            clock.Restart();
            Require(WindowsServiceListenerSnapshot.StopProcessesUsingExecutable(ownedPath, quiescenceDeadline.Token).Length == 0,
                "native recheck proves owned runtime quiescent without restarting a kill loop", clock.Elapsed.TotalMilliseconds);
            Require(WindowsServiceListenerSnapshot.StopProcessesUsingExecutable(Path.Combine(root, "absent", name), quiescenceDeadline.Token).Length == 0 && !foreign.HasExited,
                "missing destination enumerates matching real rows and preserves foreign path");
            // Repeat actual exit/capture overlap while retaining the caller's
            // Process handle. A dead process may remain in a Toolhelp snapshot.
            for (int iteration = 0; iteration < 12; iteration++)
            {
                using var retiring = Child(ownedPath, root);
                try
                {
                    Require(retiring.Start(), "exit-race harmless child starts " + iteration);
                    int retiringPid = int.Parse(await retiring.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(8)) ?? "0");
                    Require(retiringPid == retiring.Id && !retiring.HasExited, "exit-race readiness belongs to held child " + iteration);
                    await ExitOwnChild(retiring);
                    using var cycleDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                    WindowsServiceListenerSnapshot.VerifyRuntimeQuiescent(ownedPath, cycleDeadline.Token);
                    Require(WindowsServiceListenerSnapshot.StopProcessesUsingExecutable(ownedPath, cycleDeadline.Token).Length == 0 && !foreign.HasExited,
                        "actual exited-child capture preserves quiescence and live foreign process " + iteration);
                }
                finally { await ExitOwnChild(retiring); }
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
            await ExitOwnChild(owned);
            await ExitOwnChild(foreign);
            await ExitOwnChild(restarted);
        }
    }
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, int processId);

    private static Process Child(string executable, string root)
    {
        var child = new Process { StartInfo = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true,
            WorkingDirectory = root, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        child.StartInfo.ArgumentList.Add("--fixture-child"); return child;
    }
    private static async Task ExitOwnChild(Process child)
    {
        try { if (!child.HasExited) { await child.StandardInput.WriteLineAsync("exit"); await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); } }
        catch (TimeoutException) { child.Kill(); await child.WaitForExitAsync(); }
        catch (InvalidOperationException) { }
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
