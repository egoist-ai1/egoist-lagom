//#region src/electron/ipc/handlers-zapret.ts
var ZAPRET_HISTORY_MAX_BYTES = 48 * 1024;
var zapretSelectionHistoryStore = null;
function compactZapretSelectionHistory(result) {
	if (!result || typeof result !== "object" || result.completed !== true && result.cancelled !== true) return null;
	const sourceRows = Array.isArray(result.results) ? result.results : Array.isArray(result.testResults) ? result.testResults : [];
	const text = (value, max = 128) => {
		if (typeof value !== "string") return "";
		let clipped = value.slice(0, max);
		while (Buffer.byteLength(JSON.stringify(clipped), "utf8") > max) clipped = clipped.slice(0, -1);
		return clipped;
	};
	const count = value => Number.isFinite(value) && value >= 0 ? value : null;
	const rows = sourceRows.slice(0, 64).filter(row => row && typeof row === "object" && typeof (row.configName ?? row.name ?? row.configId ?? row.id) === "string" && ["success", "error"].includes(row.result)).map(row => {
		const targets = Array.isArray(row.targets) ? row.targets : [];
		return { configName: text(row.configName ?? row.name ?? row.configId ?? row.id), result: row.result, pingMs: count(row.pingMs), testedAt: text(row.testedAt, 32), error: text(row.error, 256), passedTargets: count(row.passedTargets) ?? targets.filter(target => target?.ok === true).length, totalTargets: count(row.totalTargets) ?? targets.length, targets: targets.slice(0, 8).filter(target => target && typeof target === "object").map(target => ({ label: text(target.label ?? target.key ?? target.name, 96), host: text(target.host ?? target.url, 256), ok: target.ok === true, pingMs: count(target.pingMs) })) };
	});
	if (!rows.length) return null;
	const history = { schemaVersion: 2, completed: result.completed === true && result.cancelled !== true, cancelled: result.cancelled === true, testedAt: text(result.testedAt, 32) || new Date().toISOString(), bestProfile: result.cancelled === true ? null : text(result.bestProfile) || null, results: rows, totalProfiles: count(result.totalProfiles), summary: text(result.summary, 256), detail: text(result.detail, 512) };
	if (!Number.isFinite(Date.parse(history.testedAt))) return null;
	for (const previewLimit of [8, 4, 2, 1, 0]) {
		for (const row of rows) { row.targets = row.targets.slice(0, previewLimit); row.targetsOmitted = Math.max(0, row.totalTargets - row.targets.length); }
		if (Buffer.byteLength(JSON.stringify(history), "utf8") <= ZAPRET_HISTORY_MAX_BYTES) return history;
	}
	return null;
}
function createZapretSelectionHistoryStore(userData) {
	const file = path.join(userData, "zapret-selection-history.json");
	let latest = null;
	try {
		if (fs.statSync(file).size <= ZAPRET_HISTORY_MAX_BYTES) {
			const stored = JSON.parse(fs.readFileSync(file, "utf8"));
			if (stored?.schemaVersion === 2) latest = compactZapretSelectionHistory(stored);
		}
	} catch {}
	return {
		read: () => latest,
		record(result) {
			const next = compactZapretSelectionHistory(result);
			if (!next || (next.cancelled || !next.completed) && latest?.completed) return latest;
			const temporary = `${file}.tmp`;
			try {
				fs.mkdirSync(userData, { recursive: true });
				fs.writeFileSync(temporary, JSON.stringify(next), "utf8");
				fs.renameSync(temporary, file);
				latest = next;
			} catch (error) {
				latest = next;
				logger.warn("[zapret] Could not persist selection history:", error);
			}
			return latest;
		}
	};
}
function getZapretSelectionHistoryStore() {
	if (!zapretSelectionHistoryStore) zapretSelectionHistoryStore = createZapretSelectionHistoryStore(app.getPath("userData"));
	return zapretSelectionHistoryStore;
}
function recordZapretSelectionHistory(result) {
	try { return getZapretSelectionHistoryStore().record(result); }
	catch (error) { logger.warn("[zapret] Selection history unavailable:", error); return null; }
}
function getZapretProfile(rawProfile, fallbackProfile) {
	if (typeof rawProfile === "undefined" || rawProfile === null || rawProfile === "") return fallbackProfile;
	return ZapretProfileInputSchema.parse(rawProfile);
}
async function assertVpnDisconnected(runtimeManager, message) {
	if ((await runtimeManager.status()).connected) throw new Error(message);
}
async function prepareZapretProbeDns(systemDohManager) {
	if (!systemDohManager?.status || typeof systemDohManager.stopAndRemove !== "function") return;
	const current = await systemDohManager.status({ force: true });
	if (current?.running === true && current?.verified === true) return;
	const restored = await systemDohManager.stopAndRemove();
	if (restored?.ok === false) throw new Error(restored.message || restored.error || "Не удалось подготовить DNS для автоподбора профилей.");
	const after = await systemDohManager.status({ force: true });
	if (!after || typeof after !== "object") throw new Error("Не удалось проверить DNS перед автоподбором профилей.");
	if (after?.lastError) throw new Error(after.lastError);
	if (after.running === true && after.verified !== true) throw new Error("DNS не прошёл проверку перед автоподбором профилей.");
}
function registerZapretHandlers({ stateStore, runtimeManager, systemDohManager, zapretManager, networkCombinatorManager }) {
	const mutate = (action, operation, guardMessage, requiredLocks = ["packet-interception", "windivert"]) => {
		const guardedOperation = async () => {
			// The VPN check must run after the combinator grants the mutation lock.
			// Checking before queueing leaves a TOCTOU window in which VPN can
			// connect while a Zapret operation is waiting for packet-interception.
			if (guardMessage) await assertVpnDisconnected(runtimeManager, guardMessage);
			return operation();
		};
		return networkCombinatorManager ? networkCombinatorManager.runCoordinatedMutation({
			module: "zapret",
			action,
			requiredLocks,
			conflictsWith: ["traffic-route", "zapret-suspend"]
		}, guardedOperation) : guardedOperation();
	};
	let autoSelectPending = false;
	let autoSelectCancelQueued = false;
	ipcMain.handle("zapret:status", async () => {
		const status = await zapretManager.status();
		let autoSelectHistory = null;
		try { autoSelectHistory = getZapretSelectionHistoryStore().read(); } catch {}
		return { ...status, autoSelectHistory };
	});
	ipcMain.handle("zapret:list-profiles", async () => {
		return zapretManager.listProfiles();
	});
	ipcMain.handle("zapret:dry-run-profile", async (_event, rawProfile) => {
		const fallbackProfile = stateStore.get().settings.zapretProfile;
		const profile = getZapretProfile(rawProfile, fallbackProfile);
		return zapretManager.dryRunProfile(profile);
	});
	ipcMain.handle("zapret:get-user-lists", async () => {
		return zapretManager.getUserLists();
	});
	ipcMain.handle("zapret:save-user-lists", async (_event, rawLists) => {
		return mutate("save-user-lists", () => zapretManager.saveUserLists(ZapretUserListsInputSchema.parse(rawLists)), "Сначала отключите соединение в Egoist Lagom, затем меняйте пользовательские списки профилей.");
	});
	ipcMain.handle("zapret:install-service", async (_event, rawProfile) => {
		const fallbackProfile = stateStore.get().settings.zapretProfile;
		const profile = getZapretProfile(rawProfile, fallbackProfile);
		return mutate("install-service", () => zapretManager.installService(profile), "Нельзя устанавливать или переустанавливать службу профилей при активном соединении.");
	});
	ipcMain.handle("zapret:set-service-profile", async (_event, rawProfile) => {
		const fallbackProfile = stateStore.get().settings.zapretProfile;
		const profile = getZapretProfile(rawProfile, fallbackProfile);
		return mutate("set-service-profile", () => zapretManager.setServiceProfile(profile), "Сначала отключите соединение в Egoist Lagom, затем меняйте профиль службы.");
	});
	ipcMain.handle("zapret:start-service", async () => {
		return mutate("start-service", () => zapretManager.startService(), "Сначала отключите соединение в Egoist Lagom, затем запускайте службу профилей.");
	});
	ipcMain.handle("zapret:stop-service", async () => {
		return mutate("stop-service", () => zapretManager.stopService());
	});
	ipcMain.handle("zapret:remove-service", async () => {
		return mutate("remove-service", () => zapretManager.removeService());
	});
	ipcMain.handle("zapret:start-standalone", async (_event, rawProfile) => {
		const fallbackProfile = stateStore.get().settings.zapretProfile;
		const profile = getZapretProfile(rawProfile, fallbackProfile);
		return mutate("start-standalone", () => zapretManager.startStandalone(profile), "Сначала отключите соединение в Egoist Lagom, затем запускайте отдельный профиль.");
	});
	ipcMain.handle("zapret:restart-standalone", async (_event, rawProfile) => {
		const fallbackProfile = stateStore.get().settings.zapretProfile;
		const profile = getZapretProfile(rawProfile, fallbackProfile);
		return mutate("restart-standalone", () => zapretManager.restartStandalone(profile), "Сначала отключите соединение в Egoist Lagom, затем перезапускайте отдельный профиль.");
	});
	ipcMain.handle("zapret:stop-standalone", async () => {
		return mutate("stop-standalone", () => zapretManager.stopStandalone());
	});
	ipcMain.handle("zapret:set-game-filter-mode", async (_event, rawMode) => {
		return mutate("set-game-filter-mode", () => zapretManager.setGameFilterMode(ZapretGameFilterModeSchema.parse(rawMode)));
	});
	ipcMain.handle("zapret:set-ipset-mode", async (_event, rawMode) => {
		return mutate("set-ipset-mode", () => zapretManager.setIpsetMode(ZapretIpsetModeSchema.parse(rawMode)));
	});
	ipcMain.handle("zapret:update-ipset-list", async () => {
		return mutate("update-ipset-list", () => zapretManager.updateIpsetList());
	});
	ipcMain.handle("zapret:set-update-checks-enabled", async (_event, rawEnabled) => {
		return mutate("set-update-checks", () => zapretManager.setUpdateChecksEnabled(ZapretUpdateChecksInputSchema.parse(rawEnabled)));
	});
	ipcMain.handle("zapret:check-updates", async () => {
		return zapretManager.checkForUpdates();
	});
	ipcMain.handle("zapret:install-core-update", async () => {
		return mutate("install-core-update", () => zapretManager.installCoreUpdate(), "Сначала отключите соединение в Egoist Lagom, затем обновляйте Lagom Core.");
	});
	ipcMain.handle("zapret:install-core-version", async (_event, rawVersion) => {
		return mutate("install-core-version", () => zapretManager.installCoreVersion(ZapretCoreVersionInputSchema.parse(rawVersion)), "Сначала отключите соединение в Egoist Lagom, затем меняйте версию Lagom Core.");
	});
	ipcMain.handle("zapret:run-core-updater", async () => {
		return mutate("run-core-updater", () => zapretManager.runCoreUpdater());
	});
	ipcMain.handle("zapret:reset-network-state", async () => {
		return mutate("reset-network-state", () => zapretManager.resetNetworkState(), "Сначала отключите соединение в Egoist Lagom, затем сбрасывайте состояние профилей.");
	});
	ipcMain.handle("zapret:diagnostics", async () => {
		return zapretManager.runDiagnostics();
	});
	ipcMain.handle("zapret:auto-select", async (event) => {
		autoSelectPending = true;
		try {
			return await mutate("auto-select", async () => {
				if (autoSelectCancelQueued) {
					autoSelectCancelQueued = false;
					if (!event.sender.isDestroyed()) event.sender.send("zapret:auto-select-progress", { phase: "cancelled" });
					return { completed: false, cancelled: true, bestProfile: null, goodProfiles: [], badProfiles: [], testedProfiles: [], results: [], testResults: [] };
				}
				await prepareZapretProbeDns(systemDohManager);
				if (autoSelectCancelQueued) {
					autoSelectCancelQueued = false;
					if (!event.sender.isDestroyed()) event.sender.send("zapret:auto-select-progress", { phase: "cancelled" });
					return { completed: false, cancelled: true, bestProfile: null, goodProfiles: [], badProfiles: [], testedProfiles: [], results: [], testResults: [] };
				}
				const result = await zapretManager.autoSelectBestProfile((progress) => {
					if (!event.sender.isDestroyed()) event.sender.send("zapret:auto-select-progress", progress);
				});
				recordZapretSelectionHistory(result);
				return result;
			}, "Сначала отключите соединение в Egoist Lagom, затем запускайте автоподбор профилей.", ["packet-interception", "windivert", "dns", "dns-verify"]);
		} finally {
			autoSelectPending = false;
			autoSelectCancelQueued = false;
		}
	});
	ipcMain.handle("zapret:cancel-auto-select", async () => {
		if (autoSelectPending) autoSelectCancelQueued = true;
		return zapretManager.cancelAutoSelect();
	});
	ipcMain.handle("zapret:open-service-menu", async () => {
		return zapretManager.openServiceMenu();
	});
	ipcMain.handle("zapret:run-flowseal-tests", async () => {
		return mutate("run-flowseal-tests", () => zapretManager.runFlowsealTests(), "Сначала отключите соединение в Egoist Lagom, затем запускайте тесты профилей.");
	});
	ipcMain.handle("zapret:clean-discord-cache", async (_event, rawTarget) => {
		return mutate("clean-discord-cache", () => zapretManager.cleanDiscordCache(ZapretDiscordCacheTargetSchema.parse(rawTarget)));
	});
}
//#endregion
