import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { RendererRecoveryController } from '../src/renderer-recovery-controller.js';
import { loadRecovered } from './load-recovered.mjs';

function clock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    now: () => now,
    schedule: (callback, delay) => { const id = ++next; timers.set(id, { callback, at: now + delay }); return id; },
    cancel: id => timers.delete(id),
    advance: milliseconds => {
      const end = now + milliseconds;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].callback();
      }
      now = end;
    },
    timers
  };
}

test('renderer crash loops use backoff and at most three reloads in one minute', () => {
  const time = clock();
  const results = [];
  let reloads = 0;
  const recovery = new RendererRecoveryController({ ...time, onResult: result => results.push(result),
    reload: () => { reloads++; recovery.loaded(); recovery.failed('crashed'); } });
  recovery.failed('crashed');
  time.advance(59_999);
  assert.equal(reloads, 3);
  assert.equal(results.at(-1).phase, 'cooldown');
  time.advance(301);
  assert.equal(reloads, 4);
  recovery.dispose();
  assert.equal(time.timers.size, 0);
});

test('a healthy renderer resets the failure burst only after a stable minute', () => {
  const time = clock();
  let reloads = 0;
  const recovery = new RendererRecoveryController({ ...time, reload: () => { reloads++; recovery.loaded(); } });
  recovery.failed('crashed');
  time.advance(300);
  assert.equal(reloads, 1);
  time.advance(59_999);
  assert.equal(recovery.attempts.length, 1);
  time.advance(1);
  assert.equal(recovery.attempts.length, 0);
  recovery.failed('killed');
  time.advance(300);
  assert.equal(reloads, 2);
  recovery.dispose();
});

test('recovery ignores clean exits, coalesces duplicate events and never reloads a retired window', () => {
  const time = clock();
  let allowed = true, reloads = 0;
  const recovery = new RendererRecoveryController({ ...time, canReload: () => allowed, reload: () => reloads++ });
  assert.equal(recovery.failed('clean-exit'), false);
  recovery.failed('oom'); recovery.failed('oom');
  assert.equal(time.timers.size, 1);
  time.advance(4_999);
  assert.equal(reloads, 0);
  allowed = false;
  time.advance(1);
  assert.equal(reloads, 0);
  recovery.dispose();
});

test('production settings ignore the isolated test override and test paths must be absolute', () => {
  const { buildAppPathConfig } = loadRecovered('electron/app-paths', { path: path.win32 }, ['buildAppPathConfig']);
  const options = { defaultUserDataDir: 'C:\\Users\\Test\\AppData\\Roaming\\Egoist Shield', pid: 42,
    testUserDataDir: 'C:\\Task\\work\\isolated-app' };
  assert.equal(buildAppPathConfig({ ...options, environment: 'production' }).userDataDir, options.defaultUserDataDir);
  const isolated = buildAppPathConfig({ ...options, environment: 'test' });
  assert.equal(isolated.userDataDir, options.testUserDataDir);
  assert.equal(isolated.sessionDataDir, path.win32.join(options.testUserDataDir, 'session'));
  assert.throws(() => buildAppPathConfig({ ...options, environment: 'test', testUserDataDir: '..\\production' }), /absolute/);
});

test('isolated validation shutdown never invokes system cleanup while production keeps all cleanup steps', async () => {
  const source = fs.readFileSync('src/recovered/electron/main.js', 'utf8');
  const start = source.indexOf('async function performGracefulShutdown() {');
  const end = source.indexOf('\napp.on("before-quit"', start);
  assert.ok(start >= 0 && end > start);
  for (const environment of ['test', 'production']) {
    const calls = [];
    const context = vm.createContext({ runtimeEnvironment: environment,
      logger: { info() {}, warn() {} },
      globalStateStore: { get: () => ({ settings: { zapretSuspendDuringVpn: true, zapretProfile: 'fixture' } }) },
      globalRuntimeManager: { disconnect: async () => calls.push('vpn') },
      globalZapretManager: { restoreAfterVpnIfNeeded: async () => calls.push('zapret') },
      globalTelegramProxyManager: { shutdownApplicationRuntime: async () => calls.push('telegram') },
      runShutdownSteps: async steps => {
        for (const step of steps) await step.run();
        return { failedSteps: [], timedOut: false, completedSteps: calls };
      }
    });
    await vm.runInContext(`${source.slice(start, end)}\nperformGracefulShutdown()`, context);
    assert.deepEqual(calls, environment === 'test' ? [] : ['vpn', 'zapret', 'telegram']);
  }
});
