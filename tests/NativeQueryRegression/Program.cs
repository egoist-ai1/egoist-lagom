using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using EgoistShield.Service;

namespace NativeQueryRegression;

internal static class Program
{
    private static readonly List<object> Checks = new();

    internal static async Task<int> Main(string[] args)
    {
        if (args is ["--fixture-child"])
        {
            using var v4 = new TcpListener(IPAddress.Loopback, 0);
            v4.Start();
            using var v6 = new TcpListener(IPAddress.IPv6Loopback, 0);
            v6.Server.DualMode = false;
            v6.Start();
            Console.WriteLine(JsonSerializer.Serialize(new { processId = Environment.ProcessId,
                ipv4Port = ((IPEndPoint)v4.LocalEndpoint).Port, ipv6Port = ((IPEndPoint)v6.LocalEndpoint).Port }));
            await Console.In.ReadLineAsync();
            return 0;
        }
        if (args.Length > 0) return await EgoistShield.Service.Program.Main(args);
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        string root = Environment.GetEnvironmentVariable("LAGOM_NATIVE_QUERY_TEST_ROOT") ?? throw new ArgumentException("Isolated test root required.");
        root = Path.GetFullPath(root);
        Directory.CreateDirectory(root);
        string self = Environment.ProcessPath!;
        string ownedExecutable = Path.Combine(Path.GetDirectoryName(self)!, "winws.exe");
        if (File.Exists(ownedExecutable)) throw new IOException("Existing fixture executable will not be replaced.");
        File.Copy(self, ownedExecutable);
        using var child = new Process { StartInfo = new ProcessStartInfo(ownedExecutable)
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        } };
        child.StartInfo.ArgumentList.Add("--fixture-child");
        try
        {
            Require(child.Start(), "harmless child starts");
            string line = await child.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(8)) ?? throw new IOException("Missing fixture readiness.");
            using var ready = JsonDocument.Parse(line);
            int pid = ready.RootElement.GetProperty("processId").GetInt32();
            int port4 = ready.RootElement.GetProperty("ipv4Port").GetInt32();
            int port6 = ready.RootElement.GetProperty("ipv6Port").GetInt32();
            Require(pid == child.Id && !child.HasExited, "readiness belongs to held child");
            DateTimeOffset saved = new(child.StartTime.ToUniversalTime());
            var watch = Stopwatch.StartNew();
            var rows = WindowsServiceListenerSnapshot.ReadWinwsProcesses(default);
            double processMs = watch.Elapsed.TotalMilliseconds;
            var own = rows.Single(row => row.ProcessId == pid);
            Require(own.CreatedAt != null && own.ExecutablePath == ownedExecutable && own.ParentProcessId == Environment.ProcessId,
                "native Toolhelp/path/creation identifies actual owned child", processMs);
            watch.Restart();
            var v4 = WindowsServiceListenerSnapshot.ReadListeners(port4, default);
            double tcp4Ms = watch.Elapsed.TotalMilliseconds;
            Require(v4.Any(row => row.OwningProcess == pid && row.LocalAddress == "127.0.0.1"), "native IPv4 table identifies actual listener PID", tcp4Ms);
            watch.Restart();
            var v6 = WindowsServiceListenerSnapshot.ReadListeners(port6, default);
            double tcp6Ms = watch.Elapsed.TotalMilliseconds;
            Require(v6.Any(row => row.OwningProcess == pid && row.LocalAddress == "::1"), "native IPv6 table identifies actual listener PID", tcp6Ms);
            var reader = new WindowsServiceListenerSnapshot("EgoistShieldTelegramProxy", managedProcessId: pid);
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            watch.Restart();
            var actual = await reader.ReadAsync(port4, deadline.Token);
            Console.Error.WriteLine(JsonSerializer.Serialize(new { phase = "held-fixture-capture", available = actual != null,
                stable = actual?.Stable, ownedChildRow = actual?.Processes.Any(row => row.ProcessId == pid),
                ownedBirthMatches = actual?.Processes.Any(row => row.ProcessId == pid && row.CreatedAt == own.CreatedAt),
                scmState = actual?.ServiceState, scmRootReadable = actual?.Processes.Any(row => row.ProcessId == actual.ServiceProcessId && row.CreatedAt != null && row.ExecutablePath != null) }));
            Require(actual != null && actual.Processes.Any(row => row.ProcessId == pid && row.CreatedAt == own.CreatedAt),
                "native capture retains actual held child independently of unreadable SCM root", watch.Elapsed.TotalMilliseconds);
            using var observed = JsonDocument.Parse(TelegramListenerSnapshotCommand.SerializeSnapshot(actual, port4, "C:\\fixture-unowned-wrapper.exe", pid, saved, new[] { ownedExecutable }));
            if (!actual!.Stable) Require(observed.RootElement.GetProperty("ipv4").GetProperty("state").GetString() == "unknown",
                "actual unreadable SYSTEM SCM root remains unknown without escalation");
            // Only the SCM state below is an inert classifier fixture. TCP rows,
            // process path and creation time remain the actual OS capture.
            var managedFixture = actual! with { ServiceProcessId = 0, ServiceState = "Stopped", Stable = true };
            using var managed = JsonDocument.Parse(TelegramListenerSnapshotCommand.SerializeSnapshot(managedFixture, port4, "C:\\fixture-unowned-wrapper.exe", pid, saved, new[] { ownedExecutable }));
            Require(managed.RootElement.GetProperty("managedIdentityVerified").GetBoolean() &&
                managed.RootElement.GetProperty("ipv4").GetProperty("state").GetString() == "owned",
                "inert stopped-SCM classifier accepts actual child only with explicit fixture path");
            using var wrong = JsonDocument.Parse(TelegramListenerSnapshotCommand.SerializeSnapshot(managedFixture, port4, "C:\\fixture-unowned-wrapper.exe", pid, saved, new[] { "C:\\different.exe" }));
            Require(wrong.RootElement.GetProperty("ipv4").GetProperty("state").GetString() == "unknown", "wrong managed path remains unknown");
            using var recycled = JsonDocument.Parse(TelegramListenerSnapshotCommand.SerializeSnapshot(managedFixture, port4, "C:\\fixture-unowned-wrapper.exe", pid, saved.AddMinutes(1), new[] { ownedExecutable }));
            Require(recycled.RootElement.GetProperty("ipv4").GetProperty("state").GetString() == "unknown", "changed managed creation time remains unknown");
            var stopped = managedFixture;
            using var foreign = JsonDocument.Parse(TelegramListenerSnapshotCommand.SerializeSnapshot(stopped, port4, "C:\\fixture-unowned-wrapper.exe"));
            Require(foreign.RootElement.GetProperty("ipv4").GetProperty("state").GetString() == "foreign", "real listener is foreign without any approved root");
            var partial = managedFixture with { Processes = actual.Processes.Where(row => row.ProcessId != pid).ToArray() };
            using var unknown = JsonDocument.Parse(TelegramListenerSnapshotCommand.SerializeSnapshot(partial, port4, "C:\\fixture-unowned-wrapper.exe", pid, saved, new[] { ownedExecutable }));
            Require(unknown.RootElement.GetProperty("ipv4").GetProperty("state").GetString() == "unknown", "partial managed identity cannot become owned");
            using var unavailable = JsonDocument.Parse(TelegramListenerSnapshotCommand.SerializeSnapshot(null, port4, "C:\\fixture-unowned-wrapper.exe"));
            Require(unavailable.RootElement.GetProperty("ipv4").GetProperty("state").GetString() == "unknown", "unavailable snapshot remains unknown");
            var command = await Capture(new[] { "--winws-process-snapshot" });
            using var commandJson = JsonDocument.Parse(command.Stdout);
            Require(command.Code == 0 && commandJson.RootElement.GetProperty("snapshotAvailable").GetBoolean() &&
                commandJson.RootElement.GetProperty("processes").EnumerateArray().Any(row => row.GetProperty("processId").GetInt32() == pid),
                "actual fixed WinWS CLI reads harmless native child", command.ElapsedMs);
            bool allIdentities = commandJson.RootElement.GetProperty("processes").EnumerateArray().All(row =>
                row.GetProperty("createdAt").ValueKind == JsonValueKind.String && row.GetProperty("executablePath").ValueKind == JsonValueKind.String);
            Require(commandJson.RootElement.GetProperty("identityComplete").GetBoolean() == allIdentities,
                "actual CLI marks unreadable identities explicitly rather than dropping rows");
            var cli = await Capture(new[] { "--telegram-listener-snapshot", "--port", port4.ToString(), "--managed-pid", pid.ToString(), "--managed-started-at", saved.ToUnixTimeMilliseconds().ToString() });
            using var cliJson = JsonDocument.Parse(cli.Stdout);
            Require(cli.Code == 0 && cliJson.RootElement.GetProperty("ipv4").GetProperty("state").GetString() == "unknown",
                "actual Telegram CLI refuses unapproved physical fixture path", cli.ElapsedMs);
            Require((await Capture(new[] { "--winws-process-snapshot", "--port", port4.ToString() })).Code != 0, "fixed WinWS CLI forbids arbitrary query arguments");
            Require((await Capture(new[] { "--telegram-listener-snapshot", "--port", port4.ToString(), "--console" })).Code != 0, "read-only listener CLI forbids service mode composition");
            using var cancelled = new CancellationTokenSource();
            cancelled.Cancel();
            try { WindowsServiceListenerSnapshot.ReadWinwsProcesses(cancelled.Token); throw new InvalidOperationException("Cancelled capture continued."); }
            catch (OperationCanceledException) { Checks.Add(new { name = "cancelled fixed process capture stops", passed = true }); }
            await child.StandardInput.WriteLineAsync("stop");
            await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            Require(child.ExitCode == 0, "owned child exits and closes listeners");
            Require(!WindowsServiceListenerSnapshot.ReadListeners(port4, default).Any(row => row.OwningProcess == pid), "closed actual listener is removed from native table");
            Console.WriteLine(JsonSerializer.Serialize(new { kind = "actual-harmless-native-query-regression", checks = Checks,
                actualNativeApis = true, administrator = new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent())
                    .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator), scmWrites = false, dnsWrites = false, registryWrites = false,
                serviceInstallationVerified = false, remoteConnectivityVerified = false }));
            return 0;
        }
        finally
        {
            if (child.Id > 0 && !child.HasExited) { child.Kill(entireProcessTree: true); await child.WaitForExitAsync(); }
            File.Delete(ownedExecutable);
        }
    }

    private static void Require(bool condition, string name, double? elapsedMs = null)
    {
        if (!condition) throw new InvalidOperationException(name);
        Checks.Add(new { name, passed = true, elapsedMs });
    }

    private static async Task<(int Code, string Stdout, double ElapsedMs)> Capture(string[] args)
    {
        using var query = new Process { StartInfo = new ProcessStartInfo(Environment.ProcessPath!)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true
        } };
        foreach (string arg in args) query.StartInfo.ArgumentList.Add(arg);
        var watch = Stopwatch.StartNew();
        if (!query.Start()) throw new IOException("Own read-only query child did not start.");
        Task<string> output = query.StandardOutput.ReadToEndAsync();
        Task<string> errors = query.StandardError.ReadToEndAsync();
        try
        {
            await query.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            string stdout = await output;
            _ = await errors;
            return (query.ExitCode, stdout, watch.Elapsed.TotalMilliseconds);
        }
        finally { if (!query.HasExited) { query.Kill(entireProcessTree: true); await query.WaitForExitAsync(); } }
    }
}
