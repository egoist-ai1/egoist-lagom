import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { loadRecovered } from './load-recovered.mjs';
import { ShieldConnectionController } from '../src/shield-connection-controller.js';

const source = fs.readFileSync('src/recovered/renderer.js', 'utf8');
const selection = (name = 'ALT11') => ({ completed: true, cancelled: false, bestProfile: name, testedAt: '2026-09-12T10:00:00.000Z', results: [{ configName: name, result: 'success', pingMs: 10, passedTargets: 17, totalTargets: 17, targets: [{ key: 'DiscordMain', ok: true }] }] });
function renderer() {
  const memory = new Map();
  const context = vm.createContext({ window: { localStorage: { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) } }, Wf: 'history', Gf: 2, Kf: 17, Q: (...values) => values.find(value => typeof value === 'string' && value.trim()) ?? null, $: (...values) => values.find(Number.isFinite) ?? null });
  const names = ['qf', 'Jf', 'Yf', 'zapretHistoryResult', 'zapretHistoryRows', 'zapretProfileKey', 'zm', 'Bm'];
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end), context);
  }
  return context;
}
function backend(directory, overrides = {}) {
  const handlers = new Map(), warnings = [];
  const api = loadRecovered('electron/ipc/handlers-zapret', { fs, path, app: { getPath: () => directory }, logger: { warn: (...args) => warnings.push(args) }, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, ...overrides }, ['createZapretSelectionHistoryStore', 'compactZapretSelectionHistory', 'recordZapretSelectionHistory', 'registerZapretHandlers']);
  return { ...api, handlers, warnings };
}
function temporary(t) {
  const base = process.env.LAGOM_TEST_TEMP || os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'lagom-history-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('history shows actual early-exit winner, retaining normalized catalogue status and aggregate probe counts', () => {
  const ui = renderer(), result = selection(' general (ALT11).BAT ');
  const catalogue = [{ name: 'General' }, { name: 'general (alt11)' }];
  assert.equal(ui.zm(null, catalogue, result)[0].result, 'Не проверен');
  assert.equal(ui.zm(null, catalogue, result)[1].tone, 'good');
  const history = ui.zapretHistoryRows(result);
  assert.equal(history.length, 1);
  assert.equal(history[0].result, 'Успех 17/17');
  assert.equal(history[0].name, result.bestProfile);
});

test('explicit failed result cannot become successful from an all-good target preview; startup failures stay visible', () => {
  const ui = renderer(), result = selection();
  result.results[0] = { ...result.results[0], result: 'error', passedTargets: 6 };
  result.results.push({ configName: 'Failed to start', result: 'error', error: 'runtime exited', targets: [], passedTargets: 0, totalTargets: 17 });
  const rows = ui.zapretHistoryRows(result);
  assert.equal(rows[0].tone, 'bad');
  assert.equal(rows[0].result, 'Ошибка 6/17');
  assert.equal(rows[1].result, 'Ошибка 0/17');
});

test('completed history round-trips localStorage and survives cancelled/empty attempts and stale refreshes', () => {
  const ui = renderer(), complete = ui.zapretHistoryResult(selection());
  ui.Yf(complete);
  assert.equal(ui.Jf().results[0].configName, 'ALT11');
  assert.equal(ui.zapretHistoryResult({ cancelled: true, results: [] }, complete), complete);
  assert.equal(ui.zapretHistoryResult({ ...selection('Partial'), completed: false, cancelled: true }, complete), complete);
  assert.equal(ui.zapretHistoryResult({ ...selection('Old'), testedAt: '2026-01-01' }, complete), complete);
  assert.equal(ui.zapretHistoryRows({ ...selection(), goodProfiles: 'malformed', badProfiles: {} })[0].tone, 'good');
});

test('actual renderer action preserves previous history while pending, cancelled, or throwing', async () => {
  const ui = renderer();
  let state = { zapretAutoSelect: selection(), busyActions: [] };
  ui.Yf(state.zapretAutoSelect);
  Object.assign(ui, { If: value => value, Lf: () => false, f2: { current: new Map() }, d2: { current: 0 }, Zf: {}, s2() {}, l2() {}, r2: updater => { state = updater(state); }, om: () => false, Rf: () => false, Q: ui.Q, p2: { current: false }, cm: () => ({}), y2: async () => {}, sm: () => 'failure' });
  const start = source.indexOf('let S2 = O.useCallback(async (e3, t3, n3) => {');
  const end = source.indexOf('}, [y2]);', start);
  vm.runInContext('globalThis.runAction = ' + source.slice(start + 'let S2 = O.useCallback('.length, end + 1), ui);
  let finish;
  const pending = ui.runAction('zapret-auto', () => new Promise(resolve => { finish = resolve; }), 'done');
  assert.equal(state.zapretAutoSelect.bestProfile, 'ALT11');
  assert.equal(ui.Jf().bestProfile, 'ALT11');
  finish({ cancelled: true, completed: false, results: [] });
  await pending;
  await ui.runAction('zapret-auto', async () => { throw new Error('probe failed'); }, 'done');
  assert.equal(state.zapretAutoSelect.bestProfile, 'ALT11');
  assert.equal(state.zapretProgress, null);
  assert.equal(ui.Jf().bestProfile, 'ALT11');
});

test('direct IPC selection persists on disk with renderer destroyed and is restored after handler reload', async t => {
  const directory = temporary(t), api = backend(directory);
  api.registerZapretHandlers({ zapretManager: { status: async () => ({ serviceRunning: false }), autoSelectBestProfile: async () => selection() }, runtimeManager: { status: async () => ({ connected: false }) } });
  await api.handlers.get('zapret:auto-select')({ sender: { isDestroyed: () => true } });
  const reloaded = backend(directory);
  reloaded.registerZapretHandlers({ zapretManager: { status: async () => ({ serviceRunning: false }) } });
  const status = await reloaded.handlers.get('zapret:status')();
  assert.equal(status.autoSelectHistory.results[0].configName, 'ALT11');
  assert.equal(status.autoSelectHistory.results[0].totalTargets, 17);
  const files = fs.readdirSync(directory);
  assert.deepEqual(files, ['zapret-selection-history.json']);
});

test('widget saves failed selection evidence and successful probes before later connection failure', async t => {
  const directory = temporary(t), api = backend(directory);
  for (const success of [false, true]) {
    const result = selection(success ? 'Winner' : 'Failed');
    if (!success) { result.bestProfile = null; result.results[0].result = 'error'; }
    const controller = new ShieldConnectionController({ coordinate: async (_action, operation) => operation(), zapret: { status: async () => ({}), autoSelectBestProfile: async () => result, installService: async () => { throw new Error('service denied'); }, stopService: async () => ({ ok: true }) }, dns: { status: async () => ({}) }, onSelection: api.recordZapretSelectionHistory });
    assert.equal((await controller.connect({ dnsEnabled: false, telegramEnabled: false })).ok, false);
    assert.equal(api.createZapretSelectionHistoryStore(directory).read().results[0].configName, success ? 'Winner' : 'Failed');
  }
});

test('bounded history retains all 64 result aggregates, omits previews honestly, caches reads and ignores malformed files', t => {
  const directory = temporary(t), api = backend(directory), store = api.createZapretSelectionHistoryStore(directory);
  const result = selection();
  result.results = Array.from({ length: 64 }, (_, i) => ({ configName: `Profile ${i}`, result: 'error', error: '🔥'.repeat(2000), passedTargets: 6, totalTargets: 17, targets: Array.from({ length: 17 }, () => ({ key: '🔥'.repeat(2000), host: '🔥'.repeat(2000), ok: true })) }));
  store.record(result);
  const raw = fs.readFileSync(path.join(directory, 'zapret-selection-history.json'), 'utf8');
  assert.ok(Buffer.byteLength(raw) <= 48 * 1024);
  assert.equal(store.read().results.length, 64);
  assert.ok(store.read().results.every(row => row.passedTargets === 6 && row.totalTargets === 17 && row.targetsOmitted === 17 - row.targets.length));
  fs.writeFileSync(path.join(directory, 'zapret-selection-history.json'), '{bad');
  assert.equal(store.read().results.length, 64, 'status reads use the cached snapshot');
  assert.equal(api.createZapretSelectionHistoryStore(directory).read(), null);
  fs.writeFileSync(path.join(directory, 'zapret-selection-history.json'), ' '.repeat(49 * 1024));
  assert.equal(api.createZapretSelectionHistoryStore(directory).read(), null);
});

test('cancel keeps last completed run; first partial cancellation retains completed error rows', t => {
  const directory = temporary(t), api = backend(directory), store = api.createZapretSelectionHistoryStore(directory);
  const partial = { ...selection(), completed: false, cancelled: true, bestProfile: null };
  partial.results[0] = { configName: 'Failed', result: 'error', targets: [], passedTargets: 0, totalTargets: 17 };
  store.record(partial);
  assert.equal(store.read().cancelled, true);
  store.record(selection());
  store.record(partial);
  store.record({ cancelled: true, results: [] });
  assert.equal(store.read().bestProfile, 'ALT11');
});

test('history disk failure logs a warning without failing widget connection or changing prior durable file', async t => {
  const directory = temporary(t), first = backend(directory);
  first.recordZapretSelectionHistory(selection('Old'));
  const api = backend(directory, { fs: { ...fs, renameSync() { throw new Error('disk denied'); } } });
  let running = false;
  const controller = new ShieldConnectionController({ coordinate: async (_action, operation) => operation(), onSelection: api.recordZapretSelectionHistory, zapret: { status: async () => ({ serviceRunning: running }), autoSelectBestProfile: async () => selection('New'), installService: async () => {}, startService: async () => { running = true; } }, dns: { status: async () => ({}) }, saveConnected: async () => {} });
  assert.equal((await controller.connect({ dnsEnabled: false, telegramEnabled: false })).ok, true);
  assert.equal(api.warnings.length, 1);
  assert.equal(first.createZapretSelectionHistoryStore(directory).read().bestProfile, 'Old');
});
