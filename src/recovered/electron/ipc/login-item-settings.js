//#region src/electron/ipc/login-item-settings.ts
var execFileAsync$11 = promisify(execFile);
var WINDOWS_AUTOSTART_ARGS = ["--background", "--minimized"];
function requiresWindowsBackgroundStartup(settings) { return false; }
function isWindowsLoginStartupEnabled(settings) { return settings.autoStart === true; }
function buildWindowsLoginItemSettings(settings, executablePath) {
	return { openAtLogin: isWindowsLoginStartupEnabled(settings), path: executablePath, args: [...WINDOWS_AUTOSTART_ARGS] };
}
async function runWindowsGuiStartupHelper({ operation, enabled = false, execute = execFileAsync$11, executablePath = process.execPath, resourcesPath = process.resourcesPath }) {
	const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	const helper = path.join(resourcesPath || path.join(path.dirname(executablePath), "resources"), "installer", "gui-login-startup.ps1");
	const result = await execute(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", helper, "-Operation", operation, "-Enabled", String(enabled)], { windowsHide: true, timeout: 60e3, maxBuffer: 256 * 1024 });
	let actual;
	try { actual = JSON.parse(result.stdout.trim()); } catch { throw new Error("Windows GUI startup helper returned an invalid result."); }
	return actual;
}
async function syncWindowsLoginItemSettings({ app, settings, previousSettings, platform = process.platform, executablePath = process.execPath, resourcesPath = process.resourcesPath, execute = execFileAsync$11 }) {
	if (platform !== "win32" || app.isPackaged !== true || typeof runtimeEnvironment !== "undefined" && runtimeEnvironment !== "production") return false;
	const expected = isWindowsLoginStartupEnabled(settings);
	if (previousSettings && expected === isWindowsLoginStartupEnabled(previousSettings)) return false;
	const actual = await runWindowsGuiStartupHelper({ operation: "Sync", enabled: expected, execute, executablePath, resourcesPath });
	if (actual?.schemaVersion !== 1 || actual.owner !== "EgoistShield" || actual.purpose !== "gui-login-startup" || actual.verified !== true || actual.enabled !== expected || actual.suspended !== false) throw new Error("Windows GUI startup task verification failed.");
	// Retire only Electron's exact previous login-item registration after task readback.
	const legacy = app.getLoginItemSettings({ path: executablePath, args: [...WINDOWS_AUTOSTART_ARGS] });
	if (legacy.openAtLogin === true) {
		app.setLoginItemSettings({ openAtLogin: false, path: executablePath, args: [...WINDOWS_AUTOSTART_ARGS] });
		if (app.getLoginItemSettings({ path: executablePath, args: [...WINDOWS_AUTOSTART_ARGS] }).openAtLogin === true) throw new Error("Legacy GUI login item removal did not verify.");
	}
	return true;
}
async function cleanupOwnedLegacyWindowsStartupTasks({ app, platform = process.platform, execute = execFileAsync$11, executablePath = process.execPath, resourcesPath = process.resourcesPath } = {}) {
	if (platform !== "win32" || app?.isPackaged !== true || typeof runtimeEnvironment !== "undefined" && runtimeEnvironment !== "production") return [];
	const actual = await runWindowsGuiStartupHelper({ operation: "CleanupLegacy", execute, executablePath, resourcesPath });
	if (!Array.isArray(actual.removed) || actual.removed.some(name => name !== "EgoistShieldStartup")) throw new Error("Legacy GUI startup cleanup returned an invalid result.");
	return actual.removed;
}
//#endregion