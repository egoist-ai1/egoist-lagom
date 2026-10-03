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
  assert.ok(process.env.CODEX_THREAD_ID, 'The actual task ID is required');
  const result = await exec(pointer.python, [path.join(pointer.root, 'brain.py'), 'task', 'paths', '--id', process.env.CODEX_THREAD_ID], { windowsHide: true, timeout: 15000 });
  return JSON.parse(result.stdout).work;
}

test('service backup completion validates its exact owned binding before moving only the SCM manifest', { skip: process.platform !== 'win32' }, async () => {
  const work = await workRoot();
  assert.ok(path.isAbsolute(work));
  await fs.mkdir(work, { recursive: true });
  const dir = await fs.mkdtemp(path.join(work, 'lagom-service-backup-completion-'));
  try {
    const modules = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/Modules');
    const powershell = path.join(path.dirname(modules), 'powershell.exe');
    const result = await exec(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/installer-service-backup-completion.ps1'), '-TestDirectory', dir], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, PSModulePath: modules } });
    assert.match(result.stdout, /Installer service backup completion: 2 positives, 6 negatives; [1-9]\d* checks passed/);
    assert.match(result.stdout, /actual own file hashing\/single-link\/move; service\/network\/tasks\/registry operations 0; native 5\.1\./);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(work));
    assert.equal(await fs.realpath(dir), dir);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
