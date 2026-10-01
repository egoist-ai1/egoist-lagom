using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using System.ServiceProcess;
using System.Text.RegularExpressions;
using System.Text.RegularExpressions.Generated;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace EgoistShield.Service;

internal sealed class OwnedServiceController
{
	private sealed record OwnedServiceDefinition(string[] ExecutableNames, string RelativeExecutablePath, string[] InstallArguments, string[] RemoveArguments, string Description, bool SupportsInstall = true);

	private static readonly IReadOnlyDictionary<string, OwnedServiceDefinition> OwnedServices = new Dictionary<string, OwnedServiceDefinition>(StringComparer.OrdinalIgnoreCase)
	{
		["EgoistShieldSystemDoH"] = new OwnedServiceDefinition(new string[1] { "egoistshield-system-doh-service.exe" }, Path.Combine("Runtime", "SystemDoH", "service-wrapper", "egoistshield-system-doh-service.exe"), new string[1] { "install" }, new string[1] { "uninstall" }, "Локальный системный DNS-over-HTTPS Egoist Lagom"),
		["EgoistShieldGravitylessDNS"] = new OwnedServiceDefinition(new string[1] { "dnscrypt-proxy.exe" }, Path.Combine("GravitylessDNS", "dnscrypt-proxy.exe"), new string[7]
		{
			"-config",
			Path.Combine("GravitylessDNS", "dnscrypt-proxy.toml"),
			"-logfile",
			Path.Combine("GravitylessDNS", "dnscrypt-proxy.log"),
			"-logfile-truncate",
			"-service",
			"install"
		}, new string[2] { "-service", "uninstall" }, "Локальный Gravityless DNS resolver Egoist Lagom", SupportsInstall: false),
		["dnscrypt-proxy"] = new OwnedServiceDefinition(new string[1] { "dnscrypt-proxy.exe" }, Path.Combine("GravitylessDNS", "dnscrypt-proxy.exe"), new string[7]
		{
			"-config",
			Path.Combine("GravitylessDNS", "dnscrypt-proxy.toml"),
			"-logfile",
			Path.Combine("GravitylessDNS", "dnscrypt-proxy.log"),
			"-logfile-truncate",
			"-service",
			"install"
		}, new string[2] { "-service", "uninstall" }, "Локальный Gravityless DNS resolver Egoist Lagom"),
		["EgoistShieldZapret"] = new OwnedServiceDefinition(new string[1] { "egoistshield-zapret-service.exe" }, Path.Combine("Runtime", "Zapret", "service-wrapper", "egoistshield-zapret-service.exe"), new string[1] { "install" }, new string[1] { "uninstall" }, "Профильная служба Discord и YouTube, управляемая Egoist Lagom"),
		["EgoistShieldTelegramProxy"] = new OwnedServiceDefinition(new string[1] { "egoistshield-telegram-proxy-service.exe" }, Path.Combine("Runtime", "TelegramProxy", "service-wrapper", "egoistshield-telegram-proxy-service.exe"), new string[1] { "install" }, new string[1] { "uninstall" }, "Локальный Telegram Proxy, управляемый Egoist Lagom"),
		[ServiceContract.VpnServiceName] = new OwnedServiceDefinition(new string[] { "egoistshield-vpn-service.exe" }, Path.Combine("Runtime", "Vpn", "service-wrapper", "egoistshield-vpn-service.exe"), new string[] { "install" }, new string[] { "uninstall" }, "Фоновое TUN-подключение Egoist Lagom")
	};

	private readonly string _installRoot;

	private readonly string _productDataRoot;

	private readonly string _scPath;

	private readonly bool _productDataRootVerified;

	public OwnedServiceController(string installRoot, string productDataRoot, bool productDataRootVerified = true)
	{
		_installRoot = Path.GetFullPath(installRoot);
		_productDataRoot = Path.GetFullPath(productDataRoot);
		_productDataRootVerified = productDataRootVerified;
		_scPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "sc.exe");
	}

	public async Task<OwnedServiceStatus> StatusAsync(string serviceName, CancellationToken cancellationToken = default(CancellationToken))
	{
		serviceName = NormalizeServiceName(serviceName);
		return await Task.Run(delegate
		{
			cancellationToken.ThrowIfCancellationRequested();
			using ServiceController serviceController = new ServiceController(serviceName);
			try
			{
				serviceController.Refresh();
				return new OwnedServiceStatus(serviceName, NormalizeServiceState(serviceController.Status), NormalizeStartType(serviceController.StartType), Installed: true);
			}
			catch (InvalidOperationException ex) when (ex.InnerException is Win32Exception ex2 && ex2.NativeErrorCode == 1060)
			{
				return new OwnedServiceStatus(serviceName, "not-installed", "not-installed", Installed: false);
			}
		}, cancellationToken);
	}

	public async Task<OwnedServiceStatus> StartAsync(string serviceName, CancellationToken cancellationToken = default(CancellationToken))
	{
		serviceName = NormalizeServiceName(serviceName);
		EnsureProductDataRootVerified();
		await AssertOwnedImagePathAsync(serviceName, cancellationToken);
		return await OwnedServiceTransition.ChangeAsync(serviceName, true,
			token => StatusAsync(serviceName, token),
			(control, token) => RunScAsync(new[] { control, serviceName }, token),
			ServiceContract.ServiceTransitionTimeout, cancellationToken);
	}

	public async Task<OwnedServiceStatus> InstallAsync(string serviceName, CancellationToken cancellationToken = default(CancellationToken))
	{
		serviceName = NormalizeServiceName(serviceName);
		EnsureProductDataRootVerified();
		OwnedServiceDefinition definition = OwnedServices[serviceName];
		if (!definition.SupportsInstall)
		{
			throw new ArgumentException("Service " + serviceName + " cannot be installed under this name; it is kept for status and removal only.");
		}
		string executablePath = ResolveCanonicalExecutable(definition);
		if (serviceName == ServiceContract.VpnServiceName) VerifyVpnWrapper(executablePath);
		if (!File.Exists(executablePath))
		{
			throw new FileNotFoundException("Owned service executable is missing for " + serviceName + ".", executablePath);
		}
		OwnedServiceStatus before = await StatusAsync(serviceName, cancellationToken);
		if (before.Installed)
		{
			await AssertOwnedImagePathAsync(serviceName, cancellationToken);
			// Repair recovery and dependencies on repeated installation as well:
			// a previous partial install can already have Start=Automatic.
			await ConfigureInstallationAsync(serviceName, definition.Description, cancellationToken);
			return await StatusAsync(serviceName, cancellationToken);
		}
		ProcessResult processResult = await RunOwnedExecutableAsync(executablePath, ResolveOwnedArguments(definition.InstallArguments), cancellationToken);
		if (processResult.ExitCode != 0)
		{
			throw new InvalidOperationException("Service install failed for " + serviceName + ": " + CleanError(processResult));
		}
		await AssertOwnedImagePathAsync(serviceName, cancellationToken);
		await ConfigureInstallationAsync(serviceName, definition.Description, cancellationToken);
		OwnedServiceStatus obj = await StatusAsync(serviceName, cancellationToken);
		if (!obj.Installed)
		{
			throw new InvalidOperationException("Service " + serviceName + " was not registered after installation.");
		}
		return obj;
	}

	public async Task<OwnedServiceStatus> RemoveAsync(string serviceName, CancellationToken cancellationToken = default(CancellationToken))
	{
		serviceName = NormalizeServiceName(serviceName);
		OwnedServiceStatus before = await StatusAsync(serviceName, cancellationToken);
		if (!before.Installed)
		{
			return before;
		}
		await AssertOwnedImagePathAsync(serviceName, cancellationToken);
		if (before.State != "stopped")
		{
			await StopAsync(serviceName, cancellationToken);
		}
		OwnedServiceDefinition ownedServiceDefinition = OwnedServices[serviceName];
		string text = ResolveCanonicalExecutable(ownedServiceDefinition);
		if (!File.Exists(text))
		{
			await DeleteServiceRegistrationAsync(serviceName, cancellationToken);
		}
		else if ((await RunOwnedExecutableAsync(text, ResolveOwnedArguments(ownedServiceDefinition.RemoveArguments), cancellationToken)).ExitCode != 0)
		{
			await DeleteServiceRegistrationAsync(serviceName, cancellationToken);
		}
		return await WaitForStateAsync(serviceName, "not-installed", cancellationToken);
	}

	public async Task<OwnedServiceStatus> StopAsync(string serviceName, CancellationToken cancellationToken = default(CancellationToken))
	{
		serviceName = NormalizeServiceName(serviceName);
		OwnedServiceStatus before = await StatusAsync(serviceName, cancellationToken);
		if (!before.Installed)
		{
			return before;
		}
		await AssertOwnedImagePathAsync(serviceName, cancellationToken);
		return await OwnedServiceTransition.ChangeAsync(serviceName, false,
			token => StatusAsync(serviceName, token),
			(control, token) => RunScAsync(new[] { control, serviceName }, token),
			ServiceContract.ServiceTransitionTimeout, cancellationToken);
	}

	public static string NormalizeServiceName(string serviceName)
	{
		string value = serviceName.Trim();
		EnsureKnownService(value);
		return OwnedServices.Keys.First((string key) => key.Equals(value, StringComparison.OrdinalIgnoreCase));
	}

	public async Task<string?> ReadZapretProfileAsync(CancellationToken cancellationToken = default(CancellationToken))
	{
		if (!(await StatusAsync("EgoistShieldZapret", cancellationToken)).Installed)
		{
			return null;
		}
		await AssertOwnedImagePathAsync("EgoistShieldZapret", cancellationToken);
		ProcessResult processResult = await RunRegAsync(new global::_003C_003Ez__ReadOnlyArray<string>(new string[4] { "query", "HKLM\\SYSTEM\\CurrentControlSet\\Services\\EgoistShieldZapret", "/v", "EgoistShieldProfile" }), cancellationToken);
		if (processResult.ExitCode != 0)
		{
			return null;
		}
		Match match = ProfileRegex().Match(processResult.StandardOutput);
		return match.Success ? match.Groups[1].Value.Trim() : null;
	}

	public async Task<string> SetZapretProfileAsync(string? profile, CancellationToken cancellationToken = default(CancellationToken))
	{
		string normalized = NormalizeZapretProfileName(profile);
		if (!(await StatusAsync("EgoistShieldZapret", cancellationToken)).Installed)
		{
			throw new ServiceOperationException("SERVICE_NOT_INSTALLED", "Owned service EgoistShieldZapret is not installed; the Zapret profile cannot be stored.");
		}
		await AssertOwnedImagePathAsync("EgoistShieldZapret", cancellationToken);
		ProcessResult processResult = await RunRegAsync(new global::_003C_003Ez__ReadOnlyArray<string>(new string[9] { "add", "HKLM\\SYSTEM\\CurrentControlSet\\Services\\EgoistShieldZapret", "/v", "EgoistShieldProfile", "/t", "REG_SZ", "/d", normalized, "/f" }), cancellationToken);
		if (processResult.ExitCode != 0)
		{
			throw new InvalidOperationException("Failed to store Zapret profile: " + CleanError(processResult));
		}
		return normalized;
	}

	internal static string NormalizeZapretProfileName(string? profile)
	{
		string text = (profile ?? string.Empty).Trim();
		int length = text.Length;
		bool flag = ((length < 1 || length > 128) ? true : false);
		if (flag || text.Any(delegate(char character)
		{
			bool flag2 = char.IsAsciiLetterOrDigit(character);
			if (!flag2)
			{
				bool flag3;
				switch (character)
				{
				case ' ':
				case '(':
				case ')':
				case '-':
				case '.':
				case '_':
					flag3 = true;
					break;
				default:
					flag3 = false;
					break;
				}
				flag2 = flag3;
			}
			return !flag2;
		}))
		{
			throw new ArgumentException("Zapret profile name contains unsupported characters.");
		}
		return text;
	}

	public async Task ClearZapretProfileAsync(CancellationToken cancellationToken = default(CancellationToken))
	{
		if ((await StatusAsync("EgoistShieldZapret", cancellationToken)).Installed)
		{
			await AssertOwnedImagePathAsync("EgoistShieldZapret", cancellationToken);
			ProcessResult processResult = await RunRegAsync(new global::_003C_003Ez__ReadOnlyArray<string>(new string[5] { "delete", "HKLM\\SYSTEM\\CurrentControlSet\\Services\\EgoistShieldZapret", "/v", "EgoistShieldProfile", "/f" }), cancellationToken);
			int exitCode = processResult.ExitCode;
			if (exitCode != 0 && exitCode != 1)
			{
				throw new InvalidOperationException("Failed to clear Zapret profile: " + CleanError(processResult));
			}
		}
	}

	public async Task RestoreStartTypeAsync(string serviceName, string? desiredStartType, CancellationToken cancellationToken = default(CancellationToken))
	{
		serviceName = NormalizeServiceName(serviceName);
		string normalizedStartType = NormalizeRestorableStartType(desiredStartType);
		if (normalizedStartType != null)
		{
			if (normalizedStartType == "auto") EnsureProductDataRootVerified();
			await AssertOwnedImagePathAsync(serviceName, cancellationToken);
			await SetStartTypeAsync(serviceName, normalizedStartType, await StatusAsync(serviceName, cancellationToken), cancellationToken);
			OwnedServiceStatus ownedServiceStatus = await StatusAsync(serviceName, cancellationToken);
			if (ownedServiceStatus.Installed && !string.Equals(ownedServiceStatus.StartType, normalizedStartType, StringComparison.Ordinal))
			{
				throw new InvalidOperationException($"SC start type verification failed for {serviceName}: expected {normalizedStartType}, got {ownedServiceStatus.StartType ?? "unknown"}.");
			}
		}
	}

	internal Task AssertOwnedImagePathAsync(string serviceName, CancellationToken cancellationToken)
	{
		ReadOwnedExecutablePath(serviceName, cancellationToken);
		return Task.CompletedTask;
	}

	internal string ReadOwnedExecutablePath(string serviceName, CancellationToken cancellationToken)
	{
		EnsureKnownService(serviceName);
		cancellationToken.ThrowIfCancellationRequested();
		using RegistryKey registryKey = Registry.LocalMachine.OpenSubKey("SYSTEM\\CurrentControlSet\\Services\\" + serviceName, writable: false);
		string obj = registryKey?.GetValue("ImagePath", null, RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
		if (string.IsNullOrWhiteSpace(obj))
		{
			throw new InvalidOperationException("Cannot read ImagePath for owned service " + serviceName + ".");
		}
		string text = ExtractExecutablePath(Environment.ExpandEnvironmentVariables(obj.Trim()));
		if (serviceName == ServiceContract.VpnServiceName)
		{
			string expected = Path.Combine(_productDataRoot, "Runtime", "Vpn", "service-wrapper", "egoistshield-vpn-service.exe");
			if (!Path.GetFullPath(text).Equals(Path.GetFullPath(expected), StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("VPN service ImagePath is not its fixed owned wrapper.");
			string image = Environment.ExpandEnvironmentVariables(obj.Trim());
			if (!image.Equals(expected, StringComparison.OrdinalIgnoreCase) && !image.Equals("\"" + expected + "\"", StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("VPN service ImagePath includes unexpected arguments.");
			VerifyVpnWrapper(expected);
		}
		if (!MemoryExtensions.Contains<string>(value: Path.GetFileName(text), span: OwnedServices[serviceName].ExecutableNames, comparer: StringComparer.OrdinalIgnoreCase))
		{
			throw new UnauthorizedAccessException("ImagePath executable is not allowlisted for " + serviceName + ".");
		}
		return TrustedPath.AssertExistingFileUnderRoots(text, _installRoot, _productDataRoot);
	}

	private void VerifyVpnWrapper(string executable)
	{
		VpnServiceConfiguration.AssertPrivatePath(executable, _productDataRoot);
		using var installation = ProtectedExecutable.OpenHost(_installRoot, "cli");
		using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(_installRoot, "resources", "runtime", "manifest.json")));
		var pins = manifest.RootElement.GetProperty("components").EnumerateArray().Where(value => value.GetProperty("name").GetString() == "zapret")
			.SelectMany(value => value.GetProperty("files").EnumerateArray()).Where(value => value.GetProperty("path").GetString() == "zapret/service-wrapper/egoistshield-zapret-service.exe").ToArray();
		if (pins.Length != 1) throw new InvalidDataException("VPN wrapper source pin is ambiguous.");
		using var file = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read);
		if (file.Length != pins[0].GetProperty("size").GetInt64() || !Convert.ToHexString(SHA256.HashData(file)).Equals(pins[0].GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("VPN wrapper does not match its installation pin.");
		string xml = Path.ChangeExtension(executable, ".xml");
		VpnServiceConfiguration.AssertPrivatePath(xml, _productDataRoot);
		if (new FileInfo(xml).Length > 16384) throw new InvalidDataException("VPN wrapper config exceeds its bound.");
		using var reader = XmlReader.Create(xml, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null });
		var document = XDocument.Load(reader);
		var service = document.Root;
		string[] allowed = { "id", "name", "description", "startmode", "delayedAutoStart", "hidewindow", "executable", "arguments", "workingdirectory", "stoptimeout", "stopparentprocessfirst", "logpath", "log", "onfailure", "resetfailure" };
		if (service?.Name != "service" || service.HasAttributes || service.Elements().Any(value => !allowed.Contains(value.Name.LocalName, StringComparer.Ordinal) || value.Name.NamespaceName.Length != 0) ||
			service.Elements().Where(value => value.Name != "onfailure").GroupBy(value => value.Name).Any(group => group.Count() != 1)) throw new InvalidDataException("VPN wrapper includes an unsupported extension.");
		string helper = Path.Combine(_installRoot, "resources", "core-service", "win-x64", "EgoistShield.Service.exe");
		if (service.Element("id")?.Value != ServiceContract.VpnServiceName || service.Element("arguments")?.Value != "--run-vpn-runtime" ||
			!string.Equals(service.Element("executable")?.Value, helper, StringComparison.OrdinalIgnoreCase) ||
			!string.Equals(service.Element("workingdirectory")?.Value, Path.GetDirectoryName(helper), StringComparison.OrdinalIgnoreCase) ||
			service.Element("startmode")?.Value != "Automatic" || service.Element("hidewindow")?.Value != "true" || service.Element("stopparentprocessfirst")?.Value != "false")
			throw new InvalidDataException("VPN wrapper host contract is invalid.");
	}

	private async Task<OwnedServiceStatus> WaitForStateAsync(string serviceName, string expectedState, CancellationToken cancellationToken)
	{
		DateTimeOffset deadline = DateTimeOffset.UtcNow.Add(ServiceContract.ServiceTransitionTimeout);
		while (DateTimeOffset.UtcNow < deadline)
		{
			OwnedServiceStatus ownedServiceStatus = await StatusAsync(serviceName, cancellationToken);
			if (ownedServiceStatus.State == expectedState)
			{
				return ownedServiceStatus;
			}
			await Task.Delay(250, cancellationToken);
		}
		throw new System.TimeoutException($"Service {serviceName} did not reach {expectedState} within {ServiceContract.ServiceTransitionTimeout.TotalSeconds:0} seconds.");
	}

	private async Task DeleteServiceRegistrationAsync(string serviceName, CancellationToken cancellationToken)
	{
		ProcessResult processResult = await RunScAsync(new global::_003C_003Ez__ReadOnlyArray<string>(new string[2] { "delete", serviceName }), cancellationToken);
		int exitCode = processResult.ExitCode;
		if (exitCode != 0 && exitCode != 1060 && exitCode != 1072)
		{
			throw new InvalidOperationException("SC delete failed for " + serviceName + ": " + CleanError(processResult));
		}
	}

	private static string NormalizeStartType(ServiceStartMode mode)
	{
		return mode switch
		{
			ServiceStartMode.Boot => "boot", 
			ServiceStartMode.System => "system", 
			ServiceStartMode.Automatic => "auto", 
			ServiceStartMode.Manual => "demand", 
			ServiceStartMode.Disabled => "disabled", 
			_ => "unknown", 
		};
	}

	private static string? NormalizeRestorableStartType(string? startType)
	{
		if (!(startType == "auto") && !(startType == "demand") && !(startType == "disabled"))
		{
			if (startType == null || (startType != null && startType.Length == 0) || startType == "unknown" || startType == "not-installed")
			{
				return null;
			}
			throw new ArgumentException("Unsupported owned service start type: " + startType + ".", "startType");
		}
		return startType;
	}

	private static string NormalizeServiceState(ServiceControllerStatus status)
	{
		return status switch
		{
			ServiceControllerStatus.Stopped => "stopped", 
			ServiceControllerStatus.StartPending => "start_pending", 
			ServiceControllerStatus.StopPending => "stop_pending", 
			ServiceControllerStatus.Running => "running", 
			ServiceControllerStatus.ContinuePending => "continue_pending", 
			ServiceControllerStatus.PausePending => "pause_pending", 
			ServiceControllerStatus.Paused => "paused", 
			_ => "unknown", 
		};
	}

	private async Task SetStartTypeAsync(string serviceName, string desiredStartType, OwnedServiceStatus current, CancellationToken cancellationToken)
	{
		if (current.Installed && !string.Equals(current.StartType, desiredStartType, StringComparison.Ordinal))
		{
			ProcessResult processResult = await RunScAsync(new global::_003C_003Ez__ReadOnlyArray<string>(new string[4] { "config", serviceName, "start=", desiredStartType }), cancellationToken);
			if (processResult.ExitCode != 0)
			{
				throw new InvalidOperationException($"SC start type change to {desiredStartType} failed for {serviceName}: {CleanError(processResult)}");
			}
		}
	}

	private Task<ProcessResult> RunScAsync(IEnumerable<string> arguments, CancellationToken cancellationToken)
	{
		return ProcessRunner.RunAsync(_scPath, arguments, ServiceContract.CommandTimeout, cancellationToken);
	}

	internal async Task RepairRecoveryAsync(string serviceName, CancellationToken cancellationToken)
	{
		serviceName = NormalizeServiceName(serviceName);
		EnsureProductDataRootVerified();
		await AssertOwnedImagePathAsync(serviceName, cancellationToken);
		await ConfigureRecoveryAsync(serviceName, OwnedServices[serviceName].Description, RunScAsync, cancellationToken);
	}

	private async Task ConfigureInstallationAsync(string serviceName, string description, CancellationToken cancellationToken)
	{
		EnsureProductDataRootVerified();
		cancellationToken.ThrowIfCancellationRequested();
		ProcessResult startup = await RunScAsync(new[] { "config", serviceName, "start=", "auto" }, cancellationToken);
		if (startup.ExitCode != 0)
		{
			throw new InvalidOperationException("SC installation startup configuration failed for " + serviceName + ": " + CleanError(startup));
		}
		await ConfigureRecoveryAsync(serviceName, description, RunScAsync, cancellationToken);
		cancellationToken.ThrowIfCancellationRequested();
		ProcessResult delayedStart = await RunRegAsync(new[]
		{
			"add",
			"HKLM\\SYSTEM\\CurrentControlSet\\Services\\" + serviceName,
			"/v",
			"DelayedAutoStart",
			"/t",
			"REG_DWORD",
			"/d",
			"0",
			"/f"
		}, cancellationToken);
		if (delayedStart.ExitCode != 0)
		{
			throw new InvalidOperationException("DelayedAutoStart configuration failed for " + serviceName + ": " + CleanError(delayedStart));
		}
	}

	internal static async Task ConfigureRecoveryAsync(string serviceName, string description,
		Func<IEnumerable<string>, CancellationToken, Task<ProcessResult>> runSc, CancellationToken cancellationToken)
	{
		serviceName = NormalizeServiceName(serviceName);
		// Recovery repair must leave startup policy unchanged, including an external
		// Disabled change made after the supervisor's earlier status observation.
		string[][] array = new string[3][]
		{
			new string[4] { "config", serviceName, "depend=", "Tcpip/Afd" },
			new string[6] { "failure", serviceName, "reset=", "3600", "actions=", "restart/5000/restart/10000/restart/60000" },
			new string[3] { "failureflag", serviceName, "1" }
		};
		foreach (string[] arguments in array)
		{
			cancellationToken.ThrowIfCancellationRequested();
			ProcessResult processResult = await runSc(arguments, cancellationToken);
			if (processResult.ExitCode != 0)
			{
				throw new InvalidOperationException("SC recovery configuration failed for " + serviceName + ": " + CleanError(processResult));
			}
		}
		cancellationToken.ThrowIfCancellationRequested();
		ProcessResult processResult2 = await runSc(new[] { "description", serviceName, description }, cancellationToken);
		if (processResult2.ExitCode != 0)
		{
			throw new InvalidOperationException("SC description failed for " + serviceName + ": " + CleanError(processResult2));
		}
	}

	private string ResolveCanonicalExecutable(OwnedServiceDefinition definition)
	{
		return TrustedPath.AssertPathUnderRoot(Path.GetFullPath(Path.Combine(_productDataRoot, definition.RelativeExecutablePath)), _productDataRoot, requireLeaf: false);
	}

	private string[] ResolveOwnedArguments(string[] arguments)
	{
		return arguments.Select((string argument) => (!argument.Contains(Path.DirectorySeparatorChar) && !argument.Contains(Path.AltDirectorySeparatorChar)) ? argument : TrustedPath.AssertPathUnderRoot(Path.Combine(_productDataRoot, argument), _productDataRoot, requireLeaf: false)).ToArray();
	}

	private Task<ProcessResult> RunOwnedExecutableAsync(string executablePath, string[] arguments, CancellationToken cancellationToken)
	{
		EnsureProductDataRootVerified();
		return ProcessRunner.RunAsync(executablePath, arguments, ServiceContract.CommandTimeout, cancellationToken, Path.GetDirectoryName(executablePath));
	}

	private void EnsureProductDataRootVerified()
	{
		if (!_productDataRootVerified)
		{
			throw new ServiceOperationException("PROTECTED_ROOT_UNVERIFIED", "Права на защищённый каталог Egoist Lagom не подтверждены, поэтому запуск его исполняемых файлов заблокирован. Выполните «Восстановить интернет» или переустановите приложение.");
		}
	}

	private Task<ProcessResult> RunRegAsync(IEnumerable<string> arguments, CancellationToken cancellationToken)
	{
		return ProcessRunner.RunAsync(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "reg.exe"), arguments, ServiceContract.CommandTimeout, cancellationToken);
	}

	private static void EnsureKnownService(string serviceName)
	{
		if (!OwnedServices.ContainsKey(serviceName))
		{
			throw new ArgumentException("Service name is not allowlisted: " + serviceName);
		}
	}

	private static string ExtractExecutablePath(string commandLine)
	{
		string text = commandLine.Trim();
		if (text.StartsWith("\\??\\", StringComparison.Ordinal))
		{
			text = text.Substring(4);
		}
		if (text.StartsWith('"'))
		{
			int num = text.IndexOf('"', 1);
			if (num <= 1)
			{
				throw new InvalidOperationException("Malformed quoted service ImagePath.");
			}
			return text.Substring(1, num - 1);
		}
		int num2 = text.IndexOf(' ');
		string text2 = ((num2 < 0) ? text : text.Substring(0, num2));
		if (text2.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
		{
			return text2;
		}
		int num3 = text.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
		if (num3 < 0)
		{
			throw new InvalidOperationException("Service ImagePath does not contain an executable.");
		}
		return text.Substring(0, num3 + 4).Trim();
	}

	private static string CleanError(ProcessResult result)
	{
		return (string.IsNullOrWhiteSpace(result.StandardError) ? result.StandardOutput : result.StandardError).ReplaceLineEndings(" ").Trim();
	}
	[GeneratedCode("System.Text.RegularExpressions.Generator", "10.0.14.27113")]
	private static Regex ProfileRegex()
	{
		return _003CRegexGenerator_g_003EF6D74187046B00D172B4F885B621DE58A29247487BEEF7874C300C5ED3831944D__ProfileRegex_0.Instance;
	}
}
