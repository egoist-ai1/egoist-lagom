import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('WinPS preserves exact SCM argv and refuses unverifiable legacy registration restores', {skip: process.platform !== 'win32'}, async () => {
  assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP || ''), 'Set task-scoped LAGOM_TEST_TEMP.');
  const dir = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP, 'registration-'));
  try {
    const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const receiptPath = path.join(dir, 'receipt.json');
    const result = await promisify(execFile)(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.resolve('tests/installer-service-registration.ps1'), '-TestDirectory', dir, '-ReceiptPath', receiptPath], {
      windowsHide: true, timeout: 45000,
      env: {...process.env, TEMP:dir, TMP:dir, PSModulePath:path.join(path.dirname(ps), 'Modules')}
    });
    assert.equal(result.stderr.trim(), '');
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.failed, 0, JSON.stringify(receipt.cases.filter(entry => !entry.passed)));
    assert.ok(receipt.caseCount >= 25);
    assert.ok(receipt.actualEchoArguments >= 100);
    assert.equal(receipt.forbiddenHostCalls, 0);
    assert.equal(receipt.realScmMutations, 0);
    assert.equal(receipt.realRegistryMutations, 0);
    assert.equal(receipt.realNetworkMutations, 0);
    assert.equal(receipt.ownedChildTimeoutKills, 1);
    assert.match(receipt.powerShellVersion, /^5\.1\./);
    assert.deepEqual(JSON.parse(await fs.readFile(receiptPath, 'utf8')), receipt);
    const source = await fs.readFile('scripts/invoke-final-silent-reinstall.ps1');
    assert.equal(receipt.productionSourceSha256.toLowerCase(), crypto.createHash('sha256').update(source).digest('hex'));
  } finally {
    assert.equal(await fs.realpath(dir), dir);
    await fs.rm(dir, {recursive:true, force:true});
  }
});
