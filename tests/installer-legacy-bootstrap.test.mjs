import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('legacy installer bridge preserves verified launch booleans and waits for the prior lease/watchdog', { skip: process.platform !== 'win32', timeout: 30000 }, () => {
  const executable = process.env.LAGOM_WINDOWS_POWERSHELL || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/installer-legacy-bootstrap.ps1'), '-TempRoot', process.env.LAGOM_TEST_TEMP || os.tmpdir()];
  if (process.env.LAGOM_LEGACY_BOOTSTRAP_BEFORE_SOURCE) args.push('-BeforeSource', process.env.LAGOM_LEGACY_BOOTSTRAP_BEFORE_SOURCE);
  if (process.env.LAGOM_LEGACY_LAUNCH_BEFORE_SOURCE) args.push('-BeforeLaunchSource', process.env.LAGOM_LEGACY_LAUNCH_BEFORE_SOURCE);
  const childEnvironment = { ...process.env };
  if (path.basename(executable).toLowerCase() === 'powershell.exe')
    for (const key of Object.keys(childEnvironment))
      if (key.toLowerCase() === 'psmodulepath') delete childEnvironment[key];
  const result = spawnSync(executable, args, { env: childEnvironment, encoding: 'utf8', windowsHide: true, timeout: 25000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = JSON.parse(result.stdout);
  assert.ok(receipt.groups >= 11);
  assert.equal(receipt.liveServiceMutations, 0);
  assert.equal(receipt.liveDnsMutations, 0);
  assert.equal(receipt.hostAclMutations, 0);
  assert.equal(receipt.nativeRegistryMutations, 0);
  assert.equal(receipt.launchBeforeAfterChecked, Boolean(process.env.LAGOM_LEGACY_LAUNCH_BEFORE_SOURCE));
  if (process.env.LAGOM_LEGACY_BOOTSTRAP_RECEIPT) {
    assert.ok(process.env.LAGOM_TEST_TEMP, 'Receipt export requires the explicit task temp root.');
    const destination = path.resolve(process.env.LAGOM_LEGACY_BOOTSTRAP_RECEIPT);
    assert.ok(destination.startsWith(path.resolve(process.env.LAGOM_TEST_TEMP) + path.sep));
    fs.writeFileSync(destination, result.stdout, { flag: 'wx' });
  }
});
