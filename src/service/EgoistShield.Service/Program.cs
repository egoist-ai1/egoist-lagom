using System;
using System.IO;
using System.ServiceProcess;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class Program
{
	private sealed record ParsedArguments(bool ConsoleMode, bool AllowDevClient, bool SelfTest, bool RecoverActive, bool RemoveNativeDoh, bool RestoreOwnedDns, bool NotifySystemProxy, bool CheckAdmin, bool VerifyPipeServer, string? PipeName, string? ServiceName, string? StateRoot, string? InstallRoot, string? ConfigureInstallRoot)
	{
		public static ParsedArguments Parse(string[] args)
		{
			bool flag = false;
			bool flag2 = false;
			bool selfTest = false;
			bool recoverActive = false;
			bool removeNativeDoh = false;
			bool restoreOwnedDns = false;
			bool notifySystemProxy = false;
			bool checkAdmin = false;
			bool verifyPipeServer = false;
			string pipeName = null;
			string serviceName = null;
			string stateRoot = null;
			string installRoot = null;
			string configureInstallRoot = null;
			for (int i = 0; i < args.Length; i++)
			{
				switch (args[i])
				{
				case "--console":
					flag = true;
					break;
				case "--allow-dev-client":
					flag2 = true;
					break;
				case "--self-test":
					selfTest = true;
					break;
				case "--recover-active":
					recoverActive = true;
					break;
				case "--restore-owned-dns":
					restoreOwnedDns = true;
					break;
				case "--remove-native-doh":
					removeNativeDoh = true;
					break;
				case "--notify-system-proxy":
					notifySystemProxy = true;
					break;
				case "--check-admin":
					checkAdmin = true;
					break;
				case "--verify-pipe-server":
					verifyPipeServer = true;
					break;
				case "--pipe-name":
					pipeName = ReadValue(args, ref i, "--pipe-name");
					break;
				case "--service-name":
					serviceName = ReadValue(args, ref i, "--service-name");
					break;
				case "--state-root":
					stateRoot = Path.GetFullPath(ReadValue(args, ref i, "--state-root"));
					break;
				case "--install-root":
					installRoot = Path.GetFullPath(ReadValue(args, ref i, "--install-root"));
					break;
				case "configure":
					if (i + 2 >= args.Length || args[i + 1] != "--install-root")
					{
						throw new ArgumentException("Usage: EgoistShield.Service configure --install-root <path> [--state-root <path>]");
					}
					i++;
					configureInstallRoot = Path.GetFullPath(ReadValue(args, ref i, "--install-root"));
					break;
				default:
					throw new ArgumentException("Unknown argument: " + args[i]);
				}
			}
			if (flag2 && !flag)
			{
				throw new ArgumentException("--allow-dev-client is valid only with --console.");
			}
			return new ParsedArguments(flag, flag2, selfTest, recoverActive, removeNativeDoh, restoreOwnedDns, notifySystemProxy, checkAdmin, verifyPipeServer, pipeName, serviceName, stateRoot, installRoot, configureInstallRoot);
		}

		private static string ReadValue(string[] args, ref int index, string name)
		{
			if (++index >= args.Length || string.IsNullOrWhiteSpace(args[index]))
			{
				throw new ArgumentException(name + " requires a value.");
			}
			return args[index];
		}
	}

	public static readonly DateTimeOffset StartedAt = DateTimeOffset.UtcNow;

	public static Task<int> Main(string[] args)
	{
		try
		{
			ParsedArguments parsed = ParsedArguments.Parse(args);
			if (parsed.VerifyPipeServer && !parsed.CheckAdmin && !parsed.SelfTest)
			{
				return VerifyPipeServerAsync(parsed);
			}
			return RunServiceModesAsync(parsed);
		}
		catch (Exception value)
		{
			Console.Error.WriteLine(value);
			return Task.FromResult(1);
		}
	}

	private static async Task<int> VerifyPipeServerAsync(ParsedArguments parsed)
	{
		try
		{
			PipeServerIdentityResult result = await PipeServerIdentityVerifier.VerifyAsync(parsed.PipeName ?? "EgoistShield.Service.v1", parsed.ServiceName ?? "EgoistShieldCore", CancellationToken.None);
			Console.WriteLine(JsonSerializer.Serialize(result, IdentityJsonContext.Default.PipeServerIdentityResult));
			return result.Ok ? 0 : 2;
		}
		catch (Exception value)
		{
			Console.Error.WriteLine(value);
			return 1;
		}
	}

	private static async Task<int> RunServiceModesAsync(ParsedArguments parsed)
	{
		_ = 7;
		try
		{
			if (parsed.CheckAdmin)
			{
				AdminStatusResult result = AdminStatusChecker.Check();
				Console.WriteLine(JsonSerializer.Serialize(result, JsonDefaults.Options));
				return result.Ok ? 0 : 2;
			}
			if (parsed.SelfTest)
			{
				await SelfTest.RunAsync();
				return 0;
			}
			if (parsed.NotifySystemProxy)
			{
				SystemProxyNotificationResult result = SystemProxyNotifier.Notify();
				Console.WriteLine(JsonSerializer.Serialize(result, JsonDefaults.Options));
				return result.Ok ? 0 : 2;
			}
			string stateRoot = parsed.StateRoot ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "EgoistShield", "Service");
			if (parsed.RemoveNativeDoh)
			{
				WindowsDnsController dns = new WindowsDnsController();
				await new WindowsNativeDohController(stateRoot).RemoveForUninstallAsync(dns);
				Console.WriteLine("Egoist Shield native DoH ownership was removed safely.");
				return 0;
			}
			if (parsed.ConfigureInstallRoot != null)
			{
				await ServiceConfiguration.WriteAsync(stateRoot, parsed.ConfigureInstallRoot);
				Console.WriteLine("Configured install root: " + Path.GetFullPath(parsed.ConfigureInstallRoot));
				return 0;
			}
			ServiceOptions options = new ServiceOptions(parsed.PipeName ?? "EgoistShield.Service.v1", stateRoot, parsed.ConsoleMode, parsed.AllowDevClient, parsed.InstallRoot);
			if (parsed.RestoreOwnedDns)
			{
				await (await ServiceEngine.CreateAsync(options)).RestoreOwnedDnsForUninstallAsync();
				Console.WriteLine("Owned adapter DNS was restored safely.");
				return 0;
			}
			if (parsed.RecoverActive)
			{
				await (await ServiceEngine.CreateAsync(options)).RecoverOnlyAsync();
				Console.WriteLine("EgoistShieldCore offline recovery completed.");
				return 0;
			}
			if (parsed.ConsoleMode)
			{
				CancellationTokenSource stop = new CancellationTokenSource();
				try
				{
					ConsoleCancelEventHandler handler = delegate(object? _, ConsoleCancelEventArgs eventArgs)
					{
						eventArgs.Cancel = true;
						stop.Cancel();
					};
					Console.CancelKeyPress += handler;
					try
					{
						ServiceEngine obj2 = await ServiceEngine.CreateAsync(options, stop.Token);
						Console.WriteLine($"{"EgoistShieldCore"} {BuildInfo.Version} listening on {options.PipeName}.");
						await obj2.RunAsync(stop.Token);
					}
					catch (OperationCanceledException) when (stop.IsCancellationRequested)
					{
					}
					finally
					{
						Console.CancelKeyPress -= handler;
					}
					return 0;
				}
				finally
				{
					if (stop != null)
					{
						((IDisposable)stop).Dispose();
					}
				}
			}
			if (!OperatingSystem.IsWindows())
			{
				throw new PlatformNotSupportedException("EgoistShield.Service requires Windows.");
			}
			ServiceBase.Run(new EgoistShieldWindowsService(options));
			return 0;
		}
		catch (Exception value)
		{
			Console.Error.WriteLine(value);
			return 1;
		}
	}
}
