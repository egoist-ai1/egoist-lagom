using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class ServiceConfiguration
{
	private const string FileName = "service-config.json";

	public static async Task<ServiceConfig?> ReadAsync(string stateRoot, CancellationToken cancellationToken = default)
		=> (await ReadResultAsync(stateRoot, cancellationToken)).ValueOrThrow(FileName);

	internal static async Task<AtomicJsonReadResult<ServiceConfig>> ReadResultAsync(string stateRoot,
		CancellationToken cancellationToken = default)
	{
		var result = await AtomicJsonFile.ReadResultAsync<ServiceConfig>(Path.Combine(stateRoot, FileName), cancellationToken);
		if (result.Kind != AtomicJsonReadKind.Valid) return result;
		var config = result.Value!;
		try
		{
			if (config.SchemaVersion != 1 || config.Owner != "EgoistShield" || config.UpdatedAt == default ||
				string.IsNullOrWhiteSpace(config.InstallRoot) || !Path.IsPathFullyQualified(config.InstallRoot))
				throw new ArgumentException("Invalid service configuration identity.");
			string normalized = Path.TrimEndingDirectorySeparator(Path.GetFullPath(config.InstallRoot));
			if (!normalized.Equals(Path.TrimEndingDirectorySeparator(config.InstallRoot), StringComparison.OrdinalIgnoreCase))
				throw new ArgumentException("The configured install root is not canonical.");
			ClientAuthorizer.EnsureProgramFilesRoot(normalized);
		}
		catch (Exception error) when (error is ArgumentException or NotSupportedException or InvalidOperationException)
		{
			return result with { Kind = AtomicJsonReadKind.Corrupt, Value = null, ErrorCode = "CONFIG_IDENTITY_INVALID" };
		}
		return result;
	}

	public static async Task WriteAsync(string stateRoot, string installRoot, CancellationToken cancellationToken = default(CancellationToken))
	{
		string normalized = Path.GetFullPath(installRoot);
		ClientAuthorizer.EnsureProgramFilesRoot(normalized);
		await ProtectedProductRoot.HardenAsync(stateRoot, cancellationToken);
		await AtomicJsonFile.WriteAsync(Path.Combine(stateRoot, "service-config.json"), new ServiceConfig(1, "EgoistShield", normalized, DateTimeOffset.UtcNow), cancellationToken);
	}
}
