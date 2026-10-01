import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

test('legacy installer bridge waits for the prior lease and watchdog before fresh recovery preflight', { skip: process.platform !== 'win32', timeout: 30000 }, () => {
  const executable = process.env.LAGOM_WINDOWS_POWERSHELL || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/installer-legacy-bootstrap.ps1'), '-TempRoot', process.env.LAGOM_TEST_TEMP || os.tmpdir()];
  if (process.env.LAGOM_LEGACY_BOOTSTRAP_BEFORE_SOURCE) args.push('-BeforeSource', process.env.LAGOM_LEGACY_BOOTSTRAP_BEFORE_SOURCE);
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = JSON.parse(result.stdout);
  assert.ok(receipt.groups >= 7);
  assert.equal(receipt.liveServiceMutations, 0);
  assert.equal(receipt.liveDnsMutations, 0);
});
