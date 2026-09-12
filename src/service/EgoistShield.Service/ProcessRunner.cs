using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class ProcessRunner
{
	private const int MaxOutputCharacters = 4194304;

	private static readonly HashSet<string> OemConsoleExecutables;

	static ProcessRunner()
	{
		OemConsoleExecutables = new HashSet<string>(new global::_003C_003Ez__ReadOnlyArray<string>(new string[7] { "sc.exe", "reg.exe", "netsh.exe", "ipconfig.exe", "nslookup.exe", "taskkill.exe", "icacls.exe" }), StringComparer.OrdinalIgnoreCase);
		Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
	}

	public static async Task<ProcessResult> RunAsync(string executable, IEnumerable<string> arguments, TimeSpan timeout, CancellationToken cancellationToken = default(CancellationToken), string? workingDirectory = null)
	{
		Encoding encoding = ResolveOutputEncoding(executable);
		using Process process = new Process
		{
			StartInfo = new ProcessStartInfo
			{
				FileName = executable,
				UseShellExecute = false,
				CreateNoWindow = true,
				RedirectStandardOutput = true,
				RedirectStandardError = true,
				StandardOutputEncoding = encoding,
				StandardErrorEncoding = encoding,
				WorkingDirectory = (workingDirectory ?? string.Empty)
			}
		};
		foreach (string argument in arguments)
		{
			process.StartInfo.ArgumentList.Add(argument);
		}
		if (!process.Start())
		{
			throw new InvalidOperationException("Failed to start " + Path.GetFileName(executable) + ".");
		}
		using CancellationTokenSource timeoutSource = new CancellationTokenSource(timeout);
		using CancellationTokenSource linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutSource.Token);
		Task<string> stdoutTask = ReadBoundedAsync(process.StandardOutput, linked.Token);
		Task<string> stderrTask = ReadBoundedAsync(process.StandardError, linked.Token);
		Task task = process.WaitForExitAsync(linked.Token);
		try
		{
			InlineArray3<Task> buffer = default(InlineArray3<Task>);
			buffer[0] = task;
			buffer[1] = stdoutTask;
			buffer[2] = stderrTask;
			await Task.WhenAll(buffer).WaitAsync(linked.Token);
		}
		catch (OperationCanceledException)
		{
			TryKill(process);
			TryCloseRedirectedStreams(process);
			Observe(stdoutTask);
			Observe(stderrTask);
			if (timeoutSource.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
			{
				throw new TimeoutException($"{Path.GetFileName(executable)} exceeded {timeout.TotalSeconds:0} seconds.");
			}
			throw;
		}
		string stdout = await stdoutTask;
		string standardError = await stderrTask;
		return new ProcessResult(process.ExitCode, stdout, standardError);
	}

	private static Encoding ResolveOutputEncoding(string executable)
	{
		if (!OperatingSystem.IsWindows() || !OemConsoleExecutables.Contains(Path.GetFileName(executable)))
		{
			return new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
		}
		int oEMCodePage = CultureInfo.CurrentCulture.TextInfo.OEMCodePage;
		try
		{
			return Encoding.GetEncoding(oEMCodePage, EncoderFallback.ReplacementFallback, DecoderFallback.ReplacementFallback);
		}
		catch (ArgumentException)
		{
			return Encoding.Default;
		}
	}

	private static async Task<string> ReadBoundedAsync(StreamReader reader, CancellationToken cancellationToken)
	{
		char[] buffer = new char[8192];
		StringBuilder captured = new StringBuilder(Math.Min(4194304, 65536));
		while (true)
		{
			int num = await reader.ReadAsync(buffer.AsMemory(), cancellationToken);
			if (num == 0)
			{
				break;
			}
			int num2 = 4194304 - captured.Length;
			if (num2 > 0)
			{
				captured.Append(buffer, 0, Math.Min(num, num2));
			}
		}
		return captured.ToString();
	}

	private static void Observe(Task task)
	{
		task.ContinueWith(delegate(Task completed)
		{
			_ = completed.Exception;
		}, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
	}

	private static void TryKill(Process process)
	{
		try
		{
			if (!process.HasExited)
			{
				process.Kill(entireProcessTree: true);
			}
		}
		catch
		{
		}
	}

	private static void TryCloseRedirectedStreams(Process process)
	{
		try
		{
			process.StandardOutput.Close();
		}
		catch
		{
		}
		try
		{
			process.StandardError.Close();
		}
		catch
		{
		}
	}
}
