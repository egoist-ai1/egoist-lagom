using System;
using System.IO;
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

	public static async Task<T?> ReadAsync<T>(string targetPath, CancellationToken cancellationToken = default(CancellationToken))
	{
		int attempt = 0;
		while (true)
		{
			if (!File.Exists(targetPath))
			{
				return default(T);
			}
			try
			{
				await using FileStream stream = new FileStream(targetPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 16384, FileOptions.Asynchronous | FileOptions.SequentialScan);
				return await JsonSerializer.DeserializeAsync<T>((Stream)stream, JsonDefaults.StateOptions, cancellationToken);
			}
			catch (Exception ex) when (((ex is IOException || ex is UnauthorizedAccessException) ? true : false) && attempt < 7)
			{
				await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(250, 10 * (1 << attempt))), cancellationToken);
			}
			attempt++;
		}
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
