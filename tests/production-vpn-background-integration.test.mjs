import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { loadRecovered } from './load-recovered.mjs';

const logger = { info() {}, warn() {}, debug() {}, error() {} };
const observed = extra => ({ serviceName: 'EgoistShieldVpn', serviceInstalled: true,
  serviceState: 'running', startType: 'auto', backgroundEnabled: true, running: true,
  serviceRunning: true, localHealth: 'responsive', proxyPort: 10838, socksPort: 10838, runtimeKind: 'sing-box',
  activeNodeId: 'selected-node', pid: 444, startedAt: '2026-10-01T01:00:00Z',
  instanceId: '444:2026-10-01T01:00:00Z', observation: { state: 'observed', at: '2026-10-01T01:01:00Z' }, ...extra });
const stopped = () => observed({ serviceState: 'stopped', startType: 'disabled', backgroundEnabled: false,
  running: false, serviceRunning: false, localHealth: 'unresponsive', pid: null, instanceId: null });
class RuntimeInstaller {}
class KillSwitch { isActive() { return false; } }
function managerApi(extra = {}) {
  return loadRecovered('electron/ipc/vpn-manager', { EventEmitter, RuntimeInstaller, KillSwitch,
    path, promises: fsp, process, promisify, execFile() { throw new Error('Unexpected host executable'); },
    performance, logger, formatRuntimeLogEvent: value => JSON.stringify(value),
    disableSystemProxy: async () => ({ ok: true }), ...extra }, ['VpnRuntimeManager', 'isObservedBackgroundVpnStatus']);
}
function serviceFixture(initial = observed()) {
  let current = initial;
  const calls = [];
  return { calls, get current() { return current; }, set current(value) { current = value; },
    async status() { calls.push('status'); return structuredClone(current); },
    async installService(snapshot) { calls.push({ install: snapshot }); current = observed({ activeNodeId: snapshot.node.id }); return current; },
    async startService() { calls.push('start'); current = observed(); return current; },
    async stopService() { calls.push('stop'); current = stopped(); return current; },
    async removeService() { calls.push('remove'); current = observed({ serviceInstalled: false, serviceState: 'not-installed', backgroundEnabled: false,
      running: false, serviceRunning: false, pid: null, instanceId: null }); return current; } };
}
function newManager(extra) { const api = managerApi(extra), manager = new api.VpnRuntimeManager('.', '.'); manager.cachedIsAdmin = false; return { manager, api }; }

test('background status contract requires an actual observation and preserves unknown', async () => {
  const { manager, api } = newManager();
  assert.throws(() => manager.attachBackgroundService({ status() {} }), /Неполный контракт/);
  const service = serviceFixture(); manager.attachBackgroundService(service);
  const status = await manager.status();
  assert.equal(status.executionMode, 'background-service'); assert.equal(status.temporaryRuntimeActive, false);
  assert.equal(status.connected, true); assert.equal(status.useTunMode, true); assert.equal(status.egressVerified, false);
  assert.equal(status.processGeneration, service.current.instanceId);
  for (const unknown of [observed({ observation: { state: 'unknown' } }), observed({ serviceInstalled: null }),
    observed({ running: null }), observed({ serviceState: 'unknown' }), observed({ backgroundEnabled: null })]) {
    assert.equal(api.isObservedBackgroundVpnStatus(unknown), false);
    service.current = unknown; await assert.rejects(manager.status(), /не подтверждено/);
  }
  assert.equal(service.calls.includes('stop'), false);
});
test('packaged VPN manager and handlers ignore every environment mock switch', () => {
  const environment = { EGOISTSHIELD_MOCK_RUNTIME: '1', NODE_ENV: 'test', VITEST: 'true' };
  const api = managerApi({ app: { isPackaged: true }, process: { env: environment, platform: 'win32' } });
  const manager = new api.VpnRuntimeManager('.', '.');
  assert.equal(manager.mockMode, false);
  const handlerApi = loadRecovered('electron/ipc/handlers-vpn', { app: { isPackaged: true }, process: { env: environment } }, ['IS_TEST_MOCK_RUNTIME']);
  assert.equal(handlerApi.IS_TEST_MOCK_RUNTIME, false);
});
test('temporary connect fails before any teardown or preparation when background state cannot permit it', async () => {
  const { manager } = newManager(), service = serviceFixture(); manager.attachBackgroundService(service);
  let mutations = 0; manager.clearPendingHandoff = () => mutations++; manager.prepareConnection = async () => { mutations++; throw new Error('Should not prepare'); };
  for (const blocked of [observed(), observed({ serviceState: 'start_pending', running: false }),
    observed({ ...stopped(), startType: 'auto' }), observed({ serviceState: 'unknown' }),
    observed({ ...stopped(), localHealth: 'conflict' }), observed({ ...stopped(), localHealth: 'unknown' })]) {
    service.current = blocked; await assert.rejects(manager._connect({ id: 'temporary' }, [], [], {}));
  }
  assert.equal(mutations, 0); assert.equal(service.calls.includes('stop'), false);
  service.status = async () => { throw new Error('Own service query failed'); };
  await assert.rejects(manager.assertTemporaryRuntimeAllowed(), /Own service query failed/);
  assert.equal(manager.backgroundModeActive, true, 'unknown service queries must suppress GUI reconnect');
});
test('manual background disconnect confirms disabled and stopped before returning idle', async () => {
  const { manager } = newManager(), service = serviceFixture(); manager.attachBackgroundService(service);
  const result = await manager.disconnect();
  assert.equal(service.calls.filter(value => value === 'stop').length, 1);
  assert.equal(result.connected, false); assert.equal(result.backgroundService.serviceState, 'stopped');
  assert.equal(result.backgroundService.startType, 'disabled'); assert.equal(result.executionMode, 'none');
});
test('an unconfirmed background stop cannot declare disconnected or mutate the service again', async () => {
  const { manager } = newManager(), service = serviceFixture(); manager.attachBackgroundService(service);
  service.stopService = async () => { service.calls.push('stop'); };
  await assert.rejects(manager.disconnect(), /Остановка.*не подтверждена/);
  assert.equal(service.calls.filter(value => value === 'stop').length, 1);
  assert.equal((await manager.status()).connected, true);
});
test('real GUI-owned harmless child and config stop on shutdown while background service and suspension remain', async t => {
  const taskTemporary = process.env.LAGOM_TEST_TEMP || os.tmpdir();
  const directory = await fsp.mkdtemp(path.join(taskTemporary, 'vpn-exit-'));
  const configPath = path.join(directory, 'config.json'); await fsp.writeFile(configPath, '{}');
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000);'], { windowsHide: true, stdio: 'ignore' });
  t.after(async () => { if (child.exitCode === null && !child.signalCode) child.kill(); await fsp.rm(directory, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const { manager } = newManager(), service = serviceFixture(); manager.attachBackgroundService(service);
  manager.applyActiveSession({ process: child, processGeneration: 1, startedAt: new Date().toISOString(), proxyPort: 10809,
    socksPort: 10809, apiPort: null, configPath, nodeId: 'temporary', activeRuntimePath: process.execPath, runtimeKind: 'sing-box', processRulesApplied: false });
  const proof = await manager.shutdownApplicationRuntime();
  assert.equal(manager.isChildProcessAlive(child), false); assert.equal(fs.existsSync(configPath), false);
  assert.equal(proof.temporaryRuntimeStopped, true); assert.equal(proof.backgroundServicePreserved, true);
  assert.equal(proof.keepZapretSuspended, true); assert.equal(service.calls.includes('stop'), false);
  assert.equal((await manager.status()).executionMode, 'background-service');
});
test('GUI exit preserves an unknown background service instead of attempting a stop or Zapret restore', async () => {
  const { manager } = newManager(), service = serviceFixture(observed({ serviceState: 'unknown', observation: { state: 'unknown' } }));
  manager.attachBackgroundService(service);
  const proof = await manager.shutdownApplicationRuntime();
  assert.equal(proof.backgroundServicePreserved, true); assert.equal(proof.keepZapretSuspended, true);
  assert.equal(service.calls.includes('stop'), false);
});
test('background egress verification is bound to the observed instance and expires on monotonic time', async () => {
  let elapsed = 100;
  const { manager } = newManager({ performance: { now: () => elapsed } }), service = serviceFixture(); manager.attachBackgroundService(service);
  const instance = service.current.instanceId;
  await manager.markEgressVerified('203.0.113.1', instance);
  assert.equal((await manager.status()).egressVerified, true);
  elapsed += 60001; assert.equal((await manager.status()).egressVerified, false);
  service.current = observed({ pid: 445, instanceId: '445:2026-10-01T02:00:00Z' });
  await manager.markEgressVerified('203.0.113.2', instance);
  assert.equal((await manager.status()).egressVerified, false);
  await manager.markEgressVerified('203.0.113.3', service.current.instanceId);
  assert.equal((await manager.status()).egressVerified, true);
  await manager.markEgressUnverified('own observed upstream failure', instance);
  assert.equal((await manager.status()).egressVerified, true, 'a late old-instance failure must not clear the new instance');
});

function handlerFixture(t, { service = serviceFixture(stopped()), snapshotValidation } = {}) {
  const handlers = new Map(), events = [], app = new EventEmitter(), powerMonitor = new EventEmitter(), state = { settings: { reconnectOnDrop: true, zapretSuspendDuringVpn: true,
    zapretProfile: 'configured', useTunMode: false }, nodes: [{ id: 'selected-node', name: 'own selected node', server: 'fixture.example', port: 443 }], domainRules: [], processRules: [], activeNodeId: 'selected-node' };
  const { manager, api } = newManager(); manager.attachBackgroundService(service);
  const Actual = loadRecovered('electron/ipc/vpn-reconnect-supervisor', {}, ['VpnReconnectSupervisor']).VpnReconnectSupervisor;
  const originalShutdown = manager.shutdownApplicationRuntime.bind(manager);
  manager.shutdownApplicationRuntime = async () => { events.push('temporary-shutdown'); return originalShutdown(); };
  app.getVersion = () => '3.8.0';
  t.after(() => app.emit('before-quit'));
  loadRecovered('electron/ipc/handlers-vpn', { process: { env: {} }, app, logger, performance,
    ipcMain: { handle(name, callback) { handlers.set(name, callback); } }, VpnReconnectSupervisor: Actual,
    powerMonitor, isObservedBackgroundVpnStatus: api.isObservedBackgroundVpnStatus,
    validateBackgroundVpnSnapshot: value => { events.push('snapshot-validation'); snapshotValidation?.(value); return value; },
    updateTrayMenu: connected => events.push({ tray: connected }),
  }, ['registerVpnHandlers']).registerVpnHandlers({ stateStore: { get: () => structuredClone(state) }, runtimeManager: manager,
    zapretManager: { prepareForVpn: async () => events.push('zapret-suspend'), restoreAfterVpnIfNeeded: async () => events.push('zapret-restore') },
    networkCombinatorManager: { runCoordinatedMutation: async (intent, operation) => { events.push({ intent }); return operation(); } } });
  return { handlers, events, manager, service, state, app, powerMonitor };
}
test('five background IPC contracts reject raw config, extra args and missing node before mutation', async t => {
  const fixture = handlerFixture(t), { handlers, events } = fixture;
  for (const name of ['status', 'install', 'start', 'stop', 'remove']) assert.equal(typeof handlers.get('vpn:service-' + name), 'function');
  for (const input of [{ node: fixture.state.nodes[0] }, null, '', 'x'.repeat(129)]) await assert.rejects(handlers.get('vpn:service-install')(null, input));
  await assert.rejects(handlers.get('vpn:service-install')(null, 'selected-node', {}));
  await assert.rejects(handlers.get('vpn:service-install')(null, 'removed-node'), /отсутствует/);
  for (const name of ['status', 'start', 'stop', 'remove']) await assert.rejects(handlers.get('vpn:service-' + name)(null, { config: '{}' }));
  assert.equal(events.includes('temporary-shutdown'), false); assert.equal(events.includes('zapret-suspend'), false);
});
test('background IPC snapshots selected node and rules, closes temporary mode and confirms fresh status', async t => {
  const fixture = handlerFixture(t), { handlers, events, service } = fixture;
  const result = await handlers.get('vpn:service-install')(null, 'selected-node');
  const installed = service.calls.find(value => typeof value === 'object' && value.install);
  assert.equal(installed.install.node.id, 'selected-node'); assert.equal(installed.install.settings.useTunMode, true);
  assert.equal(fixture.state.settings.useTunMode, false, 'install snapshot must not mutate GUI preferences');
  assert.ok(events.indexOf('snapshot-validation') < events.indexOf('temporary-shutdown'));
  assert.ok(events.indexOf('temporary-shutdown') < events.indexOf('zapret-suspend'));
  assert.equal(result.backgroundEnabled, true); assert.equal(result.observation.state, 'observed');
  assert.equal(service.calls.at(-1), 'status');
  assert.equal(events.find(value => value?.intent)?.intent.action, 'service-install');
});
test('invalid background snapshot and unavailable service cannot interrupt a temporary connection', async t => {
  const first = handlerFixture(t, { snapshotValidation() { throw new Error('Unsupported settings'); } });
  await assert.rejects(first.handlers.get('vpn:service-install')(null, 'selected-node'), /Unsupported settings/);
  assert.equal(first.events.includes('temporary-shutdown'), false);
  const second = handlerFixture(t, { service: serviceFixture(observed({ serviceInstalled: false, serviceState: 'not-installed', backgroundEnabled: false, running: false, serviceRunning: false })) });
  await assert.rejects(second.handlers.get('vpn:service-start')(null), /не установлена/);
  assert.equal(second.events.includes('temporary-shutdown'), false);
});
test('unknown service state blocks every mutation but is returned as unknown by the status IPC', async t => {
  const fixture = handlerFixture(t, { service: serviceFixture(observed({ serviceInstalled: null, serviceState: 'unknown', running: null, observation: { state: 'unknown' } })) });
  assert.equal((await fixture.handlers.get('vpn:service-status')(null)).observation.state, 'unknown');
  for (const name of ['install', 'start', 'stop', 'remove']) await assert.rejects(fixture.handlers.get('vpn:service-' + name)(null, ...name === 'install' ? ['selected-node'] : []), /не подтверждено/);
  assert.equal(fixture.events.includes('temporary-shutdown'), false);
});
test('background stop/remove confirms Core readback and restores suspension only when both modes are inactive', async t => {
  const fixture = handlerFixture(t, { service: serviceFixture() });
  const result = await fixture.handlers.get('vpn:service-stop')(null);
  assert.equal(result.serviceState, 'stopped'); assert.equal(result.startType, 'disabled');
  assert.equal(fixture.events.includes('zapret-restore'), true);
  const removed = await fixture.handlers.get('vpn:service-remove')(null);
  assert.equal(removed.serviceInstalled, false); assert.equal(removed.observation.state, 'observed');
});
test('background TUN reapply refuses changing Windows system proxy', async t => {
  const fixture = handlerFixture(t, { service: serviceFixture() });
  const result = await fixture.handlers.get('vpn:reapply-route')(null);
  assert.equal(result.ok, false); assert.match(result.message, /фонового TUN/);
});

test('failed background start restores Zapret only after a fresh confirmed inactive service readback', async t => {
  const fixture = handlerFixture(t);
  fixture.service.startService = async () => { fixture.service.calls.push('start-failure'); throw new Error('Own controlled start failure'); };
  await assert.rejects(fixture.handlers.get('vpn:service-start')(null), /Own controlled start failure/);
  assert.equal(fixture.events.includes('zapret-suspend'), true);
  assert.equal(fixture.events.includes('zapret-restore'), true);
  assert.equal(fixture.service.calls.at(-1), 'status');
  const uncertain = handlerFixture(t);
  uncertain.service.startService = async () => { uncertain.service.current = observed({ serviceState: 'unknown', observation: { state: 'unknown' } }); throw new Error('Own uncertain start failure'); };
  await assert.rejects(uncertain.handlers.get('vpn:service-start')(null), /Own uncertain start failure/);
  assert.equal(uncertain.events.includes('zapret-restore'), false);
});

test('GUI exit removes wake listeners and does not schedule another probe after shutdown', async t => {
  const fixture = handlerFixture(t);
  assert.equal(fixture.powerMonitor.listenerCount('resume'), 1);
  assert.equal(fixture.powerMonitor.listenerCount('unlock-screen'), 1);
  fixture.app.emit('before-quit');
  assert.equal(fixture.powerMonitor.listenerCount('resume'), 0);
  assert.equal(fixture.powerMonitor.listenerCount('unlock-screen'), 0);
  const observedReads = fixture.service.calls.length;
  fixture.powerMonitor.emit('resume'); fixture.powerMonitor.emit('unlock-screen');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(fixture.service.calls.length, observedReads);
});
