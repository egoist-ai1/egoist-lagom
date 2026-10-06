import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { loadRecovered } from './load-recovered.mjs';

// The production StateStore reads and writes this memory-only filesystem. Paths
// identify fixtures; no user profile, real filesystem or Windows API is mutated.
function fixture() {
  const files = new Map(), operations = [];
  let sequence = 0, onBackupWrite = () => {};
  let primaryPath, backupPath;
  const bytes = value => Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8');
  const missing = () => Object.assign(new Error('Missing virtual file'), { code: 'ENOENT' });
  const isBackupWrite = file => file === backupPath || file.startsWith(backupPath + '.');
  const backupBoundary = file => { if (isBackupWrite(file)) onBackupWrite(); };
  const fs = {
    async readFile(file) {
      operations.push({ operation: 'read', file });
      if (!files.has(file)) throw missing();
      return bytes(files.get(file));
    },
    async mkdir() {},
    async copyFile(from, to) {
      operations.push({ operation: 'copy', from, file: to });
      backupBoundary(to);
      files.set(to, await this.readFile(from));
    },
    async open(file, flags) {
      operations.push({ operation: 'open', file, flags });
      if (flags === 'r') return { async sync() {}, async close() {} };
      backupBoundary(file);
      if (flags === 'wx' && files.has(file)) throw Object.assign(new Error('Existing virtual file'), { code: 'EEXIST' });
      return {
        async writeFile(value) { operations.push({ operation: 'write', file }); files.set(file, bytes(value)); },
        async sync() { operations.push({ operation: 'sync', file }); },
        async close() {},
      };
    },
    async writeFile(file, value) { backupBoundary(file); files.set(file, bytes(value)); operations.push({ operation: 'write', file }); },
    async rename(from, to) {
      if (!files.has(from)) throw missing();
      files.set(to, bytes(files.get(from))); files.delete(from);
      operations.push({ operation: 'rename', from, file: to });
    },
    async rm(file) { files.delete(file); operations.push({ operation: 'rm', file }); },
  };
  const { StateStore, DEFAULT_STATE } = loadRecovered('electron/ipc/state-store', {
    promises: fs, path, process, randomUUID: () => 'virtual-fixture-' + (++sequence),
    logger: { info() {}, warn() {}, error() {} }, normalizePersistedDisplayText: value => value,
    normalizeCustomDnsUrl: value => value || '', normalizeSystemDohUrl: value => value || '',
    normalizeSystemDohLocalAddress: value => value || '',
  }, ['StateStore', 'DEFAULT_STATE']);
  const create = () => new StateStore(path.resolve('MemoryOnlyStateStore', 'Egoist Lagom'));
  const store = create(); primaryPath = store.filePath; backupPath = store.backupPath;
  const saved = { ...structuredClone(DEFAULT_STATE), stateRevision: 9, legacyMigrationVersion: 1,
    nodes: [{ id: 'saved', protocol: 'vless', server: 'private.example', port: 443 }], activeNodeId: 'saved' };
  const primary = Buffer.from(JSON.stringify(saved, null, 2));
  const backup = Buffer.from(JSON.stringify({ ...saved, stateRevision: 8 }, null, 2));
  files.set(primaryPath, primary); files.set(backupPath, backup);
  return { files, operations, store, primary, backup, create, setBackupBoundary(fn) { onBackupWrite = fn; } };
}

test('a known backup write denial blocks settings side effects before they start', async () => {
  const f = fixture(); await f.store.load(); f.operations.length = 0;
  let effects = 0, rollbacks = 0, deniedWrites = 0;
  f.setBackupBoundary(() => { deniedWrites++; throw Object.assign(new Error('Virtual backup access denied'), { code: 'EACCES' }); });
  // The external action barrier and the mutation both run production methods.
  await f.store.checkStorageWritable().catch(() => {});
  const result = await f.store.patchSettings({ autoStart: true }, undefined, {
    beforeCommit: async () => { effects++; }, rollback: async () => { rollbacks++; },
  });
  assert.equal(result.ok, false);
  assert.ok(deniedWrites > 0, 'fault must reach the actual backup writer');
  assert.equal(effects, 0, 'a stable disk denial must be found before changing Windows preferences');
  assert.equal(rollbacks, 0, 'rollback must not run for a side effect that never started');
  assert.equal(f.store.getSnapshot().storage.writable, false);
  assert.deepEqual(f.files.get(f.store.filePath), f.primary);
  assert.deepEqual(f.files.get(f.store.backupPath), f.backup);
  assert.equal([...f.files.keys()].some(file => file.endsWith('.tmp')), false, 'failed staging removes its own temporary files');
});

test('a primary change at the backup writer cannot replace the verified backup with corrupt bytes', async () => {
  const f = fixture(); await f.store.load();
  const corrupt = Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x7d]);
  let injections = 0, effects = 0;
  f.setBackupBoundary(() => {
    if (injections++) return;
    f.files.set(f.store.filePath, Buffer.from(corrupt));
  });
  const result = await f.store.patchSettings({ notifications: false }, undefined, {
    beforeCommit: async () => { effects++; },
  });
  assert.ok(injections > 0, 'change must occur at the actual copy or atomic backup writer boundary');
  assert.equal(result.ok, false);
  assert.deepEqual(f.files.get(f.store.filePath), corrupt, 'the concurrent primary must not be overwritten');
  const retainedBackup = f.files.get(f.store.backupPath);
  assert.ok(retainedBackup.equals(f.primary) || retainedBackup.equals(f.backup),
    'backup must retain a known verified snapshot, even if the conflict aborts its atomic replacement');
  assert.equal(effects, 0, 'staging rechecks primary before a settings side effect');
  assert.equal(f.store.get().nodes[0].id, 'saved');
  assert.equal([...f.files.keys()].some(file => file.endsWith('.tmp')), false);
  f.setBackupBoundary(() => {});
  const restarted = f.create(); await restarted.load();
  assert.equal(restarted.getSnapshot().storage.writable, true);
  assert.equal(restarted.get().nodes[0].id, 'saved', 'the only on-disk recovery copy remains usable on restart');
  const preserved = [...f.files].find(([file]) => file.startsWith(restarted.filePath + '.corrupt-'));
  assert.ok(preserved, 'restoration preserves the original corrupt primary');
  assert.deepEqual(preserved[1], corrupt, 'invalid UTF-8 bytes are retained exactly');
});
