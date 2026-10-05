import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { isIP } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { loadRecovered, sourceFor } from './load-recovered.mjs';

const logger = { info() {}, warn() {}, debug() {}, error() {} };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function safeApi() {
  return loadRecovered('electron/ipc/safe-network', { fetch, AbortController, Error }, ['fetchWithRetry', 'fetchTextWithRetry']);
}
function routeApi() {
  return loadRecovered('electron/ipc/route-probe', { isIP }, ['extractRouteProbeIp']);
}
function vpnApi(extra = {}) {
  return loadRecovered('electron/ipc/handlers-vpn', {
    process: { env: {} }, logger, extractRouteProbeIp: routeApi().extractRouteProbeIp,
    isFirstSuccessfulCancellation: () => false, readResponseTextWithLimit: loadRecovered('electron/ipc/safe-network', {}, ['readResponseTextWithLimit']).readResponseTextWithLimit,
    ...extra,
  }, ['fetchRouteProbeIp', 'resolveHostDoh', 'normalizeVpnHost', 'registerVpnHandlers']);
}
async function stalledServer(t) {
  const sockets = new Set();
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.flushHeaders();
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); };
  t.after(close);
  return { endpoint: `http://127.0.0.1:${server.address().port}/stalled-body`, sockets };
}

test('route IP probe bounds a real stalled HTTP body, not just its headers', async t => {
  const { endpoint, sockets } = await stalledServer(t);
  const api = safeApi();
  let settled = false;
  const probe = vpnApi().fetchRouteProbeIp('test', consume => api.fetchWithRetry(endpoint, {
    timeoutMs: 40, retries: 0,
  }, consume).then(result => consume ? result : result.response)).then(value => { settled = true; return value; });
  await wait(220);
  const bounded = settled;
  for (const socket of sockets) socket.destroy();
  await probe;
  assert.equal(bounded, true, 'headers must not cancel the body timeout');
});

test('route IP probe limits its response body before parsing', async () => {
  let cancelled = false;
  const text = ' '.repeat(128 * 1024) + 'ip=203.0.113.1';
  const body = new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(text)); }, cancel() { cancelled = true; } });
  const result = await vpnApi().fetchRouteProbeIp('test', consume => safeApi().fetchWithRetry('https://fixture.invalid', {
    timeoutMs: 100, retries: 0, fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/plain' } }),
  }, consume));
  assert.equal(result, null);
  assert.equal(cancelled, true);
});

test('route IP extraction rejects invalid addresses and explicit provider failure', () => {
  const { extractRouteProbeIp } = routeApi();
  for (const input of [{ ip: 'not-an-ip' }, { ip: '999.999.999.999' }, 'ip=999.999.999.999\n', { ip: '203.0.113.1', success: false }]) assert.equal(extractRouteProbeIp(input), null);
  assert.equal(extractRouteProbeIp('fl=1\nip=203.0.113.1\nhttp=h2\n'), '203.0.113.1');
  assert.equal(extractRouteProbeIp({ ip: '2001:db8::1' }), '2001:db8::1');
});

test('coordinator rejection completes manual reconnect supervisor state', async t => {
  const Actual = loadRecovered('electron/ipc/vpn-reconnect-supervisor', {}, ['VpnReconnectSupervisor']).VpnReconnectSupervisor;
  let supervisor;
  class TrackedSupervisor extends Actual { constructor(options) { super(options); supervisor = this; } }
  const handlers = new Map();
  const app = new EventEmitter();
  t.after(() => app.emit('before-quit'));
  vpnApi({ process: { env: { EGOISTSHIELD_MOCK_RUNTIME: '1', NODE_ENV: 'test' } }, app,
    ipcMain: { handle(name, handler) { handlers.set(name, handler); } }, VpnReconnectSupervisor: TrackedSupervisor,
  }).registerVpnHandlers({ stateStore: { get: () => ({ settings: { reconnectOnDrop: true } }) },
    runtimeManager: { status: async () => ({ connected: false, egressVerified: false }) },
    networkCombinatorManager: { runCoordinatedMutation: async () => { throw new Error('Fixture mutation timeout'); } },
  });
  await assert.rejects(handlers.get('vpn:connect')(null, 'fixture'), /Fixture mutation timeout/);
  assert.equal(supervisor.snapshot().phase, 'idle');
  assert.equal(supervisor.attemptInFlight, false);
  assert.match(supervisor.snapshot().lastReason, /Fixture mutation timeout/);
});

test('late manual connect result cannot rearm a cancelled reconnect generation', () => {
  const { VpnReconnectSupervisor } = loadRecovered('electron/ipc/vpn-reconnect-supervisor', {}, ['VpnReconnectSupervisor']);
  const supervisor = new VpnReconnectSupervisor({ readEnabled: () => true });
  const generation = supervisor.beginManualConnect();
  supervisor.cancel();
  supervisor.recordConnectionResult({ connected: true, egressVerified: true }, generation);
  assert.equal(supervisor.snapshot().armed, false);
  assert.equal(supervisor.snapshot().phase, 'idle');
});

test('caller cancellation interrupts Retry-After wait without another fetch', async t => {
  const caller = new AbortController();
  const timers = new Map();
  const listeners = new Set();
  const removed = new Set();
  let now = 0;
  let timerCount = 0;
  let backoffEntered = false;
  let requests = 0;
  let outcome;
  const signal = {
    get aborted() { return caller.signal.aborted; },
    get reason() { return caller.signal.reason; },
    addEventListener(type, listener, options) {
      assert.equal(type, 'abort');
      listeners.add(listener);
      caller.signal.addEventListener(type, listener, options);
      if (listeners.size === 2) backoffEntered = true;
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'abort');
      listeners.delete(listener);
      removed.add(listener);
      caller.signal.removeEventListener(type, listener);
    },
  };
  t.after(() => {
    for (const listener of listeners) caller.signal.removeEventListener('abort', listener);
    timers.clear();
  });
  class ClockDate extends Date { static now() { return now; } }
  const context = vm.createContext({
    AbortController, Error, Date: ClockDate, URL, Buffer, TextDecoder,
    fetch() { throw new Error('Unexpected fixture network access'); },
    setTimeout(callback, ms) {
      const timer = { callback, ms, due: now + ms, ordinal: ++timerCount };
      timers.set(timer, timer);
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
  });
  // loadRecovered's global timer defaults override bindings, so this one case
  // supplies its scheduler directly to the VM running the actual selected source.
  vm.runInContext(sourceFor('electron/ipc/safe-network') + '\n;globalThis.api = { fetchWithRetry };', context);
  context.api.fetchWithRetry('https://fixture.invalid', {
    timeoutMs: 1000, retries: 2, signal,
    fetchImpl: async (_url, { signal: requestSignal }) => {
      requests++;
      if (requestSignal.aborted) throw requestSignal.reason;
      return new Response(null, { status: 503, headers: { 'retry-after': '1' } });
    },
  }).then(value => { outcome = { value }; }, error => { outcome = { error }; });
  for (let turn = 0; turn < 32 && !backoffEntered && !outcome; turn++) await Promise.resolve();
  assert.equal(backoffEntered, true, 'must reach Retry-After backoff before aborting');
  assert.equal(outcome, undefined);
  assert.equal(requests, 1);
  assert.equal(caller.signal.aborted, false);
  assert.equal(timerCount, 3, 'two attempt deadlines plus the retry delay');
  const retryTimer = [...timers.values()].find(timer => timer.ordinal === 3);
  assert.equal(retryTimer?.ms, 1000);
  assert.equal(retryTimer?.due, 1000);
  // Simulate a pre-abort scheduling delay beyond the old 500 ms wall assertion,
  // while the one-second retry is still pending and no timer has fired.
  now = 750;
  caller.abort();
  for (let turn = 0; turn < 32 && !outcome; turn++) await Promise.resolve();
  assert.ok(outcome, 'caller cancellation must settle without firing the retry timer');
  assert.equal(outcome.error?.name, 'AbortError');
  assert.equal(requests, 1);
  assert.equal(timers.size, 0, 'all attempt and backoff timers must be cleared');
  assert.equal(listeners.size, 0, 'all caller abort listeners must be removed');
  assert.equal(removed.size, 2, 'both attempt and backoff listeners must be released');
  now = 2000;
  for (const timer of [...timers.values()]) if (timer.due <= now) timer.callback();
  for (let turn = 0; turn < 4; turn++) await Promise.resolve();
  assert.equal(requests, 1, 'the expired retry deadline cannot start another fetch');
});

test('HTTP retry allowlist is respected while default temporary-status retries remain', async () => {
  for (const [options, expected] of [[{ retryOnStatuses: [] }, 1], [{ retryOnStatuses: [429] }, 1], [{}, 2]]) {
    let requests = 0;
    await assert.rejects(safeApi().fetchWithRetry('https://fixture.invalid', {
      retries: 1, retryBaseDelayMs: 0, ...options,
      fetchImpl: async () => { requests++; return new Response(null, { status: 503 }); },
    }));
    assert.equal(requests, expected);
  }
});

test('state sanitization preserves exact subscription endpoint, URI, and SNI', () => {
  const { sanitizeState } = loadRecovered('electron/ipc/state-store', {
    normalizePersistedDisplayText: value => value, normalizeCustomDnsUrl: value => value,
    normalizeSystemDohUrl: value => value, normalizeSystemDohLocalAddress: value => value,
  }, ['sanitizeState']);
  const node = { id: 'node', server: 'edge.cloudpath.live', uri: 'vless://fixture@edge.cloudpath.live:443?security=tls&sni=front.cloudpath.live', metadata: { sni: 'front.cloudpath.live' } };
  const output = sanitizeState({ settings: { privacyConsentVersion: 1 }, nodes: [node] });
  assert.equal(output.nodes[0].server, node.server);
  assert.equal(output.nodes[0].uri, node.uri);
  assert.equal(output.nodes[0].metadata.sni, node.metadata.sni);
});

test('Xray, sing-box and ping use exactly the configured server and TLS SNI', () => {
  const { ConfigBuilder } = loadRecovered('electron/ipc/config-builder', {}, ['ConfigBuilder']);
  const node = { protocol: 'vless', server: 'edge.cloudpath.live', port: 443, metadata: { id: '11111111-1111-4111-8111-111111111111', security: 'tls', sni: 'front.cloudpath.live' } };
  const settings = { dnsMode: 'system', routeMode: 'global', useTunMode: false };
  const xray = JSON.parse(ConfigBuilder.buildXray(node, [], settings, 10809, 10808, 10085)).outbounds[0];
  const sing = JSON.parse(ConfigBuilder.buildSingBox(node, [], [], settings, 10809)).outbounds[0];
  assert.equal(xray.settings.vnext[0].address, node.server);
  assert.equal(xray.streamSettings.tlsSettings.serverName, node.metadata.sni);
  assert.equal(sing.server, node.server);
  assert.equal(sing.tls.server_name, node.metadata.sni);
  assert.equal(vpnApi().normalizeVpnHost(node.server), node.server);
});

function gravitylessApi(exec) {
  return loadRecovered('electron/ipc/gravityless-dns-manager', {
    promisify: fn => fn, execFile: exec, path, process: { platform: 'win32' },
    resolveGravitylessDnsPaths: () => ({ installDir: '/fixture' }), resolveWindowsExecutable: name => name,
    GRAVITYLESS_DNS_SERVICE_NAME: 'FixtureService', normalizeCimServiceState: value => value,
  }, ['GravitylessDnsManager']).GravitylessDnsManager;
}
test('SCM/CIM observation failure remains unknown instead of claiming no installed DNS service', async () => {
  const Manager = gravitylessApi(async () => { throw new Error('CIM unavailable fixture'); });
  const manager = new Manager('/fixture');
  assert.equal((await manager.queryServiceViaCim()).state, 'unknown');
});
test('DNS status read started before invalidation cannot repopulate current cache', async () => {
  const Manager = gravitylessApi(() => {});
  const manager = new Manager('/fixture');
  let finishOld;
  manager.readStatus = () => new Promise(resolve => { finishOld = resolve; });
  const old = manager.status();
  manager.invalidateStatusCache();
  manager.readStatus = async () => ({ verified: true, running: true });
  await manager.status({ force: true });
  finishOld({ verified: false, running: false });
  await old;
  assert.equal((await manager.status()).verified, true);
});
test('a newer forced DNS status observation wins over an older still-pending read', async () => {
  const Manager = gravitylessApi(() => {});
  const manager = new Manager('/fixture');
  let finishOld;
  manager.readStatus = () => new Promise(resolve => { finishOld = resolve; });
  const old = manager.status({ force: true });
  manager.readStatus = async () => ({ verified: true, running: true });
  await manager.status({ force: true });
  finishOld({ verified: false, running: false });
  await old;
  assert.equal((await manager.status()).verified, true);
});
test('the real PowerShell CIM script distinguishes an empty result from an access failure', { skip: process.platform !== 'win32' }, async () => {
  for (const throws of [false, true]) {
    const Manager = gravitylessApi(async (_exe, args) => {
      const script = `function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) ${throws ? "Write-Error 'CIM access denied fixture'; return $null" : 'return $null'} }\n${args.at(-1)}`;
      const result = spawnSync(`${process.env.SystemRoot || 'C:/Windows'}/System32/WindowsPowerShell/v1.0/powershell.exe`, [
        '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
      ], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
      if (result.status !== 0) throw new Error('Fixture CIM failed');
      return { stdout: result.stdout };
    });
    const status = await new Manager('/fixture').queryServiceViaCim();
    assert.equal(status.state, throws ? 'unknown' : 'not-installed');
  }
});
test('network inspection reports its real supplied product version', async () => {
  const { buildNetworkCombinatorInspection } = loadRecovered('shared/dns-controller', {}, ['buildNetworkCombinatorInspection']);
  const { NetworkCombinatorManager } = loadRecovered('electron/ipc/network-combinator-manager', { buildNetworkCombinatorInspection }, ['NetworkCombinatorManager']);
  const manager = new NetworkCombinatorManager({ isElevated: async () => false, getProductVersion: () => '8.2.1-fixture' });
  assert.equal((await manager.inspect()).productVersion, '8.2.1-fixture');
});
test('ping DoH fallback also bounds a stalled body after HTTP headers', async t => {
  const { endpoint, sockets } = await stalledServer(t);
  const { fetchTextWithRetry } = safeApi();
  const api = vpnApi({ AbortController, isIP,
    fetch: (_url, options) => fetch(endpoint, options),
    fetchTextWithRetry: (_url, options) => fetchTextWithRetry(endpoint, { ...options, timeoutMs: 40 }),
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 40)),
  });
  let settled = false;
  const request = api.resolveHostDoh('fixture.invalid').then(value => { settled = true; return value; });
  await wait(220);
  const bounded = settled;
  for (const socket of sockets) socket.destroy();
  await request;
  assert.equal(bounded, true);
});

class FixtureSocket extends EventEmitter {
  destroyed = false;
  setTimeout() {}
  write() {}
  end() {}
  destroy() { this.destroyed = true; }
}
test('speed test cancellation interrupts its pending latency, download and upload sockets', async () => {
  for (const method of ['measureRouteLatency', 'measureDownloadEndpoint', 'measureUploadEndpoint']) {
    const sockets = [];
    const { [method]: measure } = loadRecovered('electron/ipc/handlers-vpn', {
      process: { env: {} }, app: { getVersion: () => '3.8.0-fixture' },
      tls: { connect(_options, ready) { const socket = new FixtureSocket(); sockets.push(socket); queueMicrotask(ready); return socket; } },
      performance,
    }, [method]);
    const caller = new AbortController();
    const pending = (method === 'measureDownloadEndpoint'
      ? measure({ name: 'Fixture', host: 'fixture.invalid', path: '/', bytes: 4096 }, null, 0, caller.signal)
      : measure({ name: 'Fixture', host: 'fixture.invalid', path: '/', bytes: 4096 }, null, caller.signal)
    ).then(() => 'fulfilled', error => error.name);
    await wait(10);
    caller.abort();
    await wait(10);
    const destroyedAtCancel = sockets[0].destroyed;
    if (!destroyedAtCancel) sockets[0].emit('error', new Error('Fixture cleanup'));
    const name = await pending;
    assert.equal(destroyedAtCancel, true, `${method} retained its active socket after cancellation`);
    assert.equal(name, 'SpeedtestCancelledError');
  }
});

test('speed test cancellation also closes its pending proxy CONNECT request', async () => {
  let request;
  const { openRouteProbeTls } = loadRecovered('electron/ipc/handlers-vpn', {
    process: { env: {} }, http: { request() { request = new FixtureSocket(); return request; } },
  }, ['openRouteProbeTls']);
  const caller = new AbortController();
  const pending = openRouteProbeTls({ name: 'Fixture', host: 'fixture.invalid' }, 10809, 5000, caller.signal).catch(error => error.name);
  caller.abort();
  await wait(10);
  const destroyedAtCancel = request.destroyed;
  if (!destroyedAtCancel) request.emit('error', new Error('Fixture cleanup'));
  assert.equal(await pending, 'SpeedtestCancelledError');
  assert.equal(destroyedAtCancel, true);
});

test('the registered cancel IPC closes only speed-test sockets and allows a fresh subsequent measurement', async t => {
  const Actual = loadRecovered('electron/ipc/vpn-reconnect-supervisor', {}, ['VpnReconnectSupervisor']).VpnReconnectSupervisor;
  const handlers = new Map();
  const app = new EventEmitter();
  app.getVersion = () => '3.8.0-fixture';
  const sockets = [];
  const api = loadRecovered('electron/ipc/handlers-vpn', {
    process: { env: { EGOISTSHIELD_MOCK_RUNTIME: '1', NODE_ENV: 'test' } }, app, AbortController, logger, performance,
    VpnReconnectSupervisor: Actual, ipcMain: { handle(name, handler) { handlers.set(name, handler); } },
    tls: { connect(_options, ready) { const socket = new FixtureSocket(); sockets.push(socket); queueMicrotask(ready); return socket; } },
  }, ['registerVpnHandlers', 'measureRouteLatency']);
  t.after(() => app.emit('before-quit'));
  api.registerVpnHandlers({ stateStore: { get: () => ({ settings: { reconnectOnDrop: true }, nodes: [] }) },
    runtimeManager: { status: async () => ({ connected: false, egressVerified: false }) },
  });
  const outside = api.measureRouteLatency({ name: 'Independent fixture', host: 'independent.invalid', path: '/', bytes: 0 }, null).catch(() => {});
  await wait(10);
  for (let iteration = 0; iteration < 2; iteration++) {
    const startedAt = performance.now();
    const measurement = handlers.get('vpn:speedtest')();
    await wait(15);
    const testSockets = sockets.slice(1).filter(socket => !socket.destroyed);
    assert.equal(testSockets.length, 3);
    assert.equal((await handlers.get('vpn:speedtest-cancel')()).cancelled, true);
    const result = await measurement;
    assert.equal(result.cancelled, true);
    assert.equal(testSockets.every(socket => socket.destroyed), true);
    assert.equal(sockets[0].destroyed, false, 'independent route latency is not owned by the speed test');
    assert.ok(performance.now() - startedAt < 500);
  }
  sockets[0].emit('error', new Error('Fixture cleanup'));
  await outside;
});

function subscriptionApi(fetchText, exec = async () => { throw new Error('Unexpected curl fixture'); }, log = logger) {
  const safe = loadRecovered('electron/ipc/safe-network', { Error }, ['getNetworkErrorDetails', 'redactUrlForLog']);
  return loadRecovered('electron/ipc/subscription-utils', {
    AbortController, Error, promisify: fn => fn, execFile: exec, path, tmpdir: () => os.tmpdir(), promises: fs,
    randomUUID, createHash, hostname: () => 'fixture-host', log, fetchTextWithRetry: fetchText,
    resolveWindowsExecutable: name => name, parseNodesFromText: () => ({ nodes: [] }), isLikelyUnsupportedPlaceholderText: () => true,
    getNetworkErrorDetails: safe.getNetworkErrorDetails, redactUrlForLog: safe.redactUrlForLog,
  }, ['readUrlText']);
}
test('subscription auto profile budget bounds a real stalled response and skips curl after cancellation', async t => {
  const { endpoint, sockets } = await stalledServer(t);
  let curlCalls = 0;
  let settled = false;
  const api = subscriptionApi((_url, options) => safeApi().fetchTextWithRetry(endpoint, options), async () => { curlCalls++; throw new Error('Fixture cleanup'); });
  const pending = api.readUrlText(endpoint, 'auto', false, { budgetMs: 40 }).then(() => { settled = true; }, () => { settled = true; });
  await wait(220);
  const bounded = settled;
  for (const socket of sockets) socket.destroy();
  await pending;
  assert.equal(bounded, true);
  assert.equal(curlCalls, 0);
});

test('subscription curl fallback shares the same total budget and abort signal', async () => {
  let seenSignal;
  let curlSignal;
  let cleanup;
  let settled = false;
  const api = subscriptionApi(async (_url, options) => { seenSignal = options.signal; throw new Error('fetch failed'); },
    async (_exe, _args, options) => {
      curlSignal = options.signal;
      return new Promise((_, reject) => {
        cleanup = () => reject(new Error('Fixture cleanup'));
        options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    });
  const pending = api.readUrlText('https://fixture.invalid/sub', 'auto', false, { budgetMs: 40 }).then(() => { settled = true; }, () => { settled = true; });
  await wait(150);
  const bounded = settled;
  if (!bounded) cleanup();
  await pending;
  assert.equal(bounded, true);
  assert.ok(seenSignal);
  assert.equal(curlSignal, seenSignal);
  assert.equal(curlSignal.aborted, true);
});

test('subscription transport error logs and returned errors never expose secret URL paths', async () => {
  const messages = [];
  const log = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, text => messages.push(text)]));
  const url = 'https://provider.invalid/sub/private-fixture-key';
  const api = subscriptionApi(async () => { throw new Error(`fetch failed for ${url}`); },
    async () => { throw new Error(`Command failed: curl.exe -L --fail ${url}`); }, log);
  let failure;
  try { await api.readUrlText(url, 'egoistshield'); } catch (error) { failure = error.message; }
  assert.ok(failure);
  assert.equal([...messages, failure].some(text => text.includes('private-fixture-key')), false);
});

test('an explicit deleted server ID fails without connecting to a different first server', async t => {
  const Actual = loadRecovered('electron/ipc/vpn-reconnect-supervisor', {}, ['VpnReconnectSupervisor']).VpnReconnectSupervisor;
  const handlers = new Map();
  const app = new EventEmitter();
  let connectedNode;
  t.after(() => app.emit('before-quit'));
  vpnApi({ process: { env: { EGOISTSHIELD_MOCK_RUNTIME: '1', NODE_ENV: 'test' } }, app,
    ipcMain: { handle(name, handler) { handlers.set(name, handler); } }, VpnReconnectSupervisor: Actual,
    Notification: { isSupported: () => false }, updateTrayMenu() {}, formatRuntimeLogEvent: () => '',
  }).registerVpnHandlers({ stateStore: { get: () => ({ settings: { reconnectOnDrop: true }, nodes: [{ id: 'first', name: 'Other server' }] }) },
    runtimeManager: { status: async () => ({ connected: false, egressVerified: false }), connect: async node => { connectedNode = node; return { connected: false }; } },
  });
  const result = await handlers.get('vpn:connect')(null, 'deleted-server');
  assert.equal(connectedNode, undefined);
  assert.equal(result.lifecycle, 'failed');
  assert.match(result.lastError, /deleted-server/);
});
