import test from 'node:test';
import assert from 'node:assert/strict';
import { ShieldConnectionController } from '../src/shield-connection-controller.js';

function fixture(overrides = {}) {
  const calls = [], events = [];
  let running = false, dnsRunning = false;
  const deps = {
    coordinate: async (_action, operation) => operation(),
    onProgress: event => events.push(event),
    vpn: { status: async () => ({ connected: false }) },
    zapret: {
      status: async () => ({ serviceRunning: running }),
      autoSelectBestProfile: async progress => { calls.push('select'); progress({ phase: 'profile-start', index: 1, total: 22, profile: 'ALT11' }); return { completed: true, bestProfile: 'ALT11' }; },
      installService: async () => { calls.push('install'); },
      startService: async () => { calls.push('start'); running = true; },
      stopService: async () => { calls.push('stop'); running = false; },
      stopStandalone: async () => { calls.push('stop-standalone'); },
      cancelAutoSelect: async () => { calls.push('cancel'); }
    },
    dns: { status: async () => ({ running: dnsRunning, serviceRunning: dnsRunning, verified: dnsRunning }) },
    applyDns: async () => { calls.push('dns'); dnsRunning = true; return { ok: true }; },
    resetDns: async () => { calls.push('reset-dns'); dnsRunning = false; return { ok: true }; },
    saveConnected: async () => { calls.push('save'); }
  };
  Object.assign(deps, overrides);
  return { controller: new ShieldConnectionController(deps), deps, calls, events };
}

test('one connection transaction establishes DNS foundation before selecting and starting addons', async () => {
  const { controller, calls, events } = fixture();
  assert.equal((await controller.connect()).ok, true);
  assert.deepEqual(calls, ['dns', 'select', 'install', 'start', 'save']);
  assert.equal(events.at(-1).busy, false);
  assert.equal(events.at(-1).phase, 'connected');
  assert.equal((await controller.status()).dnsRunning, true);
});

test('inactive DNS is enabled before auto-select without deleting its resolver', async () => {
  const { controller, deps, calls } = fixture();
  let resolverRunning = false;
  deps.dns.status = async () => ({ running: resolverRunning, serviceRunning: resolverRunning, verified: resolverRunning });
  deps.dns.stopAndRemove = async () => { calls.push('stop-dns'); resolverRunning = false; return { ok: true, running: false }; };
  deps.applyDns = async () => { calls.push('dns'); resolverRunning = true; return { ok: true }; };
  assert.equal((await controller.connect()).ok, true);
  assert.deepEqual(calls, ['dns', 'select', 'install', 'start', 'save']);
});

test('configured stopped DNS blocks auto-select while preserving its service and intent', async () => {
  const { controller, deps, calls } = fixture();
  deps.dns.status = async () => ({ running: false, serviceRunning: false, verified: false, enabled: true, serviceInstalled: true });
  deps.dns.stopAndRemove = async () => { calls.push('stop-dns'); throw new Error('DNS ownership is pending'); };
  assert.equal((await controller.connect()).ok, false);
  assert.deepEqual(calls, []);
});

test('unverified but running DoH service is preserved during auto-select preparation', async () => {
  const { controller, deps, calls } = fixture();
  deps.dns.status = async () => ({ running: false, verified: false, serviceRunning: true });
  deps.dns.stopAndRemove = async () => { calls.push('stop-dns'); return { ok: true }; };
  assert.equal((await controller.connect()).ok, false);
  assert.deepEqual(calls, []);
  assert.match(controller.state.error, /не будет останавливать/);
});

test('unverified running owned DNS is preserved and blocks auto-select', async () => {
  const { controller, deps, calls } = fixture();
  let resolverRunning = true;
  let resolverVerified = false;
  deps.dns.status = async () => ({ running: resolverRunning, serviceRunning: resolverRunning, verified: resolverVerified });
  deps.dns.stopAndRemove = async () => { calls.push('stop-dns'); resolverRunning = false; resolverVerified = false; return { ok: true }; };
  deps.applyDns = async () => { calls.push('dns'); resolverRunning = true; resolverVerified = true; return { ok: true }; };
  assert.equal((await controller.connect()).ok, false);
  assert.deepEqual(calls, []);
  assert.equal(resolverRunning, true);
  assert.equal(resolverVerified, false);
});

test('unknown verification of running DNS is preserved and blocks auto-select', async () => {
  const { controller, deps, calls } = fixture();
  let resolverRunning = true;
  deps.dns.status = async () => ({ running: resolverRunning, serviceRunning: resolverRunning, verified: calls.includes('dns') ? resolverRunning : undefined });
  deps.dns.stopAndRemove = async () => { calls.push('stop-dns'); resolverRunning = false; return { ok: true }; };
  deps.applyDns = async () => { calls.push('dns'); resolverRunning = true; return { ok: true }; };
  assert.equal((await controller.connect()).ok, false);
  assert.deepEqual(calls, []);
  assert.equal(resolverRunning, true);
});

test('missing DNS readback blocks auto-select after recovery', async () => {
  const { controller, deps, calls } = fixture();
  deps.dns.stopAndRemove = async () => { calls.push('stop-dns'); return { ok: true }; };
  let reads = 0;
  deps.dns.status = async () => (++reads === 1 ? { running: false, serviceRunning: false, verified: false } : null);
  assert.equal((await controller.connect()).ok, false);
  assert.deepEqual(calls, ['dns']);
  assert.match(controller.state.error, /DNS не прошёл проверку/);
});

test('status keeps the last healthy component snapshot when a status probe is temporarily unavailable', async () => {
  const { controller, deps } = fixture();
  await controller.status();
  deps.zapret.status = async () => { throw new Error('Core unavailable'); };
  deps.dns.status = async () => ({ running: true, verified: true });
  const status = await controller.status();
  assert.equal(status.running, false);
  assert.equal(status.dnsRunning, true);
  assert.equal(status.statusError, 'Zapret: Core unavailable');
  assert.equal(status.error, 'Zapret: Core unavailable');
});

test('status returns an unavailable snapshot instead of rejecting when both probes fail', async () => {
  const { controller, deps } = fixture({
    zapret: { status: async () => { throw new Error('Zapret query failed'); } },
    dns: { status: async () => { throw new Error('DNS query failed'); } }
  });
  const status = await controller.status();
  assert.equal(status.running, null);
  assert.equal(status.dnsRunning, null);
  assert.equal(status.statusError, 'Zapret: Zapret query failed; DNS: DNS query failed');
});

test('double clicks share one promise and do not spawn a second candidate or service', async () => {
  const { controller, calls } = fixture();
  const first = controller.connect();
  assert.equal(controller.connect(), first);
  assert.equal((await controller.disconnect()).ok, false);
  await first;
  assert.equal(calls.filter(call => call === 'select').length, 1);
});

test('unconfirmed selection never falls back to an arbitrary profile', async () => {
  const { controller, deps, calls } = fixture();
  deps.zapret.autoSelectBestProfile = async () => ({ completed: true, bestProfile: null });
  assert.equal((await controller.connect()).ok, false);
  assert.deepEqual(calls, ['dns']);
  assert.equal((await controller.status()).dnsRunning, true, 'Failed addon selection keeps initialized DNS');
  assert.equal(controller.state.phase, 'error');
});

test('a DNS result with ok:false prevents any addon startup without resetting DNS', async () => {
  const { controller, calls } = fixture({ applyDns: async () => ({ ok: false, message: 'Resolver unavailable' }) });
  assert.equal((await controller.connect()).ok, false);
  assert.deepEqual(calls, []);
  assert.equal(controller.state.error, 'Resolver unavailable');
});

test('partial DNS apply failure preserves its candidate and prevents addon startup', async () => {
  let candidateRunning = false;
  const { controller, calls } = fixture({
    dns: { status: async () => ({ running: false, serviceRunning: candidateRunning, verified: false, enabled: candidateRunning }) },
    applyDns: async () => { candidateRunning = true; throw new Error('settings persistence failed'); },
    resetDns: async () => { throw new Error('implicit reset must never execute'); }
  });
  const result = await controller.connect();
  assert.equal(result.ok, false);
  assert.match(result.message, /settings persistence failed/);
  assert.deepEqual(calls, []);
  assert.equal(candidateRunning, true);
  assert.equal((await controller.status()).running, false);
});

test('cancellation waits for the pending selection and never installs its winner', async () => {
  let release;
  const { controller, deps, calls } = fixture();
  deps.zapret.autoSelectBestProfile = () => new Promise(resolve => { release = resolve; });
  const pending = controller.connect();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await controller.cancel();
  assert.equal(controller.state.busy, true);
  release({ completed: true, bestProfile: 'ALT11' });
  assert.equal((await pending).cancelled, true);
  assert.deepEqual(calls, ['dns', 'cancel']);
});

test('DNS opt-out skips initial activation and disconnect stops only bypass addons', async () => {
  const { controller, calls } = fixture();
  await controller.connect({ dnsEnabled: false });
  assert.deepEqual(calls, ['select', 'install', 'start', 'save']);
  calls.length = 0;
  assert.equal((await controller.disconnect()).ok, true);
  assert.deepEqual(calls, ['stop-standalone', 'stop']);
});

test('addon disconnect does not depend on or attempt DNS restoration', async () => {
  const { controller, deps, calls } = fixture();
  await controller.connect();
  deps.resetDns = async () => { throw new Error('DNS reset is explicitly forbidden'); };
  calls.length = 0;
  assert.equal((await controller.disconnect()).ok, true);
  assert.deepEqual(calls, ['stop-standalone', 'stop']);
  const status = await controller.status();
  assert.equal(status.running, false);
  assert.equal(status.dnsRunning, true);
});
