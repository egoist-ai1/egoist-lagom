//#region src/electron/ipc/subscription-utils.ts
var MAX_SUBSCRIPTION_RESPONSE_BYTES = 5 * 1024 * 1024;
/**
* Общий бюджет на одну подписку в режиме "auto". Профилей 5, вариантов HWID 3,
* у каждой попытки свои ретраи и curl-фолбэк — без потолка одна недоступная
* ссылка могла удерживать импорт больше десяти минут.
*/
var SUBSCRIPTION_AUTO_BUDGET_MS = 45e3;
var execFileAsync$13 = promisify(execFile);
var USER_AGENT_BY_PROFILE = {
	egoistshield: "EgoistShield/3.0",
	v2rayn: "v2rayN/6.0",
	singbox: "sing-box/1.10",
	nekobox: "NekoBox/1.0",
	mihomo: "Mihomo/1.19",
	"clash-verge": "clash-verge/2.0",
	"clash-for-windows": "ClashforWindows/0.20.39",
	shadowrocket: "Shadowrocket/2320",
	loon: "Loon/3.2.5",
	quantumultx: "Quantumult X/1.0.32",
	surge: "Surge/3029",
	curl: "curl/8.0"
};
var AUTO_PROFILE_ORDER = [
	"clash-verge",
	"mihomo",
	"clash-for-windows",
	"v2rayn",
	"egoistshield"
];
function getRequestProfiles(profile) {
	return profile === "auto" ? AUTO_PROFILE_ORDER : [profile];
}
function getAcceptHeader(profile) {
	if ([
		"mihomo",
		"clash-verge",
		"clash-for-windows",
		"surge"
	].includes(profile)) return "text/yaml,text/plain;q=0.9,*/*;q=0.8";
	return "text/plain,*/*;q=0.8";
}
function getUserAgentString(profile) {
	return USER_AGENT_BY_PROFILE[profile];
}
function getSubscriptionUserAgent(settings) {
	return settings.subscriptionUserAgent ?? "auto";
}
/**
* Генерирует HWID (Hardware-ID) устройства.
* Используется подписочными панелями (Marzban, 3X-UI, V2Board) для лимита устройств.
* Формат совместим с v2rayN/Happ — SHA-256 хэш hostname.
*/
var _cachedHwid = null;
function getDeviceHwid() {
	if (_cachedHwid) return _cachedHwid;
	try {
		const raw = hostname() || "EgoistShield-Desktop";
		_cachedHwid = createHash("sha256").update(raw).digest("hex").substring(0, 32);
	} catch {
		_cachedHwid = "egoistshield-default-hwid-00000";
	}
	return _cachedHwid;
}
function getCompatibilityHwid() {
	return "0123456789abcdef0123456789abcdef";
}
function redactSubscriptionUrl(rawUrl) {
	return redactUrlForLog(rawUrl);
}
/**
* Разбирает сырой дамп заголовков `curl -D`. При `-L` там лежит по блоку на
* каждый redirect-хоп; значимы заголовки последнего ответа.
*/
function parseRawHttpHeaders(raw) {
	const headers = {};
	for (const line of raw.split(/\r?\n/)) {
		if (/^HTTP\/\d/i.test(line)) {
			for (const key of Object.keys(headers)) delete headers[key];
			continue;
		}
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();
		if (key && value) headers[key] = value;
	}
	return headers;
}
function parseSubscriptionUserInfo(header) {
	if (!header) return null;
	const result = {};
	for (const part of header.split(";")) {
		const [key, value] = part.split("=");
		if (key && value) {
			const num = Number.parseInt(value.trim(), 10);
			if (!Number.isNaN(num)) result[key.trim().toLowerCase()] = num;
		}
	}
	return Object.keys(result).length > 0 ? result : null;
}
function extractSubscriptionName(response) {
	return extractSubscriptionNameFromHeaders((name) => response.headers.get(name));
}
function extractSubscriptionNameFromHeaders(getHeader) {
	const response = { headers: { get: getHeader } };
	const profileTitle = response.headers.get("profile-title") || response.headers.get("Profile-Title");
	if (profileTitle) {
		const base64Match = profileTitle.match(/^base64:(.+)$/i);
		if (base64Match?.[1]) try {
			return Buffer.from(base64Match[1], "base64").toString("utf8").trim();
		} catch {}
		return profileTitle.trim();
	}
	const cd = response.headers.get("content-disposition") || response.headers.get("Content-Disposition");
	if (cd) {
		const utf8Match = cd.match(/filename\*=(?:UTF-8''|utf-8'')([^;]+)/i);
		if (utf8Match?.[1]) try {
			return decodeURIComponent(utf8Match[1]).replace(/\.[^.]+$/, "");
		} catch {}
		const fnMatch = cd.match(/filename="?([^"\n;]+)"?/i);
		if (fnMatch?.[1]) return fnMatch[1].replace(/\.[^.]+$/, "").trim();
	}
	const subName = response.headers.get("subscription-name");
	if (subName) return subName.trim();
	return null;
}
/**
* Переносит id уже сохранённых узлов на свежие данные подписки.
*
* buildNode всегда выдаёт новый randomUUID, поэтому каждое обновление подписки
* меняло id всех узлов. Последствия были заметные: слетал выбранный сервер
* (activeNodeId переставал существовать и подменялся первым в списке),
* обнулялась история здоровья узлов и выученное предпочтение рантайма
* (xray/sing-box) — то есть после каждого обновления ядро снова подбирало
* рантайм перебором с фолбэками.
*/
function preserveNodeIdentities(existing, incoming) {
	const idByFingerprint = /* @__PURE__ */ new Map();
	for (const node of existing) {
		const id = typeof node?.id === "string" ? node.id : null;
		if (!id) continue;
		const key = buildNodeFingerprint(node);
		if (!idByFingerprint.has(key)) idByFingerprint.set(key, id);
	}
	const usedIds = /* @__PURE__ */ new Set();
	return incoming.map((node) => {
		const previousId = idByFingerprint.get(buildNodeFingerprint(node));
		if (previousId && !usedIds.has(previousId)) {
			usedIds.add(previousId);
			return {
				...node,
				id: previousId
			};
		}
		return node;
	});
}
function uniqueNodes(existing, incoming) {
	const keyFor = (node) => JSON.stringify([node.subscriptionId ?? "", buildNodeFingerprint(node)]);
	const index = new Set(existing.map(keyFor));
	const result = [];
	for (const node of incoming) {
		const key = keyFor(node);
		if (!index.has(key)) {
			result.push(node);
			index.add(key);
		}
	}
	return result;
}
function countSupportedNodes(payload) {
	try {
		return parseNodesFromText(payload).nodes.length;
	} catch {
		return 0;
	}
}
function describeSubscriptionFetchError(url, error) {
	const details = getNetworkErrorDetails(error);
	const source = redactSubscriptionUrl(url);
	const raw = error instanceof Error ? error.message : String(error ?? "");
	if (details.kind === "timeout") return `SUBSCRIPTION-TIMEOUT: подписка ${source} не ответила за отведенное время. Проверьте интернет, DNS или доступность провайдера.`;
	if (details.kind === "http") return `SUBSCRIPTION-HTTP-${details.status ?? "ERROR"}: провайдер подписки ${source} вернул ${details.message}. Проверьте ссылку и срок подписки.`;
	if (details.kind === "too-large") return `SUBSCRIPTION-SIZE: ответ подписки ${source} больше 5 МБ, импорт остановлен.`;
	if (details.kind === "network") return `SUBSCRIPTION-NETWORK: не удалось подключиться к ${source}. Проверьте DNS, VPN, прокси или блокировку провайдера. Причина: ${details.message}${raw && raw !== details.message ? ` (${raw})` : ""}`;
	return `SUBSCRIPTION-ERROR: не удалось загрузить подписку ${source}.${raw ? ` Причина: ${raw}` : ""}`;
}
async function readUrlTextWithProfile(url, profileKey, hwid = null, context = { curlFallbackUsed: false }) {
	log.info(`[readUrlText] Fetching ${redactSubscriptionUrl(url)} with UA=${profileKey}`);
	const headers = {
		"User-Agent": getUserAgentString(profileKey),
		Accept: getAcceptHeader(profileKey)
	};
	if (hwid) headers["X-HWID"] = hwid;
	try {
		const { response, text, attempts, elapsedMs } = await fetchTextWithRetry(url, {
			headers,
			redirect: "follow",
			timeoutMs: 1e4,
			retries: 2,
			retryBaseDelayMs: 500,
			maxBytes: MAX_SUBSCRIPTION_RESPONSE_BYTES
		});
		log.info(`[readUrlText] Response: ${text.length} bytes after ${attempts} attempt(s), ${elapsedMs}ms`);
		if (!text.trim()) throw new Error("Сервер вернул пустой ответ");
		return {
			text,
			userinfo: parseSubscriptionUserInfo(response.headers.get("Subscription-Userinfo") || response.headers.get("subscription-userinfo")),
			name: extractSubscriptionName(response)
		};
	} catch (error) {
		const details = getNetworkErrorDetails(error);
		log.warn(`[readUrlText] Failed ${redactSubscriptionUrl(url)}: ${details.kind} ${details.message}`);
		if (context.curlFallbackUsed) throw error;
		context.curlFallbackUsed = true;
		try {
			const fallback = await readUrlTextWithCurl(url, headers);
			log.info(`[readUrlText] curl fallback succeeded: ${fallback.text.length} bytes for ${redactSubscriptionUrl(url)}`);
			return fallback;
		} catch (fallbackError) {
			const fallbackDetails = getNetworkErrorDetails(fallbackError);
			log.warn(`[readUrlText] curl fallback failed ${redactSubscriptionUrl(url)}: ${fallbackDetails.kind} ${fallbackDetails.message}`);
			throw error;
		}
	}
}
async function readUrlTextWithCurl(url, headers) {
	const outputPath = path.join(tmpdir(), `egoistshield-subscription-${Date.now()}-${randomUUID()}.txt`);
	const headerPath = `${outputPath}.headers`;
	const args = [
		"-L",
		"--fail",
		"--silent",
		"--show-error",
		"--max-time",
		"24",
		"--connect-timeout",
		"8",
		"--max-filesize",
		String(MAX_SUBSCRIPTION_RESPONSE_BYTES),
		"-D",
		headerPath,
		"--output",
		outputPath
	];
	for (const [key, value] of Object.entries(headers)) args.push("-H", `${key}: ${value}`);
	args.push(url);
	try {
		await execFileAsync$13(resolveWindowsExecutable("curl.exe"), args, {
			windowsHide: true,
			timeout: 3e4,
			maxBuffer: 1024 * 1024
		});
		if ((await promises.stat(outputPath)).size > MAX_SUBSCRIPTION_RESPONSE_BYTES) throw new Error("Ответ подписки слишком большой. Максимальный размер: 5 МБ.");
		const text = await promises.readFile(outputPath, "utf8");
		if (!text.trim()) throw new Error("Сервер вернул пустой ответ");
		const parsedHeaders = parseRawHttpHeaders(await promises.readFile(headerPath, "utf8").catch(() => ""));
		const getHeader = (name) => parsedHeaders[name.toLowerCase()] ?? null;
		return {
			text,
			userinfo: parseSubscriptionUserInfo(getHeader("subscription-userinfo")),
			name: extractSubscriptionNameFromHeaders(getHeader)
		};
	} finally {
		await Promise.all([promises.rm(outputPath, { force: true }).catch(() => void 0), promises.rm(headerPath, { force: true }).catch(() => void 0)]);
	}
}
/**
* Отказы, которые не зависят от User-Agent/HWID. Перебирать ради них ещё
* четырнадцать комбинаций заголовков бессмысленно: адрес один и тот же, а цена
* — минуты ожидания. HTTP-статусы намеренно НЕ попадают сюда: панели подписок
* реально отдают 403/404 именно на неизвестный клиент.
*/
function isProfileIndependentFailure(error) {
	const kind = getNetworkErrorDetails(error).kind;
	return kind === "timeout" || kind === "network" || kind === "offline" || kind === "too-large";
}
async function readUrlText(url, profile, sendHwid = false) {
	const profiles = getRequestProfiles(profile);
	const hwidAttempts = sendHwid ? [getDeviceHwid(), getCompatibilityHwid()] : [null];
	const context = { curlFallbackUsed: false };
	const deadline = Date.now() + SUBSCRIPTION_AUTO_BUDGET_MS;
	let fallback = null;
	let bestEmptyResponse = null;
	let lastError = null;
	attempts: for (const profileKey of profiles) for (const hwid of hwidAttempts) {
		if (profile === "auto" && Date.now() >= deadline) {
			log.warn(`[readUrlText] Auto profile budget exhausted for ${redactSubscriptionUrl(url)}`);
			break attempts;
		}
		try {
			const response = await readUrlTextWithProfile(url, profileKey, hwid, context);
			if (!fallback) fallback = response;
			const isPlaceholder = isLikelyUnsupportedPlaceholderText(response.text);
			const supportedNodeCount = isPlaceholder ? 0 : countSupportedNodes(response.text);
			if (!isPlaceholder && !bestEmptyResponse) bestEmptyResponse = response;
			if (supportedNodeCount > 0) {
				if (profile === "auto" && (profileKey !== profiles[0] || Boolean(hwid) !== sendHwid)) log.info(`[readUrlText] Auto profile selected UA=${profileKey}, hwid=${Boolean(hwid)}, nodes=${supportedNodeCount} for ${redactSubscriptionUrl(url)}`);
				return response;
			}
			const reason = isPlaceholder ? "unsupported placeholder" : "no supported nodes";
			log.warn(`[readUrlText] UA=${profileKey}, hwid=${Boolean(hwid)} returned ${reason} for ${redactSubscriptionUrl(url)}`);
		} catch (error) {
			lastError = error;
			if (profile !== "auto") throw new Error(describeSubscriptionFetchError(url, error));
			if (isProfileIndependentFailure(error)) {
				log.warn(`[readUrlText] Aborting auto profile sweep for ${redactSubscriptionUrl(url)}: ${getNetworkErrorDetails(error).kind}`);
				break attempts;
			}
		}
	}
	if (fallback) return bestEmptyResponse ?? fallback;
	throw new Error(describeSubscriptionFetchError(url, lastError ?? /* @__PURE__ */ new Error("Subscription fetch failed")));
}
//#endregion
