namespace EgoistShield.Service;

internal sealed record OwnedServiceStatus(string ServiceName, string State, string? StartType, bool Installed);
