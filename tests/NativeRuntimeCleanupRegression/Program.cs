using System.Diagnostics;
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
            await ExitOwnChild(restarted);
            clock.Restart();
            Require(WindowsServiceListenerSnapshot.StopProcessesUsingExecutable(ownedPath, deadline.Token).Length == 0,
                "native recheck proves owned runtime quiescent without restarting a kill loop", clock.Elapsed.TotalMilliseconds);
            Require(WindowsServiceListenerSnapshot.StopProcessesUsingExecutable(Path.Combine(root, "absent", name), deadline.Token).Length == 0 && !foreign.HasExited,
                "missing destination enumerates matching real rows and preserves foreign path");
            Require(await EgoistShield.Service.Program.Main(["--telegram-runtime-cleanup", "--runtime", "C:\\Foreign\\arbitrary.exe"]) != 0,
                "actual CLI refuses arbitrary target before native cleanup");
            Require(await EgoistShield.Service.Program.Main(["--telegram-runtime-cleanup", "--runtime", "primary", "--console"]) != 0,
                "actual CLI refuses mixed service mode before native cleanup");
            Console.WriteLine(JsonSerializer.Serialize(new { kind = "actual-harmless-native-runtime-cleanup", actualNativeApis = true, checks = Checks,
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
