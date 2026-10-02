// Owns the whole connection transaction independently of the renderer's lifetime.
export class ShieldConnectionController {
  constructor(deps) {
    this.deps = deps;
    this.state = { phase: 'idle', busy: false, progress: 0, message: '', error: null };
    this.componentStatus = { zapret: null, dns: null, telegram: null };
    this.pending = null;
    this.cancelled = false;
    this.operationGeneration = 0;
    this.statusReadSequence = 0;
    this.lastStatusError = null;
    this.lastConnectOptions = null;
    this.lastActionError = null;
  }

  publish(patch) {
    this.state = { ...this.state, ...patch, updatedAt: Date.now() };
    this.deps.onProgress?.({ ...this.state });
  }

  async status() {
    const generation = this.operationGeneration;
    const sequence = ++this.statusReadSequence;
    const [zapretResult, dnsResult, telegramResult] = await Promise.allSettled([
      Promise.resolve().then(() => this.deps.zapret?.status()),
      Promise.resolve().then(() => this.deps.dns?.status()),
      Promise.resolve().then(() => this.deps.telegramProxy?.status?.())
    ]);
    // A status read may finish after a manual action or a newer read. Such a
    // reply must not resurrect the old service snapshot in the shared cache.
    const current = generation === this.operationGeneration && sequence === this.statusReadSequence;
    if (current) {
      const errors = [];
      const observe = (name, dependency, result) => {
        if (!dependency) return;
        if (result.status === 'rejected') {
          errors.push(`${name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
          return;
        }
        const value = result.value;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          errors.push(`${name}: Служба не вернула состояние`);
          return;
        }
        const unavailable = value.statusError || value.nativeStatusUnavailable === true ||
          ['unknown', 'unavailable'].includes(value.serviceState) || value.healthState === 'unknown' || value.ownerInspectionErrors?.length;
        if (unavailable) {
          errors.push(`${name}: ${value.statusError || value.lastError || 'Состояние службы не подтверждено'}`);
          return;
        }
        const key = name === 'Zapret' ? 'zapret' : name === 'DNS' ? 'dns' : 'telegram';
        this.componentStatus[key] = value;
      };
      observe('Zapret', this.deps.zapret, zapretResult);
      observe('DNS', this.deps.dns, dnsResult);
      observe('Telegram', this.deps.telegramProxy, telegramResult);
      this.lastStatusError = errors.length ? errors.join('; ') : null;
    }

    const zapret = this.componentStatus.zapret;
    const dns = this.componentStatus.dns;
    const telegram = this.componentStatus.telegram;
    const statusError = this.lastStatusError;
    const running = zapret ? zapret.runtimeReady !== false && !!(zapret.serviceRunning || zapret.standaloneRunning) : null;
    const dnsRunning = dns ? dns.running === true && dns.verified === true : null;
    const dnsConfigured = statusError || !dns || typeof dns.enabled !== 'boolean' ? null : dns.enabled;
    const dnsServiceRunning = statusError || !dns || typeof dns.serviceRunning !== 'boolean' ? null : dns.serviceRunning;
    const dnsHealthState = statusError || !dns ? 'unknown' : dnsRunning === true ? 'ready'
      : (dns.healthState && dns.healthState !== 'ready' ? dns.healthState : null) || (dns.running === true || dns.serviceRunning === true || dns.enabled === true ? 'degraded' : dns.running === false ? 'stopped' : 'unknown');
    const dnsError = dnsHealthState === 'degraded' ? dns.lastError || 'Служба DNS запущена, но запросы через выбранный DoH не прошли проверку.' : null;
    const telegramRunning = telegram ? telegram.runtimeReady !== false && telegram.listenerReady !== false && !!(telegram.running || telegram.serviceRunning) : null;
    const targetObserved = this.state.action === 'connect'
      ? this.lastConnectOptions && running === true && (!this.lastConnectOptions.dnsEnabled || dnsRunning === true) && (!this.lastConnectOptions.telegramEnabled || telegramRunning === true)
      : this.state.action === 'disconnect' && running === false && (!this.deps.telegramProxy || telegramRunning === false);
    if (current && this.state.phase === 'error' && !this.state.busy && !statusError && targetObserved) {
      const connected = this.state.action === 'connect';
      this.publish({ phase: connected ? 'connected' : 'idle', error: null, progress: connected ? 100 : 0,
        message: connected ? 'Защита и службы работают в фоне' : 'Подключение отключено' });
    }
    return {
      ...this.state,
      running,
      dnsRunning,
      dnsConfigured,
      dnsServiceRunning,
      dnsHealthState,
      dnsError,
      telegramRunning,
      profile: zapret?.serviceProfile || zapret?.currentProfile || null,
      error: statusError || this.state.error,
      statusError,
      lastActionError: this.lastActionError
    };
  }

  requireSuccess(result, fallback) {
    if (result?.ok === false) throw new Error(result.message || result.error || fallback);
    return result;
  }

  async prepareDnsForAutoSelect(status) {
    // DNS is a persistent foundation, not a disposable strategy-probe component.
    // An addon transaction must never delete an owned resolver or reset adapters.
    this.checkCancelled();
    if (!status || typeof status !== 'object' || Array.isArray(status) || status.statusError ||
        status.nativeStatusUnavailable === true || status.ownerInspectionErrors?.length ||
        ['unknown', 'unavailable', 'query-failed'].includes(status.serviceState) || status.healthState === 'unknown') {
      throw new Error('Не удалось проверить DNS перед автоподбором. Выбранный DNS сохранён.');
    }
    if (status.running === true && status.verified === true) return status;
    if (status.enabled === true || status.currentUrl || status.running === true || status.serviceRunning === true ||
        status.nativeManaged === true && status.enabled !== false || status.healthState === 'degraded') {
      throw new Error(status.lastError || 'Выбранный DNS ещё не готов. Автоподбор не будет останавливать или заменять выбранный DNS.');
    }
    if (status.running !== false || status.serviceRunning !== false ||
        status.serviceState && !['stopped', 'not-installed'].includes(status.serviceState)) {
      throw new Error('Не удалось подтвердить остановленное состояние DNS. Выбранный DNS сохранён.');
    }
    return status;
  }

  checkCancelled() {
    if (this.cancelled) throw new Error('Подключение отменено');
  }

  async stopTelegram() {
    this.requireSuccess(await this.deps.telegramProxy.stopService(), 'Не удалось остановить прокси Telegram.');
    const status = await this.deps.telegramProxy.status({ force: true });
    if (!status || status.running || status.serviceRunning) throw new Error(status?.lastError || 'Прокси Telegram не подтвердил остановку.');
  }

  run(action, operation) {
    if (this.pending) return this.state.action === action ? this.pending : Promise.resolve({ ok: false, message: 'Дождитесь завершения текущего действия.' });
    this.cancelled = false;
    this.operationGeneration += 1;
    this.lastActionError = null;
    this.publish({ action, busy: true, error: null, phase: action === 'disconnect' ? 'disconnecting' : 'preparing', progress: 0, message: action === 'disconnect' ? 'Восстанавливаем настройки сети' : 'Подготавливаем подключение' });
    this.pending = Promise.resolve().then(() => this.deps.coordinate(action, operation)).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      const cleanCancellation = this.cancelled && message === 'Подключение отменено';
      this.lastActionError = cleanCancellation ? null : message;
      this.publish({ phase: cleanCancellation ? 'cancelled' : 'error', error: cleanCancellation ? null : message, message, progress: 0 });
      return { ok: false, cancelled: this.cancelled, message };
    }).finally(() => {
      this.pending = null;
      this.publish({ busy: false });
    });
    return this.pending;
  }

  connect({ dnsEnabled = true, telegramEnabled = true } = {}) {
    if (!this.pending) this.lastConnectOptions = { dnsEnabled, telegramEnabled: telegramEnabled && Boolean(this.deps.telegramProxy) };
    return this.run('connect', async () => {
      this.checkCancelled();
      // VPN handoff is performed once by the main-process coordinator while it
      // owns the route lock. Repeating it here added two status calls and could
      // race with a freshly completed handoff.
      this.checkCancelled();
      let dnsBefore = await this.deps.dns.status({ force: true });
      this.checkCancelled();
      dnsBefore = await this.prepareDnsForAutoSelect(dnsBefore);
      if (dnsEnabled && !(dnsBefore.running === true && dnsBefore.verified === true)) {
        this.publish({ phase: 'dns', progress: 4, message: 'Подключаем постоянный зашифрованный DNS' });
        this.requireSuccess(await this.deps.applyDns(), 'Не удалось подключить DNS.');
        this.checkCancelled();
        dnsBefore = await this.deps.dns.status({ force: true });
        this.checkCancelled();
        if (!dnsBefore || dnsBefore.running !== true || dnsBefore.verified !== true) {
          throw new Error(dnsBefore?.lastError || 'DNS не прошёл проверку. Выбранная конфигурация сохранена.');
        }
      }
      // DNS setup and its intent survive every subsequent addon failure/cancel.
      const before = await this.deps.zapret.status({ force: true });
      this.checkCancelled();
      const telegramBefore = telegramEnabled && this.deps.telegramProxy ? await this.deps.telegramProxy.status({ force: true }) : null;
      this.checkCancelled();
      if (telegramEnabled && this.deps.telegramProxy && !telegramBefore) throw new Error('Не удалось проверить состояние прокси Telegram.');
      let startedZapret = false;
      let startedTg = false;
      try {
        let profile = before.serviceProfile || before.currentProfile;
        if (before.serviceRunning && before.runtimeReady === false) {
          this.publish({ phase: 'service', progress: 74, message: 'Восстанавливаем рабочий процесс Zapret', profile });
          this.requireSuccess(await this.deps.zapret.startService(), 'Не удалось восстановить службу Zapret.');
          const repaired = await this.deps.zapret.status({ force: true });
          if (!repaired?.serviceRunning || repaired.runtimeReady === false) throw new Error(repaired?.lastError || 'Рабочий процесс Zapret не подтвердил запуск.');
        }
        if (!before.serviceRunning) {
          this.checkCancelled();
          this.publish({ phase: 'selecting', progress: 8, message: 'Проверяем стратегии подключения' });
          const result = await this.deps.zapret.autoSelectBestProfile(event => {
            if (!['start', 'profile-start', 'profile-result', 'preparing'].includes(event.phase)) return;
            const index = Number(event.index) || 0;
            const total = Math.max(1, Number(event.total) || 22);
            const progress = Math.min(68, 8 + Math.round(60 * index / total));
            this.publish({ phase: 'selecting', progress: Math.max(this.state.progress, progress), message: event.profile ? `Проверяем ${event.profile.replace(/\.bat$/i, '')}` : 'Проверяем доступность сайтов', tested: index, total });
          });
          this.deps.onSelection?.(result);
          this.checkCancelled();
          if (!result?.completed || result.cancelled || !result.bestProfile) throw new Error(result?.detail || result?.summary || 'Рабочая стратегия не найдена. Проверьте интернет и повторите попытку.');
          profile = result.bestProfile;
          this.publish({ phase: 'service', progress: 74, message: 'Запускаем фоновую службу Zapret', profile });
          startedZapret = true;
          this.requireSuccess(await this.deps.zapret.installService(profile), 'Не удалось установить службу.');
          this.checkCancelled();
          this.requireSuccess(await this.deps.zapret.startService(), 'Не удалось запустить службу.');
          const status = await this.deps.zapret.status({ force: true });
          if (!status.serviceRunning || status.runtimeReady === false) throw new Error(status.lastError || 'Служба Zapret не подтвердила запуск.');
        }
        this.checkCancelled();
        if (telegramEnabled && this.deps.telegramProxy) {
          this.publish({ phase: 'telegram', progress: 92, message: 'Запускаем прокси Telegram' });
          if (!telegramBefore.running && !telegramBefore.serviceRunning) {
            // Installation starts the service and may partially succeed before throwing.
            startedTg = true;
            const installed = this.requireSuccess(await this.deps.telegramProxy.installService(), 'Не удалось установить прокси Telegram.');
            if (!installed?.serviceRunning || installed.runtimeReady === false || installed.listenerReady === false) throw new Error(installed?.lastError || 'Служба прокси Telegram не подтвердила запуск.');
          } else if (telegramBefore.runtimeReady === false || telegramBefore.listenerReady === false) {
            this.requireSuccess(await this.deps.telegramProxy.startService(), 'Не удалось восстановить прокси Telegram.');
          }
          const status = await this.deps.telegramProxy.status({ force: true });
          if ((!status?.running && !status?.serviceRunning) || status?.runtimeReady === false || status?.listenerReady === false) throw new Error(status?.lastError || 'Прокси Telegram не подтвердил запуск.');
          this.checkCancelled();
          // Opening the client is optional; service failures above must abort the transaction.
          await this.deps.telegramProxy.openConnectionLink().catch(() => {});
        }
        this.checkCancelled();
        await this.deps.saveConnected(profile);
        this.checkCancelled();
        this.publish({ phase: 'connected', progress: 100, message: 'Защита и службы работают в фоне', error: null, profile });
        return { ok: true, profile };
      } catch (error) {
        const rollbackErrors = [];
        if (startedTg && this.deps.telegramProxy) {
          try { await this.stopTelegram(); } catch (e) { rollbackErrors.push(e.message); }
        }
        if (startedZapret && rollbackErrors.length === 0) {
          try { this.requireSuccess(await this.deps.zapret.stopService(), 'Не удалось остановить службу.'); }
          catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
        }
        if (rollbackErrors.length) throw new Error(`${error.message}. Восстановление требует внимания: ${rollbackErrors.join('; ')}`);
        throw error;
      }
    });
  }

  disconnect() {
    return this.run('disconnect', async () => {
      this.publish({ phase: 'disconnecting', progress: 40, message: 'Останавливаем дополнения; DNS сохраняется' });
      if (this.deps.telegramProxy) {
        await this.stopTelegram();
      }
      this.publish({ phase: 'disconnecting', progress: 70, message: 'Останавливаем службу Zapret' });
      this.requireSuccess(await this.deps.zapret.stopStandalone(), 'Не удалось остановить процесс.');
      this.requireSuccess(await this.deps.zapret.stopService(), 'Не удалось остановить службу.');
      const status = await this.deps.zapret.status({ force: true });
      if (status.serviceRunning || status.standaloneRunning) throw new Error('Служба ещё работает. Повторите отключение.');
      this.publish({ phase: 'idle', progress: 0, error: null, message: 'Профиль отключён; DNS работает независимо' });
      return { ok: true };
    });
  }

  async cancel() {
    if (!this.pending || this.state.action !== 'connect') return { ok: true };
    this.cancelled = true;
    this.publish({ message: 'Отменяем подключение' });
    await this.deps.zapret.cancelAutoSelect();
    return { ok: true };
  }
}
