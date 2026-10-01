import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadRecovered } from './load-recovered.mjs';

function localManager(command) {
  const { SystemDohManager } = loadRecovered('electron/ipc/system-doh-service-manager', {
    promisify: value => value, execFile: command, resolveWindowsExecutable: value => value,
    normalizeSystemDohLocalAddress: value => value ?? ''
  }, ['SystemDohManager']);
  return Object.create(SystemDohManager.prototype);
}

function dnsInspector(systemDoh, gravityless = { serviceState: 'not-installed' }) {
  const { buildNetworkModuleInspectors } = loadRecovered('electron/ipc/handlers', {}, ['buildNetworkModuleInspectors']);
  return buildNetworkModuleInspectors({ stateStore: { get: () => ({ settings: {} }) },
    gravitylessDnsManager: { status: async () => gravityless },
    systemDohManager: { status: async () => typeof systemDoh === 'function' ? systemDoh() : systemDoh }
  }).dns;
}

test('confirmed numeric SCM missing response bypasses unavailable CIM', async () => {
  const calls = [];
  const manager = localManager(async exe => {
    calls.push(exe);
    throw Object.assign(new Error('service missing'), exe === 'sc.exe' ? { code: 1060, killed: false, signal: null } : { killed: true });
  });
  const result = await manager.queryServiceStatus();
  assert.equal(result.state, 'not-installed');
  assert.equal(result.installed, false);
  assert.deepEqual(calls, ['sc.exe']);
});

test('non-missing, text-only, timeout and interrupted SCM failures remain unknown', async () => {
  for (const shape of [{ code: 5 }, { code: '1060' }, { code: 1, stdout: 'a filename contains 1060' },
    { code: 1060, killed: true }, { code: 1060, signal: 'SIGTERM' }, { code: 1060, timedOut: true }, { code: 1060, timeout: true }]) {
    const calls = [];
    const manager = localManager(async exe => {
      calls.push(exe);
      throw Object.assign(new Error('controlled query failure'), exe === 'sc.exe' ? shape : { code: 'EACCES' });
    });
    const result = await manager.queryServiceStatus();
    assert.equal(result.state, 'unknown', JSON.stringify(shape));
    assert.deepEqual(calls, ['sc.exe', 'powershell.exe']);
    assert.equal(result.ownerInspectionErrors.length, 2);
    assert.equal(result.ownerInspectionErrors[0].stage, 'sc-queryex');
    assert.equal(result.ownerInspectionErrors[1].stage, 'cim-fallback');
    assert.equal(result.ownerInspectionErrors[1].commandErrorCode, 'EACCES');
  }
});

test('unparseable live SCM and CIM state never becomes a missing service', async () => {
  const manager = localManager(async exe => ({ stdout: exe === 'sc.exe' ? 'STATE : 4 SOMETHING_ELSE' : 'not-a-supported-state|91' }));
  const result = await manager.queryServiceStatus();
  assert.equal(result.state, 'unknown');
  assert.equal(result.installed, true);
  assert.ok(result.ownerInspectionErrors.some(value => value.code === 'SYSTEM_DOH_SERVICE_STATE_UNKNOWN'));
});

test('native error code and readback stage survive DNS module and coordinator diagnostics', async () => {
  const events = [];
  const { NetworkCombinatorManager } = loadRecovered('electron/ipc/network-combinator-manager', {
    buildNetworkCombinatorInspection: value => value
  }, ['NetworkCombinatorManager']);
  const inspector = dnsInspector(async () => { throw Object.assign(new Error('Read-only query failed at ipv6-default-route'), { code: 'DNS_DOH_QUERY_TIMEOUT' }); });
  const result = await inspector();
  assert.equal(result.status, 'degraded');
  assert.deepEqual(Array.from(result.ownedLocks), ['dns', 'dns-verify']);
  assert.equal(result.ownerInspectionErrors[0].provider, 'system-doh');
  assert.equal(result.ownerInspectionErrors[0].code, 'DNS_DOH_QUERY_TIMEOUT');
  assert.match(result.ownerInspectionErrors[0].reason, /ipv6-default-route/);
  const coordinator = new NetworkCombinatorManager({ isElevated: async () => false, moduleInspectors: { dns: inspector }, onInspectionDiagnostic: event => events.push(event) });
  await coordinator.inspect();
  const row = events[0].providers.find(value => value.id === 'dns');
  assert.equal(row.errorCode, 'DNS_DOH_QUERY_TIMEOUT');
  assert.equal(row.causes[0].provider, 'system-doh');
  assert.match(row.causes[0].reason, /ipv6-default-route/);
});

test('local DNS SCM and CIM failures retain subprovider, numeric error and stage', async () => {
  const local = { serviceState: 'unknown', ownerInspectionErrors: [
    { provider: 'system-doh-local', code: 'SYSTEM_DOH_SERVICE_QUERY_FAILED', stage: 'sc-queryex', nativeErrorCode: 5 },
    { provider: 'system-doh-local', code: 'SYSTEM_DOH_SERVICE_QUERY_FAILED', stage: 'cim-fallback', timedOut: true }
  ] };
  const result = await dnsInspector(local)();
  assert.equal(result.status, 'degraded');
  assert.equal(result.ownerInspectionErrors.length, 2);
  assert.equal(result.ownerInspectionErrors[0].nativeErrorCode, 5);
  assert.equal(result.ownerInspectionErrors[1].stage, 'cim-fallback');
});

test('actual status method retains native and local readback failures before IPC mapping', async () => {
  const local = localManager(async exe => { throw Object.assign(new Error('controlled child query failed'), { code: exe === 'sc.exe' ? 5 : 'EACCES' }); });
  Object.assign(local, { migrateLegacyStateIfNeeded: async () => {}, readManagedState: async () => null,
    getManagedRuntimeInfo: async () => null, getSourceRuntimeInfo: async () => null });
  const status = await local.readStatus();
  assert.equal(status.serviceState, 'unknown');
  assert.equal(status.ownerInspectionErrors[0].nativeErrorCode, 5);
  assert.equal(status.ownerInspectionErrors[1].stage, 'cim-fallback');
  const native = localManager(async () => { throw new Error('Native path must not execute SCM.'); });
  Object.assign(native, { readManagedState: async () => null, coreService: {
    nativeDohStatus: async () => { throw Object.assign(new Error('readback failed at ipv6-default-route'), { code: 'DNS_DOH_ROUTE_QUERY_INVALID' }); }
  } });
  const unavailable = await native.readStatus();
  assert.equal(unavailable.serviceState, 'unavailable');
  assert.equal(unavailable.ownerInspectionErrors[0].provider, 'system-doh-native');
  assert.equal(unavailable.ownerInspectionErrors[0].code, 'DNS_DOH_ROUTE_QUERY_INVALID');
  assert.match(unavailable.ownerInspectionErrors[0].reason, /ipv6-default-route/);
});

test('healthy local status retains a failed native observation through the real desktop facade', async () => {
  const context = vm.createContext({ URL, componentOperations: () => ({ SystemDoH: { status: {}, apply: {} } }), COMPONENT_QUERIES: new Set(['status']) });
  vm.runInContext(fs.readFileSync('src/component-facade.js', 'utf8') + '\nglobalThis.wrap = useComponentService;', context);
  const core = {
    request: async () => ({ running: true, serviceState: 'running', currentUrl: 'https://local.example/dns-query', serviceInstalled: true }),
    nativeDohStatus: async () => { throw Object.assign(new Error('ownership corrupt at ownership-recheck'), { code: 'STATE_CORRUPT' }); }
  };
  const desktop = context.wrap({ apply: async () => assert.fail('Mutation attempted') }, 'SystemDoH', core);
  const status = await desktop.status();
  assert.equal(status.running, true);
  assert.equal(status.nativeStatusUnavailable, true);
  assert.equal(status.ownerInspectionErrors[0].code, 'STATE_CORRUPT');
  const result = await dnsInspector(status)();
  assert.equal(result.status, 'degraded');
  assert.deepEqual(Array.from(result.ownedLocks), ['dns', 'dns-verify']);
  assert.equal(result.ownerInspectionErrors[0].provider, 'system-doh-native');
  assert.match(result.ownerInspectionErrors[0].reason, /ownership-recheck/);
});

test('actual harmless SCM query reports numeric 1060 and drives the unchanged status function', { skip: process.platform !== 'win32', timeout: 5000 }, async () => {
  const uniqueService = 'EgoistShieldReadonlyDns_' + randomUUID().replaceAll('-', '');
  const sc = path.join(process.env.SystemRoot, 'System32', 'sc.exe');
  let actualError;
  try { await promisify(execFile)(sc, ['queryex', uniqueService], { windowsHide: true, timeout: 3000, maxBuffer: 16 * 1024 }); }
  catch (error) { actualError = error; }
  assert.equal(actualError?.code, 1060);
  assert.equal(actualError.killed, false);
  assert.equal(actualError.signal, null);
  const calls = [];
  const manager = localManager(async exe => { calls.push(exe); if (exe === 'sc.exe') throw actualError; throw new Error('Unexpected fallback'); });
  const result = await manager.queryServiceStatus();
  assert.equal(result.state, 'not-installed');
  assert.deepEqual(calls, ['sc.exe']);
  const receipt = { kind: 'actual-read-only-sc-unique-missing', uniqueService, code: actualError.code,
    killed: actualError.killed, signal: actualError.signal, result: result.state, serviceMutationCommands: 0 };
  console.log(JSON.stringify(receipt));
  if (process.env.SHIELD_DNS_OWNER_TEST_WORK) {
    assert.ok(path.isAbsolute(process.env.SHIELD_DNS_OWNER_TEST_WORK));
    fs.writeFileSync(path.join(process.env.SHIELD_DNS_OWNER_TEST_WORK, 'actual-sc-missing.json'), JSON.stringify(receipt, null, 2));
  }
});
