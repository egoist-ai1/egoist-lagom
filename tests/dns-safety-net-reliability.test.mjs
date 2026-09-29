import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { loadRecovered } from './load-recovered.mjs';

const { shouldRestoreOwnedDnsForUnavailableResolvers } = loadRecovered('shared/system-dns', {}, ['shouldRestoreOwnedDnsForUnavailableResolvers']);
const main = await fs.readFile(new URL('../src/recovered/electron/main.js', import.meta.url), 'utf8');
const start = main.indexOf('async function restoreDnsIfLocalResolverIsDown()');
const end = main.indexOf('\nasync function runDnsWatchdog()', start);
assert.ok(start >= 0 && end > start);

function fixture(statuses, health = { active: true, healthy: false }, result = { restored: 1, pendingAdapters: 0 }) {
  const calls = [];
  const coreService = { restoreOwnedDns: async () => { calls.push('restore-owned'); return result; } };
  const context = vm.createContext({
    Promise, Number, shouldRestoreOwnedDnsForUnavailableResolvers,
    globalSystemDohManager: { coreService, status: async () => statuses[0] },
    globalGravitylessDnsManager: { coreService, status: async () => statuses[1] },
    inspectOwnedLoopbackDnsHealth: async () => { calls.push('probe'); return health; },
    logger: { warn() {}, error() {} },
  });
  vm.runInContext(`${main.slice(start, end)}\nthis.recover = restoreDnsIfLocalResolverIsDown;`, context);
  return { recover: context.recover, calls };
}

test('upstream resolution failure in a running resolver never resets adapter DNS', async () => {
  for (const active of [{ running: true }, { serviceRunning: true }, { verified: true }]) {
    const f = fixture([{ ...active, serviceState: 'running' }, { service: { state: 'not-installed' } }]);
    assert.equal(await f.recover(), false);
    assert.deepEqual(f.calls, []);
  }
});

test('unknown service state preserves both static DNS and external loopback resolvers', async () => {
  for (const unknown of [null, {}, { serviceState: 'unknown' }, { serviceState: 'unavailable', serviceInstalled: false }]) {
    const f = fixture([unknown, { service: { state: 'stopped' } }]);
    assert.equal(await f.recover(), false);
    assert.deepEqual(f.calls, []);
  }
});

test('confirmed stopped resolvers restore only Core-owned original DNS', async () => {
  const f = fixture([{ serviceState: 'stopped' }, { service: { state: 'not-installed' } }]);
  assert.equal(await f.recover(), true);
  assert.deepEqual(f.calls, ['probe', 'restore-owned']);
});

test('an external answering loopback resolver is preserved after own services stop', async () => {
  const f = fixture([{ serviceState: 'stopped' }, { service: { state: 'not-installed' } }], { active: true, healthy: true });
  assert.equal(await f.recover(), false);
  assert.deepEqual(f.calls, ['probe']);
});

test('no ownership journal result is not reported as a successful recovery', async () => {
  const f = fixture([{ serviceState: 'not-installed' }, { service: { state: 'stopped' } }], undefined, { restored: 0, pendingAdapters: 1 });
  assert.equal(await f.recover(), false);
  assert.deepEqual(f.calls, ['probe', 'restore-owned']);
});
