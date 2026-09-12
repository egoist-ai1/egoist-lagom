//#region src/electron/ipc/zapret-manager.ts
var execFileAsync$1 = promisify(execFile);
var SERVICE_NAME = "EgoistShieldZapret";
var SERVICE_DISPLAY_NAME = "EgoistShield Zapret";
var SERVICE_DESCRIPTION = "Integrated Zapret DPI bypass managed by EgoistShield";
var SERVICE_WRAPPER_DIR = "service-wrapper";
var SERVICE_WRAPPER_EXE = "egoistshield-zapret-service.exe";
var SERVICE_WRAPPER_XML = "egoistshield-zapret-service.xml";
var SERVICE_START_TIMEOUT_MS = 75e3;
var ZAPRET_STATUS_CACHE_TTL_MS = 3e3;
var DRIVER_SERVICES = ["WinDivert", "WinDivert14"];
var EXTERNAL_CONFLICT_SERVICES = ["zapret", "zapret_discord"];
var LEGACY_ZAPRET_RESET_SERVICES = [
	"GoodbyeDPI",
	"zapret",
	"zapret_discord",
	"discordfix_zapret",
	"winws1",
	"winws2"
];
var DIAGNOSTIC_CONFLICT_SERVICES = [
	"GoodbyeDPI",
	"discordfix_zapret",
	"winws1",
	"winws2"
];
var DEFAULT_PROFILE_NAME = "General";
var PROFILE_FILE_EXCLUDES = /* @__PURE__ */ new Set([
	"discord.bat",
	"service.bat",
	"cloudflare_switch.bat"
]);
var DEFAULT_USER_LIST_FILES = {
	"ipset-all-user.txt": "203.0.113.113/32\n",
	"ipset-exclude-user.txt": "203.0.113.113/32\n",
	"list-general-user.txt": "domain.example.abc\n",
	"list-exclude-user.txt": "domain.example.abc\n"
};
var USER_LIST_FILE_NAMES = {
	generalDomains: "list-general-user.txt",
	includedCidrs: "ipset-all-user.txt",
	excludedDomains: "list-exclude-user.txt",
	excludedCidrs: "ipset-exclude-user.txt"
};
var DEFAULT_USER_LIST_PLACEHOLDERS = {
	generalDomains: "domain.example.abc",
	includedCidrs: "203.0.113.113/32",
	excludedDomains: "domain.example.abc",
	excludedCidrs: "203.0.113.113/32"
};
var FLOWSEAL_VERSION_URL = "https://raw.githubusercontent.com/Flowseal/zapret-discord-youtube/main/.service/version.txt";
var FLOWSEAL_RELEASE_API_URL = "https://api.github.com/repos/Flowseal/zapret-discord-youtube/releases/latest";
var FLOWSEAL_RELEASES_URL = "https://github.com/Flowseal/zapret-discord-youtube/releases/latest";
var FLOWSEAL_DISCORD_RESCUE_VERSION = "1.9.2";
var FLOWSEAL_TRUSTED_RELEASE_ZIP_SHA256 = {
	"1.9.8": "6379213185367b94a6b41bfdb7d64bccb2ad9ffafd07848af1d9657513f8b491",
	"1.9.8c": "49c2901d329c9ef3747c48a9999e73c3fa2fb050aed126b91cac02c6bbea8618",
	"1.9.9a": "52fba9d0b47c9e8ac89e9714ae344c0c3ba3c4f89a03910d10a75824f0adb3d3",
	"1.10.0": "6b7c5a66cfd055b8e361f8b5fb00f00b167260f21b1c03d589f6008417fb94a2",
	"1.10.2": "5eaac9fb2e4b1abd693487452a3ff3f4dfe9578a45f9ddddfa4bc1f5a6bb62d5"
};
var FLOWSEAL_TRUSTED_SOURCE_ZIP_SHA256 = { "1.9.9c": "a9834bc30d01f3c682d99ecbb88e305f451ec43b151c8149a13f3d6e81bacbf0" };
var FLOWSEAL_IPSET_URL = "https://raw.githubusercontent.com/Flowseal/zapret-discord-youtube/refs/heads/main/.service/ipset-service.txt";
var APP_RELEASE_VERSION = package_default.version;
var FLOWSEAL_SCRIPT_USER_AGENT = `EgoistShield/${APP_RELEASE_VERSION}`;
var FLOWSEAL_SERVICE_LOCAL_VERSION_LINES = ["set \"LOCAL_VERSION=unknown\"", "if exist \"%~dp0..\\VERSION.txt\" for /f \"usebackq delims=\" %%A in (\"%~dp0..\\VERSION.txt\") do set \"LOCAL_VERSION=%%~A\""];
var FLOWSEAL_SERVICE_VERSION_FETCH_LINE = `for /f "delims=" %%A in ('powershell -NoProfile -Command "$ProgressPreference = ''SilentlyContinue''; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { if (Get-Command curl.exe -ErrorAction SilentlyContinue) { (& curl.exe -fsSL --connect-timeout 5 -H ''User-Agent: ${FLOWSEAL_SCRIPT_USER_AGENT}'' -H ''Cache-Control: no-cache'' ''%GITHUB_VERSION_URL%'').Trim() } else { (Invoke-WebRequest -Uri ''%GITHUB_VERSION_URL%'' -Headers @{''User-Agent''=''''${FLOWSEAL_SCRIPT_USER_AGENT}'''';''Cache-Control''=''''no-cache''''} -UseBasicParsing -TimeoutSec 5).Content.Trim() } } catch { '''' }" 2^>nul') do set "GITHUB_VERSION=%%A"`;
/**
* Flowseal ships `core/fast/update_service.bat`, which downloads a release ZIP
* and overwrites `core/` without any checksum or signature check. EgoistShield
* replaces that script with a refusal stub: the only supported update path is
* the in-app Flowseal Core updater, which verifies SHA-256 (GitHub asset digest
* or a pinned trusted hash) before a single file is replaced.
*/
var FLOWSEAL_UPDATE_SCRIPT_TEMPLATE = `@echo off
chcp 65001 >nul
title EgoistShield - обновление Zapret Core

echo.
echo  Этот консольный апдейтер отключён Egoist Shield ${APP_RELEASE_VERSION}.
echo.
echo  Он скачивал архив Flowseal без проверки контрольной суммы и подменял
echo  файлы core\\ напрямую, поэтому повреждённый или подменённый архив
echo  применился бы незаметно.
echo.
echo  Обновляйте ядро во встроенной панели "Flowseal Core" внутри Zapret:
echo  там архив принимается только после совпадения SHA-256 с GitHub Releases
echo  или с закреплённым доверенным хэшем, а служба и драйверы
echo  останавливаются и восстанавливаются программой.
echo.
echo  Ничего не изменено. Нажмите любую клавишу для выхода...
pause >nul
exit /b 1
`;
var STANDALONE_STATE_FILE = ".egoistshield-standalone.json";
var AUTO_SELECT_TARGETS = [
	{
		key: "DiscordMain",
		label: "Discord Main",
		url: "https://discord.com"
	},
	{
		key: "DiscordGateway",
		label: "Discord Gateway",
		url: "https://discord.com/api/v10/gateway"
	},
	{
		key: "DiscordCDN",
		label: "Discord CDN",
		url: "https://cdn.discordapp.com/embed/avatars/0.png"
	},
	{
		key: "YouTubeWeb",
		label: "YouTube Web",
		url: "https://www.youtube.com"
	},
	{
		key: "YouTubeShort",
		label: "YouTube Short",
		url: "https://youtu.be"
	},
	{
		key: "YouTubeImage",
		label: "YouTube Image",
		url: "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg"
	},
	{
		key: "GoogleMain",
		label: "Google Main",
		url: "https://www.google.com"
	},
	{
		key: "GoogleGstatic",
		label: "Google Gstatic",
		url: "https://www.gstatic.com"
	},
	{
		key: "CloudflareWeb",
		label: "Cloudflare Web",
		url: "https://www.cloudflare.com"
	},
	{
		key: "CloudflareCDN",
		label: "Cloudflare CDN",
		url: "https://cdnjs.cloudflare.com"
	},
	{
		key: "CloudflareDNS1111",
		label: "Cloudflare DNS 1.1.1.1",
		pingTarget: "1.1.1.1"
	},
	{
		key: "CloudflareDNS1001",
		label: "Cloudflare DNS 1.0.0.1",
		pingTarget: "1.0.0.1"
	},
	{
		key: "GoogleDNS8888",
		label: "Google DNS 8.8.8.8",
		pingTarget: "8.8.8.8"
	},
	{
		key: "GoogleDNS8844",
		label: "Google DNS 8.8.4.4",
		pingTarget: "8.8.4.4"
	},
	{
		key: "Quad9DNS9999",
		label: "Quad9 DNS 9.9.9.9",
		pingTarget: "9.9.9.9"
	}
];
var ZAPRET_CURL_FALLBACK_VARIANTS = [
	{
		label: "HTTP",
		args: ["--http1.1"]
	},
	{
		label: "TLS1.2",
		args: [
			"--tlsv1.2",
			"--tls-max",
			"1.2"
		]
	},
	{
		label: "TLS1.3",
		args: [
			"--tlsv1.3",
			"--tls-max",
			"1.3"
		]
	}
];
/**
* Auto-select tuning. The 5.4.0 loop ran the three curl variants strictly one
* after another (up to 3 x 5 s per target) and pinged every hostname with
* `-n 3`, so a single dead profile cost ~15-20 s. Running the variants in
* parallel under a bounded process pool keeps the same evidence (every variant
* is still recorded in `checks`) while bounding a profile probe by the slowest
* single request instead of their sum.
*/
var ZAPRET_PROBE_HTTP_TIMEOUT_MS = 4e3;
var ZAPRET_PROBE_PING_COUNT = 2;
var ZAPRET_PROBE_PING_TIMEOUT_MS = 1500;
var ZAPRET_PROBE_MAX_PARALLEL = 8;
var ZAPRET_PROBE_SETTLE_MS = 600;
var ZAPRET_PROBE_START_TIMEOUT_MS = 15e3;
var ZAPRET_PROBE_STOP_TIMEOUT_MS = 4e3;
var ZAPRET_AUTO_SELECT_MEMORY_FILE = ".egoistshield-autoselect.json";
var ZAPRET_AUTO_SELECT_MEMORY_VERSION = 1;
var ZAPRET_AUTO_SELECT_MEMORY_MAX_ENTRIES = 12;
var DISCORD_CACHE_SUBPATHS = [
	"Cache",
	"Code Cache",
	"GPUCache",
	"DawnCache",
	path.join("Network", "Cache"),
	path.join("Service Worker", "CacheStorage"),
	path.join("Service Worker", "ScriptCache"),
	path.join("Partitions", "discord_voice", "Cache"),
	path.join("Partitions", "discord_voice", "Code Cache"),
	path.join("Partitions", "discord_voice", "GPUCache")
];
var DISCORD_CACHE_TARGETS = {
	discord: {
		label: "Discord",
		directoryNames: ["discord", "Discord"],
		processNames: ["Discord.exe", "Update.exe"]
	},
	"discord-ptb": {
		label: "Discord PTB",
		directoryNames: ["discordptb", "DiscordPTB"],
		processNames: ["DiscordPTB.exe", "Update.exe"]
	},
	"discord-canary": {
		label: "Discord Canary",
		directoryNames: ["discordcanary", "DiscordCanary"],
		processNames: ["DiscordCanary.exe", "Update.exe"]
	},
	vesktop: {
		label: "Vesktop",
		directoryNames: ["vesktop", "Vesktop"],
		processNames: [
			"vesktop.exe",
			"Vesktop.exe",
			"Update.exe"
		]
	}
};
var ZapretAutoSelectCancelledError = class extends Error {
	constructor() {
		super("Zapret auto-select cancelled");
		this.name = "ZapretAutoSelectCancelledError";
	}
};
function throwIfAutoSelectCancelled(signal) {
	if (signal?.aborted) throw new ZapretAutoSelectCancelledError();
}
function dedupeNormalizedEntries(entries) {
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const entry of entries) {
		const normalized = entry.trim().toLowerCase();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}
function normalizeZapretDomainEntries(entries, placeholder) {
	const invalid = /* @__PURE__ */ new Set();
	const normalized = dedupeNormalizedEntries(entries).filter((entry) => entry !== placeholder).filter((entry) => {
		const isValid = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(entry);
		if (!isValid) invalid.add(entry);
		return isValid;
	});
	if (invalid.size > 0) throw new Error(`Некорректные домены в пользовательском списке Zapret: ${Array.from(invalid).join(", ")}. Используйте по одному домену на строку.`);
	return normalized;
}
function parseWmiDateToIso(value) {
	if (typeof value !== "string" || !value.trim()) return null;
	const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.\d+([+-])(\d{3})$/);
	if (!match) return null;
	const [, year, month, day, hour, minute, second, sign, offsetMinutesRaw] = match;
	const offsetMinutes = Number.parseInt(offsetMinutesRaw, 10);
	if (!Number.isFinite(offsetMinutes)) return null;
	const utcMs = Date.UTC(Number.parseInt(year, 10), Number.parseInt(month, 10) - 1, Number.parseInt(day, 10), Number.parseInt(hour, 10), Number.parseInt(minute, 10), Number.parseInt(second, 10)) - (sign === "+" ? offsetMinutes : -offsetMinutes) * 6e4;
	return Number.isFinite(utcMs) ? new Date(utcMs).toISOString() : null;
}
function averageProbePing(values) {
	const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
	if (!numbers.length) return null;
	return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}
function countSuccessfulProbeTargets(result) {
	return result.targets.filter((target) => target.ok).length;
}
/** Runs async jobs with a bounded degree of parallelism, preserving input order. */
async function runWithBoundedConcurrency(items, limit, worker) {
	const results = new Array(items.length);
	const effectiveLimit = Math.max(1, Math.min(limit, items.length || 1));
	let cursor = 0;
	let firstError = null;
	async function pump() {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			try {
				results[index] = await worker(items[index], index);
			} catch (error) {
				if (firstError === null) firstError = error;
				cursor = items.length;
				return;
			}
		}
	}
	await Promise.all(Array.from({ length: effectiveLimit }, () => pump()));
	if (firstError !== null) throw firstError;
	return results;
}
/**
* Stable, offline network identity. MAC + /24 of every non-internal IPv4
* interface is enough to tell "home Wi-Fi" from "office LAN" from "tethering"
* without touching the network or storing anything identifying in clear text.
*/
function computeZapretNetworkFingerprint(interfaces = os.networkInterfaces()) {
	const parts = [];
	for (const entries of Object.values(interfaces)) for (const entry of entries ?? []) {
		if (!entry || entry.internal || entry.family !== "IPv4") continue;
		const mac = (entry.mac ?? "").toLowerCase();
		if (!mac || mac === "00:00:00:00:00:00") continue;
		const subnet = entry.address.split(".").slice(0, 3).join(".");
		parts.push(`${mac}|${subnet}`);
	}
	if (parts.length === 0) return "unknown-network";
	return createHash("sha256").update(Array.from(new Set(parts)).sort().join(";")).digest("hex").slice(0, 16);
}
var TOP_MODERN_PROFILES = [
	"general (FAKE TLS AUTO)",
	"General",
	"general (ALT4)",
	"general (ALT9)",
	"general (ALT11)",
	"general (ALT12)",
	"general (ALT13)",
	"general (FAKE TLS AUTO ALT2)",
	"general (FAKE TLS AUTO ALT3)",
	"general (FAKE TLS AUTO ALT)"
];
/** Puts the profile that already worked on this network in front, followed by top TSPU bypass profiles. */
function orderZapretProfilesForAutoSelect(profiles, rememberedProfile) {
	const ordered = [];
	const seen = new Set();
	if (rememberedProfile) {
		const remembered = profiles.find((profile) => profile.name === rememberedProfile);
		if (remembered) {
			ordered.push(remembered);
			seen.add(remembered.name);
		}
	}
	for (const topName of TOP_MODERN_PROFILES) {
		const match = profiles.find((profile) => profile.name.toLowerCase() === topName.toLowerCase() && !seen.has(profile.name));
		if (match) {
			ordered.push(match);
			seen.add(match.name);
		}
	}
	for (const profile of profiles) {
		if (!seen.has(profile.name)) {
			ordered.push(profile);
			seen.add(profile.name);
		}
	}
	return ordered;
}
function countZapretProbeGroup(targets, prefix) {
	const group = targets.filter((target) => target.key.startsWith(prefix));
	return {
		passed: group.filter((target) => target.ok).length,
		total: group.length
	};
}
/**
* "Confident" means every Discord and every YouTube target answered, not just
* one of each. This permits an early exit: the result is the first fully reachable
* candidate, not a claim that every strategy or video playback was measured.
*/
function isConfidentZapretProbe(targets) {
	const discord = countZapretProbeGroup(targets, "Discord");
	const youtube = countZapretProbeGroup(targets, "YouTube");
	return discord.total > 0 && youtube.total > 0 && discord.passed === discord.total && youtube.passed === youtube.total;
}
function summarizeZapretAutoSelect(input) {
	const scope = `Проверено профилей: ${input.testedProfiles} из ${input.totalProfiles}.`;
	if (input.cancelled) return {
		headline: "Автоподбор остановлен",
		detail: `${scope} Результаты незавершённых профилей не сохранены — рекомендация не выдаётся.`,
		confidence: "none"
	};
	if (!input.bestProfile) return {
		headline: "Рабочий профиль не найден",
		detail: `${scope} Ни один профиль не открыл одновременно Discord и YouTube. Обновите ядро Flowseal, отключите сторонние обходы (GoodbyeDPI, второй Zapret, AdGuard) и повторите автоподбор.`,
		confidence: "none"
	};
	const groups = `Discord ${input.discordPassed}/${input.discordTotal}, YouTube ${input.youTubePassed}/${input.youTubeTotal}`;
	const latency = input.bestPingMs === null ? "задержка не измерена" : `средний отклик ${input.bestPingMs} мс`;
	const memoryNote = input.usedRememberedProfile ? " Профиль был подсказан историей этой сети и подтверждён свежими пробами." : "";
	if (input.confident) return {
		headline: `Подходит профиль «${input.bestProfile}»`,
		detail: `${scope} Профиль прошёл ${input.bestPassedTargets} из ${input.bestTotalTargets} проверок (${groups}), ${latency}.${memoryNote}`,
		confidence: "high"
	};
	return {
		headline: `Лучший из проверенных — «${input.bestProfile}»`,
		detail: `${scope} Профиль прошёл ${input.bestPassedTargets} из ${input.bestTotalTargets} проверок (${groups}), ${latency}. Часть целей осталась недоступной, поэтому это лучший измеренный вариант, а не гарантированный.`,
		confidence: "medium"
	};
}
function compareZapretAutoSelectCandidates(left, right) {
	const leftPassed = countSuccessfulProbeTargets(left);
	const rightPassed = countSuccessfulProbeTargets(right);
	if (leftPassed !== rightPassed) return rightPassed - leftPassed;
	const leftPing = left.pingMs ?? Number.MAX_SAFE_INTEGER;
	const rightPing = right.pingMs ?? Number.MAX_SAFE_INTEGER;
	if (leftPing !== rightPing) return leftPing - rightPing;
	const leftSuccess = left.result === "success" ? 1 : 0;
	return (right.result === "success" ? 1 : 0) - leftSuccess;
}
function parsePingAverageMs(output) {
	const averageMatch = output.match(/(?:Average|Среднее)\s*=\s*(\d+)\s*(?:ms|мс(?:ек)?)/i);
	if (averageMatch?.[1]) return Number.parseInt(averageMatch[1], 10);
	return averageProbePing(Array.from(output.matchAll(/[=<]\s*(\d+)\s*(?:ms|мс(?:ек)?)/gi)).map((match) => Number.parseInt(match[1] ?? "", 10)).filter((value) => Number.isFinite(value)));
}
function parseCurlStatusCode(output) {
	const match = String(output ?? "").trim().match(/(\d{3})$/);
	if (!match?.[1]) return null;
	const status = Number.parseInt(match[1], 10);
	return Number.isFinite(status) && status >= 100 && status < 600 ? status : null;
}
function normalizeCurlProbeError(value) {
	return String(value ?? "").replace(/\s+/g, " ").trim() || "curl probe failed";
}
function normalizeZapretNetworkEntries(entries, placeholder) {
	const invalid = /* @__PURE__ */ new Set();
	const normalized = dedupeNormalizedEntries(entries).filter((entry) => entry !== placeholder).filter((entry) => {
		const isValid = /^[0-9a-f:.]+(?:\/\d{1,3})?$/i.test(entry);
		if (!isValid) invalid.add(entry);
		return isValid;
	});
	if (invalid.size > 0) throw new Error(`Некорректные IP/CIDR в пользовательском списке Zapret: ${Array.from(invalid).join(", ")}. Используйте IP или подсеть вида 203.0.113.10/32.`);
	return normalized;
}
function parseZapretListFile(raw, placeholder) {
	return dedupeNormalizedEntries(raw.split(/\r?\n/).map((line) => line.trim())).filter((line) => line && !line.startsWith("#") && !line.startsWith(";") && line !== placeholder);
}
function serializeZapretListEntries(entries, placeholder) {
	return `${(entries.length > 0 ? entries : [placeholder]).join("\n")}\n`;
}
function parseIpsetEntries(raw) {
	return dedupeNormalizedEntries(raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && !line.startsWith(";")));
}
function serializeIpsetEntries(entries) {
	return entries.length > 0 ? `${entries.join("\n")}\n` : "";
}
function ensureTrailingSlash(value) {
	return value.endsWith("\\") ? value : `${value}\\`;
}
function getCommandFailureText(error) {
	if (!(error instanceof Error)) return String(error);
	const execError = error;
	const chunks = [execError.message];
	if (typeof execError.code !== "undefined") chunks.push(String(execError.code));
	if (typeof execError.stdout === "string") chunks.push(execError.stdout);
	else if (Buffer.isBuffer(execError.stdout)) chunks.push(execError.stdout.toString("utf8"));
	if (typeof execError.stderr === "string") chunks.push(execError.stderr);
	else if (Buffer.isBuffer(execError.stderr)) chunks.push(execError.stderr.toString("utf8"));
	return chunks.filter(Boolean).join("\n");
}
function isWindowsServiceMissingError(error) {
	const message = getCommandFailureText(error);
	return /1060|does not exist as an installed service/i.test(message);
}
function isScAlreadyRunningError(error) {
	const message = getCommandFailureText(error);
	return /1056|already running/i.test(message);
}
function isScNotActiveError(error) {
	const message = getCommandFailureText(error);
	return /1062|has not been started/i.test(message);
}
function parseScQueryState(stdout) {
	const statePattern = new RegExp(`:\\s*\\d+\\s+(${[
		"STOPPED",
		"START_PENDING",
		"STOP_PENDING",
		"RUNNING",
		"CONTINUE_PENDING",
		"PAUSE_PENDING",
		"PAUSED"
	].join("|")})\\b`, "i");
	for (const line of stdout.split(/\r?\n/)) {
		const match = line.match(statePattern);
		if (match?.[1]) return match[1].toUpperCase();
	}
	return null;
}
function normalizeBatchContent(content) {
	return content.replace(/\r\n/g, "\n");
}
function naturalTokens(value) {
	return value.split(/(\d+)/).filter(Boolean).map((part) => /^\d+$/.test(part) ? Number.parseInt(part, 10) : part.toLowerCase());
}
function buildProfileSortKey(name) {
	const trimmed = name.trim();
	const altMatch = trimmed.match(/\(\s*([A-Za-z\-]*ALT)\s*(\d*)\s*\)\s*$/i);
	if (altMatch) {
		const base = trimmed.slice(0, altMatch.index).trimEnd();
		const altLabel = (altMatch[1] || "").toLowerCase();
		const altIndex = altMatch[2] ? Number.parseInt(altMatch[2], 10) : 1;
		return [
			naturalTokens(base),
			0,
			altLabel,
			altIndex
		];
	}
	return [
		naturalTokens(trimmed),
		1,
		"",
		0
	];
}
function compareMixedValues(left, right) {
	if (typeof left === "number" && typeof right === "number") return left - right;
	return String(left).localeCompare(String(right), "ru-RU", {
		sensitivity: "base",
		numeric: true
	});
}
function normalizeFlowsealVersion(value) {
	return normalizeVersionTag(value);
}
function normalizeFlowsealInstallVersion(value) {
	const normalized = normalizeFlowsealVersion(value);
	if (!normalized || !/^\d+(?:\.\d+){1,3}[a-z]?$/i.test(normalized)) throw new Error("Некорректная версия Flowseal Core. Используйте формат вроде 1.9.8 или 1.9.7b.");
	return normalized;
}
function areSameFlowsealVersion(left, right) {
	return compareFlowsealVersions(left, right) === 0;
}
function compareFlowsealVersions(left, right) {
	const normalizedLeft = normalizeFlowsealVersion(left);
	const normalizedRight = normalizeFlowsealVersion(right);
	if (normalizedLeft === normalizedRight) return 0;
	if (!normalizedLeft) return -1;
	if (!normalizedRight) return 1;
	return compareLooseVersions(normalizedLeft, normalizedRight);
}
function compareZapretProfileNames(left, right) {
	const leftKey = buildProfileSortKey(left);
	const rightKey = buildProfileSortKey(right);
	const maxLength = Math.max(leftKey[0].length, rightKey[0].length);
	for (let index = 0; index < maxLength; index += 1) {
		const leftValue = leftKey[0][index];
		const rightValue = rightKey[0][index];
		if (typeof leftValue === "undefined") return -1;
		if (typeof rightValue === "undefined") return 1;
		const diff = compareMixedValues(leftValue, rightValue);
		if (diff !== 0) return diff;
	}
	if (leftKey[1] !== rightKey[1]) return leftKey[1] - rightKey[1];
	if (leftKey[2] !== rightKey[2]) return leftKey[2].localeCompare(rightKey[2], "ru-RU", { sensitivity: "base" });
	return leftKey[3] - rightKey[3];
}
function parseZapretWinwsArgs(profileContent) {
	const lines = normalizeBatchContent(profileContent).split("\n");
	const commandStart = lines.findIndex((line) => /%BIN%winws\.exe/i.test(line));
	if (commandStart < 0) throw new Error("Не удалось найти команду запуска winws.exe в выбранном профиле Zapret.");
	const chunks = [];
	for (let index = commandStart; index < lines.length; index += 1) {
		const originalLine = lines[index]?.trim();
		if (!originalLine) continue;
		const continued = originalLine.endsWith("^");
		chunks.push(continued ? originalLine.slice(0, -1).trim() : originalLine);
		if (!continued) break;
	}
	const match = chunks.join(" ").match(/%BIN%winws\.exe"?\s+(.+)$/i);
	if (!match?.[1]) throw new Error("Не удалось выделить аргументы winws.exe из профиля Zapret.");
	return match[1].trim();
}
function applyZapretPlaceholders(rawArgs, replacements) {
	return rawArgs.replace(/%BIN%/gi, replacements.BIN).replace(/%LISTS%/gi, replacements.LISTS).replace(/%GameFilterTCP%/gi, replacements.GameFilterTCP).replace(/%GameFilterUDP%/gi, replacements.GameFilterUDP).replace(/%GameFilter%/gi, replacements.GameFilter).replace(/\^!/g, "!").replace(/\^\^/g, "^").replace(/\s+/g, " ").trim();
}
function splitWindowsCommandLine(commandLine) {
	const args = [];
	let current = "";
	let inQuotes = false;
	let backslashes = 0;
	for (const char of commandLine) {
		if (char === "\\") {
			backslashes += 1;
			continue;
		}
		if (char === "\"") {
			current += "\\".repeat(Math.floor(backslashes / 2));
			if (backslashes % 2 === 0) inQuotes = !inQuotes;
			else current += "\"";
			backslashes = 0;
			continue;
		}
		if (backslashes > 0) {
			current += "\\".repeat(backslashes);
			backslashes = 0;
		}
		if (/\s/.test(char) && !inQuotes) {
			if (current.length > 0) {
				args.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (backslashes > 0) current += "\\".repeat(backslashes);
	if (current.length > 0) args.push(current);
	return args;
}
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function psQuote(value) {
	return `'${value.replace(/'/g, "''")}'`;
}
function buildCommandResult(message, options = {}) {
	return {
		ok: options.ok ?? true,
		opened: options.opened ?? false,
		message,
		output: options.output ?? ""
	};
}
function buildDeprecatedConsoleMessage(target) {
	const isUpdater = target === "updater";
	return buildCommandResult(isUpdater ? "Классический консольный обновлятор Flowseal Core больше не используется. Откройте встроенный блок Flowseal Core в центре Zapret." : "Сервисное консольное меню Flowseal больше не используется. Все действия со службой доступны прямо в центре Zapret.", { output: [`Deprecated console workflow suppressed by EgoistShield ${APP_RELEASE_VERSION}.`, isUpdater ? "Use the integrated Flowseal Core panel in Zapret." : "Use the integrated service controls in Zapret."].join("\n") });
}
/**
* Tells the user, before they press "install", which integrity proof the update
* will be held to. A version with no pinned hash is installable only when
* GitHub returns the exact asset digest through release metadata or the public
* expanded-assets fragment; otherwise installation fails closed.
*/
function describeFlowsealIntegrityPolicy(version) {
	const normalized = normalizeFlowsealVersion(version);
	if (normalized && (FLOWSEAL_TRUSTED_SOURCE_ZIP_SHA256[normalized] || FLOWSEAL_TRUSTED_RELEASE_ZIP_SHA256[normalized])) return {
		source: "pinned-sha256",
		note: "Архив будет проверен по закреплённому в приложении SHA-256."
	};
	return {
		source: "github-asset-digest",
		note: "Для этой версии нет закреплённого SHA-256: архив будет принят только по точному digest GitHub Releases, иначе установка будет отклонена."
	};
}
function buildFlowsealReleaseAssetName(version) {
	return `zapret-discord-youtube-${version}.zip`;
}
function buildFlowsealReleaseAssetUrl(version) {
	return `https://github.com/Flowseal/zapret-discord-youtube/releases/download/${encodeURIComponent(version)}/${encodeURIComponent(buildFlowsealReleaseAssetName(version))}`;
}
function buildFlowsealSourceArchiveName(version) {
	return `zapret-discord-youtube-${version}-source.zip`;
}
function buildFlowsealSourceArchiveUrl(version) {
	return `https://github.com/Flowseal/zapret-discord-youtube/archive/refs/tags/${encodeURIComponent(version)}.zip`;
}
function buildFlowsealReleaseUrl(version) {
	return buildGitHubReleaseTagPageUrl(FLOWSEAL_RELEASE_API_URL, version) ?? `https://github.com/Flowseal/zapret-discord-youtube/releases/tag/${encodeURIComponent(version)}`;
}
function quotePowerShellLiteral(value) {
	return `'${value.replace(/'/g, "''")}'`;
}
function toPowerShellArgumentList(args) {
	return args.map((arg) => quotePowerShellLiteral(arg)).join(", ");
}
function isFlowsealRootPayloadEntry(name, isDirectory) {
	const normalized = name.trim().toLowerCase();
	if (!normalized || normalized.startsWith(".")) return false;
	if (isDirectory) return normalized === "bin" || normalized === "fast" || normalized === "lists" || normalized === "utils";
	return normalized === "service.bat" || normalized.endsWith(".bat");
}
function escapeXmlText(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function buildDiscordCacheCleanupPlan(target, env = process.env) {
	const resolvedTargets = target === "all" ? Object.values(DISCORD_CACHE_TARGETS) : [DISCORD_CACHE_TARGETS[target]];
	const roots = [env.APPDATA, env.LOCALAPPDATA].filter((value) => Boolean(value));
	const directories = /* @__PURE__ */ new Set();
	const processNames = /* @__PURE__ */ new Set();
	for (const resolvedTarget of resolvedTargets) {
		for (const processName of resolvedTarget.processNames) processNames.add(processName);
		for (const root of roots) for (const directoryName of resolvedTarget.directoryNames) for (const subPath of DISCORD_CACHE_SUBPATHS) directories.add(path.join(root, directoryName, subPath));
	}
	return {
		labels: resolvedTargets.map((item) => item.label),
		directories: Array.from(directories),
		processNames: Array.from(processNames)
	};
}
var ZapretManager = class {
	resourcesPath;
	appPath;
	userDataDir;
	coreService;
	workDir;
	lastError = null;
	suspendedByVpnMode = "none";
	suspendedProfileDuringVpn = null;
	statusCache = null;
	statusInFlight = null;
	autoSelectController = null;
	/** Non-null only while an auto-select sweep is running. */
	probeProfiles = null;
	constructor(resourcesPath, appPath, userDataDir, protectedComponentRoot, coreService) {
		this.resourcesPath = resourcesPath;
		this.appPath = appPath;
		this.userDataDir = userDataDir;
		this.coreService = coreService;
		this.workDir = protectedComponentRoot ?? path.join(userDataDir, "zapret");
	}
	getWorkDir() {
		return this.workDir;
	}
	async status(options = {}) {
		const now = Date.now();
		if (!options.force && this.statusCache && this.statusCache.expiresAt > now) return this.statusCache.value;
		if (!options.force && this.statusInFlight) return this.statusInFlight;
		this.statusInFlight = this.readStatus().then((value) => {
			this.statusCache = {
				value,
				expiresAt: Date.now() + ZAPRET_STATUS_CACHE_TTL_MS
			};
			return value;
		}).finally(() => {
			this.statusInFlight = null;
		});
		return this.statusInFlight;
	}
	invalidateStatusCache() {
		this.statusCache = null;
	}
	async readStatus() {
		const sourceRuntime = await this.getSourceRuntimeInfo();
		const service = await this.queryService(SERVICE_NAME);
		const provisioned = await this.pathExists(path.join(this.workDir, "core", "service.bat"));
		const serviceProfile = service.installed ? await this.readServiceProfile() : null;
		const coreVersion = provisioned ? await this.readCoreVersion() : sourceRuntime?.version ?? null;
		const standaloneState = await this.readStandaloneState();
		const integratedProcesses = await this.listIntegratedWinwsProcesses();
		const standaloneRunning = !service.running && integratedProcesses.length > 0;
		const standalonePid = standaloneRunning && standaloneState?.pid ? standaloneState.pid : standaloneRunning ? integratedProcesses[0]?.pid ?? null : null;
		const standaloneProfile = standaloneRunning ? standaloneState?.profile ?? null : null;
		const runningStartedAt = service.running ? integratedProcesses[0]?.startedAt ?? null : standaloneRunning ? standaloneState?.startedAt ?? integratedProcesses[0]?.startedAt ?? null : null;
		const runningStartedMs = runningStartedAt ? Date.parse(runningStartedAt) : NaN;
		const uptimeMs = Number.isFinite(runningStartedMs) ? Math.max(0, Date.now() - runningStartedMs) : null;
		const drivers = await this.getDriverStatuses();
		const gameFilterMode = provisioned ? await this.readGameFilterMode() : "disabled";
		const ipsetMode = provisioned ? await this.readIpsetMode() : "loaded";
		const updateChecksEnabled = provisioned ? await this.areUpdateChecksEnabled() : false;
		const conflictItems = (await this.findServiceNamesByPatterns([
			"AdGuard",
			"GoodbyeDPI",
			"discordfix_zapret",
			"CloudflareWARP",
			"Cloudflare WARP",
			"WireGuard",
			"Wintun",
			"Npcap",
			"zapret",
			"winws"
		])).filter((name) => name.toLowerCase() !== SERVICE_NAME.toLowerCase()).map((name) => ({
			kind: "service",
			name
		}));
		const suspension = buildZapretSuspensionState(this.suspendedByVpnMode, this.suspendedProfileDuringVpn);
		if (!standaloneRunning && standaloneState) await this.clearStandaloneState();
		return {
			available: true,
			provisioned,
			workDir: this.workDir,
			serviceName: SERVICE_NAME,
			serviceInstalled: service.installed,
			serviceRunning: service.running,
			serviceProfile,
			standaloneRunning,
			standalonePid,
			standaloneProfile,
			startedAt: runningStartedAt,
			uptimeMs,
			winwsRunning: service.running || standaloneRunning,
			drivers,
			gameFilterMode,
			ipsetMode,
			updateChecksEnabled,
			coreVersion,
			currentProfile: serviceProfile ?? standaloneProfile ?? null,
			conflictMatrix: findZapretConflicts(conflictItems),
			suspension,
			recoveryPlan: buildZapretRecoveryPlan({
				suspendedByVpn: suspension.active,
				serviceInstalled: service.installed,
				serviceRunning: service.running,
				standaloneRunning,
				staleIntegratedProcesses: integratedProcesses.length
			}),
			lastError: this.lastError
		};
	}
	async listProfiles() {
		await this.ensureProvisioned();
		const coreDir = path.join(this.workDir, "core");
		const entries = await promises.readdir(coreDir, { withFileTypes: true }).catch(() => []);
		const profiles = [];
		if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "general.bat")) profiles.push({
			name: DEFAULT_PROFILE_NAME,
			fileName: "general.bat"
		});
		const dynamicProfiles = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".bat")).filter((entry) => {
			const lower = entry.name.toLowerCase();
			return lower !== "general.bat" && !PROFILE_FILE_EXCLUDES.has(lower) && !lower.startsWith("__noupdate__");
		}).map((entry) => ({
			name: path.parse(entry.name).name,
			fileName: entry.name
		})).sort((left, right) => compareZapretProfileNames(left.name, right.name));
		return [...profiles, ...dynamicProfiles];
	}
	async getUserLists() {
		await this.ensureProvisioned();
		return {
			generalDomains: await this.readUserListEntries("generalDomains"),
			includedCidrs: await this.readUserListEntries("includedCidrs"),
			excludedDomains: await this.readUserListEntries("excludedDomains"),
			excludedCidrs: await this.readUserListEntries("excludedCidrs")
		};
	}
	async dryRunProfile(profileName = DEFAULT_PROFILE_NAME) {
		await this.ensureProvisioned();
		const { profile, args } = await this.buildServiceCommand(profileName);
		return buildZapretDryRunProfile(profile.name, args);
	}
	async saveUserLists(nextLists) {
		await this.ensureProvisioned();
		const normalizedLists = this.normalizeUserLists(nextLists);
		const listsDir = path.join(this.workDir, "core", "lists");
		await promises.mkdir(listsDir, { recursive: true });
		await Promise.all(Object.keys(USER_LIST_FILE_NAMES).map(async (key) => {
			const fileName = USER_LIST_FILE_NAMES[key];
			const placeholder = DEFAULT_USER_LIST_PLACEHOLDERS[key];
			const filePath = path.join(listsDir, fileName);
			await promises.writeFile(filePath, serializeZapretListEntries(normalizedLists[key], placeholder), "utf8");
		}));
		this.lastError = null;
		return this.reapplyAfterUserListsChange();
	}
	async installService(profileName = DEFAULT_PROFILE_NAME) {
		await this.ensureProvisioned();
		await this.assertNoExternalConflict();
		try {
			const { profile, args, winwsPath } = await this.buildServiceCommand(profileName);
			await this.deleteServiceIfPresent(SERVICE_NAME);
			await this.installWrappedService(profile.name, winwsPath, args);
			if (!this.coreService) await this.execSc([
				"description",
				SERVICE_NAME,
				SERVICE_DESCRIPTION
			]);
			if (!this.coreService) await this.configureServiceAutostartRecovery();
			if (this.coreService) await this.coreService.setZapretProfile(profile.name);
			else await this.execReg([
				"add",
				`HKLM\\SYSTEM\\CurrentControlSet\\Services\\${SERVICE_NAME}`,
				"/v",
				"EgoistShieldProfile",
				"/t",
				"REG_SZ",
				"/d",
				profile.name,
				"/f"
			]);
			this.lastError = null;
			await this.startService();
			this.invalidateStatusCache();
			return this.status({ force: true });
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			logger.warn("[zapret] Service install failed:", error);
			throw error;
		}
	}
	async setServiceProfile(profileName) {
		await this.ensureProvisioned();
		await this.assertNoExternalConflict();
		await this.assertStandaloneStopped();
		const service = await this.queryService(SERVICE_NAME);
		if (!service.installed) throw new Error("Служба Zapret ещё не установлена.");
		const shouldRestart = service.running;
		const { profile, args, winwsPath } = await this.buildServiceCommand(profileName);
		await this.deleteServiceIfPresent(SERVICE_NAME);
		await this.installWrappedService(profile.name, winwsPath, args);
		if (!this.coreService) await this.execSc([
			"description",
			SERVICE_NAME,
			SERVICE_DESCRIPTION
		]);
		if (!this.coreService) await this.configureServiceAutostartRecovery();
		if (this.coreService) await this.coreService.setZapretProfile(profile.name);
		else await this.execReg([
			"add",
			`HKLM\\SYSTEM\\CurrentControlSet\\Services\\${SERVICE_NAME}`,
			"/v",
			"EgoistShieldProfile",
			"/t",
			"REG_SZ",
			"/d",
			profile.name,
			"/f"
		]);
		if (shouldRestart) await this.startService();
		this.lastError = null;
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async startService() {
		await this.ensureProvisioned();
		await this.assertNoExternalConflict();
		const service = await this.queryService(SERVICE_NAME);
		if (!service.installed) throw new Error("Служба Zapret ещё не установлена.");
		if (this.coreService) await this.coreService.installOwnedService(SERVICE_NAME);
		const restoreStandalone = await this.prepareStandaloneForServiceStart();
		try {
			await this.stopStaleWinwsBeforeServiceStart();
			await this.execSc(["config", SERVICE_NAME, "start=", "auto"]);
			if (!service.running) {
				if (this.coreService) await this.coreService.startOwnedService(SERVICE_NAME);
				else try {
					await this.startWrappedService();
				} catch (error) {
					if (!isScAlreadyRunningError(error)) {
						logger.warn("[zapret] Wrapped service start failed, falling back to sc start:", error);
						await this.execSc(["start", SERVICE_NAME]);
					}
				}
				await this.waitForServiceState(SERVICE_NAME, ["RUNNING"], SERVICE_START_TIMEOUT_MS);
			}
			if (!await this.waitForIntegratedWinwsStart(null, ZAPRET_PROBE_START_TIMEOUT_MS)) throw new Error("Служба запущена, но принадлежащий Egoist Shield winws.exe не работает.");
			this.lastError = null;
			this.invalidateStatusCache();
			return this.status({ force: true });
		} catch (error) {
			if (!service.running) {
				try {
					await this.execSc(["config", SERVICE_NAME, "start=", "disabled"]);
					await this.stopServiceInternal(true);
					await this.stopOwnedWinwsProcesses();
				} catch (cleanupError) {
					this.lastError = `${error instanceof Error ? error.message : String(error)} Очистка: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
					throw new Error(this.lastError);
				}
			}
			await restoreStandalone();
			this.lastError = error instanceof Error ? error.message : String(error);
			logger.warn("[zapret] Service start failed:", error);
			throw error;
		}
	}
	async stopService() {
		// Explicit disconnect must remain disconnected after a reboot. Temporary
		// VPN suspension uses stopServiceInternal and preserves the startup mode.
		if ((await this.queryService(SERVICE_NAME)).installed) await this.execSc(["config", SERVICE_NAME, "start=", "disabled"]);
		await this.stopServiceInternal(true);
		await this.stopOwnedWinwsProcesses();
		this.lastError = null;
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async removeService() {
		await this.deleteServiceIfPresent(SERVICE_NAME);
		await this.stopStaleWinwsBeforeServiceStart();
		await this.cleanupDriverServicesIfSafe();
		if (this.suspendedByVpnMode === "service") this.clearVpnSuspension();
		this.lastError = null;
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async startStandalone(profileName = DEFAULT_PROFILE_NAME) {
		await this.ensureProvisioned();
		await this.assertNoExternalConflict();
		if ((await this.queryService(SERVICE_NAME)).running) throw new Error("Сначала остановите службу Zapret, затем запускайте standalone-режим.");
		await this.stopStandaloneInternal(true);
		const { profile, args, winwsPath } = await this.buildServiceCommand(profileName);
		const child = spawn(winwsPath, splitWindowsCommandLine(args), {
			cwd: path.join(this.workDir, "core"),
			detached: true,
			stdio: "ignore",
			windowsHide: true
		});
		let spawnError = null;
		child.on("error", (error) => { spawnError = error; });
		child.unref();
		try {
			await this.writeStandaloneState({
			pid: child.pid ?? null,
			profile: profile.name,
			startedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			if (!child.pid || !await this.waitForIntegratedWinwsStart(child.pid, 12e3)) {
				throw spawnError ?? new Error("winws.exe не запустился в standalone-режиме. Проверьте права администратора и драйверы.");
			}
			if (spawnError) throw spawnError;
		} catch (error) {
			await this.stopStandaloneInternal(true);
			throw error;
		}
		this.lastError = null;
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async restartStandalone(profileName = DEFAULT_PROFILE_NAME) {
		await this.stopStandaloneInternal(true);
		return this.startStandalone(profileName);
	}
	async stopStandalone() {
		await this.stopStandaloneInternal(true);
		this.lastError = null;
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async setGameFilterMode(mode) {
		await this.ensureProvisioned();
		const flagPath = path.join(this.workDir, "core", "utils", "game_filter.enabled");
		if (mode === "disabled") {
			await promises.mkdir(path.dirname(flagPath), { recursive: true });
			await promises.writeFile(flagPath, "disabled\n", "utf8");
		} else {
			await promises.mkdir(path.dirname(flagPath), { recursive: true });
			await promises.writeFile(flagPath, `${mode}\n`, "utf8");
		}
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async setIpsetMode(mode) {
		await this.ensureProvisioned();
		const { listFile, backupFile } = this.getIpsetFilePaths();
		const currentMode = await this.readIpsetMode();
		if (mode === currentMode) {
			this.invalidateStatusCache();
			return this.status({ force: true });
		}
		if ((mode === "none" || mode === "any") && currentMode === "loaded" && await this.pathExists(listFile)) await promises.copyFile(listFile, backupFile);
		if (mode === "loaded" && !await this.pathExists(backupFile)) throw new Error("Нет сохранённого ipset backup. Сначала обновите список или переключите режим из loaded.");
		await this.writeEffectiveIpsetList(mode);
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async updateIpsetList() {
		await this.ensureProvisioned();
		const { backupFile } = this.getIpsetFilePaths();
		let payload;
		try {
			payload = await this.fetchText(FLOWSEAL_IPSET_URL, 12e3);
		} catch (error) {
			throw this.wrapFlowsealNetworkError(error, "обновление списка IP для Zapret");
		}
		await promises.writeFile(backupFile, payload.endsWith("\n") ? payload : `${payload}\n`, "utf8");
		await this.writeEffectiveIpsetList();
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async setUpdateChecksEnabled(enabled) {
		await this.ensureProvisioned();
		const flagPath = path.join(this.workDir, "core", "utils", "check_updates.enabled");
		if (enabled) {
			await promises.mkdir(path.dirname(flagPath), { recursive: true });
			await promises.writeFile(flagPath, "ENABLED\n", "utf8");
		} else await promises.rm(flagPath, { force: true });
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async checkForUpdates() {
		await this.ensureProvisioned();
		const currentVersion = await this.readCoreVersion();
		let latestVersion = null;
		let releaseUrl = FLOWSEAL_RELEASES_URL;
		try {
			latestVersion = (await this.fetchText(FLOWSEAL_VERSION_URL, 8e3)).trim() || null;
		} catch (error) {
			const wrapped = this.wrapFlowsealNetworkError(error, "проверку обновлений Flowseal Core");
			this.lastError = wrapped.message;
			return {
				currentVersion,
				latestVersion: null,
				updateAvailable: false,
				releaseUrl: FLOWSEAL_RELEASES_URL,
				message: `${wrapped.message} Используется локальный Flowseal Core${currentVersion ? `: ${currentVersion}` : ""}.`
			};
		}
		try {
			const resolvedRelease = await resolveLatestGitHubRelease(FLOWSEAL_RELEASE_API_URL, {
				"User-Agent": FLOWSEAL_SCRIPT_USER_AGENT,
				Accept: "application/vnd.github+json"
			});
			const releaseTag = normalizeVersionTag(resolvedRelease.tag_name);
			releaseUrl = resolvedRelease.html_url?.trim() || (latestVersion ? buildFlowsealReleaseUrl(latestVersion) : FLOWSEAL_RELEASES_URL);
			if (releaseTag && latestVersion && !areSameFlowsealVersion(releaseTag, latestVersion)) {
				this.lastError = `Flowseal release tag mismatch: version endpoint=${latestVersion}, GitHub release=${releaseTag}.`;
				return {
					currentVersion,
					latestVersion,
					updateAvailable: false,
					releaseUrl,
					releaseVerified: false,
					releaseSource: resolvedRelease.source,
					message: `GitHub Releases Flowseal не совпадает с version.txt: latest=${latestVersion}, release=${releaseTag}. Обновление не подтверждено.`
				};
			}
			if (!latestVersion && releaseTag) latestVersion = releaseTag;
		} catch (error) {
			const wrapped = this.wrapFlowsealNetworkError(error, "проверку релиза Flowseal Core на GitHub");
			this.lastError = wrapped.message;
			return {
				currentVersion,
				latestVersion,
				updateAvailable: false,
				releaseUrl,
				releaseVerified: false,
				message: `${wrapped.message} Версия${latestVersion ? ` ${latestVersion}` : ""} не подтверждена через GitHub Releases.`
			};
		}
		const updateAvailable = Boolean(latestVersion && !areSameFlowsealVersion(currentVersion, latestVersion));
		const integrity = describeFlowsealIntegrityPolicy(latestVersion);
		return {
			currentVersion,
			latestVersion,
			updateAvailable,
			releaseUrl,
			releaseVerified: true,
			integritySource: integrity.source,
			integrityNote: integrity.note,
			message: updateAvailable ? `Доступно обновление Flowseal Core: ${latestVersion}. ${integrity.note}` : `Используется актуальная версия Core${currentVersion ? `: ${currentVersion}` : ""}`
		};
	}
	async installCoreUpdate() {
		return this.installFlowsealCoreVersion({ mode: "latest" });
	}
	async installCoreVersion(version) {
		return this.installFlowsealCoreVersion({
			mode: "specific",
			version: normalizeFlowsealInstallVersion(version)
		});
	}
	async installDiscordRescueCore() {
		return this.installCoreVersion(FLOWSEAL_DISCORD_RESCUE_VERSION);
	}
	async installFlowsealCoreVersion(request) {
		await this.recoverInterruptedCoreUpdate();
		const target = await this.resolveFlowsealInstallTarget(request);
		const currentVersion = await this.readCoreVersion();
		if (currentVersion && areSameFlowsealVersion(currentVersion, target.version)) {
			this.lastError = null;
			this.invalidateStatusCache();
			return this.status({ force: true });
		}
		const currentStatus = await this.status();
		const restoreMode = currentStatus.serviceRunning ? "service" : currentStatus.standaloneRunning ? "standalone" : "none";
		const restoreProfile = currentStatus.currentProfile ?? DEFAULT_PROFILE_NAME;
		const tempRoot = path.join(this.userDataDir, "zapret", "_update", `${target.version}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		const zipPath = path.join(tempRoot, `${target.version}.zip`);
		const extractDir = path.join(tempRoot, "extract");
		const candidateRoot = path.join(tempRoot, "candidate");
		const coreDir = path.join(this.workDir, "core");
		const previousDir = path.join(this.workDir, "core.previous");
		let stopped = false;
		let movedPrevious = false;
		let published = false;
		let journalWritten = false;
		let committed = false;
		try {
			const releaseAsset = target.release ? pickGitHubAsset(target.release, [/\.zip$/i], [/source/i, /symbols/i]) : null;
			const trustedReleaseSha256 = FLOWSEAL_TRUSTED_RELEASE_ZIP_SHA256[target.version] ?? null;
			const trustedSourceSha256 = FLOWSEAL_TRUSTED_SOURCE_ZIP_SHA256[target.version] ?? null;
			const useTrustedSourceArchive = Boolean(trustedSourceSha256);
			const archiveUrl = useTrustedSourceArchive ? buildFlowsealSourceArchiveUrl(target.version) : releaseAsset?.browser_download_url ?? buildFlowsealReleaseAssetUrl(target.version);
			const archiveName = useTrustedSourceArchive ? buildFlowsealSourceArchiveName(target.version) : releaseAsset?.name ?? buildFlowsealReleaseAssetName(target.version);
			await promises.mkdir(tempRoot, { recursive: true });
			logger.info(`[zapret] Downloading Flowseal Core ${target.version}: ${archiveUrl}`);
			await downloadFileWithProgress(archiveUrl, zipPath, void 0, {
				"User-Agent": FLOWSEAL_SCRIPT_USER_AGENT,
				Accept: "application/octet-stream"
			});
			let verification = trustedSourceSha256 || trustedReleaseSha256 ? await verifyFileSha256(zipPath, trustedSourceSha256 ?? trustedReleaseSha256) : await verifyGitHubReleaseAssetChecksum({
				filePath: zipPath,
				assetName: archiveName,
				releaseApiUrl: FLOWSEAL_RELEASE_API_URL,
				tagName: target.releaseTag,
				release: target.release,
				assetDigest: releaseAsset?.digest,
				headers: {
					"User-Agent": FLOWSEAL_SCRIPT_USER_AGENT,
					Accept: "application/vnd.github+json"
				}
			});
			if (!verification.verified && trustedReleaseSha256) {
				const trustedVerification = await verifyFileSha256(zipPath, trustedReleaseSha256);
				if (trustedVerification.verified) verification = trustedVerification;
			}
			if (!verification.verified) throw new Error(`Flowseal Core integrity verification failed: ${verification.verificationMessage}`);
			logger.info(`[zapret] Flowseal Core ${target.version} archive accepted via ${verification.integritySource}: ${archiveName}`);
			await extractZipArchive(zipPath, extractDir);
			const payloadRoot = await this.findFlowsealPayloadRoot(extractDir);
			if (!payloadRoot) throw new Error("В архиве Flowseal не найден service.bat или каталог core.");
			const candidateCore = path.join(candidateRoot, "core");
			if (await this.pathExists(coreDir)) await this.copyRuntimeTree(coreDir, candidateCore);
			if (payloadRoot.layout === "core") await this.copyRuntimeTree(payloadRoot.sourceDir, candidateCore);
			else await this.copyFlowsealRootPayload(payloadRoot.sourceDir, candidateCore);
			const candidate = Object.create(this);
			candidate.workDir = candidateRoot;
			await candidate.applyFlowsealScriptFixes(candidateCore);
			await candidate.ensureUserLists();
			await candidate.writeEffectiveIpsetList();
			await candidate.ensurePathExists(path.join(candidateCore, "service.bat"), "Flowseal archive has no service.bat");
			await candidate.ensurePathExists(path.join(candidateCore, "bin", "winws.exe"), "Flowseal archive has no winws.exe");
			this.coreUpdateInProgress = true;
			await this.writeCoreUpdateJournal({ schema: 1, phase: "prepared", previousVersion: currentVersion, targetVersion: target.version });
			journalWritten = true;
			// Downloads and validation leave the running version untouched.
			if (restoreMode === "service") { stopped = true; await this.stopServiceInternal(false); }
			else if (restoreMode === "standalone") { stopped = true; await this.stopStandaloneInternal(false); }
			await this.prepareCoreFilesForUpdate();
			await promises.rm(previousDir, { recursive: true, force: true });
			if (await this.pathExists(coreDir)) { await promises.rename(coreDir, previousDir); movedPrevious = true; }
			await promises.rename(candidateCore, coreDir);
			published = true;
			await this.writeInstalledCoreVersion(target.version);
			const installedVersion = await this.readCoreVersion();
			if (!areSameFlowsealVersion(installedVersion, target.version)) throw new Error(`Flowseal Core обновился не полностью: ожидалась версия ${target.version}, но после установки обнаружена ${installedVersion ?? "unknown"}.`);
			if (restoreMode === "service") await this.startService();
			else if (restoreMode === "standalone") await this.startStandalone(restoreProfile);
			await this.writeCoreUpdateJournal({ schema: 1, phase: "committed", previousVersion: currentVersion, targetVersion: target.version });
			committed = true;
			await promises.rm(previousDir, { recursive: true, force: true }).catch(error => logger.warn("[zapret] Previous core cleanup deferred", error));
			await promises.rm(path.join(this.workDir, "core-update.json"), { force: true }).catch(error => logger.warn("[zapret] Update journal cleanup deferred", error));
			this.lastError = null;
			this.invalidateStatusCache();
			return this.status({ force: true });
		} catch (error) {
			if (committed) throw error;
			try {
				if (published) {
					if (restoreMode === "service") await this.stopServiceInternal(false);
					else if (restoreMode === "standalone") await this.stopStandaloneInternal(false);
					await promises.rm(coreDir, { recursive: true, force: true });
				}
				if (movedPrevious) await promises.rename(previousDir, coreDir);
				if (published && currentVersion) await this.writeInstalledCoreVersion(currentVersion);
				if (stopped && restoreMode === "service") await this.startService();
				else if (stopped && restoreMode === "standalone") await this.startStandalone(restoreProfile);
				if (journalWritten) await promises.rm(path.join(this.workDir, "core-update.json"), { force: true });
			} catch (rollbackError) {
				throw new Error(`Flowseal update failed: ${error.message}; rollback failed: ${rollbackError.message}`);
			}
			this.lastError = error instanceof Error ? error.message : String(error);
			logger.warn(`[zapret] Flowseal Core ${target.version} install failed:`, error);
			throw error;
		} finally {
			this.coreUpdateInProgress = false;
			await promises.rm(tempRoot, {
				recursive: true,
				force: true
			}).catch(() => void 0);
		}
	}
	async resolveFlowsealInstallTarget(request) {
		if (request.mode === "specific") {
			const version = normalizeFlowsealInstallVersion(request.version);
			try {
				const release = await fetchGitHubReleaseByTag(FLOWSEAL_RELEASE_API_URL, version, {
					"User-Agent": FLOWSEAL_SCRIPT_USER_AGENT,
					Accept: "application/vnd.github+json"
				});
				const releaseTag = normalizeVersionTag(release.tag_name) ?? version;
				if (!areSameFlowsealVersion(releaseTag, version)) throw new Error(`Flowseal release tag mismatch: requested=${version}, GitHub release=${releaseTag}.`);
				return {
					version,
					releaseTag,
					release,
					releaseUrl: release.html_url?.trim() || buildFlowsealReleaseUrl(version)
				};
			} catch (error) {
				throw this.wrapFlowsealNetworkError(error, `получение релиза Flowseal Core ${version}`);
			}
		}
		let latestVersion = "";
		try {
			latestVersion = normalizeFlowsealInstallVersion((await this.fetchText(FLOWSEAL_VERSION_URL, 8e3)).trim());
		} catch (error) {
			throw this.wrapFlowsealNetworkError(error, "получение новой версии Flowseal Core");
		}
		const resolvedRelease = await resolveLatestGitHubRelease(FLOWSEAL_RELEASE_API_URL, {
			"User-Agent": FLOWSEAL_SCRIPT_USER_AGENT,
			Accept: "application/vnd.github+json"
		});
		const releaseTag = normalizeVersionTag(resolvedRelease.tag_name) ?? latestVersion;
		if (!areSameFlowsealVersion(releaseTag, latestVersion)) throw new Error(`Flowseal release tag mismatch: version endpoint=${latestVersion}, GitHub release=${releaseTag}.`);
		return {
			version: latestVersion,
			releaseTag,
			release: resolvedRelease.release,
			releaseUrl: resolvedRelease.html_url?.trim() || buildFlowsealReleaseUrl(latestVersion)
		};
	}
	async runCoreUpdater() {
		logger.warn("[zapret] Deprecated runCoreUpdater() call suppressed; use integrated Flowseal Core UI");
		return buildDeprecatedConsoleMessage("updater");
	}
	async openServiceMenu() {
		logger.warn("[zapret] Deprecated openServiceMenu() call suppressed; use integrated Zapret service controls");
		return buildDeprecatedConsoleMessage("service-menu");
	}
	async runFlowsealTests() {
		await this.ensureProvisioned();
		const scriptPath = path.join(this.workDir, "core", "utils", "test zapret.ps1");
		await this.ensurePathExists(scriptPath, "test zapret.ps1 не найден.");
		await this.launchConsoleCommand(resolveWindowsExecutable("powershell.exe"), [
			"-NoExit",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			scriptPath
		], { cwd: path.dirname(scriptPath) });
		return buildCommandResult("Открыта отдельная консоль проверки Flowseal test zapret.ps1.", { opened: true });
	}
	async cleanDiscordCache(target) {
		const plan = buildDiscordCacheCleanupPlan(target);
		const killedProcesses = await this.killImageNames(plan.processNames);
		const removedDirectories = await this.removeExistingDirectories(plan.directories);
		const title = plan.labels.length > 1 ? "Discord-клиентов" : plan.labels[0] ?? "Discord";
		const summary = removedDirectories.length > 0 ? `Кеш ${title} очищен.` : `Кеш ${title} не найден, но активные процессы были аккуратно завершены.`;
		const outputLines = [
			`Targets: ${plan.labels.join(", ") || "Discord"}`,
			`Processes stopped: ${killedProcesses.join(", ") || "нет активных процессов"}`,
			`Removed cache folders: ${removedDirectories.length}`
		];
		if (removedDirectories.length > 0) {
			const listedDirectories = removedDirectories.slice(0, 12);
			outputLines.push(...listedDirectories.map((directory) => `- ${directory}`));
			if (removedDirectories.length > listedDirectories.length) outputLines.push(`... и ещё ${removedDirectories.length - listedDirectories.length} папок`);
		}
		outputLines.push("Local Storage, токены и пользовательские настройки не затрагивались.");
		return buildCommandResult(summary, { output: outputLines.join("\n") });
	}
	async resetNetworkState() {
		await this.stopStandaloneInternal(true);
		await this.deleteServiceIfPresent(SERVICE_NAME);
		await this.cleanupDriverServicesIfSafe();
		this.lastError = null;
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async runDiagnostics() {
		await this.ensureProvisioned();
		const [service, driverStatuses, secureDnsEnabled, tcpTimestampsEnabled, proxyInfo, adguardRunning, bfeRunning] = await Promise.all([
			this.queryService(SERVICE_NAME),
			this.getDriverStatuses(),
			this.hasSecureDns(),
			this.hasTcpTimestampsEnabled(),
			this.readSystemProxyInfo(),
			this.isNamedProcessRunning("AdguardSvc"),
			this.queryService("BFE").then((item) => item.running).catch(() => false)
		]);
		const winwsRunning = await this.isWinwsRunning();
		const vpnServices = await this.findServiceNamesByPatterns(["VPN"]);
		const killerServices = await this.findServiceNamesByPatterns(["Killer"]);
		const checkpointServices = await this.findServiceNamesByPatterns(["TracSrvWrapper", "EPWD"]);
		const smartByteServices = await this.findServiceNamesByPatterns(["SmartByte"]);
		const intelConnectivityServices = await this.findServiceNamesByPatterns([
			"Intel",
			"Connectivity",
			"Network"
		]);
		const conflictingServices = await this.findServiceNamesByPatterns([...DIAGNOSTIC_CONFLICT_SERVICES]);
		const hostsWarning = await this.hostsFileContains(["youtube.com", "youtu.be"]);
		const items = [
			{
				key: "bfe",
				title: "Base Filtering Engine",
				state: bfeRunning ? "ok" : "error",
				details: bfeRunning ? "Служба BFE запущена." : "Служба BFE не запущена. Без неё WinDivert/Zapret не будет работать корректно."
			},
			{
				key: "proxy",
				title: "Системный прокси Windows",
				state: proxyInfo.enabled ? "warn" : "ok",
				details: proxyInfo.enabled ? `Включён системный прокси: ${proxyInfo.server || "значение не прочитано"}.` : "Системный прокси отключён."
			},
			{
				key: "tcp-timestamps",
				title: "TCP timestamps",
				state: tcpTimestampsEnabled ? "ok" : "warn",
				details: tcpTimestampsEnabled ? "TCP timestamps включены." : "TCP timestamps выключены. Flowseal рекомендует включить их для стабильной работы."
			},
			{
				key: "secure-dns",
				title: "Secure DNS",
				state: secureDnsEnabled ? "ok" : "warn",
				details: secureDnsEnabled ? "Обнаружены признаки настроенного secure DNS." : "Secure DNS не обнаружен. Часть проблем с доступом может упираться в DNS."
			},
			{
				key: "adguard",
				title: "AdGuard",
				state: adguardRunning ? "warn" : "ok",
				details: adguardRunning ? "Найден активный AdGuard. Он может конфликтовать с Discord/WinDivert." : "AdGuard не обнаружен."
			},
			{
				key: "killer",
				title: "Killer Services",
				state: killerServices.length > 0 ? "warn" : "ok",
				details: killerServices.length > 0 ? `Найдены сервисы Killer: ${killerServices.join(", ")}.` : "Конфликтующих Killer-сервисов не найдено."
			},
			{
				key: "intel-connectivity",
				title: "Intel Connectivity Network Service",
				state: intelConnectivityServices.length > 0 ? "warn" : "ok",
				details: intelConnectivityServices.length > 0 ? `Найдены сервисы Intel Connectivity: ${intelConnectivityServices.join(", ")}.` : "Конфликтов Intel Connectivity не найдено."
			},
			{
				key: "checkpoint",
				title: "Check Point",
				state: checkpointServices.length > 0 ? "warn" : "ok",
				details: checkpointServices.length > 0 ? `Найдены сервисы Check Point: ${checkpointServices.join(", ")}.` : "Сервисы Check Point не обнаружены."
			},
			{
				key: "smartbyte",
				title: "SmartByte",
				state: smartByteServices.length > 0 ? "warn" : "ok",
				details: smartByteServices.length > 0 ? `Найдены сервисы SmartByte: ${smartByteServices.join(", ")}.` : "SmartByte не обнаружен."
			},
			{
				key: "vpn-services",
				title: "Сторонние VPN-сервисы",
				state: vpnServices.length > 0 ? "warn" : "ok",
				details: vpnServices.length > 0 ? `Найдены сервисы с VPN в имени: ${vpnServices.join(", ")}.` : "Сторонних VPN-сервисов не найдено."
			},
			{
				key: "hosts",
				title: "Hosts override",
				state: hostsWarning ? "warn" : "ok",
				details: hostsWarning ? "В hosts найдены записи для YouTube. Это может ломать доступ даже при рабочем профиле." : "Подозрительных записей YouTube в hosts не найдено."
			},
			{
				key: "drivers",
				title: "WinDivert drivers",
				state: driverStatuses.some((driver) => driver.running && !winwsRunning) ? "warn" : "ok",
				details: driverStatuses.map((driver) => `${driver.name}: ${driver.running ? "RUNNING" : driver.installed ? "INSTALLED" : "ABSENT"}`).join(" · ")
			},
			{
				key: "bypass",
				title: "Активный bypass",
				state: winwsRunning || service.running ? "ok" : "warn",
				details: service.running ? `Служба ${SERVICE_NAME} активна.` : winwsRunning ? "Обнаружен активный standalone winws.exe." : "Активный winws.exe не обнаружен."
			},
			{
				key: "conflicts",
				title: "Известные конфликтующие bypass-сервисы",
				state: conflictingServices.length > 0 ? "warn" : "ok",
				details: conflictingServices.length > 0 ? `Найдены: ${conflictingServices.join(", ")}.` : "Известных конфликтующих bypass-сервисов не найдено."
			}
		];
		const errorCount = items.filter((item) => item.state === "error").length;
		const warnCount = items.filter((item) => item.state === "warn").length;
		return {
			generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			summary: errorCount > 0 ? `Найдены критические проблемы: ${errorCount}, предупреждения: ${warnCount}.` : warnCount > 0 ? `Критических проблем нет, предупреждений: ${warnCount}.` : "Критических проблем и предупреждений не обнаружено.",
			items
		};
	}
	async cancelAutoSelect() {
		// The sweep owns cleanup. Concurrent teardown could race a pending spawn.
		this.autoSelectController?.abort();
		return { ok: true, message: "Остановка автоподбора запрошена." };
	}
	async autoSelectBestProfile(onProgress) {
		if (this.autoSelectController) throw new Error("Автоподбор уже выполняется.");
		const controller = new AbortController();
		this.autoSelectController = controller;
		const signal = controller.signal;
		const startedAt = new Date().toISOString();
		const results = [], testedProfiles = [], goodProfiles = [], badProfiles = [];
		let orderedProfiles = [], rememberedProfile = null, fingerprint = null, cancelled = false;
		let runtimePrepared = false;
		const emit = (event) => {
			// A closed renderer must not interrupt process cleanup or invalidate measurements.
			try { onProgress?.({ startedAt, testedAt: new Date().toISOString(), ...event }); }
			catch (error) { logger.warn("[zapret] Progress delivery failed:", error); }
		};
		try {
			emit({ phase: "preparing" });
			throwIfAutoSelectCancelled(signal);
			await this.resetOwnedRuntimeBeforeAutoSelect();
			runtimePrepared = true;
			throwIfAutoSelectCancelled(signal);
			await this.ensureProvisioned();
			throwIfAutoSelectCancelled(signal);
			const profiles = await this.listProfiles();
			this.probeProfiles = profiles;
			fingerprint = computeZapretNetworkFingerprint();
			rememberedProfile = (await this.readAutoSelectMemory(fingerprint))?.profile ?? null;
			orderedProfiles = orderZapretProfilesForAutoSelect(profiles, rememberedProfile);
			emit({ phase: "start", total: orderedProfiles.length });
			for (const [index, profile] of orderedProfiles.entries()) {
				throwIfAutoSelectCancelled(signal);
				emit({ phase: "profile-start", profile: profile.name, index: index + 1, total: orderedProfiles.length });
				let result;
				try {
					await this.startProbeStandalone(profile.name, signal);
					throwIfAutoSelectCancelled(signal);
					const probe = await this.probeZapretTargets(signal);
					throwIfAutoSelectCancelled(signal);
					if (!(await this.listIntegratedWinwsProcesses()).length) throw new Error("winws.exe завершился во время проверки.");
					result = {
						id: profile.name, configId: profile.name, configName: profile.name,
						result: probe.healthy ? "success" : "error", pingMs: probe.averagePingMs,
						testedAt: new Date().toISOString(), passedTargets: probe.targets.filter((target) => target.ok).length,
						totalTargets: probe.targets.length, confident: probe.confident, targets: probe.targets,
						verification: "https-endpoints", videoPlaybackVerified: false
					};
				} catch (error) {
					throwIfAutoSelectCancelled(signal);
					logger.warn("[zapret] Auto-select probe failed:", profile.name, error);
					result = {
						id: profile.name, configId: profile.name, configName: profile.name, result: "error",
						pingMs: null, testedAt: new Date().toISOString(), passedTargets: 0,
						totalTargets: AUTO_SELECT_TARGETS.length, confident: false, targets: [],
						error: error instanceof Error ? error.message : String(error),
						verification: "https-endpoints", videoPlaybackVerified: false
					};
				} finally {
					// A failed stop aborts the entire sweep; never overlap WinDivert candidates.
					await this.stopProbeStandalone();
				}
				throwIfAutoSelectCancelled(signal);
				results.push(result);
				testedProfiles.push(profile.name);
				(result.result === "success" ? goodProfiles : badProfiles).push(profile.name);
				emit({ phase: "profile-result", profile: profile.name, index: index + 1, total: orderedProfiles.length,
					result: result.result, pingMs: result.pingMs, targets: result.targets, error: result.error,
					confidence: result.confident ? "high" : result.result === "success" ? "medium" : "none" });
				if (result.confident) break;
			}
		} catch (error) {
			if (error instanceof ZapretAutoSelectCancelledError) cancelled = true;
			else {
				this.lastError = error instanceof Error ? error.message : String(error);
				emit({ phase: "error", error: this.lastError, total: orderedProfiles.length, testedProfiles: testedProfiles.length });
				throw error;
			}
		} finally {
			try {
				if (runtimePrepared) await this.stopProbeStandalone();
			} finally {
				this.probeProfiles = null;
				this.invalidateStatusCache();
				if (this.autoSelectController === controller) this.autoSelectController = null;
			}
		}
		cancelled ||= signal.aborted;
		const bestResult = cancelled ? null : results.filter((result) => result.result === "success").sort(compareZapretAutoSelectCandidates)[0];
		const discord = countZapretProbeGroup(bestResult?.targets ?? [], "Discord");
		const youtube = countZapretProbeGroup(bestResult?.targets ?? [], "YouTube");
		const usedRememberedProfile = Boolean(rememberedProfile && bestResult?.configName === rememberedProfile);
		const earlyExit = !cancelled && Boolean(bestResult?.confident) && testedProfiles.length < orderedProfiles.length;
		const summary = summarizeZapretAutoSelect({
			cancelled, bestProfile: bestResult?.configName ?? null, bestPassedTargets: bestResult?.passedTargets ?? 0,
			bestTotalTargets: bestResult?.totalTargets ?? AUTO_SELECT_TARGETS.length, bestPingMs: bestResult?.pingMs ?? null,
			discordPassed: discord.passed, discordTotal: discord.total, youTubePassed: youtube.passed, youTubeTotal: youtube.total,
			confident: bestResult?.confident === true, testedProfiles: testedProfiles.length,
			totalProfiles: orderedProfiles.length, usedRememberedProfile
		});
		const detail = summary.detail + " Проверена доступность HTTPS-узлов; воспроизведение видео, 4K и голос Discord не проверялись.";
		if (!cancelled && bestResult) await this.writeAutoSelectMemory(fingerprint, {
			profile: bestResult.configName, savedAt: new Date().toISOString(), passedTargets: bestResult.passedTargets,
			totalTargets: bestResult.totalTargets, pingMs: bestResult.pingMs, confident: bestResult.confident
		});
		emit({ phase: cancelled ? "cancelled" : "complete", bestProfile: bestResult?.configName ?? null,
			total: orderedProfiles.length, testedProfiles: testedProfiles.length, summary: summary.headline,
			detail, confidence: summary.confidence, earlyExit, verification: "https-endpoints", videoPlaybackVerified: false });
		return {
			completed: !cancelled, cancelled, bestProfile: bestResult?.configName ?? null,
			goodProfiles, badProfiles, testedProfiles, results, testResults: results,
			summary: summary.headline, detail, confidence: summary.confidence, earlyExit,
			totalProfiles: orderedProfiles.length, rememberedProfile, usedRememberedProfile,
			verification: "https-endpoints", videoPlaybackVerified: false
		};
	}
	async resetOwnedRuntimeBeforeAutoSelect() {
		await this.assertNoExternalConflict();
		await this.stopServiceInternal(true);
		await this.stopStandaloneInternal(true);
		if ((await this.queryService(SERVICE_NAME)).running) throw new Error("Служба EgoistShieldZapret ещё работает. Автоподбор остановлен.");
		if ((await this.listIntegratedWinwsProcesses()).length) throw new Error("Процесс Egoist Shield winws.exe ещё работает. Автоподбор остановлен.");
		this.clearVpnSuspension();
		this.lastError = null;
	}
	/**
	* Lean per-profile start used only by auto-select. `startStandalone()` also
	* re-provisions the runtime, re-queries services and rebuilds the full status
	* (a `Get-Service` sweep over every service on the machine); doing that once
	* per profile added several seconds per candidate without changing what the
	* probes measure. The runtime is already provisioned and conflict-checked by
	* `autoSelectBestProfile` before the loop starts.
	*/
	async startProbeStandalone(profileName, signal) {
		throwIfAutoSelectCancelled(signal);
		if ((await this.listIntegratedWinwsProcesses()).length) throw new Error("Предыдущий кандидат winws.exe ещё работает.");
		const { profile, args, winwsPath } = await this.buildServiceCommand(profileName);
		throwIfAutoSelectCancelled(signal);
		const child = spawn(winwsPath, splitWindowsCommandLine(args), {
			cwd: path.join(this.workDir, "core"), detached: false, stdio: "ignore", windowsHide: true
		});
		let spawnError = null;
		child.on("error", (error) => { spawnError = error; });
		const pid = child.pid ?? null;
		await this.writeStandaloneState({ pid, profile: profile.name, startedAt: new Date().toISOString() });
		await sleep(ZAPRET_PROBE_SETTLE_MS);
		throwIfAutoSelectCancelled(signal);
		if (spawnError) throw spawnError;
		if (!pid || !await this.waitForIntegratedWinwsStart(pid, ZAPRET_PROBE_START_TIMEOUT_MS, signal)) throw new Error(
			`Профиль «${profile.name}»: winws.exe не запустился. Проверьте права администратора и совместимость драйвера WinDivert.`
		);
	}
	/**
	* Closing owned winws processes releases their handles. The shared driver
	* service is deliberately retained for other applications.
	*/
	async stopProbeStandalone() {
		await this.stopOwnedWinwsProcesses(ZAPRET_PROBE_STOP_TIMEOUT_MS);
		await this.clearStandaloneState();
	}
	async stopOwnedWinwsProcesses(timeoutMs = ZAPRET_PROBE_STOP_TIMEOUT_MS) {
		const owned = await this.listIntegratedWinwsProcesses();
		for (const info of owned) {
			// Revalidate the executable at the point of mutation; saved PIDs can be recycled.
			await this.execPowerShell(`$p = Get-CimInstance Win32_Process -Filter "ProcessId=${info.pid}" -ErrorAction Stop; if ($p -and $p.ExecutablePath -ieq ${psQuote(path.join(this.workDir, "core", "bin", "winws.exe"))}) { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop }`, 8e3);
		}
		const deadline = Date.now() + timeoutMs;
		do {
			if (!(await this.listIntegratedWinwsProcesses()).length) return;
			await sleep(120);
		} while (Date.now() < deadline);
		throw new Error("Не удалось остановить принадлежащий Egoist Shield winws.exe. Новый кандидат не запущен.");
	}
	isPidAlive(pid) {
		if (!Number.isInteger(pid) || pid <= 0) return false;
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			return error?.code === "EPERM";
		}
	}
	getAutoSelectMemoryPath() {
		return path.join(this.workDir, ZAPRET_AUTO_SELECT_MEMORY_FILE);
	}
	async readAutoSelectMemoryFile() {
		try {
			const parsed = JSON.parse(await promises.readFile(this.getAutoSelectMemoryPath(), "utf8"));
			if (parsed?.version !== ZAPRET_AUTO_SELECT_MEMORY_VERSION || typeof parsed.entries !== "object" || parsed.entries === null) return {
				version: ZAPRET_AUTO_SELECT_MEMORY_VERSION,
				entries: {}
			};
			return {
				version: ZAPRET_AUTO_SELECT_MEMORY_VERSION,
				entries: parsed.entries
			};
		} catch {
			return {
				version: ZAPRET_AUTO_SELECT_MEMORY_VERSION,
				entries: {}
			};
		}
	}
	async readAutoSelectMemory(fingerprint) {
		const entry = (await this.readAutoSelectMemoryFile()).entries[fingerprint];
		return entry && typeof entry.profile === "string" && entry.profile.trim() ? entry : null;
	}
	async writeAutoSelectMemory(fingerprint, entry) {
		try {
			const memory = await this.readAutoSelectMemoryFile();
			memory.entries[fingerprint] = entry;
			const sorted = Object.entries(memory.entries).sort((left, right) => Date.parse(right[1]?.savedAt ?? "") - Date.parse(left[1]?.savedAt ?? ""));
			memory.entries = Object.fromEntries(sorted.slice(0, ZAPRET_AUTO_SELECT_MEMORY_MAX_ENTRIES));
			await promises.mkdir(this.workDir, { recursive: true });
			await promises.writeFile(this.getAutoSelectMemoryPath(), `${JSON.stringify(memory, null, 2)}\n`, "utf8");
		} catch (error) {
			logger.warn("[zapret] Failed to persist auto-select memory:", error);
		}
	}
	async stopLegacyZapretServicesBeforeAutoSelect() {
		await this.assertNoExternalConflict();
	}
	async stopAllWinwsBeforeAutoSelect() {
		await this.assertNoExternalConflict();
		await this.stopOwnedWinwsProcesses();
	}
	async prepareForVpn(suspendDuringVpn) {
		if (!suspendDuringVpn || this.suspendedByVpnMode !== "none") return;
		if ((await this.queryService(SERVICE_NAME)).running) {
			this.suspendedByVpnMode = "service";
			this.suspendedProfileDuringVpn = await this.readServiceProfile();
			await this.stopServiceInternal(false);
			return;
		}
		const standaloneStatus = await this.status();
		if (standaloneStatus.standaloneRunning) {
			this.suspendedByVpnMode = "standalone";
			this.suspendedProfileDuringVpn = standaloneStatus.standaloneProfile ?? standaloneStatus.currentProfile;
			await this.stopStandaloneInternal(false);
		}
	}
	async restoreAfterVpnIfNeeded(suspendDuringVpn, preferredProfile = DEFAULT_PROFILE_NAME, { skipIdleStatus = false } = {}) {
		if (!suspendDuringVpn || this.suspendedByVpnMode === "none") {
			this.clearVpnSuspension();
			this.invalidateStatusCache();
			if (skipIdleStatus) return null;
			return this.status({ force: true });
		}
		const profile = this.suspendedProfileDuringVpn ?? preferredProfile;
		if (this.suspendedByVpnMode === "service") {
			const serviceProfile = await this.readServiceProfile();
			if (!(await this.queryService(SERVICE_NAME)).installed) await this.installService(profile);
			else if (serviceProfile && serviceProfile !== profile) {
				await this.setServiceProfile(profile);
				await this.startService();
			} else await this.startService();
		} else if (this.suspendedByVpnMode === "standalone") await this.startStandalone(profile);
		this.clearVpnSuspension();
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	clearVpnSuspension() {
		this.suspendedByVpnMode = "none";
		this.suspendedProfileDuringVpn = null;
	}
	async stopServiceInternal(clearVpnSuspension) {
		const service = await this.queryService(SERVICE_NAME);
		if (!service.installed) {
			if (clearVpnSuspension && this.suspendedByVpnMode === "service") this.clearVpnSuspension();
			return;
		}
		if (service.running) {
			try {
				if (this.coreService) await this.coreService.stopOwnedService(SERVICE_NAME);
				else await this.execSc(["stop", SERVICE_NAME]);
			} catch (error) {
				if (!isScNotActiveError(error)) {
					this.lastError = error instanceof Error ? error.message : String(error);
					throw error;
				}
			}
			await this.waitForServiceState(SERVICE_NAME, ["STOPPED"], 2e4);
		}
		if (clearVpnSuspension && this.suspendedByVpnMode === "service") this.clearVpnSuspension();
		await this.cleanupDriverServicesIfSafe();
	}
	async stopStandaloneInternal(clearVpnSuspension) {
		if (!(await this.queryService(SERVICE_NAME)).running) await this.stopOwnedWinwsProcesses();
		await this.clearStandaloneState();
		if (clearVpnSuspension && this.suspendedByVpnMode === "standalone") this.clearVpnSuspension();
	}
	async prepareStandaloneForServiceStart() {
		const currentStatus = await this.status();
		if (!currentStatus.standaloneRunning) {
			await this.stopStaleWinwsBeforeServiceStart();
			return async () => {};
		}
		const profileToRestore = currentStatus.standaloneProfile ?? currentStatus.currentProfile ?? DEFAULT_PROFILE_NAME;
		await this.stopStandaloneInternal(true);
		return async () => {
			try {
				if ((await this.queryService(SERVICE_NAME)).running) return;
				await this.startStandalone(profileToRestore);
			} catch (error) {
				logger.warn("[zapret] Failed to restore standalone after service transition error:", error);
			}
		};
	}
	async stopStaleWinwsBeforeServiceStart() {
		if (!(await this.queryService(SERVICE_NAME)).running) await this.stopOwnedWinwsProcesses();
	}
	async assertStandaloneStopped() {
		if ((await this.status()).standaloneRunning) throw new Error("Сначала остановите standalone-режим Zapret, затем запускайте службу.");
	}
	async buildServiceCommand(profileName, knownProfiles = this.probeProfiles) {
		const profile = (knownProfiles ?? await this.listProfiles()).find((item) => item.name === profileName);
		if (!profile) throw new Error(`Профиль Zapret "${profileName}" не найден.`);
		return {
			profile,
			args: applyZapretPlaceholders(parseZapretWinwsArgs(await promises.readFile(path.join(this.workDir, "core", profile.fileName), "utf8")), {
				BIN: ensureTrailingSlash(path.join(this.workDir, "core", "bin")),
				LISTS: ensureTrailingSlash(path.join(this.workDir, "core", "lists")),
				...await this.readGameFilterValues()
			}),
			winwsPath: path.join(this.workDir, "core", "bin", "winws.exe")
		};
	}
	getServiceWrapperPaths() {
		const wrapperDir = path.join(this.workDir, SERVICE_WRAPPER_DIR);
		return {
			wrapperDir,
			wrapperPath: path.join(wrapperDir, SERVICE_WRAPPER_EXE),
			xmlPath: path.join(wrapperDir, SERVICE_WRAPPER_XML)
		};
	}
	async installWrappedService(profileName, winwsPath, args) {
		const { wrapperDir, wrapperPath, xmlPath } = this.getServiceWrapperPaths();
		await this.ensurePathExists(wrapperPath, "Service wrapper WinSW для Zapret не найден в runtime.");
		await promises.mkdir(wrapperDir, { recursive: true });
		await promises.mkdir(path.join(this.workDir, "logs", "zapret-service"), { recursive: true });
		await promises.writeFile(xmlPath, this.buildServiceWrapperXml(profileName, winwsPath, args), "utf8");
		if (this.coreService) await this.coreService.installOwnedService(SERVICE_NAME);
		else await execFileAsync$1(wrapperPath, ["install"], {
			cwd: wrapperDir,
			windowsHide: true,
			timeout: 3e4
		});
	}
	async startWrappedService() {
		const { wrapperDir, wrapperPath } = this.getServiceWrapperPaths();
		await this.ensurePathExists(wrapperPath, "Service wrapper WinSW для Zapret не найден в runtime.");
		await execFileAsync$1(wrapperPath, ["start"], {
			cwd: wrapperDir,
			windowsHide: true,
			timeout: 3e4
		});
	}
	async configureServiceAutostartRecovery() {
		const commands = [
			[
				"config",
				SERVICE_NAME,
				"start=",
				"auto"
			],
			[
				"failure",
				SERVICE_NAME,
				"reset=",
				"86400",
				"actions=",
				"restart/5000/restart/10000/restart/30000"
			],
			[
				"config",
				SERVICE_NAME,
				"depend=",
				"Tcpip/Afd"
			],
			[
				"failureflag",
				SERVICE_NAME,
				"1"
			]
		];
		for (const args of commands) try {
			await this.execSc(args);
		} catch (error) {
			logger.warn("[zapret] Service autostart/recovery configuration failed:", args.join(" "), error);
		}
		try {
			await this.execReg([
				"add",
				`HKLM\\SYSTEM\\CurrentControlSet\\Services\\${SERVICE_NAME}`,
				"/v",
				"DelayedAutoStart",
				"/t",
				"REG_DWORD",
				"/d",
				"0",
				"/f"
			]);
		} catch (error) {
			logger.warn("[zapret] Service delayed autostart flag failed:", error);
		}
	}
	buildServiceWrapperXml(profileName, winwsPath, args) {
		const logDir = path.join(this.workDir, "logs", "zapret-service");
		return [
			"<service>",
			`  <id>${escapeXmlText(SERVICE_NAME)}</id>`,
			`  <name>${escapeXmlText(SERVICE_DISPLAY_NAME)}</name>`,
			`  <description>${escapeXmlText(`${SERVICE_DESCRIPTION}. Profile: ${profileName}`)}</description>`,
			"  <startmode>Automatic</startmode>",
			"  <delayedAutoStart>false</delayedAutoStart>",
			`  <executable>${escapeXmlText(winwsPath)}</executable>`,
			`  <arguments>${escapeXmlText(args)}</arguments>`,
			`  <workingdirectory>${escapeXmlText(path.join(this.workDir, "core"))}</workingdirectory>`,
			"  <stoptimeout>15 sec</stoptimeout>",
			"  <stopparentprocessfirst>false</stopparentprocessfirst>",
			`  <logpath>${escapeXmlText(logDir)}</logpath>`,
			"  <log mode=\"roll-by-size\">",
			"    <sizeThreshold>10485760</sizeThreshold>",
			"    <keepFiles>5</keepFiles>",
			"  </log>",
			"  <onfailure action=\"restart\" delay=\"5 sec\" />",
			"  <onfailure action=\"restart\" delay=\"10 sec\" />",
			"</service>",
			""
		].join("\n");
	}
	async ensureProvisioned() {
		if (!this.coreUpdateInProgress) await this.recoverInterruptedCoreUpdate();
		const versionFile = path.join(this.workDir, "VERSION.txt");
		const installedVersion = await this.readVersion(versionFile);
		const coreServicePath = path.join(this.workDir, "core", "service.bat");
		const wrapperPath = path.join(this.workDir, SERVICE_WRAPPER_DIR, SERVICE_WRAPPER_EXE);
		const hasProvisionedCore = await this.pathExists(coreServicePath);
		const hasServiceWrapper = await this.pathExists(wrapperPath);
		const runtime = await this.getSourceRuntimeInfo();
		if (!runtime) {
			if (hasProvisionedCore && hasServiceWrapper) {
				logger.warn("[zapret] Bundled runtime is missing; using already provisioned userData runtime.");
				await this.ensureUserLists();
				await this.applyFlowsealScriptFixes(path.join(this.workDir, "core"));
				await this.writeEffectiveIpsetList();
				return;
			}
			logger.warn("[zapret] Bundled runtime is missing; downloading Flowseal Core before continuing.");
			await this.installFlowsealCoreVersion({ mode: "latest" });
			return;
		}
		await promises.mkdir(this.workDir, { recursive: true });
		if (!hasProvisionedCore) await this.copyRuntimeTree(runtime.sourceDir, this.workDir);
		else if (!hasServiceWrapper) await this.copyRuntimeTree(path.join(runtime.sourceDir, SERVICE_WRAPPER_DIR), path.join(this.workDir, SERVICE_WRAPPER_DIR));
		await this.ensureUserLists();
		await this.applyFlowsealScriptFixes(path.join(this.workDir, "core"));
		await this.writeEffectiveIpsetList();
		await this.unblockDriverFiles();
		const { xmlPath } = this.getServiceWrapperPaths();
		if (await this.pathExists(xmlPath)) {
			try {
				const currentXml = await promises.readFile(xmlPath, "utf8");
				if (currentXml.includes("quic_initial_dbankcloud_ru.bin") || currentXml.includes("AppData\\Roaming")) {
					logger.warn("[zapret] Detected outdated/invalid service wrapper XML; regenerating...");
					const currentStatus = await this.status().catch(() => null);
					const currentProfile = currentStatus?.serviceProfile ?? currentStatus?.currentProfile ?? DEFAULT_PROFILE_NAME;
					const { profile, args, winwsPath } = await this.buildServiceCommand(currentProfile);
					await promises.writeFile(xmlPath, this.buildServiceWrapperXml(profile.name, winwsPath, args), "utf8");
				}
			} catch (xmlError) {
				logger.warn("[zapret] Failed to inspect or repair service wrapper XML:", xmlError);
			}
		}
	}
	async unblockDriverFiles() {
		try {
			const binDir = path.join(this.workDir, "core", "bin");
			if (await this.pathExists(binDir)) {
				await this.execPowerShell(`Get-ChildItem -Path ${psQuote(binDir)} -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue`, 6e3);
			}
		} catch (error) {
			logger.warn("[zapret] Driver unblock skipped or failed:", error);
		}
	}
	async writeCoreUpdateJournal(value) {
		await promises.mkdir(this.workDir, { recursive: true });
		const journalPath = path.join(this.workDir, "core-update.json");
		const temporaryPath = journalPath + ".tmp";
		const handle = await promises.open(temporaryPath, "w");
		try { await handle.writeFile(JSON.stringify(value), "utf8"); await handle.sync(); }
		finally { await handle.close(); }
		await promises.rename(temporaryPath, journalPath);
	}
	async recoverInterruptedCoreUpdate() {
		if (this.coreUpdateInProgress) return;
		if (this.coreRecoveryPromise) return this.coreRecoveryPromise;
		this.coreRecoveryPromise = this.recoverCoreUpdateFiles();
		try { return await this.coreRecoveryPromise; }
		finally { this.coreRecoveryPromise = null; }
	}
	async recoverCoreUpdateFiles() {
		const coreDir = path.join(this.workDir, "core");
		const previousDir = path.join(this.workDir, "core.previous");
		const journalPath = path.join(this.workDir, "core-update.json");
		let journal = null;
		try { journal = JSON.parse(await promises.readFile(journalPath, "utf8")); }
		catch (error) { if (error.code !== "ENOENT") throw new Error("Zapret update journal cannot be read; runtime files were preserved."); }
		if (journal && (journal.schema !== 1 || !["prepared", "committed"].includes(journal.phase))) throw new Error("Unknown Zapret update journal; runtime files were preserved.");
		const hasPrevious = await this.pathExists(previousDir);
		const hasCore = await this.pathExists(coreDir);
		if (journal?.phase === "committed" && hasCore) {
			await promises.rm(previousDir, { recursive: true, force: true });
		} else if (hasPrevious && (journal || !hasCore)) {
			await this.stopServiceInternal(false);
			await this.stopStandaloneInternal(false);
			if (hasCore) await promises.rm(coreDir, { recursive: true, force: true });
			await promises.rename(previousDir, coreDir);
			if (typeof journal?.previousVersion === "string") await this.writeInstalledCoreVersion(journal.previousVersion);
			logger.warn("[zapret] Interrupted core update restored; network components remain stopped.");
		}
		if (journal) await promises.rm(journalPath, { force: true });
	}
	async copyRuntimeTree(sourceDir, destinationDir) {
		const stack = [{
			sourceDir,
			destinationDir
		}];
		while (stack.length > 0) {
			const current = stack.pop();
			if (!current) continue;
			await promises.mkdir(current.destinationDir, { recursive: true });
			const entries = await promises.readdir(current.sourceDir, { withFileTypes: true });
			for (const entry of entries) {
				const sourcePath = path.join(current.sourceDir, entry.name);
				const destinationPath = path.join(current.destinationDir, entry.name);
				if (entry.isDirectory()) {
					stack.push({
						sourceDir: sourcePath,
						destinationDir: destinationPath
					});
					continue;
				}
				if (this.shouldPreserveDestinationFile(destinationPath) && await this.pathExists(destinationPath)) continue;
				await this.copyFileWithRetry(sourcePath, destinationPath);
			}
		}
	}
	async copyFlowsealRootPayload(sourceDir, destinationDir) {
		await promises.mkdir(destinationDir, { recursive: true });
		const entries = await promises.readdir(sourceDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!isFlowsealRootPayloadEntry(entry.name, entry.isDirectory())) continue;
			const sourcePath = path.join(sourceDir, entry.name);
			const destinationPath = path.join(destinationDir, entry.name);
			if (entry.isDirectory()) {
				await this.copyRuntimeTree(sourcePath, destinationPath);
				continue;
			}
			if (this.shouldPreserveDestinationFile(destinationPath) && await this.pathExists(destinationPath)) continue;
			await this.copyFileWithRetry(sourcePath, destinationPath);
		}
	}
	shouldPreserveDestinationFile(filePath) {
		const normalized = filePath.replace(/\//g, "\\").toLowerCase();
		return normalized.endsWith("-user.txt") || normalized.endsWith(".backup") || normalized.endsWith("\\core\\utils\\game_filter.enabled") || normalized.endsWith("\\core\\utils\\check_updates.enabled");
	}
	async prepareCoreFilesForUpdate() {
		await this.cleanupDriverServicesIfSafe();
		await new Promise((resolve) => setTimeout(resolve, 900));
	}
	async copyFileWithRetry(sourcePath, destinationPath, maxAttempts = 6) {
		await promises.mkdir(path.dirname(destinationPath), { recursive: true });
		for (let attempt = 1; attempt <= maxAttempts; attempt += 1) try {
			await promises.copyFile(sourcePath, destinationPath);
			return;
		} catch (error) {
			if (!this.isRetriableCopyError(error) || attempt === maxAttempts) throw error;
			await new Promise((resolve) => setTimeout(resolve, attempt * 350));
		}
	}
	isRetriableCopyError(error) {
		if (!(error instanceof Error)) return false;
		const nodeError = error;
		return nodeError.code === "EBUSY" || nodeError.code === "EPERM" || nodeError.code === "EACCES";
	}
	async applyFlowsealScriptFixes(coreDir) {
		await this.patchFlowsealServiceScript(path.join(coreDir, "service.bat"));
		await this.patchFlowsealUpdateScript(path.join(coreDir, "fast", "update_service.bat"));
	}
	async patchFlowsealServiceScript(scriptPath) {
		if (!await this.pathExists(scriptPath)) return;
		const lines = (await promises.readFile(scriptPath, "utf8")).split(/\r?\n/);
		let changed = false;
		const localVersionIndex = lines.findIndex((line) => line.startsWith("set \"LOCAL_VERSION="));
		if (localVersionIndex >= 0) {
			const currentBlock = lines.slice(localVersionIndex, localVersionIndex + FLOWSEAL_SERVICE_LOCAL_VERSION_LINES.length);
			if (currentBlock.length !== FLOWSEAL_SERVICE_LOCAL_VERSION_LINES.length || currentBlock.some((line, index) => line !== FLOWSEAL_SERVICE_LOCAL_VERSION_LINES[index])) {
				lines.splice(localVersionIndex, 1, ...FLOWSEAL_SERVICE_LOCAL_VERSION_LINES);
				changed = true;
			}
		}
		const versionFetchIndex = lines.findIndex((line) => line.includes("set \"GITHUB_VERSION=%%A\"") && line.includes("Invoke-WebRequest"));
		if (versionFetchIndex >= 0 && lines[versionFetchIndex] !== FLOWSEAL_SERVICE_VERSION_FETCH_LINE) {
			lines[versionFetchIndex] = FLOWSEAL_SERVICE_VERSION_FETCH_LINE;
			changed = true;
		}
		if (changed) await promises.writeFile(scriptPath, `${lines.join("\r\n").replace(/\r\n+$/u, "")}\r\n`, "utf8");
	}
	async patchFlowsealUpdateScript(scriptPath) {
		if (!await this.pathExists(scriptPath)) return;
		if (await promises.readFile(scriptPath, "utf8") === FLOWSEAL_UPDATE_SCRIPT_TEMPLATE) return;
		await promises.writeFile(scriptPath, FLOWSEAL_UPDATE_SCRIPT_TEMPLATE, "utf8");
	}
	async ensureUserLists() {
		const listsDir = path.join(this.workDir, "core", "lists");
		await promises.mkdir(listsDir, { recursive: true });
		for (const [fileName, defaultContent] of Object.entries(DEFAULT_USER_LIST_FILES)) {
			const filePath = path.join(listsDir, fileName);
			if (!await this.pathExists(filePath)) await promises.writeFile(filePath, defaultContent, "utf8");
		}
	}
	normalizeUserLists(nextLists) {
		return {
			generalDomains: normalizeZapretDomainEntries(nextLists.generalDomains, DEFAULT_USER_LIST_PLACEHOLDERS.generalDomains),
			includedCidrs: normalizeZapretNetworkEntries(nextLists.includedCidrs, DEFAULT_USER_LIST_PLACEHOLDERS.includedCidrs),
			excludedDomains: normalizeZapretDomainEntries(nextLists.excludedDomains, DEFAULT_USER_LIST_PLACEHOLDERS.excludedDomains),
			excludedCidrs: normalizeZapretNetworkEntries(nextLists.excludedCidrs, DEFAULT_USER_LIST_PLACEHOLDERS.excludedCidrs)
		};
	}
	async readUserListEntries(key) {
		const fileName = USER_LIST_FILE_NAMES[key];
		const placeholder = DEFAULT_USER_LIST_PLACEHOLDERS[key];
		return parseZapretListFile(await promises.readFile(path.join(this.workDir, "core", "lists", fileName), "utf8").catch(() => ""), placeholder);
	}
	getIpsetFilePaths() {
		const listFile = path.join(this.workDir, "core", "lists", "ipset-all.txt");
		return {
			listFile,
			backupFile: `${listFile}.backup`
		};
	}
	async readBaseIpsetEntries() {
		const { listFile, backupFile } = this.getIpsetFilePaths();
		const sourcePath = await this.pathExists(backupFile) ? backupFile : listFile;
		return parseIpsetEntries(await promises.readFile(sourcePath, "utf8").catch(() => ""));
	}
	async writeEffectiveIpsetList(mode) {
		const nextMode = mode ?? await this.readIpsetMode();
		const { listFile } = this.getIpsetFilePaths();
		if (nextMode === "none") {
			await promises.writeFile(listFile, "203.0.113.113/32\n", "utf8");
			return;
		}
		if (nextMode === "any") {
			await promises.writeFile(listFile, "", "utf8");
			return;
		}
		const baseEntries = await this.readBaseIpsetEntries();
		const includedCidrs = await this.readUserListEntries("includedCidrs");
		await promises.writeFile(listFile, serializeIpsetEntries(dedupeNormalizedEntries([...baseEntries, ...includedCidrs])), "utf8");
	}
	async reapplyAfterUserListsChange() {
		await this.writeEffectiveIpsetList();
		const currentStatus = await this.status();
		if (currentStatus.serviceRunning) return this.setServiceProfile(currentStatus.serviceProfile ?? currentStatus.currentProfile ?? DEFAULT_PROFILE_NAME);
		if (currentStatus.standaloneRunning) return this.restartStandalone(currentStatus.standaloneProfile ?? currentStatus.currentProfile ?? DEFAULT_PROFILE_NAME);
		this.invalidateStatusCache();
		return this.status({ force: true });
	}
	async readGameFilterValues() {
		const mode = await this.readGameFilterMode();
		if (mode === "all") return {
			GameFilter: "1024-65535",
			GameFilterTCP: "1024-65535",
			GameFilterUDP: "1024-65535"
		};
		if (mode === "tcp") return {
			GameFilter: "1024-65535",
			GameFilterTCP: "1024-65535",
			GameFilterUDP: "12"
		};
		if (mode === "udp") return {
			GameFilter: "1024-65535",
			GameFilterTCP: "12",
			GameFilterUDP: "1024-65535"
		};
		return {
			GameFilter: "12",
			GameFilterTCP: "12",
			GameFilterUDP: "12"
		};
	}
	async readGameFilterMode() {
		const flagPath = path.join(this.workDir, "core", "utils", "game_filter.enabled");
		const raw = await promises.readFile(flagPath, "utf8").catch(() => null);
		if (raw == null) return "all";
		const mode = raw.trim().toLowerCase();
		if (mode === "all" || mode === "tcp" || mode === "udp") return mode;
		return "disabled";
	}
	async readIpsetMode() {
		const listFile = path.join(this.workDir, "core", "lists", "ipset-all.txt");
		const trimmedLines = (await promises.readFile(listFile, "utf8").catch(() => "")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
		if (trimmedLines.length === 0) return "any";
		return trimmedLines.length === 1 && trimmedLines[0] === "203.0.113.113/32" ? "none" : "loaded";
	}
	async areUpdateChecksEnabled() {
		return this.pathExists(path.join(this.workDir, "core", "utils", "check_updates.enabled"));
	}
	async assertNoExternalConflict() {
		for (const serviceName of LEGACY_ZAPRET_RESET_SERVICES) if ((await this.queryService(serviceName).catch(() => ({ running: false }))).running) throw new Error(`Работает сторонняя служба ${serviceName}. Остановите её перед запуском Egoist Shield.`);
		const serviceRunning = (await this.queryService(SERVICE_NAME).catch(() => ({ running: false }))).running;
		const external = (await this.listWinwsProcesses()).filter((info) => !this.isOwnedWinwsProcess(info, serviceRunning));
		if (external.length) throw new Error("Работает сторонний winws.exe. Остановите его перед запуском Egoist Shield.");
	}
	async cleanupDriverServicesIfSafe() {
		// WinDivert driver services are shared system resources, not owned services.
		// Closing our winws handles releases interception without deleting other users' drivers.
	}
	async isWinwsRunning() {
		return (await this.listWinwsProcesses()).length > 0;
	}
	async listWinwsProcesses() {
		try {
			const trimmed = (await this.execPowerShell("$ErrorActionPreference = 'Stop'; $procs = Get-CimInstance Win32_Process -Filter \"Name='winws.exe'\" | Select-Object ProcessId, ExecutablePath, CommandLine, CreationDate; if (-not $procs) { '[]' } else { $procs | ConvertTo-Json -Compress }", 12e3)).trim();
			if (!trimmed) throw new Error("Пустой ответ проверки процессов.");
			const parsed = JSON.parse(trimmed);
			return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({
				pid: Number(entry.ProcessId ?? 0),
				commandLine: String(entry.CommandLine ?? ""),
				executablePath: String(entry.ExecutablePath ?? ""),
				startedAt: parseWmiDateToIso(entry.CreationDate)
			})).filter((entry) => entry.pid > 0);
		} catch (error) {
			throw new Error(`Не удалось проверить процессы winws.exe: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	async listIntegratedWinwsProcesses() {
		const serviceRunning = (await this.queryService(SERVICE_NAME).catch(() => ({ running: false }))).running;
		return (await this.listWinwsProcesses()).filter((info) => this.isOwnedWinwsProcess(info, serviceRunning));
	}
	isOwnedWinwsProcess(info, serviceRunning = false) {
		const expected = path.resolve(this.workDir, "core", "bin", "winws.exe").toLowerCase();
		if (info.executablePath) {
			return path.resolve(info.executablePath).toLowerCase() === expected;
		}
		if (serviceRunning && !info.executablePath && !info.commandLine) {
			return true;
		}
		return false;
	}
	async waitForIntegratedWinwsStart(expectedPid, timeoutMs, signal) {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			throwIfAutoSelectCancelled(signal);
			const processes = await this.listIntegratedWinwsProcesses();
			if (expectedPid && processes.some((processInfo) => processInfo.pid === expectedPid)) return true;
			if (!expectedPid && processes.length > 0) return true;
			await sleep(300);
		}
		return false;
	}
	async probeZapretTargets(signal) {
		throwIfAutoSelectCancelled(signal);
		const jobs = this.buildZapretProbeJobs(signal);
		const checks = await runWithBoundedConcurrency(jobs, ZAPRET_PROBE_MAX_PARALLEL, (job) => job.run());
		const targets = this.collectZapretProbeTargets(jobs, checks);
		const reachableTargets = targets.filter((target) => target.ok);
		return {
			healthy: this.isZapretProbeHealthy(targets),
			confident: isConfidentZapretProbe(targets),
			averagePingMs: averageProbePing(reachableTargets.map((target) => target.pingMs)),
			targets
		};
	}
	buildZapretProbeJobs(signal) {
		const jobs = [];
		for (const target of AUTO_SELECT_TARGETS) {
			if ("pingTarget" in target) {
				jobs.push({
					key: target.key,
					run: () => this.probePingTarget(target.pingTarget, ZAPRET_PROBE_PING_TIMEOUT_MS, signal)
				});
				continue;
			}
			for (const variant of ZAPRET_CURL_FALLBACK_VARIANTS) jobs.push({
				key: target.key,
				run: () => this.probeCurlHeadUrl(target.url, ZAPRET_PROBE_HTTP_TIMEOUT_MS, variant.label, [...variant.args], signal)
			});
		}
		return jobs;
	}
	collectZapretProbeTargets(jobs, checks) {
		return AUTO_SELECT_TARGETS.map((target) => {
			const targetChecks = checks.filter((_check, index) => jobs[index]?.key === target.key);
			const okCheck = targetChecks.find((check) => check.ok);
			const primaryCheck = okCheck ?? targetChecks[0] ?? null;
			const ok = Boolean(okCheck);
			if ("pingTarget" in target) return {
				key: target.key,
				label: target.label,
				url: `PING:${target.pingTarget}`,
				ok,
				pingMs: primaryCheck?.pingMs ?? null,
				status: null,
				error: ok ? null : primaryCheck?.error ?? "ping probe failed",
				checks: targetChecks
			};
			return {
				key: target.key,
				label: target.label,
				url: target.url,
				urls: [target.url],
				ok,
				pingMs: primaryCheck?.pingMs ?? null,
				status: primaryCheck?.status ?? null,
				error: ok ? null : targetChecks.map((check) => check.error).filter(Boolean).join("; ") || "curl checks failed",
				checks: targetChecks
			};
		});
	}
	isZapretProbeHealthy(targets) {
		const successfulTargets = targets.filter((target) => target.ok);
		return ["DiscordMain", "DiscordGateway", "YouTubeWeb", "YouTubeImage"].every((key) => successfulTargets.some((target) => target.key === key));
	}
	async probeCurlHeadUrl(url, timeoutMs, label, tlsArgs, signal) {
		const startedAt = Date.now();
		const timeoutSeconds = Math.max(2, Math.ceil(timeoutMs / 1e3));
		try {
			throwIfAutoSelectCancelled(signal);
			const { stdout, stderr } = await execFileAsync$1(resolveWindowsExecutable("curl.exe"), [
				"-q",
				"--noproxy",
				"*",
				"--connect-timeout",
				String(timeoutSeconds),
				"--location",
				"--max-redirs",
				"3",
				"--max-filesize",
				"2097152",
				"-s",
				"-m",
				String(timeoutSeconds),
				"-o",
				"NUL",
				"-w",
				"%{http_code}",
				"--show-error",
				...tlsArgs,
				url
			], {
				signal,
				timeout: timeoutMs + 5e3,
				windowsHide: true
			});
			const status = parseCurlStatusCode(stdout);
			const pingMs = Math.max(1, Date.now() - startedAt);
			return {
				url: `${url} [${label}]`,
				ok: status !== null && status >= 200 && status < 400,
				pingMs,
				status,
				method: "http",
				error: status === null ? normalizeCurlProbeError(stderr) : status >= 400 ? `HTTP ${status}` : null
			};
		} catch (error) {
			throwIfAutoSelectCancelled(signal);
			const stdout = typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout ?? "") : "";
			const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr ?? "") : "";
			const status = parseCurlStatusCode(stdout);
			return {
				url: `${url} [${label}]`,
				ok: false,
				pingMs: status !== null ? Math.max(1, Date.now() - startedAt) : null,
				status,
				method: "http",
				error: normalizeCurlProbeError(stderr || (error instanceof Error ? error.message : String(error)))
			};
		}
	}
	async probePingTarget(target, timeoutMs, signal) {
		const startedAt = Date.now();
		const url = `PING:${target}`;
		const pingTimeoutMs = Math.max(1e3, Math.min(timeoutMs, ZAPRET_PROBE_PING_TIMEOUT_MS));
		try {
			throwIfAutoSelectCancelled(signal);
			const { stdout, stderr } = await execFileAsync$1(resolveWindowsExecutable("ping.exe"), [
				"-n",
				String(ZAPRET_PROBE_PING_COUNT),
				"-w",
				String(pingTimeoutMs),
				target
			], {
				signal,
				timeout: pingTimeoutMs * ZAPRET_PROBE_PING_COUNT + 2e3,
				windowsHide: true
			});
			return {
				url,
				ok: true,
				pingMs: parsePingAverageMs(`${stdout}\n${stderr}`) ?? Math.max(1, Date.now() - startedAt),
				status: null,
				method: "ping",
				error: null
			};
		} catch (error) {
			throwIfAutoSelectCancelled(signal);
			const pingMs = parsePingAverageMs(typeof error === "object" && error !== null ? `${"stdout" in error ? String(error.stdout ?? "") : ""}\n${"stderr" in error ? String(error.stderr ?? "") : ""}` : "");
			return {
				url,
				ok: pingMs !== null,
				pingMs,
				status: null,
				method: "ping",
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async getDriverStatuses() {
		const statuses = [];
		for (const driver of DRIVER_SERVICES) {
			const service = await this.queryService(driver);
			statuses.push({
				name: driver,
				installed: service.installed,
				running: service.running
			});
		}
		return statuses;
	}
	async hasSecureDns() {
		try {
			const output = await this.execPowerShell("Get-ChildItem -Recurse -Path 'HKLM:System\\CurrentControlSet\\Services\\Dnscache\\InterfaceSpecificParameters\\' | Get-ItemProperty | Where-Object { $_.DohFlags -gt 0 } | Measure-Object | Select-Object -ExpandProperty Count", 1e4);
			return Number.parseInt(output.trim(), 10) > 0;
		} catch {
			return false;
		}
	}
	async hasTcpTimestampsEnabled() {
		try {
			const { stdout } = await execFileAsync$1(resolveWindowsExecutable("netsh.exe"), [
				"interface",
				"tcp",
				"show",
				"global"
			], {
				windowsHide: true,
				timeout: 8e3
			});
			return /timestamps/i.test(stdout) && /enabled/i.test(stdout);
		} catch {
			return false;
		}
	}
	async readSystemProxyInfo() {
		try {
			const enableOutput = await execFileAsync$1(resolveWindowsExecutable("reg.exe"), [
				"query",
				"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
				"/v",
				"ProxyEnable"
			], {
				windowsHide: true,
				timeout: 8e3
			});
			if (!/0x1/i.test(enableOutput.stdout)) return {
				enabled: false,
				server: null
			};
			return {
				enabled: true,
				server: (await execFileAsync$1(resolveWindowsExecutable("reg.exe"), [
					"query",
					"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
					"/v",
					"ProxyServer"
				], {
					windowsHide: true,
					timeout: 8e3
				})).stdout.match(/ProxyServer\s+REG_\w+\s+(.+)$/im)?.[1]?.trim() ?? null
			};
		} catch {
			return {
				enabled: false,
				server: null
			};
		}
	}
	async isNamedProcessRunning(processName) {
		try {
			const output = await this.execPowerShell(`(Get-Process -Name ${psQuote(processName)} -ErrorAction SilentlyContinue | Measure-Object).Count`, 8e3);
			return Number.parseInt(output.trim(), 10) > 0;
		} catch {
			return false;
		}
	}
	async hostsFileContains(needles) {
		try {
			const hostsFile = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts");
			const content = (await promises.readFile(hostsFile, "utf8")).toLowerCase();
			return needles.some((needle) => content.includes(needle.toLowerCase()));
		} catch {
			return false;
		}
	}
	async findServiceNamesByPatterns(patterns) {
		const command = "Get-Service | Where-Object { " + patterns.map((pattern) => `($_.Name -match ${psQuote(pattern)} -or $_.DisplayName -match ${psQuote(pattern)})`).join(" -or ") + " } | Sort-Object Name | Select-Object -ExpandProperty Name";
		try {
			return (await this.execPowerShell(command, 12e3)).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
		} catch {
			return [];
		}
	}
	async readCoreVersion() {
		const installedVersion = await this.readVersion(path.join(this.workDir, "VERSION.txt"));
		if (installedVersion) return installedVersion;
		const sourceRuntime = await this.getSourceRuntimeInfo();
		if (sourceRuntime?.version) return sourceRuntime.version;
		const servicePath = path.join(this.workDir, "core", "service.bat");
		const parsedVersion = (await promises.readFile(servicePath, "utf8").catch(() => "")).match(/LOCAL_VERSION\s*=\s*"?([^"\r\n]+)"?/i)?.[1]?.trim() ?? null;
		return parsedVersion && parsedVersion.toLowerCase() !== "unknown" ? parsedVersion : null;
	}
	async writeInstalledCoreVersion(version) {
		await promises.mkdir(this.workDir, { recursive: true });
		await promises.writeFile(path.join(this.workDir, "VERSION.txt"), `${version.trim()}\n`, "utf8");
	}
	async readStandaloneState() {
		const statePath = path.join(this.workDir, STANDALONE_STATE_FILE);
		try {
			const raw = await promises.readFile(statePath, "utf8");
			const parsed = JSON.parse(raw);
			return {
				pid: typeof parsed.pid === "number" ? parsed.pid : null,
				profile: typeof parsed.profile === "string" ? parsed.profile : null,
				startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : (/* @__PURE__ */ new Date()).toISOString()
			};
		} catch {
			return null;
		}
	}
	async writeStandaloneState(next) {
		await promises.mkdir(this.workDir, { recursive: true });
		await promises.writeFile(path.join(this.workDir, STANDALONE_STATE_FILE), JSON.stringify(next, null, 2), "utf8");
	}
	async clearStandaloneState() {
		await promises.rm(path.join(this.workDir, STANDALONE_STATE_FILE), { force: true });
	}
	async waitForServiceState(serviceName, expectedStates, timeoutMs) {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			const service = await this.queryService(serviceName);
			if (!service.installed && expectedStates.includes("DELETED")) return;
			if (service.state && expectedStates.includes(service.state)) return;
			await sleep(500);
		}
		throw new Error(`Служба ${serviceName} не перешла в состояние ${expectedStates.join(" / ")} за ${timeoutMs}мс.`);
	}
	async deleteServiceIfPresent(serviceName) {
		const service = await this.queryService(serviceName);
		if (!service.installed) return;
		if (this.coreService && serviceName === SERVICE_NAME) {
			await this.coreService.removeOwnedService(SERVICE_NAME);
			await this.waitForServiceState(serviceName, ["DELETED"], 12e3);
			return;
		}
		if (service.running) {
			try {
				await this.execSc(["stop", serviceName]);
			} catch (error) {
				if (!isScNotActiveError(error)) throw error;
			}
			await this.waitForServiceState(serviceName, ["STOPPED"], 2e4);
		}
		try {
			await this.execSc(["delete", serviceName]);
		} catch (error) {
			if (!isWindowsServiceMissingError(error)) throw error;
		}
		await this.waitForServiceState(serviceName, ["DELETED"], 12e3);
	}
	async queryService(serviceName) {
		try {
			const { stdout } = await execFileAsync$1(resolveWindowsExecutable("sc.exe"), ["query", serviceName], {
				windowsHide: true,
				timeout: 8e3
			});
			const state = parseScQueryState(stdout);
			return {
				installed: true,
				running: state === "RUNNING",
				state
			};
		} catch (error) {
			if (isWindowsServiceMissingError(error)) return {
				installed: false,
				running: false,
				state: null
			};
			logger.warn("[zapret] Service query failed:", serviceName, error);
			throw error;
		}
	}
	async readServiceProfile() {
		try {
			const { stdout } = await execFileAsync$1(resolveWindowsExecutable("reg.exe"), [
				"query",
				`HKLM\\SYSTEM\\CurrentControlSet\\Services\\${SERVICE_NAME}`,
				"/v",
				"EgoistShieldProfile"
			], {
				windowsHide: true,
				timeout: 6e3
			});
			return stdout.match(/EgoistShieldProfile\s+REG_SZ\s+(.+)$/im)?.[1]?.trim() ?? null;
		} catch {
			return null;
		}
	}
	async execSc(args) {
		await execFileAsync$1(resolveWindowsExecutable("sc.exe"), args, {
			windowsHide: true,
			timeout: 2e4
		});
	}
	async execReg(args) {
		await execFileAsync$1(resolveWindowsExecutable("reg.exe"), args, {
			windowsHide: true,
			timeout: 1e4
		});
	}
	async execPowerShell(command, timeoutMs = 8e3) {
		const { stdout } = await execFileAsync$1(resolveWindowsExecutable("powershell.exe"), [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			command
		], {
			windowsHide: true,
			timeout: timeoutMs
		});
		return stdout;
	}
	async fetchText(url, timeoutMs) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, {
				cache: "no-store",
				headers: {
					"user-agent": FLOWSEAL_SCRIPT_USER_AGENT,
					accept: "text/plain, text/html;q=0.9, */*;q=0.8",
					"cache-control": "no-cache",
					pragma: "no-cache"
				},
				signal: controller.signal
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return await response.text();
		} finally {
			clearTimeout(timer);
		}
	}
	wrapFlowsealNetworkError(error, operation) {
		if (error instanceof Error) {
			if (error.name === "AbortError") return /* @__PURE__ */ new Error(`Не удалось выполнить ${operation}: сервер Flowseal не ответил вовремя.`);
			if (error.message.includes("HTTP 403")) return /* @__PURE__ */ new Error(`Не удалось выполнить ${operation}: сервер Flowseal временно отклонил запрос (HTTP 403). Продолжаем работать на локальном Core и попробуем снова позже.`);
			return error;
		}
		return /* @__PURE__ */ new Error(`Не удалось выполнить ${operation}: ${String(error)}`);
	}
	async launchConsoleCommand(executable, args, options) {
		await execFileAsync$1(resolveWindowsExecutable("powershell.exe"), [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			[
				`$filePath = ${quotePowerShellLiteral(executable)}`,
				`$workingDirectory = ${quotePowerShellLiteral(options.cwd)}`,
				`Start-Process -FilePath $filePath -WorkingDirectory $workingDirectory -ArgumentList @(${toPowerShellArgumentList(args)}) -WindowStyle Normal`
			].join("; ")
		], {
			windowsHide: true,
			timeout: 1e4
		});
	}
	async killImageNames(imageNames) {
		const killed = [];
		for (const imageName of imageNames) try {
			await execFileAsync$1(resolveWindowsExecutable("taskkill.exe"), [
				"/F",
				"/T",
				"/IM",
				imageName
			], {
				windowsHide: true,
				timeout: 8e3
			});
			killed.push(imageName);
		} catch (error) {
			if (this.isMissingProcessError(error)) continue;
			logger.warn("[zapret] Failed to stop process before cache cleanup:", imageName, error);
		}
		return killed;
	}
	isMissingProcessError(error) {
		const message = getCommandFailureText(error);
		return /not found|no running instance|128/i.test(message);
	}
	async removeExistingDirectories(targets) {
		const removed = [];
		for (const target of targets) {
			if (!await this.pathExists(target)) continue;
			await promises.rm(target, {
				recursive: true,
				force: true,
				maxRetries: 2
			});
			removed.push(target);
		}
		return removed;
	}
	async findFirstDirectory(rootDir) {
		const directory = (await promises.readdir(rootDir, { withFileTypes: true }).catch(() => null))?.find((entry) => entry.isDirectory());
		return directory ? path.join(rootDir, directory.name) : null;
	}
	async findFlowsealPayloadRoot(rootDir) {
		const queue = [rootDir];
		const visited = /* @__PURE__ */ new Set();
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current || visited.has(current)) continue;
			visited.add(current);
			const nestedCoreDir = path.join(current, "core");
			if (await this.pathExists(path.join(nestedCoreDir, "service.bat"))) return {
				sourceDir: nestedCoreDir,
				layout: "core"
			};
			if (await this.pathExists(path.join(current, "service.bat"))) return {
				sourceDir: current,
				layout: "root"
			};
			const entries = await promises.readdir(current, { withFileTypes: true }).catch(() => []);
			for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith(".")) queue.push(path.join(current, entry.name));
		}
		return null;
	}
	async ensurePathExists(targetPath, errorMessage) {
		if (!await this.pathExists(targetPath)) throw new Error(errorMessage);
	}
	async getSourceRuntimeInfo() {
		const execResourcesPath = path.join(path.dirname(process.execPath), "resources");
		const candidates = [
			path.join(this.resourcesPath, "runtime", "zapret"),
			path.join(this.resourcesPath, "resources", "runtime", "zapret"),
			path.join(this.appPath, "runtime", "zapret"),
			path.join(this.appPath, "resources", "runtime", "zapret"),
			path.join(execResourcesPath, "runtime", "zapret"),
			path.join(execResourcesPath, "resources", "runtime", "zapret"),
			path.join(process.cwd(), "runtime", "zapret"),
			path.join(process.cwd(), "resources", "runtime", "zapret")
		];
		for (const candidate of candidates) if (await this.pathExists(path.join(candidate, "core", "service.bat"))) return {
			sourceDir: candidate,
			version: await this.readVersion(path.join(candidate, "VERSION.txt"))
		};
		return null;
	}
	async readVersion(versionPath) {
		try {
			return (await promises.readFile(versionPath, "utf8")).trim() || null;
		} catch {
			return null;
		}
	}
	async pathExists(targetPath) {
		try {
			await promises.access(targetPath);
			return true;
		} catch {
			return false;
		}
	}
};
//#endregion
