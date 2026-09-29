import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRecovered } from './load-recovered.mjs';

const { buildNetworkModuleInspectors } = loadRecovered('electron/ipc/handlers', {}, ['buildNetworkModuleInspectors']);

function inspectors(zapret, telegram) {
  return buildNetworkModuleInspectors({
    zapretManager: { status: async () => zapret },
    telegramProxyManager: { status: async () => telegram },
  });
}

test('a running Zapret wrapper without its worker is degraded and retains interception locks', async () => {
  const result = await inspectors({ serviceRunning: true, runtimeReady: false }, {}).zapret();
  assert.equal(result.status, 'degraded');
  assert.equal(result.health, 'warn');
  assert.deepEqual(Array.from(result.ownedLocks), ['packet-interception', 'windivert']);
});

test('a running Telegram wrapper without its listener retains its port reservation', async () => {
  const result = await inspectors({}, { serviceRunning: true, running: false, runtimeReady: false })['telegram-proxy']();
  assert.equal(result.status, 'degraded');
  assert.equal(result.health, 'warn');
  assert.deepEqual(Array.from(result.ownedLocks), ['telegram-proxy-port']);
});

test('confirmed ready runtimes are active while genuinely stopped runtimes release locks', async () => {
  const ready = inspectors({ serviceRunning: true, runtimeReady: true }, { serviceRunning: true, running: true, runtimeReady: true });
  assert.equal((await ready.zapret()).status, 'active');
  assert.equal((await ready['telegram-proxy']()).status, 'active');
  const stopped = inspectors({ serviceRunning: false, runtimeReady: false }, { running: false, serviceRunning: false, runtimeReady: false });
  assert.equal((await stopped.zapret()).ownedLocks.length, 0);
  assert.equal((await stopped['telegram-proxy']()).ownedLocks.length, 0);
});

test('failed inspection preserves potential ownership instead of authorizing a conflict', async () => {
  const f = buildNetworkModuleInspectors({
    zapretManager: { status: async () => { throw new Error('SCM is unavailable'); } },
    telegramProxyManager: { status: async () => ({ running: false, serviceState: 'unknown' }) },
  });
  for (const [id, locks] of [['zapret', ['packet-interception', 'windivert']], ['telegram-proxy', ['telegram-proxy-port']]]) {
    const result = await f[id]();
    assert.equal(result.status, 'degraded');
    assert.deepEqual(Array.from(result.ownedLocks), locks);
    assert.ok(result.blockers.length > 0);
  }
});

test('configured DoH with a failed verification is degraded and keeps DNS ownership', async () => {
  const modules = buildNetworkModuleInspectors({
    stateStore: { get: () => ({ settings: { systemDohEnabled: true } }) },
    gravitylessDnsManager: { status: async () => ({ running: false, serviceState: 'not-installed' }) },
    systemDohManager: { status: async () => ({ running: false, serviceRunning: true, serviceState: 'running' }) },
  });
  const dns = await modules.dns();
  assert.equal(dns.status, 'degraded');
  assert.equal(dns.health, 'warn');
  assert.deepEqual(Array.from(dns.ownedLocks), ['dns', 'dns-verify']);
});
