import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('installer terminates only its captured owned process identity', { skip: process.platform !== 'win32' }, async () => {
  assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP || ''));
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const source = path.join(root, 'src', 'installer', 'service-maintenance.ps1');
  const receiptPath = path.join(process.env.LAGOM_TEST_TEMP, `owned-process-${crypto.randomUUID()}.json`);
  const { stdout, stderr } = await promisify(execFile)(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tests', 'installer-owned-process-identity.ps1'), '-SourceScript', source, '-ReceiptPath', receiptPath], { cwd: root, windowsHide: true, timeout: 20_000, env: { ...process.env, PSModulePath: path.join(path.dirname(powershell), 'Modules') } });
  assert.equal(stderr.trim(), '');
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.failed, 0);
  assert.equal(receipt.caseCount, 6);
  assert.deepEqual(receipt.identityAdmissions.map(value => value.fixture), ['owned-child', 'race-child']);
  for (const identity of receipt.identityAdmissions) {
    assert.equal(identity.recordPresent, true);
    assert.equal(identity.observedPid, identity.retainedPid);
    assert.equal(identity.pathMatch, true);
    assert.equal(identity.retainedHandleAvailable, true);
    assert.equal(identity.retainedHasExited, false);
    assert.equal(identity.diagnosticError, null);
    assert.ok(identity.birthDeltaMilliseconds >= 0 && identity.birthDeltaMilliseconds < 1);
  }
  assert.equal(receipt.ownedFixtureProcessKills, 1);
  assert.equal(receipt.raceFixtureRetirements, 1);
  for (const field of ['unrelatedProcessKills', 'scmMutations', 'registryMutations', 'networkMutations']) assert.equal(receipt[field], 0);
  assert.equal(receipt.cleanupComplete, true);
  assert.match(receipt.powerShellVersion, /^5\.1\./);
  assert.equal(receipt.productionSourceSha256, crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex'));
  assert.deepEqual(JSON.parse(await fs.readFile(receiptPath, 'utf8')), receipt);
});