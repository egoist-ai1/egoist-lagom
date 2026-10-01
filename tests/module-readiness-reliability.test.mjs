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

function vpnInspectors(status) {
  return buildNetworkModuleInspectors({
    stateStore: { get: () => ({ settings: { zapretSuspendDuringVpn: true, killSwitch: true, routeMode: 'global' } }) },
    runtimeManager: { status: async () => status },
  });
}

test('an enabled background VPN retains route ownership until observed stopped and disabled', async () => {
  const background = { serviceInstalled: true, backgroundEnabled: true, serviceRunning: true, running: false, serviceState: 'running', startType: 'auto' };
  const cases = [background, { ...background, serviceRunning: false, serviceState: 'stopped' },
    { ...background, backgroundEnabled: false, serviceRunning: false, serviceState: 'stopped' }];
  for (const backgroundService of cases) {
    const result = await vpnInspectors({ connected: false, executionMode: 'background-service', lifecycle: 'failed', backgroundService }).vpn();
    assert.equal(result.status, 'degraded');
    assert.equal(result.health, 'warn');
    assert.deepEqual(Array.from(result.ownedLocks), ['traffic-route', 'dns-verify', 'zapret-suspend']);
  }
  const stopped = await vpnInspectors({ connected: false, lifecycle: 'idle', executionMode: 'none',
    backgroundService: { ...background, backgroundEnabled: false, running: false, serviceRunning: false, serviceState: 'stopped', startType: 'disabled' } }).vpn();
  assert.equal(stopped.ownedLocks.length, 0);
});

test('background SOCKS readiness does not claim a Windows system proxy or GUI kill switch', async () => {
  const status = { connected: true, executionMode: 'background-service', proxyPort: 10838, egressVerified: false,
    backgroundService: { serviceInstalled: true, backgroundEnabled: true, serviceRunning: true, running: true, serviceState: 'running', startType: 'auto' } };
  const modules = vpnInspectors(status);
  const result = await modules.vpn();
  assert.equal(result.health, 'warn');
  assert.equal(result.ownedLocks.includes('system-proxy'), false);
  assert.equal(result.ownedLocks.includes('firewall-kill-switch'), false);
  assert.equal((await modules['system-proxy']()).ownedLocks.length, 0);
  assert.equal((await modules.firewall()).ownedLocks.length, 0);
  const temporary = vpnInspectors({ connected: true, executionMode: 'temporary', proxyPort: 10809, egressVerified: true });
  assert.equal((await temporary['system-proxy']()).status, 'active');
  assert.equal((await temporary.firewall()).status, 'active');
});
