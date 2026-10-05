import assert from 'node:assert/strict';
import { readFileSync, lstatSync, mkdtempSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const testsRoot = dirname(fileURLToPath(import.meta.url));
const declaredTemp = process.env.LAGOM_TEST_TEMP;
const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL ||
  join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
test('actual DNS and VPN close boundaries preserve first normal-exit failures and fixed diagnostics', { skip: process.platform !== 'win32' || !declaredTemp, timeout: 65_000 }, () => {
  const temp = declaredTemp;
  assert.ok(temp && isAbsolute(temp), 'LAGOM_TEST_TEMP must name an existing declared private directory');
  const tempInfo = lstatSync(temp);
  assert.ok(tempInfo.isDirectory() && !tempInfo.isSymbolicLink(), 'declared private test directory must be ordinary');
  const powershell = shell;
  assert.ok(powershell && isAbsolute(powershell), 'selected PowerShell executable must be absolute');
  const executableInfo = lstatSync(powershell);
  assert.ok(executableInfo.isFile() && !executableInfo.isSymbolicLink(), 'declared PowerShell executable must be ordinary');
  const work = mkdtempSync(join(temp, 'native-gui-close-'));
  const output = join(work, 'close-result.json');
  const child = spawnSync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(testsRoot, 'windows-native-gui-close-observation.ps1'),
    '-DnsSource', join(testsRoot, 'windows-dns-native-acceptance.ps1'),
    '-VpnSource', join(testsRoot, 'windows-vpn-native-acceptance.ps1'), '-Output', output,
  ], { cwd: resolve(testsRoot, '..'), windowsHide: true, timeout: 60_000, maxBuffer: 1_048_576 });
  assert.equal(child.error, undefined, 'bounded inert PowerShell child must complete');
  assert.equal(child.signal, null, 'inert PowerShell child must not be terminated');
  const result = JSON.parse(readFileSync(output, 'utf8').replace(/^\uFEFF/, ''));
  const failed = result.cases.filter(item => !item.passed).map(item => `${item.name}: ${item.errorClass}`).slice(0, 4);
  assert.equal(child.status, 0, `actual close-boundary regression failed: ${failed.join('; ')}`);
  assert.equal(result.kind, 'actual-native-gui-close-boundary-inert-regression');
  assert.equal(result.expectedOriginal, false, 'maintained route must execute the current source gate');
  assert.equal(result.caseCount, 34);
  assert.equal(result.passedCaseCount, 34);
  assert.equal(result.allPassed, true);
  for (const kind of ['dns', 'vpn']) {
    for (const label of ['original-false-wait-late-cleanup-zero', 'original-signaled-259-late-cleanup-zero', 'original-signaled-nonzero-late-cleanup-zero']) {
      const observed = result.cases.find(item => item.name === `${kind}:${label}`);
      assert.equal(observed?.accepted, false, 'later cleanup must never rescue the original failed normal-exit gate');
      assert.equal(observed?.waitBudgetMilliseconds, 30_000);
    }
  }
  for (const key of ['actualNativeProcessQueries', 'actualGuiCalls', 'networkCalls', 'serviceMutations', 'registryWrites', 'sourceWrites']) assert.equal(result[key], 0);
});
