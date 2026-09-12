using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Sockets;

namespace EgoistShield.Service;

internal sealed record DnsOwnedState(int SchemaVersion, string Owner, string[] Servers, DnsAdapterSnapshot[] OriginalAdapters, Dictionary<string, string[]>? AdapterServers = null)
{
    internal string[] ServersFor(DnsAdapterSnapshot adapter) => AdapterServers?.FirstOrDefault(x => string.Equals(x.Key, adapter.InterfaceGuid, StringComparison.OrdinalIgnoreCase)).Value ?? Servers;

    internal void Validate()
    {
        if (SchemaVersion != 1 || Owner != "EgoistShield" || OriginalAdapters == null || OriginalAdapters.Any(x => string.IsNullOrWhiteSpace(x.InterfaceGuid)) || OriginalAdapters.Select(x => x.InterfaceGuid).Distinct(StringComparer.OrdinalIgnoreCase).Count() != OriginalAdapters.Length)
            throw new InvalidOperationException("DNS ownership state is invalid.");
        WindowsDnsController.ValidateServers(Servers);
        if (AdapterServers != null) foreach (var pair in AdapterServers) { if (string.IsNullOrWhiteSpace(pair.Key)) throw new InvalidOperationException("DNS adapter identity is missing."); WindowsDnsController.ValidateServers(pair.Value); }
    }

    internal static DnsOwnedState Capture(DnsOwnedState? previous, DnsAdapterSnapshot[] current, string[] servers)
    {
        var baseline = current.Select(adapter =>
        {
            var saved = previous?.OriginalAdapters.SingleOrDefault(x => SameAdapter(x, adapter));
            if (saved == null || previous == null) return adapter;
            return adapter with
            {
                Ipv4 = Owns(adapter.Ipv4, adapter.Ipv4Static, previous.ServersFor(adapter), AddressFamily.InterNetwork) ? saved.Ipv4 : adapter.Ipv4,
                Ipv4Static = Owns(adapter.Ipv4, adapter.Ipv4Static, previous.ServersFor(adapter), AddressFamily.InterNetwork) ? saved.Ipv4Static : adapter.Ipv4Static,
                Ipv6 = Owns(adapter.Ipv6, adapter.Ipv6Static, previous.ServersFor(adapter), AddressFamily.InterNetworkV6) ? saved.Ipv6 : adapter.Ipv6,
                Ipv6Static = Owns(adapter.Ipv6, adapter.Ipv6Static, previous.ServersFor(adapter), AddressFamily.InterNetworkV6) ? saved.Ipv6Static : adapter.Ipv6Static
            };
        }).ToList();
        // Disconnected/removed adapters retain their baseline for a later reconnect.
        baseline.AddRange(previous?.OriginalAdapters.Where(saved => !current.Any(adapter => SameAdapter(saved, adapter))) ?? Array.Empty<DnsAdapterSnapshot>());
        var ownership = baseline.ToDictionary(adapter => adapter.InterfaceGuid, adapter => current.Any(x => SameAdapter(x, adapter)) ? servers : previous!.ServersFor(adapter), StringComparer.OrdinalIgnoreCase);
        return new DnsOwnedState(1, "EgoistShield", servers, baseline.ToArray(), ownership);
    }

    internal DnsAdapterSnapshot[] RestoreTargets(IReadOnlyCollection<DnsAdapterSnapshot> current) => RestoreTargets(current, out _);

    internal DnsAdapterSnapshot[] RestoreTargets(IReadOnlyCollection<DnsAdapterSnapshot> current, out bool fallbackToDhcp, bool repairLoopback = true)
    {
        bool usedFallback = false;
        var targets = current.Select(adapter =>
        {
            var saved = OriginalAdapters.SingleOrDefault(x => SameAdapter(x, adapter));
            if (saved == null) return null;
            var servers = ServersFor(adapter);
            bool v4 = Owns(adapter.Ipv4, adapter.Ipv4Static, servers, AddressFamily.InterNetwork);
            bool v6 = Owns(adapter.Ipv6, adapter.Ipv6Static, servers, AddressFamily.InterNetworkV6);
            if (!v4 && !v6) return null;
            // A failed stop in older builds could save our own local resolver as
            // the baseline. Repair only that still-owned family, never its peer.
            bool resetV4 = repairLoopback && v4 && IsOwnedLoopback(saved.Ipv4, saved.Ipv4Static, servers, AddressFamily.InterNetwork);
            bool resetV6 = repairLoopback && v6 && IsOwnedLoopback(saved.Ipv6, saved.Ipv6Static, servers, AddressFamily.InterNetworkV6);
            usedFallback |= resetV4 || resetV6;
            return adapter with
            {
                Ipv4 = resetV4 ? Array.Empty<string>() : v4 ? saved.Ipv4 : adapter.Ipv4,
                Ipv4Static = resetV4 ? false : v4 ? saved.Ipv4Static : adapter.Ipv4Static,
                Ipv6 = resetV6 ? Array.Empty<string>() : v6 ? saved.Ipv6 : adapter.Ipv6,
                Ipv6Static = resetV6 ? false : v6 ? saved.Ipv6Static : adapter.Ipv6Static
            };
        }).Where(x => x != null).Cast<DnsAdapterSnapshot>().ToArray();
        fallbackToDhcp = usedFallback;
        return targets;
    }

    private static bool IsOwnedLoopback(string[] baseline, bool isStatic, string[] servers, AddressFamily family) =>
        Owns(baseline, isStatic, servers, family) && baseline.All(x => IPAddress.TryParse(x, out var address) && IPAddress.IsLoopback(address));

    private static bool SameAdapter(DnsAdapterSnapshot left, DnsAdapterSnapshot right) =>
        !string.IsNullOrWhiteSpace(left.InterfaceGuid) && string.Equals(left.InterfaceGuid, right.InterfaceGuid, StringComparison.OrdinalIgnoreCase);

    private static bool Owns(string[] actual, bool isStatic, string[] servers, AddressFamily family)
    {
        var desired = servers.Where(x => IPAddress.Parse(x).AddressFamily == family).ToArray();
        return isStatic && desired.Length > 0 && actual.SequenceEqual(desired, StringComparer.OrdinalIgnoreCase);
    }
}

internal sealed record DnsOwnedTransactionSnapshot(DnsAdapterSnapshot[] Adapters, DnsOwnedState? OwnedState);
