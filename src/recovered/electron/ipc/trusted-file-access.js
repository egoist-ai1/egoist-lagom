//#region src/electron/ipc/trusted-file-access.ts
var TRUSTED_FILE_TTL_MS = 300 * 1e3;
var pickedFiles = /* @__PURE__ */ new Map();
function normalizeFilePath(filePath) {
	return path.resolve(filePath).toLowerCase();
}
function pruneExpired(now = Date.now()) {
	for (const [filePath, expiresAt] of pickedFiles) if (expiresAt <= now) pickedFiles.delete(filePath);
}
function rememberPickedFile(filePath) {
	pruneExpired();
	pickedFiles.set(normalizeFilePath(filePath), Date.now() + TRUSTED_FILE_TTL_MS);
}
function consumePickedFile(filePath) {
	const now = Date.now();
	pruneExpired(now);
	const normalized = normalizeFilePath(filePath);
	const expiresAt = pickedFiles.get(normalized);
	if (!expiresAt || expiresAt <= now) {
		pickedFiles.delete(normalized);
		return false;
	}
	pickedFiles.delete(normalized);
	return true;
}
//#endregion
