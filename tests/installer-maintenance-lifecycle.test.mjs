import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

test('production installer lifecycle preserves policies, ownership, maintenance lease and interrupted stage', {skip:process.platform !== 'win32'}, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lagom-maintenance-lifecycle-'));
  try {
    const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const env = {...process.env, PSModulePath:path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules')};
    const result = await exec(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/installer-maintenance-lifecycle.ps1'), '-TestDirectory', dir], {env, windowsHide:true, timeout:30000});
    assert.match(result.stdout, /lifecycle: 9 groups passed/);
    assert.match(result.stdout, /native SCM\/registry\/network\/kills 0/);
  } finally {
    assert.equal(await fs.realpath(dir), dir);
    await fs.rm(dir, {recursive:true, force:true});
  }
});
