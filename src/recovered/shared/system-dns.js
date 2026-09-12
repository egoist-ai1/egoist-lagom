//#region src/shared/system-dns.ts
var DNS_SEPARATOR_PATTERN = /[\s,;]+/;
var IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
function stripWrappingQuotes(value) {
	if (value.startsWith("\"") && value.endsWith("\"") || value.startsWith("'") && value.endsWith("'") || value.startsWith("`") && value.endsWith("`")) return value.slice(1, -1).trim();
	return value;
}
function isValidIpv4(value) {
	return IPV4_PATTERN.test(value);
}
function isValidIpv6(value) {
	if (!value.includes(":")) return false;
	try {
		return new URL(`http://[${value}]`).hostname === `[${value}]`;
	} catch {
		return false;
	}
}
function isValidIpLiteral(value) {
	return isValidIpv4(value) || isValidIpv6(value);
}
function unwrapBracketedHost$1(value) {
	if (!value.startsWith("[")) return value;
	const closingIndex = value.indexOf("]");
	if (closingIndex === -1) return value;
	return value.slice(1, closingIndex);
}
function extractHostCandidate(rawToken) {
	const token = stripWrappingQuotes(rawToken.trim());
	if (!token) return token;
	if (/^sdns:\/\//i.test(token)) throw new Error("DNS Stamp (sdns://) нельзя применить напрямую как системный DNS Windows. Используйте IP-адреса или локальный DNS-прокси.");
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) try {
		return unwrapBracketedHost$1(new URL(token).hostname);
	} catch {
		throw new Error(`Не удалось разобрать DNS-адрес: ${token}`);
	}
	if (token.startsWith("[")) {
		const closingIndex = token.indexOf("]");
		if (closingIndex !== -1) return token.slice(1, closingIndex);
	}
	const withoutPath = token.split("/")[0] ?? token;
	if (isValidIpLiteral(withoutPath)) return withoutPath;
	const hostPortMatch = /^(?<host>[^:]+):(?<port>\d+)$/.exec(withoutPath);
	if (hostPortMatch?.groups?.host && isValidIpv4(hostPortMatch.groups.host)) return hostPortMatch.groups.host;
	return withoutPath;
}
function parseDnsServers(rawInput) {
	const tokens = rawInput.split(DNS_SEPARATOR_PATTERN).map((value) => value.trim()).filter(Boolean);
	if (tokens.length === 0) throw new Error("Укажите хотя бы один DNS-сервер.");
	const uniqueServers = /* @__PURE__ */ new Set();
	for (const token of tokens) {
		const normalized = extractHostCandidate(token);
		if (!isValidIpLiteral(normalized)) throw new Error(`Некорректный DNS-адрес: ${token}. Для системного DNS Windows поддерживаются IP-адреса, host:port или URL с IP-хостом.`);
		uniqueServers.add(normalized);
	}
	return [...uniqueServers];
}
function splitDnsServersByFamily(servers) {
	const ipv4Servers = servers.filter((server) => isValidIpv4(server));
	const ipv6Servers = servers.filter((server) => isValidIpv6(server));
	return {
		servers: [...servers],
		ipv4Servers,
		ipv6Servers
	};
}
//#endregion
