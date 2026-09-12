'use strict';

// Guest-only acceptance probe. The supplied PID must own the local main inspector.
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const started = performance.now();
const wholeDeadline = started + 450_000;
const readinessDeadline = started + 300_000;
const expectedMainPid = Number(process.argv[2]);
const outputPath = process.argv[3];
const state = {
  schemaVersion: 1,
  expectedMainPid,
  phase: 'starting',
  ok: false,
  components: [],
  screens: [],
};
let socket;
let nextId = 0;
let writeChain = Promise.resolve();
const pending = new Map();

function failure(code) {
  const error = new Error(code);
  error.probeCode = code;
  return error;
}

function remaining(deadline, maximum) {
  const value = Math.min(deadline, wholeDeadline) - performance.now();
  if (value <= 0) throw failure('deadline-exceeded');
  return Math.max(1, Math.min(maximum, value));
}

function publish(phase, extra = {}) {
  Object.assign(state, extra, { phase, elapsedMs: Math.round(performance.now() - started) });
  const contents = JSON.stringify(state, null, 2) + '\n';
  const write = async () => {
    const temporary = `${outputPath}.tmp-${process.pid}`;
    await fs.writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, outputPath);
  };
  writeChain = writeChain.then(write, write);
  return writeChain;
}

function rejectPending(code) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(failure(code));
  }
  pending.clear();
}

async function connect() {
  const response = await fetch('http://127.0.0.1:9229/json/list', {
    signal: AbortSignal.timeout(Math.ceil(remaining(readinessDeadline, 5_000))),
    redirect: 'error',
  });
  if (!response.ok) throw failure('inspector-discovery-failed');
  const targets = await response.json();
  const address = Array.isArray(targets) && targets.find(item => typeof item.webSocketDebuggerUrl === 'string')?.webSocketDebuggerUrl;
  if (!address) throw failure('inspector-target-missing');
  const endpoint = new URL(address);
  if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1' || endpoint.port !== '9229' || endpoint.username || endpoint.password) {
    throw failure('inspector-endpoint-not-local');
  }
  const connectedSocket = new WebSocket(endpoint);
  socket = connectedSocket;
  connectedSocket.addEventListener('message', event => {
    if (socket !== connectedSocket) return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(failure('inspector-command-failed'));
    else entry.resolve(message.result);
  });
  connectedSocket.addEventListener('close', () => { if (socket === connectedSocket) rejectPending('inspector-closed'); });
  connectedSocket.addEventListener('error', () => { if (socket === connectedSocket) rejectPending('inspector-socket-error'); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => complete(failure('inspector-connect-timeout')), remaining(readinessDeadline, 5_000));
    const opened = () => complete();
    const failed = () => complete(failure('inspector-connect-failed'));
    function complete(error) {
      clearTimeout(timer);
      connectedSocket.removeEventListener('open', opened);
      connectedSocket.removeEventListener('error', failed);
      connectedSocket.removeEventListener('close', failed);
      if (error) reject(error); else resolve();
    }
    connectedSocket.addEventListener('open', opened, { once: true });
    connectedSocket.addEventListener('error', failed, { once: true });
    connectedSocket.addEventListener('close', failed, { once: true });
  });
}

function evaluate(expression, deadline, maximum = 15_000) {
  const timeout = remaining(deadline, maximum);
  if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(failure('inspector-not-connected'));
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(failure('inspector-evaluation-timeout'));
    }, timeout);
    pending.set(id, {
      timer,
      reject,
      resolve: response => {
        if (response?.exceptionDetails) reject(failure('inspector-evaluation-exception'));
        else resolve(response?.result?.value);
      },
    });
    try {
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
        expression, awaitPromise: true, returnByValue: true,
      } }));
    } catch {
      pending.delete(id);
      clearTimeout(timer);
      reject(failure('inspector-send-failed'));
    }
  });
}

const electronExpression = "process.mainModule.require('electron')";
const readinessExpression = `(() => {
  const { app, BrowserWindow } = ${electronExpression};
  if (!app.isReady()) return { appReady: false, windowCount: 0 };
  const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
  return { appReady: true, windowCount: windows.length, windowId: windows.length === 1 ? windows[0].id : null };
})()`;
const domExpression = `(() => {
  const widget = document.querySelector('.shield-widget-container');
  const rect = widget?.getBoundingClientRect();
  const button = document.querySelector('.shield-interactive-trigger');
  const footer = document.querySelector('.shield-widget-footer')?.getBoundingClientRect();
  return {
    readyState: document.readyState,
    textLength: document.body?.innerText?.trim().length || 0,
    visibility: document.visibilityState,
    widgetPresent: !!widget,
    phase: widget?.dataset.phase || null,
    brandText: document.querySelector('.shield-widget-brand')?.innerText?.replace(/\\s+/g, ' ').trim() || '',
    mainActionText: button?.getAttribute('aria-label') || button?.innerText?.trim() || '',
    mainActionEnabled: !!button && !button.disabled,
    dnsSwitchPresent: !!document.querySelector('.shield-switch-toggle[role="switch"]'),
    settingsPresent: !!document.querySelector('.shield-settings-open-btn[aria-label="Настройки"]'),
    windowButtonCount: document.querySelectorAll('.shield-widget-window-btns button').length,
    retiredWindowsControlAbsent: !Object.prototype.hasOwnProperty.call(window.egoistAPI || {}, 'systemControl'),
    generatedIconCount: document.querySelectorAll('svg.ruby-icon path, svg.ruby-icon circle, .shield-widget-symbol path').length,
    widgetInViewport: !!rect && rect.width > 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
    footerInViewport: !!footer && footer.bottom <= innerHeight + 1,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    verticalOverflow: document.documentElement.scrollHeight > innerHeight + 1,
    viewport: { width: innerWidth, height: innerHeight }
  };
})()`;

function windowExpression(windowId, body) {
  return `(() => {
    const { app, BrowserWindow } = ${electronExpression};
    const w = BrowserWindow.fromId(${windowId});
    if (!w || w.isDestroyed()) throw new Error('owned-window-unavailable');
    ${body}
  })()`;
}

function rendererExpression(windowId, expression) {
  return windowExpression(windowId, `return w.webContents.executeJavaScript(${JSON.stringify(expression)});`);
}

async function readNativeWidgetGeometry(windowId) {
  return evaluate(windowExpression(windowId, 'return { outer: w.getBounds(), content: w.getContentBounds(), zoom: w.webContents.getZoomFactor() };'), wholeDeadline);
}

function compactViewportMatches(viewport, geometry) {
  if (!viewport || !geometry?.content || Math.abs(geometry.zoom - 1) > 0.0001) return false;
  const content = geometry.content;
  return content.width >= 280 && content.width <= 360
    && content.height >= 340 && content.height <= 440
    && Math.abs(viewport.width - content.width) <= 1
    && Math.abs(viewport.height - content.height) <= 1;
}

async function metrics(deadline) {
  return evaluate(`(() => {
    const metrics = ${electronExpression}.app.getAppMetrics();
    return metrics.map(item => ({ pid: item.pid, type: item.type, cpu: {
      percentCPUUsage: item.cpu?.percentCPUUsage,
      cumulativeCPUUsage: item.cpu?.cumulativeCPUUsage,
      idleWakeupsPerSecond: item.cpu?.idleWakeupsPerSecond
    } }));
  })()`, deadline);
}

async function captureWindow(windowId, capturePath) {
  await evaluate(rendererExpression(windowId, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'), wholeDeadline);
  const result = await evaluate(windowExpression(windowId, `return w.webContents.capturePage().then(image => {
    const { width, height } = image.getSize(), pixels = image.toBitmap();
    let bodySamples = 0;
    for (let y = 12; y < height - 12; y += 3) {
      for (let x = 12; x < width - 12; x += 3) {
        const offset = (y * width + x) * 4;
        if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) >= 45) bodySamples++;
      }
    }
    if (bodySamples >= 50) process.mainModule.require('node:fs').writeFileSync(${JSON.stringify(capturePath)}, image.toPNG());
    return { width, height, bodySamples, painted: bodySamples >= 50 };
  });`), wholeDeadline);
  if (!result?.painted) throw failure('installed-window-capture-empty');
  return result;
}

async function inspectWidgetAndDashboard(windowId) {
  const widgetCapturePath = `${outputPath}.widget.png`;
  const widgetCapture = await captureWindow(windowId, widgetCapturePath);
  state.screens.push({ screen: 'widget', ...widgetCapture, capturePath: widgetCapturePath });
  await publish('opening-dashboard');
  await evaluate(rendererExpression(windowId, `(() => {
    const button = document.querySelector('.shield-settings-open-btn[aria-label="Настройки"]');
    if (!button) throw new Error('widget-settings-missing');
    button.click();
    return true;
  })()`), wholeDeadline);
  let dashboard;
  while (true) {
    dashboard = await evaluate(rendererExpression(windowId, `(() => ({
      present: !!document.querySelector('.ruby-dashboard'),
      navigationCount: document.querySelectorAll('.ruby-sidebar nav button').length,
      widgetSwitcherPresent: !!document.querySelector('.ruby-widget-switch-btn[aria-label="Виджет"]'),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      viewport: { width: innerWidth, height: innerHeight }
    }))()`), wholeDeadline);
    if (dashboard?.present && dashboard.navigationCount === 6 && dashboard.widgetSwitcherPresent && dashboard.viewport.width >= 780 && dashboard.viewport.height >= 600 && !dashboard.horizontalOverflow) break;
    await new Promise(resolve => setTimeout(resolve, remaining(wholeDeadline, 250)));
  }
  await publish('checking-dashboard', { dashboard });
  await inspectScreens(windowId);
  await evaluate(rendererExpression(windowId, `(() => {
    const button = document.querySelector('.ruby-widget-switch-btn[aria-label="Виджет"]');
    if (!button) throw new Error('dashboard-widget-switch-missing');
    button.click();
    return true;
  })()`), wholeDeadline);
  while (true) {
    const returned = await evaluate(rendererExpression(windowId, `(() => ({
      widgetPresent: !!document.querySelector('.shield-widget-container'),
      viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1
    }))()`), wholeDeadline);
    const geometry = await readNativeWidgetGeometry(windowId);
    if (returned?.widgetPresent && compactViewportMatches(returned.viewport, geometry) && !returned.overflow) {
      const stable = Math.abs(geometry.content.width - state.widgetGeometry.content.width) <= 1
        && Math.abs(geometry.content.height - state.widgetGeometry.content.height) <= 1;
      if (!stable) throw failure('widget-roundtrip-size-changed');
      await publish('widget-roundtrip-complete', { widgetRoundtrip: { ...returned, geometry }, widgetGeometryStable: true });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, remaining(wholeDeadline, 250)));
  }
}

function installCloseLifecycleProbe(expectedPid, logPath) {
  if (process.pid !== expectedPid) throw new Error('close-probe-pid-mismatch');
  const fileSystem = process.mainModule.require('node:fs');
  const { app, BrowserWindow } = process.mainModule.require('electron');
  function record(eventName, event, exitCode) {
    try {
      let windowCount = null, activeResources = null;
      try { windowCount = BrowserWindow.getAllWindows().length; } catch {}
      try { activeResources = process.getActiveResourcesInfo(); } catch {}
      fileSystem.appendFileSync(logPath, JSON.stringify({
        utc: new Date().toISOString(), pid: process.pid, event: eventName,
        defaultPrevented: typeof event?.defaultPrevented === 'boolean' ? event.defaultPrevented : null,
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        windowCount, activeResources,
      }) + '\n', 'utf8');
      return true;
    } catch { return false; }
  }
  if (!record('probe-arming')) throw new Error('close-probe-receipt-unwritable');
  for (const name of ['window-all-closed', 'before-quit', 'will-quit', 'quit']) app.on(name, (event, exitCode) => record(name, event, exitCode));
  for (const window of BrowserWindow.getAllWindows()) {
    const windowId = window.id;
    window.on('close', event => record('window:' + windowId + ':close', event));
    window.on('closed', () => record('window:' + windowId + ':closed'));
  }
  process.on('exit', exitCode => record('process:exit', null, exitCode));
  return { armed: record('probe-armed'), pid: process.pid, logPath };
}

async function inspectScreens(windowId) {
  for (const [id, label] of [['dashboard', 'Обзор'], ['vpn', 'Соединение'], ['dns', 'DNS'], ['zapret', 'Профили'], ['telegram-proxy', 'Telegram'], ['settings', 'Настройки'], ['dashboard', 'Обзор']]) {
    await evaluate(rendererExpression(windowId, `(() => {
      const button = [...document.querySelectorAll('.ruby-sidebar nav button')].find(button => button.getAttribute('aria-label') === ${JSON.stringify(label)});
      if (!button) throw new Error('screen-navigation-missing'); button.click(); return true;
    })()`), wholeDeadline);
    await publish('waiting-for-screen', { pendingScreen: id });
    let result;
    while (true) {
      result = await evaluate(rendererExpression(windowId, `(() => {
        const stages = [...document.querySelectorAll('.screen-stage')];
        const stage = stages[0];
        const controlsPainted = !!stage && [...stage.querySelectorAll('button')].filter(button => button.getClientRects().length).every(button => {
          for (let element = button; element && stage.contains(element); element = element.parentElement) {
            const style = getComputedStyle(element);
            const opacity = Number(style.opacity);
            if (opacity <= 0 || style.visibility !== 'visible') return false;
            if ((element !== button || !button.disabled) && opacity < 0.99) return false;
          }
          return true;
        });
        const ready = stages.length === 1 && stage.dataset.screen === ${JSON.stringify(id)} && getComputedStyle(stage).opacity === '1' && controlsPainted;
        return { screen: ${JSON.stringify(id)}, ready, buttonCount: stage?.querySelectorAll('button').length ?? 0, textLength: stage?.innerText?.trim().length ?? 0, horizontalOverflow: !!stage && stage.scrollWidth > stage.clientWidth + 1, width: innerWidth, height: innerHeight };
      })()`), wholeDeadline);
      if (result?.ready) break;
      await new Promise(resolve => setTimeout(resolve, remaining(wholeDeadline, 250)));
    }
    if (result.horizontalOverflow || result.textLength < 30) throw failure('installed-screen-layout-invalid');
    const capturePath = `${outputPath}.${id}.png`;
    await evaluate(rendererExpression(windowId, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'), wholeDeadline);
    while (true) {
      const capture = await evaluate(windowExpression(windowId, `return w.webContents.capturePage().then(image => {
        const { width, height } = image.getSize(), pixels = image.toBitmap();
        let bodySamples = 0;
        for (let y = Math.max(120, Math.ceil(height * 0.18)); y < height - 20; y += 3) {
          for (let x = Math.ceil(width * 0.22); x < width - 20; x += 3) {
            const offset = (y * width + x) * 4;
            if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) >= 80) bodySamples++;
          }
        }
        if (bodySamples < 50) return { painted: false, bodySamples };
        process.mainModule.require('node:fs').writeFileSync(${JSON.stringify(capturePath)}, image.toPNG());
        return { painted: true, bodySamples };
      });`), wholeDeadline);
      if (capture.painted) { result.bodySamples = capture.bodySamples; break; }
      await new Promise(resolve => setTimeout(resolve, remaining(wholeDeadline, 250)));
    }
    if (!state.screens.some(screen => screen.screen === id)) state.screens.push({ ...result, capturePath });
    await publish('checking-screens');
  }
}

async function main() {
  if (process.argv.length !== 4 || !Number.isSafeInteger(expectedMainPid) || expectedMainPid <= 0 || !outputPath || !path.isAbsolute(outputPath)) {
    throw failure('usage-expected-main-pid-and-absolute-output-path');
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await publish('connecting');
  while (!socket || socket.readyState !== WebSocket.OPEN) {
    try { await connect(); }
    catch (error) {
      try { socket?.close(); } catch {}
      if (error.probeCode === 'inspector-endpoint-not-local') throw error;
      await new Promise(resolve => setTimeout(resolve, remaining(readinessDeadline, 2_000)));
    }
  }

  // Do not access Electron or its windows until the inspector's PID is confirmed.
  const actualMainPid = await evaluate('process.pid', readinessDeadline, 300_000);
  if (actualMainPid !== expectedMainPid) throw failure('main-pid-mismatch');
  await publish('waiting-for-window', { actualMainPid, pidVerified: true });
  let windowId;
  while (windowId === undefined) {
    const readiness = await evaluate(readinessExpression, readinessDeadline, 300_000);
    await publish('waiting-for-window', { readiness });
    if (readiness?.appReady && readiness.windowCount === 1 && Number.isSafeInteger(readiness.windowId)) {
      windowId = readiness.windowId;
    } else await new Promise(resolve => setTimeout(resolve, remaining(readinessDeadline, 2_000)));
  }
  await evaluate(windowExpression(windowId, 'if (w.isMinimized()) w.restore(); w.show(); w.focus(); return true;'), readinessDeadline, 300_000);
  await publish('waiting-for-dom', { windowId });
  while (true) {
    const dom = await evaluate(rendererExpression(windowId, domExpression), readinessDeadline, 300_000);
    const geometry = await readNativeWidgetGeometry(windowId);
    await publish('waiting-for-dom', { dom, widgetGeometry: geometry });
    if (dom?.readyState === 'complete' && dom.retiredWindowsControlAbsent !== true) throw failure('retired-windows-control-api-present');
    if (dom?.readyState === 'complete' && dom.visibility === 'visible' && dom.widgetPresent && dom.phase === 'idle' && dom.brandText.replace(/\s+/g, '') === 'egoist/lagom' && dom.mainActionText === 'Подключить защиту' && dom.mainActionEnabled && dom.dnsSwitchPresent && dom.settingsPresent && dom.windowButtonCount === 2 && dom.generatedIconCount > 5 && dom.widgetInViewport && dom.footerInViewport && !dom.horizontalOverflow && !dom.verticalOverflow && compactViewportMatches(dom.viewport, geometry)) {
      state.widgetGeometry = geometry;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, remaining(readinessDeadline, 2_000)));
  }
  const metricsBefore = await metrics(wholeDeadline);
  await publish('requesting-components', { metricsBefore });
  const componentDeadline = Math.min(wholeDeadline, performance.now() + 180_000);
  const components = [
    ['SystemDoH', 'system', 'systemDohStatus', ['available', 'running', 'verified', 'serviceInstalled', 'serviceRunning']],
    ['Zapret', 'zapret', 'status', ['available', 'serviceInstalled', 'serviceRunning', 'standaloneRunning']],
    ['TelegramProxy', 'telegramProxy', 'status', ['available', 'running', 'serviceInstalled', 'serviceRunning']],
  ];
  const responses = await Promise.all(components.map(async ([component, namespace, method, booleanFields]) => {
    const expression = `(async () => {
      const api = window.egoistAPI?.[${JSON.stringify(namespace)}];
      const operation = api?.[${JSON.stringify(method)}];
      if (typeof operation !== 'function') return { component: ${JSON.stringify(component)}, received: false, accepted: false, keys: [] };
      try {
        const value = await operation.call(api);
        const received = value !== null && typeof value === 'object' && !Array.isArray(value);
        const contractValid = received && ${JSON.stringify(booleanFields)}.every(key => typeof value[key] === 'boolean');
        const explicitFailure = received && (value.ok === false || value.success === false || !!value.error);
        const lastErrorPresent = received && !!value.lastError;
        // A stopped service is valid; System DoH's unavailable fallback means its query failed.
        const queryUnavailable = received && (value.serviceState === 'unavailable' || (value.nativeManaged === true && value.available === false && lastErrorPresent));
        return {
          component: ${JSON.stringify(component)}, received,
          accepted: contractValid && !explicitFailure && !queryUnavailable,
          keys: received ? Object.keys(value) : [],
          contractValid, explicitFailure, queryUnavailable, lastErrorPresent
        };
      } catch (error) { return { component: ${JSON.stringify(component)}, received: false, accepted: false, keys: [], error: String(error?.message || error).slice(0, 600) }; }
    })()`;
    const result = await evaluate(rendererExpression(windowId, expression), componentDeadline, 180_000);
    state.components.push(result);
    await publish('receiving-components');
    return result;
  }));
  await inspectWidgetAndDashboard(windowId);
  if (!responses.every(result => result?.received === true && result.accepted === true)) throw failure('component-response-not-accepted');
  const metricsAfter = await metrics(wholeDeadline);
  const lifecycleProbe = await evaluate(`(${installCloseLifecycleProbe.toString()})(${JSON.stringify(expectedMainPid)}, ${JSON.stringify(`${outputPath}.lifecycle.jsonl`)})`, wholeDeadline);
  if (!lifecycleProbe?.armed || lifecycleProbe.pid !== expectedMainPid) throw failure('close-probe-not-armed');
  await publish('complete', { ok: true, metricsAfter, lifecycleProbe });
}

const wholeTimer = setTimeout(() => {
  rejectPending('whole-deadline-exceeded');
  try { socket?.close(); } catch {}
}, 450_000);

main().then(async () => {
  clearTimeout(wholeTimer);
  rejectPending('probe-complete');
  try { socket?.close(); } catch {}
  process.exit(0);
}).catch(async error => {
  clearTimeout(wholeTimer);
  rejectPending('probe-failed');
  try { socket?.close(); } catch {}
  if (outputPath && path.isAbsolute(outputPath) && Number.isSafeInteger(expectedMainPid) && expectedMainPid > 0) {
    try { await publish('failed', { ok: false, error: error.probeCode || 'probe-operation-failed' }); } catch {}
  }
  process.stderr.write(`${error.probeCode || 'probe-operation-failed'}\n`);
  process.exit(1);
});
