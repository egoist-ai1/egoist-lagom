import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const sourcePath = process.env.LAGOM_BOOT_TEST_SOURCE
  ?? fileURLToPath(new URL('../src/recovered/electron/main.js', import.meta.url));
const source = fs.readFileSync(sourcePath, 'utf8');
const anchor = 'async function recoverBackgroundFeaturesAfterRendererLoad(loadedState) {';
const start = source.indexOf(anchor);
const end = source.indexOf('async function scheduleAutoConnectWhenNetworkReady(', start);
assert.ok(start >= 0 && end > start && source.indexOf(anchor, start + anchor.length) === -1,
  'Extract exactly the actual recovered background-recovery function');
// Only this declaration is compiled. Electron/main bootstrap is never evaluated.
const recovered = new vm.Script(source.slice(start, end), { filename: 'actual-boot-recovery-function' });
const options = { timeout: 1500 };
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(config = {}) {
  const calls = { intents: [], doh: 0, restore: 0, watchdog: 0, autoConnect: [], log: [] };
  const state = {
    settings: { systemDohEnabled: true, systemDohUrl: 'https://owned.invalid/dns-query',
      systemDohLocalAddress: '127.0.0.1', systemDnsServers: '', autoConnect: true },
    activeNodeId: 'owned-node'
  };
  const window = { destroyed: false, isDestroyed() { return this.destroyed; } };
  const context = vm.createContext({
    Promise, pendingBootRecovery: new Set(config.pending ? [config.pending.promise] : []),
    reconnectSupervisor: { generation: 7 }, mainWindow: window, isQuitting: false,
    globalStateStore: { get: () => state },
    isGravitylessLoopbackDnsRequest: value => value === '127.0.0.1',
    globalSystemDohManager: { async recover() { calls.doh++; return { verified: true }; } },
    globalGravitylessDnsManager: null,
    async restoreDnsIfLocalResolverIsDown() {
      calls.restore++;
      if (config.mutationError) throw config.mutationError;
    },
    scheduleAutoConnectWhenNetworkReady: (node, generation) => calls.autoConnect.push({ node, generation }),
    startDnsWatchdog: () => { calls.watchdog++; },
    logger: Object.fromEntries(['info', 'warn', 'error'].map(level =>
      [level, (...args) => calls.log.push({ level, message: args[0], error: args[1] })]))
  });
  context.globalNetworkCombinatorManager = config.withoutCoordinator ? null : {
    async runCoordinatedMutation(intent, operation) {
      calls.intents.push(JSON.parse(JSON.stringify(intent)));
      if (config.admission) await config.admission.promise;
      if (config.denial) throw config.denial;
      return operation();
    }
  };
  recovered.runInContext(context, { timeout: 250 });
  return { calls, state, window, context,
    run: () => context.recoverBackgroundFeaturesAfterRendererLoad(state) };
}
function assertIntent(f) {
  assert.deepEqual(f.calls.intents, [{ module: 'dns', action: 'boot-recovery',
    requiredLocks: ['dns', 'dns-verify'], conflictsWith: ['traffic-route'] }]);
}
function assertIndependent(f, expectedAutoConnect = [{ node: 'owned-node', generation: 7 }]) {
  assert.equal(f.calls.watchdog, 1, 'Independent GUI watchdog registration is reached');
  assert.deepEqual(f.calls.autoConnect, expectedAutoConnect);
}
function assertNoneStarted(f) {
  assert.equal(f.calls.doh, 0); assert.equal(f.calls.restore, 0);
  assert.equal(f.calls.watchdog, 0); assert.deepEqual(f.calls.autoConnect, []);
}
function assertDegraded(f, originalError) {
  assert.ok(f.calls.log.some(row => row.level === 'error' && row.error === originalError),
    'Original admission/mutation error remains logged');
  assert.ok(f.calls.log.some(row => row.level === 'warn' && row.message.includes('background recovery:degraded')));
  assert.equal(f.calls.log.some(row => row.message === '[boot] background recovery:complete'), false,
    'Denied or failed DNS recovery must not be called complete');
}

test('accepted recovery keeps existing DNS ownership intent and independent initialization', options, async () => {
  const f = fixture(); await f.run(); assertIntent(f);
  assert.equal(f.calls.doh, 1); assert.equal(f.calls.restore, 1); assertIndependent(f);
  assert.ok(f.calls.log.some(row => row.message === '[boot] background recovery:complete'));
});
test('denied admission initializes independent features without dispatching DNS recovery', options, async () => {
  const error = new Error('Owned admission refused'); const f = fixture({ denial: error });
  await f.run(); assertIntent(f); assert.equal(f.calls.doh, 0); assert.equal(f.calls.restore, 0);
  assertIndependent(f); assertDegraded(f, error);
});
test('mutation exception initializes independent features and retains a degraded result', options, async () => {
  const error = new Error('Owned mutation failed'); const f = fixture({ mutationError: error });
  await f.run(); assertIntent(f); assert.equal(f.calls.doh, 1); assert.equal(f.calls.restore, 1);
  assertIndependent(f); assertDegraded(f, error);
});
test('denied admission respects disabled autoConnect', options, async () => {
  const f = fixture({ denial: new Error('Owned admission refused') }); f.state.settings.autoConnect = false;
  await f.run(); assertIndependent(f, []); assert.equal(f.calls.doh, 0);
});
test('denied admission respects absent selected node', options, async () => {
  const f = fixture({ denial: new Error('Owned admission refused') }); f.state.activeNodeId = null;
  await f.run(); assertIndependent(f, []); assert.equal(f.calls.doh, 0);
});
test('pending boot repair still settles before admission or feature initialization', options, async () => {
  const pending = deferred(); const f = fixture({ pending }); const run = f.run();
  try { await turn(); assert.equal(f.calls.intents.length, 0); assertNoneStarted(f); }
  finally { pending.resolve(); }
  await run; assertIntent(f); assertIndependent(f);
});
test('allSettled still tolerates a rejected earlier boot repair', options, async () => {
  const pending = deferred(); const f = fixture({ pending }); const run = f.run();
  pending.reject(new Error('Owned earlier repair failed')); await run; assertIntent(f); assertIndependent(f);
});
for (const change of ['quit', 'destroy', 'replace']) {
  test(`no work starts when window ${change} occurs during pending boot repair`, options, async () => {
    const pending = deferred(); const f = fixture({ pending }); const run = f.run(); await turn();
    if (change === 'quit') f.context.isQuitting = true;
    else if (change === 'destroy') f.window.destroyed = true;
    else f.context.mainWindow = { isDestroyed: () => false };
    pending.resolve(); await run; assert.equal(f.calls.intents.length, 0); assertNoneStarted(f);
  });
}
for (const change of ['quit', 'destroy', 'replace']) {
  test(`no DNS or independent work starts when window ${change} occurs during admission`, options, async () => {
    const admission = deferred(); const f = fixture({ admission }); const run = f.run(); await turn();
    if (change === 'quit') f.context.isQuitting = true;
    else if (change === 'destroy') f.window.destroyed = true;
    else f.context.mainWindow = { isDestroyed: () => false };
    admission.resolve(); await run; assertIntent(f); assertNoneStarted(f);
  });
}
test('generation changed during refused admission cannot queue stale autoConnect', options, async () => {
  const admission = deferred(), error = new Error('Owned admission refused');
  const f = fixture({ admission, denial: error }); const run = f.run(); await turn();
  f.context.reconnectSupervisor.generation++; admission.resolve(); await run;
  assertIndependent(f, []); assert.equal(f.calls.doh, 0); assertDegraded(f, error);
});
test('manual autoConnect disable during admission is read after the await', options, async () => {
  const admission = deferred(); const f = fixture({ admission }); const run = f.run(); await turn();
  f.state.settings.autoConnect = false; admission.resolve(); await run; assertIndependent(f, []);
});
test('manual DNS disable during admission prevents the delayed recovery mutation', options, async () => {
  const admission = deferred(); const f = fixture({ admission }); const run = f.run(); await turn();
  f.state.settings.systemDohEnabled = false; admission.resolve(); await run;
  assert.equal(f.calls.doh, 0); assert.equal(f.calls.restore, 0); assertIndependent(f);
});
test('without a coordinator the existing direct recovery fallback remains usable', options, async () => {
  const f = fixture({ withoutCoordinator: true }); await f.run(); assert.equal(f.calls.intents.length, 0);
  assert.equal(f.calls.doh, 1); assert.equal(f.calls.restore, 1); assertIndependent(f);
});
test('direct recovery fallback failure does not omit independent initialization', options, async () => {
  const error = new Error('Owned direct recovery failed'); const f = fixture({ withoutCoordinator: true, mutationError: error });
  await f.run(); assertIndependent(f); assertDegraded(f, error);
});
test('a missing startup window cannot register background features or DNS recovery', options, async () => {
  const f = fixture(); f.context.mainWindow = null; await f.run();
  assert.equal(f.calls.intents.length, 0); assertNoneStarted(f);
});
test('accepted recovery with autoConnect disabled still registers the independent watchdog', options, async () => {
  const f = fixture(); f.state.settings.autoConnect = false; await f.run();
  assertIntent(f); assertIndependent(f, []);
});
