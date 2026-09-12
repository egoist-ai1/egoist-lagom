using System;
using System.Linq;
using EgoistShield.Service;

namespace DnsOwnedRestoreRegression;

internal static class Program
{
    private static void Main()
    {
        var poisoned = new DnsAdapterSnapshot(7, "Ethernet", "adapter-a", new[] { "127.0.0.1" }, new[] { "::1" }, true, true);
        var owned = new DnsOwnedState(1, "EgoistShield", new[] { "127.0.0.1", "::1" }, new[] { poisoned });
        var current = poisoned with { Ipv6 = new[] { "2001:db8::99" } };
        var restored = owned.RestoreTargets(new[] { current }).Single();
        Assert(!restored.Ipv4Static, "a poisoned owned IPv4 baseline switches to DHCP despite external IPv6");
        Assert(restored.Ipv6Static && restored.Ipv6.SequenceEqual(current.Ipv6), "external IPv6 stays unchanged");
        Console.WriteLine("DNS owned restore regression passed.");
    }

    private static void Assert(bool condition, string name)
    {
        if (!condition) throw new InvalidOperationException("Regression failed: " + name);
        Console.WriteLine("PASS: " + name);
    }
}
