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
test('continuity correlates CIM microseconds while retaining the held native process birth', { skip: process.platform !== 'win32' }, async () => {
  const work = await workRoot();
  await fs.mkdir(work, { recursive: true });
  const dir = await fs.mkdtemp(path.join(work, 'lagom-continuity-process-birth-'));
  try {
    const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    let result;
    // A real process born exactly on a microsecond does not expose the old defect.
    // Retry only these own child hosts; their normal exit needs no termination.
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        result = await exec(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/installer-continuity-process-birth.ps1'), '-TestDirectory', dir], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
        break;
      } catch (error) {
        if (error.code !== 23 || !error.stdout.includes('PRECISION_SAMPLE_ZERO')) throw error;
      }
    }
    assert.ok(result, 'Eight own native hosts had zero submicrosecond residue; the real precision boundary was not exercised.');
    assert.match(result.stdout, /Installer continuity process birth: 23 positives, 33 negatives, 3 unchanged false branches passed/);
    assert.match(result.stdout, /actual own native handle and CIM row; native-CIM [1-9] ticks; exact held100ns authority; product queries 0; live mutations 0; native 5\.1\./);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(work));
    assert.equal(await fs.realpath(dir), dir);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
