import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const command = promisify(execFile);
const testsRoot = path.dirname(fileURLToPath(import.meta.url));
const harnessPath = path.join(testsRoot, 'windows-production-acceptance.ps1');
const fixturePath = path.join(testsRoot, 'fixtures/telegram-occupied-port-readonly.ps1');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const importedFunctions = [
  'Get-NativeTelegramPortFixtureHash', 'ConvertTo-NativeTelegramPortFixtureState',
  'New-NativeTelegramOccupiedPortActor', 'Get-NativeTelegramOccupiedPortActorIdentity',
  'Stop-NativeTelegramOccupiedPortActor', 'Assert-NativeTelegramOccupiedPortSnapshot',
  'ConvertTo-NativeTelegramConflictGuiObservation', 'ConvertTo-NativeTelegramUtcInstant',
  'Get-NativeTelegramSnapshotState',
];
const forbiddenActions = ['nativeServiceActions', 'privateDataRead', 'scm', 'registry', 'taskScheduler',
  'uac', 'setup', 'gui', 'foreground', 'globalKeys', 'clipboard', 'sourceWrites'];
const parentNames = ['PSModulePath', 'TEMP', 'TMP', 'SHIELD_TEST_WORK_ROOT', 'LAGOM_TEST_TEMP'];
const parentEnvironment = () => Object.fromEntries(parentNames.map(name => [name, process.env[name]]));

async function testWorkRoot() {
  // CI provides LAGOM_TEST_TEMP; local runs use an explicit scoped root or this actual task's work path.
  const scoped = process.env.SHIELD_TEST_WORK_ROOT || process.env.LAGOM_TEST_TEMP;
  if (scoped) {
    assert.ok(path.isAbsolute(scoped), 'Telegram guard work root must be absolute');
    assert.ok((await fs.stat(scoped)).isDirectory(), 'Telegram guard work root must exist');
    return fs.realpath(scoped);
  }
  assert.ok(process.env.CODEX_THREAD_ID, 'Set SHIELD_TEST_WORK_ROOT or use the actual Agent Brain task ID');
  const pointer = JSON.parse(await fs.readFile(path.join(os.homedir(), '.codex/brain-pointer.json'), 'utf8'));
  assert.ok(path.isAbsolute(pointer.python) && path.isAbsolute(pointer.root), 'Brain paths must be explicit and absolute');
  const result = await command(pointer.python, [path.join(pointer.root, 'brain.py'), 'task', 'paths', '--id', process.env.CODEX_THREAD_ID],
    { windowsHide: true, timeout: 15_000, maxBuffer: 32_768 });
  const paths = JSON.parse(result.stdout);
  assert.equal(paths.task_id, process.env.CODEX_THREAD_ID);
  assert.ok(path.isAbsolute(paths.work), 'Agent Brain did not return an absolute task work path');
  assert.ok((await fs.stat(paths.work)).isDirectory(), 'Actual task work directory must exist');
  return fs.realpath(paths.work);
}

for (const major of [5, 7]) {
  test(`production Telegram occupied-port guards and own IPv4/IPv6 actors on PowerShell ${major}`, {
    skip: process.platform !== 'win32', timeout: 80_000,
  }, async t => {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    assert.ok(path.isAbsolute(systemRoot), 'Native Windows SystemRoot must be absolute');
    const nativeShell = path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    // Existing CI uses LAGOM_TEST_POWERSHELL; its alias is admitted only with an actual PS7 receipt.
    const shell = major === 5 ? nativeShell : (process.env.LAGOM_TEST_POWERSHELL7 || process.env.LAGOM_TEST_POWERSHELL);
    assert.ok(shell && path.isAbsolute(shell), 'Windows requires an explicitly selected absolute PowerShell 7 executable');
    assert.equal((await fs.realpath(shell)).toLowerCase(), path.resolve(shell).toLowerCase(), 'Selected PowerShell path must be canonical');
    assert.ok((await fs.stat(shell)).isFile(), 'Selected PowerShell executable is missing');
    const beforeEnvironment = parentEnvironment();
    const beforeHarnessSha256 = sha256(await fs.readFile(harnessPath));
    const beforeFixtureSha256 = sha256(await fs.readFile(fixturePath));
    const work = await testWorkRoot();
    const ownWork = await fs.mkdtemp(path.join(work, `lagom-telegram-port-ps${major}-`));
    assert.equal(path.dirname(ownWork), work);
    const receiptPath = path.join(ownWork, 'receipt.json');
    const stderrPath = path.join(ownWork, 'stderr.log');
    const env = { ...process.env, TEMP: ownWork, TMP: ownWork };
    // Only the native child gets Windows PowerShell's own modules; parent/User/Machine are untouched.
    if (major === 5) env.PSModulePath = path.join(path.dirname(nativeShell), 'Modules');
    let result;
    try {
      result = await command(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', fixturePath, '-HarnessPath', harnessPath],
      { env, windowsHide: true, timeout: 60_000, maxBuffer: 262_144 });
    } catch (error) {
      await fs.writeFile(receiptPath, error.stdout || '');
      await fs.writeFile(stderrPath, error.stderr || '');
      t.diagnostic(JSON.stringify({ powershellMajor: major, failure: 'scoped-fixture-child', code: error.code,
        timedOut: Boolean(error.killed), receiptPath, stderrPath }));
      throw error;
    } finally {
      assert.deepEqual(parentEnvironment(), beforeEnvironment, 'Child launch changed the parent environment');
    }
    await fs.writeFile(receiptPath, result.stdout);
    await fs.writeFile(stderrPath, result.stderr);
    assert.equal(result.stderr.trim(), '', 'Guard fixture emitted errors or warnings');
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(Number(receipt.powershellVersion.split('.')[0]), major, 'Explicit executable ran the wrong PowerShell edition');
    assert.equal(receipt.edition, major === 5 ? 'Desktop' : 'Core');
    assert.equal(receipt.parserErrors, 0);
    assert.equal(receipt.caseCount, 43);
    assert.equal(receipt.passed, 43);
    assert.equal(receipt.passedAll, true);
    assert.equal(receipt.checks.length, 43);
    assert.equal(new Set(receipt.checks.map(check => check.name)).size, 43);
    for (const check of receipt.checks) assert.equal(check.passed, true, check.name);
    assert.ok(receipt.checks.some(check => check.name === 'actual production readiness guard rejects foreign ancestry'));
    assert.ok(receipt.checks.some(check => check.name === 'OFF missing phase refuses a foreign listener before own actor bind'));
    assert.deepEqual(receipt.importedFunctions.map(fn => fn.name), importedFunctions);
    for (const fn of receipt.importedFunctions) {
      assert.ok(Number.isInteger(fn.sourceLine) && fn.sourceLine > 0);
      assert.match(fn.sourceExtentSha256, /^[a-f0-9]{64}$/);
    }
    assert.equal(receipt.harnessSha256, beforeHarnessSha256, 'Receipt does not bind the actual harness bytes');
    assert.equal(sha256(await fs.readFile(harnessPath)), beforeHarnessSha256, 'Harness changed during the child check');
    assert.equal(sha256(await fs.readFile(fixturePath)), beforeFixtureSha256, 'Fixture changed during the child check');
    assert.equal(receipt.harnessEntrypointExecuted, false);
    assert.equal(receipt.nativeAcceptanceExecuted, false);
    assert.equal(receipt.productionCoreSnapshotExecuted, false);
    for (const action of forbiddenActions) assert.equal(receipt[action], 0, action);
    assert.deepEqual(receipt.ownActorObservations.map(actor => actor.host), ['127.0.0.1', '::1']);
    for (const actor of receipt.ownActorObservations) {
      assert.ok(Number.isInteger(actor.port) && actor.port >= 1024 && actor.port <= 65535);
      assert.ok(Number.isInteger(actor.processId) && actor.processId > 0 && actor.processId !== process.pid);
      assert.equal(actor.executable.toLowerCase(), path.resolve(shell).toLowerCase());
      assert.match(actor.birthUtc, /^\d{4}-\d{2}-\d{2}T/);
      for (const field of ['processHandleHeld', 'duplicateBindRejected', 'ownByteExchanged', 'released', 'postReleaseRebind']) {
        assert.equal(actor[field], true, `${actor.host}: ${field}`);
      }
      assert.ok(['AddressAlreadyInUse', 'AccessDenied'].includes(actor.duplicateBindSocketError));
      assert.equal(actor.productionPortUsed, false);
      assert.equal(actor.productionCoreSnapshotExecuted, false);
    }
    assert.equal(receipt.limitations.length, 3);
    t.diagnostic(JSON.stringify({ powershellMajor: major, passedCases: 43, importedFunctions: 9,
      harnessSha256: receipt.harnessSha256, ownActorFamilies: ['127.0.0.1', '::1'],
      nativeAcceptanceExecuted: false, nativeServiceActions: 0, privateDataRead: 0, receiptPath }));
  });
}
