namespace EgoistShield.Service;

internal sealed record DnsAdapterSnapshot(int InterfaceIndex, string InterfaceAlias, string? InterfaceGuid, string[] Ipv4, string[] Ipv6, bool Ipv4Static, bool Ipv6Static);
