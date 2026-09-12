using System;

namespace EgoistShield.Service;

internal sealed record NativeDohOwnedState(int SchemaVersion, string Owner, string Url, string[] Servers, DateTimeOffset UpdatedAt, NativeDohEntrySnapshot[]? OriginalEntries = null, DnsAdapterSnapshot[]? OriginalDnsAdapters = null);
