//#region src/electron/main.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname$1 = path.dirname(__filename);
var globalStateStore = null;
var execFileAsync = promisify(execFile);
var runtimeEnvironment = detectRuntimeEnvironment({
	isPackaged: app.isPackaged,
	nodeEnv: process.env.NODE_ENV
});
var appPathConfig = buildAppPathConfig({
	defaultUserDataDir: path.join(app.getPath("appData"), "Egoist Shield"),
	environment: runtimeEnvironment,
	pid: process.pid
});
if (appPathConfig.userDataDir !== app.getPath("userData")) app.setPath("userData", appPathConfig.userDataDir);
if (appPathConfig.sessionDataDir) app.setPath("sessionData", appPathConfig.sessionDataDir);
configureLoggerPaths(appPathConfig.logsDir);
var USER_DATA_DIR = app.getPath("userData");
var autoUpdateEnabled = true;
var updateCheckInterval = null;
function toPublicUpdateResult(result) {
	return {
		ok: result.ok,
		phase: result.phase,
		currentVersion: result.currentVersion,
		latestVersion: result.latestVersion,
		message: result.message,
		failureCode: result.failureCode,
		retryable: result.retryable,
		releaseHistory: result.releaseHistory
	};
}
var desktopUpdater = new DesktopUpdater({
	currentVersion: app.getVersion(),
	userDataDir: USER_DATA_DIR,
	resourcesPath: process.resourcesPath,
	onProgress: (progress) => {
		mainWindow?.webContents.send("update-progress", progress);
	}
});
function emitUpdateResult(result) {
	if (result.phase === "available" && result.latestVersion) {
		mainWindow?.webContents.send("update-available", {
			version: result.latestVersion,
			phase: result.phase,
			message: result.message
		});
		return;
	}
	if (result.phase === "up-to-date") {
		mainWindow?.webContents.send("update-not-available", result);
		return;
	}
	if (result.phase === "failed" || result.phase === "blocked") mainWindow?.webContents.send("update-error", {
		message: result.message,
		code: result.failureCode,
		retryable: result.retryable
	});
}
var deferredStartupTimers = /* @__PURE__ */ new Set();
function scheduleDeferredStartup(callback, delayMs) {
	const timer = setTimeout(() => {
		deferredStartupTimers.delete(timer);
		callback();
	}, delayMs);
	deferredStartupTimers.add(timer);
}
function cancelDeferredStartupTimers() {
	for (const timer of deferredStartupTimers) clearTimeout(timer);
	deferredStartupTimers.clear();
}
async function runBackgroundUpdateCheck() {
	if (!autoUpdateEnabled) return;
	const result = toPublicUpdateResult(await desktopUpdater.check());
	emitUpdateResult(result);
	if (result.phase === "available" && result.latestVersion && autoUpdateEnabled && !desktopUpdater.installPromise) {
		if (Notification.isSupported() && globalStateStore?.get()?.settings?.notifications !== false) new Notification({
			title: "Egoist Lagom: обновление",
			body: `Доверенная версия ${result.latestVersion} загружается и будет установлена с сохранением сетевых настроек.`,
			silent: true
		}).show();
		const installed = toPublicUpdateResult(await desktopUpdater.checkAndInstall());
		emitUpdateResult(installed);
		if (installed.phase === "restarting") scheduleDeferredStartup(() => {
			isQuitting = true;
			app.quit();
		}, 750);
		else if (!installed.ok) logger.warn(`[updater] Automatic installation failed: ${installed.failureCode ?? "unknown"}`);
		return;
	}
	if (result.phase === "failed" || result.phase === "blocked") logger.warn(`[updater] Background check ${result.phase}: ${result.failureCode ?? "unknown"}`);
	else logger.info(`[updater] Background check: ${result.phase}, latest=${result.latestVersion ?? "none"}`);
}
function setupAutoUpdater() {
	if (!app.isPackaged) {
		logger.info("[updater] Dev-режим: фоновые проверки desktop-релизов отключены");
		return;
	}
	scheduleDeferredStartup(() => {
		runBackgroundUpdateCheck();
	}, 1e4);
	updateCheckInterval = setInterval(() => {
		runBackgroundUpdateCheck();
	}, 86400 * 1e3);
	logger.info(`[updater] Signed stable channel configured, current=${app.getVersion()}`);
}
ipcMain.handle("updater:check", async (event) => {
	assertTrustedIpcEvent(event);
	const result = toPublicUpdateResult(await desktopUpdater.check());
	emitUpdateResult(result);
	return result;
});
ipcMain.handle("updater:check-and-install", async (event) => {
	assertTrustedIpcEvent(event);
	const result = toPublicUpdateResult(await desktopUpdater.checkAndInstall());
	emitUpdateResult(result);
	if (result.phase === "restarting") scheduleDeferredStartup(() => {
		isQuitting = true;
		app.quit();
	}, 750);
	return result;
});
ipcMain.handle("updater:open-release-page", async (event) => {
	assertTrustedIpcEvent(event);
	await shell.openExternal(APP_RELEASE_PAGE_URL);
	return true;
});
ipcMain.handle("updater:last-result", async (event) => {
	assertTrustedIpcEvent(event);
	const programData = process.env.ProgramData || "C:\\ProgramData";
	const resultPath = path.join(programData, "EgoistShield", "Installer", "last-update-result.json");
	try {
		const stat = await fs.promises.lstat(resultPath);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 64 * 1024) return null;
		const parsed = JSON.parse(await fs.promises.readFile(resultPath, "utf8"));
		await fs.promises.rm(resultPath, { force: true });
		if (parsed.schemaVersion !== 1 || typeof parsed.ok !== "boolean" || typeof parsed.message !== "string" || typeof parsed.completedAt !== "string") return null;
		return {
			ok: parsed.ok,
			code: typeof parsed.code === "number" ? parsed.code : -1,
			fromVersion: typeof parsed.fromVersion === "string" ? parsed.fromVersion : null,
			toVersion: typeof parsed.toVersion === "string" ? parsed.toVersion : app.getVersion(),
			message: parsed.message,
			completedAt: parsed.completedAt
		};
	} catch {
		return null;
	}
});
ipcMain.handle("updater:set-auto", async (event, enabled) => {
	assertTrustedIpcEvent(event);
	if (typeof enabled !== "boolean") throw new TypeError("enabled must be boolean");
	autoUpdateEnabled = enabled;
	logger.info(`[updater] autoCheck set to ${enabled}`);
	if (globalStateStore) await globalStateStore.patch({ settings: { autoUpdate: enabled } });
	if (!enabled && updateCheckInterval) {
		clearInterval(updateCheckInterval);
		updateCheckInterval = null;
	} else if (enabled && !updateCheckInterval && app.isPackaged) {
		updateCheckInterval = setInterval(() => {
			runBackgroundUpdateCheck();
		}, 86400 * 1e3);
		runBackgroundUpdateCheck();
		scheduleDeferredStartup(() => checkManagedComponentUpdates(), 2e4);
	}
	return enabled;
});
var componentUpdateInFlight = false;
function reportComponentUpdate(message, phase, percent) {
	mainWindow?.webContents.send("update-progress", { phase, message, percent });
	if (["up-to-date", "failed"].includes(phase) && Notification.isSupported() && globalStateStore?.get()?.settings?.notifications !== false) new Notification({
		title: phase === "failed" ? "Egoist Lagom: обновление не завершено" : "Egoist Lagom: компонент обновлён",
		body: message,
		silent: true
	}).show();
}
async function checkManagedComponentUpdates() {
	if (!autoUpdateEnabled || componentUpdateInFlight || desktopUpdater.installPromise) return;
	componentUpdateInFlight = true;
	const results = [];
	let failures = 0;
	try {
		if (globalZapretManager && (await globalZapretManager.status()).updateChecksEnabled) {
			const info = await globalZapretManager.checkForUpdates();
			if (info.updateAvailable && info.latestVersion && info.releaseVerified === true) {
				const vpnConnected = Boolean((await globalRuntimeManager?.status())?.connected);
				if (vpnConnected) logger.info(`[updates] Flowseal Core ${info.latestVersion} deferred until the VPN disconnects.`);
				else {
					reportComponentUpdate(`Обновляем Flowseal Core до ${info.latestVersion}…`, "installing", 0);
					let lastProgressPercent = -5;
					try {
						const updated = await globalNetworkCombinatorManager.runCoordinatedMutation({
							module: "zapret", action: "install-core-update", requiredLocks: ["packet-interception", "windivert"], conflictsWith: ["traffic-route", "zapret-suspend"]
						}, async () => {
							if ((await globalRuntimeManager?.status())?.connected) throw new Error("VPN подключён; обновление Flowseal отложено.");
							return globalZapretManager.installCoreUpdate(({ percent }) => {
								if (percent >= lastProgressPercent + 5 || percent === 100) {
									lastProgressPercent = percent;
									reportComponentUpdate(`Загружаем проверенный Flowseal Core ${info.latestVersion}…`, "downloading", percent);
								}
							});
						});
						results.push(`Flowseal Core ${updated.coreVersion ?? info.latestVersion}: обновлён и проверен`);
					} catch (error) {
						results.push(`Flowseal Core: не обновлён (${error.message})`);
						failures += 1;
						logger.warn("[updates] Flowseal Core automatic update failed:", error);
					}
				}
			}
		}
		if (globalTelegramProxyManager && await globalTelegramProxyManager.shouldCheckUpdates() && !desktopUpdater.installPromise) {
			const info = await globalTelegramProxyManager.checkForUpdates();
			if (info.updateAvailable && info.controlledInstallAllowed && info.latestVersion) {
				reportComponentUpdate(`Обновляем совместимый Telegram Proxy до ${info.latestVersion}…`, "installing", 0);
				try {
					const updated = await globalNetworkCombinatorManager.runCoordinatedMutation({
						module: "telegram-proxy", action: "install-update", requiredLocks: ["telegram-proxy-port"]
					}, () => globalTelegramProxyManager.installUpdate());
					results.push(`Telegram Proxy ${updated.currentVersion ?? info.latestVersion}: обновлён и проверен`);
				} catch (error) {
					results.push(`Telegram Proxy: не обновлён (${error.message})`);
					failures += 1;
					logger.warn("[updates] Telegram Proxy automatic update failed:", error);
				}
			}
		}
	} catch (error) {
		results.push(`Проверка компонентов: не завершена (${error.message})`);
		failures += 1;
		logger.warn("[updates] Managed component check failed:", error);
	} finally {
		if (results.length > 0) reportComponentUpdate(results.join(" · "), failures > 0 ? "failed" : "up-to-date", failures > 0 ? 0 : 100);
		componentUpdateInFlight = false;
	}
}
function setupManagedComponentUpdateChecks() {
	if (componentUpdateInterval) clearInterval(componentUpdateInterval);
	scheduleDeferredStartup(() => {
		checkManagedComponentUpdates();
	}, 2e4);
	componentUpdateInterval = setInterval(() => {
		checkManagedComponentUpdates();
	}, 360 * 60 * 1e3);
}
var mainWindow = null;
var tray = null;
var globalRuntimeManager = null;
var globalGravitylessDnsManager = null;
var globalSystemDohManager = null;
var globalZapretManager = null;
var globalTelegramProxyManager = null;
var globalNetworkCombinatorManager = null;
var dnsWatchdogTimer = null;
var dnsWatchdogInFlight = false;
var dnsWatchdogConsecutiveFailures = 0;
var DNS_WATCHDOG_INTERVAL_MS = 6e4;
var DNS_WATCHDOG_FAILURE_THRESHOLD = 2;
var trafficInterval = null;
var isQuitting = false;
var shutdownComplete = false;
var shutdownPromise = null;
var componentUpdateInterval = null;
var DEFAULT_WINDOW_WIDTH = 1360;
var DEFAULT_WINDOW_HEIGHT = 900;
var MIN_WINDOW_WIDTH = 1000;
var MIN_WINDOW_HEIGHT = 680;
var WINDOW_STATE_PATH = path.join(USER_DATA_DIR, "window-state.json");
var notifiedComponentVersions = /* @__PURE__ */ new Map();
function getWorkAreas() {
	const primary = screen.getPrimaryDisplay();
	return [primary, ...screen.getAllDisplays().filter((display) => display.id !== primary.id)].map((display) => display.workArea);
}
var WIDGET_WINDOW_WIDTH = 300;
var WIDGET_WINDOW_HEIGHT = 370;
function saveWindowState(window, state) {
	if (window.isDestroyed()) return;
	state.widgetMode = window.shieldWidgetMode === true;
	const normalBounds = window.getNormalBounds();
	if (!window.shieldWidgetMode && normalBounds.width >= MIN_WINDOW_WIDTH && normalBounds.height >= MIN_WINDOW_HEIGHT) {
		state.bounds = {
			x: normalBounds.x,
			y: normalBounds.y,
			width: normalBounds.width,
			height: normalBounds.height
		};
		state.maximized = window.isMaximized();
	} else if (window.shieldWidgetMode) {
		state.bounds = {
			width: WIDGET_WINDOW_WIDTH,
			height: WIDGET_WINDOW_HEIGHT
		};
		state.maximized = false;
	}
	try {
		persistWindowState(WINDOW_STATE_PATH, state);
	} catch (error) {
		logger.warn("[window] Failed to persist window state:", error);
	}
}
function applyShieldWindowMode(window, widgetMode) {
	if (!window || window.isDestroyed()) return;
	const previous = window.getBounds();
	if (widgetMode) {
		if (previous.width >= MIN_WINDOW_WIDTH && previous.height >= MIN_WINDOW_HEIGHT) {
			window.shieldDashboardBounds = { ...previous };
		}
	}
	if (window.isMaximized()) window.unmaximize();
	window.shieldWidgetMode = widgetMode;
	const display = screen.getDisplayMatching(previous) || screen.getPrimaryDisplay();
	const area = display.workArea;
	if (widgetMode) {
		const width = Math.min(area.width, WIDGET_WINDOW_WIDTH);
		const height = Math.min(area.height, WIDGET_WINDOW_HEIGHT);
		window.setMinimumSize(width, height);
		window.setResizable(false);
		const posX = Math.round(area.x + (area.width - width) / 2);
		const posY = Math.round(area.y + (area.height - height) / 2);
		window.setBounds({ x: posX, y: posY, width, height });
		window.setBackgroundColor("#111111");
	} else {
		const saved = window.shieldDashboardBounds;
		const targetWidth = (saved && typeof saved.width === "number" && saved.width >= MIN_WINDOW_WIDTH) ? saved.width : DEFAULT_WINDOW_WIDTH;
		const targetHeight = (saved && typeof saved.height === "number" && saved.height >= MIN_WINDOW_HEIGHT) ? saved.height : DEFAULT_WINDOW_HEIGHT;
		const width = Math.min(area.width, targetWidth);
		const height = Math.min(area.height, targetHeight);
		window.setMinimumSize(Math.min(area.width, MIN_WINDOW_WIDTH), Math.min(area.height, MIN_WINDOW_HEIGHT));
		window.setResizable(true);
		const posX = (saved && typeof saved.x === "number") ? saved.x : Math.round(area.x + (area.width - width) / 2);
		const posY = (saved && typeof saved.y === "number") ? saved.y : Math.round(area.y + (area.height - height) / 2);
		const boundedX = Math.max(area.x, Math.min(posX, area.x + area.width - width));
		const boundedY = Math.max(area.y, Math.min(posY, area.y + area.height - height));
		window.setBounds({ x: boundedX, y: boundedY, width, height });
		window.setBackgroundColor("#050505");
	}
}
global.applyShieldWindowMode = applyShieldWindowMode;
function applyRendererScalePolicy(window) {
	if (window.isDestroyed()) return;
	window.webContents.setZoomFactor(1);
	window.webContents.setVisualZoomLevelLimits(1, 1).catch((error) => {
		logger.warn("[window] Failed to configure visual zoom limits:", error);
	});
}
var SINGBOX_TRAFFIC_URL = "http://127.0.0.1:9090/traffic";
var XRAY_API_PORT = 10085;
async function performGracefulShutdown() {
	const persistedState = globalStateStore?.get();
	const result = await runShutdownSteps([
		...globalRuntimeManager ? [{
			name: "vpn-runtime",
			run: () => globalRuntimeManager.disconnect()
		}] : [],
		...globalZapretManager && persistedState?.settings.zapretSuspendDuringVpn ? [{
			name: "zapret-restore",
			run: () => globalZapretManager.restoreAfterVpnIfNeeded(persistedState.settings.zapretSuspendDuringVpn, persistedState.settings.zapretProfile, { skipIdleStatus: true })
		}] : [],
		...globalTelegramProxyManager ? [{
			name: "telegram-proxy",
			run: () => globalTelegramProxyManager.shutdownApplicationRuntime()
		}] : []
	], 15e3);
	for (const failure of result.failedSteps) logger.warn(`[exit] ${failure.name} cleanup failed:`, failure.error);
	if (result.timedOut) logger.warn(`[exit] Graceful cleanup reached the 15 second deadline while running "${result.unfinishedStep ?? "unknown"}"; completed: ${result.completedSteps.join(", ") || "none"}. Recovery on next start will finish the rest.`);
	else logger.info(`[exit] Graceful cleanup complete: ${result.completedSteps.join(", ") || "no active runtimes"}`);
}
app.on("before-quit", (event) => {
	isQuitting = true;
	if (componentUpdateInterval) {
		clearInterval(componentUpdateInterval);
		componentUpdateInterval = null;
	}
	if (updateCheckInterval) {
		clearInterval(updateCheckInterval);
		updateCheckInterval = null;
	}
	if (trafficInterval) {
		clearInterval(trafficInterval);
		trafficInterval = null;
	}
	if (activeSingboxReq) {
		activeSingboxReq.destroy();
		activeSingboxReq = null;
	}
	stopDnsWatchdog();
	cancelDeferredStartupTimers();
	if (shutdownComplete) {
		if (tray) {
			tray.destroy();
			tray = null;
		}
		return;
	}
	event.preventDefault();
	if (shutdownPromise) return;
	shutdownPromise = performGracefulShutdown().finally(() => {
		shutdownComplete = true;
		if (tray) {
			tray.destroy();
			tray = null;
		}
		setImmediate(() => app.quit());
	});
});
var activeSingboxReq = null;
var activeSingboxSession = null;
var TRAFFIC_POLL_INTERVAL_MS = 5e3;
var TRAFFIC_RUNTIME_STATUS_CACHE_TTL_MS = 3e3;
var TRAFFIC_XRAY_FAILURE_LOG_EVERY = 5;
var trafficSampleInFlight = false;
var trafficRuntimeStatusCache = null;
var trafficXrayStatsFailureCount = 0;
var trafficXrayBaseline = null;
var trafficSampleGeneration = 0;
function resetTrafficSampling() {
	trafficXrayBaseline = null;
	trafficRuntimeStatusCache = null;
	trafficSampleGeneration += 1;
	stopSingboxTraffic();
	if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("traffic-update", {
		rx: 0,
		tx: 0,
		source: "unavailable"
	});
}
function trafficSessionKey(status) {
	return JSON.stringify([status.runtimeKind, status.resolvedRuntimePath, status.apiPort, status.pid, status.startedAt, status.activeNodeId]);
}
function sampleXrayTraffic(status, stats, sampledAt = performance.now()) {
	const session = trafficSessionKey(status);
	const previous = trafficXrayBaseline;
	trafficXrayBaseline = { session, sampledAt, ...stats };
	const elapsedMs = previous ? sampledAt - previous.sampledAt : 0;
	if (!previous || previous.session !== session || elapsedMs <= 0 || elapsedMs > TRAFFIC_POLL_INTERVAL_MS * 3 || stats.downlink < previous.downlink || stats.uplink < previous.uplink) return { rx: 0, tx: 0, source: "baseline" };
	return {
		rx: Number(stats.downlink - previous.downlink) / (elapsedMs / 1e3),
		tx: Number(stats.uplink - previous.uplink) / (elapsedMs / 1e3),
		source: "xray-proxy"
	};
}
function stopSingboxTraffic() {
	const request = activeSingboxReq;
	activeSingboxReq = null;
	activeSingboxSession = null;
	request?.destroy();
}
function startSingboxTraffic(status) {
	const session = trafficSessionKey(status);
	if (activeSingboxReq && activeSingboxSession === session) return;
	resetTrafficSampling();
	const generation = trafficSampleGeneration;
	let pending = "";
	const current = () => generation === trafficSampleGeneration && activeSingboxReq === request;
	const failed = () => {
		if (current()) resetTrafficSampling();
	};
	const request = http.get(SINGBOX_TRAFFIC_URL, (res) => {
		if (!current()) {
			res.destroy();
			return;
		}
		if (res.statusCode !== 200) {
			failed();
			return;
		}
		res.on("data", (chunk) => {
			if (!current()) return;
			if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) {
				failed();
				return;
			}
			pending += chunk.toString("utf8");
			const lines = pending.split("\n");
			pending = lines.pop();
			try {
				if (pending.length > 65536) throw new Error("Oversized sing-box traffic message.");
				for (const line of lines) {
					if (!line.trim()) continue;
					const data = JSON.parse(line);
					if (![data.down, data.up].every((value) => Number.isFinite(value) && value >= 0)) throw new Error("Invalid sing-box traffic counters.");
					mainWindow.webContents.send("traffic-update", { rx: data.down, tx: data.up, source: "sing-box" });
				}
			} catch (error) {
				console.warn("[traffic] sing-box parse error:", error);
				failed();
			}
		});
		res.on("end", failed);
		res.on("aborted", failed);
		res.on("error", failed);
		res.on("close", failed);
	});
	activeSingboxReq = request;
	activeSingboxSession = session;
	request.on("error", failed);
	request.setTimeout(TRAFFIC_POLL_INTERVAL_MS * 3, failed);
}
async function getTrafficRuntimeStatus() {
	if (!globalRuntimeManager) throw new Error("Runtime manager is not initialized.");
	const now = performance.now();
	if (trafficRuntimeStatusCache && trafficRuntimeStatusCache.expiresAt > now) return trafficRuntimeStatusCache.value;
	const value = await globalRuntimeManager.status();
	trafficRuntimeStatusCache = {
		value,
		expiresAt: performance.now() + TRAFFIC_RUNTIME_STATUS_CACHE_TTL_MS
	};
	return value;
}
function startTrafficMonitoring() {
	if (trafficInterval) clearInterval(trafficInterval);
	resetTrafficSampling();
	trafficInterval = setInterval(async () => {
		if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) {
			resetTrafficSampling();
			return;
		}
		if (!globalRuntimeManager) {
			resetTrafficSampling();
			return;
		}
		if (trafficSampleInFlight) return;
		trafficSampleInFlight = true;
		const sampleGeneration = trafficSampleGeneration;
		try {
			const status = await getTrafficRuntimeStatus();
			if (sampleGeneration !== trafficSampleGeneration) return;
			if (!status.connected) {
				resetTrafficSampling();
				return;
			}
			if (status.runtimeKind === "sing-box") {
				startSingboxTraffic(status);
			} else if (status.runtimeKind === "xray") {
				stopSingboxTraffic();
				let gotStats = false;
				if (status.resolvedRuntimePath) try {
					const sessionApiPort = typeof status.apiPort === "number" && status.apiPort > 0 ? status.apiPort : XRAY_API_PORT;
					const statsData = await queryXrayStats(status.resolvedRuntimePath, sessionApiPort);
					if (sampleGeneration !== trafficSampleGeneration) return;
					if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) {
						resetTrafficSampling();
						return;
					}
					gotStats = true;
					trafficXrayStatsFailureCount = 0;
					mainWindow.webContents.send("traffic-update", sampleXrayTraffic({ ...status, apiPort: sessionApiPort }, statsData));
				} catch (e) {
					trafficXrayStatsFailureCount += 1;
					if (trafficXrayStatsFailureCount === 1 || trafficXrayStatsFailureCount % TRAFFIC_XRAY_FAILURE_LOG_EVERY === 0) console.warn("[traffic] xray stats unavailable, fallback is throttled:", e);
				}
				if (!gotStats) resetTrafficSampling();
			} else resetTrafficSampling();
		} catch (e) {
			resetTrafficSampling();
			console.warn("[traffic] monitoring cycle error:", e);
		} finally {
			trafficSampleInFlight = false;
		}
	}, TRAFFIC_POLL_INTERVAL_MS);
}
async function queryXrayStats(xrayPath, apiPort) {
	const { stdout } = await execFileAsync(xrayPath, [
		"api",
		"statsquery",
		`-s=127.0.0.1:${apiPort}`
	], { timeout: 3e3 });
	return parseXrayProxyStats(stdout);
}
function parseXrayProxyStats(stdout) {
	let entries;
	if (stdout.trimStart().startsWith("{")) {
		entries = JSON.parse(stdout).stat ?? [];
	} else {
		entries = [...stdout.matchAll(/name:\s*"([^"]+)"(?:\s+value:\s*(\d+))?/g)].map((match) => ({ name: match[1], value: match[2] ?? "0" }));
	}
	const stats = {};
	for (const entry of entries) {
		const direction = /^outbound>>>proxy>>>traffic>>>(uplink|downlink)$/.exec(entry.name ?? "")?.[1];
		if (!direction) continue;
		const raw = entry.value ?? "0";
		if (typeof raw === "number" && !Number.isSafeInteger(raw) || !/^\d+$/.test(String(raw))) throw new Error("Invalid Xray proxy traffic counter.");
		stats[direction] = BigInt(raw);
	}
	if (stats.uplink === void 0 && stats.downlink === void 0) throw new Error("Xray proxy traffic counters are unavailable.");
	return { uplink: stats.uplink ?? 0n, downlink: stats.downlink ?? 0n };
}
app.commandLine.appendSwitch("high-dpi-support", "1");
var APP_USER_MODEL_ID = "egoist.shield.app.v3.7";
app.setName("Egoist Lagom");
if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);
function getIconPath() {
	const candidates = [
		path.resolve(process.resourcesPath, "resources/brand/icon.ico"),
		path.resolve(process.resourcesPath, "brand/icon.ico"),
		path.resolve(app.getAppPath(), "resources/brand/icon.ico"),
		path.resolve(__dirname$1, "../renderer/main_window/icon.ico"),
		path.resolve(__dirname$1, "../renderer/main_window/assets/icon.ico"),
		path.resolve(app.getAppPath(), "renderer/public/assets/icon.ico")
	];
	for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
	return null;
}
function getTrayAssetPath(filename) {
	const candidates = [
		path.resolve(process.resourcesPath, "resources/brand", filename),
		path.resolve(process.resourcesPath, "brand", filename),
		path.resolve(app.getAppPath(), "resources/brand", filename),
		path.resolve(__dirname$1, "../renderer/main_window/assets", filename),
		path.resolve(__dirname$1, "../renderer/main_window", filename),
		path.resolve(app.getAppPath(), "renderer/public/assets", filename),
		path.resolve(app.getAppPath(), ".vite/renderer/main_window/assets", filename)
	];
	for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
	return null;
}
/**
* Восстановление owned-состояния после аварийного завершения приложения.
* Выполняется до появления UI и до регистрации IPC — в этот момент активной
* VPN-сессии заведомо нет, поэтому решение принимается без гонки.
*
* disableSystemProxy() ownership-aware: без rollback-файла это no-op, а если
* прокси после нас изменил пользователь или другая программа — снимок не
* применяется.
*/
/**
* Жёсткий дедлайн для шага загрузки.
*
* РЕГРЕССИЯ, ИСПРАВЛЕНА В 3.3.1. Реконсиляция выполняется ДО регистрации IPC и
* загрузки интерфейса, а внутри неё живут `netsh`, `sc.exe` и PowerShell. На
* зависшем сетевом стеке любой из них не возвращается никогда, и приложение
* навсегда останавливалось до появления обработчиков: окно открыто, но не
* отвечает ни одна кнопка. Просроченный шаг теперь пропускается, а его работу
* доделывает восстановление после загрузки renderer.
*/
async function withBootDeadline(label, budgetMs, work) {
	let timer = null;
	const deadline = new Promise((resolve) => {
		timer = setTimeout(() => {
			logger.error(`[boot] ${label} exceeded ${Math.round(budgetMs / 1e3)} s and was skipped; the app continues to start.`);
			resolve(null);
		}, budgetMs);
		timer.unref?.();
	});
	try {
		return await Promise.race([work(), deadline]);
	} catch (error) {
		logger.warn(`[boot] ${label} failed:`, error);
		return null;
	} finally {
		if (timer) clearTimeout(timer);
	}
}
/** Общий бюджет дозагрузочной реконсиляции. */
var BOOT_RECONCILE_BUDGET_MS = 2e4;
async function reconcileOwnedSystemStateBeforeUi() {
	const startedAt = Date.now();
	const remainingBudget = () => Math.max(2e3, BOOT_RECONCILE_BUDGET_MS - (Date.now() - startedAt));
	try {
		logger.info("[boot] system proxy reconciliation:start");
		const result = await withBootDeadline("system proxy reconciliation", Math.min(8e3, remainingBudget()), () => recoverSystemProxyTransaction());
		if (!result) logger.warn("[boot] system proxy reconciliation did not finish in time; deferred to background recovery");
		else if (result.restored) logger.warn("[boot] system proxy reconciliation: restored the user configuration after an unclean exit");
		else if (result.conflict) logger.info("[boot] system proxy reconciliation: configuration is no longer ours; left untouched");
		else if (!result.ok) logger.error("[boot] system proxy reconciliation incomplete:", result.error);
		else logger.info("[boot] system proxy reconciliation:complete");
	} catch (error) {
		logger.warn("[boot] system proxy reconciliation failed:", error);
	}
	try {
		const dnsRecovery = await withBootDeadline("dns transaction recovery", Math.min(12e3, remainingBudget()), () => recoverDnsTransaction());
		if (!dnsRecovery) logger.error("[boot] dns transaction recovery did not finish in time; adapters may still hold an unfinished configuration");
		else if (dnsRecovery.found && dnsRecovery.phase !== "committed") if (dnsRecovery.failures.length > 0) logger.error(`[boot] dns transaction recovery incomplete (phase ${dnsRecovery.phase}): ${dnsRecovery.failures.join("; ")}`);
		else logger.warn(`[boot] dns transaction recovery: restored the original snapshot on ${dnsRecovery.restored} adapter(s) after phase ${dnsRecovery.phase}`);
	} catch (error) {
		logger.warn("[boot] dns transaction recovery failed:", error);
	}
	await withBootDeadline("orphaned runtime config cleanup", Math.min(5e3, remainingBudget()), async () => globalRuntimeManager?.cleanupOrphanedRuntimeConfigs());
}
/**
* Возвращает адаптеры к DHCP, если они указывают на локальный резолвер, а тот
* не отвечает. Проверяется фактическое разрешение имени, а не состояние службы:
* служба может числиться running и при этом не обслуживать запросы.
*/
function isLoopbackDnsAddress(address) {
	const normalized = address.trim().replace(/^\[|\]$/g, "").toLowerCase();
	return normalized === "::1" || normalized === "localhost" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}
async function inspectOwnedLoopbackDnsHealth() {
	const targets = (await readAdapterDnsSnapshot()).filter((adapter) => [...adapter.ipv4, ...adapter.ipv6].some(isLoopbackDnsAddress));
	const addresses = [...new Set(targets.flatMap((adapter) => [...adapter.ipv4, ...adapter.ipv6]).filter(isLoopbackDnsAddress))].slice(0, 4);
	if (targets.length === 0 || addresses.length === 0) return {
		active: false,
		healthy: true,
		interfaceIndices: [],
		addresses: []
	};
	const { promises: dnsPromises } = await import("node:dns");
	const probeDomains = ["www.msftconnecttest.com", "cloudflare.com"];
	for (const address of addresses) {
		const resolver = new dnsPromises.Resolver({
			timeout: 2e3,
			tries: 1
		});
		resolver.setServers([address]);
		for (const domain of probeDomains) try {
			if ((await resolver.resolve4(domain)).length > 0) return {
				active: true,
				healthy: true,
				interfaceIndices: targets.map((adapter) => adapter.interfaceIndex),
				addresses
			};
		} catch {}
	}
	return {
		active: true,
		healthy: false,
		interfaceIndices: [...new Set(targets.map((adapter) => adapter.interfaceIndex))],
		addresses
	};
}
async function restoreDnsIfLocalResolverIsDown() {
	try {
		const [systemDoh, gravityless] = await Promise.all([globalSystemDohManager?.status({ force: true }).catch(() => null) ?? Promise.resolve(null), globalGravitylessDnsManager?.status({ force: true }).catch(() => null) ?? Promise.resolve(null)]);
		if (systemDoh?.verified || gravityless?.verified) return false;
		const health = await inspectOwnedLoopbackDnsHealth();
		if (!health.active || health.healthy) return false;
		logger.error(`[boot] DNS safety net: adapter(s) ${health.interfaceIndices.join(",")} point at ${health.addresses.join(",")}, but the local resolver does not answer. Restoring DHCP only on those adapters.`);
		const { resetSystemDnsInterfaces } = await Promise.resolve().then(() => system_dns_exports);
		await resetSystemDnsInterfaces(health.interfaceIndices, false);
		logger.warn("[boot] DNS safety net: affected adapters restored to DHCP; external DNS on other adapters was preserved");
		return true;
	} catch (error) {
		logger.error("[boot] DNS safety net failed:", error);
		return false;
	}
}
async function runDnsWatchdog() {
	if (dnsWatchdogInFlight || !globalStateStore) return;
	const settings = globalStateStore.get().settings;
	if (!(settings.systemDohEnabled || isGravitylessLoopbackDnsRequest(String(settings.systemDnsServers ?? "")))) {
		dnsWatchdogConsecutiveFailures = 0;
		return;
	}
	dnsWatchdogInFlight = true;
	try {
		const health = await inspectOwnedLoopbackDnsHealth();
		if (!health.active || health.healthy) {
			dnsWatchdogConsecutiveFailures = 0;
			return;
		}
		dnsWatchdogConsecutiveFailures += 1;
		logger.warn(`[dns-watchdog] local resolver probe failed (${dnsWatchdogConsecutiveFailures}/${DNS_WATCHDOG_FAILURE_THRESHOLD})`);
		if (dnsWatchdogConsecutiveFailures < DNS_WATCHDOG_FAILURE_THRESHOLD) return;
		const recovery = () => restoreDnsIfLocalResolverIsDown();
		if (globalNetworkCombinatorManager) await globalNetworkCombinatorManager.runCoordinatedMutation({
			module: "dns",
			action: "watchdog-recovery",
			requiredLocks: ["dns", "dns-verify"],
			conflictsWith: ["traffic-route"]
		}, recovery);
		else await recovery();
		dnsWatchdogConsecutiveFailures = 0;
	} catch (error) {
		logger.error("[dns-watchdog] recovery probe failed:", error);
	} finally {
		dnsWatchdogInFlight = false;
	}
}
function startDnsWatchdog() {
	if (dnsWatchdogTimer) return;
	dnsWatchdogTimer = setInterval(() => void runDnsWatchdog(), DNS_WATCHDOG_INTERVAL_MS);
	dnsWatchdogTimer.unref?.();
	logger.info("[dns-watchdog] started (60 s interval, recovery after 2 consecutive failures)");
}
function stopDnsWatchdog() {
	if (dnsWatchdogTimer) clearInterval(dnsWatchdogTimer);
	dnsWatchdogTimer = null;
	dnsWatchdogConsecutiveFailures = 0;
}
async function recoverBackgroundFeaturesAfterRendererLoad(loadedState) {
	logger.info("[boot] background recovery:start");
	const usesLoopbackDns = isGravitylessLoopbackDnsRequest(String(loadedState.settings.systemDnsServers ?? ""));
	const recoverDns = async () => {
		if (globalSystemDohManager && loadedState.settings.systemDohEnabled) {
			logger.info("[boot] system DoH recovery:start");
			try {
				await globalSystemDohManager.recover({
					enabled: loadedState.settings.systemDohEnabled,
					url: loadedState.settings.systemDohUrl,
					localAddress: loadedState.settings.systemDohLocalAddress
				});
				logger.info("[boot] system DoH recovery:complete");
			} catch (error) {
				logger.error("[boot] system DoH recovery failed:", error);
			}
		}
		if (globalGravitylessDnsManager && !loadedState.settings.systemDohEnabled && usesLoopbackDns) {
			logger.info("[boot] Gravityless DNS recovery:start");
			try {
				if (!(await globalGravitylessDnsManager.status({ force: true }).catch(() => null))?.verified) await globalGravitylessDnsManager.ensureRunning();
				logger.info("[boot] Gravityless DNS recovery:complete");
			} catch (error) {
				logger.error("[boot] Gravityless DNS recovery failed:", error);
			}
		}
		if (usesLoopbackDns || loadedState.settings.systemDohEnabled) await restoreDnsIfLocalResolverIsDown();
	};
	if (globalNetworkCombinatorManager) await globalNetworkCombinatorManager.runCoordinatedMutation({
		module: "dns",
		action: "boot-recovery",
		requiredLocks: ["dns", "dns-verify"],
		conflictsWith: ["traffic-route"]
	}, recoverDns);
	else await recoverDns();
	// Windows owns automatic service startup. Opening the UI must respect a stopped service.
	if (loadedState.settings.autoConnect && loadedState.activeNodeId) scheduleAutoConnectWhenNetworkReady(loadedState.activeNodeId);
	startDnsWatchdog();
	logger.info("[boot] background recovery:complete");
}
/**
* Запускает автоподключение, когда сеть действительно готова.
*
* MED-05: прежняя реализация посылала событие ровно через 3 секунды после
* загрузки. При автозапуске вместе с входом в систему за это время часто нет ни
* адреса, ни маршрута, ни разрешения имён — попытка гарантированно проваливалась
* и уходила в reconnect-цикл. То же самое происходило после выхода из сна и в
* сети с captive portal.
*
* Здесь ожидание строится на факте: разрешение имени + доступность маршрута.
* Интервалы растут (1, 2, 4, 8, 15, 15… с) и ограничены общим бюджетом, чтобы
* ожидание не превратилось в бесконечный опрос.
*/
async function scheduleAutoConnectWhenNetworkReady(activeNodeId) {
	const AUTO_CONNECT_BUDGET_MS = 180 * 1e3;
	const BACKOFF_STEPS_MS = [
		1e3,
		2e3,
		4e3,
		8e3,
		15e3
	];
	const deadline = Date.now() + AUTO_CONNECT_BUDGET_MS;
	let attempt = 0;
	const networkReady = async () => {
		try {
			const { promises: dnsPromises } = await import("node:dns");
			const addresses = await dnsPromises.resolve4("www.msftconnecttest.com");
			return Array.isArray(addresses) && addresses.length > 0;
		} catch {
			return false;
		}
	};
	while (Date.now() < deadline) {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		if (await networkReady()) {
			logger.info(`[boot] auto-connect: network is ready after ${attempt} probe(s)`);
			mainWindow.webContents.send("auto-connect", activeNodeId);
			return;
		}
		const delayMs = BACKOFF_STEPS_MS[Math.min(attempt, BACKOFF_STEPS_MS.length - 1)];
		attempt += 1;
		await new Promise((resolve) => {
			setTimeout(resolve, delayMs).unref?.();
		});
	}
	logger.warn("[boot] auto-connect skipped: the network did not become usable within the wait budget. The user can connect manually.");
}
async function createMainWindow() {
	logger.info("[boot] createMainWindow:start");
	const preload = path.join(__dirname$1, "preload.js");
	const rendererFile = path.join(__dirname$1, `../renderer/main_window/index.html`);
	const iconPath = getIconPath();
	const minimizedLaunch = process.argv.includes("--minimized");
	logger.info(`[boot] paths preload=${preload}, renderer=${rendererFile}, icon=${iconPath ?? "none"}, minimized=${minimizedLaunch}`);
	configureTrustedIpcPolicy({
		devServerUrl: void 0,
		packagedRendererRoot: path.dirname(rendererFile)
	});
	installIpcMainGuard(ipcMain);
	logger.info("[boot] ipc security guards installed");
	const windowState = loadWindowState(WINDOW_STATE_PATH, getWorkAreas(), {
		width: DEFAULT_WINDOW_WIDTH,
		height: DEFAULT_WINDOW_HEIGHT,
		minWidth: MIN_WINDOW_WIDTH,
		minHeight: MIN_WINDOW_HEIGHT
	});
	const initialWidgetMode = true;
	const primaryArea = (getWorkAreas()[0]) || { x: 0, y: 0, width: 1920, height: 1080 };
	const initialBounds = {
		x: Math.round(primaryArea.x + (primaryArea.width - WIDGET_WINDOW_WIDTH) / 2),
		y: Math.round(primaryArea.y + (primaryArea.height - WIDGET_WINDOW_HEIGHT) / 2),
		width: WIDGET_WINDOW_WIDTH,
		height: WIDGET_WINDOW_HEIGHT
	};
	logger.info("[boot] creating BrowserWindow");
	mainWindow = new BrowserWindow({
		...initialBounds,
		minWidth: WIDGET_WINDOW_WIDTH,
		minHeight: WIDGET_WINDOW_HEIGHT,
		useContentSize: true,
		resizable: false,
		title: "Egoist Lagom",
		titleBarStyle: "hidden",
		autoHideMenuBar: true,
		show: false,
		icon: iconPath ? nativeImage.createFromPath(iconPath) : void 0,
		backgroundColor: "#111111",
		transparent: false,
		webPreferences: {
			preload,
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true
		}
	});
	logger.info("[boot] BrowserWindow created");
	if (iconPath) {
		try {
			mainWindow.setIcon(nativeImage.createFromPath(iconPath));
		} catch {}
	}
	mainWindow.shieldWidgetMode = true;
	mainWindow.shieldDashboardBounds = windowState.bounds && windowState.bounds.width >= MIN_WINDOW_WIDTH && windowState.bounds.height >= MIN_WINDOW_HEIGHT ? { ...windowState.bounds } : {
		x: Math.round(primaryArea.x + (primaryArea.width - DEFAULT_WINDOW_WIDTH) / 2),
		y: Math.round(primaryArea.y + (primaryArea.height - DEFAULT_WINDOW_HEIGHT) / 2),
		width: DEFAULT_WINDOW_WIDTH,
		height: DEFAULT_WINDOW_HEIGHT
	};
	applyRendererScalePolicy(mainWindow);
	let windowStateTimer = null;
	const persistCurrentWindowState = () => {
		if (windowStateTimer) {
			clearTimeout(windowStateTimer);
			windowStateTimer = null;
		}
		if (mainWindow) saveWindowState(mainWindow, windowState);
	};
	const scheduleWindowStateSave = () => {
		if (windowStateTimer) clearTimeout(windowStateTimer);
		windowStateTimer = setTimeout(persistCurrentWindowState, 250);
	};
	mainWindow.on("move", scheduleWindowStateSave);
	mainWindow.on("resize", scheduleWindowStateSave);
	mainWindow.on("maximize", scheduleWindowStateSave);
	mainWindow.on("unmaximize", scheduleWindowStateSave);
	mainWindow.on("hide", resetTrafficSampling);
	mainWindow.on("minimize", resetTrafficSampling);
	mainWindow.once("ready-to-show", () => {
		if (!minimizedLaunch && mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
	});
	mainWindow.webContents.on("before-input-event", (event, input) => {
		if (!isRendererZoomShortcut(input)) return;
		event.preventDefault();
		if (mainWindow) applyRendererScalePolicy(mainWindow);
	});
	logger.info("[boot] creating StateStore and managers");
	const stateStore = new StateStore(USER_DATA_DIR, app.isPackaged ? path.join(process.resourcesPath, "installation.json") : void 0);
	globalStateStore = stateStore;
	configureSystemProxyOwnershipState(USER_DATA_DIR);
	configureDnsTransactionStore({
		programDataDir: process.env.ProgramData ?? null,
		userDataDir: USER_DATA_DIR,
		version: app.getVersion()
	});
	const protectedRuntimeRoot = resolveProtectedRuntimeRoot({
		packaged: app.isPackaged,
		programDataDir: process.env.ProgramData,
		userDataDir: USER_DATA_DIR
	});
	const coreServiceCandidate = app.isPackaged ? new CoreServiceClient() : void 0;
	const coreServiceAvailable = coreServiceCandidate ? await coreServiceCandidate.isAvailable().catch(() => false) : false;
	const coreService = coreServiceCandidate;
	if (coreServiceCandidate && !coreServiceAvailable) logger.warn("[boot] EgoistShieldCore is not ready yet; privileged actions will retry the authenticated service.");
	if (!globalRuntimeManager) globalRuntimeManager = new VpnRuntimeManager(process.resourcesPath, USER_DATA_DIR);
	if (!globalGravitylessDnsManager) globalGravitylessDnsManager = new GravitylessDnsManager(process.resourcesPath, coreService);
	if (!globalSystemDohManager) globalSystemDohManager = useComponentService(new SystemDohManager(process.resourcesPath, app.getAppPath(), USER_DATA_DIR, resolveProtectedComponentRoot(protectedRuntimeRoot, "SystemDoH"), coreService), "SystemDoH", coreService);
	if (!globalZapretManager) globalZapretManager = useComponentService(new ZapretManager(process.resourcesPath, app.getAppPath(), USER_DATA_DIR, resolveProtectedComponentRoot(protectedRuntimeRoot, "Zapret"), coreService), "Zapret", coreService);
	if (!globalTelegramProxyManager) globalTelegramProxyManager = useComponentService(new TelegramProxyManager(process.resourcesPath, app.getAppPath(), USER_DATA_DIR, resolveProtectedComponentRoot(protectedRuntimeRoot, "TelegramProxy"), coreService), "TelegramProxy", coreService);
	await reconcileOwnedSystemStateBeforeUi();
	logger.info("[boot] registering IPC handlers");
	globalNetworkCombinatorManager = await registerIpcHandlers(mainWindow, stateStore, globalRuntimeManager, globalGravitylessDnsManager, globalSystemDohManager, globalZapretManager, globalTelegramProxyManager);
	logger.info("[boot] IPC handlers registered");
	logger.info("[boot] loading persisted state");
	const loadedState = await stateStore.load();
	logger.info("[boot] persisted state loaded");
	try {
		syncWindowsLoginItemSettings({
			app,
			settings: loadedState.settings
		});
		const removedLegacyTasks = app.isPackaged ? await cleanupOwnedLegacyWindowsStartupTasks() : [];
		if (removedLegacyTasks.length > 0) logger.info(`[boot] Removed legacy duplicate startup tasks: ${removedLegacyTasks.join(", ")}`);
		applyLoggerSettings(loadedState.settings);
	} catch (error) {
		logger.warn("[system] Failed to apply persisted settings on startup:", error);
	}
	autoUpdateEnabled = loadedState.settings.autoUpdate;
	logger.info(`[updater] Persisted auto-update = ${autoUpdateEnabled}`);
	mainWindow.webContents.on("did-finish-load", () => {
		if (mainWindow) applyRendererScalePolicy(mainWindow);
		logger.info("[window] Main window renderer finished load");
	});
	installWindowSecurityGuards(mainWindow);
	mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
		logger.error(`[window] did-fail-load code=${errorCode} mainFrame=${isMainFrame} url=${validatedURL} description=${errorDescription}`);
	});
	mainWindow.webContents.on("render-process-gone", (_event, details) => {
		logger.error(`[window] render-process-gone reason=${details.reason} exitCode=${details.exitCode ?? "unknown"}`);
		if (details.reason === "crashed" || details.reason === "killed") {
			try {
				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.webContents.reload();
				}
			} catch {}
		}
	});
	mainWindow.webContents.on("console-message", (details) => {
		const { level, lineNumber, message, sourceId } = details;
		if (level === "warning" || level === "error") logger.warn(`[window] console-message level=${level} ${sourceId}:${lineNumber} ${message}`);
	});
	logger.info(`[window] Loading packaged renderer from ${rendererFile}`);
	await mainWindow.loadFile(rendererFile);
	logger.info("[window] loadFile resolved successfully");
	if (minimizedLaunch) mainWindow.hide();
	mainWindow.on("close", (event) => {
		persistCurrentWindowState();
		const minimizeToTray = Boolean(globalStateStore?.get().settings.minimizeToTray);
		if (!isQuitting && minimizeToTray) {
			event.preventDefault();
			applyShieldWindowMode(mainWindow, true);
			mainWindow?.webContents?.send("switch-to-widget");
			mainWindow?.hide();
			return false;
		}
		isQuitting = true;
	});
	mainWindow.on("closed", () => {
		if (windowStateTimer) clearTimeout(windowStateTimer);
		mainWindow = null;
	});
	recoverBackgroundFeaturesAfterRendererLoad(loadedState).catch((error) => {
		logger.error("[boot] background recovery failed:", error);
	});
	logger.info("[boot] createMainWindow:complete");
}
function updateTrayMenu(isConnected) {
	if (!tray) return;
	const iconPath = getTrayAssetPath(isConnected ? "tray-connected.png" : "tray-default.png");
	if (iconPath) {
		const iconBase = nativeImage.createFromPath(iconPath);
		if (!iconBase.isEmpty()) tray.setImage(iconBase);
	}
	tray.setContextMenu(Menu.buildFromTemplate([
		{
			label: "Основное окно",
			click: () => {
				if (mainWindow) {
					mainWindow.show();
					mainWindow.focus();
				}
			}
		},
		{ type: "separator" },
		{
			label: isConnected ? "Статус: Подключено" : "Статус: Отключено",
			enabled: false
		},
		{ type: "separator" },
		{
			label: "Выход",
			click: () => {
				isQuitting = true;
				app.quit();
			}
		}
	]));
}
function createTray() {
	if (tray) return;
	const trayPng = getTrayAssetPath("tray-icon.png") || getTrayAssetPath("tray-default.png");
	if (trayPng) {
		const img = nativeImage.createFromPath(trayPng);
		const resized = img.isEmpty() ? img : img.resize({
			width: 32,
			height: 32
		});
		tray = new Tray(resized.isEmpty() ? img : resized);
	} else {
		const iconPath = getIconPath();
		if (!iconPath) return;
		tray = new Tray(nativeImage.createFromPath(iconPath));
	}
	tray.setToolTip("Egoist Lagom");
	tray.on("click", () => {
		if (mainWindow) {
			if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
				applyShieldWindowMode(mainWindow, true);
				mainWindow.webContents?.send("switch-to-widget");
			}
			mainWindow.isMinimized() ? mainWindow.restore() : mainWindow.show();
			mainWindow.focus();
		}
	});
	updateTrayMenu(false);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", () => {
		if (mainWindow) {
			applyShieldWindowMode(mainWindow, true);
			mainWindow.webContents?.send("switch-to-widget");
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.show();
			mainWindow.focus();
		}
	});
	app.whenReady().then(async () => {
		try {
			app.setName("Egoist Lagom");
			app.setAppUserModelId(APP_USER_MODEL_ID);
			logger.info(`[paths] Runtime=${runtimeEnvironment}, userData=${USER_DATA_DIR}`);
			await createMainWindow();
			createTray();
			startTrafficMonitoring();
			setupAutoUpdater();
			setupManagedComponentUpdateChecks();
			app.on("activate", async () => {
				if (!mainWindow) await createMainWindow();
			});
		} catch (error) {
			const message = error instanceof Error ? error.stack ?? error.message : String(error);
			logger.error("[boot] app startup failed:", message);
			dialog.showErrorBox("Egoist Lagom startup failed", message);
			app.quit();
		}
	});
}
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
//#endregion
export { globalGravitylessDnsManager, globalNetworkCombinatorManager, globalRuntimeManager, globalStateStore, globalSystemDohManager, globalTelegramProxyManager, globalZapretManager, tray, updateTrayMenu };

//# sourceMappingURL=main.js.map
