using System.Buffers.Binary;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using EgoistShield.Service;

internal static class Program
{
    private const string ServiceName = "EgoistShieldSystemDoH";
    private static string _work = "";
    private static int _passed;

    private static async Task<int> Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--fixture") return await FixtureAsync(args[1], args[2]);
        int workIndex = Array.IndexOf(args, "--work");
        if (workIndex < 0 || workIndex + 1 >= args.Length || !Path.IsPathFullyQualified(args[workIndex + 1]))
            throw new ArgumentException("Use --work <absolute task work path>; fixtures never use the shared TEMP directory.");
        _work = Path.Combine(Path.GetFullPath(args[workIndex + 1]), "core-reliability-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_work);
        int caseIndex = Array.IndexOf(args, "--case");
        string selected = caseIndex >= 0 ? args[caseIndex + 1] : "all";
        var elapsed = Stopwatch.StartNew();
        try
        {
            if (selected == "all")
            {
                await Check("SCM pending transitions and control races", TransitionsAsync);
                await Check("SCM transition deadline and cancellation", TransitionDeadlinesAsync);
                await Check("boot enrollment preserves stopped and disabled services", BootEnrollmentAsync);
                await Check("boot recovery policy repair is bounded and preserves stopped intent", RecoveryPolicyAsync);
                await Check("explicit stop and disabled races beat recovery", StopRacesAsync);
                await Check("recovery backoff survives Core restart", RecoveryBackoffAsync);
                await Check("offline and unknown probes never trigger recovery", DeferredHealthAsync);
                await Check("foreign Telegram listener cannot cause a running/stopped recovery storm", TelegramCollisionAsync);
                await Check("listener ownership validates process ancestry, birth time and endpoint", ListenerOwnershipAsync);
                await Check("real TCP reachability cannot override foreign or changing listener ownership", OwnedTcpAsync);
                await Check("native snapshot timeout cannot accumulate reads or reuse stale metadata", NativeSnapshotBoundsAsync);
                await Check("real native IPv4/IPv6 TCP tables retain exact endpoint PID and fresh changes", NativeTcpTablesAsync);
                await Check("1,440 fault cycles have bounded recovery and diagnostics", FaultStressAsync);
                await Check("malformed durable intent prevents recovery", InvalidIntentAsync);
                await Check("new DNS adapter selection preserves existing and static settings", DnsMaintenanceSelectionAsync);
                await Check("bootstrap refresh deadline persists across restart and concurrent checks", BootstrapScheduleAsync);
                await Check("DNS SERVFAIL proves local liveness", DnsServfailAsync);
                await Check("DNS TCP fallback and unresponsive transport", DnsTcpFallbackAsync);
                await Check("DNS identity/question checks and malformed packet stress", DnsPacketChecksAsync);
                await Check("worker replies correlate and operation error keeps protocol alive", WorkerHealthyAsync);
                await Check("worker malformed frame fails all pending requests", WorkerMalformedAsync);
                await Check("oversized unterminated worker frame fails within a bound", WorkerOversizedAsync);
                await Check("blocked worker stdin cannot hold the mutation indefinitely", WorkerBlockedInputAsync);
            }
            await Check("worker timeout retires process and never replays mutation", WorkerTimeoutAsync);
            Console.WriteLine($"Core service reliability regression passed: {_passed} groups; runtime={System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}; elapsed={elapsed.Elapsed.TotalSeconds:0.00}s; work={_work}");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            Console.Error.WriteLine("Regression evidence preserved: " + _work);
            return 1;
        }
    }

    private static async Task Check(string name, Func<Task> run)
    { await run(); _passed++; Console.WriteLine("PASS: " + name); }
    private static void Assert(bool condition, string message)
    { if (!condition) throw new InvalidOperationException(message); }
    private static async Task Expect<T>(Func<Task> run) where T : Exception
    { try { await run(); } catch (T) { return; } throw new InvalidOperationException("Expected " + typeof(T).Name); }

    private static async Task TransitionsAsync()
    {
        foreach (var test in new[] { (true, "stop_pending", "stopped", "start"), (false, "start_pending", "running", "stop"), (true, "paused", "paused", "continue") })
        {
            var states = new Queue<string>(new[] { test.Item2, test.Item3 });
            string final = test.Item1 ? "running" : "stopped";
            var controls = new List<string>();
            Task<OwnedServiceStatus> Read(CancellationToken _) => Task.FromResult(new OwnedServiceStatus(ServiceName, states.Count > 0 ? states.Dequeue() : final, "auto", true));
            Task<ProcessResult> Send(string control, CancellationToken _) { controls.Add(control); return Task.FromResult(new ProcessResult(0, "", "")); }
            await OwnedServiceTransition.ChangeAsync(ServiceName, test.Item1, Read, Send, TimeSpan.FromSeconds(1), default, TimeSpan.FromMilliseconds(1));
            Assert(controls.SequenceEqual(new[] { test.Item4 }), "Controls must wait for pending SCM state and resume paused services.");
        }
        int reads = 0, sends = 0;
        await OwnedServiceTransition.ChangeAsync(ServiceName, false,
            _ => Task.FromResult(new OwnedServiceStatus(ServiceName, ++reads < 3 ? "running" : "stopped", "auto", true)),
            (_, _) => { sends++; return Task.FromResult(new ProcessResult(1061, "SCM changed state", "")); },
            TimeSpan.FromSeconds(1), default, TimeSpan.FromMilliseconds(1));
        Assert(sends == 2, "A racing cannot-accept-control result must be followed by actual state readback.");
        await Expect<InvalidOperationException>(() => OwnedServiceTransition.ChangeAsync(ServiceName, true,
            _ => Task.FromResult(new OwnedServiceStatus(ServiceName, "stopped", "auto", true)),
            (_, _) => Task.FromResult(new ProcessResult(5, "access denied", "")), TimeSpan.FromSeconds(1), default));
    }

    private static async Task TransitionDeadlinesAsync()
    {
        var elapsed = Stopwatch.StartNew();
        await Expect<TimeoutException>(() => OwnedServiceTransition.ChangeAsync(ServiceName, true,
            _ => Task.FromResult(new OwnedServiceStatus(ServiceName, "stop_pending", "auto", true)),
            (_, _) => throw new InvalidOperationException("Pending state must not receive control"), TimeSpan.FromMilliseconds(120), default));
        Assert(elapsed.Elapsed < TimeSpan.FromSeconds(1), "Pending transition exceeds its total monotonic deadline.");
        using var stop = new CancellationTokenSource(TimeSpan.FromMilliseconds(80));
        await Expect<OperationCanceledException>(() => OwnedServiceTransition.ChangeAsync(ServiceName, true,
            _ => Task.FromResult(new OwnedServiceStatus(ServiceName, "start_pending", "auto", true)),
            (_, _) => throw new InvalidOperationException(), TimeSpan.FromSeconds(5), stop.Token));
        foreach (bool blockRead in new[] { true, false })
        {
            elapsed.Restart();
            await Expect<TimeoutException>(() => OwnedServiceTransition.ChangeAsync(ServiceName, true,
                async token => { if (blockRead) await Task.Delay(Timeout.Infinite, token); return new OwnedServiceStatus(ServiceName, "stopped", "auto", true); },
                async (_, token) => { await Task.Delay(Timeout.Infinite, token); return new ProcessResult(0, "", ""); }, TimeSpan.FromMilliseconds(80), default));
            Assert(elapsed.Elapsed < TimeSpan.FromSeconds(1), "A blocked SCM status/control escaped the total transition deadline.");
        }
    }

    private sealed class SupervisionFixture
    {
        internal readonly string Name;
        internal readonly OwnedServiceIntentStore Store;
        internal TimeSpan Now;
        internal OwnedServiceStatus Status = new(ServiceName, "running", "auto", true);
        internal LocalServiceHealth Health = LocalServiceHealth.Unresponsive;
        internal bool Online = true;
        internal int Probes, Recoveries, Warnings;
        internal bool? LastRecoveryWasRunning;
        internal Func<Task>? ProbeHook;
        internal readonly string Root;
        internal SupervisionFixture(string name = ServiceName)
        { Name = name; Status = new(name, "running", "auto", true); Root = Path.Combine(_work, "supervisor-" + Guid.NewGuid().ToString("N")); Store = new OwnedServiceIntentStore(Root); }
        internal DateTimeOffset Utc => DateTimeOffset.Parse("2026-09-29T00:00:00Z") + Now;
        internal OwnedServiceSupervisor Create(Func<string, CancellationToken, Task>? repair = null) => new(Store,
            (name, _) => Task.FromResult(name == Name ? Status : new OwnedServiceStatus(name, "not-installed", "not-installed", false)),
            (_, _) => Task.CompletedTask,
            async (_, _) => { Probes++; if (ProbeHook != null) await ProbeHook(); return Health; },
            (_, running, _) => { Recoveries++; LastRecoveryWasRunning = running; return Task.CompletedTask; },
            _ => { Warnings++; return Task.CompletedTask; }, () => Online, () => Now, () => Utc, repairRecovery: repair);
        internal async Task FailThree(OwnedServiceSupervisor supervisor, int start = 60)
        { for (int index = 0; index < 3; index++) { Now = TimeSpan.FromSeconds(start + index * 15); await supervisor.CheckAsync(default); } }
    }

    private static async Task BootEnrollmentAsync()
    {
        var fixture = new SupervisionFixture { Health = LocalServiceHealth.Responsive };
        var supervisor = fixture.Create();
        fixture.Now = TimeSpan.FromSeconds(59); await supervisor.CheckAsync(default);
        Assert(fixture.Probes == 0, "Boot grace must defer local probes.");
        fixture.Now = TimeSpan.FromSeconds(60); await supervisor.CheckAsync(default);
        Assert((await fixture.Store.ReadAsync(default)).Services[ServiceName].Running, "Verified running automatic legacy service was not enrolled.");
        var stopped = new SupervisionFixture { Status = new(ServiceName, "stopped", "auto", true) };
        await stopped.FailThree(stopped.Create());
        Assert(stopped.Recoveries == 0 && (await stopped.Store.ReadAsync(default)).Services.Count == 0, "Stopped legacy service must not be guessed enabled.");
        fixture.Status = fixture.Status with { StartType = "disabled" };
        await fixture.FailThree(supervisor, 100);
        Assert(fixture.Recoveries == 0 && fixture.Probes == 1, "Disabled service received a probe or restart.");
    }

    private static async Task RecoveryPolicyAsync()
    {
        var healthy = new SupervisionFixture { Health = LocalServiceHealth.Responsive };
        int repairs = 0;
        var supervisor = healthy.Create((_, _) => { repairs++; return Task.CompletedTask; });
        for (int index = 0; index < 100; index++) { healthy.Now = TimeSpan.FromSeconds(60 + 15 * index); await supervisor.CheckAsync(default); }
        Assert(repairs == 1 && healthy.Probes == 100, "An already repaired SCM policy was repeatedly rewritten or blocked health checks.");
        var stopped = new SupervisionFixture { Status = new(ServiceName, "stopped", "auto", true) };
        await stopped.FailThree(stopped.Create((_, _) => { repairs++; return Task.CompletedTask; }));
        Assert(repairs == 1, "Stopped legacy policy repair changed startup intent.");
        var failing = new SupervisionFixture { Health = LocalServiceHealth.Responsive };
        int failedRepairs = 0;
        var retry = failing.Create((_, _) => { failedRepairs++; throw new IOException("controlled SCM policy failure"); });
        await failing.FailThree(retry);
        Assert(failedRepairs == 1 && failing.Warnings == 1 && failing.Probes == 3, "Failed policy repair caused a retry storm or blocked independent local health checks.");
        failing.Now = TimeSpan.FromSeconds(360); await retry.CheckAsync(default);
        Assert(failedRepairs == 2 && failing.Warnings == 2, "Policy repair did not retry after its bounded defer interval.");
    }

    private static async Task StopRacesAsync()
    {
        foreach (bool disabled in new[] { false, true })
        {
            var fixture = new SupervisionFixture(); await fixture.Store.SetRunningAsync(ServiceName, true, default);
            fixture.ProbeHook = async () => { if (fixture.Now >= TimeSpan.FromSeconds(90)) {
                if (disabled) fixture.Status = fixture.Status with { StartType = "disabled" };
                else await fixture.Store.SetRunningAsync(ServiceName, false, default);
            }};
            await fixture.FailThree(fixture.Create());
            Assert(fixture.Recoveries == 0, "Stop/disabled during a local probe must defeat subsequent recovery.");
        }
        var off = new SupervisionFixture(); await off.Store.SetRunningAsync(ServiceName, false, default);
        await off.FailThree(off.Create());
        Assert(off.Recoveries == 0 && off.Probes == 0, "Persisted explicit-off must not be legacy-enrolled again.");
        var stopped = new SupervisionFixture { Status = new(ServiceName, "stopped", "auto", true) };
        await stopped.Store.SetRunningAsync(ServiceName, true, default); await stopped.FailThree(stopped.Create());
        Assert(stopped.Recoveries == 1 && stopped.LastRecoveryWasRunning == false, "Unexpected stopped intended service should use start without an extra stop.");
    }

    private static async Task RecoveryBackoffAsync()
    {
        var fixture = new SupervisionFixture(); await fixture.Store.SetRunningAsync(ServiceName, true, default);
        var supervisor = fixture.Create(); await fixture.FailThree(supervisor);
        Assert(fixture.Recoveries == 1, "Persistent local failure should recover once after three observations.");
        await fixture.FailThree(supervisor, 110);
        Assert(fixture.Recoveries == 1, "A restart loop violated the five-minute backoff.");
        await fixture.FailThree(fixture.Create(), 160);
        Assert(fixture.Recoveries == 1, "Core restart erased persisted recovery backoff.");
        fixture.Now = TimeSpan.FromSeconds(390); await supervisor.CheckAsync(default);
        Assert(fixture.Recoveries == 2, "Recovery was not retried after the bounded backoff.");
    }

    private static async Task DeferredHealthAsync()
    {
        foreach (bool offline in new[] { false, true })
        {
            var fixture = new SupervisionFixture { Online = !offline, Health = offline ? LocalServiceHealth.Unresponsive : LocalServiceHealth.Unknown };
            await fixture.Store.SetRunningAsync(ServiceName, true, default); await fixture.FailThree(fixture.Create());
            Assert(fixture.Recoveries == 0, "Offline or unknown local health must not trigger a speculative restart.");
        }
    }

    private static async Task TelegramCollisionAsync()
    {
        const string name = "EgoistShieldTelegramProxy";
        foreach (string state in new[] { "running", "stopped" })
        {
            var fixture = new SupervisionFixture(name) { Health = LocalServiceHealth.Conflict, Status = new(name, state, "auto", true) };
            await fixture.Store.SetRunningAsync(name, true, default); var supervisor = fixture.Create();
            for (int cycle = 0; cycle < 1440; cycle++) { fixture.Now = TimeSpan.FromSeconds(60 + cycle * 15); await supervisor.CheckAsync(default); }
            Assert(fixture.Probes == 1440 && fixture.Recoveries == 0 && fixture.Warnings == 0,
                "A persistent foreign listener caused speculative service start/restart or a diagnostic storm.");
            var status = JsonSerializer.SerializeToElement(supervisor.Describe(), JsonDefaults.Options).GetProperty("services").EnumerateArray().Single(x => x.GetProperty("serviceName").GetString() == name);
            Assert(status.GetProperty("localHealth").GetString() == "listener-conflict" && status.GetProperty("consecutiveFailures").GetInt32() == 0, "Port conflict was hidden as healthy or accumulated a restart streak.");
        }
        var raced = new SupervisionFixture(name); await raced.Store.SetRunningAsync(name, true, default);
        raced.ProbeHook = () => { if (raced.Probes >= 4) raced.Health = LocalServiceHealth.Conflict; return Task.CompletedTask; };
        await raced.FailThree(raced.Create());
        Assert(raced.Probes == 4 && raced.Recoveries == 0, "A listener takeover immediately before service recovery was ignored.");
        var missing = new SupervisionFixture(name) { Status = new(name, "stopped", "auto", true) };
        await missing.Store.SetRunningAsync(name, true, default); await missing.FailThree(missing.Create());
        Assert(missing.Recoveries == 1 && missing.LastRecoveryWasRunning == false, "A confirmed free stopped endpoint no longer permits bounded startup recovery.");
        Console.WriteLine("COLLISION STRESS: runningChecks=1440, stoppedChecks=1440, recoveries=0, warnings=0");
    }

    private static Task ListenerOwnershipAsync()
    {
        string executable = Path.Combine(_work, "owned-wrapper.exe"); var born = DateTimeOffset.Parse("2026-09-29T00:00:00Z");
        var root = new ListenerProcess(10, 1, born, executable);
        var child = new ListenerProcess(20, 10, born.AddSeconds(1), "child.exe");
        var grandchild = new ListenerProcess(30, 20, born.AddSeconds(2), "proxy.exe");
        ServiceListenerSnapshot Snapshot(params ListenerEndpoint[] endpoints) => new(10, "Running", new[] { root, child, grandchild }, endpoints, true);
        var endpoint = new ListenerEndpoint("127.0.0.1", 1443, 30);
        TcpListenerOwnership Read(ServiceListenerSnapshot value, IPAddress? address = null) => OwnedTcpListenerProbe.Classify(value, address ?? IPAddress.Loopback, 1443, executable);
        Assert(Read(Snapshot(endpoint)) == TcpListenerOwnership.Owned, "Nested WinSW child was not recognized.");
        Assert(Read(Snapshot(endpoint with { LocalAddress = "0.0.0.0" })) == TcpListenerOwnership.Owned && Read(Snapshot(endpoint with { LocalAddress = "::" })) == TcpListenerOwnership.Owned, "Potential wildcard listener was not considered for subsequent TCP confirmation.");
        Assert(Read(Snapshot(endpoint with { LocalAddress = "::1" })) == TcpListenerOwnership.Missing && Read(Snapshot(endpoint with { LocalAddress = "::1" }), IPAddress.IPv6Loopback) == TcpListenerOwnership.Owned, "Address families were incorrectly merged.");
        Assert(Read(Snapshot(endpoint) with { Processes = new[] { root with { ExecutablePath = "foreign.exe" }, child, grandchild } }) == TcpListenerOwnership.Unknown, "Wrong SCM executable was accepted as owned.");
        Assert(Read(Snapshot(endpoint) with { Processes = new[] { root, child with { CreatedAt = born.AddSeconds(5) }, grandchild } }) == TcpListenerOwnership.Foreign, "Reused parent PID was accepted as ownership.");
        Assert(Read(Snapshot(endpoint) with { Processes = new[] { root, child, grandchild with { CreatedAt = null } } }) == TcpListenerOwnership.Unknown, "Missing creation time was assumed safe.");
        Assert(Read(Snapshot(endpoint) with { Stable = false }) == TcpListenerOwnership.Unknown, "SCM change during snapshot was ignored.");
        var foreign = new ListenerProcess(99, 0, born.AddSeconds(-1), "relay.exe");
        Assert(Read(Snapshot(endpoint, endpoint with { OwningProcess = 99 }) with { Processes = new[] { root, child, grandchild, foreign } }) == TcpListenerOwnership.Foreign, "A second foreign listener was hidden behind one owned endpoint.");
        Assert(Read(new(0, "Stopped", Array.Empty<ListenerProcess>(), new[] { endpoint }, true)) == TcpListenerOwnership.Foreign &&
            Read(new(0, "Stopped", Array.Empty<ListenerProcess>(), Array.Empty<ListenerEndpoint>(), true)) == TcpListenerOwnership.Missing, "Stopped service collision was guessed healthy/free.");
        Assert(Read(Snapshot(endpoint) with { Processes = new[] { root, child with { ParentProcessId = 30, CreatedAt = grandchild.CreatedAt }, grandchild } }) == TcpListenerOwnership.Unknown, "A process cycle was followed indefinitely.");
        for (int index = 0; index < 10000; index++) Assert(Read(Snapshot(endpoint) with { Processes = new[] { root, child with { ParentProcessId = 30, CreatedAt = grandchild.CreatedAt }, grandchild } }) == TcpListenerOwnership.Unknown, "Repeated malformed ancestry escaped its bound.");
        Assert(Read(Snapshot(endpoint with { OwningProcess = 0 })) == TcpListenerOwnership.Unknown, "Missing socket process identity was treated as a recoverable missing listener.");
        return Task.CompletedTask;
    }

    private static async Task OwnedTcpAsync()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        try
        {
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            string executable = Path.Combine(_work, "own-service.exe"); var born = DateTimeOffset.UtcNow.AddMinutes(-1);
            var root = new ListenerProcess(10, 0, born, executable);
            var owned = new ServiceListenerSnapshot(10, "Running", new[] { root }, new[] { new ListenerEndpoint("127.0.0.1", port, 10) }, true);
            var foreign = owned with { Processes = new[] { root, new ListenerProcess(99, 0, born.AddSeconds(-1), "relay.exe") }, Listeners = new[] { owned.Listeners[0] with { OwningProcess = 99 } } };
            Assert(await LocalServiceHealthProbe.TcpAsync(IPAddress.Loopback, port, TimeSpan.FromSeconds(1), default) == LocalServiceHealth.Responsive, "Real loopback fixture did not accept TCP.");
            foreach (bool takeover in new[] { false, true })
            {
                int reads = 0;
                var result = await OwnedTcpListenerProbe.ProbeAsync("EgoistShieldTelegramProxy", executable, IPAddress.Loopback, port, TimeSpan.FromSeconds(1),
                    (_, _) => Task.FromResult(new ProcessResult(0, JsonSerializer.Serialize(takeover && ++reads == 1 ? owned : foreign, JsonDefaults.Options), "")), default);
                Assert(result == LocalServiceHealth.Conflict, "TCP connect accepted a foreign listener or endpoint takeover as healthy.");
            }
            Assert(await OwnedTcpListenerProbe.ProbeAsync("EgoistShieldTelegramProxy", executable, IPAddress.Loopback, port, TimeSpan.FromSeconds(1),
                (_, _) => Task.FromResult(new ProcessResult(0, JsonSerializer.Serialize(owned, JsonDefaults.Options), "")), default) == LocalServiceHealth.Responsive, "Owned real loopback listener was rejected.");
            Assert(await OwnedTcpListenerProbe.ProbeAsync("EgoistShieldTelegramProxy", executable, IPAddress.Loopback, port, TimeSpan.FromMilliseconds(80),
                async (_, token) => { await Task.Delay(Timeout.Infinite, token); return new ProcessResult(0, "", ""); }, default) == LocalServiceHealth.Unknown, "Unreadable ownership caused speculative recovery.");
            using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(40));
            await Expect<OperationCanceledException>(() => OwnedTcpListenerProbe.ProbeAsync("EgoistShieldTelegramProxy", executable, IPAddress.Loopback, port, TimeSpan.FromSeconds(5),
                async (_, token) => { await Task.Delay(Timeout.Infinite, token); return new ProcessResult(0, "", ""); }, cancel.Token));
        }
        finally { listener.Stop(); }
    }

    private static async Task NativeSnapshotBoundsAsync()
    {
        int calls = 0;
        var captured = new List<int>();
        using var release = new ManualResetEventSlim(false);
        var reader = new WindowsServiceListenerSnapshot("EgoistShieldTelegramProxy", (port, token) =>
        {
            int call = Interlocked.Increment(ref calls);
            lock (captured) captured.Add(port);
            if (call == 1) release.Wait(TimeSpan.FromSeconds(5));
            return new(0, "Stopped", Array.Empty<ListenerProcess>(), Array.Empty<ListenerEndpoint>(), true);
        });
        using var deadline = new CancellationTokenSource(TimeSpan.FromMilliseconds(80));
        await Expect<OperationCanceledException>(() => reader.ReadAsync(1445, deadline.Token));
        for (int index = 0; index < 10000; index++)
            Assert(await reader.ReadAsync(1446, default) == null, "An outstanding timed-out native read was reused as current metadata.");
        Assert(calls == 1, "Timed-out native reads accumulated threads.");
        release.Set();
        ServiceListenerSnapshot? fresh = null;
        var retry = Stopwatch.StartNew();
        while (fresh == null && retry.Elapsed < TimeSpan.FromSeconds(2))
        { fresh = await reader.ReadAsync(1446, default); if (fresh == null) await Task.Delay(5); }
        Assert(fresh != null && calls == 2 && captured.SequenceEqual(new[] { 1445, 1446 }),
            "A completed timed-out native snapshot was reused, or a changed port was cached.");
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        await Expect<OperationCanceledException>(() => reader.ReadAsync(1446, cancelled.Token));
        Assert(calls == 2, "Cancellation started another native read.");
    }

    private static Task NativeTcpTablesAsync()
    {
        if (!OperatingSystem.IsWindows()) return Task.CompletedTask;
        using var ipv4 = new TcpListener(IPAddress.Loopback, 0); ipv4.Start();
        int port = ((IPEndPoint)ipv4.LocalEndpoint).Port;
        using var ipv6 = new TcpListener(IPAddress.IPv6Loopback, port); ipv6.Server.DualMode = false; ipv6.Start();
        var endpoints = WindowsServiceListenerSnapshot.ReadListeners(port, default);
        Assert(endpoints.Any(x => x.LocalAddress == "127.0.0.1" && x.OwningProcess == Environment.ProcessId),
            "Real IPv4 native TCP row port/address/PID layout was incorrect.");
        Assert(endpoints.Any(x => x.LocalAddress == "::1" && x.OwningProcess == Environment.ProcessId),
            "Real IPv6 native TCP row port/address/PID layout was incorrect.");
        ipv4.Stop();
        var changed = WindowsServiceListenerSnapshot.ReadListeners(port, default);
        Assert(!changed.Any(x => x.LocalAddress == "127.0.0.1") && changed.Any(x => x.LocalAddress == "::1"),
            "Fresh native read retained a stale endpoint or merged address families.");
        using var cancel = new CancellationTokenSource(); cancel.Cancel();
        try { WindowsServiceListenerSnapshot.ReadListeners(port, cancel.Token); throw new InvalidOperationException("Cancelled native capture continued."); }
        catch (OperationCanceledException) { }
        return Task.CompletedTask;
    }

    private static async Task FaultStressAsync()
    {
        var fixture = new SupervisionFixture(); await fixture.Store.SetRunningAsync(ServiceName, true, default);
        var supervisor = fixture.Create();
        for (int cycle = 0; cycle < 1440; cycle++) { fixture.Now = TimeSpan.FromSeconds(60 + cycle * 15); await supervisor.CheckAsync(default); }
        Assert(fixture.Recoveries >= 8 && fixture.Recoveries <= 20 && fixture.Warnings == fixture.Recoveries,
            "Repeated failure caused an unbounded recovery or diagnostic storm.");
        Assert(new FileInfo(Path.Combine(fixture.Root, "service-supervision.json")).Length < 2048, "Supervision state grew with fault history.");
        Console.WriteLine($"STRESS: checks=1440, simulatedHours=6, recoveries={fixture.Recoveries}, warnings={fixture.Warnings}");
    }

    private static async Task InvalidIntentAsync()
    {
        var fixture = new SupervisionFixture(); Directory.CreateDirectory(fixture.Root);
        await File.WriteAllTextAsync(Path.Combine(fixture.Root, "service-supervision.json"), "{\"schemaVersion\":1,\"owner\":\"EgoistShield\",\"services\":{\"unowned-service\":{\"running\":true}}}");
        fixture.Now = TimeSpan.FromSeconds(60);
        await Expect<InvalidOperationException>(() => fixture.Create().CheckAsync(default));
        Assert(fixture.Recoveries == 0, "Invalid state authorized service recovery.");
    }

    private static async Task BootstrapScheduleAsync()
    {
        string root = Path.Combine(_work, "bootstrap-schedule");
        DateTimeOffset now = DateTimeOffset.Parse("2026-09-29T00:00:00Z");
        int calls = 0;
        var scheduler = new DnsBootstrapRefreshScheduler(root, () => now);
        Task Refresh(CancellationToken _) { calls++; return Task.CompletedTask; }
        const string url = "https://custom.example/dns-query";
        var checks = await Task.WhenAll(Enumerable.Range(0, 100).Select(_ => scheduler.RunIfDueAsync("local", url, Refresh, default)));
        Assert(calls == 1 && checks.Count(x => x) == 1, "Concurrent checks replayed a successful refresh.");
        now = now.AddMinutes(59);
        Assert(!await new DnsBootstrapRefreshScheduler(root, () => now).RunIfDueAsync("local", url, Refresh, default), "Core restart erased hourly refresh cooldown.");
        now = now.AddMinutes(1); await scheduler.RunIfDueAsync("local", url, Refresh, default);
        Assert(calls == 2, "Hourly healthy refresh was not allowed.");
        await Expect<IOException>(() => scheduler.RunIfDueAsync("native", url, _ => throw new IOException("controlled bootstrap failure"), default));
        now = now.AddMinutes(14);
        Assert(!await new DnsBootstrapRefreshScheduler(root, () => now).RunIfDueAsync("native", url, Refresh, default), "Core restart erased failed-refresh minimum cooldown.");
        now = now.AddMinutes(1); await scheduler.RunIfDueAsync("native", url, Refresh, default);
        Assert(calls == 3 && new FileInfo(Path.Combine(root, "dns-bootstrap-maintenance.json")).Length < 2048, "Retry failed or state grew with repeated checks.");
    }

    private static Task DnsMaintenanceSelectionAsync()
    {
        var known = new DnsAdapterSnapshot(1, "Ethernet", "known", new[] { "192.0.2.53" }, Array.Empty<string>(), false, false);
        var automatic = known with { InterfaceIndex = 2, InterfaceGuid = "new-dhcp" };
        var staticV4 = automatic with { InterfaceIndex = 3, InterfaceGuid = "new-static-v4", Ipv4Static = true };
        var staticV6 = automatic with { InterfaceIndex = 4, InterfaceGuid = "new-static-v6", Ipv6Static = true };
        var external = known with { Ipv4 = new[] { "198.51.100.53" }, Ipv4Static = true };
        var targets = DnsMaintenancePolicy.NewAutomaticAdapters(new[] { external, automatic, staticV4, staticV6 }, new[] { known });
        Assert(targets.Length == 1 && targets[0].InterfaceGuid == "new-dhcp", "DNS maintenance touched a known adapter or static external setting.");
        Assert(DnsMaintenancePolicy.NewAutomaticAdapters(new[] { automatic }, Array.Empty<DnsAdapterSnapshot>()).Length == 0, "Legacy state without baseline cannot enroll guessed adapters.");
        Assert(DnsMaintenancePolicy.NewAutomaticAdapters(new[] { known with { InterfaceIndex = 99 } }, new[] { known }).Length == 0, "Interface index change must retain stable ownership identity.");
        var coveredV4 = known with { Ipv4 = new[] { "1.1.1.1" }, Ipv4Static = true };
        Assert(DnsMaintenancePolicy.FullyCovered(new[] { coveredV4 }, new[] { "1.1.1.1" }), "A wholly covered IPv4-only adapter should be verified.");
        Assert(!DnsMaintenancePolicy.FullyCovered(new[] { coveredV4 with { Ipv6 = new[] { "fe80::1" } } }, new[] { "1.1.1.1" }), "Retained ISP IPv6 DNS must prevent an encrypted claim.");
        var dual = coveredV4 with { Ipv6 = new[] { "2606:4700:4700::1111" }, Ipv6Static = true };
        Assert(DnsMaintenancePolicy.FullyCovered(new[] { dual }, new[] { "1.1.1.1", "2606:4700:4700::1111" }), "Selected IPv4/IPv6 provider coverage rejected.");
        return Task.CompletedTask;
    }

    private static async Task DnsServfailAsync()
    {
        using var udp = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        int port = ((IPEndPoint)udp.Client.LocalEndPoint!).Port;
        var server = Task.Run(async () => { var received = await udp.ReceiveAsync(); byte[] response = received.Buffer; response[2] |= 0x80; response[3] = 2; await udp.SendAsync(response, received.RemoteEndPoint); });
        Assert(await LocalServiceHealthProbe.DnsAsync(IPAddress.Loopback, port, TimeSpan.FromMilliseconds(200), default) == LocalServiceHealth.Responsive,
            "SERVFAIL must be local-responsive, not a reason to restart for provider outage.");
        await server.WaitAsync(TimeSpan.FromSeconds(2));
    }

    private static async Task DnsTcpFallbackAsync()
    {
        using var server = new TcpListener(IPAddress.Loopback, 0); server.Start();
        int port = ((IPEndPoint)server.LocalEndpoint).Port;
        var serve = Task.Run(async () => {
            using var client = await server.AcceptTcpClientAsync(); using var stream = client.GetStream();
            byte[] size = new byte[2]; await stream.ReadExactlyAsync(size); byte[] query = new byte[BinaryPrimitives.ReadUInt16BigEndian(size)];
            await stream.ReadExactlyAsync(query); query[2] |= 0x80; query[3] = 3;
            await stream.WriteAsync(size); await stream.WriteAsync(query);
        });
        Assert(await LocalServiceHealthProbe.DnsAsync(IPAddress.Loopback, port, TimeSpan.FromMilliseconds(200), default) == LocalServiceHealth.Responsive, "DNS TCP fallback failed.");
        await serve.WaitAsync(TimeSpan.FromSeconds(2)); server.Stop();
        Assert(await LocalServiceHealthProbe.DnsAsync(IPAddress.Loopback, port, TimeSpan.FromMilliseconds(100), default) == LocalServiceHealth.Unresponsive, "Absent UDP/TCP listener should be unresponsive.");
    }

    private static Task DnsPacketChecksAsync()
    {
        byte[] query = LocalServiceHealthProbe.BuildDnsQuery(), valid = (byte[])query.Clone(); valid[2] |= 0x80;
        Assert(LocalServiceHealthProbe.IsDnsResponse(valid, query), "Valid DNS question echo rejected.");
        foreach (int offset in new[] { 0, 1, 4, 5, 13, query.Length - 1 })
        { byte[] malformed = (byte[])valid.Clone(); malformed[offset] ^= 1; Assert(!LocalServiceHealthProbe.IsDnsResponse(malformed, query), "Malformed ID/question accepted at " + offset); }
        byte[] cyclic = new byte[18]; query.AsSpan(0, 12).CopyTo(cyclic); cyclic[2] |= 0x80; cyclic[12] = 0xc0; cyclic[13] = 12;
        Assert(!LocalServiceHealthProbe.IsDnsResponse(cyclic, query), "Cyclic DNS compression pointer accepted.");
        var random = new Random(42); for (int index = 0; index < 10000; index++) { byte[] packet = new byte[random.Next(0, 200)]; random.NextBytes(packet); _ = LocalServiceHealthProbe.IsDnsResponse(packet, query); }
        return Task.CompletedTask;
    }

    private static async Task<Process> StartFixtureAsync(string mode, string log)
    {
        var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
        if (string.Equals(Path.GetFileNameWithoutExtension(Environment.ProcessPath), "dotnet", StringComparison.OrdinalIgnoreCase)) start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        foreach (string value in new[] { "--fixture", mode, log }) start.ArgumentList.Add(value);
        Process process = Process.Start(start) ?? throw new InvalidOperationException("Fixture did not start.");
        Assert(await process.StandardError.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10)) == "READY", "Fixture did not become ready.");
        return process;
    }
    private static ComponentWorker Worker(Func<Process> factory, TimeSpan timeout)
    {
        var constructor = typeof(ComponentWorker).GetConstructor(BindingFlags.NonPublic | BindingFlags.Instance, null, new[] { typeof(Func<Process>), typeof(TimeSpan?) }, null);
        return constructor == null ? new ComponentWorker(factory) : (ComponentWorker)constructor.Invoke(new object[] { factory, timeout });
    }
    private static Task<JsonElement> Request(ComponentWorker worker, string method, bool query = true, string? argument = null) =>
        worker.ExecuteAsync(JsonDefaults.ToElement(new { component = "SystemDoH", method, args = argument == null ? Array.Empty<string>() : new[] { argument } }), query, default);
    private static void Kill(Process process) { try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { } }

    private static async Task WorkerHealthyAsync()
    {
        string log = Path.Combine(_work, "worker-healthy.jsonl"); using Process process = await StartFixtureAsync("out-of-order", log);
        using var worker = Worker(() => process, TimeSpan.FromSeconds(3));
        Task<JsonElement> first = Request(worker, "status"), second = Request(worker, "autoSelectProgress");
        Assert((await second).GetString() == "autoSelectProgress" && (await first).GetString() == "status", "Out-of-order replies lost correlation.");
        await Expect<InvalidOperationException>(() => Request(worker, "stop", false));
        Assert((await Request(worker, "status")).GetString() == "status", "Operation error disabled the response stream.");
        Assert(File.ReadAllLines(log).Length == 4, "Worker request was replayed.");
    }

    private static async Task WorkerMalformedAsync()
    {
        string log = Path.Combine(_work, "worker-malformed.jsonl"); using Process process = await StartFixtureAsync("malformed", log);
        using var worker = Worker(() => process, TimeSpan.FromSeconds(3));
        var calls = new[] { Request(worker, "status"), Request(worker, "autoSelectProgress") };
        foreach (var call in calls) await Expect<IOException>(() => call.WaitAsync(TimeSpan.FromSeconds(3)));
        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3));
    }

    private static async Task WorkerOversizedAsync()
    {
        string log = Path.Combine(_work, "worker-oversized.jsonl"); using Process process = await StartFixtureAsync("oversized", log);
        using var worker = Worker(() => process, TimeSpan.FromSeconds(3));
        try { await Expect<IOException>(() => Request(worker, "status").WaitAsync(TimeSpan.FromSeconds(3))); await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); }
        finally { Kill(process); }
    }

    private static async Task WorkerBlockedInputAsync()
    {
        string log = Path.Combine(_work, "worker-blocked-input.jsonl"); using Process process = await StartFixtureAsync("ignore-input", log);
        using var worker = Worker(() => process, TimeSpan.FromMilliseconds(250));
        try { await Expect<TimeoutException>(() => Request(worker, "apply", false, new string('x', 60000)).WaitAsync(TimeSpan.FromSeconds(3))); await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); }
        finally { Kill(process); }
    }

    private static async Task WorkerTimeoutAsync()
    {
        string stalledLog = Path.Combine(_work, "worker-stalled.jsonl"), healthyLog = Path.Combine(_work, "worker-restarted.jsonl");
        using Process stalled = await StartFixtureAsync("hang-reply", stalledLog), healthy = await StartFixtureAsync("echo", healthyLog);
        int starts = 0; using var worker = Worker(() => ++starts == 1 ? stalled : healthy, TimeSpan.FromMilliseconds(250));
        try
        {
            await Expect<TimeoutException>(() => Request(worker, "apply", false).WaitAsync(TimeSpan.FromSeconds(3)));
            await stalled.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(2));
            Assert((await Request(worker, "status").WaitAsync(TimeSpan.FromSeconds(3))).GetString() == "status", "A request after timeout cannot start a fresh owned worker.");
            Assert(starts == 2 && File.ReadAllLines(stalledLog).Length == 1 && File.ReadAllLines(healthyLog).Length == 1, "A timed-out mutation was replayed after restarting its worker.");
        }
        finally { Kill(stalled); Kill(healthy); }
    }

    private static async Task<int> FixtureAsync(string mode, string log)
    {
        Console.InputEncoding = Encoding.UTF8; Console.OutputEncoding = new UTF8Encoding(false);
        Console.Error.WriteLine("READY"); Console.Error.Flush();
        if (mode == "ignore-input") { await Task.Delay(TimeSpan.FromMinutes(1)); return 0; }
        JsonElement? held = null; bool first = true;
        while (await Console.In.ReadLineAsync() is string line)
        {
            await File.AppendAllTextAsync(log, line + Environment.NewLine);
            if (mode == "hang-reply") { await Task.Delay(TimeSpan.FromMinutes(1)); continue; }
            if (mode == "oversized") { Console.Write(new string('x', 4 * 1024 * 1024 + 4096)); Console.Out.Flush(); await Task.Delay(TimeSpan.FromMinutes(1)); continue; }
            if (mode == "malformed") { Console.WriteLine("invalid-json"); Console.Out.Flush(); await Task.Delay(TimeSpan.FromMinutes(1)); continue; }
            using var document = JsonDocument.Parse(line); var request = document.RootElement.Clone();
            if (mode == "out-of-order" && first) { held = request; first = false; continue; }
            string method = request.GetProperty("method").GetString()!;
            if (method == "stop") Console.WriteLine(JsonSerializer.Serialize(new { id = request.GetProperty("id").GetString(), ok = false, error = "fixture rejected mutation" }));
            else Console.WriteLine(JsonSerializer.Serialize(new { id = request.GetProperty("id").GetString(), ok = true, result = method }));
            if (held.HasValue) { Console.WriteLine(JsonSerializer.Serialize(new { id = held.Value.GetProperty("id").GetString(), ok = true, result = held.Value.GetProperty("method").GetString() })); held = null; }
            Console.Out.Flush();
        }
        return 0;
    }
}
