import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../src/recovered/electron/ipc/handlers-system.js', import.meta.url), 'utf8');
const start = source.indexOf('\tlet lastClipboardRead = 0;');
const end = source.indexOf('\tipcMain.handle("system:terminate-conflicts"', start);
assert.ok(start >= 0 && end > start);

function handlers(clipboard) {
  const registered = new Map();
  const warnings = [];
  vm.runInNewContext(source.slice(start, end), {
    clipboard, Date: { now: () => 10000 },
    logger: { warn: message => warnings.push(message) },
    ipcMain: { handle: (name, callback) => registered.set(name, callback) },
  });
  return { read: registered.get('system:read-clipboard'), write: registered.get('system:write-clipboard'), warnings };
}

test('clipboard import awaits Electron44 text, filters unrelated text and retains its cooldown', async () => {
  let reads = 0;
  const uri = handlers({ readText: async () => { reads++; return '  vless://test-value  '; } });
  assert.equal(await uri.read(), 'vless://test-value');
  assert.equal(await uri.read(), '');
  assert.equal(reads, 1);
  assert.equal(await handlers({ readText: async () => 'unrelated note' }).read(), '');
});

test('clipboard copy reports success only after the asynchronous write has completed', async () => {
  let complete;
  const writes = [];
  const copy = handlers({ writeText: text => { writes.push(text); return new Promise(resolve => { complete = resolve; }); } });
  let settled = false;
  const result = copy.write(null, '  test endpoint  ').then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(writes, ['test endpoint']);
  complete();
  assert.equal(await result, true);
});

test('clipboard rejection returns an actionable failure without logging user content', async () => {
  const secretError = new Error('private clipboard content');
  const access = handlers({ readText: async () => { throw secretError; }, writeText: async () => { throw secretError; } });
  assert.equal(await access.read(), '');
  assert.equal(await access.write(null, 'private clipboard content'), false);
  assert.equal(access.warnings.length, 2);
  assert.ok(access.warnings.every(message => !message.includes('private clipboard content')));
});

test('clipboard copy validates text before making a system call', async () => {
  let calls = 0;
  const copy = handlers({ writeText: async () => { calls++; } });
  for (const value of [null, {}, '', ' ', 'x'.repeat(4097)]) assert.equal(await copy.write(null, value), false);
  assert.equal(calls, 0);
});
