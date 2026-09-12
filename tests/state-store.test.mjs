import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadRecovered } from './load-recovered.mjs';

const { StateStore, DEFAULT_STATE } = loadRecovered('electron/ipc/state-store', {
  promises: fs, path, process, randomUUID,
  logger: { info() {}, warn() {}, error() {} },
  normalizePersistedDisplayText: state => ({ ...state, nodes: state.nodes.map(x => ({ ...x })) }),
  normalizeCustomDnsUrl: value => value || '',
  normalizeSystemDohUrl: value => value || '',
  normalizeSystemDohLocalAddress: value => value || '',
}, ['StateStore', 'DEFAULT_STATE']);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shield-state-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: new StateStore(root) };
}

test('fresh state has no automatic connection or DNS override', async t => {
  const { store } = await fixture(t);
  const state = await store.load();
  assert.equal(state.settings.autoStart, false);
  assert.equal(state.settings.autoConnect, false);
  assert.equal(state.settings.systemDohEnabled, false);
  assert.equal(state.settings.systemDnsServers, '');
});

test('a new installation disables old automatic connections in each user profile only once', async t => {
  const { root } = await fixture(t);
  const installationPath = path.join(root, 'installation.json');
  await fs.writeFile(installationPath, JSON.stringify({ id: randomUUID() }));
  const state = structuredClone(DEFAULT_STATE);
  state.settings.autoStart = state.settings.autoConnect = state.settings.systemDohEnabled = true;
  state.nodes = [{ id: 'saved-node', name: 'User server' }];
  await fs.writeFile(path.join(root, 'egoistshield-state.json'), JSON.stringify(state));
  const store = new StateStore(root, installationPath);
  await store.load();
  assert.equal(store.get().settings.autoStart, false);
  assert.equal(store.get().settings.autoConnect, false);
  assert.equal(store.get().settings.systemDohEnabled, false);
  assert.equal(store.get().nodes[0].id, 'saved-node');
  await store.patchSettings({ autoConnect: true });
  const reopened = new StateStore(root, installationPath);
  await reopened.load();
  assert.equal(reopened.get().settings.autoConnect, true, 'later explicit user choice must persist');
});

test('installation preserves the user-selected resolver while leaving DNS disabled', async t => {
  const { root } = await fixture(t);
  const installationPath = path.join(root, 'installation.json');
  await fs.writeFile(installationPath, JSON.stringify({ id: randomUUID() }));
  const state = structuredClone(DEFAULT_STATE);
  state.settings.systemDohUrl = 'https://resolver.example.test/custom?key=user-choice';
  state.settings.customDnsUrl = state.settings.systemDohUrl;
  state.settings.systemDohEnabled = true;
  await fs.writeFile(path.join(root, 'egoistshield-state.json'), JSON.stringify(state));
  const store = new StateStore(root, installationPath);
  await store.load();
  assert.ok(store.get().settings.systemDohUrl === state.settings.systemDohUrl, 'Resolver selection must survive installation');
  assert.ok(store.get().settings.customDnsUrl === state.settings.customDnsUrl, 'Custom resolver selection must survive installation');
  assert.equal(store.get().settings.systemDohEnabled, false);
});

test('two concurrent settings changes with one revision cannot both commit', async t => {
  const { store } = await fixture(t);
  await store.load();
  const revision = store.getRevision();
  const results = await Promise.all([
    store.patchSettings({ notifications: false }, revision),
    store.patchSettings({ notifications: true }, revision),
  ]);
  assert.equal(results.filter(x => x.ok).length, 1);
  assert.equal(results.filter(x => x.conflict).length, 1);
  assert.equal(store.get().settings.notifications, false);
});

test('valid backup survives recovery from a truncated primary', async t => {
  const { root, store } = await fixture(t);
  const state = structuredClone(DEFAULT_STATE);
  state.settings.notifications = false;
  await fs.writeFile(store.filePath, '{broken');
  await fs.writeFile(store.backupPath, JSON.stringify(state));
  await store.load();
  assert.equal(store.get().settings.notifications, false);
  const backup = JSON.parse(await fs.readFile(path.join(root, 'egoistshield-state.json.bak'), 'utf8'));
  assert.equal(backup.settings.notifications, false);
});

test('syntactically valid but malformed state recovers from backup', async t => {
  const { store } = await fixture(t);
  await fs.writeFile(store.filePath, JSON.stringify({ nodes: 'corrupt' }));
  await fs.writeFile(store.backupPath, JSON.stringify(DEFAULT_STATE));
  await assert.doesNotReject(() => store.load());
  assert.deepEqual([...store.get().nodes], []);
});

test('failed disk write leaves settings and revision unchanged', async t => {
  const { store } = await fixture(t);
  await store.load();
  const before = JSON.stringify(store.get());
  const revision = store.getRevision();
  store.writeStateFile = async () => { throw new Error('simulated full disk'); };
  const result = await store.patchSettings({ notifications: false });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(store.get()), before);
  assert.equal(store.getRevision(), revision);
});
