import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { loadRecovered, sourceFor } from './load-recovered.mjs';

const contract = loadRecovered('shared/dns-controller', {}, ['buildNetworkCombinatorInspection', 'buildNetworkCombinatorPlan', 'approveNetworkCombinatorPlan', 'buildNetworkVerificationReport']);
function createManager(options = {}, bindings = {}) {
  const context = vm.createContext({ ...contract, ...bindings, performance, setTimeout, clearTimeout, setInterval, clearInterval, Map, Set, console });
  const source = process.env.LAGOM_COORDINATOR_SOURCE ? fs.readFileSync(process.env.LAGOM_COORDINATOR_SOURCE, 'utf8') : sourceFor('electron/ipc/network-combinator-manager');
  vm.runInContext(source + '\n;globalThis.Manager = NetworkCombinatorManager;', context);
  return new context.Manager({ isElevated: async () => true, ...options });
}
const intent = action => ({ module: 'dns', action, summary: 'Own diagnostic plan', mutatesSystem: true, requiredLocks: ['dns'], conflictsWith: [], rollbackRequired: false });

test('diagnostic plan approval does not claim a network mutation, rollback, or connectivity verification', async () => {
  const manager = createManager();
  const plan = await manager.plan(intent('apply'));
  manager.approve(plan.planId);
  assert.equal(manager.apply(plan.planId).ok, false);
  assert.equal(manager.apply(plan.planId).applied, false);
  assert.equal(manager.rollback(plan.planId).ok, false);
  assert.equal(manager.verify(plan.planId).overall, 'skipped');
});

test('unobserved component state stays unknown', async () => {
  const manager = createManager();
  const observed = await manager.inspect();
  assert.ok(observed.modules.every(module => module.health === 'unknown' && module.status === 'unknown'));
});

test('coordinator cache expires by elapsed time after wall clock rollback', async () => {
  let wall = 100000000;
  let elapsed = 0;
  let inspected = 0;
  class FixtureDate extends Date { static now() { return wall; } }
  const manager = createManager({ elapsedNow: () => elapsed, moduleInspectors: { dns: async () => { inspected++; return { health: 'ok' }; } } }, { Date: FixtureDate });
  await manager.inspect();
  wall -= 86400000;
  elapsed = 3001;
  await manager.inspect();
  assert.equal(inspected, 2);
});

test('a forward wall clock correction does not prematurely cancel a bounded mutation', { timeout: 2000 }, async () => {
  let wall = 100000000;
  const began = performance.now();
  let inspections = 0;
  class FixtureDate extends Date { static now() { return wall; } }
  const manager = createManager({ moduleInspectors: { vpn: async () => {
    if (++inspections === 1) wall += 600000;
    return { ownedLocks: performance.now() - began < 30 ? ['traffic-route'] : [] };
  } } }, { Date: FixtureDate });
  let operations = 0;
  await manager.runCoordinatedMutation({ module: 'dns', action: 'probe', requiredLocks: ['dns'], conflictsWith: ['traffic-route'], waitTimeoutMs: 1000 }, async () => { operations++; });
  assert.equal(operations, 1);
  assert.ok(performance.now() - began < 1500);
});

test('diagnostic plan cache stays bounded across 2000 inputs and expires approvals', async () => {
  let elapsed = 0;
  const manager = createManager({ elapsedNow: () => elapsed });
  for (let index = 0; index < 2000; index++) await manager.plan(intent('probe-' + index));
  assert.equal(manager.plans.size, 64);
  const id = 'dns:probe-1999';
  manager.approve(id);
  elapsed = 300001;
  assert.throws(() => manager.apply(id), /Unknown network combinator plan/);
  assert.equal(manager.plans.size, 0);
});

test('the 129th coordinated mutation is refused while 128 operations are pending', { timeout: 4000 }, async () => {
  const manager = createManager();
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const operation = { module: 'dns', action: 'own-test', requiredLocks: ['dns'], conflictsWith: [] };
  const jobs = [manager.runCoordinatedMutation(operation, async () => { entered(); await held; })];
  await started;
  for (let index = 1; index < 128; index++) jobs.push(manager.runCoordinatedMutation(operation, async () => {}));
  const extra = manager.runCoordinatedMutation(operation, async () => {}).then(() => 'accepted', error => error.message);
  jobs.push(extra);
  try {
    const outcome = await Promise.race([extra, new Promise(resolve => setTimeout(() => resolve('still queued'), 50))]);
    assert.match(outcome, /Too many pending network operations/);
    assert.equal(manager.outstandingCoordinatedMutations, 128);
  } finally {
    release();
    await Promise.allSettled(jobs);
  }
  assert.equal(manager.outstandingCoordinatedMutations, 0);
  assert.equal(manager.mutationReleaseWaiters.size, 0);
});

test('network plan IPC rejects unbounded or ambiguous intent before caching', () => {
  const source = process.env.LAGOM_COORDINATOR_HANDLER_SOURCE ? fs.readFileSync(process.env.LAGOM_COORDINATOR_HANDLER_SOURCE, 'utf8') : sourceFor('electron/ipc/handlers-network-combinator');
  const context = vm.createContext({ Set });
  vm.runInContext(source + '\n;globalThis.parse = parseNetworkPlanIntent;', context);
  for (const invalid of [[], { ...intent('x'), action: 'x'.repeat(65) }, { ...intent('x'), summary: 'x'.repeat(1025) },
    { ...intent('x'), mutatesSystem: 'true' }, { ...intent('x'), unexpected: true },
    { ...intent('x'), requiredLocks: ['dns', 'dns'] }, { ...intent('x'), action: 'x\u0000y' }]) {
    assert.throws(() => context.parse(invalid));
  }
  assert.equal(context.parse(intent('dns-probe')).action, 'dns-probe');
});

test('background VPN transitions can suspend steady Zapret while retaining mutual exclusion with live mutations', async () => {
  const manager = createManager({ isElevated: async () => false,
    moduleInspectors: { zapret: async () => ({ ownedLocks: ['packet-interception', 'windivert'] }) } });
  for (const action of ['service-install', 'service-start', 'service-stop', 'service-remove']) {
    let ran = false;
    await manager.runCoordinatedMutation({ module: 'vpn', action, requiredLocks: ['traffic-route', 'zapret-suspend'],
      conflictsWith: ['packet-interception', 'windivert'], waitTimeoutMs: 100 }, async () => { ran = true; });
    assert.equal(ran, true, action);
  }
  let release;
  let entered;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const zapret = manager.runCoordinatedMutation({ module: 'zapret', action: 'start', requiredLocks: ['windivert'], conflictsWith: [] }, async () => { entered(); await held; });
  await started;
  try {
    await assert.rejects(manager.runCoordinatedMutation({ module: 'vpn', action: 'service-start', requiredLocks: ['traffic-route', 'zapret-suspend'],
      conflictsWith: ['windivert'], waitTimeoutMs: 50 }, async () => { assert.fail('Concurrent interception mutation was admitted'); }), /Timed out/);
  } finally { release(); await zapret; }
  await assert.rejects(manager.runCoordinatedMutation({ module: 'vpn', action: 'service-start', requiredLocks: ['traffic-route'],
    conflictsWith: ['windivert'], waitTimeoutMs: 50 }, async () => { assert.fail('Suspension ownership is required'); }), /Timed out/);
});
