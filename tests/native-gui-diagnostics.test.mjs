import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('native GUI diagnostics retain bounded stream tails and preserve failures without changing parent environment', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const root = path.resolve(process.env.LAGOM_TEST_TEMP || process.env.EGOIST_RELEASE_TEST_DIR || os.tmpdir());
  const directory = await fs.mkdtemp(path.join(root, 'gd-'));
  const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL ||
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const environment = { ...process.env };
  if (path.basename(shell).toLowerCase() === 'powershell.exe')
    for (const key of Object.keys(environment)) if (key.toLowerCase() === 'psmodulepath') delete environment[key];
  try {
    const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.resolve('tests/native-gui-diagnostics.ps1'), '-TestDirectory', directory], {
      env: environment, encoding: 'utf8', windowsHide: true, timeout: 25000, maxBuffer: 1048576,
    });
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.groups, 8);
    assert.equal(receipt.parentEnvironmentUnchanged, true);
    assert.equal(receipt.childIdentityObserved, true);
    assert.equal(receipt.childWindowStationObserved, false);
    assert.equal(receipt.liveGuiLaunches + receipt.liveServiceMutations + receipt.liveNetworkMutations + receipt.liveRegistryMutations, 0);
    const diagnostics = JSON.parse(await fs.readFile(path.join(directory, 'owned-child.diagnostics.json'), 'utf8'));
    assert.equal(diagnostics.drainLimitMilliseconds, 2000);
    assert.equal(diagnostics.launch.launch.emptyArguments, true);
    assert.deepEqual(diagnostics.launch.launch.arguments, []);
    assert.equal(diagnostics.launch.child.imageMatchesExpected, true);
    assert.equal(diagnostics.launch.environmentPolicy.loggingPathWithinWork, true);
    assert.equal(diagnostics.launch.environmentPolicy.forbiddenVariableCount, 0);
    assert.equal(diagnostics.chromium.truncated, true);
    assert.ok(diagnostics.chromium.bytes <= 1048576);
    assert.equal(await fs.readFile(path.join(directory, 'owned-child.stdout.txt'), 'utf8'), 'owned child stdout');
    assert.equal(await fs.readFile(path.join(directory, 'owned-child.stderr.txt'), 'utf8'), 'owned child stderr');
  } finally {
    assert.equal(path.dirname(directory), root);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
