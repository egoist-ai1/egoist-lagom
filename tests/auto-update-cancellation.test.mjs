import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { loadRecovered, sourceFor } from './load-recovered.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(process.env.SHIELD_TEST_WORK_ROOT ?? os.tmpdir(), 'lagom-auto-cancel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from('inert future signed-candidate transport fixture');
  const candidate = { version: '3.8.1', minimumAppVersion: '3.8.0', tag: 'v3.8.1',
    assetName: 'EgoistShield-Setup-3.8.1.exe', assetUrl: 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.8.1/EgoistShield-Setup-3.8.1.exe',
    size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    sha512: createHash('sha512').update(bytes).digest('hex'), manifestDigest: 'a'.repeat(64), keyId: 'fixture-only' };
  const downloading = deferred(), finishDownload = deferred();
  const calls = [], progress = [];
  const { DesktopUpdater } = loadRecovered('electron/ipc/desktop-updater', {
    path, promises: fs, process, createHash, createReadStream,
    getNetworkErrorDetails: () => ({ kind: 'unknown' }),
    fetchWithRetry: async () => {
      let reads = 0;
      return { response: { status: 200, url: candidate.assetUrl, headers: new Headers(), body: {
        getReader() { return {
          async read() {
            if (reads++ === 0) return { done: false, value: bytes.subarray(0, 10) };
            if (reads === 2) { downloading.resolve(); await finishDownload.promise; return { done: false, value: bytes.subarray(10) }; }
            return { done: true };
          }, async cancel() {}, releaseLock() {},
        }; }, async cancel() {},
      } } };
    },
    spawn(executable, args) {
      calls.push({ executable, args: Array.from(args) });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  }, ['DesktopUpdater']);
  const resourcesPath = path.join(root, 'resources');
  await fs.mkdir(path.join(resourcesPath, 'installer'), { recursive: true });
  for (const name of ['invoke-final-silent-reinstall.ps1', 'ModernInstaller.exe', 'Unbounded.ttf'])
    await fs.writeFile(path.join(resourcesPath, 'installer', name), 'inert helper boundary fixture');
  const updater = new DesktopUpdater({ currentVersion: '3.8.0', userDataDir: root, resourcesPath,
    onProgress: value => progress.push(value), canInstall: async () => true, ...options });
  // Authentication is a separate existing test contract. This test exercises
  // actual source control flow, body streaming, disk hashes and the handoff boundary.
  updater.check = async () => ({ ok: true, phase: 'available', latestVersion: '3.8.1', candidate, warnings: [] });
  return { updater, root, candidate, downloading, finishDownload, calls, progress };
}

test('automatic off during an actual partial stream cannot dispatch Setup or restart', async t => {
  const f = await fixture(t);
  let enabled = true;
  const running = f.updater.checkAndInstall({ shouldContinue: () => enabled });
  await f.downloading.promise;
  assert.equal((await fs.stat(path.join(f.root, 'updates', `${f.candidate.assetName}.partial`))).size, 10);
  enabled = false; f.finishDownload.resolve();
  const result = await running;
  assert.equal(result.failureCode, 'cancelled');
  assert.equal(result.ok, false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.progress.some(value => value.phase === 'restarting'), false);
});

test('automatic quitting during a partial stream cannot dispatch Setup', async t => {
  const f = await fixture(t);
  let quitting = false;
  const running = f.updater.checkAndInstall({ shouldContinue: () => !quitting });
  await f.downloading.promise; quitting = true; f.finishDownload.resolve();
  assert.equal((await running).failureCode, 'cancelled');
  assert.equal(f.calls.length, 0);
});

test('automatic preference is checked again after asynchronous VPN readiness', async t => {
  const readiness = deferred(), enteredReadiness = deferred();
  const f = await fixture(t, { canInstall: () => { enteredReadiness.resolve(); return readiness.promise; } });
  let enabled = true;
  const running = f.updater.checkAndInstall({ shouldContinue: () => enabled });
  await f.downloading.promise; f.finishDownload.resolve();
  await enteredReadiness.promise; enabled = false; readiness.resolve(true);
  assert.equal((await running).failureCode, 'cancelled');
  assert.equal(f.calls.length, 0);
});

test('manual update remains allowed when the automatic preference is off', async t => {
  const f = await fixture(t);
  const running = f.updater.checkAndInstall();
  await f.downloading.promise; f.finishDownload.resolve();
  assert.equal((await running).phase, 'restarting');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args.includes('-ExpectedVersion'), true);
  assert.equal(f.calls[0].args.includes('3.8.1'), true);
  assert.equal(f.calls[0].args.includes(f.candidate.sha256), true);
});

function scheduler(updater, patch = async () => {}) {
  const source = sourceFor('electron/main');
  const timers = [], handlers = new Map();
  const context = vm.createContext({ autoUpdateEnabled: true, updateCheckInterval: null, isQuitting: false,
    componentUpdateInFlight: false, desktopUpdater: updater,
    globalRuntimeManager: { async status() { return { connected: false }; } },
    globalNetworkCombinatorManager: { isMutationIdle: () => true }, pendingBootRecovery: new Set(),
    globalStateStore: { patch, get: () => ({ settings: {} }) },
    toPublicUpdateResult: value => value, emitUpdateResult() {}, Notification: { isSupported: () => false },
    app: { isPackaged: true, quit() { throw new Error('Product must not quit in this fixture.'); } },
    logger: { info() {}, warn() {} }, assertTrustedIpcEvent() {},
    ipcMain: { handle(name, callback) { handlers.set(name, callback); } },
    setTimeout(callback, delay) { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeout() {}, scheduleDeferredStartup(callback, delay) { timers.push({ callback, delay, restart: true }); },
    checkManagedComponentUpdates() {},
  });
  const start = source.indexOf('var backgroundUpdateInFlight = false;');
  vm.runInContext(source.slice(start, source.indexOf('function setupAutoUpdater()', start)), context);
  const settingsStart = source.indexOf('ipcMain.handle("updater:set-auto",');
  vm.runInContext(source.slice(settingsStart, source.indexOf('var componentUpdateInFlight', settingsStart)), context);
  return { context, timers, setAuto: enabled => handlers.get('updater:set-auto')({}, enabled) };
}

test('real automatic scheduler off then on never revives the previous download', async t => {
  const f = await fixture(t);
  const s = scheduler(f.updater);
  const running = s.context.runBackgroundUpdateCheck();
  await f.downloading.promise;
  await s.setAuto(false); await s.setAuto(true);
  s.context.scheduleNextUpdateCheck(0);
  const early = s.timers.at(-1);
  early.callback(); // The new-generation timer fires while the old run is still active.
  assert.equal(s.context.backgroundUpdateInFlight, true);
  f.finishDownload.resolve();
  await running;
  assert.equal(f.calls.length, 0);
  assert.equal(s.timers.some(value => value.restart), false);
  assert.equal(s.context.autoUpdateEnabled, true);
  assert.equal(s.timers.at(-1).delay, 0);
  assert.notEqual(s.timers.at(-1), early);
});

test('real automatic scheduler dispatches a completed permitted update once', async t => {
  const f = await fixture(t);
  const s = scheduler(f.updater);
  const running = s.context.runBackgroundUpdateCheck();
  await f.downloading.promise; f.finishDownload.resolve(); await running;
  assert.equal(f.calls.length, 1);
  assert.equal(s.timers.filter(value => value.restart).length, 1);
});

test('off takes effect before asynchronous settings persistence completes', async t => {
  const f = await fixture(t);
  const persist = deferred();
  const s = scheduler(f.updater, () => persist.promise);
  const running = s.context.runBackgroundUpdateCheck();
  await f.downloading.promise;
  const saving = s.setAuto(false);
  f.finishDownload.resolve(); await running;
  persist.resolve(); await saving;
  assert.equal(f.calls.length, 0);
  assert.equal(s.timers.some(value => value.restart), false);
});
