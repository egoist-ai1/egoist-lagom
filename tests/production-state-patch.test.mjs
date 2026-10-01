import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { loadRecovered, sourceFor } from './load-recovered.mjs';

const silentLogger = { info() {}, warn() {}, error() {} };
const { StateStore } = loadRecovered('electron/ipc/state-store', {
  promises: fs, path, process, randomUUID, logger: silentLogger,
  normalizePersistedDisplayText: state => state,
  normalizeCustomDnsUrl: value => value || '',
  normalizeSystemDohUrl: value => value || '',
  normalizeSystemDohLocalAddress: value => value || '',
}, ['StateStore']);

const node = (id, subscriptionId) => ({
  id, name: id, protocol: 'vless', server: 'example.invalid', port: 443,
  uri: 'vless://not-a-user-credential@example.invalid', metadata: {},
  ...(subscriptionId ? { subscriptionId } : {}),
});
const sub = (id, url = `https://${id}.invalid/sub`) => ({ id, url, name: id, enabled: true, lastUpdated: null });
const plain = value => JSON.parse(JSON.stringify(value));

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP || os.tmpdir(), 'production-state-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new StateStore(root);
  await store.load();
  return { root, store };
}

function handlers(store, root, sync = () => {}) {
  const registered = new Map();
  const context = vm.createContext({
    z, path, process, promises: fs, structuredClone, URL, Buffer, console, promisify, execFile,
    setTimeout, clearTimeout, setInterval, clearInterval,
    logger: silentLogger, ipcMain: { handle: (channel, fn) => registered.set(channel, fn) },
    app: { getPath: () => root }, syncWindowsLoginItemSettings: sync,
    applyLoggerSettings() {},
    ShieldConnectionController: class { constructor(options) { this.options = options; } },
    CoreServiceClient: class {},
    crypto: { randomUUID },
  });
  vm.runInContext(sourceFor('electron/ipc/ipc-schemas'), context);
  vm.runInContext(sourceFor('electron/ipc/handlers-system'), context);
  vm.runInContext(sourceFor('electron/ipc/handlers-import'), context);
  context.store = store;
  context.testWindow = {};
  vm.runInContext('registerSystemHandlers({window:testWindow,stateStore:store,runtimeManager:{on(){}}}); registerImportHandlers({stateStore:store});', context);
  return { context, invoke: (name, ...args) => {
    assert.ok(registered.has(name), `Actual handler ${name} is registered`);
    return registered.get(name)({}, ...args);
  } };
}

test('R02: stale complete snapshot is rejected and the acknowledged node stays on disk', async t => {
  const { store } = await fixture(t);
  const stale = store.get();
  await store.update(current => ({ ...current, nodes: [...current.nodes, node('new-node')] }));
  stale.settings.notifications = false;
  await assert.rejects(() => store.set(stale, stale.stateRevision), error => error.code === 'STATE_REVISION_CONFLICT');
  assert.equal(store.get().nodes[0].id, 'new-node');
  assert.equal(JSON.parse(await fs.readFile(store.filePath, 'utf8')).nodes[0].id, 'new-node');
});

test('R02: complete replacement without a revision is refused', async t => {
  const { store } = await fixture(t);
  const next = store.get();
  delete next.stateRevision;
  await assert.rejects(() => store.set(next), error => error.code === 'STATE_REVISION_REQUIRED');
});

test('R02: disk revision survives reopen and stale IPC settings conflict explicitly', async t => {
  const { root, store } = await fixture(t);
  const stale = store.get();
  await store.update(current => ({ ...current, nodes: [node('saved')] }));
  const reopened = new StateStore(root);
  await reopened.load();
  assert.equal(reopened.get().stateRevision, store.get().stateRevision);
  const { invoke } = handlers(reopened, root);
  const result = await invoke('state:patch-settings', { patch: { notifications: false }, expectedRevision: stale.stateRevision });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(result.error, 'STATE_REVISION_CONFLICT');
  assert.equal(result.state.nodes[0].id, 'saved');
  assert.equal(result.revision, result.state.stateRevision);
});

test('R02: atomic settings, node and subscription operations preserve independent queued writes', async t => {
  const { root, store } = await fixture(t);
  const { invoke } = handlers(store, root);
  const revision = store.get().stateRevision;
  const results = await Promise.all([
    invoke('state:patch-settings', { patch: { notifications: false }, expectedRevision: revision }),
    store.update(current => ({ ...current, nodes: [...current.nodes, node('a', 'sub-a')] })),
    store.update(current => ({ ...current, subscriptions: [...current.subscriptions, sub('sub-a')] })),
  ]);
  assert.equal(results[0].ok, true);
  assert.equal(store.get().settings.notifications, false);
  assert.equal(store.get().nodes[0].id, 'a');
  assert.equal(store.get().subscriptions[0].id, 'sub-a');
  assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), plain(store.get()));
});

test('R02: node select, favorite, rename and deletion use fresh state while unrelated writes queue', async t => {
  const { root, store } = await fixture(t);
  await store.update(current => ({ ...current, nodes: [node('a'), node('b')], activeNodeId: 'a' }));
  const { invoke } = handlers(store, root);
  await Promise.all([
    invoke('node:select', { id: 'b' }),
    invoke('node:set-favorite', { id: 'b', favorite: true }),
    invoke('node:rename', 'b', 'Renamed B'),
    store.patchSettings({ soundNotifications: true }),
    store.update(current => ({ ...current, subscriptions: [sub('independent')] })),
  ]);
  assert.equal(store.get().activeNodeId, 'b');
  assert.equal(store.get().nodes[1].metadata.favorite, 'true');
  assert.equal(store.get().nodes[1].name, 'Renamed B');
  assert.equal(store.get().settings.soundNotifications, true);
  assert.equal(store.get().subscriptions[0].id, 'independent');
  const deleted = await invoke('node:delete', { id: 'b' });
  assert.equal(deleted.activeNodeId, 'a');
  assert.equal(deleted.subscriptions[0].id, 'independent');
  for (const [channel, payload] of [['node:select', {id:'gone'}], ['node:set-favorite', {id:'gone',favorite:true}], ['node:delete',{id:'gone'}]]) {
    await assert.rejects(() => invoke(channel, payload), /NODE_NOT_FOUND/);
  }
});

test('R02: failed disk write rolls back login item inside the serialized mutation', async t => {
  const { root, store } = await fixture(t);
  const loginStates = [];
  const { invoke } = handlers(store, root, ({ settings }) => loginStates.push(settings.autoStart));
  const before = plain(store.get());
  const write = store.writeStateFile.bind(store);
  let fail = true;
  store.writeStateFile = async value => {
    if (fail) { fail = false; throw new Error('Injected disk failure'); }
    return write(value);
  };
  const [failed, succeeded] = await Promise.all([
    invoke('state:patch-settings', {patch:{autoStart:true}, expectedRevision:before.stateRevision}),
    invoke('state:patch-settings', {patch:{notifications:false}, expectedRevision:before.stateRevision}),
  ]);
  assert.equal(failed.ok, false);
  assert.equal(failed.conflict, false);
  assert.equal(failed.error, 'STATE_WRITE_FAILED');
  assert.equal(succeeded.ok, true);
  assert.equal(store.get().settings.autoStart, false);
  assert.equal(store.get().settings.notifications, false);
  assert.deepEqual(loginStates, [true, false, false]);
  assert.equal(store.get().stateRevision, before.stateRevision + 1);
});

test('R02: login item failure cannot publish settings or advance the disk revision', async t => {
  const { root, store } = await fixture(t);
  const before = plain(store.get());
  const { invoke } = handlers(store, root, ({ settings }) => {
    if (settings.autoStart) throw new Error('Injected login item failure');
  });
  const result = await invoke('state:patch-settings', {patch:{autoStart:true}, expectedRevision:before.stateRevision});
  assert.equal(result.ok, false);
  assert.deepEqual(plain(store.get()), before);
  assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), before);
});

test('R02: IPC rejects missing revisions, foreign setting fields and stale full state before login writes', async t => {
  const { root, store } = await fixture(t);
  let syncs = 0;
  const { invoke } = handlers(store, root, () => { syncs += 1; });
  await assert.rejects(() => invoke('state:patch-settings', {patch:{notifications:false}}));
  await assert.rejects(() => invoke('state:patch-settings', {patch:{nodes:[]}, expectedRevision:store.get().stateRevision}));
  const stale = store.get();
  await store.patchSettings({ soundNotifications: true });
  await assert.rejects(() => invoke('state:set', stale), error => error.code === 'STATE_REVISION_CONFLICT');
  assert.equal(syncs, 0);
  assert.equal(store.get().settings.soundNotifications, true);
});

test('R06: confirmed second subscription ID deletes only that subscription and its nodes', async t => {
  const { root, store } = await fixture(t);
  await store.update(current => ({ ...current,
    subscriptions: [sub('first'), sub('second')], nodes: [node('a','first'),node('b','second')], activeNodeId:'b',
  }));
  const { invoke } = handlers(store, root);
  await Promise.all([
    invoke('subscription:delete-by-id', {id:'second'}),
    invoke('subscription:rename', 'https://first.invalid/sub', 'First retained'),
    store.patchSettings({ notifications:false }),
  ]);
  assert.deepEqual(store.get().subscriptions.map(item => item.id), ['first']);
  assert.equal(store.get().subscriptions[0].name, 'First retained');
  assert.deepEqual(store.get().nodes.map(item => item.id), ['a']);
  assert.equal(store.get().activeNodeId, 'a');
  assert.equal(store.get().settings.notifications, false);
});

test('R06: pending refresh cannot redirect or resurrect a confirmed deletion, including a same-URL replacement', async t => {
  const { root, store } = await fixture(t);
  const target = sub('target', 'https://provider.invalid/secret-sub');
  await store.update(current => ({ ...current, subscriptions:[sub('first'),target], nodes:[node('a','first'),node('b','target')] }));
  const { invoke, context } = handlers(store, root);
  let resolveResponse;
  context.readUrlText = () => new Promise(resolve => { resolveResponse = resolve; });
  context.getSubscriptionUserAgent = () => 'test';
  context.parseNodesFromText = () => ({ nodes:[node('incoming')], issues:[] });
  context.buildNodeFingerprint = item => item.id;
  context.preserveNodeIdentities = (_previous, incoming) => incoming;
  context.uniqueNodes = (_previous, incoming) => incoming;
  const pending = invoke('subscription:refresh-one', target.url);
  assert.equal(await invoke('subscription:delete-by-id', {id:target.id}), true);
  await store.update(current => ({ ...current, subscriptions:[...current.subscriptions,sub('replacement',target.url)] }));
  resolveResponse({ text:'own fixture', name:'old target', userinfo:{total:999} });
  await pending;
  assert.deepEqual(store.get().subscriptions.map(item => item.id), ['first','replacement']);
  assert.equal(store.get().subscriptions[1].total, undefined);
  assert.equal(store.get().nodes.some(item => item.id === 'incoming'), false);
  assert.equal(await invoke('subscription:delete-by-id', {id:'target'}), false);
  assert.equal(store.get().subscriptions[1].id, 'replacement');
});

test('R02/R06: actual preload forwards only narrow payloads and captured subscription ID', async () => {
  const calls = [];
  let api;
  const context = vm.createContext({require: () => ({
    contextBridge:{exposeInMainWorld: (_name, value) => { api = value; }},
    ipcRenderer:{invoke: (...args) => { calls.push(args); return Promise.resolve(); }},
  })});
  vm.runInContext(await fs.readFile('src/recovered/preload.cjs', 'utf8'), context);
  await api.state.patchSettings({notifications:false}, 4);
  await api.node.select('b');
  await api.node.setFavorite('b', true);
  await api.node.delete('b');
  await api.subscription.deleteById('second');
  assert.deepEqual(plain(calls), [
    ['state:patch-settings',{patch:{notifications:false},expectedRevision:4}],
    ['node:select',{id:'b'}], ['node:set-favorite',{id:'b',favorite:true}], ['node:delete',{id:'b'}],
    ['subscription:delete-by-id',{id:'second'}],
  ]);
});

test('R20: shield connection persists only its profile and respects the explicit GUI startup preferences', async t => {
  const { root, store } = await fixture(t);
  const { context } = handlers(store, root);
  await context.testWindow.shieldController.options.saveConnected('Selected profile');
  assert.equal(store.get().settings.zapretProfile, 'Selected profile');
  assert.equal(store.get().settings.autoStart, false);
  assert.equal(store.get().settings.startMinimized, false);
  assert.equal(store.get().settings.minimizeToTray, false);
  await store.patchSettings({autoStart:true, startMinimized:false, minimizeToTray:true});
  await context.testWindow.shieldController.options.saveConnected('Next profile');
  assert.equal(store.get().settings.autoStart, true);
  assert.equal(store.get().settings.startMinimized, false);
  assert.equal(store.get().settings.minimizeToTray, true);
});

test('R02: 120 interleaved acknowledged commands preserve every independent node and subscription', async t => {
  const { root, store } = await fixture(t);
  const { invoke } = handlers(store, root);
  const initialRevision = store.get().stateRevision;
  for (let batch = 0; batch < 30; batch += 1) {
    const revision = store.get().stateRevision;
    const id = `batch-${batch}`;
    const [settings] = await Promise.all([
      invoke('state:patch-settings', {patch:{notifications:batch % 2 === 0},expectedRevision:revision}),
      store.update(current => ({...current,nodes:[...current.nodes,node(id,id)]})),
      store.update(current => ({...current,subscriptions:[...current.subscriptions,sub(id)]})),
      store.update(current => ({...current,usageHistory:[...current.usageHistory,{id,timestamp:batch}]})),
    ]);
    assert.equal(settings.ok, true);
    assert.equal(store.get().nodes.length, batch + 1);
    assert.equal(store.get().subscriptions.length, batch + 1);
    assert.equal(store.get().usageHistory.length, batch + 1);
  }
  const saved = JSON.parse(await fs.readFile(store.filePath,'utf8'));
  assert.deepEqual(saved, plain(store.get()));
  assert.equal(saved.stateRevision, initialRevision + 120);
  assert.equal(new Set(saved.nodes.map(item => item.id)).size, 30);
  assert.equal(new Set(saved.subscriptions.map(item => item.id)).size, 30);
});
