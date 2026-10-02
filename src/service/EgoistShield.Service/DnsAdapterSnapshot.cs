namespace EgoistShield.Service;

internal sealed record DnsAdapterSnapshot(int InterfaceIndex, string InterfaceAlias, string? InterfaceGuid, string[] Ipv4, string[] Ipv6, bool Ipv4Static, bool Ipv6Static, bool? Ipv4BindingEnabled = null, bool? Ipv6BindingEnabled = null, string? Ipv6ConfiguredNameServer = null);
