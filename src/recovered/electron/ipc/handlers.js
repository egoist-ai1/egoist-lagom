//#region src/electron/ipc/handlers.ts
async function registerIpcHandlers(window, stateStore, runtimeManager, gravitylessDnsManager, systemDohManager, zapretManager, telegramProxyManager) {
	await stateStore.load();
	const ctx = {
		window,
		stateStore,
		runtimeManager,
		gravitylessDnsManager,
		systemDohManager,
		zapretManager,
		telegramProxyManager
	};
	const networkCombinatorManager = new NetworkCombinatorManager({
		isElevated: async () => runtimeManager.isAdmin(),
		moduleInspectors: buildNetworkModuleInspectors({
			stateStore,
			runtimeManager,
			gravitylessDnsManager,
			systemDohManager,
			zapretManager,
			telegramProxyManager
		})
	});
	ctx.networkCombinatorManager = networkCombinatorManager;
	registerNetworkCombinatorHandlers(networkCombinatorManager);
	registerSystemHandlers(ctx);
	registerImportHandlers(ctx);
	registerVpnHandlers(ctx);
	registerZapretHandlers(ctx);
	registerTelegramProxyHandlers(ctx);
	registerLogHandlers();
	registerHealthHandlers(ctx);
	return networkCombinatorManager;
}
function buildNetworkModuleInspectors({ stateStore, runtimeManager, gravitylessDnsManager, systemDohManager, zapretManager, telegramProxyManager }) {
	return {
		vpn: async () => inspectModule("vpn", async () => {
			const state = stateStore.get();
			const status = await runtimeManager.status();
			const active = Boolean(status.connected);
			const locks = active ? [
				"traffic-route",
				"system-proxy",
				"dns-verify",
				...state.settings.killSwitch ? ["firewall-kill-switch"] : [],
				...state.settings.zapretSuspendDuringVpn ? ["zapret-suspend"] : []
			] : [];
			return {
				id: "vpn",
				status: active ? "active" : status.lifecycle === "failed" ? "degraded" : "idle",
				health: status.lastError || status.diagnostic?.reason ? "warn" : "ok",
				ownedLocks: locks,
				activeMutations: active ? [
					`runtime:${status.runtimeKind ?? "unknown"}`,
					`route:${state.settings.routeMode ?? "global"}`,
					...status.proxyPort ? [`system-proxy:${status.proxyPort}`] : []
				] : [],
				rollbackReady: active,
				blockers: status.lastError ? [String(status.lastError)] : []
			};
		}),
		dns: async () => inspectModule("dns", async () => {
			const state = stateStore.get();
			const [gravityless, systemDoh] = await Promise.all([gravitylessDnsManager.status().catch((error) => ({
				running: false,
				lastError: stringifyError(error)
			})), systemDohManager.status().catch((error) => ({
				running: false,
				lastError: stringifyError(error)
			}))]);
			const mode = state.settings.systemDohEnabled ? "system-doh" : String(state.settings.systemDnsServers ?? "").trim() ? "system-dns" : "system-default";
			const active = mode !== "system-default" || Boolean(gravityless.running) || Boolean(systemDoh.running);
			const health = mode === "system-doh" && !systemDoh.running || String(state.settings.systemDnsServers ?? "").includes("127.0.0.1") && !gravityless.running ? "warn" : "ok";
			return {
				id: "dns",
				status: active ? "active" : "idle",
				health,
				ownedLocks: active ? ["dns", "dns-verify"] : [],
				activeMutations: active ? [
					`mode:${mode}`,
					...gravityless.running ? ["gravityless-dns:running"] : [],
					...systemDoh.running ? ["system-doh:running"] : []
				] : [],
				rollbackReady: false,
				blockers: [gravityless.lastError, systemDoh.lastError].filter(Boolean).map(String)
			};
		}),
		zapret: async () => inspectModule("zapret", async () => {
			const status = await zapretManager.status();
			const active = Boolean(status.serviceRunning || status.standaloneRunning);
			const suspended = Boolean(status.suspension?.active);
			const conflicts = Array.isArray(status.conflictMatrix) ? status.conflictMatrix : [];
			return {
				id: "zapret",
				status: suspended ? "suspended" : active ? "active" : conflicts.length > 0 ? "blocked" : "idle",
				health: status.lastError ? "warn" : conflicts.length > 0 ? "warn" : "ok",
				ownedLocks: active ? ["packet-interception", "windivert"] : [],
				activeMutations: active ? [
					status.serviceRunning ? "service:EgoistShieldZapret" : "standalone:winws",
					`profile:${status.currentProfile ?? "unknown"}`,
					`core:${status.coreVersion ?? "unknown"}`
				] : suspended ? [`suspended:${status.suspension?.mode ?? "unknown"}`] : [],
				rollbackReady: Boolean(status.provisioned || status.serviceInstalled),
				blockers: [...conflicts.map((item) => item.message ?? item.name ?? "Zapret conflict"), ...status.lastError ? [String(status.lastError)] : []]
			};
		}),
		"telegram-proxy": async () => inspectModule("telegram-proxy", async () => {
			const status = await telegramProxyManager.status();
			const running = Boolean(status.running);
			const portBlocked = status.portConflict && status.portConflict.available === false;
			return {
				id: "telegram-proxy",
				status: running ? "active" : portBlocked ? "blocked" : "idle",
				health: status.lastError || portBlocked ? "warn" : "ok",
				ownedLocks: running ? ["telegram-proxy-port"] : [],
				activeMutations: running ? [
					status.serviceRunning ? "service:EgoistShieldTelegramProxy" : "user-mode:tg-ws-proxy",
					`port:${status.portConflict?.port ?? status.config?.port ?? "unknown"}`,
					`version:${status.currentVersion ?? "unknown"}`
				] : [],
				rollbackReady: Boolean(status.serviceInstalled),
				blockers: [...portBlocked ? [`Port ${status.portConflict.port} is already in use.`] : [], ...status.lastError ? [String(status.lastError)] : []],
				sidecar: true
			};
		}),
		"system-proxy": async () => inspectModule("system-proxy", async () => {
			const status = await runtimeManager.status();
			const active = Boolean(status.connected && status.proxyPort);
			return {
				id: "system-proxy",
				status: active ? "active" : "idle",
				health: "ok",
				ownedLocks: active ? ["system-proxy"] : [],
				activeMutations: active ? [`proxy-port:${status.proxyPort}`] : [],
				rollbackReady: active
			};
		}),
		firewall: async () => inspectModule("firewall", async () => {
			const state = stateStore.get();
			const status = await runtimeManager.status();
			const active = Boolean(status.connected && state.settings.killSwitch);
			return {
				id: "firewall",
				status: active ? "active" : "idle",
				health: "ok",
				ownedLocks: active ? ["firewall-kill-switch"] : [],
				activeMutations: active ? ["kill-switch:enabled"] : [],
				rollbackReady: active
			};
		}),
		updates: async () => inspectModule("updates", async () => {
			const state = stateStore.get();
			return {
				id: "updates",
				status: "idle",
				health: state.settings.autoUpdate ? "ok" : "warn",
				ownedLocks: [],
				activeMutations: state.settings.autoUpdate ? ["auto-update:enabled"] : ["auto-update:disabled"],
				rollbackReady: false
			};
		})
	};
}
async function inspectModule(id, inspect) {
	try {
		return await inspect();
	} catch (error) {
		return {
			id,
			status: "degraded",
			health: "warn",
			ownedLocks: [],
			activeMutations: [],
			rollbackReady: false,
			blockers: [stringifyError(error)]
		};
	}
}
function stringifyError(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
