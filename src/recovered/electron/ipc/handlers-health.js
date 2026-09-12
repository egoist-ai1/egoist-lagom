//#region src/electron/ipc/handlers-health.ts
var execFileAsync$14 = promisify(execFile);
var moduleDir = path.dirname(fileURLToPath(import.meta.url));
var HEALTH_REPORT_CACHE_TTL_MS = 3e4;
var healthReportCache = null;
var healthReportInFlight = null;
function getReleaseChannel() {
	return process.env.EGOISTSHIELD_RELEASE_CHANNEL === "production" ? "production" : "community";
}
function stateRank(state) {
	return state === "error" ? 2 : state === "warn" ? 1 : 0;
}
function summarizeHealth(components) {
	const errors = components.filter((item) => item.state === "error").length;
	const warnings = components.filter((item) => item.state === "warn").length;
	if (errors > 0) return `${errors} критичных компонента требуют внимания.`;
	if (warnings > 0) return `${warnings} компонента требуют проверки.`;
	return "Все проверенные компоненты выглядят штатно.";
}
function formatReleaseChannel(channel) {
	return channel === "production" ? "подписанный производственный канал" : "канал сообщества";
}
function formatRuntimeLifecycle(lifecycle) {
	return {
		idle: "ожидание",
		probing: "проверка",
		connecting: "подключение",
		warmup: "прогрев",
		active: "активно",
		degraded: "ухудшено",
		reconnecting: "переподключение",
		failed: "ошибка"
	}[lifecycle] ?? lifecycle;
}
function formatRuntimeKind(kind) {
	if (kind === "xray") return "Xray";
	if (kind === "sing-box") return "sing-box";
	return "не выбран";
}
function formatComponentName(name) {
	return {
		xray: "Xray",
		"sing-box": "sing-box",
		zapret: "Zapret",
		"tg-ws-proxy": "Прокси Telegram"
	}[name] ?? name;
}
async function fileSha256(filePath) {
	const hash = createHash("sha256");
	hash.update(await promises.readFile(filePath));
	return hash.digest("hex");
}
function getRuntimeManifestCandidates() {
	return [
		path.join(process.resourcesPath, "runtime", "manifest.json"),
		path.join(process.cwd(), "runtime", "manifest.json"),
		path.resolve(moduleDir, "..", "..", "runtime", "manifest.json"),
		path.join(app.getAppPath(), "runtime", "manifest.json")
	];
}
async function readRuntimeManifest() {
	for (const manifestPath of getRuntimeManifestCandidates()) try {
		const raw = await promises.readFile(manifestPath, "utf8");
		const manifest = JSON.parse(raw);
		if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.components)) throw new Error("Некорректная структура манифеста компонентов.");
		return {
			manifest,
			manifestPath,
			runtimeRoot: path.dirname(manifestPath)
		};
	} catch {}
	throw new Error("Манифест компонентов runtime/manifest.json не найден.");
}
async function buildRuntimeManifestComponents() {
	try {
		const { manifest, manifestPath, runtimeRoot } = await readRuntimeManifest();
		const components = [{
			id: "runtime-manifest",
			title: "Манифест компонентов",
			state: manifest.packageVersion === app.getVersion() ? "ok" : "warn",
			details: manifest.packageVersion === app.getVersion() ? `Манифест соответствует версии приложения ${app.getVersion()}.` : `Версия пакета в манифесте: ${manifest.packageVersion ?? "неизвестно"}, версия приложения: ${app.getVersion()}.`,
			path: manifestPath,
			recommendedAction: manifest.packageVersion === app.getVersion() ? null : "Запустите npm run runtime:manifest перед релизом."
		}];
		for (const component of manifest.components) {
			const missingFiles = [];
			let firstChecksum = null;
			for (const file of component.files ?? []) {
				const filePath = path.join(runtimeRoot, file.path);
				try {
					const stat = await promises.stat(filePath);
					if (!stat.isFile() || stat.size !== file.size) {
						missingFiles.push(file.path);
						continue;
					}
					if (await fileSha256(filePath) !== file.sha256) missingFiles.push(file.path);
					firstChecksum ??= file.sha256;
				} catch {
					missingFiles.push(file.path);
				}
			}
			components.push({
				id: `runtime-${component.name}`,
				title: formatComponentName(component.name),
				state: !component.present || missingFiles.length > 0 ? "error" : "ok",
				details: missingFiles.length > 0 ? `${missingFiles.length} файлов компонента отсутствуют или не совпадают с манифестом.` : `${component.fileCount ?? component.files?.length ?? 0} файлов проверены по SHA-256.`,
				version: component.version ?? null,
				checksum: firstChecksum,
				recommendedAction: missingFiles.length > 0 ? "Пересоберите манифест компонентов или восстановите файлы компонентов." : null
			});
		}
		return components;
	} catch (error) {
		return [{
			id: "runtime-manifest",
			title: "Манифест компонентов",
			state: "error",
			details: error instanceof Error ? error.message : String(error),
			recommendedAction: "Запустите npm run runtime:manifest и проверьте файлы компонентов."
		}];
	}
}
async function readRecentRuntimeEvents$1(maxLines = 200) {
	try {
		const logPath = log.transports.file.getFile().path;
		const content = await promises.readFile(logPath, "utf8");
		const events = [];
		for (const line of content.split("\n")) {
			const markerIndex = line.indexOf(RUNTIME_EVENT_PREFIX);
			if (markerIndex < 0) continue;
			try {
				events.push(JSON.parse(line.slice(markerIndex + RUNTIME_EVENT_PREFIX.length).trim()));
			} catch {}
		}
		return events.slice(-maxLines);
	} catch {
		return [];
	}
}
async function buildHealthReport(ctx) {
	const channel = getReleaseChannel();
	const persistedState = ctx.stateStore.get();
	const runtimeComponents = await buildRuntimeManifestComponents();
	const [vpnStatus, systemDohStatus, zapretStatus, telegramStatus] = await Promise.all([
		ctx.runtimeManager.status(),
		ctx.systemDohManager.status(),
		ctx.zapretManager.status(),
		ctx.telegramProxyManager.status()
	]);
	const components = [
		{
			id: "app",
			title: "EgoistShield",
			state: "ok",
			details: `Версия приложения ${app.getVersion()} работает через ${formatReleaseChannel(channel)}.`,
			version: app.getVersion()
		},
		{
			id: "release-channel",
			title: "Канал релиза",
			state: channel === "community" ? "warn" : "ok",
			details: channel === "community" ? "Канал сообщества без Authenticode: установщик проверяется через подписанный манифест и контрольные суммы." : "Производственный канал требует действительную Authenticode-подпись установщика.",
			recommendedAction: channel === "community" ? "Для публичного производственного релиза подключите сертификат подписи кода." : null
		},
		{
			id: "state-store",
			title: "Хранилище состояния",
			state: "ok",
			details: `${persistedState.nodes.length} узлов, ${persistedState.subscriptions.length} подписок, ${persistedState.usageHistory.length} записей истории.`
		},
		{
			id: "vpn-runtime",
			title: "Сетевое ядро",
			state: vpnStatus.lifecycle === "failed" ? "error" : vpnStatus.diagnostic.reason ? "warn" : "ok",
			details: `Состояние: ${formatRuntimeLifecycle(vpnStatus.lifecycle ?? "idle")}, ядро: ${formatRuntimeKind(vpnStatus.runtimeKind)}.`,
			path: vpnStatus.resolvedRuntimePath,
			lastError: vpnStatus.lastError,
			recommendedAction: vpnStatus.diagnostic.reason ? "Откройте журнал подключений и экспортируйте диагностический архив." : null
		},
		{
			id: "system-doh",
			title: "Системный DoH",
			state: systemDohStatus.lastError ? "warn" : "ok",
			details: systemDohStatus.running ? systemDohStatus.nativeManaged === true ? `Windows DNS Client шифрует запросы к ${systemDohStatus.currentUrl}; UDP fallback отключён.` : `Работает на ${systemDohStatus.localAddress}:${systemDohStatus.localPort}.` : "Остановлен или выключен.",
			path: systemDohStatus.runtimePath,
			lastError: systemDohStatus.lastError
		},
		{
			id: "zapret",
			title: "Zapret / Flowseal",
			state: zapretStatus.available ? zapretStatus.lastError ? "warn" : "ok" : "error",
			details: zapretStatus.available ? `Версия ядра: ${zapretStatus.coreVersion ?? "неизвестно"}, служба: ${zapretStatus.serviceRunning ? "работает" : "остановлена"}.` : "Компонент Zapret недоступен.",
			path: zapretStatus.workDir,
			lastError: zapretStatus.lastError
		},
		{
			id: "telegram-proxy",
			title: "Прокси Telegram",
			state: telegramStatus.available ? telegramStatus.lastError ? "warn" : "ok" : "error",
			details: telegramStatus.running ? `Работает на ${telegramStatus.config.host}:${telegramStatus.config.port}.` : "Остановлен или выключен.",
			path: telegramStatus.runtimePath,
			lastError: telegramStatus.lastError
		},
		...runtimeComponents
	];
	const trustStatus = channel === "production" ? "trusted" : "community-unsigned";
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		appVersion: app.getVersion(),
		releaseChannel: channel,
		trustStatus,
		summary: summarizeHealth(components),
		components
	};
}
function getLogFilePath$1() {
	return log.transports.file.getFile().path;
}
async function writeJson(filePath, value) {
	await promises.writeFile(filePath, `${JSON.stringify(redactDiagnosticObject(value), null, 2)}\n`, "utf8");
}
async function exportDiagnosticsBundle(ctx) {
	const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
	const diagnosticsRoot = path.join(app.getPath("userData"), "diagnostics");
	const workDir = path.join(diagnosticsRoot, `egoistshield-diagnostics-${stamp}`);
	const zipPath = `${workDir}.zip`;
	try {
		await promises.mkdir(workDir, { recursive: true });
		const [healthReport, runtimeEvents, vpnStatus, systemDohStatus, zapretStatus, telegramStatus] = await Promise.all([
			buildHealthReport(ctx),
			readRecentRuntimeEvents$1(500),
			ctx.runtimeManager.status(),
			ctx.systemDohManager.status(),
			ctx.zapretManager.status(),
			ctx.telegramProxyManager.status()
		]);
		const state = ctx.stateStore.get();
		await writeJson(path.join(workDir, "health-report.json"), healthReport);
		await writeJson(path.join(workDir, "runtime-events.json"), runtimeEvents);
		await writeJson(path.join(workDir, "statuses.json"), {
			vpn: vpnStatus,
			systemDoh: systemDohStatus,
			zapret: zapretStatus,
			telegramProxy: telegramStatus
		});
		await writeJson(path.join(workDir, "state-summary.json"), {
			nodes: state.nodes.length,
			subscriptions: state.subscriptions.length,
			processRules: state.processRules.length,
			domainRules: state.domainRules.length,
			usageHistory: state.usageHistory.length,
			settings: state.settings
		});
		try {
			const logContent = await promises.readFile(getLogFilePath$1(), "utf8");
			await promises.writeFile(path.join(workDir, "main.log.redacted.txt"), redactDiagnosticText(logContent), "utf8");
		} catch (error) {
			await promises.writeFile(path.join(workDir, "main.log.redacted.txt"), `Файл лога недоступен: ${error instanceof Error ? error.message : String(error)}\n`, "utf8");
		}
		const command = `Compress-Archive -Path '${workDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
		await execFileAsync$14(resolveWindowsExecutable("powershell.exe"), [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			command
		], { windowsHide: true });
		await promises.rm(workDir, {
			recursive: true,
			force: true
		});
		try {
			shell.showItemInFolder(zipPath);
		} catch (error) {
			log.warn("[diagnostics] Failed to reveal diagnostics archive:", error);
			await shell.openPath(diagnosticsRoot).catch((openError) => {
				log.warn("[diagnostics] Failed to open diagnostics folder:", openError);
			});
		}
		return {
			ok: true,
			filePath: zipPath,
			message: "Диагностический архив экспортирован локально, папка открыта."
		};
	} catch (error) {
		return {
			ok: false,
			filePath: null,
			message: error instanceof Error ? error.message : String(error)
		};
	}
}
async function buildPerformanceProfile(ctx, rendererSnapshot) {
	const state = ctx.stateStore.get();
	const runtimeEvents = await readRecentRuntimeEvents$1(2e3);
	const jsHeap = rendererSnapshot?.jsHeapUsedBytes ?? null;
	const recommendations = [];
	if (typeof jsHeap === "number" && jsHeap > 250 * 1024 * 1024) recommendations.push("Память окна повышена: закройте тяжёлые экраны и проверьте 3D-глобус на слабом устройстве.");
	if (state.nodes.length > 500) recommendations.push("Большая библиотека узлов: используйте поиск и облегчённый режим карты для слабых машин.");
	if (runtimeEvents.length > 1500) recommendations.push("Много событий компонентов: экспортируйте диагностический архив и проверьте повторяющиеся ошибки.");
	const metrics = [
		{
			key: "renderer-ready",
			title: "Готовность окна",
			value: rendererSnapshot?.rendererReadyMs ?? null,
			unit: "ms",
			state: (rendererSnapshot?.rendererReadyMs ?? 0) > 2500 ? "warn" : "ok",
			details: rendererSnapshot?.screen ? `Активный экран: ${rendererSnapshot.screen}` : null
		},
		{
			key: "js-heap",
			title: "Память JS",
			value: jsHeap === null ? null : Math.round(jsHeap / 1024 / 1024),
			unit: "MB",
			state: typeof jsHeap === "number" && jsHeap > 250 * 1024 * 1024 ? "warn" : "ok"
		},
		{
			key: "nodes",
			title: "Узлы",
			value: state.nodes.length,
			state: state.nodes.length > 500 ? "warn" : "ok"
		},
		{
			key: "subscriptions",
			title: "Подписки",
			value: state.subscriptions.length,
			state: state.subscriptions.length > 50 ? "warn" : "ok"
		},
		{
			key: "runtime-events",
			title: "События компонентов",
			value: runtimeEvents.length,
			state: runtimeEvents.length > 1500 ? "warn" : "ok"
		}
	];
	const maxState = metrics.reduce((state, metric) => stateRank(metric.state) > stateRank(state) ? metric.state : state, "ok");
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		summary: maxState === "ok" ? "Локальные сигналы производительности в норме." : "Есть локальные сигналы производительности для проверки.",
		metrics,
		recommendations
	};
}
function registerHealthHandlers(ctx) {
	ipcMain.handle("health:get-report", async () => getCachedHealthReport(ctx));
	ipcMain.handle("health:run-performance-profile", async (_event, rendererSnapshot) => buildPerformanceProfile(ctx, rendererSnapshot));
	ipcMain.handle("diagnostics:export-bundle", async () => {
		enableDiagnosticLogging();
		return exportDiagnosticsBundle(ctx);
	});
}
async function getCachedHealthReport(ctx) {
	const now = Date.now();
	if (healthReportCache && healthReportCache.expiresAt > now) return healthReportCache.value;
	if (healthReportInFlight) return healthReportInFlight;
	healthReportInFlight = buildHealthReport(ctx).then((value) => {
		healthReportCache = {
			value,
			expiresAt: Date.now() + HEALTH_REPORT_CACHE_TTL_MS
		};
		return value;
	}).finally(() => {
		healthReportInFlight = null;
	});
	return healthReportInFlight;
}
//#endregion
