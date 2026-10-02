import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('interrupted installer restores private state and never changes operator during an upstream failure', { skip: process.platform !== 'win32' }, async () => {
  assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP || ''), 'Set task-scoped LAGOM_TEST_TEMP.');
  const dir = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP, 'private-recovery-'));
  const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = await promisify(execFile)(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/installer-private-dns-recovery.ps1'), '-TestDirectory', dir], {
    windowsHide: true, timeout: 30_000, env: { ...process.env, TEMP: process.env.LAGOM_TEST_TEMP, TMP: process.env.LAGOM_TEST_TEMP, PSModulePath: path.join(path.dirname(ps), 'Modules') }
  });
  assert.equal(result.stderr.trim(), '');
  assert.match(result.stdout, /Private DNS installer recovery checks: 8 passed/);
  assert.match(result.stdout, /native SCM\/registry\/network mutations0/);
});
