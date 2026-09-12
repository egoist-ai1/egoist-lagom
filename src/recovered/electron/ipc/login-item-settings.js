//#region src/electron/ipc/login-item-settings.ts
var execFileAsync$11 = promisify(execFile);
var WINDOWS_AUTOSTART_ARGS = ["--background", "--minimized"];
var LEGACY_OWNED_STARTUP_TASKS = ["EgoistShieldStartup"];
function requiresWindowsBackgroundStartup(settings) {
	return settings.autoConnect;
}
function isWindowsLoginStartupEnabled(settings) {
	return settings.autoStart || requiresWindowsBackgroundStartup(settings);
}
function buildWindowsLoginItemSettings(settings, executablePath) {
	return {
		openAtLogin: isWindowsLoginStartupEnabled(settings),
		path: executablePath,
		args: [...WINDOWS_AUTOSTART_ARGS]
	};
}
function syncWindowsLoginItemSettings({ app, settings, platform = process.platform, executablePath = process.execPath }) {
	if (platform !== "win32") return false;
	app.setLoginItemSettings(buildWindowsLoginItemSettings(settings, executablePath));
	const actual = app.getLoginItemSettings({
		path: executablePath,
		args: [...WINDOWS_AUTOSTART_ARGS]
	});
	const expected = isWindowsLoginStartupEnabled(settings);
	if (actual.openAtLogin !== expected) throw new Error(`Windows login item verification failed: requested=${expected}, actual=${actual.openAtLogin}.`);
	return true;
}
async function cleanupOwnedLegacyWindowsStartupTasks({ platform = process.platform, execute = execFileAsync$11 } = {}) {
	if (platform !== "win32") return [];
	const schtasks = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "schtasks.exe");
	const removed = [];
	for (const taskName of LEGACY_OWNED_STARTUP_TASKS) {
		try {
			await execute(schtasks, [
				"/Query",
				"/TN",
				taskName
			], {
				windowsHide: true,
				timeout: 8e3
			});
		} catch {
			continue;
		}
		await execute(schtasks, [
			"/Delete",
			"/TN",
			taskName,
			"/F"
		], {
			windowsHide: true,
			timeout: 8e3
		});
		try {
			await execute(schtasks, [
				"/Query",
				"/TN",
				taskName
			], {
				windowsHide: true,
				timeout: 8e3
			});
			throw new Error(`Legacy startup task ${taskName} still exists after deletion.`);
		} catch (error) {
			if (error instanceof Error && error.message.includes("still exists after deletion")) throw error;
		}
		removed.push(taskName);
	}
	return removed;
}
//#endregion
