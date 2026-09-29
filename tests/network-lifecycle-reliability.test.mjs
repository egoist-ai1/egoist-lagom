import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { loadRecovered } from './load-recovered.mjs';
import { ShieldConnectionController } from '../src/shield-connection-controller.js';

const noLog = { info() {}, warn() {}, error() {}, debug() {} };

function telegramFixture(bindings = {}) {
  const { TelegramProxyManager } = loadRecovered('electron/ipc/telegram-proxy-manager', {
    path: path.win32, process: { env: {} }, randomBytes,
    promisify: fn => fn, execFile: async () => { throw new Error('Unexpected host command'); },
    resolveWindowsExecutable: name => name,
    resolveTelegramProxyChecksumState: () => 'verified',
    buildTelegramProxyLinks: () => ({}),
    buildTelegramProxyUpdateGate: () => ({}),
    buildTelegramProxyHealthState: value => value,
    ...bindings
  }, ['TelegramProxyManager']);
  const manager = new TelegramProxyManager('resources', 'app', 'user', 'C:\\Lagom\\Telegram');
  manager.appendProxyLog = async () => {};
  manager.ensureConfigExists = async () => {};
  manager.readConfig = async () => ({ host: '::1', port: 1443, secret: 'a'.repeat(32), checkUpdates: false });
  manager.readManagedState = async () => null;
  manager.isStateRunning = async () => false;
  manager.queryServiceStatus = async () => ({ installed: true, running: true, state: 'running', pid: 100 });
  manager.readLogTailLines = async () => [];
  manager.readRuntimeTraffic = () => ({ rx: 0, tx: 0, source: 'unavailable' });
  manager.getManagedRuntimeInfo = async () => ({ runtimePath: 'C:\\Lagom\\Telegram\\runtime.exe', version: '1' });
  manager.getBundledRuntimeInfo = async () => null;
  manager.sha256File = async () => null;
  manager.queryListenerOwnership = async () => ({ state: 'none', ownerPid: null, ownerName: null });
  return manager;
}

test('Telegram readiness requires its configured listener, even when SCM reports running', async () => {
  const manager = telegramFixture();
  const probes = [];
  manager.isLocalTcpPortOpen = async (port, host) => { probes.push([port, host]); return false; };
  const status = await manager.readStatus();
  assert.deepEqual(probes, [[1443, '::1']]);
  assert.equal(status.serviceRunning, true, 'SCM state remains available separately');
  assert.equal(status.listenerReady, false);
  assert.equal(status.runtimeReady, false);
  assert.equal(status.running, false);
  assert.match(status.lastError, /1443/);
});

test('Telegram stop timeout does not kill workers behind a live SCM or claim success', async () => {
  const manager = telegramFixture();
  const events = [];
  manager.execSc = async args => events.push(args.join(' '));
  manager.coreService = { stopOwnedService: async () => events.push('core-stop') };
  manager.waitForServiceState = async () => false;
  manager.stopStaleTelegramProxyProcesses = async () => events.push('kill-stale');
  await assert.rejects(manager.stopService(), /не остановилась/);
  assert.equal(events.includes('kill-stale'), false);
  assert.equal(events.some(value => value.includes('start= disabled')), true);
});

test('Telegram persistence repair preserves service registration', async () => {
  const manager = telegramFixture();
  const events = [];
  let verified = false;
  manager.verifyServiceRecoveryConfiguration = async () => ({ ok: verified, details: ['missing recovery'] });
  manager.coreService = {
    removeOwnedService: async () => { events.push('remove'); },
    installOwnedService: async () => { events.push('repair'); verified = true; }
  };
  const result = await manager.ensureServicePersistence();
  assert.equal(result.ok, true);
  assert.deepEqual(events, ['repair']);
});

test('Telegram restart preserves startup policy and closing the UI preserves an installed service', async () => {
  const manager = telegramFixture();
  const events = [];
  manager.stopServiceInternal = async disable => events.push(['stop', disable]);
  manager.startService = async () => events.push(['start']);
  manager.status = async () => ({ serviceRunning: true });
  manager.stop = async () => { throw new Error('Closing the application must not stop an installed service'); };
  await manager.restart();
  await manager.shutdownApplicationRuntime();
  assert.deepEqual(events, [['stop', false], ['start']]);
});

test('Telegram start waits for an already starting SCM service without killing its emerging worker', async () => {
  const manager = telegramFixture();
  const events = [];
  manager.ensureManagedRuntimeInstalled = async () => ({ runtimePath: 'runtime.exe' });
  manager.ensureServicePersistence = async () => {};
  manager.queryServiceStatus = async () => ({ installed: true, running: false, state: 'start-pending' });
  manager.stopStaleTelegramProxyProcesses = async () => { throw new Error('Must not kill a worker while its service is starting'); };
  manager.waitForServiceReady = async () => events.push('wait-ready');
  manager.status = async () => ({ serviceRunning: true, runtimeReady: true });
  assert.equal((await manager.startService()).runtimeReady, true);
  assert.deepEqual(events, ['wait-ready']);
});

test('Telegram discovery failures remain unknown instead of being treated as a missing service', async () => {
  const manager = telegramFixture();
  delete manager.queryServiceStatus;
  manager.queryServiceStatusViaCore = async () => null;
  manager.queryServiceStatusViaServiceController = async () => null;
  manager.queryServiceStatusViaCim = async () => null;
  await assert.rejects(manager.queryServiceStatus(), /Не удалось проверить состояние службы/);
});

for (const name of ['telegram-proxy-manager', 'zapret-manager']) {
  test(`${name} ignores a status sample that completes after cache invalidation`, async () => {
    const bindings = { path, promisify: fn => fn, execFile: async () => {}, process: { env: {} }, package_default: { version: '3.7.7' } };
    const className = name.startsWith('telegram') ? 'TelegramProxyManager' : 'ZapretManager';
    const api = loadRecovered('electron/ipc/' + name, bindings, [className]);
    const manager = new api[className]('.', '.', '.');
    const releases = [];
    manager.readStatus = () => new Promise(resolve => releases.push(resolve));
    const before = manager.status({ force: true });
    manager.invalidateStatusCache();
    const after = manager.status({ force: true });
    releases[1]({ running: true });
    assert.equal((await after).running, true);
    releases[0]({ running: false });
    await before;
    assert.equal((await manager.status()).running, true, 'late pre-mutation status cannot overwrite new cache');
  });
}

function zapretFixture(bindings = {}) {
  const { ZapretManager } = loadRecovered('electron/ipc/zapret-manager', {
    path: path.win32, promisify: fn => fn,
    execFile: async () => { throw new Error('Unexpected host command'); },
    package_default: { version: '3.7.7' }, logger: noLog,
    buildZapretSuspensionState: () => ({ active: false }), findZapretConflicts: () => [],
    buildZapretRecoveryPlan: value => value,
    ...bindings
  }, ['ZapretManager']);
  return new ZapretManager('resources', 'app', 'user', 'C:\\Lagom\\Zapret');
}

test('Zapret running wrapper without owned worker is explicitly unready', async () => {
  const manager = zapretFixture();
  manager.getSourceRuntimeInfo = async () => null;
  manager.queryService = async () => ({ installed: true, running: true, state: 'RUNNING' });
  manager.pathExists = async () => true;
  manager.readServiceProfile = async () => 'General';
  manager.readCoreVersion = async () => '1';
  manager.readStandaloneState = async () => null;
  manager.listIntegratedWinwsProcesses = async () => [];
  manager.getDriverStatuses = async () => [];
  manager.readGameFilterMode = async () => 'disabled';
  manager.readIpsetMode = async () => 'loaded';
  manager.areUpdateChecksEnabled = async () => false;
  manager.findServiceNamesByPatterns = async () => [];
  const status = await manager.readStatus();
  assert.equal(status.serviceRunning, true);
  assert.equal(status.winwsRunning, false);
  assert.equal(status.runtimeReady, false);
  assert.equal(status.serviceReady, false);
  assert.match(status.lastError, /winws/);
});

test('Zapret stop waits for a pending transition before allowing VPN handoff', async () => {
  const manager = zapretFixture();
  const events = [];
  manager.queryService = async () => ({ installed: true, running: false, state: 'STOP_PENDING' });
  manager.execSc = async () => events.push('stop-command');
  manager.waitForServiceState = async () => { events.push('wait-stopped'); throw new Error('stop timeout'); };
  manager.cleanupDriverServicesIfSafe = async () => events.push('cleanup');
  await assert.rejects(manager.stopServiceInternal(false), /stop timeout/);
  assert.deepEqual(events, ['wait-stopped']);
});

test('Zapret start waits for pending SCM startup before stale-process cleanup or another start', async () => {
  const manager = zapretFixture();
  let state = 'START_PENDING';
  const events = [];
  manager.ensureProvisioned = async () => {};
  manager.assertNoExternalConflict = async () => {};
  manager.queryService = async () => ({ installed: true, running: state === 'RUNNING', state });
  manager.configureServiceAutostartRecovery = async () => {};
  manager.waitForServiceState = async () => { events.push('wait-running'); state = 'RUNNING'; };
  manager.listIntegratedWinwsProcesses = async () => [{ pid: 123 }];
  manager.prepareStandaloneForServiceStart = async () => async () => {};
  manager.stopStaleWinwsBeforeServiceStart = async () => { assert.equal(state, 'RUNNING'); };
  manager.execSc = async () => {};
  manager.startWrappedService = async () => { throw new Error('Must not double-start'); };
  manager.waitForIntegratedWinwsStart = async () => true;
  manager.status = async () => ({ serviceRunning: true, runtimeReady: true });
  assert.equal((await manager.startService()).runtimeReady, true);
  assert.deepEqual(events, ['wait-running']);
});

function profileFixture() {
  const events = [];
  const files = new Map([['C:\\Lagom\\Zapret\\service-wrapper\\egoistshield-zapret-service.xml', 'xml:Old']]);
  let activeProfile = 'Old';
  let running = true;
  const manager = zapretFixture({ promises: {
    readFile: async file => files.get(file),
    writeFile: async (file, text) => { files.set(file, text); events.push('write:' + text); }
  } });
  manager.ensureProvisioned = async () => {};
  manager.assertNoExternalConflict = async () => {};
  manager.assertStandaloneStopped = async () => {};
  manager.queryService = async () => ({ installed: true, running, state: running ? 'RUNNING' : 'STOPPED' });
  manager.readServiceProfile = async () => activeProfile;
  manager.buildServiceCommand = async name => ({ profile: { name }, args: name, winwsPath: 'winws.exe' });
  manager.buildServiceWrapperXml = name => 'xml:' + name;
  manager.deleteServiceIfPresent = async () => { events.push('unregister'); running = false; };
  manager.stopServiceInternal = async () => { events.push('stop'); running = false; };
  manager.installWrappedService = async (name, _path, _args, options) => {
    events.push(options?.existing ? 'update-config' : 'install');
    files.set(manager.getServiceWrapperPaths().xmlPath, 'xml:' + name);
  };
  manager.coreService = { setZapretProfile: async name => { activeProfile = name; events.push('profile:' + name); } };
  manager.configureServiceAutostartRecovery = async () => {};
  manager.startService = async () => { events.push('start:' + activeProfile); running = true; };
  manager.status = async () => ({ serviceRunning: running, runtimeReady: running, serviceProfile: activeProfile });
  return { manager, files, events, profile: () => activeProfile, running: () => running };
}

test('Zapret profile selection preserves registration and does not restart an unchanged strategy', async () => {
  const f = profileFixture();
  await f.manager.setServiceProfile('Old');
  assert.deepEqual(f.events, []);
  await f.manager.setServiceProfile('New');
  assert.deepEqual(f.events, ['stop', 'update-config', 'profile:New', 'start:New']);
  assert.equal(f.running(), true);
});

test('Zapret failed strategy switch restores the previous running profile and configuration', async () => {
  const f = profileFixture();
  f.manager.startService = async () => {
    f.events.push('start:' + f.profile());
    if (f.profile() === 'New') throw new Error('new strategy failed readiness');
  };
  await assert.rejects(f.manager.setServiceProfile('New'), /new strategy failed readiness/);
  assert.equal(f.profile(), 'Old');
  assert.equal(f.files.get(f.manager.getServiceWrapperPaths().xmlPath), 'xml:Old');
  assert.equal(f.events.includes('unregister'), false);
  assert.equal(f.events.at(-1), 'start:Old');
});

test('Zapret failed rollback reports both failures instead of promising restoration', async () => {
  const f = profileFixture();
  f.manager.startService = async () => { throw new Error('worker cannot start'); };
  const error = await f.manager.setServiceProfile('New').catch(error => error);
  assert.match(error.message, /worker cannot start/);
  assert.match(error.message, /Восстановление/);
  assert.equal(f.profile(), 'Old');
  assert.equal(f.files.get(f.manager.getServiceWrapperPaths().xmlPath), 'xml:Old');
});

function fakeScheduler() {
  let time = 0;
  const timers = new Map();
  return {
    now: () => time, random: () => 0,
    setTimeout: (callback, delay) => { const key = {}; timers.set(key, { callback, delay }); return key; },
    clearTimeout: key => timers.delete(key),
    setInterval: () => ({}), clearInterval() {},
    pending: () => [...timers.values()].map(value => value.delay),
    fire: async () => {
      const [key, value] = timers.entries().next().value;
      timers.delete(key); time += value.delay; await value.callback();
    }
  };
}

function reconnectFixture(extra = {}) {
  const { VpnReconnectSupervisor } = loadRecovered('electron/ipc/vpn-reconnect-supervisor', {}, ['VpnReconnectSupervisor']);
  const scheduler = fakeScheduler();
  const options = { readEnabled: () => true, getStatus: async () => ({ connected: false, lastError: 'network timeout' }),
    reconnect: async () => ({ connected: false, lastError: 'network timeout' }), scheduler,
    baseDelayMs: 10, maxDelayMs: 20, maxNetworkAttempts: 2, networkCooldownMs: 100, ...extra };
  return { supervisor: new VpnReconnectSupervisor(options), scheduler, options };
}

test('VPN transient retry budget enters cooldown and recovers after a long outage', async () => {
  const { supervisor, scheduler, options } = reconnectFixture();
  supervisor.recordConnectionResult({ connected: true, egressVerified: true });
  await supervisor.checkNow();
  await scheduler.fire();
  await scheduler.fire();
  assert.equal(supervisor.snapshot().armed, true);
  assert.equal(supervisor.snapshot().phase, 'cooldown');
  assert.deepEqual(scheduler.pending(), [100]);
  options.reconnect = async () => ({ connected: true, egressVerified: true });
  await scheduler.fire();
  assert.equal(supervisor.snapshot().phase, 'watching');
  assert.equal(supervisor.snapshot().attempt, 0);
  assert.deepEqual(scheduler.pending(), []);
});

test('VPN stale retry completion cannot release the new manual connection guard', async () => {
  let release;
  const { supervisor, scheduler } = reconnectFixture({ reconnect: () => new Promise(resolve => { release = resolve; }) });
  supervisor.recordConnectionResult({ connected: true, egressVerified: true });
  await supervisor.checkNow();
  const retry = scheduler.fire();
  supervisor.beginManualConnect();
  release({ connected: false, lastError: 'timeout' });
  await retry;
  assert.equal(supervisor.attemptInFlight, true);
  assert.equal(supervisor.snapshot().phase, 'reconnecting');
});

test('VPN auth failure requires user correction rather than periodic retries', async () => {
  const { supervisor, scheduler } = reconnectFixture({ reconnect: async () => ({ connected: false, lastError: 'authentication failed' }) });
  supervisor.recordConnectionResult({ connected: true, egressVerified: true });
  await supervisor.checkNow();
  await scheduler.fire();
  assert.equal(supervisor.snapshot().armed, false);
  assert.equal(supervisor.snapshot().circuitOpen, true);
  assert.deepEqual(scheduler.pending(), []);
});

test('VPN runtime crashes use bounded cooldown rather than requiring a permanent manual reset', async () => {
  const { supervisor, scheduler } = reconnectFixture({ reconnect: async () => ({ connected: false, lastError: 'Runtime exited unexpectedly (code 9)' }) });
  supervisor.recordConnectionResult({ connected: true, egressVerified: true });
  await supervisor.checkNow();
  await scheduler.fire();
  await scheduler.fire();
  assert.equal(supervisor.snapshot().failureClass, 'runtime');
  assert.equal(supervisor.snapshot().phase, 'cooldown');
  assert.equal(supervisor.snapshot().armed, true);
  assert.deepEqual(scheduler.pending(), [100]);
});

test('coordinator deadline includes a hung read-only inspection and never invokes the mutation later', async () => {
  const { NetworkCombinatorManager } = loadRecovered('electron/ipc/network-combinator-manager', {
    buildNetworkCombinatorInspection: ({ modules }) => ({ modules })
  }, ['NetworkCombinatorManager']);
  let release;
  const manager = new NetworkCombinatorManager({ isElevated: async () => true,
    moduleInspectors: { vpn: () => new Promise(resolve => { release = resolve; }) } });
  let invoked = false;
  const mutation = manager.runCoordinatedMutation({ module: 'dns', action: 'apply', requiredLocks: ['dns'], waitTimeoutMs: 20 }, async () => { invoked = true; });
  const outcome = await Promise.race([mutation.then(() => 'applied', error => error.message), new Promise(resolve => setTimeout(() => resolve('hung'), 100))]);
  assert.match(outcome, /Timed out/);
  release({ ownedLocks: [] });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(invoked, false);
  assert.equal(manager.activeCoordinatedMutations.size, 0);
});

test('coordinator serializes a burst of network mutations without leaking locks or release waiters', async () => {
  const { NetworkCombinatorManager } = loadRecovered('electron/ipc/network-combinator-manager', {
    buildNetworkCombinatorInspection: ({ modules }) => ({ modules })
  }, ['NetworkCombinatorManager']);
  const manager = new NetworkCombinatorManager({ isElevated: async () => true });
  let active = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: 128 }, (_, index) => manager.runCoordinatedMutation({
    module: index % 2 ? 'vpn' : 'dns', action: 'stress', requiredLocks: ['traffic-route'], waitTimeoutMs: 5000
  }, async () => {
    assert.equal(++active, 1, 'overlapping route mutations are forbidden');
    await new Promise(resolve => setImmediate(resolve));
    active--; completed++;
  })));
  assert.equal(completed, 128);
  assert.equal(manager.activeCoordinatedMutations.size, 0);
  assert.equal(manager.mutationReleaseWaiters.size, 0);
});

test('Shield does not accept SCM running if the working component explicitly failed readiness', async () => {
  for (const component of ['zapret', 'telegram']) {
    let saved = false;
    const deps = {
      coordinate: async (_action, operation) => operation(),
      zapret: { status: async () => ({ serviceRunning: true, runtimeReady: component !== 'zapret' }) },
      dns: { status: async () => ({ running: true, verified: true }) },
      telegramProxy: { status: async () => ({ serviceRunning: true, running: true, runtimeReady: component !== 'telegram' }),
        openConnectionLink: async () => {} },
      saveConnected: async () => { saved = true; }
    };
    const controller = new ShieldConnectionController(deps);
    assert.equal((await controller.connect()).ok, false, component);
    assert.equal(saved, false);
    const status = await controller.status();
    assert.equal(component === 'zapret' ? status.running : status.telegramRunning, false);
  }
});

test('Shield recovered live state clears a stale connection error while retaining the failed action', async () => {
  let ready = false;
  const controller = new ShieldConnectionController({
    coordinate: async () => { throw new Error('service temporarily unavailable'); },
    zapret: { status: async () => ({ serviceRunning: ready, runtimeReady: ready }) },
    dns: { status: async () => ({ running: ready, verified: ready }) }
  });
  await controller.connect({ telegramEnabled: false });
  assert.match((await controller.status()).error, /temporarily unavailable/);
  ready = true;
  const status = await controller.status();
  assert.equal(status.phase, 'connected');
  assert.equal(status.error, null);
  assert.match(status.lastActionError, /temporarily unavailable/);
});

test('Shield failed disconnect remains visible until every requested component is confirmed stopped', async () => {
  let active = true;
  const controller = new ShieldConnectionController({
    coordinate: async () => { throw new Error('stop timeout'); },
    zapret: { status: async () => ({ serviceRunning: active, runtimeReady: active }) },
    dns: { status: async () => ({ running: active, verified: active }) }
  });
  await controller.disconnect();
  assert.match((await controller.status()).error, /stop timeout/);
  active = false;
  const status = await controller.status();
  assert.equal(status.phase, 'idle');
  assert.equal(status.error, null);
  assert.equal(status.lastActionError, 'stop timeout');
});

function vpnFixture(bindings = {}) {
  const { VpnRuntimeManager } = loadRecovered('electron/ipc/vpn-manager', {
    EventEmitter, path, promisify: fn => fn, execFile: async () => {},
    process: { env: {}, kill() {} }, logger: noLog,
    RuntimeInstaller: class {}, KillSwitch: class { isActive() { return false; } },
    formatRuntimeLogEvent: value => JSON.stringify(value), ...bindings
  }, ['VpnRuntimeManager']);
  return new VpnRuntimeManager('.', '.');
}

test('VPN killed flag alone is not proof that the OS process has stopped', () => {
  const manager = vpnFixture();
  manager.snapshot.process = { pid: 123, killed: true, exitCode: null, signalCode: null };
  assert.equal(manager.isRuntimeProcessAlive(), true);
  manager.snapshot.process.signalCode = 'SIGTERM';
  assert.equal(manager.isRuntimeProcessAlive(), false);
});

test('VPN failed disconnect retains the active session for diagnosis and a safe stop retry', async () => {
  const manager = vpnFixture();
  const session = { process: { pid: 123, killed: false, exitCode: null }, processGeneration: 1, nodeId: 'node',
    startedAt: '2026-09-29T00:00:00Z', proxyPort: 10809, activeRuntimePath: 'C:\\Lagom\\xray.exe', runtimeKind: 'xray' };
  manager.applyActiveSession(session);
  manager.flushRetiringSessions = async () => {};
  manager.terminateSession = async () => { throw new Error('runtime stop timeout'); };
  await assert.rejects(manager._disconnect(), /runtime stop timeout/);
  assert.equal(manager.getActiveSession()?.processGeneration, 1);
  assert.match(manager.snapshot.lastError, /runtime stop timeout/);
});

test('VPN failed retired-session cleanup keeps its reference for the next cleanup attempt', async () => {
  const manager = vpnFixture();
  const session = { processGeneration: 10 };
  manager.retiringSessions.set(10, { session, timer: null });
  manager.terminateSession = async () => { throw new Error('retired process is still alive'); };
  await assert.rejects(manager.flushRetiringSessions(), /still alive/);
  assert.equal(manager.retiringSessions.get(10)?.session, session);
  manager.terminateSession = async () => {};
  await manager.flushRetiringSessions();
  assert.equal(manager.retiringSessions.size, 0);
});

test('VPN signal-terminated process cleanup skips redundant kill and restores owned network settings', async () => {
  const events = [];
  const manager = vpnFixture({ disableSystemProxy: async () => { events.push('restore-proxy'); return { ok: true }; } });
  const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: 'SIGTERM', killed: true,
    kill() { throw new Error('Already exited: must not signal again'); } });
  await manager.terminateSession({ process: child, processGeneration: 1, configPath: null }, { disableSystemProxy: true, clearKillSwitch: true });
  assert.deepEqual(events, ['restore-proxy']);
});

test('VPN escalates termination through its exact child handle and verifies exit before restoring the proxy', async () => {
  const events = [];
  const manager = vpnFixture({ disableSystemProxy: async () => { events.push('restore-proxy'); return { ok: true }; },
    spawnSync: () => { throw new Error('PID-only termination is forbidden'); } });
  const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null, killed: false,
    kill(signal) {
      events.push(signal ?? 'SIGTERM');
      if (signal === 'SIGKILL') { this.exitCode = 0; this.emit('exit', 0); return true; }
      return false;
    } });
  const keepAlive = setTimeout(() => {}, 4000);
  try {
    await manager.terminateSession({ process: child, processGeneration: 1, configPath: null }, { disableSystemProxy: true, clearKillSwitch: true });
  } finally { clearTimeout(keepAlive); }
  assert.deepEqual(events, ['SIGTERM', 'SIGKILL', 'restore-proxy']);
});

test('shutdown deadline prevents subsequent service mutations after the UI has already quit', async () => {
  const { runShutdownSteps } = loadRecovered('electron/shutdown-coordinator', {}, ['runShutdownSteps']);
  const events = [];
  let release;
  const report = await runShutdownSteps([
    { name: 'pending-vpn-stop', run: () => new Promise(resolve => { release = resolve; }) },
    { name: 'restore-zapret', run: async () => events.push('restore') }
  ], 20);
  assert.equal(report.timedOut, true);
  assert.equal(report.unfinishedStep, 'pending-vpn-stop');
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, []);
  assert.deepEqual(Array.from(report.completedSteps), [], 'the returned timeout report is a stable snapshot');
});

test('VPN ninety-day virtual outage keeps one timer, bounded retry batches, and manual cancellation', async t => {
  let attempts = 0;
  const { supervisor, scheduler } = reconnectFixture({
    reconnect: async () => { attempts++; return { connected: false, lastError: 'network timeout' }; },
    baseDelayMs: 1500, maxDelayMs: 30000, maxNetworkAttempts: 8, networkCooldownMs: 300000
  });
  supervisor.recordConnectionResult({ connected: true, egressVerified: true });
  await supervisor.checkNow();
  const duration = 90 * 24 * 60 * 60 * 1000;
  while (scheduler.now() < duration) {
    assert.equal(scheduler.pending().length, 1);
    assert.ok(supervisor.snapshot().attempt < 8);
    await scheduler.fire();
  }
  assert.ok(attempts < 8 * (duration / 300000 + 1));
  supervisor.cancel();
  assert.deepEqual(scheduler.pending(), []);
  assert.equal(supervisor.snapshot().armed, false);
  t.diagnostic(`90 simulated days; ${attempts} failed reconnect calls; maximum queued retries: 1. No live network or elapsed-day soak.`);
});
