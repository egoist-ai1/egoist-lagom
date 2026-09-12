let electron = require("electron");
//#region src/electron/preload.ts
function subscribeToChannel(channel, callback) {
	const listener = (_event, data) => callback(data);
	electron.ipcRenderer.on(channel, listener);
	return () => {
		electron.ipcRenderer.off(channel, listener);
	};
}
function subscribeToSignal(channel, callback) {
	const listener = () => callback();
	electron.ipcRenderer.on(channel, listener);
	return () => {
		electron.ipcRenderer.off(channel, listener);
	};
}
electron.contextBridge.exposeInMainWorld("egoistAPI", {
	shield: {
		status: () => electron.ipcRenderer.invoke("shield:status"),
		connect: (options) => electron.ipcRenderer.invoke("shield:connect", options),
		disconnect: () => electron.ipcRenderer.invoke("shield:disconnect"),
		cancel: () => electron.ipcRenderer.invoke("shield:cancel"),
		onProgress: (callback) => subscribeToChannel("shield:progress", callback)
	},
	state: {
		get: () => electron.ipcRenderer.invoke("state:get"),
		set: (next) => electron.ipcRenderer.invoke("state:set", next)
	},
	import: {
		text: (payload) => electron.ipcRenderer.invoke("import:text", payload),
		file: (filePath) => electron.ipcRenderer.invoke("import:file", filePath)
	},
	subscription: {
		refreshOne: (url) => electron.ipcRenderer.invoke("subscription:refresh-one", url),
		refreshAll: () => electron.ipcRenderer.invoke("subscription:refresh-all"),
		rename: (url, newName) => electron.ipcRenderer.invoke("subscription:rename", url, newName),
		delete: (url) => electron.ipcRenderer.invoke("subscription:delete", url)
	},
	node: { rename: (id, newName) => electron.ipcRenderer.invoke("node:rename", id, newName) },
	network: {
		inspect: () => electron.ipcRenderer.invoke("network:inspect"),
		plan: (intent) => electron.ipcRenderer.invoke("network:plan", intent),
		approve: (planId) => electron.ipcRenderer.invoke("network:approve", planId),
		apply: (planId) => electron.ipcRenderer.invoke("network:apply", planId),
		rollback: (planId) => electron.ipcRenderer.invoke("network:rollback", planId),
		verify: (planId) => electron.ipcRenderer.invoke("network:verify", planId),
		diagnose: () => electron.ipcRenderer.invoke("network:diagnose")
	},
	vpn: {
		connect: (nodeId) => electron.ipcRenderer.invoke("vpn:connect", nodeId),
		disconnect: () => electron.ipcRenderer.invoke("vpn:disconnect"),
		status: () => electron.ipcRenderer.invoke("vpn:status"),
		diagnose: () => electron.ipcRenderer.invoke("vpn:diagnose"),
		stressTest: (iterations) => electron.ipcRenderer.invoke("vpn:stress-test", iterations),
		onFallback: (callback) => subscribeToChannel("fallback-triggered", callback)
	},
	runtime: {
		installXray: () => electron.ipcRenderer.invoke("runtime:install-xray"),
		installAll: () => electron.ipcRenderer.invoke("runtime:install-all"),
		checkUpdates: () => electron.ipcRenderer.invoke("runtime:check-updates")
	},
	app: {
		isAdmin: () => electron.ipcRenderer.invoke("app:is-admin"),
		getVersion: () => electron.ipcRenderer.invoke("app:get-version"),
		isFirstRun: () => electron.ipcRenderer.invoke("app:is-first-run"),
		markFirstRunDone: () => electron.ipcRenderer.invoke("app:mark-first-run-done")
	},
	system: {
		pickFile: (filters) => electron.ipcRenderer.invoke("system:pick-file", filters),
		listProcesses: () => electron.ipcRenderer.invoke("system:list-processes"),
		getAppIcon: (exePath) => electron.ipcRenderer.invoke("system:get-app-icon", exePath),
		ping: (host, port, timeoutMs) => electron.ipcRenderer.invoke("vpn:ping", host, port, timeoutMs),
		pingActiveProxy: () => electron.ipcRenderer.invoke("vpn:ping-active-proxy"),
		speedtest: () => electron.ipcRenderer.invoke("vpn:speedtest"),
		onSpeedtestProgress: (callback) => subscribeToChannel("vpn:speedtest-progress", callback),
		geoip: (host) => electron.ipcRenderer.invoke("system:geoip", host),
		internetFix: () => electron.ipcRenderer.invoke("system:internet-fix"),
		terminateConflicts: () => electron.ipcRenderer.invoke("system:terminate-conflicts"),
		readClipboard: () => electron.ipcRenderer.invoke("system:read-clipboard"),
		writeClipboard: (text) => electron.ipcRenderer.invoke("system:write-clipboard", text),
		setDnsServers: (dnsServers) => electron.ipcRenderer.invoke("system:set-dns-servers", dnsServers),
		resetDnsServers: () => electron.ipcRenderer.invoke("system:reset-dns-servers"),
		dnsControllerStatus: () => electron.ipcRenderer.invoke("system:dns-controller-status"),
		dnsDiagnostics: () => electron.ipcRenderer.invoke("system:dns-diagnostics"),
		systemDohStatus: () => electron.ipcRenderer.invoke("system-doh:status"),
		applySystemDoh: (url) => electron.ipcRenderer.invoke("system-doh:apply", url),
		resetSystemDoh: () => electron.ipcRenderer.invoke("system-doh:reset"),
		restartSystemDoh: () => electron.ipcRenderer.invoke("system-doh:restart"),
		getMyIp: () => electron.ipcRenderer.invoke("vpn:get-my-ip"),
		routeProbe: () => electron.ipcRenderer.invoke("vpn:route-probe"),
		dnsLeakTest: () => electron.ipcRenderer.invoke("vpn:dns-leak-test"),
		/**
		* Повторно применяет системный маршрут активной сессии.
		*
		* Точечное действие вместо общего «починить всё»: если проверка защиты
		* нашла, что Windows не направлен на локальный прокси, это единственное
		* нужное исправление, и оно не касается DNS, Zapret и Telegram.
		*/
		reapplyRoute: () => electron.ipcRenderer.invoke("vpn:reapply-route"),
		/**
		* Отменяет активный замер скорости.
		*
		* Закрытие панели раньше только скрывало интерфейс — трафик продолжал идти.
		*/
		cancelSpeedtest: () => electron.ipcRenderer.invoke("vpn:speedtest-cancel")
	},
	window: {
		minimize: () => electron.ipcRenderer.invoke("window:minimize"),
		toggleMaximize: () => electron.ipcRenderer.invoke("window:toggle-maximize"),
		isMaximized: () => electron.ipcRenderer.invoke("window:is-maximized"),
		close: () => electron.ipcRenderer.invoke("window:close"),
		setWidgetMode: (isWidget) => electron.ipcRenderer.invoke("window:set-widget-mode", isWidget),
		onSwitchToWidget: (callback) => subscribeToSignal("switch-to-widget", callback)
	},
	traffic: { onUpdate: (callback) => subscribeToChannel("traffic-update", callback) },
	updater: {
		onUpdateAvailable: (callback) => subscribeToChannel("update-available", callback),
		onDownloadProgress: (callback) => subscribeToChannel("update-progress", callback),
		onUpdateDownloaded: (callback) => subscribeToChannel("update-downloaded", callback),
		onUpdateNotAvailable: (callback) => subscribeToSignal("update-not-available", callback),
		onUpdateError: (callback) => subscribeToChannel("update-error", callback),
		checkAndInstall: () => electron.ipcRenderer.invoke("updater:check-and-install"),
		openReleasePage: () => electron.ipcRenderer.invoke("updater:open-release-page"),
		check: () => electron.ipcRenderer.invoke("updater:check"),
		getLastResult: () => electron.ipcRenderer.invoke("updater:last-result"),
		setAuto: (enabled) => electron.ipcRenderer.invoke("updater:set-auto", enabled)
	},
	autoConnect: { onAutoConnect: (callback) => subscribeToChannel("auto-connect", callback) },
	logs: {
		getRecent: (maxLines) => electron.ipcRenderer.invoke("logs:get-recent", maxLines),
		getRuntimeSummary: (maxLines) => electron.ipcRenderer.invoke("logs:get-runtime-summary", maxLines),
		getPath: () => electron.ipcRenderer.invoke("logs:get-path"),
		openFolder: () => electron.ipcRenderer.invoke("logs:open-folder")
	},
	health: {
		getReport: () => electron.ipcRenderer.invoke("health:get-report"),
		runPerformanceProfile: () => electron.ipcRenderer.invoke("health:run-performance-profile", {
			rendererReadyMs: Math.round(performance.now()),
			jsHeapUsedBytes: "memory" in performance && typeof performance.memory?.usedJSHeapSize === "number" ? performance.memory?.usedJSHeapSize : null,
			screen: document.querySelector("[data-screen]")?.getAttribute("data-screen") ?? null
		})
	},
	diagnostics: { exportBundle: () => electron.ipcRenderer.invoke("diagnostics:export-bundle") },
	usage: {
		saveRecord: (record) => electron.ipcRenderer.invoke("usage:save-record", record),
		getHistory: () => electron.ipcRenderer.invoke("usage:get-history")
	},
	zapret: {
		status: () => electron.ipcRenderer.invoke("zapret:status"),
		listProfiles: () => electron.ipcRenderer.invoke("zapret:list-profiles"),
		dryRunProfile: (profileName) => electron.ipcRenderer.invoke("zapret:dry-run-profile", profileName),
		getUserLists: () => electron.ipcRenderer.invoke("zapret:get-user-lists"),
		saveUserLists: (lists) => electron.ipcRenderer.invoke("zapret:save-user-lists", lists),
		installService: (profileName) => electron.ipcRenderer.invoke("zapret:install-service", profileName),
		setServiceProfile: (profileName) => electron.ipcRenderer.invoke("zapret:set-service-profile", profileName),
		startService: () => electron.ipcRenderer.invoke("zapret:start-service"),
		stopService: () => electron.ipcRenderer.invoke("zapret:stop-service"),
		removeService: () => electron.ipcRenderer.invoke("zapret:remove-service"),
		startStandalone: (profileName) => electron.ipcRenderer.invoke("zapret:start-standalone", profileName),
		restartStandalone: (profileName) => electron.ipcRenderer.invoke("zapret:restart-standalone", profileName),
		stopStandalone: () => electron.ipcRenderer.invoke("zapret:stop-standalone"),
		setGameFilterMode: (mode) => electron.ipcRenderer.invoke("zapret:set-game-filter-mode", mode),
		setIpsetMode: (mode) => electron.ipcRenderer.invoke("zapret:set-ipset-mode", mode),
		updateIpsetList: () => electron.ipcRenderer.invoke("zapret:update-ipset-list"),
		setUpdateChecksEnabled: (enabled) => electron.ipcRenderer.invoke("zapret:set-update-checks-enabled", enabled),
		checkUpdates: () => electron.ipcRenderer.invoke("zapret:check-updates"),
		installCoreUpdate: () => electron.ipcRenderer.invoke("zapret:install-core-update"),
		installCoreVersion: (version) => electron.ipcRenderer.invoke("zapret:install-core-version", version),
		runCoreUpdater: () => electron.ipcRenderer.invoke("zapret:run-core-updater"),
		resetNetworkState: () => electron.ipcRenderer.invoke("zapret:reset-network-state"),
		diagnostics: () => electron.ipcRenderer.invoke("zapret:diagnostics"),
		autoSelect: () => electron.ipcRenderer.invoke("zapret:auto-select"),
		cancelAutoSelect: () => electron.ipcRenderer.invoke("zapret:cancel-auto-select"),
		onAutoSelectProgress: (callback) => subscribeToChannel("zapret:auto-select-progress", callback),
		openServiceMenu: () => electron.ipcRenderer.invoke("zapret:open-service-menu"),
		runFlowsealTests: () => electron.ipcRenderer.invoke("zapret:run-flowseal-tests"),
		cleanDiscordCache: (target) => electron.ipcRenderer.invoke("zapret:clean-discord-cache", target)
	},
	telegramProxy: {
		status: () => electron.ipcRenderer.invoke("telegram-proxy:status"),
		saveConfig: (config) => electron.ipcRenderer.invoke("telegram-proxy:save-config", config),
		start: () => electron.ipcRenderer.invoke("telegram-proxy:start"),
		stop: () => electron.ipcRenderer.invoke("telegram-proxy:stop"),
		restart: () => electron.ipcRenderer.invoke("telegram-proxy:restart"),
		installService: () => electron.ipcRenderer.invoke("telegram-proxy:install-service"),
		startService: () => electron.ipcRenderer.invoke("telegram-proxy:start-service"),
		stopService: () => electron.ipcRenderer.invoke("telegram-proxy:stop-service"),
		removeService: () => electron.ipcRenderer.invoke("telegram-proxy:remove-service"),
		checkUpdates: () => electron.ipcRenderer.invoke("telegram-proxy:check-updates"),
		installUpdate: () => electron.ipcRenderer.invoke("telegram-proxy:install-update"),
		openLink: () => electron.ipcRenderer.invoke("telegram-proxy:open-link"),
		openLogs: () => electron.ipcRenderer.invoke("telegram-proxy:open-logs"),
		tailLogs: (maxLines) => electron.ipcRenderer.invoke("telegram-proxy:tail-logs", maxLines)
	}
});
//#endregion

//# sourceMappingURL=preload.js.map
