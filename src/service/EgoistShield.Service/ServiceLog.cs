using System;
using System.CodeDom.Compiler;
using System.IO;
using System.Text.RegularExpressions;
using System.Text.RegularExpressions.Generated;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed class ServiceLog
{
	private readonly string _logPath;

	private readonly SemaphoreSlim _writeLock = new SemaphoreSlim(1, 1);

	public ServiceLog(string stateRoot)
	{
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

	private async Task WriteAsync(string level, string message, CancellationToken cancellationToken)
	{
		string value = Redact(message);
		string line = $"{DateTimeOffset.UtcNow:O}\t{level}\t{value}{Environment.NewLine}";
		await _writeLock.WaitAsync(cancellationToken);
		try
		{
			RotateIfNeeded();
			await File.AppendAllTextAsync(_logPath, line, cancellationToken);
		}
		finally
		{
			_writeLock.Release();
		}
	}

	private void RotateIfNeeded()
	{
		if (File.Exists(_logPath) && new FileInfo(_logPath).Length > 5242880)
		{
			string text = _logPath + ".1";
			if (File.Exists(text))
			{
				File.Delete(text);
			}
			File.Move(_logPath, text);
		}
	}

	private static string Redact(string value)
	{
		string input = SecretAssignmentRegex().Replace(value, "$1=[redacted]");
		input = ProxyCredentialRegex().Replace(input, "$1://[redacted]@");
		if (input.Length > 4096)
		{
			return input.Substring(0, 4096);
		}
		return input;
	}
	[GeneratedCode("System.Text.RegularExpressions.Generator", "10.0.14.27113")]
	private static Regex SecretAssignmentRegex()
	{
		return _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__SecretAssignmentRegex_1.Instance;
	}
	[GeneratedCode("System.Text.RegularExpressions.Generator", "10.0.14.27113")]
	private static Regex ProxyCredentialRegex()
	{
		return _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__ProxyCredentialRegex_2.Instance;
	}
}
