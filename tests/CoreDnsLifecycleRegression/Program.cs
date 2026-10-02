using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.Json;
using EgoistShield.Service;

internal static class Program
{
    private const string Name = "EgoistShieldSystemDoH";
    private static string _work = "";
    private static int _passed, _failed;
    private static void Assert(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private static async Task Check(string name, Func<Task> run)
    { try { await run(); _passed++; Console.WriteLine("PASS: " + name); } catch (Exception error) { _failed++; Console.WriteLine("FAIL: " + name + " -> " + error.Message); } }
    private static async Task<int> Main(string[] args)
    {
        if (args is ["--crash-after-mark", var childRoot, var timestamp]) return await CrashChildAsync(childRoot, timestamp);
        int index = Array.IndexOf(args, "--work");
        if (index < 0 || index + 1 >= args.Length || !Path.IsPathFullyQualified(args[index + 1])) throw new ArgumentException("Use --work <absolute task work path>.");
        _work = Path.Combine(args[index + 1], "core-dns-lifecycle-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(_work);
        index = Array.IndexOf(args, "--case"); string selected = index < 0 ? "all" : args[index + 1]; var elapsed = Stopwatch.StartNew();
        if (selected is "all" or "stable-backoff") await Check("ten-minute stable health retires the old thirty-minute recovery backoff", StableBackoffAsync);
        if (selected is "all" or "final-offline") await Check("network loss during the final recovery comparison prevents a pointless restart", FinalOfflineAsync);
        if (selected == "all")
        {
            await Check("thirty daily Core reboots preserve intended running/off and boot grace", DailyRebootsAsync);
            await Check("abrupt recovery failure preserves intent and recovery interval across Core recreation", CrashPersistenceAsync);
            await Check("actual test-process kill after durable recovery commit survives Core recreation", ActualProcessDeathAsync);
            await Check("external cancellation after durable recovery mark preserves restart interval", CancellationPersistenceAsync);
            await Check("offline intervals reset failure streak, restored network needs two fresh failures", NetworkTransitionsAsync);
            await Check("stopped/disabled/pending/absent/foreign services do not acquire unwanted intent", ServiceBoundariesAsync);
            await Check("local healthy DNS remains fresh and cleans socket resources through 2000 queries", SustainedDnsAsync);
            await Check("corrupt durable intent never authorizes recovery", CorruptIntentAsync);
        }
        Console.WriteLine($"Core DNS lifecycle: passed={_passed}, failed={_failed}; elapsed={elapsed.Elapsed.TotalSeconds:0.00}s; runtime={System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}");
        return _failed == 0 ? 0 : 1;
    }

    private sealed class Fixture
    {
        internal readonly string Root;
        internal readonly OwnedServiceIntentStore Store;
        internal TimeSpan Now;
        internal DateTimeOffset BootUtc = DateTimeOffset.Parse("2026-10-02T00:00:00Z");
        internal DateTimeOffset Utc => BootUtc + Now;
        internal bool Online = true, Owned = true;
        internal string State = "running", StartType = "auto";
        internal bool Installed = true;
        internal LocalServiceHealth Health = LocalServiceHealth.Unresponsive;
        internal int Probes, Recoveries, Warnings, Policies;
        internal Func<CancellationToken, Task>? ProbeHook, RecoveryHook;
        internal Fixture(string? root = null) { Root = root ?? Path.Combine(_work, "supervisor-" + Guid.NewGuid().ToString("N")); Store = new(Root); }
        internal OwnedServiceSupervisor Create(TimeSpan? bootGrace = null) => new(Store,
            (name, _) => Task.FromResult(name == Name ? new OwnedServiceStatus(name, State, StartType, Installed) : new(name, "not-installed", "not-installed", false)),
            (_, _) => Owned ? Task.CompletedTask : Task.FromException(new UnauthorizedAccessException("Controlled foreign service")),
            async (_, token) => { Probes++; if (ProbeHook != null) await ProbeHook(token); return Health; },
            async (_, _, token) => { Recoveries++; if (RecoveryHook != null) await RecoveryHook(token); },
            _ => { Warnings++; return Task.CompletedTask; }, () => Online, () => Now, () => Utc, bootGrace: bootGrace,
            repairRecovery: (_, _) => { Policies++; return Task.CompletedTask; });
        internal async Task Three(OwnedServiceSupervisor supervisor, int start, CancellationToken token = default)
        { for (int step = 0; step < 3; step++) { Now = TimeSpan.FromSeconds(start + step * 15); await supervisor.CheckAsync(token); } }
        internal void Reboot(DateTimeOffset utc) { BootUtc = utc; Now = TimeSpan.Zero; }
    }

    private static async Task StableBackoffAsync()
    {
        var fixture = new Fixture(); await fixture.Store.SetRunningAsync(Name, true, default); var supervisor = fixture.Create();
        foreach (int start in new[] { 60, 150, 240, 570, 1200, 2430 }) await fixture.Three(supervisor, start);
        Assert(fixture.Recoveries == 6, "Fixture did not reach persisted thirty-minute backoff.");
        fixture.Health = LocalServiceHealth.Responsive;
        for (int step = 0; step <= 40; step++) { fixture.Now = TimeSpan.FromSeconds(2490 + step * 15); await supervisor.CheckAsync(default); }
        var described = JsonSerializer.SerializeToElement(supervisor.Describe());
        var item = described.GetProperty("services").EnumerateArray().Single(x => x.GetProperty("serviceName").GetString() == Name);
        Assert(item.GetProperty("recoveryAttempts").GetInt32() == 0, "Ten-minute stable health did not reset the attempt streak.");
        fixture.Health = LocalServiceHealth.Unresponsive; await fixture.Three(supervisor, 3105);
        Assert(fixture.Recoveries == 7, "Old NextAttempt still defers a new persistent fault despite ten healthy minutes and expired durable minimum; recoveries=" + fixture.Recoveries);
    }

    private static async Task FinalOfflineAsync()
    {
        var fixture = new Fixture(); await fixture.Store.SetRunningAsync(Name, true, default);
        fixture.ProbeHook = _ => { if (fixture.Probes == 3) fixture.Online = false; return Task.CompletedTask; };
        var supervisor = fixture.Create(); fixture.Now = TimeSpan.FromSeconds(60); await supervisor.CheckAsync(default); fixture.Now = TimeSpan.FromSeconds(70); await supervisor.CheckAsync(default);
        Assert(fixture.Probes == 3 && fixture.Recoveries == 0 && (await fixture.Store.ReadAsync(default)).Services[Name].LastRecoveryAt == null,
            "A network loss during the final local/upstream comparison still causes a restart and consumes durable backoff; recoveries=" + fixture.Recoveries);
    }

    private static async Task DailyRebootsAsync()
    {
        foreach (bool intended in new[] { false, true })
        {
            var fixture = new Fixture { Health = LocalServiceHealth.Responsive }; await fixture.Store.SetRunningAsync(Name, intended, default);
            for (int day = 0; day < 30; day++)
            {
                fixture.Reboot(DateTimeOffset.Parse("2026-10-02T00:00:00Z").AddDays(day)); var supervisor = fixture.Create();
                int before = fixture.Probes; fixture.Now = TimeSpan.FromSeconds(59); await supervisor.CheckAsync(default);
                Assert(fixture.Probes == before, "Boot grace ran probes before initialization window.");
                for (int check = 0; check < 30; check++) { fixture.Now = TimeSpan.FromSeconds(60 + 15 * check); await supervisor.CheckAsync(default); }
                Assert((await fixture.Store.ReadAsync(default)).Services[Name].Running == intended, "Daily Core recreation overwrote persisted running/off.");
            }
            Assert(fixture.Recoveries == 0 && fixture.Probes == (intended ? 900 : 0) && fixture.Policies == (intended ? 30 : 0), "Daily boot caused unwanted enable/probe/recovery policy edits.");
        }
    }

    private static async Task CrashPersistenceAsync()
    {
        var fixture = new Fixture(); await fixture.Store.SetRunningAsync(Name, true, default);
        fixture.RecoveryHook = _ => throw new IOException("Controlled abrupt failure after durable recovery mark");
        fixture.Now = TimeSpan.FromSeconds(60); var initial = fixture.Create(); await initial.CheckAsync(default); fixture.Now = TimeSpan.FromSeconds(70); await initial.CheckAsync(default);
        var intent = (await fixture.Store.ReadAsync(default)).Services[Name]; Assert(intent.Running && intent.LastRecoveryAt == fixture.Utc && fixture.Recoveries == 1, "Crash path failed to preserve durable intended-running/recovery mark.");
        fixture.RecoveryHook = null; fixture.Reboot(fixture.Utc); var restarted = fixture.Create(TimeSpan.Zero); await fixture.Three(restarted, 0);
        Assert(fixture.Recoveries == 1, "Core recreation removed minimum persisted restart interval after abrupt failure.");
        fixture.Now = TimeSpan.FromSeconds(60); await restarted.CheckAsync(default); Assert(fixture.Recoveries == 2, "Recovery was never retried after durable interval expired.");
    }

    private static async Task<int> CrashChildAsync(string root, string timestamp)
    {
        string owner = Environment.GetEnvironmentVariable("LAGOM_CORE_DNS_LIFECYCLE_OWNER") ?? throw new ArgumentException("Child fixture owner is required.");
        if (!Path.IsPathFullyQualified(root) || !Path.GetFullPath(root).StartsWith(Path.GetFullPath(owner).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Child root escaped its isolated owner.");
        var store = new OwnedServiceIntentStore(root); await store.SetRunningAsync(Name, true, default);
        await store.MarkRecoveryAsync(Name, DateTimeOffset.Parse(timestamp), default);
        Console.WriteLine("RECOVERY_MARK_COMMITTED");
        await Task.Delay(Timeout.Infinite); return 0;
    }

    private static async Task ActualProcessDeathAsync()
    {
        string root = Path.Combine(_work, "actual-abrupt-death"); var committed = DateTimeOffset.Parse("2026-10-02T00:01:30Z");
        using var child = new Process { StartInfo = new ProcessStartInfo("C:\\Program Files\\dotnet\\dotnet.exe")
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = _work } };
        child.StartInfo.ArgumentList.Add(typeof(Program).Assembly.Location); child.StartInfo.ArgumentList.Add("--crash-after-mark"); child.StartInfo.ArgumentList.Add(root); child.StartInfo.ArgumentList.Add(committed.ToString("o"));
        child.StartInfo.Environment["LAGOM_CORE_DNS_LIFECYCLE_OWNER"] = _work;
        Assert(child.Start(), "Failed to start isolated intent-writer child.");
        try
        {
            string? ready = await child.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5));
            Assert(ready == "RECOVERY_MARK_COMMITTED" && !child.HasExited, "Child did not confirm its durable recovery boundary.");
            int killedPid = child.Id; child.Kill(entireProcessTree: true); await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3));
            Assert(child.HasExited && child.ExitCode != 0, "Fixture process did not die abruptly.");
            var fixture = new Fixture(root); fixture.Reboot(committed); var intent = (await fixture.Store.ReadAsync(default)).Services[Name];
            Assert(intent.Running && intent.LastRecoveryAt == committed, "OS-level process kill lost durable user intent/recovery mark.");
            var recreated = fixture.Create(TimeSpan.Zero); await fixture.Three(recreated, 0); Assert(fixture.Recoveries == 0, "OS-level process kill permitted immediate recovery replay.");
            fixture.Now = TimeSpan.FromSeconds(60); await recreated.CheckAsync(default); Assert(fixture.Recoveries == 1, "Post-death recovery remained disabled after bounded durable interval.");
            Assert(Directory.GetFiles(root, "*.tmp", SearchOption.AllDirectories).Length == 0, "Committed intent left a temporary file after process death.");
            Console.WriteLine("ACTUAL PROCESS DEATH: killedFixturePid=" + killedPid + ", durableRunning=true, durableIntervalPreserved=true");
        }
        finally { if (!child.HasExited) { child.Kill(entireProcessTree: true); await child.WaitForExitAsync(); } }
    }
    private static async Task CancellationPersistenceAsync()
    {
        var fixture = new Fixture(); await fixture.Store.SetRunningAsync(Name, true, default); using var cancel = new CancellationTokenSource();
        fixture.RecoveryHook = token => { cancel.Cancel(); token.ThrowIfCancellationRequested(); return Task.CompletedTask; };
        try { await fixture.Three(fixture.Create(), 60, cancel.Token); throw new InvalidOperationException("Cancellation was swallowed."); } catch (OperationCanceledException) { }
        var intent = (await fixture.Store.ReadAsync(default)).Services[Name]; Assert(intent.Running && intent.LastRecoveryAt == fixture.Utc, "Cancellation erased committed recovery intent/timestamp.");
        fixture.RecoveryHook = null; fixture.Reboot(fixture.Utc); await fixture.Three(fixture.Create(TimeSpan.Zero), 0); Assert(fixture.Recoveries == 1, "Cancelled recovery replayed on immediate Core recreation.");
    }

    private static async Task NetworkTransitionsAsync()
    {
        var fixture = new Fixture(); await fixture.Store.SetRunningAsync(Name, true, default); var supervisor = fixture.Create();
        fixture.Now = TimeSpan.FromSeconds(60); await supervisor.CheckAsync(default);
        fixture.Online = false;
        for (int check = 0; check < 100; check++) { fixture.Now = TimeSpan.FromSeconds(90 + 15 * check); await supervisor.CheckAsync(default); }
        Assert(fixture.Recoveries == 0, "Offline network caused restart storm.");
        fixture.Online = true; fixture.Health = LocalServiceHealth.Responsive; fixture.Now = TimeSpan.FromSeconds(1605); await supervisor.CheckAsync(default);
        fixture.Health = LocalServiceHealth.Unresponsive; fixture.Now = TimeSpan.FromSeconds(1620); await supervisor.CheckAsync(default);
        Assert(fixture.Recoveries == 0, "Old pre-offline failures survived network restoration.");
        fixture.Now = TimeSpan.FromSeconds(1630); await supervisor.CheckAsync(default); Assert(fixture.Recoveries == 1, "Two fresh failures after network restoration did not recover.");
    }

    private static async Task ServiceBoundariesAsync()
    {
        foreach (string boundary in new[] { "legacy-stopped", "disabled", "pending", "absent", "foreign", "explicit-off" })
        {
            var fixture = new Fixture();
            if (boundary != "legacy-stopped") await fixture.Store.SetRunningAsync(Name, boundary != "explicit-off", default);
            switch (boundary) { case "legacy-stopped": fixture.State = "stopped"; break; case "disabled": fixture.StartType = "disabled"; break; case "pending": fixture.State = "start_pending"; break; case "absent": fixture.Installed = false; break; case "foreign": fixture.Owned = false; break; }
            await fixture.Three(fixture.Create(), 60); Assert(fixture.Recoveries == 0 && fixture.Probes == 0, "Service boundary authorized probe/recovery: " + boundary);
            if (boundary == "legacy-stopped") Assert((await fixture.Store.ReadAsync(default)).Services.Count == 0, "Stopped legacy service acquired guessed running intent.");
            if (boundary == "explicit-off") Assert(!(await fixture.Store.ReadAsync(default)).Services[Name].Running, "Explicit off was erased by automatic-running SCM status.");
        }
    }

    private sealed class Handler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        { var query = await request.Content!.ReadAsByteArrayAsync(token); query[2] = 0x81; query[3] = 0x83; var response = new HttpResponseMessage(HttpStatusCode.OK) { Version = HttpVersion.Version20, Content = new ByteArrayContent(query) }; response.Content.Headers.ContentType = new("application/dns-message"); return response; }
    }
    private static async Task SustainedDnsAsync()
    {
        using var stop = new CancellationTokenSource(); using var udp = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0)); int port = ((IPEndPoint)udp.Client.LocalEndPoint!).Port;
        int requests = 0; byte[]? previous = null; bool repeated = false;
        var reader = Task.Run(async () =>
        {
            try { while (true) { var request = await udp.ReceiveAsync(stop.Token); if (previous != null && previous.AsSpan(12).SequenceEqual(request.Buffer.AsSpan(12))) repeated = true; previous = (byte[])request.Buffer.Clone(); int cycle = Interlocked.Increment(ref requests); request.Buffer[2] = 0x81; request.Buffer[3] = (byte)(cycle % 20 == 0 ? 0x82 : 0x83); await udp.SendAsync(request.Buffer, request.RemoteEndPoint, stop.Token); } }
            catch (Exception error) when (error is OperationCanceledException or ObjectDisposedException or SocketException) { }
        });
        var config = new SystemDohProbeConfiguration(IPAddress.Loopback, port, new Uri("https://resolver.example/private/profile?tenant=fixture"), new[] { IPAddress.Parse("192.0.2.53") });
        // Warm the CLR/HTTP diagnostics before measuring persistent resources.
        for (int warm = 0; warm < 100; warm++) await SystemDohServiceHealthProbe.ProbeAsync(config, TimeSpan.FromMilliseconds(250), default, () => new Handler());
        Interlocked.Exchange(ref requests, 0); previous = null; repeated = false;
        GC.Collect(); GC.WaitForPendingFinalizers(); int handlesBefore = Process.GetCurrentProcess().HandleCount; int localizedFailures = 0;
        try
        {
            for (int cycle = 0; cycle < 2000; cycle++)
            {
                var health = await SystemDohServiceHealthProbe.ProbeAsync(config, TimeSpan.FromMilliseconds(250), default, () => new Handler());
                if (health == LocalServiceHealth.Unresponsive) localizedFailures++;
                else Assert(health == LocalServiceHealth.Responsive, "Healthy sustained local/direct DNS result became unknown.");
            }
            GC.Collect(); GC.WaitForPendingFinalizers(); int handlesAfter = Process.GetCurrentProcess().HandleCount;
            Assert(!repeated && requests == 2000 && localizedFailures == 100, "Sustained probe caching or correlation/failure classification drifted.");
            Assert(handlesAfter <= handlesBefore + 24, "Sustained probing leaked handles: " + handlesBefore + " -> " + handlesAfter);
            Console.WriteLine("SUSTAINED DNS: questions=2000, localizedFailures=100, handles=" + handlesBefore + "->" + handlesAfter);
        }
        finally { stop.Cancel(); udp.Dispose(); await reader; }
    }

    private static async Task CorruptIntentAsync()
    {
        var fixture = new Fixture(); Directory.CreateDirectory(fixture.Root); await File.WriteAllTextAsync(Path.Combine(fixture.Root, "service-supervision.json"), "{\"schemaVersion\":1,\"owner\":\"Foreign\",\"services\":{}}");
        fixture.Now = TimeSpan.FromSeconds(60);
        try { await fixture.Create().CheckAsync(default); throw new InvalidOperationException("Corrupt durable intent accepted."); } catch (InvalidOperationException error) when (error.Message.Contains("invalid")) { }
        Assert(fixture.Probes == 0 && fixture.Recoveries == 0, "Corrupt durable intent authorized recovery.");
    }
}
