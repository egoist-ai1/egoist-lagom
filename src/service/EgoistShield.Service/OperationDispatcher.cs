using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed class OperationDispatcher : IDisposable
{
	private sealed record CachedResponse(string Fingerprint, ServiceResponse Response, DateTimeOffset CompletedAt, int Bytes);

	private sealed record NativeDohHealth(NativeDohOwnedState? State, DnsAdapterSnapshot[] Adapters, NativeDohEntrySnapshot[] Entries, bool EntriesMatch, bool DnsOwned);

	private static readonly HashSet<string> MutationOperations = new HashSet<string>(StringComparer.Ordinal)
	{
		"dns.apply", "dns.reset", "dns.restore-owned", "dns.doh.apply", "dns.doh.remove", "owned-service.install", "owned-service.remove", "owned-service.start", "owned-service.stop", "zapret.profile.set", "network.repair-owned",
		"test.delay-mutation", "component.execute"
	};

	private readonly ServiceOptions _options;

	private readonly WindowsDnsController _dns;

	private readonly WindowsNativeDohController _nativeDoh;

	private readonly OwnedServiceController? _services;

	private readonly TransactionJournal _journal;
	private readonly StateReadException? _startupStateError;

	private readonly ServiceLog _log;

	private readonly string _dnsOwnedStatePath;

	private readonly SemaphoreSlim _mutationLock = new SemaphoreSlim(1, 1);

	private readonly ConcurrentDictionary<string, CachedResponse> _responses = new ConcurrentDictionary<string, CachedResponse>(StringComparer.Ordinal);

	private readonly ConcurrentDictionary<string, byte> _inFlight = new ConcurrentDictionary<string, byte>(StringComparer.Ordinal);

	private long _sequence;
	private readonly Lazy<ComponentWorker> _componentWorker;
	private readonly Func<JsonElement, bool, CancellationToken, Task<JsonElement>> _executeComponent;
	private readonly OwnedServiceIntentStore _serviceIntents;
	private readonly InstallerServiceMaintenance _installerMaintenance;
	private readonly OwnedServiceSupervisor? _serviceSupervisor;
	private readonly DnsBootstrapRefreshScheduler _bootstrapRefresh;
	private readonly OwnedWrapperLogMaintenance? _wrapperLogMaintenance;
	private WindowsServiceListenerSnapshot? _telegramListenerSnapshot;
	private readonly Stopwatch _maintenanceClock = Stopwatch.StartNew();
	private TimeSpan _nextDnsMaintenance;
	private TimeSpan _nextDnsAudit;
	private int _dnsMaintenanceRequested = 1;
	private TimeSpan _nextWrapperLogWarning;
	private readonly object _responseCacheLock = new();
	private const long MaxResponseCacheBytes = 8 * 1024 * 1024;
	private const int MaxCachedResponseBytes = 256 * 1024;

	public OperationDispatcher(ServiceOptions options, WindowsDnsController dns, WindowsNativeDohController nativeDoh, OwnedServiceController? services, TransactionJournal journal, ServiceLog log,
		Func<JsonElement, bool, CancellationToken, Task<JsonElement>>? componentExecutor = null, StateReadException? startupStateError = null)
	{
		_options = options;
		_dns = dns;
		_nativeDoh = nativeDoh;
		_services = services;
		_journal = journal;
		_startupStateError = startupStateError;
		_log = log;
		_dnsOwnedStatePath = Path.Combine(options.StateRoot, "dns-owned-state.json");
		_componentWorker = new Lazy<ComponentWorker>(() => new ComponentWorker(options.InstallRoot ?? throw new InvalidOperationException("Component operations require an installed product.")));
		_executeComponent = componentExecutor ?? ((payload, query, token) => _componentWorker.Value.ExecuteAsync(payload, query, token));
		_serviceIntents = new OwnedServiceIntentStore(options.StateRoot);
		_installerMaintenance = new InstallerServiceMaintenance(options.StateRoot);
		_bootstrapRefresh = new DnsBootstrapRefreshScheduler(options.StateRoot);
		if (services != null && options.InstallRoot != null && !options.ConsoleMode)
		{
			if (ProtectedProductRoot.IsProductionShape(options.StateRoot))
				_wrapperLogMaintenance = OwnedWrapperLogMaintenance.ForVerifiedProductionRoot(options.StateRoot);
			_serviceSupervisor = new OwnedServiceSupervisor(_serviceIntents, services.StatusAsync,
				services.AssertOwnedImagePathAsync, ProbeOwnedServiceAsync,
				async (name, running, token) =>
				{
					if (running) await services.StopAsync(name, token);
					await services.StartAsync(name, token);
				}, message => _log.WarnAsync(message), NetworkInterface.GetIsNetworkAvailable,
				repairRecovery: services.RepairRecoveryAsync);
			NetworkChange.NetworkAddressChanged += OnNetworkAddressChanged;
		}
	}

	internal async Task RunSupervisionAsync(CancellationToken cancellationToken)
	{
		if (_serviceSupervisor == null) return;
		using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
		DateTimeOffset? lastWarning = null;
		while (await timer.WaitForNextTickAsync(cancellationToken))
		{
			if (!await _mutationLock.WaitAsync(0, cancellationToken)) continue;
			try
			{
				if (_installerMaintenance.IsActive() || _startupStateError != null) continue;
				// A crash marker is recovered by the transaction path, never bypassed
				// by an independent health repair during partial network mutation.
				if ((await _journal.ReadActiveResultAsync(cancellationToken)).Kind != AtomicJsonReadKind.Missing) continue;
				await _journal.ReadResponsesAsync(cancellationToken);
				if ((await ReconcileCompletedOperationIntentsAsync(cancellationToken)).Count != 0) continue;
				TimeSpan now = _maintenanceClock.Elapsed;
				await MaintainOwnedWrapperLogsAsync(now, cancellationToken);
				await _serviceSupervisor.CheckAsync(cancellationToken);
				if (now >= TimeSpan.FromSeconds(60)) await RefreshOwnedDnsBootstrapAsync(cancellationToken);
				if (now >= TimeSpan.FromSeconds(60) && now >= _nextDnsMaintenance &&
					(Volatile.Read(ref _dnsMaintenanceRequested) != 0 || now >= _nextDnsAudit))
				{
					_nextDnsMaintenance = now + TimeSpan.FromMinutes(1);
					_nextDnsAudit = now + TimeSpan.FromMinutes(10);
					Interlocked.Exchange(ref _dnsMaintenanceRequested, 0);
					try { await MaintainOwnedDnsAsync(cancellationToken); }
					catch { Interlocked.Exchange(ref _dnsMaintenanceRequested, 1); throw; }
				}
			}
			catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
			catch (Exception error)
			{
				if (lastWarning == null || DateTimeOffset.UtcNow - lastWarning >= TimeSpan.FromMinutes(5))
				{
					await _log.WarnAsync("Background service supervision deferred: " + error.Message, cancellationToken);
					lastWarning = DateTimeOffset.UtcNow;
				}
			}
			finally { _mutationLock.Release(); }
		}
	}

	private async Task MaintainOwnedWrapperLogsAsync(TimeSpan now, CancellationToken cancellationToken)
	{
		if (_wrapperLogMaintenance == null) return;
		try
		{
			var result = _wrapperLogMaintenance.RunIfDue(now, cancellationToken);
			if (result.Deferred == 0 && result.Rejected == 0) return;
			if (now < _nextWrapperLogWarning) return;
			_nextWrapperLogWarning = now + TimeSpan.FromHours(1);
			await _log.WarnAsync($"Owned wrapper log maintenance deferred: busy/unavailable={result.Deferred}; untrusted={result.Rejected}. Services continue without interruption.", cancellationToken);
		}
		catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
		catch (Exception)
		{
			// Log maintenance must not prevent independent service/DNS checks.
			if (now < _nextWrapperLogWarning) return;
			_nextWrapperLogWarning = now + TimeSpan.FromHours(1);
			try { await _log.WarnAsync("Owned wrapper log maintenance is temporarily unavailable; service/DNS checks continue.", cancellationToken); }
			catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
			catch (Exception) { }
		}
	}

	private void OnNetworkAddressChanged(object? sender, EventArgs args) => Interlocked.Exchange(ref _dnsMaintenanceRequested, 1);

	internal async Task RefreshOwnedDnsBootstrapAsync(CancellationToken cancellationToken)
	{
		if (!NetworkInterface.GetIsNetworkAvailable()) return;
		var native = await _nativeDoh.ReadOwnedStateAsync(cancellationToken);
		ValidateNativeDohOwnedState(native);
		if (native != null)
		{
			await _bootstrapRefresh.RunIfDueAsync("native", native.Url, async token =>
			{
				if (!WindowsNativeDohController.EntriesMatch(await _nativeDoh.ReadEntriesAsync(native.Servers, token), native))
					throw new InvalidOperationException("Native bootstrap refresh deferred because owned DoH registrations changed.");
				var baseline = native.OriginalDnsAdapters ?? Array.Empty<DnsAdapterSnapshot>();
				if (baseline.Length == 0) throw new InvalidOperationException("Native bootstrap refresh requires a recorded adapter baseline.");
				// Resolve by GUID including disconnected devices; removal of a
				// physical device defers rotation rather than deleting its template.
				var present = await _dns.ReadPresentSnapshotAsync(baseline, token);
				if (present.Length != baseline.Length) throw new InvalidOperationException("Native bootstrap refresh deferred until recorded adapters are present.");
				var targets = present.Where(adapter => DnsMatchesServers(new[] { adapter }, native.Servers)).ToArray();
				var stillOwned = NativeDohRestoreTargets(native, present);
				if (targets.Length == 0 || targets.Length != stillOwned.Length)
					throw new InvalidOperationException("Native bootstrap refresh preserved externally changed adapter DNS.");
				bool ipv6 = native.Servers.Any(server => IPAddress.Parse(server).AddressFamily == AddressFamily.InterNetworkV6) &&
					await _nativeDoh.HasIpv6DefaultRouteAsync(token);
				var resolved = await _executeComponent(JsonDefaults.ToElement(new { component = "SystemDoH", method = "bootstrapServers", args = new object[] { native.Url, ipv6 } }), true, token);
				if (resolved.ValueKind != JsonValueKind.Object || resolved.GetProperty("url").GetString() != native.Url)
					throw new InvalidOperationException("DNS bootstrap worker returned a different provider URL.");
				var servers = WindowsDnsController.ValidateServers(resolved.GetProperty("servers").Deserialize<string[]>(JsonDefaults.Options) ?? Array.Empty<string>());
				if (resolved.GetProperty("knownProvider").GetBoolean() || servers.ToHashSet(StringComparer.OrdinalIgnoreCase).SetEquals(native.Servers)) return;
				var request = new ServiceRequest(1, "bootstrap:" + Guid.NewGuid().ToString("N"), "dns.doh.apply", JsonDefaults.ToElement(new { url = native.Url, servers, probeHosts = Array.Empty<string>() }));
				long sequence = Interlocked.Increment(ref _sequence);
				ServiceResponse response;
				try { response = ServiceResponse.Success(request.RequestId, sequence, await ExecuteNativeDohApplyAsync(request, sequence, token, targets)); }
				catch (Exception error) { response = CreateFailureResponse(request.RequestId, sequence, error); }
				await PersistMutationResponseAsync(request, Fingerprint(request), response, CancellationToken.None);
				if (!response.Ok) throw new InvalidOperationException(response.Error?.Message ?? "Native bootstrap rotation failed.");
				await _log.InfoAsync("Rotated custom native DoH bootstrap addresses after owned adapter readback; mode was preserved.", token);
			}, cancellationToken);
			return;
		}
		var ownership = await ReadDnsOwnedStateAsync(cancellationToken);
		ownership?.Validate();
		if (ownership == null || !ownership.Servers.All(server => IPAddress.IsLoopback(IPAddress.Parse(server)))) return;
		var intents = await _serviceIntents.ReadAsync(cancellationToken);
		if (!intents.Services.TryGetValue("EgoistShieldSystemDoH", out var intent) || !intent.Running) return;
		string productRoot = ProtectedProductRoot.Resolve(_options.StateRoot);
		string statePath = Path.Combine(productRoot, "Runtime", "SystemDoH", "state.json");
		TrustedPath.AssertPathUnderRoot(statePath, productRoot, true);
		var state = await AtomicJsonFile.ReadAsync<JsonElement>(statePath, cancellationToken);
		if (state.ValueKind != JsonValueKind.Object || !state.TryGetProperty("url", out var currentUrl) || string.IsNullOrWhiteSpace(currentUrl.GetString())) return;
		await _bootstrapRefresh.RunIfDueAsync("local", currentUrl.GetString()!, async token =>
		{
			var service = await RequireServiceController().StatusAsync("EgoistShieldSystemDoH", token);
			if (!service.Installed || service.State != "running" || service.StartType != "auto")
				throw new InvalidOperationException("Local bootstrap refresh deferred until the intended automatic DNS service is running.");
			await RequireServiceController().AssertOwnedImagePathAsync(service.ServiceName, token);
			if (await ProbeOwnedServiceAsync(service.ServiceName, token) != LocalServiceHealth.Responsive)
				throw new InvalidOperationException("Local bootstrap refresh deferred until the owned DNS listener is responsive.");
			var result = await _executeComponent(JsonDefaults.ToElement(new { component = "SystemDoH", method = "refreshBootstrap", args = Array.Empty<object>() }), false, token);
			if (result.ValueKind != JsonValueKind.Object || !result.TryGetProperty("changed", out var changed))
				throw new InvalidOperationException("DNS bootstrap refresh returned an invalid result.");
			if (changed.ValueKind == JsonValueKind.True) await _log.InfoAsync("Refreshed custom local DoH bootstrap addresses after listener verification; mode was preserved.", token);
		}, cancellationToken);
	}

	private async Task MaintainOwnedDnsAsync(CancellationToken cancellationToken)
	{
		if (!NetworkInterface.GetIsNetworkAvailable()) return;
		var native = await _nativeDoh.ReadOwnedStateAsync(cancellationToken);
		ValidateNativeDohOwnedState(native);
		var local = native == null ? await ReadDnsOwnedStateAsync(cancellationToken) : null;
		local?.Validate();
		if (native == null && (local == null || !local.Servers.All(server => IPAddress.IsLoopback(IPAddress.Parse(server))))) return;
		if (native == null)
		{
			var intents = await _serviceIntents.ReadAsync(cancellationToken);
			if (intents.Services.TryGetValue("EgoistShieldSystemDoH", out var intent) && !intent.Running) return;
			var status = await RequireServiceController().StatusAsync("EgoistShieldSystemDoH", cancellationToken);
			if (!status.Installed || status.State != "running" ||
				await ProbeOwnedServiceAsync("EgoistShieldSystemDoH", cancellationToken) != LocalServiceHealth.Responsive) return;
		}
		else
		{
			var entries = await _nativeDoh.ReadEntriesAsync(native.Servers, cancellationToken);
			if (entries.Any(entry => entry.Existed && (!string.Equals(entry.DohTemplate, native.Url, StringComparison.OrdinalIgnoreCase) || entry.AllowFallbackToUdp || !entry.AutoUpgrade)))
				return; // External template changes are never repaired over.
			var missing = entries.Where(entry => !entry.Existed).Select(entry => entry.ServerAddress).ToArray();
			if (missing.Length > 0)
			{
				await _nativeDoh.ConfigureAsync(native.Url, missing, cancellationToken);
				await _log.InfoAsync("Restored missing owned native DoH registrations; adapter DNS was preserved.", cancellationToken);
			}
		}
		var current = await _dns.ReadSnapshotAsync(cancellationToken);
		var targets = DnsMaintenancePolicy.NewAutomaticAdapters(current, native?.OriginalDnsAdapters ?? local?.OriginalAdapters ?? Array.Empty<DnsAdapterSnapshot>());
		if (targets.Length == 0) return;
		string operation = native == null ? "dns.apply" : "dns.doh.apply";
		object payload = native == null ? new { servers = local!.Servers, probeHosts = Array.Empty<string>() } :
			new { url = native.Url, servers = native.Servers, probeHosts = Array.Empty<string>() };
		var request = new ServiceRequest(1, "maintenance:" + Guid.NewGuid().ToString("N"), operation, JsonDefaults.ToElement(payload));
		long sequence = Interlocked.Increment(ref _sequence);
		ServiceResponse response;
		try
		{
			object result = native == null ? await ExecuteDnsApplyAsync(request, sequence, cancellationToken, targets) :
				await ExecuteNativeDohApplyAsync(request, sequence, cancellationToken, targets);
			response = ServiceResponse.Success(request.RequestId, sequence, result);
		}
		catch (Exception error) { response = CreateFailureResponse(request.RequestId, sequence, error); }
		await PersistMutationResponseAsync(request, Fingerprint(request), response, CancellationToken.None);
		if (!response.Ok) throw new InvalidOperationException(response.Error?.Message ?? "Owned DNS maintenance failed.");
		await _log.InfoAsync($"Enrolled {targets.Length} new automatic DNS adapter(s) using the saved owned provider; existing adapter settings were preserved.", cancellationToken);
	}

	private async Task<LocalServiceHealth> ProbeOwnedServiceAsync(string serviceName, CancellationToken cancellationToken)
	{
		if (serviceName == "EgoistShieldZapret") return LocalServiceHealth.ScmOnly;
		if (serviceName == "EgoistShieldVpn")
			return await VpnServiceHealthProbe.ProbeAsync(ProtectedProductRoot.Resolve(_options.StateRoot), RequireServiceController(), cancellationToken);
		string component = serviceName == "EgoistShieldSystemDoH" ? "SystemDoH" : "TelegramProxy";
		string productRoot = ProtectedProductRoot.Resolve(_options.StateRoot);
		string file = Path.Combine(productRoot, "Runtime", component,
			component == "SystemDoH" ? "state.json" : "config.json");
		if (!File.Exists(file)) return LocalServiceHealth.Unknown;
		TrustedPath.AssertPathUnderRoot(file, productRoot, requireLeaf: true);
		var config = await AtomicJsonFile.ReadAsync<JsonElement>(file, cancellationToken);
		string hostKey = component == "SystemDoH" ? "localAddress" : "host";
		string portKey = component == "SystemDoH" ? "localPort" : "port";
		if (config.ValueKind != JsonValueKind.Object || !config.TryGetProperty(hostKey, out var host) ||
			!IPAddress.TryParse(host.GetString(), out var address) || !IPAddress.IsLoopback(address) ||
			!config.TryGetProperty(portKey, out var portValue) || !portValue.TryGetInt32(out int port) || port < 1 || port > 65535)
			return LocalServiceHealth.Unknown;
		if (component == "SystemDoH")
		{
			string runtimeConfigPath = Path.Combine(productRoot, "Runtime", component, "config.json");
			TrustedPath.AssertPathUnderRoot(runtimeConfigPath, productRoot, requireLeaf: true);
			var runtimeConfig = await AtomicJsonFile.ReadAsync<JsonElement>(runtimeConfigPath, cancellationToken);
			if (runtimeConfig.ValueKind != JsonValueKind.Object || !runtimeConfig.TryGetProperty("dns", out var dns) ||
				!dns.TryGetProperty("hosts", out var hosts) || !hosts.TryGetProperty("health.egoist.invalid", out var healthHost) ||
				!(healthHost.ValueKind == JsonValueKind.String && healthHost.GetString() == "127.0.0.1" ||
					healthHost.ValueKind == JsonValueKind.Array && healthHost.EnumerateArray().Any(value => value.ValueKind == JsonValueKind.String && value.GetString() == "127.0.0.1")))
				return LocalServiceHealth.Unknown;
		}
		if (component == "SystemDoH")
			return await LocalServiceHealthProbe.DnsAsync(address, port, TimeSpan.FromSeconds(3), cancellationToken);
		_telegramListenerSnapshot ??= new WindowsServiceListenerSnapshot(serviceName);
		return await OwnedTcpListenerProbe.ProbeSnapshotAsync(RequireServiceController().ReadOwnedExecutablePath(serviceName, cancellationToken),
			address, port, TimeSpan.FromSeconds(8), token => _telegramListenerSnapshot.ReadAsync(port, token), cancellationToken);
	}

	private async Task<JsonElement> ExecuteComponentAsync(ServiceRequest request, CancellationToken cancellationToken)
	{
		bool query = request.Operation == "component.query";
		string component = request.Payload.GetProperty("component").GetString() ?? "";
		string method = request.Payload.GetProperty("method").GetString() ?? "";
		string serviceName = component switch
		{
			"SystemDoH" => "EgoistShieldSystemDoH", "Zapret" => "EgoistShieldZapret",
			"TelegramProxy" => "EgoistShieldTelegramProxy", "Vpn" => "EgoistShieldVpn", _ => ""
		};
		var args = request.Payload.GetProperty("args");
		bool localEnable = component == "SystemDoH" && !query && (method is "apply" or "restart" || method == "recover" &&
			args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && args[0].ValueKind == JsonValueKind.Object &&
			args[0].TryGetProperty("enabled", out var desiredEnabled) && desiredEnabled.ValueKind == JsonValueKind.True);
		if (localEnable && await _nativeDoh.ReadOwnedStateAsync(cancellationToken) != null)
			throw new ServiceOperationException("DNS_MODE_CONFLICT", "Native DoH is already enabled; its protected mode must be stopped before enabling the local DNS service.");
		bool off = !query && (method is "stop" or "stopService" or "removeService" or "stopAndRemove" ||
			component == "Zapret" && (method is "startStandalone" or "restartStandalone" or "resetNetworkState" ||
				method == "prepareForVpn" && args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && args[0].ValueKind == JsonValueKind.True) ||
			component == "SystemDoH" && method == "recover" && args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 &&
				args[0].ValueKind == JsonValueKind.Object && args[0].TryGetProperty("enabled", out var enabled) && enabled.ValueKind == JsonValueKind.False);
		if (off && serviceName.Length > 0) await _serviceIntents.SetRunningAsync(serviceName, false, cancellationToken);
		// The VPN runtime verifies explicit saved start intent before SCM launches it.
		bool vpnStart = !query && component == "Vpn" && (method is "installService" or "startService");
		OwnedServiceIntent? previousVpnIntent = null;
		if (vpnStart)
		{
			(await _serviceIntents.ReadAsync(cancellationToken)).Services.TryGetValue(serviceName, out previousVpnIntent);
			await _serviceIntents.SetRunningAsync(serviceName, true, cancellationToken);
		}
		JsonElement result;
		try
		{
			var correlated = JsonDefaults.ToElement(new { component, method, args, requestId = request.RequestId });
			result = await _executeComponent(correlated, query, cancellationToken);
		}
		catch (ServiceOperationException error) when (vpnStart && (error.Code is "VPN_SERVICE_VALIDATION_FAILED" or "VPN_SERVICE_ROLLBACK_VERIFIED"))
		{
			try { await _serviceIntents.RestoreRunningAsync(serviceName, previousVpnIntent, CancellationToken.None); }
			catch (Exception restoreError)
			{
				throw new ServiceOperationException("OPERATION_OUTCOME_UNKNOWN",
					"The VPN worker confirmed its rollback but Core could not confirm the prior background intent. Inspect operation.status before retrying.", false, restoreError);
			}
			throw;
		}
		catch (Exception error) when (vpnStart)
		{
			throw new ServiceOperationException("OPERATION_OUTCOME_UNKNOWN",
				"The VPN worker did not confirm its result or a verified rollback. The saved operation will not be replayed; inspect operation.status before retrying.", false, error);
		}
		catch (Exception error) when (!query && error is IOException or TimeoutException or OperationCanceledException)
		{
			throw new ServiceOperationException("OPERATION_OUTCOME_UNKNOWN",
				"The component worker did not confirm its result. The operation may have changed owned state; inspect operation.status before any retry.", false, error);
		}
		bool enablesService = !query && !off && (method is "start" or "startService" or "restart" or "apply" or "recover" or "installService" or "restoreAfterVpnIfNeeded");
		if (enablesService && _services != null && serviceName.Length > 0)
		{
			var status = await _services.StatusAsync(serviceName, cancellationToken);
			if (status.Installed && status.State == "running" && status.StartType == "auto")
			{
				await _services.AssertOwnedImagePathAsync(serviceName, cancellationToken);
				await _serviceIntents.SetRunningAsync(serviceName, true, cancellationToken);
			}
		}
		return result;
	}

	public Task<ServiceResponse> DispatchAsync(ServiceRequest request, ClientIdentity identity, CancellationToken cancellationToken = default(CancellationToken))
		=> DispatchRequestAsync(request, identity, false, cancellationToken);

	// Only the offline installer/uninstaller entry point can use this path. IPC
	// callers cannot select an operation or opt out of the maintenance barrier.
	internal Task<ServiceResponse> RestoreOwnedDnsOfflineAsync(ClientIdentity identity, CancellationToken cancellationToken = default)
		=> DispatchRequestAsync(new ServiceRequest(1, "uninstall-dns:" + Guid.NewGuid().ToString("N"),
			"dns.restore-owned", JsonDefaults.ToElement(new { })), identity, true, cancellationToken);

	private async Task<ServiceResponse> DispatchRequestAsync(ServiceRequest request, ClientIdentity identity, bool offlineDnsRestore, CancellationToken cancellationToken)
	{
		try { return await DispatchRequestCoreAsync(request, identity, offlineDnsRestore, cancellationToken); }
		catch (StateReadException error)
		{
			return ServiceResponse.Failure(request.RequestId, Interlocked.Increment(ref _sequence),
				error.Kind == AtomicJsonReadKind.Corrupt ? "STATE_CORRUPT" : "STATE_UNAVAILABLE", error.Message,
				retryable: error.Kind == AtomicJsonReadKind.Unavailable);
		}
	}

	private async Task<ServiceResponse> DispatchRequestCoreAsync(ServiceRequest request, ClientIdentity identity, bool offlineDnsRestore, CancellationToken cancellationToken)
	{
		long sequence = Interlocked.Increment(ref _sequence);
		if (identity.IdentityProbe && request.Operation != "hello")
		{
			return ServiceResponse.Failure(request.RequestId, sequence, "IDENTITY_PROBE_SCOPE", "The Core identity probe may call hello only.");
		}
		string fingerprint = Fingerprint(request);
		bool mutation = MutationOperations.Contains(request.Operation);
		if (_startupStateError != null && (mutation || request.Operation == "component.query"))
			throw _startupStateError;
		if (!offlineDnsRestore && _installerMaintenance.IsActive() && (mutation || request.Operation == "component.query"))
		{
			return ServiceResponse.Failure(request.RequestId, sequence, "INSTALLER_MAINTENANCE",
				"An installer is preserving owned services; retry after installation or recovery completes.", retryable: true);
		}
		if (request.Operation == "component.query")
		{
			var activeRead = await _journal.ReadActiveResultAsync(cancellationToken);
			if (activeRead.Kind is AtomicJsonReadKind.Corrupt or AtomicJsonReadKind.Unavailable)
				activeRead.ValueOrThrow("active-transaction.json");
			await _journal.ReadResponsesAsync(cancellationToken);
			await _journal.ReadOperationIntentsAsync(cancellationToken);
		}
		if (_responses.TryGetValue(request.RequestId, out CachedResponse value))
		{
			return (value.Fingerprint == fingerprint) ? value.Response : ServiceResponse.Failure(request.RequestId, sequence, "REQUEST_ID_REUSED", "The requestId was already used with a different request.");
		}
		if (mutation)
		{
			PersistedResponseEntry persistedResponseEntry = await _journal.ReadResponseAsync(request.RequestId, cancellationToken);
			if ((object)persistedResponseEntry != null)
			{
				if (persistedResponseEntry.Fingerprint != fingerprint)
					return ServiceResponse.Failure(request.RequestId, sequence, "REQUEST_ID_REUSED", "The requestId was already used with a different persisted mutation.");
				if (request.Operation == "component.execute")
					await _journal.RetireOperationIntentAsync(request.RequestId, fingerprint, cancellationToken);
				return persistedResponseEntry.Response;
			}
		}
		if (!_inFlight.TryAdd(request.RequestId, 0))
		{
			return ServiceResponse.Failure(request.RequestId, sequence, "REQUEST_IN_FLIGHT", "A request with the same requestId is still running.", retryable: true);
		}
		try
		{
			if (mutation)
			{
				return await DispatchMutationAsync(request, identity, sequence, fingerprint, offlineDnsRestore, cancellationToken);
			}
			ServiceResponse serviceResponse = await ExecuteAsync(request, identity, sequence, cancellationToken);
			if (serviceResponse.Error?.Code != "REQUEST_IN_FLIGHT")
			{
				CacheResponse(request.RequestId, fingerprint, serviceResponse);
			}
			TrimResponseCache();
			return serviceResponse;
		}
		finally
		{
			_inFlight.TryRemove(request.RequestId, out var _);
		}
	}

	public async Task RecoverOnStartupAsync(CancellationToken cancellationToken = default(CancellationToken))
	{
		await _mutationLock.WaitAsync(cancellationToken);
		try
		{
			// Validate durable replay state before any startup recovery can touch the OS.
			if (_startupStateError != null) throw _startupStateError;
			await _journal.ReadResponsesAsync(cancellationToken);
			var intents = await ReconcileCompletedOperationIntentsAsync(cancellationToken);
			ActiveTransaction transaction = await _journal.ReadActiveAsync(cancellationToken);
			foreach (var intent in intents)
			{
				await _log.WarnAsync("Component operation " + intent.RequestId + " has unknown outcome; startup recovery will not replay it.", cancellationToken);
			}
			if (intents.Count != 0) return;
			if ((object)transaction == null)
			{
				return;
			}
			TransactionPhase phase = transaction.Phase;
			if ((phase == TransactionPhase.Committed || phase == TransactionPhase.RolledBack) ? true : false)
			{
				await FinalizeTerminalTransactionAsync(transaction, cancellationToken);
				return;
			}
			bool flag = transaction.Phase == TransactionPhase.Verified;
			if (flag)
			{
				flag = await TryFinalizeVerifiedTransactionAsync(transaction, cancellationToken);
			}
			if (flag)
			{
				return;
			}
			await _log.WarnAsync($"Recovering transaction {transaction.TransactionId} at phase {transaction.Phase}.", cancellationToken);
			try
			{
				await RollbackAsync(transaction, new ServiceOperationException("RECOVERED_ON_STARTUP", "The interrupted system mutation was rolled back during service startup."), cancellationToken);
				ActiveTransaction activeTransaction = await _journal.ReadActiveAsync(CancellationToken.None);
				flag = (object)activeTransaction != null;
				if (flag)
				{
					phase = activeTransaction.Phase;
					bool flag2 = ((phase == TransactionPhase.Committed || phase == TransactionPhase.RolledBack) ? true : false);
					flag = flag2;
				}
				if (flag)
				{
					await FinalizeTerminalTransactionAsync(activeTransaction, CancellationToken.None);
				}
			}
			catch (Exception ex)
			{
				await _log.ErrorAsync("Startup recovery of " + transaction.TransactionId + " did not complete: " + ex.Message, cancellationToken);
			}
		}
		catch (StateReadException error)
		{
			await _log.ErrorAsync("Core started with read-only diagnostics: " + error.Message, cancellationToken);
		}
		catch (Exception error) when (error is IOException or UnauthorizedAccessException)
		{
			await _log.ErrorAsync("Core recovery persistence is unavailable; read-only diagnostics remain available: " + error.GetType().Name, cancellationToken);
		}
		finally
		{
			_mutationLock.Release();
		}
	}

	internal async Task WaitForInstallerMaintenanceAsync(CancellationToken cancellationToken)
	{
		while (_installerMaintenance.IsActive())
			await Task.Delay(250, cancellationToken);
	}

	// Callers hold the Core mutation slot. This only commits already confirmed
	// results; it never calls the executor or infers success from current status.
	internal async Task<IReadOnlyList<PersistedOperationIntent>> ReconcileCompletedOperationIntentsAsync(CancellationToken cancellationToken)
	{
		if (_startupStateError != null) throw _startupStateError;
		var intents = await _journal.ReadOperationIntentsAsync(cancellationToken);
		foreach (var intent in intents.Where(value => value.TerminalResponse != null))
		{
			await _journal.RecordResponseAsync(intent.RequestId, intent.Fingerprint, intent.TerminalResponse!, cancellationToken);
			await _journal.RetireOperationIntentAsync(intent.RequestId, intent.Fingerprint, cancellationToken);
		}
		return intents.Where(value => value.TerminalResponse == null).ToArray();
	}

	private async Task<ServiceResponse> DispatchMutationAsync(ServiceRequest request, ClientIdentity identity, long sequence, string fingerprint, bool offlineDnsRestore, CancellationToken cancellationToken)
	{
		bool isRepair = request.Operation == "network.repair-owned";
		TimeSpan lockTimeout = isRepair ? TimeSpan.FromSeconds(3) : ServiceContract.MutationLockTimeout;
		if (!(await _mutationLock.WaitAsync(lockTimeout, cancellationToken)))
		{
			return ServiceResponse.Failure(request.RequestId, sequence, "MUTATION_BUSY", "Another system mutation is still running.", retryable: true);
		}
		try
		{
			if (!offlineDnsRestore && _installerMaintenance.IsActive())
			{
				return ServiceResponse.Failure(request.RequestId, sequence, "INSTALLER_MAINTENANCE",
					"An installer is preserving owned services; retry after installation or recovery completes.", retryable: true);
			}
			var intents = await ReconcileCompletedOperationIntentsAsync(cancellationToken);
			PersistedResponseEntry persistedResponseEntry = await _journal.ReadResponseAsync(request.RequestId, cancellationToken);
			if ((object)persistedResponseEntry != null)
			{
				return (persistedResponseEntry.Fingerprint == fingerprint) ? persistedResponseEntry.Response : ServiceResponse.Failure(request.RequestId, sequence, "REQUEST_ID_REUSED", "The requestId was already used with a different persisted mutation.");
			}
			var existingIntent = intents.SingleOrDefault(intent => intent.RequestId == request.RequestId);
			if (existingIntent != null)
			{
				if (existingIntent.Fingerprint != fingerprint)
					return ServiceResponse.Failure(request.RequestId, sequence, "REQUEST_ID_REUSED", "The requestId already has durable intent for a different request.");
				return UnknownOperation(request.RequestId, sequence);
			}
			if (intents.Count != 0)
				return ServiceResponse.Failure(request.RequestId, sequence, "RECOVERY_REQUIRED", "A component operation has unresolved durable intent. Inspect operation.status; new mutations are blocked until its outcome is reconciled.");
			ServiceResponse serviceResponse = await PrepareMutationSlotAsync(request, sequence, cancellationToken);
			if (serviceResponse != null) return serviceResponse;
			bool componentOperation = request.Operation == "component.execute";
			if (componentOperation)
			{
				PersistedOperationIntent intent;
				try { intent = CreateComponentIntent(request, fingerprint); }
				catch (ArgumentException error) { return CreateFailureResponse(request.RequestId, sequence, error); }
				await _journal.BeginOperationIntentAsync(intent, cancellationToken);
			}
			ServiceResponse response = await ExecuteAsync(request, identity, sequence, cancellationToken);
			if (componentOperation && response.Error?.Code == "OPERATION_OUTCOME_UNKNOWN") return response;
			try
			{
				if (componentOperation)
					await _journal.CompleteOperationIntentAsync(request.RequestId, fingerprint, response, CancellationToken.None);
				await PersistMutationResponseAsync(request, fingerprint, response, CancellationToken.None, cacheResponse: !componentOperation);
				if (componentOperation)
				{
					await _journal.RetireOperationIntentAsync(request.RequestId, fingerprint, CancellationToken.None);
					CacheResponse(request.RequestId, fingerprint, response);
				}
			}
			catch (Exception error) when (componentOperation && error is IOException or UnauthorizedAccessException)
			{
				await _log.ErrorAsync("Component result persistence failed; durable intent was retained: " + error.GetType().Name, CancellationToken.None);
				return UnknownOperation(request.RequestId, sequence);
			}
			return response;
		}
		finally
		{
			_mutationLock.Release();
		}
	}

	private async Task<ServiceResponse?> PrepareMutationSlotAsync(ServiceRequest request, long sequence, CancellationToken cancellationToken)
	{
		ActiveTransaction active = await _journal.ReadActiveAsync(cancellationToken);
		if ((object)active == null)
		{
			return null;
		}
		TransactionPhase phase = active.Phase;
		if ((phase == TransactionPhase.Committed || phase == TransactionPhase.RolledBack) ? true : false)
		{
			await FinalizeTerminalTransactionAsync(active, cancellationToken);
			return null;
		}
		bool flag = active.Phase == TransactionPhase.Verified;
		if (flag)
		{
			flag = await TryFinalizeVerifiedTransactionAsync(active, cancellationToken);
		}
		if (flag)
		{
			return null;
		}
		if (request.Operation == "network.repair-owned")
		{
			return null;
		}
		return ServiceResponse.Failure(request.RequestId, sequence, "RECOVERY_REQUIRED", "Transaction " + active.TransactionId + " requires owned recovery before another mutation can start.");
	}

	private async Task PersistMutationResponseAsync(ServiceRequest request, string fingerprint, ServiceResponse response, CancellationToken cancellationToken, bool cacheResponse = true)
	{
		ActiveTransaction activeTransaction = await _journal.ReadActiveAsync(cancellationToken);
		if ((object)activeTransaction != null && activeTransaction.RequestId.Equals(request.RequestId, StringComparison.Ordinal))
		{
			await _journal.AttachTerminalResponseAsync(activeTransaction, response, cancellationToken);
		}
		await _journal.RecordResponseAsync(request.RequestId, fingerprint, response, cancellationToken);
		if (cacheResponse) CacheResponse(request.RequestId, fingerprint, response);
		activeTransaction = await _journal.ReadActiveAsync(cancellationToken);
		if ((object)activeTransaction != null && activeTransaction.RequestId.Equals(request.RequestId, StringComparison.Ordinal))
		{
			if (response.Ok)
			{
				if (activeTransaction.Phase != TransactionPhase.Verified)
				{
					throw new InvalidOperationException($"Successful mutation response has unexpected journal phase {activeTransaction.Phase}.");
				}
				await _journal.CompleteAsync(activeTransaction, TransactionPhase.Committed, null, response, cancellationToken);
				activeTransaction = await _journal.ReadActiveAsync(cancellationToken);
			}
			bool flag = (object)activeTransaction != null;
			if (flag)
			{
				TransactionPhase phase = activeTransaction.Phase;
				bool flag2 = ((phase == TransactionPhase.Committed || phase == TransactionPhase.RolledBack) ? true : false);
				flag = flag2;
			}
			if (flag)
			{
				await _journal.ArchiveTerminalAsync(activeTransaction, cancellationToken);
			}
		}
		TrimResponseCache();
	}

	private async Task<bool> TryFinalizeVerifiedTransactionAsync(ActiveTransaction transaction, CancellationToken cancellationToken)
	{
		PersistedResponseEntry persistedResponseEntry = await _journal.ReadResponseAsync(transaction.RequestId, cancellationToken);
		ServiceResponse response = persistedResponseEntry?.Response ?? transaction.TerminalResponse;
		string fingerprint = persistedResponseEntry?.Fingerprint ?? transaction.RequestFingerprint;
		if ((object)response == null || fingerprint == null || !response.Ok)
		{
			return false;
		}
		bool flag = (object)persistedResponseEntry == null;
		if (flag)
		{
			flag = !(await VerifyRecordedPostStateAsync(transaction, cancellationToken));
		}
		if (flag)
		{
			return false;
		}
		await _journal.AttachTerminalResponseAsync(transaction, response, cancellationToken);
		await _journal.RecordResponseAsync(transaction.RequestId, fingerprint, response, cancellationToken);
		await _journal.CompleteAsync(transaction, TransactionPhase.Committed, null, response, cancellationToken);
		ActiveTransaction completed = (await _journal.ReadActiveAsync(cancellationToken)) ?? throw new InvalidOperationException("Verified transaction marker disappeared before archival.");
		await _journal.ArchiveTerminalAsync(completed, cancellationToken);
		CacheResponse(transaction.RequestId, fingerprint, response);
		await _log.InfoAsync("Finalized verified transaction " + transaction.TransactionId + " without replaying its mutation.", cancellationToken);
		return true;
	}

	private async Task FinalizeTerminalTransactionAsync(ActiveTransaction transaction, CancellationToken cancellationToken)
	{
		ServiceResponse response = transaction.TerminalResponse;
		string fingerprint = transaction.RequestFingerprint;
		if ((object)response == null || fingerprint == null)
		{
			await _log.WarnAsync("Archiving legacy terminal transaction " + transaction.TransactionId + " without a reconstructable idempotency response.", cancellationToken);
		}
		else
		{
			await _journal.RecordResponseAsync(transaction.RequestId, fingerprint, response, cancellationToken);
			CacheResponse(transaction.RequestId, fingerprint, response);
		}
		await _journal.ArchiveTerminalAsync(transaction, cancellationToken);
		await _log.InfoAsync("Finalized terminal transaction marker " + transaction.TransactionId + ".", cancellationToken);
	}

	private async Task<ServiceResponse> ExecuteAsync(ServiceRequest request, ClientIdentity identity, long sequence, CancellationToken cancellationToken)
	{
		try
		{
			object obj;
			switch (request.Operation)
			{
			case "component.execute":
			case "component.query":
				obj = await ExecuteComponentAsync(request, cancellationToken);
				break;
			case "hello":
				obj = new
				{
					protocolVersion = 1,
					serviceVersion = BuildInfo.Version,
					pipeName = _options.PipeName,
					clientPid = identity.ProcessId,
					developmentOverride = identity.DevelopmentOverride,
					identityProbe = identity.IdentityProbe,
					persistence = await DescribePersistenceAsync(cancellationToken)
				};
				break;
			case "service.status":
				obj = new
				{
					serviceName = "EgoistShieldCore",
					version = BuildInfo.Version,
					processId = Environment.ProcessId,
					startedAt = Program.StartedAt,
					consoleMode = _options.ConsoleMode,
					supervision = _serviceSupervisor?.Describe(),
					persistence = await DescribePersistenceAsync(cancellationToken)
				};
				break;
			case "recovery.status":
			{
				obj = await DescribePersistenceAsync(cancellationToken);
				break;
			}
			case "operation.status":
				obj = await ReadOperationStatusAsync(request, cancellationToken);
				break;
			case "dns.status":
				obj = new
				{
					adapters = await _dns.ReadSnapshotAsync(cancellationToken)
				};
				break;
			case "dns.doh.status":
				obj = await ReadNativeDohStatusAsync(cancellationToken);
				break;
			case "dns.apply":
				obj = await ExecuteDnsApplyAsync(request, sequence, cancellationToken);
				break;
			case "dns.reset":
				obj = await ExecuteDnsResetAsync(request, sequence, cancellationToken);
				break;
			case "dns.restore-owned":
				obj = await ExecuteDnsRestoreOwnedAsync(request, sequence, cancellationToken);
				break;
			case "dns.doh.apply":
				obj = await ExecuteNativeDohApplyAsync(request, sequence, cancellationToken);
				break;
			case "dns.doh.remove":
				obj = await ExecuteNativeDohRemoveAsync(request, sequence, cancellationToken);
				break;
			case "owned-service.status":
				obj = await ReadOwnedServiceStatusAsync(request, cancellationToken);
				break;
			case "owned-service.install":
				obj = await ExecuteOwnedServiceMutationAsync(request, "installed", sequence, cancellationToken);
				break;
			case "owned-service.remove":
				obj = await ExecuteOwnedServiceMutationAsync(request, "not-installed", sequence, cancellationToken);
				break;
			case "owned-service.start":
				obj = await ExecuteOwnedServiceMutationAsync(request, "running", sequence, cancellationToken);
				break;
			case "owned-service.stop":
				obj = await ExecuteOwnedServiceMutationAsync(request, "stopped", sequence, cancellationToken);
				break;
			case "zapret.profile.set":
				obj = await ExecuteZapretProfileMutationAsync(request, sequence, cancellationToken);
				break;
			case "network.repair-owned":
				obj = await RepairOwnedAsync(request, sequence, cancellationToken);
				break;
			case "test.delay-mutation":
				obj = await DelayTestMutationAsync(request, cancellationToken);
				break;
			default:
				throw new ServiceOperationException("UNKNOWN_OPERATION", "Unsupported service operation: " + request.Operation);
			}
			object result = obj;
			return ServiceResponse.Success(request.RequestId, sequence, result);
		}
		catch (Exception ex)
		{
			if (!(ex is ServiceOperationException) && !(ex is JsonException) && !(ex is ArgumentException) && !(ex is UnauthorizedAccessException) && !(ex is TimeoutException) && !(ex is OperationCanceledException))
			{
				await _log.ErrorAsync($"{request.Operation} failed: {ex.GetType().Name}: {ex.Message}", CancellationToken.None);
			}
			return CreateFailureResponse(request.RequestId, sequence, ex);
		}
	}

	private async Task<object> ExecuteDnsApplyAsync(ServiceRequest request, long sequence, CancellationToken cancellationToken, DnsAdapterSnapshot[]? targetAdapters = null)
	{
		DnsApplyPayload dnsApplyPayload = request.Payload.Deserialize<DnsApplyPayload>(JsonDefaults.Options) ?? throw new ArgumentException("DNS payload is required.");
		string[] servers = WindowsDnsController.ValidateServers(dnsApplyPayload.Servers ?? Array.Empty<string>());
		string[] probeHosts = WindowsDnsController.ValidateProbeHosts(dnsApplyPayload.ProbeHosts ?? Array.Empty<string>());
		DnsAdapterSnapshot[] original = targetAdapters ?? await _dns.ReadSnapshotAsync(cancellationToken);
		DnsOwnedState? previousOwnership = await ReadDnsOwnedStateAsync(cancellationToken);
		previousOwnership?.Validate();
		ActiveTransaction transaction = CreateTransaction(request, "dns", JsonDefaults.ToElement(new DnsOwnedTransactionSnapshot(original, previousOwnership)), JsonDefaults.ToElement(new { servers, probeHosts }), sequence);
		await _journal.CreateActiveAsync(transaction, cancellationToken);
		try
		{
			await _journal.UpdatePhaseAsync(transaction, TransactionPhase.Applying, null, cancellationToken);
			DnsAdapterSnapshot[] adapters = await _dns.ApplyAsync(original, servers, probeHosts, cancellationToken);
			await WriteDnsOwnedStateAsync(DnsOwnedState.Capture(previousOwnership, original, servers), cancellationToken);
			object result = new
			{
				servers = servers,
				adapters = adapters
			};
			await _journal.MarkVerifiedAsync(transaction, result, cancellationToken);
			return result;
		}
		catch (Exception failure)
		{
			await RollbackAsync(transaction, failure, cancellationToken);
			throw;
		}
	}

	private async Task<object> ExecuteDnsResetAsync(ServiceRequest request, long sequence, CancellationToken cancellationToken)
	{
		DnsAdapterSnapshot[] original = await _dns.ReadSnapshotAsync(cancellationToken);
		DnsOwnedState? previousOwnership = await ReadDnsOwnedStateAsync(cancellationToken);
		previousOwnership?.Validate();
		ActiveTransaction transaction = CreateTransaction(request, "dns", JsonDefaults.ToElement(new DnsOwnedTransactionSnapshot(original, previousOwnership)), JsonDefaults.ToElement(new
		{
			mode = "dhcp"
		}), sequence);
		await _journal.CreateActiveAsync(transaction, cancellationToken);
		try
		{
			await _journal.UpdatePhaseAsync(transaction, TransactionPhase.Applying, null, cancellationToken);
			DnsAdapterSnapshot[] adapters = await _dns.ResetAsync(original, cancellationToken);
			await WriteDnsOwnedStateAsync(null, cancellationToken);
			object result = new
			{
				mode = "dhcp",
				adapters = adapters
			};
			await _journal.MarkVerifiedAsync(transaction, result, cancellationToken);
			return result;
		}
		catch (Exception failure)
		{
			await RollbackAsync(transaction, failure, cancellationToken);
			throw;
		}
	}

	private async Task<object> ExecuteDnsRestoreOwnedAsync(ServiceRequest request, long sequence, CancellationToken cancellationToken)
	{
		NativeDohOwnedState? nativeBefore = await _nativeDoh.ReadOwnedStateAsync(cancellationToken);
		DnsOwnedState? dnsBefore = await ReadDnsOwnedStateAsync(cancellationToken);
		dnsBefore?.Validate();
		if (nativeBefore == null && dnsBefore == null)
		{
			return new { pendingAdapters = 0, restored = Array.Empty<DnsAdapterSnapshot>() };
		}

		DnsAdapterSnapshot[] original;
		ActiveTransaction transaction;
		if (nativeBefore != null)
		{
			DnsAdapterSnapshot[] baseline = nativeBefore.OriginalDnsAdapters ?? Array.Empty<DnsAdapterSnapshot>();
			original = baseline.Length == 0 ? await _dns.ReadSnapshotAsync(cancellationToken) : await _dns.ReadPresentSnapshotAsync(baseline, cancellationToken);
			int pending = baseline.Length - original.Length;
			if (pending > 0) return new { pendingAdapters = pending, restored = Array.Empty<DnsAdapterSnapshot>() };
			NativeDohEntrySnapshot[] entries = await _nativeDoh.ReadEntriesAsync(nativeBefore.Servers, cancellationToken);
			transaction = CreateTransaction(request, "native-doh", JsonDefaults.ToElement(new NativeDohTransactionSnapshot(original, nativeBefore, entries)), JsonDefaults.ToElement(new { mode = "restore-owned", servers = nativeBefore.Servers }), sequence);
		}
		else
		{
			original = await _dns.ReadPresentSnapshotAsync(dnsBefore!.OriginalAdapters, cancellationToken);
			int pending = dnsBefore.OriginalAdapters.Length - original.Length;
			if (pending > 0) return new { pendingAdapters = pending, restored = Array.Empty<DnsAdapterSnapshot>() };
			DnsAdapterSnapshot[] restoreTargets = dnsBefore.RestoreTargets(original, out bool fallbackToDhcp);
			transaction = CreateTransaction(request, "dns", JsonDefaults.ToElement(new DnsOwnedTransactionSnapshot(original, dnsBefore)), JsonDefaults.ToElement(new { mode = "restore-owned", servers = dnsBefore.Servers, restoreTargets, fallbackToDhcp }), sequence);
		}
		await _journal.CreateActiveAsync(transaction, cancellationToken);
		try
		{
			await _journal.UpdatePhaseAsync(transaction, TransactionPhase.Applying, null, cancellationToken);
			DnsAdapterSnapshot[] actual;
			if (nativeBefore != null)
			{
				actual = await RestoreNativeDohDnsBaselineAsync(nativeBefore, original, cancellationToken);
				await _nativeDoh.RemoveOwnedEntriesAsync(nativeBefore, cancellationToken);
				await _nativeDoh.WriteOwnedStateAsync(null, cancellationToken);
			}
			else
			{
				DnsAdapterSnapshot[] restoreTargets = transaction.Desired.GetProperty("restoreTargets").Deserialize<DnsAdapterSnapshot[]>(JsonDefaults.StateOptions)!;
				bool loopbackFallback = transaction.Desired.GetProperty("fallbackToDhcp").GetBoolean();
				if (restoreTargets.Length > 0)
				{
					actual = await RestoreAndReadDnsBaselineAsync(restoreTargets, original, cancellationToken);
				}
				else actual = Array.Empty<DnsAdapterSnapshot>();
				await WriteDnsOwnedStateAsync(null, cancellationToken);
				object result = new
				{
					pendingAdapters = 0,
					restored = actual,
					fallbackToDhcp = loopbackFallback
				};
				await _dns.FlushCacheAsync(cancellationToken);
				await _journal.MarkVerifiedAsync(transaction, result, cancellationToken);
				return result;
			}

			await _dns.FlushCacheAsync(cancellationToken);
			object nativeResult = new
			{
				pendingAdapters = 0,
				restored = actual
			};
			await _journal.MarkVerifiedAsync(transaction, nativeResult, cancellationToken);
			return nativeResult;
		}
		catch (Exception failure)
		{
			await RollbackAsync(transaction, failure, cancellationToken);
			throw;
		}
	}

	internal static bool IsLoopbackOwnedBaseline(DnsOwnedState state, IReadOnlyCollection<DnsAdapterSnapshot> current)
	{
		// Retained solely to recover journals written by the older broad reset path.
		if (state.Servers.Length == 0 || state.Servers.Any(server => !IPAddress.TryParse(server, out IPAddress? address) || !IPAddress.IsLoopback(address))) return false;
		foreach (DnsAdapterSnapshot adapter in current)
		{
			string[] ownedServers = state.ServersFor(adapter);
			string[] ownedV4 = ownedServers.Where(server => IPAddress.Parse(server).AddressFamily == AddressFamily.InterNetwork).ToArray();
			string[] ownedV6 = ownedServers.Where(server => IPAddress.Parse(server).AddressFamily == AddressFamily.InterNetworkV6).ToArray();
			bool v4Matches = ownedV4.Length > 0 && adapter.Ipv4Static && adapter.Ipv4.SequenceEqual(ownedV4, StringComparer.OrdinalIgnoreCase);
			bool v6Matches = ownedV6.Length > 0 && adapter.Ipv6Static && adapter.Ipv6.SequenceEqual(ownedV6, StringComparer.OrdinalIgnoreCase);
			// DHCP fallback resets both address families at once. Only use it when
			// every tracked family still matches our loopback state and every
			// untracked family is already DHCP; an external static family must take
			// the normal ownership-aware restore path instead.
			bool v4Safe = ownedV4.Length > 0 ? v4Matches : !adapter.Ipv4Static;
			bool v6Safe = ownedV6.Length > 0 ? v6Matches : !adapter.Ipv6Static;
			if (!v4Safe || !v6Safe) return false;
		}
		return current.Count > 0;
	}

	private async Task<DnsAdapterSnapshot[]> RestoreAndReadDnsBaselineAsync(IReadOnlyCollection<DnsAdapterSnapshot> targets, IReadOnlyCollection<DnsAdapterSnapshot> current, CancellationToken cancellationToken)
	{
		await _dns.RestoreFromExpectedSnapshotAsync(targets, current, cancellationToken);
		return await _dns.ReadPresentSnapshotAsync(targets, cancellationToken);
	}

	private async Task<object> ReadNativeDohStatusAsync(CancellationToken cancellationToken)
	{
		if (!WindowsNativeDohController.IsSupported)
			return new { supported = false, hasIpv6DefaultRoute = false, enabled = false, verified = false, encrypted = false,
				nativeManaged = true, url = (string?)null, servers = Array.Empty<string>(), adapters = Array.Empty<DnsAdapterSnapshot>(),
				updatedAt = (DateTimeOffset?)null, fallbackToUdp = false };
		NativeDohHealth nativeDohHealth = await ReadNativeDohHealthAsync(cancellationToken);
		bool covered = nativeDohHealth.State != null && DnsMaintenancePolicy.FullyCovered(nativeDohHealth.Adapters, nativeDohHealth.State.Servers);
		return new
		{
			supported = true,
			hasIpv6DefaultRoute = await _nativeDoh.HasIpv6DefaultRouteAsync(cancellationToken),
			enabled = ((object)nativeDohHealth.State != null),
			verified = (covered && nativeDohHealth.EntriesMatch && nativeDohHealth.DnsOwned),
			encrypted = (covered && nativeDohHealth.EntriesMatch && nativeDohHealth.DnsOwned),
			nativeManaged = true,
			url = nativeDohHealth.State?.Url,
			servers = (nativeDohHealth.State?.Servers ?? Array.Empty<string>()),
			adapters = nativeDohHealth.Adapters,
			updatedAt = nativeDohHealth.State?.UpdatedAt,
			fallbackToUdp = false
		};
	}

	private async Task<object> ExecuteNativeDohApplyAsync(ServiceRequest request, long sequence, CancellationToken cancellationToken, DnsAdapterSnapshot[]? targetAdapters = null)
	{
		NativeDohApplyPayload nativeDohApplyPayload = request.Payload.Deserialize<NativeDohApplyPayload>(JsonDefaults.Options) ?? throw new ArgumentException("Native DoH payload is required.");
		string url = WindowsNativeDohController.ValidateUrl(nativeDohApplyPayload.Url);
		string[] servers = WindowsDnsController.ValidateServers(nativeDohApplyPayload.Servers ?? Array.Empty<string>());
		string[] probeHosts = WindowsDnsController.ValidateProbeHosts(nativeDohApplyPayload.ProbeHosts ?? Array.Empty<string>());
		DnsAdapterSnapshot[] originalDns = targetAdapters ?? await _dns.ReadSnapshotAsync(cancellationToken);
		NativeDohOwnedState before = await _nativeDoh.ReadOwnedStateAsync(cancellationToken);
		ValidateNativeDohOwnedState(before);
		if (before != null && before.Servers.Select(server => IPAddress.Parse(server).AddressFamily).Distinct()
			.Any(family => !servers.Any(server => IPAddress.Parse(server).AddressFamily == family)))
			throw new ServiceOperationException("DNS_FAMILY_UNAVAILABLE", "The replacement provider has no verified address for an already managed IP family; existing encrypted DNS settings were preserved.");
		if (before?.OriginalDnsAdapters is { Length: > 0 } previousBaseline && !servers.ToHashSet(StringComparer.OrdinalIgnoreCase).SetEquals(before.Servers))
		{
			var present = await _dns.ReadPresentSnapshotAsync(previousBaseline, cancellationToken);
			if (present.Length != previousBaseline.Length)
				throw new ServiceOperationException("DNS_ADAPTER_UNAVAILABLE", "Native provider addresses cannot be replaced until every recorded adapter is present; existing DoH registrations were preserved.");
			// Disconnected but present owned adapters are migrated too. Otherwise
			// removing an obsolete provider would break them on reconnect.
			originalDns = originalDns.Concat(present.Where(adapter => DnsMatchesServers(new[] { adapter }, before.Servers)))
				.DistinctBy(adapter => adapter.InterfaceGuid, StringComparer.OrdinalIgnoreCase).ToArray();
		}
		string localStatePath = Path.Combine(ProtectedProductRoot.Resolve(_options.StateRoot), "Runtime", "SystemDoH", "state.json");
		if (File.Exists(localStatePath) || _services != null && (await _services.StatusAsync("EgoistShieldSystemDoH", cancellationToken)).Installed)
			throw new ServiceOperationException("DNS_MODE_CONFLICT", "The local DNS service is already configured; its protected mode must be stopped before enabling native DoH.");
		string[] rawServers = servers.Concat(before?.Servers ?? Array.Empty<string>()).Distinct<string>(StringComparer.OrdinalIgnoreCase).ToArray();
		NativeDohEntrySnapshot[] beforeEntries = await _nativeDoh.ReadEntriesAsync(rawServers, cancellationToken);
		NativeDohTransactionSnapshot value = new NativeDohTransactionSnapshot(originalDns, before, beforeEntries);
		ActiveTransaction transaction = CreateTransaction(request, "native-doh", JsonDefaults.ToElement(value), JsonDefaults.ToElement(new { url, servers, probeHosts }), sequence);
		await _journal.CreateActiveAsync(transaction, cancellationToken);
		try
		{
			await _journal.UpdatePhaseAsync(transaction, TransactionPhase.Applying, null, cancellationToken);
			NativeDohEntrySnapshot[] originalEntries = BuildNativeDohOriginalEntries(before, beforeEntries, servers);
			// The old provider remains registered while the new one is configured
			// and applied. Overlapping IPs can replace only our exact old template.
			await _nativeDoh.ConfigureAsync(url, servers, cancellationToken, before);
			DnsAdapterSnapshot[] actual = await _dns.ApplyAsync(originalDns, servers, probeHosts, cancellationToken);
			var oldDnsOwnership = before?.OriginalDnsAdapters == null ? null : new DnsOwnedState(1, "EgoistShield", before.Servers, before.OriginalDnsAdapters);
			var baseline = DnsOwnedState.Capture(oldDnsOwnership, originalDns, servers).OriginalAdapters;
			NativeDohOwnedState state = new NativeDohOwnedState(1, "EgoistShield", url, servers, DateTimeOffset.UtcNow, originalEntries, baseline);
			if (!WindowsNativeDohController.EntriesMatch(await _nativeDoh.ReadEntriesAsync(servers, cancellationToken), state))
			{
				throw new InvalidOperationException("Windows native DoH post-configuration verification failed.");
			}
			if (before != null)
			{
				string[] obsolete = before.Servers.Where(server => !servers.Contains(server, StringComparer.OrdinalIgnoreCase)).ToArray();
				if (obsolete.Length > 0) await _nativeDoh.RemoveOwnedEntriesAsync(SliceNativeDohOwnedState(before, obsolete), cancellationToken);
			}
			await _nativeDoh.WriteOwnedStateAsync(state, cancellationToken);
			object result = new
			{
				enabled = true,
				verified = DnsMaintenancePolicy.FullyCovered(actual, servers),
				encrypted = DnsMaintenancePolicy.FullyCovered(actual, servers),
				nativeManaged = true,
				url = url,
				servers = servers,
				adapters = actual,
				fallbackToUdp = false,
				updatedAt = state.UpdatedAt
			};
			await _journal.MarkVerifiedAsync(transaction, result, cancellationToken);
			return result;
		}
		catch (Exception failure)
		{
			await RollbackAsync(transaction, failure, cancellationToken);
			throw;
		}
	}

	private async Task<object> ExecuteNativeDohRemoveAsync(ServiceRequest request, long sequence, CancellationToken cancellationToken)
	{
		NativeDohOwnedState before = await _nativeDoh.ReadOwnedStateAsync(cancellationToken);
		ValidateNativeDohOwnedState(before);
		DnsAdapterSnapshot[] originalDns = await _dns.ReadSnapshotAsync(cancellationToken);
		NativeDohEntrySnapshot[] array = (((object)before != null) ? (await _nativeDoh.ReadEntriesAsync(before.Servers, cancellationToken)) : Array.Empty<NativeDohEntrySnapshot>());
		NativeDohEntrySnapshot[] entries = array;
		NativeDohTransactionSnapshot value = new NativeDohTransactionSnapshot(originalDns, before, entries);
		ActiveTransaction transaction = CreateTransaction(request, "native-doh", JsonDefaults.ToElement(value), JsonDefaults.ToElement(new
		{
			url = before?.Url,
			servers = (before?.Servers ?? Array.Empty<string>()),
			mode = "remove"
		}), sequence);
		await _journal.CreateActiveAsync(transaction, cancellationToken);
		try
		{
			await _journal.UpdatePhaseAsync(transaction, TransactionPhase.Applying, null, cancellationToken);
			bool dnsOwned = (object)before != null && DnsMatchesServers(originalDns, before.Servers);
			DnsAdapterSnapshot[] array2 = before == null ? originalDns : await RestoreNativeDohDnsBaselineAsync(before, originalDns, cancellationToken);
			DnsAdapterSnapshot[] actual = array2;
			string[] removed;
			string[] preserved;
			(removed, preserved) = await _nativeDoh.RemoveOwnedEntriesAsync(before, cancellationToken);
			await _nativeDoh.WriteOwnedStateAsync(null, cancellationToken);
			object result = new
			{
				enabled = false,
				verified = true,
				encrypted = false,
				nativeManaged = true,
				url = (string)null,
				servers = Array.Empty<string>(),
				updatedAt = (DateTimeOffset?)null,
				removed = removed,
				preserved = preserved,
				resetOwnedDns = dnsOwned,
				preservedExternalDns = !dnsOwned,
				adapters = actual,
				fallbackToUdp = false
			};
			await _journal.MarkVerifiedAsync(transaction, result, cancellationToken);
			return result;
		}
		catch (Exception failure)
		{
			await RollbackAsync(transaction, failure, cancellationToken);
			throw;
		}
	}

	private async Task<object> ReadOwnedServiceStatusAsync(ServiceRequest request, CancellationToken cancellationToken)
	{
		string serviceName = ReadOwnedServiceName(request);
		return await RequireServiceController().StatusAsync(serviceName, cancellationToken);
	}

	private async Task<object> ExecuteOwnedServiceMutationAsync(ServiceRequest request, string desiredState, long sequence, CancellationToken cancellationToken)
	{
		string serviceName = ReadOwnedServiceName(request);
		OwnedServiceController services = RequireServiceController();
		// Persist explicit off before any control command, including a failed stop.
		// Recovery must not turn a user's pending stop back into an enabled service.
		if (desiredState is "stopped" or "not-installed")
			await _serviceIntents.SetRunningAsync(serviceName, false, cancellationToken);
		ActiveTransaction transaction = CreateTransaction(request, "owned-service", JsonDefaults.ToElement(await services.StatusAsync(serviceName, cancellationToken)), JsonDefaults.ToElement(new
		{
			serviceName = serviceName,
			state = desiredState
		}), sequence);
		await _journal.CreateActiveAsync(transaction, cancellationToken);
		try
		{
			await _journal.UpdatePhaseAsync(transaction, TransactionPhase.Applying, null, cancellationToken);
			if (desiredState == "running") await _serviceIntents.SetRunningAsync(serviceName, true, cancellationToken);
			OwnedServiceStatus after = desiredState switch
			{
				"installed" => await services.InstallAsync(serviceName, cancellationToken), 
				"not-installed" => await services.RemoveAsync(serviceName, cancellationToken), 
				"running" => await services.StartAsync(serviceName, cancellationToken), 
				"stopped" => await services.StopAsync(serviceName, cancellationToken), 
				_ => throw new InvalidOperationException("Unsupported desired service state: " + desiredState + "."), 
			};
			await _journal.MarkVerifiedAsync(transaction, after, cancellationToken);
			return after;
		}
		catch (Exception failure)
		{
			if (desiredState == "running") await _serviceIntents.SetRunningAsync(serviceName, false, CancellationToken.None);
			await RollbackAsync(transaction, failure, cancellationToken);
			throw;
		}
	}

	private async Task<object> RepairOwnedAsync(ServiceRequest request, long sequence, CancellationToken cancellationToken)
	{
		ActiveTransaction active = await _journal.ReadActiveAsync(cancellationToken);
		bool flag = (object)active != null;
		if (flag)
		{
			TransactionPhase phase = active.Phase;
			bool flag2 = ((phase == TransactionPhase.Committed || phase == TransactionPhase.RolledBack) ? true : false);
			flag = flag2;
		}
		if (flag)
		{
			await FinalizeTerminalTransactionAsync(active, cancellationToken);
			active = null;
		}
		if ((object)active == null)
		{
			NativeDohHealth health = await ReadNativeDohHealthAsync(cancellationToken);
			if ((object)health.State != null && (!health.EntriesMatch || !health.DnsOwned))
			{
				NativeDohTransactionSnapshot value = new NativeDohTransactionSnapshot(health.Adapters, health.State, health.Entries);
				ActiveTransaction repair = CreateTransaction(request, "native-doh", JsonDefaults.ToElement(value), JsonDefaults.ToElement(new
				{
					url = health.State.Url,
					servers = health.State.Servers,
					mode = "repair-reset"
				}), sequence);
				await _journal.CreateActiveAsync(repair, cancellationToken);
				try
				{
					await _journal.UpdatePhaseAsync(repair, TransactionPhase.Applying, null, cancellationToken);
					DnsAdapterSnapshot[] array = await RestoreNativeDohDnsBaselineAsync(health.State, health.Adapters, cancellationToken);
					DnsAdapterSnapshot[] actual = array;
					string[] removed;
					string[] preserved;
					(removed, preserved) = await _nativeDoh.RemoveOwnedEntriesAsync(health.State, cancellationToken);
					await _nativeDoh.WriteOwnedStateAsync(null, cancellationToken);
					await _dns.FlushCacheAsync(cancellationToken);
					object result = new
					{
						repaired = true,
						resource = "native-doh",
						reason = "The committed Egoist Lagom DoH state was incomplete and was reset safely.",
						removed = removed,
						preserved = preserved,
						resetOwnedDns = health.DnsOwned,
						preservedExternalDns = !health.DnsOwned,
						preservedRunningBypassServices = true,
						adapters = actual
					};
					await _journal.MarkVerifiedAsync(repair, result, cancellationToken);
					return result;
				}
				catch (Exception failure)
				{
					await RollbackAsync(repair, failure, cancellationToken);
					throw;
				}
			}
			await _dns.FlushCacheAsync(cancellationToken);
			return new
			{
				repaired = false,
				message = (((object)health.State == null) ? "No unfinished Egoist Lagom system transaction was found; DNS cache was refreshed." : "Egoist Lagom native DoH is healthy; DNS cache was refreshed without changing it."),
				preservedExternalDns = true,
				preservedRunningBypassServices = true
			};
		}
		await RollbackAsync(active, new ServiceOperationException("RECOVERY_REPAIRED", "The unfinished mutation was safely rolled back by owned repair."), cancellationToken);
		ActiveTransaction transaction = (await _journal.ReadActiveAsync(CancellationToken.None)) ?? throw new InvalidOperationException("Recovered transaction marker disappeared before durable finalization.");
		await FinalizeTerminalTransactionAsync(transaction, CancellationToken.None);
		return new
		{
			repaired = true,
			transactionId = active.TransactionId,
			resource = active.Resource,
			preservedExternalDns = true,
			preservedRunningBypassServices = (active.Resource != "owned-service")
		};
	}

	private async Task<object> ExecuteZapretProfileMutationAsync(ServiceRequest request, long sequence, CancellationToken cancellationToken)
	{
		ZapretProfilePayload payload = request.Payload.Deserialize<ZapretProfilePayload>(JsonDefaults.Options) ?? throw new ArgumentException("Zapret profile payload is required.");
		OwnedServiceController services = RequireServiceController();
		ActiveTransaction transaction = CreateTransaction(request, "zapret-profile", JsonDefaults.ToElement(new ZapretProfileSnapshot(await services.ReadZapretProfileAsync(cancellationToken))), JsonDefaults.ToElement(new
		{
			profile = payload.Profile
		}), sequence);
		await _journal.CreateActiveAsync(transaction, cancellationToken);
		try
		{
			await _journal.UpdatePhaseAsync(transaction, TransactionPhase.Applying, null, cancellationToken);
			object result = new
			{
				profile = await services.SetZapretProfileAsync(payload.Profile, cancellationToken)
			};
			await _journal.MarkVerifiedAsync(transaction, result, cancellationToken);
			return result;
		}
		catch (Exception failure)
		{
			await RollbackAsync(transaction, failure, cancellationToken);
			throw;
		}
	}

	private async Task<object> DelayTestMutationAsync(ServiceRequest request, CancellationToken cancellationToken)
	{
		if (!_options.ConsoleMode || !_options.AllowDevClient)
		{
			throw new ServiceOperationException("UNKNOWN_OPERATION", "Unsupported service operation: " + request.Operation);
		}
		int delayMs = 100;
		if (request.Payload.ValueKind == JsonValueKind.Object && request.Payload.TryGetProperty("delayMs", out var value) && value.TryGetInt32(out var value2))
		{
			delayMs = Math.Clamp(value2, 1, 2000);
		}
		DateTimeOffset startedAt = DateTimeOffset.UtcNow;
		await Task.Delay(delayMs, cancellationToken);
		return new
		{
			startedAt = startedAt,
			completedAt = DateTimeOffset.UtcNow,
			delayMs = delayMs
		};
	}

	private async Task RollbackAsync(ActiveTransaction transaction, Exception failure, CancellationToken cancellationToken)
	{
		using CancellationTokenSource graceSource = new CancellationTokenSource(ServiceContract.RollbackGracePeriod);
		CancellationToken grace = graceSource.Token;
		string reason = failure.Message;
		ActiveTransaction activeTransaction = (await _journal.ReadActiveAsync(grace)) ?? throw new InvalidOperationException("The active transaction marker disappeared before rollback.");
		if (!activeTransaction.TransactionId.Equals(transaction.TransactionId, StringComparison.Ordinal))
		{
			throw new InvalidOperationException("Refusing to roll back a transaction marker owned by another mutation.");
		}
		transaction = activeTransaction;
		await _journal.UpdatePhaseAsync(transaction, TransactionPhase.RollingBack, reason, grace);
		try
		{
			switch (transaction.Resource)
			{
			case "dns":
			{
				bool hasOwnershipState = transaction.Original.ValueKind == JsonValueKind.Object;
				DnsOwnedTransactionSnapshot before = hasOwnershipState
					? transaction.Original.Deserialize<DnsOwnedTransactionSnapshot>(JsonDefaults.StateOptions) ?? throw new InvalidOperationException("DNS rollback snapshot is invalid.")
					: new DnsOwnedTransactionSnapshot(transaction.Original.Deserialize<DnsAdapterSnapshot[]>(JsonDefaults.StateOptions) ?? throw new InvalidOperationException("DNS rollback snapshot is invalid."), null);
				if (transaction.Operation == "dns.restore-owned")
				{
					DnsAdapterSnapshot[] expected;
					if (transaction.Desired.TryGetProperty("restoreTargets", out JsonElement recordedTargets))
						expected = recordedTargets.Deserialize<DnsAdapterSnapshot[]>(JsonDefaults.StateOptions) ?? throw new InvalidOperationException("DNS restore post-state is invalid.");
					else
					{
						DnsOwnedState ownership = before.OwnedState ?? throw new InvalidOperationException("DNS restore ownership snapshot is missing.");
						expected = ownership.RestoreTargets(before.Adapters, out _, repairLoopback: false);
						if (IsLoopbackOwnedBaseline(ownership, expected))
							expected = before.Adapters.Select(adapter => adapter with { Ipv4Static = false, Ipv6Static = false }).ToArray();
					}
					if (expected.Length > 0)
						await _dns.RestoreFromExpectedSnapshotAsync(WindowsDnsController.IntersectByStableIdentity(before.Adapters, expected), expected, grace);
				}
				else await _dns.RestoreAsync(before.Adapters, transaction.Operation, ReadDesiredDnsServers(transaction), grace);
				if (hasOwnershipState) await WriteDnsOwnedStateAsync(before.OwnedState, grace);
				break;
			}
			case "native-doh":
			{
				NativeDohTransactionSnapshot nativeBefore = transaction.Original.Deserialize<NativeDohTransactionSnapshot>(JsonDefaults.StateOptions) ?? throw new InvalidOperationException("Native DoH rollback snapshot is invalid.");
				if (transaction.Operation == "dns.doh.apply")
				{
					await _dns.RestoreAsync(nativeBefore.Adapters, "dns.apply", ReadDesiredDnsServers(transaction), grace);
					string desiredUrl = transaction.Desired.GetProperty("url").GetString() ?? throw new InvalidOperationException("Native DoH transaction has no desired URL.");
					string[] desiredServers = ReadDesiredDnsServers(transaction) ?? Array.Empty<string>();
					NativeDohEntrySnapshot[] snapshots = nativeBefore.Entries.Where((NativeDohEntrySnapshot entry) => desiredServers.Contains<string>(entry.ServerAddress, StringComparer.OrdinalIgnoreCase)).ToArray();
					await _nativeDoh.RestoreEntriesAsync(snapshots, desiredUrl, grace);
					if ((object)nativeBefore.OwnedState != null)
					{
						string[] obsolete = nativeBefore.OwnedState.Servers.Where((string server) => !desiredServers.Contains<string>(server, StringComparer.OrdinalIgnoreCase)).ToArray();
						if (obsolete.Length != 0)
						{
							NativeDohOwnedState state = SliceNativeDohOwnedState(nativeBefore.OwnedState, obsolete);
							NativeDohEntrySnapshot[] configuredSnapshots = nativeBefore.Entries.Where((NativeDohEntrySnapshot entry) => obsolete.Contains<string>(entry.ServerAddress, StringComparer.OrdinalIgnoreCase)).ToArray();
							await _nativeDoh.RestoreRemovedEntriesAsync(configuredSnapshots, state, grace);
						}
					}
				}
				else if ((object)nativeBefore.OwnedState != null)
				{
					await _nativeDoh.RestoreRemovedEntriesAsync(nativeBefore.Entries, nativeBefore.OwnedState, grace);
				}
				await _nativeDoh.WriteOwnedStateAsync(nativeBefore.OwnedState, grace);
				if (transaction.Operation != "dns.doh.apply")
				{
					DnsAdapterSnapshot[] array = nativeBefore.OwnedState?.OriginalDnsAdapters;
					if (array == null || array.Length <= 0)
					{
						await _dns.RestoreAsync(nativeBefore.Adapters, "dns.reset", null, grace);
					}
					else
					{
						var restored = NativeDohRestoreTargets(nativeBefore.OwnedState!, nativeBefore.Adapters);
						var expected = nativeBefore.Adapters.Select(adapter => restored.SingleOrDefault(target => string.Equals(target.InterfaceGuid, adapter.InterfaceGuid, StringComparison.OrdinalIgnoreCase)) ?? adapter).ToArray();
						await _dns.RestoreFromExpectedSnapshotAsync(nativeBefore.Adapters, expected, grace);
					}
				}
				break;
			}
			case "owned-service":
			{
				OwnedServiceStatus before = transaction.Original.Deserialize<OwnedServiceStatus>(JsonDefaults.StateOptions) ?? throw new InvalidOperationException("Service rollback snapshot is invalid.");
				await RestoreOwnedServiceAsync(before, transaction, grace);
				break;
			}
			case "zapret-profile":
			{
				ZapretProfileSnapshot zapretProfileSnapshot = transaction.Original.Deserialize<ZapretProfileSnapshot>(JsonDefaults.StateOptions) ?? throw new InvalidOperationException("Zapret profile rollback snapshot is invalid.");
				await RestoreZapretProfileAsync(zapretProfileSnapshot.Profile, transaction, grace);
				break;
			}
			default:
				throw new InvalidOperationException("No rollback handler for resource " + transaction.Resource + ".");
			}
			ServiceResponse terminalResponse = CreateFailureResponse(transaction.RequestId, transaction.ResponseSequence.GetValueOrDefault(), failure);
			await _journal.CompleteAsync(transaction, TransactionPhase.RolledBack, reason, terminalResponse, grace);
			await _log.WarnAsync("Transaction " + transaction.TransactionId + " rolled back: " + reason, grace);
		}
		catch (Exception ex)
		{
			string message = "System mutation failed (" + failure.Message + ") and rollback requires recovery: " + ex.Message;
			ServiceResponse terminalResponse2 = ServiceResponse.Failure(transaction.RequestId, transaction.ResponseSequence.GetValueOrDefault(), "RECOVERY_REQUIRED", message);
			await _journal.MarkRecoveryRequiredAsync(transaction, reason + "; rollback: " + ex.Message, terminalResponse2, CancellationToken.None);
			throw new ServiceOperationException("RECOVERY_REQUIRED", message, retryable: false, ex);
		}
	}

	private async Task RestoreOwnedServiceAsync(OwnedServiceStatus before, ActiveTransaction transaction, CancellationToken cancellationToken)
	{
		OwnedServiceController services = RequireServiceController();
		OwnedServiceStatus ownedServiceStatus = await services.StatusAsync(before.ServiceName, cancellationToken);
		if (ServiceStateMatchesSnapshot(ownedServiceStatus, before))
		{
			return;
		}
		if ((transaction.Desired.GetProperty("state").GetString() ?? throw new InvalidOperationException("Owned-service transaction has no desired state.")) switch
		{
			"installed" => (ownedServiceStatus.Installed && ownedServiceStatus.StartType == "auto") ? 1 : 0, 
			"not-installed" => (!ownedServiceStatus.Installed) ? 1 : 0, 
			"running" => (ownedServiceStatus.Installed && NormalizeRunState(ownedServiceStatus.State) == "running") ? 1 : 0, 
			"stopped" => (ownedServiceStatus.Installed && NormalizeRunState(ownedServiceStatus.State) == "stopped") ? 1 : 0, 
			_ => 0, 
		} == 0)
		{
			throw new InvalidOperationException("Owned service " + before.ServiceName + " no longer matches either the snapshot or transaction post-state; rollback was skipped.");
		}
		if (!before.Installed)
		{
			if (ownedServiceStatus.Installed)
			{
				await services.RemoveAsync(before.ServiceName, cancellationToken);
			}
			if (!(await services.StatusAsync(before.ServiceName, cancellationToken)).Installed)
			{
				return;
			}
			throw new InvalidOperationException("Owned service rollback readback failed for " + before.ServiceName + ": registration remains installed.");
		}
		if (!ownedServiceStatus.Installed)
		{
			ownedServiceStatus = await services.InstallAsync(before.ServiceName, cancellationToken);
		}
		string text = NormalizeRunState(before.State);
		if (text == null)
		{
			return;
		}
		string b = NormalizeRunState(ownedServiceStatus.State);
		if (!string.Equals(text, b, StringComparison.Ordinal))
		{
			if (!(text == "running"))
			{
				await services.StopAsync(before.ServiceName, cancellationToken);
			}
			else
			{
				await services.StartAsync(before.ServiceName, cancellationToken);
			}
		}
		await services.RestoreStartTypeAsync(before.ServiceName, before.StartType, cancellationToken);
		if (ServiceStateMatchesSnapshot(await services.StatusAsync(before.ServiceName, cancellationToken), before))
		{
			return;
		}
		throw new InvalidOperationException("Owned service rollback readback failed for " + before.ServiceName + ".");
	}

	private static bool ServiceStateMatchesSnapshot(OwnedServiceStatus actual, OwnedServiceStatus expected)
	{
		if (actual.Installed != expected.Installed)
		{
			return false;
		}
		if (!expected.Installed)
		{
			return true;
		}
		string text = NormalizeRunState(expected.State);
		bool num = text == null || NormalizeRunState(actual.State) == text;
		string startType = expected.StartType;
		bool flag = ((startType == null || startType == "unknown") ? true : false);
		bool flag2 = flag || string.Equals(actual.StartType, expected.StartType, StringComparison.Ordinal);
		return num & flag2;
	}

	private static string? NormalizeRunState(string? state)
	{
		switch (state)
		{
		case "running":
		case "start_pending":
		case "continue_pending":
			return "running";
		case "stopped":
		case "pause_pending":
		case "stop_pending":
		case "paused":
			return "stopped";
		default:
			return null;
		}
	}

	private async Task RestoreZapretProfileAsync(string? profile, ActiveTransaction transaction, CancellationToken cancellationToken)
	{
		OwnedServiceController services = RequireServiceController();
		if (!(await services.StatusAsync("EgoistShieldZapret", cancellationToken)).Installed)
		{
			throw new InvalidOperationException("Zapret service disappeared before profile rollback.");
		}
		string a = await services.ReadZapretProfileAsync(cancellationToken);
		if (!string.Equals(a, profile, StringComparison.Ordinal))
		{
			string b = transaction.Desired.GetProperty("profile").GetString();
			if (!string.Equals(a, b, StringComparison.Ordinal))
			{
				throw new InvalidOperationException("Zapret profile no longer matches the transaction post-state; rollback was skipped.");
			}
			if (!string.IsNullOrWhiteSpace(profile))
			{
				await services.SetZapretProfileAsync(profile, cancellationToken);
			}
			else
			{
				await services.ClearZapretProfileAsync(cancellationToken);
			}
			if (!string.Equals(await services.ReadZapretProfileAsync(cancellationToken), profile, StringComparison.Ordinal))
			{
				throw new InvalidOperationException("Zapret profile rollback readback failed.");
			}
		}
	}

	private static ActiveTransaction CreateTransaction(ServiceRequest request, string resource, JsonElement original, JsonElement desired, long sequence)
	{
		DateTimeOffset utcNow = DateTimeOffset.UtcNow;
		return new ActiveTransaction(1, "EgoistShield", Guid.NewGuid().ToString("N"), request.RequestId, resource, request.Operation, TransactionPhase.Prepared, original.Clone(), desired.Clone(), utcNow, utcNow, null, null, Fingerprint(request), sequence);
	}

	private Task<DnsOwnedState?> ReadDnsOwnedStateAsync(CancellationToken cancellationToken)
	{
		return AtomicJsonFile.ReadAsync<DnsOwnedState>(_dnsOwnedStatePath, cancellationToken);
	}

	private async Task WriteDnsOwnedStateAsync(DnsOwnedState? state, CancellationToken cancellationToken)
	{
		if (state == null)
		{
			if (File.Exists(_dnsOwnedStatePath)) File.Delete(_dnsOwnedStatePath);
			return;
		}
		state.Validate();
		await AtomicJsonFile.WriteAsync(_dnsOwnedStatePath, state, cancellationToken);
	}

	private static string[]? ReadDesiredDnsServers(ActiveTransaction transaction)
	{
		string operation = transaction.Operation;
		if (!(operation == "dns.apply") && !(operation == "dns.doh.apply"))
		{
			return null;
		}
		if (!transaction.Desired.TryGetProperty("servers", out var value))
		{
			throw new InvalidOperationException("DNS transaction does not contain its desired server list.");
		}
		return value.Deserialize<string[]>(JsonDefaults.StateOptions) ?? throw new InvalidOperationException("DNS transaction contains an invalid desired server list.");
	}

	private static ServiceResponse CreateFailureResponse(string requestId, long sequence, Exception error)
	{
		if (error is StateReadException readError)
			return ServiceResponse.Failure(requestId, sequence, readError.Kind == AtomicJsonReadKind.Corrupt ? "STATE_CORRUPT" : "STATE_UNAVAILABLE",
				readError.Message, readError.Kind == AtomicJsonReadKind.Unavailable);
		if (!(error is ServiceOperationException ex))
		{
			if (!(error is JsonException) && !(error is ArgumentException))
			{
				if (!(error is UnauthorizedAccessException))
				{
					if (!(error is TimeoutException))
					{
						if (error is OperationCanceledException)
						{
							return ServiceResponse.Failure(requestId, sequence, "OPERATION_CANCELLED", "The operation was cancelled; inspect recovery.status before retrying.", retryable: true);
						}
						return ServiceResponse.Failure(requestId, sequence, "OPERATION_FAILED", error.Message);
					}
					return ServiceResponse.Failure(requestId, sequence, "OPERATION_TIMEOUT", error.Message, retryable: true);
				}
				return ServiceResponse.Failure(requestId, sequence, "OWNERSHIP_VIOLATION", error.Message);
			}
			return ServiceResponse.Failure(requestId, sequence, "INVALID_PAYLOAD", error.Message);
		}
		return ServiceResponse.Failure(requestId, sequence, ex.Code, ex.Message, ex.Retryable);
	}

	private async Task<bool> VerifyRecordedPostStateAsync(ActiveTransaction transaction, CancellationToken cancellationToken)
	{
		if (!transaction.Verified.HasValue)
		{
			return false;
		}
		try
		{
			switch (transaction.Resource)
			{
			case "dns":
				if (transaction.Operation == "dns.restore-owned" && await ReadDnsOwnedStateAsync(cancellationToken) != null) return false;
				return await _dns.MatchesRecordedPostStateAsync(transaction, cancellationToken);
			case "native-doh":
			{
				if (transaction.Operation == "dns.doh.apply")
				{
					NativeDohHealth nativeDohHealth = await ReadNativeDohHealthAsync(cancellationToken);
					string b = transaction.Desired.GetProperty("url").GetString() ?? string.Empty;
					string[] array = ReadDesiredDnsServers(transaction) ?? Array.Empty<string>();
					return (object)nativeDohHealth.State != null && string.Equals(nativeDohHealth.State.Url, b, StringComparison.OrdinalIgnoreCase) && nativeDohHealth.State.Servers.SequenceEqual<string>(array, StringComparer.OrdinalIgnoreCase) && nativeDohHealth.EntriesMatch && nativeDohHealth.DnsOwned;
				}
				if ((object)(await _nativeDoh.ReadOwnedStateAsync(cancellationToken)) != null || !transaction.Verified.Value.TryGetProperty("adapters", out var value))
				{
					return false;
				}
				return DnsSnapshotsMatch(expected: value.Deserialize<DnsAdapterSnapshot[]>(JsonDefaults.StateOptions) ?? Array.Empty<DnsAdapterSnapshot>(), actual: await _dns.ReadSnapshotAsync(cancellationToken));
			}
			case "owned-service":
			{
				OwnedServiceController ownedServiceController2 = RequireServiceController();
				string serviceName = transaction.Desired.GetProperty("serviceName").GetString() ?? throw new InvalidOperationException("Verified service transaction has no serviceName.");
				string desiredState = transaction.Desired.GetProperty("state").GetString() ?? throw new InvalidOperationException("Verified service transaction has no desired state.");
				OwnedServiceStatus ownedServiceStatus = await ownedServiceController2.StatusAsync(serviceName, cancellationToken);
				return desiredState switch
				{
					"installed" => ownedServiceStatus.Installed && ownedServiceStatus.StartType == "auto", 
					"not-installed" => !ownedServiceStatus.Installed, 
					"running" => ownedServiceStatus.Installed && NormalizeRunState(ownedServiceStatus.State) == "running", 
					"stopped" => ownedServiceStatus.Installed && NormalizeRunState(ownedServiceStatus.State) == "stopped", 
					_ => false, 
				};
			}
			case "zapret-profile":
			{
				OwnedServiceController ownedServiceController = RequireServiceController();
				return string.Equals(b: transaction.Desired.GetProperty("profile").GetString(), a: await ownedServiceController.ReadZapretProfileAsync(cancellationToken), comparisonType: StringComparison.Ordinal);
			}
			default:
				return transaction.Operation == "test.delay-mutation";
			}
		}
		catch
		{
			return false;
		}
	}

	private async Task<NativeDohHealth> ReadNativeDohHealthAsync(CancellationToken cancellationToken)
	{
		DnsAdapterSnapshot[] adapters = await _dns.ReadSnapshotAsync(cancellationToken);
		NativeDohOwnedState state = await _nativeDoh.ReadOwnedStateAsync(cancellationToken);
		ValidateNativeDohOwnedState(state);
		if ((object)state == null)
		{
			return new NativeDohHealth(null, adapters, Array.Empty<NativeDohEntrySnapshot>(), EntriesMatch: false, DnsOwned: false);
		}
		NativeDohEntrySnapshot[] entries = await _nativeDoh.ReadEntriesAsync(state.Servers, cancellationToken);
		return new NativeDohHealth(state, adapters, entries, WindowsNativeDohController.EntriesMatch(entries, state), DnsMatchesServers(adapters, state.Servers));
	}

	private async Task<DnsAdapterSnapshot[]> RestoreNativeDohDnsBaselineAsync(NativeDohOwnedState state, DnsAdapterSnapshot[] current, CancellationToken cancellationToken)
	{
		DnsAdapterSnapshot[] originalDnsAdapters = state.OriginalDnsAdapters;
		if (originalDnsAdapters != null && originalDnsAdapters.Length > 0)
		{
			var targets = NativeDohRestoreTargets(state, current);
			if (targets.Length != 0)
			{
				var expected = WindowsDnsController.IntersectByStableIdentity(current, targets);
				await _dns.RestoreFromExpectedSnapshotAsync(targets, expected, cancellationToken);
			}
			return await _dns.ReadSnapshotAsync(cancellationToken);
		}
		return DnsMatchesServers(current, state.Servers) ? await _dns.ResetAsync(current, cancellationToken) : current;
	}

	private static DnsAdapterSnapshot[] NativeDohRestoreTargets(NativeDohOwnedState state, DnsAdapterSnapshot[] current) =>
		new DnsOwnedState(1, "EgoistShield", state.Servers, state.OriginalDnsAdapters ?? Array.Empty<DnsAdapterSnapshot>())
			.RestoreTargets(current, out _, repairLoopback: false);

	private static void ValidateNativeDohOwnedState(NativeDohOwnedState? state)
	{
		if ((object)state != null)
		{
			if (state.SchemaVersion != 1 || !string.Equals(state.Owner, "EgoistShield", StringComparison.Ordinal))
			{
				throw new InvalidOperationException("Native DoH ownership state has an unsupported schema or owner.");
			}
			WindowsNativeDohController.ValidateUrl(state.Url);
			WindowsDnsController.ValidateServers(state.Servers);
		}
	}

	private static NativeDohEntrySnapshot[] BuildNativeDohOriginalEntries(NativeDohOwnedState? before, IReadOnlyCollection<NativeDohEntrySnapshot> currentEntries, IReadOnlyCollection<string> desiredServers)
	{
		List<NativeDohEntrySnapshot> list = new List<NativeDohEntrySnapshot>();
		foreach (string server in desiredServers)
		{
			NativeDohEntrySnapshot nativeDohEntrySnapshot = before?.OriginalEntries?.SingleOrDefault((NativeDohEntrySnapshot entry) => entry.ServerAddress.Equals(server, StringComparison.OrdinalIgnoreCase));
			if ((object)nativeDohEntrySnapshot != null)
			{
				list.Add(nativeDohEntrySnapshot);
				continue;
			}
			if ((object)before != null && before.Servers.Contains<string>(server, StringComparer.OrdinalIgnoreCase))
			{
				list.Add(new NativeDohEntrySnapshot(server, Existed: false, null, AllowFallbackToUdp: false, AutoUpgrade: false));
				continue;
			}
			list.Add(currentEntries.Single((NativeDohEntrySnapshot entry) => entry.ServerAddress.Equals(server, StringComparison.OrdinalIgnoreCase)));
		}
		return list.ToArray();
	}

	private static NativeDohOwnedState SliceNativeDohOwnedState(NativeDohOwnedState state, IReadOnlyCollection<string> servers)
	{
		string[] selected = state.Servers.Where((string server) => servers.Contains<string>(server, StringComparer.OrdinalIgnoreCase)).ToArray();
		NativeDohEntrySnapshot[] originalEntries = state.OriginalEntries?.Where((NativeDohEntrySnapshot entry) => selected.Contains<string>(entry.ServerAddress, StringComparer.OrdinalIgnoreCase)).ToArray();
		return state with
		{
			Servers = selected,
			OriginalEntries = originalEntries
		};
	}

	private static bool DnsMatchesServers(IReadOnlyCollection<DnsAdapterSnapshot> adapters, IReadOnlyCollection<string> servers)
	{
		string[] ipv4 = servers.Where((string server) => IPAddress.Parse(server).AddressFamily == AddressFamily.InterNetwork).ToArray();
		string[] ipv6 = servers.Where((string server) => IPAddress.Parse(server).AddressFamily == AddressFamily.InterNetworkV6).ToArray();
		if (adapters.Count > 0)
		{
			return adapters.All((DnsAdapterSnapshot adapter) => (ipv4.Length == 0 || (adapter.Ipv4Static && adapter.Ipv4.SequenceEqual<string>(ipv4, StringComparer.OrdinalIgnoreCase))) && (ipv6.Length == 0 || (adapter.Ipv6Static && adapter.Ipv6.SequenceEqual<string>(ipv6, StringComparer.OrdinalIgnoreCase))));
		}
		return false;
	}

	private static bool DnsSnapshotsMatch(IReadOnlyCollection<DnsAdapterSnapshot> actual, IReadOnlyCollection<DnsAdapterSnapshot> expected)
	{
		if (actual.Count != expected.Count || expected.Count == 0)
		{
			return false;
		}
		return expected.All(delegate(DnsAdapterSnapshot target)
		{
			DnsAdapterSnapshot dnsAdapterSnapshot = actual.SingleOrDefault((DnsAdapterSnapshot adapter) => string.Equals(adapter.InterfaceGuid, target.InterfaceGuid, StringComparison.OrdinalIgnoreCase));
			return (object)dnsAdapterSnapshot != null && dnsAdapterSnapshot.Ipv4Static == target.Ipv4Static && dnsAdapterSnapshot.Ipv6Static == target.Ipv6Static && (!target.Ipv4Static || dnsAdapterSnapshot.Ipv4.SequenceEqual<string>(target.Ipv4, StringComparer.OrdinalIgnoreCase)) && (!target.Ipv6Static || dnsAdapterSnapshot.Ipv6.SequenceEqual<string>(target.Ipv6, StringComparer.OrdinalIgnoreCase));
		});
	}

	private OwnedServiceController RequireServiceController()
	{
		return _services ?? throw new ServiceOperationException("SERVICE_NOT_CONFIGURED", "Owned service control is unavailable until install root is configured.");
	}

	private static string ReadOwnedServiceName(ServiceRequest request)
	{
		return OwnedServiceController.NormalizeServiceName((request.Payload.Deserialize<OwnedServicePayload>(JsonDefaults.Options) ?? throw new ArgumentException("Owned service payload is required.")).ServiceName ?? string.Empty);
	}

	private static string Fingerprint(ServiceRequest request)
	{
		string value = ((request.Payload.ValueKind == JsonValueKind.Undefined) ? "{}" : JsonSerializer.Serialize(request.Payload, JsonDefaults.Options));
		string s = $"{request.ProtocolVersion}\n{request.Operation}\n{value}";
		return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s)));
	}

	private void TrimResponseCache()
	{
		lock (_responseCacheLock)
		{
			var entries = _responses.ToArray().OrderBy(entry => entry.Value.CompletedAt).ToArray();
			long bytes = entries.Sum(entry => (long)entry.Value.Bytes);
			int count = entries.Length;
			foreach (var entry in entries)
			{
				if (count <= 1024 && bytes <= MaxResponseCacheBytes) break;
				if (_responses.TryRemove(entry.Key, out var removed)) { count--; bytes -= removed.Bytes; }
			}
		}
	}

	private void CacheResponse(string requestId, string fingerprint, ServiceResponse response)
	{
		int bytes = JsonSerializer.SerializeToUtf8Bytes(response, JsonDefaults.StateOptions).Length;
		if (bytes > MaxCachedResponseBytes) return;
		lock (_responseCacheLock)
		{
			_responses.TryAdd(requestId, new CachedResponse(fingerprint, response, DateTimeOffset.UtcNow, bytes));
			TrimResponseCache();
		}
	}

	private static ServiceResponse UnknownOperation(string requestId, long sequence) => ServiceResponse.Failure(requestId, sequence,
		"OPERATION_OUTCOME_UNKNOWN", "A durable operation intent exists but its result is not committed. The operation will not execute again; inspect operation.status and current component state.");

	private static PersistedOperationIntent CreateComponentIntent(ServiceRequest request, string fingerprint)
	{
		if (request.Payload.ValueKind != JsonValueKind.Object ||
			!request.Payload.TryGetProperty("component", out var component) || component.ValueKind != JsonValueKind.String ||
			component.GetString() is not ("SystemDoH" or "Zapret" or "TelegramProxy" or "Vpn") ||
			!request.Payload.TryGetProperty("method", out var method) || method.ValueKind != JsonValueKind.String ||
			string.IsNullOrWhiteSpace(method.GetString()) || method.GetString()!.Length > 128 || method.GetString()!.Any(char.IsControl) ||
			!request.Payload.TryGetProperty("args", out var args) || args.ValueKind != JsonValueKind.Array || args.GetArrayLength() > 4)
			throw new ArgumentException("Invalid owned component operation payload.");
		return new PersistedOperationIntent(request.RequestId, fingerprint, component.GetString()!, method.GetString()!, DateTimeOffset.UtcNow);
	}

	internal async Task<object> DescribePersistenceAsync(CancellationToken cancellationToken = default)
	{
		var active = await _journal.ReadActiveResultAsync(cancellationToken);
		var problems = new List<object>();
		if (_startupStateError != null) problems.Add(DescribeStateError(_startupStateError));
		IReadOnlyList<PersistedOperationIntent> intents = Array.Empty<PersistedOperationIntent>();
		try { intents = await _journal.ReadOperationIntentsAsync(cancellationToken); }
		catch (StateReadException error) { problems.Add(DescribeStateError(error)); }
		try { await _journal.ReadResponsesAsync(cancellationToken); }
		catch (StateReadException error) { problems.Add(DescribeStateError(error)); }
		var original = JsonDefaults.ToElement(_journal.Describe(active.Value));
		bool uncertain = active.Kind is AtomicJsonReadKind.Corrupt or AtomicJsonReadKind.Unavailable || problems.Count != 0;
		return new { recoveryRequired = uncertain || intents.Count != 0 || original.GetProperty("recoveryRequired").GetBoolean(),
			mutationReady = active.Kind == AtomicJsonReadKind.Missing && intents.Count == 0 && problems.Count == 0,
			active = original.GetProperty("active").Clone(), journal = active.Describe(), persistenceProblems = problems,
			pendingOperations = intents.Select(intent => new { requestId = intent.RequestId, component = intent.Component, method = intent.Method,
				startedAt = intent.StartedAt, outcome = intent.TerminalResponse == null ? "unknown" : "commit-pending" }).ToArray(),
			replayRetention = new { maxResponses = 512, maxStoreBytes = TransactionJournal.MaxResponseStoreBytes,
				maxRetainedResponseBytes = TransactionJournal.MaxRetainedResponseBytes, unresolvedIntentsEvicted = false } };
	}

	private static object DescribeStateError(StateReadException error) => new { file = error.FileName,
		kind = error.Kind.ToString().ToLowerInvariant(), errorCode = error.ErrorCode, bytes = error.Bytes, sha256 = error.Sha256 };

	private async Task<object> ReadOperationStatusAsync(ServiceRequest request, CancellationToken cancellationToken)
	{
		string targetId = request.Payload.TryGetProperty("requestId", out var id) && id.ValueKind == JsonValueKind.String ? id.GetString()! : "";
		if (string.IsNullOrWhiteSpace(targetId) || targetId.Length > 128) throw new ArgumentException("A bounded requestId is required.");
		var intent = (await _journal.ReadOperationIntentsAsync(cancellationToken)).SingleOrDefault(value => value.RequestId == targetId);
		var response = await _journal.ReadResponseAsync(targetId, cancellationToken);
		if (intent == null) return new { requestId = targetId, outcome = response == null ? "not-retained" : "committed",
			replayAllowed = false, historicalResultKnown = response != null };
		object observation;
		try
		{
			if (_startupStateError != null) throw _startupStateError;
			using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
			deadline.CancelAfter(TimeSpan.FromSeconds(3));
			var payload = JsonDefaults.ToElement(new { component = intent.Component, method = "status", args = Array.Empty<object>(), requestId = request.RequestId });
			var state = await _executeComponent(payload, true, deadline.Token).WaitAsync(deadline.Token);
			observation = JsonSerializer.SerializeToUtf8Bytes(state, JsonDefaults.StateOptions).Length <= 64 * 1024
				? new { available = true, state = (object)state, evidence = "current-component-status-only" }
				: new { available = false, state = (object?)null, evidence = "observation-too-large" };
		}
		catch (Exception error) when (error is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
		{
			observation = new { available = false, error = error.GetType().Name, evidence = "current-status-unavailable" };
		}
		return new { requestId = targetId, component = intent.Component, method = intent.Method,
			outcome = intent.TerminalResponse == null ? "unknown" : "commit-pending", replayAllowed = false,
			historicalResultKnown = intent.TerminalResponse != null, observation };
	}

	public void Dispose()
	{
		if (_serviceSupervisor != null) NetworkChange.NetworkAddressChanged -= OnNetworkAddressChanged;
		_mutationLock.Dispose();
		if (_componentWorker.IsValueCreated)
		{
			_componentWorker.Value.Dispose();
		}
	}
}
