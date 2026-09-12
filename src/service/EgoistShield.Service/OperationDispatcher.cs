using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed class OperationDispatcher : IDisposable
{
	private sealed record CachedResponse(string Fingerprint, ServiceResponse Response, DateTimeOffset CompletedAt);

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

	private readonly ServiceLog _log;

	private readonly string _dnsOwnedStatePath;

	private readonly SemaphoreSlim _mutationLock = new SemaphoreSlim(1, 1);

	private readonly ConcurrentDictionary<string, CachedResponse> _responses = new ConcurrentDictionary<string, CachedResponse>(StringComparer.Ordinal);

	private readonly ConcurrentDictionary<string, byte> _inFlight = new ConcurrentDictionary<string, byte>(StringComparer.Ordinal);

	private long _sequence;
	private readonly Lazy<ComponentWorker> _componentWorker;

	public OperationDispatcher(ServiceOptions options, WindowsDnsController dns, WindowsNativeDohController nativeDoh, OwnedServiceController? services, TransactionJournal journal, ServiceLog log)
	{
		_options = options;
		_dns = dns;
		_nativeDoh = nativeDoh;
		_services = services;
		_journal = journal;
		_log = log;
		_dnsOwnedStatePath = Path.Combine(options.StateRoot, "dns-owned-state.json");
		_componentWorker = new Lazy<ComponentWorker>(() => new ComponentWorker(options.InstallRoot ?? throw new InvalidOperationException("Component operations require an installed product.")));
	}

	public async Task<ServiceResponse> DispatchAsync(ServiceRequest request, ClientIdentity identity, CancellationToken cancellationToken = default(CancellationToken))
	{
		long sequence = Interlocked.Increment(ref _sequence);
		string fingerprint = Fingerprint(request);
		bool mutation = MutationOperations.Contains(request.Operation);
		if (_responses.TryGetValue(request.RequestId, out CachedResponse value))
		{
			return (value.Fingerprint == fingerprint) ? value.Response : ServiceResponse.Failure(request.RequestId, sequence, "REQUEST_ID_REUSED", "The requestId was already used with a different request.");
		}
		if (mutation)
		{
			PersistedResponseEntry persistedResponseEntry = await _journal.ReadResponseAsync(request.RequestId, cancellationToken);
			if ((object)persistedResponseEntry != null)
			{
				return (persistedResponseEntry.Fingerprint == fingerprint) ? persistedResponseEntry.Response : ServiceResponse.Failure(request.RequestId, sequence, "REQUEST_ID_REUSED", "The requestId was already used with a different persisted mutation.");
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
				return await DispatchMutationAsync(request, identity, sequence, fingerprint, cancellationToken);
			}
			ServiceResponse serviceResponse = await ExecuteAsync(request, identity, sequence, cancellationToken);
			if (serviceResponse.Error?.Code != "REQUEST_IN_FLIGHT")
			{
				_responses.TryAdd(request.RequestId, new CachedResponse(fingerprint, serviceResponse, DateTimeOffset.UtcNow));
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
			ActiveTransaction transaction = await _journal.ReadActiveAsync(cancellationToken);
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
		finally
		{
			_mutationLock.Release();
		}
	}

	private async Task<ServiceResponse> DispatchMutationAsync(ServiceRequest request, ClientIdentity identity, long sequence, string fingerprint, CancellationToken cancellationToken)
	{
		bool isRepair = request.Operation == "network.repair-owned";
		TimeSpan lockTimeout = isRepair ? TimeSpan.FromSeconds(3) : ServiceContract.MutationLockTimeout;
		if (!(await _mutationLock.WaitAsync(lockTimeout, cancellationToken)))
		{
			return ServiceResponse.Failure(request.RequestId, sequence, "MUTATION_BUSY", "Another system mutation is still running.", retryable: true);
		}
		try
		{
			ServiceResponse serviceResponse = await PrepareMutationSlotAsync(request, sequence, cancellationToken);
			if ((object)serviceResponse != null)
			{
				return serviceResponse;
			}
			PersistedResponseEntry persistedResponseEntry = await _journal.ReadResponseAsync(request.RequestId, cancellationToken);
			if ((object)persistedResponseEntry != null)
			{
				return (persistedResponseEntry.Fingerprint == fingerprint) ? persistedResponseEntry.Response : ServiceResponse.Failure(request.RequestId, sequence, "REQUEST_ID_REUSED", "The requestId was already used with a different persisted mutation.");
			}
			ServiceResponse response = await ExecuteAsync(request, identity, sequence, cancellationToken);
			await PersistMutationResponseAsync(request, fingerprint, response, CancellationToken.None);
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

	private async Task PersistMutationResponseAsync(ServiceRequest request, string fingerprint, ServiceResponse response, CancellationToken cancellationToken)
	{
		ActiveTransaction activeTransaction = await _journal.ReadActiveAsync(cancellationToken);
		if ((object)activeTransaction != null && activeTransaction.RequestId.Equals(request.RequestId, StringComparison.Ordinal))
		{
			await _journal.AttachTerminalResponseAsync(activeTransaction, response, cancellationToken);
		}
		await _journal.RecordResponseAsync(request.RequestId, fingerprint, response, cancellationToken);
		_responses.TryAdd(request.RequestId, new CachedResponse(fingerprint, response, DateTimeOffset.UtcNow));
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
		_responses.TryAdd(transaction.RequestId, new CachedResponse(fingerprint, response, DateTimeOffset.UtcNow));
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
			_responses.TryAdd(transaction.RequestId, new CachedResponse(fingerprint, response, DateTimeOffset.UtcNow));
		}
		await _journal.ArchiveTerminalAsync(transaction, cancellationToken);
		await _log.InfoAsync("Finalized terminal transaction marker " + transaction.TransactionId + ".", cancellationToken);
	}

	private async Task<ServiceResponse> ExecuteAsync(ServiceRequest request, ClientIdentity identity, long sequence, CancellationToken cancellationToken)
	{
		try
		{
			if (identity.IdentityProbe && request.Operation != "hello")
			{
				return ServiceResponse.Failure(request.RequestId, sequence, "IDENTITY_PROBE_SCOPE", "The Core identity probe may call hello only.");
			}
			object obj;
			switch (request.Operation)
			{
			case "component.execute":
			case "component.query":
				obj = await _componentWorker.Value.ExecuteAsync(request.Payload, request.Operation == "component.query", cancellationToken);
				break;
			case "hello":
				obj = new
				{
					protocolVersion = 1,
					serviceVersion = BuildInfo.Version,
					pipeName = _options.PipeName,
					clientPid = identity.ProcessId,
					developmentOverride = identity.DevelopmentOverride,
					identityProbe = identity.IdentityProbe
				};
				break;
			case "service.status":
				obj = new
				{
					serviceName = "EgoistShieldCore",
					version = BuildInfo.Version,
					processId = Environment.ProcessId,
					startedAt = Program.StartedAt,
					consoleMode = _options.ConsoleMode
				};
				break;
			case "recovery.status":
			{
				TransactionJournal journal = _journal;
				obj = journal.Describe(await _journal.ReadActiveAsync(cancellationToken));
				break;
			}
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

	private async Task<object> ExecuteDnsApplyAsync(ServiceRequest request, long sequence, CancellationToken cancellationToken)
	{
		DnsApplyPayload dnsApplyPayload = request.Payload.Deserialize<DnsApplyPayload>(JsonDefaults.Options) ?? throw new ArgumentException("DNS payload is required.");
		string[] servers = WindowsDnsController.ValidateServers(dnsApplyPayload.Servers ?? Array.Empty<string>());
		string[] probeHosts = WindowsDnsController.ValidateProbeHosts(dnsApplyPayload.ProbeHosts ?? Array.Empty<string>());
		DnsAdapterSnapshot[] original = await _dns.ReadSnapshotAsync(cancellationToken);
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
		NativeDohHealth nativeDohHealth = await ReadNativeDohHealthAsync(cancellationToken);
		return new
		{
			enabled = ((object)nativeDohHealth.State != null),
			verified = ((object)nativeDohHealth.State != null && nativeDohHealth.EntriesMatch && nativeDohHealth.DnsOwned),
			encrypted = ((object)nativeDohHealth.State != null && nativeDohHealth.EntriesMatch),
			nativeManaged = true,
			url = nativeDohHealth.State?.Url,
			servers = (nativeDohHealth.State?.Servers ?? Array.Empty<string>()),
			adapters = nativeDohHealth.Adapters,
			updatedAt = nativeDohHealth.State?.UpdatedAt,
			fallbackToUdp = false
		};
	}

	private async Task<object> ExecuteNativeDohApplyAsync(ServiceRequest request, long sequence, CancellationToken cancellationToken)
	{
		NativeDohApplyPayload nativeDohApplyPayload = request.Payload.Deserialize<NativeDohApplyPayload>(JsonDefaults.Options) ?? throw new ArgumentException("Native DoH payload is required.");
		string url = WindowsNativeDohController.ValidateUrl(nativeDohApplyPayload.Url);
		string[] servers = WindowsDnsController.ValidateServers(nativeDohApplyPayload.Servers ?? Array.Empty<string>());
		string[] probeHosts = WindowsDnsController.ValidateProbeHosts(nativeDohApplyPayload.ProbeHosts ?? Array.Empty<string>());
		DnsAdapterSnapshot[] originalDns = await _dns.ReadSnapshotAsync(cancellationToken);
		NativeDohOwnedState before = await _nativeDoh.ReadOwnedStateAsync(cancellationToken);
		ValidateNativeDohOwnedState(before);
		string[] rawServers = servers.Concat(before?.Servers ?? Array.Empty<string>()).Distinct<string>(StringComparer.OrdinalIgnoreCase).ToArray();
		NativeDohEntrySnapshot[] beforeEntries = await _nativeDoh.ReadEntriesAsync(rawServers, cancellationToken);
		NativeDohTransactionSnapshot value = new NativeDohTransactionSnapshot(originalDns, before, beforeEntries);
		ActiveTransaction transaction = CreateTransaction(request, "native-doh", JsonDefaults.ToElement(value), JsonDefaults.ToElement(new { url, servers, probeHosts }), sequence);
		await _journal.CreateActiveAsync(transaction, cancellationToken);
		try
		{
			await _journal.UpdatePhaseAsync(transaction, TransactionPhase.Applying, null, cancellationToken);
			NativeDohEntrySnapshot[] originalEntries = BuildNativeDohOriginalEntries(before, beforeEntries, servers);
			if ((object)before != null)
			{
				bool urlChanged = !string.Equals(before.Url, url, StringComparison.OrdinalIgnoreCase);
				string[] array = before.Servers.Where((string server) => urlChanged || !servers.Contains<string>(server, StringComparer.OrdinalIgnoreCase)).ToArray();
				if (array.Length != 0)
				{
					await _nativeDoh.RemoveOwnedEntriesAsync(SliceNativeDohOwnedState(before, array), cancellationToken);
				}
			}
			await _nativeDoh.ConfigureAsync(url, servers, cancellationToken);
			DnsAdapterSnapshot[] actual = await _dns.ApplyAsync(originalDns, servers, probeHosts, cancellationToken);
			NativeDohOwnedState state = new NativeDohOwnedState(1, "EgoistShield", url, servers, DateTimeOffset.UtcNow, originalEntries, before?.OriginalDnsAdapters ?? originalDns);
			await _nativeDoh.WriteOwnedStateAsync(state, cancellationToken);
			if (!WindowsNativeDohController.EntriesMatch(await _nativeDoh.ReadEntriesAsync(servers, cancellationToken), state))
			{
				throw new InvalidOperationException("Windows native DoH post-configuration verification failed.");
			}
			object result = new
			{
				enabled = true,
				verified = true,
				encrypted = true,
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
			DnsAdapterSnapshot[] array2 = ((!dnsOwned) ? originalDns : (await RestoreNativeDohDnsBaselineAsync(before, originalDns, cancellationToken)));
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
		ActiveTransaction transaction = CreateTransaction(request, "owned-service", JsonDefaults.ToElement(await services.StatusAsync(serviceName, cancellationToken)), JsonDefaults.ToElement(new
		{
			serviceName = serviceName,
			state = desiredState
		}), sequence);
		await _journal.CreateActiveAsync(transaction, cancellationToken);
		try
		{
			await _journal.UpdatePhaseAsync(transaction, TransactionPhase.Applying, null, cancellationToken);
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
					DnsAdapterSnapshot[] array = ((!health.DnsOwned) ? health.Adapters : (await RestoreNativeDohDnsBaselineAsync(health.State, health.Adapters, cancellationToken)));
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
						await _dns.RestoreFromExpectedSnapshotAsync(nativeBefore.Adapters, array, grace);
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
							return ServiceResponse.Failure(requestId, sequence, "OPERATION_CANCELLED", "The operation was cancelled and any owned mutation was rolled back.", retryable: true);
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
			DnsAdapterSnapshot[] array = WindowsDnsController.IntersectByStableIdentity(originalDnsAdapters, current);
			if (array.Length != 0)
			{
				await _dns.RestoreAsync(array, "dns.apply", state.Servers, cancellationToken);
			}
			return await _dns.ReadSnapshotAsync(cancellationToken);
		}
		return await _dns.ResetAsync(current, cancellationToken);
	}

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
		if (_responses.Count <= 1024)
		{
			return;
		}
		foreach (string item in from entry in (from entry in _responses.ToArray()
				orderby entry.Value.CompletedAt
				select entry).Take(_responses.Count - 768)
			select entry.Key)
		{
			_responses.TryRemove(item, out CachedResponse _);
		}
	}

	public void Dispose()
	{
		_mutationLock.Dispose();
		if (_componentWorker.IsValueCreated)
		{
			_componentWorker.Value.Dispose();
		}
	}
}
