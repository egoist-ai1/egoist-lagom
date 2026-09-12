//#region src/electron/ipc/telegram-proxy-manager.ts
var execFileAsync$3 = promisify(execFile);
var TG_WS_PROXY_RELEASE_API_URL = "https://api.github.com/repos/Flowseal/tg-ws-proxy/releases/latest";
var TG_WS_PROXY_RELEASE_PAGE_URL = "https://github.com/Flowseal/tg-ws-proxy/releases/latest";
var TG_WS_PROXY_MANAGED_EXE_NAME = "egoistshield-tg-ws-proxy.exe";
var TG_WS_PROXY_BUNDLED_ASSET_NAME = "egoistshield-tg-ws-proxy.bin";
var TG_WS_PROXY_LEGACY_EXE_NAME = "TgWsProxy_windows_7_64bit.exe";
var TG_WS_PROXY_VERSION_FILE = "VERSION.txt";
var TG_WS_PROXY_FLAVOR_FILE = "RUNTIME_FLAVOR.txt";
var TG_WS_PROXY_INTERNAL_DIR = "telegram-proxy";
var TG_WS_PROXY_HEADLESS_FLAVOR_PREFIX = "headless";
var TG_WS_PROXY_DESIRED_FLAVOR = "headless-windowless";
var TG_WS_PROXY_SERVICE_NAME = "EgoistShieldTelegramProxy";
var TG_WS_PROXY_SERVICE_DISPLAY_NAME = "EgoistShield Telegram Proxy";
var TG_WS_PROXY_SERVICE_EXE_NAME = "egoistshield-telegram-proxy-service.exe";
var TG_WS_PROXY_SERVICE_START_TIMEOUT_MS = 45e3;
var TELEGRAM_PROXY_STATUS_CACHE_TTL_MS = 3e3;
var TELEGRAM_PROXY_TRAFFIC_CACHE_TTL_MS = 3e3;
var TELEGRAM_PROXY_FALLBACK_ONLY_DC = "0:127.0.0.1";
var TELEGRAM_PROXY_LEGACY_DIRECT_DCS = ["2:149.154.167.220", "4:149.154.167.220"];
var SC_SERVICE_STATE_BY_CODE = {
	1: "STOPPED",
	2: "START_PENDING",
	3: "STOP_PENDING",
	4: "RUNNING",
	5: "CONTINUE_PENDING",
	6: "PAUSE_PENDING",
	7: "PAUSED"
};
var TG_WS_PROXY_MANAGED_CANDIDATES = [TG_WS_PROXY_MANAGED_EXE_NAME, TG_WS_PROXY_LEGACY_EXE_NAME];
var TG_WS_PROXY_BUNDLED_CANDIDATES = [
	TG_WS_PROXY_BUNDLED_ASSET_NAME,
	TG_WS_PROXY_MANAGED_EXE_NAME,
	TG_WS_PROXY_LEGACY_EXE_NAME
];
var TELEGRAM_PROXY_LOG_TAIL_BYTES = 128 * 1024;
function isRecord(value) {
	return typeof value === "object" && value !== null;
}
function parseScServiceState(stdout) {
	for (const line of stdout.split(/\r?\n/)) {
		const match = /^\s*[^:\r\n]+:\s*([1-7])\s+([A-Z_]+)\s*$/i.exec(line);
		if (!match) continue;
		const rawState = match[2].toUpperCase();
		if (SC_SERVICE_STATE_BY_CODE[match[1]] === rawState) return rawState;
	}
	return null;
}
function normalizePositiveInteger(value, fallback) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const normalized = Math.trunc(value);
	return normalized > 0 ? normalized : fallback;
}
function normalizeBoundedInteger(value, fallback, minimum, maximum) {
	const normalized = normalizePositiveInteger(value, fallback);
	return Math.min(maximum, Math.max(minimum, normalized));
}
function normalizePositiveFloat(value, fallback) {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
	return value;
}
function normalizeTelegramProxySecret(value) {
	const trimmed = value.trim().replace(/^dd/i, "");
	return /^[0-9a-f]{32}$/i.test(trimmed) ? trimmed.toLowerCase() : randomBytes(16).toString("hex");
}
function isLoopbackHost(value) {
	const normalized = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
	return normalized === "localhost" || normalized === "::1" || normalized === "127.0.0.1";
}
function normalizeDirectDcEndpoints(value) {
	return [...new Set(value.map((item) => item.trim()).filter((item) => {
		const match = /^([1-5]):(\[?[^\]]+\]?)$/.exec(item);
		if (!match) return false;
		return isIP(match[2].replace(/^\[|\]$/g, "")) > 0;
	}))].slice(0, 16);
}
function buildTelegramProxyLink(config) {
	const secret = normalizeTelegramProxySecret(config.secret);
	return `tg://proxy?server=${encodeURIComponent(config.host)}&port=${config.port}&secret=dd${secret}`;
}
function buildTelegramProxyWebLink(config) {
	const secret = normalizeTelegramProxySecret(config.secret);
	return `https://t.me/proxy?server=${encodeURIComponent(config.host)}&port=${config.port}&secret=dd${secret}`;
}
function normalizeTelegramProxyConfig(rawConfig, fallback) {
	const safeFallback = fallback ?? {
		host: "127.0.0.1",
		port: 1443,
		secret: randomBytes(16).toString("hex"),
		dcIp: [],
		verbose: false,
		bufKb: 256,
		poolSize: 8,
		logMaxMb: 5,
		checkUpdates: true
	};
	if (!isRecord(rawConfig)) return safeFallback;
	const dcIpValue = rawConfig.dc_ip;
	const dcIp = Array.isArray(dcIpValue) ? dcIpValue.map((item) => String(item).trim()).filter(Boolean) : typeof dcIpValue === "string" ? dcIpValue.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) : safeFallback.dcIp;
	const usesLegacyDirectDefaults = dcIp.length === TELEGRAM_PROXY_LEGACY_DIRECT_DCS.length && TELEGRAM_PROXY_LEGACY_DIRECT_DCS.every((endpoint) => dcIp.includes(endpoint));
	const rawHost = typeof rawConfig.host === "string" && rawConfig.host.trim() ? rawConfig.host.trim() : safeFallback.host;
	return {
		host: isLoopbackHost(rawHost) ? rawHost : safeFallback.host,
		port: normalizeBoundedInteger(rawConfig.port, safeFallback.port, 1024, 65535),
		secret: typeof rawConfig.secret === "string" ? normalizeTelegramProxySecret(rawConfig.secret) : safeFallback.secret,
		dcIp: usesLegacyDirectDefaults ? [] : normalizeDirectDcEndpoints(dcIp),
		verbose: typeof rawConfig.verbose === "boolean" ? rawConfig.verbose : safeFallback.verbose,
		bufKb: normalizeBoundedInteger(rawConfig.buf_kb, safeFallback.bufKb, 64, 4096),
		poolSize: normalizeBoundedInteger(rawConfig.pool_size, safeFallback.poolSize, 1, 32),
		logMaxMb: Math.min(100, Math.max(1, normalizePositiveFloat(rawConfig.log_max_mb, safeFallback.logMaxMb))),
		checkUpdates: typeof rawConfig.check_updates === "boolean" ? rawConfig.check_updates : safeFallback.checkUpdates
	};
}
function validateTelegramProxyConfig(config) {
	const host = config.host.trim();
	if (!isLoopbackHost(host)) throw new Error("Локальный Telegram Proxy может слушать только 127.0.0.1, ::1 или localhost. Публикация прокси в локальную сеть заблокирована.");
	if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error("Порт Telegram Proxy должен быть целым числом от 1024 до 65535.");
	const secret = config.secret.trim().replace(/^dd/i, "");
	if (!/^[0-9a-f]{32}$/i.test(secret)) throw new Error("Secret должен содержать ровно 32 шестнадцатеричных символа.");
	if (!Array.isArray(config.dcIp)) throw new Error("Список прямых Telegram DC имеет неверный формат.");
	const submittedDcEndpoints = config.dcIp.map((item) => String(item).trim()).filter(Boolean);
	const dcIp = normalizeDirectDcEndpoints(submittedDcEndpoints);
	if (dcIp.length !== new Set(submittedDcEndpoints).size) throw new Error("Каждый прямой Telegram DC должен иметь вид 2:149.154.167.220 или 2:[IPv6]; допустимы DC 1–5 и не более 16 уникальных адресов.");
	if (!Number.isInteger(config.bufKb) || config.bufKb < 64 || config.bufKb > 4096) throw new Error("Буфер Telegram Proxy должен быть от 64 до 4096 КБ.");
	if (!Number.isInteger(config.poolSize) || config.poolSize < 1 || config.poolSize > 32) throw new Error("Пул Telegram Proxy должен содержать от 1 до 32 соединений.");
	if (!Number.isFinite(config.logMaxMb) || config.logMaxMb < 1 || config.logMaxMb > 100) throw new Error("Лимит журнала Telegram Proxy должен быть от 1 до 100 МБ.");
	return {
		...config,
		host,
		secret: secret.toLowerCase(),
		dcIp
	};
}
function buildTelegramProxyRuntimeArgs(config, logPath) {
	const args = [
		"--host",
		config.host,
		"--port",
		String(config.port),
		"--secret",
		normalizeTelegramProxySecret(config.secret),
		"--buf-kb",
		String(config.bufKb),
		"--pool-size",
		String(config.poolSize),
		"--log-file",
		logPath,
		"--log-max-mb",
		String(config.logMaxMb)
	];
	const directDcEndpoints = config.dcIp.length > 0 ? config.dcIp : [TELEGRAM_PROXY_FALLBACK_ONLY_DC];
	for (const dcIp of directDcEndpoints) args.push("--dc-ip", dcIp);
	if (config.verbose) args.push("--verbose");
	return args;
}
function toRawConfig(config) {
	return {
		host: config.host,
		port: config.port,
		secret: normalizeTelegramProxySecret(config.secret),
		dc_ip: config.dcIp,
		verbose: config.verbose,
		buf_kb: config.bufKb,
		pool_size: config.poolSize,
		log_max_mb: config.logMaxMb,
		check_updates: config.checkUpdates
	};
}
function buildCommandResult$1(message, options = {}) {
	return {
		ok: options.ok ?? true,
		opened: options.opened ?? false,
		message,
		output: options.output ?? ""
	};
}
function escapeXmlText$1(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
/**
* `$PID` is a read-only automatic variable in PowerShell: assigning to it raises
* "Cannot overwrite variable PID because it is read-only or constant" and aborts
* the walk, so the previous version of this script silently reported the
* PowerShell host's own process id instead of the proxy process tree. The loop
* variable must never be named `$pid`.
*/
function buildTelegramProxyProcessTreeScript(rootPid) {
	return [
		`$root = ${Math.trunc(rootPid)}`,
		"$all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId, ParentProcessId",
		"$known = New-Object 'System.Collections.Generic.HashSet[int]'",
		"$queue = New-Object 'System.Collections.Generic.Queue[int]'",
		"[void]$known.Add([int]$root)",
		"$queue.Enqueue([int]$root)",
		"while ($queue.Count -gt 0) {",
		"  $parent = $queue.Dequeue()",
		"  foreach ($proc in @($all | Where-Object { [int]$_.ParentProcessId -eq $parent })) {",
		"    $childPid = [int]$proc.ProcessId",
		"    if ($known.Add($childPid)) { $queue.Enqueue($childPid) }",
		"  }",
		"}",
		"$known | ForEach-Object { $_ }"
	].join("; ");
}
function quoteWindowsArgument(value) {
	return `"${value.replace(/"/g, "\\\"")}"`;
}
function parseTrafficByteValue(value, unit) {
	if (!value) return null;
	const numeric = Number.parseFloat(value.replace(",", "."));
	if (!Number.isFinite(numeric) || numeric < 0) return null;
	const normalizedUnit = (unit || "b").toLowerCase();
	return Math.round(numeric * (normalizedUnit === "gb" || normalizedUnit === "gib" ? 1024 ** 3 : normalizedUnit === "mb" || normalizedUnit === "mib" ? 1024 ** 2 : normalizedUnit === "kb" || normalizedUnit === "kib" ? 1024 : 1));
}
function parseTelegramProxyLogTrafficTotals(line) {
	if (!line || !/\bstats:/i.test(line)) return null;
	const upMatch = /\bup=(\d+(?:[.,]\d+)?)([KMGT]?i?B)?\b/i.exec(line);
	const downMatch = /\bdown=(\d+(?:[.,]\d+)?)([KMGT]?i?B)?\b/i.exec(line);
	if (upMatch || downMatch) {
		const upBytes = parseTrafficByteValue(upMatch?.[1], upMatch?.[2]);
		const downBytes = parseTrafficByteValue(downMatch?.[1], downMatch?.[2]);
		if (upBytes !== null || downBytes !== null) return {
			upBytes: upBytes ?? 0,
			downBytes: downBytes ?? 0
		};
	}
	const sentMatch = /\bsent=(\d+)\b/i.exec(line);
	const receivedMatch = /\breceived=(\d+)\b/i.exec(line);
	if (sentMatch || receivedMatch) return {
		upBytes: Number.parseInt(sentMatch?.[1] ?? "0", 10) || 0,
		downBytes: Number.parseInt(receivedMatch?.[1] ?? "0", 10) || 0
	};
	return null;
}
var TelegramProxyManager = class {
	resourcesPath;
	appPath;
	userDataDir;
	coreService;
	runtimeDir;
	appDataDir;
	legacyAppDataDir;
	configPath;
	logPath;
	firstRunMarkerPath;
	statePath;
	lastError = null;
	trafficCache = null;
	statusCache = null;
	statusInFlight = null;
	lastUpstreamVersion = null;
	sha256Cache = /* @__PURE__ */ new Map();
	constructor(resourcesPath, appPath, userDataDir, protectedComponentRoot, coreService) {
		this.resourcesPath = resourcesPath;
		this.appPath = appPath;
		this.userDataDir = userDataDir;
		this.coreService = coreService;
		this.runtimeDir = protectedComponentRoot ? path.join(protectedComponentRoot, "runtime") : path.join(this.userDataDir, "runtime", "tg-ws-proxy");
		this.appDataDir = protectedComponentRoot ?? path.join(this.userDataDir, TG_WS_PROXY_INTERNAL_DIR);
		this.legacyAppDataDir = path.join(process.env.APPDATA || path.dirname(this.userDataDir), "TgWsProxy");
		this.configPath = path.join(this.appDataDir, "config.json");
		this.logPath = path.join(this.appDataDir, "proxy.log");
		this.firstRunMarkerPath = path.join(this.appDataDir, ".first_run_done_mtproto");
		this.statePath = path.join(this.appDataDir, "state.json");
	}
	async status(options = {}) {
		const now = Date.now();
		if (!options.force && this.statusCache && this.statusCache.expiresAt > now) return this.statusCache.value;
		if (!options.force && this.statusInFlight) return this.statusInFlight;
		this.statusInFlight = this.readStatus().then((value) => {
			this.statusCache = {
				value,
				expiresAt: Date.now() + TELEGRAM_PROXY_STATUS_CACHE_TTL_MS
			};
			return value;
		}).finally(() => {
			this.statusInFlight = null;
		});
		return this.statusInFlight;
	}
	invalidateStatusCache() {
		this.statusCache = null;
		this.trafficCache = null;
	}
	async readStatus() {
		await this.ensureConfigExists();
		const config = await this.readConfig();
		const managedState = await this.readManagedState();
		const running = await this.isStateRunning(managedState);
		if (!running && managedState) await this.clearManagedState();
		const service = await this.queryServiceStatus();
		const logLines = await this.readLogTailLines(300);
		const traffic = this.readRuntimeTraffic(logLines);
		const managedRuntime = await this.getManagedRuntimeInfo();
		const bundledRuntime = await this.getBundledRuntimeInfo();
		const runtime = managedRuntime ?? bundledRuntime;
		const latestVersion = this.pickNewerVersion(bundledRuntime?.version ?? null, runtime?.version ?? null);
		const portAvailable = running || service.running ? true : !await this.isLocalTcpPortOpen(config.port);
		const [managedSha256, bundledSha256] = await Promise.all([managedRuntime ? this.sha256File(managedRuntime.runtimePath) : Promise.resolve(null), bundledRuntime ? this.sha256File(bundledRuntime.runtimePath) : Promise.resolve(null)]);
		const checksumState = resolveTelegramProxyChecksumState({
			bundledSha256,
			managedSha256,
			bundledVersion: bundledRuntime?.version ?? null,
			managedVersion: managedRuntime?.version ?? null
		});
		const links = buildTelegramProxyLinks(config);
		const logTail = logLines.slice(-80);
		return {
			runtimeSha256: managedSha256,
			bundledSha256,
			runtimeMatchesBundled: Boolean(managedSha256 && bundledSha256 && managedSha256 === bundledSha256),
			available: Boolean(runtime),
			running: running || service.running,
			pid: running ? managedState?.pid ?? null : service.pid,
			runtimePath: runtime?.runtimePath ?? null,
			configPath: this.configPath,
			logPath: this.logPath,
			currentVersion: runtime?.version ?? null,
			upstreamLatestVersion: this.lastUpstreamVersion,
			upstreamInstallable: false,
			connectionUrl: buildTelegramProxyLink(config),
			webConnectionUrl: links.webUrl,
			qrPayload: links.qrPayload,
			updateChecksEnabled: config.checkUpdates,
			serviceName: TG_WS_PROXY_SERVICE_NAME,
			serviceInstalled: service.installed,
			serviceRunning: service.running,
			serviceState: service.state,
			trafficRx: traffic.rx,
			trafficTx: traffic.tx,
			trafficSource: traffic.source,
			trafficUpdatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			portConflict: {
				host: config.host,
				port: config.port,
				available: portAvailable,
				owner: portAvailable ? null : "unknown local process"
			},
			updateGate: buildTelegramProxyUpdateGate({
				currentVersion: runtime?.version ?? null,
				latestVersion,
				checksumState
			}),
			health: buildTelegramProxyHealthState({
				available: Boolean(runtime),
				running: running || service.running,
				serviceRunning: service.running,
				serviceState: service.state,
				config,
				portAvailable,
				portOwner: portAvailable ? null : "unknown local process",
				currentVersion: runtime?.version ?? null,
				latestVersion,
				checksumState,
				logTail
			}),
			logTail,
			config,
			lastError: this.lastError
		};
	}
	async saveConfig(config) {
		const validated = validateTelegramProxyConfig(config);
		await this.writeConfig(validated);
		await this.appendProxyLog("INFO", `Конфиг сохранён: ${validated.host}:${validated.port}, DC=${validated.dcIp.length}, verbose=${validated.verbose ? "on" : "off"}.`);
		this.lastError = null;
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async start() {
		await this.appendProxyLog("INFO", "Запуск TG Proxy запрошен из интерфейса.");
		if (process.platform === "win32") return this.startService();
		if ((await this.queryServiceStatus()).installed) return this.startService();
		const runtime = await this.ensureManagedRuntimeInstalled();
		if (!runtime) throw new Error("Бинарь TG WS Proxy не найден. Сначала подготовьте runtime/tg-ws-proxy.");
		const currentState = await this.readManagedState();
		if (await this.isStateRunning(currentState)) {
			await this.appendProxyLog("INFO", "TG Proxy уже запущен, повторный запуск пропущен.");
			this.invalidateStatusCache();
			return this.status({ force: true });
		}
		const config = await this.readConfig();
		await this.writeConfig(config);
		await promises.mkdir(this.appDataDir, { recursive: true });
		await promises.writeFile(this.firstRunMarkerPath, (/* @__PURE__ */ new Date()).toISOString(), "utf8");
		const child = spawn(runtime.runtimePath, this.buildRuntimeArgs(config), {
			cwd: path.dirname(runtime.runtimePath),
			detached: true,
			stdio: "ignore",
			windowsHide: true
		});
		child.unref();
		await this.writeManagedState({
			pid: child.pid ?? null,
			startedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		this.lastError = null;
		await this.appendProxyLog("INFO", `Headless runtime запущен: pid=${child.pid ?? "unknown"}, port=${config.port}.`);
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async stop() {
		await this.appendProxyLog("INFO", "Остановка TG Proxy запрошена из интерфейса.");
		const service = await this.queryServiceStatus();
		if (service.installed && service.running) await this.stopService();
		await this.stopStaleTelegramProxyProcesses();
		await this.appendProxyLog("INFO", "TG Proxy остановлен.");
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async shutdownApplicationRuntime() {
		if ((await this.queryServiceStatus()).installed) {
			await this.appendProxyLog("INFO", "Egoist Lagom закрывается; установленная фоновая служба TG Proxy остаётся под управлением Windows SCM.");
			this.invalidateStatusCache();
			return this.status({ force: true });
		}
		return this.stop();
	}
	async restart() {
		await this.appendProxyLog("INFO", "Перезапуск TG Proxy запрошен из интерфейса.");
		if ((await this.queryServiceStatus()).installed) {
			await this.stopService();
			return this.startService();
		}
		await this.stop();
		return this.start();
	}
	/**
	* Устанавливает или приводит в соответствие фоновую службу — идемпотентно.
	*
	* ЧТО БЫЛО НЕ ТАК (MED-02)
	*
	* Метод ВСЕГДА выполнял stop -> uninstall -> delete -> install -> start,
	* даже если конфигурация полностью совпадала. На чистой VM это занимало
	* 17–29 секунд и порождало лишние окна отказа службы.
	*
	* Новая логика:
	*  * служба не установлена -> полная установка;
	*  * установлена и конфигурация совпадает -> только подтверждение параметров
	*    восстановления и запуск, если она остановлена (секунды вместо десятков);
	*  * установлена, изменилась только конфигурация -> перезапись XML и
	*    контролируемый restart, без снятия регистрации и без потери автозапуска;
	*  * полное переустановление -> только если регистрация службы указывает на
	*    чужой/устаревший wrapper.
	*/
	async installService() {
		const runtime = await this.ensureManagedRuntimeInstalled();
		if (!runtime) throw new Error("Встроенный runtime TG WS Proxy не найден. Нельзя установить службу без runtime.");
		const wrapperPath = await this.ensureServiceWrapperInstalled();
		const existing = await this.queryServiceStatus();
		const configResult = await this.writeServiceWrapperConfig(runtime);
		const imagePathMatchesWrapper = await this.serviceImagePathMatches(wrapperPath);
		if (existing.installed && imagePathMatchesWrapper && !configResult.changed) {
			await this.appendProxyLog("INFO", "Служба TG Proxy уже соответствует конфигурации: переустановка не требуется.");
			if (this.coreService) await this.coreService.installOwnedService(TG_WS_PROXY_SERVICE_NAME);
			else await this.configureServiceRecovery();
			const verification = await this.ensureServicePersistence();
			await this.startService();
			this.lastError = null;
			await this.appendProxyLog("INFO", `Служба TG Proxy проверена (автозапуск подтверждён: ${verification.ok ? "да" : "нет"}).`);
			this.invalidateStatusCache();
			return {
				...await this.status({ force: true }),
				servicePersistence: verification
			};
		}
		if (existing.installed && imagePathMatchesWrapper && configResult.changed) {
			await this.appendProxyLog("INFO", "Конфигурация службы TG Proxy изменилась: контролируемый перезапуск.");
			if (this.coreService) await this.coreService.stopOwnedService(TG_WS_PROXY_SERVICE_NAME);
			else await this.execServiceWrapper(wrapperPath, ["stop"], true);
			if (!await this.waitForServiceState("stopped", 15e3)) throw new Error(`Служба ${TG_WS_PROXY_SERVICE_NAME} не остановилась за 15 секунд; перенастройка отменена.`);
			if (this.coreService) await this.coreService.installOwnedService(TG_WS_PROXY_SERVICE_NAME);
			else await this.configureServiceRecovery();
			const verification = await this.ensureServicePersistence();
			await this.startService();
			this.lastError = null;
			this.invalidateStatusCache();
			return {
				...await this.status({ force: true }),
				servicePersistence: verification
			};
		}
		await this.appendProxyLog("INFO", "Установка фоновой службы TG Proxy в автозапуск.");
		await this.stop();
		await this.stopStaleTelegramProxyProcesses();
		if (existing.installed) {
			if (this.coreService) await this.coreService.removeOwnedService(TG_WS_PROXY_SERVICE_NAME);
			else {
				await this.execServiceWrapper(wrapperPath, ["stop"], true);
				await this.execServiceWrapper(wrapperPath, ["uninstall"], true);
				await this.execSc(["delete", TG_WS_PROXY_SERVICE_NAME], true);
			}
			if (!await this.waitForServiceState("not-installed", 12e3)) throw new Error(`Старая служба ${TG_WS_PROXY_SERVICE_NAME} не удалилась. Закройте services.msc и повторите установку.`);
		}
		if (this.coreService) await this.coreService.installOwnedService(TG_WS_PROXY_SERVICE_NAME);
		else {
			await this.execServiceWrapper(wrapperPath, ["install"], false);
			await this.configureServiceRecovery();
		}
		const verification = await this.ensureServicePersistence();
		await this.startService();
		this.lastError = null;
		await this.appendProxyLog("INFO", `Служба EgoistShieldTelegramProxy установлена: Automatic + restart recovery (подтверждено: ${verification.ok ? "да" : "нет"}).`);
		this.invalidateStatusCache();
		return {
			...await this.status({ force: true }),
			servicePersistence: verification
		};
	}
	/**
	* Проверяет, что ImagePath службы указывает на наш wrapper.
	*
	* Совпадение имени службы недостаточно: запись могла остаться от прошлой
	* установки в другом каталоге, и тогда контролируемый restart применил бы
	* конфигурацию к не тому исполняемому файлу.
	*/
	async serviceImagePathMatches(wrapperPath) {
		try {
			const { stdout } = await execFileAsync$3(resolveWindowsExecutable("reg.exe"), [
				"query",
				`HKLM\\SYSTEM\\CurrentControlSet\\Services\\${TG_WS_PROXY_SERVICE_NAME}`,
				"/v",
				"ImagePath"
			], {
				windowsHide: true,
				timeout: 15e3
			});
			const match = /ImagePath\s+REG_(?:EXPAND_)?SZ\s+(.+)/i.exec(stdout);
			if (!match) return false;
			const imagePath = match[1].trim().replace(/^"(.*)"$/, "$1");
			return path.resolve(imagePath).toLowerCase() === path.resolve(wrapperPath).toLowerCase();
		} catch {
			return false;
		}
	}
	async removeService() {
		await this.appendProxyLog("INFO", "Удаление owned-службы TG Proxy.");
		const wrapperPath = await this.findExistingServiceWrapperPath();
		if (this.coreService) await this.coreService.removeOwnedService(TG_WS_PROXY_SERVICE_NAME);
		else {
			if (wrapperPath) await this.execServiceWrapper(wrapperPath, ["stop"], true);
			await this.execSc(["stop", TG_WS_PROXY_SERVICE_NAME], true);
			await this.waitForServiceState("stopped", 12e3);
			if (wrapperPath) await this.execServiceWrapper(wrapperPath, ["uninstall"], true);
			await this.execSc(["delete", TG_WS_PROXY_SERVICE_NAME], true);
		}
		const removed = await this.waitForServiceState("not-installed", 12e3);
		await this.stopStaleTelegramProxyProcesses();
		if (!removed) {
			const service = await this.queryServiceStatus();
			throw new Error(`Служба ${TG_WS_PROXY_SERVICE_NAME} не удалилась (состояние: ${service.state}). Перезагрузите Windows и повторите удаление.`);
		}
		this.lastError = null;
		await this.appendProxyLog("INFO", "Служба EgoistShieldTelegramProxy удалена.");
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async startService() {
		await this.appendProxyLog("INFO", "Запуск фоновой службы TG Proxy.");
		const runtime = await this.ensureManagedRuntimeInstalled();
		if (!runtime) throw new Error("Встроенный runtime TG WS Proxy не найден. Нельзя запустить службу без runtime.");
		let service = await this.queryServiceStatus();
		if (!service.installed) return this.installService();
		if (this.coreService) await this.coreService.installOwnedService(TG_WS_PROXY_SERVICE_NAME);
		await this.ensureServicePersistence();
		service = await this.queryServiceStatus();
		const config = await this.readConfig();
		if (service.running) {
			if (await this.isLocalTcpPortOpen(config.port)) {
				this.lastError = null;
				await this.appendProxyLog("INFO", "Служба TG Proxy уже работает, состояние подтверждено.");
				this.invalidateStatusCache();
				return this.status({ force: true });
			}
			await this.stopService();
		}
		await this.stopStaleTelegramProxyProcesses();
		await this.writeServiceWrapperConfig(runtime);
		await promises.writeFile(this.firstRunMarkerPath, (/* @__PURE__ */ new Date()).toISOString(), "utf8");
		if (this.coreService) await this.coreService.startOwnedService(TG_WS_PROXY_SERVICE_NAME);
		else {
			const wrapperPath = await this.getServiceWrapperPath();
			await this.execServiceWrapper(wrapperPath, ["start"], true);
		}
		await this.waitForServiceReady(config.port, TG_WS_PROXY_SERVICE_START_TIMEOUT_MS);
		this.lastError = null;
		await this.appendProxyLog("INFO", `Служба TG Proxy запущена и подтвердила порт 127.0.0.1:${config.port}.`);
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async stopService() {
		await this.appendProxyLog("INFO", "Остановка фоновой службы TG Proxy.");
		if (this.coreService) await this.coreService.stopOwnedService(TG_WS_PROXY_SERVICE_NAME);
		else {
			const wrapperPath = await this.findExistingServiceWrapperPath();
			if (wrapperPath) await this.execServiceWrapper(wrapperPath, ["stop"], true);
			await this.execSc(["stop", TG_WS_PROXY_SERVICE_NAME], true);
		}
		await this.waitForServiceState("stopped", 15e3);
		await this.stopStaleTelegramProxyProcesses();
		this.lastError = null;
		await this.appendProxyLog("INFO", "Фоновая служба TG Proxy остановлена.");
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async checkForUpdates() {
		await this.appendProxyLog("INFO", "Проверка runtime TG WS Proxy и GitHub Releases.");
		const managedRuntime = await this.getManagedRuntimeInfo();
		const bundledRuntime = await this.getBundledRuntimeInfo();
		const currentVersion = managedRuntime?.version ?? bundledRuntime?.version ?? null;
		const bundledVersion = bundledRuntime?.version ?? null;
		const upstreamVersion = await this.getLatestUpstreamVersion().catch(() => null);
		this.lastUpstreamVersion = upstreamVersion;
		const managedNeedsHeadlessRepair = this.needsManagedRuntimeRepair(bundledRuntime, managedRuntime);
		const latestInstallableVersion = this.pickNewerVersion(bundledVersion, currentVersion);
		const updateAvailable = managedNeedsHeadlessRepair || (latestInstallableVersion === null ? false : currentVersion === null ? true : compareLooseVersions(latestInstallableVersion, currentVersion) > 0);
		return {
			currentVersion,
			latestVersion: latestInstallableVersion,
			upstreamLatestVersion: upstreamVersion,
			upstreamInstallable: false,
			updateAvailable,
			releaseUrl: TG_WS_PROXY_RELEASE_PAGE_URL,
			targetVersion: TELEGRAM_PROXY_TARGET_VERSION,
			checksumState: "verified",
			controlledInstallAllowed: updateAvailable,
			message: managedNeedsHeadlessRepair ? "Будет применён встроенный hidden headless TG WS Proxy, чтобы прокси работал без отдельного окна, консоли и значка в трее." : upstreamVersion && bundledVersion && compareLooseVersions(upstreamVersion, bundledVersion) > 0 ? `На GitHub есть TG WS Proxy ${upstreamVersion}, но официальный Windows asset является desktop/tray-приложением. EgoistShield не устанавливает его как внутренний headless runtime, чтобы не открывать сторонние окна.` : latestInstallableVersion ? updateAvailable ? `Доступно встроенное headless-обновление TG WS Proxy: ${latestInstallableVersion}` : `Внутренний headless TG WS Proxy уже актуален (${currentVersion ?? latestInstallableVersion}).` : "Встроенный TG WS Proxy пока недоступен."
		};
	}
	async installUpdate() {
		await this.appendProxyLog("INFO", "Установка совместимого internal headless runtime TG WS Proxy.");
		await this.stopStaleTelegramProxyProcesses();
		await promises.rm(path.join(this.userDataDir, "runtime", "_download"), {
			recursive: true,
			force: true
		}).catch(() => void 0);
		const managedRuntime = await this.getManagedRuntimeInfo();
		const bundledRuntime = await this.getBundledRuntimeInfo();
		const needsHeadlessRepair = this.needsManagedRuntimeRepair(bundledRuntime, managedRuntime);
		const bundledIsInstallable = this.isHeadlessRuntime(bundledRuntime);
		const bundledIsNewer = Boolean(bundledRuntime?.version && managedRuntime?.version) && compareLooseVersions(bundledRuntime?.version ?? "", managedRuntime?.version ?? "") > 0;
		if (!(bundledIsInstallable && (needsHeadlessRepair || !managedRuntime || bundledIsNewer))) {
			await this.appendProxyLog("INFO", "Обновление не применено: совместимый internal headless runtime уже актуален; официальный GitHub Windows asset не запускается и не устанавливается внутри EgoistShield.");
			this.lastError = null;
			this.invalidateStatusCache();
			return this.status({ force: true });
		}
		const wasRunning = await this.isStateRunning(await this.readManagedState());
		const serviceBeforeUpdate = await this.queryServiceStatus();
		if (wasRunning) await this.stop();
		if (serviceBeforeUpdate.running) await this.stopService();
		const runtime = await this.ensureManagedRuntimeInstalled({ force: needsHeadlessRepair || !managedRuntime || bundledIsNewer });
		if (!runtime) throw new Error("Bundled runtime TG WS Proxy не найден.");
		if (serviceBeforeUpdate.installed) await this.writeServiceWrapperConfig(runtime);
		if (serviceBeforeUpdate.running) await this.startService();
		else if (wasRunning) await this.start();
		this.lastError = null;
		await this.appendProxyLog("INFO", `Runtime TG WS Proxy обновлён: ${runtime.version ?? "bundled"}.`);
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async openConnectionLink() {
		const config = await this.readConfig();
		const nativeUrl = buildTelegramProxyLink(config);
		const webUrl = buildTelegramProxyWebLink(config);
		try {
			await shell.openExternal(nativeUrl);
			return buildCommandResult$1("Ссылка подключения открыта в Telegram.", {
				opened: true,
				output: nativeUrl
			});
		} catch {
			try {
				await shell.openExternal(webUrl);
				return buildCommandResult$1("Протокол tg:// не найден, ссылка открыта через web-страницу Telegram.", {
					opened: true,
					output: webUrl
				});
			} catch {
				throw new Error("Не удалось открыть ссылку Telegram Proxy. Проверьте, что установлен Telegram Desktop или доступен браузер.");
			}
		}
	}
	async openLogs() {
		shell.showItemInFolder(this.logPath);
		return buildCommandResult$1("Открыта папка с логами TG WS Proxy.", { opened: true });
	}
	async tailLogs(maxLines = 80) {
		return this.readLogTailLines(maxLines);
	}
	/**
	* Reads at most the last 128 KiB of the log. `proxy.log` is capped by
	* `log_max_mb` (5 MB by default), and the previous implementation loaded the
	* whole file into memory on every status poll.
	*/
	async readLogTailLines(maxLines = 80) {
		const limit = Math.max(1, Math.min(300, maxLines));
		let handle = null;
		try {
			handle = await promises.open(this.logPath, "r");
			const { size } = await handle.stat();
			const length = Math.min(size, TELEGRAM_PROXY_LOG_TAIL_BYTES);
			if (length <= 0) return [];
			const buffer = Buffer.alloc(length);
			await handle.read(buffer, 0, length, size - length);
			const lines = buffer.toString("utf8").split(/\r?\n/).filter(Boolean);
			return (size > length && lines.length > 1 ? lines.slice(1) : lines).slice(-limit).map((line) => redactDiagnosticText(line));
		} catch {
			return [];
		} finally {
			await handle?.close().catch(() => void 0);
		}
	}
	async sha256File(filePath) {
		try {
			const stats = await promises.stat(filePath);
			const cached = this.sha256Cache.get(filePath);
			if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) return cached.sha256;
			const sha256 = createHash("sha256").update(await promises.readFile(filePath)).digest("hex");
			this.sha256Cache.set(filePath, {
				size: stats.size,
				mtimeMs: stats.mtimeMs,
				sha256
			});
			return sha256;
		} catch {
			return null;
		}
	}
	async appendProxyLog(level, message) {
		try {
			await promises.mkdir(this.appDataDir, { recursive: true });
			await promises.appendFile(this.logPath, `${(/* @__PURE__ */ new Date()).toISOString()} [${level}] ${message}\n`, "utf8");
		} catch {}
	}
	/**
	* Traffic is reported only when the proxy runtime itself printed a `stats:`
	* line. The previous fallback summed `IOReadBytesPersec`/`IOWriteBytesPersec`
	* of the whole process tree — that counter includes file, pipe and registry
	* I/O, so it displayed numbers that were not proxied traffic at all. An
	* honest "нет данных" is better than a fabricated counter, and it removes two
	* PowerShell process sweeps from every 3-second status poll.
	*/
	readRuntimeTraffic(logLines) {
		const now = Date.now();
		if (this.trafficCache && this.trafficCache.expiresAt > now) return this.trafficCache.value;
		let value = {
			rx: 0,
			tx: 0,
			source: "runtime-stats-unavailable"
		};
		for (let index = logLines.length - 1; index >= 0; index -= 1) {
			const totals = parseTelegramProxyLogTrafficTotals(logLines[index]);
			if (totals) {
				value = {
					rx: totals.downBytes,
					tx: totals.upBytes,
					source: "runtime-stats"
				};
				break;
			}
		}
		this.trafficCache = {
			value,
			expiresAt: Date.now() + TELEGRAM_PROXY_TRAFFIC_CACHE_TTL_MS
		};
		return value;
	}
	async shouldCheckUpdates() {
		return (await this.readConfig()).checkUpdates;
	}
	async ensureConfigExists() {
		await this.migrateLegacyStateIfNeeded();
		await promises.mkdir(this.appDataDir, { recursive: true });
		if (!await this.pathExists(this.configPath)) await this.writeConfig(normalizeTelegramProxyConfig(null, {
			host: "127.0.0.1",
			port: 1443,
			secret: randomBytes(16).toString("hex"),
			dcIp: [],
			verbose: false,
			bufKb: 256,
			poolSize: 8,
			logMaxMb: 5,
			checkUpdates: true
		}));
	}
	async readConfig() {
		await this.ensureConfigExists();
		try {
			return normalizeTelegramProxyConfig(JSON.parse(await promises.readFile(this.configPath, "utf8")));
		} catch {
			return normalizeTelegramProxyConfig(null);
		}
	}
	async writeConfig(config) {
		await promises.mkdir(this.appDataDir, { recursive: true });
		await promises.writeFile(this.configPath, `${JSON.stringify(toRawConfig(config), null, 2)}\n`, "utf8");
	}
	async readManagedState() {
		try {
			const raw = JSON.parse(await promises.readFile(this.statePath, "utf8"));
			return {
				pid: typeof raw.pid === "number" ? raw.pid : null,
				startedAt: typeof raw.startedAt === "string" ? raw.startedAt : (/* @__PURE__ */ new Date()).toISOString()
			};
		} catch {
			return null;
		}
	}
	async writeManagedState(state) {
		await promises.writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	}
	async clearManagedState() {
		await promises.rm(this.statePath, { force: true });
	}
	async isStateRunning(state) {
		if (!state?.pid) return false;
		return this.isPidRunning(state.pid);
	}
	async isPidRunning(pid) {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}
	async ensureManagedRuntimeInstalled(options) {
		const managedRuntime = await this.getManagedRuntimeInfo();
		const bundledRuntime = await this.getBundledRuntimeInfo();
		const managedRuntimePath = path.join(this.runtimeDir, TG_WS_PROXY_MANAGED_EXE_NAME);
		if (!bundledRuntime) return managedRuntime;
		if (!(options?.force === true || !managedRuntime || managedRuntime.runtimePath !== managedRuntimePath || this.isIncomingVersionNewer(bundledRuntime.version, managedRuntime.version) || this.needsManagedRuntimeRepair(bundledRuntime, managedRuntime))) return managedRuntime;
		await promises.mkdir(this.runtimeDir, { recursive: true });
		await this.prepareManagedRuntimeDestination(managedRuntimePath);
		await this.copyRuntimeWithRetries(bundledRuntime.runtimePath, managedRuntimePath);
		this.sha256Cache.delete(managedRuntimePath);
		const expectedSha256 = await this.sha256File(bundledRuntime.runtimePath);
		const installedSha256 = await this.sha256File(managedRuntimePath);
		if (!expectedSha256 || !installedSha256 || expectedSha256 !== installedSha256) {
			await promises.rm(path.join(this.runtimeDir, TG_WS_PROXY_VERSION_FILE), { force: true }).catch(() => void 0);
			throw new Error("Runtime TG WS Proxy не совпал по SHA-256 после копирования: обновление не применено. Закройте прокси и повторите.");
		}
		await promises.writeFile(path.join(this.runtimeDir, TG_WS_PROXY_VERSION_FILE), `${bundledRuntime.version ?? "bundled"}\n`, "utf8");
		if (this.isHeadlessRuntime(bundledRuntime)) await promises.writeFile(path.join(this.runtimeDir, TG_WS_PROXY_FLAVOR_FILE), `${bundledRuntime.flavor ?? TG_WS_PROXY_DESIRED_FLAVOR}\n`, "utf8");
		return {
			sourceDir: this.runtimeDir,
			runtimePath: managedRuntimePath,
			version: bundledRuntime.version,
			flavor: bundledRuntime.flavor
		};
	}
	async getLatestUpstreamVersion() {
		return normalizeVersionTag((await resolveLatestGitHubRelease(TG_WS_PROXY_RELEASE_API_URL, {
			"User-Agent": "EgoistShield/TelegramProxy",
			Accept: "application/vnd.github+json"
		})).tag_name);
	}
	async prepareManagedRuntimeDestination(runtimePath) {
		await this.stopProcessesUsingManagedRuntime(runtimePath);
		await promises.rm(runtimePath, { force: true });
	}
	async copyRuntimeWithRetries(sourcePath, targetPath) {
		const retryableCodes = /* @__PURE__ */ new Set(["EBUSY", "EPERM"]);
		let lastError;
		for (let attempt = 0; attempt < 5; attempt += 1) try {
			await promises.copyFile(sourcePath, targetPath);
			return;
		} catch (error) {
			lastError = error;
			const code = error instanceof Error && "code" in error ? String(error.code ?? "") : "";
			if (!retryableCodes.has(code) || attempt === 4) throw error;
			await this.stopProcessesUsingManagedRuntime(targetPath);
			await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
		}
		throw lastError instanceof Error ? lastError : /* @__PURE__ */ new Error("Не удалось скопировать runtime TG WS Proxy.");
	}
	async stopProcessesUsingManagedRuntime(runtimePath) {
		const target = path.win32.normalize(runtimePath).replace(/'/g, "''");
		const script = [
			"$ErrorActionPreference = 'Stop'",
			`$target = [System.IO.Path]::GetFullPath('${target}')`,
			"$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [string]::Equals([System.IO.Path]::GetFullPath($_.ExecutablePath), $target, [System.StringComparison]::OrdinalIgnoreCase) })",
			"foreach ($item in $processes) { Stop-Process -Id $item.ProcessId -Force -ErrorAction Stop }"
		].join("; ");
		await execFileAsync$3(resolveWindowsExecutable("powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, timeout: 10000 });
		await this.clearManagedState();
	}
	async stopStaleTelegramProxyProcesses() {
		const service = await this.queryServiceStatus();
		if (service.running) return;
		// Unknown executables and command-line mentions are not proof of ownership.
		for (const name of TG_WS_PROXY_MANAGED_CANDIDATES) {
			await this.stopProcessesUsingManagedRuntime(path.join(this.runtimeDir, name));
		}
	}

	async getProcessTreePids(rootPid) {
		const script = buildTelegramProxyProcessTreeScript(rootPid);
		try {
			const { stdout } = await execFileAsync$3(resolveWindowsExecutable("powershell.exe"), [
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				script
			], {
				windowsHide: true,
				timeout: 8e3
			});
			const pids = stdout.split(/\r?\n/).map((line) => Number.parseInt(line.trim(), 10)).filter((value) => Number.isInteger(value) && value > 0);
			return Array.from(/* @__PURE__ */ new Set([rootPid, ...pids]));
		} catch {
			return [rootPid];
		}
	}
	async getManagedRuntimeInfo() {
		return this.findRuntimeInfo([this.runtimeDir], TG_WS_PROXY_MANAGED_CANDIDATES);
	}
	async getBundledRuntimeInfo() {
		const execResourcesPath = path.join(path.dirname(process.execPath), "resources");
		const candidates = [
			path.join(this.resourcesPath, "runtime", "tg-ws-proxy"),
			path.join(this.resourcesPath, "resources", "runtime", "tg-ws-proxy"),
			path.join(this.resourcesPath, "app.asar.unpacked", "runtime", "tg-ws-proxy"),
			path.join(this.resourcesPath, "resources", "app.asar.unpacked", "runtime", "tg-ws-proxy"),
			path.join(this.appPath, "runtime", "tg-ws-proxy"),
			path.join(this.appPath, "resources", "runtime", "tg-ws-proxy"),
			path.join(this.appPath, "app.asar.unpacked", "runtime", "tg-ws-proxy"),
			path.join(this.appPath, "resources", "app.asar.unpacked", "runtime", "tg-ws-proxy"),
			path.join(execResourcesPath, "runtime", "tg-ws-proxy"),
			path.join(execResourcesPath, "resources", "runtime", "tg-ws-proxy"),
			path.join(execResourcesPath, "app.asar.unpacked", "runtime", "tg-ws-proxy"),
			path.join(execResourcesPath, "resources", "app.asar.unpacked", "runtime", "tg-ws-proxy"),
			path.join(process.cwd(), "runtime", "tg-ws-proxy"),
			path.join(process.cwd(), "resources", "runtime", "tg-ws-proxy")
		];
		return this.findRuntimeInfo(candidates, TG_WS_PROXY_BUNDLED_CANDIDATES);
	}
	async findRuntimeInfo(candidateDirs, candidateFiles) {
		const uniqueDirs = Array.from(new Set(candidateDirs));
		for (const candidateDir of uniqueDirs) for (const candidateFile of candidateFiles) {
			const runtimePath = path.join(candidateDir, candidateFile);
			if (await this.pathExists(runtimePath)) {
				const explicitFlavor = await this.readRuntimeFlavor(candidateDir);
				return {
					sourceDir: candidateDir,
					runtimePath,
					version: await readVersionFile(path.join(candidateDir, TG_WS_PROXY_VERSION_FILE)),
					flavor: explicitFlavor ?? (candidateFile === TG_WS_PROXY_BUNDLED_ASSET_NAME ? TG_WS_PROXY_DESIRED_FLAVOR : null)
				};
			}
		}
		return null;
	}
	isIncomingVersionNewer(nextVersion, currentVersion) {
		if (!nextVersion) return false;
		if (!currentVersion) return true;
		return compareLooseVersions(nextVersion, currentVersion) > 0;
	}
	pickNewerVersion(left, right) {
		if (!left) return right;
		if (!right) return left;
		return compareLooseVersions(left, right) >= 0 ? left : right;
	}
	isHeadlessRuntime(runtime) {
		return this.isHeadlessFlavor(runtime?.flavor);
	}
	isHeadlessFlavor(flavor) {
		return flavor?.trim().toLowerCase().startsWith(TG_WS_PROXY_HEADLESS_FLAVOR_PREFIX) ?? false;
	}
	normalizeFlavor(flavor) {
		const normalized = flavor?.trim().toLowerCase();
		return normalized ? normalized : null;
	}
	needsManagedRuntimeRepair(bundledRuntime, managedRuntime) {
		if (!bundledRuntime || !managedRuntime) return false;
		const bundledFlavor = this.normalizeFlavor(bundledRuntime.flavor);
		const managedFlavor = this.normalizeFlavor(managedRuntime.flavor);
		if (bundledFlavor && bundledFlavor !== managedFlavor) return true;
		return this.isHeadlessRuntime(bundledRuntime) && !this.isHeadlessRuntime(managedRuntime);
	}
	async readRuntimeFlavor(runtimeDir) {
		try {
			return (await promises.readFile(path.join(runtimeDir, TG_WS_PROXY_FLAVOR_FILE), "utf8")).trim() || null;
		} catch {
			return null;
		}
	}
	async ensureServiceWrapperInstalled() {
		const wrapperDir = path.join(this.appDataDir, "service-wrapper");
		const wrapperPath = path.join(wrapperDir, TG_WS_PROXY_SERVICE_EXE_NAME);
		if (await this.pathExists(wrapperPath)) return wrapperPath;
		const sourcePath = await this.findServiceWrapperSource();
		if (!sourcePath) throw new Error("WinSW service-wrapper не найден во встроенных ресурсах EgoistShield.");
		await promises.mkdir(wrapperDir, { recursive: true });
		await promises.copyFile(sourcePath, wrapperPath);
		return wrapperPath;
	}
	async getServiceWrapperPath() {
		return this.ensureServiceWrapperInstalled();
	}
	/** Never provisions and never throws: used by stop/remove, which must always work. */
	async findExistingServiceWrapperPath() {
		const wrapperPath = path.join(this.appDataDir, "service-wrapper", TG_WS_PROXY_SERVICE_EXE_NAME);
		return await this.pathExists(wrapperPath) ? wrapperPath : null;
	}
	async findServiceWrapperSource() {
		const execResourcesPath = path.join(path.dirname(process.execPath), "resources");
		const candidates = [
			path.join(this.resourcesPath, "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe"),
			path.join(this.resourcesPath, "resources", "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe"),
			path.join(this.resourcesPath, "app.asar.unpacked", "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe"),
			path.join(this.resourcesPath, "resources", "app.asar.unpacked", "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe"),
			path.join(this.appPath, "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe"),
			path.join(this.appPath, "resources", "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe"),
			path.join(this.appPath, "app.asar.unpacked", "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe"),
			path.join(this.appPath, "resources", "app.asar.unpacked", "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe"),
			path.join(execResourcesPath, "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe"),
			path.join(execResourcesPath, "resources", "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe"),
			path.join(execResourcesPath, "app.asar.unpacked", "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe"),
			path.join(execResourcesPath, "resources", "app.asar.unpacked", "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe"),
			path.join(process.cwd(), "resources", "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe")
		];
		for (const candidate of candidates) if (await this.pathExists(candidate)) return candidate;
		return null;
	}
	async writeServiceWrapperConfig(runtime) {
		const config = await this.readConfig();
		await promises.mkdir(this.appDataDir, { recursive: true });
		const wrapperPath = await this.ensureServiceWrapperInstalled();
		const logDir = path.join(this.appDataDir, "service-logs");
		await promises.mkdir(logDir, { recursive: true });
		await this.writeConfig(config);
		const args = this.buildRuntimeArgs(config).map(quoteWindowsArgument).join(" ");
		const xml = [
			"<service>",
			`  <id>${escapeXmlText$1(TG_WS_PROXY_SERVICE_NAME)}</id>`,
			`  <name>${escapeXmlText$1(TG_WS_PROXY_SERVICE_DISPLAY_NAME)}</name>`,
			"  <description>Фоновая служба EgoistShield для встроенного Telegram Proxy.</description>",
			"  <startmode>Automatic</startmode>",
			"  <delayedAutoStart>false</delayedAutoStart>",
			"  <hidewindow>true</hidewindow>",
			`  <executable>${escapeXmlText$1(runtime.runtimePath)}</executable>`,
			`  <arguments>${escapeXmlText$1(args)}</arguments>`,
			`  <workingdirectory>${escapeXmlText$1(path.dirname(runtime.runtimePath))}</workingdirectory>`,
			"  <stoptimeout>15 sec</stoptimeout>",
			"  <stopparentprocessfirst>false</stopparentprocessfirst>",
			`  <logpath>${escapeXmlText$1(logDir)}</logpath>`,
			"  <log mode=\"roll-by-size\">",
			"    <sizeThreshold>10485760</sizeThreshold>",
			"    <keepFiles>5</keepFiles>",
			"  </log>",
			"  <onfailure action=\"restart\" delay=\"5 sec\"/>",
			"  <onfailure action=\"restart\" delay=\"10 sec\"/>",
			"  <resetfailure>1 hour</resetfailure>",
			"</service>",
			""
		].join("\n");
		const xmlPath = wrapperPath.replace(/\.exe$/i, ".xml");
		if (await promises.readFile(xmlPath, "utf8").catch(() => null) === xml) return {
			changed: false,
			xmlPath
		};
		await promises.writeFile(xmlPath, xml, "utf8");
		return {
			changed: true,
			xmlPath
		};
	}
	/**
	* Проверяет ФАКТИЧЕСКИ применённые параметры автозапуска и восстановления.
	*
	* MED-03: команды `sc config/failure/failureflag` выполнялись с подавлением
	* ошибок, поэтому интерфейс мог показывать обещанный автозапуск, ни разу его
	* не подтвердив. Вывод `sc.exe` локализован и не является машинным API,
	* поэтому фактическое состояние читается из служебного раздела реестра SCM.
	*/
	async ensureServicePersistence() {
		let verification = await this.verifyServiceRecoveryConfiguration();
		if (verification.ok) return verification;
		await this.appendProxyLog("WARN", `Параметры фоновой службы требуют восстановления: ${verification.details.join("; ")}`);
		if (this.coreService) {
			await this.coreService.removeOwnedService(TG_WS_PROXY_SERVICE_NAME);
			if (!await this.waitForServiceState("not-installed", 12e3)) throw new Error(`Служба ${TG_WS_PROXY_SERVICE_NAME} не удалилась перед восстановлением автозапуска.`);
			await this.coreService.installOwnedService(TG_WS_PROXY_SERVICE_NAME);
		} else await this.configureServiceRecovery();
		verification = await this.verifyServiceRecoveryConfiguration();
		if (!verification.ok) throw new Error(`Не удалось подтвердить Automatic + restart recovery для ${TG_WS_PROXY_SERVICE_NAME}: ${verification.details.join("; ")}`);
		return verification;
	}
	async verifyServiceRecoveryConfiguration() {
		const details = [];
		let startTypeAuto = false;
		let delayedAutoStart = false;
		let failureActionsConfigured = false;
		let failureFlagSet = false;
		try {
			const script = [
				`$key = Get-Item -LiteralPath '${`Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\${TG_WS_PROXY_SERVICE_NAME}`}' -ErrorAction Stop`,
				"$start = $key.GetValue('Start', $null)",
				"$delayed = $key.GetValue('DelayedAutoStart', 0)",
				"$failure = $key.GetValue('FailureActions', $null)",
				"$failureFlag = $key.GetValue('FailureActionsOnNonCrashFailures', 0)",
				"$failureBytes = if ($failure -is [byte[]]) { $failure.Length } else { 0 }",
				"[pscustomobject]@{ start = [int]$start; delayed = [int]$delayed; failureBytes = [int]$failureBytes; failureFlag = [int]$failureFlag } | ConvertTo-Json -Compress"
			].join("; ");
			const { stdout } = await execFileAsync$3(resolveWindowsExecutable("powershell.exe"), [
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				script
			], {
				windowsHide: true,
				timeout: 120e3,
				maxBuffer: 1024 * 1024
			});
			const registry = JSON.parse(stdout.trim());
			startTypeAuto = registry.start === 2;
			delayedAutoStart = registry.delayed === 1;
			failureActionsConfigured = Number(registry.failureBytes ?? 0) > 0;
			failureFlagSet = registry.failureFlag === 1;
		} catch (error) {
			details.push(`registry read: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!startTypeAuto) details.push("Start не равен 2 (Automatic)");
		if (!failureActionsConfigured) details.push("FailureActions отсутствует или пуст");
		if (!failureFlagSet) details.push("FailureActionsOnNonCrashFailures не выставлен");
		const ok = startTypeAuto && failureActionsConfigured && failureFlagSet;
		if (!ok) await this.appendProxyLog("WARN", `Конфигурация автозапуска службы подтверждена не полностью: ${details.join("; ")}`);
		return {
			ok,
			startTypeAuto,
			delayedAutoStart,
			failureActionsConfigured,
			failureFlagSet,
			details
		};
	}
	async execServiceWrapper(wrapperPath, args, ignoreFailure) {
		try {
			return await execFileAsync$3(wrapperPath, args, {
				windowsHide: true,
				timeout: 3e4
			});
		} catch (error) {
			if (ignoreFailure) return null;
			throw error;
		}
	}
	async configureServiceRecovery() {
		const sc = resolveWindowsExecutable("sc.exe");
		await execFileAsync$3(sc, [
			"config",
			TG_WS_PROXY_SERVICE_NAME,
			"start=",
			"auto"
		], {
			windowsHide: true,
			timeout: 15e3
		}).catch(() => void 0);
		await execFileAsync$3(resolveWindowsExecutable("reg.exe"), [
			"add",
			`HKLM\\SYSTEM\\CurrentControlSet\\Services\\${TG_WS_PROXY_SERVICE_NAME}`,
			"/v",
			"DelayedAutoStart",
			"/t",
			"REG_DWORD",
			"/d",
			"0",
			"/f"
		], {
			windowsHide: true,
			timeout: 15e3
		}).catch(() => void 0);
		await execFileAsync$3(sc, [
			"failure",
			TG_WS_PROXY_SERVICE_NAME,
			"reset=",
			"86400",
			"actions=",
			"restart/5000/restart/10000/restart/30000"
		], {
			windowsHide: true,
			timeout: 15e3
		}).catch(() => void 0);
		await execFileAsync$3(sc, [
			"config",
			TG_WS_PROXY_SERVICE_NAME,
			"depend=",
			"Tcpip/Afd"
		], {
			windowsHide: true,
			timeout: 15e3
		}).catch(() => void 0);
		await execFileAsync$3(sc, [
			"failureflag",
			TG_WS_PROXY_SERVICE_NAME,
			"1"
		], {
			windowsHide: true,
			timeout: 15e3
		}).catch(() => void 0);
	}
	async queryServiceStatus() {
		const coreStatus = await this.queryServiceStatusViaCore();
		if (coreStatus) return coreStatus;
		try {
			const { stdout } = await execFileAsync$3(resolveWindowsExecutable("sc.exe"), ["queryex", TG_WS_PROXY_SERVICE_NAME], {
				windowsHide: true,
				timeout: 8e3
			});
			const rawState = parseScServiceState(stdout) ?? "UNKNOWN";
			const pidRaw = /PID\s*:\s*(\d+)/i.exec(stdout)?.[1];
			const pid = pidRaw ? Number.parseInt(pidRaw, 10) : null;
			const state = this.normalizeServiceState(rawState);
			if (state === "unknown") {
				const controllerStatus = await this.queryServiceStatusViaServiceController();
				if (controllerStatus) return controllerStatus;
				const cimStatus = await this.queryServiceStatusViaCim();
				if (cimStatus) return cimStatus;
			}
			return {
				installed: true,
				running: state === "running",
				state,
				rawState,
				pid: typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null
			};
		} catch {
			const controllerStatus = await this.queryServiceStatusViaServiceController();
			if (controllerStatus) return controllerStatus;
			return await this.queryServiceStatusViaCim() ?? {
				installed: false,
				running: false,
				state: "not-installed",
				rawState: null,
				pid: null
			};
		}
	}
	async queryServiceStatusViaCore() {
		if (!this.coreService) return null;
		try {
			const value = await this.coreService.ownedServiceStatus(TG_WS_PROXY_SERVICE_NAME);
			if (!isRecord(value) || typeof value.installed !== "boolean" || typeof value.state !== "string") return null;
			if (!value.installed) return {
				installed: false,
				running: false,
				state: "not-installed",
				rawState: "not-installed",
				pid: null
			};
			const rawState = value.state.trim();
			const state = this.normalizeServiceState(rawState.toUpperCase().replace(/[\s-]+/g, "_"));
			return {
				installed: true,
				running: state === "running",
				state,
				rawState,
				pid: null
			};
		} catch {
			return null;
		}
	}
	async queryServiceStatusViaServiceController() {
		const script = [
			`$svc = Get-Service -Name '${TG_WS_PROXY_SERVICE_NAME}' -ErrorAction SilentlyContinue`,
			"if ($null -eq $svc) { 'not-installed'; exit 0 }",
			"[string]$svc.Status"
		].join("; ");
		try {
			const { stdout } = await execFileAsync$3(resolveWindowsExecutable("powershell.exe"), [
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				script
			], {
				windowsHide: true,
				timeout: 8e3
			});
			const rawState = stdout.trim();
			if (rawState === "not-installed") return {
				installed: false,
				running: false,
				state: "not-installed",
				rawState: null,
				pid: null
			};
			const state = this.normalizeServiceState(rawState.toUpperCase().replace(/[\s-]+/g, "_"));
			return {
				installed: true,
				running: state === "running",
				state,
				rawState,
				pid: null
			};
		} catch {
			return null;
		}
	}
	async queryServiceStatusViaCim() {
		const script = [
			`$svc = Get-CimInstance Win32_Service -Filter "Name='${TG_WS_PROXY_SERVICE_NAME}'" -ErrorAction SilentlyContinue`,
			"if ($null -eq $svc) { 'not-installed|0'; exit 0 }",
			"$state = [string]$svc.State",
			"$pid = [int]($svc.ProcessId)",
			"'{0}|{1}' -f $state, $pid"
		].join("; ");
		try {
			const { stdout } = await execFileAsync$3(resolveWindowsExecutable("powershell.exe"), [
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				script
			], {
				windowsHide: true,
				timeout: 8e3
			});
			const [rawState = "unknown", rawPid = "0"] = stdout.trim().split("|");
			if (rawState === "not-installed") return {
				installed: false,
				running: false,
				state: "not-installed",
				rawState: null,
				pid: null
			};
			const state = this.normalizeServiceState(rawState.toUpperCase().replace(/\s+/g, "_"));
			const pid = Number.parseInt(rawPid, 10);
			return {
				installed: true,
				running: state === "running",
				state,
				rawState,
				pid: typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null
			};
		} catch {
			return null;
		}
	}
	normalizeServiceState(rawState) {
		if (rawState === "RUNNING") return "running";
		if (rawState === "STARTED") return "running";
		if (rawState === "STOPPED") return "stopped";
		if (rawState === "STOP") return "stopped";
		if (rawState === "START_PENDING") return "start-pending";
		if (rawState === "STARTPENDING") return "start-pending";
		if (rawState === "STOP_PENDING") return "stop-pending";
		if (rawState === "STOPPENDING") return "stop-pending";
		return "unknown";
	}
	/**
	* Readiness requires the SCM to report RUNNING *and* the port to answer. The
	* previous condition accepted `status.installed`, which is true for a stopped
	* service — so an unrelated process squatting on 1443 made a dead service
	* look successfully started.
	*/
	async waitForServiceReady(port, timeoutMs) {
		const deadline = Date.now() + timeoutMs;
		let lastState = "unknown";
		let lastPortOpen = false;
		while (Date.now() < deadline) {
			const status = await this.queryServiceStatus();
			lastState = status.state;
			lastPortOpen = await this.isLocalTcpPortOpen(port);
			if (status.running && lastPortOpen) return;
			if (status.state === "stopped" || status.state === "not-installed") break;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		const portHint = lastPortOpen ? `порт 127.0.0.1:${port} занят другим процессом` : `порт 127.0.0.1:${port} не отвечает`;
		throw new Error(`Служба ${TG_WS_PROXY_SERVICE_NAME} не подтвердила запуск: состояние ${lastState}, ${portHint}.`);
	}
	/** Returns whether the state was reached; callers decide if a timeout is fatal. */
	async waitForServiceState(expectedState, timeoutMs) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const status = await this.queryServiceStatus();
			if (status.state === expectedState) return true;
			if (expectedState === "stopped" && status.state === "not-installed") return true;
			await new Promise((resolve) => setTimeout(resolve, 400));
		}
		return (await this.queryServiceStatus()).state === expectedState;
	}
	async execSc(args, ignoreFailure) {
		try {
			await execFileAsync$3(resolveWindowsExecutable("sc.exe"), args, {
				windowsHide: true,
				timeout: 2e4
			});
		} catch (error) {
			if (!ignoreFailure) throw error;
		}
	}
	async isLocalTcpPortOpen(port) {
		return new Promise((resolve) => {
			const socket = createConnection({
				host: "127.0.0.1",
				port,
				timeout: 800
			}, () => {
				socket.destroy();
				resolve(true);
			});
			socket.on("error", () => {
				socket.destroy();
				resolve(false);
			});
			socket.on("timeout", () => {
				socket.destroy();
				resolve(false);
			});
		});
	}
	buildRuntimeArgs(config) {
		return buildTelegramProxyRuntimeArgs(config, this.logPath);
	}
	async migrateLegacyStateIfNeeded() {
		if (await this.pathExists(this.configPath)) return;
		await promises.mkdir(this.appDataDir, { recursive: true });
		const legacyRoots = [path.join(this.userDataDir, TG_WS_PROXY_INTERNAL_DIR), this.legacyAppDataDir].filter((candidate, index, values) => path.resolve(candidate) !== path.resolve(this.appDataDir) && values.findIndex((value) => path.resolve(value) === path.resolve(candidate)) === index);
		for (const legacyRoot of legacyRoots) {
			const candidates = [
				[path.join(legacyRoot, "config.json"), this.configPath],
				[path.join(legacyRoot, "proxy.log"), this.logPath],
				[path.join(legacyRoot, ".first_run_done_mtproto"), this.firstRunMarkerPath],
				[path.join(this.userDataDir, "telegram-proxy-state.json"), this.statePath]
			];
			for (const [source, destination] of candidates) if (!await this.pathExists(destination) && await this.pathExists(source)) await promises.copyFile(source, destination);
			if (await this.pathExists(this.configPath)) break;
		}
	}
	async pathExists(targetPath) {
		try {
			await promises.access(targetPath);
			return true;
		} catch {
			return false;
		}
	}
};
//#endregion
