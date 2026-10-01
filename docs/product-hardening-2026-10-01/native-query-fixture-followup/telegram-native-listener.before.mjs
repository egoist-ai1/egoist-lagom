import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadRecovered } from './load-recovered.mjs';

const rootPath = 'C:\\Lagom\\Telegram\\service-wrapper\\egoistshield-telegram-proxy-service.exe';
const rootBirth = '2026-09-29T12:00:00.000Z';
const ownerBirth = '2026-09-29T12:00:02.000Z';

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1, operation: 'telegram-listener-snapshot', serviceName: 'EgoistShieldTelegramProxy',
    port: 1445, snapshotAvailable: true, stable: true, serviceState: 'Running', serviceProcessId: 100,
    rootProcessPathVerified: true,
    ipv4: { state: 'owned', ownerPid: 102, ownerName: 'egoistshield-tg-ws-proxy.exe', ownerCreatedAt: ownerBirth },
    ipv6: { state: 'missing', ownerPid: null, ownerName: null, ownerCreatedAt: null },
    snapshot: {
      processes: [{ processId: 100, createdAt: rootBirth, executablePath: rootPath }, { processId: 102, createdAt: ownerBirth }],
      listeners: [{ localAddress: '127.0.0.1', localPort: 1445, owningProcess: 102 }],
    },
    ...overrides,
  };
}

function fixture(responses = [snapshot(), snapshot()]) {
  const calls = [];
  const { TelegramProxyManager } = loadRecovered('electron/ipc/telegram-proxy-manager', {
    path: path.win32, process: { env: {} }, randomBytes, promisify: fn => fn,
    resolveWindowsExecutable: name => name,
    execFile: async (executable, args, options) => {
      calls.push({ executable, args, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return { stdout: JSON.stringify(response) };
    },
  }, ['TelegramProxyManager']);
  const manager = new TelegramProxyManager('C:\\Lagom\\resources', 'app', 'user', 'C:\\Lagom\\Telegram');
  return { manager, calls };
}

test('service readiness uses two fresh native proofs within one deadline', async () => {
  const { manager, calls } = fixture();
  const result = await manager.queryListenerOwnership(1445, '127.0.0.1', { serviceRunning: true, timeoutMs: 1000 });
  assert.equal(result.state, 'owned');
  assert.equal(result.ownerPid, 102);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.executable, 'C:\\Lagom\\resources\\core-service\\win-x64\\EgoistShield.Service.exe');
    assert.deepEqual(Array.from(call.args), ['--telegram-listener-snapshot', '--port', '1445']);
    assert.ok(call.options.timeout > 0 && call.options.timeout <= 1000);
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.options.maxBuffer, 65536);
  }
  assert.ok(calls[1].options.timeout <= calls[0].options.timeout);
});

test('native query failure stays unknown without a permissive fallback', async () => {
  const { manager, calls } = fixture([new Error('private diagnostic')]);
  const result = await manager.queryListenerOwnership(1445, '127.0.0.1', { serviceRunning: true });
  assert.equal(result.state, 'unknown');
  assert.equal(result.ownerName, null);
  assert.equal(calls.length, 1);
});

test('foreign IPv6 cannot be hidden behind an owned IPv4 localhost listener', async () => {
  const foreign = { state: 'foreign', ownerPid: 900, ownerName: 'Relay.exe' };
  const { manager, calls } = fixture([snapshot({ ipv6: foreign })]);
  const result = await manager.queryListenerOwnership(1445, 'localhost', { serviceRunning: true });
  assert.equal(result.state, 'foreign');
  assert.equal(result.ownerPid, 900);
  assert.equal(calls.length, 1);
});

test('an explicit IPv6 endpoint uses its own ownership proof', async () => {
  const ipv6 = { state: 'owned', ownerPid: 102, ownerName: 'proxy.exe', ownerCreatedAt: ownerBirth };
  const { manager } = fixture([snapshot({ ipv6 }), snapshot({ ipv6 })]);
  assert.equal((await manager.queryListenerOwnership(1445, '[::1]', { serviceRunning: true })).state, 'owned');
});

for (const [name, change] of [
  ['wrong operation', value => { value.operation = 'other'; }],
  ['wrong port', value => { value.port = 1443; }],
  ['unverified root path', value => { value.rootProcessPathVerified = false; }],
  ['foreign wrapper path', value => { value.snapshot.processes[0].executablePath = 'C:\\Relay\\wrapper.exe'; }],
  ['unstable SCM root', value => { value.stable = false; }],
  ['unknown address family', value => { value.ipv4.state = 'unknown'; }],
  ['missing process birth', value => { value.snapshot.processes[1].createdAt = null; }],
  ['recycled service root', value => { value.snapshot.processes[0].createdAt = '2026-09-29T12:00:01.000Z'; }],
  ['recycled listener owner', value => { value.snapshot.processes[1].createdAt = value.ipv4.ownerCreatedAt = '2026-09-29T12:00:03.000Z'; }],
  ['changing listener', value => { value.ipv4 = { state: 'missing' }; }],
]) {
  test(`native ownership rejects ${name}`, async () => {
    const next = snapshot();
    change(next);
    const { manager } = fixture([snapshot(), next]);
    assert.equal((await manager.queryListenerOwnership(1445, '127.0.0.1', { serviceRunning: true })).state, 'unknown');
  });
}

test('stopped service and standalone mode retain the saved process PowerShell guard', async () => {
  const { manager, calls } = fixture([{ state: 'owned', ownerPid: 102, ownerName: 'proxy.exe' }]);
  assert.equal((await manager.queryListenerOwnership(1445, '127.0.0.1', { serviceRunning: false, managedState: { pid: 101, startedAt: rootBirth } })).state, 'owned');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'powershell.exe');
});

test('native missing port needs two stable reads and a contradictory TCP result stays unknown', async () => {
  const missing = () => snapshot({ ipv4: { state: 'missing', ownerPid: null } });
  const { manager, calls } = fixture([missing(), missing()]);
  manager.isLocalTcpPortOpen = async () => true;
  const result = await manager.inspectListener(1445, '127.0.0.1', { serviceRunning: true });
  assert.equal(result.state, 'unknown');
  assert.equal(result.ready, false);
  assert.equal(calls.length, 2);
});

test('Telegram start-pending waits for SCM before requiring native running ownership', async () => {
  const { manager, calls } = fixture();
  let states = 0;
  manager.queryServiceStatus = async () => ++states === 1 ? { state: 'start-pending', running: false } : { state: 'running', running: true };
  manager.isLocalTcpPortOpen = async () => true;
  await manager.waitForServiceReady(1445, 2000);
  assert.equal(states, 2);
  assert.equal(calls.length, 2);
});

test('Telegram pending-to-running still refuses an actual foreign ownership response', async () => {
  const { manager, calls } = fixture([snapshot({ ipv4: { state: 'foreign', ownerPid: 900, ownerName: 'Relay.exe' } })]);
  let states = 0;
  manager.queryServiceStatus = async () => ++states === 1 ? { state: 'start-pending', running: false } : { state: 'running', running: true };
  manager.isLocalTcpPortOpen = async () => true;
  await assert.rejects(manager.waitForServiceReady(1445, 2000), /Relay\.exe/);
  assert.equal(states, 2);
  assert.equal(calls.length, 1);
});
