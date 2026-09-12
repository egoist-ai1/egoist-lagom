//#region src/electron/ipc/system-proxy.ts
/**
* System Proxy — управление системным прокси Windows (WinINet, HKCU).
*
* ЧТО ИСПРАВЛЕНО В 3.2.1 (HIGH-01)
*
* Прежняя реализация привязывала владение к ПЕРВОМУ managed-порту. При
* make-before-break новый рантайм получает другой локальный порт, поэтому на
* финальном disconnect текущий `ProxyServer` не совпадал с сохранённым, код
* считал это сторонним изменением, УДАЛЯЛ rollback и не возвращал исходные
* proxy/PAC пользователя. Настройка оставалась нашей навсегда.
*
* Новая модель:
*   * ресурс имеет `sessionId`, `revision` и СПИСОК managed endpoints сессии;
*   * `original` — снимок до первого включения, он не меняется при reconnect;
*   * применение транзакционно: intent -> apply -> verify -> commit, при любой
*     ошибке уже изменённые значения возвращаются в обратном порядке;
*   * PAC (`AutoConfigURL`) снимается на время управления и восстанавливается:
*     иначе WinINet предпочитал PAC, и приложение не контролировало итоговое
*     разрешение прокси, продолжая показывать «защищено»;
*   * восстановление выполняется только если текущая конфигурация всё ещё наша;
*     чужое изменение никогда не перезаписывается.
*/
var execFileAsync$7 = promisify(execFile);
var REG_PATH = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
var OWNERSHIP_FILE_NAME = "system-proxy-rollback.json";
var REG_TIMEOUT_MS = 6e4;
var SYSTEM_PROXY_NOTIFICATION_TIMEOUT_MS = 2e4;
var SYSTEM_PROXY_NOTIFIER_RELATIVE_PATH = ["core-service", "win-x64", "EgoistShield.Service.exe"];
var PROXY_VALUE_NAMES = [
	"ProxyEnable",
	"ProxyServer",
	"ProxyOverride",
	"AutoConfigURL"
];
var ownershipStatePath = null;
/** Configure the private rollback record before a managed proxy can be enabled. */
function configureSystemProxyOwnershipState(userDataDir) {
	ownershipStatePath = path.join(userDataDir, OWNERSHIP_FILE_NAME);
}
/**
* Уведомляет Windows о смене настроек прокси через WinINet.
*
* Раньше вызов был fire-and-forget: приложение не знало, применилось ли
* изменение, и post-verify не мог опереться на факт уведомления. Теперь вызов
* ожидается с таймаутом, а ошибка попадает в журнал.
*/
function findBundledSystemProxyNotifier() {
	if (typeof process.resourcesPath !== "string" || !process.resourcesPath) return null;
	const notifierPath = path.join(process.resourcesPath, ...SYSTEM_PROXY_NOTIFIER_RELATIVE_PATH);
	return fs.existsSync(notifierPath) ? notifierPath : null;
}
async function notifySystemProxyChangedWithPowerShell() {
	const ps = [
		"$ErrorActionPreference = 'Stop'",
		`$signature = '[DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(System.IntPtr h, int o, System.IntPtr b, int l);'`,
		"Add-Type -MemberDefinition $signature -Name WinInet -Namespace EgoistShield.Native",
		"if (-not [EgoistShield.Native.WinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0)) { throw 'WinINet settings notification failed' }",
		"if (-not [EgoistShield.Native.WinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0)) { throw 'WinINet refresh failed' }"
	].join("; ");
	try {
		await execFileAsync$7(resolveWindowsExecutable("powershell.exe"), [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			ps
		], {
			timeout: 8e3,
			windowsHide: true
		});
		return true;
	} catch (error) {
		logger.warn("[system-proxy] WinINet change notification failed:", error);
		return false;
	}
}
async function notifySystemProxyChanged() {
	if (process.platform !== "win32") return true;
	const notifierPath = findBundledSystemProxyNotifier();
	if (!notifierPath) return notifySystemProxyChangedWithPowerShell();
	try {
		const { stdout } = await execFileAsync$7(notifierPath, ["--notify-system-proxy"], {
			timeout: SYSTEM_PROXY_NOTIFICATION_TIMEOUT_MS,
			windowsHide: true,
			maxBuffer: 128 * 1024,
			encoding: "utf8"
		});
		const result = JSON.parse(String(stdout).trim());
		if (result?.ok !== true) throw new Error(`${result?.code ?? "NOTIFICATION_FAILED"}: ${result?.message ?? "Native system-proxy notifier reported failure."}`);
		return true;
	} catch (error) {
		logger.warn("[system-proxy] Native WinINet change notification failed:", error);
		return false;
	}
}
async function readProxyValues() {
	const { stdout } = await execFileAsync$7(resolveWindowsExecutable("reg.exe"), ["query", REG_PATH], {
		windowsHide: true,
		timeout: REG_TIMEOUT_MS
	});
	const values = Object.fromEntries(PROXY_VALUE_NAMES.map((name) => [name, {
		exists: false,
		value: null
	}]));
	for (const line of String(stdout).split(/\r?\n/)) {
		const match = line.match(/^\s*(\S+)\s+REG_\S+\s*(.*)$/i);
		const name = match ? PROXY_VALUE_NAMES.find((candidate) => candidate.toLowerCase() === match[1].toLowerCase()) : null;
		if (!name) continue;
		values[name] = {
			exists: true,
			value: match[2].trim() || null
		};
	}
	return values;
}
async function writeRegistryValue(name, snapshot, current = null) {
	if (!snapshot.exists) {
		if (current && !current.exists) return;
		await execFileAsync$7(resolveWindowsExecutable("reg.exe"), [
			"delete",
			REG_PATH,
			"/v",
			name,
			"/f"
		], {
			windowsHide: true,
			timeout: REG_TIMEOUT_MS
		});
		return;
	}
	const type = name === "ProxyEnable" ? "REG_DWORD" : "REG_SZ";
	await execFileAsync$7(resolveWindowsExecutable("reg.exe"), [
		"add",
		REG_PATH,
		"/v",
		name,
		"/t",
		type,
		"/d",
		snapshot.value ?? "",
		"/f"
	], {
		windowsHide: true,
		timeout: REG_TIMEOUT_MS
	});
}
/** ProxyEnable может быть десятичным или шестнадцатеричным DWORD. */
function parseProxyEnable(value) {
	if (!value.exists || value.value === null) return null;
	const normalized = value.value.trim().toLowerCase();
	const hexadecimal = /^0x[0-9a-f]+$/i.test(normalized);
	if (!hexadecimal && !/^\d+$/.test(normalized)) return null;
	const numeric = Number.parseInt(normalized, hexadecimal ? 16 : 10);
	return Number.isSafeInteger(numeric) ? numeric : null;
}
function isProxyEnabled(value) {
	const numeric = parseProxyEnable(value);
	return numeric !== null && numeric !== 0;
}
function sameRegistryValue(name, a, b) {
	if (a.exists !== b.exists) return false;
	if (!a.exists) return true;
	if (name === "ProxyEnable") return parseProxyEnable(a) === parseProxyEnable(b);
	return (a.value ?? "") === (b.value ?? "");
}
function proxyValuesMatch(actual, expected) {
	return PROXY_VALUE_NAMES.every((name) => sameRegistryValue(name, actual[name], expected[name]));
}
/**
* Чтение записи владения с поддержкой устаревшей схемы 1.
*
* Схема 1 не знала истории портов, поэтому её единственный `proxyServer`
* становится первым элементом `managedEndpoints`: после обновления приложения
* активная сессия прошлой версии всё равно корректно восстанавливается.
*/
async function readRollback() {
	if (!ownershipStatePath) return null;
	try {
		const parsed = JSON.parse(await fs$1.readFile(ownershipStatePath, "utf8"));
		if (parsed.owner !== "EgoistShield") return null;
		const values = parsed.original ?? parsed.values;
		if (!values) return null;
		const managedEndpoints = Array.isArray(parsed.managedEndpoints) ? parsed.managedEndpoints.map(String).filter(Boolean) : [];
		const legacyEndpoint = typeof parsed.proxyServer === "string" ? parsed.proxyServer : "";
		const endpoints = [...new Set([...managedEndpoints, legacyEndpoint].filter(Boolean))];
		if (endpoints.length === 0) return null;
		return {
			schemaVersion: 2,
			owner: "EgoistShield",
			sessionId: typeof parsed.sessionId === "string" && parsed.sessionId ? parsed.sessionId : randomUUID(),
			revision: Number.isFinite(Number(parsed.revision)) ? Number(parsed.revision) : 1,
			managedEndpoints: endpoints,
			managedEndpoint: typeof parsed.managedEndpoint === "string" && parsed.managedEndpoint ? parsed.managedEndpoint : endpoints[endpoints.length - 1],
			original: values,
			capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : (/* @__PURE__ */ new Date()).toISOString(),
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : (/* @__PURE__ */ new Date()).toISOString(),
			proxyServer: endpoints[endpoints.length - 1],
			values
		};
	} catch {
		return null;
	}
}
/** Атомарная запись: временный файл + rename, иначе сбой оставляет обрывок. */
async function writeRollback(rollback) {
	if (!ownershipStatePath) return;
	await fs$1.mkdir(path.dirname(ownershipStatePath), { recursive: true });
	const tempPath = `${ownershipStatePath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await fs$1.writeFile(tempPath, `${JSON.stringify(rollback, null, 2)}\n`, "utf8");
		await fs$1.rename(tempPath, ownershipStatePath);
	} catch (error) {
		await fs$1.rm(tempPath, { force: true }).catch(() => void 0);
		throw error;
	}
}
async function removeRollback() {
	if (ownershipStatePath) await fs$1.rm(ownershipStatePath, { force: true });
}
/** Текущая конфигурация принадлежит нам, если её endpoint есть в истории сессии. */
function isOwnedConfiguration(rollback, currentProxyServer) {
	if (!rollback || !currentProxyServer) return false;
	return rollback.managedEndpoints.includes(currentProxyServer);
}
/**
* Фактическая конфигурация системного прокси Windows плюс признак владения.
*
* Используется проверкой защиты: зелёный статус нельзя показывать только по
* тому, что локальный порт отвечает. Нужно доказательство, что ОС действительно
* направлена через наш endpoint текущей сессии.
*/
async function readSystemProxyState() {
	const [values, rollback] = await Promise.all([readProxyValues(), readRollback()]);
	const proxyServer = values.ProxyServer.value;
	return {
		enabled: isProxyEnabled(values.ProxyEnable),
		proxyServer,
		proxyOverride: values.ProxyOverride.value,
		autoConfigUrl: values.AutoConfigURL.exists ? values.AutoConfigURL.value : null,
		ownedByApp: isProxyEnabled(values.ProxyEnable) && isOwnedConfiguration(rollback, proxyServer),
		managedEndpoint: rollback?.managedEndpoint ?? null,
		managedEndpoints: rollback?.managedEndpoints ?? [],
		sessionId: rollback?.sessionId ?? null,
		revision: rollback?.revision ?? 0
	};
}
var PROXY_BYPASS = "<local>;127.*;10.*;192.168.*;172.16.*;172.17.*;172.18.*;172.19.*;localhost";
/**
* Включает системный прокси на указанном порту одной транзакцией.
*
* Порядок: снимок -> intent в журнал -> последовательная запись -> чтение
* фактических значений -> commit. При расхождении на этапе проверки уже
* применённые значения возвращаются в обратном порядке, и функция сообщает
* ошибку вместо молчаливого «применено».
*/
async function enableSystemProxy(port) {
	const managedEndpoint = `127.0.0.1:${port}`;
	const base = {
		ok: true,
		managedEndpoint,
		revision: 0,
		adoptedExternalChange: false,
		pacSuspended: false,
		error: null
	};
	if (process.platform !== "win32") return base;
	const [current, existing] = await Promise.all([readProxyValues(), readRollback()]);
	const currentProxyServer = current.ProxyServer.value;
	const reconnectOfOwnedSession = isOwnedConfiguration(existing, currentProxyServer);
	const adoptedExternalChange = Boolean(existing) && !reconnectOfOwnedSession;
	const original = reconnectOfOwnedSession && existing ? existing.original : current;
	const sessionId = reconnectOfOwnedSession && existing ? existing.sessionId : randomUUID();
	const revision = (reconnectOfOwnedSession && existing ? existing.revision : 0) + 1;
	const managedEndpoints = [.../* @__PURE__ */ new Set([...reconnectOfOwnedSession && existing ? existing.managedEndpoints : [], managedEndpoint])];
	if (adoptedExternalChange) logger.warn("[system-proxy] Proxy configuration changed outside the app; adopting it as the new restore point.");
	const desired = {
		ProxyEnable: {
			exists: true,
			value: "1"
		},
		ProxyServer: {
			exists: true,
			value: managedEndpoint
		},
		ProxyOverride: {
			exists: true,
			value: PROXY_BYPASS
		},
		AutoConfigURL: {
			exists: false,
			value: null
		}
	};
	const pacSuspended = original.AutoConfigURL.exists;
	const rollback = {
		schemaVersion: 2,
		owner: "EgoistShield",
		sessionId,
		revision,
		managedEndpoints,
		managedEndpoint,
		original,
		capturedAt: reconnectOfOwnedSession && existing ? existing.capturedAt : (/* @__PURE__ */ new Date()).toISOString(),
		updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		proxyServer: managedEndpoint,
		values: original
	};
	await writeRollback(rollback);
	const applied = [];
	try {
		for (const name of PROXY_VALUE_NAMES) {
			if (sameRegistryValue(name, current[name], desired[name])) continue;
			applied.push(name);
			await writeRegistryValue(name, desired[name]);
		}
		if (!await notifySystemProxyChanged()) throw new Error("Windows не подтвердила уведомление об изменении прокси.");
		const verified = await readProxyValues();
		const mismatches = PROXY_VALUE_NAMES.filter((name) => {
			if (name === "ProxyEnable") return !isProxyEnabled(verified.ProxyEnable);
			return !sameRegistryValue(name, verified[name], desired[name]);
		});
		if (mismatches.length > 0) throw new Error(`Windows не применил значения: ${mismatches.join(", ")}`);
		return {
			...base,
			revision,
			adoptedExternalChange,
			pacSuspended
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error("[system-proxy] Apply failed; rolling back partial changes:", message);
		const restoreFailures = [];
		for (const name of [...applied].reverse()) try {
			await writeRegistryValue(name, current[name]);
		} catch (restoreError) {
			restoreFailures.push(`${name}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
			logger.error(`[system-proxy] Rollback of ${name} failed:`, restoreError);
		}
		if (!await notifySystemProxyChanged()) restoreFailures.push("WinINet restore notification failed.");
		try {
			if (!proxyValuesMatch(await readProxyValues(), current)) restoreFailures.push("Registry values do not match the pre-transaction snapshot.");
		} catch (restoreError) {
			restoreFailures.push(`Verification: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
		}
		if (restoreFailures.length === 0) try {
			if (reconnectOfOwnedSession && existing) await writeRollback(existing);
			else await removeRollback();
		} catch (restoreError) {
			restoreFailures.push(`Journal: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
		}
		else logger.error("[system-proxy] Rollback remains pending:", restoreFailures.join("; "));
		return {
			...base,
			ok: false,
			revision,
			adoptedExternalChange,
			pacSuspended,
			error: restoreFailures.length > 0 ? `${message}; rollback incomplete: ${restoreFailures.join("; ")}` : message
		};
	}
}
/**
* Возвращает исходную конфигурацию пользователя, если она всё ещё наша.
*
* Ключевое отличие от прошлой версии: совпадение проверяется со ВСЕМИ managed
* endpoints сессии, поэтому reconnect с новым локальным портом больше не
* приводит к потере rollback. Чужое изменение не перезаписывается никогда —
* вместо этого возвращается conflict, и вызывающий код может об этом сообщить.
*/
async function disableSystemProxy() {
	const base = {
		ok: true,
		restored: false,
		conflict: false,
		error: null
	};
	if (process.platform !== "win32") return base;
	const rollback = await readRollback();
	if (!rollback) return base;
	const current = await readProxyValues();
	if (!isOwnedConfiguration(rollback, current.ProxyServer.value)) {
		if (proxyValuesMatch(current, rollback.original)) {
			if (!await notifySystemProxyChanged()) return { ...base, ok: false, error: "WinINet restore notification failed." };
			await removeRollback();
			return {
				...base,
				restored: true
			};
		}
		logger.warn("[system-proxy] Current proxy configuration is not ours; user settings preserved without changes.");
		return {
			...base,
			conflict: true
		};
	}
	const restoreOrder = [
		"ProxyEnable",
		"ProxyOverride",
		"AutoConfigURL",
		"ProxyServer"
	];
	const failures = [];
	for (const name of restoreOrder) {
		if (name === "ProxyServer" && failures.length > 0) break;
		try {
			await writeRegistryValue(name, rollback.original[name], current[name]);
		} catch (error) {
			failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (!await notifySystemProxyChanged()) failures.push("WinINet restore notification failed.");
	try {
		if (!proxyValuesMatch(await readProxyValues(), rollback.original)) failures.push("Registry values do not match the rollback snapshot.");
	} catch (error) {
		failures.push(`Verification: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (failures.length > 0) {
		logger.error("[system-proxy] Restore incomplete:", failures.join("; "));
		return {
			ok: false,
			restored: false,
			conflict: false,
			error: failures.join("; ")
		};
	}
	await removeRollback();
	return {
		...base,
		restored: true
	};
}
/**
* Доводит до конца прерванную транзакцию прокси при старте приложения.
*
* Если процесс упал между применением и disconnect, в системе остаётся наш
* прокси с мёртвым локальным портом — интернет у пользователя не работает,
* пока он не запустит приложение снова. Восстановление выполняется только при
* доказанном владении.
*/
async function recoverSystemProxyTransaction() {
	const base = {
		ok: true,
		restored: false,
		conflict: false,
		error: null
	};
	if (process.platform !== "win32") return base;
	if (!await readRollback()) return base;
	logger.warn("[system-proxy] Found an unfinished proxy transaction from a previous run; restoring.");
	return disableSystemProxy();
}
//#endregion
