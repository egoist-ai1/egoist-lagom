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
		ServiceConfig config = await ServiceConfiguration.ReadAsync(options.StateRoot, cancellationToken);
		string text = config?.InstallRoot ?? options.InstallRoot;
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
		OperationDispatcher dispatcher = new OperationDispatcher(executionOptions, dns, nativeDoh, services, journal, log);
		ClientAuthorizer authorizer = new ClientAuthorizer(options, config);
		PipeServer pipeServer = new PipeServer(options, authorizer, dispatcher, log);
		return new ServiceEngine(options, log, dispatcher, pipeServer);
	}

	public async Task RunAsync(CancellationToken cancellationToken)
	{
		await _log.InfoAsync($"Starting {"EgoistShieldCore"} {BuildInfo.Version}; pipe={_options.PipeName}.", cancellationToken);
		try
		{
			await _dispatcher.RecoverOnStartupAsync(cancellationToken);
			await _pipeServer.RunAsync(cancellationToken);
		}
		finally
		{
			_dispatcher.Dispose();
			await _log.InfoAsync("Service stopped.", CancellationToken.None);
		}
	}

	public Task RecoverOnlyAsync(CancellationToken cancellationToken = default(CancellationToken))
	{
		return _dispatcher.RecoverOnStartupAsync(cancellationToken);
	}

	public async Task RestoreOwnedDnsForUninstallAsync(CancellationToken cancellationToken = default)
	{
		try
		{
			await _dispatcher.RecoverOnStartupAsync(cancellationToken);
			var request = new ServiceRequest(1, "uninstall-dns:" + Guid.NewGuid().ToString("N"), "dns.restore-owned", JsonDefaults.ToElement(new { }));
			var identity = new ClientIdentity(Environment.ProcessId, Environment.ProcessPath ?? "", false, "S-1-5-18");
			var response = await _dispatcher.DispatchAsync(request, identity, cancellationToken);
			if (!response.Ok) throw new InvalidOperationException(response.Error?.Message ?? "DNS restoration failed.");
			var result = JsonDefaults.ToElement(response.Result);
			if (result.TryGetProperty("pendingAdapters", out var pending) && pending.GetInt32() > 0) throw new InvalidOperationException("Reconnect absent adapters before uninstalling the DNS resolver.");
		}
		finally { _dispatcher.Dispose(); }
	}
}
