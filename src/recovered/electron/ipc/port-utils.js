//#region src/electron/ipc/port-utils.ts
/** Найти свободный TCP-порт начиная с preferredPort */
async function findAvailablePort(preferredPort, taken = /* @__PURE__ */ new Set()) {
	for (let offset = 0; offset <= 100; offset += 1) {
		const candidate = preferredPort + offset;
		if (taken.has(candidate)) continue;
		if (await canBindPort(candidate)) return candidate;
	}
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close(() => reject(/* @__PURE__ */ new Error("Failed to obtain dynamic port.")));
				return;
			}
			const { port } = address;
			server.close((closeErr) => {
				if (closeErr) {
					reject(closeErr);
					return;
				}
				resolve(port);
			});
		});
	});
}
/** Проверить можно ли забиндить порт */
async function canBindPort(port) {
	return new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.listen(port, "127.0.0.1", () => {
			server.close(() => resolve(true));
		});
	});
}
/** Ждём пока TCP-порт станет доступен */
async function waitForPort(port, timeoutMs, shouldStop = () => false) {
	const start = Date.now();
	const interval = 100;
	const delay = (ms) => new Promise((r) => setTimeout(r, ms));
	while (!shouldStop() && Date.now() - start < timeoutMs) try {
		await new Promise((resolve, reject) => {
			const sock = createConnection({
				host: "127.0.0.1",
				port,
				timeout: 500
			}, () => {
				sock.destroy();
				resolve();
			});
			sock.on("error", () => {
				sock.destroy();
				reject();
			});
			sock.on("timeout", () => {
				sock.destroy();
				reject();
			});
		});
		return true;
	} catch {
		await delay(interval);
	}
	return false;
}
var CORE_SERVICE_PIPE_NAME = "EgoistShield.Service.v1";
var CORE_SERVICE_PIPE_PATH = `\\\\.\\pipe\\${CORE_SERVICE_PIPE_NAME}`;
var CORE_SERVICE_NAME = "EgoistShieldCore";
var CONNECT_TIMEOUT_MS = 1e4;
var REQUEST_TIMEOUT_MS = 35e3;
var MUTATION_REQUEST_TIMEOUT_MS = 18e4;
var MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
var SERVER_IDENTITY_REVERIFY_MS = 6e4;
// All desktop managers share one Core client in production, while a small
// legacy handler still owns a second instance. Keep their mutating requests
// serialized in-process so a background component check cannot collide with a
// shield transition and produce a misleading `Another system mutation` error.
var coreMutationQueue = Promise.resolve();
var execFileAsync$10 = promisify(execFile);
var CoreServiceRequestError = class extends Error {
	code;
	retryable;
	constructor(error) {
		super(error.message);
		this.name = "CoreServiceRequestError";
		this.code = error.code;
		this.retryable = error.retryable;
	}
};
var CoreServiceUnavailableError = class extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = "CoreServiceUnavailableError";
	}
};
var CoreServiceClient = class CoreServiceClient {
	pipePath;
	requireServerIdentity;
	verifiedServicePid = null;
	identityVerifiedAt = 0;
	identityVerificationInFlight = null;
	identityInvalidationReason = "cold";
	constructor(pipePath = CORE_SERVICE_PIPE_PATH) {
		this.pipePath = pipePath;
		this.requireServerIdentity = pipePath === CORE_SERVICE_PIPE_PATH;
	}
	/**
	* Проверка доступности выполняется одной попыткой: она стоит на пути запуска,
	* и три повтора по connect-таймауту задержали бы старт на несколько секунд.
	*/
	async isAvailable() {
		try {
			await this.requestOnce("hello", {});
			return true;
		} catch (error) {
			if (error instanceof CoreServiceUnavailableError) return false;
			if (error instanceof CoreServiceRequestError) return false;
			throw error;
		}
	}
	async dnsStatus() {
		return this.request("dns.status", {});
	}
	async applyDns(servers, options = {}) {
		return this.request("dns.apply", {
			servers,
			probeHosts: options.probeHosts ?? []
		});
	}
	async resetDns() {
		return this.request("dns.reset", {});
	}
	async restoreOwnedDns() {
		return this.request("dns.restore-owned", {});
	}
	async nativeDohStatus() {
		return this.request("dns.doh.status", {});
	}
	async applyNativeDoh(url, servers, options = {}) {
		return this.request("dns.doh.apply", {
			url,
			servers,
			probeHosts: options.probeHosts ?? []
		});
	}
	async removeNativeDoh() {
		return this.request("dns.doh.remove", {});
	}
	async repairOwnedNetwork() {
		return this.request("network.repair-owned", {});
	}
	async ownedServiceStatus(serviceName) {
		return this.request("owned-service.status", { serviceName });
	}
	async installOwnedService(serviceName) {
		return this.request("owned-service.install", { serviceName });
	}
	async removeOwnedService(serviceName) {
		return this.request("owned-service.remove", { serviceName });
	}
	async startOwnedService(serviceName) {
		return this.request("owned-service.start", { serviceName });
	}
	async stopOwnedService(serviceName) {
		return this.request("owned-service.stop", { serviceName });
	}
	async setZapretProfile(profile) {
		return this.request("zapret.profile.set", { profile });
	}
	/**
	* Повтор допустим только для операций без побочных эффектов. Мутация
	* повторяется на стороне службы по requestId, поэтому здесь она не
	* переотправляется: новый requestId означал бы новую транзакцию.
	*/
	static IDEMPOTENT_OPERATIONS = /* @__PURE__ */ new Set([
		"hello",
		"service.status",
		"recovery.status",
		"dns.status",
		"dns.doh.status",
		"owned-service.status"
	]);
	async request(operation, payload) {
		const run = async () => {
			const isIdempotent = CoreServiceClient.IDEMPOTENT_OPERATIONS.has(operation);
			const attempts = isIdempotent ? 3 : 5;
			let lastError;
			for (let attempt = 0; attempt < attempts; attempt += 1) try {
				return await this.requestOnce(operation, payload);
			} catch (error) {
				const isBusyOrRetryable = (error instanceof CoreServiceUnavailableError && isIdempotent) ||
					(error instanceof CoreServiceRequestError && (
						(isIdempotent && error.retryable) ||
						error.code === "MUTATION_BUSY" ||
						(typeof error.message === "string" && error.message.includes("Another system mutation"))
					));
				if (!isBusyOrRetryable || attempt === attempts - 1) throw error;
				lastError = error;
				await new Promise((resolve) => setTimeout(resolve, (isIdempotent ? 200 : 500) * (attempt + 1)));
			}
			throw lastError instanceof Error ? lastError : new CoreServiceUnavailableError("Core service did not answer.");
		};
		const isMutation = operation !== "component.query" && !CoreServiceClient.IDEMPOTENT_OPERATIONS.has(operation);
		if (!isMutation) return run();
		const queued = coreMutationQueue.then(run, run);
		coreMutationQueue = queued.then(() => void 0, () => void 0);
		return queued;
	}
	async requestOnce(operation, payload) {
		await this.verifyServerIdentity();
		const requestId = `electron:${process.pid}:${Date.now()}:${randomUUID()}`;
		const rawRequest = `${JSON.stringify({
			protocolVersion: 1,
			requestId,
			operation,
			payload
		})}\n`;
		let response;
		try {
			const timeout = operation === "component.execute" ? 21 * 60 * 1000
				: operation.startsWith("dns.") || operation === "network.repair-owned"
					? CoreServiceClient.IDEMPOTENT_OPERATIONS.has(operation) ? 130000 : 12 * 60 * 1000
				: operation === "component.query" ? 130000
				: CoreServiceClient.IDEMPOTENT_OPERATIONS.has(operation) ? REQUEST_TIMEOUT_MS : MUTATION_REQUEST_TIMEOUT_MS;
			response = await this.exchange(rawRequest, timeout);
		} catch (error) {
			this.verifiedServicePid = null;
			this.identityVerifiedAt = 0;
			this.identityInvalidationReason = "exchange-failed";
			throw error;
		}
		if (response.protocolVersion !== 1) throw new CoreServiceRequestError({
			code: "PROTOCOL_MISMATCH",
			message: `Core service protocol mismatch: ${response.protocolVersion}.`,
			retryable: false
		});
		if (response.requestId !== requestId) throw new CoreServiceRequestError({
			code: "RESPONSE_MISMATCH",
			message: "Core service returned a response for another request.",
			retryable: false
		});
		if (!response.ok) throw new CoreServiceRequestError(response.error ?? {
			code: "OPERATION_FAILED",
			message: "Core service reported a failure without an error code.",
			retryable: false
		});
		return response.result;
	}
	/**
	* A pipe name and DACL authenticate the client to the service, but not the
	* service to the client. While Core is offline, a local process could create
	* the same pipe name and forge successful replies. The installed Core binary
	* opens a bounded probe connection, compares the pipe-server PID with the SCM
	* PID and its own protected image path, then completes a hello exchange.
	*/
	async verifyServerIdentity() {
		if (!this.requireServerIdentity) return;
		if (process.platform !== "win32") throw new CoreServiceUnavailableError("Core service identity can be verified only on Windows.");
		const previousServicePid = this.verifiedServicePid;
		const cacheAgeMs = this.identityVerifiedAt > 0 ? Date.now() - this.identityVerifiedAt : null;
		let reason = this.verifiedServicePid !== null ? "cache-expired" : this.identityInvalidationReason;
		if (this.verifiedServicePid !== null && Date.now() - this.identityVerifiedAt < SERVER_IDENTITY_REVERIFY_MS) try {
			process.kill(this.verifiedServicePid, 0);
			return;
		} catch (error) {
			const code = typeof error?.code === "string" && /^[A-Z_]+$/.test(error.code) ? error.code : "unknown";
			reason = `liveness-error:${code}`;
			this.verifiedServicePid = null;
			this.identityVerifiedAt = 0;
		}
		if (this.identityVerificationInFlight) return this.identityVerificationInFlight;
		this.identityVerificationInFlight = this.performServerIdentityVerification({ reason, previousServicePid, cacheAgeMs }).finally(() => {
			this.identityVerificationInFlight = null;
		});
		return this.identityVerificationInFlight;
	}
	async performServerIdentityVerification(diagnostic = { reason: "direct", previousServicePid: null, cacheAgeMs: null }) {
		const startedAt = Date.now();
		const verifierPath = path.join(process.resourcesPath, "core-service", "win-x64", "EgoistShield.Service.exe");
		if (!fs.existsSync(verifierPath)) throw new CoreServiceUnavailableError("Core service identity verifier is missing from the installed package.");
		try {
			const { stdout } = await execFileAsync$10(verifierPath, [
				"--verify-pipe-server",
				"--pipe-name",
				CORE_SERVICE_PIPE_NAME,
				"--service-name",
				CORE_SERVICE_NAME
			], {
				windowsHide: true,
				timeout: 6e4,
				maxBuffer: 128 * 1024,
				encoding: "utf8"
			});
			const result = JSON.parse(String(stdout).trim());
			if (result.ok !== true || !Number.isSafeInteger(result.serverProcessId) || result.serverProcessId !== result.serviceProcessId || Number(result.serverProcessId) <= 0) throw new Error(`${result.code ?? "IDENTITY_FAILED"}: ${result.message ?? "Core identity was not verified."}`);
			this.verifiedServicePid = Number(result.serverProcessId);
			this.identityVerifiedAt = Date.now();
		} catch (error) {
			this.verifiedServicePid = null;
			this.identityVerifiedAt = 0;
			this.identityInvalidationReason = "identity-failed";
			throw new CoreServiceUnavailableError(`Core service named-pipe identity verification failed. reason=${diagnostic.reason}, elapsedMs=${Date.now() - startedAt}, previousServicePid=${diagnostic.previousServicePid}, cacheAgeMs=${diagnostic.cacheAgeMs}`, { cause: error });
		}
	}
	exchange(rawRequest, requestTimeoutMs) {
		return new Promise((resolve, reject) => {
			const socket = net.createConnection(this.pipePath);
			let connected = false;
			let settled = false;
			let response = "";
			const connectTimer = setTimeout(() => {
				finish(new CoreServiceUnavailableError(`Core service did not accept a connection within ${CONNECT_TIMEOUT_MS} ms.`));
			}, CONNECT_TIMEOUT_MS);
			const requestTimer = setTimeout(() => {
				finish(new CoreServiceUnavailableError(`Core service did not answer within ${requestTimeoutMs} ms.`));
			}, requestTimeoutMs);
			const finish = (error, value) => {
				if (settled) return;
				settled = true;
				clearTimeout(connectTimer);
				clearTimeout(requestTimer);
				socket.destroy();
				if (error) reject(error);
				else resolve(value);
			};
			socket.setEncoding("utf8");
			socket.on("connect", () => {
				connected = true;
				clearTimeout(connectTimer);
				socket.write(rawRequest);
			});
			socket.on("data", (chunk) => {
				response += chunk;
				if (Buffer.byteLength(response, "utf8") > MAX_RESPONSE_BYTES) {
					finish(new CoreServiceRequestError({
						code: "RESPONSE_TOO_LARGE",
						message: "Core service response exceeded the local safety limit.",
						retryable: false
					}));
					return;
				}
				const newline = response.indexOf("\n");
				if (newline < 0) return;
				try {
					finish(void 0, JSON.parse(response.slice(0, newline)));
				} catch (error) {
					finish(new CoreServiceRequestError({
						code: "INVALID_RESPONSE",
						message: error instanceof Error ? error.message : "Core service returned invalid JSON.",
						retryable: false
					}));
				}
			});
			socket.on("error", (error) => {
				const unavailable = !connected && (error.code === "ENOENT" || error.code === "ECONNREFUSED" || error.code === "EACCES");
				finish(unavailable ? new CoreServiceUnavailableError(`Core service pipe is unavailable (${error.code ?? "unknown"}).`, { cause: error }) : error);
			});
			socket.on("end", () => {
				if (!settled) finish(new CoreServiceRequestError({
					code: "TRUNCATED_RESPONSE",
					message: "Core service closed the pipe before returning a complete response.",
					retryable: true
				}));
			});
		});
	}
};
//#endregion
