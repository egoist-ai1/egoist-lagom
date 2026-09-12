//#region src/electron/ipc/parsers/clash-parser.ts
/**
* Парсер Clash YAML подписок и Clash-формата прокси.
*/
/**
* Переносит transport-опции Clash в metadata.
*
* Раньше `ws-opts` читались только для VLESS, а `grpc-opts`/`h2-opts` — вообще
* никогда. Из-за этого vmess+ws (самая массовая связка) терял path и Host, а
* любой grpc-профиль приходил с пустым serviceName: конфиг собирался, рантайм
* стартовал, но узел не работал — и выглядело это как «сервер не отвечает».
*/
function readClashTransportOptions(proxy, metadata) {
	if (proxy["ws-opts"] && typeof proxy["ws-opts"] === "object") {
		const ws = proxy["ws-opts"];
		const path = toStringSafe(ws.path).trim();
		if (path) metadata.path = path;
		if (ws.headers && typeof ws.headers === "object") {
			const headers = ws.headers;
			const host = toStringSafe(headers.Host).trim() || toStringSafe(headers.host).trim();
			if (host) metadata.host = host;
		}
	}
	if (proxy["grpc-opts"] && typeof proxy["grpc-opts"] === "object") {
		const grpc = proxy["grpc-opts"];
		const serviceName = toStringSafe(grpc["grpc-service-name"]).trim() || toStringSafe(grpc.serviceName).trim();
		if (serviceName) metadata.serviceName = serviceName;
	}
	if (proxy["h2-opts"] && typeof proxy["h2-opts"] === "object") {
		const h2 = proxy["h2-opts"];
		const path = toStringSafe(h2.path).trim();
		if (path) metadata.path = path;
		const host = toStringSafe((Array.isArray(h2.host) ? h2.host : [])[0]).trim();
		if (host) metadata.host = host;
	}
}
/** ALPN и skip-cert-verify раньше отбрасывались для всех TLS-протоколов, кроме hy2/tuic. */
function readClashTlsOptions(proxy, metadata) {
	const alpn = Array.isArray(proxy.alpn) ? proxy.alpn.map((item) => toStringSafe(item).trim()).filter(Boolean).join(",") : toStringSafe(proxy.alpn).trim();
	if (alpn) metadata.alpn = alpn;
	if (proxy["skip-cert-verify"] === true || proxy.insecure === true) metadata.insecure = "true";
}
function parseClashProxy(proxy) {
	const rawType = toStringSafe(proxy.type).trim().toLowerCase();
	const name = toStringSafe(proxy.name).trim() || "Без имени";
	const server = toStringSafe(proxy.server).trim();
	const port = toNumberSafe(proxy.port, NaN);
	if (!rawType) return {
		node: null,
		issue: `Запись прокси без поля type (${name}).`
	};
	if (!server || Number.isNaN(port) || port <= 0) return {
		node: null,
		issue: `Прокси ${name}: некорректный server/port.`
	};
	if (isUnsupportedEndpoint(name, server, port)) return {
		node: null,
		issue: buildUnsupportedEndpointIssue(name, server, port)
	};
	if (rawType === "vless") {
		const uuid = toStringSafe(proxy.uuid).trim();
		if (!uuid) return {
			node: null,
			issue: `Прокси ${name}: для VLESS отсутствует uuid.`
		};
		const metadata = {
			id: uuid,
			type: toStringSafe(proxy.network).trim() || "tcp"
		};
		const tls = proxy.tls === true;
		const sni = toStringSafe(proxy.servername).trim() || toStringSafe(proxy.sni).trim();
		if (tls) metadata.security = "tls";
		else metadata.security = "none";
		if (sni) metadata.sni = sni;
		const fp = toStringSafe(proxy["client-fingerprint"]).trim();
		if (fp) metadata.fp = fp;
		const flow = toStringSafe(proxy.flow).trim();
		if (flow) metadata.flow = flow;
		if (proxy["reality-opts"] && typeof proxy["reality-opts"] === "object") {
			const reality = proxy["reality-opts"];
			const pbk = toStringSafe(reality["public-key"]).trim();
			const sid = toStringSafe(reality["short-id"]).trim();
			metadata.security = "reality";
			if (pbk) metadata.pbk = pbk;
			if (sid) metadata.sid = sid;
		}
		readClashTransportOptions(proxy, metadata);
		readClashTlsOptions(proxy, metadata);
		return {
			node: buildNode("vless", name, server, port, buildVlessUri(server, port, name, metadata), metadata),
			issue: null
		};
	}
	if (rawType === "vmess") {
		const uuid = toStringSafe(proxy.uuid).trim();
		if (!uuid) return {
			node: null,
			issue: `Прокси ${name}: для VMESS отсутствует uuid.`
		};
		const metadata = {
			v: "2",
			ps: name,
			add: server,
			port: String(port),
			id: uuid,
			aid: String(toNumberSafe(proxy.alterId, 0)),
			net: toStringSafe(proxy.network).trim() || "tcp",
			scy: toStringSafe(proxy.cipher).trim() || "auto"
		};
		if (proxy.tls === true) metadata.tls = "tls";
		const sni = toStringSafe(proxy.servername).trim() || toStringSafe(proxy.sni).trim();
		if (sni) metadata.sni = sni;
		readClashTransportOptions(proxy, metadata);
		readClashTlsOptions(proxy, metadata);
		return {
			node: buildNode("vmess", name, server, port, `vmess://${Buffer.from(JSON.stringify(metadata), "utf8").toString("base64")}`, metadata),
			issue: null
		};
	}
	if (rawType === "trojan") {
		const password = toStringSafe(proxy.password).trim();
		if (!password) return {
			node: null,
			issue: `Прокси ${name}: для Trojan отсутствует password.`
		};
		const metadata = { password };
		const sni = toStringSafe(proxy.servername).trim() || toStringSafe(proxy.sni).trim();
		if (sni) metadata.sni = sni;
		const network = toStringSafe(proxy.network).trim();
		if (network) metadata.type = network;
		readClashTransportOptions(proxy, metadata);
		readClashTlsOptions(proxy, metadata);
		const params = new URLSearchParams();
		if (metadata.sni) params.set("sni", metadata.sni);
		if (metadata.type) params.set("type", metadata.type);
		if (metadata.path) params.set("path", metadata.path);
		if (metadata.host) params.set("host", metadata.host);
		if (metadata.serviceName) params.set("serviceName", metadata.serviceName);
		if (metadata.alpn) params.set("alpn", metadata.alpn);
		if (metadata.insecure) params.set("insecure", metadata.insecure);
		const encodedName = encodeURIComponent(name);
		return {
			node: buildNode("trojan", name, server, port, `trojan://${encodeURIComponent(password)}@${server}:${port}${params.size > 0 ? `?${params.toString()}` : ""}#${encodedName}`, metadata),
			issue: null
		};
	}
	if (rawType === "ss" || rawType === "shadowsocks") {
		const method = toStringSafe(proxy.cipher).trim();
		const password = toStringSafe(proxy.password).trim();
		if (!method || !password) return {
			node: null,
			issue: `Прокси ${name}: для Shadowsocks отсутствует cipher/password.`
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
	if (rawType === "socks5" || rawType === "socks") {
		const metadata = {};
		const username = toStringSafe(proxy.username).trim();
		const password = toStringSafe(proxy.password).trim();
		if (username) metadata.username = username;
		if (password) metadata.password = password;
		return {
			node: buildNode("socks", name, server, port, `socks://${username ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ""}@` : ""}${server}:${port}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
	}
	if (rawType === "http") {
		const metadata = {};
		const username = toStringSafe(proxy.username).trim();
		const password = toStringSafe(proxy.password).trim();
		const tls = proxy.tls === true;
		if (username) metadata.username = username;
		if (password) metadata.password = password;
		metadata.tls = tls ? "true" : "false";
		const auth = username ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ""}@` : "";
		return {
			node: buildNode("http", name, server, port, `${tls ? "https" : "http"}://${auth}${server}:${port}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
	}
	if (rawType === "hysteria2" || rawType === "hy2") {
		const password = toStringSafe(proxy.password).trim();
		if (!password) return {
			node: null,
			issue: `Прокси ${name}: для Hysteria2 отсутствует password.`
		};
		const metadata = { password };
		const sni = toStringSafe(proxy.sni).trim() || toStringSafe(proxy.servername).trim();
		if (sni) metadata.sni = sni;
		if (proxy["skip-cert-verify"] === true || proxy.insecure === true) metadata.insecure = "true";
		const up = toStringSafe(proxy["up-mbps"]).trim() || toStringSafe(proxy.up).trim();
		const down = toStringSafe(proxy["down-mbps"]).trim() || toStringSafe(proxy.down).trim();
		if (up) metadata.up_mbps = up;
		if (down) metadata.down_mbps = down;
		const obfs = toStringSafe(proxy.obfs).trim();
		const obfsPassword = toStringSafe(proxy["obfs-password"]).trim();
		if (obfs) metadata.obfs = obfs;
		if (obfsPassword) metadata.obfs_password = obfsPassword;
		const params = new URLSearchParams();
		if (metadata.sni) params.set("sni", metadata.sni);
		if (metadata.insecure) params.set("insecure", metadata.insecure);
		if (metadata.up_mbps) params.set("upmbps", metadata.up_mbps);
		if (metadata.down_mbps) params.set("downmbps", metadata.down_mbps);
		if (metadata.obfs) params.set("obfs", metadata.obfs);
		if (metadata.obfs_password) params.set("obfs-password", metadata.obfs_password);
		return {
			node: buildNode("hysteria2", name, server, port, `hysteria2://${encodeURIComponent(password)}@${server}:${port}${params.size > 0 ? `?${params.toString()}` : ""}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
	}
	if (rawType === "tuic") {
		const uuid = toStringSafe(proxy.uuid).trim();
		const password = toStringSafe(proxy.password).trim();
		if (!uuid || !password) return {
			node: null,
			issue: `Прокси ${name}: для TUIC отсутствует uuid/password.`
		};
		const metadata = {
			uuid,
			password
		};
		const sni = toStringSafe(proxy.sni).trim() || toStringSafe(proxy.servername).trim();
		if (sni) metadata.sni = sni;
		if (proxy["skip-cert-verify"] === true || proxy.insecure === true) metadata.insecure = "true";
		const cc = toStringSafe(proxy["congestion-controller"]).trim() || toStringSafe(proxy.congestion_control).trim();
		if (cc) metadata.congestion_control = cc;
		const params = new URLSearchParams();
		if (metadata.sni) params.set("sni", metadata.sni);
		if (metadata.insecure) params.set("insecure", metadata.insecure);
		if (metadata.congestion_control) params.set("congestion_control", metadata.congestion_control);
		return {
			node: buildNode("tuic", name, server, port, `tuic://${encodeURIComponent(uuid)}:${encodeURIComponent(password)}@${server}:${port}${params.size > 0 ? `?${params.toString()}` : ""}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
	}
	if (rawType === "wireguard") {
		const privateKey = toStringSafe(proxy["private-key"]).trim() || toStringSafe(proxy.privateKey).trim();
		const publicKey = toStringSafe(proxy["public-key"]).trim() || toStringSafe(proxy.publicKey).trim();
		if (!privateKey || !publicKey) return {
			node: null,
			issue: `Прокси ${name}: для WireGuard отсутствует private/public key.`
		};
		const metadata = {
			private_key: privateKey,
			peer_public_key: publicKey
		};
		const address = toStringSafe(proxy.ip).trim() || toStringSafe(proxy.address).trim();
		if (address) metadata.local_address = address;
		const mtu = toStringSafe(proxy.mtu).trim();
		if (mtu) metadata.mtu = mtu;
		const preshared = toStringSafe(proxy["pre-shared-key"]).trim();
		if (preshared) metadata.pre_shared_key = preshared;
		const params = new URLSearchParams();
		params.set("publickey", publicKey);
		if (metadata.local_address) params.set("address", metadata.local_address);
		if (metadata.mtu) params.set("mtu", metadata.mtu);
		if (metadata.pre_shared_key) params.set("presharedkey", metadata.pre_shared_key);
		return {
			node: buildNode("wireguard", name, server, port, `wireguard://${encodeURIComponent(privateKey)}@${server}:${port}?${params.toString()}#${encodeURIComponent(name)}`, metadata),
			issue: null
		};
	}
	return {
		node: null,
		issue: `Неподдерживаемый тип прокси в YAML: ${rawType} (${name}).`
	};
}
function parseNodesFromClashYaml(payload) {
	if (!CLASH_YAML_HINT_PATTERN.test(payload)) return {
		matched: false,
		nodes: [],
		issues: []
	};
	try {
		const parsed = parse(payload);
		if (!parsed || typeof parsed !== "object") return {
			matched: true,
			nodes: [],
			issues: ["YAML подписка пустая или повреждена."]
		};
		const proxies = parsed.proxies;
		if (!Array.isArray(proxies)) return {
			matched: true,
			nodes: [],
			issues: ["YAML подписка не содержит секцию proxies (или она пустая)."]
		};
		const nodes = [];
		const issues = [];
		for (const entry of proxies) {
			if (!entry || typeof entry !== "object") {
				issues.push("Секция proxies содержит некорректную запись.");
				continue;
			}
			const { node, issue } = parseClashProxy(entry);
			if (node) nodes.push(node);
			if (issue) issues.push(issue);
		}
		return {
			matched: true,
			nodes,
			issues
		};
	} catch (error) {
		return {
			matched: true,
			nodes: [],
			issues: [`Ошибка чтения YAML подписки: ${String(error)}`]
		};
	}
}
//#endregion
