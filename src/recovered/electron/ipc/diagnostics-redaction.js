//#region src/electron/ipc/diagnostics-redaction.ts
var UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
var WINDOWS_USER_PATH_RE = /\b([A-Za-z]:\\Users\\)([^\\\s]+)(?=\\)/g;
var SECRET_ASSIGNMENT_RE = /\b(secret|token|password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|pre[_-]?shared[_-]?key|preshared[_-]?key)(\s*[:=]\s*)([^\s,"']+)/gi;
var AUTH_HEADER_RE = /\b(authorization|proxy-authorization)(\s*[:=]\s*)(bearer\s+|basic\s+)?([^\s,"']+)/gi;
var COOKIE_HEADER_RE = /\b(set-cookie|cookie)(\s*[:=]\s*)([^\r\n]+)/gi;
var PRIVATE_KEY_MARKER_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|-----END [A-Z ]*PRIVATE KEY-----/g;
var PRIVATE_KEY_BODY_LIMIT = 8e3;
var HWID_RE = /\b(X-HWID\s*[:=]\s*)([^\s,"']+)/gi;
var URL_WITH_QUERY_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;
function redactUrl(rawUrl) {
	try {
		const parsed = new URL(rawUrl);
		const hasCredentials = Boolean(parsed.username || parsed.password);
		const safeOrigin = `${parsed.protocol}//${hasCredentials ? "<credentials>@" : ""}${parsed.host}`;
		if (parsed.search || parsed.hash) return `${safeOrigin}${parsed.pathname ? "/..." : "/"}${parsed.search ? "?<redacted>" : ""}`;
		if (hasCredentials) return `${safeOrigin}${parsed.pathname || "/"}`;
		return rawUrl;
	} catch {
		return rawUrl;
	}
}
function redactPrivateKeyBlocks(value) {
	const begins = [];
	let firstEligibleBegin = 0;
	let output = "";
	let copiedUntil = 0;
	PRIVATE_KEY_MARKER_RE.lastIndex = 0;
	for (let marker = PRIVATE_KEY_MARKER_RE.exec(value); marker; marker = PRIVATE_KEY_MARKER_RE.exec(value)) {
		if (marker[0].startsWith("-----BEGIN ")) {
			begins.push({
				start: marker.index,
				bodyStart: PRIVATE_KEY_MARKER_RE.lastIndex
			});
			continue;
		}
		while (firstEligibleBegin < begins.length && marker.index - begins[firstEligibleBegin].bodyStart > PRIVATE_KEY_BODY_LIMIT) firstEligibleBegin += 1;
		if (firstEligibleBegin >= begins.length) continue;
		const begin = begins[firstEligibleBegin];
		if (begin.start >= copiedUntil) {
			output += `${value.slice(copiedUntil, begin.start)}<private-key>`;
			copiedUntil = PRIVATE_KEY_MARKER_RE.lastIndex;
		}
		begins.length = 0;
		firstEligibleBegin = 0;
	}
	PRIVATE_KEY_MARKER_RE.lastIndex = 0;
	return copiedUntil === 0 ? value : `${output}${value.slice(copiedUntil)}`;
}
function redactDiagnosticText(value) {
	return redactPrivateKeyBlocks(value).replace(URL_WITH_QUERY_RE, redactUrl).replace(AUTH_HEADER_RE, "$1$2$3<redacted>").replace(COOKIE_HEADER_RE, "$1$2<redacted>").replace(SECRET_ASSIGNMENT_RE, "$1$2<redacted>").replace(HWID_RE, "$1<redacted>").replace(UUID_RE, "<uuid>").replace(WINDOWS_USER_PATH_RE, "$1<user>");
}
function redactDiagnosticObject(value) {
	if (typeof value === "string") return redactDiagnosticText(value);
	if (Array.isArray(value)) return value.map((item) => redactDiagnosticObject(item));
	if (value && typeof value === "object") {
		const result = {};
		for (const [key, entry] of Object.entries(value)) if (/authorization|cookie|secret|token|password|passwd|hwid|private[_-]?key|pre[_-]?shared[_-]?key|uri|url/i.test(key)) result[key] = typeof entry === "string" && /^https?:\/\//i.test(entry) ? redactDiagnosticText(entry) : "<redacted>";
		else result[key] = redactDiagnosticObject(entry);
		return result;
	}
	return value;
}
//#endregion
