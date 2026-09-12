function extractRouteProbeIp(payload) {
	if (!payload) return null;
	if (typeof payload === "string") {
		const match = payload.match(/(?:ip=|\b)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
		return match ? match[1] : null;
	}
	if (typeof payload === "object") {
		const candidate = payload.ip || payload.query || payload.clientIp;
		if (typeof candidate === "string") return candidate.trim() || null;
	}
	return null;
}
var PROXY_MODE_LIMITATION = "Режим системного прокси не управляет программами с собственным сетевым стеком: они могут использовать другой маршрут.";
var IPV6_LIMITATION = "Проверен только IPv4. Отсутствие IPv6 не является утечкой, но и не подтверждено этой проверкой.";
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
*  * одинаковые адреса — `fail`: выход не изменился, защита не работает;
*  * применение в Windows проверяется отдельно от работоспособности рантайма.
*/
function buildRouteProbeResult(snapshot) {
	const { directIp, vpnIp } = snapshot;
	const mode = snapshot.mode ?? "system_proxy";
	const testedAt = (/* @__PURE__ */ new Date()).toISOString();
	const checks = [];
	const limitations = [IPV6_LIMITATION];
	if (mode === "system_proxy") limitations.unshift(PROXY_MODE_LIMITATION);
	if (vpnIp) checks.push({
		id: "vpn-egress",
		title: "Выход через VPN доступен",
		status: "pass",
		observed: vpnIp,
		expected: "внешний адрес получен через управляемый рантайм",
		explanation: "HTTPS-запрос через локальный прокси VPN завершился успешно.",
		recommendedAction: null
	});
	else checks.push({
		id: "vpn-egress",
		title: "Выход через VPN доступен",
		status: "fail",
		observed: null,
		expected: "внешний адрес через управляемый рантайм",
		explanation: "Не удалось получить внешний адрес через VPN: рантайм или узел недоступны.",
		recommendedAction: "Переподключить VPN"
	});
	if (!vpnIp) checks.push({
		id: "egress-changed",
		title: "Внешний адрес изменён",
		status: "skipped",
		observed: null,
		expected: "адрес через VPN отличается от прямого",
		explanation: "Проверка невозможна, пока выход через VPN не подтверждён.",
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
	else if (directIp === vpnIp) checks.push({
		id: "egress-changed",
		title: "Внешний адрес изменён",
		status: "fail",
		observed: `direct и VPN совпадают: ${vpnIp}`,
		expected: "адрес через VPN отличается от прямого",
		explanation: "Точка выхода не изменилась: трафик через VPN покидает сеть с того же адреса, что и прямой. Защиты внешнего маршрута нет.",
		recommendedAction: "Выбрать другой сервер"
	});
	else checks.push({
		id: "egress-changed",
		title: "Внешний адрес изменён",
		status: "pass",
		observed: `${directIp} -> ${vpnIp}`,
		expected: "адрес через VPN отличается от прямого",
		explanation: "Трафик через VPN выходит с другого внешнего адреса — точка выхода изменена.",
		recommendedAction: null
	});
	const systemProxy = snapshot.systemProxy ?? null;
	if (mode !== "system_proxy") checks.push({
		id: "route-applied",
		title: "Маршрут применён в Windows",
		status: "skipped",
		observed: null,
		expected: "TUN/WFP-проверка",
		explanation: "Для полного туннеля применяется отдельная проверка интерфейса и таблицы маршрутов.",
		recommendedAction: null
	});
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
		explanation: "Windows не использует прокси приложения, поэтому обычные программы идут мимо VPN, несмотря на работающий рантайм.",
		recommendedAction: "Применить маршрут заново"
	});
	else if (snapshot.expectedEndpoint && systemProxy.proxyServer !== snapshot.expectedEndpoint) checks.push({
		id: "route-applied",
		title: "Системный прокси применён",
		status: "fail",
		observed: systemProxy.proxyServer,
		expected: snapshot.expectedEndpoint,
		explanation: "Windows направлен на другой прокси, а не на локальный порт активной сессии. Часть трафика идёт мимо VPN.",
		recommendedAction: "Применить маршрут заново"
	});
	else if (!systemProxy.ownedByApp) checks.push({
		id: "route-applied",
		title: "Системный прокси применён",
		status: "warn",
		observed: systemProxy.proxyServer,
		expected: "endpoint активной сессии Egoist Shield",
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
	const verdict = verdictFrom(checks);
	const failedRoute = checks.some((check) => check.status === "fail" && (check.id === "egress-changed" || check.id === "route-applied"));
	return {
		verdict,
		mode,
		checks,
		limitations,
		testedAt,
		directIp: directIp ?? null,
		vpnIp: vpnIp ?? null,
		error: null,
		bypassDetected: failedRoute
	};
}
/** Вердикт для случая, когда проверять нечего: VPN не подключён. */
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
