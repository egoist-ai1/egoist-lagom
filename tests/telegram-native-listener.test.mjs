import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { loadRecovered } from './load-recovered.mjs';

const rootPath = 'C:\\Lagom\\Telegram\\service-wrapper\\egoistshield-telegram-proxy-service.exe';
const ownerPath = 'C:\\Lagom\\Telegram\\runtime\\egoistshield-tg-ws-proxy.exe';
const rootBirth = '2026-09-29T12:00:00.000Z';
const ownerBirth = '2026-09-29T12:00:02.000Z';
const missing = () => ({ state: 'missing', ownerPid: null, ownerName: null, ownerCreatedAt: null, rootPid: null, rootCreatedAt: null });

function snapshot(overrides = {}) {
  return {
    schemaVersion: 2, operation: 'telegram-listener-snapshot', serviceName: 'EgoistShieldTelegramProxy',
    port: 1445, snapshotAvailable: true, stable: true, serviceState: 'Running', serviceProcessId: 100,
    rootProcessPathVerified: true, rootProcessCreatedAt: rootBirth,
    managedProcessId: null, managedIdentityVerified: false, managedRootCreatedAt: null,
    ipv4: { state: 'owned', ownerPid: 102, ownerName: 'egoistshield-tg-ws-proxy.exe', ownerCreatedAt: ownerBirth, rootPid: 100, rootCreatedAt: rootBirth },
    ipv6: missing(),
    snapshot: {
      serviceProcessId: 100, serviceState: 'Running', stable: true,
      processes: [
        { processId: 100, parentProcessId: 1, createdAt: rootBirth, executablePath: rootPath },
        { processId: 102, parentProcessId: 100, createdAt: ownerBirth, executablePath: ownerPath },
      ],
      listeners: [{ localAddress: '127.0.0.1', localPort: 1445, owningProcess: 102 }],
    },
    ...overrides,
  };
}

function foreignSnapshot(family = 'ipv6') {
  const value = snapshot();
  value[family] = { state: 'foreign', ownerPid: 900, ownerName: 'Relay.exe', ownerCreatedAt: ownerBirth, rootPid: null, rootCreatedAt: null };
  value.snapshot.processes.push({ processId: 900, parentProcessId: 1, createdAt: ownerBirth, executablePath: 'C:\\Relay\\Relay.exe' });
  const listener = { localAddress: family === 'ipv6' ? '::1' : '127.0.0.1', localPort: 1445, owningProcess: 900 };
  if (family === 'ipv6') value.snapshot.listeners.push(listener);
  else value.snapshot.listeners = [listener];
  return value;
}

function managedSnapshot() {
  const value = snapshot({ serviceState: 'Stopped', serviceProcessId: 0, rootProcessPathVerified: false, rootProcessCreatedAt: null,
    managedProcessId: 101, managedIdentityVerified: true, managedRootCreatedAt: rootBirth });
  value.ipv4.rootPid = 101;
  value.snapshot.serviceProcessId = 0;
  value.snapshot.serviceState = 'Stopped';
  value.snapshot.processes = [
    { processId: 101, parentProcessId: 1, createdAt: rootBirth, executablePath: ownerPath },
    { processId: 102, parentProcessId: 101, createdAt: ownerBirth, executablePath: ownerPath },
  ];
  return value;
}

function missingSnapshot() {
  const value = snapshot({ ipv4: missing() });
  value.snapshot.listeners = [];
  value.snapshot.processes = [value.snapshot.processes[0]];
  return value;
}

function fixture(responses = [snapshot(), snapshot()]) {
  const calls = [];
  const { TelegramProxyManager } = loadRecovered('electron/ipc/telegram-proxy-manager', {
    path: path.win32, process: { env: {} }, randomBytes, isIP, promisify: fn => fn,
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
  assert.equal(result.ownerPid, null);
  assert.equal(result.ownerName, null);
  assert.equal(calls.length, 1);
});

test('foreign IPv6 cannot be hidden behind an owned IPv4 localhost listener', async () => {
  const { manager, calls } = fixture([foreignSnapshot(), foreignSnapshot()]);
  const result = await manager.queryListenerOwnership(1445, 'localhost', { serviceRunning: true });
  assert.equal(result.state, 'foreign');
  assert.equal(result.ownerPid, 900);
  assert.equal(result.ownerName, 'Relay.exe');
  assert.equal(calls.length, 2);
});

test('an explicit IPv6 endpoint uses its own ownership proof', async () => {
  const dual = () => {
    const value = foreignSnapshot('ipv4');
    value.ipv6 = { ...snapshot().ipv4 };
    value.snapshot.listeners.push({ localAddress: '::1', localPort: 1445, owningProcess: 102 });
    return value;
  };
  const { manager, calls } = fixture([dual(), dual()]);
  const result = await manager.queryListenerOwnership(1445, '[::1]', { serviceRunning: true });
  assert.equal(result.state, 'owned');
  assert.equal(result.ownerPid, 102);
  assert.equal(calls.length, 2);
});

for (const [name, change] of [
  ['wrong operation', value => { value.operation = 'other'; }],
  ['obsolete schema', value => { value.schemaVersion = 1; }],
  ['wrong port', value => { value.port = 1443; }],
  ['contradictory SCM snapshot', value => { value.snapshot.serviceState = 'Stopped'; }],
  ['unverified root path', value => { value.rootProcessPathVerified = false; }],
  ['foreign wrapper path', value => { value.snapshot.processes[0].executablePath = 'C:\\Relay\\wrapper.exe'; }],
  ['unstable SCM root', value => { value.stable = false; }],
  ['unknown address family', value => { value.ipv4.state = 'unknown'; }],
  ['missing process birth', value => { value.snapshot.processes[1].createdAt = null; }],
  ['missing ancestry', value => { value.snapshot.processes[1].parentProcessId = 999; }],
  ['recycled service root', value => { value.snapshot.processes[0].createdAt = value.rootProcessCreatedAt = value.ipv4.rootCreatedAt = '2026-09-29T12:00:01.000Z'; }],
  ['recycled listener owner', value => { value.snapshot.processes[1].createdAt = value.ipv4.ownerCreatedAt = '2026-09-29T12:00:03.000Z'; }],
  ['changing listener', value => { value.ipv4 = missing(); value.snapshot.listeners = []; value.snapshot.processes = [value.snapshot.processes[0]]; }],
]) {
  test(`native ownership rejects ${name}`, async () => {
    const next = snapshot();
    change(next);
    const { manager, calls } = fixture([snapshot(), next]);
    assert.equal((await manager.queryListenerOwnership(1445, '127.0.0.1', { serviceRunning: true })).state, 'unknown');
    assert.equal(calls.length, 2);
  });
}

test('stopped service and standalone mode require two native saved-process identity proofs', async () => {
  const { manager, calls } = fixture([managedSnapshot(), managedSnapshot()]);
  const result = await manager.queryListenerOwnership(1445, '127.0.0.1', { serviceRunning: false, managedState: { pid: 101, startedAt: rootBirth } });
  assert.equal(result.state, 'owned');
  assert.equal(result.ownerPid, 102);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.executable, 'C:\\Lagom\\resources\\core-service\\win-x64\\EgoistShield.Service.exe');
    assert.deepEqual(Array.from(call.args), ['--telegram-listener-snapshot', '--port', '1445', '--managed-pid', '101', '--managed-started-at', String(Date.parse(rootBirth))]);
    assert.ok(call.options.timeout > 0 && call.options.timeout <= 4000);
    assert.equal(Object.hasOwn(call.options, 'env'), false);
  }
});

test('native missing port needs two stable reads and a contradictory TCP result stays unknown', async () => {
  const { manager, calls } = fixture([missingSnapshot(), missingSnapshot()]);
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
  const { manager, calls } = fixture([foreignSnapshot('ipv4'), foreignSnapshot('ipv4')]);
  let states = 0;
  manager.queryServiceStatus = async () => ++states === 1 ? { state: 'start-pending', running: false } : { state: 'running', running: true };
  manager.isLocalTcpPortOpen = async () => true;
  await assert.rejects(manager.waitForServiceReady(1445, 2000), /Relay\.exe/);
  assert.equal(states, 2);
  assert.equal(calls.length, 2);
});
