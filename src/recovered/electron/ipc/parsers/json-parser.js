//#region src/electron/ipc/parsers/json-parser.ts
function readXrayTransportOptions(streamSettings, metadata, networkKey = "type") {
	const network = toStringSafe(streamSettings.network).trim() || "tcp";
	metadata[networkKey] = network;
	const options = network === "ws" ? streamSettings.wsSettings : network === "grpc" ? streamSettings.grpcSettings : network === "xhttp" || network === "splithttp" ? streamSettings.xhttpSettings ?? streamSettings.splithttpSettings : null;
	if (!options || typeof options !== "object") return;
	if (network === "grpc") {
		const serviceName = toStringSafe(options.serviceName);
		if (serviceName) metadata.serviceName = serviceName;
		return;
	}
	const path = toStringSafe(options.path);
	if (path) metadata.path = path;
	const headers = options.headers && typeof options.headers === "object" ? options.headers : {};
	const host = toStringSafe(options.host) || toStringSafe(headers.Host) || toStringSafe(headers.host);
	if (host) metadata.host = host;
	if (network === "xhttp" || network === "splithttp") {
		const mode = toStringSafe(options.mode);
		if (mode) metadata.mode = mode;
	}
}
function parseXrayOutbound(outbound, index) {
	const protocol = toStringSafe(outbound.protocol).trim().toLowerCase();
	const name = toStringSafe(outbound.tag).trim() || `Xray outbound #${index + 1}`;
	if (!protocol) return {
		node: null,
		issue: null
	};
	if ([
		"freedom",
		"blackhole",
		"dns",
		"direct",
		"block"
	].includes(protocol)) return {
		node: null,
		issue: null
	};
	const settings = outbound.settings && typeof outbound.settings === "object" ? outbound.settings : {};
	const streamSettings = outbound.streamSettings && typeof outbound.streamSettings === "object" ? outbound.streamSettings : {};
	if (protocol === "vless") {
		const vnext = Array.isArray(settings.vnext) ? settings.vnext[0] : null;
		if (!vnext || typeof vnext !== "object") return {
			node: null,
			issue: `Xray outbound ${name}: отсутствует settings.vnext.`
		};
		const record = vnext;
		const server = toStringSafe(record.address).trim();
		const port = toNumberSafe(record.port, NaN);
		const user = Array.isArray(record.users) ? record.users[0] : null;
		const userData = user && typeof user === "object" ? user : {};
		const id = toStringSafe(userData.id).trim();
		if (!server || Number.isNaN(port) || port <= 0 || !id) return {
			node: null,
			issue: `Xray outbound ${name}: некорректный VLESS endpoint.`
		};
		const metadata = {
			id,
			type: toStringSafe(streamSettings.network).trim() || "tcp",
			security: toStringSafe(streamSettings.security).trim() || "none"
		};
		const flow = toStringSafe(userData.flow).trim();
		if (flow) metadata.flow = flow;
		const tlsSettings = streamSettings.tlsSettings && typeof streamSettings.tlsSettings === "object" ? streamSettings.tlsSettings : {};
		const realitySettings = streamSettings.realitySettings && typeof streamSettings.realitySettings === "object" ? streamSettings.realitySettings : {};
		const sni = toStringSafe(tlsSettings.serverName).trim() || toStringSafe(realitySettings.serverName).trim();
		if (sni) metadata.sni = sni;
		const fp = toStringSafe(tlsSettings.fingerprint).trim() || toStringSafe(realitySettings.fingerprint).trim();
		if (fp) metadata.fp = fp;
		const pbk = toStringSafe(realitySettings.publicKey).trim();
		const sid = toStringSafe(realitySettings.shortId).trim();
		if (pbk) metadata.pbk = pbk;
		if (sid) metadata.sid = sid;
		readXrayTransportOptions(streamSettings, metadata);
		const alpn = joinStringList(tlsSettings.alpn);
		if (alpn) metadata.alpn = alpn;
		if (tlsSettings.allowInsecure === true) metadata.insecure = "true";
		const spiderX = toStringSafe(realitySettings.spiderX).trim();
		if (spiderX) metadata.spx = spiderX;
		return {
			node: buildNode("vless", name, server, port, buildVlessUri(server, port, name, metadata), metadata),
			issue: null
		};
	}
	if (protocol === "vmess") {
		const vnext = Array.isArray(settings.vnext) ? settings.vnext[0] : null;
		if (!vnext || typeof vnext !== "object") return {
			node: null,
			issue: `Xray outbound ${name}: отсутствует settings.vnext.`
		};
		const record = vnext;
		const server = toStringSafe(record.address).trim();
		const port = toNumberSafe(record.port, NaN);
		const user = Array.isArray(record.users) ? record.users[0] : null;
		const userData = user && typeof user === "object" ? user : {};
		const id = toStringSafe(userData.id).trim();
		if (!server || Number.isNaN(port) || port <= 0 || !id) return {
			node: null,
			issue: `Xray outbound ${name}: некорректный VMESS endpoint.`
		};
		const metadata = {
			v: "2",
			ps: name,
			add: server,
			port: String(port),
			id,
			aid: String(toNumberSafe(userData.alterId, 0)),
			net: toStringSafe(streamSettings.network).trim() || "tcp",
			scy: toStringSafe(userData.security).trim() || "auto"
		};
		if (toStringSafe(streamSettings.security).trim() === "tls") metadata.tls = "tls";
		readXrayTransportOptions(streamSettings, metadata, "net");
		const sni = toStringSafe((streamSettings.tlsSettings && typeof streamSettings.tlsSettings === "object" ? streamSettings.tlsSettings : {}).serverName).trim();
		if (sni) metadata.sni = sni;
		return {
			node: buildNode("vmess", name, server, port, buildVmessUriFromMetadata(metadata), metadata),
			issue: null
		};
	}
	if (protocol === "trojan") {
		const servers = Array.isArray(settings.servers) ? settings.servers[0] : null;
		if (!servers || typeof servers !== "object") return {
			node: null,
			issue: `Xray outbound ${name}: отсутствует settings.servers.`
		};
		const record = servers;
		const server = toStringSafe(record.address).trim();
		const port = toNumberSafe(record.port, NaN);
		const password = toStringSafe(record.password).trim();
		if (!server || Number.isNaN(port) || port <= 0 || !password) return {
			node: null,
			issue: `Xray outbound ${name}: некорректный Trojan endpoint.`
		};
		const metadata = { password };
		const sni = toStringSafe((streamSettings.tlsSettings && typeof streamSettings.tlsSettings === "object" ? streamSettings.tlsSettings : {}).serverName).trim();
		if (sni) metadata.sni = sni;
		readXrayTransportOptions(streamSettings, metadata);
		const params = new URLSearchParams();
		if (metadata.sni) params.set("sni", metadata.sni);
		if (metadata.type) params.set("type", metadata.type);
		for (const key of ["path", "host", "serviceName", "mode"]) if (metadata[key]) params.set(key, metadata[key]);
		return {
			node: buildNode("trojan", name, server, port, `trojan://${encodeURIComponent(password)}@${server}:${port}${params.size > 0 ? `?${params.toString()}` : ""}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
	}
	if (protocol === "shadowsocks") {
		const servers = Array.isArray(settings.servers) ? settings.servers[0] : null;
		if (!servers || typeof servers !== "object") return {
			node: null,
			issue: `Xray outbound ${name}: отсутствует settings.servers.`
		};
		const record = servers;
		const server = toStringSafe(record.address).trim();
		const port = toNumberSafe(record.port, NaN);
		const method = toStringSafe(record.method).trim();
		const password = toStringSafe(record.password).trim();
		if (!server || Number.isNaN(port) || port <= 0 || !method || !password) return {
			node: null,
			issue: `Xray outbound ${name}: некорректный Shadowsocks endpoint.`
		};
		const plain = `${method}:${password}@${server}:${port}`;
		return {
			node: buildNode("shadowsocks", name, server, port, `ss://${Buffer.from(plain, "utf8").toString("base64")}#${encodeURIComponent(name)}`, {
				method,
				password
			}),
			issue: null
		};
	}
	if (protocol === "socks" || protocol === "http") {
		const servers = Array.isArray(settings.servers) ? settings.servers[0] : null;
		if (!servers || typeof servers !== "object") return {
			node: null,
			issue: `Xray outbound ${name}: отсутствует settings.servers.`
		};
		const record = servers;
		const server = toStringSafe(record.address).trim();
		const port = toNumberSafe(record.port, NaN);
		if (!server || Number.isNaN(port) || port <= 0) return {
			node: null,
			issue: `Xray outbound ${name}: некорректный ${protocol.toUpperCase()} endpoint.`
		};
		const user = Array.isArray(record.users) ? record.users[0] : null;
		const userData = user && typeof user === "object" ? user : {};
		const username = toStringSafe(userData.user).trim();
		const pass = toStringSafe(userData.pass).trim();
		const metadata = {};
		if (username) metadata.username = username;
		if (pass) metadata.password = pass;
		if (protocol === "http" && streamSettings.security === "tls") {
			metadata.tls = "true";
			const sni = toStringSafe(streamSettings.tlsSettings?.serverName).trim();
			if (sni) metadata.sni = sni;
		}
		if (protocol === "http") return {
			node: buildNode("http", name, server, port, `${metadata.tls === "true" ? "https" : "http"}://${username ? `${encodeURIComponent(username)}${pass ? `:${encodeURIComponent(pass)}` : ""}@` : ""}${server}:${port}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
		return {
			node: buildNode("socks", name, server, port, `socks://${username ? `${encodeURIComponent(username)}${pass ? `:${encodeURIComponent(pass)}` : ""}@` : ""}${server}:${port}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
	}
	return {
		node: null,
		issue: `Xray outbound ${name}: неподдерживаемый protocol ${protocol}.`
	};
}
function firstStringOf(value) {
	if (Array.isArray(value)) return toStringSafe(value[0]).trim();
	return toStringSafe(value).trim();
}
function joinStringList(value) {
	if (!Array.isArray(value)) return toStringSafe(value).trim();
	return value.map((item) => toStringSafe(item).trim()).filter(Boolean).join(",");
}
/**
* Читает блок tls sing-box outbound.
*
* Раньше отсюда брался только server_name. Всё остальное — reality
* (public_key/short_id), utls fingerprint, insecure и alpn — терялось. Для
* REALITY это фатально: узел импортировался «успешно», но без publicKey и
* shortId рукопожатие невозможно, и провал выглядел как проблема сервера.
*/
function readSingBoxTlsOptions(outbound, metadata) {
	const tls = outbound.tls && typeof outbound.tls === "object" ? outbound.tls : null;
	if (!tls) return;
	if (tls.enabled === true) metadata.security = "tls";
	const sni = toStringSafe(tls.server_name).trim();
	if (sni) metadata.sni = sni;
	if (tls.insecure === true) metadata.insecure = "true";
	const alpn = joinStringList(tls.alpn);
	if (alpn) metadata.alpn = alpn;
	const utls = tls.utls && typeof tls.utls === "object" ? tls.utls : null;
	const fingerprint = utls ? toStringSafe(utls.fingerprint).trim() : "";
	if (fingerprint) metadata.fp = fingerprint;
	const reality = tls.reality && typeof tls.reality === "object" ? tls.reality : null;
	if (reality && reality.enabled !== false) {
		metadata.security = "reality";
		const publicKey = toStringSafe(reality.public_key).trim();
		const shortId = toStringSafe(reality.short_id).trim();
		if (publicKey) metadata.pbk = publicKey;
		if (shortId) metadata.sid = shortId;
	}
}
/** Транспорт sing-box (ws/grpc/http) раньше не читался вовсе — path/Host/serviceName терялись. */
function readSingBoxTransportOptions(outbound, metadata, networkKey) {
	const transport = outbound.transport && typeof outbound.transport === "object" ? outbound.transport : null;
	if (!transport) return;
	const transportType = toStringSafe(transport.type).trim().toLowerCase();
	const headers = transport.headers && typeof transport.headers === "object" ? transport.headers : {};
	if (transportType === "ws") {
		metadata[networkKey] = "ws";
		const path = toStringSafe(transport.path).trim();
		if (path) metadata.path = path;
		const host = firstStringOf(headers.Host) || firstStringOf(headers.host);
		if (host) metadata.host = host;
		return;
	}
	if (transportType === "grpc") {
		metadata[networkKey] = "grpc";
		const serviceName = toStringSafe(transport.service_name).trim();
		if (serviceName) metadata.serviceName = serviceName;
		return;
	}
	if (transportType === "http") {
		metadata[networkKey] = "h2";
		const path = toStringSafe(transport.path).trim();
		if (path) metadata.path = path;
		const host = firstStringOf(transport.host);
		if (host) metadata.host = host;
	}
}
function parseSingBoxOutbound(outbound, index) {
	const type = toStringSafe(outbound.type).trim().toLowerCase();
	const name = toStringSafe(outbound.tag).trim() || `sing-box outbound #${index + 1}`;
	if (!type) return {
		node: null,
		issue: null
	};
	if ([
		"direct",
		"block",
		"dns",
		"selector",
		"urltest"
	].includes(type)) return {
		node: null,
		issue: null
	};
	const server = toStringSafe(outbound.server).trim();
	const port = toNumberSafe(outbound.server_port, NaN);
	if (type === "vless") {
		const uuid = toStringSafe(outbound.uuid).trim();
		if (!server || Number.isNaN(port) || port <= 0 || !uuid) return {
			node: null,
			issue: `sing-box outbound ${name}: некорректный VLESS endpoint.`
		};
		const metadata = {
			id: uuid,
			security: "none",
			type: toStringSafe(outbound.network).trim() || "tcp"
		};
		readSingBoxTlsOptions(outbound, metadata);
		readSingBoxTransportOptions(outbound, metadata, "type");
		const flow = toStringSafe(outbound.flow).trim();
		if (flow) metadata.flow = flow;
		return {
			node: buildNode("vless", name, server, port, buildVlessUri(server, port, name, metadata), metadata),
			issue: null
		};
	}
	if (type === "vmess") {
		const uuid = toStringSafe(outbound.uuid).trim();
		if (!server || Number.isNaN(port) || port <= 0 || !uuid) return {
			node: null,
			issue: `sing-box outbound ${name}: некорректный VMESS endpoint.`
		};
		const metadata = {
			v: "2",
			ps: name,
			add: server,
			port: String(port),
			id: uuid,
			aid: "0",
			net: toStringSafe(outbound.network).trim() || "tcp",
			scy: toStringSafe(outbound.security).trim() || "auto"
		};
		metadata.aid = String(toNumberSafe(outbound.alter_id, 0));
		readSingBoxTlsOptions(outbound, metadata);
		readSingBoxTransportOptions(outbound, metadata, "net");
		if (metadata.security === "tls" || metadata.security === "reality") metadata.tls = "tls";
		return {
			node: buildNode("vmess", name, server, port, buildVmessUriFromMetadata(metadata), metadata),
			issue: null
		};
	}
	if (type === "trojan") {
		const password = toStringSafe(outbound.password).trim();
		if (!server || Number.isNaN(port) || port <= 0 || !password) return {
			node: null,
			issue: `sing-box outbound ${name}: некорректный Trojan endpoint.`
		};
		const metadata = { password };
		readSingBoxTlsOptions(outbound, metadata);
		readSingBoxTransportOptions(outbound, metadata, "type");
		const params = new URLSearchParams();
		if (metadata.sni) params.set("sni", metadata.sni);
		if (metadata.type) params.set("type", metadata.type);
		if (metadata.path) params.set("path", metadata.path);
		if (metadata.host) params.set("host", metadata.host);
		if (metadata.serviceName) params.set("serviceName", metadata.serviceName);
		return {
			node: buildNode("trojan", name, server, port, `trojan://${encodeURIComponent(password)}@${server}:${port}${params.size > 0 ? `?${params.toString()}` : ""}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
	}
	if (type === "shadowsocks") {
		const method = toStringSafe(outbound.method).trim();
		const password = toStringSafe(outbound.password).trim();
		if (!server || Number.isNaN(port) || port <= 0 || !method || !password) return {
			node: null,
			issue: `sing-box outbound ${name}: некорректный Shadowsocks endpoint.`
		};
		const plain = `${method}:${password}@${server}:${port}`;
		return {
			node: buildNode("shadowsocks", name, server, port, `ss://${Buffer.from(plain, "utf8").toString("base64")}#${encodeURIComponent(name)}`, {
				method,
				password
			}),
			issue: null
		};
	}
	if (type === "socks" || type === "http") {
		if (!server || Number.isNaN(port) || port <= 0) return {
			node: null,
			issue: `sing-box outbound ${name}: некорректный ${type.toUpperCase()} endpoint.`
		};
		const username = toStringSafe(outbound.username).trim();
		const password = toStringSafe(outbound.password).trim();
		const metadata = {};
		if (username) metadata.username = username;
		if (password) metadata.password = password;
		if (type === "http") {
			readSingBoxTlsOptions(outbound, metadata);
			if (metadata.security === "tls") metadata.tls = "true";
		}
		const auth = username ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ""}@` : "";
		if (type === "http") return {
			node: buildNode("http", name, server, port, `${metadata.tls === "true" ? "https" : "http"}://${auth}${server}:${port}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
		return {
			node: buildNode("socks", name, server, port, `socks://${auth}${server}:${port}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
	}
	if (type === "hysteria2") {
		const password = toStringSafe(outbound.password).trim();
		if (!server || Number.isNaN(port) || port <= 0 || !password) return {
			node: null,
			issue: `sing-box outbound ${name}: некорректный Hysteria2 endpoint.`
		};
		const metadata = { password };
		const sni = toStringSafe((outbound.tls && typeof outbound.tls === "object" ? outbound.tls : {}).server_name).trim();
		if (sni) metadata.sni = sni;
		return {
			node: buildNode("hysteria2", name, server, port, `hysteria2://${encodeURIComponent(password)}@${server}:${port}${metadata.sni ? `?sni=${encodeURIComponent(metadata.sni)}` : ""}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
	}
	if (type === "tuic") {
		const uuid = toStringSafe(outbound.uuid).trim();
		const password = toStringSafe(outbound.password).trim();
		if (!server || Number.isNaN(port) || port <= 0 || !uuid || !password) return {
			node: null,
			issue: `sing-box outbound ${name}: некорректный TUIC endpoint.`
		};
		const metadata = {
			uuid,
			password
		};
		const sni = toStringSafe((outbound.tls && typeof outbound.tls === "object" ? outbound.tls : {}).server_name).trim();
		if (sni) metadata.sni = sni;
		const params = new URLSearchParams();
		if (metadata.sni) params.set("sni", metadata.sni);
		return {
			node: buildNode("tuic", name, server, port, `tuic://${encodeURIComponent(uuid)}:${encodeURIComponent(password)}@${server}:${port}${params.size > 0 ? `?${params.toString()}` : ""}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
	}
	if (type === "wireguard") {
		const privateKey = toStringSafe(outbound.private_key).trim();
		const publicKey = toStringSafe(outbound.peer_public_key).trim();
		if (!server || Number.isNaN(port) || port <= 0 || !privateKey || !publicKey) return {
			node: null,
			issue: `sing-box outbound ${name}: некорректный WireGuard endpoint.`
		};
		const metadata = {
			private_key: privateKey,
			peer_public_key: publicKey
		};
		const params = new URLSearchParams();
		params.set("publickey", publicKey);
		const addressValue = toStringSafe(Array.isArray(outbound.local_address) ? outbound.local_address[0] : null).trim();
		if (addressValue) {
			metadata.local_address = addressValue;
			params.set("address", addressValue);
		}
		return {
			node: buildNode("wireguard", name, server, port, `wireguard://${encodeURIComponent(privateKey)}@${server}:${port}?${params.toString()}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
	}
	return {
		node: null,
		issue: `sing-box outbound ${name}: неподдерживаемый type ${type}.`
	};
}
function parseNodesFromJson(payload) {
	const trimmed = payload.trim();
	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return {
		matched: false,
		nodes: [],
		issues: []
	};
	let parsed;
	try {
		parsed = JSON.parse(trimmed);
	} catch (error) {
		return {
			matched: true,
			nodes: [],
			issues: [`Ошибка чтения JSON-конфига: ${String(error)}`]
		};
	}
	const nodes = [];
	const issues = [];
	const collectFromObject = (obj) => {
		if (Array.isArray(obj.proxies)) for (const entry of obj.proxies) {
			if (!entry || typeof entry !== "object") {
				issues.push("JSON proxies содержит некорректную запись.");
				continue;
			}
			const { node, issue } = parseClashProxy(entry);
			if (node) nodes.push(node);
			if (issue) issues.push(issue);
		}
		if (Array.isArray(obj.outbounds)) for (let i = 0; i < obj.outbounds.length; i += 1) {
			const outbound = obj.outbounds[i];
			if (!outbound || typeof outbound !== "object") {
				issues.push(`JSON outbounds[${i}] имеет некорректный формат.`);
				continue;
			}
			const asRecord = outbound;
			const parsedOutbound = Boolean(toStringSafe(asRecord.protocol).trim()) ? parseXrayOutbound(asRecord, i) : parseSingBoxOutbound(asRecord, i);
			if (parsedOutbound.node) nodes.push(parsedOutbound.node);
			if (parsedOutbound.issue) issues.push(parsedOutbound.issue);
		}
	};
	if (Array.isArray(parsed)) for (let i = 0; i < parsed.length; i += 1) {
		const entry = parsed[i];
		if (typeof entry === "string") {
			const detailed = parseNodeUriDetailed(entry);
			if (detailed.node) nodes.push(detailed.node);
			if (detailed.issue) issues.push(detailed.issue);
			continue;
		}
		if (entry && typeof entry === "object") collectFromObject(entry);
	}
	else if (parsed && typeof parsed === "object") collectFromObject(parsed);
	if (nodes.length === 0 && issues.length === 0) issues.push("JSON распознан, но поддерживаемых узлов не найдено.");
	return {
		matched: true,
		nodes,
		issues
	};
}
//#endregion
