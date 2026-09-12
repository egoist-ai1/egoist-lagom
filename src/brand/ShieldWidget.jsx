function ShieldWidget({ snapshot, onOpenSettings }) {
  const api = window.egoistAPI;
  const [connection, setConnection] = O.useState(null);
  const [actionError, setActionError] = O.useState('');
  const [statusError, setStatusError] = O.useState('');
  const [dnsBusy, setDnsBusy] = O.useState(false);
  const [tgBusy, setTgBusy] = O.useState(false);

  const [dnsEnabled, setDnsEnabled] = O.useState(() => {
    try { return localStorage.getItem('shield_dns_on_connect') !== 'false'; } catch { return true; }
  });
  const [telegramEnabled, setTelegramEnabled] = O.useState(() => {
    try { return localStorage.getItem('shield_telegram_on_connect') !== 'false'; } catch { return true; }
  });

  const mounted = O.useRef(true);
  const surface = O.useRef(null);
  const stateRevision = O.useRef(0);

  O.useEffect(() => {
    const syncVisibility = () => {
      if (surface.current) surface.current.dataset.hidden = String(document.hidden);
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, []);

  O.useEffect(() => {
    mounted.current = true;
    let timer;
    const refresh = async () => {
      const revision = stateRevision.current;
      try {
        const status = await Z('shield.status', api?.shield?.status);
        if (mounted.current && revision === stateRevision.current) {
          setConnection(status);
          setStatusError('');
        }
      } catch (failure) {
        if (mounted.current) setStatusError(failure.message || 'Не удалось прочитать состояние службы');
      }
      if (mounted.current) timer = setTimeout(refresh, document.hidden ? 10000 : 4000);
    };
    const unsubscribe = api?.shield?.onProgress?.(status => {
      if (mounted.current) {
        stateRevision.current += 1;
        setStatusError('');
        setConnection(previous => ({ ...previous, ...status }));
      }
    });
    refresh();
    return () => { mounted.current = false; clearTimeout(timer); unsubscribe?.(); };
  }, []);

  const busy = connection?.busy === true;
  const running = connection?.running ?? !!(snapshot?.zapret?.serviceRunning || snapshot?.zapret?.standaloneRunning);
  const dnsRunning = connection?.dnsRunning ?? snapshot?.systemDoh?.running === true;
  const telegramRunning = connection?.telegramRunning ?? snapshot?.telegram?.running === true;
  const failure = actionError || statusError || connection?.error;
  const phase = busy ? connection.phase : failure ? 'error' : running ? 'connected' : 'idle';
  const progress = Math.max(0, Math.min(100, Number(connection?.progress) || 0));

  O.useLayoutEffect(() => {
    const gsap = window.ShieldMotion?.gsap;
    if (!gsap) return;
    const media = gsap.matchMedia(surface.current);
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const timeline = gsap.timeline();
      timeline.fromTo('.shield-widget-status-group', { y: 3, opacity: .6 }, { y: 0, opacity: 1, duration: .32, ease: 'power2.out' });
      if (phase === 'connected') timeline.fromTo('.shield-connected-check', { strokeDashoffset: 44 }, { strokeDashoffset: 0, duration: .46, ease: 'power2.out' }, 0);
      const visibility = () => document.hidden ? timeline.pause() : timeline.resume();
      visibility();
      document.addEventListener('visibilitychange', visibility);
      return () => document.removeEventListener('visibilitychange', visibility);
    });
    return () => media.revert();
  }, [phase, busy]);

  async function refreshNow() {
    const revision = stateRevision.current;
    const status = await Z('shield.status', api?.shield?.status);
    if (mounted.current && revision === stateRevision.current) {
      setConnection(status);
      setStatusError('');
    }
  }

  async function toggleConnection() {
    if (busy || dnsBusy || tgBusy) return;
    stateRevision.current += 1;
    setActionError('');
    setConnection(previous => ({
      ...previous,
      busy: true,
      phase: running ? 'disconnecting' : 'preparing',
      progress: 0,
      message: running ? 'Восстанавливаем настройки сети' : 'Подготавливаем подключение',
      error: null
    }));
    try {
      const result = running
        ? await Z('shield.disconnect', api?.shield?.disconnect)
        : await Z('shield.connect', api?.shield?.connect, { dnsEnabled, telegramEnabled });
      if (result?.ok !== true && !result?.cancelled) throw new Error(result?.message || 'Подключение не подтверждено');
      await refreshNow();
      if (mounted.current) setActionError('');
    } catch (failure) {
      if (mounted.current) {
        setActionError(failure.message);
        setConnection(previous => ({ ...previous, busy: false }));
      }
      await refreshNow().catch(() => {});
    }
  }

  async function toggleDns() {
    if (busy || dnsBusy) return;
    const next = !(dnsRunning || (!running && dnsEnabled));
    setActionError('');
    if (running || dnsRunning) {
      setDnsBusy(true);
      try {
        const result = next
          ? await Z('system.applySystemDoh', api?.system?.applySystemDoh, snapshot?.state?.settings?.systemDohUrl)
          : await Z('system.resetSystemDoh', api?.system?.resetSystemDoh);
        if (result?.ok === false || (next ? result?.running === false || result?.verified === false : result?.running === true)) throw new Error(result?.message || result?.lastError || 'Не удалось изменить DNS');
        await refreshNow();
        if (mounted.current) setActionError('');
      } catch (failure) {
        setActionError(failure.message);
        return;
      } finally {
        if (mounted.current) setDnsBusy(false);
      }
    }
    setDnsEnabled(next);
    try { localStorage.setItem('shield_dns_on_connect', String(next)); } catch {}
  }

  async function toggleTelegram() {
    if (busy || tgBusy) return;
    const next = !(telegramRunning || (!running && telegramEnabled));
    setActionError('');
    if (running || telegramRunning) {
      setTgBusy(true);
      try {
        const result = next
          ? await Z('telegramProxy.start', api?.telegramProxy?.start)
          : await Z('telegramProxy.stop', api?.telegramProxy?.stop);
        const activeAfter = result?.running === true || result?.serviceRunning === true;
        if (result?.ok === false || (next ? !activeAfter : activeAfter)) throw new Error(result?.message || result?.lastError || 'Не удалось изменить Telegram Proxy');
        await refreshNow();
        if (mounted.current) setActionError('');
      } catch (failure) {
        setActionError(failure.message);
        return;
      } finally {
        if (mounted.current) setTgBusy(false);
      }
    }
    setTelegramEnabled(next);
    try { localStorage.setItem('shield_telegram_on_connect', String(next)); } catch {}
  }

  async function cancel() {
    try {
      const result = await Z('shield.cancel', api?.shield?.cancel);
      if (result?.ok === false) setActionError(result.message);
    } catch (failure) {
      setActionError(failure.message);
    }
  }

  return (
    <div className="shield-widget-container" data-phase={phase} ref={surface}>
      <header className="shield-widget-header">
        <div className="shield-widget-brand">
          <span>egoist<span className="shield-brand-separator"> / </span><b>lagom</b></span>
        </div>
        <div className="shield-widget-window-btns">
          <button aria-label="Свернуть" title="Свернуть" onClick={() => api?.window?.minimize?.()}>
            <RubyIcon name="minimize" size={14}/>
          </button>
          <button aria-label="Закрыть" title="Скрыть в трей" onClick={() => api?.window?.close?.()}>
            <RubyIcon name="close" size={14}/>
          </button>
        </div>
      </header>

      <section className="shield-widget-hero" aria-label="Управление защитой">
        <button
          className="shield-interactive-trigger"
          onClick={toggleConnection}
          disabled={busy || dnsBusy || tgBusy}
          aria-label={busy ? 'Выполняется операция' : running ? 'Отключить защиту' : 'Подключить защиту'}
          title={busy ? 'Операция выполняется...' : running ? 'Нажмите для отключения' : 'Нажмите для подключения'}
        >
          <div className="shield-widget-emblem" aria-hidden="true">
            <svg className="shield-widget-symbol" viewBox="0 0 106 112" fill="none">
              <path className="shield-base-fill" d="M53 5 95 20v33c0 26-17 44-42 54C28 97 11 79 11 53V20L53 5Z"/>
              <path className="shield-inner-contour" d="M53 15 86 27v26c0 20-13 35-33 44C33 88 20 73 20 53V27l33-12Z"/>
              <path className="shield-outer-border" d="M53 5 95 20v33c0 26-17 44-42 54C28 97 11 79 11 53V20L53 5Z"/>
              <path className="shield-travel-edge" d="M53 5 95 20v33c0 26-17 44-42 54C28 97 11 79 11 53V20L53 5Z" pathLength="300"/>
              <path className="shield-power" d="M53 33v18M41.5 38.5a18 18 0 1 0 23 0" strokeWidth="3.4" strokeLinecap="round"/>
              <path className="shield-connected-check" d="m39 55 10 10 18-22" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </button>

        <div className="shield-widget-status-group" role="status" aria-live="polite" aria-atomic="true">
          <h1>
            <i className="shield-live-dot"/>
            {busy ? (phase === 'disconnecting' ? 'Отключение...' : 'Подключение...') : failure ? 'Нужна проверка' : running ? 'Подключено' : 'Готов к подключению'}
          </h1>
          {(busy || failure) && (
            <p>{busy ? (connection?.message || 'Оптимизация соединения...') : 'Подробности ниже'}</p>
          )}
        </div>

        <div className="shield-progress-area">
          <div
            className="shield-progress-track"
            role="progressbar"
            aria-label="Прогресс"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={busy ? progress : running ? 100 : 0}
          >
            <span style={{ transform: `scaleX(${(busy ? progress : running ? 100 : 0) / 100})` }}/>
          </div>
        </div>

        {busy && phase !== 'disconnecting' && (
          <div className="shield-widget-caption">
            <button className="shield-cancel" onClick={cancel}>Отменить</button>
          </div>
        )}
      </section>

      {failure && (
        <details className="shield-widget-error" open>
          <summary><RubyIcon name="warning" size={14}/>Не удалось завершить действие</summary>
          <p role="alert">{failure}</p>
        </details>
      )}

      <footer className="shield-widget-footer">
        <div className="shield-footer-switches">
          <div className="shield-switch-group" title={dnsBusy ? 'Проверяем DNS' : dnsRunning ? 'DNS зашифрован' : dnsEnabled ? 'DNS включится при подключении' : 'DNS выключен'}>
            <span>DNS</span>
            <button
              role="switch"
              aria-label="Зашифрованный DNS"
              aria-checked={dnsRunning || (!running && dnsEnabled)}
              disabled={busy || dnsBusy}
              className="shield-switch-toggle"
              onClick={toggleDns}
            >
              <i/>
            </button>
          </div>

          <div className="shield-switch-group" title={tgBusy ? 'Переключаем Telegram' : telegramRunning ? 'Telegram Proxy активен' : telegramEnabled ? 'Telegram включится при подключении' : 'Telegram выключен'}>
            <span>TG</span>
            <button
              role="switch"
              aria-label="Telegram Proxy"
              aria-checked={telegramRunning || (!running && telegramEnabled)}
              disabled={busy || tgBusy}
              className="shield-switch-toggle"
              onClick={toggleTelegram}
            >
              <i/>
            </button>
          </div>
        </div>

        <button className="shield-settings-open-btn" onClick={onOpenSettings} aria-label="Настройки" title="Настройки">
          <RubyIcon name="settings" size={17}/>
        </button>
      </footer>
    </div>
  );
}
