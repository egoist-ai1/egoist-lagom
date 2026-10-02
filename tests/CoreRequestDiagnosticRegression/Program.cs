using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using EgoistShield.Service;

namespace CoreRequestDiagnosticRegression;
internal static class Program
{
 private static string Work = "";
 private static int Passed, Failed, Assertions;
 private const string Secret = "DISPATCHER_PRIVATE_DOH_SENTINEL";
 private static readonly string PrivateUrl = "https://private.invalid:8443/dns-query/" + Secret + "?token=" + Secret;
 private static readonly ClientIdentity Identity = new(Environment.ProcessId, Environment.ProcessPath!, true, "isolated-request-diagnostic-test");
 private sealed class Fixture : IDisposable
 {
  internal readonly string Root;
  internal readonly ServiceLog Log;
  internal readonly OperationDispatcher Dispatcher;
  internal int WorkerCalls;
  internal Exception? WorkerFailure;
  internal int WorkerDelayMs;
  internal Fixture()
  {
   Root = Path.Combine(Work, "dispatcher-diagnostic-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(Root);
   Task<ProcessResult> Forbidden(string script, CancellationToken token) => throw new Exception("SCM/DNS/registry not authorized in this fixture");
   Log = new ServiceLog(Root);
   Dispatcher = new(new ServiceOptions("unused", Root, true, true, null), new WindowsDnsController(Forbidden), new WindowsNativeDohController(Root, Forbidden),
    null, new TransactionJournal(Root), Log, componentExecutor: async (payload, query, token) => {
     token.ThrowIfCancellationRequested(); WorkerCalls++;
     if (WorkerDelayMs > 0) await Task.Delay(WorkerDelayMs, token);
     if (WorkerFailure != null) throw WorkerFailure;
     return JsonDefaults.ToElement(new { controlled = true, query });
    });
  }
  internal Task<ServiceResponse> Run(ServiceRequest request, CancellationToken token = default) => Dispatcher.DispatchAsync(request, Identity, token);
  internal string LogFile => Path.Combine(Root, "service.log");
  internal List<(JsonElement Event, JsonElement Context)> ReadEvents()
  {
   var rows = new List<(JsonElement Event, JsonElement Context)>();
   if (!File.Exists(LogFile)) return rows;
   foreach (string line in File.ReadLines(LogFile))
   {
    int eventStart = line.IndexOf("[diagnostic-event] ", StringComparison.Ordinal), contextStart = line.IndexOf("\t[context] ", StringComparison.Ordinal);
    if (eventStart < 0 || contextStart < 0) continue;
    using var entry = JsonDocument.Parse(line[(eventStart + "[diagnostic-event] ".Length)..contextStart]);
    using var context = JsonDocument.Parse(line[(contextStart + "\t[context] ".Length)..]);
    rows.Add((entry.RootElement.Clone(), context.RootElement.Clone()));
   }
   return rows;
  }
  public void Dispose() { Dispatcher.Dispose(); }
 }
 private static ServiceRequest Component(string method, bool query = false, string? id = null, string component = "SystemDoH", object[]? args = null)
  => new(1, id ?? Guid.NewGuid().ToString("N"), query ? "component.query" : "component.execute", JsonDefaults.ToElement(new { component, method, args = args ?? [] }));
 private static void Require(bool condition, string label) { Assertions++; if (!condition) throw new Exception(label); }
 private static async Task Check(string name, Func<Task> action)
 { try { await action(); Passed++; Console.WriteLine("PASS: " + name); } catch (Exception error) { Failed++; Console.WriteLine("FAIL: " + name + " -> " + error); } }
 private static async Task<int> Main(string[] args)
 {
  if (args is not ["--work", var selected] || !Path.IsPathFullyQualified(selected)) throw new ArgumentException("--work <absolute own task work>");
  Work = selected; Directory.CreateDirectory(Work);
  await Check("actual mutation records start/completion and SHA24 request correlation", async () => {
   using var f = new Fixture(); string requestId = Guid.NewGuid().ToString(); var request = Component("apply", id: requestId, args: [PrivateUrl]);
   var response = await f.Run(request); Require(response.Ok && f.WorkerCalls == 1, "Controlled component mutation failed");
   var events = f.ReadEvents(); Require(events.Count == 2, "Start/completion missing or poll telemetry flood");
   Require(events[0].Event.GetProperty("stage").GetString() == "request.started" && events[1].Event.GetProperty("stage").GetString() == "request.completed", "Incorrect request stage order");
   string expected = "id-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(requestId))).ToLowerInvariant()[..24];
   foreach (var row in events) {
    var scope = row.Context.GetProperty("scope"); Require(scope.GetProperty("requestIdHash").GetString() == expected, "SHA24 scope correlation differs");
    Require(scope.GetProperty("clientPid").GetInt32() == Environment.ProcessId && scope.GetProperty("actor").GetString() == "development-client", "Actor/PID scope missing");
    Require(scope.GetProperty("operation").GetString() == "component.execute" && scope.GetProperty("component").GetString() == "SystemDoH" && scope.GetProperty("method").GetString() == "apply", "Safe operation/component/method missing");
   }
   var completed = events[1].Event.GetProperty("fields"); Require(completed.GetProperty("ok").GetBoolean() && completed.GetProperty("Sequence").GetInt64() == response.Sequence && completed.GetProperty("elapsedMs").GetInt64() >= 0, "Completion not tied to actual response");
   Require(!File.ReadAllText(f.LogFile).Contains(Secret) && !File.ReadAllText(f.LogFile).Contains(requestId), "Private argument/request ID leaked");
  });
  await Check("retry same mutation logs the same request hash and returns original durable response", async () => {
   using var f = new Fixture(); var request = Component("apply", args: [PrivateUrl]); var first = await f.Run(request); var retry = await f.Run(request);
   Require(first.Ok && retry == first && f.WorkerCalls == 1, "Diagnostic retry replayed mutation/changed original response");
   var hashes = f.ReadEvents().Select(row => row.Context.GetProperty("scope").GetProperty("requestIdHash").GetString()).Distinct().ToArray();
   Require(hashes.Length == 1 && f.ReadEvents().Count == 4, "Retries cannot be correlated");
  });
  await Check("failed query logs completion code/retryability without successful-query pollution", async () => {
   using var f = new Fixture(); Require((await f.Run(Component("status", query: true))).Ok && f.ReadEvents().Count == 0, "Healthy polling polluted journal");
   f.WorkerFailure = new TimeoutException("Controlled TLS/HTTP phase timeout " + PrivateUrl); var response = await f.Run(Component("status", query: true));
   Require(!response.Ok && response.Error?.Code == "OPERATION_TIMEOUT" && response.Error.Retryable, "Failure response changed");
   var events = f.ReadEvents(); Require(events.Count == 1 && events[0].Event.GetProperty("stage").GetString() == "request.completed", "Failed query completion missing");
   var fields = events[0].Event.GetProperty("fields"); Require(!fields.GetProperty("mutation").GetBoolean() && !fields.GetProperty("ok").GetBoolean() && fields.GetProperty("code").GetString() == response.Error.Code && fields.GetProperty("retryable").GetBoolean(), "Error code/retryability not connected to query");
   string phaseMessage = fields.GetProperty("message").GetString() ?? "";
   Require(phaseMessage.Contains("TLS/HTTP phase timeout") && phaseMessage.Contains("private.invalid:8443") && !phaseMessage.Contains(Secret), "Safe completion error message lost TLS/HTTP phase or leaked private URI");
   Require(!File.ReadAllText(f.LogFile).Contains(Secret), "Failed query diagnostic leaked private URI");
  });
  await Check("safe component/method projection conceals URLs and ignores oversized/non-string values", async () => {
   using var f = new Fixture(); var request = Component(PrivateUrl, component: PrivateUrl, args: [PrivateUrl, new { token = Secret }]); var response = await f.Run(request);
   Require(!response.Ok && response.Error?.Code == "INVALID_PAYLOAD" && f.WorkerCalls == 0, "Invalid mutation name acquired execution authority"); string text = File.ReadAllText(f.LogFile);
   Require(!text.Contains(Secret) && text.Contains("redacted-path"), "Projected metadata leaked private URL or argument");
   var oversized = Component(new string('x', 161), query: true, component: new string('y', 161));
   f.WorkerFailure = new TimeoutException("controlled oversized query");
   Require(!(await f.Run(oversized)).Ok, "Controlled oversized query failure unexpectedly changed");
   f.WorkerFailure = null;
   var scope = f.ReadEvents().Last().Context.GetProperty("scope"); Require(scope.GetProperty("component").ValueKind == JsonValueKind.Null && scope.GetProperty("method").ValueKind == JsonValueKind.Null, "Oversized safe diagnostic names reflected");
   var malformed = new ServiceRequest(1, Guid.NewGuid().ToString("N"), "component.query", JsonDefaults.ToElement(new { component = 7, method = true, args = new object[] { PrivateUrl } }));
   var failure = await f.Run(malformed); Require(!failure.Ok && !File.ReadAllText(f.LogFile).Contains(Secret), "Non-string field altered/leaked query failure");
  });
  await Check("locked log preserves actual mutation and failed-query response in bounded time", async () => {
   using var f = new Fixture(); await f.Log.InfoAsync("fixture"); using var held = new FileStream(f.LogFile, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
   var clock = Stopwatch.StartNew(); var response = await f.Run(Component("apply", args: [PrivateUrl]));
   Require(response.Ok && f.WorkerCalls == 1 && clock.Elapsed < TimeSpan.FromSeconds(2), "Log viewer lock changed/delayed actual mutation");
   f.WorkerFailure = new ServiceOperationException("CONTROLLED_QUERY_FAILURE", "private failure " + PrivateUrl, retryable: true);
   var query = await f.Run(Component("status", query: true)); Require(!query.Ok && query.Error?.Code == "CONTROLLED_QUERY_FAILURE" && query.Error.Retryable, "Locked diagnostic substituted original query response");
  });
  await Check("unavailable log directory preserves durable mutation and cancellation", async () => {
   using var f = new Fixture(); Directory.CreateDirectory(f.LogFile); var response = await f.Run(Component("apply", args: [PrivateUrl]));
   Require(response.Ok && f.WorkerCalls == 1, "Unavailable log changed mutation");
   using var cancelled = new CancellationTokenSource(); cancelled.Cancel(); bool propagated = false;
   try { await f.Run(Component("apply"), cancelled.Token); } catch (OperationCanceledException) { propagated = true; }
   Require(propagated && f.WorkerCalls == 1, "Precancelled request lost cancellation/ran component");
  });
  await Check("blocked diagnostic writer honors per-event deadline and original request cancellation", async () => {
   using var f = new Fixture(); var field = typeof(ServiceLog).GetField("_writeLock", BindingFlags.Instance | BindingFlags.NonPublic) ?? throw new Exception("Actual writer lock not present");
   var gate = (SemaphoreSlim)field.GetValue(f.Log)!; await gate.WaitAsync();
   try {
    var clock = Stopwatch.StartNew(); var response = await f.Run(Component("apply", args: [PrivateUrl]));
    Require(response.Ok && f.WorkerCalls == 1, "Timed-out diagnostic altered mutation response");
    Require(clock.Elapsed >= TimeSpan.FromMilliseconds(800) && clock.Elapsed < TimeSpan.FromSeconds(2), "Diagnostic per-event 500 ms limit is unbounded/not exercised");
    using var cancelled = new CancellationTokenSource(TimeSpan.FromMilliseconds(50)); bool propagated = false; clock.Restart();
    try { await f.Run(Component("apply"), cancelled.Token); } catch (OperationCanceledException) { propagated = true; }
    Require(propagated && f.WorkerCalls == 1 && clock.Elapsed < TimeSpan.FromSeconds(2), "Diagnostic lock swallowed/delayed request cancellation beyond budget");
   } finally { gate.Release(); }
  });
  Console.WriteLine(JsonSerializer.Serialize(new { kind = "actual-dispatcher-request-diagnostic-regression", passed = Passed, failed = Failed, assertions = Assertions, realScmWrites = false, realDnsWrites = false, actualSources = true }));
  return Failed == 0 ? 0 : 1;
 }
}
