using System.Diagnostics;
using System.IO.Pipes;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using EgoistShield.Service;

namespace CorePersistenceProduction;

internal static class TestProgram
{
    private static string Work = "";
    private static int Replaces;
    private static int Reads;
    private static readonly List<object> Results = new();
    private static readonly ClientIdentity Identity = new(Environment.ProcessId, Environment.ProcessPath!, true, "isolated-core-persistence-test");

    private static async Task<int> Main(string[] args)
    {
        if (args.Length == 3 && args[0] == "--crash-child") return await CrashChild(args[1], args[2]);
        if (args.Length != 8 || args[0] != "--work" || !Path.IsPathFullyQualified(args[1]) || args[2] != "--case" || args[4] != "--replaces" || args[6] != "--reads")
            throw new ArgumentException("Use --work <own absolute path> --case <case> --replaces <count> --reads <count>.");
        Work = args[1]; Replaces = int.Parse(args[5]); Reads = int.Parse(args[7]); string selected = args[3];
        var watch = Stopwatch.StartNew();
        try
        {
            if (selected is "all" or "atomic") await Check("typed-atomic-read-and-replace", AtomicReads);
            if (selected is "all" or "verification" or "degraded") await Check("corrupt-and-foreign-journal-diagnostics", DegradedStartup);
            if (selected is "all" or "verification" or "configuration") await Check("untrusted-configuration-read-only-startup", ConfigurationStartup);
            if (selected is "all" or "verification" or "intents") await Check("durable-intent-write-denial-and-crash", OperationIntents);
            if (selected is "all" or "verification" or "vpn") await Check("VPN-explicit-start-stop-intent-before-worker", VpnComponentIntents);
            if (selected is "all" or "verification" or "budgets") await Check("response-and-memory-byte-budgets", ResponseBudgets);
            if (selected is "all" or "verification" or "route") await Check("native-route-monotonic-cache", NativeRouteCache);
            if (selected is "all" or "verification" or "selftest") await Check("integrated-Core-self-test", async () => { await SelfTest.RunAsync(); return new { passed = true }; });
            await File.WriteAllTextAsync(Path.Combine(Work, "results.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, finishedAt = DateTimeOffset.UtcNow, runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
                elapsedSeconds = watch.Elapsed.TotalSeconds, realSystemMutations = false,
                scope = "Actual production C# classes, own NTFS file locks/replaces, own named pipes and harmless crash children. No live SCM, DNS, registry or tasks. Finite stress; not a long-term availability proof.",
                results = Results
            }, new JsonSerializerOptions { WriteIndented = true }));
            Console.WriteLine($"PASS: {Results.Count} production groups; {watch.Elapsed.TotalSeconds:0.00}s");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }

    private sealed record Blob(int Generation, string Value);
    private static string Root(string name) { string path = Path.Combine(Work, name); Directory.CreateDirectory(path); return path; }
    private static void Assert(bool valid, string text) { if (!valid) throw new InvalidOperationException(text); }
    private static async Task Check(string name, Func<Task<object>> test)
    {
        Console.WriteLine("RUN: " + name);
        var watch = Stopwatch.StartNew(); object result = await test().WaitAsync(TimeSpan.FromMinutes(10));
        Results.Add(new { name, outcome = "passed", elapsedMs = watch.Elapsed.TotalMilliseconds, details = result });
        Console.WriteLine($"PASS: {name}; {watch.Elapsed.TotalMilliseconds:0}ms; {JsonSerializer.Serialize(result)}");
    }

    private static ServiceRequest Request(string id, string operation, object payload) => new(1, id, operation, JsonDefaults.ToElement(payload));
    private static object Payload(string method = "startService") => new { component = "Zapret", method, args = Array.Empty<object>() };
    private static OperationDispatcher Dispatcher(string root, Func<JsonElement, bool, CancellationToken, Task<JsonElement>>? executor = null)
    {
        Task<ProcessResult> Forbidden(string script, CancellationToken token) => throw new InvalidOperationException("The test forbids OS DNS/SCM calls.");
        return new OperationDispatcher(new ServiceOptions("unused-test-pipe", root, true, true, null), new WindowsDnsController(Forbidden),
            new WindowsNativeDohController(root, Forbidden), null, new TransactionJournal(root), new ServiceLog(root), executor);
    }

    private static async Task<object> AtomicReads()
    {
        string root = Root("atomic"); string path = Path.Combine(root, "state.json");
        Assert((await AtomicJsonFile.ReadResultAsync<Blob>(path)).Kind == AtomicJsonReadKind.Missing, "Stable missing file was not missing.");
        await File.WriteAllTextAsync(path, "{\"generation\":1,"); byte[] bad = await File.ReadAllBytesAsync(path);
        var corrupt = await AtomicJsonFile.ReadResultAsync<Blob>(path);
        Assert(corrupt.Kind == AtomicJsonReadKind.Corrupt && corrupt.Sha256 == Convert.ToHexString(SHA256.HashData(bad)), "Corruption was not classified/hash-preserved.");
        Assert(bad.AsEnumerable().SequenceEqual(await File.ReadAllBytesAsync(path)), "Corrupt evidence was rewritten.");
        await File.WriteAllTextAsync(path, "null");
        Assert((await AtomicJsonFile.ReadResultAsync<Blob>(path)).Kind == AtomicJsonReadKind.Corrupt, "JSON null became absence.");
        await AtomicJsonFile.WriteAsync(path, new Blob(0, "stable"));
        AtomicJsonReadKind denied;
        var watch = Stopwatch.StartNew();
        using (var held = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None)) denied = (await AtomicJsonFile.ReadResultAsync<Blob>(path)).Kind;
        double denialMs = watch.Elapsed.TotalMilliseconds;
        Assert(denied == AtomicJsonReadKind.Unavailable && denialMs < 2000, "Sharing denial was missing/unbounded.");
        using (var held = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(35));
            bool cancelled = false; try { await AtomicJsonFile.ReadResultAsync<Blob>(path, cancel.Token); } catch (OperationCanceledException) { cancelled = true; }
            Assert(cancelled, "Read retry ignored cancellation.");
        }
        await File.WriteAllTextAsync(path, new string('x', 1025));
        Assert((await AtomicJsonFile.ReadResultAsync<Blob>(path, maxBytes: 1024)).ErrorCode == "FILE_TOO_LARGE", "Size limit was not enforced.");
        await AtomicJsonFile.WriteAsync(path, new Blob(0, "stable"));
        int writes = 0, reads = 0, missing = 0, unavailable = 0, malformed = 0;
        var tasks = new List<Task> { Task.Run(async () => { for (int i = 1; i <= Replaces; i++) { await AtomicJsonFile.WriteAsync(path, new Blob(i, "stable")); Interlocked.Increment(ref writes); } }) };
        for (int reader = 0; reader < 4; reader++)
        {
            int quota = Reads / 4 + (reader < Reads % 4 ? 1 : 0);
            tasks.Add(Task.Run(async () => { for (int i = 0; i < quota; i++) {
                var value = await AtomicJsonFile.ReadResultAsync<Blob>(path);
                if (value.Kind == AtomicJsonReadKind.Missing) Interlocked.Increment(ref missing);
                else if (value.Kind == AtomicJsonReadKind.Unavailable) Interlocked.Increment(ref unavailable);
                else if (value.Kind != AtomicJsonReadKind.Valid || value.Value!.Value != "stable") Interlocked.Increment(ref malformed);
                Interlocked.Increment(ref reads);
            }}));
        }
        await Task.WhenAll(tasks);
        Console.WriteLine($"ATOMIC_COUNTERS: writes={writes}; reads={reads}; falseMissing={missing}; unavailable={unavailable}; malformed={malformed}");
        Assert(writes == Replaces && reads == Reads && missing == 0 && malformed == 0,
            $"Atomic replace returned false absence/corrupt read: writes={writes}; reads={reads}; missing={missing}; unavailable={unavailable}; malformed={malformed}.");
        Assert((await AtomicJsonFile.ReadAsync<Blob>(path))!.Generation == Replaces, "Final acknowledged generation was lost.");
        var journalRoot = Root("recovery-replace"); var journal = new TransactionJournal(journalRoot); var marker = Marker(TransactionPhase.Applying);
        await journal.CreateActiveAsync(marker); using var dispatcher = Dispatcher(journalRoot);
        int falseReady = 0;
        var statusReads = Task.Run(async () => { for (int i = 0; i < 1600; i++) {
            var response = await dispatcher.DispatchAsync(Request("recovery-read:" + i, "recovery.status", new { }), Identity);
            Assert(response.Ok, "Recovery diagnostics failed during replace.");
            var value = JsonDefaults.ToElement(response.Result);
            if (!value.GetProperty("recoveryRequired").GetBoolean() || value.GetProperty("mutationReady").GetBoolean()) falseReady++;
        }});
        for (int i = 0; i < 240; i++) await journal.UpdatePhaseAsync(marker, TransactionPhase.Applying, "generation:" + i);
        await statusReads; Assert(falseReady == 0, "Recovery status falsely became ready during NTFS replace.");
        return new { writes, reads, falseMissing = missing, typedUnavailable = unavailable, malformedReads = malformed, finalGeneration = Replaces,
            sharingDenialKind = denied.ToString(), sharingDenialMs = denialMs, cancellationVerified = true, corruptionBytesPreserved = true,
            recoveryMarkerWrites = 240, recoveryQueries = 1600, falseRecoveryReady = falseReady };
    }

    private static ActiveTransaction Marker(TransactionPhase phase) => new(1, "EgoistShield", Guid.NewGuid().ToString("N"), "production-test:marker",
        "owned-service", "owned-service.start", phase, JsonDefaults.ToElement(new { serviceName = "EgoistShieldZapret", installed = true, state = "stopped", startType = "auto" }),
        JsonDefaults.ToElement(new { serviceName = "EgoistShieldZapret", state = "running" }), DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null);

    private static void ProtectOwnRoot(string root)
    {
        var current = WindowsIdentity.GetCurrent().User!; var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false); acl.SetOwner(current);
        foreach (var sid in new[] { current, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null) })
            acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), FileSystemRights.ReadAndExecute,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        new DirectoryInfo(root).SetAccessControl(acl); TrustedPath.AssertTreeContainsNoReparsePoints(root);
    }

    private static async Task<ServiceResponse> PipeRequest(string pipe, ServiceRequest request, CancellationToken token)
    {
        using var client = new NamedPipeClientStream(".", pipe, PipeDirection.InOut, PipeOptions.Asynchronous);
        await client.ConnectAsync(token);
        byte[] bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request, JsonDefaults.Options) + "\n");
        await client.WriteAsync(bytes, token); await client.FlushAsync(token);
        using var reader = new StreamReader(client, Encoding.UTF8);
        string line = await reader.ReadLineAsync(token) ?? throw new IOException("No pipe reply.");
        return JsonSerializer.Deserialize<ServiceResponse>(line, JsonDefaults.Options) ?? throw new IOException("Empty pipe reply.");
    }

    private static async Task<object> DegradedStartup()
    {
        int starts = 0, replies = 0, blocked = 0; double maxHelloMs = 0;
        foreach (var phase in Enum.GetValues<TransactionPhase>())
        {
            string root = Root("corrupt-" + phase); ProtectOwnRoot(root); var journal = new TransactionJournal(root);
            await journal.CreateActiveAsync(Marker(phase)); string path = Path.Combine(root, "active-transaction.json");
            byte[] original = await File.ReadAllBytesAsync(path); int header = Encoding.UTF8.GetString(original).IndexOf("\"original\":", StringComparison.Ordinal);
            await File.WriteAllBytesAsync(path, original[..(header + 23)]); byte[] corrupt = await File.ReadAllBytesAsync(path);
            string pipe = "Lagom-Persistence-" + Guid.NewGuid().ToString("N");
            var engine = await ServiceEngine.CreateAsync(new ServiceOptions(pipe, root, true, true, null));
            using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(8)); var watch = Stopwatch.StartNew(); Task run = engine.RunAsync(stop.Token);
            try
            {
                var hello = await PipeRequest(pipe, Request("hello:" + phase, "hello", new { }), stop.Token);
                maxHelloMs = Math.Max(maxHelloMs, watch.Elapsed.TotalMilliseconds);
                Assert(hello.Ok, "Corrupt marker prevented authenticated hello."); replies++;
                var health = await PipeRequest(pipe, Request("health:" + phase, "service.status", new { }), stop.Token);
                Assert(health.Ok && !JsonDefaults.ToElement(health.Result).GetProperty("persistence").GetProperty("mutationReady").GetBoolean(), "Degraded health claimed readiness."); replies++;
                var recovery = await PipeRequest(pipe, Request("recovery:" + phase, "recovery.status", new { }), stop.Token);
                var state = JsonDefaults.ToElement(recovery.Result);
                Assert(recovery.Ok && state.GetProperty("recoveryRequired").GetBoolean() && state.GetProperty("journal").GetProperty("kind").GetString() == "corrupt", "Corrupt journal became no-recovery."); replies++;
                var mutation = await PipeRequest(pipe, Request("mutation:" + phase, "test.delay-mutation", new { delayMs = 1 }), stop.Token);
                Assert(mutation.Error?.Code == "STATE_CORRUPT", "Unsafe mutation was not rejected."); blocked++;
                Assert(corrupt.AsEnumerable().SequenceEqual(await File.ReadAllBytesAsync(path)), "Startup/diagnostics altered corrupt bytes."); starts++;
            }
            finally { stop.Cancel(); try { await run; } catch (OperationCanceledException) { } }
            var offline = await ServiceEngine.CreateAsync(new ServiceOptions("unused-offline", root, true, true, null));
            bool refused = false; try { await offline.RecoverOnlyAsync(); } catch (InvalidOperationException) { refused = true; }
            Assert(refused, "Read-only degraded startup falsely completed offline recovery.");
        }
        string foreignRoot = Root("foreign"); var foreignJournal = new TransactionJournal(foreignRoot);
        await foreignJournal.WriteActiveAsync(Marker(TransactionPhase.Applying) with { Owner = "ForeignOwner" });
        byte[] foreign = await File.ReadAllBytesAsync(Path.Combine(foreignRoot, "active-transaction.json"));
        int executions = 0; using var dispatcher = Dispatcher(foreignRoot, (p, q, t) => { executions++; return Task.FromResult(JsonDefaults.ToElement(new { })); });
        await dispatcher.RecoverOnStartupAsync();
        var denied = await dispatcher.DispatchAsync(Request("foreign-mutation", "component.execute", Payload()), Identity);
        Assert(denied.Error?.Code == "STATE_CORRUPT" && executions == 0 && foreign.AsEnumerable().SequenceEqual(await File.ReadAllBytesAsync(Path.Combine(foreignRoot, "active-transaction.json"))), "Foreign state authorized recovery/mutation.");
        var queryDenied = await dispatcher.DispatchAsync(Request("foreign-worker-query", "component.query", new { component = "Zapret", method = "cancelAutoSelect", args = Array.Empty<object>() }), Identity);
        Assert(queryDenied.Error?.Code == "STATE_CORRUPT" && executions == 0, "Degraded startup executed a component query worker.");
        Assert(maxHelloMs < 5000, "Degraded hello exceeded the acceptance budget.");
        return new { authenticTruncatedPhases = starts, diagnosticReplies = replies, rejectedMutations = blocked,
            maxHelloMs, corruptionPreserved = true, foreignBytesPreserved = true, foreignExecutorCalls = executions,
            offlineRecoveryRefused = true, actualNamedPipes = true,
            aclScope = "Own test root, current SID owner; no claim of ProgramData LocalSystem integration." };
    }

    private static string Fingerprint(ServiceRequest request) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        $"{request.ProtocolVersion}\n{request.Operation}\n{JsonSerializer.Serialize(request.Payload, JsonDefaults.Options)}")));

    private static async Task<object> ConfigurationStartup()
    {
        string programFilesRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "EgoistShield");
        var valid = new ServiceConfig(1, "EgoistShield", programFilesRoot, DateTimeOffset.UtcNow);
        var cases = new Dictionary<string, string> {
            ["truncated"] = "{\"schemaVersion\":1,\"owner\":\"EgoistShield\",",
            ["null"] = "null",
            ["foreign-owner"] = JsonSerializer.Serialize(valid with { Owner = "ForeignOwner" }, JsonDefaults.StateOptions),
            ["foreign-schema"] = JsonSerializer.Serialize(valid with { SchemaVersion = 99 }, JsonDefaults.StateOptions),
            ["relative-root"] = JsonSerializer.Serialize(valid with { InstallRoot = "EgoistShield" }, JsonDefaults.StateOptions),
            ["foreign-root"] = JsonSerializer.Serialize(valid with { InstallRoot = Work }, JsonDefaults.StateOptions),
            ["denied"] = JsonSerializer.Serialize(valid, JsonDefaults.StateOptions)
        };
        int starts = 0, replies = 0, mutations = 0, workers = 0;
        foreach (var testCase in cases)
        {
            string root = Root("configuration-" + testCase.Key); ProtectOwnRoot(root);
            string configPath = Path.Combine(root, "service-config.json");
            byte[] original = Encoding.UTF8.GetBytes(testCase.Value); await File.WriteAllBytesAsync(configPath, original);
            FileStream? denyConfig = testCase.Key == "denied" ? new FileStream(configPath, FileMode.Open, FileAccess.Read, FileShare.None) : null;
            string expectedError = testCase.Key == "denied" ? "STATE_UNAVAILABLE" : "STATE_CORRUPT";
            try
            {
                string pipe = "Lagom-Configuration-" + Guid.NewGuid().ToString("N");
                var engine = await ServiceEngine.CreateAsync(new ServiceOptions(pipe, root, true, true, Work));
                using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(8)); Task run = engine.RunAsync(stop.Token);
                try
                {
                    var hello = await PipeRequest(pipe, Request("configuration-hello", "hello", new { }), stop.Token);
                    Assert(hello.Ok, "Untrusted service configuration prevented diagnostic hello."); replies++;
                    var health = await PipeRequest(pipe, Request("configuration-health", "service.status", new { }), stop.Token);
                    var persistence = JsonDefaults.ToElement(health.Result).GetProperty("persistence");
                    Assert(health.Ok && !persistence.GetProperty("mutationReady").GetBoolean() &&
                        persistence.GetProperty("persistenceProblems").EnumerateArray().Any(problem => problem.GetProperty("file").GetString() == "service-config.json"),
                        "Untrusted configuration was accepted as healthy/ignored by diagnostics."); replies++;
                    var mutation = await PipeRequest(pipe, Request("configuration-mutation", "test.delay-mutation", new { delayMs = 1 }), stop.Token);
                    Assert(mutation.Error?.Code == expectedError, "Untrusted configuration authorized a mutation."); mutations++;
                    var query = await PipeRequest(pipe, Request("configuration-worker", "component.query", new { component = "Zapret", method = "status", args = Array.Empty<object>() }), stop.Token);
                    Assert(query.Error?.Code == expectedError, "Untrusted configuration allowed a component worker."); workers++;
                    starts++;
                }
                finally { stop.Cancel(); try { await run; } catch (OperationCanceledException) { } }
            }
            finally { denyConfig?.Dispose(); }
            Assert(original.AsEnumerable().SequenceEqual(await File.ReadAllBytesAsync(configPath)), "Invalid configuration bytes were rewritten.");
        }
        Assert(ServiceEngine.ResolveDiagnosticInstallRoot(Environment.ProcessPath) == null,
            "An arbitrary test host acquired installed GUI authority.");
        Assert(ServiceEngine.ResolveDiagnosticInstallRoot(Path.Combine(Work, "resources", "core-service", "win-x64", "EgoistShield.Service.exe")) == null,
            "An executable outside Program Files acquired installed GUI authority.");
        string missingPath = Path.Combine(programFilesRoot, "resources", "core-service", "win-x64", "missing-service.exe");
        Assert(ServiceEngine.ResolveDiagnosticInstallRoot(missingPath) == null, "An unrecognized/missing executable acquired authority.");
        return new { startupCases = starts, realDiagnosticReplies = replies, refusedMutations = mutations, refusedWorkerQueries = workers,
            callerInstallRootIgnoredWhenConfigInvalid = true, untrustedConfigNeverAuthorizesGui = true, configBytesPreserved = true,
            testAuthorization = "Explicit console dev-client override on own pipe; production GUI verification is unchanged and not bypassed.",
            productionAcceptancePending = "Native installed Core/GUI authorization in a LocalSystem ProgramData environment." };
    }

    private static async Task<object> OperationIntents()
    {
        int responseExecutions = 0, unknownExecutions = 0, readOnlyObservations = 0;
        string knownRoot = Root("response-denial"); var journal = new TransactionJournal(knownRoot);
        await journal.RecordResponseAsync("seed", "seed", ServiceResponse.Success("seed", 1, new { }));
        FileStream? deny = null;
        var request = Request("known-result-after-denial", "component.execute", Payload());
        using (var dispatcher = Dispatcher(knownRoot, async (payload, query, token) => {
            if (!query) {
                responseExecutions++;
                var pending = await new TransactionJournal(knownRoot).ReadOperationIntentsAsync();
                Assert(pending.Single().RequestId == request.RequestId && pending.Single().Fingerprint == Fingerprint(request), "Intent/fingerprint not durable before external effect.");
                Assert(payload.GetProperty("requestId").GetString() == request.RequestId, "Request identity was not forwarded.");
                await File.AppendAllTextAsync(Path.Combine(knownRoot, "effects.txt"), "executed\n");
                deny = new FileStream(Path.Combine(knownRoot, "idempotency-responses.json"), FileMode.Open, FileAccess.Read, FileShare.None);
            }
            return JsonDefaults.ToElement(new { completed = true });
        })) {
            try { Assert((await dispatcher.DispatchAsync(request, Identity)).Error?.Code == "OPERATION_OUTCOME_UNKNOWN", "Durable-result denial did not retain pending intent."); }
            finally { deny?.Dispose(); }
        }
        using (var restart = Dispatcher(knownRoot, (p, q, t) => { responseExecutions++; return Task.FromResult(JsonDefaults.ToElement(new { })); })) {
            for (int i = 0; i < 100; i++) Assert((await restart.DispatchAsync(request, Identity)).Ok, "Known terminal intent failed durable retry.");
            Assert(responseExecutions == 1 && (await journal.ReadOperationIntentsAsync()).Count == 0, "Known result replayed instead of finalizing.");
            Assert((await restart.DispatchAsync(request with { Payload = JsonDefaults.ToElement(Payload("stopService")) }, Identity)).Error?.Code == "REQUEST_ID_REUSED", "Payload reuse escaped durable fingerprint.");
        }
        string unknownRoot = Root("intent-denial"); FileStream? denyIntent = null;
        var unknownRequest = Request("unknown-after-execution", "component.execute", Payload());
        using (var dispatcher = Dispatcher(unknownRoot, async (payload, query, token) => {
            if (query) { readOnlyObservations++; return JsonDefaults.ToElement(new { installed = true, running = true }); }
            unknownExecutions++; await File.AppendAllTextAsync(Path.Combine(unknownRoot, "effects.txt"), "executed\n");
            denyIntent = new FileStream(Path.Combine(unknownRoot, "operation-intents.json"), FileMode.Open, FileAccess.Read, FileShare.None);
            return JsonDefaults.ToElement(new { completed = true });
        })) {
            try { Assert((await dispatcher.DispatchAsync(unknownRequest, Identity)).Error?.Code == "OPERATION_OUTCOME_UNKNOWN", "Intent completion denial was hidden."); }
            finally { denyIntent?.Dispose(); }
        }
        using (var restart = Dispatcher(unknownRoot, (payload, query, token) => {
            if (query) { readOnlyObservations++; return Task.FromResult(JsonDefaults.ToElement(new { installed = true, running = true })); }
            unknownExecutions++; return Task.FromResult(JsonDefaults.ToElement(new { }));
        })) {
            await restart.RecoverOnStartupAsync();
            for (int i = 0; i < 100; i++) Assert((await restart.DispatchAsync(unknownRequest, Identity)).Error?.Code == "OPERATION_OUTCOME_UNKNOWN", "Unknown result replay was accepted.");
            Assert((await restart.DispatchAsync(unknownRequest with { RequestId = "different-id" }, Identity)).Error?.Code == "RECOVERY_REQUIRED", "New ID bypassed unresolved operation gate.");
            Assert((await restart.DispatchAsync(unknownRequest with { Payload = JsonDefaults.ToElement(Payload("stopService")) }, Identity)).Error?.Code == "REQUEST_ID_REUSED", "Unknown intent fingerprint did not reject changed request.");
            var status = await restart.DispatchAsync(Request("operation-status", "operation.status", new { requestId = unknownRequest.RequestId }), Identity);
            var state = JsonDefaults.ToElement(status.Result);
            Assert(status.Ok && state.GetProperty("outcome").GetString() == "unknown" && state.GetProperty("observation").GetProperty("available").GetBoolean(), "Current read-only state observation missing.");
            Assert((await new TransactionJournal(unknownRoot).ReadOperationIntentsAsync()).Single().TerminalResponse == null && unknownExecutions == 1, "Read-only status falsely cleared historical uncertainty.");
        }
        int crashChildren = 0, crashEffects = 0;
        string retireRoot = Root("live-response-before-retire"); var retireJournal = new TransactionJournal(retireRoot);
        var retireRequest = Request("live-retire", "component.execute", Payload());
        var terminal = ServiceResponse.Success(retireRequest.RequestId, 1, new { completed = true });
        await retireJournal.BeginOperationIntentAsync(new PersistedOperationIntent(retireRequest.RequestId, Fingerprint(retireRequest), "Zapret", "startService", DateTimeOffset.UtcNow), default);
        await retireJournal.CompleteOperationIntentAsync(retireRequest.RequestId, Fingerprint(retireRequest), terminal, default);
        await retireJournal.RecordResponseAsync(retireRequest.RequestId, Fingerprint(retireRequest), terminal);
        using (var sameSession = Dispatcher(retireRoot, (p, q, t) => throw new InvalidOperationException("A completed operation must not execute again.")))
        {
            Assert((await sameSession.DispatchAsync(retireRequest, Identity)).Ok && (await retireJournal.ReadOperationIntentsAsync()).Count == 0,
                "A durable response left completed intent blocking the next operation.");
        }
        string cleanupRoot = Root("completed-intent-cleanup-denial"); var cleanupJournal = new TransactionJournal(cleanupRoot);
        var cleanupRequest = Request("cleanup-completed", "component.execute", Payload());
        var cleanupTerminal = ServiceResponse.Success(cleanupRequest.RequestId, 17, new { completed = true });
        await cleanupJournal.BeginOperationIntentAsync(new PersistedOperationIntent(cleanupRequest.RequestId, Fingerprint(cleanupRequest), "Zapret", "startService", DateTimeOffset.UtcNow), default);
        await cleanupJournal.CompleteOperationIntentAsync(cleanupRequest.RequestId, Fingerprint(cleanupRequest), cleanupTerminal, default);
        int cleanupExecutions = 0; bool cleanupDeferred = false;
        using (var dispatcher = Dispatcher(cleanupRoot, (p, q, t) => { cleanupExecutions++; return Task.FromResult(JsonDefaults.ToElement(new { })); }))
        {
            var nextRequest = Request("cleanup-next", "test.delay-mutation", new { delayMs = 1 });
            using (var held = new FileStream(Path.Combine(cleanupRoot, "operation-intents.json"), FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                try { await dispatcher.DispatchAsync(nextRequest, Identity); }
                catch (IOException) { cleanupDeferred = true; }
            }
            Assert(cleanupDeferred && (await cleanupJournal.ReadOperationIntentsAsync()).Single().TerminalResponse != null,
                "Cleanup denial discarded known intent or executed the next mutation.");
            Assert((await dispatcher.DispatchAsync(nextRequest, Identity)).Ok && (await cleanupJournal.ReadOperationIntentsAsync()).Count == 0,
                "A new request could not finish known cleanup after the transient lock was released.");
            Assert((await dispatcher.DispatchAsync(cleanupRequest, Identity)).Ok && cleanupExecutions == 0,
                "Completed cleanup replayed the old component operation.");
        }
        string mixedRoot = Root("known-and-unknown-intents"); var mixedJournal = new TransactionJournal(mixedRoot);
        var mixedRequest = Request("mixed-known", "component.execute", Payload());
        await mixedJournal.BeginOperationIntentAsync(new PersistedOperationIntent(mixedRequest.RequestId, Fingerprint(mixedRequest), "Zapret", "startService", DateTimeOffset.UtcNow), default);
        await mixedJournal.CompleteOperationIntentAsync(mixedRequest.RequestId, Fingerprint(mixedRequest), ServiceResponse.Success(mixedRequest.RequestId, 1, new { completed = true }), default);
        await mixedJournal.BeginOperationIntentAsync(new PersistedOperationIntent("mixed-unknown", new string('A', 64), "Zapret", "stopService", DateTimeOffset.UtcNow), default);
        using (var dispatcher = Dispatcher(mixedRoot, (p, q, t) => throw new InvalidOperationException("Unknown mixed operation must not be executed.")))
        {
            Assert((await dispatcher.DispatchAsync(Request("mixed-next", "test.delay-mutation", new { delayMs = 1 }), Identity)).Error?.Code == "RECOVERY_REQUIRED",
                "Unresolved sibling intent allowed another mutation.");
            Assert((await mixedJournal.ReadOperationIntentsAsync()).Single().RequestId == "mixed-unknown" && await mixedJournal.ReadResponseAsync("mixed-known") != null,
                "Known cleanup was blocked by unknown sibling, or unknown evidence was cleared.");
        }
        foreach (string point in new[] { "before-effect", "after-effect", "terminal-before-response", "response-before-retire" })
        for (int i = 0; i < 8; i++)
        {
            string root = Root("crash-" + point + "-" + i); var child = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
            child.ArgumentList.Add("--crash-child"); child.ArgumentList.Add(root); child.ArgumentList.Add(point);
            using var process = Process.Start(child) ?? throw new IOException("Own crash child did not start.");
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(15)); Assert(process.ExitCode == 17, "Own crash child did not reach its intended point."); crashChildren++;
            int effectsBefore = File.Exists(Path.Combine(root, "effects.txt")) ? File.ReadAllLines(Path.Combine(root, "effects.txt")).Length : 0;
            int forbiddenExecutions = 0; using var restart = Dispatcher(root, (p, q, t) => { forbiddenExecutions++; return Task.FromResult(JsonDefaults.ToElement(new { })); });
            await restart.RecoverOnStartupAsync(); var repeated = await restart.DispatchAsync(Request("crash-request", "component.execute", Payload()), Identity);
            Assert(forbiddenExecutions == 0, "Crash window blindly executed component again.");
            Assert(point is "terminal-before-response" or "response-before-retire" ? repeated.Ok : repeated.Error?.Code == "OPERATION_OUTCOME_UNKNOWN", "Crash result classification is incorrect.");
            int effectsAfter = File.Exists(Path.Combine(root, "effects.txt")) ? File.ReadAllLines(Path.Combine(root, "effects.txt")).Length : 0;
            Assert(effectsAfter == effectsBefore, "Restart added an external effect."); crashEffects += effectsAfter;
        }
        return new { responseDeniedExecutions = responseExecutions, knownResultReplays = 100, unknownDeniedExecutions = unknownExecutions,
            refusedUnknownReplays = 100, payloadMismatchRefused = true, newRequestIdBlocked = true, readOnlyObservations,
            unknownIntentNotClearedByCurrentState = true, liveCompletedIntentRetiredWithoutExecution = true,
            actualCleanupWriteDenialDeferred = cleanupDeferred, cleanupResumedByNewRequestWithoutOldExecution = cleanupExecutions == 0,
            knownCleanupDoesNotClearUnknownSibling = true,
            realCrashChildren = crashChildren, crashEffects, replayExecutionsAfterCrash = 0,
            crashScope = "Own harmless children exit at 4 boundaries; terminal/response boundaries use actual journal APIs. This is bounded intent/replay verification, not a permanent exactly-once guarantee." };
    }

    private static async Task<int> CrashChild(string root, string point)
    {
        var request = Request("crash-request", "component.execute", Payload()); var journal = new TransactionJournal(root);
        if (point is "terminal-before-response" or "response-before-retire")
        {
            await journal.BeginOperationIntentAsync(new PersistedOperationIntent(request.RequestId, Fingerprint(request), "Zapret", "startService", DateTimeOffset.UtcNow), default);
            await File.AppendAllTextAsync(Path.Combine(root, "effects.txt"), "executed\n");
            var response = ServiceResponse.Success(request.RequestId, 1, new { completed = true });
            await journal.CompleteOperationIntentAsync(request.RequestId, Fingerprint(request), response, default);
            if (point == "response-before-retire") await journal.RecordResponseAsync(request.RequestId, Fingerprint(request), response);
            Environment.Exit(17);
        }
        using var dispatcher = Dispatcher(root, async (payload, query, token) => {
            if (point == "after-effect") await File.AppendAllTextAsync(Path.Combine(root, "effects.txt"), "executed\n");
            Environment.Exit(17); return JsonDefaults.ToElement(new { });
        });
        await dispatcher.DispatchAsync(request, Identity); return 99;
    }

    private static async Task<object> VpnComponentIntents()
    {
        string root = Root("vpn-component-intent"); var journal = new TransactionJournal(root);
        var desired = new OwnedServiceIntentStore(root); int effects = 0, queries = 0;
        Task<JsonElement> Execute(JsonElement payload, bool query, CancellationToken token)
        {
            Assert(payload.GetProperty("component").GetString() == "Vpn", "VPN component identity was changed.");
            if (query) { queries++; return Task.FromResult(JsonDefaults.ToElement(new { installed = true, running = false })); }
            return ExecuteMutation(payload, token);
        }
        async Task<JsonElement> ExecuteMutation(JsonElement payload, CancellationToken token)
        {
            string method = payload.GetProperty("method").GetString()!;
            var state = await desired.ReadAsync(token);
            Assert(state.Services.TryGetValue("EgoistShieldVpn", out var intent) &&
                intent.Running == (method is "installService" or "startService"),
                "VPN desired state was not durable before the worker call.");
            var pending = (await journal.ReadOperationIntentsAsync(token)).Single();
            Assert(pending.Component == "Vpn" && pending.Method == method && pending.RequestId == payload.GetProperty("requestId").GetString(),
                "VPN operation did not have correlated durable intent before its effect.");
            effects++; return JsonDefaults.ToElement(new { completed = true });
        }
        var requests = new List<ServiceRequest>();
        using (var dispatcher = Dispatcher(root, Execute))
        {
            foreach (string method in new[] { "installService", "startService", "stopService", "removeService" })
            {
                var request = Request("vpn:" + method, "component.execute", new { component = "Vpn", method, args = Array.Empty<object>() });
                Assert((await dispatcher.DispatchAsync(request, Identity)).Ok, "Explicit VPN lifecycle request failed.");
                requests.Add(request);
            }
            Assert((await dispatcher.DispatchAsync(Request("vpn:status", "component.query", new { component = "Vpn", method = "status", args = Array.Empty<object>() }), Identity)).Ok,
                "VPN read-only status was unavailable.");
        }
        using (var restarted = Dispatcher(root, Execute))
        {
            foreach (var request in requests) Assert((await restarted.DispatchAsync(request, Identity)).Ok, "VPN committed replay was not retained.");
            Assert((await restarted.DispatchAsync(requests[0] with { Payload = JsonDefaults.ToElement(new { component = "Vpn", method = "removeService", args = Array.Empty<object>() }) }, Identity)).Error?.Code == "REQUEST_ID_REUSED",
                "VPN request fingerprint allowed a different method.");
        }
        Assert(effects == 4 && queries == 1 && !(await desired.ReadAsync(default)).Services["EgoistShieldVpn"].Running,
            "VPN replay had effects or last explicit stop intent was lost.");
        int confirmedFailures = 0;
        foreach (string code in new[] { "VPN_SERVICE_VALIDATION_FAILED", "VPN_SERVICE_ROLLBACK_VERIFIED" })
        foreach (bool? previous in new bool?[] { null, false, true })
        {
            string failureRoot = Root("vpn-failure-" + code + "-" + (previous?.ToString() ?? "absent"));
            var failureStore = new OwnedServiceIntentStore(failureRoot);
            if (previous.HasValue)
            {
                await failureStore.SetRunningAsync("EgoistShieldVpn", previous.Value, default);
                await failureStore.MarkRecoveryAsync("EgoistShieldVpn", DateTimeOffset.Parse("2026-01-01T00:00:00Z"), default);
            }
            (await failureStore.ReadAsync(default)).Services.TryGetValue("EgoistShieldVpn", out var prior);
            using var failed = Dispatcher(failureRoot, (p, q, t) => Task.FromException<JsonElement>(new ServiceOperationException(code, "Trusted worker confirmed no effects/verified rollback.")));
            var response = await failed.DispatchAsync(Request("vpn:confirmed-failure", "component.execute", new { component = "Vpn", method = "installService", args = Array.Empty<object>() }), Identity);
            Assert(response.Error?.Code == code, "Confirmed VPN worker error lost its safe failure category.");
            (await failureStore.ReadAsync(default)).Services.TryGetValue("EgoistShieldVpn", out var restored);
            Assert(restored == prior && (await new TransactionJournal(failureRoot).ReadOperationIntentsAsync()).Count == 0,
                "Confirmed failure left a ghost start intent or lost prior recovery history.");
            confirmedFailures++;
        }
        string uncertainRoot = Root("vpn-unconfirmed-failure");
        using (var uncertain = Dispatcher(uncertainRoot, (p, q, t) => Task.FromException<JsonElement>(new InvalidOperationException("Unclassified worker failure."))))
        {
            Assert((await uncertain.DispatchAsync(Request("vpn:uncertain", "component.execute", new { component = "Vpn", method = "startService", args = Array.Empty<object>() }), Identity)).Error?.Code == "OPERATION_OUTCOME_UNKNOWN",
                "Unclassified VPN failure became a completed outcome.");
            Assert((await uncertain.DispatchAsync(Request("vpn:uncertain-next", "test.delay-mutation", new { delayMs = 1 }), Identity)).Error?.Code == "RECOVERY_REQUIRED",
                "An unconfirmed VPN failure allowed another mutation.");
        }
        string changedRoot = Root("vpn-intent-changed-during-failure"); var changedStore = new OwnedServiceIntentStore(changedRoot);
        using (var changed = Dispatcher(changedRoot, async (p, q, t) => {
            await changedStore.SetRunningAsync("EgoistShieldVpn", false, t);
            throw new ServiceOperationException("VPN_SERVICE_ROLLBACK_VERIFIED", "Worker confirmed rollback, but another explicit intent change occurred.");
        }))
        {
            Assert((await changed.DispatchAsync(Request("vpn:changed", "component.execute", new { component = "Vpn", method = "startService", args = Array.Empty<object>() }), Identity)).Error?.Code == "OPERATION_OUTCOME_UNKNOWN",
                "Changed background intent was silently overwritten by stale rollback.");
            Assert(!(await changedStore.ReadAsync(default)).Services["EgoistShieldVpn"].Running,
                "A newer explicit off intent was overwritten.");
        }
        return new { explicitLifecycleMethods = 4, workerExecutions = effects, committedReplaysAfterRestart = requests.Count,
            workerStatusQueries = queries, preEffectStartStopIntentVerified = true, latestOffIntentPreserved = true,
            confirmedFailureRestorations = confirmedFailures, unknownFailureBlocksMutation = true, changedOffIntentPreserved = true,
            scope = "Actual Core dispatcher/journal/intent store with injected harmless executor. No SCM/native VPN launch; host/config acceptance is a separate R25 test." };
    }

    private static async Task<object> ResponseBudgets()
    {
        string root = Root("response-budgets"); var journal = new TransactionJournal(root);
        for (int i = 0; i < 90; i++) await journal.RecordResponseAsync("large:" + i, "fingerprint:" + i, ServiceResponse.Success("large:" + i, i, new { payload = new string('x', 96 * 1024) }));
        long bytes = new FileInfo(Path.Combine(root, "idempotency-responses.json")).Length;
        Assert(bytes <= TransactionJournal.MaxResponseStoreBytes && await journal.ReadResponseAsync("large:89") != null, "Durable response store exceeded byte limit/lost newest result.");
        var retained = await journal.ReadResponsesAsync(); Assert(retained!.Entries.Count < 90, "Byte budget failed to evict completed old entries.");
        string giantRoot = Root("giant-response"); int executions = 0;
        using (var dispatcher = Dispatcher(giantRoot, (p, q, t) => { executions++; return Task.FromResult(JsonDefaults.ToElement(new { payload = new string('y', 3 * 1024 * 1024) })); }))
        {
            var request = Request("giant", "component.execute", Payload()); var first = await dispatcher.DispatchAsync(request, Identity);
            Assert(first.Ok && JsonDefaults.ToElement(first.Result).GetProperty("payload").GetString()!.Length == 3 * 1024 * 1024, "First completed result was truncated.");
            var repeated = await dispatcher.DispatchAsync(request, Identity);
            Assert(repeated.Error?.Code == "OPERATION_RESULT_NOT_RETAINED" && executions == 1, "Oversized response was re-executed/retained without bounds.");
        }
        string cacheRoot = Root("memory-budget"); using var cacheDispatcher = Dispatcher(cacheRoot, (p, q, t) => Task.FromResult(JsonDefaults.ToElement(new { payload = new string('z', 200 * 1024) })));
        for (int i = 0; i < 90; i++) Assert((await cacheDispatcher.DispatchAsync(Request("query:" + i, "component.query", new { component = "Zapret", method = "status", args = Array.Empty<object>() }), Identity)).Ok, "Read-only large query failed.");
        object cache = typeof(OperationDispatcher).GetField("_responses", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(cacheDispatcher)!;
        var values = (System.Collections.IEnumerable)cache.GetType().GetProperty("Values")!.GetValue(cache)!;
        long memoryBytes = 0; int count = 0;
        foreach (object entry in values) { memoryBytes += (int)entry.GetType().GetProperty("Bytes")!.GetValue(entry)!; count++; }
        Assert(memoryBytes <= 8 * 1024 * 1024 && count < 90, "Memory response cache exceeded byte limit.");
        string capacityRoot = Root("intent-capacity"); var capacityJournal = new TransactionJournal(capacityRoot);
        for (int i = 0; i < TransactionJournal.MaxPendingOperations; i++)
            await capacityJournal.BeginOperationIntentAsync(new PersistedOperationIntent("pending:" + i, new string('A', 64), "Zapret", "startService", DateTimeOffset.UtcNow), default);
        byte[] beforeLimit = await File.ReadAllBytesAsync(Path.Combine(capacityRoot, "operation-intents.json")); bool capacityRefused = false;
        try { await capacityJournal.BeginOperationIntentAsync(new PersistedOperationIntent("capacity-overflow", new string('B', 64), "Zapret", "stopService", DateTimeOffset.UtcNow), default); }
        catch (InvalidOperationException) { capacityRefused = true; }
        Assert(capacityRefused && beforeLimit.AsEnumerable().SequenceEqual(await File.ReadAllBytesAsync(Path.Combine(capacityRoot, "operation-intents.json"))), "Pending intents were evicted to admit new work.");
        return new { durableWrites = 90, durableBytes = bytes, durableEntries = retained.Entries.Count, durableLimitBytes = TransactionJournal.MaxResponseStoreBytes,
            giantFirstResponseBytes = 3 * 1024 * 1024, giantExecutions = executions, oversizedReplayReceipt = "OPERATION_RESULT_NOT_RETAINED",
            readOnlyQueries = 90, cachedEntries = count, cachedResponseBytes = memoryBytes, cacheLimitBytes = 8 * 1024 * 1024,
            unresolvedIntentsRetainedAtCapacity = TransactionJournal.MaxPendingOperations, capacityOverflowRefused = capacityRefused,
            unresolvedIntentsEvicted = false, retentionScope = "Old completed responses may be evicted; no indefinite historical replay guarantee." };
    }

    private static async Task<object> NativeRouteCache()
    {
        string root = Root("route-clock"); TimeSpan elapsed = TimeSpan.Zero; bool route = true; int calls = 0;
        var controller = new WindowsNativeDohController(root, (script, token) => {
            calls++; return Task.FromResult(new ProcessResult(0, route ? "true" : "false", ""));
        }, () => elapsed);
        Assert(await controller.HasIpv6DefaultRouteAsync(default) && calls == 1, "Initial route observation failed.");
        route = false; elapsed = TimeSpan.FromSeconds(29);
        Assert(await controller.HasIpv6DefaultRouteAsync(default) && calls == 1, "Healthy TTL cache was not reused.");
        elapsed = TimeSpan.FromSeconds(30);
        Assert(!await controller.HasIpv6DefaultRouteAsync(default) && calls == 2, "Expired route evidence was reused.");
        route = true; elapsed = TimeSpan.FromSeconds(5);
        Assert(await controller.HasIpv6DefaultRouteAsync(default) && calls == 3, "Future timestamp/clock reversal extended stale route evidence.");
        bool cancelled = false; using var stop = new CancellationTokenSource(); stop.Cancel();
        try { await controller.HasIpv6DefaultRouteAsync(stop.Token); } catch (OperationCanceledException) { cancelled = true; }
        Assert(cancelled && calls == 3, "Cancelled route check escaped the lock budget.");
        return new { calls, cachedWithin30Seconds = true, expiredAt30Seconds = true, reverseElapsedInvalidates = true,
            systemWallClockModified = false, actualProductionMethod = true, nativeNetworkWrites = 0,
            seam = "Injected monotonic elapsed clock and read-only PowerShell adapter; actual controller cache/lock code." };
    }
}
