using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed class ServiceLog
{
	private readonly string _logPath;

	private readonly SemaphoreSlim _writeLock = new SemaphoreSlim(1, 1);
	private DateTimeOffset? _lastWriteFailure;
	private readonly string _sessionId = "core-" + Guid.NewGuid().ToString("N");
	private readonly DateTimeOffset _processBirthUtc = GetProcessBirthUtc();
	private readonly string? _imageSha256 = GetOwnImageSha256();
	private readonly string? _actorSid = GetActorSid();
	private long _sequence;
	private static readonly AsyncLocal<object?> DiagnosticScope = new();
	internal const long RotationBytes = 5 * 1024 * 1024;
	internal const int RotationCount = 3;

	public ServiceLog(string stateRoot)
	{
		ProtectedProductRoot.AssertFileWriteAllowed(Path.Combine(stateRoot, "service.log"));
		Directory.CreateDirectory(stateRoot);
		_logPath = Path.Combine(stateRoot, "service.log");
	}

	public Task InfoAsync(string message, CancellationToken cancellationToken = default(CancellationToken))
	{
		return WriteAsync("INFO", message, cancellationToken);
	}

	public Task WarnAsync(string message, CancellationToken cancellationToken = default(CancellationToken))
	{
		return WriteAsync("WARN", message, cancellationToken);
	}

	public Task ErrorAsync(string message, CancellationToken cancellationToken = default(CancellationToken))
	{
		return WriteAsync("ERROR", message, cancellationToken);
	}

	// Scope must be entered in the caller, after authentication, never from raw payload.
	public IDisposable BeginScope(object fields)
	{
		object? previous = DiagnosticScope.Value;
		DiagnosticScope.Value = ServiceDiagnosticRedaction.Value(fields);
		return new ScopeExit(previous);
	}

	public Task EventAsync(string level, string stage, object? fields = null, Exception? error = null, CancellationToken cancellationToken = default)
	{
		string safeStage = ServiceDiagnosticRedaction.Text(stage, 128);
		string payload;
		try
		{
			payload = JsonSerializer.Serialize(new { schemaVersion = 1, stage = safeStage, fields = ServiceDiagnosticRedaction.Value(fields), error = ServiceDiagnosticRedaction.Value(error) });
			if (payload.Length > 7000) payload = JsonSerializer.Serialize(new { schemaVersion = 1, stage = safeStage, truncated = true, preview = ServiceDiagnosticRedaction.Text(payload, 2048) });
		}
		catch { payload = JsonSerializer.Serialize(new { schemaVersion = 1, stage = safeStage, diagnosticError = "UNSERIALIZABLE_EVENT" }); }
		return WriteAsync(level is "ERROR" or "WARN" or "DEBUG" ? level : "INFO", "[diagnostic-event] " + payload, cancellationToken);
	}

	private sealed class ScopeExit(object? previous) : IDisposable
	{
		private bool _disposed;
		public void Dispose() { if (_disposed) return; _disposed = true; DiagnosticScope.Value = previous; }
	}

	private static DateTimeOffset GetProcessBirthUtc()
	{
		try { using var process = Process.GetCurrentProcess(); return process.StartTime.ToUniversalTime(); }
		catch { return DateTimeOffset.UtcNow; }
	}
	private static string? GetOwnImageSha256()
	{
		try { using var stream = File.OpenRead(Environment.ProcessPath!); return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant(); }
		catch { return null; }
	}
	private static string? GetActorSid()
	{
		try { if (!OperatingSystem.IsWindows()) return null; using var identity = WindowsIdentity.GetCurrent(); return identity.User?.Value; }
		catch { return null; }
	}

	private async Task WriteAsync(string level, string message, CancellationToken cancellationToken)
	{
		string value = ServiceDiagnosticRedaction.Text(message).Replace("\r", "\\r").Replace("\n", "\\n");
		string context = JsonSerializer.Serialize(new { schemaVersion = 1, source = "core", sessionId = _sessionId,
			pid = Environment.ProcessId, processBirthUtc = _processBirthUtc, imageSha256 = _imageSha256, actorSid = _actorSid,
			sequence = Interlocked.Increment(ref _sequence), localTimestamp = DateTimeOffset.Now, scope = DiagnosticScope.Value });
		string line = $"{DateTimeOffset.UtcNow:O}\t{level}\t{value}\t[context] {context}{Environment.NewLine}";
		await _writeLock.WaitAsync(cancellationToken);
		try
		{
			ProtectedProductRoot.AssertFileWriteAllowed(_logPath);
			RotateIfNeeded();
			await using FileStream stream = ProtectedProductRoot.CreateStateFileStream(_logPath, FileMode.Append, 4096, FileOptions.Asynchronous, FileShare.Read);
			await stream.WriteAsync(System.Text.Encoding.UTF8.GetBytes(line), cancellationToken);
			await stream.FlushAsync(cancellationToken);
		}
		catch (Exception error) when (error is IOException or UnauthorizedAccessException)
		{
			// Diagnostics cannot turn a completed network mutation into a failure
			// or stop Core when antivirus/file viewers temporarily lock the log.
			if (_lastWriteFailure == null || DateTimeOffset.UtcNow - _lastWriteFailure >= TimeSpan.FromMinutes(1))
			{
				Trace.TraceError("Core service log is temporarily unavailable: " + ServiceDiagnosticRedaction.Text(error.Message));
				_lastWriteFailure = DateTimeOffset.UtcNow;
			}
		}
		finally
		{
			_writeLock.Release();
		}
	}

	private void RotateIfNeeded()
	{
		if (File.Exists(_logPath) && new FileInfo(_logPath).Length >= RotationBytes)
		{
			for (int index = RotationCount; index >= 1; index--)
			{
				string target = _logPath + "." + index;
				string source = index == 1 ? _logPath : _logPath + "." + (index - 1);
				ProtectedProductRoot.AssertFileWriteAllowed(target);
				ProtectedProductRoot.AssertFileWriteAllowed(source);
				if (index == RotationCount && File.Exists(target)) File.Delete(target);
				if (File.Exists(source)) File.Move(source, target, overwrite: true);
			}
		}
	}

}
