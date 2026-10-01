//#region src/electron/ipc/dns-leak-test.ts
/**
* Проверка пути DNS-запросов.
*
* ЧТО БЫЛО НЕ ТАК (HIGH-11)
*
* Прежняя реализация считала `bypassDetected = resolverIp !== vpnIp`. Это
* невалидный критерий в принципе: публичный рекурсивный резолвер (Cloudflare,
* Google, резолвер провайдера) и VPN-сервер — РАЗНЫЕ системы, поэтому их адреса
* почти всегда различаются даже при идеально настроенном маршруте. Проверка
* помечала утечкой нормальную работу.
*
* Правильный критерий зависит от выбранного режима DNS:
*   * `app-managed`  — ожидается конкретный собственный резолвер (loopback
*                      для System DoH / Gravityless);
*   * `user-external` — внешний DNS пользователя НЕ является утечкой; проверяется
*                      только его работоспособность и отсутствие неожиданной
*                      подмены;
*   * `tunnel`        — ожидается, что запросы идут через туннель, что можно
*                      подтвердить только tokenized-пробой; без неё результат
*                      честно помечается как неподтверждённый.
*/
var DNS_PROBE_TIMEOUT_MS = 3500;
async function withTimeout$1(promise, timeoutMs, label) {
	let timeout = null;
	const timeoutPromise = new Promise((_, reject) => {
		timeout = setTimeout(() => reject(/* @__PURE__ */ new Error(`${label} timed out`)), timeoutMs);
		timeout.unref?.();
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
function extractDnsLeakIpFromText(value) {
	const tokens = value.split(/[\s"'()[\],]+/).map((token) => token.split("/")[0]?.trim() ?? "").filter(Boolean);
	for (const token of tokens) if (isIP(token)) return token;
	return null;
}
function extractDnsLeakIpFromTxt(records) {
	for (const record of records) {
		const candidate = extractDnsLeakIpFromText(record.join(""));
		if (candidate) return candidate;
	}
	return null;
}
/** Loopback-резолвер означает, что запросы идут через локальный компонент. */
function canonicalDnsProbeResolver(raw) {
	if (typeof raw !== "string") return null;
	const address = raw.trim().replace(/^\[|\]$/g, "");
	if (isIP(address) === 4) return address;
	if (isIP(address) !== 6) return null;
	try { return new URL(`http://[${address}]/`).hostname.toLowerCase(); } catch { return null; }
}
function isLoopback(address) {
	const canonical = canonicalDnsProbeResolver(address);
	return canonical === "[::1]" || canonical?.startsWith("127.") === true;
}
function verdictFrom$1(checks) {
	const relevant = checks.filter((check) => check.status !== "skipped");
	if (relevant.length === 0) return "inconclusive";
	if (relevant.some((check) => check.status === "fail")) return relevant.some((check) => check.status === "pass") ? "partial" : "unprotected";
	if (relevant.some((check) => check.status === "warn")) return "partial";
	return "protected";
}
function buildDnsLeakTestResult(snapshot) {
	const { resolverIp, mode, expectedResolvers, resolutionWorks } = snapshot;
	const checks = [];
	const limitations = [];
	const expected = expectedResolvers.map((value) => value.trim()).filter(Boolean);
	checks.push({
		id: "dns-resolution",
		title: "Разрешение имён",
		status: resolutionWorks ? "pass" : "fail",
		observed: resolutionWorks ? "имена разрешаются" : "имена не разрешаются",
		expected: "успешное разрешение независимых доменов",
		explanation: resolutionWorks ? "Системный резолвер отвечает на запросы." : "Системный резолвер не отвечает: до выяснения пути нужно восстановить разрешение имён.",
		recommendedAction: resolutionWorks ? null : "Восстановить интернет"
	});
	if (!resolverIp) {
		checks.push({
			id: "dns-path",
			title: "Путь DNS-запросов",
			status: "warn",
			observed: null,
			expected: expected.length > 0 ? expected.join(", ") : "наблюдаемый рекурсивный резолвер",
			explanation: "Внешняя проба не определила адрес рекурсивного резолвера, поэтому путь запросов не подтверждён. Это не доказательство утечки.",
			recommendedAction: "Повторить проверку"
		});
		limitations.push("Адрес рекурсивного резолвера не наблюдался: путь DNS не подтверждён ни в одну сторону.");
	} else if (mode === "app-managed") {
		const comparable = expected.filter((value) => !isLoopback(value));
		const usesLocalForwarder = expected.some(isLoopback);
		if (comparable.length > 0) {
			const observedResolver = canonicalDnsProbeResolver(resolverIp);
			const matches = observedResolver !== null && comparable.some((value) => canonicalDnsProbeResolver(value) === observedResolver);
			checks.push({
				id: "dns-path",
				title: "DNS идёт через резолвер приложения",
				status: matches ? "pass" : "warn",
				observed: resolverIp,
				expected: comparable.join(", "),
				explanation: matches ? "Внешний адрес рекурсивного резолвера совпал с ожидаемым. Это наблюдение не доказывает настройки адаптеров, владельца локальной службы или путь всех DNS-запросов." : "Внешний адрес рекурсивного резолвера отличается от ожидаемого. Провайдер DNS может использовать другой адрес для исходящих запросов; это не доказательство утечки.",
				recommendedAction: matches ? null : "Проверить настройки DNS"
			});
		} else if (usesLocalForwarder) {
			checks.push({
				id: "dns-path",
				title: "DNS идёт через локальный резолвер приложения",
				status: "warn",
				observed: resolverIp,
				expected: "адрес upstream локального резолвера",
				explanation: "В настройках выбран локальный резолвер. Внешняя проба показывает адрес рекурсивного upstream-провайдера; она не читает настройки адаптеров и не подтверждает владельца локального DNS.",
				recommendedAction: null
			});
			limitations.push("Локальный резолвер: подтвердить путь по адресу рекурсивного резолвера невозможно, нужна tokenized-проба.");
		} else checks.push({
			id: "dns-path",
			title: "DNS идёт через резолвер приложения",
			status: "warn",
			observed: resolverIp,
			expected: "настроенный резолвер приложения",
			explanation: "Список ожидаемых резолверов пуст, поэтому сравнивать не с чем.",
			recommendedAction: "Открыть настройки DNS"
		});
	} else if (mode === "user-external") {
		const observedResolver = canonicalDnsProbeResolver(resolverIp);
		const unexpectedSubstitution = expected.length > 0 && (observedResolver === null || !expected.some((value) => canonicalDnsProbeResolver(value) === observedResolver));
		checks.push({
			id: "dns-path",
			title: "DNS: внешний резолвер пользователя",
			status: unexpectedSubstitution ? "warn" : "pass",
			observed: resolverIp,
			expected: expected.length > 0 ? expected.join(", ") : "резолвер, настроенный в системе",
			explanation: unexpectedSubstitution ? "Наблюдаемый резолвер отличается от настроенного на адаптерах. Обычно это нормально для провайдерского или корпоративного split-DNS, но может означать и подмену." : "Используется внешний резолвер, настроенный в системе. Приложение его не меняло и не считает утечкой.",
			recommendedAction: null
		});
		limitations.push("Выбран внешний DNS пользователя: приложение не управляет путём DNS-запросов и намеренно его не меняет.");
	} else {
		checks.push({
			id: "dns-path",
			title: "DNS через полный туннель",
			status: "warn",
			observed: resolverIp,
			expected: "резолвер, наблюдаемый со стороны туннеля",
			explanation: "Подтвердить, что DNS идёт внутри туннеля, можно только tokenized-пробой к контролируемому авторитетному серверу. Такая проба в этой сборке недоступна, поэтому результат не подтверждён.",
			recommendedAction: null
		});
		limitations.push("Проверка DNS внутри туннеля требует контролируемого authoritative endpoint.");
	}
	limitations.push("Адрес из внешней DNS-пробы не подтверждает путь всех запросов, текущую конфигурацию адаптеров или принадлежность локального резолвера приложению.");
	const verdict = verdictFrom$1(checks);
	return {
		verdict: mode === "app-managed" && verdict === "protected" ? "partial" : verdict,
		mode: "system_proxy",
		dnsMode: mode,
		scope: "resolver-observation",
		checks,
		limitations,
		testedAt: (/* @__PURE__ */ new Date()).toISOString(),
		directIp: resolverIp ?? null,
		vpnIp: null,
		error: null,
		bypassDetected: checks.some((check) => check.id === "dns-path" && check.status === "fail")
	};
}
async function resolveSystemDnsResolverIp() {
	const probes = [
		async () => extractDnsLeakIpFromTxt(await promises$1.resolveTxt("whoami.cloudflare")),
		async () => (await promises$1.resolve4("whoami.akamai.net"))[0] ?? null,
		async () => extractDnsLeakIpFromTxt(await promises$1.resolveTxt("o-o.myaddr.l.google.com"))
	];
	for (const probe of probes) try {
		const result = await withTimeout$1(probe(), DNS_PROBE_TIMEOUT_MS, "DNS resolver probe");
		if (result) return result;
	} catch {}
	return null;
}
/**
* Проверяет, что имена реально разрешаются.
*
* Используется как предпосылка вердикта: без работающего разрешения имён любые
* выводы о «пути DNS» бессмысленны.
*/
async function probeDnsResolutionWorks() {
	return (await Promise.allSettled([
		"cloudflare.com",
		"example.com",
		"microsoft.com"
	].map((domain) => withTimeout$1(promises$1.lookup(domain, { all: true }), DNS_PROBE_TIMEOUT_MS, `lookup ${domain}`)))).some((result) => result.status === "fulfilled" && Array.isArray(result.value) && result.value.length > 0);
}
//#endregion
