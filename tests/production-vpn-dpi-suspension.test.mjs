import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import vm from 'node:vm';
import { sourceFor } from './load-recovered.mjs';

// Execute the production preparation, stop/readback, status and restoration
// controllers. The OS boundary is an in-memory SCM/registry/process model;
// no child processes, filesystem writes, DNS, drivers or host services run.
function fixture({ mode = 'service' } = {}) {
  const model = {
    installed: mode === 'service', state: mode === 'service' ? 'RUNNING' : 'STOPPED',
    profile: 'Saved service profile', profileReadError: false, stopOutcome: 'success',
    processes: mode === 'standalone' ? [{ pid: 66, startedAt: '2026-10-06T00:00:00Z' }] : [],
    standalone: mode === 'standalone' ? { pid: 66, profile: 'Saved standalone profile' } : null,
    commands: [], profileReads: 0, processStops: 0, restorations: [], unexpectedCommands: 0, now: 0,
  };
  class VirtualDate extends Date { static now() { return model.now; } }
  const execute = async (command, args) => {
    const name = path.basename(command).toLowerCase();
    model.commands.push([name, ...args]);
    if (name === 'sc.exe' && args[0] === 'query') {
      if (!model.installed) throw new Error('1060: service does not exist as an installed service');
      return { stdout: `STATE : 4 ${model.state}\n`, stderr: '' };
    }
    if (name === 'sc.exe' && args[0] === 'stop') {
      if (model.stopOutcome !== 'timeout') model.state = 'STOPPED';
      if (model.stopOutcome === 'partial-failure') throw new Error('Controlled failure after SCM stopped');
      return { stdout: '', stderr: '' };
    }
    if (name === 'sc.exe' && args[0] === 'config' && args.includes('disabled')) return { stdout: '', stderr: '' };
    if (name === 'reg.exe' && args[0] === 'query') {
      model.profileReads++;
      if (model.profileReadError) throw Object.assign(new Error('Virtual registry denied'), { code: 'EACCES' });
      return { stdout: `EgoistShieldProfile REG_SZ ${model.profile}\n`, stderr: '' };
    }
    model.unexpectedCommands++;
    throw new Error('Unexpected virtual OS command');
  };
  const context = vm.createContext({ path, Buffer, URL, Date: VirtualDate, clock: model,
    process: { platform: 'win32', env: {}, pid: 1 }, promisify: fn => fn, execFile: execute,
    resolveWindowsExecutable: value => value, package_default: { version: '3.8.0' },
    logger: { info() {}, warn() {}, error() {} },
    setTimeout() { throw new Error('A virtual deadline must not use a host timer'); },
  });
  vm.runInContext(sourceFor('shared/zapret-control') + '\n' + sourceFor('electron/ipc/zapret-manager') +
    '\nsleep = async ms => { clock.now += ms; }; globalThis.Manager = ZapretManager;', context);
  const manager = new context.Manager('memory-resources', 'memory-app', 'memory-user', 'memory-runtime', null);
  manager.cleanupDriverServicesIfSafe = async () => {};
  manager.getSourceRuntimeInfo = async () => null;
  manager.pathExists = async () => false;
  manager.getDriverStatuses = async () => [];
  manager.findServiceNamesByPatterns = async () => [];
  manager.readStandaloneState = async () => model.standalone;
  manager.clearStandaloneState = async () => { model.standalone = null; };
  manager.listIntegratedWinwsProcesses = async () => model.processes.map(value => ({ ...value }));
  manager.execPowerShell = async () => {
    model.processStops++;
    if (model.stopOutcome !== 'timeout') model.processes = [];
    if (model.stopOutcome === 'partial-failure') throw new Error('Controlled failure after owned process stopped');
    return '';
  };
  manager.setServiceProfile = async profile => { model.profile = profile; };
  manager.startService = async () => { model.restorations.push(['service', model.profile]); model.state = 'RUNNING'; };
  manager.startStandalone = async profile => {
    model.restorations.push(['standalone', profile]); model.standalone = { pid: 66, profile };
    model.processes = [{ pid: 66, startedAt: '2026-10-06T00:00:00Z' }];
  };
  return { manager, model, stops: () => model.commands.filter(row => row[0] === 'sc.exe' && row[1] === 'stop').length };
}

function assertNoNativeActions(f) { assert.equal(f.model.unexpectedCommands, 0); }

test('an unreadable active service profile cannot become an acknowledged VPN suspension', async () => {
  const f = fixture(); f.model.profileReadError = true;
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(f.manager.prepareForVpn(true));
  assert.equal(f.stops(), 0);
  assert.equal(f.model.profileReads, 2, 'retry must inspect the actual profile again');
  assert.equal(f.manager.suspendedByVpnMode, 'none');
  assert.equal(f.manager.vpnSuspensionPhase, 'none');
  f.model.profileReadError = false;
  await f.manager.prepareForVpn(true);
  assert.equal(f.manager.suspendedProfileDuringVpn, 'Saved service profile');
  assert.equal(f.manager.vpnSuspensionPhase, 'verified');
  assertNoNativeActions(f);
});

test('service stop timeouts retain restoration intent and retry authoritative SCM readback', async () => {
  const f = fixture(); f.model.stopOutcome = 'timeout';
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(f.manager.prepareForVpn(true));
  assert.equal(f.stops(), 2, 'a pending marker must not acknowledge a still running service');
  assert.equal(f.manager.suspendedByVpnMode, 'service');
  assert.equal(f.manager.suspendedProfileDuringVpn, 'Saved service profile');
  assert.equal(f.manager.vpnSuspensionPhase, 'pending');
  const pending = await f.manager.status({ force: true });
  assert.equal(pending.serviceRunning, true);
  assert.equal(pending.suspension.active, false);
  assert.equal(pending.suspension.verified, false);
  assert.equal(pending.suspension.restorationRequired, true);
  f.model.profile = 'Later service profile'; f.model.stopOutcome = 'success';
  await f.manager.prepareForVpn(true);
  assert.equal(f.manager.vpnSuspensionPhase, 'verified');
  assert.equal(f.manager.suspendedProfileDuringVpn, 'Saved service profile', 'retry preserves the original restore target');
  await f.manager.restoreAfterVpnIfNeeded(true, 'Fallback');
  assert.deepEqual(f.model.restorations, [['service', 'Saved service profile']]);
  assert.equal(f.manager.suspendedByVpnMode, 'none');
  assert.equal(f.manager.vpnSuspensionPhase, 'none');
  assertNoNativeActions(f);
});

test('partial SCM stop failure can be verified by retry or restored without forgetting its profile', async () => {
  for (const next of ['retry', 'restore']) {
    const f = fixture(); f.model.stopOutcome = 'partial-failure';
    await assert.rejects(f.manager.prepareForVpn(true), /Controlled failure/);
    assert.equal(f.model.state, 'STOPPED');
    assert.equal(f.manager.suspendedByVpnMode, 'service');
    assert.equal(f.manager.vpnSuspensionPhase, 'pending');
    if (next === 'retry') {
      await f.manager.prepareForVpn(true);
      assert.equal(f.manager.vpnSuspensionPhase, 'verified');
      assert.equal(f.stops(), 1, 'fresh stopped readback requires no second stop');
    }
    await f.manager.restoreAfterVpnIfNeeded(true, 'Fallback');
    assert.deepEqual(f.model.restorations, [['service', 'Saved service profile']]);
    assert.equal(f.manager.vpnSuspensionPhase, 'none');
    assertNoNativeActions(f);
  }
});

test('unknown SCM state after a failed stop stays pending and cannot acknowledge suspension', async () => {
  const f = fixture(); f.model.stopOutcome = 'timeout';
  await assert.rejects(f.manager.prepareForVpn(true));
  f.model.state = 'UNKNOWN';
  await assert.rejects(f.manager.prepareForVpn(true), /проверить|состояни/);
  assert.equal(f.stops(), 1);
  assert.equal(f.manager.suspendedByVpnMode, 'service');
  assert.equal(f.manager.suspendedProfileDuringVpn, 'Saved service profile');
  assert.equal(f.manager.vpnSuspensionPhase, 'pending');
  assertNoNativeActions(f);
});

test('owned standalone stop failure is retried and restores its original standalone profile', async () => {
  const f = fixture({ mode: 'standalone' }); f.model.stopOutcome = 'timeout';
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(f.manager.prepareForVpn(true));
  assert.equal(f.model.processStops, 2);
  assert.equal(f.manager.suspendedByVpnMode, 'standalone');
  assert.equal(f.manager.suspendedProfileDuringVpn, 'Saved standalone profile');
  assert.equal(f.manager.vpnSuspensionPhase, 'pending');
  f.model.stopOutcome = 'success'; await f.manager.prepareForVpn(true);
  assert.equal(f.manager.vpnSuspensionPhase, 'verified');
  assert.equal(f.model.processes.length, 0);
  await f.manager.restoreAfterVpnIfNeeded(true, 'Fallback');
  assert.deepEqual(f.model.restorations, [['standalone', 'Saved standalone profile']]);
  assert.equal(f.manager.vpnSuspensionPhase, 'none');
  assertNoNativeActions(f);
});

test('a manual service stop releases a pending restoration intent and cannot be undone by VPN cleanup', async () => {
  const f = fixture(); f.model.stopOutcome = 'timeout';
  await assert.rejects(f.manager.prepareForVpn(true));
  f.model.stopOutcome = 'success';
  await f.manager.stopService();
  assert.equal(f.manager.suspendedByVpnMode, 'none');
  assert.equal(f.manager.suspendedProfileDuringVpn, null);
  assert.equal(f.manager.vpnSuspensionPhase, 'none');
  await f.manager.restoreAfterVpnIfNeeded(true, 'Fallback');
  assert.deepEqual(f.model.restorations, []);
  assert.equal(f.model.state, 'STOPPED');
  assertNoNativeActions(f);
});

test('a Core or external service restart invalidates a previously verified suspension', async () => {
  const f = fixture();
  await f.manager.prepareForVpn(true);
  assert.equal(f.manager.vpnSuspensionPhase, 'verified');
  assert.equal(f.model.state, 'STOPPED');
  f.model.state = 'RUNNING'; f.model.profile = 'Restarted service profile'; f.model.stopOutcome = 'timeout';
  await assert.rejects(f.manager.prepareForVpn(true));
  assert.equal(f.stops(), 2, 'verified state must not bypass fresh authoritative SCM inspection');
  assert.equal(f.manager.vpnSuspensionPhase, 'pending');
  assert.equal(f.manager.suspendedProfileDuringVpn, 'Saved service profile');
  const observed = await f.manager.status({ force: true });
  assert.equal(observed.serviceRunning, true);
  assert.equal(observed.suspension.active, false);
  assert.equal(observed.suspension.restorationRequired, true);
  assertNoNativeActions(f);
});
