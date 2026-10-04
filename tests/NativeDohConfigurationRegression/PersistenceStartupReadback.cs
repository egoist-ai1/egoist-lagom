using EgoistShield.Service;
using System.Reflection;
using System.Text.Json;
namespace NativeDohRegression;
internal static partial class Program
{
    private static async Task StartupReadbackEpochAsync()
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var getGate = typeof(AtomicJsonFile).GetMethod("GetPathLock", BindingFlags.Static | BindingFlags.NonPublic) ?? throw new InvalidOperationException("Atomic read barrier unavailable.");
        SemaphoreSlim Gate(string path) => (SemaphoreSlim)getGate.Invoke(null, new object[] { path })!;
        string root = ""; SemaphoreSlim activeGate = null!, intentGate = null!;
        for (int attempt = 0; attempt < 128; attempt++)
        {
            root = Path.Combine(_work, "startup-readback-" + Guid.NewGuid().ToString("N"));
            activeGate = Gate(Path.Combine(root, "active-transaction.json"));
            intentGate = Gate(Path.Combine(root, "operation-intents.json"));
            var responseGate = Gate(Path.Combine(root, "idempotency-responses.json"));
            var historyGate = Gate(Path.Combine(root, "transactions.jsonl"));
            if (new[] { activeGate, intentGate, responseGate, historyGate }.Distinct().Count() == 4) break;
            if (attempt == 127) throw new InvalidOperationException("Could not isolate striped fixture paths.");
        }
        Directory.CreateDirectory(root);
        var journal = new TransactionJournal(root);
        var now = DateTimeOffset.UtcNow;
        var terminal = new ActiveTransaction(1, "EgoistShield", "epoch:transaction", "epoch:request", "test", "test.delay-mutation", TransactionPhase.Committed, JsonDefaults.ToElement(new { }), JsonDefaults.ToElement(new { }), now, now, null);
        await journal.CreateActiveAsync(terminal, deadline.Token);
        using var dispatcher = new OperationDispatcher(new ServiceOptions("epoch:no-pipe", root, true, true, null), new WindowsDnsController(), new WindowsNativeDohController(root), null, journal, new ServiceLog(root));
        dispatcher.SetStartupRecoveryPending(true);
        await intentGate.WaitAsync(deadline.Token);
        Task<object>? pending = null;
        try
        {
            pending = dispatcher.DescribePersistenceAsync(deadline.Token);
            // The first reader owns this stripe until its active bytes are copied.
            // Acquiring it proves the old generation is captured; the intent read
            // remains blocked by the separately held stripe without timing sleeps.
            await activeGate.WaitAsync(deadline.Token);
            activeGate.Release();
            Assert(!pending.IsCompleted, "Fixture did not hold the persistence read across startup completion.");
            await journal.ArchiveTerminalAsync(terminal, deadline.Token);
            dispatcher.SetStartupRecoveryPending(false);
        }
        finally { intentGate.Release(); }
        JsonElement before = JsonDefaults.ToElement(await pending!);
        Assert(before.GetProperty("startupPending").GetBoolean() && !before.GetProperty("mutationReady").GetBoolean(), "Persistence read mixed pre-recovery journal bytes with post-recovery startup flag.");
        Assert(before.GetProperty("active").ValueKind != JsonValueKind.Null, "Barrier did not retain the old active generation.");
        JsonElement after = JsonDefaults.ToElement(await dispatcher.DescribePersistenceAsync(deadline.Token));
        Assert(!after.GetProperty("startupPending").GetBoolean() && after.GetProperty("mutationReady").GetBoolean(), "Fresh post-recovery read did not establish mutation readiness.");
        Assert(await journal.ReadActiveAsync(deadline.Token) == null, "Completed fixture journal remains active.");
        Assert((await File.ReadAllTextAsync(Path.Combine(root, "transactions.jsonl"), deadline.Token)).Contains(terminal.TransactionId), "Terminal fixture recovery history was lost.");
    }
}