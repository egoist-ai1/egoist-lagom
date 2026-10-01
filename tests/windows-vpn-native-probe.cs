using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// This child has no service, route, DNS, proxy or privilege APIs. The native gate
// gives only its exact executable name a production process rule. It dials a
// fixed synthetic IP with plain TCP; local self-test uses only fixed loopback.
internal static class Program
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    private static async Task<int> Main(string[] args)
    {
        if (args.Length != 4 || args[0] is not ("--probe" or "--loopback-probe") ||
            !Regex.IsMatch(args[1], "^[a-f0-9]{48}$") || !Regex.IsMatch(args[2], "^[a-f0-9]{48}$") || !Path.IsPathFullyQualified(args[3]))
        { Console.Error.WriteLine("Use --probe|--loopback-probe nonce fixtureInstance ownReceiptPath."); return 2; }
        string nonce = args[1], instance = args[2], receiptPath = Path.GetFullPath(args[3]);
        string host = args[0] == "--probe" ? "198.18.0.254" : "127.0.0.1";
        var watch = Stopwatch.StartNew();
        try
        {
            if (File.Exists(receiptPath) || File.Exists(receiptPath + ".release")) throw new IOException("A probe receipt or release already exists.");
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(12));
            using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
            await socket.ConnectAsync(new IPEndPoint(IPAddress.Parse(host), 19080), deadline.Token);
            using var stream = new NetworkStream(socket, ownsSocket: false);
            byte[] request = Encoding.ASCII.GetBytes($"GET /nonce/{nonce} HTTP/1.1\r\nHost: 198.18.0.254:19080\r\nConnection: keep-alive\r\n\r\n");
            await stream.WriteAsync(request, deadline.Token);
            var bytes = new List<byte>(); int headerEnd = -1, bodyLength = -1; byte[] buffer = new byte[1024];
            while (headerEnd < 0 || bytes.Count < headerEnd + bodyLength)
            {
                int read = await stream.ReadAsync(buffer, deadline.Token);
                if (read == 0) throw new IOException("Nonce endpoint ended early.");
                bytes.AddRange(buffer.AsSpan(0, read).ToArray()); if (bytes.Count > 16384) throw new IOException("Oversized HTTP response.");
                if (headerEnd < 0)
                {
                    string text = Encoding.ASCII.GetString(bytes.ToArray()); int boundary = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                    if (boundary >= 0)
                    {
                        if (!text.StartsWith("HTTP/1.1 200 OK\r\n", StringComparison.Ordinal)) throw new IOException("Unexpected HTTP status.");
                        var length = Regex.Match(text[..boundary], "(?:^|\r\n)Content-Length: ([0-9]{1,4})(?:\r\n|$)");
                        if (!length.Success || !int.TryParse(length.Groups[1].Value, out bodyLength) || bodyLength is < 1 or > 4096) throw new IOException("Invalid response length.");
                        headerEnd = boundary + 4;
                    }
                }
            }
            byte[] body = bytes.Skip(headerEnd).Take(bodyLength).ToArray();
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.GetProperty("nonce").GetString() != nonce || document.RootElement.GetProperty("fixtureInstance").GetString() != instance)
                throw new IOException("Nonce or fixture generation mismatch.");
            var proof = new { schemaVersion = 1, kind = "actual-plain-tcp-nonce-probe", stage = "observed", processId = Environment.ProcessId,
                processName = Path.GetFileName(Environment.ProcessPath), startedAt = Process.GetCurrentProcess().StartTime.ToUniversalTime(),
                targetAddress = host, targetPort = 19080, socketLocal = socket.LocalEndPoint?.ToString(), socketRemote = socket.RemoteEndPoint?.ToString(),
                proxyConfigured = false, nonce, fixtureInstance = instance, responseSha256 = Convert.ToHexString(SHA256.HashData(body)).ToLowerInvariant(),
                elapsedMs = watch.ElapsedMilliseconds, actualTunClaim = false };
            await File.WriteAllTextAsync(receiptPath, JsonSerializer.Serialize(proof, Json), new UTF8Encoding(false), deadline.Token);
            // Retain the real flow briefly so the parent can independently read
            // its OS socket owner and the sing-box→fixture socket owner.
            var retained = Stopwatch.StartNew(); bool released = false;
            while (retained.Elapsed.TotalSeconds < 8)
            {
                if (File.Exists(receiptPath + ".release") && await File.ReadAllTextAsync(receiptPath + ".release") == "release:" + nonce) { released = true; break; }
                await Task.Delay(50);
            }
            if (!released) throw new IOException("Probe was not acknowledged within the socket observation window.");
            Console.WriteLine(JsonSerializer.Serialize(new { ok = true, processId = Environment.ProcessId, nonce, fixtureInstance = instance, released }, Json));
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(JsonSerializer.Serialize(new { ok = false, processId = Environment.ProcessId, nonce, targetAddress = host,
                elapsedMs = watch.ElapsedMilliseconds, error = error.Message }, Json));
            return 1;
        }
    }
}
