using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed record TelegramListenerFamilyResult(string State, int? OwnerPid, string? OwnerName, DateTimeOffset? OwnerCreatedAt);

internal static class TelegramListenerSnapshotCommand
{
    internal static async Task<int> RunAsync(int port)
    {
        if (port < 1 || port > 65535) throw new ArgumentException("Read-only Telegram snapshot requires a valid port.");
        const string serviceName = "EgoistShieldTelegramProxy";
        string expectedExecutable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "EgoistShield", "Runtime", "TelegramProxy", "service-wrapper", "egoistshield-telegram-proxy-service.exe");
        var reader = new WindowsServiceListenerSnapshot(serviceName);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        ServiceListenerSnapshot? snapshot;
        try { snapshot = await reader.ReadAsync(port, deadline.Token); }
        catch (OperationCanceledException) { snapshot = null; }
        Console.WriteLine(SerializeSnapshot(snapshot, port, expectedExecutable));
        return 0;
    }

    internal static string SerializeSnapshot(ServiceListenerSnapshot? snapshot, int port, string expectedExecutable)
    {
        var root = snapshot?.Processes?.SingleOrDefault(process => process.ProcessId == snapshot.ServiceProcessId);
        bool rootPathVerified = false;
        if (!string.IsNullOrWhiteSpace(root?.ExecutablePath))
        {
            try { rootPathVerified = Path.GetFullPath(root.ExecutablePath).Equals(Path.GetFullPath(expectedExecutable), StringComparison.OrdinalIgnoreCase); }
            catch (ArgumentException) { }
        }
        string output = JsonSerializer.Serialize(new
        {
            schemaVersion = 1, operation = "telegram-listener-snapshot", serviceName = "EgoistShieldTelegramProxy", port,
            snapshotAvailable = snapshot != null, stable = snapshot?.Stable == true,
            serviceState = snapshot?.ServiceState ?? "Unknown", serviceProcessId = snapshot?.ServiceProcessId ?? 0,
            rootProcessPathVerified = rootPathVerified, rootProcessCreatedAt = root?.CreatedAt,
            ownership = OwnedTcpListenerProbe.Classify(snapshot, IPAddress.Loopback, port, expectedExecutable).ToString().ToLowerInvariant(),
            ipv6Ownership = OwnedTcpListenerProbe.Classify(snapshot, IPAddress.IPv6Loopback, port, expectedExecutable).ToString().ToLowerInvariant(),
            ipv4 = DescribeFamily(snapshot, IPAddress.Loopback, port, expectedExecutable),
            ipv6 = DescribeFamily(snapshot, IPAddress.IPv6Loopback, port, expectedExecutable),
            snapshot, remoteConnectivityVerified = false
        }, JsonDefaults.Options);
        // The GUI has a 64 KiB output limit. Oversized metadata must fail closed,
        // rather than dropping proof rows and claiming a healthy listener.
        return Encoding.UTF8.GetByteCount(output) <= 60 * 1024 ? output : SerializeSnapshot(null, port, expectedExecutable);
    }

    internal static TelegramListenerFamilyResult DescribeFamily(ServiceListenerSnapshot? snapshot, IPAddress address, int port, string expectedExecutable)
    {
        var state = OwnedTcpListenerProbe.Classify(snapshot, address, port, expectedExecutable);
        var matching = snapshot?.Listeners?.Where(listener => listener != null && listener.LocalPort == port &&
            OwnedTcpListenerProbe.MatchesAddress(listener.LocalAddress, address)).ToArray() ?? Array.Empty<ListenerEndpoint>();
        ListenerEndpoint? selected = state == TcpListenerOwnership.Foreign
            ? matching.FirstOrDefault(listener => OwnedTcpListenerProbe.Classify(snapshot! with { Listeners = new[] { listener } }, address, port, expectedExecutable) == TcpListenerOwnership.Foreign)
            : matching.FirstOrDefault();
        var process = selected == null ? null : snapshot?.Processes?.SingleOrDefault(row => row.ProcessId == selected.OwningProcess);
        return new(state.ToString().ToLowerInvariant(), selected?.OwningProcess, Path.GetFileName(process?.ExecutablePath), process?.CreatedAt);
    }
}

