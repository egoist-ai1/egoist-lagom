//#region src/electron/ipc/system-doh-manager.ts
/**
* System DoH bootstrap and Xray config builder.
*
* The runtime/service lifecycle lives in `system-doh-service-manager.ts`; this
* module intentionally owns only the pure config/bootstrap helpers it exports.
*/
var BOOTSTRAP_DNS_SERVERS = [
	"1.1.1.1",
	"8.8.8.8",
	"9.9.9.9"
];
var BOOTSTRAP_DOH_ENDPOINTS = ["https://1.1.1.1/dns-query", "https://8.8.8.8/resolve"];
var BOOTSTRAP_LOOKUP_TIMEOUT_MS = 6e3;
var IPV4_ADDRESS_RE = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
var KNOWN_NATIVE_DOH_SERVERS = {
	"cloudflare-dns.com": ["1.1.1.1", "1.0.0.1"],
	"one.one.one.one": ["1.1.1.1", "1.0.0.1"],
	"dns.google": ["8.8.8.8", "8.8.4.4"],
	"dns.quad9.net": ["9.9.9.9", "149.112.112.112"],
	"dns.adguard-dns.com": ["94.140.14.14", "94.140.15.15"],
	"dns.adguard.com": ["94.140.14.14", "94.140.15.15"]
};
/**
* Node's DNS resolver can inherit a long OS-level timeout when a new network
* profile has no reachable resolver yet. System DoH bootstrap must fail over
* promptly instead of holding the UI action hostage behind that timeout.
*/
function withTimeout(operation, timeoutMs, label) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
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
	return Array.from(new Set(values.map((value) => value.trim()).filter((value) => IPV4_ADDRESS_RE.test(value))));
}
async function resolveSystemDohHostWithExplicitDns(host) {
	const resolver = new Resolver();
	resolver.setServers([...BOOTSTRAP_DNS_SERVERS]);
	return uniqueIpv4Addresses(await withTimeout(resolver.resolve4(host), BOOTSTRAP_LOOKUP_TIMEOUT_MS, "Explicit DNS bootstrap lookup"));
}
async function resolveSystemDohHostWithDoh(host) {
	const errors = [];
	for (const endpoint of BOOTSTRAP_DOH_ENDPOINTS) try {
		const response = await fetch(`${endpoint}?name=${encodeURIComponent(host)}&type=A`, {
			headers: { accept: "application/dns-json" },
			signal: AbortSignal.timeout(6e3)
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const payload = await response.json();
		if (typeof payload.Status === "number" && payload.Status !== 0) throw new Error(`DNS status ${payload.Status}`);
		const addresses = uniqueIpv4Addresses((payload.Answer ?? []).filter((answer) => answer.type === 1).map((answer) => answer.data ?? ""));
		if (addresses.length > 0) return addresses;
		errors.push(`${endpoint}: empty A answer`);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		errors.push(`${endpoint}: ${reason}`);
	}
	throw new Error(errors.join("; ") || "empty DoH bootstrap answer");
}
async function resolveSystemDohHostWithSystemLookup(host) {
	return uniqueIpv4Addresses((await withTimeout(lookup(host, {
		all: true,
		family: 4
	}), BOOTSTRAP_LOOKUP_TIMEOUT_MS, "System DNS bootstrap lookup")).map((record) => record.address));
}
async function resolveSystemDohBootstrapHosts(url) {
	const parsed = parseSystemDohUrl(url);
	if (!parsed.hostnameRequiresResolver) return;
	const failures = [];
	const attempts = [
		["IP DoH", () => resolveSystemDohHostWithDoh(parsed.server)],
		["explicit DNS", () => resolveSystemDohHostWithExplicitDns(parsed.server)],
		["system lookup", () => resolveSystemDohHostWithSystemLookup(parsed.server)]
	];
	for (const [label, resolveHost] of attempts) try {
		const addresses = await resolveHost();
		if (addresses.length > 0) return { [parsed.server]: addresses };
		failures.push(`${label}: empty address list`);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		failures.push(`${label}: ${reason}`);
	}
	throw new Error(`Не удалось получить bootstrap IP для DoH upstream ${parsed.server} через bootstrap DNS/DoH: ${failures.join(" | ")}`);
}
/**
* Windows native DoH binds a template to concrete resolver IPs. Known public
* providers use their documented anycast pairs; a custom hostname is resolved
* through the same bounded, multi-path bootstrap used by the legacy dev path.
*/
async function resolveSystemDohNativeServers(url) {
	const parsed = parseSystemDohUrl(url);
	if (!parsed.hostnameRequiresResolver) return [parsed.server];
	const known = KNOWN_NATIVE_DOH_SERVERS[parsed.server.toLowerCase()];
	if (known) return [...known];
	const resolved = uniqueIpv4Addresses((await resolveSystemDohBootstrapHosts(url))?.[parsed.server] ?? []).slice(0, 2);
	if (resolved.length === 0) throw new Error(`DoH upstream ${parsed.server} не имеет доступного IPv4 bootstrap-адреса.`);
	return resolved;
}
function buildSystemDohXrayConfig(options) {

	const localPort = options.localPort ?? 53;
	const bootstrapHosts = Object.fromEntries(Object.entries(options.bootstrapHosts ?? {}).filter(([host, addresses]) => host && Array.isArray(addresses) && addresses.length > 0));
	const hasBootstrapHosts = Object.keys(bootstrapHosts).length > 0;
	return `${JSON.stringify({
		log: {
			loglevel: "info",
			error: options.logPath
		},
		inbounds: [options.localAddress, ...(options.localAddress === "127.0.0.1" ? ["::1"] : [])].map((address, index) => ({
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
			servers: [buildXrayLocalDohServerUrl(options.url)],
			disableFallback: true,
			queryStrategy: "UseIP"
		}
	}, null, 2)}\n`;
}
//#endregion
