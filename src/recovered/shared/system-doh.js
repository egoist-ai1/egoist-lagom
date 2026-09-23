//#region src/shared/system-doh.ts
var SYSTEM_DOH_DEFAULT_LOCAL_ADDRESS = "127.0.0.1";
var SYSTEM_DOH_VERIFICATION_DOMAINS = [
	"example.com",
	"www.microsoft.com",
	"github.com"
];
function isIpv4Octet(value) {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255;
}
function isLoopbackAddress(value) {
	const parts = value.split(".");
	if (parts.length !== 4 || parts[0] !== "127") return false;
	return parts.every(isIpv4Octet);
}
function wrapIpv6Host(value) {
	return value.includes(":") && !value.startsWith("[") ? `[${value}]` : value;
}
function normalizeSystemDohUrl(value, fallback = "") {
	return normalizeCustomDnsUrl(value, fallback);
}
function parseSystemDohUrl(rawInput) {
	return parseCustomDnsUrl(rawInput);
}
function normalizeSystemDohLocalAddress(value, fallback = "") {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	return isLoopbackAddress(trimmed) ? trimmed : fallback;
}
function buildSystemDohLoopbackCandidates(_preferredAddress) {
	return [SYSTEM_DOH_DEFAULT_LOCAL_ADDRESS];
}
function buildXrayLocalDohServerUrl(rawInput) {
	const parsed = parseSystemDohUrl(rawInput);
	return `https://${wrapIpv6Host(parsed.server)}${parsed.serverPort === 443 ? "" : `:${parsed.serverPort}`}${parsed.path}`;
}
//#endregion
