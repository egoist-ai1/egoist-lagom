namespace EgoistShield.Service;

internal sealed record ClientIdentity(int ProcessId, string ExecutablePath, bool DevelopmentOverride, string UserSid, bool IdentityProbe = false);
