import test from 'node:test';
import assert from 'node:assert/strict';
import { ShieldConnectionController } from '../src/shield-connection-controller.js';

function fixture({ telegramRunning = false } = {}) {
  const calls = [];
  const state = { vpn: false, zapret: false, dns: false, telegram: telegramRunning };
  const deps = {
    coordinate: async (_action, operation) => operation(),
    vpn: {
      status: async () => ({ connected: state.vpn }),
      disconnect: async () => { calls.push('vpn-stop'); state.vpn = false; return { connected: false }; }
    },
    zapret: {
      status: async () => ({ serviceRunning: state.zapret, standaloneRunning: false, serviceProfile: 'ALT11' }),
      autoSelectBestProfile: async () => ({ completed: true, bestProfile: 'ALT11' }),
      installService: async () => { calls.push('zapret-install'); },
      startService: async () => { calls.push('zapret-start'); state.zapret = true; },
      stopStandalone: async () => {},
      stopService: async () => { calls.push('zapret-stop'); state.zapret = false; }
    },
    dns: { status: async () => ({ running: state.dns, verified: state.dns }) },
    applyDns: async () => { state.dns = true; return { ok: true }; },
    resetDns: async () => { calls.push('dns-reset'); state.dns = false; return { ok: true }; },
    telegramProxy: {
      status: async () => ({ running: state.telegram, serviceRunning: state.telegram }),
      // The production install method installs AND starts, returning a status snapshot.
      installService: async () => { calls.push('tg-install'); state.telegram = true; return { running: true, serviceRunning: true }; },
      startService: async () => { calls.push('tg-start'); state.telegram = true; return { running: true, serviceRunning: true }; },
      stopService: async () => { calls.push('tg-stop'); state.telegram = false; return { running: false, serviceRunning: false }; },
      openConnectionLink: async () => { calls.push('tg-link'); return { ok: true }; }
    },
    saveConnected: async () => { calls.push('save'); }
  };
  return { controller: new ShieldConnectionController(deps), deps, calls, state };
}

for (const failure of ['throws', 'failed-result', 'not-running']) {
  test(`Telegram install ${failure} cannot publish connected and rolls back new components`, async () => {
    const { controller, deps, calls, state } = fixture();
    deps.telegramProxy.installService = async () => {
      if (failure === 'throws') throw new Error('TG runtime unavailable');
      if (failure === 'failed-result') return { ok: false, message: 'TG install denied' };
      return { running: false, serviceRunning: false, lastError: 'TG failed to start' };
    };
    assert.equal((await controller.connect()).ok, false);
    assert.equal(calls.includes('save'), false);
    assert.equal(calls.includes('tg-link'), false);
    assert.equal(state.zapret, false);
    assert.equal(state.dns, false);
  });
}

test('an existing Telegram proxy is not restarted or stopped by a failed connection', async () => {
  const { controller, deps, calls, state } = fixture({ telegramRunning: true });
  deps.saveConnected = async () => { throw new Error('Settings write failed'); };
  assert.equal((await controller.connect()).ok, false);
  assert.equal(state.telegram, true);
  assert.equal(calls.includes('tg-install'), false);
  assert.equal(calls.includes('tg-start'), false);
  assert.equal(calls.includes('tg-stop'), false);
});

test('verified Telegram service remains a successful connection when the client link cannot open', async () => {
  const { controller, deps, state } = fixture();
  deps.telegramProxy.openConnectionLink = async () => { throw new Error('No Telegram client'); };
  assert.equal((await controller.connect()).ok, true);
  assert.equal(state.telegram, true);
});

for (const failure of ['throws', 'failed-result', 'still-running']) {
  test(`Telegram stop ${failure} cannot publish a successful disconnect`, async () => {
    const { controller, deps, state } = fixture({ telegramRunning: true });
    state.zapret = true;
    deps.telegramProxy.stopService = async () => {
      if (failure === 'throws') throw new Error('TG stop denied');
      if (failure === 'failed-result') return { ok: false, message: 'TG stop denied' };
      return { running: true, serviceRunning: true };
    };
    assert.equal((await controller.disconnect()).ok, false);
    assert.equal(controller.state.phase, 'error');
    assert.equal(state.telegram, true);
  });
}

test('Telegram rollback that leaves a running proxy is reported', async () => {
  const { controller, deps, state } = fixture();
  deps.saveConnected = async () => { throw new Error('Settings write failed'); };
  deps.telegramProxy.stopService = async () => ({ running: true, serviceRunning: true });
  const result = await controller.connect();
  assert.equal(result.ok, false);
  assert.match(result.message, /Восстановление требует внимания/);
  assert.equal(state.telegram, true);
});

test('failed Telegram status is visible alongside the last known snapshot', async () => {
  const { controller, deps } = fixture({ telegramRunning: true });
  await controller.status();
  deps.telegramProxy.status = async () => { throw new Error('TG query unavailable'); };
  const result = await controller.status();
  assert.equal(result.telegramRunning, true);
  assert.match(result.statusError, /Telegram: TG query unavailable/);
});

test('Telegram status failure during preflight does not change any services', async () => {
  const { controller, deps, calls } = fixture();
  deps.telegramProxy.status = async () => { throw new Error('TG query unavailable'); };
  assert.equal((await controller.connect()).ok, false);
  assert.deepEqual(calls, []);
});

test('Telegram verification bypasses the cached pre-install status', async () => {
  const { controller, deps, state } = fixture();
  deps.telegramProxy.status = async options => ({ running: options?.force ? state.telegram : false, serviceRunning: options?.force ? state.telegram : false });
  assert.equal((await controller.connect()).ok, true);
});

test('a partially successful Telegram installation is stopped on rollback', async () => {
  const { controller, deps, state, calls } = fixture();
  deps.telegramProxy.installService = async () => {
    state.telegram = true;
    throw new Error('TG persistence verification failed');
  };
  assert.equal((await controller.connect()).ok, false);
  assert.equal(state.telegram, false);
  assert.equal(calls.includes('tg-stop'), true);
});

test('an already running but explicitly unverified DNS cannot report a healthy connection', async () => {
  const { controller, deps, calls, state } = fixture();
  state.dns = true;
  deps.dns.status = async () => ({ running: true, verified: false, lastError: 'DNS verification failed' });
  assert.equal((await controller.connect()).ok, false);
  assert.equal(calls.includes('save'), false);
  assert.equal(calls.includes('dns-reset'), false);
  assert.equal(state.dns, true);
});
