import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
test('installer baseline preserves absent DNS families and refuses provider failure', async () => {
  assert.ok(process.env.LAGOM_TEST_TEMP && path.isAbsolute(process.env.LAGOM_TEST_TEMP), 'Task-owned LAGOM_TEST_TEMP is required');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout, stderr } = await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/installer-network-baseline.ps1'), '-TempRoot', process.env.LAGOM_TEST_TEMP], { windowsHide: true, timeout: 30_000 });
  assert.equal(stderr.trim(), '');
  const receipt = JSON.parse(stdout.trim());
  assert.equal(receipt.groups, 6);
  assert.equal(receipt.actualProductionFunctions, true);
  assert.equal(receipt.networkMutations, 0);
});
