//#region src/electron/ipc/system-doh-service-manager.ts
var execFileAsync$4 = promisify(execFile);
var SYSTEM_DOH_SERVICE_NAME = "EgoistShieldSystemDoH";
var SYSTEM_DOH_SERVICE_DISPLAY_NAME = "Egoist Lagom System DoH";
var SYSTEM_DOH_SERVICE_EXE_NAME = "egoistshield-system-doh-service.exe";
var SYSTEM_DOH_EXE_NAME = "xray-system-doh.exe";
var XRAY_SOURCE_EXE_NAME = "xray.exe";
var VERSION_FILE_NAME = "VERSION.txt";
var READY_TIMEOUT_MS = 2e4;
var READY_POLL_INTERVAL_MS = 300;
var QUERY_TIMEOUT_MS = 3e3;
var STATUS_CACHE_TTL_MS = 3e3;
var SYSTEM_DOH_BOOTSTRAP_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
function systemDohOwnerInspectionError(provider, stage, error, code) {
	const commandErrorCode = typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : null;
	return { provider, stage, code: provider === "system-doh-native" && commandErrorCode ? commandErrorCode : code,
		commandErrorCode, nativeErrorCode: Number.isInteger(error?.code) ? error.code : null,
		timedOut: error?.killed === true || error?.timedOut === true || error?.timeout === true,
		reason: String(error?.message ?? error).replace(/https?:\/\/[^\s]+/gi, "<url>").replace(/[\u0000-\u001f]/g, " ").slice(0, 384) };
}
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
function createDnsQuery(domain, transactionId = DNS_QUERY_ID) {
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
	parts[0].writeUInt16BE(transactionId, 0);
	for (const label of domain.split(".").filter(Boolean)) {
		const encoded = Buffer.from(label, "ascii");
		if (encoded.length < 1 || encoded.length > 63) throw new Error("Некорректное DNS-имя для проверки.");
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
function hasSuccessfulDnsAnswer(buffer, query) {
	if (buffer.length < 12) return false;
	const transactionId = buffer.readUInt16BE(0);
	const flags = buffer.readUInt16BE(2);
	const response = (flags & 32768) === 32768;
	const rcode = flags & 15;
	const answerCount = buffer.readUInt16BE(6);
	if (transactionId !== (query ? query.readUInt16BE(0) : DNS_QUERY_ID) || !response || (flags & 512) !== 0 || rcode !== 0 || answerCount === 0) return false;
	if (!query) return false;
	if (buffer.readUInt16BE(4) !== 1 || buffer.length < query.length || !buffer.subarray(12, query.length).equals(query.subarray(12))) return false;
	let offset = query.length;
	let hasAddress = false;
	for (let answer = 0; answer < answerCount; answer += 1) {
		// Only advance over the encoded name; a compression pointer is two bytes.
		while (true) {
			if (offset >= buffer.length) return false;
			const size = buffer[offset++];
			if ((size & 192) === 192) {
				if (offset >= buffer.length || ((size & 63) << 8 | buffer[offset++]) >= buffer.length) return false;
				break;
			}
			if ((size & 192) !== 0 || size > 63 || offset + size > buffer.length) return false;
			if (size === 0) break;
			offset += size;
		}
		if (offset + 10 > buffer.length) return false;
		const type = buffer.readUInt16BE(offset);
		const dnsClass = buffer.readUInt16BE(offset + 2);
		const size = buffer.readUInt16BE(offset + 8);
		offset += 10;
		if (offset + size > buffer.length) return false;
		if (type === 1 && dnsClass === 1 && size === 4) hasAddress = true;
		offset += size;
	}
	return hasAddress;
}
function queryDnsServer(address, port, domain, signal) {
	return new Promise((resolve, reject) => {
		const socket = createSocket(address.includes(":") ? "udp6" : "udp4");
		const query = createDnsQuery(domain, Math.floor(Math.random() * 65536));
		let settled = false;
		const cleanup = () => {
			try {
				socket.close();
			} catch {}
		};
		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			cleanup();
			if (error) reject(error);
			else resolve(true);
		};
		const onAbort = () => finish(new Error("DNS readiness probe cancelled."));
		const timer = setTimeout(() => finish(new Error("DNS readiness probe timed out.")), QUERY_TIMEOUT_MS);
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) return onAbort();
		socket.once("error", finish);
		socket.once("message", (message) => {
			finish(hasSuccessfulDnsAnswer(message, query) ? null : new Error(`Local DNS service did not resolve ${domain}.`));
		});
		// A connected UDP socket accepts replies only from this resolver/port.
		socket.connect(port, address, () => socket.send(query, (error) => { if (error) finish(error); }));
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
		"  <description>Фоновая Windows-служба Egoist Lagom для локального защищённого DNS-over-HTTPS.</description>",
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
		"    <sizeThreshold>10240</sizeThreshold>",
		"    <keepFiles>5</keepFiles>",
		"  </log>",
		"  <onfailure action=\"restart\" delay=\"0 sec\"/>",
		"  <onfailure action=\"restart\" delay=\"1 sec\"/>",
		"  <onfailure action=\"restart\" delay=\"60 sec\"/>",
		"  <resetfailure>1 hour</resetfailure>",
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
	bootstrapRefreshPath;
	bootstrapPreviousConfigPath;
	lastError = null;
	statusCache = null;
	statusInFlight = null;
	statusGeneration = 0;
	mutationQueue = Promise.resolve();
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
		this.logPath = path.join(this.serviceLogDir, SYSTEM_DOH_SERVICE_EXE_NAME.replace(/\.exe$/i, ".err.log"));
		this.bootstrapRefreshPath = path.join(this.workDir, "bootstrap-refresh.json");
		this.bootstrapPreviousConfigPath = path.join(this.workDir, "config.bootstrap-previous.json");
	}
	async status(options = {}) {
		const now = Date.now();
		const generation = this.statusGeneration ?? 0;
		if (!options.force && this.statusCache && this.statusCache.expiresAt > now) return this.statusCache.value;
		if (this.statusInFlight?.generation === generation) return this.statusInFlight.promise;
		const inFlight = { generation, promise: null };
		inFlight.promise = this.readStatus().then((value) => {
			if ((this.statusGeneration ?? 0) === generation) this.statusCache = {
				value,
				expiresAt: Date.now() + STATUS_CACHE_TTL_MS
			};
			return value;
		}).finally(() => {
			if (this.statusInFlight === inFlight) this.statusInFlight = null;
		});
		this.statusInFlight = inFlight;
		return inFlight.promise;
	}
	async apply(url, preferredLocalAddress) {
		return this.runMutation(() => this.applyInternal(url, preferredLocalAddress));
	}
	async runMutation(operation) {
		const result = (this.mutationQueue ?? Promise.resolve()).then(async () => {
			this.invalidateStatusCache();
			try { return await operation(); }
			finally { this.invalidateStatusCache(); }
		});
		this.mutationQueue = result.catch(() => {});
		return result;
	}
	async bootstrapServers(url, allowIpv6 = false) {
		const parsed = parseSystemDohUrl(url);
		const knownProvider = Boolean(KNOWN_NATIVE_DOH_SERVERS[parsed.server.toLowerCase()]);
		const servers = await resolveSystemDohNativeServers(url, { allowIpv6: allowIpv6 === true });
		let verifiedServers = servers;
		if (parsed.hostnameRequiresResolver && !knownProvider) {
			try { verifiedServers = await probeSystemDohBootstrapAddresses(url, servers); }
			catch (error) { throw new Error("Новые bootstrap-адреса DoH не прошли HTTPS-проверку; действующая конфигурация сохранена.", { cause: error }); }
		}
		return {
			url: parsed.url ?? buildXrayLocalDohServerUrl(url),
			servers: verifiedServers,
			knownProvider
		};
	}
	async refreshBootstrap() {
		return this.runMutation(() => this.refreshBootstrapInternal());
	}
	async refreshBootstrapInternal() {
		const result = (reason, extra = {}) => ({ changed: false, reason, retryAfterMs: SYSTEM_DOH_BOOTSTRAP_REFRESH_INTERVAL_MS, ...extra });
		const protectedRoot = process.env.ProgramData ? path.join(process.env.ProgramData, "EgoistShield", "Runtime", "SystemDoH") : null;
		if (!protectedRoot || path.resolve(this.workDir).toLowerCase() !== path.resolve(protectedRoot).toLowerCase()) return result("not-owned");
		const state = await this.readManagedState();
		const service = await this.queryServiceStatus();
		if (!state || !service.installed || !service.running) return result("not-running");
		if (!await this.isManagedServiceOwned()) return result("not-owned");
		let metadata = await this.readBootstrapRefreshState();
		const original = await promises.readFile(this.configPath, "utf8");
		const digest = (content) => createHash("sha256").update(content, "utf8").digest("hex");
		if (["switching", "rolling-back"].includes(metadata?.phase)) {
			const previous = await promises.readFile(this.bootstrapPreviousConfigPath, "utf8");
			if (digest(previous) !== metadata.previousHash || ![metadata.previousHash, metadata.candidateHash].includes(digest(original))) throw new Error("Конфигурация DNS изменилась после прерванного обновления bootstrap; чужое изменение сохранено.");
			const restored = await this.restoreBootstrapConfig(previous, state, metadata);
			if (!restored.verified) throw new Error("Предыдущая конфигурация DNS и работа службы восстановлены, но upstream не прошёл проверку; обновление bootstrap будет повторено.");
			return result("recovered", { rolledBack: true });
		}
		const parsed = parseSystemDohUrl(state.url);
		if (!parsed.hostnameRequiresResolver) return result("ip-literal");
		if (KNOWN_NATIVE_DOH_SERVERS[parsed.server.toLowerCase()]) return result("documented-provider");
		const now = Date.now();
		const elapsed = metadata?.lastAttemptAt > now ? SYSTEM_DOH_BOOTSTRAP_REFRESH_INTERVAL_MS : now - (metadata?.lastAttemptAt ?? 0);
		if (metadata && elapsed < SYSTEM_DOH_BOOTSTRAP_REFRESH_INTERVAL_MS) return result("rate-limited", { retryAfterMs: SYSTEM_DOH_BOOTSTRAP_REFRESH_INTERVAL_MS - elapsed });
		const config = JSON.parse(original);
		const upstream = typeof config.dns?.servers?.[0] === "string" ? config.dns.servers[0] : config.dns?.servers?.[0]?.address;
		if (!upstream || buildXrayLocalDohServerUrl(upstream) !== buildXrayLocalDohServerUrl(state.url)) throw new Error("Сохранённый DNS URL не совпадает с рабочей конфигурацией; bootstrap не изменён.");
		const hostKey = Object.keys(config.dns.hosts ?? {}).find((key) => key.toLowerCase() === parsed.server.toLowerCase());
		const currentAddresses = hostKey && Array.isArray(config.dns.hosts[hostKey]) ? uniqueIpv4Addresses(config.dns.hosts[hostKey]) : [];
		if (currentAddresses.length === 0) throw new Error("Рабочая конфигурация DNS не содержит проверяемых bootstrap-адресов.");
		metadata = { schemaVersion: 1, phase: "checking", lastAttemptAt: now };
		await this.writeBootstrapRefreshState(metadata);
		const hosts = await resolveSystemDohBootstrapHosts(state.url);
		const addresses = uniqueIpv4Addresses(hosts?.[parsed.server] ?? []).slice(0, 4);
		if (addresses.length === 0) throw new Error("HTTPS bootstrap не вернул IPv4-адресов; действующий DNS сохранён.");
		if ([...currentAddresses].sort().join(",") === [...addresses].sort().join(",")) return result("unchanged", { servers: addresses });
		const verifiedAddresses = await probeSystemDohBootstrapAddresses(state.url, addresses);
		if ([...currentAddresses].sort().join(",") === [...verifiedAddresses].sort().join(",")) return result("unchanged", { servers: verifiedAddresses });
		config.dns.hosts[hostKey] = verifiedAddresses;
		config.dns.hosts[SYSTEM_DOH_HEALTH_DOMAIN] = ["127.0.0.1"];
		const candidate = `${JSON.stringify(config, null, 2)}\n`;
		await this.validateBootstrapConfig(candidate);
		const liveState = await this.readManagedState();
		const liveService = await this.queryServiceStatus();
		if (!liveService.running || !liveState || liveState.url !== state.url || liveState.localAddress !== state.localAddress || liveState.localPort !== state.localPort || await promises.readFile(this.configPath, "utf8") !== original || !await this.isManagedServiceOwned()) return result("state-changed");
		await this.writeAtomicFile(this.bootstrapPreviousConfigPath, original);
		metadata = { ...metadata, phase: "switching", previousHash: digest(original), candidateHash: digest(candidate) };
		await this.writeBootstrapRefreshState(metadata);
		try {
			await this.writeAtomicFile(this.configPath, candidate);
			if (!await this.restartBootstrapService(state)) throw new Error("Локальный DNS не прошёл проверку после обновления bootstrap.");
			const nextService = await this.queryServiceStatus();
			await this.writeManagedState({ ...state, pid: nextService.pid, startedAt: new Date().toISOString() });
			await this.writeBootstrapRefreshState({ ...metadata, phase: "idle" });
			this.lastError = null;
			return { changed: true, reason: "refreshed", retryAfterMs: SYSTEM_DOH_BOOTSTRAP_REFRESH_INTERVAL_MS, servers: verifiedAddresses };
		} catch (error) {
			let rollbackVerified = null;
			try {
				const currentConfig = await promises.readFile(this.configPath, "utf8");
				const currentService = await this.queryServiceStatus();
				if (currentConfig === original && currentService.running && currentService.pid === service.pid) await this.writeBootstrapRefreshState({ ...metadata, phase: "idle" });
				else rollbackVerified = (await this.restoreBootstrapConfig(original, state, metadata)).verified;
			}
			catch (rollbackError) {
				this.lastError = "Обновление bootstrap DNS не завершено; предыдущая конфигурация сохранена для восстановления.";
				throw new Error(this.lastError, { cause: rollbackError });
			}
			this.lastError = rollbackVerified === false ? "Предыдущая конфигурация DNS и работа службы восстановлены, но upstream не прошёл проверку; обновление bootstrap будет повторено." : rollbackVerified === true ? "Обновление bootstrap DNS не прошло проверку; предыдущая конфигурация восстановлена." : "Обновление bootstrap DNS не завершено; действующая конфигурация сохранена.";
			throw new Error(this.lastError, { cause: error });
		}
	}
	async restartBootstrapService(state) {
		if (await this.queryBootstrapServiceState() !== "stopped") {
			await this.controlBootstrapService("stop");
			await this.waitForBootstrapServiceState("stopped");
		}
		await this.controlBootstrapService("start");
		await this.waitForBootstrapServiceState("running");
		const verified = await this.waitForBootstrapReady(state);
		if (await this.queryBootstrapServiceState() !== "running") throw new Error("SCM не подтвердил работающую службу после обновления bootstrap.");
		return verified;
	}
	async controlBootstrapService(command) {
		if (!["stop", "start"].includes(command)) throw new Error("Unsupported bootstrap service command.");
		await execFileAsync$4(resolveWindowsExecutable("sc.exe"), [command, SYSTEM_DOH_SERVICE_NAME], { windowsHide: true, timeout: 8e3, maxBuffer: 65536 });
	}
	async queryBootstrapServiceState() {
		const { stdout } = await execFileAsync$4(resolveWindowsExecutable("sc.exe"), ["queryex", SYSTEM_DOH_SERVICE_NAME], { windowsHide: true, timeout: 2e3, maxBuffer: 65536 });
		const state = this.normalizeServiceState(parseScServiceState$1(stdout) ?? "unknown");
		if (state === "unknown") throw new Error("SCM не подтвердил состояние службы при обновлении bootstrap.");
		return state;
	}
	async waitForBootstrapServiceState(expected) {
		const deadline = Date.now() + 12e3;
		while (Date.now() < deadline) {
			if (await this.queryBootstrapServiceState() === expected) return;
			await delay$1(300);
		}
		throw new Error("SCM не подтвердил переход службы при обновлении bootstrap.");
	}
	async waitForBootstrapReady(state) {
		const deadline = Date.now() + READY_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (await this.queryBootstrapServiceState() === "running" && await this.verifyDns(state).catch(() => false)) return true;
			await delay$1(READY_POLL_INTERVAL_MS);
		}
		return false;
	}
	async restoreBootstrapConfig(previous, state, metadata) {
		const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
		const currentHash = hash(await promises.readFile(this.configPath, "utf8"));
		if (hash(previous) !== metadata.previousHash || ![metadata.previousHash, metadata.candidateHash].includes(currentHash)) throw new Error("Чужое изменение конфигурации DNS сохранено; откат bootstrap остановлен.");
		await this.writeBootstrapRefreshState({ ...metadata, phase: "rolling-back" }).catch(() => {});
		await this.writeAtomicFile(this.configPath, previous);
		const verified = await this.restartBootstrapService(state);
		await this.writeBootstrapRefreshState({ ...metadata, phase: "idle", previousVerified: verified });
		return { verified };
	}
	async validateBootstrapConfig(candidate) {
		const runtime = await this.getManagedRuntimeInfo();
		if (!runtime) throw new Error("Управляемый Xray runtime не найден; DNS не изменён.");
		const candidatePath = path.join(this.workDir, `config.bootstrap-candidate-${randomUUID()}.json`);
		try {
			await this.writeAtomicFile(candidatePath, candidate);
			await execFileAsync$4(runtime.runtimePath, ["run", "-test", "-config", candidatePath], { cwd: path.dirname(runtime.runtimePath), windowsHide: true, timeout: 1e4, maxBuffer: 1024 * 1024 });
		} finally { await promises.rm(candidatePath, { force: true }).catch(() => {}); }
	}
	async isManagedServiceOwned() {
		const runtime = await this.getManagedRuntimeInfo();
		if (!runtime) return false;
		const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
		const script = [
			"$ErrorActionPreference = 'Stop'",
			`$svc = Get-CimInstance Win32_Service -Filter "Name='${SYSTEM_DOH_SERVICE_NAME}'" -ErrorAction Stop`,
			"if (-not $svc) { exit 0 }",
			"$match = [regex]::Match([string]$svc.PathName, '^\\s*(?:\"([^\"]+)\"|([^\\s]+))')",
			"$executable = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }",
			`if (-not [string]::Equals([IO.Path]::GetFullPath($executable), [IO.Path]::GetFullPath(${literal(this.serviceWrapperPath)}), [StringComparison]::OrdinalIgnoreCase)) { exit 0 }`,
			`[xml]$xml = Get-Content -LiteralPath ${literal(this.serviceWrapperConfigPath)} -Raw -ErrorAction Stop`,
			`if (-not [string]::Equals([IO.Path]::GetFullPath([string]$xml.service.executable), [IO.Path]::GetFullPath(${literal(runtime.runtimePath)}), [StringComparison]::OrdinalIgnoreCase)) { exit 0 }`,
			`if ([string]$xml.service.arguments -ne ${literal(["run", "-c", this.configPath].map(quoteWindowsArgument$1).join(" "))}) { exit 0 }`,
			"'owned'"
		].join("; ");
		const { stdout } = await execFileAsync$4(resolveWindowsExecutable("powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 8e3, maxBuffer: 65536 });
		return stdout.trim() === "owned";
	}
	async readBootstrapRefreshState() {
		try {
			const value = JSON.parse(await promises.readFile(this.bootstrapRefreshPath, "utf8"));
			if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.lastAttemptAt) || value.lastAttemptAt < 0 || !["checking", "switching", "rolling-back", "idle"].includes(value.phase) || ["switching", "rolling-back"].includes(value.phase) && (!/^[0-9a-f]{64}$/.test(value.previousHash) || !/^[0-9a-f]{64}$/.test(value.candidateHash))) throw new Error("Invalid bootstrap refresh state.");
			return value;
		} catch (error) {
			if (error?.code === "ENOENT") return null;
			throw new Error("Журнал обновления bootstrap DNS недоступен; конфигурация сохранена.", { cause: error });
		}
	}
	async writeBootstrapRefreshState(value) {
		await this.writeAtomicFile(this.bootstrapRefreshPath, `${JSON.stringify(value, null, 2)}\n`);
	}
	async applyInternal(url, preferredLocalAddress) {
		let normalizedUrl = normalizeSystemDohUrl(url, "");
		if (!normalizedUrl) throw new Error("Укажите DoH URL.");
		const parsed = parseSystemDohUrl(normalizedUrl);
		normalizedUrl = parsed.url ?? normalizedUrl;
		const current = await this.status({ force: true });
		if (["unknown", "unavailable"].includes(current.serviceState)) throw new Error("Не удалось проверить текущее состояние DNS. Настройки сохранены; повторите проверку после восстановления службы.");
		if ((current.serviceRunning || current.nativeManaged && current.enabled) && current.currentUrl === normalizedUrl) return current;
		if (current.serviceInstalled && current.currentUrl === normalizedUrl) {
			// Retry the same saved provider without deleting the resolver/config
			// that existing owned loopback adapters may still depend on.
			if (!await this.isManagedServiceOwned()) throw new Error("Принадлежность службы System DoH не подтверждена; повторное подключение не выполнено.");
			const saved = await this.readManagedState();
			if (!saved || saved.url !== normalizedUrl) throw new Error("Сохранённая конфигурация System DoH изменилась; повторное подключение не выполнено.");
			await this.startServiceInternal();
			if (!await this.waitUntilReady(saved)) {
				const retained = await this.retainRunningServiceAfterReadinessFailure(saved);
				if (retained) return retained;
				throw new Error("Служба System DoH не запустилась; сохранённая конфигурация оставлена для восстановления.");
			}
			const service = await this.queryServiceStatus();
			await this.writeManagedState({ ...saved, pid: service.pid });
			this.lastError = null;
			this.invalidateStatusCache();
			return this.status({ force: true });
		}
		const hasCustomPort = parsed.serverPort && parsed.serverPort !== 443;
		if (current.serviceRunning || current.nativeManaged && current.enabled && hasCustomPort) {
			throw new Error("Текущий DNS работает. Переключение DoH требует отдельного безопасного переноса; действующее подключение сохранено.");
		}
		if (this.coreService && !hasCustomPort) {
			const servers = await resolveSystemDohNativeServers(normalizedUrl, { allowIpv6: current.hasIpv6DefaultRoute === true });
			// Core owns the native change, readback and rollback as one transaction.
			// Removing its current DNS first would create an avoidable outage.
			const native = await this.coreService.applyNativeDoh(normalizedUrl, servers, { probeHosts: [...SYSTEM_DOH_VERIFICATION_DOMAINS] });
			this.lastError = null;
			this.invalidateStatusCache();
			return this.mapNativeStatus(native);
		}
		const runtime = await this.ensureManagedRuntimeInstalled();
		await this.ensureServiceWrapperInstalled();
		await this.stopAndRemoveInternal();
		let lastBindError = null;
		for (const candidate of buildSystemDohLoopbackCandidates(preferredLocalAddress)) {
			const state = {
				pid: null,
				startedAt: (/* @__PURE__ */ new Date()).toISOString(),
				localAddress: candidate,
				localPort: 53,
				url: normalizedUrl
			};
			let readinessFailed = false;
			try {
				await this.prepareConfig(normalizedUrl, candidate);
				await this.writeServiceWrapperConfig(runtime);
				await this.writeManagedState(state);
				await this.installService();
				if (!this.coreService) await this.configureServiceAutostartRecovery();
				await this.startServiceInternal();
				if (!await this.waitUntilReady(state)) {
					readinessFailed = true;
					throw new Error(`System DoH не отвечает через ${candidate}:53.`);
				}
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
				if (readinessFailed && !/bind:|forbidden by its access permissions|Only one usage of each socket address/i.test(diagnostic)) {
					// Remote readiness can fail while the owned runtime is healthy.
					// Return its honest degraded status so Core keeps enabled intent;
					// the GUI still refuses to enroll new adapters until verified.
					const retained = await this.retainRunningServiceAfterReadinessFailure(state);
					if (retained) return retained;
				}
				try {
					await this.removeServiceInternal();
					await this.stopLegacyStandaloneRuntime();
					await this.clearManagedState();
				} catch (rollbackError) {
					const rollbackReason = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
					this.lastError = `${diagnostic} Восстановление System DoH не завершено: ${rollbackReason}. Сохранённая конфигурация и состояние сохранены для повторной проверки.`;
					throw new Error(this.lastError, { cause: rollbackError });
				}
				if (/bind:|forbidden by its access permissions|Only one usage of each socket address/i.test(diagnostic)) {
					lastBindError = diagnostic;
					continue;
				}
				this.lastError = diagnostic;
				throw new Error(`System DoH не прошёл проверку: контрольные домены не резолвятся через локальный канал. Детали сохранены в журнале System DoH.`);
			}
		}
		this.lastError = lastBindError ?? "Не удалось найти свободный loopback-адрес для System DoH.";
		throw new Error(this.lastError);
	}
	async retainRunningServiceAfterReadinessFailure(state) {
		const service = await this.queryServiceStatus();
		if (["unknown", "unavailable"].includes(service.state)) throw new Error("Состояние службы System DoH неизвестно; конфигурация и служба сохранены для повторной проверки.");
		if (!service.installed || !service.running) return null;
		if (!await this.isManagedServiceOwned()) throw new Error("Принадлежность работающей службы System DoH не подтверждена; её состояние сохранено без изменений.");
		const saved = await this.readManagedState();
		if (!saved || ["url", "localAddress", "localPort", "startedAt"].some(key => saved[key] !== state[key])) throw new Error("Сохранённая конфигурация System DoH изменилась во время проверки; служба и конфигурация сохранены без отката.");
		await this.writeManagedState({ ...saved, pid: service.pid });
		this.lastError = "Служба System DoH запущена, но выбранный DoH пока не прошёл проверку. Конфигурация сохранена; Core продолжит фоновое восстановление.";
		this.invalidateStatusCache();
		const status = await this.status({ force: true });
		if (status.verified === true) {
			this.lastError = null;
			return { ...status, lastError: null, readinessPending: false, ownedResolverRetained: true };
		}
		return { ...status, readinessPending: true, ownedResolverRetained: true };
	}
	async stop() {
		return this.runMutation(() => this.stopInternal());
	}
	async stopInternal() {
		if (this.coreService) return this.stopAndRemoveInternal();
		await this.stopServiceInternal();
		await this.stopLegacyStandaloneRuntime();
		this.lastError = null;
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async restart() {
		return this.runMutation(() => this.restartInternal());
	}
	async restartInternal() {
		const currentStatus = await this.status({ force: true });
		if (["unknown", "unavailable"].includes(currentStatus.serviceState)) throw new Error("Состояние службы System DoH неизвестно; перезапуск не выполнен.");
		const state = await this.readManagedState();
		if (this.coreService && !state) {
			const current = await this.coreService.nativeDohStatus();
			if (!current.url) throw new Error("Конфигурация System DoH отсутствует.");
			return this.applyInternal(current.url);
		}
		if (!state?.url) throw new Error("Сохранённая конфигурация System DoH отсутствует; перезапуск не выполнен.");
		const service = await this.queryServiceStatus();
		if (["unknown", "unavailable"].includes(service.state)) throw new Error("Состояние службы System DoH неизвестно; перезапуск не выполнен.");
		if (!service.installed) return this.applyInternal(state.url, state.localAddress);
		if (!this.coreService && !await this.isManagedServiceOwned()) throw new Error("Принадлежность службы System DoH не подтверждена; перезапуск не выполнен.");
		// An explicit restart may replace a degraded or healthy owned process. Core
		// supplies privileges and exact identity checks; DNS/provider config stays.
		await this.stopServiceInternal();
		await this.stopLegacyStandaloneRuntime();
		await this.startServiceInternal();
		const nextService = await this.queryServiceStatus();
		await this.writeManagedState({ ...state, pid: nextService.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString() });
		if (!await this.waitUntilReady(state)) {
			this.lastError = "Служба System DoH перезапущена, но локальный DNS не прошёл проверку.";
			throw new Error(this.lastError);
		}
		this.lastError = null;
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async stopAndRemove() {
		return this.runMutation(() => this.stopAndRemoveInternal());
	}
	async stopAndRemoveInternal() {
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
		return this.runMutation(() => this.recoverInternal(options));
	}
	async recoverInternal(options) {
		const normalizedUrl = normalizeSystemDohUrl(options.url, "");
		if (this.coreService && !await this.readManagedState() && (!normalizedUrl || !parseSystemDohUrl(normalizedUrl).serverPort || parseSystemDohUrl(normalizedUrl).serverPort === 443)) try {
			const current = await this.coreService.nativeDohStatus();
			if (!options.enabled || !normalizedUrl) {
				if (current.enabled) return this.stopAndRemoveInternal();
				return this.mapNativeStatus(current);
			}
			if (current.enabled && current.url === normalizedUrl) return this.mapNativeStatus(current);
			return this.applyInternal(normalizedUrl, options.localAddress);
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			this.invalidateStatusCache();
			return this.readStatus();
		}
		if (!options.enabled || !normalizedUrl) return this.stopAndRemoveInternal();
		try {
			const state = await this.readManagedState();
			const service = await this.queryServiceStatus();
			if (service.installed && state?.url === normalizedUrl && state.localAddress === "127.0.0.1") {
				// Opening the GUI observes an already running resolver. Core owns
				// repair of persistent failures; repeated readiness loops hold the
				// network mutation slot and cannot fix an unreachable upstream.
				if (service.running) return this.status({ force: true });
				await this.startServiceInternal();
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
			return this.applyInternal(normalizedUrl, options.localAddress);
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
				ownerInspectionErrors: [systemDohOwnerInspectionError("system-doh-native", "native-status", error, "SYSTEM_DOH_NATIVE_STATUS_FAILED")],
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
			serverAddresses: verified ? (state.localAddress === "127.0.0.1" ? ["127.0.0.1", "::1"] : [state.localAddress]) : [],
			currentUrl: state?.url || null,
			ownerInspectionErrors: service.ownerInspectionErrors ?? [],
			healthState: service.state === "unknown" ? "unknown" : service.running ? verified ? "ready" : "degraded" : "stopped",
			lastError: service.state === "unknown" && service.ownerInspectionErrors?.length ? service.ownerInspectionErrors.map((value) => `${value.code}/${value.stage}`).join("; ") : service.running && !verified ? "Служба DNS запущена, но запросы через выбранный DoH не прошли проверку. Фоновая служба проверит необходимость восстановления." : this.lastError
		};
	}
	mapNativeStatus(native) {
		return {
			available: native.supported !== false,
			nativeSupported: native.supported,
			hasIpv6DefaultRoute: native.hasIpv6DefaultRoute === true,
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
		this.statusGeneration = (this.statusGeneration ?? 0) + 1;
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
		if (service.state === "unknown") throw new Error("Состояние службы System DoH неизвестно; запуск не выполнен.");
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
		if (["unknown", "unavailable"].includes(service.state)) throw new Error("Состояние службы System DoH неизвестно; остановка не выполнена.");
		if (!service.installed) return;
		if (this.coreService) await this.coreService.stopOwnedService(SYSTEM_DOH_SERVICE_NAME);
		else {
			if (!await this.isManagedServiceOwned()) throw new Error("Принадлежность службы System DoH не подтверждена; остановка не выполнена.");
			if (["running", "start-pending", "paused"].includes(service.state)) {
				await this.execServiceWrapper(["stop"], false);
			}
		}
		await this.waitForServiceState("stopped", 12e3);
		this.invalidateStatusCache();
	}
	async removeServiceInternal() {
		const service = await this.queryServiceStatus();
		if (service.state === "unknown") throw new Error("Состояние службы System DoH неизвестно; удаление не выполнено.");
		if (!service.installed) return;
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
			"3600",
			"actions=",
			"restart/0/restart/1000/restart/60000"
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
		], false);
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
		const ownerInspectionErrors = [];
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
			ownerInspectionErrors.push(systemDohOwnerInspectionError("system-doh-local", "sc-queryex",
				new Error("SCM query returned an unsupported service state."), "SYSTEM_DOH_SERVICE_STATE_UNKNOWN"));
		} catch (error) {
			if (error?.code === 1060 && !error.killed && !error.signal && !error.timedOut && !error.timeout) return {
				installed: false, running: false, state: "not-installed", rawState: null, pid: null
			};
			ownerInspectionErrors.push(systemDohOwnerInspectionError("system-doh-local", "sc-queryex", error, "SYSTEM_DOH_SERVICE_QUERY_FAILED"));
		}
		const script = [
			"$ErrorActionPreference = 'Stop'",
			`$svc = Get-CimInstance Win32_Service -Filter "Name='${SYSTEM_DOH_SERVICE_NAME}'" -ErrorAction Stop`,
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
			if (state === "unknown") ownerInspectionErrors.push(systemDohOwnerInspectionError("system-doh-local", "cim-fallback",
				new Error("CIM query returned an unsupported service state."), "SYSTEM_DOH_SERVICE_STATE_UNKNOWN"));
			return {
				installed: true,
				running: state === "running",
				state,
				rawState,
				pid: Number.isInteger(pid) && pid > 0 ? pid : null,
				...(state === "unknown" ? { ownerInspectionErrors } : {})
			};
		} catch (error) {
			ownerInspectionErrors.push(systemDohOwnerInspectionError("system-doh-local", "cim-fallback", error, "SYSTEM_DOH_SERVICE_QUERY_FAILED"));
			return {
				installed: false,
				running: false,
				state: "unknown",
				rawState: null,
				pid: null,
				ownerInspectionErrors
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
			const controller = new AbortController();
			try {
				await Promise.any(SYSTEM_DOH_VERIFICATION_DOMAINS.map(domain => queryDnsServer(address, state.localPort, domain, controller.signal)));
				return true;
			} catch { return false; }
			finally { controller.abort(); }
		}));
		return results.every(Boolean);
	}
	async readLogTail() {
		for (const target of [this.logPath, this.logPath.replace(/\.err\.log$/i, ".out.log"), path.join(this.workDir, "runtime.log")]) {
			let handle;
			try {
				handle = await promises.open(target, "r");
				const { size } = await handle.stat();
				const buffer = Buffer.alloc(Math.min(size, 8192));
				await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
				const lines = buffer.toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
				if (lines.length) return lines.slice(-6).join(" | ");
			} catch {}
			finally { await handle?.close().catch(() => {}); }
		}
		return null;
	}
	async readManagedState() {
		try {
			const raw = JSON.parse(await promises.readFile(this.statePath, "utf8"));
			const url = normalizeSystemDohUrl(raw.url, "");
			if (!url) throw new Error("URL отсутствует");
			parseSystemDohUrl(url);
			const localAddress = normalizeSystemDohLocalAddress(raw.localAddress, "");
			if (!localAddress || !Number.isInteger(raw.localPort) || raw.localPort < 1 || raw.localPort > 65535) throw new Error("Локальный адрес или порт некорректен");
			return {
				pid: typeof raw.pid === "number" ? raw.pid : null,
				startedAt: typeof raw.startedAt === "string" ? raw.startedAt : (/* @__PURE__ */ new Date()).toISOString(),
				localAddress,
				localPort: raw.localPort,
				url
			};
		} catch (error) {
			if (error?.code === "ENOENT") return null;
			throw new Error("Не удалось прочитать сохранённую конфигурацию System DoH. Действующая служба сохранена.", { cause: error });
		}
	}
	async writeManagedState(state) {
		await this.writeAtomicFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`);
	}
	async writeAtomicFile(target, content) {
		await promises.mkdir(path.dirname(target), { recursive: true });
		const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
		try {
			const handle = await promises.open(temporary, "wx");
			try {
				await handle.writeFile(content, "utf8");
				await handle.sync();
			} finally { await handle.close(); }
			await promises.rename(temporary, target);
		} finally { await promises.rm(temporary, { force: true }).catch(() => {}); }
	}
	async clearManagedState() {
		await promises.rm(this.statePath, { force: true });
	}
	async stopLegacyStandaloneRuntime() {
		if (this.coreService) return this.coreService.stopOwnedService(SYSTEM_DOH_SERVICE_NAME);
		const script = [
			"$ErrorActionPreference = 'Stop'",
			`$target = [System.IO.Path]::GetFullPath('${path.win32.normalize(path.join(this.runtimeDir, SYSTEM_DOH_EXE_NAME)).replace(/'/g, "''")}')`,
			`$procs = Get-CimInstance Win32_Process -Filter "Name='${SYSTEM_DOH_EXE_NAME}'" -ErrorAction Stop`,
			"foreach ($proc in @($procs)) {",
			"  $processPath = [string]$proc.ExecutablePath",
			"  if (-not $processPath) { throw 'DNS runtime identity is unavailable; cleanup refused.' }",
			"  if (-not [string]::Equals([System.IO.Path]::GetFullPath($processPath), $target, [System.StringComparison]::OrdinalIgnoreCase)) { continue }",
			"  try { $live = Get-Process -Id $proc.ProcessId -ErrorAction Stop } catch { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { continue }; throw }",
			"  try {",
			"    $held = $live.Handle",
			"    $born = $live.StartTime.ToUniversalTime()",
			"    $image = [string]$live.MainModule.FileName",
			"    if (-not $image -or -not [string]::Equals([System.IO.Path]::GetFullPath($image), $target, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'DNS runtime process identity changed; cleanup refused.' }",
			"    if ($live.HasExited) { continue }",
			"    $live.Kill()",
			"    if (-not $live.WaitForExit(5000)) { throw 'Owned DNS runtime exit was not confirmed.' }",
			"  } finally { $live.Dispose() }",
			"}",
			`$remaining = Get-CimInstance Win32_Process -Filter "Name='${SYSTEM_DOH_EXE_NAME}'" -ErrorAction Stop`,
			"foreach ($proc in @($remaining)) {",
			"  $image = [string]$proc.ExecutablePath",
			"  if (-not $image) { throw 'DNS runtime quiescence is unavailable.' }",
			"  if ([string]::Equals([System.IO.Path]::GetFullPath($image), $target, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Owned DNS runtime restarted during cleanup.' }",
			"}"
		].join("; ");
		await execFileAsync$4(resolveWindowsExecutable("powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, timeout: 1e4 });
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
