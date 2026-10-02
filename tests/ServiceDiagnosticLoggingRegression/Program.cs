using System.Text.Json;
using EgoistShield.Service;

string parent = Environment.GetEnvironmentVariable("LAGOM_TEST_TEMP") ?? throw new Exception("Set an owned LAGOM_TEST_TEMP.");
string root = Path.Combine(parent, "native-diagnostic-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
int checks = 0;
void Check(bool condition, string label) { if (!condition) throw new Exception(label); checks++; }
const string secret = "NATIVE_PRIVATE_DOH_SENTINEL";
string url = "https://name:pass@private.invalid:8443/dns-query/" + secret + "?token=" + secret;
try
{
    string safe = ServiceDiagnosticRedaction.Text("upstream failed " + url + "\nAuthorization: Bearer " + secret + "\nCookie: token=" + secret);
    Check(!safe.Contains(secret) && safe.Contains("private.invalid:8443") && safe.Contains("upstream failed"), "URL credentials/path/query headers must be safe with useful stage retained");
    Check(!ServiceDiagnosticRedaction.Text(secret + "\n-----END PRIVATE KEY-----").Contains(secret), "Orphan PEM tail leaked");
    Check(!ServiceDiagnosticRedaction.Text("-----BEGIN PRIVATE KEY-----\n" + secret).Contains(secret), "Unclosed PEM leaked");
    string nested = JsonSerializer.Serialize(ServiceDiagnosticRedaction.Value(new Exception("DoH " + url, new IOException("TLS " + url))));
    Check(!nested.Contains(secret) && nested.Contains("IOException") && nested.Contains("TLS"), "Nested causal chain missing/redaction failed");
    string request = Guid.NewGuid().ToString();
    Check(ServiceDiagnosticRedaction.Correlation(request) == ServiceDiagnosticRedaction.Correlation(request) && ServiceDiagnosticRedaction.Correlation(request) != ServiceDiagnosticRedaction.Correlation(Guid.NewGuid().ToString()), "Retries/different requests lost identity");
    var log = new ServiceLog(root);
    using (log.BeginScope(new { actor = "gui", requestIdHash = ServiceDiagnosticRedaction.Correlation(request), operation = "component.execute", component = "SystemDoH", method = "apply", rawPayload = secret }))
    {
        await log.InfoAsync("DNS error " + url + "\r\nsecond-line");
        await Task.WhenAll(Enumerable.Range(0, 12).Select(index => log.EventAsync("WARN", "doh-probe", new { attempt = index }, new IOException("TLS failed " + url))));
    }
    await log.InfoAsync("outside scope");
    string file = Path.Combine(root, "service.log");
    string[] lines = await File.ReadAllLinesAsync(file);
    Check(lines.Length == 14, "Concurrent/event/newline writes were split or lost");
    Check(lines.All(line => !line.Contains(secret)), "Secret escaped actual written log");
    var contexts = lines.Select(line => JsonDocument.Parse(line[(line.IndexOf("[context] ", StringComparison.Ordinal) + 10)..])).ToArray();
    Check(contexts.Select(c => c.RootElement.GetProperty("sessionId").GetString()).Distinct().Count() == 1, "Session changed between writes");
    Check(contexts.Select(c => c.RootElement.GetProperty("sequence").GetInt64()).Distinct().Count() == 14, "Write sequence repeated");
    Check(contexts.Take(13).All(c => c.RootElement.GetProperty("scope").GetProperty("requestIdHash").GetString() == ServiceDiagnosticRedaction.Correlation(request)), "Async request scope lost");
    Check(contexts.Last().RootElement.GetProperty("scope").ValueKind == JsonValueKind.Null, "Scope leaked to unrelated action");
    Check(contexts.All(c => c.RootElement.GetProperty("localTimestamp").GetDateTimeOffset().Offset == DateTimeOffset.Now.Offset && c.RootElement.GetProperty("pid").GetInt32() == Environment.ProcessId), "Timezone/own PID context missing");
    foreach (var c in contexts) c.Dispose();
    await log.EventAsync("INFO", "large-event", new { description = new string('ж', 20000) });
    string eventLine = File.ReadLines(file).Last();
    int begin = eventLine.IndexOf("[diagnostic-event] ", StringComparison.Ordinal) + "[diagnostic-event] ".Length;
    using (var large = JsonDocument.Parse(eventLine[begin..eventLine.IndexOf("\t[context]", StringComparison.Ordinal)]))
    { Check(large.RootElement.GetProperty("truncated").GetBoolean(), "Oversized event lost valid structured JSON"); }
    await log.EventAsync("INFO", "unserializable-event", new { invalidNumber = double.NaN });
    Check(File.ReadLines(file).Last().Contains("unserializable-event"), "Unexpected diagnostic value escaped as operation failure");
    for (int index = 0; index < 6; index++)
    {
        await File.WriteAllTextAsync(file, new string('x', (int)ServiceLog.RotationBytes));
        await log.InfoAsync("rotation " + index + " русское событие");
    }
    Check(Directory.GetFiles(root, "service.log*").Length == 4, "Rotation did not remain bounded to current + 3 segments");
    Check((await File.ReadAllTextAsync(file)).Contains("русское событие"), "UTF-8 lost");
    using (var held = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
    { await log.InfoAsync("locked diagnostic must not fail network mutation"); }
    await log.InfoAsync("after lock");
    Check((await File.ReadAllTextAsync(file)).Contains("after lock"), "Logger did not recover after viewer lock");
    Console.WriteLine(JsonSerializer.Serialize(new { kind = "actual-native-service-diagnostic-logging", result = "passed", checks, networkMutations = 0 }));
}
finally { Directory.Delete(root, true); }

namespace EgoistShield.Service
{
    // Harness only: filesystem ACL policy is covered by existing native tests.
    internal static class ProtectedProductRoot
    {
        internal static void AssertFileWriteAllowed(string target)
        {
            string root = Path.GetFullPath(Environment.GetEnvironmentVariable("LAGOM_TEST_TEMP")!);
            if (!Path.GetFullPath(target).StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("Fixture escaped owned root.");
        }
        internal static FileStream CreateStateFileStream(string path, FileMode mode, int bufferSize, FileOptions options, FileShare share)
        { AssertFileWriteAllowed(path); return new FileStream(path, mode, FileAccess.Write, share, bufferSize, options); }
    }
}
