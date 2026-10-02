using System;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace EgoistShield.Service;

// Cancellation eligibility, never an authority grant. Complex worker operations
// still use their normal validator; only known validated mutations preempt probes.
internal static class ForegroundMutationPreemption
{
    internal static bool IsValid(ServiceRequest request, ClientIdentity identity, ServiceOptions options)
    {
        if (identity.IdentityProbe || request.ProtocolVersion != 1 || request.Payload.ValueKind != JsonValueKind.Object ||
            string.IsNullOrWhiteSpace(request.RequestId) || request.RequestId.Length > 128 ||
            request.RequestId.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '.' or ':' or '_'))) return false;
        try
        {
            switch (request.Operation)
            {
            case "dns.apply":
                var dns = request.Payload.Deserialize<DnsApplyPayload>(JsonDefaults.Options) ?? throw new ArgumentException();
                WindowsDnsController.ValidateServers(dns.Servers ?? Array.Empty<string>());
                WindowsDnsController.ValidateProbeHosts(dns.ProbeHosts ?? Array.Empty<string>()); return true;
            case "dns.doh.apply":
                var doh = request.Payload.Deserialize<NativeDohApplyPayload>(JsonDefaults.Options) ?? throw new ArgumentException();
                WindowsNativeDohController.ValidateUrl(doh.Url);
                WindowsDnsController.ValidateServers(doh.Servers ?? Array.Empty<string>());
                WindowsDnsController.ValidateProbeHosts(doh.ProbeHosts ?? Array.Empty<string>()); return true;
            case "dns.reset": case "dns.restore-owned": case "dns.doh.remove": case "network.repair-owned":
                return !request.Payload.EnumerateObject().Any();
            case "owned-service.install": case "owned-service.remove": case "owned-service.start": case "owned-service.stop":
                var owned = request.Payload.Deserialize<OwnedServicePayload>(JsonDefaults.Options) ?? throw new ArgumentException();
                _ = OwnedServiceController.NormalizeServiceName(owned.ServiceName ?? ""); return true;
            case "component.execute": return ValidComponent(request.Payload);
            case "test.delay-mutation":
                return options.ConsoleMode && options.AllowDevClient &&
                    (!request.Payload.TryGetProperty("delayMs", out var delay) || delay.TryGetInt32(out _));
            default: return false;
            }
        }
        catch (Exception error) when (error is ArgumentException or JsonException or InvalidOperationException or FormatException)
        { return false; }
    }

    private static bool ValidComponent(JsonElement payload)
    {
        if (!payload.TryGetProperty("component", out var c) || c.ValueKind != JsonValueKind.String ||
            !payload.TryGetProperty("method", out var m) || m.ValueKind != JsonValueKind.String ||
            !payload.TryGetProperty("args", out var args) || args.ValueKind != JsonValueKind.Array || args.GetArrayLength() > 4) return false;
        string component = c.GetString()!, method = m.GetString()!; int count = args.GetArrayLength();
        bool None() => count == 0;
        bool Profile() => count == 0 || count == 1 && (args[0].ValueKind == JsonValueKind.Null || args[0].ValueKind == JsonValueKind.String &&
            args[0].GetString() is { Length: > 0 and <= 160 } value && !string.IsNullOrWhiteSpace(value) && !value.Any(v => char.IsControl(v) || v is '\\' or '/'));
        bool Https(JsonElement value)
        {
            if (value.ValueKind != JsonValueKind.String || value.GetString() is not { Length: > 0 and <= 2048 } url || url.Any(char.IsControl)) return false;
            _ = WindowsNativeDohController.ValidateUrl(url);
            return Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.HostNameType is UriHostNameType.Dns or UriHostNameType.IPv4 or UriHostNameType.IPv6 &&
                uri.Fragment.Length == 0 && uri.Port is > 0 and <= 65535;
        }
        bool Local(JsonElement value) => value.ValueKind == JsonValueKind.String && value.GetString() is { } address &&
            (address.Trim().Length == 0 || Regex.IsMatch(address, @"^127\.0\.0\.(?:1|[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$", RegexOptions.CultureInvariant));
        if (component == "SystemDoH")
        {
            if (method is "stop" or "restart" or "stopAndRemove" or "refreshBootstrap") return None();
            if (method == "apply") return count is 1 or 2 && Https(args[0]) && (count == 1 || args[1].ValueKind == JsonValueKind.Null ||
                Local(args[1]));
            if (method == "recover") return count == 1 && args[0].ValueKind == JsonValueKind.Object &&
                args[0].TryGetProperty("enabled", out var enabled) && enabled.ValueKind is JsonValueKind.True or JsonValueKind.False &&
                args[0].TryGetProperty("url", out var url) && url.ValueKind == JsonValueKind.String && url.GetString()!.Length <= 2048 &&
                (enabled.ValueKind == JsonValueKind.False || Https(url)) &&
                args[0].EnumerateObject().All(p => p.Name is "enabled" or "url" or "localAddress") &&
                (!args[0].TryGetProperty("localAddress", out var local) || Local(local));
            return false;
        }
        if (component == "TelegramProxy") return (method is "start" or "stop" or "restart" or "installService" or "removeService" or
            "startService" or "stopService" or "installUpdate" or "shutdownApplicationRuntime") && None();
        if (component == "Vpn") return (method is "startService" or "stopService" or "removeService") && None();
        if (component == "Zapret")
        {
            if (method is "startService" or "stopService" or "removeService" or "stopStandalone" or "updateIpsetList" or "installCoreUpdate" or
                "installDiscordRescueCore" or "resetNetworkState" or "runDiagnostics" or "clearVpnSuspension") return None();
            if (method is "installService" or "setServiceProfile" or "startStandalone" or "restartStandalone") return Profile();
            if (method is "prepareForVpn" or "setUpdateChecksEnabled") return count == 1 && args[0].ValueKind is JsonValueKind.True or JsonValueKind.False;
        }
        return false;
    }
}
