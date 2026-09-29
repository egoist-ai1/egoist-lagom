//#region src/electron/ipc/dns-transaction.ts
/**
* Durable-транзакция изменения DNS Windows (HIGH-03).
*
* ЧТО БЫЛО НЕ ТАК
*
* Снимок для откложа жил только внутри результата одного IPC-вызова. Он не
* хранился на диске, не применялся автоматически при частичном сбое, не
* переживал падение процесса или потерю питания и не использовался при
* удалении приложения. Если DNS первого адаптера изменился, а второй адаптер
* или запись состояния упали, Windows оставался в промежуточной конфигурации —
* то есть у пользователя мог перестать работать интернет.
*
* МОДЕЛЬ
*
*   prepared -> applying -> verified -> committed
*                    \-> rollingBack -> rolledBack
*
* Журнал в `%ProgramData%\EgoistShield\transactions` пишется атомарно (temp +
* rename) ДО первой мутации. Любой последующий запуск приложения видит
* незавершённую транзакцию и завершает откат.
*
* Адаптеры опознаются по InterfaceGuid, а не по InterfaceIndex: индекс не
* стабилен между перезагрузками и после переустановки драйвера, поэтому
* восстановление по индексу могло применить настройки к ЧУЖОМУ адаптеру.
*/
var execFileAsync$9 = promisify(execFile);
var SCRIPT_TIMEOUT_MS = 25e3;
var TRANSACTION_FILE_NAME = "dns-transaction.json";
/**
* Фильтр активных uplink-интерфейсов; совпадает с system-dns.ts и Core.
* Hyper-V/virtual намеренно не исключаются: внутри VM это единственный
* легитимный uplink. Исключаются только явные VPN/tunnel/loopback adapters.
*/
var CONNECTED_INTERFACE_FILTER$1 = "$adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue; $identity = ([string]$_.InterfaceAlias + ' ' + [string]$adapter.InterfaceDescription); $_.ConnectionState -eq 'Connected' -and $identity -notmatch 'WireGuard|Wintun|Cloudflare\\s+WARP|VPN|Loopback|isatap|Teredo|Pseudo|Npcap|Bluetooth|(^|[\\s_-])(TAP|TUN)([\\s_-]|$)'";
var transactionDirectory = null;
var appVersion = "unknown";
var activeDnsTransaction = false;
/**
* Задаёт каталог журнала транзакций.
*
* Основное расположение — ProgramData: оно переживает удаление профиля и
* доступно установщику. userData используется как резерв, если ProgramData
* недоступен (нестандартная система, запуск без прав).
*/
function configureDnsTransactionStore(options) {
	const base = options.programDataDir?.trim() ? path.join(options.programDataDir, "EgoistShield", "transactions") : path.join(options.userDataDir, "transactions");
	transactionDirectory = process.env.EGOISTSHIELD_DNS_TRANSACTION_DIR?.trim() || base;
	if (options.version) appVersion = options.version;
}
function transactionPath() {
	if (!transactionDirectory) return null;
	return path.join(transactionDirectory, TRANSACTION_FILE_NAME);
}
async function runPowerShell(script) {
	const { stdout } = await execFileAsync$9(resolveWindowsExecutable("powershell.exe"), [
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-Command",
		script
	], {
		windowsHide: true,
		timeout: SCRIPT_TIMEOUT_MS,
		maxBuffer: 4 * 1024 * 1024
	});
	return stdout;
}
function toPowerShellArray$1(values) {
	if (values.length === 0) return "@()";
	return `@(${values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ")})`;
}
/**
* Скрипт чтения per-adapter снимка DNS.
*
* Статичность определяется по реестру: непустой `NameServer` в
* Tcpip/Tcpip6 Parameters\Interfaces\{GUID} означает заданные вручную адреса,
* пустой — адреса от DHCP. Без этого различения восстановление превратило бы
* DHCP-адаптер в статический и заморозило бы устаревшие адреса.
*/
function createSnapshotScript() {
	return `
$ErrorActionPreference = 'Stop'
$interfaces =
  Get-NetIPInterface | Where-Object { ${CONNECTED_INTERFACE_FILTER$1} } |
    Group-Object InterfaceIndex | ForEach-Object { $_.Group | Sort-Object InterfaceMetric | Select-Object -First 1 }
$result = @()
foreach ($iface in $interfaces) {
  $index = [int]$iface.InterfaceIndex
  $adapter = Get-NetAdapter -InterfaceIndex $index -ErrorAction SilentlyContinue
  $guid = if ($adapter) { [string]$adapter.InterfaceGuid } else { $null }
  if (-not $guid) { throw "Interface #$index has no stable GUID; DNS was not changed." }
  $v4 = Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily IPv4 -ErrorAction Stop
  $v6 = Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily IPv6 -ErrorAction Stop
  $ipv4Static = $false
  $ipv6Static = $false
  if ($guid) {
    try {
      $v4Reg = (Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\$guid" -ErrorAction Stop).NameServer
      $ipv4Static = -not [string]::IsNullOrWhiteSpace($v4Reg)
    } catch { if ($_.CategoryInfo.Category -ne 'ObjectNotFound') { throw }; $ipv4Static = $false }
    try {
      $v6Reg = (Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters\\Interfaces\\$guid" -ErrorAction Stop).NameServer
      $ipv6Static = -not [string]::IsNullOrWhiteSpace($v6Reg)
    } catch { if ($_.CategoryInfo.Category -ne 'ObjectNotFound') { throw }; $ipv6Static = $false }
  }
  $result += [pscustomobject]@{
    interfaceIndex = $index
    interfaceAlias = [string]$iface.InterfaceAlias
    interfaceGuid  = $guid
    ipv4           = @($v4.ServerAddresses)
    ipv6           = @($v6.ServerAddresses)
    ipv4Static     = $ipv4Static
    ipv6Static     = $ipv6Static
  }
}
ConvertTo-Json -InputObject @($result) -Compress -Depth 5
`.trim();
}
function normalizeAddresses(value) {
	if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return [];
}
async function readAdapterDnsSnapshot() {
	const stdout = await runPowerShell(createSnapshotScript());
	const parsed = JSON.parse(stdout || "[]");
	return (Array.isArray(parsed) ? parsed : [parsed]).filter((row) => Boolean(row) && typeof row === "object").map((row) => ({
		interfaceIndex: Number(row.interfaceIndex) || 0,
		interfaceAlias: String(row.interfaceAlias ?? ""),
		interfaceGuid: typeof row.interfaceGuid === "string" && row.interfaceGuid ? row.interfaceGuid : null,
		ipv4: normalizeAddresses(row.ipv4),
		ipv6: normalizeAddresses(row.ipv6),
		ipv4Static: row.ipv4Static === true,
		ipv6Static: row.ipv6Static === true
	})).filter((row) => row.interfaceIndex > 0);
}
/**
* Скрипт восстановления снимка.
*
* Адаптеры обходятся в ОБРАТНОМ порядке применения: последний изменённый
* возвращается первым, поэтому промежуточное состояние живёт минимально
* короткое время. Адаптер ищется по GUID; индекс используется только как
* резерв, если GUID не сохранился.
*/
function createDnsRestoreScript(snapshot, ownership = null) {
	const desired = ownership?.desiredServers ?? [];
	return `
$ErrorActionPreference = 'Continue'
$targets = @(${[...snapshot].reverse().map((adapter) => {
		return `[pscustomobject]@{ guid = ${adapter.interfaceGuid ? `'${adapter.interfaceGuid.replaceAll("'", "''")}'` : "$null"}; alias = '${String(adapter.interfaceAlias ?? "").replaceAll("'", "''")}'; index = ${adapter.interfaceIndex}; ipv4 = ${toPowerShellArray$1(adapter.ipv4)}; ipv6 = ${toPowerShellArray$1(adapter.ipv6)}; ipv4Static = ${adapter.ipv4Static ? "$true" : "$false"}; ipv6Static = ${adapter.ipv6Static ? "$true" : "$false"} }`;
	}).join(", ")})
$checkOwnership = ${ownership ? "$true" : "$false"}
$intent = '${ownership?.intent === "reset" ? "reset" : "apply"}'
$desiredV4 = ${toPowerShellArray$1(desired.filter((value) => !value.includes(":")))}
$desiredV6 = ${toPowerShellArray$1(desired.filter((value) => value.includes(":")))}
$restored = 0
$failures = New-Object System.Collections.Generic.List[string]
function Read-FamilyState {
  param([string]$Family, [int]$Index, [string]$Guid)
  $addressFamily = if ($Family -eq 'ipv4') { 'IPv4' } else { 'IPv6' }
  $protocol = if ($Family -eq 'ipv4') { 'Tcpip' } else { 'Tcpip6' }
  $config = Get-DnsClientServerAddress -InterfaceIndex $Index -AddressFamily $addressFamily -ErrorAction Stop
  $static = $false
  try {
    $value = (Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\$protocol\\Parameters\\Interfaces\\$Guid" -ErrorAction Stop).NameServer
    $static = -not [string]::IsNullOrWhiteSpace([string]$value)
  } catch { if ($_.CategoryInfo.Category -ne 'ObjectNotFound') { throw } }
  return [pscustomobject]@{ addresses = @($config.ServerAddresses); static = $static }
}
function Test-AddressList {
  param([string[]]$Actual, [string[]]$Expected, [bool]$AllowPrefix = $false)
  if ($Actual.Count -ne $Expected.Count -and -not $AllowPrefix) { return $false }
  if ($AllowPrefix -and ($Actual.Count -eq 0 -or $Actual.Count -gt $Expected.Count)) { return $false }
  for ($i = 0; $i -lt $Actual.Count; $i++) {
    if (-not ([System.Net.IPAddress]::Parse($Actual[$i])).Equals([System.Net.IPAddress]::Parse($Expected[$i]))) { return $false }
  }
  return $true
}
function Set-FamilyDns {
  param([string]$Family, [int]$Index, [string]$Guid, [string[]]$Addresses, [bool]$Static)
  if ($checkOwnership) {
    $current = Read-FamilyState -Family $Family -Index $Index -Guid $Guid
    $isOriginal = $current.static -eq $Static -and (-not $Static -or (Test-AddressList $current.addresses $Addresses))
    if ($isOriginal) { return }
    $expected = if ($Family -eq 'ipv4') { $desiredV4 } else { $desiredV6 }
    $isOwned = if ($intent -eq 'reset') { -not $current.static } else { $current.static -and (Test-AddressList $current.addresses $expected $true) }
    if (-not $isOwned) { throw "DNS $Family on interface #$Index changed outside this transaction; preserved." }
  }
  if (-not $Static -or $Addresses.Count -eq 0) {
    # Адаптер получал адреса от DHCP: возвращаем именно этот режим, а не
    # статическую копию прежних значений.
    & netsh interface $Family set dnsservers name=$Index source=dhcp validate=no | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ("netsh {0} dhcp restore failed: {1}" -f $Family, $LASTEXITCODE) }
  } else {
    & netsh interface $Family set dnsservers name=$Index source=static address=$($Addresses[0]) validate=no | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ("netsh {0} static restore failed: {1}" -f $Family, $LASTEXITCODE) }
    for ($i = 1; $i -lt $Addresses.Count; $i++) {
      & netsh interface $Family add dnsservers name=$Index address=$($Addresses[$i]) index=$($i + 1) validate=no | Out-Null
      if ($LASTEXITCODE -ne 0) { throw ("netsh {0} add restore failed: {1}" -f $Family, $LASTEXITCODE) }
    }
  }
  if ($checkOwnership) {
    $actual = Read-FamilyState -Family $Family -Index $Index -Guid $Guid
    if ($actual.static -ne $Static -or ($Static -and -not (Test-AddressList $actual.addresses $Addresses))) { throw "DNS $Family restore readback failed on interface #$Index." }
  }
}
foreach ($target in $targets) {
  $index = $target.index
  if ($target.guid) {
    $adapter = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { [string]$_.InterfaceGuid -eq $target.guid } | Select-Object -First 1
    if ($adapter) { $index = [int]$adapter.ifIndex }
    else {
      # Адаптера больше нет: применять его настройки к другому индексу нельзя.
      $failures.Add(("adapter {0} is gone; skipped" -f $target.guid))
      continue
    }
  } else {
    $adapter = Get-NetAdapter -InterfaceIndex $index -ErrorAction SilentlyContinue
    if (-not $adapter -or -not $target.alias -or [string]$adapter.Name -ne $target.alias) {
      $failures.Add(("interface #{0} has no matching stable identity; skipped" -f $index))
      continue
    }
  }
  $adapterRestored = $true
  foreach ($family in @('ipv4', 'ipv6')) {
    try {
      $staticKey = $family + 'Static'
      Set-FamilyDns -Family $family -Index $index -Guid $target.guid -Addresses $target.$family -Static:$target.$staticKey
    } catch {
      $adapterRestored = $false
      $failures.Add(("interface #{0}: {1}" -f $index, $_.Exception.Message))
    }
  }
  if ($adapterRestored) { $restored++ }
}
& ipconfig.exe /flushdns | Out-Null
ConvertTo-Json -InputObject ([pscustomobject]@{ restored = $restored; failures = @($failures) }) -Compress -Depth 3
`.trim();
}
async function restoreAdapterDnsSnapshot(snapshot, ownership = null) {
	if (snapshot.length === 0) return {
		restored: 0,
		failures: []
	};
	const stdout = await runPowerShell(createDnsRestoreScript(snapshot, ownership));
	try {
		const parsed = JSON.parse(stdout || "{}");
		return {
			restored: Number(parsed.restored) || 0,
			failures: normalizeAddresses(parsed.failures)
		};
	} catch {
		return {
			restored: 0,
			failures: ["не удалось разобрать результат восстановления"]
		};
	}
}
async function writeTransaction(transaction) {
	const target = transactionPath();
	if (!target) throw new Error("Хранилище транзакций DNS не настроено; DNS не изменён.");
	await fs$1.mkdir(path.dirname(target), { recursive: true });
	const tempPath = `${target}.${process.pid}.${randomUUID()}.tmp`;
	try {
		const handle = await fs$1.open(tempPath, "wx");
		try {
			await handle.writeFile(`${JSON.stringify(transaction, null, 2)}\n`, "utf8");
			await handle.sync();
		} finally { await handle.close(); }
		await fs$1.rename(tempPath, target);
	} catch (error) {
		await fs$1.rm(tempPath, { force: true }).catch(() => void 0);
		throw error;
	}
}
async function readDnsTransaction() {
	const target = transactionPath();
	if (!target) return null;
	try {
		const parsed = JSON.parse(await fs$1.readFile(target, "utf8"));
		if (!isValidDnsTransaction(parsed)) throw new Error("Некорректный журнал DNS");
		return parsed;
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw new Error("Не удалось прочитать журнал DNS. Новое изменение заблокировано до восстановления журнала.", { cause: error });
	}
}
function isValidDnsTransaction(value) {
	const validAddresses = (addresses) => Array.isArray(addresses) && addresses.every((server) => typeof server === "string" && isIP(server) !== 0);
	if (!value || value.schemaVersion !== 1 || value.owner !== "EgoistShield" || value.resource !== "dns") return false;
	if (!["prepared", "applying", "verified", "committed", "rollingBack", "rolledBack"].includes(value.phase) || !["apply", "reset"].includes(value.intent)) return false;
	if (!validAddresses(value.desiredServers) || !Array.isArray(value.original) || value.original.length === 0) return false;
	if (value.intent === "apply" && (value.desiredServers.length === 0 || value.desiredServers.length > 6) || value.intent === "reset" && value.desiredServers.length !== 0) return false;
	return value.original.every((adapter) => adapter && Number.isSafeInteger(adapter.interfaceIndex) && adapter.interfaceIndex > 0 &&
		(typeof adapter.interfaceGuid === "string" && adapter.interfaceGuid.length > 0 || adapter.interfaceGuid === null && typeof adapter.interfaceAlias === "string" && adapter.interfaceAlias.length > 0) &&
		validAddresses(adapter.ipv4) && validAddresses(adapter.ipv6) && typeof adapter.ipv4Static === "boolean" && typeof adapter.ipv6Static === "boolean");
}
async function removeTransaction() {
	const target = transactionPath();
	if (target) await fs$1.rm(target, { force: true }).catch(() => void 0);
}
/**
* Начинает транзакцию: снимает снимок и записывает intent ДО первой мутации.
*
* Если снимок снять не удалось, транзакция не начинается вовсе: менять DNS без
* возможности вернуть исходное состояние недопустимо.
*/
async function beginDnsTransaction(options) {
	if (activeDnsTransaction) throw new Error("Изменение DNS уже выполняется.");
	activeDnsTransaction = true;
	try {
		const pending = await readDnsTransaction();
		if (pending && pending.phase !== "committed") throw new Error("Сначала завершите восстановление предыдущей транзакции DNS.");
		const targets = options.interfaceIndices ?? [];
		const original = (await readAdapterDnsSnapshot()).filter((adapter) => targets.length === 0 || targets.includes(adapter.interfaceIndex));
		if (original.length === 0 || original.some((adapter) => !adapter.interfaceGuid)) throw new Error("Не найден активный сетевой адаптер со стабильным GUID; DNS не изменён.");
		const transaction = {
			schemaVersion: 1,
			owner: "EgoistShield",
			transactionId: randomUUID(),
			resource: "dns",
			phase: "prepared",
			intent: options.intent,
			desiredServers: [...options.desiredServers],
			original,
			appVersion,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			lastError: null
		};
		if (!isValidDnsTransaction(transaction)) throw new Error("Некорректные параметры транзакции DNS; DNS не изменён.");
		await writeTransaction(transaction);
		logger.info(`[dns-transaction] prepared ${transaction.transactionId} for ${original.length} adapter(s), intent=${options.intent}`);
		const handle = {
			transaction,
			async setPhase(phase, error = null) {
				transaction.phase = phase;
				transaction.lastError = error;
				transaction.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
				await writeTransaction(transaction);
			},
			async commit() {
				try {
					transaction.phase = "committed";
					transaction.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
					await writeTransaction(transaction);
					await removeTransaction();
					logger.info(`[dns-transaction] committed ${transaction.transactionId}`);
				} finally { activeDnsTransaction = false; }
			},
			async rollback(reason) {
				try {
					await handle.setPhase("rollingBack", reason).catch((error) => logger.error(`[dns-transaction] rollback marker write failed: ${error.message}`));
					logger.warn(`[dns-transaction] rolling back ${transaction.transactionId}: ${reason}`);
					const result = await restoreAdapterDnsSnapshot(transaction.original, transaction);
					if (result.failures.length > 0) {
						await handle.setPhase("rollingBack", `${reason}; restore failures: ${result.failures.join("; ")}`);
						logger.error(`[dns-transaction] rollback incomplete: ${result.failures.join("; ")}`);
						return result;
					}
					await handle.setPhase("rolledBack", reason);
					await removeTransaction();
					logger.info(`[dns-transaction] rolled back ${transaction.transactionId} on ${result.restored} adapter(s)`);
					return result;
				} finally { activeDnsTransaction = false; }
			}
		};
		return handle;
	} catch (error) { activeDnsTransaction = false; throw error; }
}
/**
* Завершает транзакцию, прерванную падением процесса или потерей питания.
*
* Вызывается при старте приложения до появления UI и при удалении. Любая
* незавершённая фаза означает, что Windows может остаться в промежуточной
* конфигурации, поэтому применяется исходный снимок.
*/
async function recoverDnsTransaction() {
	if (activeDnsTransaction) throw new Error("Текущая транзакция DNS ещё выполняется; восстановление отложено.");
	activeDnsTransaction = true;
	try { return await recoverDnsTransactionInternal(); }
	finally { activeDnsTransaction = false; }
}
async function recoverDnsTransactionInternal() {
	const transaction = await readDnsTransaction();
	if (!transaction) return {
		found: false,
		phase: null,
		restored: 0,
		failures: []
	};
	if (transaction.phase === "committed") {
		await removeTransaction();
		return {
			found: true,
			phase: "committed",
			restored: 0,
			failures: []
		};
	}
	if (process.platform !== "win32") {
		await removeTransaction();
		return {
			found: true,
			phase: transaction.phase,
			restored: 0,
			failures: []
		};
	}
	logger.warn(`[dns-transaction] found an unfinished transaction ${transaction.transactionId} in phase ${transaction.phase}; restoring the original DNS snapshot.`);
	const result = await restoreAdapterDnsSnapshot(transaction.original, transaction);
	if (result.failures.length === 0) await removeTransaction();
	else logger.error(`[dns-transaction] recovery incomplete: ${result.failures.join("; ")}`);
	return {
		found: true,
		phase: transaction.phase,
		restored: result.restored,
		failures: result.failures
	};
}
//#endregion
