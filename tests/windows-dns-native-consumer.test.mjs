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
test('actual private DNS intent consumer preserves empty families and refuses unsafe policy changes', { skip: process.platform !== 'win32' || !declaredTemp, timeout: 65_000 }, () => {
  const temp = declaredTemp;
  assert.ok(temp && isAbsolute(temp), 'LAGOM_TEST_TEMP must name an existing declared private directory');
  const tempInfo = lstatSync(temp);
  assert.ok(tempInfo.isDirectory() && !tempInfo.isSymbolicLink(), 'declared private test directory must be ordinary');
  const powershell = shell;
  assert.ok(powershell && isAbsolute(powershell), 'selected PowerShell executable must be absolute');
  const executableInfo = lstatSync(powershell);
  assert.ok(executableInfo.isFile() && !executableInfo.isSymbolicLink(), 'declared PowerShell executable must be ordinary');
  const work = mkdtempSync(join(temp, 'dns-private-consumer-'));
  const output = join(work, 'consumer-result.json');
  const child = spawnSync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(testsRoot, 'windows-dns-native-consumer.ps1'),
    '-DnsSource', join(testsRoot, 'windows-dns-native-acceptance.ps1'), '-Output', output,
  ], { cwd: resolve(testsRoot, '..'), windowsHide: true, timeout: 60_000, maxBuffer: 1_048_576 });
  assert.equal(child.error, undefined, 'bounded inert PowerShell child must complete');
  assert.equal(child.signal, null, 'inert PowerShell child must not be terminated');
  const result = JSON.parse(readFileSync(output, 'utf8').replace(/^\uFEFF/, ''));
  const failed = result.cases.filter(item => !item.passed).map(item => `${item.name}: ${item.errorClass}`).slice(0, 4);
  assert.equal(child.status, 0, `actual consumer regression failed: ${failed.join('; ')}`);
  assert.equal(result.kind, 'actual-dns-private-intent-consumer-inert-regression');
  assert.equal(result.proposalAppliedOnlyInMemory, false, 'maintained route must execute actual source without replacing it');
  assert.equal(result.caseCount, 19);
  assert.equal(result.passedCaseCount, 19);
  assert.equal(result.allPassed, true);
  assert.equal(result.directNullAddressRejected, true);
  assert.equal(result.directEmptySequenceAccepted, true);
  for (const key of ['nativeDnsCalls', 'networkCalls', 'serviceMutations', 'registryWrites', 'sourceWrites']) assert.equal(result[key], 0);
});
