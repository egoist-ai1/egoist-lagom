//#region src/electron/ipc/safe-network.ts
var DEFAULT_TIMEOUT_MS = 15e3;
var DEFAULT_RETRIES = 2;
var DEFAULT_RETRY_BASE_DELAY_MS = 400;
var DEFAULT_MAX_TEXT_BYTES = 5 * 1024 * 1024;
function redactUrlForLog(rawUrl) {
	try {
		const parsed = new URL(rawUrl);
		parsed.username = "";
		parsed.password = "";
		parsed.search = "";
		parsed.hash = "";
		return `${parsed.origin}${parsed.pathname ? "/..." : ""}`;
	} catch {
		return "<invalid-url>";
	}
}
function getNetworkErrorDetails(error) {
	if (error instanceof SafeHttpError) return {
		kind: "http",
		message: `HTTP ${error.status}`,
		status: error.status,
		retryable: isRetryableStatus(error.status)
	};
	if (error instanceof ResponseTooLargeError) return {
		kind: "too-large",
		message: "Response exceeded configured size limit.",
		retryable: false
	};
	if (error instanceof Error) {
		const causeSummary = getErrorCauseSummary(error);
		if (error.name === "AbortError" || error.name === "TimeoutError") return {
			kind: "timeout",
			message: causeSummary ? `Request timed out (${causeSummary}).` : "Request timed out.",
			retryable: true
		};
		if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(error.message)) return {
			kind: "network",
			message: causeSummary ? `Network request failed (${causeSummary}).` : "Network request failed.",
			retryable: true
		};
		return {
			kind: "unknown",
			message: error.message,
			retryable: false
		};
	}
	return {
		kind: "unknown",
		message: String(error),
		retryable: false
	};
}
function getErrorCauseSummary(error) {
	const cause = error.cause;
	if (!cause || typeof cause !== "object") return null;
	const record = cause;
	const code = typeof record.code === "string" && record.code.trim() ? record.code.trim() : null;
	const message = typeof record.message === "string" && record.message.trim() ? record.message.trim().split(/\r?\n/)[0] : null;
	if (code && message) return `${code}: ${message}`;
	return code ?? message;
}
var SafeHttpError = class extends Error {
	status;
	statusText;
	constructor(status, statusText) {
		super(`HTTP ${status} ${statusText}`.trim());
		this.status = status;
		this.statusText = statusText;
		this.name = "SafeHttpError";
	}
};
var ResponseTooLargeError = class extends Error {
	maxBytes;
	constructor(maxBytes) {
		super(`Response exceeded ${maxBytes} bytes.`);
		this.maxBytes = maxBytes;
		this.name = "ResponseTooLargeError";
	}
};
async function fetchWithRetry(url, options = {}, consumeResponse) {
	const { timeoutMs = DEFAULT_TIMEOUT_MS, headerTimeoutMs = timeoutMs, retries = DEFAULT_RETRIES, retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS, retryOnStatuses, fetchImpl = fetch, signal, validateUrl, maxRedirects = 4, ...requestOptions } = options;
	const startedAt = Date.now();
	let lastError = null;
	const maxAttempts = Math.max(1, retries + 1);
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		if (signal?.aborted) throw signal.reason ?? createRequestAbortError();
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(createRequestTimeoutError("Response deadline exceeded.")), timeoutMs);
		const headerTimeout = setTimeout(() => controller.abort(createRequestTimeoutError("Response headers timed out.")), headerTimeoutMs);
		const abortFromCaller = () => controller.abort(signal?.reason);
		let response;
		try {
			if (signal?.aborted) controller.abort(signal.reason);
			else signal?.addEventListener("abort", abortFromCaller, { once: true });
			response = await fetchWithValidatedRedirects(url, {
				...requestOptions,
				signal: controller.signal
			}, fetchImpl, validateUrl, maxRedirects);
			clearTimeout(headerTimeout);
			if (!response.ok) {
				const httpError = new SafeHttpError(response.status, response.statusText);
				await cancelNetworkBody(response.body);
				httpError.retryAfter = response.headers.get("retry-after");
				throw httpError;
			}
			// Whole-response helpers consume inside the attempt: headers alone must
			// not end their timeout or caller-cancellation budget.
			const consumed = consumeResponse ? await consumeResponse(response, { signal: controller.signal }) : {};
			return {
				response,
				...consumed,
				attempts: attempt,
				elapsedMs: Date.now() - startedAt
			};
		} catch (error) {
			lastError = error;
			// Abort the transport even when a reader or local write, rather than fetch,
			// rejected. The caller must not leave the response socket behind.
			controller.abort(error);
			if (response?.body && !response.body.locked) await cancelNetworkBody(response.body);
			if (signal?.aborted) throw error;
			const retryable = error instanceof SafeHttpError ? retryOnStatuses === void 0 ? isRetryableStatus(error.status) : retryOnStatuses.includes(error.status) : getNetworkErrorDetails(error).retryable;
			if (attempt >= maxAttempts || !retryable) throw error;
			await delay$2(getRetryDelayMs(attempt, retryBaseDelayMs, error instanceof SafeHttpError ? error.retryAfter : void 0), signal);
		} finally {
			signal?.removeEventListener("abort", abortFromCaller);
			clearTimeout(timeout);
			clearTimeout(headerTimeout);
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Network request failed."));
}
function createNetworkTimeoutError(message) {
	const error = new Error(message);
	error.name = "TimeoutError";
	return error;
}
function createRequestTimeoutError(message) {
	const error = createNetworkTimeoutError(message);
	// Keep the existing fetch helper's AbortError contract for callers.
	error.name = "AbortError";
	return error;
}
function waitWithNetworkAbort(operation, signal) {
	if (signal?.aborted) return Promise.reject(signal.reason ?? createRequestAbortError());
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason ?? createRequestAbortError());
		signal?.addEventListener("abort", abort, { once: true });
		Promise.resolve(operation).then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort));
	});
}
async function cancelNetworkBody(body) {
	if (!body) return;
	let timer;
	try {
		await Promise.race([Promise.resolve().then(() => body.cancel()).catch(() => void 0), new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
	} finally { clearTimeout(timer); }
}
function assertReleaseHttpsUrl(rawUrl, allowedHosts) {
	let parsed;
	try { parsed = new URL(rawUrl); } catch { throw new Error("Invalid release download URL."); }
	if (typeof rawUrl !== "string" || rawUrl.trim() !== rawUrl || /[\u0000-\u0020\\]/.test(rawUrl) || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port && parsed.port !== "443" || parsed.hash || !allowedHosts.has(parsed.hostname.toLowerCase())) throw new Error("Release download URL is outside the allowed HTTPS channel.");
	return parsed;
}
async function fetchWithValidatedRedirects(url, requestOptions, fetchImpl, validateUrl, maxRedirects) {
	if (!validateUrl) return waitWithNetworkAbort(fetchImpl(url, requestOptions), requestOptions.signal);
	if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) throw new Error("Invalid redirect limit.");
	validateUrl(url, { initial: true });
	let nextUrl = new URL(url).href;
	let headers = requestOptions.headers;
	for (let redirects = 0; ; redirects += 1) {
		validateUrl(nextUrl, { initial: redirects === 0 });
		const response = await waitWithNetworkAbort(fetchImpl(nextUrl, { ...requestOptions, headers, redirect: "manual" }), requestOptions.signal);
		if (![301, 302, 303, 307, 308].includes(response.status)) {
			if (response.redirected || response.url && new URL(response.url).href !== nextUrl) {
				await cancelNetworkBody(response.body);
				throw new Error("Release transport followed an unchecked redirect.");
			}
			return response;
		}
		const location = response.headers.get("location");
		if (response.body) await cancelNetworkBody(response.body);
		if (!location || redirects >= maxRedirects) throw new Error("Release redirect chain exceeded its limit.");
		const redirectUrl = new URL(location, nextUrl);
		if (redirectUrl.origin !== new URL(nextUrl).origin && headers) {
			const entries = Array.isArray(headers) ? headers : typeof headers.entries === "function" ? Array.from(headers.entries()) : Object.entries(headers);
			headers = entries.filter(([name]) => !/^(authorization|proxy-authorization|cookie)$/i.test(name));
		}
		nextUrl = redirectUrl.href;
	}
}
async function fetchJsonWithRetry(url, options = {}) {
	const { json } = await fetchWithRetry(url, options, async (response) => ({ json: await response.json() }));
	return json;
}
async function fetchTextWithRetry(url, options = {}) {
	const { maxBytes = DEFAULT_MAX_TEXT_BYTES, ...fetchOptions } = options;
	return fetchWithRetry(url, fetchOptions, async (response) => ({ text: await readResponseTextWithLimit(response, maxBytes) }));
}
async function fetchBufferWithRetry(url, options = {}) {
	const { maxBytes = DEFAULT_MAX_TEXT_BYTES, ...fetchOptions } = options;
	return fetchWithRetry(url, fetchOptions, async (response) => ({ bytes: await readResponseBufferWithLimit(response, maxBytes) }));
}
async function readResponseBufferWithLimit(response, maxBytes = DEFAULT_MAX_TEXT_BYTES) {
	if (!response.body) {
		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.byteLength > maxBytes) throw new ResponseTooLargeError(maxBytes);
		return bytes;
	}
	const reader = response.body.getReader();
	const chunks = [];
	let totalBytes = 0;
	let complete = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) { complete = true; break; }
			if (!value) continue;
			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) throw new ResponseTooLargeError(maxBytes);
			chunks.push(Buffer.from(value));
		}
	} finally {
		if (!complete) await cancelNetworkBody(reader);
		try { reader.releaseLock(); } catch {}
	}
	return Buffer.concat(chunks);
}
async function readResponseTextWithLimit(response, maxBytes = DEFAULT_MAX_TEXT_BYTES) {
	if (!response.body) {
		const text = await response.text();
		if (Buffer.byteLength(text, "utf8") > maxBytes) throw new ResponseTooLargeError(maxBytes);
		return text;
	}
	return (await readResponseBufferWithLimit(response, maxBytes)).toString("utf8");
}
function isRetryableStatus(status) {
	return status === 408 || status === 425 || status === 429 || status >= 500 && status <= 599;
}
function getRetryDelayMs(attempt, baseDelayMs, retryAfterHeader) {
	const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
	if (typeof retryAfterMs === "number") return Math.min(retryAfterMs, 1e4);
	const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
	const jitter = Math.floor(Math.random() * Math.max(50, baseDelayMs / 2));
	return Math.min(exponential + jitter, 1e4);
}
function parseRetryAfterMs(value) {
	if (!value) return null;
	const seconds = Number.parseInt(value, 10);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1e3);
	const dateMs = Date.parse(value);
	if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
	return null;
}
function createRequestAbortError() {
	const error = new Error("Request cancelled.");
	error.name = "AbortError";
	return error;
}
function delay$2(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? createRequestAbortError());
			return;
		}
		const finish = (error) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			if (error) reject(error);
			else resolve();
		};
		const onAbort = () => finish(signal.reason ?? createRequestAbortError());
		const timer = setTimeout(() => finish(), ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
//#endregion
