//#region src/electron/ipc/system-doh-manager.ts
/**
* System DoH bootstrap and Xray config builder.
*
* The runtime/service lifecycle lives in `system-doh-service-manager.ts`; this
* module intentionally owns only the pure config/bootstrap helpers it exports.
*/
var BOOTSTRAP_DOH_ENDPOINTS = ["https://1.1.1.1/dns-query", "https://8.8.8.8/resolve"];
var BOOTSTRAP_LOOKUP_TIMEOUT_MS = 2500;
var BOOTSTRAP_PREFLIGHT_TIMEOUT_MS = 3000;
var IPV4_ADDRESS_RE = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
var KNOWN_NATIVE_DOH_SERVERS = {
	"cloudflare-dns.com": ["1.1.1.1", "1.0.0.1"],
	"one.one.one.one": ["1.1.1.1", "1.0.0.1"],
	"dns.google": ["8.8.8.8", "8.8.4.4"],
	"dns.quad9.net": ["9.9.9.9", "149.112.112.112"],
	"dns.adguard-dns.com": ["94.140.14.14", "94.140.15.15"],
	"dns.adguard.com": ["94.140.14.14", "94.140.15.15"]
};
var KNOWN_NATIVE_DOH_IPV6_SERVERS = {
	"cloudflare-dns.com": ["2606:4700:4700::1111", "2606:4700:4700::1001"],
	"one.one.one.one": ["2606:4700:4700::1111", "2606:4700:4700::1001"],
	"dns.google": ["2001:4860:4860::8888", "2001:4860:4860::8844"],
	"dns.quad9.net": ["2620:fe::fe", "2620:fe::9"],
	"dns.adguard-dns.com": ["2a10:50c0::ad1:ff", "2a10:50c0::ad2:ff"],
	"dns.adguard.com": ["2a10:50c0::ad1:ff", "2a10:50c0::ad2:ff"]
};
/**
* The entire bootstrap response, including its body, has a bounded deadline.
* A stalled request is cancelled before trying the next HTTPS bootstrap path.
*/
function withTimeout(operation, timeoutMs, label, onTimeout = () => {}) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			try { onTimeout(); } catch {}
			reject(/* @__PURE__ */ new Error(`${label} timed out after ${timeoutMs} ms.`));
		}, timeoutMs);
		operation.then((value) => {
			clearTimeout(timer);
			resolve(value);
		}, (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}
function uniqueIpv4Addresses(values) {
	return Array.from(new Set(values.filter((value) => typeof value === "string").map((value) => value.trim()).filter((value) => IPV4_ADDRESS_RE.test(value))));
}
function uniqueIpv6Addresses(values) {
	const addresses = [];
	for (const value of values) {
		if (typeof value !== "string" || !value.includes(":")) continue;
		try { addresses.push(new URL(`http://[${value.trim()}]`).hostname.slice(1, -1)); } catch {}
	}
	return [...new Set(addresses)];
}
async function resolveSystemDohHostWithDoh(host, type = "A") {
	const errors = [];
	for (const endpoint of BOOTSTRAP_DOH_ENDPOINTS) try {
		const controller = new AbortController();
		const payload = await withTimeout((async () => {
			const response = await fetch(`${endpoint}?name=${encodeURIComponent(host)}&type=${type}`, {
				headers: { accept: "application/dns-json" },
				redirect: "error",
				signal: controller.signal
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.json();
		})(), BOOTSTRAP_LOOKUP_TIMEOUT_MS, "HTTPS bootstrap lookup", () => controller.abort());
		if (typeof payload.Status === "number" && payload.Status !== 0) throw new Error(`DNS status ${payload.Status}`);
		const values = (payload.Answer ?? []).filter((answer) => answer.type === (type === "AAAA" ? 28 : 1)).map((answer) => answer.data ?? "");
		const addresses = type === "AAAA" ? uniqueIpv6Addresses(values) : uniqueIpv4Addresses(values);
		if (addresses.length > 0) return addresses;
		errors.push(`${endpoint}: empty ${type} answer`);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		errors.push(`${endpoint}: ${reason}`);
	}
	throw new Error(errors.join("; ") || "empty DoH bootstrap answer");
}
async function resolveSystemDohBootstrapHosts(url) {
	const parsed = parseSystemDohUrl(url);
	if (!parsed.hostnameRequiresResolver) return;
	const known = KNOWN_NATIVE_DOH_SERVERS[parsed.server.toLowerCase()];
	if (known) return { [parsed.server]: [...known] };
	try {
		return { [parsed.server]: await resolveSystemDohHostWithDoh(parsed.server) };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`Не удалось получить bootstrap IP для DoH upstream ${parsed.server} через HTTPS: ${reason}`);
	}
}
/**
* Windows native DoH binds a template to concrete resolver IPs. Known public
* providers use their documented anycast pairs; a custom hostname is resolved
* through the same bounded HTTPS bootstrap used by the local resolver path.
*/
async function resolveSystemDohNativeServers(url, options = {}) {
	const parsed = parseSystemDohUrl(url);
	if (!parsed.hostnameRequiresResolver) return [parsed.server];
	const known = KNOWN_NATIVE_DOH_SERVERS[parsed.server.toLowerCase()];
	if (known) return [...known, ...(options.allowIpv6 ? KNOWN_NATIVE_DOH_IPV6_SERVERS[parsed.server.toLowerCase()] ?? [] : [])];
	const [v4, v6] = await Promise.allSettled([
		resolveSystemDohBootstrapHosts(url),
		options.allowIpv6 ? resolveSystemDohHostWithDoh(parsed.server, "AAAA") : Promise.resolve([])
	]);
	const resolved = [
		...uniqueIpv4Addresses(v4.status === "fulfilled" ? v4.value?.[parsed.server] ?? [] : []).slice(0, 2),
		...(v6.status === "fulfilled" ? v6.value.slice(0, 2) : [])
	];
	if (resolved.length === 0) throw new Error(`DoH upstream ${parsed.server} не имеет доступного bootstrap-адреса через HTTPS.`);
	return resolved;
}
async function probeSystemDohBootstrapAddresses(url, addresses) {
	const parsed = parseSystemDohUrl(url);
	const candidates = [...uniqueIpv4Addresses(addresses), ...uniqueIpv6Addresses(addresses)].slice(0, 4);
	if (candidates.length === 0) throw new Error("Bootstrap DNS не содержит IP-адресов.");
	const verified = [];
	let lastError;
	for (const address of candidates) {
		const family = address.includes(":") ? 6 : 4;
		const controller = new AbortController();
		const dispatcher = new DohBootstrapAgent({
			connect: {
				servername: parsed.server,
				rejectUnauthorized: true,
				autoSelectFamily: false,
				lookup: (hostname, options, callback) => {
					if (hostname.toLowerCase() !== parsed.server.toLowerCase()) return callback(new Error("Unexpected bootstrap hostname."));
					if (options.all) callback(null, [{ address, family }]);
					else callback(null, address, family);
				}
			},
			connectTimeout: BOOTSTRAP_PREFLIGHT_TIMEOUT_MS,
			allowH2: true
		});
		try {
			const query = createDnsQuery(SYSTEM_DOH_VERIFICATION_DOMAINS[0], 0);
			await withTimeout((async () => {
				const response = await dohBootstrapFetch(buildXrayLocalDohServerUrl(url), {
					method: "POST",
					headers: { accept: "application/dns-message", "content-type": "application/dns-message" },
					body: query,
					dispatcher,
					redirect: "error",
					signal: controller.signal
				});
				if (!response.ok) throw new Error("HTTPS DNS preflight failed.");
				if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/dns-message")) throw new Error("HTTPS endpoint did not return DNS wire format.");
				const chunks = [];
				let size = 0;
				if (!response.body) throw new Error("HTTPS DNS response is empty.");
				for await (const chunk of response.body) {
					size += chunk.length;
					if (size > 65535) throw new Error("HTTPS DNS response exceeds the wire size limit.");
					chunks.push(Buffer.from(chunk));
				}
				const data = Buffer.concat(chunks);
				if (!hasSuccessfulDnsAnswer(data, query)) throw new Error("HTTPS DNS preflight answer failed verification.");
			})(), BOOTSTRAP_PREFLIGHT_TIMEOUT_MS, "HTTPS DNS preflight", () => controller.abort());
			verified.push(address);
		} catch (error) {
			lastError = error;
		} finally {
			controller.abort();
			await dispatcher.destroy().catch(() => {});
		}
	}
	if (verified.length === 0) throw new Error("Ни один bootstrap-адрес не прошёл HTTPS DNS-проверку.", { cause: lastError });
	return verified;
}
function buildSystemDohXrayConfig(options) {
	const localPort = options.localPort ?? 53;
	if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) throw new Error("Некорректный локальный порт DNS.");
	const localAddress = normalizeSystemDohLocalAddress(options.localAddress, "");
	if (!localAddress) throw new Error("Локальный DNS должен слушать только loopback-адрес.");
	const primary = buildXrayLocalDohServerUrl(options.url);
	// A fallback is another DNS operator and can bypass a private/filtering
	// resolver's policy. Use only explicitly supplied HTTPS endpoints, in order.
	const servers = [...new Set([primary, ...(options.fallbackUrls ?? []).map(buildXrayLocalDohServerUrl)])];
	const bootstrapHosts = {};
	for (const serverUrl of servers) {
		const parsed = parseSystemDohUrl(serverUrl);
		if (!parsed.hostnameRequiresResolver) continue;
		const addresses = uniqueIpv4Addresses(options.bootstrapHosts?.[parsed.server] ?? KNOWN_NATIVE_DOH_SERVERS[parsed.server.toLowerCase()] ?? []);
		if (addresses.length === 0) throw new Error(`DoH upstream ${parsed.server} не имеет bootstrap IP.`);
		bootstrapHosts[parsed.server] = addresses;
	}
	// Core probes this reserved name to distinguish a live local listener from
	// Internet/upstream failure without sending a health query to an operator.
	bootstrapHosts[SYSTEM_DOH_HEALTH_DOMAIN] = ["127.0.0.1"];
	const hasBootstrapHosts = Object.keys(bootstrapHosts).length > 0;
	return `${JSON.stringify({
		log: {
			// WinSW rotates stdout/stderr; Xray's separate file has no size limit.
			loglevel: "warning"
		},
		inbounds: [localAddress, ...(localAddress === "127.0.0.1" ? ["::1"] : [])].map((address, index) => ({
			tag: index === 0 ? "dns-in" : "dns-in-v6",
			listen: address,
			port: localPort,
			protocol: "dokodemo-door",
			settings: {
				address: "1.1.1.1",
				port: 53,
				network: "tcp,udp"
			}
		})),
		outbounds: [{
			tag: "dns-out",
			protocol: "dns"
		}, {
			tag: "direct",
			protocol: "freedom",
			settings: { domainStrategy: "ForceIPv4" }
		}],
		routing: {
			domainStrategy: "AsIs",
			rules: [{
				type: "field",
				inboundTag: ["doh-upstream"],
				outboundTag: "direct"
			}, {
				type: "field",
				inboundTag: ["dns-in", "dns-in-v6"],
				outboundTag: "dns-out"
			}]
		},
		dns: {
			tag: "doh-upstream",
			...hasBootstrapHosts ? { hosts: bootstrapHosts } : {},
			servers: servers.map((address) => ({ address, timeoutMs: 2500 })),
			disableCache: false,
			// Keep same-operator cached answers through brief transport outages.
			// Xray also extends cached negatives; never use zero (unbounded).
			serveStale: true,
			serveExpiredTTL: 120,
			enableParallelQuery: false,
			disableFallback: servers.length === 1,
			queryStrategy: "UseIP"
		}
	}, null, 2)}\n`;
}
//#endregion

