//#region src/shared/secure-dns.ts
function unwrapBracketedHost(value) {
	if (value.startsWith("[") && value.endsWith("]")) return value.slice(1, -1);
	return value;
}
function normalizeCustomDnsUrl(value, fallback = "") {
	if (typeof value !== "string") return fallback;
	return value.trim() || fallback;
}
function parseCustomDnsUrl(rawInput) {
	const input = normalizeCustomDnsUrl(rawInput, "");
	if (!input) throw new Error("Укажите DoH URL.");
	let parsed;
	try {
		parsed = new URL(input);
	} catch {
		throw new Error("Некорректный URL защищённого DNS.");
	}
	if (parsed.protocol !== "https:") throw new Error("Сейчас поддерживаются только DoH URL вида https://host[:port]/dns-query.");
	if (!parsed.hostname) throw new Error("В DoH URL отсутствует хост.");
	if (parsed.username || parsed.password) throw new Error("DoH URL с логином или паролем не поддерживается.");
	const server = unwrapBracketedHost(parsed.hostname);
	const serverPort = parsed.port ? Number.parseInt(parsed.port, 10) : 443;
	if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) throw new Error("Некорректный порт в DoH URL.");
	const path = `${parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "/dns-query"}${parsed.search}`;
	return {
		url: `${parsed.protocol}//${parsed.host}${path}`,
		server,
		serverPort,
		path,
		hostnameRequiresResolver: !isValidIpLiteral(server)
	};
}
//#endregion
