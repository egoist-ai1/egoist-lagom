import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ShieldConnectionController } from '../src/shield-connection-controller.js';
import { loadRecovered } from './load-recovered.mjs';

const zapretControl = loadRecovered('shared/zapret-control', {}, ['buildZapretSuspensionState', 'buildZapretRecoveryPlan', 'findZapretConflicts']);
const unavailableStates = ['unknown', 'UNKNOWN', 'unavailable', 'UNAVAILABLE', 'query-failed', 'QUERY-FAILED', 'Query-Failed'];
const components = [['zapret', 'running', 'Zapret'], ['dns', 'dnsRunning', 'DNS'], ['telegramProxy', 'telegramRunning', 'Telegram']];
function snapshot(serviceState, active = true) {
  return { serviceState, serviceRunning: active, standaloneRunning: active, runtimeReady: active,
    running: active, verified: active, listenerReady: active, enabled: active };
}
for (const [name, field, label] of components) {
  for (const state of unavailableStates) test(`${label} ${state} is an inspection error even with ready-looking flags`, async () => {
    const shield = new ShieldConnectionController({ [name]: { status: async () => snapshot(state) } });
    const result = await shield.status();
    assert.equal(result[field], null);
    assert.match(result.statusError, new RegExp(label + ':'));
    assert.equal(result.error, result.statusError);
  });
  test(`${label} unknown does not become a confirmed stopped observation`, async () => {
    const shield = new ShieldConnectionController({ [name]: { status: async () => snapshot('UNKNOWN', false) } });
    const result = await shield.status();
    assert.equal(result[field], null);
    assert.ok(result.statusError);
  });
}

test('unknown service status cannot clear a failed connection using the last ready snapshot', async () => {
  let zapret = snapshot('RUNNING');
  const shield = new ShieldConnectionController({ zapret: { status: async () => zapret } });
  await shield.status();
  shield.lastConnectOptions = { dnsEnabled: false, telegramEnabled: false };
  shield.publish({ phase: 'error', action: 'connect', busy: false, error: 'start verification failed' });
  zapret = snapshot('UNKNOWN');
  const result = await shield.status();
  assert.equal(result.phase, 'error');
  assert.equal(result.running, true, 'last known snapshot remains visible with explicit inspection failure');
  assert.match(result.statusError, /Zapret:/);
});

for (const state of ['START_PENDING', 'STOP_PENDING', 'start-pending', 'stop-pending']) {
  test(`${state} wrapper with a dead runtime does not report a ready function`, async () => {
    const deps = Object.fromEntries(components.map(([name]) => [name, { status: async () => ({
      ...snapshot(state), running: false, standaloneRunning: false, runtimeReady: false, listenerReady: false, verified: false
    }) }]));
    const result = await new ShieldConnectionController(deps).status();
    assert.equal(result.running, false);
    assert.equal(result.dnsRunning, false);
    assert.equal(result.telegramRunning, false);
  });
}

test('actual Zapret UNKNOWN SCM fallback is an inspection error despite an owned winws snapshot', async () => {
  const { ZapretManager } = loadRecovered('electron/ipc/zapret-manager', {
    ...zapretControl, path, process, package_default: { version: '3.8.0' },
    promisify: () => async () => ({ stdout: 'unexpected SCM output' }), execFile() {},
    resolveWindowsExecutable: name => name, logger: { warn() {}, info() {} },
  }, ['ZapretManager']);
  const zapret = new ZapretManager('resources', 'app', 'user');
  Object.assign(zapret, {
    getSourceRuntimeInfo: async () => null, pathExists: async () => true,
    readServiceProfile: async () => 'General', readCoreVersion: async () => 'fixture',
    readStandaloneState: async () => null, listIntegratedWinwsProcesses: async () => [{ pid: 42, startedAt: new Date().toISOString() }],
    getDriverStatuses: async () => [], readGameFilterMode: async () => 'disabled', readIpsetMode: async () => 'loaded',
    areUpdateChecksEnabled: async () => false, findServiceNamesByPatterns: async () => [],
  });
  const status = await zapret.readStatus();
  assert.equal(status.serviceState, 'UNKNOWN');
  assert.equal(status.runtimeReady, true);
  assert.equal(status.standaloneRunning, true);
  const result = await new ShieldConnectionController({ zapret: { status: async () => status } }).status();
  assert.equal(result.running, null);
  assert.match(result.statusError, /Zapret:/);
});
for (const state of unavailableStates) test(`DNS preflight rejects ${state} before using ready-looking flags`, async () => {
  await assert.rejects(new ShieldConnectionController({}).prepareDnsForAutoSelect(snapshot(state)), /DNS/);
});