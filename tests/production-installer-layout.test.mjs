import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

test('installer generation paths preserve byte identity and GUI migration preserves unrelated compatibility flags', { skip: process.platform !== 'win32', timeout: 20000 }, () => {
  const shell = process.env.LAGOM_WINDOWS_POWERSHELL || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/production-installer-layout.ps1'), '-TempRoot', process.env.LAGOM_TEST_TEMP || os.tmpdir()];
  if (process.env.LAGOM_LEGACY_BOOTSTRAP_BEFORE_SOURCE) args.push('-BeforeSource', process.env.LAGOM_LEGACY_BOOTSTRAP_BEFORE_SOURCE);
  const result = spawnSync(shell, args, { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.passes, 26);
  assert.equal(receipt.executedInstallers, 0);
  assert.equal(receipt.registryMutations, 0);
  if (process.env.LAGOM_LEGACY_BOOTSTRAP_BEFORE_SOURCE) assert.equal(receipt.beforeNestedRefusal, true);
});
