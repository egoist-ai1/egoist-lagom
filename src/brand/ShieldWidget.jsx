function rubyStatusKnown(status) {
  return !!status && !status.statusError && status.uiObservation?.known !== false && status.uiObservation?.stale !== true;
}

function rubyShieldObservedState(connection, component) {
  if (!connection || connection.statusError) return null;
  const value = connection[component];
  return typeof value === 'boolean' ? value : null;
}

function rubyObserveStatus(result, previous, generation, attemptedAt) {
  const value = result?.status === 'fulfilled' && result.value && typeof result.value === 'object' ? result.value : null;
  if (value) return { ...value, uiObservation: { known:true, stale:false, error:null, generation, attemptedAt, lastConfirmedAt:result.completedAt ?? attemptedAt } };
  const error = result?.reason?.message || (result?.status === 'rejected' ? String(result.reason) : 'Служба не вернула состояние');
  return { ...previous, uiObservation: { known:false, stale:!!previous?.uiObservation?.lastConfirmedAt, error, generation, attemptedAt, lastConfirmedAt:previous?.uiObservation?.lastConfirmedAt ?? null } };
}

function rubyReadStatuses(reads) {
  return Promise.all(reads.map(read => Promise.resolve(read).then(
    value => ({status:'fulfilled',value,completedAt:Date.now()}),
    reason => ({status:'rejected',reason,completedAt:Date.now()})
  )));
}

function rubyTelegramIpAddress(value) {
  const parts = value.split('.');
  if (parts.length === 4 && parts.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)) return true;
  if (!value.includes(':') || value.includes('%')) return false;
  try { return new URL(`http://[${value}]/`).hostname.startsWith('['); } catch { return false; }
}

function rubyTelegramConfigProblem(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 'Конфигурация Telegram ещё не прочитана.';
  const keys = ['host','port','secret','dcIp','verbose','bufKb','poolSize','logMaxMb','checkUpdates'];
  if (Object.keys(config).some(key => !keys.includes(key))) return 'Служба вернула неизвестные поля конфигурации Telegram.';
  const host = typeof config.host === 'string' ? config.host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1') : '';
  if (!['127.0.0.1','::1','localhost'].includes(host)) return 'Локальный адрес: 127.0.0.1, ::1 или localhost.';
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) return 'Порт Telegram: целое число от 1024 до 65535.';
  if (typeof config.secret !== 'string' || !/^[a-f0-9]{32}$/i.test(config.secret.trim().replace(/^dd([a-f0-9]{32})$/i, '$1'))) return 'Secret должен содержать ровно 32 hex-символа.';
  if (!Array.isArray(config.dcIp) || config.dcIp.length > 16 || config.dcIp.some(value => {
    if (typeof value !== 'string' || value.trim().length > 128 || !/^\d+:[a-z0-9.:-]+$/i.test(value.trim())) return true;
    const match = /^([1-5]):(.+)$/.exec(value.trim());
    return !match || !rubyTelegramIpAddress(match[2]);
  })) return 'Прямые DC: адреса вида 2:149.154.167.220; DC 1–5, не более 16 строк.';
  if (!Number.isInteger(config.bufKb) || config.bufKb < 64 || config.bufKb > 4096) return 'Буфер Telegram: целое число от 64 до 4096 КБ.';
  if (!Number.isInteger(config.poolSize) || config.poolSize < 1 || config.poolSize > 32) return 'Пул Telegram: целое число от 1 до 32.';
  if (!Number.isFinite(config.logMaxMb) || config.logMaxMb < 1 || config.logMaxMb > 100) return 'Лимит журнала Telegram: от 1 до 100 МБ.';
  if (typeof config.verbose !== 'boolean' || typeof config.checkUpdates !== 'boolean') return 'Служба не вернула все параметры конфигурации Telegram.';
  return null;
}

function rubyTelegramConfigReady(status) {
  return rubyStatusKnown(status) && rubyTelegramConfigProblem(status.config) === null;
}

function rubyTelegramConfigKey(config) {
  return JSON.stringify([typeof config?.host === 'string' ? config.host.trim() : null, config?.port ?? null, typeof config?.secret === 'string' ? config.secret.trim().replace(/^dd([a-f0-9]{32})$/i, '$1').toLowerCase() : null,
    Array.isArray(config?.dcIp) ? [...new Set(config.dcIp.map(value => typeof value === 'string' ? value.trim() : null))] : [], config?.verbose ?? null, config?.bufKb ?? null, config?.poolSize ?? null, config?.logMaxMb ?? null, config?.checkUpdates ?? null]);
}

function rubyTelegramReady(status) {
  if (!rubyStatusKnown(status)) return false;
  if (status?.runtimeReady === false || status?.listenerReady === false) return false;
  return status?.runtimeReady === true || status?.running === true || status?.serviceRunning === true;
}

function rubyZapretReady(status) {
  if (!rubyStatusKnown(status)) return false;
  if (status?.runtimeReady === false) return false;
  return status?.runtimeReady === true || status?.serviceReady === true || status?.serviceRunning === true || status?.standaloneRunning === true;
}

function rubyDnsReady(status) {
  if (!rubyStatusKnown(status)) return false;
  return status?.running === true && (status?.resolutionVerified === true || status?.verified === true);
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

  const busy = (!(statusError || connection?.statusError) && connection?.busy === true) || localAction === 'connect' || localAction === 'disconnect';
  const dnsBusy = localAction === 'dns';
  const tgBusy = localAction === 'telegram';
  const statusKnown = connection !== null && typeof connection.running === 'boolean';
  const stateError = statusError || connection?.statusError;
  const unavailable = !statusKnown || !!stateError;
  const running = statusKnown && !stateError ? connection.running : null;
  const dnsRunning = !stateError ? rubyShieldObservedState(connection, 'dnsRunning') : null;
  const telegramRunning = !stateError ? rubyShieldObservedState(connection, 'telegramRunning') : null;
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
    const next = !dnsRunning;
    try {
      let url;
      if (next) {
        const state = await Z('state.get', api?.state?.get);
        url = state?.settings?.systemDohUrl;
        if (!url) throw new Error('Добавьте HTTPS-адрес DoH в разделе DNS.');
      }
      const result = next
        ? await Z('system.applySystemDoh', api?.system?.applySystemDoh, url)
        : await Z('system.resetSystemDoh', api?.system?.resetSystemDoh);
      if (!result || result.ok === false || (next ? result.running === false || result.verified === false : result.running === true)) throw new Error(result?.message || result?.lastError || 'Не удалось изменить DNS');
      const status = await refreshNow(true);
      if (status.statusError || status.dnsRunning !== next) throw new Error('Служба не подтвердила изменение DNS. Повторите проверку состояния.');
    } catch (failure) {
      if (mounted.current) setActionError(failure.message);
    } finally { finish(); }
  }

  async function toggleTelegram() {
    if (!begin('telegram')) return;
    const next = !telegramRunning;
    try {
      const result = next
        ? await Z('telegramProxy.start', api?.telegramProxy?.start)
        : await Z('telegramProxy.stop', api?.telegramProxy?.stop);
      const activeAfter = rubyTelegramReady(result);
      if (!result || result.ok === false || (next ? !activeAfter : activeAfter || result.serviceRunning === true)) throw new Error(result?.message || result?.lastError || 'Не удалось изменить Telegram Proxy');
      const status = await refreshNow(true);
      if (status.statusError || status.telegramRunning !== next) throw new Error('Служба не подтвердила изменение Telegram Proxy. Повторите проверку состояния.');
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

  function setOnConnectPreference(component, enabled) {
    if (component === 'dns') setDnsEnabled(enabled);
    else setTelegramEnabled(enabled);
    try { localStorage.setItem(component === 'dns' ? 'shield_dns_on_connect' : 'shield_telegram_on_connect', String(enabled)); } catch {}
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
          aria-label={!statusKnown ? 'Проверяем состояние службы' : busy ? 'Выполняется операция' : running ? 'Отключить профиль DPI и компоненты' : 'Подключить профиль DPI и выбранные компоненты'}
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
            {busy ? (phase === 'disconnecting' ? 'Отключение…' : 'Подключение…') : liveFailure ? 'Нужна проверка' : !statusKnown ? 'Проверяем состояние…' : running ? 'Профиль подключён' : 'Готов к подключению'}
          </h1>
          {(busy || failure || dnsBusy || tgBusy) && (
            <p>{busy ? (connection?.message || 'Проверяем подключение…') : dnsBusy ? 'Переключаем DNS…' : tgBusy ? 'Переключаем Telegram…' : 'Подробности ниже'}</p>
          )}
        </div>

        <p className="shield-operation-scope">Профиль DPI · VPN подключается отдельно</p>

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

      <fieldset className="shield-on-connect-preferences" disabled={busy || dnsBusy || tgBusy}>
        <legend>При подключении профиля</legend>
        <label><input type="checkbox" checked={dnsEnabled} onChange={event => setOnConnectPreference('dns', event.target.checked)}/><span>Включить DNS</span></label>
        <label><input type="checkbox" checked={telegramEnabled} onChange={event => setOnConnectPreference('telegram', event.target.checked)}/><span>Включить TG</span></label>
      </fieldset>

      <footer className="shield-widget-footer">
        <div className="shield-footer-switches">
          <div className="shield-switch-group" title={dnsBusy ? 'Проверяем DNS' : dnsRunning === null ? 'Состояние DNS не проверено' : dnsRunning ? 'DNS зашифрован' : 'DNS выключен'}>
            <span>DNS<small>{dnsBusy ? 'Проверка…' : dnsRunning === null ? 'Не проверен' : dnsRunning ? 'Работает' : 'Выключен'}</small></span>
            <button
              role="switch"
              aria-label="Зашифрованный DNS"
              aria-checked={dnsRunning === true}
              disabled={busy || dnsBusy || tgBusy || unavailable || dnsRunning === null}
              aria-busy={dnsBusy}
              className="shield-switch-toggle"
              onClick={toggleDns}
            >
              <i/>
            </button>
          </div>

          <div className="shield-switch-group" title={tgBusy ? 'Переключаем Telegram' : telegramRunning === null ? 'Состояние Telegram не проверено' : telegramRunning ? 'Telegram Proxy активен' : 'Telegram выключен'}>
            <span>TG<small>{tgBusy ? 'Проверка…' : telegramRunning === null ? 'Не проверен' : telegramRunning ? 'Работает' : 'Выключен'}</small></span>
            <button
              role="switch"
              aria-label="Telegram Proxy"
              aria-checked={telegramRunning === true}
              disabled={busy || dnsBusy || tgBusy || unavailable || telegramRunning === null}
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
