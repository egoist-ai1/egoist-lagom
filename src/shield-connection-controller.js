// Owns the whole connection transaction independently of the renderer's lifetime.
export class ShieldConnectionController {
  constructor(deps) {
    this.deps = deps;
    this.state = { phase: 'idle', busy: false, progress: 0, message: '', error: null };
    this.componentStatus = { zapret: null, dns: null, telegram: null };
    this.pending = null;
    this.cancelled = false;
  }

  publish(patch) {
    this.state = { ...this.state, ...patch, updatedAt: Date.now() };
    this.deps.onProgress?.({ ...this.state });
  }

  async status() {
    const [zapretResult, dnsResult, telegramResult] = await Promise.allSettled([
      Promise.resolve().then(() => this.deps.zapret?.status()),
      Promise.resolve().then(() => this.deps.dns?.status()),
      Promise.resolve().then(() => this.deps.telegramProxy?.status?.())
    ]);
    const errors = [];
    if (zapretResult.status === 'fulfilled' && zapretResult.value) this.componentStatus.zapret = zapretResult.value;
    else if (zapretResult.status === 'rejected') errors.push(`Zapret: ${zapretResult.reason instanceof Error ? zapretResult.reason.message : String(zapretResult.reason)}`);
    if (dnsResult.status === 'fulfilled' && dnsResult.value) this.componentStatus.dns = dnsResult.value;
    else if (dnsResult.status === 'rejected') errors.push(`DNS: ${dnsResult.reason instanceof Error ? dnsResult.reason.message : String(dnsResult.reason)}`);
    if (telegramResult.status === 'fulfilled' && telegramResult.value) this.componentStatus.telegram = telegramResult.value;
    else if (telegramResult.status === 'rejected') errors.push(`Telegram: ${telegramResult.reason instanceof Error ? telegramResult.reason.message : String(telegramResult.reason)}`);

    const zapret = this.componentStatus.zapret;
    const dns = this.componentStatus.dns;
    const telegram = this.componentStatus.telegram;
    const statusError = errors.length ? errors.join('; ') : null;
    const running = zapret ? !!(zapret.serviceRunning || zapret.standaloneRunning) : null;
    const dnsRunning = dns ? dns.running === true : null;
    const telegramRunning = telegram ? !!(telegram.running || telegram.serviceRunning) : null;
    return {
      ...this.state,
      running,
      dnsRunning,
      telegramRunning,
      profile: zapret?.serviceProfile || zapret?.currentProfile || null,
      error: statusError || this.state.error,
      statusError
    };
  }

  requireSuccess(result, fallback) {
    if (result?.ok === false) throw new Error(result.message || result.error || fallback);
    return result;
  }

  async prepareDnsForAutoSelect(dnsBefore) {
    if (typeof this.deps.dns?.stopAndRemove !== 'function') return dnsBefore;
    // A stopped/failed owned resolver can leave Windows pointing at its
    // loopback address. Restore only the component's own DNS transaction so
    // curl can resolve probe hosts; external static DNS remains untouched.
    if (dnsBefore?.running === true && dnsBefore?.verified === true) return dnsBefore;
    if (dnsBefore?.serviceRunning === true) {
      throw new Error('Служба DNS работает, но проверка не прошла. Автоподбор не будет останавливать единственный локальный DNS.');
    }
    this.publish({ phase: 'dns', progress: 4, message: 'Готовим DNS для проверки профилей' });
    this.requireSuccess(await this.deps.dns.stopAndRemove(), 'Не удалось подготовить DNS для автоподбора.');
    const after = await this.deps.dns.status({ force: true });
    if (!after || typeof after !== 'object') throw new Error('Не удалось проверить DNS перед автоподбором.');
    if (after?.lastError) throw new Error(after.lastError);
    if (after.running === true && after.verified !== true) throw new Error('DNS не прошёл проверку перед автоподбором.');
    return after;
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
    this.publish({ action, busy: true, error: null, phase: action === 'disconnect' ? 'disconnecting' : 'preparing', progress: 0, message: action === 'disconnect' ? 'Восстанавливаем настройки сети' : 'Подготавливаем подключение' });
    this.pending = Promise.resolve().then(() => this.deps.coordinate(action, operation)).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      this.publish({ phase: this.cancelled ? 'cancelled' : 'error', error: this.cancelled ? null : message, message, progress: 0 });
      return { ok: false, cancelled: this.cancelled, message };
    }).finally(() => {
      this.pending = null;
      this.publish({ busy: false });
    });
    return this.pending;
  }

  connect({ dnsEnabled = true, telegramEnabled = true } = {}) {
    return this.run('connect', async () => {
      this.checkCancelled();
      // VPN handoff is performed once by the main-process coordinator while it
      // owns the route lock. Repeating it here added two status calls and could
      // race with a freshly completed handoff.
      this.checkCancelled();
      const before = await this.deps.zapret.status({ force: true });
      let dnsBefore = await this.deps.dns.status({ force: true });
      let dnsPreparedForProbe = false;
      if (dnsEnabled && dnsBefore.running === true && dnsBefore.verified !== true) {
        if (typeof this.deps.dns?.stopAndRemove !== 'function') throw new Error(dnsBefore.lastError || 'DNS не прошёл проверку.');
        dnsBefore = await this.prepareDnsForAutoSelect(dnsBefore);
        dnsPreparedForProbe = true;
      }
      const telegramBefore = telegramEnabled && this.deps.telegramProxy ? await this.deps.telegramProxy.status({ force: true }) : null;
      if (telegramEnabled && this.deps.telegramProxy && !telegramBefore) throw new Error('Не удалось проверить состояние прокси Telegram.');
      let startedZapret = false;
      let startedDns = false;
      let startedTg = false;
      try {
        let profile = before.serviceProfile || before.currentProfile;
        if (!before.serviceRunning) {
          if (!dnsPreparedForProbe) dnsBefore = await this.prepareDnsForAutoSelect(dnsBefore);
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
          if (!status.serviceRunning) throw new Error(status.lastError || 'Служба Zapret не подтвердила запуск.');
        }
        this.checkCancelled();
        if (dnsEnabled && dnsBefore.running !== true) {
          this.publish({ phase: 'dns', progress: 85, message: 'Подключаем зашифрованный DNS' });
          startedDns = true;
          this.requireSuccess(await this.deps.applyDns(), 'Не удалось подключить DNS.');
          const status = await this.deps.dns.status({ force: true });
          if (status.running !== true || status.verified !== true) throw new Error(status.lastError || 'DNS не прошёл проверку.');
        }
        this.checkCancelled();
        if (telegramEnabled && this.deps.telegramProxy) {
          this.publish({ phase: 'telegram', progress: 92, message: 'Запускаем прокси Telegram' });
          if (!telegramBefore.running && !telegramBefore.serviceRunning) {
            // Installation starts the service and may partially succeed before throwing.
            startedTg = true;
            const installed = this.requireSuccess(await this.deps.telegramProxy.installService(), 'Не удалось установить прокси Telegram.');
            if (!installed?.serviceRunning) throw new Error(installed?.lastError || 'Служба прокси Telegram не подтвердила запуск.');
          }
          const status = await this.deps.telegramProxy.status({ force: true });
          if (!status?.running && !status?.serviceRunning) throw new Error(status?.lastError || 'Прокси Telegram не подтвердил запуск.');
          this.checkCancelled();
          // Opening the client is optional; service failures above must abort the transaction.
          await this.deps.telegramProxy.openConnectionLink().catch(() => {});
        }
        this.checkCancelled();
        await this.deps.saveConnected(profile);
        this.publish({ phase: 'connected', progress: 100, message: 'Защита и службы работают в фоне', error: null, profile });
        return { ok: true, profile };
      } catch (error) {
        const rollbackErrors = [];
        if (startedTg && this.deps.telegramProxy) {
          try { await this.stopTelegram(); } catch (e) { rollbackErrors.push(e.message); }
        }
        if (startedDns) {
          try { this.requireSuccess(await this.deps.resetDns(), 'Не удалось восстановить DNS.'); }
          catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
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
      this.requireSuccess(await this.deps.resetDns(), 'Не удалось восстановить DNS.');
      this.publish({ phase: 'disconnecting', progress: 40, message: 'Останавливаем службы' });
      if (this.deps.telegramProxy) {
        await this.stopTelegram();
      }
      this.publish({ phase: 'disconnecting', progress: 70, message: 'Останавливаем службу Zapret' });
      this.requireSuccess(await this.deps.zapret.stopStandalone(), 'Не удалось остановить процесс.');
      this.requireSuccess(await this.deps.zapret.stopService(), 'Не удалось остановить службу.');
      const status = await this.deps.zapret.status({ force: true });
      if (status.serviceRunning || status.standaloneRunning) throw new Error('Служба ещё работает. Повторите отключение.');
      this.publish({ phase: 'idle', progress: 0, error: null, message: 'Подключение отключено' });
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
