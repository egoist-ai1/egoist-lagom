import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createGuiLifecycleTelemetry } from '../src/gui-lifecycle-telemetry.js';

const root = new URL('../', import.meta.url);
const source = name => fs.readFileSync(new URL(name, root), 'utf8');
const coordinator = source('src/recovered/electron/shutdown-coordinator.js');
const main = source('src/recovered/electron/main.js');
function sinkFixture() {
  const sink = new EventEmitter(), lines = [];
  sink.write = (line, callback) => { lines.push(line); callback(); return false; };
  return { sink, lines, records: () => lines.map(line => JSON.parse(line.slice('[lagom-lifecycle] '.length))) };
}
function coordinatorFixture(text, telemetry) {
  const context = vm.createContext({ setTimeout, clearTimeout, Date, ...(telemetry === undefined ? {} : { guiLifecycleTelemetry: telemetry }) });
  vm.runInContext(text + '\nglobalThis.run = runShutdownSteps;', context);
  return context.run;
}
test('records have an exact ASCII schema and monotonic elapsed time without raw inputs', () => {
  const f = sinkFixture(); let clock = 100;
  const emit = createGuiLifecycleTelemetry({ pid: 31, stderr: f.sink, now: () => clock });
  assert.equal(emit('window-close'), true);
  clock = 112.9; emit('window-state-persisted'); clock = 111; emit('window-closed');
  const records = f.records();
  assert.deepEqual(records.map(record => record.elapsedMs), [0, 12, 12]);
  for (const [index, record] of records.entries()) {
    assert.deepEqual(Object.keys(record), ['schemaVersion', 'pid', 'phase', 'elapsedMs', 'step', 'ok']);
    assert.equal(record.pid, 31); assert.equal(record.step, null); assert.equal(record.ok, null);
    assert.match(f.lines[index], /^[\x00-\x7f]+$/); assert.ok(Buffer.byteLength(f.lines[index]) <= 256);
  }
});

test('unknown phase, unknown step, arbitrary outcome and non-step metadata are never serialized', () => {
  const f = sinkFixture(); const emit = createGuiLifecycleTelemetry({ pid: 31, stderr: f.sink, now: () => 1 });
  for (const args of [['private-config'], ['shutdown-step-start', 'private-token'],
    ['shutdown-step-end', 'vpn-runtime', 'private-error'], ['window-close', 'vpn-runtime'],
    ['window-close', null, false], ['shutdown-step-start', null], ['shutdown-outcome', null]]) {
    assert.equal(emit(...args), false);
  }
  assert.deepEqual(f.lines, []);
  emit('shutdown-step-start', 'vpn-runtime'); emit('shutdown-step-end', 'vpn-runtime', false);
  assert.deepEqual(f.records().map(record => [record.phase, record.step, record.ok]),
    [['shutdown-step-start', 'vpn-runtime', null], ['shutdown-step-end', 'vpn-runtime', false]]);
});

test('synchronous, callback and asynchronous stream failures cannot throw or enqueue further records', async () => {
  const throwing = new EventEmitter(); throwing.write = () => { throw new Error('private failure'); };
  const first = createGuiLifecycleTelemetry({ pid: 31, stderr: throwing, now: () => 1 });
  assert.doesNotThrow(() => assert.equal(first('window-close'), false));
  assert.equal(first('window-closed'), false);
  const callback = new EventEmitter(); callback.write = (_line, done) => { done(new Error('private failure')); return true; };
  assert.equal(createGuiLifecycleTelemetry({ pid: 31, stderr: callback, now: () => 1 })('window-close'), false);
  const later = new EventEmitter(); let writes = 0;
  later.write = (_line, done) => { writes++; setImmediate(() => { done(new Error('private failure')); later.emit('error', new Error('private failure')); }); return true; };
  const third = createGuiLifecycleTelemetry({ pid: 31, stderr: later, now: () => 1 });
  assert.equal(third('window-close'), true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(third('window-closed'), false); assert.equal(writes, 1);
});

test('repeated close and step events have finite key, record and byte bounds', () => {
  const f = sinkFixture(); const emit = createGuiLifecycleTelemetry({ pid: 31, stderr: f.sink, now: () => 1 });
  const cases = ['window-close', 'window-state-persisted', 'close-to-tray', 'window-closed',
    'window-all-closed', 'before-quit', 'shutdown-start', 'shutdown-finally', 'quit-requested', 'will-quit'].map(phase => [phase]);
  for (const step of ['vpn-runtime', 'zapret-policy', 'telegram-proxy']) {
    cases.push(['shutdown-step-start', step], ['shutdown-step-end', step, true],
      ['shutdown-timeout', step, false], ['shutdown-outcome', step, false]);
  }
  cases.push(['shutdown-timeout', null, false], ['shutdown-outcome', null, true]);
  for (let i = 0; i < 100; i++) for (const args of cases) emit(...args);
  assert.ok(f.lines.length <= 96); assert.ok(Buffer.byteLength(f.lines.join('')) <= 16384);
  const perKey = new Map();
  for (const record of f.records()) { const key = record.phase + ':' + record.step; perKey.set(key, (perKey.get(key) ?? 0) + 1); }
  assert.ok([...perKey.values()].every(count => count <= 4));
  assert.equal(f.records().filter(record => record.phase === 'will-quit').length, 4);
});

test('initialization failures and nonfinite clocks are nonfatal and produce no records', () => {
  const f = sinkFixture();
  for (const options of [{pid: 0}, {pid: 'private-id'}, {now: () => NaN}, {now: () => {throw new Error('private failure');}}]) {
    assert.doesNotThrow(() => assert.equal(createGuiLifecycleTelemetry({pid: 31, stderr: f.sink, ...options})('window-close'), false));
  }
  let clock = 1; const emit = createGuiLifecycleTelemetry({pid: 31, stderr: f.sink, now: () => clock});
  clock = Infinity; assert.equal(emit('window-close'), false);
  assert.deepEqual(f.lines, []);
});

test('pending step deadline still reports timeout and fences later work after release', async () => {
  const f = sinkFixture(), calls = []; let release;
  const emit = createGuiLifecycleTelemetry({pid: 31, stderr: f.sink, now: () => 1});
  const result = await coordinatorFixture(coordinator, emit)([
    {name: 'vpn-runtime', run: () => new Promise(resolve => { release = resolve; })},
    {name: 'zapret-policy', run: async () => calls.push('restore')}], 20);
  assert.equal(result.timedOut, true); assert.equal(result.unfinishedStep, 'vpn-runtime');
  assert.deepEqual(f.records().slice(-2).map(record => [record.phase, record.step, record.ok]),
    [['shutdown-timeout', 'vpn-runtime', false], ['shutdown-outcome', 'vpn-runtime', false]]);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, []); assert.deepEqual(Array.from(result.completedSteps), []);
});

test('missing or throwing diagnostic emitter cannot change cleanup behavior', async () => {
  for (const emit of [undefined, () => { throw new Error('diagnostic only'); }]) {
    const calls = []; const result = await coordinatorFixture(coordinator, emit)([
      {name: 'vpn-runtime', run: async () => calls.push('vpn')},
      {name: 'telegram-proxy', run: async () => calls.push('telegram')}], 1000);
    assert.deepEqual(calls, ['vpn', 'telegram']); assert.equal(result.timedOut, false);
    assert.deepEqual(Array.from(result.completedSteps), ['vpn-runtime', 'telegram-proxy']);
  }
});

function slice(text, from, to) {
  const start = text.indexOf(from), end = text.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start); return text.slice(start, end);
}
function lifecycleFixture(trayMode) {
  const app = new EventEmitter(), window = new EventEmitter(), events = [], scheduled = [], f = sinkFixture();
  window.webContents = {send: () => events.push('widget')}; window.hide = () => events.push('hide');
  const context = vm.createContext({app, mainWindow: window, isQuitting: false, shutdownComplete: false, shutdownPromise: null,
    componentUpdateInterval: null, updateCheckInterval: null, trafficInterval: null, activeSingboxReq: null,
    tray: null, windowStateTimer: null, process: {platform: 'win32'},
    globalStateStore: {get: () => ({settings: {minimizeToTray: trayMode}})},
    guiLifecycleTelemetry: createGuiLifecycleTelemetry({pid: 31, stderr: f.sink, now: () => 1}),
    persistCurrentWindowState: () => events.push('persist'),
    applyShieldWindowMode: () => events.push('widget-mode'), stopDnsWatchdog: () => events.push('watchdog-stop'),
    cancelDeferredStartupTimers: () => events.push('timers-stop'),
    performGracefulShutdown: async () => events.push('cleanup'),
    clearTimeout() {throw new Error('unexpected clear');}, clearInterval() {throw new Error('unexpected clear');},
    setImmediate: fn => scheduled.push(fn),
  });
  app.quit = () => {
    events.push('quit'); const e = {prevented: false, preventDefault() {this.prevented = true;}};
    app.emit('before-quit', e); if (!e.prevented) app.emit('will-quit');
  };
  vm.runInContext(coordinator.slice(0, coordinator.indexOf('async function runShutdownSteps')) +
    slice(main, 'app.on("before-quit"', '\nvar activeSingboxReq') +
    slice(main, '\tmainWindow.on("close"', '\n\tif (productionRuntime) recoverBackgroundFeatures') +
    slice(main, 'app.on("will-quit"', '\n//#endregion'), context);
  return {app, window, context, events, scheduled, records: f.records};
}

test('actual copied lifecycle handlers preserve tray close and one cleanup/quit sequence', async () => {
  const hidden = lifecycleFixture(true), event = {prevented: false, preventDefault() {this.prevented = true;}};
  hidden.window.emit('close', event);
  assert.equal(event.prevented, true); assert.deepEqual(hidden.events, ['persist', 'widget-mode', 'widget', 'hide']);
  assert.deepEqual(hidden.records().map(record => record.phase), ['window-close', 'window-state-persisted', 'close-to-tray']);
  assert.equal(hidden.context.isQuitting, false);
  const exit = lifecycleFixture(false), close = {preventDefault() {throw new Error('unexpected tray');}};
  exit.window.emit('close', close); exit.window.emit('closed'); exit.app.emit('window-all-closed');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(exit.scheduled.length, 1); exit.scheduled[0]();
  assert.equal(exit.events.filter(value => value === 'cleanup').length, 1);
  assert.equal(exit.context.shutdownComplete, true); assert.equal(exit.context.mainWindow, null);
  assert.deepEqual(exit.records().map(record => record.phase),
    ['window-close', 'window-state-persisted', 'window-closed', 'window-all-closed',
      'before-quit', 'shutdown-finally', 'quit-requested', 'before-quit', 'will-quit']);
});
