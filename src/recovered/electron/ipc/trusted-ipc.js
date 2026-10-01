//#region src/electron/ipc/trusted-ipc.ts
var policy = null;
var ipcGuardInstalled = false;
function normalizePathForCompare(value) {
	return path.resolve(value).toLowerCase();
}
function isTrustedUrl(rawUrl) {
	if (!rawUrl || !policy) return false;
	try {
		const parsed = new URL(rawUrl);
		if (policy.devServerUrl) {
			const dev = new URL(policy.devServerUrl);
			if ((dev.protocol === "http:" || dev.protocol === "https:") && !parsed.username && !parsed.password && parsed.origin === dev.origin) return true;
		}
		if (parsed.protocol === "file:") {
			if (!/^file:\/\/\//i.test(rawUrl) || parsed.hostname || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || /[\u0000-\u0020\\]/.test(rawUrl) || /%(?:2f|5c|00)/i.test(parsed.pathname) || /\/(?:\.|%2e){1,2}(?:\/|$)/i.test(rawUrl)) return false;
			const framePath = decodeURIComponent(parsed.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
			const normalizedFramePath = normalizePathForCompare(framePath);
			return normalizedFramePath === normalizePathForCompare(policy.packagedRendererDocument);
		}
	} catch {
		return false;
	}
	return false;
}
function getEventUrl(event) {
	return event.senderFrame?.url ?? event.sender.getURL() ?? null;
}
function configureTrustedIpcPolicy(nextPolicy) {
	policy = {
		...nextPolicy,
		packagedRendererRoot: path.resolve(nextPolicy.packagedRendererRoot),
		packagedRendererDocument: path.resolve(nextPolicy.packagedRendererDocument ?? path.join(nextPolicy.packagedRendererRoot, "index.html")),
		trustedWebContents: null
	};
}
function assertTrustedIpcEvent(event) {
	const senderUrl = getEventUrl(event);
	if (!policy?.trustedWebContents || event.sender !== policy.trustedWebContents || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isTrustedUrl(senderUrl)) {
		logger.warn(`[security] Rejected IPC from untrusted sender: ${senderUrl ?? "<unknown>"}`);
		throw new Error("Untrusted IPC sender.");
	}
}
function installIpcMainGuard(ipcMain) {
	if (ipcGuardInstalled) return;
	const originalHandle = ipcMain.handle.bind(ipcMain);
	ipcMain.handle = ((channel, listener) => originalHandle(channel, async (event, ...args) => {
		assertTrustedIpcEvent(event);
		return listener(event, ...args);
	}));
	ipcGuardInstalled = true;
}
function isAllowedExternalUrl(rawUrl) {
	try {
		const parsed = new URL(rawUrl);
		if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port && parsed.port !== "443") return false;
		return [
			"github.com",
			"api.github.com",
			"t.me",
			"telegram.me",
			"telegram.org"
		].includes(parsed.hostname.toLowerCase());
	} catch {
		return false;
	}
}
function installWindowSecurityGuards(window) {
	if (!policy) throw new Error("Trusted IPC policy is not configured.");
	policy.trustedWebContents = window.webContents;
	window.webContents.on("will-navigate", (event, url) => {
		if (isTrustedUrl(url)) return;
		logger.warn(`[security] Blocked renderer navigation to ${url}`);
		event.preventDefault();
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (isAllowedExternalUrl(url)) shell.openExternal(url).catch((error) => {
			logger.warn("[security] Failed to open external URL:", error);
		});
		else logger.warn(`[security] Blocked window.open to ${url}`);
		return { action: "deny" };
	});
	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
		const requestingOrigin = "requestingOrigin" in details && typeof details.requestingOrigin === "string" ? details.requestingOrigin : "<unknown>";
		logger.warn(`[security] Denied permission request permission=${permission} origin=${requestingOrigin}`);
		callback(false);
	});
}
//#endregion
