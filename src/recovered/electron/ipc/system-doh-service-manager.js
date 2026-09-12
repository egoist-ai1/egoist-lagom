//#region src/electron/ipc/system-doh-service-manager.ts
var execFileAsync$4 = promisify(execFile);
var SYSTEM_DOH_SERVICE_NAME = "EgoistShieldSystemDoH";
var SYSTEM_DOH_SERVICE_DISPLAY_NAME = "Egoist Shield System DoH";
var SYSTEM_DOH_SERVICE_EXE_NAME = "egoistshield-system-doh-service.exe";
var SYSTEM_DOH_EXE_NAME = "xray-system-doh.exe";
var XRAY_SOURCE_EXE_NAME = "xray.exe";
var VERSION_FILE_NAME = "VERSION.txt";
var READY_TIMEOUT_MS = 2e4;
var READY_POLL_INTERVAL_MS = 300;
var QUERY_TIMEOUT_MS = 2e3;
var STATUS_CACHE_TTL_MS = 3e3;
var DNS_QUERY_ID = 4660;
var SC_SERVICE_STATE_BY_CODE$2 = {
	1: "STOPPED",
	2: "START_PENDING",
	3: "STOP_PENDING",
	4: "RUNNING",
	5: "CONTINUE_PENDING",
	6: "PAUSE_PENDING",
	7: "PAUSED"
};
function delay$1(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function parseScServiceState$1(stdout) {
	for (const line of stdout.split(/\r?\n/)) {
		const match = /^\s*[^:\r\n]+:\s*([1-7])\s+([A-Z_]+)\s*$/i.exec(line);
		if (!match) continue;
		const rawState = match[2].toUpperCase();
		if (SC_SERVICE_STATE_BY_CODE$2[match[1]] === rawState) return rawState;
	}
	return null;
}
function escapeXmlText$2(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function quoteWindowsArgument$1(value) {
	if (!/[\s"]/u.test(value)) return value;
	return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}
function createDnsQuery(domain) {
	const parts = [Buffer.from([
		18,
		52,
		1,
		0,
		0,
		1,
		0,
		0,
		0,
		0,
		0,
		0
	])];
	for (const label of domain.split(".").filter(Boolean)) {
		const encoded = Buffer.from(label, "ascii");
		parts.push(Buffer.from([encoded.length]), encoded);
	}
	parts.push(Buffer.from([
		0,
		0,
		1,
		0,
		1
	]));
	return Buffer.concat(parts);
}
function hasSuccessfulDnsAnswer(buffer) {
	if (buffer.length < 12) return false;
	const transactionId = buffer.readUInt16BE(0);
	const flags = buffer.readUInt16BE(2);
	const response = (flags & 32768) === 32768;
	const rcode = flags & 15;
	const answerCount = buffer.readUInt16BE(6);
	return transactionId === DNS_QUERY_ID && response && rcode === 0 && answerCount > 0;
}
function queryDnsServer(address, port, domain) {
	return new Promise((resolve, reject) => {
		const socket = createSocket(address.includes(":") ? "udp6" : "udp4");
		const cleanup = () => {
			try {
				socket.close();
			} catch {}
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(/* @__PURE__ */ new Error("DNS readiness probe timed out."));
		}, QUERY_TIMEOUT_MS);
		socket.once("error", (error) => {
			clearTimeout(timer);
			cleanup();
			reject(error);
		});
		socket.once("message", (message) => {
			clearTimeout(timer);
			cleanup();
			if (!hasSuccessfulDnsAnswer(message)) {
				reject(/* @__PURE__ */ new Error(`Local DNS service did not resolve ${domain}.`));
				return;
			}
			resolve(true);
		});
		socket.send(createDnsQuery(domain), port, address, (error) => {
			if (!error) return;
			clearTimeout(timer);
			cleanup();
			reject(error);
		});
	});
}
function buildSystemDohServiceXml(options) {
	const argumentsText = [
		"run",
		"-c",
		options.configPath
	].map(quoteWindowsArgument$1).join(" ");
	return [
		"<service>",
		`  <id>${SYSTEM_DOH_SERVICE_NAME}</id>`,
		`  <name>${SYSTEM_DOH_SERVICE_DISPLAY_NAME}</name>`,
		"  <description>Фоновая Windows-служба Egoist Shield для локального защищённого DNS-over-HTTPS.</description>",
		"  <startmode>Automatic</startmode>",
		"  <delayedAutoStart>false</delayedAutoStart>",
		"  <hidewindow>true</hidewindow>",
		`  <executable>${escapeXmlText$2(options.runtimePath)}</executable>`,
		`  <arguments>${escapeXmlText$2(argumentsText)}</arguments>`,
		`  <workingdirectory>${escapeXmlText$2(options.workingDirectory)}</workingdirectory>`,
		"  <stoptimeout>15 sec</stoptimeout>",
		"  <stopparentprocessfirst>false</stopparentprocessfirst>",
		`  <logpath>${escapeXmlText$2(options.serviceLogDirectory)}</logpath>`,
		"  <log mode=\"roll-by-size\">",
		"    <sizeThreshold>10485760</sizeThreshold>",
		"    <keepFiles>5</keepFiles>",
		"  </log>",
		"  <onfailure action=\"restart\" delay=\"5 sec\"/>",
		"  <onfailure action=\"restart\" delay=\"10 sec\"/>",
		"  <onfailure action=\"restart\" delay=\"30 sec\"/>",
		"  <resetfailure>1 day</resetfailure>",
		"</service>",
		""
	].join("\n");
}
var SystemDohManager = class {
	resourcesPath;
	appPath;
	userDataDir;
	coreService;
	runtimeDir;
	workDir;
	configPath;
	logPath;
	statePath;
	versionPath;
	serviceWrapperDir;
	serviceWrapperPath;
	serviceWrapperConfigPath;
	serviceLogDir;
	lastError = null;
	statusCache = null;
	statusInFlight = null;
	legacyStateMigrated = false;
	constructor(resourcesPath, appPath, userDataDir, protectedComponentRoot, coreService) {
		this.resourcesPath = resourcesPath;
		this.appPath = appPath;
		this.userDataDir = userDataDir;
		this.coreService = coreService;
		this.runtimeDir = protectedComponentRoot ? path.join(protectedComponentRoot, "runtime") : path.join(this.userDataDir, "runtime", "system-doh");
		this.workDir = protectedComponentRoot ?? path.join(this.userDataDir, "system-doh");
		this.configPath = path.join(this.workDir, "config.json");
		this.logPath = path.join(this.workDir, "runtime.log");
		this.statePath = path.join(this.workDir, "state.json");
		this.versionPath = path.join(this.runtimeDir, VERSION_FILE_NAME);
		this.serviceWrapperDir = path.join(this.workDir, "service-wrapper");
		this.serviceWrapperPath = path.join(this.serviceWrapperDir, SYSTEM_DOH_SERVICE_EXE_NAME);
		this.serviceWrapperConfigPath = this.serviceWrapperPath.replace(/\.exe$/i, ".xml");
		this.serviceLogDir = path.join(this.workDir, "service-logs");
	}
	async status(options = {}) {
		const now = Date.now();
		if (!options.force && this.statusCache && this.statusCache.expiresAt > now) return this.statusCache.value;
		if (!options.force && this.statusInFlight) return this.statusInFlight;
		this.statusInFlight = this.readStatus().then((value) => {
			this.statusCache = {
				value,
				expiresAt: Date.now() + STATUS_CACHE_TTL_MS
			};
			return value;
		}).finally(() => {
			this.statusInFlight = null;
		});
		return this.statusInFlight;
	}
	async apply(url, preferredLocalAddress) {
		const normalizedUrl = normalizeSystemDohUrl(url, "");
		if (!normalizedUrl) throw new Error("Укажите DoH URL.");
		const parsed = parseSystemDohUrl(normalizedUrl);
		const hasCustomPort = parsed.serverPort && parsed.serverPort !== 443;
		if (this.coreService && !hasCustomPort) {
			const servers = await resolveSystemDohNativeServers(normalizedUrl);
			await this.stopAndRemove();
			const native = await this.coreService.applyNativeDoh(normalizedUrl, servers, { probeHosts: [...SYSTEM_DOH_VERIFICATION_DOMAINS] });
			this.lastError = null;
			this.invalidateStatusCache();
			return this.mapNativeStatus(native);
		}
		const current = await this.status({ force: true });
		if (current.running && current.serviceInstalled && current.currentUrl === normalizedUrl && current.localAddress === "127.0.0.1") return current;
		const runtime = await this.ensureManagedRuntimeInstalled();
		await this.ensureServiceWrapperInstalled();
		await this.stopAndRemove();
		let lastBindError = null;
		for (const candidate of buildSystemDohLoopbackCandidates(preferredLocalAddress)) {
			const state = {
				pid: null,
				startedAt: (/* @__PURE__ */ new Date()).toISOString(),
				localAddress: candidate,
				localPort: 53,
				url: normalizedUrl
			};
			try {
				await this.prepareConfig(normalizedUrl, candidate);
				await this.writeServiceWrapperConfig(runtime);
				await this.writeManagedState(state);
				await this.installService();
				if (!this.coreService) await this.configureServiceAutostartRecovery();
				await this.startServiceInternal();
				if (!await this.waitUntilReady(state)) throw new Error(`System DoH не отвечает через ${candidate}:53.`);
				const service = await this.queryServiceStatus();
				await this.writeManagedState({
					...state,
					pid: service.pid
				});
				this.lastError = null;
				this.invalidateStatusCache();
				return this.status({ force: true });
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				const logTail = await this.readLogTail();
				const diagnostic = logTail ? `${reason} Xray: ${logTail}` : reason;
				await this.removeServiceInternal().catch(() => void 0);
				await this.stopLegacyStandaloneRuntime();
				await this.clearManagedState();
				if (/bind:|forbidden by its access permissions|Only one usage of each socket address/i.test(diagnostic)) {
					lastBindError = diagnostic;
					continue;
				}
				this.lastError = diagnostic;
				throw new Error(`System DoH не прошёл проверку: ${SYSTEM_DOH_VERIFICATION_DOMAINS.join(", ")} не резолвятся через локальный канал. Детали сохранены в журнале System DoH.`);
			}
		}
		this.lastError = lastBindError ?? "Не удалось найти свободный loopback-адрес для System DoH.";
		throw new Error(this.lastError);
	}
	async stop() {
		if (this.coreService) return this.stopAndRemove();
		await this.stopServiceInternal();
		await this.stopLegacyStandaloneRuntime();
		this.lastError = null;
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async restart() {
		const managedState = await this.readManagedState();
		if (this.coreService && !managedState) {
			const current = await this.coreService.nativeDohStatus();
			if (!current.url) throw new Error("Конфигурация System DoH отсутствует.");
			return this.apply(current.url);
		}
		const state = await this.readManagedState();
		if (state?.url && state.localAddress !== "127.0.0.1") return this.apply(state.url, SYSTEM_DOH_DEFAULT_LOCAL_ADDRESS);
		if (!(await this.queryServiceStatus()).installed) {
			if (!state?.url) throw new Error("Служба System DoH не установлена и сохранённая конфигурация отсутствует.");
			return this.apply(state.url, state.localAddress);
		}
		await this.stopServiceInternal();
		await this.stopLegacyStandaloneRuntime();
		await this.startServiceInternal();
		if (!state || !await this.waitUntilReady(state)) throw new Error("Служба System DoH перезапущена, но локальный DNS не прошёл проверку.");
		const nextService = await this.queryServiceStatus();
		await this.writeManagedState({
			...state,
			pid: nextService.pid,
			startedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		this.lastError = null;
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async stopAndRemove() {
		if (this.coreService) {
			const restored = await this.coreService.restoreOwnedDns();
			if (restored.pendingAdapters > 0) throw new Error("Подключите ранее использованный адаптер для восстановления DNS. Локальная служба сохранена.");
		}
		if (this.coreService && !await this.readManagedState()) {
			const native = await this.coreService.removeNativeDoh();
			await this.removeServiceInternal();
			await this.stopLegacyStandaloneRuntime();
			await this.clearManagedState();
			this.lastError = null;
			this.invalidateStatusCache();
			return this.mapNativeStatus(native);
		}
		await this.removeServiceInternal();
		await this.stopLegacyStandaloneRuntime();
		await this.clearManagedState();
		this.lastError = null;
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async recover(options) {
		const normalizedUrl = normalizeSystemDohUrl(options.url, "");
		if (this.coreService && !await this.readManagedState() && (!normalizedUrl || !parseSystemDohUrl(normalizedUrl).serverPort || parseSystemDohUrl(normalizedUrl).serverPort === 443)) try {
			const current = await this.coreService.nativeDohStatus();
			if (!options.enabled || !normalizedUrl) {
				if (current.enabled) return this.stopAndRemove();
				return this.mapNativeStatus(current);
			}
			if (current.enabled && current.verified && current.url === normalizedUrl) return this.mapNativeStatus(current);
			return this.apply(normalizedUrl, options.localAddress);
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			this.invalidateStatusCache();
			return this.readStatus();
		}
		if (!options.enabled || !normalizedUrl) return this.stopAndRemove();
		try {
			const state = await this.readManagedState();
			const service = await this.queryServiceStatus();
			if (service.installed && state?.url === normalizedUrl && state.localAddress === "127.0.0.1") {
				if (!service.running) await this.startServiceInternal();
				if (await this.waitUntilReady(state)) {
					const nextService = await this.queryServiceStatus();
					await this.writeManagedState({
						...state,
						pid: nextService.pid,
						startedAt: service.running ? state.startedAt : (/* @__PURE__ */ new Date()).toISOString()
					});
					this.lastError = null;
					this.invalidateStatusCache();
					return this.status({ force: true });
				}
			}
			return this.apply(normalizedUrl, options.localAddress);
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			this.invalidateStatusCache();
			return this.status({ force: true });
		}
	}
	async readStatus() {
		if (this.coreService && !await this.readManagedState()) try {
			const native = await this.coreService.nativeDohStatus();
			return this.mapNativeStatus(native);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.lastError = reason;
			return {
				available: false,
				enabled: false,
				running: false,
				verified: false,
				encrypted: false,
				nativeManaged: true,
				pid: null,
				startedAt: null,
				runtimePath: null,
				configPath: "windows://dnsclient/doh",
				logPath: null,
				serviceName: "Dnscache",
				serviceInstalled: false,
				serviceRunning: false,
				serviceState: "unavailable",
				serviceWrapperPath: null,
				localAddress: null,
				localPort: 443,
				currentUrl: null,
				serverAddresses: [],
				fallbackToUdp: false,
				lastError: reason
			};
		}
		await this.migrateLegacyStateIfNeeded();
		const state = await this.readManagedState();
		const service = await this.queryServiceStatus();
		const verified = service.running && state ? await this.verifyDns(state).catch(() => false) : false;
		const [managedRuntime, sourceRuntime] = await Promise.all([this.getManagedRuntimeInfo(), this.getSourceRuntimeInfo()]);
		const runtime = managedRuntime ?? sourceRuntime;
		return {
			available: Boolean(runtime),
			enabled: service.installed && Boolean(state),
			encrypted: service.running && verified,
			nativeManaged: false,
			running: service.running && verified,
			verified,
			pid: service.pid,
			startedAt: service.running ? state?.startedAt ?? null : null,
			runtimePath: runtime?.runtimePath ?? null,
			configPath: this.configPath,
			logPath: this.logPath,
			serviceName: SYSTEM_DOH_SERVICE_NAME,
			serviceInstalled: service.installed,
			serviceRunning: service.running,
			serviceState: service.state,
			serviceWrapperPath: this.serviceWrapperPath,
			localAddress: normalizeSystemDohLocalAddress(state?.localAddress, "") || null,
			localPort: state?.localPort ?? null,
			currentUrl: state?.url || null,
			lastError: this.lastError
		};
	}
	mapNativeStatus(native) {
		return {
			available: true,
			enabled: native.enabled,
			running: native.enabled && native.verified,
			verified: native.verified,
			encrypted: native.encrypted,
			nativeManaged: true,
			pid: null,
			startedAt: native.enabled ? native.updatedAt : null,
			runtimePath: null,
			configPath: "windows://dnsclient/doh",
			logPath: null,
			serviceName: "Dnscache",
			serviceInstalled: false,
			serviceRunning: false,
			serviceState: native.enabled ? "native" : "not-installed",
			serviceWrapperPath: null,
			localAddress: native.servers[0] ?? null,
			localPort: 443,
			currentUrl: native.url,
			serverAddresses: native.servers,
			fallbackToUdp: native.fallbackToUdp,
			lastError: this.lastError
		};
	}
	invalidateStatusCache() {
		this.statusCache = null;
	}
	/**
	* Миграция выполняется не более одного раза за процесс и никогда не роняет
	* чтение статуса: она пишет в защищённый ProgramData, и отказ по правам не
	* должен превращать обычный `system-doh:status` в исключение вместо
	* честного «служба не установлена».
	*/
	async migrateLegacyStateIfNeeded() {
		if (this.legacyStateMigrated) return;
		this.legacyStateMigrated = true;
		const legacyWorkDir = path.join(this.userDataDir, "system-doh");
		if (path.resolve(legacyWorkDir) === path.resolve(this.workDir)) return;
		try {
			await promises.mkdir(this.workDir, { recursive: true });
			for (const fileName of [
				"config.json",
				"state.json",
				"runtime.log"
			]) {
				const source = path.join(legacyWorkDir, fileName);
				const destination = path.join(this.workDir, fileName);
				if (!await this.pathExists(destination) && await this.pathExists(source)) await promises.copyFile(source, destination);
			}
		} catch (error) {
			logger.warn("[system-doh] Не удалось перенести устаревшее состояние:", error instanceof Error ? error.message : String(error));
		}
	}
	async installService() {
		if (this.coreService) await this.coreService.installOwnedService(SYSTEM_DOH_SERVICE_NAME);
		else await this.execServiceWrapper(["install"], false);
		await this.waitForServiceState("stopped", 12e3);
	}
	async startServiceInternal() {
		const service = await this.queryServiceStatus();
		if (!service.installed) throw new Error(`Служба ${SYSTEM_DOH_SERVICE_NAME} не установлена.`);
		if (this.coreService) await this.coreService.installOwnedService(SYSTEM_DOH_SERVICE_NAME);
		if (!service.running) {
			if (this.coreService) await this.coreService.startOwnedService(SYSTEM_DOH_SERVICE_NAME);
			else if (!await this.execServiceWrapper(["start"], true)) await this.execSc(["start", SYSTEM_DOH_SERVICE_NAME], false);
		}
		await this.waitForServiceState("running", 15e3);
		this.invalidateStatusCache();
	}
	async stopServiceInternal() {
		const service = await this.queryServiceStatus();
		if (!service.installed) return;
		if (service.running || service.state === "start-pending") if (this.coreService) await this.coreService.stopOwnedService(SYSTEM_DOH_SERVICE_NAME);
		else {
			await this.execServiceWrapper(["stop"], true);
			await this.execSc(["stop", SYSTEM_DOH_SERVICE_NAME], true);
		}
		await this.waitForServiceState("stopped", 12e3).catch(() => void 0);
		this.invalidateStatusCache();
	}
	async removeServiceInternal() {
		if (!(await this.queryServiceStatus()).installed) return;
		if (this.coreService) await this.coreService.removeOwnedService(SYSTEM_DOH_SERVICE_NAME);
		else {
			await this.stopServiceInternal();
			await this.execServiceWrapper(["uninstall"], true);
			await this.execSc(["delete", SYSTEM_DOH_SERVICE_NAME], true);
		}
		await this.waitForServiceState("not-installed", 12e3);
		this.invalidateStatusCache();
	}
	async configureServiceAutostartRecovery() {
		await this.execSc([
			"config",
			SYSTEM_DOH_SERVICE_NAME,
			"start=",
			"auto"
		], false);
		await this.execSc([
			"failure",
			SYSTEM_DOH_SERVICE_NAME,
			"reset=",
			"86400",
			"actions=",
			"restart/5000/restart/10000/restart/30000"
		], false);
		await this.execSc([
			"config",
			SYSTEM_DOH_SERVICE_NAME,
			"depend=",
			"Tcpip/Afd"
		], false);
		await this.execSc([
			"failureflag",
			SYSTEM_DOH_SERVICE_NAME,
			"1"
		], true);
		await execFileAsync$4(resolveWindowsExecutable("reg.exe"), [
			"add",
			`HKLM\\SYSTEM\\CurrentControlSet\\Services\\${SYSTEM_DOH_SERVICE_NAME}`,
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
		});
	}
	async execServiceWrapper(args, ignoreFailure) {
		if (!await this.pathExists(this.serviceWrapperPath)) {
			if (ignoreFailure) return false;
			throw new Error("WinSW service-wrapper System DoH не найден.");
		}
		try {
			await execFileAsync$4(this.serviceWrapperPath, args, {
				cwd: this.serviceWrapperDir,
				windowsHide: true,
				timeout: 3e4
			});
			return true;
		} catch (error) {
			if (ignoreFailure) return false;
			throw error;
		}
	}
	async execSc(args, ignoreFailure) {
		try {
			await execFileAsync$4(resolveWindowsExecutable("sc.exe"), args, {
				windowsHide: true,
				timeout: 2e4
			});
		} catch (error) {
			if (!ignoreFailure) throw error;
		}
	}
	async queryServiceStatus() {
		try {
			const { stdout } = await execFileAsync$4(resolveWindowsExecutable("sc.exe"), ["queryex", SYSTEM_DOH_SERVICE_NAME], {
				windowsHide: true,
				timeout: 8e3
			});
			const rawState = parseScServiceState$1(stdout) ?? "UNKNOWN";
			const state = this.normalizeServiceState(rawState);
			if (state !== "unknown") {
				const pidRaw = /PID\s*:\s*(\d+)/i.exec(stdout)?.[1];
				const pid = pidRaw ? Number.parseInt(pidRaw, 10) : null;
				return {
					installed: true,
					running: state === "running",
					state,
					rawState,
					pid: Number.isInteger(pid) && Number(pid) > 0 ? pid : null
				};
			}
		} catch {}
		const script = [
			`$svc = Get-CimInstance Win32_Service -Filter "Name='${SYSTEM_DOH_SERVICE_NAME}'" -ErrorAction SilentlyContinue`,
			"if ($null -eq $svc) { 'not-installed|0'; exit 0 }",
			"'{0}|{1}' -f ([string]$svc.State), ([int]$svc.ProcessId)"
		].join("; ");
		try {
			const { stdout } = await execFileAsync$4(resolveWindowsExecutable("powershell.exe"), [
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
			const state = this.normalizeServiceState(rawState);
			const pid = Number.parseInt(rawPid, 10);
			return {
				installed: true,
				running: state === "running",
				state,
				rawState,
				pid: Number.isInteger(pid) && pid > 0 ? pid : null
			};
		} catch {
			return {
				installed: false,
				running: false,
				state: "not-installed",
				rawState: null,
				pid: null
			};
		}
	}
	normalizeServiceState(rawState) {
		switch (rawState.toUpperCase().replace(/\s+/g, "_")) {
			case "RUNNING":
			case "STARTED": return "running";
			case "STOPPED":
			case "STOP": return "stopped";
			case "START_PENDING": return "start-pending";
			case "STOP_PENDING": return "stop-pending";
			case "NOT_INSTALLED":
			case "NOT-INSTALLED": return "not-installed";
			default: return "unknown";
		}
	}
	async waitForServiceState(expected, timeoutMs) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if ((await this.queryServiceStatus()).state === expected) return;
			await delay$1(400);
		}
		const service = await this.queryServiceStatus();
		throw new Error(`Служба ${SYSTEM_DOH_SERVICE_NAME} не перешла в состояние ${expected}. Текущее состояние: ${service.state}.`);
	}
	async ensureManagedRuntimeInstalled() {
		const sourceRuntime = await this.getSourceRuntimeInfo() ?? await this.getManagedRuntimeInfo();
		if (!sourceRuntime) throw new Error("Встроенный runtime Xray для System DoH не найден.");
		await promises.mkdir(this.runtimeDir, { recursive: true });
		const managedRuntimePath = path.join(this.runtimeDir, SYSTEM_DOH_EXE_NAME);
		const installedVersion = await readVersionFile(this.versionPath);
		const sourceVersion = sourceRuntime.version ?? "bundled";
		if (!await this.pathExists(managedRuntimePath) || sourceRuntime.sourceDir !== this.runtimeDir && installedVersion !== sourceVersion) {
			await promises.copyFile(sourceRuntime.runtimePath, managedRuntimePath);
			await promises.writeFile(this.versionPath, `${sourceVersion}\n`, "utf8");
		}
		return {
			sourceDir: this.runtimeDir,
			runtimePath: managedRuntimePath,
			version: sourceVersion
		};
	}
	async getSourceRuntimeInfo() {
		const candidates = [
			path.join(this.userDataDir, "runtime", "xray"),
			path.join(this.resourcesPath, "runtime", "xray"),
			path.join(this.resourcesPath, "resources", "runtime", "xray"),
			path.join(this.resourcesPath, "app.asar.unpacked", "runtime", "xray"),
			path.join(this.appPath, "runtime", "xray"),
			path.join(this.appPath, "resources", "runtime", "xray"),
			path.join(process.cwd(), "resources", "runtime", "xray"),
			path.join(process.cwd(), "runtime", "xray")
		];
		for (const candidate of candidates) {
			const runtimePath = path.join(candidate, XRAY_SOURCE_EXE_NAME);
			if (await this.pathExists(runtimePath)) return {
				sourceDir: candidate,
				runtimePath,
				version: await readVersionFile(path.join(candidate, VERSION_FILE_NAME))
			};
		}
		return null;
	}
	async getManagedRuntimeInfo() {
		const runtimePath = path.join(this.runtimeDir, SYSTEM_DOH_EXE_NAME);
		if (!await this.pathExists(runtimePath)) return null;
		return {
			sourceDir: this.runtimeDir,
			runtimePath,
			version: await readVersionFile(this.versionPath)
		};
	}
	async ensureServiceWrapperInstalled() {
		const sourcePath = await this.findServiceWrapperSource();
		if (!sourcePath) throw new Error("Встроенный WinSW service-wrapper для System DoH не найден.");
		await promises.mkdir(this.serviceWrapperDir, { recursive: true });
		if (!await this.pathExists(this.serviceWrapperPath)) await promises.copyFile(sourcePath, this.serviceWrapperPath);
	}
	async findServiceWrapperSource() {
		const execResourcesPath = path.join(path.dirname(process.execPath), "resources");
		const relativePath = path.join("runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe");
		const candidates = [
			path.join(this.resourcesPath, relativePath),
			path.join(this.resourcesPath, "resources", relativePath),
			path.join(this.resourcesPath, "app.asar.unpacked", relativePath),
			path.join(this.appPath, relativePath),
			path.join(this.appPath, "resources", relativePath),
			path.join(this.appPath, "app.asar.unpacked", relativePath),
			path.join(execResourcesPath, relativePath),
			path.join(execResourcesPath, "resources", relativePath),
			path.join(process.cwd(), "resources", relativePath)
		];
		for (const candidate of candidates) if (await this.pathExists(candidate)) return candidate;
		return null;
	}
	async prepareConfig(url, localAddress) {
		const bootstrapHosts = await resolveSystemDohBootstrapHosts(url);
		await promises.mkdir(this.workDir, { recursive: true });
		await promises.writeFile(this.configPath, buildSystemDohXrayConfig({
			url,
			localAddress,
			localPort: 53,
			logPath: this.logPath,
			bootstrapHosts
		}), "utf8");
	}
	async writeServiceWrapperConfig(runtime) {
		await promises.mkdir(this.serviceLogDir, { recursive: true });
		await promises.writeFile(this.serviceWrapperConfigPath, buildSystemDohServiceXml({
			runtimePath: runtime.runtimePath,
			configPath: this.configPath,
			workingDirectory: path.dirname(runtime.runtimePath),
			serviceLogDirectory: this.serviceLogDir
		}), "utf8");
	}
	async waitUntilReady(state) {
		const deadline = Date.now() + READY_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const service = await this.queryServiceStatus();
			if (!service.installed || service.state === "stopped") return false;
			if (service.running && await this.verifyDns(state).catch(() => false)) return true;
			await delay$1(READY_POLL_INTERVAL_MS);
		}
		return false;
	}
	async verifyDns(state) {
		const addresses = state.localAddress === "127.0.0.1" ? ["127.0.0.1", "::1"] : [state.localAddress];
		const results = await Promise.all(addresses.map(async address => {
			for (const domain of SYSTEM_DOH_VERIFICATION_DOMAINS) if (await queryDnsServer(address, state.localPort, domain).catch(() => false)) return true;
			return false;
		}));
		return results.every(Boolean);
	}
	async readLogTail() {
		try {
			const lines = (await promises.readFile(this.logPath, "utf8")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
			return lines.length > 0 ? lines.slice(-6).join(" | ") : null;
		} catch {
			return null;
		}
	}
	async readManagedState() {
		try {
			const raw = JSON.parse(await promises.readFile(this.statePath, "utf8"));
			const url = normalizeSystemDohUrl(raw.url, "");
			if (!url) return null;
			return {
				pid: typeof raw.pid === "number" ? raw.pid : null,
				startedAt: typeof raw.startedAt === "string" ? raw.startedAt : (/* @__PURE__ */ new Date()).toISOString(),
				localAddress: normalizeSystemDohLocalAddress(raw.localAddress, "") || "127.0.0.1",
				localPort: typeof raw.localPort === "number" ? raw.localPort : 53,
				url
			};
		} catch {
			return null;
		}
	}
	async writeManagedState(state) {
		await promises.mkdir(this.workDir, { recursive: true });
		const temporary = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
		try {
			const handle = await promises.open(temporary, "wx");
			try {
				await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
				await handle.sync();
			} finally { await handle.close(); }
			await promises.rename(temporary, this.statePath);
		} finally { await promises.rm(temporary, { force: true }).catch(() => {}); }
	}
	async clearManagedState() {
		await promises.rm(this.statePath, { force: true });
	}
	async stopLegacyStandaloneRuntime() {
		const script = [
			`$target = [System.IO.Path]::GetFullPath('${path.win32.normalize(path.join(this.runtimeDir, SYSTEM_DOH_EXE_NAME)).replace(/'/g, "''")}')`,
			`$procs = Get-CimInstance Win32_Process -Filter "Name='${SYSTEM_DOH_EXE_NAME}'" -ErrorAction SilentlyContinue`,
			"foreach ($proc in @($procs)) {",
			"  $processPath = [string]$proc.ExecutablePath",
			"  if ($processPath -and [string]::Equals([System.IO.Path]::GetFullPath($processPath), $target, [System.StringComparison]::OrdinalIgnoreCase)) {",
			"    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue",
			"  }",
			"}"
		].join("; ");
		await execFileAsync$4(resolveWindowsExecutable("powershell.exe"), [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			script
		], {
			windowsHide: true,
			timeout: 1e4
		}).catch(() => void 0);
	}
	async isPidRunning(pid) {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
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
