//#region src/electron/ipc/gravityless-dns.ts
var GRAVITYLESS_DNS_SERVICE_NAME = "dnscrypt-proxy";
var WINDOWS_PROGRAM_DATA_ROOT = process.env.ProgramData?.trim().replace(/[\\/]+$/, "") || "C:\\ProgramData";
var GRAVITYLESS_DNS_COMPAT_INSTALL_DIR = `${WINDOWS_PROGRAM_DATA_ROOT}\\GravitylessDNS`;
var GRAVITYLESS_DNS_PRODUCT_INSTALL_DIR = `${WINDOWS_PROGRAM_DATA_ROOT}\\EgoistShield\\GravitylessDNS`;
var GRAVITYLESS_DNS_EXE_NAME = "dnscrypt-proxy.exe";
var GRAVITYLESS_DNS_TOML_NAME = "dnscrypt-proxy.toml";
var GRAVITYLESS_DNS_LOG_NAME = "dnscrypt-proxy.log";
var GRAVITYLESS_DNS_TEST_DOMAIN = "gravityless.space";
var GRAVITYLESS_DNS_EXE_SHA256 = "23d1895bcfa8573605e811056d12b2bf5f13b0633758fbeda3ded79c5a6ea19d";
var GRAVITYLESS_DNS_TOML_SHA256 = "669c65b7a682f56e2dd78e94237b8ffe6f4b3b859f1546bf35d327a6f6f47d16";
var SC_SERVICE_STATE_BY_CODE$1 = {
	1: "STOPPED",
	2: "START_PENDING",
	3: "STOP_PENDING",
	4: "RUNNING",
	5: "CONTINUE_PENDING",
	6: "PAUSE_PENDING",
	7: "PAUSED"
};
function resolveGravitylessDnsPaths(mode = "product-owned") {
	const installDir = mode === "compatibility" ? GRAVITYLESS_DNS_COMPAT_INSTALL_DIR : GRAVITYLESS_DNS_PRODUCT_INSTALL_DIR;
	return {
		installDir,
		exePath: `${installDir}\\${GRAVITYLESS_DNS_EXE_NAME}`,
		configPath: `${installDir}\\${GRAVITYLESS_DNS_TOML_NAME}`,
		logPath: `${installDir}\\${GRAVITYLESS_DNS_LOG_NAME}`
	};
}
function buildListenAddresses(enableIpv6Loopback) {
	return enableIpv6Loopback ? ["127.0.0.1:53", "[::1]:53"] : ["127.0.0.1:53"];
}
function patchDnscryptTomlListenAddresses(toml, enableIpv6Loopback) {
	const replacement = `listen_addresses = [${buildListenAddresses(enableIpv6Loopback).map((item) => `'${item}'`).join(", ")}]`;
	const lines = toml.split(/\r?\n/);
	const index = lines.findIndex((line) => line.trimStart().toLowerCase().startsWith("listen_addresses"));
	if (index >= 0) {
		lines[index] = replacement;
		return lines.join("\n");
	}
	return `${replacement}\n${toml}`;
}
function parseScQueryState$1(stdout) {
	if (/does not exist|failed 1060|не существует|не найдена/i.test(stdout)) return {
		serviceName: GRAVITYLESS_DNS_SERVICE_NAME,
		state: "not-installed",
		pid: null,
		rawState: null
	};
	let rawState = null;
	for (const line of stdout.split(/\r?\n/)) {
		const match = /^\s*[^:\r\n]+:\s*([1-7])\s+([A-Z_]+)\s*$/i.exec(line);
		if (!match) continue;
		const rawState2 = match[2].toUpperCase();
		if (SC_SERVICE_STATE_BY_CODE$1[match[1]] === rawState2) {
			rawState = rawState2;
			break;
		}
	}
	const pidMatch = stdout.match(/PID\s*:\s*(\d+)/i);
	return {
		serviceName: GRAVITYLESS_DNS_SERVICE_NAME,
		state: normalizeServiceState(rawState),
		pid: pidMatch?.[1] ? Number.parseInt(pidMatch[1], 10) : null,
		rawState
	};
}
function normalizeServiceState(rawState) {
	switch (rawState) {
		case "RUNNING": return "running";
		case "STOPPED": return "stopped";
		case "START_PENDING": return "start-pending";
		case "STOP_PENDING": return "stop-pending";
		default: return "unknown";
	}
}
//#endregion
