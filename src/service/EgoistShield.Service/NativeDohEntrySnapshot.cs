namespace EgoistShield.Service;

internal sealed record NativeDohEntrySnapshot(string ServerAddress, bool Existed, string? DohTemplate, bool AllowFallbackToUdp, bool AutoUpgrade);
