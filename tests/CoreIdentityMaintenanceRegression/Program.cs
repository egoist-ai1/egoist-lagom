using System.IO.Pipes;
using System.Reflection;
using System.Text;
using System.Text.Json;
using EgoistShield.Service;
namespace CoreIdentityMaintenanceRegression;
internal static class Program
{
    private static string Work = "";
    private static int Passed, Failed;
    private sealed class Fixture : IAsyncDisposable
    {
        internal readonly string Root, StateRoot, PipeName;
        internal readonly OperationDispatcher Dispatcher;
        internal readonly CancellationTokenSource Lifetime = new();
        internal readonly Task Run;
        internal bool IdentityProbe, Reject;
        internal int Executions;
        private bool Disposed;
        internal Fixture(params string[] markers)
        {
            Root = Path.Combine(Work, "identity-maintenance-" + Guid.NewGuid().ToString("N"));
            StateRoot = Path.Combine(Root, "Service"); Directory.CreateDirectory(StateRoot);
            PipeName = "EgoistShield.OwnIdentityRegression." + Guid.NewGuid().ToString("N");
            foreach (string marker in markers) { string file = Path.Combine(Root, "installer", marker); Directory.CreateDirectory(Path.GetDirectoryName(file)!); File.WriteAllText(file, "{\"ownSyntheticFixture\":true}"); }
            var options = new ServiceOptions(PipeName, StateRoot, true, true, null);
            Task<ProcessResult> Forbidden(string command, CancellationToken token) => throw new Exception("SCM/DNS/registry subprocess is forbidden in this fixture");
            var log = new ServiceLog(StateRoot);
            Dispatcher = new(options, new WindowsDnsController(Forbidden), new WindowsNativeDohController(StateRoot, Forbidden), null, new TransactionJournal(StateRoot), log,
                componentExecutor: (payload, query, token) => { token.ThrowIfCancellationRequested(); Executions++; return Task.FromResult(JsonDefaults.ToElement(new { controlled = true })); });
            var server = new PipeServer(options, _ => Reject ? throw new UnauthorizedAccessException("own controlled rejected client") : new ClientIdentity(Environment.ProcessId, Environment.ProcessPath!, true, "own-test-sid", IdentityProbe), Dispatcher, log);
            var engine = (ServiceEngine)Activator.CreateInstance(typeof(ServiceEngine), BindingFlags.NonPublic | BindingFlags.Instance, null, new object[] { options, log, Dispatcher, server }, null)!;
            Run = engine.RunAsync(Lifetime.Token);
        }
        internal async Task<JsonElement> Request(string operation, object? payload = null)
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            await pipe.ConnectAsync(deadline.Token);
            string requestId = "own:" + Guid.NewGuid().ToString("N");
            byte[] body = JsonSerializer.SerializeToUtf8Bytes(new { protocolVersion = 1, requestId, operation, payload = payload ?? new { } });
            await pipe.WriteAsync(body, deadline.Token); await pipe.WriteAsync(new byte[] { 10 }, deadline.Token); await pipe.FlushAsync(deadline.Token);
            using var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 4096, true);
            string line = await reader.ReadLineAsync(deadline.Token) ?? throw new Exception("missing native pipe response");
            using var json = JsonDocument.Parse(line); return json.RootElement.Clone();
        }
        internal void RetireOwnMarker(string relative) => File.Delete(Path.Combine(Root, "installer", relative));
        public async ValueTask DisposeAsync()
        {
            if (Disposed) return; Disposed = true;
            Lifetime.Cancel();
            try { await Run.WaitAsync(TimeSpan.FromSeconds(4)); } catch (OperationCanceledException) { }
            Lifetime.Dispose();
        }
    }
    private static void Require(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static string? Error(JsonElement reply) => reply.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.Object ? error.GetProperty("code").GetString() : null;
    private static async Task Check(string name, Func<Task> run) { try { await run(); Passed++; Console.WriteLine("PASS: " + name); } catch (Exception error) { Failed++; Console.WriteLine("FAIL: " + name + " -> " + error); } }
    private static async Task<int> Main(string[] args)
    {
        if (args is not ["--work", var root] || !Path.IsPathFullyQualified(root)) throw new ArgumentException("--work <absolute own task path>");
        Work = root; Directory.CreateDirectory(Work);
        foreach (string marker in new[] { "service-maintenance.json", Path.Combine("service-backup", "manifest.json") })
            await Check("authenticated native hello remains reachable while own marker " + marker + " blocks changes", async () => {
                await using var f = new Fixture(marker);
                var hello = await f.Request("hello"); Require(hello.GetProperty("ok").GetBoolean(), "hello blocked before creating pipe");
                var persistence = hello.GetProperty("result").GetProperty("persistence");
                Require(persistence.GetProperty("installerMaintenance").GetProperty("active").GetBoolean() && persistence.GetProperty("startupPending").GetBoolean() && !persistence.GetProperty("mutationReady").GetBoolean(), "maintenance/startup readiness was misreported");
                var query = await f.Request("component.query", new { component = "SystemDoH", method = "status", args = Array.Empty<object>() });
                var mutation = await f.Request("component.execute", new { component = "SystemDoH", method = "apply", args = new[] { "https://fixture.invalid/dns-query" } });
                Require(Error(query) == "INSTALLER_MAINTENANCE" && Error(mutation) == "INSTALLER_MAINTENANCE" && f.Executions == 0, "maintenance permitted worker activity");
                f.IdentityProbe = true; Require((await f.Request("hello")).GetProperty("ok").GetBoolean(), "identity probe hello failed");
                Require(Error(await f.Request("service.status")) == "IDENTITY_PROBE_SCOPE", "identity probe gained interactive authority"); f.IdentityProbe = false;
                f.Reject = true; Require(Error(await f.Request("hello")) == "CLIENT_NOT_AUTHORIZED", "authorization rejection changed"); f.Reject = false;
                f.RetireOwnMarker(marker);
                using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                while ((await f.Request("hello")).GetProperty("result").GetProperty("persistence").GetProperty("startupPending").GetBoolean()) await Task.Delay(30, deadline.Token);
                var ready = await f.Request("component.execute", new { component = "SystemDoH", method = "apply", args = new[] { "https://fixture.invalid/dns-query" } });
                Require(ready.GetProperty("ok").GetBoolean() && f.Executions == 1, "verified marker retirement did not release the existing guarded executor");
            });
        await Check("shutdown during indefinite maintenance cancels the listener and startup tasks", async () => {
            await using var f = new Fixture("service-maintenance.json"); Require((await f.Request("hello")).GetProperty("ok").GetBoolean(), "listener unavailable before cancel");
            await f.DisposeAsync(); Require(f.Run.IsCompleted && f.Executions == 0, "service shutdown left listener/startup work alive");
            using var deadline = new CancellationTokenSource(TimeSpan.FromMilliseconds(300)); await using var pipe = new NamedPipeClientStream(".", f.PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            try { await pipe.ConnectAsync(deadline.Token); throw new Exception("retired listener still accepts connections"); } catch (OperationCanceledException) { }
        });
        Console.WriteLine($"Core identity maintenance: passed={Passed}, failed={Failed}; actualUniqueNamedPipe=true; realScmWrites=false; realDnsWrites=false");
        return Failed == 0 ? 0 : 1;
    }
}