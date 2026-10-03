using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed class ServiceEngine
{
	private readonly ServiceOptions _options;

	private readonly ServiceLog _log;

	private readonly OperationDispatcher _dispatcher;

	private readonly PipeServer _pipeServer;

	private ServiceEngine(ServiceOptions options, ServiceLog log, OperationDispatcher dispatcher, PipeServer pipeServer)
	{
		_options = options;
		_log = log;
		_dispatcher = dispatcher;
		_pipeServer = pipeServer;
	}

	public static async Task<ServiceEngine> CreateAsync(ServiceOptions options, CancellationToken cancellationToken = default(CancellationToken))
	{
		Directory.CreateDirectory(options.StateRoot);
		ServiceLog log = new ServiceLog(options.StateRoot);
		bool protectedRootVerified = true;
		try
		{
			await ProtectedProductRoot.HardenAsync(options.StateRoot, cancellationToken);
		}
		catch (Exception ex)
		{
			protectedRootVerified = false;
			await log.ErrorAsync("Protected product root is not verified: " + ex.Message + ". DNS operations continue; executing owned binaries stays blocked until the ACL is repaired.", cancellationToken);
		}
		if (protectedRootVerified)
		{
			try
			{
				int num = ProtectedProductRoot.CleanupDeferredInstallerBackups(options.StateRoot);
				if (num > 0)
				{
					await log.InfoAsync($"Removed {num} deferred installer backup(s).", cancellationToken);
				}
			}
			catch (Exception ex2)
			{
				await log.WarnAsync("Deferred installer backup cleanup will be retried: " + ex2.Message, cancellationToken);
			}
		}
		ServiceConfig? config = null;
		StateReadException? configurationError = null;
		try { config = (await ServiceConfiguration.ReadResultAsync(options.StateRoot, cancellationToken)).ValueOrThrow("service-config.json"); }
		catch (StateReadException error)
		{
			configurationError = error;
			await log.ErrorAsync("Core configuration is unavailable for execution; read-only diagnostics will preserve it: " + error.Message, cancellationToken);
		}
		string? text = configurationError == null ? config?.InstallRoot ?? options.InstallRoot : null;
		if (!string.IsNullOrWhiteSpace(text) && !options.ConsoleMode)
		{
			try
			{
				ClientAuthorizer.EnsureProgramFilesRoot(text);
			}
			catch (Exception ex3)
			{
				await log.ErrorAsync($"Install root {text} is not under Program Files ({ex3.Message}); " + "owned service control is disabled for this session.", cancellationToken);
				text = null;
			}
		}
		OwnedServiceController services = (string.IsNullOrWhiteSpace(text) ? null : new OwnedServiceController(text, ProtectedProductRoot.Resolve(options.StateRoot), protectedRootVerified));
		TransactionJournal journal = new TransactionJournal(options.StateRoot);
		WindowsDnsController dns = new WindowsDnsController();
		WindowsNativeDohController nativeDoh = new WindowsNativeDohController(options.StateRoot);
		ServiceOptions executionOptions = options with { InstallRoot = protectedRootVerified ? text : null };
		OperationDispatcher dispatcher = new OperationDispatcher(executionOptions, dns, nativeDoh, services, journal, log,
			startupStateError: configurationError);
		// A damaged config cannot supply GUI authority. Only the actual installed Core
		// executable may establish its diagnostic root; normal GUI verification still applies.
		ServiceOptions authorizationOptions = configurationError == null ? options : options with
		{
			InstallRoot = ResolveDiagnosticInstallRoot(Environment.ProcessPath)
		};
		ClientAuthorizer authorizer = new ClientAuthorizer(authorizationOptions, config);
		PipeServer pipeServer = new PipeServer(options, authorizer, dispatcher, log);
		return new ServiceEngine(options, log, dispatcher, pipeServer);
	}

	internal static string? ResolveDiagnosticInstallRoot(string? executable)
	{
		if (string.IsNullOrWhiteSpace(executable)) return null;
		try
		{
			string path = Path.GetFullPath(executable);
			if (!Path.GetFileName(path).Equals("EgoistShield.Service.exe", StringComparison.OrdinalIgnoreCase)) return null;
			DirectoryInfo? cursor = Directory.GetParent(path);
			foreach (string expected in new[] { "win-x64", "core-service", "resources" })
			{
				if (cursor == null || !cursor.Name.Equals(expected, StringComparison.OrdinalIgnoreCase)) return null;
				cursor = cursor.Parent;
			}
			if (cursor == null) return null;
			ClientAuthorizer.EnsureProgramFilesRoot(cursor.FullName);
			TrustedPath.AssertPathUnderRoot(path, Path.GetPathRoot(path)!, requireLeaf: true);
			return cursor.FullName;
		}
		catch (Exception error) when (error is ArgumentException or NotSupportedException or InvalidOperationException or IOException or UnauthorizedAccessException)
		{
			return null;
		}
	}

	public async Task RunAsync(CancellationToken cancellationToken)
	{
		await _log.InfoAsync($"Starting {"EgoistShieldCore"} {BuildInfo.Version}; pipe={_options.PipeName}.", cancellationToken);
		using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
		Task? listener = null;
		Task? startupAndSupervision = null;
		_dispatcher.SetStartupRecoveryPending(true);
		try
		{
			// Authenticated hello/status must remain available while an installer
			// owns the maintenance barrier. The dispatcher still refuses execution.
			listener = _pipeServer.RunAsync(lifetime.Token);
			startupAndSupervision = CompleteStartupAndSuperviseAsync(lifetime.Token);
			Task completed = await Task.WhenAny(listener, startupAndSupervision);
			await completed;
			if (completed == startupAndSupervision) await listener;
		}
		finally
		{
			lifetime.Cancel();
			foreach (Task? task in new[] { listener, startupAndSupervision })
			{
				if (task == null) continue;
				try { await task; }
				catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
				catch (Exception error)
				{
					await _log.WarnAsync("Core lifetime task ended with " + error.GetType().Name + ": " + error.Message, CancellationToken.None);
				}
			}
			_dispatcher.Dispose();
			await _log.InfoAsync("Service stopped.", CancellationToken.None);
		}
	}

	private async Task CompleteStartupAndSuperviseAsync(CancellationToken cancellationToken)
	{
		await _dispatcher.WaitForInstallerMaintenanceAsync(cancellationToken);
		await _dispatcher.RecoverOnStartupAsync(cancellationToken);
		_dispatcher.SetStartupRecoveryPending(false);
		await _dispatcher.RunSupervisionAsync(cancellationToken);
	}

	public async Task RecoverOnlyAsync(CancellationToken cancellationToken = default(CancellationToken))
	{
		await _dispatcher.RecoverOnStartupAsync(cancellationToken);
		var persistence = JsonDefaults.ToElement(await _dispatcher.DescribePersistenceAsync(cancellationToken));
		if (!persistence.GetProperty("mutationReady").GetBoolean())
			throw new InvalidOperationException("Core recovery remains unresolved; diagnostic startup does not authorize installer recovery completion.");
	}

	public async Task RestoreOwnedDnsForUninstallAsync(CancellationToken cancellationToken = default)
	{
		try
		{
			await _dispatcher.RecoverOnStartupAsync(cancellationToken);
			var identity = new ClientIdentity(Environment.ProcessId, Environment.ProcessPath ?? "", false, "S-1-5-18");
			var response = await _dispatcher.RestoreOwnedDnsOfflineAsync(identity, cancellationToken);
			if (!response.Ok) throw new InvalidOperationException(response.Error?.Message ?? "DNS restoration failed.");
			var result = JsonDefaults.ToElement(response.Result);
			if (result.TryGetProperty("pendingAdapters", out var pending) && pending.GetInt32() > 0) throw new InvalidOperationException("Reconnect absent adapters before uninstalling the DNS resolver.");
		}
		finally { _dispatcher.Dispose(); }
	}
}
