//#region src/electron/ipc/ipc-schemas.ts
/**
* Zod-схемы для валидации IPC inputs.
* Используются в handlers.ts для type-safe парсинга входящих данных из renderer.
*/
var NodeProtocolSchema = z.enum([
	"vless",
	"vmess",
	"trojan",
	"shadowsocks",
	"socks",
	"http",
	"hysteria2",
	"tuic",
	"wireguard"
]);
var RuleModeSchema = z.enum([
	"vpn",
	"direct",
	"block"
]);
var RouteModeSchema = z.enum(["global", "selected"]);
var DnsModeSchema = z.enum([
	"auto",
	"secure",
	"system",
	"custom"
]);
var ZapretGameFilterModeSchema = z.enum([
	"disabled",
	"all",
	"tcp",
	"udp"
]);
var ZapretIpsetModeSchema = z.enum([
	"loaded",
	"none",
	"any"
]);
var ZapretDiscordCacheTargetSchema = z.enum([
	"all",
	"discord",
	"discord-ptb",
	"discord-canary",
	"vesktop"
]);
var SubscriptionUserAgentSchema = z.enum([
	"auto",
	"egoistshield",
	"v2rayn",
	"singbox",
	"nekobox",
	"mihomo",
	"clash-verge",
	"clash-for-windows",
	"shadowrocket",
	"loon",
	"quantumultx",
	"surge",
	"curl"
]);
var HEX_32_RE = /^[a-f0-9]{32}$/i;
var TELEGRAM_DC_IP_RE = /^\d+:[a-z0-9.:-]+$/i;
function isPrivateIpv4(host) {
	const parts = host.split(".").map((part) => Number.parseInt(part, 10));
	if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;
	const [a = -1, b = -1] = parts;
	return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}
function isAllowedTelegramProxyHost(value) {
	const host = value.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
	if (host === "localhost") return true;
	const ipKind = isIP(host);
	if (ipKind === 4) return isPrivateIpv4(host);
	if (ipKind === 6) return host === "::" || host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd");
	return false;
}
var VpnNodeSchema = z.object({
	id: z.string(),
	name: z.string(),
	protocol: NodeProtocolSchema,
	server: z.string(),
	port: z.number().int().min(1).max(65535),
	uri: z.string(),
	metadata: z.record(z.string(), z.coerce.string()),
	subscriptionId: z.string().optional()
});
var ProcessRuleSchema = z.object({
	id: z.string(),
	process: z.string(),
	mode: RuleModeSchema
});
var DomainRuleSchema = z.object({
	id: z.string(),
	domain: z.string(),
	mode: RuleModeSchema
});
var SubscriptionItemSchema = z.object({
	id: z.string(),
	url: z.string(),
	name: z.string().nullable().optional(),
	enabled: z.boolean(),
	lastUpdated: z.string().nullable(),
	upload: z.number().optional(),
	download: z.number().optional(),
	total: z.number().optional(),
	expire: z.number().optional()
});
var AppSettingsSchema = z.object({
	autoStart: z.boolean(),
	startMinimized: z.boolean(),
	minimizeToTray: z.boolean().default(false),
	autoUpdate: z.boolean(),
	useTunMode: z.boolean(),
	killSwitch: z.boolean(),
	autoConnect: z.boolean(),
	notifications: z.boolean(),
	soundNotifications: z.boolean().default(false),
	reconnectOnDrop: z.boolean().default(true),
	allowTelemetry: z.boolean(),
	allowExternalGeoLookups: z.boolean().default(false),
	logLevel: z.enum([
		"debug",
		"info",
		"warn",
		"error"
	]).default("debug"),
	keepLogsDays: z.coerce.number().int().refine((value) => [
		7,
		30,
		90
	].includes(value)).default(7),
	dnsMode: DnsModeSchema,
	systemDnsServers: z.string().default(""),
	customDnsUrl: z.string().default(""),
	systemDohEnabled: z.boolean().default(false),
	systemDohUrl: z.string().default(""),
	systemDohLocalAddress: z.string().default(""),
	subscriptionUserAgent: SubscriptionUserAgentSchema,
	sendSubscriptionHwid: z.boolean().default(false),
	privacyConsentVersion: z.literal(1).default(1),
	runtimePath: z.string(),
	routeMode: RouteModeSchema,
	zapretProfile: z.string().min(1).default("General"),
	zapretSuspendDuringVpn: z.boolean().default(true)
});
var TelegramProxyConfigSchema = z.object({
	host: z.string().trim().min(1, "Host не может быть пустым").max(253, "Host не может превышать 253 символа").refine(isAllowedTelegramProxyHost, "Host Telegram Proxy должен быть loopback, wildcard или приватным LAN-адресом"),
	port: z.coerce.number().int().min(1).max(65535),
	secret: z.string().trim().transform((value) => value.replace(/^dd([a-f0-9]{32})$/i, "$1")).refine((value) => HEX_32_RE.test(value), "Secret должен быть 32 hex-символа без dd-префикса"),
	dcIp: z.array(z.string().trim().min(1).max(128).refine((value) => TELEGRAM_DC_IP_RE.test(value), "Некорректный Telegram DC endpoint")).max(16, "Слишком много Telegram DC endpoints"),
	verbose: z.boolean(),
	bufKb: z.coerce.number().int().min(1).max(16384),
	poolSize: z.coerce.number().int().min(1).max(256),
	logMaxMb: z.coerce.number().min(1).max(1024),
	checkUpdates: z.boolean()
}).strict();
var UsageRecordSchema = z.object({
	id: z.string(),
	timestamp: z.number(),
	serverId: z.string(),
	ping: z.number(),
	down: z.number(),
	up: z.number(),
	durationSec: z.number()
});
var PersistedStateSchema = z.object({
	stateRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
	nodes: z.array(VpnNodeSchema),
	activeNodeId: z.string().nullable(),
	subscriptions: z.array(SubscriptionItemSchema),
	processRules: z.array(ProcessRuleSchema),
	domainRules: z.array(DomainRuleSchema),
	settings: AppSettingsSchema,
	usageHistory: z.array(UsageRecordSchema)
});
var SettingsPatchInputSchema = z.object({
	patch: AppSettingsSchema.partial().strict(),
	expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
}).strict();
function isRulesPatchNativePrototype(prototype, constructor) {
	if (!prototype) return false;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
	return typeof descriptor?.value === "function" && Function.prototype.toString.call(descriptor.value) === Function.prototype.toString.call(constructor) &&
		Object.getOwnPropertyDescriptor(descriptor.value, "prototype")?.value === prototype;
}
function isRulesPatchRecord(value, keys) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== null && (Object.getPrototypeOf(prototype) !== null || !isRulesPatchNativePrototype(prototype, Object))) return false;
	return Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key) &&
		Object.getOwnPropertyDescriptor(value, key).enumerable === true && Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), "value"));
}
function isRulesPatchPayload(value) {
	if (!isRulesPatchRecord(value, ["patch", "expectedRevision"]) || !Object.hasOwn(value, "patch") || !Object.hasOwn(value, "expectedRevision")) return false;
	if (!isRulesPatchRecord(value.patch, ["domainRules", "processRules"]) || Object.keys(value.patch).length === 0 || typeof value.expectedRevision !== "number") return false;
	for (const key of Object.keys(value.patch)) {
		const list = value.patch[key];
		if (!Array.isArray(list) || list.length > 256) return false;
		const prototype = Object.getPrototypeOf(list);
		if (!isRulesPatchNativePrototype(prototype, Array) || !isRulesPatchNativePrototype(Object.getPrototypeOf(prototype), Object)) return false;
		if (!Reflect.ownKeys(list).every((item) => typeof item === "string" && (item === "length" || /^(0|[1-9][0-9]*)$/.test(item) && Number(item) < list.length) &&
			(item === "length" || Object.getOwnPropertyDescriptor(list, item).enumerable === true) && Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(list, item), "value"))) return false;
		const field = key === "domainRules" ? "domain" : "process";
		for (const rule of list) if (!isRulesPatchRecord(rule, ["id", field, "mode"]) ||
			!["id", field, "mode"].every((name) => Object.hasOwn(rule, name) && typeof rule[name] === "string") ||
			rule.id.length > 128 || rule[field].length > 512 || rule.mode.length > 6) return false;
	}
	try { return Buffer.byteLength(JSON.stringify(value), "utf8") <= 60 * 1024; } catch { return false; }
}
function rulesPatchText(maximum) {
	return z.string().max(maximum).refine((value) => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value), "Rule text contains control characters").transform((value) => value.trim()).refine((value) => value.length > 0, "Rule text cannot be empty");
}
var RulesPatchInputSchema = z.unknown().refine(isRulesPatchPayload, "Invalid or oversized rules patch").pipe(z.object({
	patch: z.object({
		domainRules: z.array(z.object({ id: rulesPatchText(128), domain: rulesPatchText(512), mode: RuleModeSchema }).strict()).max(256).optional(),
		processRules: z.array(z.object({ id: rulesPatchText(128), process: rulesPatchText(512), mode: RuleModeSchema }).strict()).max(256).optional()
	}).strict(),
	expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
}).strict()).superRefine(({ patch }, context) => {
	for (const key of ["domainRules", "processRules"]) if (patch[key]) {
		const ids = new Set();
		for (const [index, rule] of patch[key].entries()) {
			if (ids.has(rule.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["patch", key, index, "id"], message: "Rule IDs must be unique within their type" });
			ids.add(rule.id);
		}
	}
});
var NodeIdInputSchema = z.object({ id: z.string().min(1).max(256) }).strict();
var SelectNodeInputSchema = z.object({ id: z.string().min(1).max(256).nullable() }).strict();
var NodeFavoriteInputSchema = z.object({
	id: z.string().min(1).max(256),
	favorite: z.boolean()
}).strict();
var SubscriptionIdInputSchema = z.object({ id: z.string().min(1).max(256) }).strict();
/** import:text — текстовый payload (URI, base64, YAML) */
var ImportTextInputSchema = z.string().min(1, "Payload не может быть пустым");
/** import:file — путь к файлу */
var ImportFileInputSchema = z.string().min(1, "Путь к файлу не может быть пустым").refine((p) => !p.includes(".."), "Путь не может содержать '..'");
/** subscription:refresh-one — URL подписки */
var SubscriptionUrlInputSchema = z.string().url("Некорректный URL подписки");
/** vpn:stress-test — количество итераций */
var StressTestInputSchema = z.number().int().min(1).max(1e3);
/** vpn:ping — хост и порт */
var PingInputSchema = z.object({
	host: z.string().min(1),
	port: z.coerce.number().int().min(1).max(65535),
	timeoutMs: z.coerce.number().int().min(250).max(10e3).optional()
});
/** system:pick-file — фильтры файлов */
var PickFileFilterSchema = z.array(z.object({
	name: z.string(),
	extensions: z.array(z.string())
}));
/** system:geoip — хост для определения страны */
var GeoipInputSchema = z.string().min(1, "Host не может быть пустым");
/** system:get-app-icon — путь к exe */
var AppIconInputSchema = z.string().min(1);
/** system:set-dns-servers — список DNS */
var SystemDnsServersInputSchema = z.string().min(1, "DNS-список не может быть пустым");
var SystemDohUrlInputSchema = z.string().min(1, "DoH URL не может быть пустым");
/** subscription:rename — URL подписки и новое имя */
var RenameSubscriptionInputSchema = z.object({
	url: z.string().url("Некорректный URL подписки"),
	newName: z.string().min(1, "Имя не может быть пустым").max(100, "Имя не может превышать 100 символов")
});
/** node:rename — ID узла и новое имя */
var RenameNodeInputSchema = z.object({
	id: z.string().min(1, "ID узла не может быть пустым"),
	newName: z.string().min(1, "Имя не может быть пустым").max(100, "Имя не может превышать 100 символов")
});
var ZapretProfileInputSchema = z.string().min(1, "Профиль Zapret не может быть пустым");
var ZapretCoreVersionInputSchema = z.string().trim().regex(/^v?\d+(?:\.\d+){1,3}[a-z]?$/i, "Некорректная версия Flowseal Core");
var ZapretUpdateChecksInputSchema = z.boolean();
var ZapretUserListsInputSchema = z.object({
	generalDomains: z.array(z.string()),
	includedCidrs: z.array(z.string()),
	excludedDomains: z.array(z.string()),
	excludedCidrs: z.array(z.string())
});
//#endregion
