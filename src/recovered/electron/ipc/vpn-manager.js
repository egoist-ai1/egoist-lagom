//#region src/electron/ipc/vpn-manager.ts
var execFileAsync$2 = promisify(execFile);
var DEFAULT_RUNTIME_CANDIDATES = {
	xray: ["runtime\\xray\\xray.exe", "xray.exe"],
	"sing-box": ["runtime\\sing-box\\sing-box.exe", "sing-box.exe"]
};
var SINGBOX_PROTOCOLS = /* @__PURE__ */ new Set([
	"hysteria2",
	"tuic",
	"wireguard"
]);
var XRAY_NATIVE_TUN_MIN_VERSION = "v26.5.3";
var DNS_FAILURE_PATTERNS = [
	"dns",
	"resolve",
	"lookup",
	"no such host",
	"server misbehaving"
];
var TLS_FAILURE_PATTERNS = [
	"tls",
	"handshake",
	"x509",
	"certificate",
	"reality"
];
var AUTH_FAILURE_PATTERNS = [
	"auth",
	"invalid user",
	"wrong password",
	"unauthorized",
	"forbidden"
];
var QUIC_FAILURE_PATTERNS = [
	"quic",
	"udp",
	"no recent network activity"
];
var NETWORK_FAILURE_PATTERNS = [
	"connection refused",
	"actively refused",
	"timed out",
	"timeout",
	"network is unreachable",
	"connection reset",
	"no route to host",
	"unreachable"
];
var PREPARED_SESSION_PROBES = 5;
var PREPARED_SESSION_TIMEOUT_MS = 2e3;
var PREPARED_SESSION_MIN_SUCCESS = 2;
var PREPARED_SESSION_SETTLE_MS = 700;
var PROBE_INTERVAL_MS = 180;
var HANDOFF_VERIFY_DELAY_MS = 2500;
var HANDOFF_RETIRE_GRACE_MS = 8e3;
var HANDOFF_VERIFY_PROBES = 4;
var HANDOFF_VERIFY_TIMEOUT_MS = 1200;
var HANDOFF_VERIFY_MIN_SUCCESS = 3;
var XRAY_TUN_ROUTE_RETRY_BACKOFF_MS = 1e3;
var XRAY_TUN_ROUTE_INITIALIZATION_FAILURE = /proxy\/tun:\s*unable to set routes\s*>\s*element not found/i;
/** Окно, в течение которого проверка готовности порта считается ещё актуальной. */
var READINESS_PROBE_REUSE_WINDOW_MS = 1500;
/** Верхняя граница размера expectedExits: генерации монотонны, старое не «выстрелит». */
var EXPECTED_EXITS_RETENTION = 16;
function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
var VpnRuntimeManager = class extends EventEmitter {
	mockMode;
	snapshot = {
		process: null,
		processGeneration: null,
		startedAt: null,
		proxyPort: null,
		socksPort: null,
		apiPort: null,
		configPath: null,
		nodeId: null,
		lastError: null,
		activeRuntimePath: null,
		runtimeKind: null,
		processRulesApplied: false,
		lifecycle: "idle",
		diagnostic: {
			reason: null,
			details: null,
			updatedAt: null,
			fallbackAttempted: false,
			fallbackTarget: null
		},
		protocolPlan: null,
		processRulesReason: "No process rules are configured.",
		egressVerified: false,
		egressIp: null,
		egressCheckedAt: null
	};
	appRoot;
	userDataDir;
	generationCounter = 0;
	expectedExits = /* @__PURE__ */ new Set();
	lastSettings = null;
	installer;
	killSwitch;
	cachedIsAdmin = null;
	operationMutex = Promise.resolve();
	retiringSessions = /* @__PURE__ */ new Map();
	nodeRuntimePreferences = /* @__PURE__ */ new Map();
	nodeHealthHistory = /* @__PURE__ */ new Map();
	pendingHealthVerification = null;
	pendingHandoff = null;
	/** Деградация вызвана именно потерей внешнего маршрута (снимается при его восстановлении). */
	egressDegraded = false;
	currentAttempt = null;
	constructor(appRoot, userDataDir) {
		super();
		this.appRoot = appRoot;
		this.userDataDir = userDataDir;
		const isTestEnv = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
		this.mockMode = process.env.EGOISTSHIELD_MOCK_RUNTIME === "1" && isTestEnv;
		this.installer = new RuntimeInstaller(appRoot, userDataDir);
		this.killSwitch = new KillSwitch();
	}
	/**
	* Удаляет осиротевшие временные конфиги рантайма (config_*.json содержат
	* credentials), оставшиеся после аварийного завершения приложения.
	* Вызывается при старте; активный конфиг текущей сессии не трогаем.
	*/
	async cleanupOrphanedRuntimeConfigs() {
		const tempDir = path.join(os.tmpdir(), "EgoistShield", "runtime");
		try {
			const entries = await promises.readdir(tempDir, { withFileTypes: true }).catch(() => []);
			const activeConfigPath = this.snapshot.configPath;
			for (const entry of entries) {
				if (!entry.isFile() || !/^config_.*\.json$/i.test(entry.name)) continue;
				const filePath = path.join(tempDir, entry.name);
				if (activeConfigPath && path.resolve(filePath) === path.resolve(activeConfigPath)) continue;
				await promises.rm(filePath, { force: true }).catch(() => {});
			}
		} catch {}
	}
	async isAdmin() {
		if (this.cachedIsAdmin !== null) return this.cachedIsAdmin;
		if (process.platform !== "win32") {
			this.cachedIsAdmin = true;
			return true;
		}
		const adminCheckerPath = path.join(this.appRoot, "core-service", "win-x64", "EgoistShield.Service.exe");
		if (fs.existsSync(adminCheckerPath)) try {
			const { stdout } = await execFileAsync$2(adminCheckerPath, ["--check-admin"], {
				timeout: 6e4,
				windowsHide: true,
				maxBuffer: 128 * 1024,
				encoding: "utf8"
			});
			const result = JSON.parse(String(stdout).trim());
			if (result?.ok !== true || typeof result.isAdmin !== "boolean") throw new Error("Native admin checker returned an invalid result.");
			this.cachedIsAdmin = result.isAdmin;
			return this.cachedIsAdmin;
		} catch {
			return false;
		}
		try {
			await execFileAsync$2(resolveWindowsExecutable("net.exe"), ["session"], {
				timeout: 2e3,
				windowsHide: true
			});
			this.cachedIsAdmin = true;
		} catch {
			return false;
		}
		return this.cachedIsAdmin;
	}
	/**
	* Ставит операцию в общую очередь VPN-ядра. Всё, что меняет активную сессию,
	* системный прокси или Kill Switch, обязано проходить здесь: иначе обработчик
	* аварийного выхода рантайма может включить прокси уже после того, как
	* пользовательский disconnect его выключил.
	*/
	enqueueOperation(task) {
		return new Promise((resolve, reject) => {
			this.operationMutex = this.operationMutex.then(task).then(resolve).catch(reject);
		});
	}
	/**
	* Жив ли процесс рантайма на самом деле.
	*
	* Флаги `exitCode`/`killed` у ChildProcess обновляются только после
	* асинхронного события `exit`. На Windows между фактической смертью процесса
	* и этим событием проходит заметное время, и всё это время статус утверждал
	* бы «подключено», когда трафик уже не идёт. Сигнал 0 не доставляется
	* процессу, а лишь проверяет его существование.
	*/
	isRuntimeProcessAlive() {
		const child = this.snapshot.process;
		if (!child || child.exitCode !== null || child.killed) return false;
		const pid = child.pid;
		if (typeof pid !== "number" || pid <= 0) return false;
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			return error?.code === "EPERM";
		}
	}
	async status() {
		const connected = this.isRuntimeProcessAlive();
		const lifecycle = !connected && (this.snapshot.lifecycle === "active" || this.snapshot.lifecycle === "degraded") ? "failed" : this.snapshot.lifecycle;
		return {
			connected,
			isMock: this.mockMode,
			pid: connected ? this.snapshot.process?.pid ?? null : null,
			startedAt: this.snapshot.startedAt,
			activeNodeId: this.snapshot.nodeId,
			lastError: this.snapshot.lastError,
			isAdmin: await this.isAdmin(),
			resolvedRuntimePath: this.snapshot.activeRuntimePath,
			runtimeKind: this.snapshot.runtimeKind,
			processRulesApplied: this.snapshot.processRulesApplied,
			proxyPort: this.snapshot.proxyPort,
			apiPort: this.snapshot.apiPort,
			lifecycle: connected ? lifecycle === "failed" ? "active" : lifecycle : lifecycle,
			diagnostic: { ...this.snapshot.diagnostic },
			protocolPlan: this.snapshot.protocolPlan ? { ...this.snapshot.protocolPlan } : null,
			processRulesReason: this.snapshot.processRulesReason,
			egressVerified: connected && this.snapshot.egressVerified,
			egressIp: connected ? this.snapshot.egressIp : null,
			egressCheckedAt: this.snapshot.egressCheckedAt,
			nodeHealthHistory: [...this.nodeHealthHistory.values()].sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt)).slice(0, 24)
		};
	}
	setLifecycle(nextLifecycle) {
		this.snapshot.lifecycle = nextLifecycle;
	}
	logRuntimeEvent(level, message, overrides) {
		const payload = formatRuntimeLogEvent({
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			level,
			lifecycle: overrides?.lifecycle ?? this.snapshot.lifecycle,
			reason: overrides?.reason ?? this.snapshot.diagnostic.reason,
			message,
			nodeId: overrides?.activeNodeId ?? this.snapshot.nodeId,
			runtimeKind: overrides?.runtimeKind ?? this.snapshot.runtimeKind,
			proxyPort: overrides?.proxyPort ?? this.snapshot.proxyPort
		});
		if (level === "error") {
			logger.error(payload);
			return;
		}
		if (level === "warn") {
			logger.warn(payload);
			return;
		}
		if (level === "debug") {
			logger.debug(payload);
			return;
		}
		logger.info(payload);
	}
	clearDiagnostic(options) {
		this.snapshot.diagnostic = {
			reason: null,
			details: null,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			fallbackAttempted: options?.fallbackAttempted ?? false,
			fallbackTarget: options?.fallbackTarget ?? null
		};
	}
	setFailure(reason, details, options) {
		this.snapshot.lastError = details;
		this.snapshot.lifecycle = "failed";
		this.snapshot.diagnostic = {
			reason,
			details,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			fallbackAttempted: options?.fallbackAttempted ?? false,
			fallbackTarget: options?.fallbackTarget ?? null
		};
		if (this.currentAttempt) this.recordNodeHealthFailure(this.currentAttempt.nodeId, this.currentAttempt.protocol, this.currentAttempt.runtimeKind, reason, details);
		this.logRuntimeEvent("error", details, {
			reason,
			lifecycle: "failed"
		});
	}
	recordNodeHealthSuccess(nodeId, protocol, runtimeKind, probe, protocolPlan) {
		const current = this.nodeHealthHistory.get(nodeId);
		this.nodeHealthHistory.set(nodeId, {
			nodeId,
			protocol,
			preferredRuntime: protocolPlan.preferredRuntime,
			lastRuntime: runtimeKind,
			successes: (current?.successes ?? 0) + 1,
			failures: current?.failures ?? 0,
			lastLatencyMs: probe.latencyMs,
			lastJitterMs: probe.jitterMs,
			lastLossPercent: probe.lossPercent,
			lastFailureReason: null,
			lastDetails: null,
			lastUpdatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		this.nodeRuntimePreferences.set(nodeId, runtimeKind);
	}
	recordNodeHealthFailure(nodeId, protocol, runtimeKind, reason, details) {
		const current = this.nodeHealthHistory.get(nodeId);
		this.nodeHealthHistory.set(nodeId, {
			nodeId,
			protocol,
			preferredRuntime: current?.preferredRuntime ?? runtimeKind,
			lastRuntime: runtimeKind,
			successes: current?.successes ?? 0,
			failures: (current?.failures ?? 0) + 1,
			lastLatencyMs: current?.lastLatencyMs ?? null,
			lastJitterMs: current?.lastJitterMs ?? null,
			lastLossPercent: current?.lastLossPercent ?? null,
			lastFailureReason: reason,
			lastDetails: details,
			lastUpdatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
	}
	recordPendingHealthFailure(reason, details, processGeneration) {
		const pending = this.pendingHealthVerification;
		if (!pending || processGeneration !== void 0 && pending.processGeneration !== processGeneration) return;
		this.recordNodeHealthFailure(pending.nodeId, pending.protocol, pending.runtimeKind, reason, details);
		this.pendingHealthVerification = null;
	}
	classifyFailureReason(rawOutput, stage, node, runtimeKind) {
		const normalizedOutput = rawOutput.toLowerCase();
		if (DNS_FAILURE_PATTERNS.some((pattern) => normalizedOutput.includes(pattern))) return "dns_failed";
		if (AUTH_FAILURE_PATTERNS.some((pattern) => normalizedOutput.includes(pattern))) return "auth_rejected";
		if (TLS_FAILURE_PATTERNS.some((pattern) => normalizedOutput.includes(pattern))) return "tls_handshake_failed";
		if ((node.protocol === "hysteria2" || node.protocol === "tuic" || runtimeKind === "sing-box") && QUIC_FAILURE_PATTERNS.some((pattern) => normalizedOutput.includes(pattern))) return "quic_blocked";
		if (NETWORK_FAILURE_PATTERNS.some((pattern) => normalizedOutput.includes(pattern))) return stage === "active" ? "runtime_crashed" : "server_unreachable";
		if (stage === "start") return "runtime_start_failed";
		if (stage === "warmup") return "runtime_crashed";
		return "runtime_crashed";
	}
	getActiveSession() {
		const { process, processGeneration, startedAt, proxyPort, socksPort, apiPort, configPath, nodeId, activeRuntimePath, runtimeKind, processRulesApplied } = this.snapshot;
		if (!process || processGeneration === null || !startedAt || proxyPort === null || !nodeId || !activeRuntimePath || !runtimeKind) return null;
		return {
			process,
			processGeneration,
			startedAt,
			proxyPort,
			socksPort,
			apiPort,
			configPath,
			nodeId,
			activeRuntimePath,
			runtimeKind,
			processRulesApplied
		};
	}
	applyActiveSession(session, fallbackTarget = null) {
		this.snapshot.process = session.process;
		this.snapshot.processGeneration = session.processGeneration;
		this.snapshot.startedAt = session.startedAt;
		this.snapshot.proxyPort = session.proxyPort;
		this.snapshot.socksPort = session.socksPort;
		this.snapshot.apiPort = session.apiPort;
		this.snapshot.configPath = session.configPath;
		this.snapshot.nodeId = session.nodeId;
		this.snapshot.activeRuntimePath = session.activeRuntimePath;
		this.snapshot.runtimeKind = session.runtimeKind;
		this.snapshot.processRulesApplied = session.processRulesApplied;
		this.snapshot.processRulesReason = this.snapshot.protocolPlan?.processRulesReason ?? this.snapshot.processRulesReason;
		this.snapshot.lastError = null;
		this.snapshot.lifecycle = "active";
		this.egressDegraded = false;
		this.snapshot.egressVerified = false;
		this.snapshot.egressIp = null;
		this.snapshot.egressCheckedAt = null;
		this.clearDiagnostic({
			fallbackAttempted: fallbackTarget !== null,
			fallbackTarget
		});
		if (fallbackTarget) this.nodeRuntimePreferences.set(session.nodeId, fallbackTarget);
		this.logRuntimeEvent("info", "Runtime session activated.", {
			activeNodeId: session.nodeId,
			runtimeKind: session.runtimeKind,
			proxyPort: session.proxyPort,
			lifecycle: "active",
			reason: null
		});
	}
	clearActiveSession(lastError = null) {
		this.pendingHealthVerification = null;
		this.egressDegraded = false;
		this.snapshot.process = null;
		this.snapshot.processGeneration = null;
		this.snapshot.startedAt = null;
		this.snapshot.proxyPort = null;
		this.snapshot.socksPort = null;
		this.snapshot.apiPort = null;
		this.snapshot.configPath = null;
		this.snapshot.nodeId = null;
		this.snapshot.activeRuntimePath = null;
		this.snapshot.runtimeKind = null;
		this.snapshot.processRulesApplied = false;
		this.snapshot.processRulesReason = "No process rules are configured.";
		this.snapshot.egressVerified = false;
		this.snapshot.egressIp = null;
		this.snapshot.egressCheckedAt = null;
		this.snapshot.lastError = lastError;
		this.snapshot.lifecycle = lastError ? "failed" : "idle";
		if (!lastError) this.clearDiagnostic();
	}
	clearPendingHandoff(expectedGeneration) {
		if (!this.pendingHandoff) return null;
		if (typeof expectedGeneration === "number" && this.pendingHandoff.nextSessionGeneration !== expectedGeneration) return null;
		const pendingHandoff = this.pendingHandoff;
		clearTimeout(pendingHandoff.verifyTimer);
		this.pendingHandoff = null;
		return pendingHandoff;
	}
	cancelSessionRetirement(processGeneration) {
		const existingRetirement = this.retiringSessions.get(processGeneration);
		if (!existingRetirement) return null;
		clearTimeout(existingRetirement.timer);
		this.retiringSessions.delete(processGeneration);
		return existingRetirement.session;
	}
	async probeRuntimePort(session, options) {
		if (this.mockMode && session.activeRuntimePath === "mock") return {
			ok: true,
			successfulProbes: options.probes,
			latencyMs: 0,
			jitterMs: 0,
			lossPercent: 0,
			failureReason: null,
			details: null
		};
		const samples = [];
		for (let index = 0; index < options.probes; index += 1) {
			if (index > 0) await delay(PROBE_INTERVAL_MS);
			if (session.process.exitCode !== null || session.process.killed) {
				const successfulSamples = samples.filter((sample) => sample >= 0);
				const exitCode = session.process.exitCode ?? "killed";
				return {
					ok: false,
					successfulProbes: successfulSamples.length,
					latencyMs: 0,
					jitterMs: 0,
					lossPercent: 100,
					failureReason: "runtime_crashed",
					details: `VPN-ядро завершилось во время проверки локального порта ${session.proxyPort} (exit: ${exitCode}).`
				};
			}
			const startedAt = performance.now();
			try {
				await new Promise((resolve, reject) => {
					const socket = createConnection({
						host: "127.0.0.1",
						port: session.proxyPort,
						timeout: options.timeoutMs
					}, () => {
						socket.destroy();
						resolve();
					});
					socket.on("error", (error) => {
						socket.destroy();
						reject(error);
					});
					socket.on("timeout", () => {
						socket.destroy();
						reject(/* @__PURE__ */ new Error("timeout"));
					});
				});
				samples.push(performance.now() - startedAt);
			} catch {
				samples.push(-1);
			}
		}
		const successfulSamples = samples.filter((sample) => sample >= 0);
		const averageLatency = successfulSamples.length > 0 ? successfulSamples.reduce((total, sample) => total + sample, 0) / successfulSamples.length : 0;
		const variance = successfulSamples.length > 1 ? successfulSamples.reduce((total, sample) => total + (sample - averageLatency) ** 2, 0) / (successfulSamples.length - 1) : 0;
		const jitterMs = Math.sqrt(variance);
		const lossPercent = Math.round((samples.length - successfulSamples.length) / samples.length * 100);
		const ok = successfulSamples.length >= options.minimumSuccesses;
		return {
			ok,
			successfulProbes: successfulSamples.length,
			latencyMs: Math.round(averageLatency),
			jitterMs: Math.round(jitterMs),
			lossPercent,
			failureReason: ok ? null : "runtime_port_unreachable",
			details: ok ? null : `Runtime port ${session.proxyPort} не подтвердил стабильность: ${successfulSamples.length}/${samples.length} успешных probe.`
		};
	}
	getFallbackRuntimeKind(currentRuntime, node, settings, fallbackTarget) {
		if (settings.useTunMode) return null;
		if (fallbackTarget) return null;
		const transportType = String(node.metadata?.type ?? node.metadata?.net ?? "").trim().toLowerCase();
		if (transportType === "xhttp" || transportType === "splithttp") return null;
		if (currentRuntime === "xray") return "sing-box";
		if (currentRuntime === "sing-box" && !SINGBOX_PROTOCOLS.has(node.protocol)) return "xray";
		return null;
	}
	async prepareFallbackConnection(node, domainRules, processRules, settings, failedRuntime, reason, details, fallbackTarget) {
		const nextRuntime = this.getFallbackRuntimeKind(failedRuntime, node, settings, fallbackTarget);
		if (!nextRuntime) return null;
		this.snapshot.lifecycle = "reconnecting";
		this.snapshot.diagnostic = {
			reason,
			details: `${details} Переключаю ядро на ${nextRuntime}.`,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			fallbackAttempted: true,
			fallbackTarget: nextRuntime
		};
		this.logRuntimeEvent("warn", `Runtime ${failedRuntime} failed, retrying with ${nextRuntime}.`, {
			reason,
			lifecycle: "reconnecting",
			runtimeKind: failedRuntime
		});
		return this.prepareConnection(node, domainRules, processRules, {
			...settings,
			runtimePath: "",
			useTunMode: false
		}, nextRuntime);
	}
	async restorePreviousSession(session, reason, details, fallbackTarget) {
		if (session.process.exitCode !== null || session.process.killed) return false;
		const cleanupIssues = [];
		if (this.lastSettings?.killSwitch) try {
			await this.killSwitch.enable(session.proxyPort, session.activeRuntimePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			cleanupIssues.push(`Kill Switch restore failed: ${message}`);
		}
		else if (this.killSwitch.isActive()) await this.killSwitch.disable().catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			cleanupIssues.push(`Kill Switch disable failed: ${message}`);
		});
		try {
			const proxyResult = await enableSystemProxy(session.proxyPort);
			if (!proxyResult.ok) cleanupIssues.push(`System proxy restore failed: ${proxyResult.error ?? "unknown"}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			cleanupIssues.push(`System proxy restore failed: ${message}`);
		}
		this.applyActiveSession(session);
		const combinedDetails = [details, ...cleanupIssues].join(" ");
		this.snapshot.lifecycle = "degraded";
		this.snapshot.lastError = combinedDetails;
		this.snapshot.diagnostic = {
			reason,
			details: combinedDetails,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			fallbackAttempted: fallbackTarget !== null,
			fallbackTarget
		};
		this.logRuntimeEvent("warn", combinedDetails, {
			activeNodeId: session.nodeId,
			runtimeKind: session.runtimeKind,
			proxyPort: session.proxyPort,
			lifecycle: "degraded",
			reason
		});
		return true;
	}
	beginPendingHandoff(nextSession, previousSession, fallbackTarget) {
		this.clearPendingHandoff();
		this.scheduleSessionRetirement(previousSession, HANDOFF_RETIRE_GRACE_MS);
		const verifyTimer = setTimeout(() => {
			this.verifyPendingHandoff(nextSession.processGeneration);
		}, HANDOFF_VERIFY_DELAY_MS);
		this.pendingHandoff = {
			nextSessionGeneration: nextSession.processGeneration,
			previousSession,
			fallbackTarget,
			verifyTimer
		};
	}
	async rollbackPendingHandoff(failedGeneration, reason, details) {
		const pendingHandoff = this.clearPendingHandoff(failedGeneration);
		if (!pendingHandoff) return false;
		const preservedSession = this.cancelSessionRetirement(pendingHandoff.previousSession.processGeneration) ?? pendingHandoff.previousSession;
		const activeSession = this.getActiveSession();
		if (activeSession && activeSession.processGeneration === failedGeneration) await this.terminateSession(activeSession, {
			disableSystemProxy: false,
			clearKillSwitch: false
		});
		return this.restorePreviousSession(preservedSession, reason, details, pendingHandoff.fallbackTarget);
	}
	async verifyPendingHandoff(nextSessionGeneration) {
		const pendingHandoff = this.pendingHandoff;
		if (!pendingHandoff || pendingHandoff.nextSessionGeneration !== nextSessionGeneration) return;
		const activeSession = this.getActiveSession();
		if (!activeSession || activeSession.processGeneration !== nextSessionGeneration) {
			this.clearPendingHandoff(nextSessionGeneration);
			return;
		}
		const probeResult = await this.probeRuntimePort(activeSession, {
			probes: HANDOFF_VERIFY_PROBES,
			timeoutMs: HANDOFF_VERIFY_TIMEOUT_MS,
			minimumSuccesses: HANDOFF_VERIFY_MIN_SUCCESS
		});
		if (probeResult.ok && this.snapshot.lifecycle !== "failed") {
			this.clearPendingHandoff(nextSessionGeneration);
			this.logRuntimeEvent("info", "Make-before-break handoff verified.", {
				activeNodeId: activeSession.nodeId,
				runtimeKind: activeSession.runtimeKind,
				proxyPort: activeSession.proxyPort,
				lifecycle: this.snapshot.lifecycle,
				reason: null
			});
			return;
		}
		const details = probeResult.details ?? `Новая сессия ${activeSession.nodeId} не прошла handoff verification. Возвращаем предыдущее соединение.`;
		await this.rollbackPendingHandoff(nextSessionGeneration, probeResult.failureReason ?? "runtime_port_unreachable", details);
	}
	async flushRetiringSessions() {
		this.clearPendingHandoff();
		const retirements = Array.from(this.retiringSessions.values());
		this.retiringSessions.clear();
		await Promise.all(retirements.map(async ({ session, timer }) => {
			clearTimeout(timer);
			await this.terminateSession(session, {
				disableSystemProxy: false,
				clearKillSwitch: false
			});
		}));
	}
	scheduleSessionRetirement(session, graceMs) {
		const existingRetirement = this.retiringSessions.get(session.processGeneration);
		if (existingRetirement) clearTimeout(existingRetirement.timer);
		const timer = setTimeout(() => {
			this.retiringSessions.delete(session.processGeneration);
			this.terminateSession(session, {
				disableSystemProxy: false,
				clearKillSwitch: false
			});
		}, graceMs);
		this.retiringSessions.set(session.processGeneration, {
			session,
			timer
		});
	}
	async terminateSession(session, options) {
		const activeProcess = session.process;
		const activeGeneration = session.processGeneration;
		const activePid = activeProcess.pid;
		const wasMockRuntime = this.mockMode && session.activeRuntimePath === "mock";
		this.expectedExits.add(activeGeneration);
		const exitPromise = new Promise((resolve) => {
			if (activeProcess.exitCode !== null) {
				resolve();
				return;
			}
			let waitTimer = null;
			const onExit = () => {
				if (waitTimer) {
					clearTimeout(waitTimer);
					waitTimer = null;
				}
				resolve();
			};
			activeProcess.once("exit", onExit);
			waitTimer = setTimeout(() => {
				waitTimer = null;
				activeProcess.removeListener("exit", onExit);
				resolve();
			}, wasMockRuntime ? 300 : 3e3);
			waitTimer.unref?.();
		});
		activeProcess.kill();
		await exitPromise;
		if (!wasMockRuntime && activePid && activeProcess.exitCode === null) {
			try {
				spawnSync(resolveWindowsExecutable("taskkill"), [
					"/F",
					"/PID",
					String(activePid)
				], {
					windowsHide: true,
					timeout: 2e3
				});
			} catch {}
			await delay(300);
		}
		const cleanupTasks = [];
		if (session.configPath) cleanupTasks.push(promises.rm(session.configPath, { force: true }).catch(() => {}));
		if (options.disableSystemProxy && !this.mockMode) cleanupTasks.push(disableSystemProxy().then((result) => {
			if (result.conflict) logger.warn("[vpn] System proxy was changed outside the app; user configuration left untouched.");
			else if (!result.ok) logger.error("[vpn] System proxy restore incomplete:", result.error);
		}));
		if (options.clearKillSwitch && this.killSwitch.isActive()) cleanupTasks.push(this.killSwitch.disable().catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn("Kill Switch disable failed:", msg);
		}));
		await Promise.all(cleanupTasks);
		this.pruneExpectedExits();
	}
	/**
	* Не даёт expectedExits расти бесконечно. Если процесс успел умереть до
	* подписки на exit, событие уже не придёт и запись останется навсегда;
	* генерации монотонны, поэтому достаточно окна из последних сессий.
	*/
	pruneExpectedExits() {
		if (this.expectedExits.size <= EXPECTED_EXITS_RETENTION) return;
		const threshold = this.generationCounter - EXPECTED_EXITS_RETENTION;
		for (const generation of this.expectedExits) if (generation <= threshold) this.expectedExits.delete(generation);
	}
	/**
	* Возвращает системный сетевой стек пользователю, когда активной сессии не
	* осталось. Без этого после аварийного выхода рантайма системный прокси
	* продолжает указывать на мёртвый 127.0.0.1:порт — интернет пропадает
	* полностью, а приложение об этом молчит.
	*/
	async releaseNetworkOwnershipAfterLoss() {
		try {
			await disableSystemProxy();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logRuntimeEvent("warn", `System proxy restore after runtime loss failed: ${message}`);
		}
		if (this.killSwitch.isActive()) await this.killSwitch.disable().catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			this.logRuntimeEvent("warn", `Kill Switch disable after runtime loss failed: ${message}`);
		});
	}
	/**
	* Подписывает сессию на аварийное завершение процесса. Обработка ставится в
	* общую очередь операций: без этого крах рантайма мог параллельно с
	* пользовательским disconnect откатить handoff и снова включить системный
	* прокси уже после того, как disconnect его выключил.
	*/
	attachSessionExitWatchers(child, processGeneration, classify) {
		child.on("exit", (code, signal) => {
			if (this.expectedExits.delete(processGeneration)) return;
			if (this.snapshot.processGeneration !== processGeneration) return;
			const { reason, startupPhase, details } = classify();
			const lastError = details ? `Runtime exited unexpectedly (code ${code ?? signal}): ${details}` : `Runtime exited unexpectedly (code ${code ?? signal})`;
			this.enqueueOperation(() => this.handleUnexpectedSessionExit(processGeneration, reason, lastError, startupPhase)).catch(() => {});
		});
	}
	async handleUnexpectedSessionExit(processGeneration, reason, lastError, startupPhase) {
		if (this.snapshot.processGeneration !== processGeneration) {
			this.recordPendingHealthFailure(reason, lastError, processGeneration);
			return;
		}
		const pendingHealthMatched = this.pendingHealthVerification?.processGeneration === processGeneration;
		this.recordPendingHealthFailure(reason, lastError, processGeneration);
		if (await this.rollbackPendingHandoff(processGeneration, reason, lastError)) return;
		const activeSession = this.getActiveSession();
		if (activeSession && !pendingHealthMatched) this.recordNodeHealthFailure(activeSession.nodeId, this.snapshot.protocolPlan?.protocol ?? null, activeSession.runtimeKind, reason, lastError);
		this.clearActiveSession(lastError);
		this.snapshot.diagnostic = {
			reason,
			details: lastError,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			fallbackAttempted: false,
			fallbackTarget: null
		};
		this.currentAttempt = null;
		this.logRuntimeEvent("error", lastError, {
			reason,
			lifecycle: "failed"
		});
		await this.releaseNetworkOwnershipAfterLoss();
		if (!startupPhase) this.emit("unexpected-exit", lastError);
	}
	async activatePreparedConnection(prepared, previousSession) {
		const { effectiveSettings, resolvedRuntime, session } = prepared;
		const preparedProbe = prepared.readinessProbe.ok && Date.now() - prepared.readinessProbeAt <= READINESS_PROBE_REUSE_WINDOW_MS && session.process.exitCode === null && !session.process.killed ? prepared.readinessProbe : await this.probeRuntimePort(session, {
			probes: PREPARED_SESSION_PROBES,
			timeoutMs: PREPARED_SESSION_TIMEOUT_MS,
			minimumSuccesses: PREPARED_SESSION_MIN_SUCCESS
		});
		if (!preparedProbe.ok) {
			await this.terminateSession(session, {
				disableSystemProxy: false,
				clearKillSwitch: false
			});
			const preparedFailureReason = preparedProbe.failureReason ?? "runtime_port_unreachable";
			const preparedFailureDetails = preparedProbe.details ?? `Runtime порт ${session.proxyPort} не готов для переключения. Сохраняем текущее соединение.`;
			if (previousSession) {
				if (await this.restorePreviousSession(previousSession, preparedFailureReason, preparedFailureDetails, prepared.fallbackTarget)) return this.status();
			}
			this.setFailure(preparedFailureReason, preparedFailureDetails, {
				fallbackAttempted: prepared.fallbackTarget !== null,
				fallbackTarget: prepared.fallbackTarget
			});
			return this.status();
		}
		let degradedReason = null;
		let degradedDetails = null;
		let proxyFailure = null;
		if (effectiveSettings.killSwitch) try {
			await this.killSwitch.enable(session.proxyPort, resolvedRuntime.runtimePath);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn("Kill Switch enable failed:", msg);
			degradedReason = "kill_switch_failed";
			degradedDetails = `Kill Switch enable failed: ${msg}`;
		}
		else if (this.killSwitch.isActive()) await this.killSwitch.disable().catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn("Kill Switch disable failed:", msg);
		});
		try {
			const proxyResult = await enableSystemProxy(session.proxyPort);
			if (!proxyResult.ok) {
				proxyFailure = `System proxy enable failed: ${proxyResult.error ?? "verification mismatch"}`;
				degradedReason = degradedReason ?? "system_proxy_failed";
				degradedDetails = degradedDetails ?? proxyFailure;
			} else if (proxyResult.adoptedExternalChange) logger.warn("[vpn] Proxy configuration had been changed outside the app; it is now the restore point.");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			proxyFailure = `System proxy enable failed: ${msg}`;
			degradedReason = degradedReason ?? "system_proxy_failed";
			degradedDetails = degradedDetails ?? proxyFailure;
		}
		if (proxyFailure) {
			// A new runtime is not usable until its system-proxy endpoint has been
			// verified.  Retiring the previous session here would strand the user
			// with a dead proxy when a registry write/readback failed.  Tear down the
			// prepared process first, then restore the old session (and its kill
			// switch) while it is still alive.
			const failureDetails = degradedDetails ?? "System proxy could not be enabled for the prepared runtime.";
			await this.terminateSession(session, {
				disableSystemProxy: !previousSession,
				clearKillSwitch: !previousSession
			});
			if (previousSession && await this.restorePreviousSession(previousSession, "system_proxy_failed", failureDetails, prepared.fallbackTarget)) return this.status();
			if (previousSession) {
				await this.releaseNetworkOwnershipAfterLoss();
				this.clearActiveSession(failureDetails);
			}
			this.setFailure("system_proxy_failed", failureDetails, {
				fallbackAttempted: prepared.fallbackTarget !== null,
				fallbackTarget: prepared.fallbackTarget
			});
			return this.status();
		}
		this.applyActiveSession(session, prepared.fallbackTarget);
		this.pendingHealthVerification = {
			processGeneration: session.processGeneration,
			nodeId: session.nodeId,
			protocol: prepared.protocolPlan.protocol,
			runtimeKind: session.runtimeKind,
			probe: preparedProbe,
			protocolPlan: prepared.protocolPlan
		};
		this.currentAttempt = null;
		this.lastSettings = effectiveSettings;
		if (previousSession) this.beginPendingHandoff(session, previousSession, prepared.fallbackTarget);
		if (degradedReason && degradedDetails) {
			this.snapshot.lifecycle = "degraded";
			this.snapshot.lastError = degradedDetails;
			this.snapshot.diagnostic = {
				reason: degradedReason,
				details: degradedDetails,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				fallbackAttempted: prepared.fallbackTarget !== null,
				fallbackTarget: prepared.fallbackTarget
			};
			this.logRuntimeEvent("warn", degradedDetails, {
				reason: degradedReason,
				lifecycle: "degraded"
			});
		}
		return this.status();
	}
	async installXrayRuntime() {
		return this.installer.installXray();
	}
	async installSingBoxRuntime() {
		return this.installer.installSingBox();
	}
	async installAllRuntimes() {
		return this.installer.installAll();
	}
	async checkRuntimeUpdates() {
		return this.installer.checkUpdates();
	}
	connect(node, domainRules, processRules, settings) {
		return this.enqueueOperation(() => this._connect(node, domainRules, processRules, settings));
	}
	async _connect(node, domainRules, processRules, settings) {
		this.clearPendingHandoff();
		this.setLifecycle(this.getActiveSession() ? "reconnecting" : "probing");
		this.clearDiagnostic();
		const previousSession = this.getActiveSession();
		const requiresSerialTunReplacement = previousSession !== null && this.lastSettings?.useTunMode === true;
		if (requiresSerialTunReplacement) {
			await this.flushRetiringSessions();
			await this.terminateSession(previousSession, {
				disableSystemProxy: false,
				clearKillSwitch: false
			});
			this.clearActiveSession();
		}
		let prepared = await this.prepareConnection(node, domainRules, processRules, settings);
		if (requiresSerialTunReplacement && prepared?.retryableTunRouteInitializationFailure) {
			this.logRuntimeEvent("warn", "Xray TUN route initialization failed after serial replacement; retrying once after cleanup.", {
				reason: "runtime_start_failed",
				lifecycle: "reconnecting",
				runtimeKind: "xray"
			});
			await delay(XRAY_TUN_ROUTE_RETRY_BACKOFF_MS);
			prepared = await this.prepareConnection(node, domainRules, processRules, settings);
		}
		if (!prepared || prepared.retryableTunRouteInitializationFailure) {
			this.currentAttempt = null;
			if (requiresSerialTunReplacement) await this.releaseNetworkOwnershipAfterLoss();
			if (prepared?.retryableTunRouteInitializationFailure) this.setFailure("runtime_start_failed", prepared.details);
			return this.status();
		}
		return this.activatePreparedConnection(prepared, requiresSerialTunReplacement ? null : previousSession);
	}
	async prepareConnection(node, domainRules, processRules, settings, fallbackTarget = null) {
		const effectiveSettings = { ...settings };
		const protocolPlan = buildProtocolRuntimePlan({
			protocol: String(node.protocol ?? ""),
			transportType: String(node.metadata?.type ?? node.metadata?.net ?? ""),
			useTunMode: effectiveSettings.useTunMode,
			processRuleCount: processRules.length,
			learnedRuntimePreference: this.nodeRuntimePreferences.get(node.id) ?? null
		});
		const activeProtocolPlan = fallbackTarget && protocolPlan.fallbackRuntime === fallbackTarget ? {
			...protocolPlan,
			preferredRuntime: fallbackTarget,
			reason: "fallback-forced",
			visibleWarnings: [...protocolPlan.visibleWarnings, `Fallback runtime forced to ${fallbackTarget}.`]
		} : protocolPlan;
		const preferredRuntime = activeProtocolPlan.preferredRuntime;
		const sanitizedProcessRules = effectiveSettings.useTunMode ? processRules : [];
		this.snapshot.protocolPlan = activeProtocolPlan;
		this.snapshot.processRulesReason = activeProtocolPlan.processRulesReason;
		this.currentAttempt = {
			nodeId: node.id,
			protocol: typeof node.protocol === "string" ? node.protocol : null,
			runtimeKind: preferredRuntime,
			protocolPlan: activeProtocolPlan
		};
		this.setLifecycle("probing");
		if (effectiveSettings.useTunMode && !this.mockMode && !await this.isAdmin()) {
			this.setFailure("runtime_start_failed", "TUN-режим требует запуска EgoistShield от имени администратора.");
			return null;
		}
		if (this.mockMode) {
			const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 100000);"], {
				windowsHide: true,
				stdio: "ignore"
			});
			const mockGeneration = ++this.generationCounter;
			const session = {
				process: child,
				processGeneration: mockGeneration,
				startedAt: (/* @__PURE__ */ new Date()).toISOString(),
				proxyPort: 10809,
				socksPort: null,
				apiPort: null,
				configPath: null,
				nodeId: node.id,
				activeRuntimePath: "mock",
				runtimeKind: preferredRuntime,
				processRulesApplied: effectiveSettings.useTunMode && sanitizedProcessRules.length > 0
			};
			this.attachSessionExitWatchers(child, mockGeneration, () => ({
				reason: "runtime_crashed",
				startupPhase: false
			}));
			this.snapshot.lastError = null;
			this.clearDiagnostic();
			return {
				effectiveSettings,
				resolvedRuntime: {
					runtimeKind: preferredRuntime,
					runtimePath: "mock"
				},
				session,
				fallbackTarget,
				protocolPlan: activeProtocolPlan,
				readinessProbe: await this.probeRuntimePort(session, {
					probes: PREPARED_SESSION_PROBES,
					timeoutMs: PREPARED_SESSION_TIMEOUT_MS,
					minimumSuccesses: PREPARED_SESSION_MIN_SUCCESS
				}),
				readinessProbeAt: Date.now()
			};
		}
		const allowRuntimeFallback = activeProtocolPlan.fallbackRuntime !== null;
		let resolvedRuntime = await this.resolveRuntimePath(settings.runtimePath, preferredRuntime, allowRuntimeFallback);
		if (!resolvedRuntime) {
			const installed = await (preferredRuntime === "xray" ? this.installer.installXray() : this.installer.installSingBox());
			if (!installed.ok) {
				this.setFailure("runtime_install_failed", `Runtime ${preferredRuntime} install failed: ${installed.message}`);
				return null;
			}
			resolvedRuntime = await this.resolveRuntimePath("", preferredRuntime, allowRuntimeFallback);
		}
		if (!resolvedRuntime) {
			this.setFailure("runtime_not_found", `Runtime ${preferredRuntime} not found after install attempt.`);
			return null;
		}
		if (effectiveSettings.useTunMode && resolvedRuntime.runtimeKind === "xray") {
			const tunRuntime = await this.resolveXrayTunRuntime(settings.runtimePath, resolvedRuntime);
			if (!tunRuntime.ok) {
				this.setFailure("runtime_tun_unavailable", tunRuntime.message);
				return null;
			}
			resolvedRuntime = tunRuntime.runtime;
		}
		this.currentAttempt = {
			nodeId: node.id,
			protocol: typeof node.protocol === "string" ? node.protocol : null,
			runtimeKind: resolvedRuntime.runtimeKind,
			protocolPlan: activeProtocolPlan
		};
		const proxyPort = await findAvailablePort(10809);
		const socksPort = resolvedRuntime.runtimeKind === "xray" ? await findAvailablePort(10808, /* @__PURE__ */ new Set([proxyPort])) : proxyPort;
		const apiPort = resolvedRuntime.runtimeKind === "xray" ? await findAvailablePort(10085, /* @__PURE__ */ new Set([proxyPort, socksPort])) : 0;
		const tempDir = path.join(os.tmpdir(), "EgoistShield", "runtime");
		await promises.mkdir(tempDir, { recursive: true });
		const configPath = path.join(tempDir, `config_${randomUUID()}.json`);
		try {
			this.setLifecycle("connecting");
			const configContent = resolvedRuntime.runtimeKind === "xray" ? ConfigBuilder.buildXray(node, domainRules, effectiveSettings, proxyPort, socksPort, apiPort, sanitizedProcessRules) : ConfigBuilder.buildSingBox(node, domainRules, sanitizedProcessRules, effectiveSettings, proxyPort);
			await promises.writeFile(configPath, configContent, "utf8");
			if (process.env.NODE_ENV === "development" || !!process.env.VITE_DEV_SERVER_URL) {
				const debugDir = path.join(this.userDataDir, "debug");
				await promises.mkdir(debugDir, { recursive: true }).catch(() => {});
				const debugPrefix = `${resolvedRuntime.runtimeKind}_${node.protocol}`;
				await promises.writeFile(path.join(debugDir, `${debugPrefix}_config.json`), configContent, "utf8").catch(() => {});
				await promises.writeFile(path.join(debugDir, `${debugPrefix}_node.json`), JSON.stringify({
					id: node.id,
					name: node.name,
					protocol: node.protocol,
					server: node.server,
					port: node.port,
					runtimeKind: resolvedRuntime.runtimeKind,
					routeMode: effectiveSettings.routeMode,
					dnsMode: effectiveSettings.dnsMode,
					useTunMode: effectiveSettings.useTunMode,
					proxyPort,
					socksPort
				}, null, 2), "utf8").catch(() => {});
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.setFailure("config_write_failed", `Failed to write config: ${msg}`);
			return null;
		}
		const runtimeArgs = [
			"run",
			"-c",
			configPath
		];
		let runtimeOutput = "";
		const appendRuntimeOutput = (chunk) => {
			runtimeOutput = `${runtimeOutput}${chunk.toString("utf8")}`.slice(-4e3);
		};
		const child = spawn(resolvedRuntime.runtimePath, runtimeArgs, {
			windowsHide: true,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			detached: false,
			cwd: path.dirname(resolvedRuntime.runtimePath)
		});
		const processGeneration = ++this.generationCounter;
		const session = {
			process: child,
			processGeneration,
			startedAt: (/* @__PURE__ */ new Date()).toISOString(),
			proxyPort,
			socksPort,
			apiPort: resolvedRuntime.runtimeKind === "xray" ? apiPort : null,
			configPath,
			nodeId: node.id,
			activeRuntimePath: resolvedRuntime.runtimePath,
			runtimeKind: resolvedRuntime.runtimeKind,
			processRulesApplied: effectiveSettings.useTunMode && sanitizedProcessRules.length > 0
		};
		child.stdout?.on("data", appendRuntimeOutput);
		child.stderr?.on("data", appendRuntimeOutput);
		if (process.env.NODE_ENV === "development" || !!process.env.VITE_DEV_SERVER_URL) {
			const debugLogPath = path.join(this.userDataDir, "debug", `${resolvedRuntime.runtimeKind}_runtime.log`);
			const writeDebugLog = (chunk) => {
				promises.appendFile(debugLogPath, chunk.toString("utf8")).catch(() => {});
			};
			child.stdout?.on("data", writeDebugLog);
			child.stderr?.on("data", writeDebugLog);
		}
		let startupPhase = true;
		child.on("error", (error) => {
			if (this.snapshot.processGeneration === processGeneration) {
				const details = this.formatRuntimeOutput(runtimeOutput);
				const reason = this.classifyFailureReason(`${error.message} ${details}`, "start", node, resolvedRuntime.runtimeKind);
				this.setFailure(reason, details ? `Runtime start error: ${error.message}. ${details}` : `Runtime start error: ${error.message}`);
			}
		});
		this.attachSessionExitWatchers(child, processGeneration, () => {
			const details = this.formatRuntimeOutput(runtimeOutput);
			return {
				reason: this.classifyFailureReason(details, startupPhase ? "warmup" : "active", node, resolvedRuntime.runtimeKind),
				startupPhase,
				details
			};
		});
		this.setLifecycle("warmup");
		const initialPortWaitTimeoutMs = 6e4;
		const ready = await waitForPort(proxyPort, initialPortWaitTimeoutMs, () => child.exitCode !== null);
		if (!ready && child.exitCode !== null) {
			const runtimeLog = this.formatRuntimeOutput(runtimeOutput);
			const classifiedReason = this.classifyFailureReason(runtimeLog, "warmup", node, resolvedRuntime.runtimeKind);
			await this.terminateSession(session, {
				disableSystemProxy: false,
				clearKillSwitch: false
			});
			if (process.platform === "win32" && effectiveSettings.useTunMode && resolvedRuntime.runtimeKind === "xray" && XRAY_TUN_ROUTE_INITIALIZATION_FAILURE.test(runtimeLog)) return {
				retryableTunRouteInitializationFailure: true,
				details: runtimeLog || "Xray TUN route initialization failed."
			};
			const fallback = await this.prepareFallbackConnection(node, domainRules, processRules, settings, resolvedRuntime.runtimeKind, classifiedReason, runtimeLog || `Runtime ${resolvedRuntime.runtimeKind} завершился во время запуска.`, fallbackTarget);
			if (fallback) return fallback;
			if (SINGBOX_PROTOCOLS.has(node.protocol)) this.setFailure(classifiedReason, `Протокол ${node.protocol} требует sing-box, но runtime крашнулся при старте.${runtimeLog ? ` Лог: ${runtimeLog}` : ""}`);
			else this.setFailure(classifiedReason, runtimeLog ? `Runtime exited immediately after start. ${runtimeLog}` : "Runtime exited immediately after start.");
			return null;
		}
		if (!ready && child.exitCode === null) {
			if (!await waitForPort(proxyPort, 2e3)) {
				await this.terminateSession(session, {
					disableSystemProxy: false,
					clearKillSwitch: false
				});
				const runtimeLog = this.formatRuntimeOutput(runtimeOutput);
				const portTimeoutDetails = `Runtime запустился, но порт ${proxyPort} не доступен. Проверьте настройки сети.${runtimeLog ? ` Лог: ${runtimeLog}` : ""}`;
				const fallback = await this.prepareFallbackConnection(node, domainRules, processRules, settings, resolvedRuntime.runtimeKind, "runtime_port_unreachable", portTimeoutDetails, fallbackTarget);
				if (fallback) return fallback;
				this.setFailure("runtime_port_unreachable", portTimeoutDetails);
				return null;
			}
		}
		await delay(PREPARED_SESSION_SETTLE_MS);
		const warmProbe = await this.probeRuntimePort(session, {
			probes: PREPARED_SESSION_PROBES,
			timeoutMs: PREPARED_SESSION_TIMEOUT_MS,
			minimumSuccesses: PREPARED_SESSION_MIN_SUCCESS
		});
		if (!warmProbe.ok) {
			const runtimeLog = this.formatRuntimeOutput(runtimeOutput);
			const reason = warmProbe.failureReason ?? this.classifyFailureReason(runtimeLog, "warmup", node, resolvedRuntime.runtimeKind);
			const details = runtimeLog ? `${warmProbe.details ?? "VPN-ядро не прошло проверку готовности."} Лог: ${runtimeLog}` : warmProbe.details ?? "VPN-ядро не прошло проверку готовности.";
			await this.terminateSession(session, {
				disableSystemProxy: false,
				clearKillSwitch: false
			});
			const fallback = await this.prepareFallbackConnection(node, domainRules, processRules, settings, resolvedRuntime.runtimeKind, reason, details, fallbackTarget);
			if (fallback) return fallback;
			this.setFailure(reason, details);
			return null;
		}
		startupPhase = false;
		this.snapshot.lastError = null;
		this.clearDiagnostic();
		return {
			effectiveSettings,
			resolvedRuntime,
			session,
			fallbackTarget,
			protocolPlan: activeProtocolPlan,
			readinessProbe: warmProbe,
			readinessProbeAt: Date.now()
		};
	}
	disconnect() {
		return this.enqueueOperation(() => this._disconnect());
	}
	markEgressVerified(ip) {
		return this.enqueueOperation(() => this._markEgressVerified(ip));
	}
	/**
	* Снимает подтверждение внешнего маршрута, не разрывая сессию. Нужен для
	* периодической перепроверки: туннель может «умереть» на стороне сервера,
	* при этом процесс рантайма продолжает работать и локальный порт слушает —
	* тогда статус «защищено» становится ложью до самого disconnect.
	*/
	markEgressUnverified(details) {
		return this.enqueueOperation(() => this._markEgressUnverified(details));
	}
	async _markEgressUnverified(details) {
		const activeSession = this.getActiveSession();
		if (!activeSession || !this.snapshot.egressVerified) return this.status();
		this.egressDegraded = true;
		this.snapshot.egressVerified = false;
		this.snapshot.egressIp = null;
		this.snapshot.egressCheckedAt = (/* @__PURE__ */ new Date()).toISOString();
		this.snapshot.lifecycle = "degraded";
		this.snapshot.lastError = details;
		this.snapshot.diagnostic = {
			reason: "server_unreachable",
			details,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			fallbackAttempted: false,
			fallbackTarget: null
		};
		this.recordNodeHealthFailure(activeSession.nodeId, this.snapshot.protocolPlan?.protocol ?? null, activeSession.runtimeKind, "server_unreachable", details);
		this.logRuntimeEvent("warn", details, {
			activeNodeId: activeSession.nodeId,
			runtimeKind: activeSession.runtimeKind,
			proxyPort: activeSession.proxyPort,
			lifecycle: "degraded",
			reason: "server_unreachable"
		});
		return this.status();
	}
	async _markEgressVerified(ip) {
		const activeSession = this.getActiveSession();
		if (!activeSession) return this.status();
		const pending = this.pendingHealthVerification;
		if (pending?.processGeneration === activeSession.processGeneration) {
			this.recordNodeHealthSuccess(pending.nodeId, pending.protocol, pending.runtimeKind, pending.probe, pending.protocolPlan);
			this.pendingHealthVerification = null;
		}
		this.snapshot.egressVerified = true;
		this.snapshot.egressIp = ip;
		this.snapshot.egressCheckedAt = (/* @__PURE__ */ new Date()).toISOString();
		if (this.snapshot.lifecycle === "probing") this.snapshot.lifecycle = "active";
		if (this.egressDegraded) {
			this.egressDegraded = false;
			this.snapshot.lifecycle = "active";
			this.snapshot.lastError = null;
			this.clearDiagnostic({
				fallbackAttempted: this.snapshot.diagnostic.fallbackAttempted,
				fallbackTarget: this.snapshot.diagnostic.fallbackTarget
			});
		}
		return this.status();
	}
	rejectActiveConnection(reason, details) {
		return this.enqueueOperation(() => this._rejectActiveConnection(reason, details));
	}
	async _rejectActiveConnection(reason, details) {
		const activeSession = this.getActiveSession();
		if (activeSession) {
			this.recordPendingHealthFailure(reason, details, activeSession.processGeneration);
			if (await this.rollbackPendingHandoff(activeSession.processGeneration, reason, details)) return this.status();
		}
		await this._disconnect();
		this.setFailure(reason, details);
		return this.status();
	}
	async _disconnect() {
		this.clearPendingHandoff();
		this.setLifecycle("idle");
		const activeSession = this.getActiveSession();
		this.clearActiveSession();
		await this.flushRetiringSessions();
		if (activeSession) await this.terminateSession(activeSession, {
			disableSystemProxy: !this.mockMode,
			clearKillSwitch: true
		});
		else if (!this.mockMode) {
			await disableSystemProxy();
			if (this.killSwitch.isActive()) await this.killSwitch.disable().catch((err) => {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn("Kill Switch disable failed:", msg);
			});
		}
		await delay(200);
		this.logRuntimeEvent("info", "Runtime session disconnected.", {
			activeNodeId: activeSession?.nodeId ?? null,
			runtimeKind: activeSession?.runtimeKind ?? null,
			proxyPort: activeSession?.proxyPort ?? null,
			lifecycle: "idle",
			reason: null
		});
		return this.status();
	}
	async diagnose() {
		const baseline = await this.status();
		if (!baseline.connected || !this.snapshot.proxyPort) return {
			ok: false,
			latencyMs: 0,
			jitterMs: 0,
			lossPercent: 100,
			runtimeReachable: false,
			message: "Нет активного подключения.",
			lifecycle: baseline.lifecycle,
			failureReason: baseline.diagnostic.reason
		};
		const port = this.snapshot.proxyPort;
		const PROBES = 5;
		const TIMEOUT = 2e3;
		const samples = [];
		for (let i = 0; i < PROBES; i++) {
			const start = performance.now();
			try {
				await new Promise((resolve, reject) => {
					const sock = createConnection({
						host: "127.0.0.1",
						port,
						timeout: TIMEOUT
					}, () => {
						sock.destroy();
						resolve();
					});
					sock.on("error", (err) => {
						sock.destroy();
						reject(err);
					});
					sock.on("timeout", () => {
						sock.destroy();
						reject(/* @__PURE__ */ new Error("timeout"));
					});
				});
				samples.push(performance.now() - start);
			} catch {
				samples.push(-1);
			}
		}
		const successful = samples.filter((s) => s >= 0);
		const lost = samples.length - successful.length;
		const avg = successful.length > 0 ? successful.reduce((a, b) => a + b, 0) / successful.length : 0;
		const variance = successful.length > 1 ? successful.reduce((sum, s) => sum + (s - avg) ** 2, 0) / (successful.length - 1) : 0;
		const jitter = Math.sqrt(variance);
		return {
			ok: successful.length >= 3,
			latencyMs: Math.round(avg),
			jitterMs: Math.round(jitter),
			lossPercent: Math.round(lost / samples.length * 100),
			runtimeReachable: successful.length > 0,
			message: successful.length >= 3 ? "Подключение стабильно." : successful.length > 0 ? "Обнаружены потери пакетов. Подключение нестабильно." : "Runtime недоступен. Проверьте настройки.",
			lifecycle: baseline.lifecycle,
			failureReason: baseline.diagnostic.reason
		};
	}
	async stressTest(node, domainRules, processRules, settings, iterations) {
		const result = {
			iterations,
			connectSuccess: 0,
			connectFailed: 0,
			disconnectSuccess: 0,
			disconnectFailed: 0,
			errors: []
		};
		for (let i = 0; i < iterations; i += 1) {
			const status = await this.connect(node, domainRules, processRules, settings);
			if (status.connected) result.connectSuccess += 1;
			else {
				result.connectFailed += 1;
				if (status.lastError) result.errors.push(`Iteration ${i + 1}: ${status.lastError}`);
			}
			if (!(await this.disconnect()).connected) result.disconnectSuccess += 1;
			else {
				result.disconnectFailed += 1;
				result.errors.push(`Iteration ${i + 1}: disconnect incomplete.`);
			}
		}
		return result;
	}
	async mockConnect(node, runtimeKind) {
		const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 100000);"], {
			windowsHide: true,
			stdio: "ignore"
		});
		this.snapshot.process = child;
		this.snapshot.processGeneration = ++this.generationCounter;
		this.snapshot.startedAt = (/* @__PURE__ */ new Date()).toISOString();
		this.snapshot.nodeId = node.id;
		this.snapshot.proxyPort = null;
		this.snapshot.socksPort = null;
		this.snapshot.activeRuntimePath = "mock";
		this.snapshot.runtimeKind = runtimeKind;
		this.snapshot.lastError = null;
		this.snapshot.processRulesApplied = false;
		this.snapshot.lifecycle = "active";
		this.clearDiagnostic();
		return this.status();
	}
	getPreferredRuntimeKind(node) {
		const preferredRuntime = this.nodeRuntimePreferences.get(node.id);
		if (preferredRuntime) return preferredRuntime;
		return "sing-box";
	}
	async resolveXrayTunRuntime(configuredPath, runtime) {
		const configured = this.normalizeBinaryPath(configuredPath);
		const isCustomRuntime = configured && this.sameRuntimePath(configured, runtime.runtimePath);
		if (isCustomRuntime) {
			const wintunPath = path.join(path.dirname(runtime.runtimePath), "wintun.dll");
			try {
				await promises.access(wintunPath);
				return { ok: true, runtime };
			} catch {
				return {
					ok: false,
					message: `Выбранный Xray не готов для TUN: рядом с ${path.basename(runtime.runtimePath)} отсутствует wintun.dll. Используйте Xray ${XRAY_NATIVE_TUN_MIN_VERSION} или новее с wintun.dll.`
				};
			}
		}
		if (await this.isXrayTunRuntimeReady(runtime.runtimePath)) return { ok: true, runtime };
		const bundledDir = await this.installer.findBundledRuntimeDir(XRAY_PLAN);
		const bundledRuntimePath = bundledDir ? path.join(bundledDir, XRAY_PLAN.exeName) : null;
		if (!bundledRuntimePath || !await this.isXrayTunRuntimeReady(bundledRuntimePath)) return {
			ok: false,
			message: `Для TUN требуется встроенный Xray ${XRAY_NATIVE_TUN_MIN_VERSION} или новее с wintun.dll.`
		};
		return {
			ok: true,
			runtime: {
				runtimeKind: "xray",
				runtimePath: bundledRuntimePath
			}
		};
	}
	async isXrayTunRuntimeReady(runtimePath) {
		const runtimeDir = path.dirname(runtimePath);
		const version = await readVersionFile(path.join(runtimeDir, "VERSION.txt"));
		if (version === null || compareLooseVersions(version, XRAY_NATIVE_TUN_MIN_VERSION) < 0) return false;
		try {
			await promises.access(path.join(runtimeDir, "wintun.dll"));
			return true;
		} catch {
			return false;
		}
	}
	sameRuntimePath(left, right) {
		const normalizedLeft = path.resolve(left);
		const normalizedRight = path.resolve(right);
		return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
	}
	async resolveRuntimePath(configuredPath, preferredKind = "xray", allowFallback = true) {
		const normalizedConfiguredPath = this.normalizeBinaryPath(configuredPath);
		if (normalizedConfiguredPath) try {
			await promises.access(normalizedConfiguredPath);
			const detectedKind = this.detectRuntimeKindByFilename(normalizedConfiguredPath);
			if (detectedKind) {
				if (path.extname(normalizedConfiguredPath).toLowerCase() !== ".exe") logger.warn(`[runtime] Ignoring custom runtime path without .exe extension: ${normalizedConfiguredPath}`);
				else if (allowFallback || detectedKind === preferredKind) return {
					runtimePath: normalizedConfiguredPath,
					runtimeKind: detectedKind
				};
			} else logger.warn(`[runtime] Ignoring custom runtime path with unknown binary name: ${normalizedConfiguredPath}`);
		} catch {}
		const exeDir = path.dirname(process.execPath);
		const kinds = allowFallback ? preferredKind === "xray" ? ["xray", "sing-box"] : ["sing-box", "xray"] : [preferredKind];
		for (const kind of kinds) {
			const candidates = DEFAULT_RUNTIME_CANDIDATES[kind];
			for (const candidate of candidates) {
				const resolvedCandidates = [
					path.resolve(this.userDataDir, candidate),
					path.resolve(this.appRoot, candidate),
					path.resolve(exeDir, candidate)
				];
				for (const resolved of resolvedCandidates) try {
					await promises.access(resolved);
					return {
						runtimePath: resolved,
						runtimeKind: kind
					};
				} catch {}
			}
		}
		return null;
	}
	normalizeBinaryPath(p) {
		const value = p.trim();
		if (!value) return null;
		if (path.isAbsolute(value)) return path.normalize(value);
		return path.resolve(this.userDataDir, value);
	}
	detectRuntimeKindByFilename(p) {
		const lower = p.toLowerCase();
		if (lower.includes("xray")) return "xray";
		if (lower.includes("sing-box")) return "sing-box";
		return null;
	}
	formatRuntimeOutput(raw) {
		return raw.trim().replace(/\s+/g, " ").slice(-700);
	}
};
//#endregion
