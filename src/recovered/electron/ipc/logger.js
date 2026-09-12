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
function redactLogValue(value, depth = 0) {
	if (typeof value === "string") return redactDiagnosticText(value);
	if (value instanceof Error) return redactDiagnosticText(`${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`);
	if (depth >= 4 || value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map((item) => redactLogValue(item, depth + 1));
	const source = value;
	const result = {};
	for (const key of Object.keys(source)) result[key] = redactLogValue(source[key], depth + 1);
	return result;
}
log.hooks.push((message) => {
	message.data = message.data.map((item) => redactLogValue(item));
	return message;
});
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
log.transports.console.format = "[{h}:{i}:{s}] [{level}] {text}";
log.transports.file.maxSize = 5 * 1024 * 1024;
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
	return `${RUNTIME_EVENT_PREFIX} ${JSON.stringify(entry)}`;
}
var logger = {
	error: (...args) => log.error(...args),
	warn: (...args) => log.warn(...args),
	info: (...args) => log.info(...args),
	debug: (...args) => log.debug(...args)
};
//#endregion
