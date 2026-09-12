import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { sourceFor, loadRecovered } from './load-recovered.mjs';

test('a timed-out boot repair cannot overlap a new network action', async () => {
  const source = sourceFor('electron/main');
  const start = source.indexOf('async function withBootDeadline(');
  const end = source.indexOf('/** Общий бюджет', start);
  const pendingBootRecovery = new Set();
  const context = vm.createContext({ pendingBootRecovery, Promise, setTimeout, clearTimeout,
    logger: { error() {}, warn() {} } });
  vm.runInContext(source.slice(start, end), context);
  const { NetworkCombinatorManager } = loadRecovered('electron/ipc/network-combinator-manager', {}, ['NetworkCombinatorManager']);
  const manager = new NetworkCombinatorManager({ isElevated: async () => true, isNetworkReady: () => pendingBootRecovery.size === 0 });
  manager.inspect = async () => ({ modules: [] });
  let finish;
  let repaired = false;
  let connected = false;
  const repair = new Promise(resolve => { finish = () => { repaired = true; resolve(true); }; });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    assert.equal(await context.withBootDeadline('network', 5, () => repair), null);
    const intent = { module: 'vpn', action: 'connect', requiredLocks: ['traffic-route'] };
    await assert.rejects(manager.runCoordinatedMutation(intent, async () => { connected = true; }), /восстановление сети/);
    assert.equal(connected, false);
    finish();
    await Promise.allSettled([...pendingBootRecovery]);
    await manager.runCoordinatedMutation(intent, async () => { assert.equal(repaired, true); connected = true; });
    assert.equal(connected, true);
    assert.equal(pendingBootRecovery.size, 0);
  } finally { finish(); clearTimeout(keepAlive); }
});
