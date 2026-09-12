//#region src/electron/ipc/parsers/parser-utils.ts
/**
* Утилиты для парсинга нод — base64, URI extraction, построение VpnNode.
*/
var URI_PATTERN = /(vless|vmess|trojan|ss|socks5?|https?|hy2|hysteria2|tuic|wireguard|wg):\/\/[^\s<>"'`]+/gi;
var SUBSCRIPTION_URL_PATTERN = /^https?:\/\/\S+$/i;
var CLASH_YAML_HINT_PATTERN = /(^|\n)\s*(proxies|proxy-groups|rules|rule-providers|tun|dns)\s*:/im;
function decodeBase64Safe(value) {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - normalized.length % 4);
	return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}
function extractKnownUris(payload) {
	const matches = payload.match(URI_PATTERN);
	return matches ? matches.map((item) => item.trim()) : [];
}
function isLikelyBase64Block(raw) {
	const value = raw.trim();
	if (value.length < 16) return false;
	return /^[A-Za-z0-9+/=_-]+$/.test(value);
}
function tryDecodeSubscriptionBlock(raw) {
	if (!isLikelyBase64Block(raw)) return [];
	try {
		return extractKnownUris(decodeBase64Safe(raw.trim()));
	} catch {
		return [];
	}
}
function toStringSafe(value) {
	return typeof value === "string" ? value : "";
}
function toNumberSafe(value, fallback) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return fallback;
}
function buildNode(protocol, name, server, port, uri, metadata) {
	const normalizedName = normalizeDisplayText(name);
	const displayMetadataKeys = /* @__PURE__ */ new Set([
		"city",
		"country",
		"countryName",
		"provider",
		"ps",
		"remark",
		"subscriptionName"
	]);
	const normalizedMetadata = Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, displayMetadataKeys.has(key) ? normalizeDisplayText(value) : value]));
	return {
		id: randomUUID(),
		name: normalizedName || `${protocol.toUpperCase()}-${server}:${port}`,
		protocol,
		server: server.trim(),
		port,
		uri,
		metadata: normalizedMetadata
	};
}
function buildUnsupportedEndpointIssue(name, server, port) {
	return `Сервис вернул заглушку «${name || "App not supported"}» (${server}:${port}). Этот формат/профиль не поддерживается провайдером для текущего клиента.`;
}
function isUnsupportedEndpoint(name, server, port) {
	const lowerName = name.toLowerCase();
	return server === "0.0.0.0" && port <= 1 || lowerName.includes("app not supported") || lowerName.includes("not supported");
}
function isLikelyUnsupportedPlaceholderText(payload) {
	const raw = payload.trim();
	if (!raw) return false;
	const lower = raw.toLowerCase();
	if (lower.includes("app not supported") && (lower.includes("0.0.0.0") || lower.includes("server:"))) return true;
	if ((lower.includes("включите поддержку hwid") || lower.includes("enable hwid")) && (lower.includes("0.0.0.0") || lower.includes("port: 1") || lower.includes(":1"))) return true;
	if (/@0\.0\.0\.0:1/i.test(raw)) return true;
	if (/server\s*:\s*["']?0\.0\.0\.0["']?[\s\S]{0,240}port\s*:\s*1/i.test(raw)) return true;
	if (isLikelyBase64Block(raw)) try {
		const decoded = decodeBase64Safe(raw);
		if (decoded.toLowerCase().includes("app not supported") || /@0\.0\.0\.0:1/i.test(decoded)) return true;
	} catch {}
	return false;
}
function isSubscriptionUrl(value) {
	return SUBSCRIPTION_URL_PATTERN.test(value.trim());
}
function buildNodeFingerprint(node) {
	const metadata = node?.metadata ?? {};
	const authKey = [metadata.id, metadata.uuid, metadata.username, metadata.password, metadata.private_key, metadata.peer_public_key].map((value) => value ?? "");
	const transportKey = [
		metadata.security ?? metadata.tls ?? "",
		metadata.type ?? metadata.net ?? "",
		metadata.sni ?? "",
		metadata.host ?? "",
		metadata.path ?? "",
		metadata.serviceName ?? "",
		metadata.flow ?? "",
		metadata.method ?? "",
		metadata.pbk ?? "",
		metadata.sid ?? "",
		metadata.mode ?? ""
	];
	return JSON.stringify([node.protocol, node.server, node.port, authKey, transportKey]);
}
function dedupeNodes(nodes) {
	const seen = /* @__PURE__ */ new Set();
	const unique = [];
	for (const node of nodes) {
		const key = buildNodeFingerprint(node);
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(node);
	}
	return unique;
}
function buildVlessUri(server, port, name, metadata) {
	const params = new URLSearchParams();
	if (metadata.security) params.set("security", metadata.security);
	if (metadata.type) params.set("type", metadata.type);
	if (metadata.mode) params.set("mode", metadata.mode);
	if (metadata.sni) params.set("sni", metadata.sni);
	if (metadata.pbk) params.set("pbk", metadata.pbk);
	if (metadata.sid) params.set("sid", metadata.sid);
	if (metadata.fp) params.set("fp", metadata.fp);
	if (metadata.flow) params.set("flow", metadata.flow);
	if (metadata.path) params.set("path", metadata.path);
	if (metadata.host) params.set("host", metadata.host);
	if (metadata.serviceName) params.set("serviceName", metadata.serviceName);
	if (metadata.alpn) params.set("alpn", metadata.alpn);
	if (metadata.spx) params.set("spx", metadata.spx);
	if (metadata.insecure) params.set("insecure", metadata.insecure);
	const query = params.toString();
	const encodedName = encodeURIComponent(name || `VLESS-${server}:${port}`);
	return `vless://${metadata.id ?? ""}@${server}:${port}${query ? `?${query}` : ""}#${encodedName}`;
}
function buildVmessUriFromMetadata(metadata) {
	return `vmess://${Buffer.from(JSON.stringify(metadata), "utf8").toString("base64")}`;
}
//#endregion
