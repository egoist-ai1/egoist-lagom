using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed class TransactionJournal
{
	private readonly string _activePath;

	private readonly string _historyPath;

	private readonly string _responsesPath;
	private readonly string _intentsPath;

	private readonly SemaphoreSlim _writeLock = new SemaphoreSlim(1, 1);

	private const long MaxHistoryBytes = 5242880L;

	private const int MaxPersistedResponses = 512;
	internal const int MaxResponseStoreBytes = 4 * 1024 * 1024;
	internal const int MaxRetainedResponseBytes = 256 * 1024;
	internal const int MaxPendingOperations = 128;

	public TransactionJournal(string stateRoot)
	{
		_activePath = Path.Combine(stateRoot, "active-transaction.json");
		_historyPath = Path.Combine(stateRoot, "transactions.jsonl");
		_responsesPath = Path.Combine(stateRoot, "idempotency-responses.json");
		_intentsPath = Path.Combine(stateRoot, "operation-intents.json");
	}

	public async Task<ActiveTransaction?> ReadActiveAsync(CancellationToken cancellationToken = default)
	{
		return (await ReadActiveResultAsync(cancellationToken)).ValueOrThrow(Path.GetFileName(_activePath));
	}

	internal async Task<AtomicJsonReadResult<ActiveTransaction>> ReadActiveResultAsync(CancellationToken cancellationToken = default)
	{
		var result = await AtomicJsonFile.ReadResultAsync<ActiveTransaction>(_activePath, cancellationToken);
		if (result.Kind != AtomicJsonReadKind.Valid) return result;
		var value = result.Value!;
		if (value.SchemaVersion != 1 || value.Owner != "EgoistShield" || !ValidIdentity(value.TransactionId) ||
			!ValidIdentity(value.RequestId) || !Enum.IsDefined(value.Phase) ||
			value.Resource is not ("dns" or "native-doh" or "owned-service" or "zapret-profile" or "test") ||
			string.IsNullOrWhiteSpace(value.Operation) || value.Operation.Length > 128 ||
			value.Original.ValueKind == JsonValueKind.Undefined || value.Desired.ValueKind == JsonValueKind.Undefined ||
			value.CreatedAt == default || value.UpdatedAt == default)
			return result with { Kind = AtomicJsonReadKind.Corrupt, Value = null, ErrorCode = "JOURNAL_IDENTITY_INVALID" };
		return result;
	}

	public async Task WriteActiveAsync(ActiveTransaction transaction, CancellationToken cancellationToken = default(CancellationToken))
	{
		await _writeLock.WaitAsync(cancellationToken);
		try
		{
			await AtomicJsonFile.WriteAsync(_activePath, transaction, cancellationToken);
		}
		finally
		{
			_writeLock.Release();
		}
	}

	public async Task CreateActiveAsync(ActiveTransaction transaction, CancellationToken cancellationToken = default(CancellationToken))
	{
		await _writeLock.WaitAsync(cancellationToken);
		try
		{
			if (!(await AtomicJsonFile.TryCreateAsync(_activePath, transaction, cancellationToken)))
			{
				throw new InvalidOperationException("An unfinished transaction marker already exists.");
			}
		}
		finally
		{
			_writeLock.Release();
		}
	}

	public async Task UpdatePhaseAsync(ActiveTransaction transaction, TransactionPhase phase, string? lastError, CancellationToken cancellationToken = default(CancellationToken))
	{
		await UpdateActiveAsync(transaction, (ActiveTransaction current) => current with
		{
			Phase = phase,
			UpdatedAt = DateTimeOffset.UtcNow,
			LastError = lastError
		}, cancellationToken);
	}

	public async Task MarkVerifiedAsync(ActiveTransaction transaction, object verified, CancellationToken cancellationToken = default(CancellationToken))
	{
		JsonElement verifiedElement = JsonDefaults.ToElement(verified).Clone();
		await UpdateActiveAsync(transaction, (ActiveTransaction current) => current with
		{
			Phase = TransactionPhase.Verified,
			Verified = verifiedElement,
			UpdatedAt = DateTimeOffset.UtcNow,
			LastError = null
		}, cancellationToken);
	}

	public async Task AttachTerminalResponseAsync(ActiveTransaction transaction, ServiceResponse response, CancellationToken cancellationToken = default(CancellationToken))
	{
		await UpdateActiveAsync(transaction, (ActiveTransaction current) => current with
		{
			TerminalResponse = response,
			UpdatedAt = DateTimeOffset.UtcNow
		}, cancellationToken);
	}

	public async Task CompleteAsync(ActiveTransaction transaction, TransactionPhase terminalPhase, string? lastError, ServiceResponse? terminalResponse = null, CancellationToken cancellationToken = default(CancellationToken))
	{
		if (terminalPhase != TransactionPhase.Committed && terminalPhase != TransactionPhase.RolledBack)
		{
			throw new ArgumentOutOfRangeException("terminalPhase", terminalPhase, "Only committed or rolled-back transactions are terminal.");
		}
		await UpdateActiveAsync(transaction, (ActiveTransaction current) => current with
		{
			Phase = terminalPhase,
			UpdatedAt = DateTimeOffset.UtcNow,
			LastError = lastError,
			TerminalResponse = (terminalResponse ?? current.TerminalResponse)
		}, cancellationToken);
	}

	public async Task MarkRecoveryRequiredAsync(ActiveTransaction transaction, string lastError, ServiceResponse terminalResponse, CancellationToken cancellationToken = default(CancellationToken))
	{
		await UpdateActiveAsync(transaction, (ActiveTransaction current) => current with
		{
			Phase = TransactionPhase.RecoveryRequired,
			UpdatedAt = DateTimeOffset.UtcNow,
			LastError = lastError,
			TerminalResponse = terminalResponse
		}, cancellationToken);
	}

	public async Task ArchiveTerminalAsync(ActiveTransaction completed, CancellationToken cancellationToken = default(CancellationToken))
	{
		TransactionPhase phase = completed.Phase;
		if (phase != TransactionPhase.Committed && phase != TransactionPhase.RolledBack)
		{
			throw new InvalidOperationException($"Cannot archive non-terminal transaction phase {completed.Phase}.");
		}
		await _writeLock.WaitAsync(cancellationToken);
		try
		{
			ActiveTransaction activeTransaction = await ReadActiveAsync(cancellationToken);
			if ((object)activeTransaction != null)
			{
				if (!activeTransaction.TransactionId.Equals(completed.TransactionId, StringComparison.Ordinal))
				{
					throw new InvalidOperationException("Refusing to archive a transaction marker that has been replaced.");
				}
				phase = activeTransaction.Phase;
				if (phase != TransactionPhase.Committed && phase != TransactionPhase.RolledBack)
				{
					throw new InvalidOperationException($"Cannot archive active transaction phase {activeTransaction.Phase}.");
				}
				completed = activeTransaction;
				Directory.CreateDirectory(Path.GetDirectoryName(_historyPath));
				string marker = "\"transactionId\":\"" + completed.TransactionId + "\"";
				string text = ((!File.Exists(_historyPath)) ? string.Empty : (await File.ReadAllTextAsync(_historyPath, cancellationToken)));
				if (!text.Contains(marker, StringComparison.Ordinal))
				{
					string contents = JsonSerializer.Serialize(completed, JsonDefaults.StateOptions) + Environment.NewLine;
					await File.AppendAllTextAsync(_historyPath, contents, cancellationToken);
				}
				await TrimHistoryUnsafeAsync(cancellationToken);
				if (File.Exists(_activePath))
				{
					File.Delete(_activePath);
				}
			}
		}
		finally
		{
			_writeLock.Release();
		}
	}

	public async Task<PersistedResponseEntry?> ReadResponseAsync(string requestId, CancellationToken cancellationToken = default(CancellationToken))
	{
		return (await ReadResponsesAsync(cancellationToken))?.Entries.LastOrDefault(entry => entry.RequestId.Equals(requestId, StringComparison.Ordinal));
	}

	public async Task RecordResponseAsync(string requestId, string fingerprint, ServiceResponse response, CancellationToken cancellationToken = default(CancellationToken))
	{
		await _writeLock.WaitAsync(cancellationToken);
		try
		{
			PersistedResponseStore persistedResponseStore = (await ReadResponsesAsync(cancellationToken)) ?? new PersistedResponseStore(1, "EgoistShield", new List<PersistedResponseEntry>());
			PersistedResponseEntry persistedResponseEntry = persistedResponseStore.Entries.LastOrDefault((PersistedResponseEntry entry) => entry.RequestId.Equals(requestId, StringComparison.Ordinal));
			if ((object)persistedResponseEntry != null)
			{
				if (!persistedResponseEntry.Fingerprint.Equals(fingerprint, StringComparison.Ordinal))
				{
					throw new InvalidOperationException("A durable response already exists for the requestId with a different fingerprint.");
				}
				return;
			}
			List<PersistedResponseEntry> list = persistedResponseStore.Entries.ToList();
			list.Add(new PersistedResponseEntry(requestId, fingerprint, BoundResponse(response), DateTimeOffset.UtcNow));
			if (list.Count > MaxPersistedResponses)
			{
				list.RemoveRange(0, list.Count - MaxPersistedResponses);
			}
			var bounded = new PersistedResponseStore(1, "EgoistShield", list);
			while (JsonSerializer.SerializeToUtf8Bytes(bounded, JsonDefaults.StateOptions).Length > MaxResponseStoreBytes && list.Count > 1)
				list.RemoveAt(0);
			await AtomicJsonFile.WriteAsync(_responsesPath, bounded, cancellationToken);
		}
		finally
		{
			_writeLock.Release();
		}
	}

	internal async Task<PersistedResponseStore?> ReadResponsesAsync(CancellationToken cancellationToken = default)
	{
		var result = await AtomicJsonFile.ReadResultAsync<PersistedResponseStore>(_responsesPath, cancellationToken);
		var value = result.ValueOrThrow(Path.GetFileName(_responsesPath));
		if (value == null) return null;
		if (value.SchemaVersion != 1 || value.Owner != "EgoistShield" || value.Entries == null || value.Entries.Count > MaxPersistedResponses ||
			value.Entries.Any(entry => entry == null || !ValidIdentity(entry.RequestId) || string.IsNullOrEmpty(entry.Fingerprint) ||
				entry.Fingerprint.Length > 128 || entry.Response == null || entry.Response.RequestId != entry.RequestId) ||
			value.Entries.Select(entry => entry.RequestId).Distinct(StringComparer.Ordinal).Count() != value.Entries.Count)
			throw new StateReadException(AtomicJsonReadKind.Corrupt, Path.GetFileName(_responsesPath), "RESPONSE_IDENTITY_INVALID", result.Bytes, result.Sha256);
		return value;
	}

	internal async Task<IReadOnlyList<PersistedOperationIntent>> ReadOperationIntentsAsync(CancellationToken cancellationToken = default)
	{
		var result = await AtomicJsonFile.ReadResultAsync<PersistedOperationIntentStore>(_intentsPath, cancellationToken,
			MaxResponseStoreBytes);
		var value = result.ValueOrThrow(Path.GetFileName(_intentsPath));
		if (value == null) return Array.Empty<PersistedOperationIntent>();
		if (value.SchemaVersion != 1 || value.Owner != "EgoistShield" || value.Entries == null || value.Entries.Count > MaxPendingOperations ||
			value.Entries.Any(entry => entry == null || !ValidIdentity(entry.RequestId) || entry.Fingerprint == null || entry.Fingerprint.Length != 64 ||
				entry.Component is not ("SystemDoH" or "Zapret" or "TelegramProxy" or "Vpn") || !ValidIdentity(entry.Method) ||
				entry.StartedAt == default || entry.TerminalResponse != null && entry.TerminalResponse.RequestId != entry.RequestId) ||
			value.Entries.Select(entry => entry.RequestId).Distinct(StringComparer.Ordinal).Count() != value.Entries.Count)
			throw new StateReadException(AtomicJsonReadKind.Corrupt, Path.GetFileName(_intentsPath), "INTENT_IDENTITY_INVALID", result.Bytes, result.Sha256);
		return value.Entries;
	}

	internal async Task BeginOperationIntentAsync(PersistedOperationIntent intent, CancellationToken cancellationToken)
	{
		await _writeLock.WaitAsync(cancellationToken);
		try
		{
			var entries = (await ReadOperationIntentsAsync(cancellationToken)).ToList();
			if (entries.Any(entry => entry.RequestId == intent.RequestId))
				throw new InvalidOperationException("The component operation already has durable intent and cannot be replayed.");
			if (entries.Count >= MaxPendingOperations)
				throw new InvalidOperationException("Unresolved operation intent capacity is reached; reconcile existing operations first.");
			entries.Add(intent);
			await WriteIntentsUnsafeAsync(entries, cancellationToken);
		}
		finally { _writeLock.Release(); }
	}

	internal async Task CompleteOperationIntentAsync(string requestId, string fingerprint, ServiceResponse response, CancellationToken cancellationToken)
	{
		await _writeLock.WaitAsync(cancellationToken);
		try
		{
			var entries = (await ReadOperationIntentsAsync(cancellationToken)).ToList();
			int index = entries.FindIndex(entry => entry.RequestId == requestId);
			if (index < 0 || entries[index].Fingerprint != fingerprint)
				throw new InvalidOperationException("Component operation intent disappeared or its fingerprint changed.");
			entries[index] = entries[index] with { TerminalResponse = BoundResponse(response) };
			await WriteIntentsUnsafeAsync(entries, cancellationToken);
		}
		finally { _writeLock.Release(); }
	}

	internal async Task RetireOperationIntentAsync(string requestId, string fingerprint, CancellationToken cancellationToken)
	{
		await _writeLock.WaitAsync(cancellationToken);
		try
		{
			var entries = (await ReadOperationIntentsAsync(cancellationToken)).ToList();
			var intent = entries.SingleOrDefault(entry => entry.RequestId == requestId);
			if (intent == null) return;
			var durable = await ReadResponseAsync(requestId, cancellationToken);
			if (intent.Fingerprint != fingerprint || durable?.Fingerprint != fingerprint || intent.TerminalResponse == null ||
				!JsonElement.DeepEquals(JsonDefaults.ToElement(intent.TerminalResponse), JsonDefaults.ToElement(durable.Response)))
				throw new InvalidOperationException("A matching durable terminal response is required before retiring component intent.");
			entries.Remove(intent);
			await WriteIntentsUnsafeAsync(entries, cancellationToken);
		}
		finally { _writeLock.Release(); }
	}

	private Task WriteIntentsUnsafeAsync(List<PersistedOperationIntent> entries, CancellationToken cancellationToken)
	{
		var store = new PersistedOperationIntentStore(1, "EgoistShield", entries);
		if (JsonSerializer.SerializeToUtf8Bytes(store, JsonDefaults.StateOptions).Length > MaxResponseStoreBytes)
			throw new IOException("The unresolved operation store reached its byte limit. Existing evidence was preserved.");
		return AtomicJsonFile.WriteAsync(_intentsPath, store, cancellationToken);
	}

	private static ServiceResponse BoundResponse(ServiceResponse response)
	{
		if (JsonSerializer.SerializeToUtf8Bytes(response, JsonDefaults.StateOptions).Length <= MaxRetainedResponseBytes) return response;
		return ServiceResponse.Failure(response.RequestId, response.Sequence, "OPERATION_RESULT_NOT_RETAINED",
			"This operation completed and its oversized response was not retained. Inspect current state; this requestId will not execute again within replay retention.");
	}

	private static bool ValidIdentity(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 128 && !value.Any(char.IsControl);

	public object Describe(ActiveTransaction? transaction)
	{
		if ((object)transaction != null)
		{
			TransactionPhase phase = transaction.Phase;
			return new
			{
				recoveryRequired = (phase != TransactionPhase.Committed && phase != TransactionPhase.RolledBack),
				active = new
				{
					TransactionId = transaction.TransactionId,
					Resource = transaction.Resource,
					Operation = transaction.Operation,
					phase = transaction.Phase.ToString(),
					CreatedAt = transaction.CreatedAt,
					UpdatedAt = transaction.UpdatedAt,
					LastError = transaction.LastError
				}
			};
		}
		return new
		{
			recoveryRequired = false,
			active = (object)null
		};
	}

	private async Task UpdateActiveAsync(ActiveTransaction expected, Func<ActiveTransaction, ActiveTransaction> update, CancellationToken cancellationToken)
	{
		await _writeLock.WaitAsync(cancellationToken);
		try
		{
			ActiveTransaction activeTransaction = (await ReadActiveAsync(cancellationToken)) ?? throw new InvalidOperationException("The active transaction marker disappeared before it could be updated.");
			if (!activeTransaction.TransactionId.Equals(expected.TransactionId, StringComparison.Ordinal))
			{
				throw new InvalidOperationException("The active transaction marker no longer belongs to this mutation.");
			}
			await AtomicJsonFile.WriteAsync(_activePath, update(activeTransaction), cancellationToken);
		}
		finally
		{
			_writeLock.Release();
		}
	}

	private async Task TrimHistoryUnsafeAsync(CancellationToken cancellationToken)
	{
		if (!File.Exists(_historyPath) || new FileInfo(_historyPath).Length <= 5242880)
		{
			return;
		}
		string[] array = await File.ReadAllLinesAsync(_historyPath, cancellationToken);
		List<string> list = new List<string>();
		long num = 0L;
		for (int num2 = array.Length - 1; num2 >= 0; num2--)
		{
			long num3 = Encoding.UTF8.GetByteCount(array[num2]) + 2;
			if (num + num3 > 2621440 && list.Count > 0)
			{
				break;
			}
			list.Add(array[num2]);
			num += num3;
		}
		list.Reverse();
		await File.WriteAllLinesAsync(_historyPath, list, cancellationToken);
	}
}
