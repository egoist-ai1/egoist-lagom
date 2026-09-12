//#region src/electron/ipc/gravityless-dns-manager.ts
var execFileAsync$15 = promisify(execFile);
var LOCAL_DNS_HOST = "127.0.0.1";
var LOCAL_DNS_PORT = 53;
var SERVICE_START_TIMEOUT_MS$1 = 2e4;
var GRAVITYLESS_STATUS_CACHE_TTL_MS = 3e3;
var PORT_PROBE_TIMEOUT_MS = 1500;
/**
* A DNS reply only proves that *our* resolver answered when the transaction id
* matches, the response bit is set, rcode is NOERROR **and** at least one answer
* record came back. The previous check accepted any 12-byte datagram with
* rcode 0, so a stray packet or an unrelated resolver returning NOERROR/0
* answers was reported as "Gravityless verified".
*/
function isValidGravitylessDnsAnswer(message, expectedId) {
	if (message.length < 12) return false;
	if (message.readUInt16BE(0) !== expectedId) return false;
	const flags = message.readUInt16BE(2);
	if ((flags & 32768) !== 32768) return false;
	if ((flags & 15) !== 0) return false;
	return message.readUInt16BE(6) > 0;
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
	constructor(resourcesPath, coreService) {
		this.resourcesPath = resourcesPath;
		this.coreService = coreService;
		this.sourceDir = path.join(this.resourcesPath, "gravityless-dns");
	}
	async status(options = {}) {
		const now = Date.now();
		if (!options.force && this.statusCache && this.statusCache.expiresAt > now) return this.statusCache.value;
		if (!options.force && this.statusInFlight) return this.statusInFlight;
		this.statusInFlight = this.readStatus().then((value) => {
			this.statusCache = {
				value,
				expiresAt: Date.now() + GRAVITYLESS_STATUS_CACHE_TTL_MS
			};
			return value;
		}).finally(() => {
			this.statusInFlight = null;
		});
		return this.statusInFlight;
	}
	invalidateStatusCache() {
		this.statusCache = null;
	}
	async readStatus() {
		const service = await this.queryService();
		const verified = service.state !== "not-installed" ? await this.verifyLocalDns().catch(() => false) : false;
		const running = service.state === "running" || verified;
		return {
			available: await this.pathExists(path.join(this.sourceDir, GRAVITYLESS_DNS_EXE_NAME)),
			running,
			verified,
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
			`$svc = Get-CimInstance Win32_Service -Filter "Name='${GRAVITYLESS_DNS_SERVICE_NAME}'" -ErrorAction SilentlyContinue`,
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
				state: "not-installed",
				pid: null,
				rawState: null
			};
		}
	}
	async waitForRunningDns(timeoutMs) {
		const startedAt = Date.now();
		let lastState = "unknown";
		while (Date.now() - startedAt < timeoutMs) {
			const status = await this.queryService();
			lastState = status.state;
			if (status.state === "running") return;
			if (await this.verifyLocalDns().catch(() => false)) return;
			await sleep$1(500);
		}
		throw new Error(`Gravityless DNS service ${GRAVITYLESS_DNS_SERVICE_NAME} не перешла в состояние running и не ответила на 127.0.0.1:53. Текущее состояние: ${lastState}.`);
	}
	async waitForServiceState(expectedState, timeoutMs) {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			if ((await this.queryService()).state === expectedState) return;
			await sleep$1(500);
		}
		const status = await this.queryService();
		throw new Error(`Gravityless DNS service ${GRAVITYLESS_DNS_SERVICE_NAME} не перешла в состояние ${expectedState}. Текущее состояние: ${status.state}.`);
	}
	async verifyLocalDns() {
		if (!await queryDnsARecord("gravityless.space", LOCAL_DNS_HOST, LOCAL_DNS_PORT, 5e3)) throw new Error(`Gravityless DNS не вернул ответ для ${GRAVITYLESS_DNS_TEST_DOMAIN} через 127.0.0.1:53 (нет корректной A-записи).`);
		return true;
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
function queryDnsARecord(domain, server, port, timeoutMs) {
	return new Promise((resolve, reject) => {
		const socket = dgram.createSocket("udp4");
		const queryId = Math.floor(Math.random() * 65535);
		const query = buildDnsAQuery(domain, queryId);
		const timer = setTimeout(() => {
			socket.close();
			reject(/* @__PURE__ */ new Error(`DNS query timeout for ${domain} via ${server}:${port}.`));
		}, timeoutMs);
		socket.once("message", (message) => {
			clearTimeout(timer);
			socket.close();
			resolve(isValidGravitylessDnsAnswer(message, queryId));
		});
		socket.once("error", (error) => {
			clearTimeout(timer);
			socket.close();
			reject(error);
		});
		socket.send(query, port, server);
	});
}
function buildDnsAQuery(domain, queryId) {
	const labels = domain.split(".").filter(Boolean);
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
