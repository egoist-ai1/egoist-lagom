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
	const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS, retryOnStatuses = [
		408,
		425,
		429,
		500,
		502,
		503,
		504
	], fetchImpl = fetch, signal, ...requestOptions } = options;
	const startedAt = Date.now();
	let lastError = null;
	const maxAttempts = Math.max(1, retries + 1);
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		const abortFromCaller = () => controller.abort(signal?.reason);
		try {
			if (signal?.aborted) controller.abort(signal.reason);
			else signal?.addEventListener("abort", abortFromCaller, { once: true });
			const response = await fetchImpl(url, {
				...requestOptions,
				signal: controller.signal
			});
			if (!response.ok) {
				const httpError = new SafeHttpError(response.status, response.statusText);
				await response.body?.cancel().catch(() => void 0);
				if (attempt < maxAttempts && retryOnStatuses.includes(response.status)) {
					lastError = httpError;
					await delay$2(getRetryDelayMs(attempt, retryBaseDelayMs, response.headers.get("retry-after")));
					continue;
				}
				throw httpError;
			}
			// Whole-response helpers consume inside the attempt: headers alone must
			// not end their timeout or caller-cancellation budget.
			const consumed = consumeResponse ? await consumeResponse(response) : {};
			return {
				response,
				...consumed,
				attempts: attempt,
				elapsedMs: Date.now() - startedAt
			};
		} catch (error) {
			lastError = error;
			if (signal?.aborted) throw error;
			const details = getNetworkErrorDetails(error);
			if (attempt >= maxAttempts || !details.retryable) throw error;
			await delay$2(getRetryDelayMs(attempt, retryBaseDelayMs));
		} finally {
			signal?.removeEventListener("abort", abortFromCaller);
			clearTimeout(timeout);
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Network request failed."));
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
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			await reader.cancel().catch(() => void 0);
			throw new ResponseTooLargeError(maxBytes);
		}
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks);
}
async function readResponseTextWithLimit(response, maxBytes = DEFAULT_MAX_TEXT_BYTES) {
	if (!response.body) {
		const text = await response.text();
		if (Buffer.byteLength(text, "utf8") > maxBytes) throw new ResponseTooLargeError(maxBytes);
		return text;
	}
	const reader = response.body.getReader();
	const chunks = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			await reader.cancel().catch(() => void 0);
			throw new ResponseTooLargeError(maxBytes);
		}
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks).toString("utf8");
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
function delay$2(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
//#endregion
