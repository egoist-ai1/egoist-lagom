import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRecovered } from './load-recovered.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function coordinator(options = {}) {
  const { NetworkCombinatorManager } = loadRecovered('electron/ipc/network-combinator-manager', {
    buildNetworkCombinatorInspection: ({ modules }) => ({ modules })
  }, ['NetworkCombinatorManager']);
  return new NetworkCombinatorManager({ isElevated: async () => true, ...options });
}

const intent = (action, locks = ['adapter-dns']) => ({ module: 'dns', action, requiredLocks: locks, conflictsWith: [] });

test('idle guard covers the asynchronous owner inspection before any lock is held', { timeout: 1500 }, async t => {
  const inspection = deferred();
  t.after(() => inspection.resolve({ ownedLocks: [] }));
  const manager = coordinator({ moduleInspectors: { vpn: () => inspection.promise } });
  assert.equal(manager.isMutationIdle(), true);
  let operated = false;
  const pending = manager.runCoordinatedMutation(intent('apply'), async () => { operated = true; });
  assert.equal(manager.activeCoordinatedMutations.size, 0);
  assert.equal(manager.isMutationIdle(), false);
  inspection.resolve({ ownedLocks: [] });
  await pending;
  assert.equal(operated, true);
  assert.equal(manager.isMutationIdle(), true);
});

test('idle guard includes a queued caller and remains busy when the first caller finishes', { timeout: 1500 }, async t => {
  const firstEntered = deferred(), firstRelease = deferred(), secondEntered = deferred(), secondRelease = deferred(), queued = deferred();
  t.after(() => { firstRelease.resolve(); secondRelease.resolve(); });
  const manager = coordinator();
  const waitForRelease = manager.waitForMutationRelease.bind(manager);
  manager.waitForMutationRelease = timeout => { queued.resolve(); return waitForRelease(timeout); };
  const first = manager.runCoordinatedMutation(intent('first'), async () => { firstEntered.resolve(); await firstRelease.promise; });
  await firstEntered.promise;
  const second = manager.runCoordinatedMutation(intent('second'), async () => { secondEntered.resolve(); await secondRelease.promise; });
  await queued.promise;
  assert.equal(manager.activeCoordinatedMutations.size, 1);
  assert.equal(manager.isMutationIdle(), false);
  firstRelease.resolve();
  await first;
  assert.equal(manager.isMutationIdle(), false);
  await secondEntered.promise;
  secondRelease.resolve();
  await second;
  assert.equal(manager.isMutationIdle(), true);
  assert.equal(manager.activeCoordinatedMutations.size, 0);
  assert.equal(manager.mutationReleaseWaiters.size, 0);
});

test('finishing one independent mutation does not hide a still-running mutation', { timeout: 1500 }, async t => {
  const firstEntered = deferred(), firstRelease = deferred(), secondEntered = deferred(), secondRelease = deferred();
  t.after(() => { firstRelease.resolve(); secondRelease.resolve(); });
  const manager = coordinator();
  const first = manager.runCoordinatedMutation(intent('first', ['adapter-dns']), async () => { firstEntered.resolve(); await firstRelease.promise; });
  await firstEntered.promise;
  const second = manager.runCoordinatedMutation(intent('second', ['loopback-proxy']), async () => { secondEntered.resolve(); await secondRelease.promise; });
  await secondEntered.promise;
  assert.equal(manager.activeCoordinatedMutations.size, 2);
  firstRelease.resolve();
  await first;
  assert.equal(manager.isMutationIdle(), false);
  secondRelease.resolve();
  await second;
  assert.equal(manager.isMutationIdle(), true);
});

test('steady service ownership is idle, but a caller waiting for it is not', async () => {
  const manager = coordinator({ moduleInspectors: { vpn: async () => ({ ownedLocks: ['traffic-route'], activeMutations: [] }) } });
  const inspected = await manager.inspect();
  assert.ok(inspected.modules.some(module => module.ownedLocks.includes('traffic-route')));
  assert.equal(manager.isMutationIdle(), true);
  let operated = false;
  const pending = manager.runCoordinatedMutation({ ...intent('apply'), conflictsWith: ['traffic-route'], waitTimeoutMs: 20 }, async () => { operated = true; });
  assert.equal(manager.isMutationIdle(), false);
  await assert.rejects(pending, /Timed out/);
  assert.equal(operated, false);
  assert.equal(manager.isMutationIdle(), true);
  assert.equal(manager.activeCoordinatedMutations.size, 0);
});

test('failed owner inspection releases the idle guard without calling the operation', async () => {
  const inspection = deferred();
  const manager = coordinator({ moduleInspectors: { vpn: () => inspection.promise } });
  let operated = false;
  const pending = manager.runCoordinatedMutation(intent('apply'), async () => { operated = true; });
  assert.equal(manager.isMutationIdle(), false);
  inspection.reject(new Error('owner query failed'));
  await assert.rejects(pending, /owner query failed/);
  assert.equal(operated, false);
  assert.equal(manager.isMutationIdle(), true);
});

test('failed operation releases its existing locks and the whole-call idle guard', async () => {
  const manager = coordinator();
  await assert.rejects(manager.runCoordinatedMutation(intent('apply'), async () => {
    assert.equal(manager.isMutationIdle(), false);
    throw new Error('component failed');
  }), /component failed/);
  assert.equal(manager.isMutationIdle(), true);
  assert.equal(manager.activeCoordinatedMutations.size, 0);
  assert.equal(manager.mutationReleaseWaiters.size, 0);
});

test('boot-unready and malformed requests leave no outstanding idle guard', async () => {
  const unavailable = coordinator({ isNetworkReady: () => false });
  await assert.rejects(unavailable.runCoordinatedMutation(intent('apply'), async () => assert.fail('operation ran')), /восстановление сети/);
  assert.equal(unavailable.isMutationIdle(), true);
  const invalid = coordinator();
  await assert.rejects(invalid.runCoordinatedMutation(null, async () => assert.fail('operation ran')), { name: 'TypeError' });
  assert.equal(invalid.isMutationIdle(), true);
});

test('boot readiness lost during inspection releases the guard before rejecting', async () => {
  let ready = true;
  const inspection = deferred();
  const manager = coordinator({ isNetworkReady: () => ready, moduleInspectors: { vpn: () => inspection.promise } });
  const pending = manager.runCoordinatedMutation(intent('apply'), async () => assert.fail('operation ran'));
  assert.equal(manager.isMutationIdle(), false);
  ready = false;
  inspection.resolve({ ownedLocks: [] });
  await assert.rejects(pending, /восстановление сети/);
  assert.equal(manager.isMutationIdle(), true);
});

test('an inspection deadline releases the idle guard and a late reply cannot run the mutation', async () => {
  const inspection = deferred();
  const manager = coordinator({ moduleInspectors: { vpn: () => inspection.promise } });
  let operated = false;
  const pending = manager.runCoordinatedMutation({ ...intent('apply'), waitTimeoutMs: 20 }, async () => { operated = true; });
  assert.equal(manager.isMutationIdle(), false);
  await assert.rejects(pending, /Timed out inspecting/);
  assert.equal(manager.isMutationIdle(), true);
  inspection.resolve({ ownedLocks: [] });
  await new Promise(setImmediate);
  assert.equal(operated, false);
});
