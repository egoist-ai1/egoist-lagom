import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { loadRecovered } from './load-recovered.mjs';
import { pathToFileURL } from 'node:url';
const { ShieldConnectionController } = await import(process.env.LAGOM_SHIELD_CONTROLLER_TEST_SOURCE ? pathToFileURL(process.env.LAGOM_SHIELD_CONTROLLER_TEST_SOURCE).href : new URL('../src/shield-connection-controller.js', import.meta.url).href);

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ running = false, dns = false, telegram = false } = {}) {
  const state = { running, dns, telegram }, calls = [], events = [];
  const deps = {
    coordinate: async (_action, work) => work(),
    onProgress: value => events.push(value),
    zapret: {
      status: async () => ({ serviceRunning: state.running, standaloneRunning: false, runtimeReady: state.running, serviceProfile: 'kept-profile' }),
      autoSelectBestProfile: async () => { calls.push('select'); return { completed: true, bestProfile: 'selected-profile' }; },
      installService: async () => { calls.push('zapret-install'); return { ok: true }; },
      startService: async () => { calls.push('zapret-start'); state.running = true; return { ok: true }; },
      stopService: async () => { calls.push('zapret-stop'); state.running = false; return { ok: true }; },
      stopStandalone: async () => { calls.push('standalone-stop'); return { ok: true }; },
      cancelAutoSelect: async () => { calls.push('cancel'); }
    },
    dns: { status: async () => ({ running: state.dns, verified: state.dns, serviceRunning: state.dns, serviceState: state.dns ? 'running' : 'stopped' }) },
    telegramProxy: {
      status: async () => ({ running: state.telegram, serviceRunning: state.telegram, listenerReady: state.telegram, runtimeReady: state.telegram }),
      installService: async () => { calls.push('tg-install'); state.telegram = true; return { serviceRunning: true, runtimeReady: true, listenerReady: true }; },
      startService: async () => { calls.push('tg-start'); state.telegram = true; return { serviceRunning: true, runtimeReady: true, listenerReady: true }; },
      stopService: async () => { calls.push('tg-stop'); state.telegram = false; return { serviceRunning: false, running: false }; },
      openConnectionLink: async () => ({ ok: true })
    },
    applyDns: async () => { calls.push('dns-apply'); state.dns = true; return { ok: true }; },
    resetDns: async () => { calls.push('dns-reset'); state.dns = false; return { ok: true }; },
    saveConnected: async () => { calls.push('save'); }
  };
  return { controller: new ShieldConnectionController(deps), deps, state, calls, events };
}

for (const dnsEnabled of [false, true]) for (const telegramEnabled of [false, true]) {
  test(`manual lifecycle survives repeated connect/disconnect with DNS=${dnsEnabled}, TG=${telegramEnabled}`, async () => {
    const { controller, state, calls } = fixture();
    for (let cycle = 0; cycle < 12; cycle++) {
      const first = controller.connect({ dnsEnabled, telegramEnabled });
      assert.equal(controller.connect({ dnsEnabled, telegramEnabled }), first);
      assert.equal((await first).ok, true);
      const connected = await controller.status();
      assert.equal(connected.running, true);
      assert.equal(connected.dnsRunning, dnsEnabled);
      assert.equal(connected.telegramRunning, telegramEnabled);
      const stop = controller.disconnect();
      assert.equal(controller.disconnect(), stop);
      assert.equal((await stop).ok, true);
      assert.deepEqual(state, { running: false, dns: dnsEnabled, telegram: false });
      assert.equal(controller.pending, null);
      assert.equal(controller.state.busy, false);
      assert.equal((await controller.status()).running, false);
    }
    assert.equal(calls.filter(x => x === 'select').length, 12);
    assert.equal(calls.filter(x => x === 'dns-apply').length, dnsEnabled ? 1 : 0);
    assert.equal(calls.filter(x => x === 'tg-install').length, telegramEnabled ? 12 : 0);
  });
}

test('status started before disconnect cannot overwrite confirmed stopped components', async () => {
  const { controller, deps } = fixture({ running: true, dns: true, telegram: true });
  const reads = [deferred(), deferred(), deferred()];
  let first = [true, true, true];
  const originals = [deps.zapret.status, deps.dns.status, deps.telegramProxy.status];
  [deps.zapret, deps.dns, deps.telegramProxy].forEach((component, index) => {
    component.status = () => first[index] ? (first[index] = false, reads[index].promise) : originals[index]();
  });
  const stale = controller.status();
  await tick();
  assert.equal((await controller.disconnect()).ok, true);
  const confirmed = await controller.status();
  assert.equal(confirmed.running, false);
  reads[0].resolve({ serviceRunning: true, runtimeReady: true });
  reads[1].resolve({ running: true, verified: true, serviceRunning: true });
  reads[2].resolve({ serviceRunning: true, runtimeReady: true, listenerReady: true });
  const late = await stale;
  assert.equal(late.running, false, 'late reply must preserve the newer confirmed stop');
  assert.equal(late.dnsRunning, true, 'DNS remains independent of stopped addons');
  assert.equal(late.telegramRunning, false);
  deps.zapret.status = deps.dns.status = deps.telegramProxy.status = async () => { throw new Error('temporary Core read outage'); };
  const unavailable = await controller.status();
  assert.equal(unavailable.running, false, 'failed later probes must not expose stale pre-stop cache');
});

test('out-of-order status reads within the same action cannot replace newer live observation', async () => {
  const { controller, deps } = fixture();
  const old = deferred();
  let first = true;
  deps.zapret.status = async () => first ? (first = false, old.promise) : { serviceRunning: true, runtimeReady: true };
  const stale = controller.status();
  await tick();
  assert.equal((await controller.status()).running, true);
  old.resolve({ serviceRunning: false, standaloneRunning: false });
  assert.equal((await stale).running, true);
  deps.zapret.status = async () => { throw new Error('read outage'); };
  assert.equal((await controller.status()).running, true);
});

test('an empty successful component reply is unavailable rather than silently healthy', async () => {
  const { controller, deps } = fixture({ running: true, dns: true, telegram: true });
  assert.equal((await controller.status()).running, true);
  deps.zapret.status = deps.dns.status = deps.telegramProxy.status = async () => null;
  const unknown = await controller.status();
  assert.ok(unknown.statusError, 'all missing replies must make the UI observation unavailable');
});

test('explicitly unknown DNS ownership is unavailable rather than a confirmed disabled toggle', async () => {
  const { controller, deps } = fixture({ running: true });
  deps.dns.status = async () => ({ running: false, serviceRunning: false, verified: false, serviceState: 'unknown', healthState: 'unknown', ownerInspectionErrors: [{ code: 'OWNER_READ_FAILED', stage: 'sc-queryex' }] });
  assert.ok((await controller.status()).statusError);
});

test('cancel during settings persistence rolls back new addons, preserves DNS and never emits connected', async () => {
  const { controller, deps, state, events } = fixture();
  const save = deferred();
  let saving = false;
  deps.saveConnected = () => { saving = true; return save.promise; };
  const pending = controller.connect();
  while (!saving) await tick();
  assert.equal((await controller.cancel()).ok, true);
  save.resolve();
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal(result.ok, false);
  assert.equal(events.some(event => event.phase === 'connected'), false);
  assert.deepEqual(state, { running: false, dns: true, telegram: false });
});

test('cancel during addon preflight preserves established DNS and prevents strategy selection', async () => {
  const { controller, deps, calls } = fixture();
  const initial = deferred();
  let inspected = false;
  deps.zapret.status = () => { inspected = true; return initial.promise; };
  deps.dns.stopAndRemove = async () => { calls.push('dns-preparation'); return { ok: true }; };
  const pending = controller.connect();
  while (!inspected) await tick();
  await controller.cancel();
  initial.resolve({ serviceRunning: false, standaloneRunning: false });
  assert.equal((await pending).cancelled, true);
  assert.deepEqual(calls, ['dns-apply', 'cancel'], 'foundation setup survives cancellation; no restoration or addon startup follows');
});

const mainSource = () => fs.readFileSync(process.env.LAGOM_MAIN_TEST_SOURCE || 'src/recovered/electron/main.js', 'utf8');
const noLog = { info() {}, warn() {}, error() {} };
function extractMain(startMarker, endMarker) {
  const source = mainSource(), start = source.indexOf(startMarker), end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, 'production function extraction markers are present');
  return source.slice(start, end);
}

test('queued startup DNS recovery respects a later manual disable and keeps the saved endpoint', async () => {
  const wait = deferred(), entered = deferred(), calls = [];
  let settings = { systemDohEnabled: true, systemDohUrl: 'https://dns.example.test:8443/private-saved-path', systemDohLocalAddress: '127.0.0.1', systemDnsServers: '', autoConnect: false };
  const loadedState = { settings: { ...settings } };
  const context = vm.createContext({ Promise, logger: noLog, pendingBootRecovery: new Set(),
    globalStateStore: { get: () => ({ settings }) },
    globalSystemDohManager: { recover: async options => { calls.push(options); return { verified: true }; } }, globalGravitylessDnsManager: null,
    globalNetworkCombinatorManager: { runCoordinatedMutation: async (_intent, work) => { entered.resolve(); await wait.promise; return work(); } },
    isGravitylessLoopbackDnsRequest: () => false, restoreDnsIfLocalResolverIsDown: async () => false,
    scheduleAutoConnectWhenNetworkReady: () => {}, startDnsWatchdog() {} });
  vm.runInContext(extractMain('async function recoverBackgroundFeaturesAfterRendererLoad(', 'async function scheduleAutoConnectWhenNetworkReady('), context);
  const pending = context.recoverBackgroundFeaturesAfterRendererLoad(loadedState);
  await entered.promise;
  settings = { ...settings, systemDohEnabled: false, systemDohLocalAddress: '' };
  wait.resolve();
  await pending;
  assert.deepEqual(calls, [], 'a startup snapshot must not re-enable DNS after the user disabled it');
  assert.equal(settings.systemDohUrl, loadedState.settings.systemDohUrl);
});

test('boot auto-connect waiting for readiness is cancelled when its saved setting is turned off', async () => {
  const dnsReady = deferred(), sent = [];
  let settings = { autoConnect: true };
  const context = vm.createContext({ Date, Promise, setTimeout, clearTimeout, logger: noLog, isQuitting: false,
    globalStateStore: { get: () => ({ settings, activeNodeId: 'saved-node' }) },
    mainWindow: { isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } },
    testDnsImport: async () => ({ promises: { Resolver: class { resolve4() { return dnsReady.promise; } cancel() {} } } }) });
  const source = extractMain('async function scheduleAutoConnectWhenNetworkReady(', 'async function createMainWindow(').replace('await import("node:dns")', 'await testDnsImport()');
  vm.runInContext(source, context);
  const pending = context.scheduleAutoConnectWhenNetworkReady('saved-node');
  await tick();
  settings = { autoConnect: false };
  dnsReady.resolve(['192.0.2.1']);
  await pending;
  assert.deepEqual(sent, [], 'delayed startup event must not override a newer disabled setting');
});


test('cancellation rollback failure remains visible while the surviving component is reported truthfully', async () => {
  const { controller, deps, state } = fixture();
  const save = deferred();
  let saving = false;
  deps.saveConnected = () => { saving = true; return save.promise; };
  deps.zapret.stopService = async () => { throw new Error('owned addon stop blocked during cancellation'); };
  const pending = controller.connect();
  while (!saving) await tick();
  await controller.cancel(); save.resolve();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(controller.state.phase, 'error');
  assert.match(controller.state.error, /owned addon stop blocked/);
  assert.equal(state.running, true, 'surviving addon and independent DNS remain visible when addon rollback fails');
});

function scheduleFixture({ ready = deferred(), startupCallback = async () => ({ connected: true }) } = {}) {
  const calls = [], resolverOptions = [];
  const state = { settings: { autoConnect: true }, activeNodeId: 'saved-node' };
  const supervisor = { generation: 5 };
  const window = { isDestroyed: () => false, webContents: { send: () => assert.fail('startup must not send an unfenced renderer connect event') } };
  const context = vm.createContext({ Date, Promise, setTimeout, clearTimeout, logger: noLog, isQuitting: false,
    globalStateStore: { get: () => state }, reconnectSupervisor: supervisor, mainWindow: window,
    globalStartupAutoConnect: async (...args) => { calls.push(args); return startupCallback(...args); },
    testDnsImport: async () => ({ promises: { Resolver: class {
      constructor(options) { resolverOptions.push(options); }
      resolve4() { return ready.promise; }
      cancel() {}
    } } }) });
  vm.runInContext(extractMain('async function scheduleAutoConnectWhenNetworkReady(', 'async function createMainWindow(').replace('await import("node:dns")', 'await testDnsImport()'), context);
  return { context, state, supervisor, calls, ready, resolverOptions, window };
}

for (const change of ['manual-stop', 'new-node', 'preference-off', 'quit', 'window-retired']) {
  test(`delayed startup readiness respects ${change}`, async () => {
    const f = scheduleFixture();
    const pending = f.context.scheduleAutoConnectWhenNetworkReady('saved-node', 5);
    await tick();
    if (change === 'manual-stop') f.supervisor.generation++;
    if (change === 'new-node') f.state.activeNodeId = 'new-node';
    if (change === 'preference-off') f.state.settings.autoConnect = false;
    if (change === 'quit') f.context.isQuitting = true;
    if (change === 'window-retired') f.context.mainWindow = { isDestroyed: () => false };
    f.ready.resolve(['192.0.2.1']);
    await pending;
    assert.equal(f.resolverOptions.length, 1, 'the readiness probe was actually in flight');
    assert.deepEqual(f.calls, []);
  });
}

test('startup readiness invokes the internal callback once with the precise saved node and intent guard', async () => {
  const f = scheduleFixture();
  const pending = f.context.scheduleAutoConnectWhenNetworkReady('saved-node', 5);
  await tick(); f.ready.resolve(['192.0.2.1']); await pending;
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], 'saved-node');
  assert.equal(f.calls[0][1], 5);
  assert.equal(f.calls[0][2](), true);
  f.supervisor.generation++;
  assert.equal(f.calls[0][2](), false);
  assert.equal(f.resolverOptions[0].timeout, 3000);
  assert.equal(f.resolverOptions[0].tries, 1);
});

test('a hung readiness DNS probe has a bounded deadline and leaves no timers after the total startup budget', async () => {
  let now = 0, next = 0, probes = 0, cancelled = 0;
  const timers = new Map();
  const timerApi = {
    setTimeout(callback, delay) { const id = ++next; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const context = vm.createContext({ Promise, Date: { now: () => now }, ...timerApi, logger: noLog, isQuitting: false,
    globalStateStore: { get: () => ({ settings: { autoConnect: true }, activeNodeId: 'saved-node' }) }, reconnectSupervisor: { generation: 1 },
    mainWindow: { isDestroyed: () => false }, globalStartupAutoConnect: () => assert.fail('unavailable network must not connect'),
    testDnsImport: async () => ({ promises: { Resolver: class { resolve4() { probes++; return new Promise(() => {}); } cancel() { cancelled++; } } } }) });
  vm.runInContext(extractMain('async function scheduleAutoConnectWhenNetworkReady(', 'async function createMainWindow(').replace('await import("node:dns")', 'await testDnsImport()'), context);
  let complete = false;
  const pending = context.scheduleAutoConnectWhenNetworkReady('saved-node', 1).then(() => { complete = true; });
  for (let safety = 0; !complete && safety < 100; safety++) {
    await tick();
    const nextTimer = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    if (!nextTimer) continue;
    now = nextTimer[1].at; timers.delete(nextTimer[0]); nextTimer[1].callback();
  }
  await pending;
  assert.equal(complete, true);
  assert.ok(probes >= 2 && probes <= 20, `bounded probes: ${probes}`);
  assert.ok(now <= 180000, `bounded elapsed time: ${now}`);
  assert.ok(cancelled >= probes);
  assert.equal(timers.size, 0);
});

function vpnHandlerFixture() {
  const calls = [], pendingSlots = [], handlers = new Map();
  const state = { settings: { autoConnect: true, reconnectOnDrop: true, notifications: false, zapretSuspendDuringVpn: false }, activeNodeId: 'saved-node',
    nodes: [{ id: 'saved-node', name: 'Saved node', protocol: 'vless' }], domainRules: [], processRules: [] };
  let connected = false, startup, service = { serviceInstalled: true, serviceState: 'stopped', startType: 'disabled', backgroundEnabled: false, running: false, serviceRunning: false, localHealth: 'unresponsive', activeNodeId: 'saved-node' };
  const runtime = {
    backgroundModeActive: false,
    status: async () => ({ connected, running: connected, activeNodeId: connected ? 'saved-node' : null, egressVerified: connected, processGeneration: 1, lifecycle: connected ? 'connected' : 'idle', diagnostic: { reason: null } }),
    connect: async node => { calls.push('runtime-connect'); connected = true; return { connected: true, activeNodeId: node.id, egressVerified: false, processGeneration: 1, lifecycle: 'connected', diagnostic: { reason: null } }; },
    markEgressVerified: async (ip, generation) => { calls.push('egress-verified'); return { connected: true, egressVerified: true, activeNodeId: 'saved-node', processGeneration: generation, egressIp: ip, lifecycle: 'connected', diagnostic: { reason: null } }; },
    disconnect: async () => { calls.push('runtime-disconnect'); connected = false; return { connected: false, lifecycle: 'idle', diagnostic: { reason: null } }; },
    shutdownApplicationRuntime: async () => { calls.push('runtime-shutdown'); connected = false; },
    backgroundService: { status: async () => ({ ...service }),
      installService: async () => { service = { ...service, serviceInstalled: true, serviceState: 'running', startType: 'automatic', backgroundEnabled: true, running: true, serviceRunning: true, localHealth: 'responsive' }; },
      startService: async () => { service = { ...service, serviceState: 'running', startType: 'automatic', backgroundEnabled: true, running: true, serviceRunning: true, localHealth: 'responsive' }; },
      stopService: async () => { service = { ...service, serviceState: 'stopped', startType: 'disabled', backgroundEnabled: false, running: false, serviceRunning: false, localHealth: 'unresponsive' }; },
      removeService: async () => { service = { ...service, serviceInstalled: false, serviceState: 'not-installed', backgroundEnabled: false, running: false, serviceRunning: false, localHealth: 'unresponsive' }; } }
  };
  const scheduler = { now: () => 0, setTimeout: () => ({}), clearTimeout() {}, setInterval: () => ({}), clearInterval() {} };
  const { VpnReconnectSupervisor, classifyReconnectFailure } = loadRecovered('electron/ipc/vpn-reconnect-supervisor', {}, ['VpnReconnectSupervisor', 'classifyReconnectFailure']);
  const app = new EventEmitter(); app.isPackaged = false;
  const context = vm.createContext({ Promise, Date, Buffer, URL, AbortController, performance, process: { env: { EGOISTSHIELD_MOCK_RUNTIME: '1', NODE_ENV: 'test' } },
    app, classifyReconnectFailure, logger: { ...noLog, debug() {} }, Notification: { isSupported: () => false },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, updateTrayMenu: active => calls.push(`tray:${active}`),
    formatRuntimeLogEvent: () => '', isObservedBackgroundVpnStatus: () => true, validateBackgroundVpnSnapshot() {},
    VpnReconnectSupervisor: class extends VpnReconnectSupervisor { constructor(options) { super({ ...options, scheduler }); } },
    ctx: { stateStore: { get: () => state, patch: async patch => Object.assign(state, patch) }, runtimeManager: runtime, zapretManager: {}, window: null,
      onStartupAutoConnectReady: callback => { startup = callback; },
      networkCombinatorManager: { runCoordinatedMutation: (intent, work) => { const result = deferred(); pendingSlots.push({ intent, work, result }); return result.promise; } } }
  });
  vm.runInContext(fs.readFileSync(process.env.LAGOM_VPN_HANDLERS_TEST_SOURCE || 'src/recovered/electron/ipc/handlers-vpn.js', 'utf8') + '\nregisterVpnHandlers(ctx);', context);
  return { context, state, calls, handlers, startup: (...args) => startup(...args), pendingSlots,
    release: async index => { const slot = pendingSlots[index]; try { slot.result.resolve(await slot.work()); } catch (error) { slot.result.reject(error); } },
    dispose: () => app.emit('before-quit') };
}

for (const manual of ['disconnect', 'connect', 'service-install', 'service-start', 'service-stop', 'service-remove']) {
  test(`a queued manual ${manual} fences a startup request before its first side effect`, async () => {
    const f = vpnHandlerFixture();
    try {
      const generation = f.context.reconnectSupervisor.generation;
      const auto = f.startup('saved-node', generation, () => true);
      assert.equal(f.pendingSlots.length, 1);
      const manualArgs = manual === 'connect' || manual === 'service-install' ? ['saved-node'] : [];
      const action = f.handlers.get(`vpn:${manual}`)(null, ...manualArgs);
      assert.equal(f.pendingSlots.length, 2);
      assert.ok(f.context.reconnectSupervisor.generation > generation, 'manual intent is recorded before waiting for route ownership');
      await f.release(0);
      assert.equal((await auto).cancelled, true);
      assert.deepEqual(f.calls, [], 'stale startup request must not suspend, start, notify, or change the route');
      await f.release(1);
      await action;
    } finally { f.dispose(); }
  });
}

test('valid startup uses the actual VPN handler, verifies egress, updates the tray and arms the existing retry supervisor', async () => {
  const f = vpnHandlerFixture();
  try {
    const generation = f.context.reconnectSupervisor.generation;
    const pending = f.startup('saved-node', generation, () => true);
    await f.release(0);
    const result = await pending;
    assert.equal(result.connected, true);
    assert.equal(result.egressVerified, true);
    assert.deepEqual(f.calls, ['runtime-connect', 'egress-verified', 'tray:true']);
    assert.equal(f.context.reconnectSupervisor.snapshot().armed, true);
  } finally { f.dispose(); }
});

test('unsuccessful startup remains unverified and does not arm recovery as a healthy connection', async () => {
  const f = vpnHandlerFixture();
  f.context.ctx.runtimeManager.connect = async () => { f.calls.push('runtime-connect'); return { connected: false, lastError: 'controlled offline fixture', lifecycle: 'failed', diagnostic: { reason: 'server_unreachable' } }; };
  try {
    const pending = f.startup('saved-node', f.context.reconnectSupervisor.generation, () => true);
    await f.release(0);
    const result = await pending;
    assert.equal(result.connected, false);
    assert.equal(f.calls.includes('egress-verified'), false);
    assert.equal(f.context.reconnectSupervisor.snapshot().armed, false);
  } finally { f.dispose(); }
});


function retryScheduleFixture(callback) {
  let now = 0, next = 0;
  const timers = new Map(), supervisor = { generation: 3 };
  const state = { settings: { autoConnect: true }, activeNodeId: 'saved-node' };
  const context = vm.createContext({ Promise, Date: { now: () => now }, logger: noLog, isQuitting: false,
    setTimeout: (callback, delay) => { const id = ++next; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id), reconnectSupervisor: supervisor, globalStateStore: { get: () => state },
    mainWindow: { isDestroyed: () => false }, globalStartupAutoConnect: callback,
    testDnsImport: async () => ({ promises: { Resolver: class { resolve4() { return Promise.resolve(['192.0.2.1']); } cancel() {} } } }) });
  vm.runInContext(extractMain('async function scheduleAutoConnectWhenNetworkReady(', 'async function createMainWindow(').replace('await import("node:dns")', 'await testDnsImport()'), context);
  const advance = async () => { await tick(); const timer = [...timers].sort((a,b) => a[1].at-b[1].at)[0]; if (timer) { now = timer[1].at; timers.delete(timer[0]); timer[1].callback(); } await tick(); };
  return { context, supervisor, state, timers, advance, now: () => now };
}

test('transient startup connect failure retries with backoff and then succeeds within the same intent', async () => {
  let attempts = 0;
  const f = retryScheduleFixture(async () => ++attempts === 1 ? { connected: false, startupRetryable: true, startupFailureClass: 'network' } : { connected: true, egressVerified: true });
  const pending = f.context.scheduleAutoConnectWhenNetworkReady('saved-node', 3);
  await f.advance(); await f.advance(); await pending;
  assert.equal(attempts, 2);
  assert.ok(f.now() >= 1000);
  assert.equal(f.timers.size, 0);
});

test('startup authentication/configuration failures stop after one attempt', async () => {
  for (const failureClass of ['auth','config']) {
    let attempts = 0;
    const f = retryScheduleFixture(async () => { attempts++; return { connected: false, startupRetryable: false, startupFailureClass: failureClass }; });
    await f.context.scheduleAutoConnectWhenNetworkReady('saved-node', 3);
    assert.equal(attempts, 1);
    assert.equal(f.timers.size, 0);
  }
});

test('manual stop during startup backoff prevents the next connection attempt', async () => {
  let attempts = 0;
  const f = retryScheduleFixture(async () => { attempts++; return { connected: false, startupRetryable: true, startupFailureClass: 'network' }; });
  const pending = f.context.scheduleAutoConnectWhenNetworkReady('saved-node', 3);
  await tick();
  assert.equal(attempts, 1);
  assert.equal(f.timers.size, 1, 'one bounded retry timer waits for the next attempt');
  f.supervisor.generation++;
  await f.advance(); await pending;
  assert.equal(attempts, 1);
  assert.equal(f.timers.size, 0);
});

test('manual stop remains paused during its queued slot and stale startup completion cannot release it', async () => {
  const f = vpnHandlerFixture();
  try {
    f.context.ctx.runtimeManager.status = async () => ({ connected: true, egressVerified: true, running: true, diagnostic: { reason: null } });
    const generation = f.context.reconnectSupervisor.generation;
    const auto = f.startup('saved-node', generation, () => true);
    const stopped = f.handlers.get('vpn:disconnect')();
    assert.equal(f.context.reconnectSupervisor.attemptInFlight, true);
    await f.context.reconnectSupervisor.checkNow();
    assert.equal(f.context.reconnectSupervisor.snapshot().armed, false);
    await f.release(0); assert.equal((await auto).cancelled, true);
    assert.equal(f.context.reconnectSupervisor.attemptInFlight, true, 'old startup finally cannot release the newer manual guard');
    await f.release(1); await stopped;
    assert.equal(f.context.reconnectSupervisor.snapshot().armed, false);
    assert.equal(f.context.reconnectSupervisor.attemptInFlight, false);
  } finally { f.dispose(); }
});


for (const [reason, message, expectedClass, retryable] of [
  ['server_unreachable', 'ECONNREFUSED controlled startup route failure', 'network', true],
  ['auth_failed', 'HTTP 403 authentication failure', 'auth', false],
  ['invalid_config', 'invalid configuration controlled fixture', 'config', false]
]) {
  test(`actual startup result classification ${expectedClass} controls retry eligibility`, async () => {
    const f = vpnHandlerFixture();
    f.context.ctx.runtimeManager.connect = async () => ({ connected: false, lastError: message, lifecycle: 'failed', diagnostic: { reason } });
    try {
      const pending = f.startup('saved-node', f.context.reconnectSupervisor.generation, () => true);
      await f.release(0);
      const result = await pending;
      assert.equal(result.startupFailureClass, expectedClass);
      assert.equal(result.startupRetryable, retryable);
      assert.equal(f.context.reconnectSupervisor.attemptInFlight, false);
    } finally { f.dispose(); }
  });
}

test('startup attempts never overlap while one actual callback is still pending', async () => {
  const first = deferred();
  let attempts = 0, active = 0, maximum = 0;
  const f = retryScheduleFixture(async () => {
    active++; maximum = Math.max(maximum, active); attempts++;
    try { return attempts === 1 ? await first.promise : { connected: true, egressVerified: true }; }
    finally { active--; }
  });
  const pending = f.context.scheduleAutoConnectWhenNetworkReady('saved-node', 3);
  await tick(); await f.advance();
  assert.equal(attempts, 1);
  assert.equal(f.timers.size, 0);
  first.resolve({ connected: false, startupRetryable: true, startupFailureClass: 'runtime' });
  await f.advance(); await pending;
  assert.equal(attempts, 2);
  assert.equal(maximum, 1);
  assert.equal(f.timers.size, 0);
});

test('startup queued beyond its total wait budget never starts a network mutation', async () => {
  const wait = deferred();
  const f = retryScheduleFixture(async (_node, _generation, current) => { await wait.promise; return current() ? assert.fail('expired startup intent cannot execute') : { cancelled: true, connected: false }; });
  const pending = f.context.scheduleAutoConnectWhenNetworkReady('saved-node', 3);
  await tick();
  // Advance the dependency-injected wall clock without releasing the queued work.
  vm.runInContext('Date.now = () => 180001;', f.context);
  wait.resolve(); await pending;
  assert.equal(f.timers.size, 0);
});

test('manual stop while startup suspends DPI prevents the next runtime-start side effect', async () => {
  const f = vpnHandlerFixture(), preparation = deferred(), entered = deferred();
  f.context.IS_TEST_MOCK_RUNTIME = false;
  f.context.ctx.zapretManager.prepareForVpn = async () => { entered.resolve(); await preparation.promise; };
  try {
    const startup = f.startup('saved-node', f.context.reconnectSupervisor.generation, () => true);
    const release = f.release(0); await entered.promise;
    const stopped = f.handlers.get('vpn:disconnect')();
    preparation.resolve(); await release;
    assert.equal((await startup).cancelled, true);
    assert.deepEqual(f.calls, []);
    await f.release(1); await stopped;
    assert.equal(f.calls.includes('runtime-connect'), false);
  } finally { f.dispose(); }
});


test('an older queued manual connect cannot start after a newer stop already completed', async () => {
  const f = vpnHandlerFixture();
  try {
    const connecting = f.handlers.get('vpn:connect')(null, 'saved-node');
    const stopped = f.handlers.get('vpn:disconnect')();
    await f.release(1); await stopped;
    const callsAfterStop = [...f.calls];
    await f.release(0);
    const stale = await connecting;
    assert.equal(stale.cancelled, true);
    assert.deepEqual(f.calls, callsAfterStop, 'older connect must not change the completed stop');
    assert.equal(f.context.reconnectSupervisor.snapshot().armed, false);
  } finally { f.dispose(); }
});

test('an older queued manual stop cannot tear down a newer verified manual connection', async () => {
  const f = vpnHandlerFixture();
  try {
    const stopping = f.handlers.get('vpn:disconnect')();
    const connected = f.handlers.get('vpn:connect')(null, 'saved-node');
    await f.release(1); assert.equal((await connected).egressVerified, true);
    const callsAfterConnect = [...f.calls];
    await f.release(0);
    const stale = await stopping;
    assert.equal(stale.cancelled, true);
    assert.deepEqual(f.calls, callsAfterConnect);
    assert.equal(f.context.reconnectSupervisor.snapshot().armed, true);
  } finally { f.dispose(); }
});
