import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../src/recovered/electron/ipc/desktop-updater.js', import.meta.url), 'utf8');

async function fixture(t, fetchWithRetry, timers = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lagom-stream-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const context = vm.createContext({
    path, promises: fs, process, Buffer, URL, console, clearTimeout,
    setTimeout: (fn, ms) => setTimeout(fn, ms < 30000 ? 0 : ms),
    fetchWithRetry, getNetworkErrorDetails: () => ({ kind: 'network' }), ...timers,
  });
  vm.runInContext(`${source}\nthis.DesktopUpdater = DesktopUpdater;`, context);
  const updater = new context.DesktopUpdater({ currentVersion: '3.7.7', userDataDir: root });
  const candidate = { version: '3.7.8', size: 100, assetUrl: 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.7.8/setup.exe' };
  const partial = path.join(root, 'updates/setup.exe.partial');
  return { updater, candidate, partial };
}

function response(candidate, chunks, headers = {}, status = 200) {
  let position = 0;
  let cancelled = 0;
  let released = false;
  return {
    url: candidate.assetUrl, status,
    headers: new Headers(headers),
    body: {
      async cancel() { cancelled += 1; },
      getReader() {
        return {
          async read() {
            const value = chunks[position++];
            if (value instanceof Error) throw value;
            return value ? { done: false, value } : { done: true };
          },
          async cancel() { cancelled += 1; },
          releaseLock() { released = true; },
        };
      },
    },
    released: () => released,
    cancellations: () => cancelled,
  };
}

test('interrupted response body resumes its exact verified byte range and releases readers', async t => {
  let f;
  const responses = [];
  const offsets = [];
  f = await fixture(t, async (_url, options) => {
    offsets.push(options.headers.Range ?? null);
    const result = responses.length === 0
      ? response(f.candidate, [Buffer.alloc(20, 1), new Error('socket reset')], { 'content-length': '100', etag: 'same-object' })
      : response(f.candidate, [Buffer.alloc(80, 2)], { 'content-length': '80', 'content-range': 'bytes 20-99/100', etag: 'same-object' }, 206);
    responses.push(result);
    return { response: result };
  });
  await f.updater.downloadCandidateWithRetry(f.candidate, f.partial);
  assert.deepEqual(offsets, [null, 'bytes=20-']);
  assert.deepEqual(await fs.readFile(f.partial), Buffer.concat([Buffer.alloc(20, 1), Buffer.alloc(80, 2)]));
  assert.ok(responses.every(value => value.released() && value.cancellations() === 1));
});

test('a mismatched Content-Range fails once before appending any bytes', async t => {
  let f;
  let calls = 0;
  let downloaded;
  f = await fixture(t, async () => {
    calls += 1;
    downloaded = response(f.candidate, [Buffer.alloc(80)], { 'content-range': 'bytes 19-98/100' }, 206);
    return { response: downloaded };
  });
  await fs.mkdir(path.dirname(f.partial), { recursive: true });
  await fs.writeFile(f.partial, Buffer.alloc(20, 7));
  await fs.writeFile(`${f.partial}.json`, JSON.stringify({ schemaVersion: 1, version: f.candidate.version, assetUrl: f.candidate.assetUrl, expectedSize: 100 }));
  await assert.rejects(f.updater.downloadCandidateWithRetry(f.candidate, f.partial), error => error.code === 'integrity-failed');
  assert.equal(calls, 1);
  assert.equal(downloaded.cancellations(), 1);
  assert.deepEqual(await fs.readFile(f.partial), Buffer.alloc(20, 7));
});

test('a silent body is cancelled by the idle deadline and leaves no open reader', async t => {
  let completeRead;
  let cancelled = false;
  let released = false;
  let observedIdle = false;
  const f = await fixture(t, async url => ({ response: {
    url, status: 200, headers: new Headers({ 'content-length': '100' }),
    body: { getReader: () => ({
      read: () => new Promise(resolve => { completeRead = resolve; }),
      cancel: async () => { cancelled = true; completeRead?.({ done: true }); },
      releaseLock: () => { released = true; },
    }) },
  } }), { setTimeout: (fn, ms) => {
    if (ms === 30000) { observedIdle = true; return setTimeout(fn, 5); }
    return setTimeout(fn, ms);
  } });
  await assert.rejects(f.updater.downloadCandidate(f.candidate, f.partial), error => error.code === 'timeout');
  assert.ok(observedIdle && cancelled && released);
});
