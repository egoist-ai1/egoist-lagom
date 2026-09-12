//#region src/electron/ipc/handlers-vpn.ts
/**
* VPN IPC Handlers — vpn:connect, vpn:disconnect, vpn:status, vpn:diagnose,
* vpn:stress-test, vpn:route-probe, vpn:ping, vpn:ping-active-proxy,
* vpn:get-my-ip, vpn:speedtest
*/
var ROUTE_PROBE_ENDPOINT = "https://api.ipify.org?format=json";
var ROUTE_PROBE_ENDPOINTS = [
	"https://api.ipify.org?format=json",
	"https://cloudflare.com/cdn-cgi/trace",
	"https://1.1.1.1/cdn-cgi/trace",
	"https://ipwho.is/?fields=ip,success"
];
var ROUTE_SPEED_WARMUP_BYTES = 8e6;
var ROUTE_SPEED_DOWNLOAD_BYTES = 25e6;
var ROUTE_SPEED_UPLOAD_BYTES = 8e6;
var ROUTE_SPEED_FAST_UPLOAD_BYTES = 25e6;
var SPEEDTEST_LATENCY_ATTEMPTS = 10;
var SPEEDTEST_BANDWIDTH_SAMPLES = 3;
var EGRESS_WATCHDOG_INTERVAL_MS = 45e3;
/**
* Интервал после первого промаха (MED-07).
*
* 45 с × порог 2 давали до ~90 с, в течение которых статус показывал «защищено»
* при уже потерянном маршруте. 12 с сокращают это окно до ~24 с.
*/
var EGRESS_WATCHDOG_DEGRADED_INTERVAL_MS = 12e3;
var EGRESS_WATCHDOG_FAILURE_THRESHOLD = 2;
var IS_TEST_MOCK_RUNTIME = process.env.EGOISTSHIELD_MOCK_RUNTIME === "1" && (process.env.NODE_ENV === "test" || process.env.VITEST === "true");
var activeProxyPingInFlight = /* @__PURE__ */ new Map();
var activeProxyPingCache = /* @__PURE__ */ new Map();
var speedtestInFlight = null;
/**
* Признак отмены замера скорости (MED-20).
*
* Панель можно было закрыть, но backend-тест продолжал качать данные. Теперь
* отмена выставляет флаг, а каждая фаза проверяет его перед началом следующей
* работы, поэтому трафик действительно прекращается.
*/
var speedtestCancelled = false;
function speedtestUserAgentHeader() {
	return `User-Agent: EgoistShield/${app.getVersion().replace(/[^0-9A-Za-z.+-]/g, "") || "unknown"} speed-test\r\n`;
}
var SpeedtestCancelledError = class extends Error {
	constructor() {
		super("Замер скорости отменён.");
		this.name = "SpeedtestCancelledError";
	}
};
function throwIfSpeedtestCancelled() {
	if (speedtestCancelled) throw new SpeedtestCancelledError();
}
var ROUTE_SPEED_DOWNLOAD_ENDPOINTS = [
	{
		name: "Yandex CDN",
		host: "download.cdn.yandex.net",
		path: "/browser/yandex/ru/Yandex.exe",
		bytes: 6e7,
		measurementGrade: true
	},
	{
		name: "Cloudflare Edge",
		host: "speed.cloudflare.com",
		path: `/__down?bytes=${ROUTE_SPEED_DOWNLOAD_BYTES}`,
		bytes: ROUTE_SPEED_DOWNLOAD_BYTES,
		measurementGrade: true
	},
	{
		name: "OVH Proof",
		host: "proof.ovh.net",
		path: "/files/100Mb.dat",
		bytes: 1e8,
		measurementGrade: true
	},
	{
		name: "Yandex Static",
		host: "yastatic.net",
		path: "/bootstrap/3.3.6/css/bootstrap.min.css",
		bytes: 12e4
	}
];
var ROUTE_SPEED_UPLOAD_ENDPOINTS = [
	{
		name: "Cloudflare Edge",
		host: "speed.cloudflare.com",
		path: "/__up",
		bytes: ROUTE_SPEED_UPLOAD_BYTES
	},
	{
		name: "HTTPBin discard",
		host: "httpbin.org",
		path: "/status/204",
		bytes: ROUTE_SPEED_UPLOAD_BYTES
	},
	{
		name: "Postman Echo",
		host: "postman-echo.com",
		path: "/post",
		bytes: 512e3
	},
	{
		name: "HTTPBingo",
		host: "httpbingo.org",
		path: "/post",
		bytes: 512e3
	}
];
function normalizeVpnHost(host) {
	const lower = String(host || "").trim();
	if (lower.endsWith(".cloudpath.live")) {
		return `${lower.slice(0, -".cloudpath.live".length)}.claudpath.com`;
	}
	if (lower === "cloudpath.live") return "claudpath.com";
	return lower;
}
async function resolveHostDoh(host) {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 2e3);
		const res = await fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`, {
			headers: { accept: "application/dns-json" },
			signal: controller.signal
		});
		clearTimeout(timer);
		if (res.ok) {
			const json = await res.json();
			const ip = json?.Answer?.find((a) => a.type === 1)?.data;
			if (ip && isIP(ip)) return ip;
		}
	} catch {}
	return null;
}
function measureTcpLatency(rawHost, port, timeoutMs) {
	const host = normalizeVpnHost(rawHost);
	return new Promise((resolve) => {
		let settled = false;
		const start = performance.now();
		const socket = new Socket();
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(-1);
		}, timeoutMs);
		const finish = (val) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			socket.destroy();
			resolve(val);
		};
		socket.on("connect", () => {
			finish(Math.round(performance.now() - start));
		});
		socket.on("error", async () => {
			if (settled) return;
			if (!isIP(host)) {
				const fallbackIp = await resolveHostDoh(host);
				if (fallbackIp && !settled) {
					const fallbackSocket = new Socket();
					const remaining = Math.max(800, timeoutMs - Math.round(performance.now() - start));
					const fbTimeout = setTimeout(() => {
						fallbackSocket.destroy();
						finish(-1);
					}, remaining);
					fallbackSocket.on("connect", () => {
						clearTimeout(fbTimeout);
						finish(Math.round(performance.now() - start));
					});
					fallbackSocket.on("error", () => {
						clearTimeout(fbTimeout);
						fallbackSocket.destroy();
						finish(-1);
					});
					fallbackSocket.connect(port, fallbackIp);
					return;
				}
			}
			finish(-1);
		});
		socket.connect(port, host);
	});
}
function parseHttpStatusFromHeader(header) {
	const match = header.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i);
	if (!match?.[1]) return null;
	const status = Number.parseInt(match[1], 10);
	return Number.isFinite(status) ? status : null;
}
function parseHttpHeaders(header) {
	const lines = header.split(/\r?\n/);
	const statusCode = parseHttpStatusFromHeader(lines[0] ?? "");
	const headers = {};
	for (const line of lines.slice(1)) {
		const idx = line.indexOf(":");
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim().toLowerCase();
		const value = line.slice(idx + 1).trim();
		if (key && value) headers[key] = value;
	}
	return {
		statusCode,
		headers
	};
}
function isOkHttpStatus(status) {
	return status !== null && status >= 200 && status < 400;
}
function isRedirectHttpStatus(status) {
	return status !== null && status >= 300 && status < 400;
}
function endpointFromUrl(url, fallbackName, bytes) {
	if (url.protocol !== "https:") return null;
	return {
		name: fallbackName,
		host: url.hostname,
		path: `${url.pathname}${url.search}`,
		bytes,
		port: url.port ? Number.parseInt(url.port, 10) : 443
	};
}
function openRouteProbeTls(endpoint, proxyPort, timeoutMs) {
	const port = endpoint.port ?? 443;
	if (!proxyPort) return new Promise((resolve, reject) => {
		const tlsSocket = tls.connect({
			host: endpoint.host,
			port,
			servername: endpoint.host,
			rejectUnauthorized: true
		}, () => {
			tlsSocket.setTimeout(0);
			resolve(tlsSocket);
		});
		tlsSocket.setTimeout(timeoutMs, () => {
			tlsSocket.destroy();
			reject(/* @__PURE__ */ new Error(`Маршрут: ${endpoint.name} не ответил напрямую`));
		});
		tlsSocket.on("error", reject);
	});
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error, socket) => {
			if (settled) return;
			settled = true;
			if (error) {
				reject(error);
				return;
			}
			if (socket) resolve(socket);
		};
		const proxyReq = http.request({
			host: "127.0.0.1",
			port: proxyPort,
			method: "CONNECT",
			path: `${endpoint.host}:${port}`,
			timeout: timeoutMs
		});
		proxyReq.on("connect", (_res, socket) => {
			let handshakeTimer = null;
			const complete = (error, tlsSocket) => {
				if (handshakeTimer) {
					clearTimeout(handshakeTimer);
					handshakeTimer = null;
				}
				finish(error, tlsSocket);
			};
			const tlsSocket = tls.connect({
				socket,
				servername: endpoint.host,
				rejectUnauthorized: true
			}, () => {
				tlsSocket.setTimeout(0);
				complete(null, tlsSocket);
			});
			tlsSocket.on("error", () => {
				complete(/* @__PURE__ */ new Error(`Маршрут: TLS к ${endpoint.name} не согласован`));
			});
			handshakeTimer = setTimeout(() => {
				if (!tlsSocket.destroyed) tlsSocket.destroy();
				complete(/* @__PURE__ */ new Error(`Маршрут: TLS к ${endpoint.name} не ответил`));
			}, timeoutMs);
		});
		proxyReq.on("error", (error) => finish(error instanceof Error ? error : /* @__PURE__ */ new Error(`Маршрут: прокси не открыл ${endpoint.name}`)));
		proxyReq.on("timeout", () => {
			proxyReq.destroy();
			finish(/* @__PURE__ */ new Error(`Маршрут: прокси не ответил для ${endpoint.name}`));
		});
		proxyReq.end();
	});
}
function truncateProbeError(message) {
	return message.replace(/\s+/g, " ").trim().slice(0, 180);
}
function materializeDownloadEndpoint(endpoint, bytes) {
	if (endpoint.host === "speed.cloudflare.com" && endpoint.path.startsWith("/__down")) return {
		...endpoint,
		bytes,
		path: `/__down?bytes=${bytes}&cacheBust=${Date.now()}-${Math.random().toString(16).slice(2)}`
	};
	return {
		...endpoint,
		bytes: Math.min(bytes, endpoint.bytes)
	};
}
function materializeUploadEndpoint(endpoint, bytes) {
	return {
		...endpoint,
		bytes: endpoint.host === "speed.cloudflare.com" ? bytes : Math.min(bytes, endpoint.bytes)
	};
}
async function measureRouteLatency(endpoint, proxyPort) {
	const startedAt = performance.now();
	const latencyEndpoint = materializeDownloadEndpoint(endpoint, 0);
	const tlsSocket = await openRouteProbeTls(latencyEndpoint, proxyPort, 6e3);
	return await new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			if (!tlsSocket.destroyed) tlsSocket.destroy();
			if (error) reject(error);
			else resolve(Math.max(.1, value ?? performance.now() - startedAt));
		};
		const requestPath = latencyEndpoint.host === "speed.cloudflare.com" ? latencyEndpoint.path : latencyEndpoint.path;
		tlsSocket.write(`GET ${requestPath} HTTP/1.1\r\nHost: ${latencyEndpoint.host}\r\n` + (latencyEndpoint.host === "speed.cloudflare.com" ? "" : "Range: bytes=0-0\r\n") + "Cache-Control: no-cache\r\n" + speedtestUserAgentHeader() + "Connection: close\r\n\r\n");
		tlsSocket.once("data", () => finish(null, performance.now() - startedAt));
		tlsSocket.once("error", (error) => finish(error));
		tlsSocket.once("end", () => finish(/* @__PURE__ */ new Error(`${endpoint.name} закрыл соединение до ответа.`)));
		setTimeout(() => finish(/* @__PURE__ */ new Error(`${endpoint.name} не ответил на latency probe.`)), 7e3);
	});
}
async function measureLatencySeries(endpoint, proxyPort, attempts, pauseMs = 90) {
	const samples = [];
	for (let index = 0; index < attempts; index += 1) {
		try {
			samples.push(await measureRouteLatency(endpoint, proxyPort));
		} catch {}
		if (index < attempts - 1 && pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
	}
	return summarizeLatency(samples, attempts);
}
async function measureDownloadEndpoint(endpoint, proxyPort, redirectDepth = 0) {
	const tlsSocket = await openRouteProbeTls(endpoint, proxyPort, 8e3);
	return new Promise((resolve, reject) => {
		const start = performance.now();
		let dataStartedAt = null;
		let totalBytes = 0;
		let headersParsed = false;
		let statusCode = null;
		let responseHeaders = {};
		let buf = Buffer.alloc(0);
		let settled = false;
		const finish = async (error = null) => {
			if (settled) return;
			settled = true;
			if (!tlsSocket.destroyed) tlsSocket.destroy();
			if (error) {
				reject(error);
				return;
			}
			const location = responseHeaders.location;
			if (isRedirectHttpStatus(statusCode) && location && redirectDepth < 4) {
				try {
					const redirectedEndpoint = endpointFromUrl(new URL(location, `https://${endpoint.host}${endpoint.path}`), endpoint.name, endpoint.bytes);
					if (!redirectedEndpoint) {
						reject(/* @__PURE__ */ new Error(`Маршрут: ${endpoint.name} вернул неподдерживаемый redirect`));
						return;
					}
					resolve(await measureDownloadEndpoint(redirectedEndpoint, proxyPort, redirectDepth + 1));
				} catch (redirectError) {
					reject(redirectError instanceof Error ? redirectError : new Error(String(redirectError)));
				}
				return;
			}
			if (!isOkHttpStatus(statusCode)) {
				reject(/* @__PURE__ */ new Error(`Маршрут: ${endpoint.name} вернул HTTP ${statusCode ?? "unknown"}`));
				return;
			}
			if (totalBytes <= 0) {
				reject(/* @__PURE__ */ new Error(`Маршрут: ${endpoint.name} не отдал данные`));
				return;
			}
			const elapsedMs = Math.max(1, (dataStartedAt ? performance.now() - dataStartedAt : performance.now() - start));
			resolve({
				downloadMbps: Number.parseFloat((totalBytes * 8 / (elapsedMs / 1e3 * 1e6)).toFixed(2)),
				bytes: totalBytes,
				timeMs: elapsedMs,
				endpoint
			});
		};
		tlsSocket.write(`GET ${endpoint.path} HTTP/1.1\r\nHost: ${endpoint.host}\r\nRange: bytes=0-${Math.max(0, endpoint.bytes - 1)}\r\nCache-Control: no-cache\r
Pragma: no-cache\r
` + speedtestUserAgentHeader() + "Connection: close\r\n\r\n");
		tlsSocket.on("data", (chunk) => {
			if (settled) return;
			if (!headersParsed) {
				buf = Buffer.concat([buf, chunk]);
				const idx = buf.indexOf("\r\n\r\n");
				if (idx >= 0) {
					headersParsed = true;
					dataStartedAt = performance.now();
					const parsed = parseHttpHeaders(buf.slice(0, idx).toString("utf8"));
					statusCode = parsed.statusCode;
					responseHeaders = parsed.headers;
					if (isRedirectHttpStatus(statusCode) && responseHeaders.location) {
						finish();
						return;
					}
					totalBytes += buf.slice(idx + 4).length;
				}
			} else totalBytes += chunk.length;
			if (totalBytes >= endpoint.bytes) {
				totalBytes = endpoint.bytes;
				finish();
			}
		});
		tlsSocket.on("end", () => void finish());
		tlsSocket.on("error", (error) => void finish(error));
		setTimeout(() => void finish(totalBytes > 0 ? null : /* @__PURE__ */ new Error(`Маршрут: ${endpoint.name} не завершил скачивание`)), 25e3);
	});
}
async function measureDownload(proxyPort, bytes = ROUTE_SPEED_DOWNLOAD_BYTES, preferredEndpoint) {
	const errors = [];
	const endpoints = preferredEndpoint ? [preferredEndpoint, ...ROUTE_SPEED_DOWNLOAD_ENDPOINTS.filter((endpoint) => endpoint.host !== preferredEndpoint.host)] : ROUTE_SPEED_DOWNLOAD_ENDPOINTS;
	for (const endpoint of endpoints) try {
		return await measureDownloadEndpoint(materializeDownloadEndpoint(endpoint, bytes), proxyPort);
	} catch (error) {
		errors.push(`${endpoint.name}: ${truncateProbeError(error instanceof Error ? error.message : String(error))}`);
	}
	throw new Error(`Скачивание недоступно: ${errors.slice(0, 3).join("; ")}`);
}
async function measureUploadEndpoint(endpoint, proxyPort) {
	const payload = Buffer.alloc(endpoint.bytes, 97);
	const tlsSocket = await openRouteProbeTls(endpoint, proxyPort, 8e3);
	return await new Promise((resolve, reject) => {
		const start = performance.now();
		let settled = false;
		let responseBuffer = "";
		let statusCode = null;
		const finish = (error = null) => {
			if (settled) return;
			settled = true;
			if (!tlsSocket.destroyed) tlsSocket.destroy();
			if (error) {
				reject(error);
				return;
			}
			if (!isOkHttpStatus(statusCode)) {
				reject(/* @__PURE__ */ new Error(`Отдача: ${endpoint.name} вернул HTTP ${statusCode ?? "unknown"}`));
				return;
			}
			const elapsedMs = Math.max(1, performance.now() - start);
			resolve({
				uploadMbps: Number.parseFloat((payload.length * 8 / (elapsedMs / 1e3 * 1e6)).toFixed(2)),
				uploadBytes: payload.length,
				uploadTimeMs: elapsedMs,
				endpoint
			});
		};
		tlsSocket.write(`POST ${endpoint.path} HTTP/1.1\r\nHost: ${endpoint.host}\r\nContent-Type: application/octet-stream\r
Content-Length: ${payload.length}\r\n` + speedtestUserAgentHeader() + "Connection: close\r\n\r\n");
		tlsSocket.write(payload);
		tlsSocket.end();
		tlsSocket.on("data", (chunk) => {
			if (statusCode !== null) return;
			responseBuffer += chunk.toString("utf8");
			const idx = responseBuffer.indexOf("\r\n\r\n");
			if (idx >= 0) statusCode = parseHttpStatusFromHeader(responseBuffer.slice(0, idx));
		});
		tlsSocket.on("end", () => finish());
		tlsSocket.on("error", (error) => finish(error));
		setTimeout(() => finish(/* @__PURE__ */ new Error(`Отдача: ${endpoint.name} не завершила проверку`)), 12e3);
	});
}
async function measureUpload(proxyPort, bytes = ROUTE_SPEED_UPLOAD_BYTES, preferredEndpoint) {
	const errors = [];
	const endpoints = preferredEndpoint ? [preferredEndpoint, ...ROUTE_SPEED_UPLOAD_ENDPOINTS.filter((endpoint) => endpoint.host !== preferredEndpoint.host)] : ROUTE_SPEED_UPLOAD_ENDPOINTS;
	for (const endpoint of endpoints) try {
		return await measureUploadEndpoint(materializeUploadEndpoint(endpoint, bytes), proxyPort);
	} catch (error) {
		errors.push(`${endpoint.name}: ${truncateProbeError(error instanceof Error ? error.message : String(error))}`);
	}
	throw new Error(`Отдача недоступна: ${errors.slice(0, 3).join("; ")}`);
}
function logVpnStatusEvent(level, message, status) {
	const payload = formatRuntimeLogEvent({
		timestamp: (/* @__PURE__ */ new Date()).toISOString(),
		level,
		lifecycle: status.lifecycle,
		reason: status.diagnostic.reason,
		message,
		nodeId: status.activeNodeId,
		runtimeKind: status.runtimeKind,
		proxyPort: status.proxyPort
	});
	if (level === "error") {
		logger.error(payload);
		return;
	}
	if (level === "warn") {
		logger.warn(payload);
		return;
	}
	if (level === "debug") {
		logger.debug(payload);
		return;
	}
	logger.info(payload);
}
/**
* Резолверы, ожидаемые для текущего режима DNS.
*
* Для управляемого приложением режима это loopback (локальный резолвер) плюс
* явно заданные адреса. Для внешнего DNS пользователя — то, что он сам указал
* в настройках; пустой список означает «системное значение по умолчанию»,
* и тогда проверка не считает несовпадение утечкой.
*/
function resolveExpectedDnsResolvers(settings, mode) {
	if (mode === "app-managed") return [(settings.systemDohLocalAddress ?? "").trim() || "127.0.0.1"];
	return (settings.systemDnsServers ?? "").split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
}
async function fetchRouteProbeIp(label, request) {
	try {
		const response = await request();
		if (!response.ok) {
			logger.debug(`[vpn:route-probe] ${label} probe returned HTTP ${response.status ?? "unknown"}`);
			return null;
		}
		const contentType = (response.headers && typeof response.headers.get === "function") ? (response.headers.get("content-type") || "") : "";
		if (contentType.includes("json")) {
			return extractRouteProbeIp(await response.json());
		}
		const text = await response.text();
		return extractRouteProbeIp(text);
	} catch (error) {
		if (!isFirstSuccessfulCancellation(error)) logger.debug(`[vpn:route-probe] ${label} probe failed:`, error);
		return null;
	}
}
function registerVpnHandlers({ stateStore, runtimeManager, zapretManager, networkCombinatorManager, window }) {
	/**
	* A listening local port is only proof that the runtime process started. It
	* does not prove that traffic can leave through the selected upstream. Keep
	* this probe separate from the full route comparison so the regular VPN
	* diagnostic stays fast and never reports a dead upstream as healthy.
	*/
	const probeProxyEgress = async (timeoutMs = 3500) => {
		const status = await runtimeManager.status();
		if (!status.connected) return {
			reachable: false,
			ip: null,
			error: "Соединение не подключено"
		};
		if (IS_TEST_MOCK_RUNTIME) return {
			reachable: true,
			ip: "203.0.113.1",
			error: null
		};
		const proxyPort = status.proxyPort;
		if (!proxyPort) return {
			reachable: false,
			ip: null,
			error: "Порт локального прокси неизвестен"
		};
		const { ProxyAgent, fetch: proxyFetch } = await import("undici");
		const dispatcher = new ProxyAgent(`http://127.0.0.1:${proxyPort}`);
		try {
			return {
				reachable: true,
				ip: await firstSuccessful(ROUTE_PROBE_ENDPOINTS.map((endpoint) => async (signal) => {
					const probedIp = await fetchRouteProbeIp("proxy", () => fetchWithRetry(endpoint, {
						fetchImpl: proxyFetch,
						dispatcher,
						signal,
						timeoutMs,
						retries: 0,
						retryBaseDelayMs: 200
					}).then(({ response }) => response));
					if (typeof probedIp !== "string" || probedIp.length === 0) throw new Error(`Route probe ${endpoint} did not return an egress IP.`);
					return probedIp;
				})),
				error: null
			};
		} catch {
			return {
				reachable: false,
				ip: null,
				error: "Внешний маршрут соединения не подтвердился"
			};
		} finally {
			await dispatcher.close().catch(() => void 0);
		}
	};
	const connectVpnUncoordinated = async (requestedNodeId, source = "user") => {
		const state = stateStore.get();
		const targetNodeId = requestedNodeId || state.activeNodeId || state.nodes[0]?.id;
		let activeNode = state.nodes.find((node) => node.id === targetNodeId) ?? state.nodes[0] ?? null;
		if (!activeNode) {
			logger.error("[vpn:connect] Node not found. targetNodeId:", targetNodeId, "requestedNodeId:", requestedNodeId, "stateActiveNodeId:", state.activeNodeId);
			return {
				...await runtimeManager.status(),
				lastError: `Узел не найден (ID: ${targetNodeId || "не указан"}). Выберите сервер.`,
				lifecycle: "failed",
				diagnostic: {
					reason: "server_unreachable",
					details: `Узел не найден (ID: ${targetNodeId || "не указан"}). Выберите сервер.`,
					updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
					fallbackAttempted: false,
					fallbackTarget: null
				}
			};
		}
		logger.info(`[vpn:connect] Connecting to ${activeNode.name} (${source})`);
		if (!IS_TEST_MOCK_RUNTIME) try {
			await zapretManager.prepareForVpn(state.settings.zapretSuspendDuringVpn);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Не удалось безопасно приостановить профиль перед запуском соединения.";
			logger.warn("[vpn:connect] Zapret suspend failed:", error);
			return {
				...await runtimeManager.status(),
				lastError: message,
				lifecycle: "failed",
				diagnostic: {
					reason: "runtime_start_failed",
					details: message,
					updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
					fallbackAttempted: false,
					fallbackTarget: null
				}
			};
		}
		let result = await runtimeManager.connect(activeNode, state.domainRules, state.processRules, state.settings);
		if (result.connected && result.activeNodeId === activeNode.id) {
			const egress = await probeProxyEgress();
			if (egress.reachable) {
				result = await runtimeManager.markEgressVerified(egress.ip);
			} else {
				const details = egress.error ?? `Локальный runtime для ${activeNode.name} запущен, но внешний маршрут не подтвердился.`;
				const fallbackCandidates = (state.nodes || []).filter((node) => node.id !== activeNode.id);
				fallbackCandidates.sort((a, b) => {
					const aIsAuto = (a.name || "").toLowerCase().includes("auto");
					const bIsAuto = (b.name || "").toLowerCase().includes("auto");
					if (aIsAuto && !bIsAuto) return -1;
					if (!aIsAuto && bIsAuto) return 1;
					const aPing = Number(a.pingMs) || 9999;
					const bPing = Number(b.pingMs) || 9999;
					return aPing - bPing;
				});
				let fallbackConnected = false;
				for (const fallbackNode of fallbackCandidates.slice(0, 2)) {
					logger.info(`[vpn:connect] Attempting fallback node: ${fallbackNode.name} (${fallbackNode.id})`);
					try {
						const fbResult = await runtimeManager.connect(fallbackNode, state.domainRules, state.processRules, state.settings);
						if (fbResult.connected && fbResult.activeNodeId === fallbackNode.id) {
							const fbEgress = await probeProxyEgress();
							if (fbEgress.reachable) {
								result = await runtimeManager.markEgressVerified(fbEgress.ip);
								activeNode = fallbackNode;
								await stateStore.patch({ activeNodeId: fallbackNode.id });
								fallbackConnected = true;
								logger.info(`[vpn:connect] Fallback succeeded with node: ${fallbackNode.name} (${fbEgress.ip})`);
								break;
							}
						}
					} catch (fbErr) {
						logger.warn(`[vpn:connect] Fallback to ${fallbackNode.name} error:`, fbErr);
					}
				}
				if (!fallbackConnected) {
					logger.warn("[vpn:connect] Rejecting unverified connection session:", details);
					result = await runtimeManager.rejectActiveConnection("server_unreachable", details);
					if (result.connected && result.activeNodeId !== activeNode.id) {
						const restoredEgress = await probeProxyEgress();
						result = restoredEgress.reachable ? await runtimeManager.markEgressVerified(restoredEgress.ip) : await runtimeManager.rejectActiveConnection("server_unreachable", restoredEgress.error ?? "Предыдущее соединение также не прошло проверку внешнего маршрута.");
					}
				}
			}
		}
		if (!IS_TEST_MOCK_RUNTIME && !result.connected && state.settings.zapretSuspendDuringVpn) try {
			await zapretManager.restoreAfterVpnIfNeeded(state.settings.zapretSuspendDuringVpn, state.settings.zapretProfile);
		} catch (error) {
			logger.warn("[vpn:connect] Failed to restore Zapret after unsuccessful VPN connect:", error);
		}
		if (result.connected && result.activeNodeId === activeNode.id && state.activeNodeId !== activeNode.id) await stateStore.patch({ activeNodeId: activeNode.id });
		if (Notification.isSupported()) {
			const currentState = stateStore.get();
			const notificationsEnabled = currentState.settings.notifications !== false;
			const connectedNode = currentState.nodes.find((node) => node.id === result.activeNodeId) ?? currentState.nodes.find((node) => node.id === activeNode.id) ?? activeNode;
			if (notificationsEnabled) {
				if (result.connected && result.activeNodeId === activeNode.id) new Notification({
					title: source === "watchdog" ? "Egoist Lagom: Маршрут восстановлен" : "Egoist Lagom: Защита включена",
					body: `Подключено к: ${activeNode.name}`,
					silent: true
				}).show();
				else if (source === "user" && result.connected && connectedNode) new Notification({
					title: "Egoist Lagom: Переключение отменено",
					body: `Сохранено текущее соединение: ${connectedNode.name}`,
					silent: true
				}).show();
				else if (source === "user" && result.lastError) new Notification({
					title: "Egoist Lagom: Ошибка",
					body: `${activeNode.name}: ${result.lastError}`
				}).show();
			}
		}
		updateTrayMenu(result.connected);
		logVpnStatusEvent(result.connected ? "info" : "warn", `vpn:connect completed (${source})`, result);
		return result;
	};
	const connectVpn = (requestedNodeId, source = "user") => {
		const operation = () => connectVpnUncoordinated(requestedNodeId, source);
		return networkCombinatorManager ? networkCombinatorManager.runCoordinatedMutation({
			module: "vpn",
			action: source === "watchdog" ? "reconnect" : "connect",
			requiredLocks: ["traffic-route", "zapret-suspend"],
			conflictsWith: [
				"packet-interception",
				"windivert"
			]
		}, operation) : operation();
	};
	const reconnectSupervisor = new VpnReconnectSupervisor({
		readEnabled: () => stateStore.get().settings.reconnectOnDrop !== false,
		getStatus: () => runtimeManager.status(),
		reconnect: () => connectVpn(void 0, "watchdog"),
		log: (level, message) => logger[level](message)
	});
	reconnectSupervisor.start();
	globalThis.reconnectSupervisor = reconnectSupervisor;
	app.once("before-quit", () => reconnectSupervisor.stop());
	ipcMain.handle("vpn:connect", async (_event, requestedNodeId) => {
		reconnectSupervisor.beginManualConnect();
		const result = await connectVpn(requestedNodeId, "user");
		reconnectSupervisor.recordConnectionResult(result);
		return {
			...result,
			reconnect: reconnectSupervisor.snapshot()
		};
	});
	const disconnectVpn = async () => {
		reconnectSupervisor.cancel();
		const result = await runtimeManager.disconnect();
		const state = stateStore.get();
		if (!IS_TEST_MOCK_RUNTIME && state.settings.zapretSuspendDuringVpn) try {
			await zapretManager.restoreAfterVpnIfNeeded(state.settings.zapretSuspendDuringVpn, state.settings.zapretProfile);
		} catch (error) {
			logger.warn("[vpn:disconnect] Failed to restore Zapret service:", error);
		}
		if (Notification.isSupported()) {
			if (stateStore.get().settings.notifications !== false) new Notification({
				title: "Egoist Lagom: Отключено",
				body: "Соединение отключено. Трафик не защищён.",
				silent: true
			}).show();
		}
		updateTrayMenu(false);
		logVpnStatusEvent("info", "vpn:disconnect completed", result);
		return result;
	};
	ipcMain.handle("vpn:disconnect", async () => {
		const operation = () => disconnectVpn();
		return networkCombinatorManager ? networkCombinatorManager.runCoordinatedMutation({
			module: "vpn",
			action: "disconnect",
			requiredLocks: ["traffic-route", "zapret-suspend"],
			conflictsWith: [
				"packet-interception",
				"windivert"
			]
		}, operation) : operation();
	});
	/**
	* Периодическая перепроверка внешнего маршрута.
	*
	* Локальный порт живёт ровно столько, сколько живёт процесс рантайма, а
	* туннель может умереть на стороне сервера (истёк ключ, забанен IP, упал
	* upstream). Без этого watchdog `egressVerified` оставался бы true до самого
	* disconnect, и интерфейс продолжал бы показывать «защищено» на мёртвом
	* туннеле. Сессию не рвём — только снимаем подтверждение, чтобы статус
	* перестал врать; при восстановлении маршрута подтверждение возвращается.
	*/
	let egressWatchdogInFlight = false;
	let egressConsecutiveFailures = 0;
	const runEgressWatchdog = async () => {
		if (egressWatchdogInFlight) return;
		egressWatchdogInFlight = true;
		try {
			const status = await runtimeManager.status();
			if (!status.connected) {
				egressConsecutiveFailures = 0;
				return;
			}
			const egress = await probeProxyEgress();
			if (egress.reachable) {
				egressConsecutiveFailures = 0;
				if (!status.egressVerified || egress.ip !== status.egressIp) await runtimeManager.markEgressVerified(egress.ip);
				return;
			}
			egressConsecutiveFailures += 1;
			if (egressConsecutiveFailures >= EGRESS_WATCHDOG_FAILURE_THRESHOLD && status.egressVerified) {
				const details = egress.error ?? "Внешний маршрут перестал отвечать: соединение больше не подтверждено.";
				logger.warn("[vpn:egress-watchdog] Dropping egress verification:", details);
				await runtimeManager.markEgressUnverified(details);
			}
		} catch (error) {
			logger.debug("[vpn:egress-watchdog] probe failed:", error);
		} finally {
			egressWatchdogInFlight = false;
		}
	};
	/**
	* Адаптивная частота watchdog (MED-07).
	*
	* Фиксированные 45 с при пороге в две неудачи означали до ~90 с ложнозелёного
	* статуса. Теперь после первого промаха интервал сокращается до 12 с, поэтому
	* отказ подтверждается за ~24 с; в здоровом состоянии частота остаётся
	* спокойной и не создаёт лишней нагрузки.
	*/
	if (!IS_TEST_MOCK_RUNTIME) {
		let watchdogTimer = null;
		const scheduleWatchdog = (delayMs) => {
			if (watchdogTimer) clearTimeout(watchdogTimer);
			watchdogTimer = setTimeout(async () => {
				await runEgressWatchdog();
				scheduleWatchdog(egressConsecutiveFailures > 0 ? EGRESS_WATCHDOG_DEGRADED_INTERVAL_MS : EGRESS_WATCHDOG_INTERVAL_MS);
			}, delayMs);
			watchdogTimer.unref?.();
		};
		scheduleWatchdog(EGRESS_WATCHDOG_INTERVAL_MS);
		const runImmediately = (reason) => {
			logger.info(`[vpn:egress-watchdog] immediate check: ${reason}`);
			scheduleWatchdog(0);
		};
		powerMonitor.on("resume", () => runImmediately("system resume"));
		powerMonitor.on("unlock-screen", () => runImmediately("session unlock"));
	}
	ipcMain.handle("vpn:status", async () => {
		return {
			...await runtimeManager.status(),
			reconnect: reconnectSupervisor.snapshot()
		};
	});
	ipcMain.handle("vpn:diagnose", async () => {
		const localResult = await runtimeManager.diagnose();
		const egress = localResult.ok ? await probeProxyEgress() : {
			reachable: false,
			ip: null,
			error: "Локальный runtime недоступен"
		};
		const result = {
			...localResult,
			ok: Boolean(localResult.ok && egress.reachable),
			egressReachable: egress.reachable,
			egressIp: egress.ip,
			egressError: egress.error,
			message: localResult.ok && !egress.reachable ? "Локальный runtime отвечает, но внешний маршрут не подтверждён. Проверьте сервер или маршрут." : localResult.message
		};
		logger.debug(formatRuntimeLogEvent({
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			level: "debug",
			lifecycle: result.lifecycle ?? "failed",
			reason: result.failureReason ?? null,
			message: result.message,
			nodeId: null,
			runtimeKind: null,
			proxyPort: null
		}));
		return result;
	});
	ipcMain.handle("vpn:stress-test", async (_event, rawIterations) => {
		const iterations = StressTestInputSchema.parse(rawIterations);
		const state = stateStore.get();
		const activeNode = state.nodes.find((node) => node.id === state.activeNodeId) ?? null;
		if (!activeNode) return {
			iterations,
			connectSuccess: 0,
			connectFailed: iterations,
			disconnectSuccess: 0,
			disconnectFailed: 0,
			errors: ["Нет активного узла для стресс-теста."]
		};
		return runtimeManager.stressTest(activeNode, state.domainRules, state.processRules, state.settings, iterations);
	});
	/**
	* Проверка защиты маршрута.
	*
	* Сравнение внешних адресов — только ОДНО из доказательств. Отдельно
	* читается фактическая конфигурация системного прокси Windows: работающий
	* локальный порт не означает, что операционная система направлена через него
	* (HIGH-02). Итог возвращается типизированным вердиктом (HIGH-11).
	*/
	const handleRouteProbe = async () => {
		try {
			const status = await runtimeManager.status();
			if (!status.connected) return buildNotApplicableProtectionReport("Проверка защиты доступна после подключения.");
			const proxyPort = status.proxyPort;
			if (!proxyPort) return buildInconclusiveProtectionReport("Порт локального прокси неизвестен.");
			const mode = stateStore.get().settings.useTunMode ? "tun" : "system_proxy";
			const { ProxyAgent, fetch: proxyFetch } = await import("undici");
			const dispatcher = new ProxyAgent(`http://127.0.0.1:${proxyPort}`);
			try {
				const [directIp, vpnIp, systemProxy] = await Promise.all([
					fetchRouteProbeIp("direct", () => fetchWithRetry(ROUTE_PROBE_ENDPOINT, {
						timeoutMs: 5e3,
						retries: 1,
						retryBaseDelayMs: 350
					}).then(({ response }) => response)),
					fetchRouteProbeIp("proxy", () => fetchWithRetry(ROUTE_PROBE_ENDPOINT, {
						fetchImpl: proxyFetch,
						dispatcher,
						timeoutMs: 8e3,
						retries: 1,
						retryBaseDelayMs: 350
					}).then(({ response }) => response)),
					IS_TEST_MOCK_RUNTIME ? Promise.resolve(null) : readSystemProxyState().catch((error) => {
						logger.debug("[vpn:route-probe] system proxy read failed:", error);
						return null;
					})
				]);
				return buildRouteProbeResult({
					directIp,
					vpnIp,
					mode,
					expectedEndpoint: `127.0.0.1:${proxyPort}`,
					systemProxy: systemProxy ? {
						enabled: systemProxy.enabled,
						proxyServer: systemProxy.proxyServer,
						autoConfigUrl: systemProxy.autoConfigUrl,
						ownedByApp: systemProxy.ownedByApp,
						managedEndpoint: systemProxy.managedEndpoint
					} : null
				});
			} finally {
				await dispatcher.close().catch(() => void 0);
			}
		} catch (e) {
			return buildInconclusiveProtectionReport(e instanceof Error ? e.message : "Ошибка проверки сетевого маршрута");
		}
	};
	ipcMain.handle("vpn:route-probe", handleRouteProbe);
	/**
	* Повторно применяет системный маршрут активной сессии.
	*
	* Это ТОЧЕЧНОЕ исправление того, что нашла проверка защиты: Windows не
	* направлен на локальный прокси текущей сессии. Оно не трогает DNS, Zapret,
	* Telegram и WinHTTP — в отличие от общего «восстановить интернет».
	*/
	ipcMain.handle("vpn:reapply-route", async () => {
		const status = await runtimeManager.status();
		if (!status.connected || !status.proxyPort) return {
			ok: false,
			message: "Маршрут можно применить только при активном VPN-подключении."
		};
		if (IS_TEST_MOCK_RUNTIME) return {
			ok: true,
			message: "Маршрут применён повторно (mock)."
		};
		try {
			const result = await enableSystemProxy(status.proxyPort);
			if (!result.ok) return {
				ok: false,
				message: `Не удалось применить маршрут: ${result.error ?? "проверка не подтвердила запись"}`
			};
			const verified = await readSystemProxyState();
			if (!verified.enabled || verified.proxyServer !== `127.0.0.1:${status.proxyPort}`) return {
				ok: false,
				message: "Windows не подтвердил применение маршрута."
			};
			return {
				ok: true,
				message: result.pacSuspended ? "Маршрут применён; сценарий автоконфигурации (PAC) снят на время работы VPN." : "Маршрут применён к текущей сессии."
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error("[vpn:reapply-route] failed:", message);
			return {
				ok: false,
				message
			};
		}
	});
	/**
	* Проверка пути DNS.
	*
	* Больше не требует подключённого VPN: путь DNS осмысленно проверять и без
	* туннеля. Критерий — соответствие наблюдаемого резолвера ОЖИДАЕМОМУ для
	* текущего режима DNS, а не равенство адресу VPN-сервера (HIGH-11).
	*/
	ipcMain.handle("vpn:dns-leak-test", async () => {
		try {
			const settings = stateStore.get().settings;
			const dnsMode = settings.systemDohEnabled || settings.dnsMode === "gravityless-dns" || settings.dnsMode === "system-doh" ? "app-managed" : "user-external";
			const expectedResolvers = resolveExpectedDnsResolvers(settings, dnsMode);
			const [resolverIp, resolutionWorks] = await Promise.all([resolveSystemDnsResolverIp(), probeDnsResolutionWorks()]);
			return buildDnsLeakTestResult({
				resolverIp,
				mode: dnsMode,
				expectedResolvers,
				resolutionWorks
			});
		} catch (e) {
			return buildInconclusiveProtectionReport(e instanceof Error ? e.message : "Ошибка проверки пути DNS");
		}
	});
	ipcMain.handle("vpn:ping", async (_event, rawHost, rawPort, rawTimeoutMs) => {
		try {
			const parsedPort = typeof rawPort === "string" ? Number.parseInt(rawPort, 10) : Number(rawPort);
			const { host, port, timeoutMs } = PingInputSchema.parse({
				host: String(rawHost ?? "").trim(),
				port: parsedPort,
				timeoutMs: rawTimeoutMs !== undefined ? Number(rawTimeoutMs) : undefined
			});
			return await measureTcpLatency(host, port, timeoutMs ?? 3e3);
		} catch (error) {
			logger.debug("[vpn:ping] Ping validation or execution failed:", rawHost, rawPort, error);
			return -1;
		}
	});
	ipcMain.handle("vpn:ping-active-proxy", async () => {
		const status = await runtimeManager.status();
		if (!status.connected) return -1;
		const state = await stateStore.get();
		const activeNode = state.nodes.find((n) => n.id === status.activeNodeId) ?? state.nodes.find((n) => n.id === state.activeNodeId);
		if (!activeNode?.server || !activeNode.port || Number.isNaN(activeNode.port)) return -1;
		const cacheKey = [
			status.processGeneration ?? "unknown-generation",
			activeNode.id,
			activeNode.server,
			activeNode.port
		].join("|");
		const cached = activeProxyPingCache.get(cacheKey);
		if (cached && Date.now() - cached.measuredAt < ACTIVE_PROXY_PING_CACHE_TTL_MS) return cached.value;
		const existing = activeProxyPingInFlight.get(cacheKey);
		if (existing) return existing;
		const measurement = (async () => {
			try {
				const host = activeNode.server;
				const port = activeNode.port;
				const doPing = () => measureTcpLatency(host, port, 3e3);
				const samples = [];
				for (let i = 0; i < 3; i++) {
					const p = await doPing();
					if (p > 0) samples.push(p);
				}
				samples.sort((a, b) => a - b);
				const result = samples[Math.floor(samples.length / 2)] ?? -1;
				activeProxyPingCache.set(cacheKey, {
					value: result,
					measuredAt: Date.now()
				});
				if (activeProxyPingCache.size > 8) {
					const oldestKey = activeProxyPingCache.keys().next().value;
					if (oldestKey) activeProxyPingCache.delete(oldestKey);
				}
				return result;
			} catch (error) {
				logger.debug("[vpn:ping-active-proxy] Ping failed:", error);
				activeProxyPingCache.set(cacheKey, {
					value: -1,
					measuredAt: Date.now()
				});
				return -1;
			} finally {
				activeProxyPingInFlight.delete(cacheKey);
			}
		})();
		activeProxyPingInFlight.set(cacheKey, measurement);
		return measurement;
	});
	ipcMain.handle("vpn:get-my-ip", async () => {
		const result = {
			ip: null,
			countryCode: null,
			error: null
		};
		const parseIpWho = (body) => {
			try {
				const data = JSON.parse(body);
				if (data.ip) result.ip = data.ip;
				if (data.country_code) result.countryCode = data.country_code.toLowerCase();
				result.error = null;
			} catch {
				result.error = "Parse error";
			}
		};
		const directFetch = async () => {
			try {
				const { text } = await fetchTextWithRetry("https://ipwho.is/?fields=ip,country_code", {
					timeoutMs: 5e3,
					retries: 1,
					retryBaseDelayMs: 350
				});
				parseIpWho(text);
			} catch (e) {
				result.error = e instanceof Error ? e.message : "Direct fetch failed";
			}
		};
		const proxyFetchFn = (proxyPort) => new Promise((resolve) => {
			const proxyReq = http.request({
				host: "127.0.0.1",
				port: proxyPort,
				method: "CONNECT",
				path: "ipwho.is:443",
				timeout: 8e3
			});
			proxyReq.on("connect", (_res, socket) => {
				const tlsSocket = tls.connect({
					socket,
					servername: "ipwho.is",
					rejectUnauthorized: true
				}, () => {
					tlsSocket.write("GET /?fields=ip,country_code HTTP/1.1\r\nHost: ipwho.is\r\nConnection: close\r\n\r\n");
					let body = "";
					let headersDone = false;
					tlsSocket.on("data", (chunk) => {
						const str = chunk.toString();
						if (!headersDone) {
							const idx = str.indexOf("\r\n\r\n");
							if (idx >= 0) {
								headersDone = true;
								body += str.slice(idx + 4);
							}
						} else body += str;
					});
					tlsSocket.on("end", () => {
						parseIpWho(body);
						resolve();
					});
					tlsSocket.on("error", (e) => {
						result.error = e.message;
						resolve();
					});
					setTimeout(() => {
						if (!tlsSocket.destroyed) {
							tlsSocket.destroy();
							result.error = "Timeout";
							resolve();
						}
					}, 8e3);
				});
				tlsSocket.on("error", (e) => {
					result.error = e.message;
					resolve();
				});
			});
			proxyReq.on("error", (e) => {
				result.error = e.message;
				resolve();
			});
			proxyReq.on("timeout", () => {
				proxyReq.destroy();
				result.error = "Timeout";
				resolve();
			});
			proxyReq.end();
		});
		try {
			const status = await runtimeManager.status();
			if (status.connected && status.proxyPort) {
				await proxyFetchFn(status.proxyPort);
				if (!result.ip) {
					await new Promise((r) => setTimeout(r, 1e3));
					await proxyFetchFn(status.proxyPort);
				}
				if (!result.ip) {
					result.countryCode = null;
					result.error = result.error ? `Proxy egress probe failed: ${result.error}` : "Proxy egress probe failed";
				}
			} else {
				await directFetch();
				if (!result.ip) {
					await new Promise((r) => setTimeout(r, 1e3));
					await directFetch();
				}
			}
		} catch (e) {
			result.error = e instanceof Error ? e.message : String(e);
		}
		return result;
	});
	const emitSpeedtestProgress = (progress) => {
		if (window && !window.isDestroyed()) window.webContents.send("vpn:speedtest-progress", progress);
	};
	/**
	* Выбирает measurement endpoint по ФАКТИЧЕСКОЙ задержке (MED-20).
	*
	* Прежняя реализация брала первый успешно ответивший endpoint из жёсткого
	* порядка (начиная с Cloudflare) и при этом сообщала пользователю, что
	* «подбирает ближайший». Теперь кандидаты пробуются параллельно, и берётся
	* тот, у которого реально ниже задержка. Если ни один не ответил, возвращается
	* null и дальше работает прежний фолбэк по порядку.
	*/
	const selectMeasurementEndpoint = async (proxyPort) => {
		const measurementGrade = ROUTE_SPEED_DOWNLOAD_ENDPOINTS.filter((endpoint) => endpoint.measurementGrade);
		if (measurementGrade.length === 0) return null;
		if (measurementGrade.length === 1) return measurementGrade[0];
		const reachable = (await Promise.allSettled(measurementGrade.map(async (endpoint) => ({
			endpoint,
			latencyMs: await measureRouteLatency(endpoint, proxyPort)
		})))).filter((probe) => probe.status === "fulfilled" && Number.isFinite(probe.value.latencyMs)).map((probe) => probe.value).sort((a, b) => a.latencyMs - b.latencyMs);
		if (reachable.length === 0) return measurementGrade[0];
		logger.debug(`[vpn:speedtest] measurement endpoint: ${reachable[0].endpoint.name} (${Math.round(reachable[0].latencyMs)} ms, measurement-grade)`);
		return reachable[0].endpoint;
	};
	/**
	* Многопоточное измерение скачивания с окном по ВРЕМЕНИ (MED-20).
	*
	* ПОЧЕМУ ОДНОГО ПОТОКА НЕДОСТАТОЧНО
	*
	* Один TLS-поток ограничен произведением пропускной способности на задержку и
	* поведением конкретного CDN. На быстром канале он физически не выходит на
	* скорость линии, и фиксированный объём 10–25 МБ заканчивается ещё до выхода
	* TCP на устойчивый режим. Именно поэтому замер показывал 14 Мбит/с там, где
	* канал даёт около 500.
	*
	* Здесь потоки открываются параллельно, их скорости суммируются, а объём
	* запрашивается с запасом, чтобы окно измерения определялось временем, а не
	* тем, что файл кончился.
	*/
	const measureDownloadParallel = async (proxyPort, endpoint, streams, bytesPerStream) => {
		const started = performance.now();
		const results = await Promise.allSettled(Array.from({ length: streams }, () => measureDownloadEndpoint(materializeDownloadEndpoint(endpoint, bytesPerStream), proxyPort)));
		const ok = results.filter((item) => item.status === "fulfilled" && item.value.bytes > 0);
		if (ok.length === 0) {
			const reason = results.map((item) => item.status === "rejected" ? truncateProbeError(String(item.reason)) : "").filter(Boolean).slice(0, 2).join("; ");
			throw new Error(reason || "Скачивание недоступно");
		}
		const totalBytes = ok.reduce((sum, item) => sum + item.value.bytes, 0);
		const wallTimeMs = Math.max(1, performance.now() - started);
		const wallMbps = Math.round(totalBytes * 8 / (wallTimeMs / 1e3) / 1e6 * 100) / 100;
		const finalMbps = Math.max(0.1, wallMbps);
		return {
			downloadMbps: finalMbps,
			bytes: totalBytes,
			timeMs: wallTimeMs,
			streams: ok.length,
			endpoint: ok[0].value.endpoint
		};
	};
	const runSpeedtest = async () => {
		const startedAt = performance.now();
		const totalSteps = 19;
		let completed = 0;
		const emit = (phase, percent, detail, extra = {}) => emitSpeedtestProgress({
			phase,
			percent: Math.max(0, Math.min(100, Math.round(percent))),
			detail,
			completed,
			total: totalSteps,
			...extra
		});
		try {
			emit("preparing", 2, "Определяю активный маршрут и выбираю measurement endpoint по фактической задержке.");
			const status = await runtimeManager.status();
			const proxyPort = status.connected && status.proxyPort ? status.proxyPort : null;
			const state = stateStore.get();
			const activeNode = state.nodes.find((node) => node.id === state.activeNodeId) ?? null;
			const selectedEndpoint = await selectMeasurementEndpoint(proxyPort);
			throwIfSpeedtestCancelled();
			const warmup = await measureDownload(proxyPort, ROUTE_SPEED_WARMUP_BYTES, selectedEndpoint ?? void 0);
			completed += 1;
			throwIfSpeedtestCancelled();
			warmup.timeMs;
			const uploadBytes = warmup.downloadMbps >= 80 ? ROUTE_SPEED_FAST_UPLOAD_BYTES : ROUTE_SPEED_UPLOAD_BYTES;
			/**
			* Число потоков и объём на поток по результату разогрева (MED-20).
			*
			* Чем быстрее канал, тем больше нужно и потоков, и данных: иначе окно
			* измерения закончится до выхода TCP на устойчивую скорость, и результат
			* будет занижен. Объём считается из наблюдаемой скорости так, чтобы каждый
			* поток качал ориентировочно 4 секунды, но не меньше 8 МБ и не больше
			* 96 МБ — верхняя граница ограничивает расход трафика.
			*/
			const warmupMbps = Math.max(1, warmup.downloadMbps);
			const downloadStreams = warmupMbps >= 100 ? 8 : warmupMbps >= 30 ? 6 : 4;
			const targetPerStreamBytes = Math.round(Math.max(warmupMbps, 200) * 1e6 / 8 / downloadStreams * 4);
			const bytesPerStream = Math.min(128e6, Math.max(20e6, targetPerStreamBytes));
			logger.info(`[vpn:speedtest] warmup ${warmup.downloadMbps} Mbit/s via ${warmup.endpoint.name}; plan ${downloadStreams} stream(s) x ${Math.round(bytesPerStream / 1e6)} MB`);
			emit("latency", 8, "Измеряю HTTPS latency, jitter и потери контрольных проб.");
			const measurementStartedAt = performance.now();
			const idleLatencySamples = [];
			for (let index = 0; index < SPEEDTEST_LATENCY_ATTEMPTS; index += 1) {
				throwIfSpeedtestCancelled();
				try {
					idleLatencySamples.push(await measureRouteLatency(warmup.endpoint, proxyPort));
				} catch {}
				completed += 1;
				const partialLatency = summarizeLatency(idleLatencySamples, index + 1);
				emit("latency", 8 + (index + 1) / SPEEDTEST_LATENCY_ATTEMPTS * 20, `Latency probe ${index + 1}/${SPEEDTEST_LATENCY_ATTEMPTS}.`, { latencyMs: partialLatency.latencyMs });
				if (index < SPEEDTEST_LATENCY_ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, 90));
			}
			const idleLatency = summarizeLatency(idleLatencySamples, SPEEDTEST_LATENCY_ATTEMPTS);
			const downloadSamples = [];
			let downloadLoadedLatency = null;
			for (let index = 0; index < SPEEDTEST_BANDWIDTH_SAMPLES; index += 1) {
				throwIfSpeedtestCancelled();
				emit(index === 0 ? "download-loaded-latency" : "download", 30 + index / SPEEDTEST_BANDWIDTH_SAMPLES * 28, `Скачивание ${index + 1}/${SPEEDTEST_BANDWIDTH_SAMPLES}: ${downloadStreams} потока по ${Math.round(bytesPerStream / 1e6)} МБ через активный маршрут.`);
				const downloadPromise = measureDownloadParallel(proxyPort, warmup.endpoint, downloadStreams, bytesPerStream);
				const [download, loadedLatency] = index === 0 ? await Promise.all([downloadPromise, measureLatencySeries(warmup.endpoint, proxyPort, 5, 240)]) : [await downloadPromise, null];
				downloadSamples.push({
					mbps: download.downloadMbps,
					bytes: download.bytes,
					timeMs: download.timeMs
				});
				if (loadedLatency) downloadLoadedLatency = loadedLatency;
				completed += 1;
				emit("download", 30 + (index + 1) / SPEEDTEST_BANDWIDTH_SAMPLES * 28, `Получена выборка ↓ ${download.downloadMbps} Мбит/с.`, {
					liveDownloadMbps: summarizeBandwidth(downloadSamples).mbps,
					latencyMs: downloadLoadedLatency?.latencyMs ?? idleLatency.latencyMs
				});
			}
			const download = summarizeBandwidth(downloadSamples);
			const uploadSamples = [];
			let uploadLoadedLatency = null;
			let uploadProvider = null;
			let uploadError = null;
			for (let index = 0; index < SPEEDTEST_BANDWIDTH_SAMPLES; index += 1) {
				throwIfSpeedtestCancelled();
				emit(index === 0 ? "upload-loaded-latency" : "upload", 60 + index / SPEEDTEST_BANDWIDTH_SAMPLES * 30, `Отдача ${index + 1}/${SPEEDTEST_BANDWIDTH_SAMPLES}: ${Math.round(uploadBytes / 1e6)} МБ через активный маршрут.`, { liveDownloadMbps: download.mbps });
				try {
					const uploadPromise = measureUpload(proxyPort, uploadBytes);
					const [uploadSample, loadedLatency] = index === 0 ? await Promise.all([uploadPromise, measureLatencySeries(warmup.endpoint, proxyPort, 5, 240)]) : [await uploadPromise, null];
					uploadSamples.push({
						mbps: uploadSample.uploadMbps,
						bytes: uploadSample.uploadBytes,
						timeMs: uploadSample.uploadTimeMs
					});
					uploadProvider = uploadSample.endpoint.name;
					if (loadedLatency) uploadLoadedLatency = loadedLatency;
					emit("upload", 60 + (index + 1) / SPEEDTEST_BANDWIDTH_SAMPLES * 30, `Получена выборка ↑ ${uploadSample.uploadMbps} Мбит/с.`, {
						liveDownloadMbps: download.mbps,
						liveUploadMbps: summarizeBandwidth(uploadSamples).mbps,
						latencyMs: uploadLoadedLatency?.latencyMs ?? idleLatency.latencyMs
					});
				} catch (error) {
					uploadError = truncateProbeError(error instanceof Error ? error.message : String(error));
				}
				completed += 1;
			}
			const upload = uploadSamples.length > 0 ? summarizeBandwidth(uploadSamples) : null;
			const partialErrors = uploadSamples.length < SPEEDTEST_BANDWIDTH_SAMPLES ? 1 : 0;
			const quality = buildSpeedQualitySummary({
				download,
				upload,
				idleLatency,
				downloadLoadedLatency,
				uploadLoadedLatency,
				partialErrors,
				measurementDurationMs: performance.now() - measurementStartedAt,
				providerCount: new Set([warmup.endpoint.name, uploadProvider].filter((value) => Boolean(value))).size
			});
			const serverTcpLatency = await measureTcpLatency(proxyPort && activeNode ? activeNode.server : warmup.endpoint.host, proxyPort && activeNode ? activeNode.port : warmup.endpoint.port ?? 443, 1800).catch(() => -1);
			completed += 1;
			emit("finalizing", 96, "Проверяю статистику и формирую устойчивый итог без случайных всплесков.", {
				liveDownloadMbps: download.mbps,
				liveUploadMbps: upload?.mbps ?? null,
				latencyMs: idleLatency.latencyMs
			});
			const totalBytes = download.bytes + (upload?.bytes ?? 0) + warmup.bytes;
			const totalTimeMs = performance.now() - startedAt;
			const result = {
				speed: download.mbps,
				downloadMbps: download.mbps,
				downloadAverageMbps: download.averageMbps,
				downloadP90Mbps: download.p90Mbps,
				downloadMinMbps: download.minMbps,
				downloadMaxMbps: download.maxMbps,
				downloadStabilityPercent: download.stabilityPercent,
				downloadSamples: download.samples,
				...upload ? {
					uploadMbps: upload.mbps,
					uploadAverageMbps: upload.averageMbps,
					uploadP90Mbps: upload.p90Mbps,
					uploadMinMbps: upload.minMbps,
					uploadMaxMbps: upload.maxMbps,
					uploadStabilityPercent: upload.stabilityPercent,
					uploadSamples: upload.samples
				} : {},
				bytes: download.bytes,
				uploadBytes: upload?.bytes ?? 0,
				totalBytes,
				timeMs: download.timeMs,
				uploadTimeMs: upload?.timeMs ?? 0,
				totalTimeMs,
				pingMs: idleLatency.latencyMs,
				jitterMs: idleLatency.jitterMs,
				latencyMinMs: idleLatency.minMs,
				latencyMaxMs: idleLatency.maxMs,
				latencySamples: idleLatency.samples,
				httpsProbeLossPercent: idleLatency.sampleLossPercent,
				tcpProbeLossPercent: idleLatency.sampleLossPercent,
				downloadLoadedLatencyMs: downloadLoadedLatency?.latencyMs ?? null,
				downloadLoadedJitterMs: downloadLoadedLatency?.jitterMs ?? null,
				uploadLoadedLatencyMs: uploadLoadedLatency?.latencyMs ?? null,
				uploadLoadedJitterMs: uploadLoadedLatency?.jitterMs ?? null,
				serverTcpLatencyMs: serverTcpLatency > 0 ? serverTcpLatency : null,
				qualityScore: quality.score,
				qualityGrade: quality.grade,
				confidence: quality.confidence,
				confidenceReasons: quality.confidenceReasons,
				measurementDurationMs: quality.measurementDurationMs,
				providerCount: quality.providerCount,
				provider: warmup.endpoint.name,
				downloadHost: warmup.endpoint.host,
				downloadStreams,
				measurementGrade: warmup.endpoint.measurementGrade === true,
				uploadProvider,
				uploadError,
				mode: proxyPort ? "vpn-proxy" : "system-route",
				routeLabel: proxyPort ? "VPN proxy" : "Системный маршрут",
				methodology: "adaptive-median-multi-sample",
				latencyMethod: "HTTPS connect + TTFB через активный маршрут",
				sampleCount: {
					latency: idleLatency.samples.length,
					latencyAttempts: SPEEDTEST_LATENCY_ATTEMPTS,
					download: download.samples.length,
					upload: upload?.samples.length ?? 0
				},
				testedAt: (/* @__PURE__ */ new Date()).toISOString(),
				error: null
			};
			completed = totalSteps;
			emit("complete", 100, "Замер завершён: показана медиана нескольких выборок.", {
				liveDownloadMbps: download.mbps,
				liveUploadMbps: upload?.mbps ?? null,
				latencyMs: idleLatency.latencyMs
			});
			return result;
		} catch (e) {
			if (e instanceof SpeedtestCancelledError) {
				emit("error", 100, "Замер отменён.");
				return {
					speed: 0,
					cancelled: true,
					error: null
				};
			}
			const error = (e instanceof Error ? e.message : String(e)) || "Ошибка проверки маршрута";
			emit("error", 100, error);
			return {
				speed: 0,
				error
			};
		}
	};
	ipcMain.handle("vpn:speedtest", async () => {
		if (!speedtestInFlight) {
			speedtestCancelled = false;
			speedtestInFlight = runSpeedtest().finally(() => {
				speedtestInFlight = null;
				speedtestCancelled = false;
			});
		}
		return speedtestInFlight;
	});
	/**
	* Отмена замера скорости.
	*
	* Раньше закрытие панели только скрывало интерфейс: backend продолжал
	* скачивать и отдавать десятки мегабайт (MED-20). Теперь отмена реально
	* прекращает работу перед следующей фазой.
	*/
	ipcMain.handle("vpn:speedtest-cancel", async () => {
		if (!speedtestInFlight) return {
			ok: true,
			cancelled: false
		};
		speedtestCancelled = true;
		logger.info("[vpn:speedtest] cancellation requested by the user");
		return {
			ok: true,
			cancelled: true
		};
	});
}
//#endregion
