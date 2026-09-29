using System;
using System.Collections.Generic;
using System.Linq;

namespace EgoistShield.Service;

internal static class DnsMaintenancePolicy
{
    internal static bool FullyCovered(IReadOnlyCollection<DnsAdapterSnapshot> adapters, IReadOnlyCollection<string> servers)
    {
        var selected = servers.ToHashSet(StringComparer.OrdinalIgnoreCase);
        return adapters.Count > 0 && adapters.All(adapter =>
            adapter.Ipv4.Length + adapter.Ipv6.Length > 0 &&
            (adapter.Ipv4.Length == 0 || adapter.Ipv4Static && adapter.Ipv4.All(selected.Contains)) &&
            (adapter.Ipv6.Length == 0 || adapter.Ipv6Static && adapter.Ipv6.All(selected.Contains)));
    }

    internal static DnsAdapterSnapshot[] NewAutomaticAdapters(IReadOnlyCollection<DnsAdapterSnapshot> current,
        IReadOnlyCollection<DnsAdapterSnapshot> recorded)
    {
        if (recorded.Count == 0) return Array.Empty<DnsAdapterSnapshot>();
        var known = recorded.Select(adapter => adapter.InterfaceGuid).ToHashSet(StringComparer.OrdinalIgnoreCase);
        // Maintenance enrolls only brand-new DHCP adapters. A known adapter
        // changed outside Egoist, or any explicit static DNS, is preserved.
        return current.Where(adapter => !string.IsNullOrWhiteSpace(adapter.InterfaceGuid) &&
            !known.Contains(adapter.InterfaceGuid) && !adapter.Ipv4Static && !adapter.Ipv6Static).ToArray();
    }
}
