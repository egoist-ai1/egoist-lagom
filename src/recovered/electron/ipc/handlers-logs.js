//#region src/electron/ipc/handlers-logs.ts
/**
* IPC Handlers — Logs
*
* Доступ к файлам логов приложения (electron-log).
* - logs:get-recent  → последние N записей из лог-файла
* - logs:get-path    → путь к файлу логов (для «Открыть в проводнике»)
*/
var LOG_LINE_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\] \[(\w+)\] (.*)$/;
function parseLogLevel(rawLevel) {
	const normalizedLevel = rawLevel.toLowerCase();
	switch (normalizedLevel) {
		case "info":
		case "warn":
		case "error":
		case "debug": return normalizedLevel;
		default: return null;
	}
}
function parseLogLine(line) {
	const match = LOG_LINE_RE.exec(line);
	if (!match) return null;
	const timestamp = match.at(1);
	const rawLevel = match.at(2);
	const message = match.at(3);
	if (!timestamp || !rawLevel || message === void 0) return null;
	const level = parseLogLevel(rawLevel);
	if (!level) return null;
	return {
		timestamp,
		level,
		message
	};
}
function getLogFilePath() {
	return log.transports.file.getFile().path;
}
function parseRuntimeEventLine(line) {
	const markerIndex = line.indexOf(RUNTIME_EVENT_PREFIX);
	if (markerIndex < 0) return null;
	const rawPayload = line.slice(markerIndex + RUNTIME_EVENT_PREFIX.length).trim();
	try {
		const parsed = JSON.parse(rawPayload);
		if (!parsed.timestamp || !parsed.level || !parsed.lifecycle) return null;
		return parsed;
	} catch {
		return null;
	}
}
function readRecentLogs(maxLines = 500) {
	try {
		const logPath = getLogFilePath();
		if (!fs.existsSync(logPath)) return [];
		const recent = fs.readFileSync(logPath, "utf-8").split("\n").filter((l) => l.trim().length > 0).slice(-maxLines);
		const entries = [];
		for (const line of recent) {
			const parsed = parseLogLine(line);
			if (parsed) entries.push(parsed);
			else if (entries.length > 0) {
				const lastEntry = entries.at(-1);
				if (lastEntry) lastEntry.message += `\n${line}`;
			}
		}
		return entries;
	} catch (err) {
		log.error("[logs] Ошибка чтения логов:", err);
		return [];
	}
}
function readRecentRuntimeEvents(maxLines = 200) {
	try {
		const logPath = getLogFilePath();
		if (!fs.existsSync(logPath)) return [];
		const lines = fs.readFileSync(logPath, "utf-8").split("\n").filter((line) => line.trim().length > 0);
		const events = [];
		for (const line of lines) {
			const parsed = parseRuntimeEventLine(line);
			if (parsed) events.push(parsed);
		}
		return events.slice(-maxLines);
	} catch (err) {
		log.error("[logs] Ошибка чтения runtime events:", err);
		return [];
	}
}
function registerLogHandlers() {
	ipcMain.handle("logs:get-recent", (_event, maxLines) => {
		return readRecentLogs(maxLines ?? 500);
	});
	ipcMain.handle("logs:get-runtime-summary", (_event, maxLines) => {
		return readRecentRuntimeEvents(maxLines ?? 200);
	});
	ipcMain.handle("logs:get-path", () => {
		return getLogFilePath();
	});
	ipcMain.handle("logs:open-folder", () => {
		const logPath = getLogFilePath();
		const folder = path.dirname(logPath);
		shell.openPath(folder);
		return true;
	});
}
//#endregion
