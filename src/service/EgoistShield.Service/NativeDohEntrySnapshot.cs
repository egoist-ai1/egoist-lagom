namespace EgoistShield.Service;

internal sealed record NativeDohEntrySnapshot(string ServerAddress, bool Existed, string? DohTemplate, bool AllowFallbackToUdp, bool AutoUpgrade, NativeDohRegistryFlagsSnapshot? RegistryFlags = null);

internal sealed record NativeDohRegistryFlagsSnapshot([property: System.Text.Json.Serialization.JsonRequired] bool Present, [property: System.Text.Json.Serialization.JsonRequired] string? Kind, [property: System.Text.Json.Serialization.JsonRequired] string? Value);
