//#region src/electron/ipc/windows-system-binaries.ts
var WINDOWS_BINARY_SEGMENTS = {
	"cmd.exe": ["System32", "cmd.exe"],
	"curl.exe": ["System32", "curl.exe"],
	"ipconfig.exe": ["System32", "ipconfig.exe"],
	"net.exe": ["System32", "net.exe"],
	"netsh.exe": ["System32", "netsh.exe"],
	"powershell.exe": [
		"System32",
		"WindowsPowerShell",
		"v1.0",
		"powershell.exe"
	],
	"reg.exe": ["System32", "reg.exe"],
	"sc.exe": ["System32", "sc.exe"],
	"taskkill.exe": ["System32", "taskkill.exe"]
};
function normalizeBinaryLookup(command) {
	const baseName = path.win32.basename(command).trim().toLowerCase();
	return baseName.endsWith(".exe") ? baseName : `${baseName}.exe`;
}
function resolveWindowsSystemRoot(env = process.env) {
	return env.SYSTEMROOT || env.SystemRoot || env.windir || "C:\\Windows";
}
function resolveWindowsExecutable(command, options = {}) {
	if ((options.platform ?? process.platform) !== "win32") return command;
	if (path.win32.isAbsolute(command) || command.includes("\\") || command.includes("/")) return command;
	const segments = WINDOWS_BINARY_SEGMENTS[normalizeBinaryLookup(command)];
	if (!segments) return command;
	return path.win32.join(resolveWindowsSystemRoot(options.env), ...segments);
}
//#endregion
