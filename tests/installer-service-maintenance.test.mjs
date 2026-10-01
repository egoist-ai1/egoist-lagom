import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

test('installer quiescence blocks queued recovery and restores verified original startup intent', { skip: process.platform !== 'win32' }, async () => {
  assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP || ''), 'Set task-scoped LAGOM_TEST_TEMP.');
  const receiptPath = path.join(process.env.LAGOM_TEST_TEMP, `installer-maintenance-${crypto.randomUUID()}.json`);
  const sourcePath = path.join(root, 'src', 'installer', 'service-maintenance.ps1');
  let execution;
  try { execution = await promisify(execFile)(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'tests', 'installer-service-maintenance.ps1'),
    '-SourceScript', sourcePath, '-ReceiptPath', receiptPath
  ], {
    cwd: root, windowsHide: true, timeout: 30_000,
    // A Node child inherits pwsh's module path unchanged; use the target
    // Windows PowerShell modules without changing the caller's environment.
    env: { ...process.env, PSModulePath: path.join(path.dirname(powershell), 'Modules') }
  }); } catch (error) {
    if (error.stdout?.trim().startsWith('{')) {
      const failed = JSON.parse(error.stdout);
      assert.fail(`Maintenance fixture failures: ${JSON.stringify(failed.cases.filter(entry => !entry.passed))}`);
    }
    throw error;
  }
  const { stdout, stderr } = execution;
  assert.equal(stderr.trim(), '');
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.failed, 0);
  assert.equal(receipt.passed, receipt.caseCount);
  assert.ok(receipt.caseCount >= 30, 'Expected a bounded fault matrix rather than a return-only test.');
  assert.equal(receipt.forbiddenHostCallAttempts, 0);
  assert.deepEqual(receipt.realOsMutations, { scm: 0, registry: 0, network: 0, processKills: 0 });
  assert.match(receipt.powerShellVersion, /^5\.1\./);
  const testedHash = crypto.createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex');
  assert.equal(receipt.productionSourceSha256.toLowerCase(), testedHash);
  assert.deepEqual(JSON.parse(await fs.readFile(receiptPath, 'utf8')), receipt);
  for (const name of [
    'queued restart independent of recovery array is blocked by Disabled',
    'queued restart fixture detects failure-actions-only suppression',
    'Core disabled and stopped before component policy changes',
    'partial suspend failure can restore all original startup modes',
    'original policy survives suspend and mixed-mode restoration',
    'reused PID birth cannot authorize termination',
    'process handle access failure cannot authorize termination',
    'zero process handle cannot authorize termination',
    'foreign cohosted service prevents process kill',
    'transient stopped sample does not satisfy stable stop'
  ]) assert.equal(receipt.cases.find(entry => entry.name === name)?.passed, true, name);
});
