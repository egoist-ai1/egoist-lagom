//#region src/electron/ipc/diagnostics-redaction.ts
var UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
var WINDOWS_USER_PATH_RE = /\b([A-Za-z]:\\Users\\)([^\\\s]+)(?=\\)/g;
var SECRET_ASSIGNMENT_RE = /\b(secret|token|password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|pre[_-]?shared[_-]?key|preshared[_-]?key|authorization|proxy[_-]?authorization)(["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;"']+)/gi;
var AUTH_HEADER_RE = /\b(authorization|proxy-authorization)(\s*[:=]\s*)(bearer\s+|basic\s+)?([^\s,"']+)/gi;
var COOKIE_HEADER_RE = /\b(set-cookie|cookie)(\s*[:=]\s*)([^\r\n]+)/gi;
var PRIVATE_KEY_MARKER_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|-----END [A-Z ]*PRIVATE KEY-----/g;
var HWID_RE = /\b(X-HWID\s*[:=]\s*)([^\s,"']+)/gi;
var URL_WITH_QUERY_RE = /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s"'<>]+/gi;
var CONNECTION_URI_RE = /\b(?:vless|vmess|trojan|ss|ssr|tuic|hysteria2?|hy2|wireguard):\/\/[^\s"'<>]+/gi;
function diagnosticCorrelationId(value) {
	if (typeof value !== "string" || !value) return "none";
	return typeof createHash === "function" ? "id-" + createHash("sha256").update(value).digest("hex").slice(0, 24) : "<id-unavailable>";
}
function redactUrl(rawUrl) {
	try {
		const parsed = new URL(rawUrl);
		if (!/^(?:https?|tls|quic|tcp|udp|socks4a?|socks5h?):$/.test(parsed.protocol)) return "<connection-uri>";
		const hasCredentials = Boolean(parsed.username || parsed.password);
		const safeOrigin = `${parsed.protocol}//${hasCredentials ? "<credentials>@" : ""}${parsed.host}`;
		const safePath = ["", "/", "/dns-query"].includes(parsed.pathname) ? parsed.pathname : "/<redacted-path>";
		return `${safeOrigin}${safePath}${parsed.search ? "?<redacted>" : ""}${parsed.hash ? "#<redacted>" : ""}`;
	} catch {
		return "<invalid-url>";
	}
}
function redactPrivateKeyBlocks(value) {
	let begin = null;
	let output = "";
	let copiedUntil = 0;
	PRIVATE_KEY_MARKER_RE.lastIndex = 0;
	for (let marker = PRIVATE_KEY_MARKER_RE.exec(value); marker; marker = PRIVATE_KEY_MARKER_RE.exec(value)) {
		if (marker[0].startsWith("-----BEGIN ")) {
			if (begin === null) begin = marker.index;
			continue;
		}
		if (begin === null) {
			// A bounded tail can start inside an older PEM block. Conceal its prefix.
			output += "<private-key>";
			copiedUntil = PRIVATE_KEY_MARKER_RE.lastIndex;
			continue;
		}
		output += `${value.slice(copiedUntil, begin)}<private-key>`;
		copiedUntil = PRIVATE_KEY_MARKER_RE.lastIndex;
		begin = null;
	}
	PRIVATE_KEY_MARKER_RE.lastIndex = 0;
	if (begin !== null) return `${output}${value.slice(copiedUntil, begin)}<private-key>`;
	return copiedUntil === 0 ? value : `${output}${value.slice(copiedUntil)}`;
}
function redactDiagnosticText(value) {
	return redactPrivateKeyBlocks(String(value)).replace(/\\+\//g, "/").replace(CONNECTION_URI_RE, "<connection-uri>").replace(URL_WITH_QUERY_RE, redactUrl).replace(AUTH_HEADER_RE, "$1$2$3<redacted>").replace(COOKIE_HEADER_RE, "$1$2<redacted>").replace(SECRET_ASSIGNMENT_RE, (_match, key, separator, secret) => {
		const quote = secret[0] === '"' || secret[0] === "'" ? secret[0] : "";
		return `${key}${separator}${quote}<redacted>${quote}`;
	}).replace(HWID_RE, "$1<redacted>").replace(UUID_RE, diagnosticCorrelationId).replace(WINDOWS_USER_PATH_RE, "$1<user>");
}
function isDiagnosticSecretKey(key) {
	return /authorization|cookie|secret|token|password|passwd|hwid|api[_-]?key|private[_-]?key|pre[_-]?shared[_-]?key|commandline|rawpayload/i.test(key);
}
function isDiagnosticUrlKey(key) {
	return /(?:url|uri)s?$/i.test(key) || /^(?:url|uri)[_-]/i.test(key);
}
function redactDiagnosticObject(value, depth = 0, ancestors = new WeakSet()) {
	if (typeof value === "string") return redactDiagnosticText(value).slice(0, 16384);
	if (value && typeof value === "object") {
		if (depth >= 8) return "<depth-limit>";
		if (ancestors.has(value)) return "<circular>";
		ancestors.add(value);
		try {
		if (Array.isArray(value)) return value.slice(0, 128).map((item) => redactDiagnosticObject(item, depth + 1, ancestors));
		if (value instanceof Error) return { name: redactDiagnosticText(value.name), message: redactDiagnosticText(value.message).slice(0, 16384), code: redactDiagnosticObject(value.code ?? null, depth + 1, ancestors),
			stack: redactDiagnosticText(value.stack ?? "").slice(0, 16384), cause: redactDiagnosticObject(value.cause, depth + 1, ancestors) };
		const result = {};
		for (const [key, entry] of Object.entries(value).slice(0, 128)) {
			if (isDiagnosticSecretKey(key)) result[key] = "<redacted>";
			else if (isDiagnosticUrlKey(key)) result[key] = typeof entry === "string" && /^[a-z][a-z0-9+.-]*:\/\//i.test(entry) ? redactDiagnosticText(entry) : "<redacted>";
			else result[key] = redactDiagnosticObject(entry, depth + 1, ancestors);
		}
		return result;
		} finally { ancestors.delete(value); }
	}
	return value;
}
//#endregion
