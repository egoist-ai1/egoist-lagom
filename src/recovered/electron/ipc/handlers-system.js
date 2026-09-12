//#region src/electron/ipc/handlers-system.ts
/**
* System/App IPC Handlers — state:get, state:set, system:geoip, app:is-first-run,
* app:mark-first-run-done, app:is-admin, runtime:install-*, system:pick-file,
* system:list-processes, system:get-app-icon, system:read-clipboard,
* system:internet-fix, window:minimize, window:close
*/
var execFileAsync$6 = promisify(execFile);
var coreServiceClient = new CoreServiceClient();
async function coordinateShieldAction(action, operation, { manager, vpn, supervisor }) {
	const coordinate = (intent, callback) => manager ? manager.runCoordinatedMutation(intent, callback) : callback();
	return coordinate({
		module: "shield",
		action,
		requiredLocks: ["traffic-route", "zapret-suspend", "packet-interception", "windivert", "dns", "dns-verify", "telegram-proxy"],
		conflictsWith: []
	}, async () => {
		if (action === "connect") {
			supervisor?.cancel();
			const before = await vpn.status();
			if (before?.connected || before?.running || before?.pid) {
				const result = await vpn.disconnect();
				if (result?.ok === false) throw new Error(result.message || "Не удалось отключить VPN.");
				const after = await vpn.status();
				if (after?.connected || after?.running || after?.pid) throw new Error("VPN ещё работает. Дождитесь отключения.");
			}
		}
		return operation();
	});
}

/**
* Три сервиса, которые в РФ первыми упираются в региональные ограничения.
* Проверка идёт в два шага: резолв имени через текущий DNS и TCP-рукопожатие с
* полученным адресом. Только связка «имя разрешилось И соединение установлено»
* доказывает, что доступ реально есть, а не просто отвечает резолвер.
*/
var DNS_DIAGNOSTIC_TARGETS = [
	{
		label: "OpenAI",
		host: "api.openai.com"
	},
	{
		label: "Claude",
		host: "api.anthropic.com"
	},
	{
		label: "Gemini",
		host: "gemini.google.com"
	}
];
var DNS_CONTROLLER_ADAPTER_CACHE_TTL_MS = 1e4;
var CURRENT_DNS_SERVERS_CACHE_TTL_MS = 5e3;
/**
* Таймаут чтения DNS. 2,5 с не укладывались в реальную длительность операции на
* холодной системе, поэтому промах был запрограммирован (HIGH-06). Значение
* взято с запасом к наблюдавшемуся p95.
*/
var CURRENT_DNS_SERVERS_TIMEOUT_MS = 9e3;
/**
* Создание rollback-снимка загружает модуль DnsClient в отдельном Windows
* PowerShell 5.1. На холодной Windows Sandbox наблюдалось более 3 секунд только
* на инициализацию модуля, поэтому прежний предел гарантированно срывал
* безопасное включение/отключение DoH. Мутация по-прежнему не начинается без
* снимка, но чтению даётся отдельный ограниченный бюджет.
*/
var DNS_MUTATION_SNAPSHOT_TIMEOUT_MS = 15e3;
/** Экспоненциальный backoff после промаха: 5, 15, 30, 60 секунд. */
var CURRENT_DNS_SERVERS_BACKOFF_STEPS_MS = [
	5e3,
	15e3,
	3e4,
	6e4
];
var dnsControllerAdapterCache = null;
var currentDnsServersCache = null;
/** Единственный запрос в полёте: параллельные вызовы ждут его результат. */
var currentDnsServersInFlight = null;
var dnsServersFailureStreak = 0;
var dnsServersBackoffUntil = 0;
var dnsServersSuppressedErrors = 0;
var COUNTRY_RU = {
	Germany: "Германия",
	"United States": "США",
	Netherlands: "Нидерланды",
	France: "Франция",
	Finland: "Финляндия",
	Poland: "Польша",
	"United Kingdom": "Великобритания",
	Russia: "Россия"
};
var GRAVITYLESS_DNS_COUNTRY = {
	country: "Германия",
	countryCode: "de",
	source: "gravityless-baseline"
};
var KNOWN_DNS_COUNTRY_HOSTS = {
	"dns.gravityless.space": {
		country: "Германия",
		countryCode: "de",
		source: "known-dns-host"
	},
	"us.aeternia.space": {
		country: "США",
		countryCode: "us",
		source: "known-dns-host"
	}
};
var DNS_COUNTRY_LABELS = {
	de: {
		country: "Германия",
		countryCode: "de",
		source: "dns-host-label"
	},
	fr: {
		country: "Франция",
		countryCode: "fr",
		source: "dns-host-label"
	},
	nl: {
		country: "Нидерланды",
		countryCode: "nl",
		source: "dns-host-label"
	},
	pl: {
		country: "Польша",
		countryCode: "pl",
		source: "dns-host-label"
	},
	uk: {
		country: "Великобритания",
		countryCode: "gb",
		source: "dns-host-label"
	},
	us: {
		country: "США",
		countryCode: "us",
		source: "dns-host-label"
	}
};
async function setSystemDnsThroughCurrentOwner(rawInput, mock, probeHosts = []) {
	if (mock || process.platform !== "win32") return setSystemDnsServers(rawInput, mock);
	const servers = SystemDnsServersInputSchema.parse(rawInput).split(/[,\s;]+/).map((value) => value.trim()).filter(Boolean);
	try {
		const result = await coreServiceClient.applyDns(servers, { probeHosts: [...probeHosts] });
		return {
			ok: true,
			message: `DNS обновлён через EgoistShieldCore: ${result.servers.join(", ")}`,
			servers: result.servers
		};
	} catch (error) {
		if (error instanceof CoreServiceUnavailableError && !app.isPackaged) {
			logger.debug("[core-service] DNS apply uses direct dev fallback:", error.message);
			return setSystemDnsServers(rawInput, false);
		}
		throw error;
	}
}
async function resetSystemDnsThroughCurrentOwner(mock) {
	if (mock || process.platform !== "win32") return resetSystemDnsServers(mock);
	try {
		await coreServiceClient.resetDns();
		return {
			ok: true,
			message: "DNS Windows возвращён к настройкам по умолчанию через EgoistShieldCore.",
			servers: []
		};
	} catch (error) {
		if (error instanceof CoreServiceUnavailableError && !app.isPackaged) {
			logger.debug("[core-service] DNS reset uses direct dev fallback:", error.message);
			return resetSystemDnsServers(false);
		}
		throw error;
	}
}
function createMockSystemDohStatus(options) {
	const running = options.running ?? false;
	const preferredLocalAddress = typeof options.localAddress === "string" ? options.localAddress.trim() : "";
	const localAddress = running ? preferredLocalAddress || "1.1.1.1" : null;
	return {
		available: true,
		running,
		verified: running,
		encrypted: running,
		nativeManaged: true,
		pid: null,
		startedAt: running ? (/* @__PURE__ */ new Date()).toISOString() : null,
		runtimePath: null,
		configPath: "windows://dnsclient/doh",
		logPath: null,
		serviceName: "Dnscache",
		serviceInstalled: false,
		serviceRunning: false,
		serviceState: running ? "native" : "not-installed",
		serviceWrapperPath: null,
		localAddress,
		localPort: 443,
		currentUrl: running ? options.url?.trim() || null : null,
		serverAddresses: localAddress ? [localAddress] : [],
		fallbackToUdp: false,
		lastError: options.lastError ?? null,
		mocked: true
	};
}
function resolveDnsControllerMode(state) {
	if (state.settings.systemDohEnabled) return "system-doh";
	const servers = String(state.settings.systemDnsServers ?? "").trim();
	if (isGravitylessLoopbackDnsRequest(servers)) return "gravityless-dns";
	if (servers) return "manual-dns";
	return "system-default";
}
async function readDnsControllerAdapters() {
	if (process.platform !== "win32") return [];
	const now = Date.now();
	if (dnsControllerAdapterCache && dnsControllerAdapterCache.expiresAt > now) return dnsControllerAdapterCache.value;
	try {
		const { stdout } = await execFileAsync$6(resolveWindowsExecutable("powershell.exe"), [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			"Get-NetAdapter | Select-Object Name, InterfaceDescription, Status, InterfaceIndex | ConvertTo-Json -Compress"
		], {
			timeout: 8e3,
			maxBuffer: 1024 * 1024,
			windowsHide: true
		});
		const parsed = JSON.parse(stdout || "[]");
		const adapters = (Array.isArray(parsed) ? parsed : [parsed]).filter((row) => row && typeof row.Name === "string").map((row) => ({
			name: row.Name,
			description: typeof row.InterfaceDescription === "string" ? row.InterfaceDescription : null,
			status: typeof row.Status === "string" ? row.Status : null,
			interfaceIndex: typeof row.InterfaceIndex === "number" ? row.InterfaceIndex : null
		}));
		dnsControllerAdapterCache = {
			value: adapters,
			expiresAt: Date.now() + DNS_CONTROLLER_ADAPTER_CACHE_TTL_MS
		};
		return adapters;
	} catch (error) {
		logger.debug("[dns-controller] Adapter report failed:", error);
		return dnsControllerAdapterCache?.value ?? [];
	}
}
/**
* Читает фактические DNS-серверы активных адаптеров.
*
* ЧТО БЫЛО НЕ ТАК (HIGH-06)
*
* На чистой VM эта операция 62 раза превысила 2,5-секундный таймаут, а фоновый
* опрос повторял её каждые три секунды. Каждый промах порождал новый процесс
* PowerShell, stack trace в журнале и задержку интерфейса — при том что
* результат всё равно не появлялся.
*
* Что изменено:
*  * таймаут поднят до 9 с (реальная длительность операции на холодной системе
*    превышала 2,5 с сама по себе, то есть промах был запрограммирован);
*  * single-flight: одновременно выполняется не больше одного запроса, а
*    параллельные вызовы ждут его результат;
*  * отрицательный кэш с экспоненциальным backoff 5/15/30/60 с — после промаха
*    опрос не повторяется на каждом тике;
*  * повторяющаяся ошибка агрегируется в одну запись со счётчиком вместо
*    лог-спама.
*/
async function readCurrentDnsServers() {
	if (process.platform !== "win32") return uniqueStrings(dns.getServers());
	const now = Date.now();
	if (currentDnsServersCache && currentDnsServersCache.expiresAt > now) return currentDnsServersCache.value;
	if (dnsServersBackoffUntil > now) return currentDnsServersCache?.value ?? uniqueStrings(dns.getServers());
	if (currentDnsServersInFlight) return currentDnsServersInFlight;
	currentDnsServersInFlight = (async () => {
		try {
			const script = [
				"$up = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | Select-Object -ExpandProperty InterfaceIndex",
				"$rows = Get-DnsClientServerAddress -AddressFamily IPv4,IPv6 -ErrorAction SilentlyContinue | Where-Object { $up -contains $_.InterfaceIndex -and $_.ServerAddresses }",
				"$rows | Select-Object InterfaceAlias,InterfaceIndex,AddressFamily,ServerAddresses | ConvertTo-Json -Compress -Depth 4"
			].join("; ");
			const { stdout } = await execFileAsync$6(resolveWindowsExecutable("powershell.exe"), [
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				script
			], {
				timeout: CURRENT_DNS_SERVERS_TIMEOUT_MS,
				maxBuffer: 1024 * 1024,
				windowsHide: true
			});
			const parsed = JSON.parse(stdout || "[]");
			const unique = uniqueStrings((Array.isArray(parsed) ? parsed : [parsed]).flatMap((row) => normalizeStringArray(row?.ServerAddresses)));
			const value = unique.length > 0 ? unique : uniqueStrings(dns.getServers());
			currentDnsServersCache = {
				value,
				expiresAt: Date.now() + CURRENT_DNS_SERVERS_CACHE_TTL_MS
			};
			dnsServersFailureStreak = 0;
			dnsServersBackoffUntil = 0;
			if (dnsServersSuppressedErrors > 0) {
				logger.info(`[dns-diagnostics] Current DNS server read recovered after ${dnsServersSuppressedErrors} suppressed failure(s).`);
				dnsServersSuppressedErrors = 0;
			}
			return value;
		} catch (error) {
			dnsServersFailureStreak += 1;
			const backoffMs = CURRENT_DNS_SERVERS_BACKOFF_STEPS_MS[Math.min(dnsServersFailureStreak - 1, CURRENT_DNS_SERVERS_BACKOFF_STEPS_MS.length - 1)];
			dnsServersBackoffUntil = Date.now() + backoffMs;
			if (dnsServersFailureStreak === 1) logger.warn(`[dns-diagnostics] Current DNS server read failed; retrying in ${Math.round(backoffMs / 1e3)}s.`, error);
			else dnsServersSuppressedErrors += 1;
			return currentDnsServersCache?.value ?? uniqueStrings(dns.getServers());
		} finally {
			currentDnsServersInFlight = null;
		}
	})();
	return currentDnsServersInFlight;
}
/**
* Читает конфигурацию WinHTTP-прокси, НЕ изменяя её.
*
* Приложение никогда не задаёт WinHTTP-прокси, поэтому любая найденная
* настройка принадлежит другому продукту или политике домена. Раньше здесь
* безусловно выполнялся `netsh winhttp reset proxy`, что ломало корпоративную
* конфигурацию (HIGH-10). Теперь значение только читается для отчёта.
*/
async function readWinHttpProxy() {
	if (process.platform !== "win32") return {
		hasProxy: false,
		summary: "недоступно вне Windows"
	};
	try {
		const { stdout } = await execFileAsync$6(resolveWindowsExecutable("netsh.exe"), [
			"winhttp",
			"show",
			"proxy"
		], {
			windowsHide: true,
			timeout: 8e3
		});
		const text = stdout.replace(/\s+/g, " ").trim();
		const proxyMatch = /(?:^|\s)([\w.-]+:\d{1,5})(?:\s|$)/.exec(text);
		if (proxyMatch) return {
			hasProxy: true,
			summary: proxyMatch[1]
		};
		return {
			hasProxy: false,
			summary: text.slice(0, 160) || "не настроен"
		};
	} catch (error) {
		logger.debug("[internet-repair] WinHTTP proxy read failed:", error);
		return {
			hasProxy: false,
			summary: "не удалось прочитать"
		};
	}
}
/**
* Пост-проверка восстановления интернета.
*
* «Команда выполнилась» не означает «интернет работает». Проверяется реальное
* разрешение имён, реальный HTTPS и отсутствие оставшегося мёртвого прокси
* приложения. Внешние ресурсы дополнительно сверяются со снимком ДО операции:
* они обязаны остаться неизменными.
*/
async function verifyInternetRecovery(before) {
	const verified = [];
	const problems = [];
	const dnsTargets = [
		"cloudflare.com",
		"microsoft.com",
		"example.com"
	];
	const dnsOk = (await Promise.allSettled(dnsTargets.map((host) => withTimeout$2(dns.lookup(host, { all: true }), 6e3, `lookup ${host}`)))).filter((result) => result.status === "fulfilled" && Array.isArray(result.value) && result.value.length > 0).length;
	if (dnsOk >= 2) verified.push(`Разрешение имён: ${dnsOk}/${dnsTargets.length}`);
	else problems.push(`Разрешение имён работает только для ${dnsOk} из ${dnsTargets.length} доменов`);
	const httpsTargets = [
		"https://www.cloudflare.com/cdn-cgi/trace",
		"https://www.msftconnecttest.com/connecttest.txt",
		"https://api.ipify.org?format=json"
	];
	const httpsOk = (await Promise.allSettled(httpsTargets.map(async (url) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 7e3);
		timer.unref?.();
		try {
			return (await fetch(url, { signal: controller.signal })).ok;
		} finally {
			clearTimeout(timer);
		}
	}))).filter((result) => result.status === "fulfilled" && result.value === true).length;
	if (httpsOk >= 2) verified.push(`HTTPS: ${httpsOk}/${httpsTargets.length}`);
	else problems.push(`HTTPS проходит только к ${httpsOk} из ${httpsTargets.length} независимых адресов`);
	const proxyAfter = await readSystemProxyState().catch(() => null);
	if (proxyAfter?.enabled && proxyAfter.ownedByApp) problems.push("В Windows остался системный прокси приложения");
	else verified.push("В Windows не осталось прокси приложения");
	if ((await readWinHttpProxy()).summary !== before.winHttpBefore.summary) problems.push("Настройка WinHTTP proxy изменилась во время восстановления");
	else verified.push("Внешний WinHTTP proxy не изменён");
	if (before.proxyBefore && !before.proxyBefore.ownedByApp && before.proxyBefore.enabled) if (proxyAfter?.proxyServer !== before.proxyBefore.proxyServer) problems.push("Внешний системный прокси был изменён — этого не должно происходить");
	else verified.push("Внешний системный прокси не изменён");
	if (!before.dnsMayChange && before.dnsServersBefore.length > 0) {
		const dnsServersAfter = await readCurrentDnsServers().catch(() => []);
		const expected = uniqueStrings(before.dnsServersBefore).sort();
		const actual = uniqueStrings(dnsServersAfter).sort();
		if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push("Настройка внешнего DNS изменилась во время восстановления");
		else verified.push("Внешний DNS не изменён");
	}
	return {
		verified,
		problems,
		connectivityConfirmed: dnsOk >= 2 && httpsOk >= 2
	};
}
/** Ограничение по времени для проб, у которых нет собственного таймаута. */
async function withTimeout$2(promise, timeoutMs, label) {
	let timer = null;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(/* @__PURE__ */ new Error(`${label} timed out`)), timeoutMs);
		timer.unref?.();
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
function uniqueStrings(values) {
	return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}
function normalizeStringArray(value) {
	if (Array.isArray(value)) return value.map(String).filter(Boolean);
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return [];
}
function firstNonEmpty(...values) {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
	}
	return null;
}
function isLocalDnsAddress(value) {
	const text = typeof value === "string" ? value.trim() : "";
	return /^127\./.test(text) || text === "::1" || text.toLowerCase() === "localhost";
}
function hostWithoutPort(value) {
	const trimmed = value.trim();
	if (!trimmed) return "";
	if (/^\[[^\]]+\]/.test(trimmed)) return trimmed.replace(/^\[([^\]]+)\].*$/, "$1");
	const withoutProtocol = trimmed.replace(/^https?:\/\//i, "");
	return withoutProtocol.split("/")[0]?.split(":")[0] ?? withoutProtocol;
}
function providerFromDnsValue(value) {
	const text = typeof value === "string" ? value.toLowerCase() : "";
	if (!text) return null;
	if (text.includes("gravityless") || text.includes("dns.gravityless.space")) return "Gravityless DNS";
	if (text.includes("cloudflare") || text.includes("1.1.1.1") || text.includes("1.0.0.1")) return "Cloudflare";
	if (text.includes("quad9") || text.includes("9.9.9.9") || text.includes("149.112.112.112")) return "Quad9";
	if (text.includes("google") || text.includes("8.8.8.8") || text.includes("8.8.4.4")) return "Google DNS";
	if (text.includes("adguard") || text.includes("94.140.14.14") || text.includes("94.140.15.15")) return "AdGuard";
	if (isLocalDnsAddress(text)) return "Локальный DNS";
	return null;
}
function knownDnsCountry(value) {
	const text = typeof value === "string" ? value.toLowerCase() : "";
	if (!text) return null;
	const host = hostWithoutPort(text);
	const exact = KNOWN_DNS_COUNTRY_HOSTS[host];
	if (exact) return { ...exact };
	const label = DNS_COUNTRY_LABELS[host.split(".")[0] ?? ""];
	if (label && host.includes(".")) return { ...label };
	if (text.includes("gravityless") || text.includes("dns.gravityless.space")) return { ...GRAVITYLESS_DNS_COUNTRY };
	return null;
}
function average(values) {
	const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
	if (numbers.length === 0) return null;
	return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}
var DNS_LOOKUP_TIMEOUT_MS = 3e3;
function withDnsLookupTimeout(operation, label) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(/* @__PURE__ */ new Error(`${label} timed out after ${DNS_LOOKUP_TIMEOUT_MS} ms.`)), DNS_LOOKUP_TIMEOUT_MS);
		operation.then((value) => {
			clearTimeout(timer);
			resolve(value);
		}, (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}
async function lookupLatency(host) {
	const started = Date.now();
	try {
		const records = await withDnsLookupTimeout(dns.lookup(host, { all: true }), `DNS lookup for ${host}`);
		return {
			dnsMs: Date.now() - started,
			address: records[0]?.address ?? null
		};
	} catch (error) {
		return {
			dnsMs: null,
			address: null,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
function tcpConnectLatency(host, port = 443, timeoutMs = 2500) {
	return new Promise((resolve) => {
		const started = Date.now();
		const socket = createConnection({
			host,
			port
		});
		let settled = false;
		const done = (result) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(timeoutMs, () => done({
			pingMs: null,
			error: "timeout"
		}));
		socket.once("connect", () => done({ pingMs: Date.now() - started }));
		socket.once("error", (error) => done({
			pingMs: null,
			error: error.message
		}));
	});
}
async function checkDnsTarget(target) {
	const [lookup, tcp] = await Promise.all([lookupLatency(target.host), tcpConnectLatency(target.host)]);
	return {
		...target,
		ok: lookup.dnsMs !== null && tcp.pingMs !== null,
		address: lookup.address,
		dnsMs: lookup.dnsMs,
		pingMs: tcp.pingMs,
		error: lookup.error ?? tcp.error ?? null
	};
}
async function geoipCountry(value, fallbackSource, allowExternal = false) {
	const known = knownDnsCountry(value) ?? knownDnsCountry(fallbackSource);
	const host = value ? hostWithoutPort(value) : "";
	if (!host || isLocalDnsAddress(host)) return known ?? {
		country: null,
		countryCode: null,
		source: null
	};
	if (!allowExternal) return known ?? {
		country: null,
		countryCode: null,
		source: null
	};
	try {
		const target = (/^[a-z0-9.-]+$/i.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host) ? await withDnsLookupTimeout(dns.lookup(host), `GeoIP DNS lookup for ${host}`).catch(() => null) : null)?.address ?? host;
		const primary = await fetchIpWhoIsCountry(target);
		if (primary.country) return primary;
		const fallback = await fetchIpApiCountry(target);
		if (fallback.country) return fallback;
	} catch (error) {
		logger.debug("[dns-diagnostics] GeoIP lookup failed:", error);
	}
	return known ?? {
		country: null,
		countryCode: null,
		source: null
	};
}
async function fetchIpWhoIsCountry(target) {
	try {
		const data = await (await fetch(`https://ipwho.is/${encodeURIComponent(target)}?fields=country,country_code,success`, { signal: AbortSignal.timeout(1800) })).json();
		if (data?.success && data.country) return {
			country: COUNTRY_RU[data.country] ?? data.country,
			countryCode: typeof data.country_code === "string" ? data.country_code.toLowerCase() : null,
			source: "ipwho.is"
		};
	} catch (error) {
		logger.debug("[dns-diagnostics] ipwho.is country lookup failed:", error);
	}
	return {
		country: null,
		countryCode: null,
		source: "ipwho.is"
	};
}
async function fetchIpApiCountry(target) {
	try {
		const data = await (await fetch(`https://ipapi.co/${encodeURIComponent(target)}/json/`, { signal: AbortSignal.timeout(1800) })).json();
		const rawCountry = typeof data?.country_name === "string" ? data.country_name : null;
		if (rawCountry) return {
			country: COUNTRY_RU[rawCountry] ?? rawCountry,
			countryCode: typeof data?.country_code === "string" ? data.country_code.toLowerCase() : null,
			source: "ipapi.co"
		};
	} catch (error) {
		logger.debug("[dns-diagnostics] ipapi.co country lookup failed:", error);
	}
	return {
		country: null,
		countryCode: null,
		source: "ipapi.co"
	};
}
async function createDnsMutationRollbackSnapshot(reason) {
	if (process.platform !== "win32") return createAdapterDnsRollbackSnapshot([], reason);
	const script = ["$configs = Get-DnsClientServerAddress -AddressFamily IPv4,IPv6 -ErrorAction SilentlyContinue", "$configs | Select-Object InterfaceAlias,InterfaceIndex,AddressFamily,ServerAddresses | ConvertTo-Json -Compress"].join("; ");
	let stdout;
	try {
		stdout = (await execFileAsync$6(resolveWindowsExecutable("powershell.exe"), [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			script
		], {
			timeout: DNS_MUTATION_SNAPSHOT_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
			windowsHide: true
		})).stdout;
	} catch (error) {
		const timedOut = Boolean(error && typeof error === "object" && "killed" in error && error.killed);
		throw new Error(timedOut ? "Windows не успела создать безопасный снимок DNS за 15 секунд. Изменения не применены; повторите действие." : `Не удалось создать безопасный снимок DNS Windows. Изменения не применены. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	const parsed = JSON.parse(stdout || "[]");
	const rows = Array.isArray(parsed) ? parsed : [parsed];
	const records = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const adapterName = String(row.InterfaceAlias ?? `if-${row.InterfaceIndex ?? "unknown"}`);
		const key = String(row.InterfaceIndex ?? adapterName);
		const current = records.get(key) ?? {
			adapterId: key,
			adapterName,
			interfaceIndex: typeof row.InterfaceIndex === "number" ? row.InterfaceIndex : void 0,
			before: []
		};
		const servers = Array.isArray(row.ServerAddresses) ? row.ServerAddresses.map((item) => String(item)).filter(Boolean) : typeof row.ServerAddresses === "string" && row.ServerAddresses ? [row.ServerAddresses] : [];
		const addressFamily = String(row.AddressFamily).toLowerCase();
		current.before.push({
			family: addressFamily === "ipv6" || addressFamily === "23" ? "ipv6" : "ipv4",
			mode: servers.length > 0 ? "static" : "dhcp",
			servers
		});
		records.set(key, current);
	}
	return createAdapterDnsRollbackSnapshot([...records.values()], reason);
}
function registerSystemHandlers({ window, stateStore, runtimeManager, gravitylessDnsManager, systemDohManager, zapretManager, telegramProxyManager, networkCombinatorManager }) {
	const mutateDns = (action, operation) => networkCombinatorManager ? networkCombinatorManager.runCoordinatedMutation({
		module: "dns",
		action,
		requiredLocks: ["dns", "dns-verify"],
		conflictsWith: ["traffic-route"]
	}, operation) : operation();
	const patchSettingsWithLoginItemSync = async (settingsPatch) => {
		const previous = stateStore.get();
		const nextState = {
			...previous,
			settings: {
				...previous.settings,
				...settingsPatch
			}
		};
		syncWindowsLoginItemSettings({
			app,
			settings: nextState.settings
		});
		try {
			return await stateStore.set(nextState);
		} catch (error) {
			try {
				syncWindowsLoginItemSettings({
					app,
					settings: previous.settings
				});
			} catch (rollbackError) {
				logger.error("[system] Failed to restore Windows login item after DNS settings error:", rollbackError);
			}
			throw error;
		}
	};
	ipcMain.handle("state:get", async () => {
		return stateStore.get();
	});
	ipcMain.handle("state:set", async (_event, rawState) => {
		const state = PersistedStateSchema.parse(rawState);
		const previous = stateStore.get();
		const nextState = {
			...state,
			settings: {
				...state.settings,
				systemDnsServers: state.settings.systemDnsServers ?? "",
				customDnsUrl: state.settings.customDnsUrl ?? "",
				systemDohEnabled: state.settings.systemDohEnabled ?? false,
				systemDohUrl: state.settings.systemDohUrl ?? "",
				systemDohLocalAddress: state.settings.systemDohLocalAddress ?? ""
			}
		};
		try {
			syncWindowsLoginItemSettings({
				app,
				settings: nextState.settings
			});
			const persisted = await stateStore.set(nextState);
			applyLoggerSettings(persisted.settings);
			return persisted;
		} catch (error) {
			try {
				syncWindowsLoginItemSettings({
					app,
					settings: previous.settings
				});
			} catch (rollbackError) {
				logger.error("[system] Failed to restore Windows login item after settings error:", rollbackError);
			}
			logger.warn("[system] Failed to apply persisted settings:", error);
			throw error;
		}
	});
	ipcMain.handle("app:is-admin", async () => runtimeManager.isAdmin());
	ipcMain.handle("app:get-version", async () => ({
		version: app.getVersion(),
		buildDate: EGOIST_SHIELD_BUILD_DATE
	}));
	ipcMain.handle("usage:save-record", async (_event, rawRecord) => {
		const record = UsageRecordSchema.parse(rawRecord);
		await stateStore.update((current) => {
			const updatedHistory = [...current.usageHistory || [], record];
			if (updatedHistory.length > 1e3) updatedHistory.shift();
			return {
				...current,
				usageHistory: updatedHistory
			};
		});
		return true;
	});
	ipcMain.handle("usage:get-history", async () => {
		return (await stateStore.get()).usageHistory || [];
	});
	ipcMain.handle("system:geoip", async (_event, rawHost) => {
		const host = GeoipInputSchema.parse(rawHost);
		if (stateStore.get().settings.allowExternalGeoLookups !== true) return {
			country: "",
			countryCode: "un"
		};
		try {
			const data = await (await fetch(`https://ipwho.is/${encodeURIComponent(host)}?fields=country,country_code,success`, { signal: AbortSignal.timeout(3e3) })).json();
			if (data.success && data.country_code) return {
				country: data.country || "",
				countryCode: data.country_code.toLowerCase()
			};
		} catch (error) {
			logger.debug("[system:geoip] Lookup failed for host", host, error);
		}
		return {
			country: "",
			countryCode: "un"
		};
	});
	const firstRunMarker = path.join(app.getPath("userData"), ".first-run-done");
	ipcMain.handle("app:is-first-run", async () => {
		try {
			await promises.access(firstRunMarker);
			return false;
		} catch {
			return true;
		}
	});
	ipcMain.handle("app:mark-first-run-done", async () => {
		await promises.writeFile(firstRunMarker, (/* @__PURE__ */ new Date()).toISOString(), "utf8");
	});
	ipcMain.handle("runtime:install-xray", async () => {
		return runtimeManager.installXrayRuntime();
	});
	ipcMain.handle("runtime:install-all", async () => {
		return await runtimeManager.installAllRuntimes();
	});
	ipcMain.handle("runtime:check-updates", async () => {
		return runtimeManager.checkRuntimeUpdates();
	});
	ipcMain.handle("system:pick-file", async (_event, rawFilters) => {
		const filters = PickFileFilterSchema.parse(rawFilters).map((filter) => ({
			name: filter.name,
			extensions: filter.extensions
		}));
		const result = await dialog.showOpenDialog(window, {
			properties: ["openFile"],
			filters
		});
		const filePath = result.canceled ? null : result.filePaths[0] ?? null;
		if (filePath) rememberPickedFile(filePath);
		return filePath;
	});
	ipcMain.handle("system:list-processes", async () => {
		if (process.platform === "win32") try {
			const { stdout } = await execFileAsync$6(resolveWindowsExecutable("powershell.exe"), [
				"-NoProfile",
				"-Command",
				"Get-Process | Where-Object { $_.Path } | Select-Object Name, Path | ConvertTo-Json -Compress"
			], { maxBuffer: 1024 * 1024 * 10, windowsHide: true });
			let procs = JSON.parse(stdout);
			if (!Array.isArray(procs)) procs = [procs];
			const unique = /* @__PURE__ */ new Map();
			for (const p of procs) {
				const parsedName = `${p.Name.toLowerCase()}.exe`;
				if (!unique.has(parsedName)) unique.set(parsedName, {
					name: `${p.Name}.exe`,
					path: p.Path
				});
			}
			return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
		} catch (err) {
			log.error("List processes failed", err);
			return [];
		}
		return [];
	});
	ipcMain.handle("system:get-app-icon", async (_event, rawExePath) => {
		const exePath = AppIconInputSchema.parse(rawExePath);
		try {
			return (await app.getFileIcon(exePath, { size: "normal" })).toDataURL();
		} catch (error) {
			logger.debug("[system:get-app-icon] Failed to resolve icon for", exePath, error);
			return null;
		}
	});
	let lastClipboardRead = 0;
	const CLIPBOARD_COOLDOWN_MS = 1e3;
	const CLIPBOARD_URI_PATTERN = /^(vmess|vless|trojan|ss|ssr|hysteria2?|tuic|wg|wireguard|socks[45]?|https?):\/\//i;
	const CLIPBOARD_BASE64_PATTERN = /^[A-Za-z0-9+/=\r\n]{20,}$/;
	const CLIPBOARD_SUB_URL_PATTERN = /^https?:\/\/.+/i;
	ipcMain.handle("system:read-clipboard", async () => {
		const now = Date.now();
		if (now - lastClipboardRead < CLIPBOARD_COOLDOWN_MS) return "";
		lastClipboardRead = now;
		const text = clipboard.readText().trim();
		if (!text) return "";
		if (CLIPBOARD_URI_PATTERN.test(text) || CLIPBOARD_SUB_URL_PATTERN.test(text) || CLIPBOARD_BASE64_PATTERN.test(text)) return text;
		return "";
	});
	ipcMain.handle("system:write-clipboard", async (_event, text) => {
		if (typeof text !== "string") return false;
		const value = text.trim();
		if (!value || value.length > 4096) return false;
		clipboard.writeText(value);
		return true;
	});
	ipcMain.handle("system:terminate-conflicts", async () => {
		const isAdmin = await runtimeManager.isAdmin();
		globalThis.reconnectSupervisor?.cancel();
		const terminateOwned = async () => {
			const results = [];
			for (const [name, stop] of [
				["VPN", () => runtimeManager.disconnect()],
				["DNS", () => systemDohManager.stopAndRemove()],
				["Telegram", () => telegramProxyManager.stop()],
				["Zapret standalone", () => zapretManager.stopStandalone()],
				["Zapret service", () => zapretManager.stopService()]
			]) {
				const result = await stop();
				if (result?.ok === false) throw new Error(result.message || `Не удалось остановить ${name}`);
				results.push(name);
			}
			return { ok: true, terminated: results, isAdmin };
		};
		return networkCombinatorManager ? networkCombinatorManager.runCoordinatedMutation({ module: "system", action: "stop-owned", requiredLocks: ["traffic-route", "zapret-suspend", "packet-interception", "windivert", "dns", "dns-verify", "system-proxy", "telegram-proxy"], conflictsWith: [] }, terminateOwned) : terminateOwned();
	});
	/**
	* «Восстановить интернет» — безопасное восстановление, а не сброс Windows.
	*
	* ЧТО БЫЛО НЕ ТАК (HIGH-10)
	*
	* Прежняя версия безусловно выполняла `netsh winhttp reset proxy`. Это
	* реальная системная мутация: WinHTTP переводится в DIRECT. Приложение
	* никогда не задавало WinHTTP-прокси, поэтому сбрасывало ЧУЖУЮ — возможно,
	* корпоративную и полностью исправную — настройку.
	*
	* Кроме того она вызывала `runtimeManager.disconnect()` напрямую, минуя
	* обработчик VPN, который возвращает временно приостановленный Zapret. В
	* результате Discord-обход оставался остановленным без объяснения.
	*
	* Новый контракт: стандартное состояние — это последний подтверждённый
	* снимок Windows ДО изменений Egoist Shield плюс любые более новые внешние
	* настройки, которые приложение не создавало. Меняется только доказанно
	* своё; всё чужое сохраняется и перечисляется явно. Итог подтверждается
	* пост-проверкой, а не фактом «команда выполнилась».
	*/
	ipcMain.handle("system:internet-fix", async () => {
		const isAdmin = await runtimeManager.isAdmin();
		const coreServiceAvailable = await coreServiceClient.isAvailable().catch(() => false);
		if (!isAdmin && !coreServiceAvailable) return {
			ok: false,
			fixed: [],
			preserved: [],
			verified: [],
			message: "Для восстановления интернета запустите Egoist Shield от имени администратора."
		};
		try {
			globalThis.reconnectSupervisor?.cancel();
		} catch {}
		const repair = async () => {
		const fixed = [];
		const preserved = [];
		const verified = [];
		const problems = [];
		let dnsMayChange = false;
		const settings = stateStore.get().settings;
		const [proxyStateBefore, winHttpBefore, dnsServersBefore, zapretBefore, telegramBefore] = await Promise.all([
			readSystemProxyState().catch(() => null),
			readWinHttpProxy(),
			readCurrentDnsServers().catch(() => []),
			zapretManager.status().catch(() => null),
			telegramProxyManager?.status?.().catch(() => null) ?? Promise.resolve(null)
		]);
		const runStep = async (label, action) => {
			try {
				if (await action() !== false) fixed.push(label);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.warn(`[internet-repair] ${label} failed:`, error);
				problems.push(`${label}: ${message}`);
			}
		};
		const vpnStatusBefore = await runtimeManager.status().catch(() => null);
		if (vpnStatusBefore?.connected || vpnStatusBefore?.running) {
			dnsMayChange = true;
			await runStep("Остановлен собственный VPN runtime", async () => {
				await runtimeManager.disconnect();
			});
		} else preserved.push("VPN: не был запущен");
		if (proxyStateBefore?.ownedByApp) await runStep("Восстановлен исходный системный прокси", async () => {
			const release = await disableSystemProxy();
			if (release.conflict) {
				preserved.push("Системный прокси: изменён вне приложения — сохранён");
				return false;
			}
			if (!release.ok) throw new Error(release.error ?? "восстановление не завершено");
			return release.restored;
		});
		else if (proxyStateBefore?.enabled) preserved.push(`Системный прокси: внешний (${proxyStateBefore.proxyServer ?? "адрес неизвестен"}) — сохранён`);
		else preserved.push("Системный прокси: выключен — не изменялся");
		preserved.push(winHttpBefore.hasProxy ? `WinHTTP proxy: внешний (${winHttpBefore.summary}) — сохранён` : "WinHTTP proxy: не настроен — не изменялся");
		await runStep("Удалены собственные правила Kill Switch", async () => {
			await new KillSwitch().disable();
		});

		try {
			if (coreServiceAvailable) {
				const recovery = await coreServiceClient.repairOwnedNetwork();
				if (recovery.repaired) {
					dnsMayChange = true;
					fixed.push(`Завершён откат транзакции ${recovery.resource ?? "сети"} в EgoistShieldCore`);
					if (recovery.resource === "native-doh") {
						if (!(await coreServiceClient.nativeDohStatus()).enabled) {
							await patchSettingsWithLoginItemSync({
								systemDohEnabled: false,
								systemDohLocalAddress: ""
							});
							fixed.push("Отключён повреждённый System DoH; Windows DNS возвращён в рабочее состояние");
						}
					}
				} else preserved.push(dnsServersBefore.length > 0 ? `DNS: ${dnsServersBefore.slice(0, 3).join(", ")} — не изменялся` : "DNS: настроен системой — не изменялся");
				verified.push("EgoistShieldCore проверил собственный журнал и обновил кэш DNS");
			} else {
				const pending = await readDnsTransaction();
				if (pending && pending.phase !== "committed") {
					const recovery = await recoverDnsTransaction();
					if (recovery.failures.length > 0) problems.push(`Незавершённая транзакция DNS: ${recovery.failures.join("; ")}`);
					else {
						dnsMayChange = dnsMayChange || recovery.restored > 0;
						fixed.push(`Завершён откат незавершённой транзакции DNS (${recovery.restored} адаптер(ов))`);
					}
				} else preserved.push(dnsServersBefore.length > 0 ? `DNS: ${dnsServersBefore.slice(0, 3).join(", ")} — не изменялся` : "DNS: настроен системой — не изменялся");
			}
		} catch (error) {
			logger.warn("[internet-repair] dns transaction check failed:", error);
			problems.push(`Проверка журнала DNS: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (telegramBefore) {
			const running = Boolean(telegramBefore.running || telegramBefore.serviceRunning);
			preserved.push(running ? "Telegram Proxy: работает — не изменялся" : "Telegram Proxy: остановлен — не изменялся");
		}
		await runStep("Возвращён прежний режим Discord-обхода", async () => {
			const restored = await zapretManager.restoreAfterVpnIfNeeded(settings.zapretSuspendDuringVpn ?? true, settings.zapretProfile || "General");
			const wasRunning = Boolean(zapretBefore?.serviceRunning || zapretBefore?.standaloneRunning);
			const isRunning = Boolean(restored?.serviceRunning || restored?.standaloneRunning);
			if (wasRunning && isRunning) {
				preserved.push("Discord-обход: работал и работает — не перезапускался");
				return false;
			}
			return isRunning;
		});
		if (!coreServiceAvailable) await runStep("Очищен кэш DNS", async () => {
			await execFileAsync$6(resolveWindowsExecutable("ipconfig"), ["/flushdns"], {
				windowsHide: true,
				timeout: 5e3
			});
		});
		const postCheck = await verifyInternetRecovery({
			proxyBefore: proxyStateBefore,
			winHttpBefore,
			dnsServersBefore,
			dnsMayChange
		});
		verified.push(...postCheck.verified);
		problems.push(...postCheck.problems);
		const ok = problems.length === 0 && postCheck.connectivityConfirmed;
		return {
			ok,
			fixed,
			preserved,
			verified,
			problems,
			message: [
				ok ? "Интернет восстановлен" : "Интернет не подтверждён",
				fixed.length > 0 ? `\nИсправлено:\n${fixed.map((item) => `- ${item}`).join("\n")}` : "",
				preserved.length > 0 ? `\nСохранено:\n${preserved.map((item) => `- ${item}`).join("\n")}` : "",
				verified.length > 0 ? `\nПроверено:\n${verified.map((item) => `- ${item}`).join("\n")}` : "",
				problems.length > 0 ? `\nВнимание:\n${problems.map((item) => `- ${item}`).join("\n")}` : ""
			].filter(Boolean).join("\n")
		};
		};
		return networkCombinatorManager ? networkCombinatorManager.runCoordinatedMutation({ module: "system", action: "repair", requiredLocks: ["traffic-route", "zapret-suspend", "packet-interception", "windivert", "dns", "dns-verify", "system-proxy", "telegram-proxy"], conflictsWith: [] }, repair) : repair();
	});
	ipcMain.handle("system:dns-controller-status", async () => {
		const persistedState = stateStore.get();
		const mode = resolveDnsControllerMode(persistedState);
		const [adapters, rawPort53Available, systemDohStatus, gravitylessStatus, configuredServers] = await Promise.all([
			readDnsControllerAdapters(),
			mode === "gravityless-dns" ? canBindPort(53).catch(() => false) : Promise.resolve(null),
			process.env.NODE_ENV === "test" ? Promise.resolve(createMockSystemDohStatus({
				url: persistedState.settings.systemDohUrl ?? "",
				localAddress: persistedState.settings.systemDohLocalAddress ?? "",
				running: persistedState.settings.systemDohEnabled ?? false
			})) : systemDohManager.status().catch((error) => ({
				running: false,
				lastError: error instanceof Error ? error.message : String(error)
			})),
			gravitylessDnsManager?.status?.().catch((error) => ({
				running: false,
				lastError: error instanceof Error ? error.message : String(error)
			})) ?? Promise.resolve(null),
			readCurrentDnsServers()
		]);
		const gravitylessRunning = Boolean(gravitylessStatus?.running || gravitylessStatus?.service?.running || gravitylessStatus?.service?.state === "running");
		const ownedResolverRunning = mode === "system-doh" && Boolean(systemDohStatus.running) || mode === "gravityless-dns" && gravitylessRunning;
		const port53Available = ownedResolverRunning ? true : rawPort53Available;
		const controller = buildDnsControllerState({
			mode,
			adapters,
			hasRollbackSnapshot: false,
			port53: port53Available === null ? null : {
				host: "127.0.0.1",
				port: 53,
				available: port53Available,
				owner: port53Available ? ownedResolverRunning ? "Egoist Shield owned resolver" : null : "unknown local DNS service"
			},
			leakStatus: {
				checked: false,
				leaking: null,
				resolverIp: null,
				vpnIp: null,
				message: "Run DNS leak test from Health to refresh this value."
			}
		});
		const running = ownedResolverRunning || mode === "manual-dns" && configuredServers.length > 0 || mode === "system-default" && configuredServers.length > 0;
		const lastError = firstNonEmpty(systemDohStatus.lastError, gravitylessStatus?.lastError);
		return {
			...controller,
			running,
			serviceRunning: gravitylessRunning,
			ownedResolverRunning,
			servers: configuredServers,
			provider: mode === "system-doh" ? "System DoH" : mode === "gravityless-dns" ? "Gravityless DNS" : providerFromDnsValue(configuredServers[0] ?? "") ?? "System DNS",
			lastError: lastError || null
		};
	});
	ipcMain.handle("system:dns-diagnostics", async () => {
		const persistedState = stateStore.get();
		const mode = resolveDnsControllerMode(persistedState);
		const [controller, systemDohStatus, gravitylessStatus, configuredServers, targets] = await Promise.all([
			(async () => {
				const [adapters, port53Available] = await Promise.all([readDnsControllerAdapters(), mode === "gravityless-dns" ? canBindPort(53).catch(() => false) : Promise.resolve(null)]);
				return buildDnsControllerState({
					mode,
					adapters,
					hasRollbackSnapshot: true,
					port53: port53Available === null ? null : {
						host: "127.0.0.1",
						port: 53,
						available: port53Available,
						owner: port53Available ? null : "local DNS service"
					},
					leakStatus: {
						checked: false,
						leaking: null,
						resolverIp: null,
						vpnIp: null,
						message: "DNS diagnostics checks resolver health directly."
					}
				});
			})(),
			process.env.NODE_ENV === "test" ? Promise.resolve(createMockSystemDohStatus({
				url: persistedState.settings.systemDohUrl ?? "",
				localAddress: persistedState.settings.systemDohLocalAddress ?? "",
				running: persistedState.settings.systemDohEnabled ?? false
			})) : systemDohManager.status(),
			gravitylessDnsManager?.status?.().catch((error) => ({ lastError: error instanceof Error ? error.message : String(error) })) ?? Promise.resolve(null),
			readCurrentDnsServers(),
			Promise.all(DNS_DIAGNOSTIC_TARGETS.map((target) => checkDnsTarget(target)))
		]);
		const dohUrl = firstNonEmpty(systemDohStatus.currentUrl, systemDohStatus.url, persistedState.settings.systemDohUrl);
		const parsedDohUrl = (() => {
			try {
				return dohUrl ? new URL(dohUrl) : null;
			} catch {
				return null;
			}
		})();
		const dohHost = parsedDohUrl?.hostname ?? (dohUrl ? hostWithoutPort(dohUrl) : null);
		const upstream = parsedDohUrl?.host ?? null;
		const localAddress = firstNonEmpty(systemDohStatus.localAddress, persistedState.settings.systemDohLocalAddress);
		const firstConfigured = firstNonEmpty(configuredServers[0], persistedState.settings.systemDnsServers);
		const nativeManaged = systemDohStatus.nativeManaged === true;
		const nativeServers = Array.isArray(systemDohStatus.serverAddresses) ? systemDohStatus.serverAddresses.filter((value) => typeof value === "string") : [];
		const pointsToNative = nativeManaged && nativeServers.some((server) => configuredServers.includes(server));
		const pointsToLocal = Boolean(localAddress && configuredServers.includes(localAddress)) || configuredServers.some(isLocalDnsAddress) || isGravitylessLoopbackDnsRequest(String(persistedState.settings.systemDnsServers ?? ""));
		const gravitylessRunning = Boolean(gravitylessStatus?.running || gravitylessStatus?.service?.running || gravitylessStatus?.service?.state === "running");
		const encrypted = Boolean(systemDohStatus.running && systemDohStatus.encrypted !== false || gravitylessRunning);
		const address = pointsToNative ? nativeServers.find((server) => configuredServers.includes(server)) ?? firstConfigured : pointsToLocal ? localAddress ?? configuredServers.find(isLocalDnsAddress) ?? "127.0.0.1" : firstConfigured;
		const providerSource = dohUrl ?? upstream ?? (mode === "gravityless-dns" ? "dns.gravityless.space" : address ?? "");
		const provider = providerFromDnsValue(providerSource) ?? providerFromDnsValue(address) ?? "Не определён";
		const country = knownDnsCountry(dohHost) ?? await geoipCountry(dohHost ?? address ?? null, providerSource, stateStore.get().settings.allowExternalGeoLookups === true);
		const hasRuntimeError = Boolean(systemDohStatus.lastError || gravitylessStatus?.lastError);
		const active = mode === "system-doh" && systemDohStatus.running && (nativeManaged ? pointsToNative : pointsToLocal) || mode === "gravityless-dns" && gravitylessRunning && pointsToLocal || mode === "manual-dns" && configuredServers.length > 0 || mode === "system-default" && configuredServers.length > 0;
		const status = hasRuntimeError ? "error" : active ? "active" : "inactive";
		const current = {
			address: address ?? "Не прочитан",
			provider,
			country: country.country,
			countryCode: country.countryCode,
			countrySource: country.source ?? null,
			protocol: systemDohStatus.running ? nativeManaged ? "System DoH (Windows)" : "System DoH" : gravitylessRunning ? "Gravityless DNS" : mode === "manual-dns" ? "Manual DNS" : "System DNS",
			localChannel: pointsToNative ? "Windows DNS Client · HTTPS:443" : pointsToLocal ? `${address ?? "127.0.0.1"}:53` : "не активен",
			encrypted,
			status,
			statusLabel: status === "active" ? "Активен" : status === "error" ? "Ошибка" : "Неактивен",
			upstream: upstream ?? firstConfigured ?? null,
			mode: controller.mode,
			error: hasRuntimeError ? firstNonEmpty(systemDohStatus.lastError, gravitylessStatus?.lastError) : null
		};
		const okCount = targets.filter((target) => target.ok).length;
		const summary = {
			averagePingMs: average(targets.map((target) => target.pingMs)),
			averageDnsMs: average(targets.map((target) => target.dnsMs)),
			okCount,
			total: targets.length
		};
		return {
			ok: okCount > 0,
			checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
			current,
			controller,
			targets,
			summary
		};
	});
	ipcMain.handle("system:set-dns-servers", async (_event, rawInput) => {
		return mutateDns("set-dns-servers", async () => {
			const dnsServers = SystemDnsServersInputSchema.parse(rawInput);
			const mock = process.env.NODE_ENV === "test";
			const persistedState = stateStore.get();
			if (!mock) {
				if (!await runtimeManager.isAdmin()) return {
					ok: false,
					message: "Для изменения системного DNS нужен запуск от имени администратора.",
					servers: []
				};
			}
			try {
				const rollbackSnapshot = await createDnsMutationRollbackSnapshot("manual-dns-apply");
				if (!mock && gravitylessDnsManager && isGravitylessLoopbackDnsRequest(dnsServers)) await gravitylessDnsManager.ensureRunning();
				const result = await setSystemDnsThroughCurrentOwner(dnsServers, mock);
				await patchSettingsWithLoginItemSync({
					systemDnsServers: result.servers.join(", "),
					systemDohEnabled: false,
					systemDohLocalAddress: ""
				});
				if (persistedState.settings.systemDohEnabled && !mock) await systemDohManager.stopAndRemove().catch((error) => {
					logger.warn("[system-doh] Failed to stop runtime after manual DNS apply:", error);
				});
				if (!mock && gravitylessDnsManager && !isGravitylessLoopbackDnsRequest(dnsServers)) await gravitylessDnsManager.stopAndRemove().catch((error) => {
					logger.warn("[gravityless-dns] Failed to stop service after switching to external DNS:", error);
				});
				return {
					...result,
					rollbackSnapshot
				};
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : "Не удалось применить системный DNS.",
					servers: []
				};
			}
		});
	});
	ipcMain.handle("system:reset-dns-servers", async () => {
		return mutateDns("reset-dns-servers", async () => {
			const mock = process.env.NODE_ENV === "test";
			const persistedState = stateStore.get();
			if (!mock) {
				if (!await runtimeManager.isAdmin()) return {
					ok: false,
					message: "Для сброса системного DNS нужен запуск от имени администратора.",
					servers: []
				};
			}
			try {
				const rollbackSnapshot = await createDnsMutationRollbackSnapshot("system-dns-reset");
				const result = await resetSystemDnsThroughCurrentOwner(mock);
				if (!mock && gravitylessDnsManager) await gravitylessDnsManager.stopAndRemove().catch((error) => {
					logger.warn("[gravityless-dns] Failed to stop service after DNS reset:", error);
				});
				await patchSettingsWithLoginItemSync({
					systemDnsServers: "",
					systemDohEnabled: false,
					systemDohLocalAddress: ""
				});
				if (persistedState.settings.systemDohEnabled && !mock) await systemDohManager.stopAndRemove().catch((error) => {
					logger.warn("[system-doh] Failed to stop runtime after DNS reset:", error);
				});
				return {
					...result,
					rollbackSnapshot
				};
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : "Не удалось сбросить системный DNS.",
					servers: []
				};
			}
		});
	});
	ipcMain.handle("system-doh:status", async () => {
		const persistedState = stateStore.get();
		if (process.env.NODE_ENV === "test") return createMockSystemDohStatus({
			url: persistedState.settings.systemDohUrl ?? "",
			localAddress: persistedState.settings.systemDohLocalAddress ?? "",
			running: persistedState.settings.systemDohEnabled ?? false
		});
		return systemDohManager.status();
	});
	ipcMain.handle("system-doh:apply", async (_event, rawInput) => {
		return mutateDns("system-doh-apply", async () => {
			const url = SystemDohUrlInputSchema.parse(rawInput);
			const mock = process.env.NODE_ENV === "test";
			const persistedState = stateStore.get();
			const switchingFromGravityless = isGravitylessLoopbackDnsRequest(persistedState.settings.systemDnsServers ?? "");
			let gravitylessWasRunning = false;
			if (!mock) {
				if (!await runtimeManager.isAdmin()) return {
					ok: false,
					message: "Для включения System DoH нужен запуск приложения от имени администратора.",
					status: await systemDohManager.status()
				};
			}
			try {
				const rollbackSnapshot = await createDnsMutationRollbackSnapshot("system-doh-apply");
				if (!mock) await systemDohManager.stopAndRemove();
				if (!mock && gravitylessDnsManager && switchingFromGravityless) {
					const gravitylessBefore = await gravitylessDnsManager.status({ force: true });
					gravitylessWasRunning = gravitylessBefore.running;
					if (gravitylessBefore.service.state !== "not-installed") await gravitylessDnsManager.stopAndRemove();
				}
				const startedStatus = mock ? createMockSystemDohStatus({
					url,
					localAddress: "1.1.1.1",
					running: true
				}) : await systemDohManager.apply(url, persistedState.settings.systemDohLocalAddress);
				if (!startedStatus.localAddress) throw new Error("System DoH запустился без локального адреса.");
				if (!mock && startedStatus.nativeManaged !== true) try {
					await setSystemDnsThroughCurrentOwner(startedStatus.localAddress, false, SYSTEM_DOH_VERIFICATION_DOMAINS);
				} catch (error) {
					await systemDohManager.stopAndRemove().catch((stopError) => {
						logger.warn("[system-doh] Failed to stop runtime after DNS apply error:", stopError);
					});
					if (gravitylessWasRunning && gravitylessDnsManager) await gravitylessDnsManager.ensureRunning().catch((restoreError) => {
						logger.warn("[system-doh] Failed to restore Gravityless after DNS apply error:", restoreError);
					});
					throw error;
				}
				const nextStatus = mock ? startedStatus : await systemDohManager.status();
				await patchSettingsWithLoginItemSync({
					systemDohEnabled: true,
					systemDohUrl: url,
					systemDohLocalAddress: nextStatus.localAddress ?? "",
					...switchingFromGravityless ? { systemDnsServers: "" } : {}
				});
				return {
					ok: true,
					message: nextStatus.nativeManaged === true ? "System DoH активирован штатным Windows DNS Client; незашифрованный UDP fallback запрещён." : `System DoH активирован через ${nextStatus.localAddress}:${nextStatus.localPort ?? 53}.`,
					status: nextStatus,
					rollbackSnapshot
				};
			} catch (error) {
				if (!mock && gravitylessWasRunning && gravitylessDnsManager) await gravitylessDnsManager.ensureRunning().catch((restoreError) => {
					logger.warn("[system-doh] Failed to restore Gravityless after System DoH startup error:", restoreError);
				});
				const message = error instanceof Error ? error.message : "Не удалось включить System DoH.";
				return {
					ok: false,
					message,
					status: mock ? createMockSystemDohStatus({
						url,
						localAddress: persistedState.settings.systemDohLocalAddress ?? "",
						running: false,
						lastError: message
					}) : await systemDohManager.status()
				};
			}
		});
	});
	ipcMain.handle("system-doh:reset", async () => {
		return mutateDns("system-doh-reset", async () => {
			const mock = process.env.NODE_ENV === "test";
			const persistedState = stateStore.get();
			if (!mock) {
				if (!await runtimeManager.isAdmin()) return {
					ok: false,
					message: "Для отключения System DoH нужен запуск приложения от имени администратора.",
					status: await systemDohManager.status()
				};
			}
			try {
				const manualDnsServers = persistedState.settings.systemDnsServers ?? "";
				const hasManualDns = manualDnsServers.trim().length > 0;
				const rollbackSnapshot = await createDnsMutationRollbackSnapshot("system-doh-reset");
				let message = "System DoH отключён.";
				let resolverStopped = false;
				if (!mock) {
					if (hasManualDns && gravitylessDnsManager && isGravitylessLoopbackDnsRequest(manualDnsServers)) {
						await systemDohManager.stopAndRemove();
						resolverStopped = true;
						try {
							await gravitylessDnsManager.ensureRunning();
							await setSystemDnsThroughCurrentOwner(manualDnsServers, false);
							message = "System DoH отключён. Gravityless DNS восстановлен и проверен.";
						} catch (restoreError) {
							throw new Error(`Gravityless DNS восстановить не удалось; исходный DNS сохранён. ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
						}
					} else if (hasManualDns) {
						await systemDohManager.stopAndRemove();
						resolverStopped = true;
						await setSystemDnsThroughCurrentOwner(manualDnsServers, false);
						message = `System DoH отключён. Возвращён сохранённый DNS: ${manualDnsServers}.`;
					} else {
						await systemDohManager.stopAndRemove();
						message = "System DoH отключён. Исходные параметры DNS восстановлены.";
					}
					if (hasManualDns && !resolverStopped) await systemDohManager.stopAndRemove();
				} else if (hasManualDns) message = `System DoH отключён. Возвращён сохранённый DNS: ${manualDnsServers}.`;
				else message = "System DoH отключён. Системный DNS возвращён к настройкам по умолчанию.";
				await patchSettingsWithLoginItemSync({
					systemDohEnabled: false,
					systemDohLocalAddress: ""
				});
				return {
					ok: true,
					message,
					status: mock ? createMockSystemDohStatus({
						url: persistedState.settings.systemDohUrl ?? "",
						running: false
					}) : await systemDohManager.status(),
					rollbackSnapshot
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Не удалось отключить System DoH.";
				return {
					ok: false,
					message,
					status: mock ? createMockSystemDohStatus({
						url: persistedState.settings.systemDohUrl ?? "",
						localAddress: persistedState.settings.systemDohLocalAddress ?? "",
						running: persistedState.settings.systemDohEnabled ?? false,
						lastError: message
					}) : await systemDohManager.status()
				};
			}
		});
	});
	ipcMain.handle("system-doh:restart", async () => {
		return mutateDns("system-doh-restart", async () => {
			const mock = process.env.NODE_ENV === "test";
			const persistedState = stateStore.get();
			if (!mock && !await runtimeManager.isAdmin()) return {
				ok: false,
				message: "Для перепроверки System DoH нужны права администратора.",
				status: await systemDohManager.status()
			};
			try {
				return {
					ok: true,
					message: "System DoH повторно применён и проверен штатным Windows DNS Client.",
					status: mock ? createMockSystemDohStatus({
						url: persistedState.settings.systemDohUrl ?? "",
						localAddress: persistedState.settings.systemDohLocalAddress ?? "",
						running: persistedState.settings.systemDohEnabled ?? false
					}) : await systemDohManager.restart()
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Не удалось перепроверить System DoH.";
				return {
					ok: false,
					message,
					status: mock ? createMockSystemDohStatus({
						url: persistedState.settings.systemDohUrl ?? "",
						localAddress: persistedState.settings.systemDohLocalAddress ?? "",
						running: false,
						lastError: message
					}) : await systemDohManager.status({ force: true })
				};
			}
		});
	});
	const shield = new ShieldConnectionController({
		zapret: zapretManager,
		dns: systemDohManager,
		vpn: runtimeManager,
		telegramProxy: telegramProxyManager,
		applyDns: async () => {
			const targetUrl = stateStore.get().settings.systemDohUrl || "https://de-prem.aeternia.space:8443/dns-query/c8570320b4bdb1d651eb938e178c272d";
			const persistedState = stateStore.get();
			await systemDohManager.stopAndRemove();
			const startedStatus = await systemDohManager.apply(targetUrl, persistedState.settings.systemDohLocalAddress);
			if (startedStatus?.localAddress && startedStatus.nativeManaged !== true) {
				await setSystemDnsThroughCurrentOwner(startedStatus.localAddress, false, SYSTEM_DOH_VERIFICATION_DOMAINS);
			}
			await patchSettingsWithLoginItemSync({
				systemDohEnabled: true,
				systemDohUrl: targetUrl,
				systemDohLocalAddress: startedStatus?.localAddress ?? ""
			});
			return { ok: true, status: startedStatus };
		},
		resetDns: async () => {
			// The component facade restores only owned DNS before stopping its resolver.
			await systemDohManager.stopAndRemove();
			await patchSettingsWithLoginItemSync({
				systemDohEnabled: false,
				systemDohLocalAddress: ""
			});
			return { ok: true };
		},
		saveConnected: profile => patchSettingsWithLoginItemSync({ zapretProfile: profile, autoStart: true, startMinimized: true, minimizeToTray: true }),
		coordinate: (action, operation) => coordinateShieldAction(action, operation, {
			manager: networkCombinatorManager,
			vpn: runtimeManager,
			supervisor: globalThis.reconnectSupervisor
		}),
		onProgress: status => {
			if (window && !window.isDestroyed()) window.webContents.send("shield:progress", status);
			if (status.phase === "connected") updateTrayMenu(true);
			else if (status.phase === "idle" || status.phase === "cancelled") updateTrayMenu(false);
		}
	});
	window.shieldController = shield;
	ipcMain.handle("shield:status", () => shield.status());
	ipcMain.handle("shield:connect", (_event, options) => shield.connect(z.object({ dnsEnabled: z.boolean().default(true), telegramEnabled: z.boolean().default(true) }).parse(options ?? {})));
	ipcMain.handle("shield:disconnect", () => shield.disconnect());
	ipcMain.handle("shield:cancel", () => shield.cancel());
	ipcMain.handle("window:minimize", async () => {
		window.minimize();
		return true;
	});
	ipcMain.handle("window:toggle-maximize", async () => {
		if (window.isMaximized()) window.unmaximize();
		else window.maximize();
		return window.isMaximized();
	});
	ipcMain.handle("window:is-maximized", async () => {
		return window.isMaximized();
	});
	ipcMain.handle("window:close", async () => {
		window.close();
		return true;
	});
	ipcMain.handle("window:set-widget-mode", async (_event, isWidget) => {
		const fn = typeof applyShieldWindowMode === "function" ? applyShieldWindowMode : (global.applyShieldWindowMode || (window ? window.applyShieldWindowMode : null));
		if (typeof fn === "function") {
			fn(window, isWidget !== false);
		}
		return true;
	});
	runtimeManager.on("unexpected-exit", async (lastError) => {
		logger.warn("[vpn] unexpected exit:", lastError);
		const status = await runtimeManager.status();
		logger.warn(formatRuntimeLogEvent({
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			level: "warn",
			lifecycle: status.lifecycle,
			reason: status.diagnostic.reason,
			message: lastError || "VPN runtime exited unexpectedly.",
			nodeId: status.activeNodeId,
			runtimeKind: status.runtimeKind,
			proxyPort: status.proxyPort
		}));
		if (Notification.isSupported() && stateStore.get().settings.notifications !== false) new Notification({
			title: "Egoist Shield: Соединение потеряно",
			body: lastError || "VPN-соединение разорвано."
		}).show();
		updateTrayMenu(false);
		const persistedState = stateStore.get();
		if (persistedState.settings.zapretSuspendDuringVpn) try {
			await zapretManager.restoreAfterVpnIfNeeded(persistedState.settings.zapretSuspendDuringVpn, persistedState.settings.zapretProfile);
		} catch (error) {
			logger.warn("[zapret] Failed to restore service after unexpected VPN exit:", error);
		}
	});
}
//#endregion
