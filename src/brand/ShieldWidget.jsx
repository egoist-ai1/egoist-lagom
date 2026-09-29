function rubyTelegramReady(status) {
  if (status?.runtimeReady === false || status?.listenerReady === false) return false;
  return status?.runtimeReady === true || status?.running === true || status?.serviceRunning === true;
}

function rubyZapretReady(status) {
  if (status?.runtimeReady === false) return false;
  return status?.runtimeReady === true || status?.serviceReady === true || status?.serviceRunning === true || status?.standaloneRunning === true;
}

function rubyDnsReady(status) {
  return status?.running === true && status?.verified !== false;
}

function ShieldWidget({ snapshot, onOpenSettings }) {
  const api = window.egoistAPI;
  const [connection, setConnection] = O.useState(null);
  const [actionError, setActionError] = O.useState('');
  const [statusError, setStatusError] = O.useState('');
  const [localAction, setLocalAction] = O.useState(null);
  const [cancelBusy, setCancelBusy] = O.useState(false);

  const [dnsEnabled, setDnsEnabled] = O.useState(() => {
    try { return localStorage.getItem('shield_dns_on_connect') !== 'false'; } catch { return true; }
  });
  const [telegramEnabled, setTelegramEnabled] = O.useState(() => {
    try { return localStorage.getItem('shield_telegram_on_connect') !== 'false'; } catch { return true; }
  });

  const mounted = O.useRef(true);
  const surface = O.useRef(null);
  const stateRevision = O.useRef(0);
  const readSequence = O.useRef(0);
  const operation = O.useRef(null);
  const cancellation = O.useRef(false);

  async function refreshNow(duringAction = false) {
    const revision = stateRevision.current;
    const sequence = ++readSequence.current;
    const current = () => mounted.current && revision === stateRevision.current && sequence === readSequence.current && (duringAction || !operation.current);
    try {
      const status = await Z('shield.status', api?.shield?.status);
      if (!status || typeof status !== 'object') throw new Error('Служба не вернула состояние подключения');
      if (current()) { setConnection(status); setStatusError(''); }
      return status;
    } catch (failure) {
      if (current()) setStatusError(failure.message || 'Не удалось прочитать состояние службы');
      throw failure;
    }
  }

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
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      clearTimeout(timer);
      polling = true;
      try {
        if (!operation.current) await refreshNow();
      } catch {} finally { polling = false; }
      if (mounted.current) timer = setTimeout(refresh, document.hidden ? 10000 : 4000);
    };
    const unsubscribe = api?.shield?.onProgress?.(status => {
      if (mounted.current) {
        stateRevision.current += 1;
        setStatusError('');
        setConnection(previous => ({ ...previous, ...status }));
      }
    });
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', visible);
    refresh();
    return () => { mounted.current = false; clearTimeout(timer); unsubscribe?.(); document.removeEventListener('visibilitychange', visible); };
  }, []);

  const busy = connection?.busy === true || localAction === 'connect' || localAction === 'disconnect';
  const dnsBusy = localAction === 'dns';
  const tgBusy = localAction === 'telegram';
  const statusKnown = connection !== null;
  const stateError = statusError || connection?.statusError;
  const unavailable = !statusKnown || !!stateError;
  const running = connection?.running ?? rubyZapretReady(snapshot?.zapret);
  const dnsRunning = connection?.dnsRunning ?? rubyDnsReady(snapshot?.systemDoh);
  const telegramRunning = connection?.telegramRunning ?? rubyTelegramReady(snapshot?.telegram);
  const failure = actionError || stateError || connection?.error;
  const liveFailure = stateError || connection?.error || (!running && actionError);
  const phase = busy ? (localAction === 'disconnect' ? 'disconnecting' : connection?.phase || 'preparing') : liveFailure ? 'error' : !statusKnown ? 'loading' : running ? 'connected' : 'idle';
  const progress = Math.max(0, Math.min(100, Number(connection?.progress) || 0));

  O.useLayoutEffect(() => {
    const gsap = window.ShieldMotion?.gsap;
    if (!gsap) return;
    const media = gsap.matchMedia(surface.current);
    media.add('(prefers-reduced-motion: no-preference)', () => {
      // Hidden windows retain the complete status glyph, without a paused entrance frame.
      if (document.hidden) return;
      const timeline = gsap.timeline();
      timeline.fromTo('.shield-widget-status-group', { y: 2, opacity: .8 }, { y: 0, opacity: 1, duration: .18, ease: 'power2.out' });
      if (phase === 'connected') timeline.fromTo('.shield-connected-check', { strokeDashoffset: 44 }, { strokeDashoffset: 0, duration: .28, ease: 'power2.out' }, 0);
      const visibility = () => document.hidden ? timeline.pause() : timeline.resume();
      visibility();
      document.addEventListener('visibilitychange', visibility);
      return () => document.removeEventListener('visibilitychange', visibility);
    });
    return () => media.revert();
  }, [phase, busy]);

  function begin(kind) {
    if (operation.current || busy || unavailable) return false;
    operation.current = kind;
    stateRevision.current += 1;
    setLocalAction(kind);
    setActionError('');
    return true;
  }

  function finish() {
    operation.current = null;
    stateRevision.current += 1;
    if (mounted.current) setLocalAction(null);
  }

  async function toggleConnection() {
    if (!begin(running ? 'disconnect' : 'connect')) return;
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
      await refreshNow(true);
      if (mounted.current) setActionError('');
    } catch (failure) {
      if (mounted.current) {
        setActionError(failure.message);
        setConnection(previous => ({ ...previous, busy: false }));
      }
      await refreshNow(true).catch(() => {});
    } finally { finish(); }
  }

  async function toggleDns() {
    if (!begin('dns')) return;
    const next = !(dnsRunning || (!running && dnsEnabled));
    try {
      if (running || dnsRunning) {
        const result = next
          ? await Z('system.applySystemDoh', api?.system?.applySystemDoh, snapshot?.state?.settings?.systemDohUrl)
          : await Z('system.resetSystemDoh', api?.system?.resetSystemDoh);
        if (!result || result.ok === false || (next ? result.running === false || result.verified === false : result.running === true)) throw new Error(result?.message || result?.lastError || 'Не удалось изменить DNS');
        const status = await refreshNow(true);
        if (status.dnsRunning !== next) throw new Error('Служба не подтвердила изменение DNS. Повторите проверку состояния.');
      }
      if (mounted.current) setDnsEnabled(next);
      try { localStorage.setItem('shield_dns_on_connect', String(next)); } catch {}
    } catch (failure) {
      if (mounted.current) setActionError(failure.message);
    } finally { finish(); }
  }

  async function toggleTelegram() {
    if (!begin('telegram')) return;
    const next = !(telegramRunning || (!running && telegramEnabled));
    try {
      if (running || telegramRunning) {
        const result = next
          ? await Z('telegramProxy.start', api?.telegramProxy?.start)
          : await Z('telegramProxy.stop', api?.telegramProxy?.stop);
        const activeAfter = rubyTelegramReady(result);
        if (!result || result.ok === false || (next ? !activeAfter : activeAfter || result.serviceRunning === true)) throw new Error(result?.message || result?.lastError || 'Не удалось изменить Telegram Proxy');
        const status = await refreshNow(true);
        if (status.telegramRunning !== next) throw new Error('Служба не подтвердила изменение Telegram Proxy. Повторите проверку состояния.');
      }
      if (mounted.current) setTelegramEnabled(next);
      try { localStorage.setItem('shield_telegram_on_connect', String(next)); } catch {}
    } catch (failure) {
      if (mounted.current) setActionError(failure.message);
    } finally { finish(); }
  }

  async function cancel() {
    if (cancellation.current) return;
    cancellation.current = true;
    setCancelBusy(true);
    try {
      const result = await Z('shield.cancel', api?.shield?.cancel);
      if (mounted.current && result?.ok === false) setActionError(result.message);
    } catch (failure) {
      if (mounted.current) setActionError(failure.message);
    } finally { cancellation.current = false; if (mounted.current) setCancelBusy(false); }
  }

  return (
    <div className="shield-widget-container" data-phase={phase} data-error={!!failure} ref={surface}>
      <header className="shield-widget-header">
        <div className="shield-widget-brand">
          <span>egoist<span className="shield-brand-separator"> / </span><b>lagom</b></span>
        </div>
        <div className="shield-widget-window-btns">
          <button aria-label="Свернуть" title="Свернуть" onClick={() => api?.window?.minimize?.()}>
            <RubyIcon name="minimize" size={14}/>
          </button>
          <button aria-label={snapshot?.state?.settings?.minimizeToTray ? 'Скрыть в трей' : 'Закрыть приложение'} title={snapshot?.state?.settings?.minimizeToTray ? 'Скрыть в трей' : 'Закрыть приложение'} onClick={() => api?.window?.close?.()}>
            <RubyIcon name="close" size={14}/>
          </button>
        </div>
      </header>

      <section className="shield-widget-hero" aria-label="Управление защитой">
        <button
          className="shield-interactive-trigger"
          onClick={toggleConnection}
          disabled={busy || dnsBusy || tgBusy || unavailable}
          aria-busy={busy || dnsBusy || tgBusy || !statusKnown}
          aria-label={!statusKnown ? 'Проверяем состояние службы' : busy ? 'Выполняется операция' : running ? 'Отключить защиту' : 'Подключить защиту'}
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
            {busy ? (phase === 'disconnecting' ? 'Отключение…' : 'Подключение…') : liveFailure ? 'Нужна проверка' : !statusKnown ? 'Проверяем состояние…' : running ? 'Подключено' : 'Готов к подключению'}
          </h1>
          {(busy || failure || dnsBusy || tgBusy) && (
            <p>{busy ? (connection?.message || 'Проверяем подключение…') : dnsBusy ? 'Переключаем DNS…' : tgBusy ? 'Переключаем Telegram…' : 'Подробности ниже'}</p>
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
            <button className="shield-cancel" onClick={cancel} disabled={cancelBusy} aria-busy={cancelBusy}>{cancelBusy ? 'Отменяем…' : 'Отменить'}</button>
          </div>
        )}
      </section>

      {failure && (
        <details className="shield-widget-error" open>
          <summary><RubyIcon name="warning" size={14}/>Не удалось завершить действие</summary>
          <p role="alert" tabIndex={0} aria-label="Подробности ошибки">{failure}</p>
          {stateError && <button className="shield-status-retry" onClick={() => refreshNow().catch(() => {})}>Повторить проверку</button>}
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
              disabled={busy || dnsBusy || tgBusy || unavailable}
              aria-busy={dnsBusy}
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
              disabled={busy || dnsBusy || tgBusy || unavailable}
              aria-busy={tgBusy}
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
