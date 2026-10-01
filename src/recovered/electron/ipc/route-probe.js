function extractRouteProbeIp(payload) {
	if (!payload) return null;
	if (typeof payload === "string") {
		const text = payload.trim();
		if (isIP(text)) return text;
		const match = text.match(/(?:^|\r?\n)ip=([^\r\n]+)(?:\r?\n|$)/);
		const value = match?.[1]?.trim();
		return value && isIP(value) ? value : null;
	}
	if (typeof payload === "object") {
		if (payload.success === false) return null;
		const candidate = payload.ip || payload.query || payload.clientIp;
		if (typeof candidate === "string" && isIP(candidate.trim())) return candidate.trim();
	}
	return null;
}
var PROXY_MODE_LIMITATION = "Режим системного прокси не управляет программами с собственным сетевым стеком: они могут использовать другой маршрут.";
var IPV6_LIMITATION = "Проверен только IPv4. Отсутствие IPv6 не является утечкой, но и не подтверждено этой проверкой.";
function canonicalRouteProbeIp(raw) {
	if (typeof raw !== "string") return null;
	const value = raw.trim();
	const parts = value.split(".");
	if (parts.length === 4 && parts.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)) return `4:${parts.join(".")}`;
	if (!value.includes(":")) return null;
	try { return `6:${new URL(`http://[${value}]/`).hostname.toLowerCase()}`; } catch { return null; }
}
function routeProbePrefixIncludes(prefix, destination) {
	if (typeof prefix !== "string" || typeof destination !== "string") return false;
	const [network, length, extra] = prefix.split("/");
	if (extra !== void 0 || !/^(?:[0-9]|[12][0-9]|3[0-2])$/.test(length ?? "")) return false;
	const networkId = canonicalRouteProbeIp(network), destinationId = canonicalRouteProbeIp(destination);
	if (!networkId?.startsWith("4:") || !destinationId?.startsWith("4:")) return false;
	const integer = (value) => value.slice(2).split(".").reduce((result, byte) => result * 256 + Number(byte), 0);
	const blockSize = 2 ** (32 - Number(length));
	return Math.floor(integer(networkId) / blockSize) === Math.floor(integer(destinationId) / blockSize);
}
function buildTunRouteCheck(evidence, expectedInterfaceName = "egoist-tun") {
	const sampleRoutes = evidence?.selectedRoutes;
	const destinations = new Set(["1.1.1.1", "8.8.8.8"]);
	const validSamples = Array.isArray(sampleRoutes) && sampleRoutes.length === 2 && sampleRoutes.every((route) => {
		if (!route || route.interfaceIndex !== evidence.interfaceIndex || !destinations.delete(route.destination)) return false;
		return routeProbePrefixIncludes(route.prefix, route.destination);
	}) && destinations.size === 0;
	const observed = ["egoist-tun", "egoist-vpn"].includes(expectedInterfaceName) && evidence?.interfaceName === expectedInterfaceName && Number.isInteger(evidence?.interfaceIndex) && evidence.interfaceIndex > 0 && evidence.interfaceUp === true && validSamples && evidence.runtimeInstanceUnchanged === true;
	return {
		id: "route-applied", title: "Маршруты TUN прочитаны в Windows", status: observed ? "pass" : "warn",
		observed: observed ? `${evidence.interfaceName} (#${evidence.interfaceIndex}); ${sampleRoutes.map((route) => route.destination).join(", ")}` : null,
		expected: "активный интерфейс текущей сессии и выбор маршрута для контрольных адресов",
		explanation: observed ? "Windows выбирает интерфейс TUN для проверенных адресов. Это не проверка пути всех приложений, IPv6 или исключений маршрутизации." : "Не удалось подтвердить интерфейс и маршруты текущей сессии TUN. Смена внешнего IP сама по себе этого не доказывает.",
		recommendedAction: observed ? null : "Повторить проверку"
	};
}
async function readWindowsTunRouteEvidence(interfaceName = "egoist-tun") {
	if (process.platform !== "win32") return null;
	if (!["egoist-tun", "egoist-vpn"].includes(interfaceName)) throw new Error("Неизвестный управляемый интерфейс TUN.");
	const script = [
		"$ErrorActionPreference = 'Stop'",
		`$adapter = Get-NetAdapter -Name '${interfaceName}' -ErrorAction SilentlyContinue | Select-Object -First 1`,
		"if (-not $adapter) { Write-Output 'null'; exit 0 }",
		"$routes = @('1.1.1.1','8.8.8.8') | ForEach-Object { $destination = $_; $route = Find-NetRoute -RemoteIPAddress $destination -ErrorAction Stop | Where-Object { $_.PSObject.Properties.Name -contains 'DestinationPrefix' } | Select-Object -First 1; if ($route) { [pscustomobject]@{ destination=$destination; interfaceIndex=[int]$route.InterfaceIndex; prefix=[string]$route.DestinationPrefix } } }",
		"[pscustomobject]@{ interfaceName=[string]$adapter.Name; interfaceIndex=[int]$adapter.InterfaceIndex; interfaceGuid=[string]$adapter.InterfaceGuid; interfaceUp=([string]$adapter.Status -eq 'Up'); selectedRoutes=@($routes) } | ConvertTo-Json -Depth 4 -Compress"
	].join("; ");
	const { stdout } = await promisify(execFile)(resolveWindowsExecutable("powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 5e3, maxBuffer: 128 * 1024 });
	return JSON.parse(stdout.trim());
}
function verdictFrom(checks) {
	const relevant = checks.filter((check) => check.status !== "skipped");
	if (relevant.length === 0) return "inconclusive";
	if (relevant.some((check) => check.status === "fail")) return relevant.some((check) => check.status === "pass") ? "partial" : "unprotected";
	if (relevant.some((check) => check.status === "warn")) return "partial";
	return "protected";
}
/**
* Строит отчёт о защите маршрута.
*
* Правила:
*  * нет данных о egress — `inconclusive`, а не «защищено»;
*  * разные direct/VPN адреса — подтверждение смены выхода (`pass`);
*  * общий выход TUN не является доказательством обхода: контрольный запрос тоже может идти в TUN;
*  * применение в Windows проверяется отдельно от работоспособности рантайма.
*/
function buildRouteProbeResult(snapshot) {
	const directIp = canonicalRouteProbeIp(snapshot.directIp) ? snapshot.directIp : null;
	const vpnIp = canonicalRouteProbeIp(snapshot.vpnIp) ? snapshot.vpnIp : null;
	const mode = snapshot.mode ?? "system_proxy";
	const testedAt = (/* @__PURE__ */ new Date()).toISOString();
	const checks = [];
	const families = [directIp, vpnIp].filter(Boolean).map((ip) => canonicalRouteProbeIp(ip)?.slice(0, 1));
	const limitations = [families.includes("6") ? "Проверенные адреса включают IPv6. Это не подтверждает одновременно маршруты IPv4 и IPv6 для всех приложений." : IPV6_LIMITATION];
	if (mode === "system_proxy") limitations.unshift(PROXY_MODE_LIMITATION);
	if (vpnIp) checks.push({
		id: "vpn-egress",
		title: "Внешний маршрут доступен",
		status: "pass",
		observed: vpnIp,
		expected: "внешний адрес получен через управляемый рантайм",
		explanation: "HTTPS-запрос через локальный прокси завершился успешно.",
		recommendedAction: null
	});
	else checks.push({
		id: "vpn-egress",
		title: "Внешний маршрут недоступен",
		status: "fail",
		observed: null,
		expected: "внешний адрес через управляемый рантайм",
		explanation: "Не удалось получить внешний адрес через соединение: runtime или узел недоступны.",
		recommendedAction: "Переподключить соединение"
	});
	if (!vpnIp) checks.push({
		id: "egress-changed",
		title: "Внешний адрес изменён",
		status: "skipped",
		observed: null,
		expected: "адрес внешнего маршрута отличается от прямого",
		explanation: "Проверка невозможна, пока внешний маршрут не подтверждён.",
		recommendedAction: null
	});
	else if (!directIp) checks.push({
		id: "egress-changed",
		title: "Внешний адрес изменён",
		status: "warn",
		observed: null,
		expected: "прямой адрес для сравнения",
		explanation: "Прямой (контрольный) адрес получить не удалось, поэтому смену точки выхода нельзя подтвердить.",
		recommendedAction: "Повторить проверку"
	});
	else if (mode === "tun" && snapshot.physicalPathVerified !== true) checks.push({
		id: "egress-changed", title: "Независимый прямой маршрут", status: "skipped",
		observed: directIp, expected: "контрольный запрос с подтверждённой привязкой к физическому интерфейсу",
		explanation: "Контрольный запрос без привязки может также идти через TUN. Совпадение или различие IP не доказывает обход или полное покрытие туннелем.",
		recommendedAction: null
	});
	else if (canonicalRouteProbeIp(directIp).slice(0, 1) !== canonicalRouteProbeIp(vpnIp).slice(0, 1)) checks.push({
		id: "egress-changed", title: "Внешний адрес изменён", status: "warn",
		observed: `${directIp} -> ${vpnIp}`, expected: "контрольные адреса одного семейства IP",
		explanation: "Сравниваются IPv4 и IPv6. Разные семейства адресов не подтверждают смену точки выхода.",
		recommendedAction: "Повторить проверку"
	});
	else if (canonicalRouteProbeIp(directIp) === canonicalRouteProbeIp(vpnIp)) checks.push({
		id: "egress-changed",
		title: "Внешний адрес изменён",
		status: "fail",
		observed: `direct и внешний маршрут совпадают: ${vpnIp}`,
		expected: "адрес внешнего маршрута отличается от прямого",
		explanation: "Точка выхода не изменилась: трафик покидает сеть с того же адреса, что и прямой. Защита внешнего маршрута не подтверждена.",
		recommendedAction: "Выбрать другой сервер"
	});
	else checks.push({
		id: "egress-changed",
		title: "Внешний адрес изменён",
		status: "pass",
		observed: `${directIp} -> ${vpnIp}`,
		expected: "адрес внешнего маршрута отличается от прямого",
		explanation: "Трафик выходит с другого внешнего адреса — точка выхода изменена.",
		recommendedAction: null
	});
	const systemProxy = snapshot.systemProxy ?? null;
	if (mode !== "system_proxy") {
		checks.push(buildTunRouteCheck(snapshot.tunEvidence, snapshot.tunInterfaceName ?? "egoist-tun"));
		limitations.push("Наблюдение отдельных маршрутов и запрос через прокси не подтверждает защищённость всех приложений. Независимый физический путь и полное покрытие здесь не проверены.");
	}
	else if (!systemProxy) checks.push({
		id: "route-applied",
		title: "Системный прокси применён",
		status: "warn",
		observed: null,
		expected: snapshot.expectedEndpoint ?? "managed endpoint текущей сессии",
		explanation: "Фактическую конфигурацию системного прокси Windows прочитать не удалось.",
		recommendedAction: "Повторить проверку"
	});
	else if (!systemProxy.enabled) checks.push({
		id: "route-applied",
		title: "Системный прокси применён",
		status: "fail",
		observed: "системный прокси Windows выключен",
		expected: snapshot.expectedEndpoint ?? "managed endpoint текущей сессии",
		explanation: "Windows не использует прокси приложения, поэтому обычные программы идут напрямую, несмотря на работающий runtime.",
		recommendedAction: "Применить маршрут заново"
	});
	else if (snapshot.expectedEndpoint && systemProxy.proxyServer !== snapshot.expectedEndpoint) checks.push({
		id: "route-applied",
		title: "Системный прокси применён",
		status: "fail",
		observed: systemProxy.proxyServer,
		expected: snapshot.expectedEndpoint,
		explanation: "Windows направлен на другой прокси, а не на локальный порт активной сессии. Часть трафика идёт напрямую.",
		recommendedAction: "Применить маршрут заново"
	});
	else if (!systemProxy.ownedByApp) checks.push({
		id: "route-applied",
		title: "Системный прокси применён",
		status: "warn",
		observed: systemProxy.proxyServer,
		expected: "endpoint активной сессии Egoist Lagom",
		explanation: "Системный прокси включён, но он не принадлежит текущей сессии приложения. Настройка не изменена намеренно.",
		recommendedAction: null
	});
	else if (systemProxy.autoConfigUrl) checks.push({
		id: "route-applied",
		title: "Системный прокси применён",
		status: "warn",
		observed: `активен PAC: ${systemProxy.autoConfigUrl}`,
		expected: "PAC отключён на время управления",
		explanation: "Сценарий автоконфигурации (PAC) имеет приоритет над адресом прокси, поэтому итоговый маршрут определяется не приложением.",
		recommendedAction: "Применить маршрут заново"
	});
	else checks.push({
		id: "route-applied",
		title: "Системный прокси применён",
		status: "pass",
		observed: systemProxy.proxyServer,
		expected: snapshot.expectedEndpoint ?? systemProxy.managedEndpoint,
		explanation: "Windows направлен на локальный прокси текущей сессии приложения.",
		recommendedAction: null
	});
	const routeCheck = checks.find((check) => check.id === "route-applied");
	const verdict = mode === "tun" && routeCheck?.status !== "fail" ? routeCheck?.status === "pass" && vpnIp ? "partial" : "inconclusive" : verdictFrom(checks);
	const failedRoute = checks.some((check) => check.status === "fail" && (check.id === "egress-changed" || check.id === "route-applied"));
	return {
		verdict,
		mode,
		scope: mode === "tun" ? "sampled-routes" : "system-proxy",
		checks,
		limitations,
		testedAt,
		directIp: directIp ?? null,
		vpnIp: vpnIp ?? null,
		error: null,
		bypassDetected: failedRoute
	};
}
/** Вердикт для случая, когда проверять нечего: соединение не подключено. */
function buildNotApplicableProtectionReport(reason) {
	return {
		verdict: "not_applicable",
		mode: "direct",
		checks: [],
		limitations: [],
		testedAt: (/* @__PURE__ */ new Date()).toISOString(),
		directIp: null,
		vpnIp: null,
		error: reason,
		bypassDetected: false
	};
}
/** Вердикт для случая, когда проверка не смогла завершиться. */
function buildInconclusiveProtectionReport(reason, mode = "system_proxy") {
	return {
		verdict: "inconclusive",
		mode,
		checks: [{
			id: "probe",
			title: "Проверка выполнена",
			status: "fail",
			observed: reason,
			expected: "успешно завершённая серия проб",
			explanation: "Проверка не завершилась, поэтому подтвердить или опровергнуть защиту нельзя.",
			recommendedAction: "Повторить проверку"
		}],
		limitations: [],
		testedAt: (/* @__PURE__ */ new Date()).toISOString(),
		directIp: null,
		vpnIp: null,
		error: reason,
		bypassDetected: false
	};
}
//#endregion
