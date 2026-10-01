using System;
using System.IO;
using System.Threading;

namespace EgoistShield.Service;

internal sealed record WrapperLogMaintenanceResult(bool Checked, int Rotated, int Deferred, int Rejected);

internal sealed class OwnedWrapperLogMaintenance
{
	internal const long RotationThresholdBytes = 5 * 1024 * 1024;
	internal static readonly TimeSpan CheckInterval = TimeSpan.FromMinutes(5);
	private static readonly string[] RelativeLogPaths =
	{
		Path.Combine("Runtime", "SystemDoH", "service-logs", "egoistshield-system-doh-service.wrapper.log"),
		Path.Combine("Runtime", "TelegramProxy", "service-logs", "egoistshield-telegram-proxy-service.wrapper.log"),
		Path.Combine("Runtime", "Zapret", "logs", "zapret-service", "egoistshield-zapret-service.wrapper.log")
	};
	private readonly string _productRoot;
	private readonly string _trustedAnchor;
	private readonly object _gate = new object();
	private TimeSpan? _lastCheck;

	private OwnedWrapperLogMaintenance(string productRoot, string trustedAnchor)
	{
		_productRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(productRoot));
		_trustedAnchor = Path.TrimEndingDirectorySeparator(Path.GetFullPath(trustedAnchor));
	}

	// ServiceEngine clears InstallRoot if ProgramData hardening fails. The
	// dispatcher creates this guard only after that verification, outside lab mode.
	internal static OwnedWrapperLogMaintenance ForVerifiedProductionRoot(string stateRoot)
	{
		string commonData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
		if (string.IsNullOrWhiteSpace(commonData)) throw new UnauthorizedAccessException("ProgramData is unavailable.");
		string productRoot = Path.GetFullPath(Path.Combine(commonData, "EgoistShield"));
		string expectedStateRoot = Path.Combine(productRoot, "Service");
		if (!Path.TrimEndingDirectorySeparator(Path.GetFullPath(stateRoot)).Equals(expectedStateRoot, StringComparison.OrdinalIgnoreCase))
			throw new UnauthorizedAccessException("Wrapper log maintenance requires the verified production state root.");
		return new OwnedWrapperLogMaintenance(productRoot, commonData);
	}

	internal WrapperLogMaintenanceResult RunIfDue(TimeSpan elapsed, CancellationToken cancellationToken)
	{
		lock (_gate)
		{
			cancellationToken.ThrowIfCancellationRequested();
			if (_lastCheck != null && elapsed - _lastCheck.Value < CheckInterval)
				return new WrapperLogMaintenanceResult(false, 0, 0, 0);
			_lastCheck = elapsed;
			try { AssertRoot(); }
			catch (UnauthorizedAccessException) { return new WrapperLogMaintenanceResult(true, 0, 0, RelativeLogPaths.Length); }
			catch (IOException) { return new WrapperLogMaintenanceResult(true, 0, RelativeLogPaths.Length, 0); }
			int rotated = 0, deferred = 0, rejected = 0;
			foreach (string relativePath in RelativeLogPaths)
			{
				cancellationToken.ThrowIfCancellationRequested();
				try
				{
					string logPath = Path.Combine(_productRoot, relativePath);
					string previousPath = logPath + ".previous";
					TrustedPath.AssertPathUnderRoot(logPath, _productRoot, requireLeaf: false);
					TrustedPath.AssertPathUnderRoot(previousPath, _productRoot, requireLeaf: false);
					if (!File.Exists(logPath) || new FileInfo(logPath).Length < RotationThresholdBytes) continue;
					// MinimalLock releases its handle after each append. Rename only
					// between events; a sharing violation defers to the next check.
					// Never truncate a held file or interfere with the wrapper process.
					AssertRoot();
					TrustedPath.AssertPathUnderRoot(logPath, _productRoot, requireLeaf: true);
					TrustedPath.AssertPathUnderRoot(previousPath, _productRoot, requireLeaf: false);
					try
					{
						File.Move(logPath, previousPath, overwrite: true);
						rotated++;
					}
					catch (UnauthorizedAccessException) { deferred++; }
				}
				catch (FileNotFoundException) { }
				catch (DirectoryNotFoundException) { }
				catch (UnauthorizedAccessException) { rejected++; }
				catch (IOException) { deferred++; }
			}
			return new WrapperLogMaintenanceResult(true, rotated, deferred, rejected);
		}
	}

	private void AssertRoot()
	{
		TrustedPath.AssertPathUnderRoot(_productRoot, _trustedAnchor, requireLeaf: true);
		TrustedPath.AssertPathUnderRoot(_trustedAnchor, Path.GetPathRoot(_trustedAnchor)!, requireLeaf: true);
	}
}
