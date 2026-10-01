//#region src/electron/ipc/gravityless-dns-manager.ts
var execFileAsync$15 = promisify(execFile);
var LOCAL_DNS_HOST = "127.0.0.1";
var LOCAL_DNS_PORT = 53;
var SERVICE_START_TIMEOUT_MS$1 = 2e4;
var GRAVITYLESS_STATUS_CACHE_TTL_MS = 3e3;
var PORT_PROBE_TIMEOUT_MS = 1500;
function gravitylessMonotonicNow() {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}
function readGravitylessDnsName(message, start) {
	let offset = start;
	let nextOffset = null;
	let expandedBytes = 1;
	const labels = [];
	const visited = new Set();
	for (let step = 0; step < 128; step += 1) {
		if (offset >= message.length || visited.has(offset)) throw new Error("Invalid DNS name.");
		visited.add(offset);
		const length = message[offset];
		if ((length & 192) === 192) {
			if (offset + 1 >= message.length) throw new Error("Truncated DNS pointer.");
			const target = ((length & 63) << 8) | message[offset + 1];
			if (target < 12 || target >= offset) throw new Error("Invalid DNS compression pointer.");
			if (nextOffset === null) nextOffset = offset + 2;
			offset = target;
			continue;
		}
		if ((length & 192) !== 0 || length > 63) throw new Error("Invalid DNS label.");
		offset += 1;
		if (length === 0) return { name: labels.join(".").toLowerCase(), nextOffset: nextOffset ?? offset };
		if (offset + length > message.length || (expandedBytes += length + 1) > 255) throw new Error("Truncated or oversized DNS name.");
		const label = message.subarray(offset, offset + length);
		if (label.some((byte) => byte < 33 || byte > 126 || byte === 46)) throw new Error("Invalid DNS label bytes.");
		labels.push(label.toString("ascii"));
		offset += length;
	}
	throw new Error("DNS compression limit exceeded.");
}
/** A matching complete answer proves resolution at the queried endpoint, not process ownership. */
function isValidGravitylessDnsAnswer(message, expectedId, expectedDomain) {
	try {
		if (!Buffer.isBuffer(message) || message.length < 12 || message.length > 65535) return false;
		if (message.readUInt16BE(0) !== expectedId) return false;
		const flags = message.readUInt16BE(2);
		if ((flags & 32768) === 0 || (flags & 0x780f) !== 0 || (flags & 0x0240) !== 0) return false;
		const questionCount = message.readUInt16BE(4), answerCount = message.readUInt16BE(6);
		const recordCount = answerCount + message.readUInt16BE(8) + message.readUInt16BE(10);
		if (questionCount !== 1 || answerCount === 0 || recordCount > 1024) return false;
		const question = readGravitylessDnsName(message, 12);
		let offset = question.nextOffset;
		if (offset + 4 > message.length || message.readUInt16BE(offset) !== 1 || message.readUInt16BE(offset + 2) !== 1) return false;
		if (expectedDomain && question.name !== expectedDomain.replace(/\.$/, "").toLowerCase()) return false;
		offset += 4;
		const addresses = new Set(), aliases = new Map();
		for (let index = 0; index < recordCount; index += 1) {
			const owner = readGravitylessDnsName(message, offset);
			offset = owner.nextOffset;
			if (offset + 10 > message.length) return false;
			const type = message.readUInt16BE(offset), recordClass = message.readUInt16BE(offset + 2);
			const dataLength = message.readUInt16BE(offset + 8);
			offset += 10;
			if (offset + dataLength > message.length) return false;
			if (type === 1 && dataLength !== 4) return false;
			if (type === 28 && dataLength !== 16) return false;
			if (type === 5) {
				const target = readGravitylessDnsName(message, offset);
				if (target.nextOffset !== offset + dataLength) return false;
				if (index < answerCount && recordClass === 1) {
					if (aliases.has(owner.name) && aliases.get(owner.name) !== target.name) return false;
					aliases.set(owner.name, target.name);
				}
			}
			if (index < answerCount && type === 1 && recordClass === 1) {
				const first = message[offset];
				if (first > 0 && first < 224 && first !== 127) addresses.add(owner.name);
			}
			offset += dataLength;
		}
		if (offset !== message.length) return false;
		if ([...aliases.keys()].some((owner) => addresses.has(owner))) return false;
		let candidate = question.name;
		const seen = new Set();
		for (let hop = 0; hop < 32 && !seen.has(candidate); hop += 1) {
			if (addresses.has(candidate)) return true;
			seen.add(candidate);
			candidate = aliases.get(candidate);
			if (!candidate) return false;
		}
		return false;
	} catch {
		return false;
	}
}
function describeLocalDnsPortConflict(host, port, errorCode) {
	return `Gravityless DNS не может занять ${host}:${port} — ${errorCode === "EADDRINUSE" ? "порт уже занят другой локальной DNS-службой" : errorCode === "EACCES" ? "нет прав на прослушивание порта" : `порт недоступен (${errorCode ?? "unknown"})`}. Остановите другой локальный DNS (AdGuard Home, Pi-hole, второй dnscrypt-proxy, Windows Internet Connection Sharing) и повторите включение. Gravityless DNS и System DoH используют один системно совместимый адрес 127.0.0.1:53, поэтому одновременно может работать только один локальный DNS.`;
}
function isGravitylessLoopbackDnsRequest(rawInput) {
	const tokens = rawInput.split(/[\s,;]+/).map((token) => token.trim().replace(/^\[|\]$/g, "")).filter(Boolean);
	return tokens.length > 0 && tokens.every((token) => token === LOCAL_DNS_HOST || token === "::1");
}
var GravitylessDnsManager = class {
	resourcesPath;
	coreService;
	sourceDir;
	paths = resolveGravitylessDnsPaths("product-owned");
	legacyPaths = resolveGravitylessDnsPaths("compatibility");
	lastError = null;
	statusCache = null;
	statusInFlight = null;
	statusGeneration = 0;
	constructor(resourcesPath, coreService) {
		this.resourcesPath = resourcesPath;
		this.coreService = coreService;
		this.sourceDir = path.join(this.resourcesPath, "gravityless-dns");
	}
	async status(options = {}) {
		const now = gravitylessMonotonicNow();
		const generation = this.statusGeneration;
		if (!options.force && this.statusCache && now >= this.statusCache.observedAt && this.statusCache.expiresAt > now) return this.statusCache.value;
		if (!options.force && this.statusInFlight?.generation === generation) return this.statusInFlight.promise;
		const inFlight = { generation, promise: null };
		inFlight.promise = this.readStatus().then((value) => {
			if (generation !== this.statusGeneration) return this.status();
			if (generation === this.statusGeneration && this.statusInFlight === inFlight) this.statusCache = {
				value,
				observedAt: gravitylessMonotonicNow(),
				expiresAt: gravitylessMonotonicNow() + GRAVITYLESS_STATUS_CACHE_TTL_MS
			};
			return value;
		}).finally(() => {
			if (this.statusInFlight === inFlight) this.statusInFlight = null;
		});
		this.statusInFlight = inFlight;
		return inFlight.promise;
	}
	invalidateStatusCache() {
		this.statusCache = null;
		this.statusGeneration += 1;
	}
	async readStatus() {
		const service = await this.queryService();
		const verified = service.state !== "not-installed" ? await this.verifyLocalDns().catch(() => false) : false;
		const running = service.state === "running" && verified;
		return {
			available: await this.pathExists(path.join(this.sourceDir, GRAVITYLESS_DNS_EXE_NAME)),
			running,
			verified,
			resolutionVerified: verified,
			resolverIdentityVerified: null,
			serviceRunning: service.state === "running",
			service,
			installDir: this.paths.installDir,
			exePath: this.paths.exePath,
			configPath: this.paths.configPath,
			logPath: this.paths.logPath,
			localAddress: LOCAL_DNS_HOST,
			lastError: this.lastError
		};
	}
	async ensureRunning() {
		if (process.platform !== "win32") throw new Error("Gravityless DNS доступен только на Windows.");
		const previouslyServing = (await this.queryService()).state === "running";
		try {
			await this.verifyBundledAssets();
			await this.stopExistingRuntime();
			await this.assertLocalDnsPortFree();
			await this.installFiles();
			await this.validateConfig();
			await this.reinstallService();
			await this.startService();
			await this.waitForRunningDns(SERVICE_START_TIMEOUT_MS$1);
			await this.verifyLocalDns();
			await this.flushDnsCache();
			this.lastError = null;
			this.invalidateStatusCache();
			return this.status({ force: true });
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			const restored = previouslyServing ? await this.rollbackToPreviousResolver() : false;
			this.lastError = previouslyServing ? restored ? `${reason} Предыдущий локальный резолвер восстановлен и снова отвечает на 127.0.0.1:53.` : `${reason} ВНИМАНИЕ: предыдущий локальный резолвер восстановить не удалось — 127.0.0.1:53 сейчас не отвечает, переключите DNS вручную.` : reason;
			this.invalidateStatusCache();
			throw new Error(this.lastError);
		}
	}
	/**
	* Best-effort return to the resolver that was serving before this attempt.
	* Reports whether 127.0.0.1:53 actually answers again, never assumes it.
	*/
	async rollbackToPreviousResolver() {
		try {
			await this.startService();
			await this.waitForRunningDns(8e3);
			await this.verifyLocalDns();
			await this.flushDnsCache().catch(() => void 0);
			return true;
		} catch (rollbackError) {
			logger.warn("[gravityless-dns] Rollback to previous resolver failed:", rollbackError);
			return false;
		}
	}
	/**
	* The manifest pins SHA-256 for both bundled assets, but nothing used to
	* check them: a tampered or truncated `dnscrypt-proxy.exe` was copied into
	* ProgramData and registered as an auto-start system service as-is.
	*/
	async verifyBundledAssets() {
		const assets = [{
			label: GRAVITYLESS_DNS_EXE_NAME,
			filePath: path.join(this.sourceDir, GRAVITYLESS_DNS_EXE_NAME),
			expected: GRAVITYLESS_DNS_EXE_SHA256
		}, {
			label: GRAVITYLESS_DNS_TOML_NAME,
			filePath: path.join(this.sourceDir, GRAVITYLESS_DNS_TOML_NAME),
			expected: GRAVITYLESS_DNS_TOML_SHA256
		}];
		for (const asset of assets) {
			const actual = await this.sha256File(asset.filePath);
			if (!actual) throw new Error(`Встроенный ${asset.label} не найден или не читается.`);
			if (actual.toLowerCase() !== asset.expected.toLowerCase()) throw new Error(`Встроенный ${asset.label} не совпал с доверенным SHA-256 (ожидался ${asset.expected}, получен ${actual}). Установка Gravityless DNS остановлена.`);
		}
	}
	async assertLocalDnsPortFree() {
		const conflict = await this.probeLocalDnsPortConflict();
		if (conflict) throw new Error(describeLocalDnsPortConflict(LOCAL_DNS_HOST, LOCAL_DNS_PORT, conflict));
	}
	probeLocalDnsPortConflict() {
		return new Promise((resolve) => {
			const socket = dgram.createSocket({
				type: "udp4",
				reuseAddr: false
			});
			const timer = setTimeout(() => {
				socket.close(() => resolve(null));
			}, PORT_PROBE_TIMEOUT_MS);
			socket.once("error", (error) => {
				clearTimeout(timer);
				try {
					socket.close();
				} catch {}
				resolve(error.code ?? "EADDRINUSE");
			});
			socket.bind(LOCAL_DNS_PORT, LOCAL_DNS_HOST, () => {
				clearTimeout(timer);
				socket.close(() => resolve(null));
			});
		});
	}
	async stopAndRemove() {
		try {
			await this.stopExistingRuntime();
			if (this.coreService) {
				if ((await this.queryService()).state !== "not-installed") await this.coreService.removeOwnedService(GRAVITYLESS_DNS_SERVICE_NAME);
			} else {
				await this.runNativeServiceCommand("stop", true);
				await this.execSc(["stop", GRAVITYLESS_DNS_SERVICE_NAME], true);
				await this.runNativeServiceCommand("uninstall", true);
				await this.runNativeServiceCommand("uninstall", true, this.legacyPaths);
				await this.execSc(["delete", GRAVITYLESS_DNS_SERVICE_NAME], true);
			}
			await this.flushDnsCache().catch(() => void 0);
			this.lastError = null;
			this.invalidateStatusCache();
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			throw error;
		}
	}
	async installFiles() {
		const sourceExe = path.join(this.sourceDir, GRAVITYLESS_DNS_EXE_NAME);
		const sourceToml = path.join(this.sourceDir, GRAVITYLESS_DNS_TOML_NAME);
		await this.ensurePath(sourceExe, "Встроенный dnscrypt-proxy.exe не найден.");
		await this.ensurePath(sourceToml, "Встроенный dnscrypt-proxy.toml не найден.");
		await promises.mkdir(this.paths.installDir, { recursive: true });
		await this.copyManagedFileWithRetries(sourceExe, this.paths.exePath);
		if ((await this.sha256File(this.paths.exePath))?.toLowerCase() !== "23d1895bcfa8573605e811056d12b2bf5f13b0633758fbeda3ded79c5a6ea19d".toLowerCase()) throw new Error(`Установленный ${GRAVITYLESS_DNS_EXE_NAME} не совпал по SHA-256 после копирования — файл занят или повреждён. Служба не установлена.`);
		const patchedToml = patchDnscryptTomlListenAddresses(await promises.readFile(sourceToml, "utf8"), false);
		await promises.writeFile(this.paths.configPath, patchedToml, "utf8");
		if (await promises.readFile(this.paths.configPath, "utf8").catch(() => "") !== patchedToml) throw new Error(`Конфиг ${GRAVITYLESS_DNS_TOML_NAME} записан не полностью. Служба не установлена.`);
	}
	async validateConfig() {
		await execFileAsync$15(this.paths.exePath, [
			"-config",
			this.paths.configPath,
			"-check"
		], {
			cwd: this.paths.installDir,
			windowsHide: true,
			timeout: 3e4
		});
	}
	async reinstallService() {
		await this.stopExistingRuntime();
		if (this.coreService) {
			if ((await this.queryService()).state !== "not-installed") await this.coreService.removeOwnedService(GRAVITYLESS_DNS_SERVICE_NAME);
			await this.coreService.installOwnedService(GRAVITYLESS_DNS_SERVICE_NAME);
		} else {
			await this.runNativeServiceCommand("uninstall", true);
			await this.runNativeServiceCommand("uninstall", true, this.legacyPaths);
			await this.execSc(["delete", GRAVITYLESS_DNS_SERVICE_NAME], true);
			await execFileAsync$15(this.paths.exePath, [
				"-config",
				this.paths.configPath,
				"-logfile",
				path.join(this.paths.installDir, GRAVITYLESS_DNS_LOG_NAME),
				"-logfile-truncate",
				"-service",
				"install"
			], {
				cwd: this.paths.installDir,
				windowsHide: true,
				timeout: 3e4
			});
			await this.execSc([
				"config",
				GRAVITYLESS_DNS_SERVICE_NAME,
				"start=",
				"auto"
			], true);
			await this.execSc([
				"failure",
				GRAVITYLESS_DNS_SERVICE_NAME,
				"reset=",
				"86400",
				"actions=",
				"restart/5000/restart/10000/restart/30000"
			], true);
			await this.execSc([
				"config",
				GRAVITYLESS_DNS_SERVICE_NAME,
				"depend=",
				"Tcpip/Afd"
			], true);
			await this.execSc([
				"failureflag",
				GRAVITYLESS_DNS_SERVICE_NAME,
				"1"
			], true);
			await execFileAsync$15(resolveWindowsExecutable("reg.exe"), [
				"add",
				`HKLM\\SYSTEM\\CurrentControlSet\\Services\\${GRAVITYLESS_DNS_SERVICE_NAME}`,
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
		}
	}
	async startService() {
		if (this.coreService) {
			await this.coreService.startOwnedService(GRAVITYLESS_DNS_SERVICE_NAME);
			return;
		}
		try {
			await this.runNativeServiceCommand("start", false);
		} catch (error) {
			logger.warn("[gravityless-dns] Native service start failed, falling back to sc start:", error);
			await this.execSc(["start", GRAVITYLESS_DNS_SERVICE_NAME], false);
		}
	}
	async stopExistingRuntime() {
		if (this.coreService) {
			if ((await this.queryService()).state !== "not-installed") await this.coreService.stopOwnedService(GRAVITYLESS_DNS_SERVICE_NAME);
		} else {
			await this.runNativeServiceCommand("stop", true);
			await this.execSc(["stop", GRAVITYLESS_DNS_SERVICE_NAME], true);
		}
		if (!this.coreService) await this.runNativeServiceCommand("stop", true, this.legacyPaths);
		await this.waitForServiceState("stopped", 8e3).catch(() => void 0);
		await this.killManagedDnscryptProcesses();
		await sleep$1(500);
	}
	async killManagedDnscryptProcesses() {
		const script = [
			`$roots = @(${[this.paths.installDir, this.legacyPaths.installDir].map((item) => item.replace(/'/g, "''")).map((root) => `'${root}'`).join(", ")}) | ForEach-Object { [System.IO.Path]::GetFullPath($_) }`,
			"$processes = Get-CimInstance Win32_Process -Filter \"Name='dnscrypt-proxy.exe'\" -ErrorAction SilentlyContinue | Where-Object {",
			"  $path = if ($_.ExecutablePath) { [System.IO.Path]::GetFullPath($_.ExecutablePath) } else { '' }",
			"  $roots | Where-Object { $path.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }",
			"}",
			"foreach ($proc in $processes) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }"
		].join("; ");
		await execFileAsync$15(resolveWindowsExecutable("powershell.exe"), [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			script
		], {
			windowsHide: true,
			timeout: 12e3
		}).catch(() => void 0);
	}
	async copyManagedFileWithRetries(sourcePath, targetPath) {
		if (await this.pathExists(targetPath) && await this.sha256File(sourcePath) === await this.sha256File(targetPath)) return;
		let lastError;
		for (let attempt = 0; attempt < 6; attempt += 1) try {
			await promises.copyFile(sourcePath, targetPath);
			return;
		} catch (error) {
			lastError = error;
			const code = error instanceof Error && "code" in error ? String(error.code ?? "") : "";
			if (![
				"EBUSY",
				"EPERM",
				"EACCES"
			].includes(code) || attempt === 5) break;
			await this.stopExistingRuntime();
			await sleep$1(500 + attempt * 250);
		}
		throw lastError instanceof Error ? lastError : /* @__PURE__ */ new Error("Не удалось обновить dnscrypt-proxy.exe.");
	}
	async sha256File(filePath) {
		try {
			const data = await promises.readFile(filePath);
			return createHash("sha256").update(data).digest("hex");
		} catch {
			return null;
		}
	}
	async queryService() {
		try {
			const { stdout } = await execFileAsync$15(resolveWindowsExecutable("sc.exe"), ["queryex", GRAVITYLESS_DNS_SERVICE_NAME], {
				windowsHide: true,
				timeout: 8e3
			});
			const parsed = parseScQueryState$1(stdout);
			if (parsed.state !== "unknown") return parsed;
		} catch (error) {
			const output = this.getCommandOutput(error);
			if (output) {
				const parsed = parseScQueryState$1(output);
				if (parsed.state !== "unknown") return parsed;
			}
		}
		return this.queryServiceViaCim();
	}
	async queryServiceViaCim() {
		const script = [
			"$ErrorActionPreference = 'Stop'",
			`$svc = Get-CimInstance Win32_Service -Filter "Name='${GRAVITYLESS_DNS_SERVICE_NAME}'" -ErrorAction Stop`,
			"if (-not $svc) { Write-Output 'STATE=NOT_INSTALLED'; exit 0 }",
			"Write-Output (\"STATE=\" + $svc.State)",
			"Write-Output (\"PID=\" + $svc.ProcessId)"
		].join("; ");
		try {
			const { stdout } = await execFileAsync$15(resolveWindowsExecutable("powershell.exe"), [
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
			const stateMatch = stdout.match(/STATE=(.+)/i);
			const pidMatch = stdout.match(/PID=(\d+)/i);
			return {
				serviceName: GRAVITYLESS_DNS_SERVICE_NAME,
				state: normalizeCimServiceState(stateMatch?.[1]?.trim() ?? ""),
				pid: pidMatch?.[1] ? Number.parseInt(pidMatch[1], 10) : null,
				rawState: stateMatch?.[1]?.trim() ?? null
			};
		} catch {
			return {
				serviceName: GRAVITYLESS_DNS_SERVICE_NAME,
				state: "unknown",
				pid: null,
				rawState: null
			};
		}
	}
	async waitForRunningDns(timeoutMs) {
		const startedAt = gravitylessMonotonicNow();
		let lastState = "unknown";
		while (gravitylessMonotonicNow() - startedAt < timeoutMs) {
			const status = await this.queryService();
			lastState = status.state;
			if (status.state === "running" && await this.verifyLocalDns().catch(() => false)) return;
			await sleep$1(500);
		}
		throw new Error(`Gravityless DNS service ${GRAVITYLESS_DNS_SERVICE_NAME} не перешла в состояние running и не ответила на 127.0.0.1:53. Текущее состояние: ${lastState}.`);
	}
	async waitForServiceState(expectedState, timeoutMs) {
		const startedAt = gravitylessMonotonicNow();
		while (gravitylessMonotonicNow() - startedAt < timeoutMs) {
			if ((await this.queryService()).state === expectedState) return;
			await sleep$1(500);
		}
		const status = await this.queryService();
		throw new Error(`Gravityless DNS service ${GRAVITYLESS_DNS_SERVICE_NAME} не перешла в состояние ${expectedState}. Текущее состояние: ${status.state}.`);
	}
	async verifyLocalDns() {
		const controller = new AbortController();
		try {
			const answers = await Promise.all([
				queryDnsARecord(GRAVITYLESS_DNS_TEST_DOMAIN, LOCAL_DNS_HOST, LOCAL_DNS_PORT, 5e3, controller.signal),
				queryDnsARecordTcp(GRAVITYLESS_DNS_TEST_DOMAIN, LOCAL_DNS_HOST, LOCAL_DNS_PORT, 5e3, controller.signal)
			]);
			if (!answers.every((value) => value === true)) throw new Error(`Gravityless DNS не вернул корректную A-запись для ${GRAVITYLESS_DNS_TEST_DOMAIN} через UDP и TCP 127.0.0.1:53.`);
			return true;
		} finally { controller.abort(); }
	}
	async runNativeServiceCommand(command, ignoreFailure, paths = this.paths) {
		try {
			if (!await this.pathExists(paths.exePath)) {
				if (ignoreFailure) return;
				throw new Error(`dnscrypt-proxy.exe not found: ${paths.exePath}`);
			}
			await execFileAsync$15(paths.exePath, ["-service", command], {
				cwd: paths.installDir,
				windowsHide: true,
				timeout: 3e4
			});
		} catch (error) {
			if (!ignoreFailure) throw error;
		}
	}
	async execSc(args, ignoreFailure) {
		try {
			await execFileAsync$15(resolveWindowsExecutable("sc.exe"), args, {
				windowsHide: true,
				timeout: 2e4
			});
		} catch (error) {
			if (!ignoreFailure) throw error;
		}
	}
	async flushDnsCache() {
		await execFileAsync$15(resolveWindowsExecutable("ipconfig"), ["/flushdns"], {
			windowsHide: true,
			timeout: 8e3
		});
	}
	async ensurePath(filePath, message) {
		if (!await this.pathExists(filePath)) throw new Error(message);
	}
	async pathExists(filePath) {
		try {
			await promises.access(filePath);
			return true;
		} catch {
			return false;
		}
	}
	getCommandOutput(error) {
		if (error && typeof error === "object") {
			const candidate = error;
			return [
				candidate.stdout,
				candidate.stderr,
				candidate.message
			].filter((item) => typeof item === "string").join("\n");
		}
		return "";
	}
};
function queryDnsARecord(domain, server, port, timeoutMs, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) { reject(signal.reason ?? new Error("DNS query cancelled.")); return; }
		const socket = dgram.createSocket("udp4");
		let settled = false, timer;
		const onAbort = () => finish(signal.reason ?? new Error("DNS query cancelled."));
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			try { socket.close(); } catch {}
			if (error) reject(error); else resolve(value);
		};
		socket.once("error", (error) => finish(error));
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			const queryId = Math.floor(Math.random() * 65536);
			const query = buildDnsAQuery(domain, queryId);
			timer = setTimeout(() => finish(new Error(`DNS query timeout for ${domain} via ${server}:${port}.`)), timeoutMs);
			socket.on("message", (message, remote) => {
				if (remote.address !== server || remote.port !== port || !isValidGravitylessDnsAnswer(message, queryId, domain)) return;
				finish(null, true);
			});
			socket.send(query, port, server, (error) => { if (error) finish(error); });
		} catch (error) { finish(error); }
	});
}
function queryDnsARecordTcp(domain, server, port, timeoutMs, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) { reject(signal.reason ?? new Error("DNS query cancelled.")); return; }
		let socket, timer, settled = false, buffer = Buffer.alloc(0), expectedLength = null;
		const onAbort = () => finish(signal.reason ?? new Error("DNS query cancelled."));
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			socket?.destroy();
			if (error) reject(error); else resolve(value);
		};
		try {
			const queryId = Math.floor(Math.random() * 65536);
			const query = buildDnsAQuery(domain, queryId);
			const frame = Buffer.alloc(query.length + 2);
			frame.writeUInt16BE(query.length, 0); query.copy(frame, 2);
			timer = setTimeout(() => finish(new Error(`DNS TCP query timeout for ${domain} via ${server}:${port}.`)), timeoutMs);
			signal?.addEventListener("abort", onAbort, { once: true });
			socket = createConnection({ host: server, port }, () => { if (!settled) socket.write(frame); });
			socket.once("error", (error) => finish(error));
			socket.once("end", () => finish(new Error("DNS TCP response was truncated.")));
			socket.once("close", () => { if (!settled) finish(new Error("DNS TCP connection closed before a matching answer.")); });
			socket.on("data", (chunk) => {
				if (settled) return;
				if (buffer.length + chunk.length > 65537) { finish(new Error("Oversized DNS TCP response.")); return; }
				buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
				if (expectedLength === null && buffer.length >= 2) {
					expectedLength = buffer.readUInt16BE(0);
					if (expectedLength < 12) { finish(new Error("Invalid DNS TCP frame length.")); return; }
				}
				if (expectedLength === null || buffer.length < expectedLength + 2) return;
				if (buffer.length !== expectedLength + 2 || !isValidGravitylessDnsAnswer(buffer.subarray(2), queryId, domain)) {
					finish(new Error("DNS TCP endpoint did not return a complete matching A answer.")); return;
				}
				finish(null, true);
			});
		} catch (error) { finish(error); }
	});
}
function buildDnsAQuery(domain, queryId) {
	const labels = domain.replace(/\.$/, "").split(".");
	if (!labels.length || labels.some((label) => !/^[A-Za-z0-9_-]{1,63}$/.test(label)) || Buffer.byteLength(labels.join(".")) > 253) throw new Error("Invalid DNS query name.");
	const length = 12 + labels.reduce((total, label) => total + 1 + Buffer.byteLength(label), 0) + 1 + 4;
	const buffer = Buffer.alloc(length);
	let offset = 0;
	buffer.writeUInt16BE(queryId & 65535, offset);
	offset += 2;
	buffer.writeUInt16BE(256, offset);
	offset += 2;
	buffer.writeUInt16BE(1, offset);
	offset += 2;
	buffer.writeUInt16BE(0, offset);
	offset += 2;
	buffer.writeUInt16BE(0, offset);
	offset += 2;
	buffer.writeUInt16BE(0, offset);
	offset += 2;
	for (const label of labels) {
		const labelLength = Buffer.byteLength(label);
		buffer.writeUInt8(labelLength, offset);
		offset += 1;
		buffer.write(label, offset, labelLength, "ascii");
		offset += labelLength;
	}
	buffer.writeUInt8(0, offset);
	offset += 1;
	buffer.writeUInt16BE(1, offset);
	offset += 2;
	buffer.writeUInt16BE(1, offset);
	return buffer;
}
function sleep$1(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function normalizeCimServiceState(rawState) {
	switch (rawState.toLowerCase()) {
		case "running": return "running";
		case "stopped": return "stopped";
		case "start pending":
		case "start-pending": return "start-pending";
		case "stop pending":
		case "stop-pending": return "stop-pending";
		case "not_installed":
		case "not-installed": return "not-installed";
		default: return "unknown";
	}
}
//#endregion
