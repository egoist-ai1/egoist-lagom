import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { z } from 'zod';
import { loadRecovered, sourceFor } from './load-recovered.mjs';

const logger = { info() {}, warn() {}, error() {} };
const { StateStore } = loadRecovered('electron/ipc/state-store', {
  promises: fs, path, process, randomUUID, logger,
  normalizePersistedDisplayText: state => state,
  normalizeCustomDnsUrl: value => value || '',
  normalizeSystemDohUrl: value => value || '',
  normalizeSystemDohLocalAddress: value => value || '',
}, ['StateStore']);
const plain = value => JSON.parse(JSON.stringify(value));
const domain = (id, value = 'example.invalid', mode = 'vpn') => ({ id, domain: value, mode });
const processRule = (id, value = 'client.exe', mode = 'direct') => ({ id, process: value, mode });

async function fixture(t) {
  const base = path.resolve(process.env.LAGOM_TEST_TEMP || process.env.RUNNER_TEMP || os.tmpdir());
  const root = await fs.mkdtemp(path.join(base, 'lagom-rules-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(base + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const store = new StateStore(root);
  await store.load();
  const calls = { login: 0, logSettings: 0, runtime: 0 };
  const registered = new Map();
  const context = vm.createContext({
    z, path, process, promises: fs, structuredClone, URL, Buffer, console, promisify, execFile,
    setTimeout, clearTimeout, setInterval, clearInterval, logger,
    ipcMain: { handle: (channel, callback) => registered.set(channel, callback) },
    app: { getPath: () => root },
    syncWindowsLoginItemSettings: () => { calls.login += 1; },
    applyLoggerSettings: () => { calls.logSettings += 1; },
    ShieldConnectionController: class {}, CoreServiceClient: class {}, crypto: { randomUUID },
  });
  vm.runInContext(sourceFor('electron/ipc/ipc-schemas'), context);
  vm.runInContext(sourceFor('electron/ipc/handlers-system'), context);
  context.store = store;
  vm.runInContext('registerSystemHandlers({window:{},stateStore:store,runtimeManager:{on(){},start(){throw new Error("Unexpected runtime start");}}});', context);
  return { root, store, calls, invoke: (channel, input) => {
    assert.ok(registered.has(channel), `Actual handler ${channel} is registered`);
    return registered.get(channel)({}, input);
  } };
}
const patch = (invoke, rules, expectedRevision) => invoke('state:patch-rules', { patch: rules, expectedRevision });

test('rules IPC persists only supplied array; trims its fields and keeps legacy opposite list and other state', async t => {
  const { store, invoke, calls, root } = await fixture(t);
  await store.update(current => ({ ...current,
    domainRules: [domain('old-domain', ' geosite:legacy ', 'direct')],
    nodes: [{ id: 'node', name: 'Saved', metadata: { id: 'own-fixture' } }],
    subscriptions: [{ id: 'sub', url: 'https://own.invalid/sub' }],
    usageHistory: [{ id: 'usage', timestamp: 10 }],
  }));
  const before = plain(store.get());
  const result = await patch(invoke, { processRules: [processRule(' process-id ', ' client.exe ', 'block')] }, before.stateRevision);
  assert.equal(result.ok, true);
  assert.equal(result.conflict, false);
  assert.equal(result.revision, before.stateRevision + 1);
  assert.deepEqual(plain(result.state.processRules), [processRule('process-id', 'client.exe', 'block')]);
  for (const name of ['domainRules', 'nodes', 'subscriptions', 'usageHistory', 'settings', 'activeNodeId']) assert.deepEqual(plain(result.state[name]), before[name]);
  assert.deepEqual(calls, { login: 0, logSettings: 0, runtime: 0 });
  assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), plain(result.state));
  const reopened = new StateStore(root);
  await reopened.load();
  assert.deepEqual(plain(reopened.get().processRules), [processRule('process-id', 'client.exe', 'block')]);
});

test('domain/process/settings requests sharing one revision conflict and explicit retries preserve every confirmed change', async t => {
  const { store, invoke } = await fixture(t);
  const revision = store.getRevision();
  const [domains, processes, settings] = await Promise.all([
    patch(invoke, { domainRules: [domain('d')] }, revision),
    patch(invoke, { processRules: [processRule('p')] }, revision),
    invoke('state:patch-settings', { patch: { soundNotifications: true }, expectedRevision: revision }),
  ]);
  assert.equal([domains, processes, settings].filter(result => result.ok).length, 1);
  assert.equal([domains, processes, settings].filter(result => result.conflict && result.error === 'STATE_REVISION_CONFLICT').length, 2);
  assert.equal(domains.ok, true);
  const processRetry = await patch(invoke, { processRules: [processRule('p')] }, store.getRevision());
  assert.equal(processRetry.ok, true);
  const settingsRetry = await invoke('state:patch-settings', { patch: { soundNotifications: true }, expectedRevision: store.getRevision() });
  assert.equal(settingsRetry.ok, true);
  assert.deepEqual(plain(store.get().domainRules), [domain('d')]);
  assert.deepEqual(plain(store.get().processRules), [processRule('p')]);
  assert.equal(store.get().settings.soundNotifications, true);
  assert.equal(store.getRevision(), revision + 3);
  assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), plain(store.get()));
});

test('both arrays commit atomically; explicit empty list clears only the named type', async t => {
  const { store, invoke } = await fixture(t);
  const result = await patch(invoke, { domainRules: [domain('shared')], processRules: [processRule('shared')] }, store.getRevision());
  assert.equal(result.ok, true, 'IDs may coincide across the two distinct rule types');
  const next = await patch(invoke, { domainRules: [] }, result.revision);
  assert.equal(next.ok, true);
  assert.deepEqual(plain(next.state.domainRules), []);
  assert.deepEqual(plain(next.state.processRules), [processRule('shared')]);
});

test('rules acknowledge only after the real disk commit, with previous memory/disk visible during write barrier', async t => {
  const { store, invoke } = await fixture(t);
  const before = plain(store.get());
  const write = store.writeStateFile.bind(store);
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  store.writeStateFile = async serialized => { enter(); await gate; return write(serialized); };
  let acknowledged = false;
  const pending = patch(invoke, { domainRules: [domain('disk-first')] }, before.stateRevision).then(result => { acknowledged = true; return result; });
  await entered;
  assert.equal(acknowledged, false);
  assert.deepEqual(plain(store.get()), before);
  assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), before);
  release();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), plain(result.state));
});

test('actual NTFS unreadable destination blocks writes and keeps memory/revision; confirmed reload accepts retry', async t => {
  const { root, store, invoke, calls } = await fixture(t);
  const before = plain(store.get()), saved = path.join(root, 'saved-primary.json');
  await fs.rename(store.filePath, saved);
  await fs.mkdir(store.filePath); // A real directory blocks replacement of this own state file.
  const result = await patch(invoke, { domainRules: [domain('must-not-publish')] }, before.stateRevision);
  assert.equal(result.ok, false);
  assert.equal(result.conflict, false);
  assert.equal(result.error, 'STATE_STORAGE_UNAVAILABLE');
  assert.deepEqual(plain(store.get()), before);
  assert.equal(store.getRevision(), before.stateRevision);
  assert.deepEqual(JSON.parse(await fs.readFile(saved, 'utf8')), before);
  assert.deepEqual(calls, { login: 0, logSettings: 0, runtime: 0 });
  await fs.rmdir(store.filePath);
  await fs.rename(saved, store.filePath);
  await store.retryLoad();
  const retry = await patch(invoke, { domainRules: [domain('retry')] }, before.stateRevision);
  assert.equal(retry.ok, true);
  assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), plain(retry.state));
});

test('malformed/foreign/prototype/accessor rules are rejected before any disk write or hook', async t => {
  const { store, invoke, calls } = await fixture(t);
  const revision = store.getRevision(), before = plain(store.get());
  let writes = 0, getters = 0;
  const write = store.writeStateFile.bind(store);
  store.writeStateFile = async value => { writes += 1; return write(value); };
  const accessor = { id: 'd', mode: 'vpn' };
  Object.defineProperty(accessor, 'domain', { enumerable: true, get() { getters += 1; return 'example.invalid'; } });
  const foreignPrototype = Object.create({ domainRules: [domain('d')] });
  const hidden = domain('hidden');
  Object.defineProperty(hidden, 'domain', { value: 'hidden.invalid', enumerable: false });
  const symbolic = { ...domain('symbol'), [Symbol('foreign')]: true };
  const inheritedJson = Object.assign(Object.create(null), { toJSON() { getters += 1; return {}; } });
  const customRecord = Object.assign(Object.create(inheritedJson), domain('custom'));
  const customArray = [domain('custom-array')];
  const arrayPrototype = [];
  arrayPrototype.toJSON = inheritedJson.toJSON;
  Object.setPrototypeOf(customArray, arrayPrototype);
  const bad = [
    null, {}, { patch: { domainRules: [] } },
    { patch: {}, expectedRevision: revision },
    { patch: { settings: {} }, expectedRevision: revision },
    { patch: { nodes: [] }, expectedRevision: revision },
    { patch: { domainRules: [] }, expectedRevision: -1 },
    { patch: { domainRules: [] }, expectedRevision: 0.5 },
    { patch: { domainRules: [] }, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { patch: { domainRules: [] }, expectedRevision: revision, state: before },
    { patch: { domainRules: [domain('d'), domain(' d ')] }, expectedRevision: revision },
    { patch: { processRules: [processRule('p'), processRule('p')] }, expectedRevision: revision },
    { patch: { domainRules: [{ ...domain('d'), process: 'foreign.exe' }] }, expectedRevision: revision },
    { patch: { processRules: [{ ...processRule('p'), stateRevision: revision }] }, expectedRevision: revision },
    { patch: { domainRules: [{ ...domain('d'), mode: 'proxy' }] }, expectedRevision: revision },
    { patch: { domainRules: [domain(' ', 'example.invalid')] }, expectedRevision: revision },
    { patch: { domainRules: [domain('d', ' \t ')] }, expectedRevision: revision },
    { patch: { processRules: [processRule('p', 'client\0.exe')] }, expectedRevision: revision },
    { patch: { domainRules: [domain('d', 'example.invalid\n')] }, expectedRevision: revision },
    { patch: { domainRules: [domain('d', 'bad\u0085.invalid')] }, expectedRevision: revision },
    { patch: { domainRules: [domain('d', 'bad\u2028.invalid')] }, expectedRevision: revision },
    { patch: { domainRules: [domain('x'.repeat(129))] }, expectedRevision: revision },
    { patch: { domainRules: [domain('d', 'x'.repeat(513))] }, expectedRevision: revision },
    { patch: { processRules: [processRule('p', 'x'.repeat(513))] }, expectedRevision: revision },
    { patch: { domainRules: [accessor] }, expectedRevision: revision },
    { patch: { domainRules: [hidden] }, expectedRevision: revision },
    { patch: { domainRules: [symbolic] }, expectedRevision: revision },
    { patch: { domainRules: [customRecord] }, expectedRevision: revision },
    { patch: { domainRules: customArray }, expectedRevision: revision },
    { patch: foreignPrototype, expectedRevision: revision },
    JSON.parse(`{"patch":{"domainRules":[],"__proto__":{}},"expectedRevision":${revision}}`),
    JSON.parse(`{"patch":{"domainRules":[{"id":"d","domain":"example.invalid","mode":"vpn","constructor":{}}]},"expectedRevision":${revision}}`),
  ];
  for (const input of bad) await assert.rejects(() => invoke('state:patch-rules', input));
  assert.equal(writes, 0);
  assert.equal(getters, 0);
  assert.deepEqual(calls, { login: 0, logSettings: 0, runtime: 0 });
  assert.deepEqual(plain(store.get()), before);
  assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), before);
});

test('UTF-8 payload and per-type count bounds reject excess while valid 256-rule boundary persists', async t => {
  const { store, invoke } = await fixture(t);
  const rules = Array.from({ length: 256 }, (_, index) => domain(`d-${index}`));
  const result = await patch(invoke, { domainRules: rules }, store.getRevision());
  assert.equal(result.ok, true);
  const before = plain(store.get());
  await assert.rejects(() => patch(invoke, { domainRules: [...rules, domain('d-extra')] }, store.getRevision()));
  const large = Array.from({ length: 200 }, (_, index) => domain(`unicode-${index}`, 'я'.repeat(200)));
  const raw = { patch: { domainRules: large }, expectedRevision: store.getRevision() };
  assert.ok(Buffer.byteLength(JSON.stringify(raw), 'utf8') > 60 * 1024);
  await assert.rejects(() => invoke('state:patch-rules', raw));
  assert.deepEqual(plain(store.get()), before);
});

test('queued store rule patch snapshots its own input and preserves intervening node/subscription updates', async t => {
  const { store } = await fixture(t);
  const incoming = { domainRules: [domain('stable')] };
  const revision = store.getRevision();
  const pending = store.patchRules(incoming, revision);
  incoming.domainRules[0].domain = 'changed-after-call.invalid';
  incoming.domainRules.push(domain('added-after-call'));
  await Promise.all([
    pending,
    store.update(current => ({ ...current, nodes: [{ id: 'new-node' }] })),
    store.update(current => ({ ...current, subscriptions: [{ id: 'new-sub' }] })),
  ]);
  assert.deepEqual(plain(store.get().domainRules), [domain('stable')]);
  assert.equal(store.get().nodes[0].id, 'new-node');
  assert.equal(store.get().subscriptions[0].id, 'new-sub');
  assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), plain(store.get()));
});

test('direct store rules API also requires revision and refuses full snapshot fields', async t => {
  const { store } = await fixture(t);
  const before = plain(store.get());
  const missing = await store.patchRules({ domainRules: [] });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'STATE_REVISION_REQUIRED');
  const foreign = await store.patchRules({ domainRules: [], settings: { autoStart: true } }, before.stateRevision);
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error, 'STATE_RULES_INVALID');
  assert.deepEqual(plain(store.get()), before);
});

test('100 real queued commits with 40 explicit CAS conflicts retain rules/settings and every independent node/subscription', async t => {
  const { store, invoke } = await fixture(t);
  const initial = store.getRevision(); let conflicts = 0;
  for (let batch = 0; batch < 20; batch += 1) {
    const revision = store.getRevision(), id = `batch-${batch}`;
    const [domains, processes, settings] = await Promise.all([
      patch(invoke, { domainRules: [domain(id)] }, revision),
      patch(invoke, { processRules: [processRule(id)] }, revision),
      invoke('state:patch-settings', { patch: { notifications: batch % 2 === 0 }, expectedRevision: revision }),
      store.update(current => ({ ...current, nodes: [...current.nodes, { id }] })),
      store.update(current => ({ ...current, subscriptions: [...current.subscriptions, { id }] })),
    ]);
    assert.equal(domains.ok, true);
    assert.equal(processes.conflict, true); assert.equal(settings.conflict, true); conflicts += 2;
    const processRetry = await patch(invoke, { processRules: [processRule(id)] }, store.getRevision());
    assert.equal(processRetry.ok, true);
    const settingsRetry = await invoke('state:patch-settings', { patch: { notifications: batch % 2 === 0 }, expectedRevision: store.getRevision() });
    assert.equal(settingsRetry.ok, true);
    assert.deepEqual(plain(store.get().domainRules), [domain(id)]);
    assert.deepEqual(plain(store.get().processRules), [processRule(id)]);
    assert.equal(store.get().nodes.length, batch + 1);
    assert.equal(store.get().subscriptions.length, batch + 1);
    assert.equal(store.get().settings.notifications, batch % 2 === 0);
  }
  assert.equal(conflicts, 40);
  assert.equal(store.getRevision(), initial + 100);
  assert.equal(new Set(store.get().nodes.map(node => node.id)).size, 20);
  assert.equal(new Set(store.get().subscriptions.map(sub => sub.id)).size, 20);
  assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), plain(store.get()));
});

test('actual preload forwards only patch and captured revision through the exact new channel', async () => {
  let api; const calls = [];
  vm.runInNewContext(await fs.readFile('src/recovered/preload.cjs', 'utf8'), { require: () => ({
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } },
  }) });
  const result = await api.state.patchRules({ domainRules: [domain('d')] }, 12);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(calls), [['state:patch-rules', { patch: { domainRules: [domain('d')] }, expectedRevision: 12 }]]);
});
