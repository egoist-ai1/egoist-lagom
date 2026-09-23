function useComponentService(manager, component, coreService) {
  if (!coreService) return manager;
  const operations = componentOperations()[component];
  const pendingStatuses = new Map();
  for (const method of Object.keys(operations)) {
    if (method === 'autoSelectBestProfile') continue;
    manager[method] = async (...args) => {
      const request = () => coreService.request(COMPONENT_QUERIES.has(method) ? 'component.query' : 'component.execute', { component, method, args });
      const restoresDns = component === 'SystemDoH' && (['stop', 'stopAndRemove'].includes(method) || method === 'recover' && args[0]?.enabled === false);
      if (restoresDns) {
        const restored = await coreService.restoreOwnedDns();
        if (restored.pendingAdapters > 0) throw new Error('Подключите ранее использованный адаптер для восстановления DNS. Служба сохранена.');
        return request();
      }
      if (method !== 'status' || args[0]?.force) return request();
      const key = JSON.stringify(args);
      if (!pendingStatuses.has(key)) {
        const pending = request().finally(() => pendingStatuses.delete(key));
        pendingStatuses.set(key, pending);
      }
      return pendingStatuses.get(key);
    };
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
