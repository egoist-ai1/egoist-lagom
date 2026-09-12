namespace EgoistShield.Service;

internal sealed record NativeDohTransactionSnapshot(DnsAdapterSnapshot[] Adapters, NativeDohOwnedState? OwnedState, NativeDohEntrySnapshot[] Entries);
