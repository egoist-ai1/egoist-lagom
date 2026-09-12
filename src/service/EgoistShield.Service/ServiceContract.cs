using System;

namespace EgoistShield.Service;

internal static class ServiceContract
{
	public const int ProtocolVersion = 1;

	public const string ServiceName = "EgoistShieldCore";

	public const string PipeName = "EgoistShield.Service.v1";

	public const int MaxRequestBytes = 65536;

	public const int MaxRequestIdLength = 128;

	public const int MaxConcurrentClients = 8;

	public static readonly TimeSpan ClientIoTimeout = TimeSpan.FromSeconds(3L);

	public static readonly TimeSpan MutationLockTimeout = TimeSpan.FromSeconds(15L);

	public static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(30L);

	public static readonly TimeSpan PowerShellTimeout = TimeSpan.FromMinutes(2);

	public static readonly TimeSpan ServiceTransitionTimeout = TimeSpan.FromSeconds(60L);

	public static readonly TimeSpan RollbackGracePeriod = TimeSpan.FromMinutes(5);
}
