import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('protected payload replacement preserves only the verified private DNS generation', {skip: process.platform !== 'win32'}, async t => {
  const taskTemp = process.env.LAGOM_TEST_TEMP || '';
  assert.ok(path.isAbsolute(taskTemp), 'Set task-scoped LAGOM_TEST_TEMP.');
  const root = await fs.mkdtemp(path.join(taskTemp, 'dns-payload-'));
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const {stdout, stderr} = await promisify(execFile)(powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/installer-dns-payload-continuity.ps1'), '-TestDirectory', root],
    {windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024,
      env: {...process.env, TEMP: taskTemp, TMP: taskTemp, PSModulePath: path.join(path.dirname(powershell), 'Modules')}});
  assert.equal(stderr.trim(), '');
  const receipt = JSON.parse(await fs.readFile(path.join(root, 'dns-payload-continuity-test.json'), 'utf8'));
  assert.equal(receipt.passed, true);
  assert.ok(receipt.groupCount >= 11);
  assert.ok(receipt.assertionCount >= 20);
  for (const boundary of ['nativeScmMutations', 'nativeDnsWrites', 'nativeProcessStarts', 'nativeProcessKills', 'nativeTaskChanges']) {
    assert.equal(receipt[boundary], 0, boundary);
  }
  for (const behavior of ['protected stop and service removal', 'real optional runtime quarantine and rollback', 'preserved runtime copy boundary', 'invalid and missing stage refusal', 'foreign PID and image refusal', 'config generation refusal', 'manual-off has no continuity exemption', 'candidate-unready keeps original private generation', 'commit leases pin runtime intent and journal', 'actual DNS candidate staging uses fast retry and private leaf digest', 'failed switch restores authenticated original bytes']) {
    assert.ok(receipt.groups.includes(behavior), behavior);
  }
  assert.match(receipt.cleanupSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.workerSha256, /^[a-f0-9]{64}$/);
  t.diagnostic(stdout.trim());
});
