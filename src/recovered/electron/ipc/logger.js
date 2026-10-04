//#region src/electron/ipc/logger.ts
/**
* Logger — centralized structured logging via electron-log.
*
* Уровни: error, warn, info, debug.
* Запись в файл (ротация) + DevTools console.
* Путь к логам задаётся main process через configureLoggerPaths().
*/
/**
* Приводит любое значение к безопасному для журнала виду.
* Объекты и массивы обходятся рекурсивно: вложенные Error (например
* `logger.warn(msg, { primaryError, backupError })`) иначе печатались бы
* через util.inspect с полными стеками и абсолютными путями пользователя.
*/
function redactLogValue(value, depth = 0, ancestors = new WeakSet()) {
	if (typeof value === "string") return redactDiagnosticText(value).slice(0, 16384);
	if (value === null || typeof value !== "object") return value;
	if (depth >= 4) return "<depth-limit>";
	if (ancestors.has(value)) return "<circular>";
	ancestors.add(value);
	try {
		if (value instanceof Error) return { name: value.name, message: redactDiagnosticText(value.message).slice(0, 16384),
			code: redactLogValue(value.code, depth + 1, ancestors), stack: redactDiagnosticText(value.stack ?? "").slice(0, 16384),
			cause: redactLogValue(value.cause, depth + 1, ancestors), errors: redactLogValue(value.errors, depth + 1, ancestors) };
		if (Array.isArray(value)) return value.slice(0, 64).map((item) => redactLogValue(item, depth + 1, ancestors));
		const result = {};
		for (const [key, entry] of Object.entries(value).slice(0, 64)) {
			if (isDiagnosticSecretKey(key)) result[key] = "<redacted>";
			else if (isDiagnosticUrlKey(key)) result[key] = redactDiagnosticObject({ [key]: entry })[key];
			else result[key] = redactLogValue(entry, depth + 1, ancestors);
		}
		return result;
	} finally {
		ancestors.delete(value);
	}
}
var diagnosticLoggerSession = "gui-" + (typeof randomUUID === "function" ? randomUUID().replaceAll("-", "") : Date.now().toString(36));
var diagnosticLoggerSequence = 0;
function diagnosticLoggerContext() {
	const now = new Date();
	return { schemaVersion: 1, source: "gui", sessionId: diagnosticLoggerSession, sequence: ++diagnosticLoggerSequence,
		timestampUtc: now.toISOString(), timezoneOffsetMinutes: -now.getTimezoneOffset(),
		pid: typeof process === "object" ? process.pid ?? null : null, parentPid: typeof process === "object" ? process.ppid ?? null : null };
}
// electron-log runs hooks once per transport with the same normalized message.
// Keep one immutable redacted snapshot so console/file share its correlation.
var diagnosticLoggerMessages = new WeakMap();
log.hooks.push((message) => {
	const cached = diagnosticLoggerMessages.get(message);
	if (cached) return cached;
	const data = message.data.map((item) => redactLogValue(item));
	// Prefix leaves the runtime-event JSON at the end of the line parseable.
	const context = "[context] " + JSON.stringify(diagnosticLoggerContext());
	if (typeof data[0] === "string") data[0] = context + " " + data[0];
	else data.push(context);
	const transformed = { ...message, data };
	diagnosticLoggerMessages.set(message, transformed);
	return transformed;
});
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
log.transports.console.format = "[{h}:{i}:{s}] [{level}] {text}";
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.archiveLogFn = (file) => {
	const current = file.toString();
	const parsed = path.parse(current);
	const old = path.join(parsed.dir, parsed.name + ".old" + parsed.ext);
	try {
		for (const target of [current, old, old + ".1", old + ".2"]) if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error("Log rotation refused a symbolic link.");
		if (fs.existsSync(old + ".2")) fs.rmSync(old + ".2");
		if (fs.existsSync(old + ".1")) fs.renameSync(old + ".1", old + ".2");
		if (fs.existsSync(old)) fs.renameSync(old, old + ".1");
		fs.renameSync(current, old);
	} catch (error) {
		file.crop?.(256 * 1024);
		log.transports.console({ data: ["[logger] Log rotation deferred: " + redactDiagnosticText(error.message)], level: "warn", date: new Date() });
	}
};
var DEFAULT_LOG_LEVEL = "info";
/** Диагностическое окно: debug живёт 15 минут, затем сам возвращается к info. */
var DIAGNOSTIC_LOG_WINDOW_MS = 900 * 1e3;
log.transports.file.level = DEFAULT_LOG_LEVEL;
log.transports.console.level = DEFAULT_LOG_LEVEL;
var configuredLogLevel = DEFAULT_LOG_LEVEL;
var diagnosticWindowTimer = null;
var configuredLogsDir = null;
function normalizeLogLevel(value) {
	return value === "debug" || value === "warn" || value === "error" || value === "info" ? value : DEFAULT_LOG_LEVEL;
}
function applyLevel(level) {
	log.transports.file.level = level;
	log.transports.console.level = level;
}
/**
* Включает debug на ограниченное время.
*
* Вызывается при экспорте диагностики: пользователю нужен подробный журнал
* именно в момент разбора проблемы, а не постоянно. По истечении окна уровень
* возвращается к настроенному, даже если приложение не перезапускали.
*/
function enableDiagnosticLogging(durationMs = DIAGNOSTIC_LOG_WINDOW_MS) {
	applyLevel("debug");
	if (diagnosticWindowTimer) clearTimeout(diagnosticWindowTimer);
	diagnosticWindowTimer = setTimeout(() => {
		diagnosticWindowTimer = null;
		applyLevel(configuredLogLevel);
		log.info(`[logger] Diagnostic debug window finished; level restored to ${configuredLogLevel}.`);
	}, durationMs);
	diagnosticWindowTimer.unref?.();
	log.info(`[logger] Diagnostic debug logging enabled for ${Math.round(durationMs / 6e4)} min.`);
	return durationMs;
}
function configureLoggerPaths(logsDir) {
	configuredLogsDir = logsDir;
	log.transports.file.resolvePathFn = () => path.join(logsDir, "main.log");
}
function normalizeKeepLogsDays(value) {
	const days = Number(value);
	return days === 30 || days === 90 ? days : 7;
}
function applyLoggerSettings(settings) {
	configuredLogLevel = normalizeLogLevel(settings.logLevel);
	if (!diagnosticWindowTimer) applyLevel(configuredLogLevel);
	cleanupOldLogFiles(normalizeKeepLogsDays(settings.keepLogsDays));
}
function cleanupOldLogFiles(keepLogsDays) {
	if (!configuredLogsDir || keepLogsDays <= 0) return;
	try {
		if (!fs.existsSync(configuredLogsDir)) return;
		const cutoff = Date.now() - keepLogsDays * 24 * 60 * 60 * 1e3;
		for (const entry of fs.readdirSync(configuredLogsDir, { withFileTypes: true })) {
			if (!entry.isFile() || !/\.log(\.|$)/i.test(entry.name)) continue;
			const filePath = path.join(configuredLogsDir, entry.name);
			if (fs.statSync(filePath).mtimeMs < cutoff) fs.rmSync(filePath, { force: true });
		}
	} catch (error) {
		log.warn("[logs] Failed to cleanup old log files:", error);
	}
}
var RUNTIME_EVENT_PREFIX = "[runtime-event]";
function formatRuntimeLogEvent(entry) {
	return `${RUNTIME_EVENT_PREFIX} ${JSON.stringify(redactDiagnosticObject(entry))}`;
}
var logger = {
	error: (...args) => log.error(...args),
	warn: (...args) => log.warn(...args),
	info: (...args) => log.info(...args),
	debug: (...args) => log.debug(...args),
	event: (stage, fields = {}, level = "info") => log[normalizeLogLevel(level)]("[diagnostic-event]", { ...redactDiagnosticObject(fields), schemaVersion: 1, stage })
};
//#endregion
