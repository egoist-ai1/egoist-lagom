import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../../..');
const mainPath = 'src/recovered/electron/main.js';
const baselineCommit = 'd56eb9327fa75a88e91fae62b8d7ea3ed095dcf2';
const previous = spawnSync('git', ['show', `${baselineCommit}:${mainPath}`], { cwd: root, encoding: 'utf8', windowsHide: true });
if (previous.status !== 0) throw new Error('Could not read immutable baseline source.');
const current = await fs.readFile(path.join(root, mainPath), 'utf8');
const controllerPath = path.join(root, 'src/renderer-recovery-controller.js');
const { RendererRecoveryController } = await import(pathToFileURL(controllerPath));
function eventSource(source) {
  const start = source.indexOf('mainWindow.webContents.on("render-process-gone"');
  const end = source.indexOf('mainWindow.webContents.on("console-message"', start);
  if (start < 0 || end < 0) throw new Error('Actual renderer handler markers were not found.');
  return source.slice(start, end);
}
function timeFixture() {
  let now = 0, next = 0;
  const pending = new Map();
  return { now: () => now, schedule: (callback, delay) => { const id = ++next; pending.set(id, { callback, at: now + delay }); return id; },
    cancel: id => pending.delete(id), advance: amount => { const end = now + amount; while (true) {
      const ready = [...pending].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!ready) break;
      now = ready[1].at; pending.delete(ready[0]); ready[1].callback();
    } now = end; } };
}
function invokeActualHandler(source, reason) {
  const time = timeFixture();
  let handler, reloads = 0;
  const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false,
    on: (name, callback) => { if (name !== 'render-process-gone') throw new Error('Unexpected event registration'); handler = callback; },
    reload: () => { reloads++; if (reloads < 10 && reason === 'crashed') handler({}, { reason, exitCode: 1 }); }
  } };
  const recovery = new RendererRecoveryController({ ...time, reload: () => window.webContents.reload() });
  const context = vm.createContext({ mainWindow: window, logger: { error() {} }, rendererRecovery: recovery });
  vm.runInContext(eventSource(source), context);
  handler({}, { reason, exitCode: 1 });
  time.advance(reason === 'oom' ? 5_000 : 59_999);
  recovery.dispose();
  return reloads;
}
const before = invokeActualHandler(previous.stdout, 'crashed');
const after = invokeActualHandler(current, 'crashed');
const oldOom = invokeActualHandler(previous.stdout, 'oom');
const newOom = invokeActualHandler(current, 'oom');
if (before !== 10 || after !== 3 || oldOom !== 0 || newOom !== 1) throw new Error(`Unexpected observed sequence ${before}/${after}/${oldOom}/${newOom}`);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const evidence = { schemaVersion: 1, baselineCommit,
  boundary: 'Actual old/new render-process-gone callbacks executed in a VM with a fake window, bounded crash-event producer and injected monotonic timer. No Electron process or user GUI was created, crashed, reloaded or modified.',
  assertion: 'At most three reloads during the first 59,999ms of a continuing crash loop',
  before: { passed: false, reloads: before, timeMs: 59_999, oomReloadsAfter5000Ms: oldOom },
  after: { passed: true, reloads: after, timeMs: 59_999, oomReloadsAfter5000Ms: newOom },
  sourceSha256: { baselineMain: sha(previous.stdout), candidateMain: sha(current), controller: sha(await fs.readFile(controllerPath)) },
  limits: ['This verifies the callback and bounded controller behavior, not actual renderer crash frequency or Electron recovery success.', 'Only a controlled host check can verify window recovery on the packaged Electron runtime.'] };
await fs.writeFile(path.join(root, 'docs/production-audit-2026-09-30/services/renderer-callback-validation.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ beforeCrashReloads: before, afterCrashReloads: after, oldOom, newOom }));
