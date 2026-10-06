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
var ROUTE_SPEED_WARMUP_BYTES = 2e6;
var ROUTE_SPEED_DOWNLOAD_BYTES = 25e6;
var ROUTE_SPEED_UPLOAD_BYTES = 2e6;
var ROUTE_SPEED_FAST_UPLOAD_BYTES = 2e6;
var SPEEDTEST_LATENCY_ATTEMPTS = 10;
var SPEEDTEST_BANDWIDTH_SAMPLES = 3;
var EGRESS_WATCHDOG_INTERVAL_MS = 45e3;
/**
* Интервал после первого промаха (MED-07).
*
* После первого отказа следующая проверка запланирована через 12 с.
* Полный срок обнаружения зависит от фазы обычного 45-секундного цикла
* и длительности сетевых проб; это не гарантия обнаружения за 24 с.
*/
var EGRESS_WATCHDOG_DEGRADED_INTERVAL_MS = 12e3;
var EGRESS_WATCHDOG_FAILURE_THRESHOLD = 2;
var IS_TEST_MOCK_RUNTIME = !(typeof app !== "undefined" && app.isPackaged === true) && process.env.EGOISTSHIELD_MOCK_RUNTIME === "1" && (process.env.NODE_ENV === "test" || process.env.VITEST === "true");
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
var speedtestAbortController = null;
var speedtestBudgets = new WeakMap();
var SPEEDTEST_MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
var SPEEDTEST_TOTAL_TIMEOUT_MS = 90e3;
var SpeedtestBudgetExceededError = class extends Error {
	constructor(message) { super(message); this.name = "SpeedtestBudgetExceededError"; }
};
function createSpeedtestBudget(maxBytes = SPEEDTEST_MAX_PAYLOAD_BYTES) {
	return { maxBytes, usedBytes: 0, reservedBytes: 0, reserve(bytes) {
		if (!Number.isSafeInteger(bytes) || bytes < 0 || this.usedBytes + this.reservedBytes + bytes > this.maxBytes) throw new SpeedtestBudgetExceededError("Достигнут лимит данных быстрого замера скорости.");
		const budget = this; let remaining = bytes, released = false;
		budget.reservedBytes += bytes;
		return {
			consume(amount) {
				if (released || !Number.isSafeInteger(amount) || amount < 0 || amount > remaining) throw new SpeedtestBudgetExceededError("Недопустимый объём данных замера скорости.");
				remaining -= amount; budget.reservedBytes -= amount; budget.usedBytes += amount;
			},
			release() { if (!released) { released = true; budget.reservedBytes -= remaining; } }
		};
	} };
}
function speedtestUserAgentHeader() {
	return `User-Agent: EgoistShield/${app.getVersion().replace(/[^0-9A-Za-z.+-]/g, "") || "unknown"} speed-test\r\n`;
}
var SpeedtestCancelledError = class extends Error {
	constructor() {
		super("Замер скорости отменён.");
		this.name = "SpeedtestCancelledError";
	}
};
function throwIfSpeedtestCancelled(signal) {
	if (speedtestCancelled || signal?.aborted) throw new SpeedtestCancelledError();
}
function listenForSpeedtestCancellation(signal, cancel) {
	if (!signal) return () => {};
	const onAbort = () => cancel(signal.reason instanceof SpeedtestBudgetExceededError ? signal.reason : new SpeedtestCancelledError());
	signal.addEventListener("abort", onAbort, { once: true });
	return () => signal.removeEventListener("abort", onAbort);
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
	return String(host || "").trim();
}
async function resolveHostDoh(host, signal) {
	try {
		const { text } = await fetchTextWithRetry(`https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`, {
			headers: { accept: "application/dns-json" },
			timeoutMs: 2e3,
			retries: 0,
			maxBytes: 64 * 1024,
			signal
		});
		const json = JSON.parse(text);
		const ip = json?.Answer?.find((a) => a.type === 1)?.data;
		if (json?.Status === 0 && typeof ip === "string" && isIP(ip) === 4) return ip;
	} catch {}
	return null;
}
function measureTcpLatency(rawHost, port, timeoutMs, signal) {
	const host = normalizeVpnHost(rawHost);
	return new Promise((resolve) => {
		if (signal?.aborted) { resolve(-1); return; }
		let settled = false;
		let fallbackSocket = null;
		let fallbackTimeout = null;
		const start = performance.now();
		const socket = new Socket();
		const timeout = setTimeout(() => finish(-1), timeoutMs);
		const finish = (val) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (fallbackTimeout) clearTimeout(fallbackTimeout);
			removeCancellation();
			socket.destroy();
			fallbackSocket?.destroy();
			resolve(val);
		};
		const removeCancellation = listenForSpeedtestCancellation(signal, () => finish(-1));
		socket.on("connect", () => {
			finish(Math.round(performance.now() - start));
		});
		socket.on("error", async () => {
			if (settled) return;
			if (!isIP(host)) {
				const fallbackIp = await resolveHostDoh(host, signal);
				if (fallbackIp && !settled) {
					fallbackSocket = new Socket();
					const remaining = Math.max(1, timeoutMs - Math.round(performance.now() - start));
					fallbackTimeout = setTimeout(() => finish(-1), remaining);
					fallbackSocket.on("connect", () => {
						finish(Math.round(performance.now() - start));
					});
					fallbackSocket.on("error", () => {
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
	const headers = Object.create(null);
	for (const line of lines.slice(1)) {
		const idx = line.indexOf(":");
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim().toLowerCase();
		const value = line.slice(idx + 1).trim();
		if (key && value) {
			if (Object.hasOwn(headers, key) && (key === "content-length" || key === "transfer-encoding")) throw new Error("Неоднозначные HTTP-заголовки замера скорости.");
			headers[key] = value;
		}
	}
	return {
		statusCode,
		headers
	};
}
function createSpeedtestBodyDecoder(headers, consumePayload) {
	const transfer = headers["transfer-encoding"]?.toLowerCase();
	if (transfer && transfer !== "chunked" || transfer && headers["content-length"] !== void 0) throw new Error("Неподдерживаемое HTTP-обрамление замера скорости.");
	if (headers["content-encoding"] && headers["content-encoding"].toLowerCase() !== "identity") throw new Error("Ответ замера скорости сжат вопреки Accept-Encoding: identity.");
	let remaining = null;
	if (headers["content-length"] !== void 0) {
		if (!/^[0-9]{1,15}$/.test(headers["content-length"])) throw new Error("Некорректная длина HTTP-ответа.");
		remaining = Number(headers["content-length"]);
		if (!Number.isSafeInteger(remaining)) throw new Error("Слишком большая длина HTTP-ответа.");
	}
	let state = transfer ? "size" : "identity", buffer = Buffer.alloc(0), trailerBytes = 0;
	let done = !transfer && remaining === 0;
	return {
		push(chunk) {
			if (done) return true;
			if (!transfer) {
				if (remaining !== null && chunk.length > remaining) throw new Error("Лишние данные после HTTP Content-Length.");
				const bytes = remaining === null ? chunk.length : Math.min(chunk.length, remaining);
				if (bytes) consumePayload(bytes);
				if (remaining !== null) { remaining -= bytes; done = remaining === 0; }
				return done;
			}
			buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
			while (!done) {
				if (state === "size" || state === "trailers") {
					const end = buffer.indexOf("\r\n");
					if (end < 0) { if (buffer.length > 1024) throw new Error("Слишком длинная HTTP chunk/trailer строка."); return false; }
					if (end > 1024) throw new Error("Слишком длинная HTTP chunk/trailer строка.");
					const line = buffer.subarray(0, end).toString("ascii");
					buffer = buffer.subarray(end + 2);
					if (state === "trailers") {
						trailerBytes += end + 2;
						if (trailerBytes > 16 * 1024 || line && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+:[\x09\x20-\x7e]*$/.test(line) || /^(content-length|transfer-encoding):/i.test(line)) throw new Error("Некорректные HTTP trailers.");
						if (!line) done = true;
						continue;
					}
					if (!/^[0-9A-Fa-f]{1,15}(?:;[\x20-\x7e]*)?$/.test(line)) throw new Error("Некорректный размер HTTP chunk.");
					remaining = Number.parseInt(line.split(";")[0], 16);
					if (!Number.isSafeInteger(remaining)) throw new Error("Слишком большой HTTP chunk.");
					state = remaining === 0 ? "trailers" : "data";
				} else if (state === "data") {
					const bytes = Math.min(buffer.length, remaining);
					if (!bytes) return false;
					consumePayload(bytes);
					buffer = buffer.subarray(bytes); remaining -= bytes;
					if (!remaining) state = "data-crlf";
				} else {
					if (buffer.length < 2) return false;
					if (buffer[0] !== 13 || buffer[1] !== 10) throw new Error("Некорректный HTTP chunk delimiter.");
					buffer = buffer.subarray(2); state = "size";
				}
			}
			if (buffer.length) throw new Error("Лишние данные после HTTP body.");
			return true;
		},
		end() { if (transfer && !done || !transfer && remaining !== null && remaining > 0) throw new Error("HTTP body замера скорости оборвался."); }
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
function openRouteProbeTls(endpoint, proxyPort, timeoutMs, signal) {
	if (signal?.aborted) return Promise.reject(new SpeedtestCancelledError());
	const port = endpoint.port ?? 443;
	if (!proxyPort) return new Promise((resolve, reject) => {
		let settled = false;
		let removeCancellation = () => {};
		let totalTimer;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			removeCancellation();
			clearTimeout(totalTimer);
			tlsSocket.setTimeout(0);
			if (error) { tlsSocket.destroy(); reject(error); }
			else resolve(tlsSocket);
		};
		const tlsSocket = tls.connect({
			host: endpoint.host,
			port,
			servername: endpoint.host,
			rejectUnauthorized: true
		}, () => {
			finish();
		});
		removeCancellation = listenForSpeedtestCancellation(signal, finish);
		totalTimer = setTimeout(() => finish(new Error(`Маршрут: истёк общий срок TLS для ${endpoint.name}`)), timeoutMs);
		tlsSocket.setTimeout(timeoutMs, () => {
			finish(/* @__PURE__ */ new Error(`Маршрут: ${endpoint.name} не ответил напрямую`));
		});
		tlsSocket.on("error", finish);
	});
	return new Promise((resolve, reject) => {
		let settled = false;
		let tlsSocket = null;
		let tunnelSocket = null;
		let totalTimer = null;
		let removeCancellation = () => {};
		const finish = (error, socket) => {
			if (settled) return;
			settled = true;
			removeCancellation();
			if (totalTimer) clearTimeout(totalTimer);
			if (error) {
				proxyReq.destroy();
				tlsSocket?.destroy();
				tunnelSocket?.destroy();
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
			timeout: timeoutMs,
			maxHeaderSize: 64 * 1024
		});
		removeCancellation = listenForSpeedtestCancellation(signal, finish);
		totalTimer = setTimeout(() => finish(new Error(`Маршрут: истёк общий срок CONNECT/TLS для ${endpoint.name}`)), timeoutMs);
		proxyReq.on("connect", (response, socket, head) => {
			if (settled) { socket.destroy(); return; }
			tunnelSocket = socket;
			if (response.statusCode !== 200) { finish(new Error(`Маршрут: CONNECT к ${endpoint.name} вернул HTTP ${response.statusCode}`)); return; }
			try {
				if (head?.length) socket.unshift(head);
				tlsSocket = tls.connect({ socket, servername: endpoint.host, rejectUnauthorized: true }, () => {
					tlsSocket.setTimeout(0);
					finish(null, tlsSocket);
				});
				tlsSocket.on("error", () => finish(new Error(`Маршрут: TLS к ${endpoint.name} не согласован`)));
			} catch (error) { finish(error); }
		});
		proxyReq.on("error", (error) => finish(error instanceof Error ? error : /* @__PURE__ */ new Error(`Маршрут: прокси не открыл ${endpoint.name}`)));
		proxyReq.on("timeout", () => {
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
async function measureRouteLatency(endpoint, proxyPort, signal) {
	const startedAt = performance.now();
	const latencyEndpoint = materializeDownloadEndpoint(endpoint, 0);
	const tlsSocket = await openRouteProbeTls(latencyEndpoint, proxyPort, 6e3, signal);
	return await new Promise((resolve, reject) => {
		let settled = false;
		let timer = null;
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			removeCancellation();
			if (!tlsSocket.destroyed) tlsSocket.destroy();
			if (error) reject(error);
			else resolve(Math.max(.1, value ?? performance.now() - startedAt));
		};
		const removeCancellation = listenForSpeedtestCancellation(signal, finish);
		if (signal?.aborted) { finish(new SpeedtestCancelledError()); return; }
		const requestPath = latencyEndpoint.host === "speed.cloudflare.com" ? latencyEndpoint.path : latencyEndpoint.path;
		tlsSocket.write(`GET ${requestPath} HTTP/1.1\r\nHost: ${latencyEndpoint.host}\r\n` + (latencyEndpoint.host === "speed.cloudflare.com" ? "" : "Range: bytes=0-0\r\n") + "Cache-Control: no-cache\r\n" + speedtestUserAgentHeader() + "Connection: close\r\n\r\n");
		tlsSocket.once("data", () => finish(null, performance.now() - startedAt));
		tlsSocket.once("error", (error) => finish(error));
		tlsSocket.once("end", () => finish(/* @__PURE__ */ new Error(`${endpoint.name} закрыл соединение до ответа.`)));
		timer = setTimeout(() => finish(/* @__PURE__ */ new Error(`${endpoint.name} не ответил на latency probe.`)), 7e3);
	});
}
async function measureLatencySeries(endpoint, proxyPort, attempts, pauseMs = 90, signal) {
	const samples = [];
	for (let index = 0; index < attempts; index += 1) {
		if (signal?.aborted) throw new SpeedtestCancelledError();
		try {
			samples.push(await measureRouteLatency(endpoint, proxyPort, signal));
		} catch (error) { if (signal?.aborted) throw error; }
		if (index < attempts - 1 && pauseMs > 0) await delay$2(pauseMs, signal);
	}
	return summarizeLatency(samples, attempts);
}
async function measureDownloadEndpoint(endpoint, proxyPort, redirectDepth = 0, signal, budget = signal ? speedtestBudgets.get(signal) : null) {
	if (!Number.isSafeInteger(endpoint.bytes) || endpoint.bytes <= 0 || endpoint.bytes > 128e6) throw new Error("Недопустимый объём скачивания для замера скорости.");
	const byteLease = budget?.reserve(endpoint.bytes);
	let tlsSocket;
	try { tlsSocket = await openRouteProbeTls(endpoint, proxyPort, 8e3, signal); } catch (error) { byteLease?.release(); throw error; }
	return new Promise((resolve, reject) => {
		const start = performance.now();
		let dataStartedAt = null;
		let totalBytes = 0;
		let headersParsed = false;
		let statusCode = null;
		let responseHeaders = {};
		let buf = Buffer.alloc(0);
		let decoder = null;
		let terminationReason = "body-complete";
		let settled = false;
		let timer = null;
		const finish = async (error = null) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			removeCancellation();
			byteLease?.release();
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
					resolve(await measureDownloadEndpoint(redirectedEndpoint, proxyPort, redirectDepth + 1, signal, budget));
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
				terminationReason,
				endpoint
			});
		};
		const removeCancellation = listenForSpeedtestCancellation(signal, finish);
		if (signal?.aborted) { finish(new SpeedtestCancelledError()); return; }
		try { tlsSocket.write(`GET ${endpoint.path} HTTP/1.1\r\nHost: ${endpoint.host}\r\nRange: bytes=0-${Math.max(0, endpoint.bytes - 1)}\r\nAccept-Encoding: identity\r\nCache-Control: no-cache\r
Pragma: no-cache\r
` + speedtestUserAgentHeader() + "Connection: close\r\n\r\n"); } catch (error) { finish(error); return; }
		tlsSocket.on("data", (chunk) => {
			if (settled) return;
			try {
				let body = chunk;
				if (!headersParsed) {
					buf = Buffer.concat([buf, chunk]);
					const idx = buf.indexOf("\r\n\r\n");
					if (idx < 0 && buf.length > 64 * 1024 || idx > 64 * 1024) { finish(new Error("Ответ замера содержит слишком большие HTTP-заголовки.")); return; }
					if (idx < 0) return;
					headersParsed = true;
					const parsed = parseHttpHeaders(buf.slice(0, idx).toString("utf8"));
					statusCode = parsed.statusCode;
					responseHeaders = parsed.headers;
					if (isRedirectHttpStatus(statusCode) && responseHeaders.location) { finish(); return; }
					if (!isOkHttpStatus(statusCode)) { finish(); return; }
					decoder = createSpeedtestBodyDecoder(responseHeaders, (bytes) => {
						const accepted = Math.min(bytes, endpoint.bytes - totalBytes);
						byteLease?.consume(accepted);
						if (accepted && dataStartedAt === null) dataStartedAt = performance.now();
						totalBytes += accepted;
					});
					body = buf.subarray(idx + 4); buf = Buffer.alloc(0);
				}
				const complete = decoder.push(body);
				if (totalBytes >= endpoint.bytes) { terminationReason = "byte-budget"; finish(); }
				else if (complete) finish();
			} catch (error) { finish(error); }
		});
		tlsSocket.on("end", () => {
			try { decoder?.end(); finish(); } catch (error) { finish(error); }
		});
		tlsSocket.on("error", (error) => void finish(error));
		timer = setTimeout(() => { terminationReason = "time-budget"; finish(totalBytes > 0 ? null : new Error(`Маршрут: ${endpoint.name} не завершил скачивание`)); }, 25e3);
	});
}
async function measureDownload(proxyPort, bytes = ROUTE_SPEED_DOWNLOAD_BYTES, preferredEndpoint, signal) {
	const errors = [];
	const endpoints = preferredEndpoint ? [preferredEndpoint, ...ROUTE_SPEED_DOWNLOAD_ENDPOINTS.filter((endpoint) => endpoint.host !== preferredEndpoint.host)] : ROUTE_SPEED_DOWNLOAD_ENDPOINTS;
	for (const endpoint of endpoints) try {
		return await measureDownloadEndpoint(materializeDownloadEndpoint(endpoint, bytes), proxyPort, 0, signal);
	} catch (error) {
		if (signal?.aborted || error instanceof SpeedtestBudgetExceededError) throw error;
		errors.push(`${endpoint.name}: ${truncateProbeError(error instanceof Error ? error.message : String(error))}`);
	}
	throw new Error(`Скачивание недоступно: ${errors.slice(0, 3).join("; ")}`);
}
async function measureUploadEndpoint(endpoint, proxyPort, signal, budget = signal ? speedtestBudgets.get(signal) : null) {
	if (signal?.aborted) throw new SpeedtestCancelledError();
	if (!Number.isSafeInteger(endpoint.bytes) || endpoint.bytes <= 0 || endpoint.bytes > 128e6) throw new Error("Недопустимый объём отдачи для замера скорости.");
	const byteLease = budget?.reserve(endpoint.bytes);
	let tlsSocket, payload;
	try { payload = Buffer.alloc(endpoint.bytes, 97); tlsSocket = await openRouteProbeTls(endpoint, proxyPort, 8e3, signal); } catch (error) { byteLease?.release(); throw error; }
	return await new Promise((resolve, reject) => {
		const start = performance.now();
		let settled = false;
		let responseBuffer = "";
		let statusCode = null;
		let timer = null;
		const finish = (error = null) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			removeCancellation();
			byteLease?.release();
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
		const removeCancellation = listenForSpeedtestCancellation(signal, finish);
		if (signal?.aborted) { finish(new SpeedtestCancelledError()); return; }
		try { tlsSocket.write(`POST ${endpoint.path} HTTP/1.1\r\nHost: ${endpoint.host}\r\nContent-Type: application/octet-stream\r
Content-Length: ${payload.length}\r\n` + speedtestUserAgentHeader() + "Connection: close\r\n\r\n");
		byteLease?.consume(payload.length); tlsSocket.write(payload); tlsSocket.end(); } catch (error) { finish(error); return; }
		tlsSocket.on("data", (chunk) => {
			if (statusCode !== null) return;
			responseBuffer += chunk.toString("utf8");
			const idx = responseBuffer.indexOf("\r\n\r\n");
			if (idx < 0 && responseBuffer.length > 64 * 1024 || idx > 64 * 1024) { finish(new Error("Ответ замера содержит слишком большие HTTP-заголовки.")); return; }
			if (idx >= 0) statusCode = parseHttpStatusFromHeader(responseBuffer.slice(0, idx));
		});
		tlsSocket.on("end", () => finish());
		tlsSocket.on("error", (error) => finish(error));
		timer = setTimeout(() => finish(/* @__PURE__ */ new Error(`Отдача: ${endpoint.name} не завершила проверку`)), 12e3);
	});
}
async function measureUpload(proxyPort, bytes = ROUTE_SPEED_UPLOAD_BYTES, preferredEndpoint, signal) {
	const errors = [];
	const endpoints = preferredEndpoint ? [preferredEndpoint, ...ROUTE_SPEED_UPLOAD_ENDPOINTS.filter((endpoint) => endpoint.host !== preferredEndpoint.host)] : ROUTE_SPEED_UPLOAD_ENDPOINTS;
	for (const endpoint of endpoints) try {
		return await measureUploadEndpoint(materializeUploadEndpoint(endpoint, bytes), proxyPort, signal);
	} catch (error) {
		if (signal?.aborted || error instanceof SpeedtestBudgetExceededError) throw error;
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
		const { ip } = await request(async (response) => {
			const text = await readResponseTextWithLimit(response, 64 * 1024);
			const contentType = (response.headers.get("content-type") || "").toLowerCase();
			return { ip: extractRouteProbeIp(contentType.includes("json") ? JSON.parse(text) : text) };
		});
		return ip;
	} catch (error) {
		if (!isFirstSuccessfulCancellation(error)) logger.debug(`[vpn:route-probe] ${label} probe failed:`, error);
		return null;
	}
}
function registerVpnHandlers({ stateStore, runtimeManager, zapretManager, networkCombinatorManager, window, onStartupAutoConnectReady }) {
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
			processGeneration: status.processGeneration,
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
			const ip = await firstSuccessful(ROUTE_PROBE_ENDPOINTS.map((endpoint) => async (signal) => {
					const probedIp = await fetchRouteProbeIp("proxy", (consume) => fetchWithRetry(endpoint, {
						fetchImpl: proxyFetch,
						dispatcher,
						signal,
						timeoutMs,
						retries: 0,
						retryBaseDelayMs: 200
					}, consume));
					if (typeof probedIp !== "string" || probedIp.length === 0) throw new Error(`Route probe ${endpoint} did not return an egress IP.`);
					return probedIp;
				}));
			const current = await runtimeManager.status();
			if (!current.connected || current.processGeneration !== status.processGeneration || current.pid !== status.pid || current.proxyPort !== proxyPort) throw new Error("Соединение изменилось во время внешней пробы.");
			return { reachable: true, ip, processGeneration: status.processGeneration, error: null };
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
	const connectVpnUncoordinated = async (requestedNodeId, source = "user", isCurrent) => {
		if (isCurrent && !isCurrent()) return { cancelled: true, connected: false };
		if (requestedNodeId !== void 0 && requestedNodeId !== null && (typeof requestedNodeId !== "string" || !requestedNodeId.trim())) throw new Error("Неверный ID сервера. Выберите сервер заново.");
		const state = stateStore.get();
		const targetNodeId = requestedNodeId || state.activeNodeId || state.nodes[0]?.id;
		let activeNode = state.nodes.find((node) => node.id === targetNodeId) ?? (requestedNodeId ? null : state.nodes[0] ?? null);
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
		if (isCurrent && !isCurrent()) return { cancelled: true, connected: false };
		let result = await runtimeManager.connect(activeNode, state.domainRules, state.processRules, state.settings);
		if (isCurrent && !isCurrent()) return { ...result, cancelled: true };
		if (result.connected && result.activeNodeId === activeNode.id) {
			const egress = await probeProxyEgress();
			if (egress.reachable) {
				result = await runtimeManager.markEgressVerified(egress.ip, egress.processGeneration);
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
					if (isCurrent && !isCurrent()) return { ...result, cancelled: true };
					logger.info(`[vpn:connect] Attempting fallback node: ${fallbackNode.name} (${fallbackNode.id})`);
					try {
						const fbResult = await runtimeManager.connect(fallbackNode, state.domainRules, state.processRules, state.settings);
						if (fbResult.connected && fbResult.activeNodeId === fallbackNode.id) {
							const fbEgress = await probeProxyEgress();
							if (fbEgress.reachable) {
								result = await runtimeManager.markEgressVerified(fbEgress.ip, fbEgress.processGeneration);
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
						result = restoredEgress.reachable ? await runtimeManager.markEgressVerified(restoredEgress.ip, restoredEgress.processGeneration) : await runtimeManager.rejectActiveConnection("server_unreachable", restoredEgress.error ?? "Предыдущее соединение также не прошло проверку внешнего маршрута.");
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
	const connectVpn = (requestedNodeId, source = "user", isCurrent) => {
		const operation = () => isCurrent && !isCurrent() ? { cancelled: true, connected: false } : connectVpnUncoordinated(requestedNodeId, source, isCurrent);
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
	const reconnectEnabled = () => stateStore.getSnapshot?.().storage.writable !== false && stateStore.get().settings.reconnectOnDrop !== false && runtimeManager.backgroundModeActive !== true;
	const reconnectSupervisor = new VpnReconnectSupervisor({
		readEnabled: reconnectEnabled,
		getStatus: () => runtimeManager.status(),
		reconnect: () => {
			// Cancellation and storage availability must survive coordinator admission
			// and asynchronous DPI preparation, before the runtime is started.
			const generation = reconnectSupervisor.generation;
			return connectVpn(void 0, "watchdog", () => reconnectSupervisor.generation === generation && reconnectEnabled());
		},
		log: (level, message) => logger[level](message)
	});
	reconnectSupervisor.start();
	globalThis.reconnectSupervisor = reconnectSupervisor;
	onStartupAutoConnectReady?.(async (nodeId, generation, isStartupCurrent) => {
		const current = () => {
			const state = stateStore.get();
			return stateStore.getSnapshot?.().storage.writable !== false && reconnectSupervisor.generation === generation && state.settings.autoConnect === true && state.activeNodeId === nodeId && isStartupCurrent();
		};
		if (!current()) return { cancelled: true, connected: false };
		const classifyStartup = result => {
			const failureClass = classifyReconnectFailure({ ...result, ...result?.diagnostic, message: result?.lastError || result?.diagnostic?.details });
			return { ...result, startupFailureClass: failureClass, startupRetryable: ["network", "runtime"].includes(failureClass) };
		};
		reconnectSupervisor.attemptInFlight = true;
		try {
			const result = await connectVpn(nodeId, "startup", current);
			if (current() && !result?.cancelled) reconnectSupervisor.recordConnectionResult(result, generation);
			return result?.connected || result?.cancelled ? result : classifyStartup(result);
		} catch (error) {
			const result = { connected: false, lastError: error instanceof Error ? error.message : String(error) };
			if (current()) reconnectSupervisor.recordConnectionResult(result, generation);
			return classifyStartup(result);
		} finally {
			if (reconnectSupervisor.generation === generation) reconnectSupervisor.attemptInFlight = false;
		}
	});
	// Manual stop intent is visible while the request waits for ownership. Polls
	// must not re-arm the old live route before that request finishes.
	const runManualStop = async (reason, operation) => {
		reconnectSupervisor.cancel(reason);
		const generation = reconnectSupervisor.generation;
		reconnectSupervisor.attemptInFlight = true;
		try { return await operation(() => reconnectSupervisor.generation === generation); }
		finally { if (reconnectSupervisor.generation === generation) reconnectSupervisor.cancel(reason); }
	};
	app.once("before-quit", () => reconnectSupervisor.stop());
	app.once("before-quit", () => speedtestAbortController?.abort());
	ipcMain.handle("vpn:connect", async (_event, requestedNodeId) => {
		const generation = reconnectSupervisor.beginManualConnect();
		try {
			const result = await connectVpn(requestedNodeId, "user", () => reconnectSupervisor.generation === generation);
			reconnectSupervisor.recordConnectionResult(result, generation);
			return { ...result, reconnect: reconnectSupervisor.snapshot() };
		} catch (error) {
			reconnectSupervisor.recordConnectionResult({ connected: false, lastError: error instanceof Error ? error.message : String(error) }, generation);
			throw error;
		}
	});
	const disconnectVpn = async () => {
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
	ipcMain.handle("vpn:disconnect", async () => runManualStop("Отключено вручную", async isCurrent => {
		const operation = () => isCurrent() ? disconnectVpn() : { cancelled: true };
		return networkCombinatorManager ? networkCombinatorManager.runCoordinatedMutation({
			module: "vpn",
			action: "disconnect",
			requiredLocks: ["traffic-route", "zapret-suspend"],
			conflictsWith: [
				"packet-interception",
				"windivert"
			]
		}, operation) : operation();
	}));
	const backgroundService = () => {
		if (!runtimeManager.backgroundService) throw new Error("Фоновая служба VPN недоступна в этой установке. Переустановите актуальную версию приложения.");
		return runtimeManager.backgroundService;
	};
	const readKnownBackground = async () => {
		const value = await backgroundService().status({ force: true });
		if (!isObservedBackgroundVpnStatus(value)) throw new Error("Состояние фоновой службы VPN не подтверждено. Изменение остановлено; действующее подключение сохранено.");
		return value;
	};
	const restoreZapretAfterBackground = async () => {
		const status = await readKnownBackground();
		if (status.backgroundEnabled || status.serviceState === "running" || status.running || status.serviceRunning || status.serviceInstalled && status.localHealth !== "unresponsive") return;
		if ((await runtimeManager.status()).temporaryRuntimeActive) return;
		const state = stateStore.get();
		if (!IS_TEST_MOCK_RUNTIME && state.settings.zapretSuspendDuringVpn) await zapretManager.restoreAfterVpnIfNeeded(true, state.settings.zapretProfile);
	};
	const restoreFailedBackgroundTransition = async (previousNode, action) => {
		const failed = await readKnownBackground().catch(() => null);
		if (!failed || failed.backgroundEnabled || failed.serviceRunning || failed.running || failed.serviceInstalled && (failed.serviceState !== "stopped" || failed.startType !== "disabled" || failed.localHealth !== "unresponsive")) return;
		try {
			if (previousNode) await connectVpnUncoordinated(previousNode.id, "restore");
			else await restoreZapretAfterBackground();
		} catch (restoreError) {
			logger.warn(`[vpn:service-${action}] Previous network state could not be restored:`, restoreError);
		}
	};
	const coordinatedBackground = (action, operation) => runManualStop(`Фоновая служба VPN: ${action}`, isCurrent => networkCombinatorManager ? networkCombinatorManager.runCoordinatedMutation({
		module: "vpn", action, requiredLocks: ["traffic-route", "zapret-suspend", "dns-verify"], conflictsWith: ["packet-interception", "windivert"]
	}, () => isCurrent() ? operation() : { cancelled: true }) : isCurrent() ? operation() : { cancelled: true });
	ipcMain.handle("vpn:service-status", async (_event, ...args) => {
		if (args.length) throw new Error("Проверка фоновой службы VPN не принимает параметры.");
		return backgroundService().status({ force: true });
	});
	ipcMain.handle("vpn:service-install", async (_event, nodeId, ...extra) => {
		if (extra.length || typeof nodeId !== "string" || !nodeId.trim() || nodeId.length > 128) throw new Error("Установка фоновой службы требует точный ID выбранного сервера.");
		return coordinatedBackground("service-install", async () => {
			const state = stateStore.get();
			const node = state.nodes.find((value) => value.id === nodeId);
			if (!node) throw new Error("Выбранный сервер отсутствует. Выберите сервер заново перед установкой службы.");
			const snapshot = { node, settings: { ...state.settings, useTunMode: true }, domainRules: state.domainRules, processRules: state.processRules };
			validateBackgroundVpnSnapshot(snapshot);
			await readKnownBackground();
			const previous = await runtimeManager.status();
			const previousNode = previous.temporaryRuntimeActive ? state.nodes.find((value) => value.id === previous.activeNodeId) : null;
			await runtimeManager.shutdownApplicationRuntime();
			try {
				if (!IS_TEST_MOCK_RUNTIME) await zapretManager.prepareForVpn(state.settings.zapretSuspendDuringVpn);
				await backgroundService().installService(snapshot);
				const observed = await readKnownBackground();
				if (!observed.serviceInstalled || observed.serviceState !== "running" || observed.running !== true || observed.backgroundEnabled !== true) throw new Error("Фоновая служба VPN не подтвердила установку и готовность. Проверьте состояние служб.");
				if (observed.activeNodeId !== nodeId) throw new Error("Фоновая служба VPN не подтвердила выбранный сервер. Действующую конфигурацию нужно проверить.");
				updateTrayMenu(true); return observed;
			} catch (error) {
				await restoreFailedBackgroundTransition(previousNode, "install");
				throw error;
			}
		});
	});
	for (const action of ["start", "stop", "remove"]) ipcMain.handle(`vpn:service-${action}`, async (_event, ...args) => {
		if (args.length) throw new Error("Управление фоновой службой VPN не принимает параметры.");
		return coordinatedBackground(`service-${action}`, async () => {
			const before = await readKnownBackground();
			if (action === "start" && !before.serviceInstalled) throw new Error("Фоновая служба VPN не установлена. Установите её для выбранного сервера.");
			let previousNode = null;
			if (action === "start") {
				const state = stateStore.get();
				const previous = await runtimeManager.status();
				previousNode = previous.temporaryRuntimeActive ? state.nodes.find((value) => value.id === previous.activeNodeId) : null;
				await runtimeManager.shutdownApplicationRuntime();
			}
			try {
				if (action === "start" && !IS_TEST_MOCK_RUNTIME) await zapretManager.prepareForVpn(stateStore.get().settings.zapretSuspendDuringVpn);
				await backgroundService()[`${action}Service`]();
				const observed = await readKnownBackground();
				if (action === "start" && (observed.serviceState !== "running" || observed.running !== true || observed.backgroundEnabled !== true)) throw new Error("Запуск фоновой службы VPN не подтверждён.");
				if (action === "stop" && observed.serviceInstalled && (observed.serviceState !== "stopped" || observed.startType !== "disabled" || observed.backgroundEnabled || observed.running || observed.localHealth !== "unresponsive")) throw new Error("Остановка фоновой службы VPN не подтверждена.");
				if (action === "remove" && observed.serviceInstalled) throw new Error("Удаление фоновой службы VPN не подтверждено.");
				if (action !== "start") await restoreZapretAfterBackground();
				updateTrayMenu(observed.running === true); return observed;
			} catch (error) {
				if (action === "start") await restoreFailedBackgroundTransition(previousNode, "start");
				throw error;
			}
		});
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
				if (!status.egressVerified || egress.ip !== status.egressIp) await runtimeManager.markEgressVerified(egress.ip, egress.processGeneration);
				return;
			}
			egressConsecutiveFailures += 1;
			if (egressConsecutiveFailures >= EGRESS_WATCHDOG_FAILURE_THRESHOLD && status.egressVerified) {
				const details = egress.error ?? "Внешний маршрут перестал отвечать: соединение больше не подтверждено.";
				logger.warn("[vpn:egress-watchdog] Dropping egress verification:", details);
				await runtimeManager.markEgressUnverified(details, status.processGeneration);
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
	* второй отказ проверяется раньше; в здоровом состоянии частота остаётся
	* спокойной и не создаёт лишней нагрузки.
	*/
	if (!IS_TEST_MOCK_RUNTIME) {
		let watchdogTimer = null;
		let watchdogStopped = false;
		const scheduleWatchdog = (delayMs) => {
			if (watchdogStopped) return;
			if (watchdogTimer) clearTimeout(watchdogTimer);
			watchdogTimer = setTimeout(async () => {
				await runEgressWatchdog();
				scheduleWatchdog(egressConsecutiveFailures > 0 ? EGRESS_WATCHDOG_DEGRADED_INTERVAL_MS : EGRESS_WATCHDOG_INTERVAL_MS);
			}, delayMs);
			watchdogTimer.unref?.();
		};
		scheduleWatchdog(EGRESS_WATCHDOG_INTERVAL_MS);
		const runImmediately = (reason) => {
			if (watchdogStopped) return;
			logger.info(`[vpn:egress-watchdog] immediate check: ${reason}`);
			scheduleWatchdog(0);
		};
		const onResume = () => runImmediately("system resume"), onUnlock = () => runImmediately("session unlock");
		powerMonitor.on("resume", onResume);
		powerMonitor.on("unlock-screen", onUnlock);
		app.once("before-quit", () => {
			watchdogStopped = true; clearTimeout(watchdogTimer);
			powerMonitor.removeListener("resume", onResume); powerMonitor.removeListener("unlock-screen", onUnlock);
		});
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
			const mode = (status.useTunMode ?? stateStore.get().settings.useTunMode) ? "tun" : "system_proxy";
			const tunInterfaceName = status.executionMode === "background-service" ? "egoist-vpn" : "egoist-tun";
			const { ProxyAgent, fetch: proxyFetch } = await import("undici");
			const dispatcher = new ProxyAgent(`http://127.0.0.1:${proxyPort}`);
			try {
				const [directIp, vpnIp, systemProxy, tunEvidence] = await Promise.all([
					fetchRouteProbeIp("direct", (consume) => fetchWithRetry(ROUTE_PROBE_ENDPOINT, {
						timeoutMs: 5e3,
						retries: 1,
						retryBaseDelayMs: 350
					}, consume)),
					fetchRouteProbeIp("proxy", (consume) => fetchWithRetry(ROUTE_PROBE_ENDPOINT, {
						fetchImpl: proxyFetch,
						dispatcher,
						timeoutMs: 8e3,
						retries: 1,
						retryBaseDelayMs: 350
					}, consume)),
					IS_TEST_MOCK_RUNTIME ? Promise.resolve(null) : readSystemProxyState().catch((error) => {
						logger.debug("[vpn:route-probe] system proxy read failed:", error);
						return null;
					}),
					mode === "tun" && !IS_TEST_MOCK_RUNTIME ? readWindowsTunRouteEvidence(tunInterfaceName).catch((error) => {
						logger.debug("[vpn:route-probe] TUN route read failed:", error);
						return null;
					}) : Promise.resolve(null)
				]);
				const currentStatus = await runtimeManager.status();
				if (!currentStatus.connected || currentStatus.processGeneration !== status.processGeneration || currentStatus.pid !== status.pid || currentStatus.startedAt !== status.startedAt || currentStatus.proxyPort !== proxyPort) return buildInconclusiveProtectionReport("Соединение изменилось во время проверки маршрута. Повторите проверку.", mode);
				return buildRouteProbeResult({
					directIp,
					vpnIp,
					mode,
					tunInterfaceName,
					tunEvidence: tunEvidence ? { ...tunEvidence, runtimeInstanceUnchanged: Number.isInteger(status.processGeneration) || typeof status.processGeneration === "string" && Boolean(status.processGeneration) } : null,
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
		if (status.executionMode === "background-service") return { ok: false, message: "Маршруты фонового TUN управляются службой. Для повторного применения остановите и запустите фоновую службу VPN." };
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
		const cacheAge = performance.now() - (cached?.measuredAt ?? 0);
		if (cached && cacheAge >= 0 && cacheAge < ACTIVE_PROXY_PING_CACHE_TTL_MS) return cached.value;
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
				const latestStatus = await runtimeManager.status();
				if (!latestStatus.connected || latestStatus.processGeneration !== status.processGeneration || latestStatus.proxyPort !== status.proxyPort) return -1;
				activeProxyPingCache.set(cacheKey, {
					value: result,
					measuredAt: performance.now()
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
					measuredAt: performance.now()
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
	const selectMeasurementEndpoint = async (proxyPort, signal) => {
		const measurementGrade = ROUTE_SPEED_DOWNLOAD_ENDPOINTS.filter((endpoint) => endpoint.measurementGrade);
		if (measurementGrade.length === 0) return null;
		if (measurementGrade.length === 1) return measurementGrade[0];
		const reachable = (await Promise.allSettled(measurementGrade.map(async (endpoint) => ({
			endpoint,
			latencyMs: await measureRouteLatency(endpoint, proxyPort, signal)
		})))).filter((probe) => probe.status === "fulfilled" && Number.isFinite(probe.value.latencyMs)).map((probe) => probe.value).sort((a, b) => a.latencyMs - b.latencyMs);
		if (reachable.length === 0) return measurementGrade[0];
		logger.debug(`[vpn:speedtest] measurement endpoint: ${reachable[0].endpoint.name} (${Math.round(reachable[0].latencyMs)} ms, measurement-grade)`);
		return reachable[0].endpoint;
	};
	/** Shared payload reservations bound concurrent streams and failed attempts. */
	const measureDownloadParallel = async (proxyPort, endpoint, streams, bytesPerStream, signal) => {
		const started = performance.now();
		const results = await Promise.allSettled(Array.from({ length: streams }, () => measureDownloadEndpoint(materializeDownloadEndpoint(endpoint, bytesPerStream), proxyPort, 0, signal)));
		if (signal?.aborted) throw new SpeedtestCancelledError();
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
	const runSpeedtest = async (signal) => {
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
			emit("preparing", 2, "Быстрый замер: до 64 МиБ полезных данных и 90 с. Определяю активный маршрут.", { maxPayloadBytes: SPEEDTEST_MAX_PAYLOAD_BYTES, maxDurationMs: SPEEDTEST_TOTAL_TIMEOUT_MS });
			const status = await runtimeManager.status();
			const proxyPort = status.connected && status.proxyPort ? status.proxyPort : null;
			const state = stateStore.get();
			const activeNode = state.nodes.find((node) => node.id === state.activeNodeId) ?? null;
			const selectedEndpoint = await selectMeasurementEndpoint(proxyPort, signal);
			throwIfSpeedtestCancelled(signal);
			const warmup = await measureDownload(proxyPort, ROUTE_SPEED_WARMUP_BYTES, selectedEndpoint ?? void 0, signal);
			completed += 1;
			throwIfSpeedtestCancelled(signal);
			warmup.timeMs;
			const uploadBytes = warmup.downloadMbps >= 80 ? ROUTE_SPEED_FAST_UPLOAD_BYTES : ROUTE_SPEED_UPLOAD_BYTES;
			// A quick sample caps two streams at 8 MB each; it does not claim sustained line capacity.
			const warmupMbps = Math.max(1, warmup.downloadMbps);
			const downloadStreams = warmupMbps >= 30 ? 2 : 1;
			const targetPerStreamBytes = Math.round(Math.max(warmupMbps, 200) * 1e6 / 8 / downloadStreams * 4);
			const bytesPerStream = Math.min(8e6, Math.max(2e6, targetPerStreamBytes));
			logger.info(`[vpn:speedtest] warmup ${warmup.downloadMbps} Mbit/s via ${warmup.endpoint.name}; plan ${downloadStreams} stream(s) x ${Math.round(bytesPerStream / 1e6)} MB`);
			emit("latency", 8, "Измеряю HTTPS latency, jitter и потери контрольных проб.");
			const measurementStartedAt = performance.now();
			const idleLatencySamples = [];
			for (let index = 0; index < SPEEDTEST_LATENCY_ATTEMPTS; index += 1) {
				throwIfSpeedtestCancelled(signal);
				try {
					idleLatencySamples.push(await measureRouteLatency(warmup.endpoint, proxyPort, signal));
				} catch (error) { if (signal?.aborted) throw error; }
				completed += 1;
				const partialLatency = summarizeLatency(idleLatencySamples, index + 1);
				emit("latency", 8 + (index + 1) / SPEEDTEST_LATENCY_ATTEMPTS * 20, `Latency probe ${index + 1}/${SPEEDTEST_LATENCY_ATTEMPTS}.`, { latencyMs: partialLatency.latencyMs });
				if (index < SPEEDTEST_LATENCY_ATTEMPTS - 1) await delay$2(90, signal);
			}
			const idleLatency = summarizeLatency(idleLatencySamples, SPEEDTEST_LATENCY_ATTEMPTS);
			const downloadSamples = [];
			let downloadLoadedLatency = null;
			for (let index = 0; index < SPEEDTEST_BANDWIDTH_SAMPLES; index += 1) {
				throwIfSpeedtestCancelled(signal);
				emit(index === 0 ? "download-loaded-latency" : "download", 30 + index / SPEEDTEST_BANDWIDTH_SAMPLES * 28, `Скачивание ${index + 1}/${SPEEDTEST_BANDWIDTH_SAMPLES}: ${downloadStreams} потока по ${Math.round(bytesPerStream / 1e6)} МБ через активный маршрут.`);
				const downloadPromise = measureDownloadParallel(proxyPort, warmup.endpoint, downloadStreams, bytesPerStream, signal);
				const [download, loadedLatency] = index === 0 ? await Promise.all([downloadPromise, measureLatencySeries(warmup.endpoint, proxyPort, 5, 240, signal)]) : [await downloadPromise, null];
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
				throwIfSpeedtestCancelled(signal);
				emit(index === 0 ? "upload-loaded-latency" : "upload", 60 + index / SPEEDTEST_BANDWIDTH_SAMPLES * 30, `Отдача ${index + 1}/${SPEEDTEST_BANDWIDTH_SAMPLES}: ${Math.round(uploadBytes / 1e6)} МБ через активный маршрут.`, { liveDownloadMbps: download.mbps });
				try {
					const uploadPromise = measureUpload(proxyPort, uploadBytes, void 0, signal);
					const [uploadSample, loadedLatency] = index === 0 ? await Promise.all([uploadPromise, measureLatencySeries(warmup.endpoint, proxyPort, 5, 240, signal)]) : [await uploadPromise, null];
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
					if (signal?.aborted) throw error;
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
			const serverTcpLatency = await measureTcpLatency(proxyPort && activeNode ? activeNode.server : warmup.endpoint.host, proxyPort && activeNode ? activeNode.port : warmup.endpoint.port ?? 443, 1800, signal).catch(() => -1);
			throwIfSpeedtestCancelled(signal);
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
				measurementProfile: "quick",
				budget: { maxPayloadBytes: SPEEDTEST_MAX_PAYLOAD_BYTES, maxDurationMs: SPEEDTEST_TOTAL_TIMEOUT_MS, usedPayloadBytes: speedtestBudgets.get(signal)?.usedBytes ?? totalBytes, includesTlsAndHeaders: false },
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
			if (e instanceof SpeedtestBudgetExceededError || signal?.reason instanceof SpeedtestBudgetExceededError) {
				const error = (signal?.reason instanceof SpeedtestBudgetExceededError ? signal.reason : e).message;
				emit("error", 100, error);
				return { speed: 0, error, budgetExceeded: true, budget: { maxPayloadBytes: SPEEDTEST_MAX_PAYLOAD_BYTES, maxDurationMs: SPEEDTEST_TOTAL_TIMEOUT_MS, usedPayloadBytes: speedtestBudgets.get(signal)?.usedBytes ?? 0 } };
			}
			if (e instanceof SpeedtestCancelledError || signal?.aborted) {
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
			speedtestAbortController = new AbortController();
			speedtestBudgets.set(speedtestAbortController.signal, createSpeedtestBudget());
			const totalDeadline = setTimeout(() => speedtestAbortController?.abort(new SpeedtestBudgetExceededError("Истёк общий срок быстрого замера скорости (90 с).")), SPEEDTEST_TOTAL_TIMEOUT_MS);
			speedtestInFlight = runSpeedtest(speedtestAbortController.signal).finally(() => {
				clearTimeout(totalDeadline);
				speedtestAbortController?.abort();
				speedtestInFlight = null;
				speedtestCancelled = false;
				speedtestAbortController = null;
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
		speedtestAbortController?.abort();
		logger.info("[vpn:speedtest] cancellation requested by the user");
		return {
			ok: true,
			cancelled: true
		};
	});
}
//#endregion
