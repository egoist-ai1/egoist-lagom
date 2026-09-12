//#region src/electron/ipc/vpn-reconnect-supervisor.ts
var defaultScheduler = {
	now: () => Date.now(),
	random: () => Math.random(),
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimeout: (handle) => clearTimeout(handle),
	setInterval: (callback, delayMs) => setInterval(callback, delayMs),
	clearInterval: (handle) => clearInterval(handle)
};
function computeReconnectDelayMs(attempt, baseDelayMs, maxDelayMs, randomValue) {
	const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt));
	const boundedRandom = Math.max(0, Math.min(1, randomValue));
	const jitter = Math.round(exponential * .2 * boundedRandom);
	return Math.min(maxDelayMs, exponential + jitter);
}
function isVerifiedConnection(status) {
	return status.connected === true && status.egressVerified === true;
}
function describeDrop(status) {
	if (status.connected !== true) return status.lastError || status.diagnostic?.details || "VPN runtime завершился";
	if (status.egressVerified !== true) return status.lastError || status.diagnostic?.details || "Внешний маршрут не подтверждён";
	return `Состояние VPN: ${status.lifecycle || "неизвестно"}`;
}
/**
* Классифицирует причину срыва по тексту ошибки (MED-08).
*
* Повтор осмыслен только для сетевых причин. Ошибки авторизации и конфигурации
* сами не исчезнут, поэтому бесконечные попытки давали лишь шум и нагрузку.
*/
function classifyReconnectFailure(reason) {
	if (!reason) return "unknown";
	const text = reason.toLowerCase();
	if (/unauthor|unauthentic|auth fail|authentication|invalid user|invalid password|forbidden|403|401|bad credential|подписка|срок действия|неверн(ый|ые) (логин|пароль|ключ)/.test(text)) return "auth";
	if (/config|конфиг|parse|invalid (json|uri|url|address|port)|unsupported protocol|missing field|некоррект|не найден.*(файл|runtime)|runtime не найден|failed to parse/.test(text)) return "config";
	if (/timeout|timed out|timedout|etimedout|econn|econnreset|econnrefused|enet|enetunreach|ehostunreach|enotfound|eai_again|dns|network|нет сети|соединение|маршрут|unreachable|refused|reset by peer|tls|handshake|socket/.test(text)) return "network";
	return "unknown";
}
function requiredActionFor(failureClass) {
	switch (failureClass) {
		case "auth": return "Проверьте подписку и учётные данные узла, затем подключитесь заново.";
		case "config": return "Проверьте конфигурацию узла (адрес, порт, протокол) и подключитесь заново.";
		case "network": return "Проверьте подключение к сети или выберите другой узел, затем подключитесь заново.";
		default: return "Подключитесь заново вручную; при повторе откройте диагностику.";
	}
}
/**
* Main-process supervisor for a previously verified VPN session.
*
* Renderer timers are throttled or stopped when the window is hidden, so the
* reconnect policy must live beside the runtime. A manual disconnect advances
* the generation and invalidates both scheduled and in-flight retries.
*/
var VpnReconnectSupervisor = class {
	options;
	scheduler;
	pollIntervalMs;
	baseDelayMs;
	maxDelayMs;
	interval = null;
	retryTimer = null;
	attemptInFlight = false;
	statusCheckInFlight = false;
	generation = 0;
	/** Порог сетевых попыток, после которого цепь размыкается. */
	maxNetworkAttempts;
	state = {
		armed: false,
		phase: "idle",
		attempt: 0,
		nextAttemptAt: null,
		lastAttemptAt: null,
		lastReason: null,
		failureClass: "unknown",
		circuitOpen: false,
		requiredAction: null
	};
	constructor(options) {
		this.options = options;
		this.scheduler = options.scheduler ?? defaultScheduler;
		this.pollIntervalMs = options.pollIntervalMs ?? 2e3;
		this.baseDelayMs = options.baseDelayMs ?? 1500;
		this.maxDelayMs = options.maxDelayMs ?? 3e4;
		this.maxNetworkAttempts = options.maxNetworkAttempts ?? 8;
	}
	/**
	* Размыкает цепь: автоматические попытки прекращаются до действия пользователя.
	*
	* Это не «сдаться», а честно сообщить, что автоматика исчерпала возможности:
	* бесконечный цикл не приближал соединение и лишь создавал шум и нагрузку.
	*/
	openCircuit(failureClass, reason) {
		this.clearRetry();
		this.state = {
			...this.state,
			phase: "circuit-open",
			armed: false,
			nextAttemptAt: null,
			lastReason: reason,
			failureClass,
			circuitOpen: true,
			requiredAction: requiredActionFor(failureClass)
		};
		this.options.log?.("warn", `[vpn:reconnect] Автоматические попытки прекращены (${failureClass}): ${reason}. ${this.state.requiredAction ?? ""}`.trim());
	}
	start() {
		if (this.interval) return;
		this.interval = this.scheduler.setInterval(() => this.checkNow(), this.pollIntervalMs);
		this.interval.unref?.();
		this.checkNow();
	}
	stop() {
		this.generation += 1;
		this.clearRetry();
		if (this.interval) {
			this.scheduler.clearInterval(this.interval);
			this.interval = null;
		}
		this.attemptInFlight = false;
		this.state = {
			...this.state,
			armed: false,
			phase: "idle",
			attempt: 0,
			nextAttemptAt: null
		};
	}
	/**
	* Ручное подключение замыкает цепь обратно.
	*
	* Это единственный корректный способ выхода из `circuit-open`: пользователь
	* либо исправил причину, либо намеренно пробует снова.
	*/
	beginManualConnect() {
		this.generation += 1;
		this.clearRetry();
		this.attemptInFlight = true;
		this.state = {
			...this.state,
			armed: false,
			phase: "reconnecting",
			attempt: 0,
			nextAttemptAt: null,
			circuitOpen: false,
			requiredAction: null
		};
	}
	recordConnectionResult(status) {
		this.attemptInFlight = false;
		if (isVerifiedConnection(status)) {
			this.armHealthyConnection();
			return;
		}
		this.state = {
			...this.state,
			armed: false,
			phase: "idle",
			lastReason: describeDrop(status)
		};
	}
	cancel(reason = "Отключено вручную") {
		this.generation += 1;
		this.clearRetry();
		this.attemptInFlight = false;
		this.state = {
			armed: false,
			phase: "idle",
			attempt: 0,
			nextAttemptAt: null,
			lastAttemptAt: this.state.lastAttemptAt,
			lastReason: reason,
			failureClass: "unknown",
			circuitOpen: false,
			requiredAction: null
		};
		this.options.log?.("info", `[vpn:reconnect] ${reason}; автоматические попытки отменены.`);
	}
	snapshot() {
		return { ...this.state };
	}
	async checkNow() {
		if (this.attemptInFlight || this.statusCheckInFlight || this.state.phase === "reconnecting") return;
		if (!this.options.readEnabled()) {
			this.clearRetry();
			this.state = {
				...this.state,
				phase: this.state.armed ? "suspended" : "idle",
				nextAttemptAt: null
			};
			return;
		}
		this.statusCheckInFlight = true;
		const generation = this.generation;
		try {
			const status = await this.options.getStatus();
			if (generation !== this.generation) return;
			if (isVerifiedConnection(status)) {
				this.armHealthyConnection();
				return;
			}
			if (!this.state.armed || this.retryTimer) return;
			const reason = describeDrop(status);
			const failureClass = classifyReconnectFailure(reason);
			this.state = {
				...this.state,
				lastReason: reason,
				failureClass
			};
			if (failureClass === "auth" || failureClass === "config") {
				this.openCircuit(failureClass, reason);
				return;
			}
			this.scheduleRetry();
		} catch (error) {
			if (generation !== this.generation) return;
			this.options.log?.("debug", `[vpn:reconnect] Не удалось прочитать состояние runtime: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.statusCheckInFlight = false;
		}
	}
	armHealthyConnection() {
		this.clearRetry();
		this.state = {
			...this.state,
			armed: true,
			phase: "watching",
			attempt: 0,
			nextAttemptAt: null,
			lastReason: null,
			failureClass: "unknown",
			circuitOpen: false,
			requiredAction: null
		};
	}
	scheduleRetry() {
		const delayMs = computeReconnectDelayMs(this.state.attempt, this.baseDelayMs, this.maxDelayMs, this.scheduler.random());
		const generation = this.generation;
		this.state = {
			...this.state,
			phase: "waiting",
			nextAttemptAt: new Date(this.scheduler.now() + delayMs).toISOString()
		};
		this.options.log?.("warn", `[vpn:reconnect] ${this.state.lastReason ?? "Соединение потеряно"}; попытка ${this.state.attempt + 1} через ${delayMs} мс.`);
		this.retryTimer = this.scheduler.setTimeout(() => this.runReconnect(generation), delayMs);
		this.retryTimer.unref?.();
	}
	async runReconnect(generation) {
		if (generation !== this.generation) return;
		this.retryTimer = null;
		if (!this.options.readEnabled()) {
			this.state = {
				...this.state,
				phase: "suspended",
				nextAttemptAt: null
			};
			return;
		}
		this.attemptInFlight = true;
		const attempt = this.state.attempt + 1;
		this.state = {
			...this.state,
			phase: "reconnecting",
			attempt,
			nextAttemptAt: null,
			lastAttemptAt: new Date(this.scheduler.now()).toISOString()
		};
		try {
			const result = await this.options.reconnect();
			if (generation !== this.generation) return;
			if (isVerifiedConnection(result)) {
				this.options.log?.("info", `[vpn:reconnect] Соединение восстановлено с попытки ${attempt}.`);
				this.armHealthyConnection();
				return;
			}
			const reason = describeDrop(result);
			this.state = {
				...this.state,
				lastReason: reason,
				failureClass: classifyReconnectFailure(reason)
			};
		} catch (error) {
			if (generation !== this.generation) return;
			const reason = error instanceof Error ? error.message : String(error);
			this.state = {
				...this.state,
				lastReason: reason,
				failureClass: classifyReconnectFailure(reason)
			};
		} finally {
			this.attemptInFlight = false;
		}
		if (generation !== this.generation || !this.state.armed || !this.options.readEnabled()) return;
		if (this.state.failureClass === "auth" || this.state.failureClass === "config") {
			this.openCircuit(this.state.failureClass, this.state.lastReason ?? "Ошибка конфигурации или авторизации");
			return;
		}
		if (this.state.attempt >= this.maxNetworkAttempts) {
			this.openCircuit(this.state.failureClass, `${this.state.lastReason ?? "Соединение не восстановлено"} (исчерпано ${this.state.attempt} попыток)`);
			return;
		}
		this.scheduleRetry();
	}
	clearRetry() {
		if (!this.retryTimer) return;
		this.scheduler.clearTimeout(this.retryTimer);
		this.retryTimer = null;
	}
};
//#endregion
