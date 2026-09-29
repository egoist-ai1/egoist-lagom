using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Runtime.InteropServices;
using EgoistShield.Service;

namespace LiveOwnedServiceProbe;

internal static class Program
{
    private const string ServiceName = "EgoistShieldTelegramProxy";
    private static async Task<int> Main(string[] args)
    {
        var parsed = new Dictionary<string, string>(StringComparer.Ordinal);
        for (int index = 0; index < args.Length; index += 2)
        {
            if (index + 1 >= args.Length || args[index] is not ("--backend" or "--port" or "--trials" or "--output"))
                throw new ArgumentException("Use --backend powershell|native --port 1445 --trials 3 --output <absolute own task work path>.");
            if (!parsed.TryAdd(args[index], args[index + 1])) throw new ArgumentException("Duplicate argument.");
        }
        string backend = parsed.GetValueOrDefault("--backend", "native");
        if (backend is not ("native" or "powershell")) throw new ArgumentException("Unknown backend.");
        int port = int.Parse(parsed.GetValueOrDefault("--port", "1445"));
        int trials = int.Parse(parsed.GetValueOrDefault("--trials", "3"));
        if (port < 1 || port > 65535 || trials < 1 || trials > 10) throw new ArgumentException("Port/trial bound exceeded.");
        string output = parsed.GetValueOrDefault("--output") ?? throw new ArgumentException("--output is required.");
        if (!Path.IsPathFullyQualified(output) || !Directory.Exists(Path.GetDirectoryName(output)))
            throw new ArgumentException("Output must be an absolute file in the executing task work directory.");
        string executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "EgoistShield", "Runtime", "TelegramProxy", "service-wrapper", "egoistshield-telegram-proxy-service.exe");
        var reader = new WindowsServiceListenerSnapshot(ServiceName);
        var results = new List<object>();
        for (int trial = 0; trial < trials; trial++)
        {
            var captures = new List<object>();
            var elapsed = Stopwatch.StartNew();
            LocalServiceHealth health;
            if (backend == "powershell")
            {
                health = await OwnedTcpListenerProbe.ProbeAsync(ServiceName, executable, IPAddress.Loopback, port,
                    TimeSpan.FromSeconds(8), async (script, token) =>
                    {
                        var watch = Stopwatch.StartNew();
                        var result = await ProcessRunner.RunAsync(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                            "WindowsPowerShell", "v1.0", "powershell.exe"), new[] { "-NoProfile", "-NonInteractive", "-Command", script },
                            TimeSpan.FromSeconds(4), token);
                        ServiceListenerSnapshot? snapshot = result.ExitCode == 0 ?
                            JsonSerializer.Deserialize<ServiceListenerSnapshot>(result.StandardOutput, JsonDefaults.Options) : null;
                        captures.Add(Describe(snapshot, port, executable, watch.Elapsed.TotalMilliseconds, result.StandardError.Length));
                        return result;
                    }, default);
            }
            else
                health = await OwnedTcpListenerProbe.ProbeSnapshotAsync(executable, IPAddress.Loopback, port, TimeSpan.FromSeconds(8),
                    async token =>
                    {
                        var watch = Stopwatch.StartNew();
                        var snapshot = await reader.ReadAsync(port, token);
                        captures.Add(Describe(snapshot, port, executable, watch.Elapsed.TotalMilliseconds, 0));
                        return snapshot;
                    }, default);
            results.Add(new { trial = trial + 1, health = health.ToString(), elapsedMs = Math.Round(elapsed.Elapsed.TotalMilliseconds, 2), captures });
        }
        var receipt = new
        {
            schemaVersion = 1, capturedAtUtc = DateTimeOffset.UtcNow, mode = "read-only-real-Windows-SCM-TCP-process-metadata",
            backend, port, wholeProbeDeadlineSeconds = 8, runtime = RuntimeInformation.FrameworkDescription,
            assemblyVersion = typeof(Program).Assembly.GetName().Version?.ToString(), mutationPerformed = false, trials = results
        };
        string json = JsonSerializer.Serialize(receipt, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(output, json);
        Console.WriteLine(json);
        return 0;
    }

    private static object Describe(ServiceListenerSnapshot? snapshot, int port, string executable, double elapsedMs, int stderrCharacters) => new
    {
        elapsedMs = Math.Round(elapsedMs, 2), stderrCharacters, snapshotAvailable = snapshot != null,
        ownership = OwnedTcpListenerProbe.Classify(snapshot, IPAddress.Loopback, port, executable).ToString(),
        stable = snapshot?.Stable, serviceProcessId = snapshot?.ServiceProcessId, serviceState = snapshot?.ServiceState,
        rootProcess = snapshot?.Processes.SingleOrDefault(process => process.ProcessId == snapshot.ServiceProcessId),
        listeners = snapshot?.Listeners
    };
}

