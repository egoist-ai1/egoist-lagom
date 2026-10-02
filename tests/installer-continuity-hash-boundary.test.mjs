import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
async function workRoot() {
  if (process.env.EGOISTSHIELD_TEST_WORK_ROOT) return process.env.EGOISTSHIELD_TEST_WORK_ROOT;
  let pointer;
  try { pointer = JSON.parse(await fs.readFile(path.join(os.homedir(), '.codex', 'brain-pointer.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return os.tmpdir(); throw error; }
  assert.ok(process.env.CODEX_THREAD_ID);
  const result = await exec(pointer.python, [path.join(pointer.root, 'brain.py'), 'task', 'paths', '--id', process.env.CODEX_THREAD_ID], { windowsHide: true, timeout: 15000 });
  const paths = JSON.parse(result.stdout);
  assert.ok(path.isAbsolute(paths.work));
  return paths.work;
}
test('continuity accepts canonical cross-producer SHA hex and retains strict ownership guards', { skip: process.platform !== 'win32' }, async () => {
  const work = await workRoot();
  await fs.mkdir(work, { recursive: true });
  const dir = await fs.mkdtemp(path.join(work, 'lagom-continuity-hash-boundary-'));
  try {
    const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const result = await exec(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/installer-continuity-hash-boundary.ps1'), '-TestDirectory', dir], { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
    assert.match(result.stdout, /Installer continuity hash boundary: 4 positives, 70 negatives, 27 strict helper cases passed/);
    assert.match(result.stdout, /actual worker\/cleanup SHA functions; local state cne preserved; live mutations 0; native 5\.1\./);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(work));
    assert.equal(await fs.realpath(dir), dir);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
