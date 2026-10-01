import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { sourceFor } from './load-recovered.mjs';

const port = 1443;
const birth = '2026-10-01T17:49:42.4744600Z';
const childBirth = '2026-10-01T17:49:42.7552140Z';
const rootPath = 'C:\\Lagom\\Telegram\\service-wrapper\\egoistshield-telegram-proxy-service.exe';
const runtimePath = 'C:\\Lagom\\Telegram\\runtime\\egoistshield-tg-ws-proxy.exe';
const missing = () => ({ state: 'missing', ownerPid: null, ownerName: null, ownerCreatedAt: null, rootPid: null, rootCreatedAt: null });
function snapshot(owned = true) {
  return {
    schemaVersion: 2, operation: 'telegram-listener-snapshot', serviceName: 'EgoistShieldTelegramProxy', port,
    snapshotAvailable: true, stable: true, serviceState: 'Running', serviceProcessId: 100,
    rootProcessPathVerified: true, rootProcessCreatedAt: birth,
    ipv4: owned ? { state: 'owned', ownerPid: 102, ownerName: 'proxy.exe', ownerCreatedAt: childBirth, rootPid: 100, rootCreatedAt: birth } : missing(),
    ipv6: missing(),
    snapshot: { serviceProcessId: 100, serviceState: 'Running', stable: true,
      processes: [{ processId: 100, parentProcessId: 1, createdAt: birth, executablePath: rootPath },
        ...(owned ? [{ processId: 102, parentProcessId: 100, createdAt: childBirth, executablePath: runtimePath }] : [])],
      listeners: owned ? [{ localAddress: '127.0.0.1', localPort: port, owningProcess: 102 }] : [] },
  };
}
function fixture(responses = []) {
  const clock = { now: 0 };
  const calls = [], mutations = [], logs = [];
  class ClockDate extends Date { static now() { return clock.now; } }
  const context = vm.createContext({ path: path.win32, process: { env: {} }, randomBytes, isIP, promisify: fn => fn,
    Date: ClockDate, Buffer, console, resolveWindowsExecutable: name => name,
    promises: { writeFile: async () => { mutations.push('marker'); } },
    setTimeout: (callback, milliseconds) => { clock.now += milliseconds; queueMicrotask(callback); return 1; },
    execFile: async (executable, args, options) => {
      calls.push({ executable, args, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return { stdout: JSON.stringify(response) };
    },
  });
  vm.runInContext(`${sourceFor('electron/ipc/telegram-proxy-manager')}\n;globalThis.Manager=TelegramProxyManager;`, context);
  const manager = new context.Manager('C:\\Lagom\\resources', 'app', 'user', 'C:\\Lagom\\Telegram');
  manager.queryServiceStatus = async () => ({ installed: true, running: true, state: 'running' });
  manager.isLocalTcpPortOpen = async () => true;
  manager.appendProxyLog = async (level, message) => { logs.push({ level, message }); };
  return { manager, clock, calls, mutations, logs };
}
function startFixture(responses = []) {
  const f = fixture(responses), { manager, mutations } = f;
  manager.readConfig = async () => ({ host: '127.0.0.1', port });
  manager.readManagedState = async () => null;
  manager.appendProxyLog = async () => {};
  manager.ensureManagedRuntimeInstalled = async () => { mutations.push('runtime'); return { runtimePath }; };
  manager.ensureServicePersistence = async () => ({ ok: true });
  manager.coreService = { installOwnedService: async () => { mutations.push('install'); }, startOwnedService: async () => { mutations.push('start'); } };
  manager.stopServiceInternal = async () => { mutations.push('stop'); };
  manager.stopStaleTelegramProxyProcesses = async () => { mutations.push('cleanup'); };
  manager.writeServiceWrapperConfig = async () => { mutations.push('config'); };
  manager.status = async () => ({ running: true, runtimeReady: true });
  return f;
}

test('startup A/B identity change stays unknown; the subsequent B/B and TCP prove readiness', async () => {
  const first = fixture([snapshot(false), snapshot()]);
  const changed = await first.manager.queryListenerOwnership(port, '127.0.0.1', { serviceRunning: true });
  assert.equal(changed.state, 'unknown');
  assert.equal(changed.diagnostic?.reason, 'identity-changed');
  const f = fixture([snapshot(false), snapshot(), snapshot(), snapshot()]);
  await f.manager.waitForServiceReady(port, 2000);
  assert.equal(f.calls.length, 4);
  assert.equal(f.clock.now, 500);
  assert.deepEqual(f.mutations, []);
});

test('a foreign listener rejects immediately without retry or mutation', async () => {
  const f = fixture(); let reads = 0;
  f.manager.inspectListener = async () => { reads++; return { state: 'foreign', ownerPid: 900, ownerName: 'foreign.exe', ready: false }; };
  await assert.rejects(f.manager.waitForServiceReady(port, 2000), /foreign\.exe/);
  assert.equal(reads, 1); assert.equal(f.clock.now, 0); assert.deepEqual(f.mutations, []);
});

test('persistent unknown exhausts only its readiness budget and reports the last bounded observation', async () => {
  const f = fixture(); let reads = 0;
  f.manager.inspectListener = async () => { reads++; return { state: 'unknown', ready: false,
    diagnostic: { stage: 'child-query', reason: 'child-query-timeout' } }; };
  await assert.rejects(f.manager.waitForServiceReady(port, 20), error => {
    assert.match(error.message, /не подтвердила запуск/);
    assert.doesNotMatch(error.message, /ownership=|stage=|reason=|child-query-timeout/);
    assert.equal(error.code, 'TELEGRAM_PROXY_READINESS_UNCONFIRMED');
    assert.equal(error.diagnostic?.ownership, 'unknown');
    assert.equal(error.diagnostic?.stage, 'child-query');
    assert.equal(error.diagnostic?.reason, 'child-query-timeout');
    return true;
  });
  assert.equal(f.clock.now, 20); assert.equal(reads, 1); assert.deepEqual(f.mutations, []);
  assert.equal(f.logs.length, 1); assert.equal(f.logs[0].level, 'WARN');
  assert.match(f.logs[0].message, /child-query-timeout/);
});

test('unknown mutation preflight still refuses runtime publication and every service mutation', async () => {
  const f = startFixture([Object.assign(new Error('private path and secret arguments'), { killed: true, code: 'ETIMEDOUT' })]);
  await assert.rejects(f.manager.startService(), error => {
    assert.match(error.message, /владельца/); assert.doesNotMatch(error.message, /private|secret/); return true;
  });
  assert.deepEqual(f.mutations, []);
});

test('Running unknown after installation rechecks readonly without stop or another start', async () => {
  const f = startFixture([snapshot(), snapshot(), snapshot(false), snapshot(), snapshot(), snapshot()]);
  const result = await f.manager.startService();
  assert.equal(result.runtimeReady, true);
  assert.equal(f.calls.length, 6);
  assert.deepEqual(f.mutations, ['runtime', 'install']);
});

test('the first Running observation and its retries share the existing 45 second budget', async () => {
  const f = startFixture(); let reads = 0, budget = null;
  f.manager.queryListenerOwnership = async () => ({ state: 'none' });
  f.manager.inspectListener = async () => { reads++; if (reads === 1) { f.clock.now += 4000; return { state: 'unknown', ready: false }; } return { state: 'owned', ready: true }; };
  const wait = f.manager.waitForServiceReady.bind(f.manager);
  f.manager.waitForServiceReady = async (...args) => { budget = args[1]; return wait(...args); };
  await f.manager.startService();
  assert.equal(budget, 41000); assert.deepEqual(f.mutations, ['runtime', 'install']);
});

test('known missing listener retains existing owned stop and restart recovery', async () => {
  const f = startFixture(); let reads = 0;
  f.manager.queryListenerOwnership = async () => ({ state: 'none' });
  f.manager.inspectListener = async () => ++reads === 1 ? { state: 'none', ready: false } : { state: 'owned', ready: true };
  await f.manager.startService();
  assert.deepEqual(f.mutations, ['runtime', 'install', 'stop', 'cleanup', 'config', 'marker', 'start']);
});

test('unknown followed by foreign never promotes a later owned observation to ready', async () => {
  const f = fixture(); let reads = 0;
  f.manager.inspectListener = async () => ++reads === 1 ? { state: 'unknown', ready: false } : { state: 'foreign', ownerName: 'foreign.exe', ready: false };
  await assert.rejects(f.manager.waitForServiceReady(port, 2000), /foreign\.exe/);
  assert.equal(reads, 2); assert.deepEqual(f.mutations, []);
});

test('child timeout diagnostics do not export private errors, paths or arguments', async () => {
  const f = fixture([Object.assign(new Error('C:\\private\\secret --secret=123'), { killed: true, code: 'ETIMEDOUT' })]);
  const result = await f.manager.queryListenerOwnership(port, '127.0.0.1');
  assert.equal(result.state, 'unknown'); assert.equal(result.diagnostic?.stage, 'child-query');
  assert.equal(result.diagnostic?.reason, 'child-query-timeout');
  assert.doesNotMatch(JSON.stringify(result), /private|secret|123/);
});
