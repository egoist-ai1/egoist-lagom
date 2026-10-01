using System.Diagnostics;
using System.IO.Pipes;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using EgoistShield.Service;

namespace ServiceAuditStress;

internal static class AuditProgram
{
    private static string Work = "";
    private static string SelectedCase = "all";
    private static readonly List<object> Results = new();
    private static readonly ClientIdentity Identity = new(Environment.ProcessId, Environment.ProcessPath!, true, "isolated-audit");

    private static async Task<int> Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--atomic-child")
        {
            await AtomicJsonFile.WriteAsync(args[1], new Blob(1, new string('x', 32 * 1024 * 1024)));
            return 0;
        }
        if (args.Length is not (2 or 4) || args[0] != "--work" || !Path.IsPathFullyQualified(args[1]) || args.Length == 4 && args[2] != "--case")
            throw new ArgumentException("Use --work <absolute task-owned work path> [--case <case name>].");
        if (args.Length == 4) SelectedCase = args[3];
        Work = Path.Combine(Path.GetFullPath(args[1]), "native-service-stress");
        if (Directory.Exists(Work)) throw new IOException("Use a fresh task-owned path; the harness preserves prior evidence.");
        Directory.CreateDirectory(Work);
        var elapsed = Stopwatch.StartNew();
        try
        {
            await Check("concurrent-intent-and-atomic-read", ConcurrentIntent);
            await Check("recovery-status-during-atomic-replace", RecoveryStatusDuringReplace);
            await Check("native-lock-write-and-cancellation", NativeLock);
            await Check("native-crash-during-atomic-write", AtomicCrash);
            await Check("serialized-dispatch-and-cache-bound", DispatcherStress);
            await Check("component-result-persistence-fault", ComponentResultPersistenceFault);
            await Check("authentic-truncated-marker-startup", CorruptMarkerStartup);
            await Check("authentic-terminal-marker-startup", HealthyMarkerStartup);
            await Check("intent-corruption-fail-closed", CorruptIntent);
            await Check("journal-response-count-and-latency", JournalStress);
            await Check("log-native-sharing-violation", LockedLog);
            await File.WriteAllTextAsync(Path.Combine(Work, "results.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, observedAt = DateTimeOffset.UtcNow, runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
                elapsedSeconds = elapsed.Elapsed.TotalSeconds, realSystemMutations = false,
                notes = "Production C# classes, real own NTFS files/locks/pipes/process kills; OS DNS/SCM adapters never executed. Injected component executors and SCM callbacks are named in individual cases. This is bounded stress, not a months-long soak.", results = Results
            }, new JsonSerializerOptions { WriteIndented = true }));
            Console.WriteLine($"AUDIT COMPLETE: {Results.Count} cases; {elapsed.Elapsed.TotalSeconds:0.00}s");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }

    private sealed record Blob(int Generation, string Value);
    private static string CaseRoot(string name) { string path = Path.Combine(Work, name); Directory.CreateDirectory(path); return path; }
    private static void Assert(bool condition, string text) { if (!condition) throw new InvalidOperationException(text); }
    private static async Task Check(string name, Func<Task<object>> test)
    {
        if (SelectedCase != "all" && SelectedCase != name) return;
        var watch = Stopwatch.StartNew(); object result = await test().WaitAsync(TimeSpan.FromSeconds(45));
        Results.Add(new { name, outcome = "observation-confirmed", elapsedMs = watch.Elapsed.TotalMilliseconds, details = result });
        Console.WriteLine($"OBSERVED: {name}; {watch.Elapsed.TotalMilliseconds:0}ms; {JsonSerializer.Serialize(result)}");
    }
    private static async Task<object> RecoveryStatusDuringReplace()
    {
        string root = CaseRoot("recovery-status-replace"); var journal = new TransactionJournal(root);
        var marker = TerminalMarker() with { Phase = TransactionPhase.Applying, Verified = null, TerminalResponse = null };
        await journal.CreateActiveAsync(marker); using var dispatcher = Dispatcher(root);
        int writes = 0, queries = 0, falseNegatives = 0, nullActiveReads = 0;
        var tasks = new List<Task> { Task.Run(async () => { for (int i = 0; i < 240; i++) {
            await journal.UpdatePhaseAsync(marker, TransactionPhase.Applying, "stress-generation:" + i); Interlocked.Increment(ref writes);
        }}) };
        for (int reader = 0; reader < 4; reader++) {
            int readerId = reader;
            tasks.Add(Task.Run(async () => { for (int i = 0; i < 400; i++) {
                var response = await dispatcher.DispatchAsync(Request($"recover:{readerId}:{i}", "recovery.status", new { }), Identity);
                Assert(response.Ok, "The read-only status query failed unexpectedly.");
                var result = JsonDefaults.ToElement(response.Result); Interlocked.Increment(ref queries);
                if (!result.GetProperty("recoveryRequired").GetBoolean()) Interlocked.Increment(ref falseNegatives);
                if (result.GetProperty("active").ValueKind == JsonValueKind.Null) Interlocked.Increment(ref nullActiveReads);
            }}));
        }
        await Task.WhenAll(tasks); var final = await journal.ReadActiveAsync();
        Assert(final?.TransactionId == marker.TransactionId && final.Phase == TransactionPhase.Applying, "The active marker was lost or silently archived.");
        return new { writes, queries, falseNoRecoveryRequired = falseNegatives, nullActiveReads, finalMarkerStillApplying = true,
            observation = "No test code deletes the active marker. Read-only production recovery.status reports false/no active marker if AtomicJsonFile.ReadAsync transiently returns default during NTFS replace." };
    }
    private static OperationDispatcher Dispatcher(string root, Func<JsonElement, bool, CancellationToken, Task<JsonElement>>? executor = null)
    {
        Task<ProcessResult> Forbidden(string script, CancellationToken token) => throw new InvalidOperationException("The harness forbids all OS DNS/SCM calls.");
        return new OperationDispatcher(new ServiceOptions("audit-unused", root, true, true, null), new WindowsDnsController(Forbidden),
            new WindowsNativeDohController(root, Forbidden), null, new TransactionJournal(root), new ServiceLog(root), executor);
    }
    private static ServiceRequest Request(string id, string operation, object payload) => new(1, id, operation, JsonDefaults.ToElement(payload));

    private static async Task<object> ConcurrentIntent()
    {
        string root = CaseRoot("intent-concurrency"); var store = new OwnedServiceIntentStore(root);
        foreach (string name in OwnedServiceIntentStore.ServiceNames) await store.SetRunningAsync(name, true, default);
        int writes = 0, reads = 0, emptyReads = 0, partialReads = 0; var tasks = new List<Task>();
        foreach (string name in OwnedServiceIntentStore.ServiceNames)
            tasks.Add(Task.Run(async () => { for (int i = 0; i < 70; i++) {
                await store.SetRunningAsync(name, i % 2 == 0, default); Interlocked.Increment(ref writes);
                await store.MarkRecoveryAsync(name, new DateTimeOffset(2026, 9, 30, 0, 0, 0, TimeSpan.Zero).AddSeconds(i), default); Interlocked.Increment(ref writes);
            }}));
        for (int n = 0; n < 4; n++) tasks.Add(Task.Run(async () => { for (int i = 0; i < 500; i++) {
            var state = await store.ReadAsync(default); if (state.Services.Count == 0) Interlocked.Increment(ref emptyReads);
            else if (state.Services.Count != 3) Interlocked.Increment(ref partialReads); Interlocked.Increment(ref reads);
        }}));
        await Task.WhenAll(tasks);
        var final = await store.ReadAsync(default);
        bool finalUpdatesPreserved = final.Services.Count == 3 && final.Services.Values.All(value => !value.Running && value.LastRecoveryAt!.Value.Second == 9);
        Assert(!Directory.EnumerateFiles(root, "*.tmp").Any(), "A completed write leaked a temp file.");
        return new { writes, reads, finalServices = final.Services.Count, transientEmptyReads = emptyReads, transientPartialReads = partialReads,
            finalUpdatesPreserved, orphanTemps = 0, observation = "Readers should retain all three seeded keys; any empty read is a default/missing read observation, not proof of final state loss." };
    }
    private static async Task<object> NativeLock()
    {
        string root = CaseRoot("native-lock"), path = Path.Combine(root, "state.json");
        await AtomicJsonFile.WriteAsync(path, new Blob(0, "original")); byte[] before = await File.ReadAllBytesAsync(path);
        var time = Stopwatch.StartNew(); bool refused = false;
        using (var nativeLock = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None)) {
            try { await AtomicJsonFile.WriteAsync(path, new Blob(1, "replacement")); } catch (IOException) { refused = true; }
        }
        Assert(refused && Enumerable.SequenceEqual(before, await File.ReadAllBytesAsync(path)), "A locked atomic write changed the last good state.");
        double denialMs = time.Elapsed.TotalMilliseconds; int cancellations = 0;
        using (var nativeLock = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None)) {
            for (int i = 0; i < 30; i++) { using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(2));
                try { await AtomicJsonFile.WriteAsync(path, new Blob(i + 2, "cancelled"), cancel.Token); } catch (OperationCanceledException) { cancellations++; }
            }
        }
        Assert(cancellations == 30 && Enumerable.SequenceEqual(before, await File.ReadAllBytesAsync(path)), "Cancellation modified state.");
        int orphanTemps = Directory.EnumerateFiles(root, "*.tmp").Count(); Assert(orphanTemps == 0, "Handled cancellation leaked temps.");
        return new { nativeSharingDenialMs = denialMs, cancellationCount = cancellations, lastGoodPreserved = true, orphanTemps };
    }
    private static async Task<object> AtomicCrash()
    {
        string root = CaseRoot("atomic-crash"); int killed = 0, unchanged = 0; long orphanBytes = 0;
        for (int i = 0; i < 8; i++) {
            string path = Path.Combine(root, $"state-{i}.json"); await AtomicJsonFile.WriteAsync(path, new Blob(0, "last-good"));
            byte[] before = await File.ReadAllBytesAsync(path); var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add("--atomic-child"); start.ArgumentList.Add(path); using Process child = Process.Start(start)!;
            var deadline = Stopwatch.StartNew(); bool observed = false;
            while (!child.HasExited && deadline.Elapsed < TimeSpan.FromSeconds(5)) {
                if (Directory.EnumerateFiles(root, $"state-{i}.json.{child.Id}.*.tmp").Any()) { observed = true; break; }
                await Task.Delay(1);
            }
            if (!observed) {
                if (!child.HasExited) { child.Kill(entireProcessTree: true); await child.WaitForExitAsync(); }
                throw new InvalidOperationException("The crash fixture did not observe a production atomic temp file; no crash claim can be made.");
            }
            child.Kill(entireProcessTree: true); await child.WaitForExitAsync(); killed++;
            if (Enumerable.SequenceEqual(before, await File.ReadAllBytesAsync(path))) unchanged++;
        }
        var orphans = Directory.EnumerateFiles(root, "*.tmp").ToArray(); orphanBytes = orphans.Sum(path => new FileInfo(path).Length);
        Assert(killed == 8 && unchanged == 8 && orphans.Length == 8, "Crash preservation/orphan expectation changed.");
        return new { ownedChildKills = killed, lastGoodPreserved = unchanged, orphanTemps = orphans.Length, orphanBytes,
            observation = "Abrupt process exit bypasses AtomicJsonFile.finally; no orphan janitor exists in the reviewed startup path. This did not corrupt the target." };
    }
    private static async Task<object> DispatcherStress()
    {
        string root = CaseRoot("dispatcher-stress"); int active = 0, peak = 0, executions = 0;
        using var dispatcher = Dispatcher(root, async (payload, query, token) => {
            int value = Interlocked.Increment(ref active); int prior; do { prior = peak; } while (value > prior && Interlocked.CompareExchange(ref peak, value, prior) != prior);
            Interlocked.Increment(ref executions); try { await Task.Delay(2, token); return JsonDefaults.ToElement(new { completed = true }); } finally { Interlocked.Decrement(ref active); }
        });
        int total = 0, inFlight = 0, unique = 0;
        for (int wave = 0; wave < 24; wave++) {
            var tasks = new List<Task<ServiceResponse>>();
            for (int slot = 0; slot < 4; slot++) {
                var request = Request($"wave:{wave}:slot:{slot}", "component.execute", new { component = "Zapret", method = "cancelAutoSelect", args = Array.Empty<object>() }); unique++;
                tasks.Add(dispatcher.DispatchAsync(request, Identity)); tasks.Add(dispatcher.DispatchAsync(request, Identity));
            }
            var responses = await Task.WhenAll(tasks); total += responses.Length; inFlight += responses.Count(response => response.Error?.Code == "REQUEST_IN_FLIGHT");
            Assert(responses.All(response => response.Ok || response.Error?.Code == "REQUEST_IN_FLIGHT"), "Unexpected dispatch failure.");
        }
        Assert(executions == unique && peak == 1, "A duplicate executed twice or mutations overlapped.");
        for (int i = 0; i < 4096; i++) Assert((await dispatcher.DispatchAsync(Request($"query:{i}", "hello", new { }), Identity)).Ok, "Hello query failed.");
        object cache = typeof(OperationDispatcher).GetField("_responses", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(dispatcher)!;
        int cacheCount = (int)cache.GetType().GetProperty("Count")!.GetValue(cache)!;
        object pending = typeof(OperationDispatcher).GetField("_inFlight", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(dispatcher)!;
        int pendingCount = (int)pending.GetType().GetProperty("Count")!.GetValue(pending)!;
        Assert(cacheCount <= 1024 && pendingCount == 0, "Cache or completed in-flight set exceeded its limit.");
        return new { mutationRequests = total, uniqueMutations = unique, workerExecutions = executions, duplicateInFlightReplies = inFlight,
            peakConcurrentMutations = peak, queryCount = 4096, retainedCacheEntries = cacheCount, retainedInflight = pendingCount,
            seam = "Injected harmless executor; actual SCM/process engine actions are not tested by this case." };
    }
    private static async Task<object> ComponentResultPersistenceFault()
    {
        string root = CaseRoot("component-persistence-fault"); var journal = new TransactionJournal(root);
        await journal.RecordResponseAsync("seed", "seed-fingerprint", ServiceResponse.Success("seed", 1, new { }), default);
        string responsePath = Path.Combine(root, "idempotency-responses.json"); FileStream? lockAfterExecution = null; int executions = 0;
        using var dispatcher = Dispatcher(root, (payload, query, token) => {
            executions++; File.AppendAllText(Path.Combine(root, "harmless-executions.txt"), "executed\n");
            if (executions == 1) lockAfterExecution = new FileStream(responsePath, FileMode.Open, FileAccess.Read, FileShare.None);
            return Task.FromResult(JsonDefaults.ToElement(new { completed = true }));
        });
        var request = Request("same-id-after-persist-fault", "component.execute", new { component = "Zapret", method = "cancelAutoSelect", args = Array.Empty<object>() });
        string exception = "none"; var watch = Stopwatch.StartNew();
        try { await dispatcher.DispatchAsync(request, Identity); } catch (IOException error) { exception = error.GetType().Name; }
        finally { lockAfterExecution?.Dispose(); }
        Assert(exception != "none" && executions == 1, "The production result-persistence fault did not reproduce.");
        bool markerMissing = await journal.ReadActiveAsync() == null; bool responseMissing = await journal.ReadResponseAsync(request.RequestId) == null;
        var repeated = await dispatcher.DispatchAsync(request, Identity);
        Assert(repeated.Ok && executions == 2 && markerMissing && responseMissing, "The repeat-execution finding did not reproduce.");
        return new { firstCallException = exception, firstCallDurationMs = watch.Elapsed.TotalMilliseconds, firstExecutionCompleted = true,
            activeTransactionMissingAfterFailure = markerMissing, durableResponseMissingAfterFailure = responseMissing,
            sameRequestIdExecutions = executions, repeatedCallOk = repeated.Ok, severity = "P1 availability/correctness",
            seam = "Only the component side effect is an injected harmless file append. Dispatching, durable persistence, in-flight cleanup and FileShare.None failure are real production paths." };
    }

    private static ActiveTransaction TerminalMarker() => new(1, "EgoistShield", Guid.NewGuid().ToString("N"), "audit:terminal", "owned-service", "owned-service.start", TransactionPhase.Committed,
        JsonDefaults.ToElement(new { serviceName = "EgoistShieldZapret", state = "stopped", startType = "auto", installed = true }),
        JsonDefaults.ToElement(new { serviceName = "EgoistShieldZapret", state = "running" }), DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null,
        JsonDefaults.ToElement(new { serviceName = "EgoistShieldZapret", state = "running", startType = "auto", installed = true }), "AUDIT-FINGERPRINT", 1,
        ServiceResponse.Success("audit:terminal", 1, new { installed = true, state = "running" }));

    private static object ProtectOwnRoot(string root)
    {
        var current = WindowsIdentity.GetCurrent().User!; var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        var administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null); var users = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null);
        var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false); acl.SetOwner(current);
        foreach (var sid in new[] { current, system, administrators }) acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        acl.AddAccessRule(new FileSystemAccessRule(users, FileSystemRights.ReadAndExecute, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        new DirectoryInfo(root).SetAccessControl(acl); TrustedPath.AssertTreeContainsNoReparsePoints(root);
        return new { inheritanceProtected = new DirectoryInfo(root).GetAccessControl().AreAccessRulesProtected, currentUserOwner = true, systemAdminFull = true, usersReadExecute = true,
            note = "Native ACL on own root; current user owns the fixture and retains FullControl. Canonical ProgramData LocalSystem ownership/hardening is deliberately not impersonated." };
    }
    private static async Task<object> CorruptMarkerStartup()
    {
        string root = CaseRoot("truncated-startup"); object acl = ProtectOwnRoot(root); var journal = new TransactionJournal(root);
        await journal.CreateActiveAsync(TerminalMarker()); string path = Path.Combine(root, "active-transaction.json");
        byte[] authentic = await File.ReadAllBytesAsync(path); int header = Encoding.UTF8.GetString(authentic).IndexOf("\"original\":", StringComparison.Ordinal);
        Assert(header > 100, "The authentic schema/owner/transaction header was not found.");
        await File.WriteAllBytesAsync(path, authentic[..(header + 23)]); byte[] truncated = await File.ReadAllBytesAsync(path);
        string pipe = "Lagom-Audit-Corrupt-" + Guid.NewGuid().ToString("N"); var engine = await ServiceEngine.CreateAsync(new ServiceOptions(pipe, root, true, true, null));
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(3)); string error = "none";
        try { await engine.RunAsync(stop.Token); } catch (JsonException ex) { error = ex.GetType().Name; }
        Assert(error == "JsonException" && Enumerable.SequenceEqual(truncated, await File.ReadAllBytesAsync(path)), "Startup corruption was hidden or rewritten.");
        bool connected = false; using var client = new NamedPipeClientStream(".", pipe, PipeDirection.InOut, PipeOptions.Asynchronous); using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        try { await client.ConnectAsync(timeout.Token); connected = true; } catch (OperationCanceledException) { }
        Assert(!connected, "A degraded pipe was unexpectedly available after recovery failed.");
        return new { authenticMarkerBytes = authentic.Length, preservedHeaderBytes = header, truncatedBytes = truncated.Length, nativeAcl = acl,
            createAsyncSucceeded = true, runAsyncException = error, recoveryStatusPipeReachable = connected, corruptBytesPreserved = true, severity = "P1 autonomous recovery/readiness",
            note = "The failure occurs after hardening/config construction in real ServiceEngine.RunAsync before PipeServer.RunAsync. This fixture never invokes DNS/SCM or canonical ProgramData hardening." };
    }
    private static async Task<object> HealthyMarkerStartup()
    {
        string root = CaseRoot("healthy-startup"); object acl = ProtectOwnRoot(root); var journal = new TransactionJournal(root); await journal.CreateActiveAsync(TerminalMarker());
        string pipe = "Lagom-Audit-Healthy-" + Guid.NewGuid().ToString("N"); var engine = await ServiceEngine.CreateAsync(new ServiceOptions(pipe, root, true, true, null));
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(5)); Task run = engine.RunAsync(stop.Token);
        string response;
        try {
            using var client = new NamedPipeClientStream(".", pipe, PipeDirection.InOut, PipeOptions.Asynchronous); await client.ConnectAsync(stop.Token);
            byte[] request = Encoding.UTF8.GetBytes("{\"protocolVersion\":1,\"requestId\":\"audit:hello\",\"operation\":\"hello\",\"payload\":{}}\n"); await client.WriteAsync(request, stop.Token); await client.FlushAsync(stop.Token);
            using var reader = new StreamReader(client, Encoding.UTF8); response = await reader.ReadLineAsync(stop.Token) ?? throw new IOException("No hello response.");
            using var json = JsonDocument.Parse(response); Assert(json.RootElement.GetProperty("ok").GetBoolean(), "Healthy startup hello failed.");
        }
        finally { stop.Cancel(); try { await run; } catch (OperationCanceledException) { } }
        Assert(await journal.ReadActiveAsync() == null && await journal.ReadResponseAsync("audit:terminal") != null, "Authentic terminal marker did not finalize.");
        return new { nativeAcl = acl, realNamedPipeHello = true, terminalMarkerArchived = true, durableTerminalResponseRestored = true,
            scope = "Console dev-client identity only in the own pipe; production installed-client authorization is unchanged and not exercised." };
    }
    private static async Task<object> CorruptIntent()
    {
        string root = CaseRoot("intent-corruption"); var store = new OwnedServiceIntentStore(root); await store.SetRunningAsync("EgoistShieldSystemDoH", true, default);
        string path = Path.Combine(root, "service-supervision.json"); byte[] original = await File.ReadAllBytesAsync(path); await File.WriteAllBytesAsync(path, original[..(original.Length - 4)]);
        int statuses = 0, recoveries = 0;
        var supervisor = new OwnedServiceSupervisor(store, (name, token) => { statuses++; return Task.FromResult(new OwnedServiceStatus(name, "stopped", "auto", true)); },
            (name, token) => Task.CompletedTask, (name, token) => Task.FromResult(LocalServiceHealth.Unresponsive), (name, running, token) => { recoveries++; return Task.CompletedTask; },
            message => Task.CompletedTask, () => true, () => TimeSpan.FromHours(1), bootGrace: TimeSpan.Zero);
        int failures = 0; for (int i = 0; i < 30; i++) try { await supervisor.CheckAsync(default); } catch (JsonException) { failures++; }
        Assert(failures == 30 && statuses == 0 && recoveries == 0, "Malformed intent did not fail closed before SCM reads/recoveries.");
        return new { checks = 30, rejectedChecks = failures, scmStatusCalls = statuses, recoveryCalls = recoveries,
            observation = "Safe refusal; corrupted durable intent also prevents later DNS/bootstrap checks in the enclosing RunSupervisionAsync sequence until state is repaired." };
    }
    private static async Task<object> JournalStress()
    {
        string root = CaseRoot("journal-stress"); var journal = new TransactionJournal(root); var latency = new List<double>();
        for (int i = 0; i < 600; i++) {
            var watch = Stopwatch.StartNew(); await journal.RecordResponseAsync("response:" + i, "fingerprint:" + i, ServiceResponse.Success("response:" + i, i, new { payload = new string('x', 1024) })); latency.Add(watch.Elapsed.TotalMilliseconds);
        }
        var state = await AtomicJsonFile.ReadAsync<PersistedResponseStore>(Path.Combine(root, "idempotency-responses.json"));
        Assert(state!.Entries.Count == 512 && await journal.ReadResponseAsync("response:0") == null && await journal.ReadResponseAsync("response:599") != null, "Journal response retention changed.");
        double Median(IEnumerable<double> values) { var array = values.Order().ToArray(); return array[array.Length / 2]; }
        return new { writes = 600, retainedEntries = state.Entries.Count, firstEntryEvicted = true, fileBytes = new FileInfo(Path.Combine(root, "idempotency-responses.json")).Length,
            first100MedianMs = Median(latency.Take(100)), last100MedianMs = Median(latency.TakeLast(100)), p95Ms = latency.Order().ElementAt((int)(latency.Count * .95)),
            observation = "Count is bounded, but serialized bytes are not bounded. Every durable response rewrites the whole retained store. Long-term same-id replay protection ends after eviction." };
    }
    private static async Task<object> LockedLog()
    {
        string root = CaseRoot("locked-log"); var log = new ServiceLog(root); await log.InfoAsync("before lock");
        var watch = Stopwatch.StartNew(); using (var nativeLock = new FileStream(Path.Combine(root, "service.log"), FileMode.Open, FileAccess.Read, FileShare.None)) {
            await Task.WhenAll(Enumerable.Range(0, 500).Select(i => log.WarnAsync("native sharing denial " + i)));
        }
        await log.InfoAsync("after lock"); Assert((await File.ReadAllTextAsync(Path.Combine(root, "service.log"))).Contains("after lock"), "ServiceLog did not recover after the native lock.");
        return new { deniedWrites = 500, escapedFailures = 0, recoveredWrite = true, elapsedMs = watch.Elapsed.TotalMilliseconds };
    }
}
