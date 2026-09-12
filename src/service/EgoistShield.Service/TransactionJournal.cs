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

	private readonly SemaphoreSlim _writeLock = new SemaphoreSlim(1, 1);

	private const long MaxHistoryBytes = 5242880L;

	private const int MaxPersistedResponses = 512;

	public TransactionJournal(string stateRoot)
	{
		_activePath = Path.Combine(stateRoot, "active-transaction.json");
		_historyPath = Path.Combine(stateRoot, "transactions.jsonl");
		_responsesPath = Path.Combine(stateRoot, "idempotency-responses.json");
	}

	public Task<ActiveTransaction?> ReadActiveAsync(CancellationToken cancellationToken = default(CancellationToken))
	{
		return AtomicJsonFile.ReadAsync<ActiveTransaction>(_activePath, cancellationToken);
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
			ActiveTransaction activeTransaction = await AtomicJsonFile.ReadAsync<ActiveTransaction>(_activePath, cancellationToken);
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
		return (await AtomicJsonFile.ReadAsync<PersistedResponseStore>(_responsesPath, cancellationToken))?.Entries.LastOrDefault((PersistedResponseEntry entry) => entry.RequestId.Equals(requestId, StringComparison.Ordinal));
	}

	public async Task RecordResponseAsync(string requestId, string fingerprint, ServiceResponse response, CancellationToken cancellationToken = default(CancellationToken))
	{
		await _writeLock.WaitAsync(cancellationToken);
		try
		{
			PersistedResponseStore persistedResponseStore = (await AtomicJsonFile.ReadAsync<PersistedResponseStore>(_responsesPath, cancellationToken)) ?? new PersistedResponseStore(1, "EgoistShield", new List<PersistedResponseEntry>());
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
			list.Add(new PersistedResponseEntry(requestId, fingerprint, response, DateTimeOffset.UtcNow));
			if (list.Count > 512)
			{
				list.RemoveRange(0, list.Count - 512);
			}
			await AtomicJsonFile.WriteAsync(_responsesPath, new PersistedResponseStore(1, "EgoistShield", list), cancellationToken);
		}
		finally
		{
			_writeLock.Release();
		}
	}

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
			ActiveTransaction activeTransaction = (await AtomicJsonFile.ReadAsync<ActiveTransaction>(_activePath, cancellationToken)) ?? throw new InvalidOperationException("The active transaction marker disappeared before it could be updated.");
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
