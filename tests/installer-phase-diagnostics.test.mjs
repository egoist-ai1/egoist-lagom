import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

async function testWorkRoot() {
  if (process.env.EGOISTSHIELD_TEST_WORK_ROOT) return process.env.EGOISTSHIELD_TEST_WORK_ROOT;
  let pointer;
  try { pointer = JSON.parse(await fs.readFile(path.join(os.homedir(), '.codex', 'brain-pointer.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return os.tmpdir(); throw error; }
  assert.ok(process.env.CODEX_THREAD_ID, 'Agent Brain tests require the actual task ID');
  const result = await exec(pointer.python, [path.join(pointer.root, 'brain.py'), 'task', 'paths', '--id', process.env.CODEX_THREAD_ID], { windowsHide: true, timeout: 15000 });
  const paths = JSON.parse(result.stdout);
  assert.ok(paths.work && path.isAbsolute(paths.work), 'Agent Brain did not return a task work path');
  return paths.work;
}

test('production phase diagnostics preserve guards, private continuity and manual/off intent', { skip: process.platform !== 'win32' }, async () => {
  const work = await testWorkRoot();
  await fs.mkdir(work, { recursive: true });
  const dir = await fs.mkdtemp(path.join(work, 'lagom-phase-diagnostics-'));
  try {
    const ps = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const result = await exec(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/installer-phase-diagnostics.ps1'), '-TestDirectory', dir], { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
    assert.match(result.stdout, /Installer phase diagnostics: 6 groups passed; 26 isolated WinPS5 dispatch cases/);
    assert.match(result.stdout, /readonly probe retains exit 2 under actual formatter, JSON serializer and Console.Error writer exceptions/);
    assert.match(result.stdout, /native SCM\/registry\/DNS\/tasks\/processes 0/);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(work));
    assert.equal(await fs.realpath(dir), dir);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
