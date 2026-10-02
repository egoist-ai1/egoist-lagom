using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed record SystemDohProbeConfiguration(IPAddress LocalAddress, int LocalPort, Uri Endpoint, IPAddress[] Bootstrap);

// The reserved local health name proves only that Xray's event loop is alive.
// Compare a fresh real DNS question with the same saved HTTPS provider before
// calling an upstream-path failure a recoverable local service failure.
internal static class SystemDohServiceHealthProbe
{
    internal const int MaxDnsBytes = 4096;
    internal const int MaxConfigurationBytes = 64 * 1024;
    internal static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(3);

    internal static async Task<LocalServiceHealth> ProbeOwnedAsync(string productRoot, CancellationToken cancellationToken)
    {
        string statePath = Path.Combine(productRoot, "Runtime", "SystemDoH", "state.json");
        string configPath = Path.Combine(productRoot, "Runtime", "SystemDoH", "config.json");
        using var readDeadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        readDeadline.CancelAfter(TimeSpan.FromSeconds(2));
        try
        {
            TrustedPath.AssertPathUnderRoot(statePath, productRoot, requireLeaf: true);
            TrustedPath.AssertPathUnderRoot(configPath, productRoot, requireLeaf: true);
            var state = await ReadAsync(statePath, readDeadline.Token);
            var runtime = await ReadAsync(configPath, readDeadline.Token);
            if (!TryReadConfiguration(state, runtime, out var config)) return LocalServiceHealth.Unknown;
            var health = await ProbeAsync(config!, ProbeTimeout, cancellationToken);
            // A replaced provider/config generation never authorizes recovery.
            using var recheckDeadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            recheckDeadline.CancelAfter(TimeSpan.FromSeconds(2));
            TrustedPath.AssertPathUnderRoot(statePath, productRoot, requireLeaf: true);
            TrustedPath.AssertPathUnderRoot(configPath, productRoot, requireLeaf: true);
            var latestState = await ReadAsync(statePath, recheckDeadline.Token);
            var latestRuntime = await ReadAsync(configPath, recheckDeadline.Token);
            return state.GetRawText() == latestState.GetRawText() && runtime.GetRawText() == latestRuntime.GetRawText()
                ? health : LocalServiceHealth.Unknown;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return LocalServiceHealth.Unknown; }
        catch (Exception error) when (error is IOException or JsonException or InvalidOperationException or UnauthorizedAccessException)
        { return LocalServiceHealth.Unknown; }
    }

    private static async Task<JsonElement> ReadAsync(string path, CancellationToken token) =>
        (await AtomicJsonFile.ReadResultAsync<JsonElement>(path, token, MaxConfigurationBytes)).ValueOrThrow(Path.GetFileName(path));

    internal static bool TryReadConfiguration(JsonElement state, JsonElement runtime, out SystemDohProbeConfiguration? config)
    {
        config = null;
        if (!GetString(state, "localAddress", out var local) || !IPAddress.TryParse(local, out var address) ||
            address.AddressFamily != AddressFamily.InterNetwork || !IPAddress.IsLoopback(address) ||
            !GetInt(state, "localPort", out int port) || port < 1 || port > 65535 ||
            !GetString(state, "url", out var savedUrl) || !TryEndpoint(savedUrl, out var saved) ||
            !GetObject(runtime, "dns", out var dns) || !GetString(dns, "tag", out var tag) || tag != "doh-upstream" ||
            !GetObject(dns, "hosts", out var hosts) || !hosts.TryGetProperty("health.egoist.invalid", out var reserved) ||
            !Strings(reserved, out var healthAddresses) || !healthAddresses.Contains("127.0.0.1", StringComparer.Ordinal) ||
            !dns.TryGetProperty("servers", out var servers) || servers.ValueKind != JsonValueKind.Array || servers.GetArrayLength() != 1)
            return false;
        var server = servers[0];
        string? activeUrl = server.ValueKind == JsonValueKind.String ? server.GetString() : GetString(server, "address", out var value) ? value : null;
        if (!TryEndpoint(activeUrl, out var active) || !string.Equals(saved!.AbsoluteUri, active!.AbsoluteUri, StringComparison.Ordinal)) return false;
        if (!runtime.TryGetProperty("inbounds", out var inbounds) || inbounds.ValueKind != JsonValueKind.Array ||
            inbounds.GetArrayLength() > 8 || !inbounds.EnumerateArray().Any(inbound =>
                GetString(inbound, "tag", out var inboundTag) && inboundTag == "dns-in" &&
                GetString(inbound, "listen", out var listen) && IPAddress.TryParse(listen, out var listenAddress) && address.Equals(listenAddress) &&
                GetInt(inbound, "port", out int inboundPort) && inboundPort == port &&
                GetString(inbound, "protocol", out var protocol) && protocol == "dokodemo-door" &&
                GetObject(inbound, "settings", out var settings) && GetString(settings, "network", out var network) && network == "tcp,udp"))
            return false;
        var bootstrap = new List<IPAddress>();
        if (IPAddress.TryParse(saved.IdnHost, out var literal)) bootstrap.Add(literal);
        else
        {
            var entries = hosts.EnumerateObject().Where(item => string.Equals(item.Name, saved.IdnHost, StringComparison.OrdinalIgnoreCase)).ToArray();
            if (entries.Length != 1 || !Strings(entries[0].Value, out var values) || values.Length < 1 || values.Length > 4) return false;
            foreach (string item in values)
            {
                if (!IPAddress.TryParse(item, out var ip) || !IsIpv4Unicast(ip) || !string.Equals(ip.ToString(), item, StringComparison.Ordinal)) return false;
                if (!bootstrap.Contains(ip)) bootstrap.Add(ip);
            }
        }
        if (bootstrap.Count == 0 || bootstrap.Any(ip => !IsIpv4Unicast(ip))) return false;
        config = new(address, port, saved, bootstrap.ToArray());
        return true;
    }

    private static bool IsIpv4Unicast(IPAddress address) => address.AddressFamily == AddressFamily.InterNetwork &&
        address.GetAddressBytes()[0] is > 0 and < 224 && !address.Equals(IPAddress.Broadcast);

    internal static bool TryEndpoint(string? value, out Uri? endpoint)
    {
        endpoint = null;
        if (string.IsNullOrWhiteSpace(value) || value.Length > 4096 || value.Any(char.IsControl) ||
            !Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
            string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment) || uri.Port is < 1 or > 65535)
            return false;
        // Matches the existing Xray builder's default endpoint, preserving the
        // exact saved profile path and query for every non-root URL.
        endpoint = uri.AbsolutePath == "/" ? new UriBuilder(uri) { Path = "/dns-query" }.Uri : uri;
        return true;
    }

    private static bool GetObject(JsonElement source, string key, out JsonElement value)
    { value = default; return source.ValueKind == JsonValueKind.Object && source.TryGetProperty(key, out value) && value.ValueKind == JsonValueKind.Object; }
    private static bool GetString(JsonElement source, string key, out string? value)
    { value = null; if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(key, out var item) || item.ValueKind != JsonValueKind.String) return false; value = item.GetString(); return value != null; }
    private static bool GetInt(JsonElement source, string key, out int value)
    { value = 0; return source.ValueKind == JsonValueKind.Object && source.TryGetProperty(key, out var item) && item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out value); }
    private static bool Strings(JsonElement source, out string[] values)
    {
        values = Array.Empty<string>();
        if (source.ValueKind == JsonValueKind.String) { values = new[] { source.GetString()! }; return true; }
        if (source.ValueKind != JsonValueKind.Array || source.GetArrayLength() > 4 || source.EnumerateArray().Any(item => item.ValueKind != JsonValueKind.String)) return false;
        values = source.EnumerateArray().Select(item => item.GetString()!).ToArray(); return true;
    }

    internal static async Task<LocalServiceHealth> ProbeAsync(SystemDohProbeConfiguration config, TimeSpan timeout,
        CancellationToken cancellationToken, Func<HttpMessageHandler>? handlerFactory = null)
    {
        if (timeout <= TimeSpan.Zero || timeout > ProbeTimeout) throw new ArgumentOutOfRangeException(nameof(timeout));
        byte[] query = BuildQuery();
        bool localHealthy = await LocalQueryAsync(config.LocalAddress, config.LocalPort, query, timeout, cancellationToken);
        if (localHealthy) return LocalServiceHealth.Responsive;
        // Failure of this exact provider is not a reason to restart the listener
        // or change adapters. This path never resolves the provider through DNS.
        bool providerHealthy = await HttpsQueryAsync(config, query, timeout, cancellationToken, handlerFactory);
        return providerHealthy ? LocalServiceHealth.Unresponsive : LocalServiceHealth.Unknown;
    }

    internal static byte[] BuildQuery()
    {
        using var message = new MemoryStream();
        byte[] header = new byte[12]; RandomNumberGenerator.Fill(header.AsSpan(0, 2)); header[2] = 1; header[5] = 1;
        message.Write(header);
        foreach (string label in ("es-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant() + ".example.com").Split('.'))
        { message.WriteByte((byte)label.Length); message.Write(Encoding.ASCII.GetBytes(label)); }
        message.Write(new byte[] { 0, 0, 1, 0, 1 });
        return message.ToArray();
    }

    internal static async Task<bool> LocalQueryAsync(IPAddress address, int port, byte[] query, TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken); deadline.CancelAfter(timeout);
        try
        {
            using var udp = new UdpClient(address.AddressFamily); udp.Connect(address, port);
            await udp.SendAsync(query, deadline.Token);
            while (true)
            {
                var reply = await udp.ReceiveAsync(deadline.Token);
                if (!LocalServiceHealthProbe.IsDnsResponse(reply.Buffer, query)) continue;
                if ((reply.Buffer[2] & 2) == 0) return IsSuccessfulResponse(reply.Buffer, query);
                break;
            }
            // A truncated response may use local TCP; both transports share one
            // deadline so a broken listener never consumes two full timeouts.
            using var tcp = new TcpClient(address.AddressFamily); await tcp.ConnectAsync(address, port, deadline.Token);
            using var stream = tcp.GetStream(); byte[] framed = new byte[query.Length + 2];
            BinaryPrimitives.WriteUInt16BigEndian(framed, (ushort)query.Length); query.CopyTo(framed, 2);
            await stream.WriteAsync(framed, deadline.Token);
            byte[] length = new byte[2]; await stream.ReadExactlyAsync(length, deadline.Token);
            int size = BinaryPrimitives.ReadUInt16BigEndian(length); if (size < 12 || size > MaxDnsBytes) return false;
            byte[] answer = new byte[size]; await stream.ReadExactlyAsync(answer, deadline.Token);
            return IsSuccessfulResponse(answer, query);
        }
        catch (Exception error) when (error is SocketException or IOException || error is OperationCanceledException && !cancellationToken.IsCancellationRequested) { return false; }
    }

    private static SocketsHttpHandler CreateHandler(SystemDohProbeConfiguration config, TimeSpan timeout) => new()
    {
        AllowAutoRedirect = false, UseProxy = false, ConnectTimeout = timeout,
        MaxConnectionsPerServer = 1, MaxResponseHeadersLength = 8,
        // A new handler and connection for each failed-path comparison avoid
        // reproducing a stalled pooled Xray upstream connection in the probe.
        ConnectCallback = async (context, token) =>
        {
            if (!string.Equals(context.DnsEndPoint.Host, config.Endpoint.IdnHost, StringComparison.OrdinalIgnoreCase) || context.DnsEndPoint.Port != config.Endpoint.Port)
                throw new HttpRequestException("Unexpected DoH endpoint.");
            foreach (var address in config.Bootstrap)
            {
                var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
                try { await socket.ConnectAsync(new IPEndPoint(address, config.Endpoint.Port), token); return new NetworkStream(socket, ownsSocket: true); }
                catch (SocketException) { socket.Dispose(); }
                catch { socket.Dispose(); throw; }
            }
            throw new HttpRequestException("Saved DoH bootstrap is unavailable.");
        }
    };

    private static async Task<bool> HttpsQueryAsync(SystemDohProbeConfiguration config, byte[] query, TimeSpan timeout,
        CancellationToken cancellationToken, Func<HttpMessageHandler>? handlerFactory)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken); deadline.CancelAfter(timeout);
        try
        {
            using var handler = handlerFactory?.Invoke() ?? CreateHandler(config, timeout);
            using var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
            using var request = new HttpRequestMessage(HttpMethod.Post, config.Endpoint)
            { Content = new ByteArrayContent(query), Version = HttpVersion.Version20, VersionPolicy = HttpVersionPolicy.RequestVersionExact };
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/dns-message"));
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/dns-message");
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            // Xray uses an HTTP2-only DoH transport. HTTP1 success cannot justify a local restart.
            if (response.Version != HttpVersion.Version20 || !response.IsSuccessStatusCode || !string.Equals(response.Content.Headers.ContentType?.MediaType, "application/dns-message", StringComparison.OrdinalIgnoreCase) || response.Content.Headers.ContentLength > MaxDnsBytes) return false;
            using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
            byte[] body = new byte[MaxDnsBytes + 1]; int offset = 0, read;
            while (offset < body.Length && (read = await stream.ReadAsync(body.AsMemory(offset), deadline.Token)) != 0) offset += read;
            return offset <= MaxDnsBytes && IsSuccessfulResponse(body.AsSpan(0, offset), query);
        }
        catch (Exception error) when (error is HttpRequestException or IOException || error is OperationCanceledException && !cancellationToken.IsCancellationRequested) { return false; }
    }

    internal static bool IsSuccessfulResponse(ReadOnlySpan<byte> reply, ReadOnlySpan<byte> query)
    {
        if (reply.Length > MaxDnsBytes || !LocalServiceHealthProbe.IsDnsResponse(reply, query) || (reply[2] & 2) != 0 ||
            (reply[3] & 0x40) != 0 || (reply[3] & 15) is not (0 or 3)) return false;
        int offset = 12;
        if (!SkipName(reply, ref offset) || offset + 4 > reply.Length) return false;
        offset += 4;
        int records = BinaryPrimitives.ReadUInt16BigEndian(reply.Slice(6, 2)) + BinaryPrimitives.ReadUInt16BigEndian(reply.Slice(8, 2)) + BinaryPrimitives.ReadUInt16BigEndian(reply.Slice(10, 2));
        if (records > 256) return false;
        for (int index = 0; index < records; index++)
        {
            if (!SkipName(reply, ref offset) || offset + 10 > reply.Length) return false;
            int type = BinaryPrimitives.ReadUInt16BigEndian(reply.Slice(offset, 2));
            int length = BinaryPrimitives.ReadUInt16BigEndian(reply.Slice(offset + 8, 2)); offset += 10;
            if (offset + length > reply.Length || type == 1 && length != 4 || type == 28 && length != 16) return false;
            offset += length;
        }
        return offset == reply.Length;
    }

    private static bool SkipName(ReadOnlySpan<byte> message, ref int offset)
    {
        int cursor = offset, end = -1, total = 0;
        for (int step = 0; step < 128 && cursor < message.Length; step++)
        {
            int size = message[cursor++];
            if (size == 0) { offset = end >= 0 ? end : cursor; return true; }
            if ((size & 0xc0) == 0xc0)
            {
                if (cursor >= message.Length) return false;
                int pointer = ((size & 63) << 8) | message[cursor++]; if (pointer >= message.Length) return false;
                if (end < 0) end = cursor; cursor = pointer; continue;
            }
            if (size > 63 || cursor + size > message.Length || (total += size + 1) > 254) return false;
            cursor += size;
        }
        return false;
    }
}

