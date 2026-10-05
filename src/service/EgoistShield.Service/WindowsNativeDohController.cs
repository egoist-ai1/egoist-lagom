using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed class WindowsNativeDohController
{
	private sealed record RemovalResult(string[] Removed, string[] Preserved);

	private const string Owner = "EgoistShield";

	public static bool IsSupported => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 20348);


	private readonly string _statePath;
	private readonly Func<string, CancellationToken, Task<ProcessResult>> _powerShellRunner;
	private readonly SemaphoreSlim _routeLock = new(1, 1);
	private readonly Func<TimeSpan> _routeElapsed;
	private TimeSpan? _routeCheckedAt;
	private bool _hasIpv6DefaultRoute;

	public WindowsNativeDohController(string stateRoot)
	{
		_statePath = Path.Combine(stateRoot, "native-doh-state.json");
		_powerShellRunner = RunWindowsPowerShellAsync;
		var clock = Stopwatch.StartNew();
		_routeElapsed = () => clock.Elapsed;
	}

	internal WindowsNativeDohController(string stateRoot, Func<string, CancellationToken, Task<ProcessResult>> powerShellRunner,
		Func<TimeSpan>? routeElapsed = null) : this(stateRoot)
	{
		_powerShellRunner = powerShellRunner ?? throw new ArgumentNullException(nameof(powerShellRunner));
		if (routeElapsed != null) _routeElapsed = routeElapsed;
	}

	public Task<NativeDohOwnedState?> ReadOwnedStateAsync(CancellationToken cancellationToken = default(CancellationToken))
	{
		return AtomicJsonFile.ReadAsync<NativeDohOwnedState>(_statePath, cancellationToken);
	}

	internal async Task<bool> HasIpv6DefaultRouteAsync(CancellationToken cancellationToken)
	{
		await _routeLock.WaitAsync(cancellationToken);
		try
		{
			TimeSpan now = _routeElapsed();
			if (_routeCheckedAt.HasValue && now >= _routeCheckedAt.Value && now - _routeCheckedAt.Value < TimeSpan.FromSeconds(30))
				return _hasIpv6DefaultRoute;
			string script = "$ErrorActionPreference = 'Stop'\n$connected = @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { [int]$_.ifIndex })\n$routes = @(Get-NetRoute -AddressFamily IPv6 -DestinationPrefix '::/0' -PolicyStore ActiveStore -ErrorAction SilentlyContinue | Where-Object { [int]$_.InterfaceIndex -in $connected })\n[bool]($routes.Count -gt 0) | ConvertTo-Json -Compress";
			var result = await RunPowerShellAsync(script, cancellationToken);
			EnsureSuccess(result, "inspect IPv6 default route");
			if (!bool.TryParse(result.StandardOutput.Trim(), out bool available))
				throw new ServiceOperationException("DNS_DOH_ROUTE_QUERY_INVALID", "IPv6 default route inspection returned an invalid result; route capability remains unknown.");
			_hasIpv6DefaultRoute = available;
			_routeCheckedAt = _routeElapsed();
			return _hasIpv6DefaultRoute;
		}
		finally { _routeLock.Release(); }
	}

	public async Task WriteOwnedStateAsync(NativeDohOwnedState? state, CancellationToken cancellationToken = default(CancellationToken))
	{
		if ((object)state == null)
		{
			if (File.Exists(_statePath))
			{
				File.Delete(_statePath);
			}
		}
		else
		{
			await AtomicJsonFile.WriteAsync(_statePath, state, cancellationToken);
		}
	}

	public static string ValidateUrl(string? rawUrl)
	{
		if (string.IsNullOrWhiteSpace(rawUrl) || !Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out Uri result) || result.Scheme != Uri.UriSchemeHttps || string.IsNullOrWhiteSpace(result.Host) || !string.IsNullOrEmpty(result.UserInfo))
		{
			throw new ArgumentException("Native DoH requires an absolute HTTPS URL without credentials.");
		}
		return result.AbsoluteUri;
	}

	public async Task<NativeDohEntrySnapshot[]> ReadEntriesAsync(IReadOnlyCollection<string> rawServers, CancellationToken cancellationToken = default(CancellationToken))
	{
		ProcessResult obj = await RunPowerShellAsync(CreateReadEntriesScript(WindowsDnsController.ValidateServers(rawServers)), cancellationToken);
		EnsureSuccess(obj, "read Windows DoH entries");
		return JsonSerializer.Deserialize<NativeDohEntrySnapshot[]>(obj.StandardOutput, JsonDefaults.Options) ?? Array.Empty<NativeDohEntrySnapshot>();
	}

	public async Task ConfigureAsync(string url, IReadOnlyCollection<string> rawServers, CancellationToken cancellationToken = default(CancellationToken), NativeDohOwnedState? previousOwnership = null)
	{
		string url2 = ValidateUrl(url);
		string[] servers = WindowsDnsController.ValidateServers(rawServers);
		EnsureSuccess(await RunPowerShellAsync(CreateConfigureScript(url2, servers, previousOwnership), cancellationToken), "configure Windows native DoH");
	}

	public async Task<(string[] Removed, string[] Preserved)> RemoveOwnedEntriesAsync(NativeDohOwnedState? state, CancellationToken cancellationToken = default(CancellationToken))
	{
		if ((object)state == null)
		{
			return (Removed: Array.Empty<string>(), Preserved: Array.Empty<string>());
		}
		string text = ValidateUrl(state.Url);
		string[] array = WindowsDnsController.ValidateServers(state.Servers);
		NativeDohEntrySnapshot[] originals = state.OriginalEntries ?? Array.Empty<NativeDohEntrySnapshot>();
		if (originals.Length != 0)
		{
			string[] originalServers = originals.Select((NativeDohEntrySnapshot entry) => entry.ServerAddress).ToArray();
			if (originals.Length != array.Length || !array.All((string server) => originalServers.Contains<string>(server, StringComparer.OrdinalIgnoreCase)))
			{
				throw new InvalidOperationException("Native DoH ownership state contains an inconsistent original-entry snapshot.");
			}
			await RestoreEntriesAsync(originals, text, cancellationToken);
			return (Removed: (from entry in originals
				where !entry.Existed
				select entry.ServerAddress).ToArray(), Preserved: (from entry in originals
				where entry.Existed
				select entry.ServerAddress).ToArray());
		}
		ProcessResult obj = await RunPowerShellAsync(CreateRemoveOwnedScript(text, array), cancellationToken);
		EnsureSuccess(obj, "remove owned Windows DoH entries");
		RemovalResult removalResult = JsonSerializer.Deserialize<RemovalResult>(obj.StandardOutput, JsonDefaults.Options);
		return (Removed: removalResult?.Removed ?? Array.Empty<string>(), Preserved: removalResult?.Preserved ?? Array.Empty<string>());
	}

	public async Task RestoreEntriesAsync(IReadOnlyCollection<NativeDohEntrySnapshot> snapshots, string desiredUrl, CancellationToken cancellationToken = default(CancellationToken))
	{
		if (snapshots.Count != 0)
		{
			string desiredUrl2 = ValidateUrl(desiredUrl);
			EnsureSuccess(await RunPowerShellAsync(CreateRestoreEntriesScript(snapshots, desiredUrl2), cancellationToken), "restore Windows DoH entries");
		}
	}

	public async Task RestoreRemovedEntriesAsync(IReadOnlyCollection<NativeDohEntrySnapshot> configuredSnapshots, NativeDohOwnedState state, CancellationToken cancellationToken = default(CancellationToken))
	{
		if (configuredSnapshots.Count != 0)
		{
			ValidateUrl(state.Url);
			NativeDohEntrySnapshot[] baselines = state.OriginalEntries ?? state.Servers.Select((string server) => new NativeDohEntrySnapshot(server, Existed: false, null, AllowFallbackToUdp: false, AutoUpgrade: false)).ToArray();
			EnsureSuccess(await RunPowerShellAsync(CreateRestoreRemovedEntriesScript(configuredSnapshots, baselines), cancellationToken), "restore removed Windows DoH entries");
		}
	}

	public static bool EntriesMatch(IReadOnlyCollection<NativeDohEntrySnapshot> entries, NativeDohOwnedState state)
	{
		if (entries.Count != state.Servers.Length)
		{
			return false;
		}
		return state.Servers.All((string server) => entries.Any((NativeDohEntrySnapshot entry) => entry.Existed && entry.ServerAddress.Equals(server, StringComparison.OrdinalIgnoreCase) && string.Equals(entry.DohTemplate, state.Url, StringComparison.OrdinalIgnoreCase) && !entry.AllowFallbackToUdp && entry.AutoUpgrade));
	}

	public async Task RemoveForUninstallAsync(WindowsDnsController dns, CancellationToken cancellationToken = default(CancellationToken))
	{
		NativeDohOwnedState state = await ReadOwnedStateAsync(cancellationToken);
		if ((object)state == null)
		{
			return;
		}
		string[] servers = WindowsDnsController.ValidateServers(state.Servers);
		DnsAdapterSnapshot[] originalDnsAdapters = state.OriginalDnsAdapters;
		DnsAdapterSnapshot[] array = originalDnsAdapters is { Length: > 0 }
			? await dns.ReadRequiredSnapshotAsync(originalDnsAdapters, cancellationToken)
			: await dns.ReadSnapshotAsync(cancellationToken);
		if (originalDnsAdapters != null && originalDnsAdapters.Length > 0)
		{
			var targets = new DnsOwnedState(1, "EgoistShield", servers, originalDnsAdapters).RestoreTargets(array, out _, repairLoopback: false);
			if (targets.Length != 0)
			{
				await dns.RestoreFromExpectedSnapshotAsync(targets, WindowsDnsController.IntersectByStableIdentity(array, targets), cancellationToken);
			}
		}
		else if (DnsMatchesServers(array, servers))
		{
			await dns.ResetAsync(array, cancellationToken);
		}
		await RemoveOwnedEntriesAsync(state, cancellationToken);
		await WriteOwnedStateAsync(null, cancellationToken);
		await dns.FlushCacheAsync(cancellationToken);
	}

	private static bool DnsMatchesServers(IReadOnlyCollection<DnsAdapterSnapshot> adapters, IReadOnlyCollection<string> servers)
	{
		string[] ipv4 = servers.Where((string server) => IPAddress.Parse(server).AddressFamily == AddressFamily.InterNetwork).ToArray();
		string[] ipv6 = servers.Where((string server) => IPAddress.Parse(server).AddressFamily == AddressFamily.InterNetworkV6).ToArray();
		if (adapters.Count > 0)
		{
			return adapters.All((DnsAdapterSnapshot adapter) => (ipv4.Length == 0 || (adapter.Ipv4Static && adapter.Ipv4.SequenceEqual<string>(ipv4, StringComparer.OrdinalIgnoreCase))) && (ipv6.Length == 0 || (adapter.Ipv6Static && adapter.Ipv6.SequenceEqual<string>(ipv6, StringComparer.OrdinalIgnoreCase))));
		}
		return false;
	}

	private static string CreateReadEntriesScript(IReadOnlyCollection<string> servers)
	{
		return "$ErrorActionPreference = 'Stop'\nif (-not (Get-Command Get-DnsClientDohServerAddress -ErrorAction SilentlyContinue)) {\n  throw 'Windows native DoH cmdlets are unavailable on this OS.'\n}\n$servers = @()\nforeach ($item in (ConvertFrom-Json -InputObject '" + SerializeForPowerShell(servers) + "')) { $servers += [string]$item }\n$rows = @()\nforeach ($server in $servers) {\n  $entry = Get-DnsClientDohServerAddress -ServerAddress ([string]$server) -ErrorAction SilentlyContinue | Select-Object -First 1\n  if ($entry) {\n    $rows += [pscustomobject]@{\n      serverAddress = [string]$entry.ServerAddress\n      existed = $true\n      dohTemplate = [string]$entry.DohTemplate\n      allowFallbackToUdp = [bool]$entry.AllowFallbackToUdp\n      autoUpgrade = [bool]$entry.AutoUpgrade\n    }\n  } else {\n    $rows += [pscustomobject]@{\n      serverAddress = [string]$server\n      existed = $false\n      dohTemplate = $null\n      allowFallbackToUdp = $false\n      autoUpgrade = $false\n    }\n  }\n}\nConvertTo-Json -InputObject @($rows) -Compress";
	}

	internal static string CreateConfigureScript(string url, IReadOnlyCollection<string> servers, NativeDohOwnedState? previousOwnership = null)
	{
		string? previousUrl = previousOwnership == null ? null : ValidateUrl(previousOwnership.Url);
		string[] previousServers = previousOwnership == null ? Array.Empty<string>() : WindowsDnsController.ValidateServers(previousOwnership.Servers);
		return $"$ErrorActionPreference = 'Stop'\n$url = [string](ConvertFrom-Json -InputObject '{SerializeForPowerShell(url)}')\n$previousUrl = [string](ConvertFrom-Json -InputObject '{SerializeForPowerShell(previousUrl)}')\n$previousServers = @()\nforeach ($item in (ConvertFrom-Json -InputObject '{SerializeForPowerShell(previousServers)}')) {{ $previousServers += [string]$item }}\n$servers = @()\nforeach ($item in (ConvertFrom-Json -InputObject '{SerializeForPowerShell(servers)}')) {{ $servers += [string]$item }}\nforeach ($server in $servers) {{\n  $entry = Get-DnsClientDohServerAddress -ServerAddress ([string]$server) -ErrorAction SilentlyContinue | Select-Object -First 1\n  $previousOwned = $entry -and ($previousServers -contains $server) -and\n    [string]::Equals([string]$entry.DohTemplate, $previousUrl, [StringComparison]::OrdinalIgnoreCase) -and\n    -not [bool]$entry.AllowFallbackToUdp -and [bool]$entry.AutoUpgrade\n  if ($entry -and -not [string]::Equals([string]$entry.DohTemplate, $url, [StringComparison]::OrdinalIgnoreCase) -and -not $previousOwned) {{\n    throw \"DoH server $server is already owned by another template: $($entry.DohTemplate)\"\n  }}\n  if ($entry) {{\n    Set-DnsClientDohServerAddress -ServerAddress ([string]$server) -DohTemplate $url -AllowFallbackToUdp $false -AutoUpgrade $true -ErrorAction Stop | Out-Null\n  }} else {{\n    Add-DnsClientDohServerAddress -ServerAddress ([string]$server) -DohTemplate $url -AllowFallbackToUdp $false -AutoUpgrade $true -ErrorAction Stop | Out-Null\n  }}\n  $actual = Get-DnsClientDohServerAddress -ServerAddress ([string]$server) -ErrorAction Stop | Select-Object -First 1\n  if (-not $actual -or\n      -not [string]::Equals([string]$actual.DohTemplate, $url, [StringComparison]::OrdinalIgnoreCase) -or\n      [bool]$actual.AllowFallbackToUdp -or\n      -not [bool]$actual.AutoUpgrade) {{\n    throw \"Native DoH readback failed for $server.\"\n  }}\n}}";
	}

	private static string CreateRemoveOwnedScript(string url, IReadOnlyCollection<string> servers)
	{
		return $"$ErrorActionPreference = 'Stop'\n$url = [string](ConvertFrom-Json -InputObject '{SerializeForPowerShell(url)}')\n$servers = @()\nforeach ($item in (ConvertFrom-Json -InputObject '{SerializeForPowerShell(servers)}')) {{ $servers += [string]$item }}\n$removed = @()\n$preserved = @()\nforeach ($server in $servers) {{\n  $entry = Get-DnsClientDohServerAddress -ServerAddress ([string]$server) -ErrorAction SilentlyContinue | Select-Object -First 1\n  if (-not $entry) {{ continue }}\n  if ([string]::Equals([string]$entry.DohTemplate, $url, [StringComparison]::OrdinalIgnoreCase) -and\n      -not [bool]$entry.AllowFallbackToUdp -and [bool]$entry.AutoUpgrade) {{\n    Remove-DnsClientDohServerAddress -ServerAddress ([string]$server) -Confirm:$false -ErrorAction Stop | Out-Null\n    $removed += [string]$server\n  }} else {{\n    $preserved += [string]$server\n  }}\n}}\n[pscustomobject]@{{ removed = @($removed); preserved = @($preserved) }} | ConvertTo-Json -Compress";
	}

	private static string CreateRestoreEntriesScript(IReadOnlyCollection<NativeDohEntrySnapshot> snapshots, string desiredUrl)
	{
		return $"$ErrorActionPreference = 'Stop'\n$snapshots = @()\nforeach ($item in (ConvertFrom-Json -InputObject '{SerializeForPowerShell(snapshots)}')) {{ $snapshots += $item }}\n$desiredUrl = [string](ConvertFrom-Json -InputObject '{SerializeForPowerShell(desiredUrl)}')\nforeach ($snapshot in $snapshots) {{\n  $server = [string]$snapshot.serverAddress\n  $current = Get-DnsClientDohServerAddress -ServerAddress $server -ErrorAction SilentlyContinue | Select-Object -First 1\n  $currentIsDesired = $current -and\n    [string]::Equals([string]$current.DohTemplate, $desiredUrl, [StringComparison]::OrdinalIgnoreCase) -and\n    -not [bool]$current.AllowFallbackToUdp -and [bool]$current.AutoUpgrade\n  if ([bool]$snapshot.existed) {{\n    $currentIsOriginal = $current -and\n      [string]::Equals([string]$current.DohTemplate, [string]$snapshot.dohTemplate, [StringComparison]::OrdinalIgnoreCase) -and\n      [bool]$current.AllowFallbackToUdp -eq [bool]$snapshot.allowFallbackToUdp -and\n      [bool]$current.AutoUpgrade -eq [bool]$snapshot.autoUpgrade\n    if ($currentIsOriginal) {{ continue }}\n    if ($current -and -not $currentIsDesired) {{\n      throw \"DoH entry $server changed outside Egoist Lagom; rollback preserved it.\"\n    }}\n    if ($current) {{\n      Set-DnsClientDohServerAddress -ServerAddress $server -DohTemplate ([string]$snapshot.dohTemplate) -AllowFallbackToUdp ([bool]$snapshot.allowFallbackToUdp) -AutoUpgrade ([bool]$snapshot.autoUpgrade) -ErrorAction Stop | Out-Null\n    }} else {{\n      Add-DnsClientDohServerAddress -ServerAddress $server -DohTemplate ([string]$snapshot.dohTemplate) -AllowFallbackToUdp ([bool]$snapshot.allowFallbackToUdp) -AutoUpgrade ([bool]$snapshot.autoUpgrade) -ErrorAction Stop | Out-Null\n    }}\n  }} elseif ($currentIsDesired) {{\n    Remove-DnsClientDohServerAddress -ServerAddress $server -Confirm:$false -ErrorAction Stop | Out-Null\n  }}\n}}";
	}

	private static string CreateRestoreRemovedEntriesScript(IReadOnlyCollection<NativeDohEntrySnapshot> configuredSnapshots, IReadOnlyCollection<NativeDohEntrySnapshot> baselines)
	{
		return $"$ErrorActionPreference = 'Stop'\n$configured = @()\nforeach ($item in (ConvertFrom-Json -InputObject '{SerializeForPowerShell(configuredSnapshots)}')) {{ $configured += $item }}\n$baselines = @()\nforeach ($item in (ConvertFrom-Json -InputObject '{SerializeForPowerShell(baselines)}')) {{ $baselines += $item }}\nfunction Test-EntryMatchesSnapshot {{\n  param($Entry, $Snapshot)\n  if (-not [bool]$Snapshot.existed) {{ return -not $Entry }}\n  return $Entry -and\n    [string]::Equals([string]$Entry.DohTemplate, [string]$Snapshot.dohTemplate, [StringComparison]::OrdinalIgnoreCase) -and\n    [bool]$Entry.AllowFallbackToUdp -eq [bool]$Snapshot.allowFallbackToUdp -and\n    [bool]$Entry.AutoUpgrade -eq [bool]$Snapshot.autoUpgrade\n}}\nforeach ($snapshot in $configured) {{\n  if (-not [bool]$snapshot.existed) {{ continue }}\n  $server = [string]$snapshot.serverAddress\n  $current = Get-DnsClientDohServerAddress -ServerAddress $server -ErrorAction SilentlyContinue | Select-Object -First 1\n  if (Test-EntryMatchesSnapshot $current $snapshot) {{ continue }}\n  $baseline = $baselines | Where-Object {{\n    [string]::Equals([string]$_.serverAddress, $server, [StringComparison]::OrdinalIgnoreCase)\n  }} | Select-Object -First 1\n  if (-not $baseline -or -not (Test-EntryMatchesSnapshot $current $baseline)) {{\n    throw \"DoH entry $server changed outside Egoist Lagom after removal; rollback preserved it.\"\n  }}\n  if ($current) {{\n    Set-DnsClientDohServerAddress -ServerAddress $server -DohTemplate ([string]$snapshot.dohTemplate) -AllowFallbackToUdp ([bool]$snapshot.allowFallbackToUdp) -AutoUpgrade ([bool]$snapshot.autoUpgrade) -ErrorAction Stop | Out-Null\n  }} else {{\n    Add-DnsClientDohServerAddress -ServerAddress $server -DohTemplate ([string]$snapshot.dohTemplate) -AllowFallbackToUdp ([bool]$snapshot.allowFallbackToUdp) -AutoUpgrade ([bool]$snapshot.autoUpgrade) -ErrorAction Stop | Out-Null\n  }}\n}}";
	}

	private static string SerializeForPowerShell<T>(T value)
	{
		return JsonSerializer.Serialize(value, JsonDefaults.StateOptions).Replace("'", "''");
	}

	private Task<ProcessResult> RunPowerShellAsync(string script, CancellationToken cancellationToken) => _powerShellRunner(script, cancellationToken);

	private static async Task<ProcessResult> RunWindowsPowerShellAsync(string script, CancellationToken cancellationToken)
	{
		if (!IsSupported)
		{
			throw new PlatformNotSupportedException("Native DoH requires Windows 11 or Windows Server 2022. Use the System DoH component on Windows 10.");
		}
		return await ProcessRunner.RunAsync(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"), new global::_003C_003Ez__ReadOnlyArray<string>(new string[6] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script }), ServiceContract.PowerShellTimeout, cancellationToken);
	}

	private static void EnsureSuccess(ProcessResult result, string action)
	{
		if (result.ExitCode == 0)
		{
			return;
		}
		string text = string.Join(Environment.NewLine, new string[2] { result.StandardError, result.StandardOutput }.Where((string value) => !string.IsNullOrWhiteSpace(value))).Trim();
		throw new InvalidOperationException($"Failed to {action} (exit {result.ExitCode}){((text.Length > 0) ? (": " + text) : ".")}");
	}
}
