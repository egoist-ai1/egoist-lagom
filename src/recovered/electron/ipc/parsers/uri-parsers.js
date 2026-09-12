//#region src/electron/ipc/parsers/uri-parsers.ts
function parseEndpoint(endpoint, fallbackPort) {
	try {
		const url = new URL(`ss://${endpoint}`);
		const server = url.hostname;
		const port = Number(url.port || fallbackPort);
		if (!server || Number.isNaN(port) || port <= 0) return null;
		return {
			server,
			port
		};
	} catch {
		const lastColon = endpoint.lastIndexOf(":");
		if (lastColon <= 0) return null;
		const server = endpoint.slice(0, lastColon).replace(/^\[|\]$/g, "");
		const port = Number(endpoint.slice(lastColon + 1));
		if (!server || Number.isNaN(port) || port <= 0) return null;
		return {
			server,
			port
		};
	}
}
function splitShadowsocksPayload(raw) {
	const payload = raw.replace(/^ss:\/\//i, "");
	const hashIndex = payload.indexOf("#");
	const beforeHash = hashIndex >= 0 ? payload.slice(0, hashIndex) : payload;
	const name = hashIndex >= 0 ? decodeURIComponent(payload.slice(hashIndex + 1)) : "";
	const queryIndex = beforeHash.indexOf("?");
	const beforeQuery = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
	const query = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : "");
	let decodedHostPart = beforeQuery;
	if (beforeQuery.lastIndexOf("@") < 0) decodedHostPart = decodeBase64Safe(beforeQuery);
	const decodedAtIndex = decodedHostPart.lastIndexOf("@");
	if (decodedAtIndex < 0) return null;
	const encodedAuthPart = decodedHostPart.slice(0, decodedAtIndex);
	const endpointPart = decodedHostPart.slice(decodedAtIndex + 1);
	const authPart = encodedAuthPart.includes(":") ? decodeURIComponent(encodedAuthPart) : decodeBase64Safe(encodedAuthPart);
	if (!authPart || !endpointPart) return null;
	return {
		authPart,
		endpointPart,
		name,
		query
	};
}
/**
* Читает секрет из userinfo URI как единую строку.
*
* У Trojan и Hysteria2 весь userinfo — это один пароль/токен, который вполне
* может содержать `:`. `new URL()` в таком случае режет его на username и
* password, и `url.username` возвращал только часть до двоеточия — то есть
* пароль молча портился, а узел потом не подключался.
*/
function readUriSecret(url) {
	const user = decodeURIComponent(url.username || "");
	const pass = decodeURIComponent(url.password || "");
	return pass ? `${user}:${pass}` : user;
}
function parseVless(raw) {
	const url = new URL(raw);
	const server = url.hostname;
	const port = Number(url.port || "443");
	if (!server || Number.isNaN(port) || port <= 0) return null;
	const metadata = {};
	url.searchParams.forEach((value, key) => {
		metadata[key] = value;
	});
	metadata.id = decodeURIComponent(url.username);
	return buildNode("vless", decodeURIComponent(url.hash.replace(/^#/, "")), server, port, raw, metadata);
}
function parseTrojan(raw) {
	const url = new URL(raw);
	const server = url.hostname;
	const port = Number(url.port || "443");
	if (!server || Number.isNaN(port) || port <= 0) return null;
	const metadata = {};
	url.searchParams.forEach((value, key) => {
		metadata[key] = value;
	});
	const password = readUriSecret(url);
	if (!password) return null;
	metadata.password = password;
	return buildNode("trojan", decodeURIComponent(url.hash.replace(/^#/, "")), server, port, raw, metadata);
}
function parseShadowsocks(raw) {
	const parsed = splitShadowsocksPayload(raw);
	if (!parsed) return null;
	const authSeparatorIndex = parsed.authPart.indexOf(":");
	if (authSeparatorIndex <= 0) return null;
	const method = parsed.authPart.slice(0, authSeparatorIndex);
	const password = parsed.authPart.slice(authSeparatorIndex + 1);
	const endpoint = parseEndpoint(parsed.endpointPart, "8388");
	if (!method || !password || !endpoint) return null;
	const metadata = {
		method,
		password
	};
	parsed.query.forEach((value, key) => {
		metadata[key] = value;
	});
	return buildNode("shadowsocks", parsed.name, endpoint.server, endpoint.port, raw, metadata);
}
function parseVmess(raw) {
	const json = decodeBase64Safe(raw.replace(/^vmess:\/\//i, "").trim());
	const parsed = JSON.parse(json);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const obj = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (value === null || value === void 0) continue;
		if (typeof value === "object") continue;
		obj[key] = String(value);
	}
	const server = obj.add ?? "";
	const port = Number(obj.port ?? "443");
	if (!server || Number.isNaN(port) || port <= 0) return null;
	if (obj.tls === "true" || obj.tls === "1") obj.tls = "tls";
	return buildNode("vmess", obj.ps ?? "", server, port, raw, obj);
}
function parseSocksProxy(raw) {
	const url = new URL(raw);
	const protocol = url.protocol.toLowerCase();
	if (protocol !== "socks:" && protocol !== "socks5:") return null;
	const server = url.hostname;
	const port = Number(url.port || "1080");
	if (!server || Number.isNaN(port) || port <= 0) return null;
	const metadata = {};
	const username = decodeURIComponent(url.username || "");
	const password = decodeURIComponent(url.password || "");
	if (username) metadata.username = username;
	if (password) metadata.password = password;
	return buildNode("socks", decodeURIComponent(url.hash.replace(/^#/, "")), server, port, raw, metadata);
}
function parseHttpProxy(raw) {
	const url = new URL(raw);
	const protocol = url.protocol.toLowerCase();
	if (protocol !== "http:" && protocol !== "https:") return null;
	const hasAuth = Boolean(url.username || url.password);
	const hasExplicitPort = Boolean(url.port);
	const hasPathOrQuery = Boolean(url.pathname && url.pathname !== "/" || url.search || url.hash);
	if (!hasAuth && !hasExplicitPort) return null;
	const server = url.hostname;
	const defaultPort = protocol === "https:" ? 443 : 80;
	const port = Number(url.port || String(defaultPort));
	if (!server || Number.isNaN(port) || port <= 0) return null;
	if (!hasAuth && hasPathOrQuery) return null;
	const metadata = { tls: protocol === "https:" ? "true" : "false" };
	const username = decodeURIComponent(url.username || "");
	const password = decodeURIComponent(url.password || "");
	if (username) metadata.username = username;
	if (password) metadata.password = password;
	return buildNode("http", decodeURIComponent(url.hash.replace(/^#/, "")), server, port, raw, metadata);
}
function parseHysteria2(raw) {
	const normalizedRaw = raw.replace(/^hy2:\/\//i, "hysteria2://");
	const url = new URL(normalizedRaw);
	const server = url.hostname;
	const port = Number(url.port || "443");
	if (!server || Number.isNaN(port) || port <= 0) return null;
	const metadata = {};
	url.searchParams.forEach((value, key) => {
		metadata[key] = value;
	});
	const password = readUriSecret(url) || decodeURIComponent(metadata.password ?? "");
	if (!password) return null;
	metadata.password = password;
	return buildNode("hysteria2", decodeURIComponent(url.hash.replace(/^#/, "")), server, port, raw, metadata);
}
function parseTuic(raw) {
	const url = new URL(raw);
	const server = url.hostname;
	const port = Number(url.port || "443");
	if (!server || Number.isNaN(port) || port <= 0) return null;
	const metadata = {};
	url.searchParams.forEach((value, key) => {
		metadata[key] = value;
	});
	const uuid = decodeURIComponent(url.username || metadata.uuid || "");
	const password = decodeURIComponent(url.password || metadata.password || "");
	if (!uuid || !password) return null;
	metadata.uuid = uuid;
	metadata.password = password;
	return buildNode("tuic", decodeURIComponent(url.hash.replace(/^#/, "")), server, port, raw, metadata);
}
function parseWireGuard(raw) {
	const normalizedRaw = raw.replace(/^wg:\/\//i, "wireguard://");
	const url = new URL(normalizedRaw);
	const server = url.hostname;
	const port = Number(url.port || "51820");
	if (!server || Number.isNaN(port) || port <= 0) return null;
	const metadata = {};
	url.searchParams.forEach((value, key) => {
		metadata[key] = value;
	});
	const privateKey = decodeURIComponent(url.username || metadata.private_key || metadata.privateKey || "");
	const publicKey = metadata.peer_public_key ?? metadata.public_key ?? metadata.publicKey ?? metadata.publickey ?? "";
	if (!privateKey || !publicKey) return null;
	metadata.private_key = privateKey;
	metadata.peer_public_key = publicKey;
	return buildNode("wireguard", decodeURIComponent(url.hash.replace(/^#/, "")), server, port, raw, metadata);
}
function unsupportedProtocolIssue(raw) {
	if (raw.toLowerCase().startsWith("ssr://")) return "Получен протокол ShadowsocksR (SSR). Этот формат пока не поддерживается.";
	return null;
}
/** Роутер: определяет протокол по URI и вызывает соответствующий парсер */
function parseNodeUriDetailed(value) {
	const raw = value.trim();
	if (!raw) return {
		node: null,
		issue: null
	};
	try {
		let node = null;
		if (raw.startsWith("vless://")) node = parseVless(raw);
		else if (raw.startsWith("vmess://")) node = parseVmess(raw);
		else if (raw.startsWith("trojan://")) node = parseTrojan(raw);
		else if (raw.startsWith("ss://")) node = parseShadowsocks(raw);
		else if (raw.startsWith("socks://") || raw.startsWith("socks5://")) node = parseSocksProxy(raw);
		else if (raw.startsWith("http://") || raw.startsWith("https://")) node = parseHttpProxy(raw);
		else if (raw.startsWith("hy2://") || raw.startsWith("hysteria2://")) node = parseHysteria2(raw);
		else if (raw.startsWith("tuic://")) node = parseTuic(raw);
		else if (raw.startsWith("wireguard://") || raw.startsWith("wg://")) node = parseWireGuard(raw);
		else {
			const unsupported = unsupportedProtocolIssue(raw);
			if (unsupported) return {
				node: null,
				issue: unsupported
			};
		}
		if (!node) return {
			node: null,
			issue: null
		};
		if (isUnsupportedEndpoint(node.name, node.server, node.port)) return {
			node: null,
			issue: buildUnsupportedEndpointIssue(node.name, node.server, node.port)
		};
		return {
			node,
			issue: null
		};
	} catch {
		return {
			node: null,
			issue: `Ошибка разбора URI: ${raw.slice(0, 100)}`
		};
	}
}
//#endregion
