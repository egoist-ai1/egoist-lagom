//#region src/electron/ipc/system-dns.ts
var system_dns_exports = /* @__PURE__ */ __exportAll({
	createWindowsDnsScript: () => createWindowsDnsScript,
	parseDnsServers: () => parseDnsServers,
	resetSystemDnsInterfaces: () => resetSystemDnsInterfaces,
	resetSystemDnsServers: () => resetSystemDnsServers,
	setSystemDnsServers: () => setSystemDnsServers
});
var execFileAsync$8 = promisify(execFile);
var WINDOWS_SCRIPT_TIMEOUT_MS = 2e4;
var dnsApplicationQueue = Promise.resolve();
var CONNECTED_INTERFACE_FILTER = "$adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue; $identity = ([string]$_.InterfaceAlias + ' ' + [string]$adapter.InterfaceDescription); $_.ConnectionState -eq 'Connected' -and $identity -notmatch 'WireGuard|Wintun|Cloudflare\\s+WARP|VPN|Loopback|isatap|Teredo|Pseudo|Npcap|Bluetooth|(^|[\\s_-])(TAP|TUN)([\\s_-]|$)'";
function toPowerShellArray(values) {
	if (values.length === 0) return "@()";
	return `@(${values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ")})`;
}
function toPowerShellBoolean(value) {
	return value ? "$true" : "$false";
}
function toPowerShellIntArray(values) {
	const normalized = [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))];
	return normalized.length > 0 ? `@(${normalized.join(", ")})` : "@()";
}
function createWindowsDnsScript(options) {
	const { reset, servers } = options;
	const savedTargets = options.adapters;
	const targetSelection = savedTargets ? `
$targets = @(${savedTargets.map((adapter) => `[pscustomobject]@{ guid = '${String(adapter.interfaceGuid ?? "").replaceAll("'", "''")}'; index = ${adapter.interfaceIndex} }`).join(", ")})
$connectedInterfaces = @()
foreach ($target in $targets) {
  if (-not $target.guid) { throw 'DNS target has no stable GUID.' }
  $adapter = Get-NetAdapter -ErrorAction Stop | Where-Object { [string]$_.InterfaceGuid -eq $target.guid } | Select-Object -First 1
  if (-not $adapter) { throw "Adapter $($target.guid) is no longer present; DNS was not applied to a reused index." }
  $connectedInterfaces += [pscustomobject]@{ InterfaceIndex = [int]$adapter.ifIndex; InterfaceGuid = [string]$adapter.InterfaceGuid }
}` : `
$connectedInterfaces = @(
  Get-NetIPInterface | Where-Object { ${CONNECTED_INTERFACE_FILTER} } |
    Group-Object InterfaceIndex | ForEach-Object { $_.Group | Sort-Object InterfaceMetric | Select-Object -First 1 }
)
if ($targetIndices.Count -gt 0) {
  $connectedInterfaces = @($connectedInterfaces | Where-Object { $targetIndices -contains [int]$_.InterfaceIndex })
}`;
	return `
$ErrorActionPreference = 'Stop'
$dnsServers = ${toPowerShellArray(servers.servers)}
$ipv4Servers = ${toPowerShellArray(servers.ipv4Servers)}
$ipv6Servers = ${toPowerShellArray(servers.ipv6Servers)}
$resetMode = ${toPowerShellBoolean(reset)}
$targetIndices = ${toPowerShellIntArray(options.interfaceIndices ?? [])}
${targetSelection}
if (-not $connectedInterfaces) { throw 'Не найден активный физический сетевой интерфейс Windows.' }
$appliedCount = 0
$errors = New-Object System.Collections.Generic.List[string]
function Apply-NetshDnsList {
  param(
    [string]$Family,
    [int]$InterfaceIndex,
    [string[]]$Addresses,
    [bool]$ResetToDhcp
  )
  # PowerShell expands only simple variable references inside a bareword
  # argument, so an indexed array reference glued to a prefix would be sent as
  # the whole array followed by a literal index, and a parenthesised expression
  # would not be evaluated at all. Every indexed or computed value must go
  # through a $(...) subexpression, and netsh exit codes must be checked
  # because "& ... | Out-Null" otherwise hides the failure.
  $family = if ($Family -eq 'ipv4') { 'ipv4' } else { 'ipv6' }
  if ($ResetToDhcp) {
    & netsh interface $family set dnsservers name=$InterfaceIndex source=dhcp validate=no | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ("netsh {0} set dnsservers dhcp failed with exit code {1}" -f $family, $LASTEXITCODE) }
    return
  }
  if ($Addresses.Count -eq 0) { return }
  & netsh interface $family set dnsservers name=$InterfaceIndex source=static address=$($Addresses[0]) validate=no | Out-Null
  if ($LASTEXITCODE -ne 0) { throw ("netsh {0} set dnsservers static failed with exit code {1}" -f $family, $LASTEXITCODE) }
  for ($i = 1; $i -lt $Addresses.Count; $i++) {
    & netsh interface $family add dnsservers name=$InterfaceIndex address=$($Addresses[$i]) index=$($i + 1) validate=no | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ("netsh {0} add dnsservers failed with exit code {1}" -f $family, $LASTEXITCODE) }
  }
}
function Test-DnsAddressesApplied {
  param(
    [object[]]$Configs,
    [string[]]$Expected,
    [string]$Family
  )
  if ($Expected.Count -eq 0) { return $true }
  foreach ($config in $Configs) {
    $matchesFamily =
      ($Family -eq 'IPv4' -and ($config.AddressFamily -eq 2 -or $config.AddressFamily -eq 'IPv4')) -or
      ($Family -eq 'IPv6' -and ($config.AddressFamily -eq 23 -or $config.AddressFamily -eq 'IPv6'))
    if (-not $matchesFamily) { continue }
    $configured = @($config.ServerAddresses)
    $allFound = $configured.Count -eq $Expected.Count
    for ($i = 0; $allFound -and $i -lt $Expected.Count; $i++) {
      if (-not ([System.Net.IPAddress]::Parse([string]$configured[$i])).Equals([System.Net.IPAddress]::Parse($Expected[$i]))) {
        $allFound = $false
        break
      }
    }
    if ($allFound) { return $true }
  }
  return $false
}
foreach ($iface in $connectedInterfaces) {
  $ifaceIndex = [int]$iface.InterfaceIndex
  try {
    if ($resetMode) {
      Set-DnsClientServerAddress -InterfaceIndex $ifaceIndex -ResetServerAddresses -ErrorAction Stop | Out-Null
    } else {
      Set-DnsClientServerAddress -InterfaceIndex $ifaceIndex -ServerAddresses $dnsServers -ErrorAction Stop | Out-Null
    }
    $appliedCount++
    continue
  } catch {
    try {
      Apply-NetshDnsList -Family 'ipv4' -InterfaceIndex $ifaceIndex -Addresses $ipv4Servers -ResetToDhcp:$resetMode
      Apply-NetshDnsList -Family 'ipv6' -InterfaceIndex $ifaceIndex -Addresses $ipv6Servers -ResetToDhcp:$resetMode
      $appliedCount++
      continue
    } catch {
      $errors.Add(("Interface #{0}: {1}" -f $ifaceIndex, $_.Exception.Message))
    }
  }
}
if ($errors.Count -gt 0 -or $appliedCount -ne $connectedInterfaces.Count) {
  $details = if ($errors.Count -gt 0) { ' ' + ($errors -join ' | ') } else { '' }
  throw ('DNS не применился ко всем выбранным сетевым интерфейсам.' + $details)
}
$verifyIndices = @($connectedInterfaces | Select-Object -ExpandProperty InterfaceIndex)
$verifyConfigs = @(Get-DnsClientServerAddress -InterfaceIndex $verifyIndices -ErrorAction SilentlyContinue)
if (-not $resetMode) {
  foreach ($verifyIndex in $verifyIndices) {
    $adapterConfigs = @($verifyConfigs | Where-Object { [int]$_.InterfaceIndex -eq [int]$verifyIndex })
    if (-not (Test-DnsAddressesApplied -Configs $adapterConfigs -Expected $ipv4Servers -Family 'IPv4')) {
      throw ("Windows не подтвердила применение IPv4 DNS на интерфейсе #{0}." -f $verifyIndex)
    }
    if (-not (Test-DnsAddressesApplied -Configs $adapterConfigs -Expected $ipv6Servers -Family 'IPv6')) {
      throw ("Windows не подтвердила применение IPv6 DNS на интерфейсе #{0}." -f $verifyIndex)
    }
  }
} else {
  foreach ($verifyIndex in $verifyIndices) {
    $adapter = Get-NetAdapter -InterfaceIndex $verifyIndex -ErrorAction Stop
    if (-not $adapter.InterfaceGuid) { throw "DNS reset readback has no GUID for interface #$verifyIndex." }
    foreach ($protocol in @('Tcpip', 'Tcpip6')) {
      try {
        $value = (Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\$protocol\\Parameters\\Interfaces\\$($adapter.InterfaceGuid)" -ErrorAction Stop).NameServer
        if (-not [string]::IsNullOrWhiteSpace([string]$value)) { throw "Windows did not confirm DHCP DNS on interface #$verifyIndex ($protocol)." }
      } catch { if ($_.CategoryInfo.Category -ne 'ObjectNotFound') { throw } }
    }
  }
}
`.trim();
}
async function flushDnsCache() {
	await execFileAsync$8(resolveWindowsExecutable("ipconfig"), ["/flushdns"], {
		windowsHide: true,
		timeout: 5e3
	});
}
async function runWindowsPowerShell(script) {
	await execFileAsync$8(resolveWindowsExecutable("powershell.exe"), [
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-Command",
		script
	], {
		windowsHide: true,
		timeout: WINDOWS_SCRIPT_TIMEOUT_MS,
		maxBuffer: 4 * 1024 * 1024
	});
}
async function applyWindowsDnsScript(options) {
	await runWindowsPowerShell(createWindowsDnsScript(options));
	await flushDnsCache();
}
/**
* Выполняет изменение DNS внутри durable-транзакции.
*
* Порядок: снимок и intent на диск -> applying -> мутация с проверкой ->
* verified -> commit. При любой ошибке уже изменённые адаптеры возвращаются к
* исходному снимку в обратном порядке, и вызывающий код получает исключение с
* итогом восстановления. Раньше сбой на втором адаптере оставлял систему в
* промежуточной конфигурации без единого способа вернуть её назад (HIGH-03).
*/
async function applyWindowsDnsInTransaction(options) {
	const result = dnsApplicationQueue.then(() => applyWindowsDnsTransactionInternal(options));
	dnsApplicationQueue = result.catch(() => {});
	return result;
}
async function applyWindowsDnsTransactionInternal(options) {
	const handle = await beginDnsTransaction({
		intent: options.intent,
		desiredServers: options.desiredServers,
		interfaceIndices: options.scriptOptions.interfaceIndices
	});
	try {
		await handle.setPhase("applying");
		await applyWindowsDnsScript({ ...options.scriptOptions, adapters: handle.transaction.original });
		await handle.setPhase("verified");
		await handle.commit();
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		const rollback = await handle.rollback(reason).catch((failure) => ({ restored: 0, failures: [failure instanceof Error ? failure.message : String(failure)] }));
		const suffix = rollback.failures.length > 0 ? ` Автоматический откат завершён не полностью: ${rollback.failures.join("; ")}. Журнал транзакции сохранён и будет применён при следующем запуске.` : ` Исходные настройки DNS восстановлены на ${rollback.restored} адаптере(ах).`;
		throw new Error(`${reason}.${suffix}`);
	}
}
async function setSystemDnsServers(rawInput, mock = false) {
	const servers = parseDnsServers(rawInput);
	if (mock || process.platform !== "win32") return {
		ok: true,
		message: `DNS обновлён: ${servers.join(", ")}`,
		servers,
		mocked: true
	};
	await applyWindowsDnsInTransaction({
		intent: "apply",
		desiredServers: servers,
		scriptOptions: {
			reset: false,
			servers: splitDnsServersByFamily(servers)
		}
	});
	return {
		ok: true,
		message: `DNS обновлён: ${servers.join(", ")}`,
		servers
	};
}
async function resetSystemDnsServers(mock = false) {
	if (mock || process.platform !== "win32") return {
		ok: true,
		message: "DNS Windows возвращён к настройкам по умолчанию.",
		servers: [],
		mocked: true
	};
	await applyWindowsDnsInTransaction({
		intent: "reset",
		desiredServers: [],
		scriptOptions: {
			reset: true,
			servers: splitDnsServersByFamily([])
		}
	});
	return {
		ok: true,
		message: "DNS Windows возвращён к настройкам по умолчанию.",
		servers: []
	};
}
/**
* Возвращает к DHCP только перечисленные адаптеры. Watchdog использует этот
* путь, чтобы не затронуть рабочий внешний DNS на другом интерфейсе.
*/
async function resetSystemDnsInterfaces(interfaceIndices, mock = false) {
	const targets = [...new Set(interfaceIndices.filter((value) => Number.isSafeInteger(value) && value > 0))];
	if (targets.length === 0) throw new Error("Не указаны сетевые интерфейсы для восстановления DNS.");
	if (mock || process.platform !== "win32") return {
		ok: true,
		message: `DNS Windows возвращён к DHCP на ${targets.length} адаптере(ах).`,
		servers: [],
		mocked: true
	};
	await applyWindowsDnsInTransaction({
		intent: "reset",
		desiredServers: [],
		scriptOptions: {
			reset: true,
			servers: splitDnsServersByFamily([]),
			interfaceIndices: targets
		}
	});
	return {
		ok: true,
		message: `DNS Windows возвращён к DHCP на ${targets.length} адаптере(ах).`,
		servers: []
	};
}
//#endregion
