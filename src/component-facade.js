const systemDohServiceBrokers = new WeakMap();
function getSystemDohServiceBroker(manager) {
  const broker = systemDohServiceBrokers.get(manager);
  return broker && manager.coreService === broker.coreService && Object.entries(broker.methods).every(([method, wrapped]) => manager[method] === wrapped) ? broker.coreService : null;
}
function useComponentService(manager, component, coreService) {
  if (!coreService) return manager;
  const operations = componentOperations()[component];
  const pendingStatuses = new Map();
  let dnsMutationQueue = Promise.resolve();
  const nativeApply = component === 'SystemDoH' && typeof manager.apply === 'function' && typeof coreService.nativeDohStatus === 'function' ? manager.apply.bind(manager) : null;
  const workerRequest = (method, args) => coreService.request(COMPONENT_QUERIES.has(method) ? 'component.query' : 'component.execute', { component, method, args });
  const routeRequest = async (method, args) => {
    if (nativeApply && ['status', 'apply', 'recover', 'restart', 'stop', 'stopAndRemove'].includes(method)) {
      const [local, nativeResult] = await Promise.all([
        workerRequest('status', [{ force: true }]),
        coreService.nativeDohStatus().then(value => ({ value }), error => ({ error })),
      ]);
      if (nativeResult.error) {
        if (method === 'status' && (local?.currentUrl || local?.serviceInstalled)) return {
          ...local, nativeStatusUnavailable: true,
          lastError: local.lastError ?? 'Не удалось проверить штатный Windows DoH; локальная служба сохранена.',
        };
        throw nativeResult.error;
      }
      const native = nativeResult.value;
      const localState = String(local?.serviceState ?? '').toLowerCase();
      if (['unknown', 'unavailable', 'query-failed'].includes(localState)) {
        if (method === 'status') return local;
        throw new Error('Не удалось проверить локальную службу DNS. Действующая конфигурация сохранена.');
      }
      const localPresent = Boolean(local?.currentUrl || local?.serviceInstalled || local?.serviceRunning);
      if (localPresent && native?.enabled) throw new Error('Обнаружены два управляемых режима DNS. Изменение заблокировано до проверки их состояния.');
      const requestedUrl = method === 'apply' ? args[0] : method === 'recover' && args[0]?.enabled ? args[0].url : null;
      const customPort = requestedUrl ? !['', '443'].includes(new URL(requestedUrl).port) : false;
      if (!localPresent && (native?.supported === true && !customPort || native?.enabled)) {
        if (method === 'status') return manager.mapNativeStatus(native);
        if (method === 'apply') return nativeApply(...args);
        if (method === 'restart') {
          if (!native?.url) throw new Error('Конфигурация System DoH отсутствует.');
          return nativeApply(native.url);
        }
        if (method === 'recover' && args[0]?.enabled) return nativeApply(args[0].url, args[0].localAddress);
        return manager.mapNativeStatus(await coreService.removeNativeDoh());
      }
    }
    const restoresDns = component === 'SystemDoH' && (['stop', 'stopAndRemove'].includes(method) || method === 'recover' && args[0]?.enabled === false);
    if (restoresDns) {
      const restored = await coreService.restoreOwnedDns();
      if (restored.pendingAdapters > 0) throw new Error('Подключите ранее использованный адаптер для восстановления DNS. Служба сохранена.');
    }
    return workerRequest(method, args);
  };
  for (const method of Object.keys(operations)) {
    if (method === 'autoSelectBestProfile') continue;
    manager[method] = async (...args) => {
      const request = () => {
        if (component !== 'SystemDoH' || COMPONENT_QUERIES.has(method)) return routeRequest(method, args);
        const pending = dnsMutationQueue.then(() => routeRequest(method, args));
        dnsMutationQueue = pending.catch(() => {});
        return pending;
      };
      if (method !== 'status' || args[0]?.force) return request();
      const key = JSON.stringify(args);
      if (!pendingStatuses.has(key)) {
        const pending = request().finally(() => pendingStatuses.delete(key));
        pendingStatuses.set(key, pending);
      }
      return pendingStatuses.get(key);
    };
  }
  if (component === 'SystemDoH' && manager.coreService === coreService && ['status', 'apply', 'restart', 'stopAndRemove'].every(method => Object.hasOwn(operations, method))) {
    systemDohServiceBrokers.set(manager, { coreService, methods: Object.fromEntries(['status', 'apply', 'restart', 'stopAndRemove'].map(method => [method, manager[method]])) });
  }
  if (component === 'Zapret') {
    manager.autoSelectBestProfile = async onProgress => {
      const voiceTarget = await manager.readRecentDiscordVoiceControlTarget();
      let polling = false;
      const timer = setInterval(async () => {
        if (polling) return;
        polling = true;
        try { const value = await manager.autoSelectProgress(); if (value) onProgress?.(value); }
        catch { /* The mutation itself reports connection errors. */ }
        finally { polling = false; }
      }, 600);
      try { return await coreService.request('component.execute', { component, method: 'autoSelectBestProfile', args: [voiceTarget] }); }
      finally { clearInterval(timer); }
    };
  }
  return manager;
}
