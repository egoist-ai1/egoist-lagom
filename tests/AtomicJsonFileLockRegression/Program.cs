using System.Diagnostics;
using System.IO;
using System.Threading;
using EgoistShield.Service;

internal static class Program
{
	private sealed record Payload(string Value);

	private static async Task<int> Main()
	{
		string root = Path.Combine(Path.GetTempPath(), "EgoistShield.AtomicJsonFileLockRegression", Guid.NewGuid().ToString("N"));
		Directory.CreateDirectory(root);
		string targetPath = Path.Combine(root, "state.json");
		try
		{
			await VerifyInitialCreationAndTryCreateAsync(targetPath);
			await VerifyReplacementWithDeleteSharingReaderAsync(targetPath);
			await VerifyTransientWriteLockIsRetriedAsync(targetPath);
			await VerifyPersistentWriteLockFailsWithinBoundAsync(targetPath);
			await VerifyCancellationInterruptsWriteRetryAsync(targetPath);
			await AtomicJsonFile.WriteAsync(targetPath, new Payload("durable"));
			await VerifyTransientExclusiveLockIsRetriedAsync(targetPath);
			await VerifyPersistentExclusiveLockFailsWithinBoundAsync(targetPath);
			await VerifyCancellationInterruptsRetryAsync(targetPath);
			Console.WriteLine("AtomicJsonFile lock regression passed.");
			return 0;
		}
		finally
		{
			Directory.Delete(root, recursive: true);
		}
	}

	private static async Task VerifyInitialCreationAndTryCreateAsync(string targetPath)
	{
		await AtomicJsonFile.WriteAsync(targetPath, new Payload("initial"));
		Assert((await AtomicJsonFile.ReadAsync<Payload>(targetPath))?.Value == "initial", "write creates a missing destination");
		Assert(!await AtomicJsonFile.TryCreateAsync(targetPath, new Payload("must not replace")), "TryCreate leaves an existing destination intact");
		Assert((await AtomicJsonFile.ReadAsync<Payload>(targetPath))?.Value == "initial", "TryCreate preserves existing content");
		string createPath = targetPath + ".create.json";
		Assert(await AtomicJsonFile.TryCreateAsync(createPath, new Payload("created")), "TryCreate creates a missing destination");
		Assert((await AtomicJsonFile.ReadAsync<Payload>(createPath))?.Value == "created", "TryCreate publishes complete JSON");
	}

	private static async Task VerifyReplacementWithDeleteSharingReaderAsync(string targetPath)
	{
		await AtomicJsonFile.WriteAsync(targetPath, new Payload("old"));
		await using FileStream reader = new(targetPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
		string replacement = new('x', 20000);
		await AtomicJsonFile.WriteAsync(targetPath, new Payload(replacement));
		Assert((await AtomicJsonFile.ReadAsync<Payload>(targetPath))?.Value == replacement, "replacement exposes complete new JSON while a delete-sharing reader remains open");
		Payload? original = await System.Text.Json.JsonSerializer.DeserializeAsync<Payload>(reader, JsonDefaults.StateOptions);
		Assert(original?.Value == "old", "the open reader retains the complete original JSON after replacement");
	}

	private static async Task VerifyTransientWriteLockIsRetriedAsync(string targetPath)
	{
		Task writeTask;
		await using (new FileStream(targetPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
		{
			writeTask = AtomicJsonFile.WriteAsync(targetPath, new Payload("after transient lock"));
			await Task.Delay(220);
			Assert(!writeTask.IsCompleted, "a reader without delete sharing prevents replacement until released");
		}
		await writeTask;
		Assert((await AtomicJsonFile.ReadAsync<Payload>(targetPath))?.Value == "after transient lock", "replacement retries after a short non-delete-sharing lock");
	}

	private static async Task VerifyPersistentWriteLockFailsWithinBoundAsync(string targetPath)
	{
		await AtomicJsonFile.WriteAsync(targetPath, new Payload("preserved"));
		await using (new FileStream(targetPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
		{
			Stopwatch stopwatch = Stopwatch.StartNew();
			try
			{
				await AtomicJsonFile.WriteAsync(targetPath, new Payload("must not replace"));
				throw new InvalidOperationException("Persistent write lock unexpectedly succeeded.");
			}
			catch (Exception error) when (error is IOException or UnauthorizedAccessException)
			{
				Assert(stopwatch.Elapsed >= TimeSpan.FromMilliseconds(700) && stopwatch.Elapsed < TimeSpan.FromSeconds(5), "a persistent write lock fails within the bounded retry window");
			}
		}
		Assert((await AtomicJsonFile.ReadAsync<Payload>(targetPath))?.Value == "preserved", "failed replacement preserves the durable destination");
		Assert(!Directory.EnumerateFiles(Path.GetDirectoryName(targetPath)!, "*.tmp").Any(), "failed replacement cleans up its temporary file");
	}

	private static async Task VerifyCancellationInterruptsWriteRetryAsync(string targetPath)
	{
		await using (new FileStream(targetPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
		{
			using CancellationTokenSource cancellation = new();
			Task writeTask = AtomicJsonFile.WriteAsync(targetPath, new Payload("must not replace"), cancellation.Token);
			cancellation.CancelAfter(30);
			await AssertCanceledAsync(writeTask, "cancellation interrupts a retrying replacement");
		}
		Assert((await AtomicJsonFile.ReadAsync<Payload>(targetPath))?.Value == "preserved", "cancelled replacement preserves the durable destination");
		Assert(!Directory.EnumerateFiles(Path.GetDirectoryName(targetPath)!, "*.tmp").Any(), "cancelled replacement cleans up its temporary file");
	}

	private static async Task VerifyTransientExclusiveLockIsRetriedAsync(string targetPath)
	{
		Task<Payload?> readTask;
		await using (new FileStream(targetPath, FileMode.Open, FileAccess.Read, FileShare.None))
		{
			readTask = AtomicJsonFile.ReadAsync<Payload>(targetPath);
			await Task.Delay(220);
		}

		Payload? result = await readTask;
		Assert(result?.Value == "durable", "a short FileShare.None lock is retried and the durable JSON remains readable");
	}

	private static async Task VerifyPersistentExclusiveLockFailsWithinBoundAsync(string targetPath)
	{
		await using FileStream lockStream = new FileStream(targetPath, FileMode.Open, FileAccess.Read, FileShare.None);
		Stopwatch stopwatch = Stopwatch.StartNew();
		try
		{
			await AtomicJsonFile.ReadAsync<Payload>(targetPath);
			throw new InvalidOperationException("Persistent exclusive lock unexpectedly succeeded.");
		}
		catch (IOException)
		{
			Assert(stopwatch.Elapsed >= TimeSpan.FromMilliseconds(700) && stopwatch.Elapsed < TimeSpan.FromSeconds(2), "a persistent lock fails after the bounded retry window");
		}
		catch (UnauthorizedAccessException)
		{
			Assert(stopwatch.Elapsed >= TimeSpan.FromMilliseconds(700) && stopwatch.Elapsed < TimeSpan.FromSeconds(2), "a persistent access denial fails after the bounded retry window");
		}
	}

	private static async Task VerifyCancellationInterruptsRetryAsync(string targetPath)
	{
		await using FileStream lockStream = new FileStream(targetPath, FileMode.Open, FileAccess.Read, FileShare.None);
		using CancellationTokenSource cancellation = new CancellationTokenSource();
		Task<Payload?> readTask = AtomicJsonFile.ReadAsync<Payload>(targetPath, cancellation.Token);
		cancellation.CancelAfter(30);
		await AssertCanceledAsync(readTask, "cancellation interrupts a retrying read");
	}

	private static async Task AssertCanceledAsync(Task task, string name)
	{
		try
		{
			await task;
		}
		catch (OperationCanceledException)
		{
			return;
		}
		throw new InvalidOperationException("Regression assertion failed: " + name + ".");
	}

	private static void Assert(bool condition, string name)
	{
		if (!condition)
		{
			throw new InvalidOperationException("Regression assertion failed: " + name + ".");
		}
	}
}
