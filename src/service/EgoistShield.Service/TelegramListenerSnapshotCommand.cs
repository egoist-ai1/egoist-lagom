using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed record TelegramListenerFamilyResult(string State, int? OwnerPid, string? OwnerName, DateTimeOffset? OwnerCreatedAt,
    int? RootPid = null, DateTimeOffset? RootCreatedAt = null);

internal static class TelegramListenerSnapshotCommand
{
    internal static async Task<int> RunAsync(int port, int? managedProcessId = null, DateTimeOffset? managedStartedAt = null)
    {
        if (port < 1 || port > 65535) throw new ArgumentException("Read-only Telegram snapshot requires a valid port.");
        const string serviceName = "EgoistShieldTelegramProxy";
        string expectedExecutable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "EgoistShield", "Runtime", "TelegramProxy", "service-wrapper", "egoistshield-telegram-proxy-service.exe");
        string runtimeRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "EgoistShield", "Runtime", "TelegramProxy", "runtime");
        var managedPaths = new[] { Path.Combine(runtimeRoot, "egoistshield-tg-ws-proxy.exe"), Path.Combine(runtimeRoot, "TgWsProxy_windows_7_64bit.exe") };
        var reader = new WindowsServiceListenerSnapshot(serviceName, managedProcessId: managedProcessId);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        ServiceListenerSnapshot? snapshot;
        try { snapshot = await reader.ReadAsync(port, deadline.Token); }
        catch (OperationCanceledException) { snapshot = null; }
        Console.WriteLine(SerializeSnapshot(snapshot, port, expectedExecutable, managedProcessId, managedStartedAt, managedPaths));
        return 0;
    }

    internal static string SerializeSnapshot(ServiceListenerSnapshot? snapshot, int port, string expectedExecutable,
        int? managedProcessId = null, DateTimeOffset? managedStartedAt = null, string[]? managedPaths = null)
    {
        var root = snapshot?.Processes?.SingleOrDefault(process => process.ProcessId == snapshot.ServiceProcessId);
        bool rootPathVerified = false;
        if (!string.IsNullOrWhiteSpace(root?.ExecutablePath))
        {
            try { rootPathVerified = Path.GetFullPath(root.ExecutablePath).Equals(Path.GetFullPath(expectedExecutable), StringComparison.OrdinalIgnoreCase); }
            catch (ArgumentException) { }
        }
        var managedRoot = snapshot?.Processes?.SingleOrDefault(process => process.ProcessId == managedProcessId);
        bool managedIdentityVerified = managedRoot?.CreatedAt is DateTimeOffset born && managedStartedAt is DateTimeOffset saved &&
            (born - saved).TotalSeconds >= -30 && (born - saved).TotalSeconds <= 5 &&
            !string.IsNullOrWhiteSpace(managedRoot.ExecutablePath) && (managedPaths ?? Array.Empty<string>()).Any(candidate =>
                Path.GetFullPath(candidate).Equals(Path.GetFullPath(managedRoot.ExecutablePath), StringComparison.OrdinalIgnoreCase));
        var ipv4 = DescribeFamily(snapshot, IPAddress.Loopback, port, expectedExecutable, managedRoot, managedIdentityVerified, managedProcessId != null);
        var ipv6 = DescribeFamily(snapshot, IPAddress.IPv6Loopback, port, expectedExecutable, managedRoot, managedIdentityVerified, managedProcessId != null);
        string output = JsonSerializer.Serialize(new
        {
            schemaVersion = 2, operation = "telegram-listener-snapshot", serviceName = "EgoistShieldTelegramProxy", port,
            snapshotAvailable = snapshot != null, stable = snapshot?.Stable == true,
            serviceState = snapshot?.ServiceState ?? "Unknown", serviceProcessId = snapshot?.ServiceProcessId ?? 0,
            rootProcessPathVerified = rootPathVerified, rootProcessCreatedAt = root?.CreatedAt,
            managedProcessId, managedIdentityVerified, managedRootCreatedAt = managedRoot?.CreatedAt,
            ownership = ipv4.State, ipv6Ownership = ipv6.State, ipv4, ipv6,
            snapshot, remoteConnectivityVerified = false
        }, JsonDefaults.Options);
        // The GUI has a 64 KiB output limit. Oversized metadata must fail closed,
        // rather than dropping proof rows and claiming a healthy listener.
        return Encoding.UTF8.GetByteCount(output) <= 60 * 1024 ? output : SerializeSnapshot(null, port, expectedExecutable, managedProcessId, managedStartedAt, managedPaths);
    }

    internal static TelegramListenerFamilyResult DescribeFamily(ServiceListenerSnapshot? snapshot, IPAddress address, int port, string expectedExecutable,
        ListenerProcess? managedRoot = null, bool managedIdentityVerified = false, bool managedRequested = false)
    {
        var state = OwnedTcpListenerProbe.Classify(snapshot, address, port, expectedExecutable);
        var matching = snapshot?.Listeners?.Where(listener => listener != null && listener.LocalPort == port &&
            OwnedTcpListenerProbe.MatchesAddress(listener.LocalAddress, address)).ToArray() ?? Array.Empty<ListenerEndpoint>();
        if (managedRequested && !managedIdentityVerified) return new("unknown", null, null, null);
        ListenerEndpoint? selected = matching.FirstOrDefault();
        ListenerProcess? proofRoot = null;
        if (managedIdentityVerified && managedRoot != null && snapshot is { Stable: true })
        {
            bool unknown = false;
            state = matching.Length == 0 ? state : TcpListenerOwnership.Owned;
            foreach (var listener in matching)
            {
                var one = snapshot with { Listeners = new[] { listener } };
                var serviceState = OwnedTcpListenerProbe.Classify(one, address, port, expectedExecutable);
                var managedState = OwnedTcpListenerProbe.Classify(one with { ServiceProcessId = managedRoot.ProcessId, ServiceState = "Running" },
                    address, port, managedRoot.ExecutablePath!);
                if (serviceState == TcpListenerOwnership.Owned || managedState == TcpListenerOwnership.Owned)
                {
                    proofRoot ??= serviceState == TcpListenerOwnership.Owned
                        ? snapshot.Processes.SingleOrDefault(row => row.ProcessId == snapshot.ServiceProcessId) : managedRoot;
                    continue;
                }
                if (serviceState == TcpListenerOwnership.Foreign && managedState == TcpListenerOwnership.Foreign)
                { state = TcpListenerOwnership.Foreign; selected = listener; proofRoot = null; break; }
                unknown = true;
            }
            if (unknown && state != TcpListenerOwnership.Foreign) state = TcpListenerOwnership.Unknown;
        }
        else if (state == TcpListenerOwnership.Foreign)
            selected = matching.FirstOrDefault(listener => OwnedTcpListenerProbe.Classify(snapshot! with { Listeners = new[] { listener } }, address, port, expectedExecutable) == TcpListenerOwnership.Foreign);
        if (state == TcpListenerOwnership.Owned && proofRoot == null)
            proofRoot = snapshot?.Processes?.SingleOrDefault(row => row.ProcessId == snapshot.ServiceProcessId);
        var process = selected == null ? null : snapshot?.Processes?.SingleOrDefault(row => row.ProcessId == selected.OwningProcess);
        if (state is TcpListenerOwnership.Foreign or TcpListenerOwnership.Owned &&
            (process?.CreatedAt == null || string.IsNullOrWhiteSpace(process.ExecutablePath)))
            return new("unknown", null, null, null);
        return new(state.ToString().ToLowerInvariant(), selected?.OwningProcess, Path.GetFileName(process?.ExecutablePath), process?.CreatedAt,
            proofRoot?.ProcessId, proofRoot?.CreatedAt);
    }
}

