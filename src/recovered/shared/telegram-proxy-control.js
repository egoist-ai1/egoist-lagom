//#region src/shared/telegram-proxy-control.ts
var TELEGRAM_PROXY_TARGET_VERSION = "1.7.0";
function summarizeTelegramProxyRouteHealth(logTail) {
	const statsLine = [...logTail].reverse().find((line) => /\bstats:\s/i.test(line));
	if (!statsLine) return {
		state: "unknown",
		mode: "unknown",
		totalConnections: 0,
		activeConnections: 0,
		successfulFallbackConnections: 0,
		errors: 0,
		visibleReason: "Upstream route has not emitted a traffic sample yet."
	};
	const read = (name) => {
		const match = new RegExp(`\\b${name}=(\\d+)`, "i").exec(statsLine);
		return match?.[1] ? Number.parseInt(match[1], 10) : 0;
	};
	const totalConnections = read("total");
	const activeConnections = read("active");
	const cloudflareConnections = read("cf");
	const directConnections = read("ws") + read("tcp_fb");
	const errors = read("err") + read("bad");
	const mode = cloudflareConnections > 0 && directConnections > 0 ? "mixed" : cloudflareConnections > 0 ? "cloudflare" : directConnections > 0 ? "direct" : "unknown";
	const state = errors > 0 && activeConnections === 0 ? "error" : cloudflareConnections + directConnections > 0 ? "active" : "idle";
	return {
		state,
		mode,
		totalConnections,
		activeConnections,
		successfulFallbackConnections: cloudflareConnections,
		errors,
		visibleReason: state === "active" ? `Upstream route is carrying traffic (${mode}, ${totalConnections} sessions, ${errors} errors).` : state === "error" ? `Upstream route has ${errors} errors and no active sessions.` : "Local proxy is ready and waiting for Telegram traffic."
	};
}
function buildTelegramProxyLinks(config) {
	const secret = config.secret.trim().replace(/^dd/i, "");
	const tgUrl = `tg://proxy?server=${encodeURIComponent(config.host)}&port=${config.port}&secret=dd${secret}`;
	const webUrl = `https://t.me/proxy?server=${encodeURIComponent(config.host)}&port=${config.port}&secret=dd${secret}`;
	return {
		tgUrl,
		webUrl,
		qrPayload: webUrl
	};
}
/**
* Turns "did the installed runtime really come from the shipped one" into the
* checksum state. The old status derived this from version strings alone, so it
* reported `verified` for a runtime nobody had ever hashed. Equal declared
* versions with different bytes mean the installed copy drifted from the
* package and must be reviewed rather than trusted.
*/
function resolveTelegramProxyChecksumState(input) {
	if (!input.bundledSha256) return input.managedSha256 ? "review-required" : "missing";
	if (!input.managedSha256) return "verified";
	if (input.bundledSha256 === input.managedSha256) return "verified";
	return input.bundledVersion && input.managedVersion && input.bundledVersion === input.managedVersion ? "review-required" : "verified";
}
function buildTelegramProxyPortState(input) {
	return {
		host: input.host,
		port: input.port,
		available: input.available,
		owner: input.owner ?? null,
		visibleReason: input.available === true ? "Local proxy port is available." : input.available === false ? `Port ${input.port} is already used by ${input.owner ?? "another local process"}.` : "Port conflict check has not run yet."
	};
}
function buildTelegramProxyUpdateGate(input) {
	const latestVersion = normalizeProxyVersion(input.latestVersion);
	const currentVersion = normalizeProxyVersion(input.currentVersion);
	const updateAvailable = latestVersion !== null && latestVersion !== currentVersion;
	const checksumState = input.checksumState;
	const controlledInstallAllowed = updateAvailable && checksumState === "verified";
	return {
		currentVersion,
		latestVersion,
		targetVersion: TELEGRAM_PROXY_TARGET_VERSION,
		updateAvailable,
		checksumState,
		controlledInstallAllowed,
		visibleReason: controlledInstallAllowed ? "Update may be installed because the release asset checksum is verified." : updateAvailable ? "Update is available, but checksum review must pass before install." : "Telegram Proxy runtime is already on the selected track."
	};
}
function buildTelegramProxyHealthState(input) {
	const logTail = input.logTail ?? [];
	return {
		available: input.available,
		running: input.running,
		serviceRunning: input.serviceRunning,
		serviceState: input.serviceState ?? null,
		port: buildTelegramProxyPortState({
			host: input.config.host,
			port: input.config.port,
			available: input.portAvailable,
			owner: input.portOwner
		}),
		links: buildTelegramProxyLinks(input.config),
		updateGate: buildTelegramProxyUpdateGate({
			currentVersion: input.currentVersion,
			latestVersion: input.latestVersion,
			checksumState: input.checksumState
		}),
		route: summarizeTelegramProxyRouteHealth(logTail),
		logTail
	};
}
function normalizeProxyVersion(value) {
	if (!value) return null;
	return value.trim().replace(/^v/i, "") || null;
}
//#endregion
