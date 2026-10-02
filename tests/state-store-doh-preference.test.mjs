import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadRecovered } from './load-recovered.mjs';

const PRIVATE_URL = 'https://resolver.example:8443/dns-query/user-preference';
const OTHER_URL = 'https://other-resolver.example/dns-query';
const { StateStore, DEFAULT_STATE } = loadRecovered('electron/ipc/state-store', {
  promises: fs, path, process, randomUUID,
  logger: { info() {}, warn() {}, error() {} },
  normalizePersistedDisplayText: state => state,
  normalizeCustomDnsUrl: (value, fallback = '') => typeof value === 'string' ? value.trim() || fallback : fallback,
  normalizeSystemDohUrl: (value, fallback = '') => typeof value === 'string' ? value.trim() || fallback : fallback,
  normalizeSystemDohLocalAddress: (value, fallback = '') => /^127(?:\.\d{1,3}){3}$/.test(value || '') ? value : fallback,
}, ['StateStore', 'DEFAULT_STATE']);

function healthyLocal(overrides = {}) {
  return {
    available: true, enabled: true, running: true, verified: true, encrypted: true,
    nativeManaged: false, serviceInstalled: true, serviceRunning: true, serviceState: 'running',
    localAddress: '127.0.0.1', currentUrl: PRIVATE_URL, ownerInspectionErrors: [], ...overrides,
  };
}

async function fixture(t, { settings = {}, activated = true, status } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shield-doh-preference-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installationPath = path.join(root, 'installation.json');
  const id = randomUUID();
  await fs.writeFile(installationPath, JSON.stringify({ id }));
  if (activated) await fs.writeFile(path.join(root, 'installation-activation.json'), JSON.stringify({ id }));
  const state = structuredClone(DEFAULT_STATE);
  Object.assign(state.settings, settings);
  await fs.writeFile(path.join(root, 'egoistshield-state.json'), JSON.stringify(state));
  const store = new StateStore(root, installationPath);
  let reads = 0;
  if (status) store.readOwnedSystemDohStatus = async () => { reads++; return status(); };
  return { root, installationPath, store, reads: () => reads };
}

for (const activated of [true, false]) test(`healthy owned DNS repairs fallback preferences before publication; activated=${activated}`, async t => {
  const { store, root, installationPath, reads } = await fixture(t, { activated, status: () => healthyLocal() });
  const state = await store.load();
  assert.equal(state.settings.systemDohEnabled, true);
  assert.equal(state.settings.systemDohUrl, PRIVATE_URL);
  assert.equal(state.settings.systemDohLocalAddress, '127.0.0.1');
  assert.equal(reads(), 1);
  const persisted = JSON.parse(await fs.readFile(store.filePath, 'utf8'));
  assert.equal(persisted.settings.systemDohUrl, PRIVATE_URL);
  const reopened = new StateStore(root, installationPath);
  await reopened.load();
  assert.equal(reopened.get().settings.systemDohEnabled, true);
  assert.equal(reopened.get().settings.systemDohUrl, PRIVATE_URL);
});

test('new installation preserves explicit custom DoH choice when status is unavailable', async t => {
  const { store } = await fixture(t, { activated: false,
    settings: { systemDohEnabled: true, systemDohUrl: PRIVATE_URL, systemDohLocalAddress: '127.0.0.1', autoStart: true, autoConnect: true },
    status: () => { throw new Error('owner cannot be inspected'); },
  });
  const state = await store.load();
  assert.equal(state.settings.systemDohEnabled, true);
  assert.equal(state.settings.systemDohUrl, PRIVATE_URL);
  assert.equal(state.settings.systemDohLocalAddress, '127.0.0.1');
  assert.equal(state.settings.autoStart, false);
  assert.equal(state.settings.autoConnect, false);
});

test('disabled custom DoH choice stays disabled and keeps URI on installation change', async t => {
  const { store, reads } = await fixture(t, { activated: false, settings: { systemDohUrl: OTHER_URL }, status: () => healthyLocal() });
  const state = await store.load();
  assert.equal(state.settings.systemDohEnabled, false);
  assert.equal(state.settings.systemDohUrl, OTHER_URL);
  assert.equal(reads(), 0);
});

for (const settings of [
  { systemDohEnabled: true, systemDohUrl: OTHER_URL },
  { systemDohEnabled: true },
  { systemDnsServers: '9.9.9.9' },
  { customDnsUrl: OTHER_URL },
]) test(`explicit DNS choice cannot be replaced by active runtime: ${JSON.stringify(settings)}`, async t => {
  const { store, reads } = await fixture(t, { settings, status: () => healthyLocal() });
  const state = await store.load();
  for (const [key, value] of Object.entries(settings)) assert.equal(state.settings[key], value);
  assert.equal(reads(), 0);
});

for (const [name, overrides] of [
  ['unknown owner', { serviceState: 'unknown' }],
  ['owner inspection error', { ownerInspectionErrors: [{ code: 'QUERY_FAILED' }] }],
  ['unverified', { verified: false }],
  ['unencrypted', { encrypted: false }],
  ['stopped', { serviceRunning: false }],
  ['not installed', { serviceInstalled: false }],
  ['invalid URL', { currentUrl: 'http://resolver.example/dns-query' }],
  ['credentials in URL', { currentUrl: 'https://user:password@resolver.example/dns-query' }],
]) test(`startup does not adopt ${name} DNS`, async t => {
  const { store } = await fixture(t, { status: () => healthyLocal(overrides) });
  const state = await store.load();
  assert.equal(state.settings.systemDohEnabled, false);
  assert.equal(state.settings.systemDohUrl, DEFAULT_STATE.settings.systemDohUrl);
});

test('new installation cannot replace an explicitly enabled default provider with another active URI', async t => {
  const { store, reads } = await fixture(t, { activated: false, settings: { systemDohEnabled: true }, status: () => healthyLocal() });
  const state = await store.load();
  assert.equal(state.settings.systemDohEnabled, true);
  assert.equal(state.settings.systemDohUrl, DEFAULT_STATE.settings.systemDohUrl);
  assert.equal(reads(), 0);
});

test('new installation preserves explicit static and custom DNS without runtime adoption', async t => {
  const { store, reads } = await fixture(t, { activated: false, settings: { systemDnsServers: '9.9.9.9', customDnsUrl: OTHER_URL }, status: () => healthyLocal() });
  const state = await store.load();
  assert.equal(state.settings.systemDnsServers, '9.9.9.9');
  assert.equal(state.settings.customDnsUrl, OTHER_URL);
  assert.equal(state.settings.systemDohEnabled, false);
  assert.equal(reads(), 0);
});

test('failed status lookup leaves fresh preferences disabled', async t => {
  const { store } = await fixture(t, { activated: false, status: () => { throw new Error('unavailable'); } });
  await assert.doesNotReject(() => store.load());
  assert.equal(store.get().settings.systemDohEnabled, false);
});

test('native verified encrypted DNS is adopted only with UDP fallback disabled', async t => {
  const native = healthyLocal({ nativeManaged: true, serviceInstalled: false, serviceRunning: false, serviceState: 'native', localAddress: '203.0.113.2', fallbackToUdp: false });
  const { store } = await fixture(t, { status: () => native });
  const state = await store.load();
  assert.equal(state.settings.systemDohEnabled, true);
  assert.equal(state.settings.systemDohUrl, PRIVATE_URL);
  assert.equal(state.settings.systemDohLocalAddress, '');
  const { store: unsafe } = await fixture(t, { status: () => ({ ...native, fallbackToUdp: true }) });
  await unsafe.load();
  assert.equal(unsafe.get().settings.systemDohEnabled, false);
});

test('newer explicit preference wins while startup awaits protected inspection', async t => {
  const { store } = await fixture(t);
  await store.load();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  store.readOwnedSystemDohStatus = async () => pending;
  const reconcile = store.reconcileOwnedSystemDohPreferences();
  await store.update(current => ({ ...current, settings: { ...current.settings, systemDohEnabled: true, systemDohUrl: OTHER_URL } }));
  release(healthyLocal());
  await reconcile;
  assert.equal(store.get().settings.systemDohUrl, OTHER_URL);
});

test('startup only reads status and updates preferences; it never applies or restarts DNS', async t => {
  const calls = [];
  const manager = { status: async options => { calls.push(['status', options.force]); return healthyLocal(); }, apply: () => assert.fail('unexpected DNS application'), restart: () => assert.fail('unexpected DNS restart') };
  const { store } = await fixture(t);
  store.readOwnedSystemDohStatus = () => manager.status({ force: true });
  await store.load();
  assert.deepEqual(calls, [['status', true]]);
});
