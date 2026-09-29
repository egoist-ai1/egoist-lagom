using EgoistShield.Service;
using System.Diagnostics;
using System.Text.Json;

namespace ServiceAudit;
internal static class Program
{
    private static string work = "";
    private static readonly List<object> findings = new();
    private static async Task<int> Main(string[] args)
    {
        work = args[1]; Directory.CreateDirectory(work);
        await BootstrapContractAsync();
        await IdentityReplayAsync();
        await FutureRecoveryTimestampAsync();
        await FutureBootstrapTimestampAsync();
        await UnverifiedRootAsync();
        File.WriteAllText(Path.Combine(work, "services-reproduction.json"), JsonSerializer.Serialize(new { checkedAt = DateTimeOffset.UtcNow, baselineCommit = "d56eb9327fa75a88e91fae62b8d7ea3ed095dcf2", runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription, scope = "exact source harness; no production mutations", findings }, new JsonSerializerOptions { WriteIndented = true }));
        foreach (var finding in findings) Console.WriteLine(JsonSerializer.Serialize(finding));
        return 0;
    }
    private static async Task BootstrapContractAsync()
    {
        int started = 0; using var worker = new ComponentWorker(() => { started++; throw new Exception("Unexpected worker launch"); });
        var payload = JsonDefaults.ToElement(new { component = "SystemDoH", method = "bootstrapServers", args = new object[] { "https://example.invalid/dns-query", false } });
        string? error = null;
        try { await worker.ExecuteAsync(payload, true, default); } catch (ArgumentException e) { error = e.Message; }
        findings.Add(new { id = "SVC-01", reproduced = error == "A mutation cannot use the component query endpoint." && started == 0, error, workerStarts = started });
    }
    private static OperationDispatcher Dispatcher(string root) => new(new ServiceOptions("not-a-live-pipe", root, true, true, null), new WindowsDnsController((_, _) => throw new Exception("Unexpected OS DNS call")), new WindowsNativeDohController(root, (_, _) => throw new Exception("Unexpected OS DoH call")), null, new TransactionJournal(root), new ServiceLog(root));
    private static async Task IdentityReplayAsync()
    {
        string root = Path.Combine(work, "identity-replay"); using var dispatcher = Dispatcher(root);
        var normal = new ClientIdentity(Environment.ProcessId, "test", true, "S-1-5-21-1001");
        var probe = normal with { IdentityProbe = true };
        var request = new ServiceRequest(1, "audit:cached-status", "service.status", JsonDefaults.ToElement(new { }));
        var initial = await dispatcher.DispatchAsync(request, normal);
        var cached = await dispatcher.DispatchAsync(request, probe);
        var fresh = await dispatcher.DispatchAsync(request with { RequestId = "audit:fresh-status" }, probe);
        var mutation = new ServiceRequest(1, "audit:durable-replay", "test.delay-mutation", JsonDefaults.ToElement(new { delayMs = 1 }));
        var first = await dispatcher.DispatchAsync(mutation, normal);
        using var restarted = Dispatcher(root);
        var durable = await restarted.DispatchAsync(mutation, probe);
        findings.Add(new { id = "SVC-02", reproduced = initial.Ok && cached.Ok && fresh.Error?.Code == "IDENTITY_PROBE_SCOPE" && first.Ok && durable.Ok, cachedAllowed = cached.Ok, freshError = fresh.Error?.Code, persistedMutationReplayAllowed = durable.Ok });
    }
    private static async Task FutureRecoveryTimestampAsync()
    {
        string root = Path.Combine(work, "future-recovery"); var store = new OwnedServiceIntentStore(root);
        string name = "EgoistShieldSystemDoH"; DateTimeOffset now = DateTimeOffset.Parse("2026-09-30T00:00:00Z");
        await store.SetRunningAsync(name, true, default); await store.MarkRecoveryAsync(name, now.AddDays(14), default);
        TimeSpan elapsed = TimeSpan.FromSeconds(60); int recoveries = 0, probes = 0;
        var supervisor = new OwnedServiceSupervisor(store,
            (value, _) => Task.FromResult(new OwnedServiceStatus(value, value == name ? "stopped" : "not-installed", "auto", value == name)),
            (_, _) => Task.CompletedTask,
            (_, _) => { probes++; return Task.FromResult(LocalServiceHealth.Unresponsive); },
            (_, _, _) => { recoveries++; return Task.CompletedTask; },
            _ => Task.CompletedTask, () => true, () => elapsed, () => now);
        for (int tick = 0; tick < 100; tick++) { elapsed = TimeSpan.FromSeconds(60 + tick * 15); now = DateTimeOffset.Parse("2026-09-30T00:00:00Z") + elapsed; await supervisor.CheckAsync(default); }
        int before = recoveries;
        now = DateTimeOffset.Parse("2026-10-15T00:00:00Z"); elapsed += TimeSpan.FromSeconds(15); await supervisor.CheckAsync(default);
        findings.Add(new { id = "SVC-03", reproduced = before == 0 && recoveries == 1, checksWhileClockBehind = 100, recoveriesWhileClockBehind = before, recoveriesAfterClockCatchesUp = recoveries, futureOffsetDays = 14 });
    }
    private static async Task FutureBootstrapTimestampAsync()
    {
        string root = Path.Combine(work, "future-bootstrap"); DateTimeOffset now = DateTimeOffset.Parse("2026-10-14T00:00:00Z");
        var scheduler = new DnsBootstrapRefreshScheduler(root, () => now); int refreshes = 0;
        bool first = await scheduler.RunIfDueAsync("native", "https://example.invalid/dns-query", _ => { refreshes++; return Task.CompletedTask; }, default);
        now = now.AddDays(-14);
        bool afterRollback = await scheduler.RunIfDueAsync("native", "https://example.invalid/dns-query", _ => { refreshes++; return Task.CompletedTask; }, default);
        findings.Add(new { id = "SVC-04", reproduced = first && !afterRollback && refreshes == 1, firstCompleted = first, afterClockRollbackExecuted = afterRollback, clockRollbackDays = 14 });
    }
    private static async Task UnverifiedRootAsync()
    {
        string root = Path.Combine(work, "unverified-root"); Directory.CreateDirectory(root);
        var controller = new OwnedServiceController(root, root, false);
        var operations = new (string Name, Func<Task> Run)[] {
            ("start", async () => { await controller.StartAsync("EgoistShieldSystemDoH"); }),
            ("install", async () => { await controller.InstallAsync("EgoistShieldSystemDoH"); }),
            ("repair-auto-recovery", () => controller.RepairRecoveryAsync("EgoistShieldSystemDoH", default)),
            ("restore-auto-start", () => controller.RestoreStartTypeAsync("EgoistShieldSystemDoH", "auto"))
        };
        var errors = new Dictionary<string, string>();
        foreach (var operation in operations)
        {
            try { await operation.Run(); errors[operation.Name] = "unexpected-success"; }
            catch (ServiceOperationException e) { errors[operation.Name] = e.Code; }
            catch (Exception e) { errors[operation.Name] = e.GetType().Name; }
        }
        findings.Add(new { id = "SVC-05", reproduced = errors.Values.All(value => value != "PROTECTED_ROOT_UNVERIFIED"), expectedBeforeAnyScmAccess = "PROTECTED_ROOT_UNVERIFIED", actualErrors = errors, proofLimit = "no commands executed: trusted-root and missing-file checks intercepted baseline; SCM start exploit remains source-only" });
    }}