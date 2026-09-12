using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed class WindowsDnsController
{
	private const string ConnectedInterfaceFilter = "$adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue; $identity = ([string]$_.InterfaceAlias + ' ' + [string]$adapter.InterfaceDescription); $_.ConnectionState -eq 'Connected' -and $identity -notmatch 'WireGuard|Wintun|Cloudflare\\s+WARP|VPN|Loopback|isatap|Teredo|Pseudo|Npcap|Bluetooth|(^|[\\s_-])(TAP|TUN)([\\s_-]|$)'";

	public Task<DnsAdapterSnapshot[]> ReadSnapshotAsync(CancellationToken cancellationToken = default(CancellationToken))
	{
		return ReadSnapshotCoreAsync(null, cancellationToken);
	}

	public async Task<DnsAdapterSnapshot[]> ReadPresentSnapshotAsync(IReadOnlyCollection<DnsAdapterSnapshot> targets, CancellationToken cancellationToken)
	{
		if (targets.Count == 0) return Array.Empty<DnsAdapterSnapshot>();
		EnsureStableTargetIdentity(targets);
		// Resolve by GUID, including disconnected adapters. A removed adapter must
		// never cause us to mutate whichever device later reused its index.
		string script = CreateSnapshotScript(targets)
			.Replace("if (-not $targets) { throw 'No connected physical network interface was found.' }", "", StringComparison.Ordinal)
			.Replace("throw \"Adapter $($Target.interfaceGuid) is no longer present.\"", "return $null", StringComparison.Ordinal)
			.Replace("$adapter = Resolve-TargetAdapter $target\n", "$adapter = Resolve-TargetAdapter $target\n  if (-not $adapter) { continue }\n", StringComparison.Ordinal);
		var result = await RunPowerShellAsync(script, cancellationToken);
		EnsureSuccess(result, "read present owned DNS adapters");
		if (string.IsNullOrWhiteSpace(result.StandardOutput)) return Array.Empty<DnsAdapterSnapshot>();
		return JsonSerializer.Deserialize<DnsAdapterSnapshot[]>(result.StandardOutput, JsonDefaults.Options) ?? Array.Empty<DnsAdapterSnapshot>();
	}

	public async Task<DnsAdapterSnapshot[]> ApplyAsync(IReadOnlyCollection<DnsAdapterSnapshot> targets, IReadOnlyCollection<string> rawServers, IReadOnlyCollection<string>? rawProbeHosts = null, CancellationToken cancellationToken = default(CancellationToken))
	{
		EnsureStableTargetIdentity(targets);
		string[] servers = ValidateServers(rawServers);
		string[] probeHosts = ValidateProbeHosts(rawProbeHosts ?? Array.Empty<string>());
		EnsureSuccess(await RunPowerShellAsync(CreateApplyScript(targets, servers), cancellationToken), "apply DNS servers");
		DnsAdapterSnapshot[] actual = await ReadSnapshotCoreAsync(targets, cancellationToken);
		VerifyApplied(actual, targets, servers);
		await VerifySystemResolutionAsync(probeHosts, cancellationToken);
		return actual;
	}

	public async Task<DnsAdapterSnapshot[]> ResetAsync(IReadOnlyCollection<DnsAdapterSnapshot> targets, CancellationToken cancellationToken = default(CancellationToken))
	{
		EnsureStableTargetIdentity(targets);
		EnsureSuccess(await RunPowerShellAsync(CreateResetScript(targets), cancellationToken), "reset DNS servers");
		DnsAdapterSnapshot[] obj = await ReadSnapshotCoreAsync(targets, cancellationToken);
		VerifyReset(obj, targets);
		return obj;
	}

	public async Task RestoreAsync(IReadOnlyCollection<DnsAdapterSnapshot> snapshot, string operation, IReadOnlyCollection<string>? desiredServers, CancellationToken cancellationToken = default(CancellationToken))
	{
		if (snapshot.Count != 0)
		{
			if (!(operation == "dns.apply") && !(operation == "dns.reset"))
			{
				throw new InvalidOperationException("Unsupported DNS rollback operation: " + operation + ".");
			}
			string[] desired = ((operation == "dns.apply") ? ValidateServers(desiredServers ?? Array.Empty<string>()) : Array.Empty<string>());
			EnsureSuccess(await RunPowerShellAsync(CreateRestoreScript(snapshot, operation, desired), cancellationToken), "restore DNS snapshot");
			VerifyRestored(await ReadSnapshotCoreAsync(snapshot, cancellationToken), snapshot, operation, desired);
		}
	}

	public async Task RestoreFromExpectedSnapshotAsync(IReadOnlyCollection<DnsAdapterSnapshot> snapshot, IReadOnlyCollection<DnsAdapterSnapshot> expectedCurrent, CancellationToken cancellationToken = default(CancellationToken))
	{
		EnsureStableTargetIdentity(snapshot);
		EnsureStableTargetIdentity(expectedCurrent);
		EnsureSuccess(await RunPowerShellAsync(CreateRestoreScript(snapshot, "dns.snapshot", Array.Empty<string>(), expectedCurrent), cancellationToken), "restore DNS from an expected owned snapshot");
		VerifyRestored(await ReadSnapshotCoreAsync(snapshot, cancellationToken), snapshot, "dns.reset", Array.Empty<string>());
	}

	public async Task<bool> MatchesRecordedPostStateAsync(ActiveTransaction transaction, CancellationToken cancellationToken = default(CancellationToken))
	{
		if (transaction.Resource != "dns" || !transaction.Verified.HasValue)
		{
			return false;
		}
		DnsAdapterSnapshot[] original = transaction.Original.ValueKind == JsonValueKind.Object
			? transaction.Original.Deserialize<DnsOwnedTransactionSnapshot>(JsonDefaults.StateOptions)?.Adapters ?? Array.Empty<DnsAdapterSnapshot>()
			: transaction.Original.Deserialize<DnsAdapterSnapshot[]>(JsonDefaults.StateOptions) ?? Array.Empty<DnsAdapterSnapshot>();
		if (original.Length == 0)
		{
			return false;
		}
		try
		{
			DnsAdapterSnapshot[] actual = await ReadSnapshotCoreAsync(original, cancellationToken);
			if (transaction.Operation == "dns.apply")
			{
				string[] rawServers = transaction.Desired.GetProperty("servers").Deserialize<string[]>(JsonDefaults.StateOptions) ?? Array.Empty<string>();
				VerifyApplied(actual, original, ValidateServers(rawServers));
				return true;
			}
			if (transaction.Operation == "dns.reset")
			{
				VerifyReset(actual, original);
				return true;
			}
			if (transaction.Operation == "dns.restore-owned")
			{
				DnsAdapterSnapshot[] expected = transaction.Verified.Value.GetProperty("restored").Deserialize<DnsAdapterSnapshot[]>(JsonDefaults.StateOptions) ?? Array.Empty<DnsAdapterSnapshot>();
				if (expected.Length == 0) return true;
				DnsAdapterSnapshot[] present = await ReadPresentSnapshotAsync(expected, cancellationToken);
				VerifyRestored(present, expected, "dns.reset", Array.Empty<string>());
				return true;
			}
		}
		catch
		{
			return false;
		}
		return false;
	}

	public async Task FlushCacheAsync(CancellationToken cancellationToken = default(CancellationToken))
	{
		EnsureSuccess(await ProcessRunner.RunAsync(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "ipconfig.exe"), new _003C_003Ez__ReadOnlySingleElementList<string>("/flushdns"), TimeSpan.FromSeconds(10L), cancellationToken), "flush DNS cache");
	}

	public static string[] ValidateServers(IReadOnlyCollection<string> rawServers)
	{
		int count = rawServers.Count;
		if ((count < 1 || count > 6) ? true : false)
		{
			throw new ArgumentException("DNS server list must contain between 1 and 6 addresses.");
		}
		List<string> list = new List<string>();
		foreach (string rawServer in rawServers)
		{
			string text = rawServer.Trim();
			if (!IPAddress.TryParse(text, out IPAddress address))
			{
				throw new ArgumentException("Invalid DNS IP address: " + text);
			}
			if (address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any) || address.IsIPv6Multicast)
			{
				throw new ArgumentException("Unsupported DNS IP address: " + text);
			}
			string text2 = address.ToString();
			if (!list.Contains<string>(text2, StringComparer.OrdinalIgnoreCase))
			{
				list.Add(text2);
			}
		}
		return list.ToArray();
	}

	public static string[] ValidateProbeHosts(IReadOnlyCollection<string> rawHosts)
	{
		if (rawHosts.Count > 6)
		{
			throw new ArgumentException("DNS system probe accepts at most 6 hosts.");
		}
		List<string> list = new List<string>();
		foreach (string rawHost in rawHosts)
		{
			string text = rawHost.Trim().TrimEnd('.');
			int length = text.Length;
			bool flag = ((length < 1 || length > 253) ? true : false);
			if (flag || Uri.CheckHostName(text) != UriHostNameType.Dns)
			{
				throw new ArgumentException("Invalid DNS system probe host: " + text);
			}
			if (!list.Contains<string>(text, StringComparer.OrdinalIgnoreCase))
			{
				list.Add(text);
			}
		}
		return list.ToArray();
	}

	private static async Task VerifySystemResolutionAsync(IReadOnlyCollection<string> hosts, CancellationToken cancellationToken)
	{
		if (hosts.Count == 0)
		{
			return;
		}
		using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
		timeout.CancelAfter(TimeSpan.FromSeconds(15L));
		foreach (string host in hosts)
		{
			try
			{
				if ((await Dns.GetHostAddressesAsync(host, timeout.Token)).Length == 0)
				{
					throw new InvalidOperationException("resolver returned no addresses");
				}
			}
			catch (Exception ex) when (!(ex is ArgumentException))
			{
				throw new InvalidOperationException("Windows DNS Client did not resolve " + host + " after the adapter change: " + ex.Message, ex);
			}
		}
	}

	private async Task<DnsAdapterSnapshot[]> ReadSnapshotCoreAsync(IReadOnlyCollection<DnsAdapterSnapshot>? targets, CancellationToken cancellationToken)
	{
		ProcessResult obj = await RunPowerShellAsync(CreateSnapshotScript(targets), cancellationToken);
		EnsureSuccess(obj, "read DNS snapshot");
		DnsAdapterSnapshot[] array = JsonSerializer.Deserialize<DnsAdapterSnapshot[]>(obj.StandardOutput, JsonDefaults.Options);
		if (array == null || array.Length == 0)
		{
			throw new InvalidOperationException("Windows returned an empty DNS adapter snapshot.");
		}
		DnsAdapterSnapshot[] array2 = array.Where((DnsAdapterSnapshot adapter) => adapter.InterfaceIndex > 0).ToArray();
		if (array2.Length != array.Length)
		{
			throw new InvalidOperationException("Windows returned an invalid DNS adapter identity.");
		}
		return array2;
	}

	private static async Task<ProcessResult> RunPowerShellAsync(string script, CancellationToken cancellationToken)
	{
		return await ProcessRunner.RunAsync(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"), new global::_003C_003Ez__ReadOnlyArray<string>(new string[6] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script }), ServiceContract.PowerShellTimeout, cancellationToken);
	}

	private static void EnsureSuccess(ProcessResult result, string operation)
	{
		if (result.ExitCode != 0)
		{
			string value = (string.IsNullOrWhiteSpace(result.StandardError) ? result.StandardOutput.Trim() : result.StandardError.Trim());
			throw new InvalidOperationException($"Failed to {operation} (exit {result.ExitCode}): {value}");
		}
	}

	private static void EnsureStableTargetIdentity(IReadOnlyCollection<DnsAdapterSnapshot> targets)
	{
		if (targets.Count == 0)
		{
			throw new InvalidOperationException("No DNS adapter targets were captured.");
		}
		DnsAdapterSnapshot dnsAdapterSnapshot = targets.FirstOrDefault((DnsAdapterSnapshot target) => string.IsNullOrWhiteSpace(target.InterfaceGuid));
		if ((object)dnsAdapterSnapshot != null)
		{
			throw new InvalidOperationException("DNS adapter " + dnsAdapterSnapshot.InterfaceAlias + " has no stable interface GUID.");
		}
		if (targets.GroupBy<DnsAdapterSnapshot, string>((DnsAdapterSnapshot target) => target.InterfaceGuid, StringComparer.OrdinalIgnoreCase).Any((IGrouping<string, DnsAdapterSnapshot> group) => group.Count() > 1))
		{
			throw new InvalidOperationException("DNS snapshot contains duplicate adapter GUIDs.");
		}
	}

	private static void VerifyApplied(IReadOnlyCollection<DnsAdapterSnapshot> actual, IReadOnlyCollection<DnsAdapterSnapshot> targets, IReadOnlyCollection<string> desired)
	{
		string[] array = desired.Where((string value) => IPAddress.Parse(value).AddressFamily == AddressFamily.InterNetwork).ToArray();
		string[] array2 = desired.Where((string value) => IPAddress.Parse(value).AddressFamily == AddressFamily.InterNetworkV6).ToArray();
		foreach (DnsAdapterSnapshot target in targets)
		{
			DnsAdapterSnapshot dnsAdapterSnapshot = FindMatchingAdapter(actual, target);
			if (array.Length != 0 && (!dnsAdapterSnapshot.Ipv4Static || !AddressSequenceEquals(dnsAdapterSnapshot.Ipv4, array)))
			{
				throw new InvalidOperationException("IPv4 DNS verification failed for interface " + dnsAdapterSnapshot.InterfaceAlias + ".");
			}
			if (array2.Length != 0 && (!dnsAdapterSnapshot.Ipv6Static || !AddressSequenceEquals(dnsAdapterSnapshot.Ipv6, array2)))
			{
				throw new InvalidOperationException("IPv6 DNS verification failed for interface " + dnsAdapterSnapshot.InterfaceAlias + ".");
			}
		}
		if (actual.Count != targets.Count)
		{
			throw new InvalidOperationException("DNS readback returned a different adapter set.");
		}
	}

	private static void VerifyReset(IReadOnlyCollection<DnsAdapterSnapshot> actual, IReadOnlyCollection<DnsAdapterSnapshot> targets)
	{
		foreach (DnsAdapterSnapshot target in targets)
		{
			DnsAdapterSnapshot dnsAdapterSnapshot = FindMatchingAdapter(actual, target);
			if (dnsAdapterSnapshot.Ipv4Static || dnsAdapterSnapshot.Ipv6Static)
			{
				throw new InvalidOperationException("DNS reset verification failed for interface " + dnsAdapterSnapshot.InterfaceAlias + ".");
			}
		}
		if (actual.Count != targets.Count)
		{
			throw new InvalidOperationException("DNS reset readback returned a different adapter set.");
		}
	}

	private static void VerifyRestored(IReadOnlyCollection<DnsAdapterSnapshot> actual, IReadOnlyCollection<DnsAdapterSnapshot> original, string operation, IReadOnlyCollection<string> desiredServers)
	{
		bool flag = operation == "dns.reset" || desiredServers.Any((string value) => IPAddress.Parse(value).AddressFamily == AddressFamily.InterNetwork);
		bool flag2 = operation == "dns.reset" || desiredServers.Any((string value) => IPAddress.Parse(value).AddressFamily == AddressFamily.InterNetworkV6);
		foreach (DnsAdapterSnapshot item in original)
		{
			DnsAdapterSnapshot dnsAdapterSnapshot = FindMatchingAdapter(actual, item);
			if (flag)
			{
				VerifyRestoredFamily(dnsAdapterSnapshot.InterfaceAlias, "IPv4", dnsAdapterSnapshot.Ipv4, dnsAdapterSnapshot.Ipv4Static, item.Ipv4, item.Ipv4Static);
			}
			if (flag2)
			{
				VerifyRestoredFamily(dnsAdapterSnapshot.InterfaceAlias, "IPv6", dnsAdapterSnapshot.Ipv6, dnsAdapterSnapshot.Ipv6Static, item.Ipv6, item.Ipv6Static);
			}
		}
		if (actual.Count != original.Count)
		{
			throw new InvalidOperationException("DNS restore readback returned a different adapter set.");
		}
	}

	private static void VerifyRestoredFamily(string alias, string family, IReadOnlyCollection<string> actualAddresses, bool actualStatic, IReadOnlyCollection<string> expectedAddresses, bool expectedStatic)
	{
		if (actualStatic != expectedStatic || (expectedStatic && !AddressSequenceEquals(actualAddresses, expectedAddresses)))
		{
			throw new InvalidOperationException(family + " DNS restore readback failed for interface " + alias + ".");
		}
	}

	private static DnsAdapterSnapshot FindMatchingAdapter(IReadOnlyCollection<DnsAdapterSnapshot> actual, DnsAdapterSnapshot expected)
	{
		return ((!string.IsNullOrWhiteSpace(expected.InterfaceGuid)) ? actual.SingleOrDefault((DnsAdapterSnapshot adapter) => string.Equals(adapter.InterfaceGuid, expected.InterfaceGuid, StringComparison.OrdinalIgnoreCase)) : actual.SingleOrDefault((DnsAdapterSnapshot adapter) => adapter.InterfaceIndex == expected.InterfaceIndex && adapter.InterfaceAlias.Equals(expected.InterfaceAlias, StringComparison.OrdinalIgnoreCase))) ?? throw new InvalidOperationException("DNS adapter " + expected.InterfaceAlias + " is missing or changed identity.");
	}

	internal static DnsAdapterSnapshot[] IntersectByStableIdentity(IReadOnlyCollection<DnsAdapterSnapshot> candidates, IReadOnlyCollection<DnsAdapterSnapshot> identities)
	{
		return candidates.Where((DnsAdapterSnapshot candidate) => identities.Any((DnsAdapterSnapshot identity) => SameStableIdentity(candidate, identity))).ToArray();
	}

	private static bool SameStableIdentity(DnsAdapterSnapshot left, DnsAdapterSnapshot right)
	{
		if (!string.IsNullOrWhiteSpace(left.InterfaceGuid) || !string.IsNullOrWhiteSpace(right.InterfaceGuid))
		{
			if (!string.IsNullOrWhiteSpace(left.InterfaceGuid) && !string.IsNullOrWhiteSpace(right.InterfaceGuid))
			{
				return string.Equals(left.InterfaceGuid, right.InterfaceGuid, StringComparison.OrdinalIgnoreCase);
			}
			return false;
		}
		if (left.InterfaceIndex == right.InterfaceIndex)
		{
			return left.InterfaceAlias.Equals(right.InterfaceAlias, StringComparison.OrdinalIgnoreCase);
		}
		return false;
	}

	private static bool AddressSequenceEquals(IEnumerable<string> left, IEnumerable<string> right)
	{
		return left.SequenceEqual<string>(right, StringComparer.OrdinalIgnoreCase);
	}

	private static string CreateSnapshotScript(IReadOnlyCollection<DnsAdapterSnapshot>? targets)
	{
		string text = ((targets == null) ? "$targets = @(\n  Get-NetIPInterface | Where-Object { $adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue; $identity = ([string]$_.InterfaceAlias + ' ' + [string]$adapter.InterfaceDescription); $_.ConnectionState -eq 'Connected' -and $identity -notmatch 'WireGuard|Wintun|Cloudflare\\s+WARP|VPN|Loopback|isatap|Teredo|Pseudo|Npcap|Bluetooth|(^|[\\s_-])(TAP|TUN)([\\s_-]|$)' } |\n    Group-Object InterfaceIndex | ForEach-Object {\n      $iface = $_.Group | Sort-Object InterfaceMetric | Select-Object -First 1\n      [pscustomobject]@{\n        interfaceIndex = [int]$iface.InterfaceIndex\n        interfaceAlias = [string]$iface.InterfaceAlias\n        interfaceGuid = $null\n      }\n    }\n)" : ("$targets = @(); foreach ($item in (ConvertFrom-Json -InputObject '" + SerializeForPowerShell(targets) + "')) { $targets += $item }"));
		return "$ErrorActionPreference = 'Stop'\n" + text + "\nfunction Resolve-TargetAdapter {\n  param($Target)\n  if ($Target.interfaceGuid) {\n    $adapter = Get-NetAdapter -ErrorAction SilentlyContinue |\n      Where-Object { [string]$_.InterfaceGuid -eq [string]$Target.interfaceGuid } |\n      Select-Object -First 1\n    if (-not $adapter) { throw \"Adapter $($Target.interfaceGuid) is no longer present.\" }\n    return $adapter\n  }\n  $adapter = Get-NetAdapter -InterfaceIndex ([int]$Target.interfaceIndex) -ErrorAction SilentlyContinue\n  if (-not $adapter) { throw \"Adapter index $($Target.interfaceIndex) is no longer present.\" }\n  if ([string]$adapter.Name -ne [string]$Target.interfaceAlias) {\n    throw \"Adapter index $($Target.interfaceIndex) was reused by $($adapter.Name).\"\n  }\n  return $adapter\n}\nfunction Test-StaticDns {\n  param([string]$Guid, [string]$Family)\n  if (-not $Guid) { return $false }\n  $protocol = if ($Family -eq 'IPv4') { 'Tcpip' } else { 'Tcpip6' }\n  try {\n    $value = (Get-ItemProperty -Path \"HKLM:\\SYSTEM\\CurrentControlSet\\Services\\$protocol\\Parameters\\Interfaces\\$Guid\" -Name NameServer -ErrorAction Stop).NameServer\n    return -not [string]::IsNullOrWhiteSpace([string]$value)\n  } catch { return $false }\n}\nif (-not $targets) { throw 'No connected physical network interface was found.' }\n$result = @()\nforeach ($target in @($targets)) {\n  $adapter = Resolve-TargetAdapter $target\n  $index = [int]$adapter.ifIndex\n  $guid = [string]$adapter.InterfaceGuid\n  $v4 = Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily IPv4 -ErrorAction Stop\n  $v6 = Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily IPv6 -ErrorAction Stop\n  $result += [pscustomobject]@{\n    interfaceIndex = $index\n    interfaceAlias = [string]$adapter.Name\n    interfaceGuid = $guid\n    ipv4 = @($v4.ServerAddresses)\n    ipv6 = @($v6.ServerAddresses)\n    ipv4Static = [bool](Test-StaticDns $guid 'IPv4')\n    ipv6Static = [bool](Test-StaticDns $guid 'IPv6')\n  }\n}\nConvertTo-Json -InputObject @($result) -Compress -Depth 5";
	}

	private static string CreateApplyScript(IReadOnlyCollection<DnsAdapterSnapshot> targets, IReadOnlyCollection<string> servers)
	{
		string value = ToPowerShellArray(servers.Where((string ipString) => IPAddress.Parse(ipString).AddressFamily == AddressFamily.InterNetwork));
		string value2 = ToPowerShellArray(servers.Where((string ipString) => IPAddress.Parse(ipString).AddressFamily == AddressFamily.InterNetworkV6));
		return $"$ErrorActionPreference = 'Stop'\n$targets = @()\nforeach ($item in (ConvertFrom-Json -InputObject '{SerializeForPowerShell(targets)}')) {{ $targets += $item }}\n$ipv4 = {value}\n$ipv6 = {value2}\nforeach ($target in $targets) {{\n  $adapter = Get-NetAdapter -ErrorAction SilentlyContinue |\n    Where-Object {{ [string]$_.InterfaceGuid -eq [string]$target.interfaceGuid }} |\n    Select-Object -First 1\n  if (-not $adapter) {{ throw \"Adapter $($target.interfaceGuid) is no longer present.\" }}\n  $index = [int]$adapter.ifIndex\n  if ($ipv4.Count -gt 0) {{\n    Set-DnsClientServerAddress -InterfaceIndex $index -ServerAddresses $ipv4 -Validate:$false -ErrorAction Stop\n  }}\n  if ($ipv6.Count -gt 0) {{\n    & netsh.exe interface ipv6 set dnsservers name=$index source=static address=$($ipv6[0]) validate=no | Out-Null\n    if ($LASTEXITCODE -ne 0) {{ throw \"IPv6 DNS apply failed for interface $index.\" }}\n    for ($i = 1; $i -lt $ipv6.Count; $i++) {{\n      & netsh.exe interface ipv6 add dnsservers name=$index address=$($ipv6[$i]) index=$($i + 1) validate=no | Out-Null\n      if ($LASTEXITCODE -ne 0) {{ throw \"IPv6 DNS add failed for interface $index.\" }}\n    }}\n  }}\n}}\n& ipconfig.exe /flushdns | Out-Null\nif ($LASTEXITCODE -ne 0) {{ throw 'DNS cache flush failed.' }}";
	}

	private static string CreateResetScript(IReadOnlyCollection<DnsAdapterSnapshot> targets)
	{
		return "$ErrorActionPreference = 'Stop'\n$targets = @()\nforeach ($item in (ConvertFrom-Json -InputObject '" + SerializeForPowerShell(targets) + "')) { $targets += $item }\nforeach ($target in $targets) {\n  $adapter = Get-NetAdapter -ErrorAction SilentlyContinue |\n    Where-Object { [string]$_.InterfaceGuid -eq [string]$target.interfaceGuid } |\n    Select-Object -First 1\n  if (-not $adapter) { throw \"Adapter $($target.interfaceGuid) is no longer present.\" }\n  Set-DnsClientServerAddress -InterfaceIndex ([int]$adapter.ifIndex) -ResetServerAddresses -ErrorAction Stop\n}\n& ipconfig.exe /flushdns | Out-Null\nif ($LASTEXITCODE -ne 0) { throw 'DNS cache flush failed.' }";
	}

	private static string CreateRestoreScript(IReadOnlyCollection<DnsAdapterSnapshot> snapshot, string operation, IReadOnlyCollection<string> desiredServers, IReadOnlyCollection<DnsAdapterSnapshot>? expectedCurrent = null)
	{
		string value = ToPowerShellArray(desiredServers.Where((string ipString) => IPAddress.Parse(ipString).AddressFamily == AddressFamily.InterNetwork));
		string value2 = ToPowerShellArray(desiredServers.Where((string ipString) => IPAddress.Parse(ipString).AddressFamily == AddressFamily.InterNetworkV6));
		return $"$ErrorActionPreference = 'Continue'\n$targets = @()\nforeach ($item in (ConvertFrom-Json -InputObject '{SerializeForPowerShell(snapshot)}')) {{ $targets += $item }}\n$operation = '{operation}'\n$desiredV4 = {value}\n$desiredV6 = {value2}\n$expectedTargets = @()\n{((expectedCurrent == null) ? "" : ("foreach ($item in (ConvertFrom-Json -InputObject '" + SerializeForPowerShell(expectedCurrent) + "')) { $expectedTargets += $item }"))}\n$failures = New-Object System.Collections.Generic.List[string]\nfunction Test-Sequence {{\n  param([string[]]$Left, [string[]]$Right)\n  if ($Left.Count -ne $Right.Count) {{ return $false }}\n  for ($i = 0; $i -lt $Left.Count; $i++) {{\n    if (-not [string]::Equals([string]$Left[$i], [string]$Right[$i], [StringComparison]::OrdinalIgnoreCase)) {{ return $false }}\n  }}\n  return $true\n}}\nfunction Test-StaticDns {{\n  param([string]$Guid, [string]$Family)\n  if (-not $Guid) {{ return $false }}\n  $protocol = if ($Family -eq 'ipv4') {{ 'Tcpip' }} else {{ 'Tcpip6' }}\n  try {{\n    $value = (Get-ItemProperty -Path \"HKLM:\\SYSTEM\\CurrentControlSet\\Services\\$protocol\\Parameters\\Interfaces\\$Guid\" -Name NameServer -ErrorAction Stop).NameServer\n    return -not [string]::IsNullOrWhiteSpace([string]$value)\n  }} catch {{ return $false }}\n}}\nfunction Set-FamilyDns {{\n  param([string]$Family, [int]$Index, [string[]]$Addresses, [bool]$Static)\n  if (-not $Static -or $Addresses.Count -eq 0) {{\n    & netsh.exe interface $Family set dnsservers name=$Index source=dhcp validate=no | Out-Null\n    if ($LASTEXITCODE -ne 0) {{ throw \"DHCP DNS restore failed for $Family/$Index.\" }}\n    return\n  }}\n  & netsh.exe interface $Family set dnsservers name=$Index source=static address=$($Addresses[0]) validate=no | Out-Null\n  if ($LASTEXITCODE -ne 0) {{ throw \"Static DNS restore failed for $Family/$Index.\" }}\n  for ($i = 1; $i -lt $Addresses.Count; $i++) {{\n    & netsh.exe interface $Family add dnsservers name=$Index address=$($Addresses[$i]) index=$($i + 1) validate=no | Out-Null\n    if ($LASTEXITCODE -ne 0) {{ throw \"DNS restore add failed for $Family/$Index.\" }}\n  }}\n}}\nforeach ($target in $targets) {{\n  $adapter = $null\n  if ($target.interfaceGuid) {{\n    $adapter = Get-NetAdapter -ErrorAction SilentlyContinue |\n      Where-Object {{ [string]$_.InterfaceGuid -eq [string]$target.interfaceGuid }} |\n      Select-Object -First 1\n    if (-not $adapter) {{\n      $failures.Add(\"Adapter $($target.interfaceGuid) is no longer present; index fallback is forbidden.\")\n      continue\n    }}\n  }} else {{\n    $adapter = Get-NetAdapter -InterfaceIndex ([int]$target.interfaceIndex) -ErrorAction SilentlyContinue\n    if (-not $adapter -or [string]$adapter.Name -ne [string]$target.interfaceAlias) {{\n      $failures.Add(\"Legacy adapter identity $($target.interfaceAlias)/$($target.interfaceIndex) no longer matches.\")\n      continue\n    }}\n  }}\n  $index = [int]$adapter.ifIndex\n  $expectedTarget = $null\n  if ($operation -eq 'dns.snapshot') {{\n    $expectedTarget = $expectedTargets | Where-Object {{\n      if ($target.interfaceGuid) {{\n        [string]::Equals([string]$_.interfaceGuid, [string]$target.interfaceGuid, [StringComparison]::OrdinalIgnoreCase)\n      }} else {{\n        [int]$_.interfaceIndex -eq [int]$target.interfaceIndex -and [string]$_.interfaceAlias -eq [string]$target.interfaceAlias\n      }}\n    }} | Select-Object -First 1\n    if (-not $expectedTarget) {{\n      $failures.Add(\"Expected DNS post-state is missing adapter $($adapter.Name).\")\n      continue\n    }}\n  }}\n  foreach ($family in @('ipv4', 'ipv6')) {{\n    $originalAddresses = if ($family -eq 'ipv4') {{ @($target.ipv4) }} else {{ @($target.ipv6) }}\n    $originalStatic = if ($family -eq 'ipv4') {{ [bool]$target.ipv4Static }} else {{ [bool]$target.ipv6Static }}\n    $current = Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily $(if ($family -eq 'ipv4') {{ 'IPv4' }} else {{ 'IPv6' }}) -ErrorAction SilentlyContinue\n    $currentAddresses = @($current.ServerAddresses)\n    $currentStatic = [bool](Test-StaticDns ([string]$adapter.InterfaceGuid) $family)\n    $alreadyOriginal = $currentStatic -eq $originalStatic -and (-not $originalStatic -or (Test-Sequence $currentAddresses $originalAddresses))\n    if ($alreadyOriginal) {{ continue }}\n\n    $ownedMutation = $false\n    if ($operation -eq 'dns.apply') {{\n      $desired = if ($family -eq 'ipv4') {{ $desiredV4 }} else {{ $desiredV6 }}\n      if ($desired.Count -eq 0) {{\n        continue\n      }}\n      $ownedMutation = $currentStatic -and (Test-Sequence $currentAddresses $desired)\n    }} elseif ($operation -eq 'dns.reset') {{\n      $ownedMutation = -not $currentStatic\n    }} elseif ($operation -eq 'dns.snapshot') {{\n      $expectedAddresses = if ($family -eq 'ipv4') {{ @($expectedTarget.ipv4) }} else {{ @($expectedTarget.ipv6) }}\n      $expectedStatic = if ($family -eq 'ipv4') {{ [bool]$expectedTarget.ipv4Static }} else {{ [bool]$expectedTarget.ipv6Static }}\n      $ownedMutation = $currentStatic -eq $expectedStatic -and (-not $expectedStatic -or (Test-Sequence $currentAddresses $expectedAddresses))\n    }}\n    if (-not $ownedMutation) {{\n      $failures.Add(\"$family on $($adapter.Name) no longer matches the transaction post-state; restore was skipped.\")\n      continue\n    }}\n\n    try {{\n      Set-FamilyDns $family $index $originalAddresses $originalStatic\n    }} catch {{\n      $failures.Add(\"${{family}}/${{index}}: $($_.Exception.Message)\")\n    }}\n  }}\n}}\n& ipconfig.exe /flushdns | Out-Null\nif ($LASTEXITCODE -ne 0) {{ $failures.Add('DNS cache flush failed.') }}\nif ($failures.Count -gt 0) {{ throw ($failures -join ' | ') }}";
	}

	private static string SerializeForPowerShell<T>(T value)
	{
		return JsonSerializer.Serialize(value, JsonDefaults.StateOptions).Replace("'", "''", StringComparison.Ordinal);
	}

	private static string ToPowerShellArray(IEnumerable<string> values)
	{
		return "@(" + string.Join(", ", values.Select((string value) => "'" + value + "'")) + ")";
	}
}
