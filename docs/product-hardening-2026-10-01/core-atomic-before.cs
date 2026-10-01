using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class AtomicJsonFile
{
	public static async Task WriteAsync<T>(string targetPath, T value, CancellationToken cancellationToken = default(CancellationToken))
	{
		Directory.CreateDirectory(Path.GetDirectoryName(targetPath));
		string tempPath = $"{targetPath}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
		try
		{
			await using (FileStream stream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 16384, FileOptions.WriteThrough | FileOptions.Asynchronous))
			{
				await JsonSerializer.SerializeAsync((Stream)stream, value, JsonDefaults.StateOptions, cancellationToken);
				await stream.FlushAsync(cancellationToken);
				stream.Flush(flushToDisk: true);
			}
			await MoveWithRetryAsync(tempPath, targetPath, overwrite: true, cancellationToken);
		}
		finally
		{
			TryDeleteTemp(tempPath);
		}
	}

	internal const int MaxReadBytes = 8 * 1024 * 1024;

	public static async Task<T?> ReadAsync<T>(string targetPath, CancellationToken cancellationToken = default)
		=> (await ReadResultAsync<T>(targetPath, cancellationToken)).ValueOrThrow(Path.GetFileName(targetPath));

	internal static async Task<AtomicJsonReadResult<T>> ReadResultAsync<T>(string targetPath,
		CancellationToken cancellationToken = default, int maxBytes = MaxReadBytes)
	{
		if (maxBytes < 1 || maxBytes > MaxReadBytes) throw new ArgumentOutOfRangeException(nameof(maxBytes));
		bool unavailableObserved = false;
		int missingObservations = 0;
		string unavailableCode = "READ_FAILED";
		for (int attempt = 0; attempt < 8; attempt++)
		{
			cancellationToken.ThrowIfCancellationRequested();
			try
			{
				// File.Exists suppresses access/share errors and can return false during NTFS replace.
				// Open the actual file; only repeated not-found errors may establish Missing.
				await using var stream = new FileStream(targetPath, FileMode.Open, FileAccess.Read,
					FileShare.ReadWrite | FileShare.Delete, 16384, FileOptions.Asynchronous | FileOptions.SequentialScan);
				if (stream.Length > maxBytes)
					return new(AtomicJsonReadKind.Corrupt, ErrorCode: "FILE_TOO_LARGE", Bytes: stream.Length);
				using var bytes = new MemoryStream((int)stream.Length);
				byte[] buffer = new byte[16384];
				int read;
				while ((read = await stream.ReadAsync(buffer.AsMemory(), cancellationToken)) != 0)
				{
					if (bytes.Length + read > maxBytes)
						return new(AtomicJsonReadKind.Corrupt, ErrorCode: "FILE_TOO_LARGE", Bytes: bytes.Length + read);
					bytes.Write(buffer, 0, read);
				}
				byte[] data = bytes.ToArray();
				string hash = Convert.ToHexString(SHA256.HashData(data));
				try
				{
					T? value = JsonSerializer.Deserialize<T>(data, JsonDefaults.StateOptions);
					return value is null ? new(AtomicJsonReadKind.Corrupt, ErrorCode: "JSON_NULL", Bytes: data.Length, Sha256: hash)
						: new(AtomicJsonReadKind.Valid, value, Bytes: data.Length, Sha256: hash);
				}
				catch (JsonException)
				{
					return new(AtomicJsonReadKind.Corrupt, ErrorCode: "JSON_INVALID", Bytes: data.Length, Sha256: hash);
				}
			}
			catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
			{
				missingObservations++;
				if (!unavailableObserved && missingObservations >= 3)
					return new(AtomicJsonReadKind.Missing);
			}
			catch (Exception error) when (error is IOException or UnauthorizedAccessException)
			{
				unavailableObserved = true;
				missingObservations = 0;
				unavailableCode = error is UnauthorizedAccessException ? "READ_DENIED" : "READ_FAILED";
			}
			if (attempt < 7)
				await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(250, 10 * (1 << attempt))), cancellationToken);
		}
		return new(AtomicJsonReadKind.Unavailable, ErrorCode: unavailableCode);
	}

	public static async Task<bool> TryCreateAsync<T>(string targetPath, T value, CancellationToken cancellationToken = default(CancellationToken))
	{
		Directory.CreateDirectory(Path.GetDirectoryName(targetPath));
		string tempPath = $"{targetPath}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
		try
		{
			await using (FileStream stream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 16384, FileOptions.WriteThrough | FileOptions.Asynchronous))
			{
				await JsonSerializer.SerializeAsync((Stream)stream, value, JsonDefaults.StateOptions, cancellationToken);
				await stream.FlushAsync(cancellationToken);
				stream.Flush(flushToDisk: true);
			}
			try
			{
				await MoveWithRetryAsync(tempPath, targetPath, overwrite: false, cancellationToken);
				return true;
			}
			catch (IOException) when (File.Exists(tempPath) && File.Exists(targetPath))
			{
				return false;
			}
		}
		finally
		{
			TryDeleteTemp(tempPath);
		}
	}

	private static async Task MoveWithRetryAsync(string sourcePath, string targetPath, bool overwrite, CancellationToken cancellationToken)
	{
		int attempt = 0;
		while (true)
		{
			try
			{
				if (overwrite && File.Exists(targetPath))
				{
					// Move with overwrite can deny access even when readers share delete on Windows.
					File.Replace(sourcePath, targetPath, destinationBackupFileName: null);
				}
				else
				{
					File.Move(sourcePath, targetPath, overwrite: false);
				}
				break;
			}
			catch (Exception ex) when ((ex is IOException || ex is UnauthorizedAccessException) && attempt < 7 && File.Exists(sourcePath) && (overwrite || !File.Exists(targetPath)))
			{
				await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(250, 10 * (1 << attempt))), cancellationToken);
			}
			attempt++;
		}
	}

	private static void TryDeleteTemp(string tempPath)
	{
		try
		{
			if (File.Exists(tempPath))
			{
				File.Delete(tempPath);
			}
		}
		catch
		{
		}
	}
}
