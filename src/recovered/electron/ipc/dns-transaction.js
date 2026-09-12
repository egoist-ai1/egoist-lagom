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
  $v4 = Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily IPv4 -ErrorAction SilentlyContinue
  $v6 = Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily IPv6 -ErrorAction SilentlyContinue
  $ipv4Static = $false
  $ipv6Static = $false
  if ($guid) {
    try {
      $v4Reg = (Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\$guid" -Name NameServer -ErrorAction Stop).NameServer
      $ipv4Static = -not [string]::IsNullOrWhiteSpace($v4Reg)
    } catch { $ipv4Static = $false }
    try {
      $v6Reg = (Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters\\Interfaces\\$guid" -Name NameServer -ErrorAction Stop).NameServer
      $ipv6Static = -not [string]::IsNullOrWhiteSpace($v6Reg)
    } catch { $ipv6Static = $false }
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
if ($result.Count -eq 0) {
  $fallbackIfaces = Get-NetIPInterface | Where-Object { $_.ConnectionState -eq 'Connected' } | Group-Object InterfaceIndex | ForEach-Object { $_.Group | Select-Object -First 1 }
  foreach ($iface in $fallbackIfaces) {
    $index = [int]$iface.InterfaceIndex
    $v4 = Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily IPv4 -ErrorAction SilentlyContinue
    $v6 = Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily IPv6 -ErrorAction SilentlyContinue
    $result += [pscustomobject]@{
      interfaceIndex = $index
      interfaceAlias = [string]$iface.InterfaceAlias
      interfaceGuid  = $null
      ipv4           = @($v4.ServerAddresses)
      ipv6           = @($v6.ServerAddresses)
      ipv4Static     = $false
      ipv6Static     = $false
    }
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
function createDnsRestoreScript(snapshot) {
	return `
$ErrorActionPreference = 'Continue'
$targets = @(${[...snapshot].reverse().map((adapter) => {
		return `[pscustomobject]@{ guid = ${adapter.interfaceGuid ? `'${adapter.interfaceGuid.replaceAll("'", "''")}'` : "$null"}; index = ${adapter.interfaceIndex}; ipv4 = ${toPowerShellArray$1(adapter.ipv4)}; ipv6 = ${toPowerShellArray$1(adapter.ipv6)}; ipv4Static = ${adapter.ipv4Static ? "$true" : "$false"}; ipv6Static = ${adapter.ipv6Static ? "$true" : "$false"} }`;
	}).join(", ")})
$restored = 0
$failures = New-Object System.Collections.Generic.List[string]
function Set-FamilyDns {
  param([string]$Family, [int]$Index, [string[]]$Addresses, [bool]$Static)
  if (-not $Static -or $Addresses.Count -eq 0) {
    # Адаптер получал адреса от DHCP: возвращаем именно этот режим, а не
    # статическую копию прежних значений.
    & netsh interface $Family set dnsservers name=$Index source=dhcp validate=no | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ("netsh {0} dhcp restore failed: {1}" -f $Family, $LASTEXITCODE) }
    return
  }
  & netsh interface $Family set dnsservers name=$Index source=static address=$($Addresses[0]) validate=no | Out-Null
  if ($LASTEXITCODE -ne 0) { throw ("netsh {0} static restore failed: {1}" -f $Family, $LASTEXITCODE) }
  for ($i = 1; $i -lt $Addresses.Count; $i++) {
    & netsh interface $Family add dnsservers name=$Index address=$($Addresses[$i]) index=$($i + 1) validate=no | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ("netsh {0} add restore failed: {1}" -f $Family, $LASTEXITCODE) }
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
  }
  try {
    Set-FamilyDns -Family 'ipv4' -Index $index -Addresses $target.ipv4 -Static:$target.ipv4Static
    Set-FamilyDns -Family 'ipv6' -Index $index -Addresses $target.ipv6 -Static:$target.ipv6Static
    $restored++
  } catch {
    $failures.Add(("interface #{0}: {1}" -f $index, $_.Exception.Message))
  }
}
& ipconfig.exe /flushdns | Out-Null
ConvertTo-Json -InputObject ([pscustomobject]@{ restored = $restored; failures = @($failures) }) -Compress -Depth 3
`.trim();
}
async function restoreAdapterDnsSnapshot(snapshot) {
	if (snapshot.length === 0) return {
		restored: 0,
		failures: []
	};
	const stdout = await runPowerShell(createDnsRestoreScript(snapshot));
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
	if (!target) return;
	await fs$1.mkdir(path.dirname(target), { recursive: true });
	const tempPath = `${target}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await fs$1.writeFile(tempPath, `${JSON.stringify(transaction, null, 2)}\n`, "utf8");
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
		if (parsed.owner !== "EgoistShield" || parsed.resource !== "dns" || !Array.isArray(parsed.original)) return null;
		return parsed;
	} catch {
		return null;
	}
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
	const original = await readAdapterDnsSnapshot();
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
			transaction.phase = "committed";
			transaction.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
			await removeTransaction();
			logger.info(`[dns-transaction] committed ${transaction.transactionId}`);
		},
		async rollback(reason) {
			await handle.setPhase("rollingBack", reason);
			logger.warn(`[dns-transaction] rolling back ${transaction.transactionId}: ${reason}`);
			const result = await restoreAdapterDnsSnapshot(transaction.original);
			if (result.failures.length > 0) {
				await handle.setPhase("rollingBack", `${reason}; restore failures: ${result.failures.join("; ")}`);
				logger.error(`[dns-transaction] rollback incomplete: ${result.failures.join("; ")}`);
				return result;
			}
			await handle.setPhase("rolledBack", reason);
			await removeTransaction();
			logger.info(`[dns-transaction] rolled back ${transaction.transactionId} on ${result.restored} adapter(s)`);
			return result;
		}
	};
	return handle;
}
/**
* Завершает транзакцию, прерванную падением процесса или потерей питания.
*
* Вызывается при старте приложения до появления UI и при удалении. Любая
* незавершённая фаза означает, что Windows может остаться в промежуточной
* конфигурации, поэтому применяется исходный снимок.
*/
async function recoverDnsTransaction() {
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
	const result = await restoreAdapterDnsSnapshot(transaction.original);
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
