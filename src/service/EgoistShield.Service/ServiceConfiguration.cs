using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class ServiceConfiguration
{
	private const string FileName = "service-config.json";

	public static Task<ServiceConfig?> ReadAsync(string stateRoot, CancellationToken cancellationToken = default(CancellationToken))
	{
		return AtomicJsonFile.ReadAsync<ServiceConfig>(Path.Combine(stateRoot, "service-config.json"), cancellationToken);
	}

	public static async Task WriteAsync(string stateRoot, string installRoot, CancellationToken cancellationToken = default(CancellationToken))
	{
		string normalized = Path.GetFullPath(installRoot);
		ClientAuthorizer.EnsureProgramFilesRoot(normalized);
		await ProtectedProductRoot.HardenAsync(stateRoot, cancellationToken);
		await AtomicJsonFile.WriteAsync(Path.Combine(stateRoot, "service-config.json"), new ServiceConfig(1, "EgoistShield", normalized, DateTimeOffset.UtcNow), cancellationToken);
	}
}
