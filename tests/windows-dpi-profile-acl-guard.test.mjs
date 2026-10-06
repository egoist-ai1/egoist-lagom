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
const nativeSource = path.join(testsRoot, 'windows-production-acceptance.ps1');
const dpiSource = path.join(testsRoot, 'windows-dpi-native-acceptance.ps1');
const fixture = path.join(testsRoot, 'fixtures/dpi-profile-acl-readonly.ps1');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const functions = ['Assert-NativeOrdinaryPath', 'Assert-NativePathWithin', 'Assert-NativeAdministratorAcl', 'Assert-NativeAdministratorOwned'];
const zeroActions = ['actualAclOsRead', 'harnessEntrypointsExecuted', 'installedProductFilesRead', 'privateDataRead',
  'serviceActions', 'scm', 'tasks', 'drivers', 'gui', 'uia', 'uac', 'setup', 'networkQueries', 'externalNetwork', 'sourceWrites'];
const environmentNames = ['PSModulePath', 'SystemDrive', 'TEMP', 'TMP', 'SHIELD_TEST_WORK_ROOT', 'LAGOM_TEST_TEMP'];
const environmentSnapshot = () => Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));

async function testWorkRoot() {
  const scoped = process.env.SHIELD_TEST_WORK_ROOT || process.env.LAGOM_TEST_TEMP;
  if (scoped) {
    assert.ok(path.isAbsolute(scoped), 'Readonly DPI ACL work root must be absolute');
    assert.ok((await fs.stat(scoped)).isDirectory(), 'Scoped test work root must exist');
    return fs.realpath(scoped);
  }
  assert.ok(process.env.CODEX_THREAD_ID, 'Set SHIELD_TEST_WORK_ROOT or use the actual Agent Brain task ID');
  const pointer = JSON.parse(await fs.readFile(path.join(os.homedir(), '.codex/brain-pointer.json'), 'utf8'));
  assert.ok(path.isAbsolute(pointer.python) && path.isAbsolute(pointer.root));
  const result = await command(pointer.python, [path.join(pointer.root, 'brain.py'), 'task', 'paths', '--id', process.env.CODEX_THREAD_ID],
    { windowsHide: true, timeout: 15_000, maxBuffer: 32_768 });
  const task = JSON.parse(result.stdout);
  assert.equal(task.task_id, process.env.CODEX_THREAD_ID);
  assert.ok(path.isAbsolute(task.work) && (await fs.stat(task.work)).isDirectory());
  return fs.realpath(task.work);
}

for (const major of [5, 7]) {
  test(`actual DPI profile caller preserves canonical path and administrator ACL guards on PowerShell ${major}`, {
    skip: process.platform !== 'win32', timeout: 80_000,
  }, async t => {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    assert.ok(path.isAbsolute(systemRoot));
    const nativeShell = path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const shell = major === 5 ? nativeShell : (process.env.LAGOM_TEST_POWERSHELL7 || process.env.LAGOM_TEST_POWERSHELL);
    assert.ok(shell && path.isAbsolute(shell), 'Windows requires an explicit absolute PowerShell 7 path');
    assert.ok((await fs.stat(shell)).isFile());
    assert.equal((await fs.realpath(shell)).toLowerCase(), path.resolve(shell).toLowerCase(), 'Selected shell must be canonical');
    const beforeEnvironment = environmentSnapshot();
    const beforeHashes = [sha256(await fs.readFile(nativeSource)), sha256(await fs.readFile(dpiSource))];
    const beforeFixture = sha256(await fs.readFile(fixture));
    const work = await testWorkRoot();
    const ownWork = await fs.mkdtemp(path.join(work, `lagom-dpi-profile-acl-ps${major}-`));
    assert.equal(path.dirname(ownWork), work);
    const receiptPath = path.join(ownWork, 'receipt.json');
    const stderrPath = path.join(ownWork, 'stderr.log');
    const env = { ...process.env, TEMP: ownWork, TMP: ownWork };
    // Pin only the native child; the PS7 child and parent/User/Machine retain their environment.
    if (major === 5) env.PSModulePath = path.join(path.dirname(nativeShell), 'Modules');
    let result;
    try {
      result = await command(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture,
        '-NativeSourcePath', nativeSource, '-DpiSourcePath', dpiSource, '-WorkDirectory', ownWork],
      { env, windowsHide: true, timeout: 60_000, maxBuffer: 262_144 });
    } catch (error) {
      await fs.writeFile(receiptPath, error.stdout || '');
      await fs.writeFile(stderrPath, error.stderr || '');
      t.diagnostic(JSON.stringify({ powershellMajor: major, failure: 'own-readonly-acl-fixture', code: error.code,
        timedOut: Boolean(error.killed), receiptPath, stderrPath }));
      throw error;
    } finally {
      assert.deepEqual(environmentSnapshot(), beforeEnvironment, 'Own child changed the parent environment');
    }
    await fs.writeFile(receiptPath, result.stdout);
    await fs.writeFile(stderrPath, result.stderr);
    assert.equal(result.stderr.trim(), '');
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.kind, 'source-bound-readonly-dpi-profile-acl-ci-guards');
    assert.equal(Number(receipt.powershellVersion.split('.')[0]), major, 'Explicit executable ran the wrong shell');
    assert.equal(receipt.edition, major === 5 ? 'Desktop' : 'Core');
    assert.equal(receipt.parserErrors, 0);
    assert.equal(receipt.pass, 19);
    assert.equal(receipt.caseCount, 19);
    assert.equal(receipt.checks.length, 19);
    assert.equal(new Set(receipt.checks.map(check => check.name)).size, 19);
    for (const check of receipt.checks) assert.equal(check.passed, true, check.name);
    assert.ok(receipt.checks.some(check => check.name === 'TrustedInstaller owner is forbidden for ProgramData profile'));
    assert.ok(receipt.checks.some(check => check.name === 'TrustedInstaller write ACE is forbidden for ProgramData profile'));
    assert.ok(receipt.checks.some(check => check.name === 'current actual profile caller rejects a reparse leaf before its ACL read'));
    assert.deepEqual(receipt.importedFunctions.map(fn => fn.name), functions);
    for (const fn of receipt.importedFunctions) {
      assert.ok(Number.isInteger(fn.sourceLine) && fn.sourceLine > 0);
      assert.match(fn.sourceExtentSha256, /^[a-f0-9]{64}$/);
    }
    assert.equal(receipt.nativeSourceSha256, beforeHashes[0]);
    assert.equal(receipt.dpiSourceSha256, beforeHashes[1]);
    assert.deepEqual([sha256(await fs.readFile(nativeSource)), sha256(await fs.readFile(dpiSource))], beforeHashes,
      'Actual source changed during the readonly guard check');
    assert.equal(sha256(await fs.readFile(fixture)), beforeFixture);
    assert.equal(receipt.currentProfileCaller.text, 'Assert-NativeAdministratorOwned $acceptanceProfile');
    assert.ok(Number.isInteger(receipt.currentProfileCaller.line) && receipt.currentProfileCaller.line > 0);
    assert.equal(receipt.wrongCallerVariant.text, receipt.currentProfileCaller.text + ' -InstallationPath');
    assert.equal(receipt.wrongCallerVariant.inMemoryOnly, true);
    assert.equal(receipt.redProgramDataError, 'Installation ACL scope escaped canonical Program Files.');
    assert.equal(receipt.redWrongCallerError, 'Installation ACL scope escaped canonical Program Files.');
    assert.equal(receipt.greenExactProgramData, true);
    assert.equal(receipt.canonicalInstallationGuardChanged, false);
    assert.equal(receipt.trustedInstallerProgramDataAdmitted, false);
    assert.equal(receipt.securityModuleTypeDataLoaded, true);
    assert.equal(receipt.mockedAclLeafReads, 3);
    assert.equal(receipt.mockedReparseLeafReads, 1);
    for (const action of zeroActions) assert.equal(receipt[action], 0, action);
    assert.equal(receipt.limitations.length, 3);
    t.diagnostic(JSON.stringify({ powershellMajor: major, passedCases: 19, actualFunctions: 4,
      nativeSourceSha256: receipt.nativeSourceSha256, dpiSourceSha256: receipt.dpiSourceSha256,
      nativeAcceptanceExecuted: false, actualAclOsRead: 0, privateDataRead: 0, receiptPath }));
  });
}
