using System.Buffers.Binary;
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using EgoistShield.Service;

internal static class Program
{
    private const string Name = "EgoistShieldSystemDoH";
    private const string Endpoint = "https://resolver.example:8443/private/profile?tenant=fixture";
    private static string _work = "";
    private static int _passed;
    private static void Assert(bool ok, string why) { if (!ok) throw new InvalidOperationException(why); }
    private static async Task Check(string name, Func<Task> run) { await run(); _passed++; Console.WriteLine("PASS: " + name); }
    private static async Task ExpectCancellation(Func<Task> run)
    { try { await run(); } catch (OperationCanceledException) { return; } throw new InvalidOperationException("External cancellation was swallowed."); }

    private static async Task<int> Main(string[] args)
    {
        int i = Array.IndexOf(args, "--work");
        if (i < 0 || i + 1 >= args.Length || !Path.IsPathFullyQualified(args[i + 1])) throw new ArgumentException("Use --work <absolute task work path>.");
        _work = Path.Combine(args[i + 1], "doh-upstream-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(_work);
        var clock = Stopwatch.StartNew();
        try
        {
            await Check("SystemDoH final current health recheck defeats healthy/unknown recovery race", FinalRecoveryRecheckAsync);
            await Check("Stop/Disabled/new recovery during final DoH comparison prevents recovery", FinalIntentRaceAsync);
            await Check("exact saved HTTPS profile, IPv4 bootstrap and local config must match", ConfigurationAsync);
            await Check("owned bounded state/config reads and generation race preserve DNS", OwnedGenerationAsync);
            await Check("reserved health stays alive while real local SERVFAIL recovers only when exact upstream works", DistinguishLocalPathAsync);
            await Check("fresh DNS identity/questions and complete bounded wire responses", PacketValidationAsync);
            await Check("local truncated UDP answer uses bounded TCP transport", TruncatedTcpAsync);
            await Check("HTTPS invalid status, content type, IDs, RCODE, lengths and slow bodies remain unknown", RemoteValidationAsync);
            await Check("HTTP1-only upstream cannot justify restarting an HTTP2-only Xray resolver", RemoteProtocolParityAsync);
            await Check("local deadline and external cancellation retire outstanding sockets/HTTP streams", DeadlinesAsync);
            await Check("HTTPS handler never redirects, proxies, resolves other hosts or bypasses TLS", PinnedTransportAsync);
            Console.WriteLine($"SystemDoH upstream recovery regression passed: {_passed} groups; elapsed={clock.Elapsed.TotalSeconds:0.00}s; runtime={System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}"); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }

    private static async Task FinalRecoveryRecheckAsync()
    {
        foreach (var finalHealth in new[] { LocalServiceHealth.Responsive, LocalServiceHealth.Unknown, LocalServiceHealth.Unresponsive })
        {
            var store = new OwnedServiceIntentStore(Path.Combine(_work, Guid.NewGuid().ToString("N"))); await store.SetRunningAsync(Name, true, default);
            TimeSpan now = TimeSpan.FromSeconds(60); int probes = 0, restarts = 0;
            OwnedServiceSupervisor Create() => new(store,
                (name, _) => Task.FromResult(name == Name ? new OwnedServiceStatus(name, "running", "auto", true) : new(name, "not-installed", "not-installed", false)),
                (_, _) => Task.CompletedTask,
                (_, _) => Task.FromResult(++probes >= 3 ? finalHealth : LocalServiceHealth.Unresponsive),
                (_, _, _) => { restarts++; return Task.CompletedTask; }, _ => Task.CompletedTask, () => true,
                () => now, () => DateTimeOffset.Parse("2026-10-02T00:00:00Z") + now);
            var supervisor = Create();
            for (int step = 0; step < 2; step++) { now = TimeSpan.FromSeconds(60 + step * 15); await supervisor.CheckAsync(default); }
            Assert(probes == 3 && restarts == (finalHealth == LocalServiceHealth.Unresponsive ? 1 : 0), "SystemDoH was recovered without current local/upstream recheck: probes/restarts=" + probes + "/" + restarts);
            if (finalHealth == LocalServiceHealth.Unresponsive)
            {
                supervisor = Create();
                for (int step = 0; step < 2; step++) { now = TimeSpan.FromSeconds(100 + step * 15); await supervisor.CheckAsync(default); }
                Assert(restarts == 1, "Persisted restart backoff was erased by Core recreation.");
            }
        }
    }

    private static async Task FinalIntentRaceAsync()
    {
        foreach (string race in new[] { "stop", "disabled", "newer-recovery" })
        {
            var store = new OwnedServiceIntentStore(Path.Combine(_work, "final-" + race)); await store.SetRunningAsync(Name, true, default);
            TimeSpan now = TimeSpan.FromSeconds(60); int probes = 0, restarts = 0; string startType = "auto";
            DateTimeOffset Utc() => DateTimeOffset.Parse("2026-10-02T00:00:00Z") + now;
            var supervisor = new OwnedServiceSupervisor(store,
                (name, _) => Task.FromResult(name == Name ? new OwnedServiceStatus(name, "running", startType, true) : new(name, "not-installed", "not-installed", false)),
                (_, _) => Task.CompletedTask,
                async (_, token) => { if (++probes == 3) { if (race == "stop") await store.SetRunningAsync(Name, false, token); else if (race == "disabled") startType = "disabled"; else await store.MarkRecoveryAsync(Name, Utc(), token); } return LocalServiceHealth.Unresponsive; },
                (_, _, _) => { restarts++; return Task.CompletedTask; }, _ => Task.CompletedTask, () => true, () => now, Utc);
            for (int step = 0; step < 2; step++) { now = TimeSpan.FromSeconds(60 + step * 15); await supervisor.CheckAsync(default); }
            Assert(probes == 3 && restarts == 0, "Final DoH probe overwrote newer " + race + " intent/state.");
        }
    }
    private static (JsonElement State, JsonElement Runtime) Documents(string url = Endpoint, string bootstrap = "192.0.2.53", int port = 53) => (
        JsonSerializer.SerializeToElement(new { url, localAddress = "127.0.0.1", localPort = port }),
        JsonSerializer.SerializeToElement(new { dns = new { tag = "doh-upstream", hosts = new Dictionary<string, string[]> { ["health.egoist.invalid"] = new[] { "127.0.0.1" }, ["resolver.example"] = new[] { bootstrap } }, servers = new[] { new { address = url, timeoutMs = 2500 } } },
            inbounds = new[] { new { tag = "dns-in", listen = "127.0.0.1", port, protocol = "dokodemo-door", settings = new { network = "tcp,udp" } } } }));

    private static Task ConfigurationAsync()
    {
        var documents = Documents();
        Assert(SystemDohServiceHealthProbe.TryReadConfiguration(documents.State, documents.Runtime, out var config) && config!.Endpoint.AbsoluteUri == Endpoint && config.Bootstrap.Single().ToString() == "192.0.2.53", "Configured URI/profile/bootstrap was changed.");
        foreach (string invalid in new[] { "http://resolver.example/dns-query", "https://user:password@resolver.example/dns-query", "https://resolver.example/dns-query#ignored", "https://resolver.example:65536/dns-query", "https://resolver.example/" + new string('x', 4096) })
            Assert(!SystemDohServiceHealthProbe.TryEndpoint(invalid, out _), "Unsafe/malformed HTTPS URI was accepted.");
        foreach (string invalid in new[] { "::1", "invalid", "0.0.0.0", "255.255.255.255", "224.0.0.1", "192.53", "192.0.2.053" })
        { var bad = Documents(bootstrap: invalid); Assert(!SystemDohServiceHealthProbe.TryReadConfiguration(bad.State, bad.Runtime, out _), "Invalid/non-IPv4 bootstrap authorized recovery."); }
        var mismatch = Documents(Endpoint + "-other");
        Assert(!SystemDohServiceHealthProbe.TryReadConfiguration(documents.State, mismatch.Runtime, out _), "A changed saved endpoint profile was accepted.");
        foreach (string needle in new[] { "doh-upstream", "dns-in", "dokodemo-door", "tcp,udp", "health.egoist.invalid" })
        {
            using var changed = JsonDocument.Parse(documents.Runtime.GetRawText().Replace(needle, needle + "-other"));
            Assert(!SystemDohServiceHealthProbe.TryReadConfiguration(documents.State, changed.RootElement, out _), "Mismatched owned runtime marker was accepted: " + needle);
        }
        using var wrongPort = JsonDocument.Parse(documents.State.GetRawText().Replace("\"localPort\":53", "\"localPort\":54"));
        Assert(!SystemDohServiceHealthProbe.TryReadConfiguration(wrongPort.RootElement, documents.Runtime, out _), "Changed local endpoint was accepted.");
        using var malformedPort = JsonDocument.Parse(documents.State.GetRawText().Replace("\"localPort\":53", "\"localPort\":\"53\""));
        Assert(!SystemDohServiceHealthProbe.TryReadConfiguration(malformedPort.RootElement, documents.Runtime, out _), "Non-numeric local port was not rejected safely.");
        return Task.CompletedTask;
    }

    private static async Task OwnedGenerationAsync()
    {
        string root = Path.Combine(_work, "owned-runtime"); string folder = Path.Combine(root, "Runtime", "SystemDoH"); Directory.CreateDirectory(folder);
        string statePath = Path.Combine(folder, "state.json"), configPath = Path.Combine(folder, "config.json");
        bool mutate = false;
        await using var local = new DnsFixture(query => { if (mutate) File.WriteAllText(configPath, File.ReadAllText(configPath).Replace("timeoutMs\":2500", "timeoutMs\":2600")); return Answer(query, 3); });
        var documents = Documents(port: local.Port);
        async Task Write() { await File.WriteAllTextAsync(statePath, documents.State.GetRawText()); await File.WriteAllTextAsync(configPath, documents.Runtime.GetRawText()); }
        await Write();
        Assert(await SystemDohServiceHealthProbe.ProbeOwnedAsync(root, default) == LocalServiceHealth.Responsive, "Owned complete healthy runtime was rejected.");
        mutate = true;
        Assert(await SystemDohServiceHealthProbe.ProbeOwnedAsync(root, default) == LocalServiceHealth.Unknown, "A changed runtime generation authorized recovery.");
        mutate = false; await Write();
        await File.WriteAllTextAsync(statePath, "{\"localPort\":\"invalid\"}");
        Assert(await SystemDohServiceHealthProbe.ProbeOwnedAsync(root, default) == LocalServiceHealth.Unknown, "Malformed owned state was treated as recoverable failure.");
        await Write(); await File.WriteAllTextAsync(configPath, "{" + new string(' ', SystemDohServiceHealthProbe.MaxConfigurationBytes) + "}");
        Assert(await SystemDohServiceHealthProbe.ProbeOwnedAsync(root, default) == LocalServiceHealth.Unknown, "Oversized runtime config authorized recovery.");
        await Write(); await File.WriteAllTextAsync(configPath, "{");
        Assert(await SystemDohServiceHealthProbe.ProbeOwnedAsync(root, default) == LocalServiceHealth.Unknown, "Corrupt owned runtime config authorized recovery.");
    }
    private sealed class DnsFixture : IAsyncDisposable
    {
        internal readonly UdpClient Udp = new(new IPEndPoint(IPAddress.Loopback, 0));
        internal int Port => ((IPEndPoint)Udp.Client.LocalEndPoint!).Port;
        internal readonly List<byte[]> Queries = new();
        private readonly CancellationTokenSource _stop = new();
        private readonly Task _read;
        internal DnsFixture(Func<byte[], byte[]?> answer)
        {
            _read = Task.Run(async () =>
            {
                try { while (true) { var request = await Udp.ReceiveAsync(_stop.Token); lock (Queries) Queries.Add(request.Buffer); var response = answer(request.Buffer); if (response != null) await Udp.SendAsync(response, request.RemoteEndPoint, _stop.Token); } }
                catch (Exception error) when (error is OperationCanceledException or SocketException or ObjectDisposedException) { }
            });
        }
        public async ValueTask DisposeAsync() { _stop.Cancel(); Udp.Dispose(); await _read; _stop.Dispose(); }
    }
    private sealed class FakeHttpHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => reply(request, token);
    }
    private static HttpResponseMessage DnsReply(byte[] body, HttpStatusCode status = HttpStatusCode.OK, string type = "application/dns-message")
    { var reply = new HttpResponseMessage(status) { Content = new ByteArrayContent(body), Version = HttpVersion.Version20 }; reply.Content.Headers.ContentType = new(type); return reply; }
    private static byte[] Answer(byte[] query, int code = 0, bool truncated = false)
    { var result = (byte[])query.Clone(); result[2] = (byte)(0x81 | (truncated ? 2 : 0)); result[3] = (byte)(0x80 | code); return result; }
    private static SystemDohProbeConfiguration Configuration(int port) => new(IPAddress.Loopback, port, new Uri(Endpoint), new[] { IPAddress.Parse("192.0.2.53") });
    private static Func<HttpMessageHandler> Http(Func<byte[], byte[]> answer, Action<HttpRequestMessage>? assertRequest = null) => () => new FakeHttpHandler(async (request, token) =>
    { assertRequest?.Invoke(request); byte[] query = await request.Content!.ReadAsByteArrayAsync(token); return DnsReply(answer(query)); });

    private static async Task DistinguishLocalPathAsync()
    {
        await using var failing = new DnsFixture(query => Answer(query, query.Length == LocalServiceHealthProbe.BuildDnsQuery().Length ? 0 : 2));
        Assert(await LocalServiceHealthProbe.DnsAsync(IPAddress.Loopback, failing.Port, TimeSpan.FromMilliseconds(100), default) == LocalServiceHealth.Responsive, "Reserved health fixture did not reproduce old Core success.");
        int remotes = 0;
        var result = await SystemDohServiceHealthProbe.ProbeAsync(Configuration(failing.Port), TimeSpan.FromMilliseconds(150), default,
            Http(query => Answer(query, 3), request => { remotes++; Assert(request.RequestUri!.AbsoluteUri == Endpoint && request.Method == HttpMethod.Post && request.Content!.Headers.ContentType!.MediaType == "application/dns-message", "Direct probe changed the exact configured operator/profile or wire protocol."); }));
        Assert(result == LocalServiceHealth.Unresponsive && remotes == 1, "Responsive reserved health hid a broken real DNS path with healthy exact upstream.");
        result = await SystemDohServiceHealthProbe.ProbeAsync(Configuration(failing.Port), TimeSpan.FromMilliseconds(150), default, Http(query => Answer(query, 2)));
        Assert(result == LocalServiceHealth.Unknown, "A real upstream outage caused speculative service recovery.");
        await using var healthy = new DnsFixture(query => Answer(query, 3));
        result = await SystemDohServiceHealthProbe.ProbeAsync(Configuration(healthy.Port), TimeSpan.FromMilliseconds(150), default, () => throw new InvalidOperationException("Healthy local path must not create remote HTTP request."));
        Assert(result == LocalServiceHealth.Responsive, "Valid local NXDOMAIN was treated as failure.");
        var queries = healthy.Queries.ToArray();
        await SystemDohServiceHealthProbe.ProbeAsync(Configuration(healthy.Port), TimeSpan.FromMilliseconds(150), default);
        Assert(!healthy.Queries[0].AsSpan(12).SequenceEqual(healthy.Queries[1].AsSpan(12)), "Repeated DNS health reused a cached question.");
    }

    private static Task PacketValidationAsync()
    {
        byte[] query = SystemDohServiceHealthProbe.BuildQuery(); var valid = Answer(query);
        Assert(SystemDohServiceHealthProbe.IsSuccessfulResponse(valid, query), "Valid successful exact DNS response rejected.");
        foreach (Action<byte[]> corrupt in new Action<byte[]>[] { r => r[0] ^= 1, r => r[13] ^= 1, r => r[3] = 2, r => r[2] |= 2, r => r[5] = 0, r => r[7] = 1, r => r[3] |= 0x40, r => { r[12] = 0xc0; r[13] = 12; } })
        { var bad = (byte[])valid.Clone(); corrupt(bad); Assert(!SystemDohServiceHealthProbe.IsSuccessfulResponse(bad, query), "Invalid DNS packet authorized recovery."); }
        Assert(!SystemDohServiceHealthProbe.IsSuccessfulResponse(valid.Concat(new byte[] { 0 }).ToArray(), query), "Trailing DNS junk accepted.");
        Assert(!SystemDohServiceHealthProbe.IsSuccessfulResponse(new byte[4097], query), "Oversized DNS body accepted.");
        for (int index = 0; index < 1000; index++)
            Assert(!SystemDohServiceHealthProbe.IsSuccessfulResponse(System.Security.Cryptography.RandomNumberGenerator.GetBytes(index % 256), query), "Malformed DNS stress packet was accepted.");
        return Task.CompletedTask;
    }

    private static async Task TruncatedTcpAsync()
    {
        await using var fixture = new DnsFixture(query => Answer(query, truncated: true));
        var listener = new TcpListener(IPAddress.Loopback, fixture.Port); listener.Start(); using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        var answer = Task.Run(async () =>
        {
            using var client = await listener.AcceptTcpClientAsync(stop.Token); using var stream = client.GetStream(); var size = new byte[2]; await stream.ReadExactlyAsync(size, stop.Token);
            var query = new byte[BinaryPrimitives.ReadUInt16BigEndian(size)]; await stream.ReadExactlyAsync(query, stop.Token);
            await stream.WriteAsync(size, stop.Token); await stream.WriteAsync(Answer(query, 3), stop.Token);
        });
        try { Assert(await SystemDohServiceHealthProbe.ProbeAsync(Configuration(fixture.Port), TimeSpan.FromSeconds(1), default, () => throw new InvalidOperationException("Healthy TCP should not probe remote.")) == LocalServiceHealth.Responsive, "Local UDP truncation failed TCP fallback."); await answer; }
        finally { listener.Stop(); }
    }

    private static async Task RemoteValidationAsync()
    {
        await using var failing = new DnsFixture(query => Answer(query, 2));
        foreach (string mode in new[] { "redirect", "content-type", "id", "question", "servfail", "truncated", "oversized", "missing-record", "trailing" })
        {
            var result = await SystemDohServiceHealthProbe.ProbeAsync(Configuration(failing.Port), TimeSpan.FromMilliseconds(150), default, () => new FakeHttpHandler(async (request, token) =>
            {
                var query = await request.Content!.ReadAsByteArrayAsync(token); var body = Answer(query);
                switch (mode) { case "id": body[0] ^= 1; break; case "question": body[13] ^= 1; break; case "servfail": body[3] = 2; break; case "truncated": body[2] |= 2; break; case "oversized": body = new byte[4097]; break; case "missing-record": body[7] = 1; break; case "trailing": body = body.Concat(new byte[] { 0 }).ToArray(); break; }
                var response = DnsReply(body, mode == "redirect" ? HttpStatusCode.Redirect : HttpStatusCode.OK, mode == "content-type" ? "text/plain" : "Application/DNS-Message");
                if (mode == "redirect") response.Headers.Location = new Uri("https://alternate.example/dns-query"); return response;
            }));
            Assert(result == LocalServiceHealth.Unknown, "Invalid upstream response triggered recovery: " + mode);
        }
    }

    private static async Task RemoteProtocolParityAsync()
    {
        await using var failing = new DnsFixture(query => Answer(query, 2));
        foreach (var version in new[] { HttpVersion.Version11, HttpVersion.Version20 })
        {
            bool exact = false;
            var result = await SystemDohServiceHealthProbe.ProbeAsync(Configuration(failing.Port), TimeSpan.FromMilliseconds(150), default,
                () => new FakeHttpHandler(async (request, token) => {
                    exact = request.Version == HttpVersion.Version20 && request.VersionPolicy == HttpVersionPolicy.RequestVersionExact;
                    var reply = DnsReply(Answer(await request.Content!.ReadAsByteArrayAsync(token))); reply.Version = version; return reply;
                }));
            Assert(result == (version == HttpVersion.Version20 ? LocalServiceHealth.Unresponsive : LocalServiceHealth.Unknown),
                "HTTP1-only upstream was treated as a healthy comparison for HTTP2-only Xray.");
            Assert(exact, "Core did not require Xray's HTTP2 transport version.");
        }
    }

    private sealed class SlowStream : Stream
    {
        internal bool Disposed;
        public override bool CanRead => true; public override bool CanSeek => false; public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException(); public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { } public override int Read(byte[] b, int o, int c) => throw new NotSupportedException();
        public override long Seek(long o, SeekOrigin origin) => throw new NotSupportedException(); public override void SetLength(long v) => throw new NotSupportedException(); public override void Write(byte[] b, int o, int c) => throw new NotSupportedException();
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken token = default) { await Task.Delay(Timeout.Infinite, token); return 0; }
        protected override void Dispose(bool disposing) { Disposed = true; base.Dispose(disposing); }
    }
    private static async Task DeadlinesAsync()
    {
        await using var failing = new DnsFixture(query => Answer(query, 2));
        var stream = new SlowStream(); var watch = Stopwatch.StartNew();
        Func<HttpMessageHandler> SlowHttp() => () => new FakeHttpHandler((_, _) => { var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(stream), Version = HttpVersion.Version20 }; response.Content.Headers.ContentType = new("application/dns-message"); return Task.FromResult(response); });
        Assert(await SystemDohServiceHealthProbe.ProbeAsync(Configuration(failing.Port), TimeSpan.FromMilliseconds(80), default, SlowHttp()) == LocalServiceHealth.Unknown && watch.Elapsed < TimeSpan.FromSeconds(1) && stream.Disposed, "Slow HTTP body escaped deadline or survived return.");
        stream = new SlowStream(); using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(40));
        await ExpectCancellation(() => SystemDohServiceHealthProbe.ProbeAsync(Configuration(failing.Port), TimeSpan.FromSeconds(2), cancel.Token, SlowHttp()));
        Assert(stream.Disposed, "Cancelled HTTP stream leaked.");
        await using var silent = new DnsFixture(_ => null); watch.Restart();
        Assert(await SystemDohServiceHealthProbe.ProbeAsync(Configuration(silent.Port), TimeSpan.FromMilliseconds(80), default, Http(query => Answer(query))) == LocalServiceHealth.Unresponsive && watch.Elapsed < TimeSpan.FromSeconds(1), "Silent local path did not finish within deadline.");
        using var localCancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(30));
        await ExpectCancellation(() => SystemDohServiceHealthProbe.ProbeAsync(Configuration(silent.Port), TimeSpan.FromSeconds(2), localCancel.Token));
    }

    private static SocketsHttpConnectionContext Context(string host, int port, HttpRequestMessage request) =>
        (SocketsHttpConnectionContext)Activator.CreateInstance(typeof(SocketsHttpConnectionContext), System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic, null, new object[] { new DnsEndPoint(host, port), request }, null)!;

    private static async Task PinnedTransportAsync()
    {
        var factory = typeof(SystemDohServiceHealthProbe).GetMethod("CreateHandler", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!;
        using var handler = (SocketsHttpHandler)factory.Invoke(null, new object[] { Configuration(53), TimeSpan.FromSeconds(1) })!;
        Assert(!handler.AllowAutoRedirect && !handler.UseProxy && handler.SslOptions.RemoteCertificateValidationCallback == null && handler.ConnectCallback != null && handler.MaxConnectionsPerServer == 1, "HTTPS redirect/proxy/TLS security policy changed.");
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://other.example/dns-query");
        try { await handler.ConnectCallback!(Context("other.example", 8443, request), default); throw new InvalidOperationException("Unexpected host reached pinned transport."); }
        catch (HttpRequestException) { }
        using var wrongPort = new HttpRequestMessage(HttpMethod.Post, Endpoint);
        try { await handler.ConnectCallback!(Context("resolver.example", 443, wrongPort), default); throw new InvalidOperationException("Unexpected port reached pinned transport."); }
        catch (HttpRequestException) { }
        // The real production handler must pin the IP while preserving the
        // configured hostname's SNI and rejecting a fresh untrusted certificate.
        using var rsa = RSA.Create(2048);
        var certificateRequest = new CertificateRequest("CN=resolver.example", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder(); san.AddDnsName("resolver.example"); certificateRequest.CertificateExtensions.Add(san.Build());
        using var certificate = certificateRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddMinutes(10));
        var tlsListener = new TcpListener(IPAddress.Loopback, 0); tlsListener.Start(); using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        string? observedSni = null;
        var tlsServer = Task.Run(async () =>
        {
            try
            {
                using var socket = await tlsListener.AcceptTcpClientAsync(stop.Token); using var ssl = new SslStream(socket.GetStream());
                await ssl.AuthenticateAsServerAsync(new SslServerAuthenticationOptions { ServerCertificateSelectionCallback = (_, host) => { observedSni = host; return certificate; } }, stop.Token);
            }
            catch (Exception error) when (error is AuthenticationException or IOException or OperationCanceledException or SocketException) { }
        });
        await using var failedLocal = new DnsFixture(query => Answer(query, 2));
        var exact = new SystemDohProbeConfiguration(IPAddress.Loopback, failedLocal.Port,
            new Uri($"https://resolver.example:{((IPEndPoint)tlsListener.LocalEndpoint).Port}/private/profile?tenant=fixture"), new[] { IPAddress.Loopback });
        try
        {
            Assert(await SystemDohServiceHealthProbe.ProbeAsync(exact, TimeSpan.FromSeconds(1), default) == LocalServiceHealth.Unknown, "Untrusted TLS certificate was accepted as healthy upstream.");
            await tlsServer;
            Assert(observedSni == "resolver.example", "Pinned connection changed the configured HTTPS SNI or used system DNS.");
        }
        finally { stop.Cancel(); tlsListener.Stop(); }
    }
}
