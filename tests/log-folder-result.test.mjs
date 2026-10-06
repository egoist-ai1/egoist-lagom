import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { loadRecovered } from './load-recovered.mjs';
import { extractRendererCallback } from './renderer-fixture-helper.mjs';

function fixture(openPath) {
  const handlers = new Map(), calls = [];
  const { registerLogHandlers } = loadRecovered('electron/ipc/handlers-logs', {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    path: path.win32,
    log: { transports: { file: { getFile: () => ({ path: String.raw`C:\AuditFixture\Logs\main.log` }) } } },
    shell: { openPath: folder => { calls.push(folder); return openPath(folder); } },
    Error
  }, ['registerLogHandlers']);
  registerLogHandlers();
  return { invoke: handlers.get('logs:open-folder'), calls };
}

test('log-folder waits for Windows before confirming success', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { invoke, calls } = fixture(() => pending);
  let settled = false;
  const result = Promise.resolve(invoke()).then(value => { settled = true; return value; });
  await Promise.resolve();
  const settledBeforeWindows = settled;
  resolve('');
  assert.equal(await result, true);
  assert.equal(settledBeforeWindows, false, 'Windows has not yet accepted the request');
  assert.deepEqual(calls, [String.raw`C:\AuditFixture\Logs`]);
});

test('log-folder surfaces a nonempty Windows error instead of success', async () => {
  const { invoke } = fixture(async () => 'Path not found');
  await assert.rejects(async () => invoke(), /Path not found/);
});

test('log-folder preserves a rejected Windows request', async () => {
  const rejected = Promise.reject(new Error('Shell request rejected'));
  void rejected.catch(() => {});
  const { invoke } = fixture(() => rejected);
  await assert.rejects(async () => invoke(), /Shell request rejected/);
});

test('log-folder keeps successful IPC response compatible', async () => {
  const { invoke, calls } = fixture(async () => '');
  assert.equal(await invoke(), true);
  assert.equal(calls.length, 1);
});

function actualRendererAction() {
  const renderer = fs.readFileSync('src/recovered/renderer.js', 'utf8');
  assert.ok(/e2\(`open-log-folder`,\s*\(\) => Z\(`logs.openFolder`,\s*window\.egoistAPI\?\.logs\?\.openFolder\),\s*`Папка логов открыта`\)/.test(renderer), 'actual Settings button must use runAction with the logs IPC');
  const action = extractRendererCallback(renderer, 'S2');
  const helpersStart = renderer.indexOf('function Z(e2, t2, ...n2)');
  const helpersEnd = renderer.indexOf('function dm(', helpersStart);
  const activities = [], tones = [], warnings = [];
  let state = { busy: null, busyActions: [] };
  const context = vm.createContext({
    Error, Date, n2:{storage:{status:'ready',writable:true}}, console: { warn: value => warnings.push(value) },
    O: { useCallback: callback => callback }, If: value => value, Lf: (a, b) => a === b,
    f2: { current: new Map() }, updateRevision: { current: 0 }, readGeneration: { current: 0 }, d2: { current: 0 },
    Zf: {}, s2: value => activities.push(value), r2: update => { state = update(state); },
    l2: () => {}, p2: { current: true }, tp: tone => tones.push(tone), Rf: () => false, y2: async () => {},
  });
  vm.runInContext(`${renderer.slice(helpersStart, helpersEnd)}\nglobalThis.runAction = ${action};`, context);
  return { runAction: context.runAction, activities, tones, warnings, get state() { return state; } };
}

test('actual renderer displays failed log-folder IPC and clears busy state', async () => {
  const { invoke } = fixture(async () => 'Path not found');
  const ui = actualRendererAction();
  assert.equal(await ui.runAction('open-log-folder', invoke, 'Папка логов открыта'), false);
  assert.equal(ui.activities.at(-1).tone, 'bad');
  assert.equal(ui.activities.at(-1).title, 'Действие не выполнено');
  assert.match(ui.activities.at(-1).detail, /Path not found/);
  assert.ok(!ui.activities.some(value => value.tone === 'good'));
  assert.deepEqual(ui.tones, ['bad']);
  assert.match(ui.warnings.at(-1), /APP-ACTION/);
  assert.equal(ui.state.busy, null);
  assert.equal(ui.state.busyActions.length, 0);
});

