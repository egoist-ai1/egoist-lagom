//#region src/electron/ipc/handlers-telegram-proxy.ts
function registerTelegramProxyHandlers({ telegramProxyManager, networkCombinatorManager }) {
	const mutate = (action, operation) => networkCombinatorManager ? networkCombinatorManager.runCoordinatedMutation({
		module: "telegram-proxy",
		action,
		requiredLocks: ["telegram-proxy-port"]
	}, operation) : operation();
	ipcMain.handle("telegram-proxy:status", async () => telegramProxyManager.status());
	ipcMain.handle("telegram-proxy:save-config", async (_event, rawConfig) => mutate("save-config", () => telegramProxyManager.saveConfig(TelegramProxyConfigSchema.parse(rawConfig))));
	ipcMain.handle("telegram-proxy:start", async () => mutate("start", () => telegramProxyManager.start()));
	ipcMain.handle("telegram-proxy:stop", async () => mutate("stop", () => telegramProxyManager.stop()));
	ipcMain.handle("telegram-proxy:restart", async () => mutate("restart", () => telegramProxyManager.restart()));
	ipcMain.handle("telegram-proxy:install-service", async () => mutate("install-service", () => telegramProxyManager.installService()));
	ipcMain.handle("telegram-proxy:start-service", async () => mutate("start-service", () => telegramProxyManager.startService()));
	ipcMain.handle("telegram-proxy:stop-service", async () => mutate("stop-service", () => telegramProxyManager.stopService()));
	ipcMain.handle("telegram-proxy:remove-service", async () => mutate("remove-service", () => telegramProxyManager.removeService()));
	ipcMain.handle("telegram-proxy:check-updates", async () => telegramProxyManager.checkForUpdates());
	ipcMain.handle("telegram-proxy:install-update", async () => mutate("install-update", () => telegramProxyManager.installUpdate()));
	ipcMain.handle("telegram-proxy:open-link", async () => telegramProxyManager.openConnectionLink());
	ipcMain.handle("telegram-proxy:open-logs", async () => telegramProxyManager.openLogs());
	ipcMain.handle("telegram-proxy:tail-logs", async (_event, maxLines) => telegramProxyManager.tailLogs(maxLines));
}
//#endregion
