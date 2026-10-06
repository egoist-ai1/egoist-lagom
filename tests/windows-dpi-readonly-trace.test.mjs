import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.join(import.meta.dirname, 'windows-dpi-readonly-trace-fixture.ps1');
const dpi = path.join(import.meta.dirname, 'windows-dpi-native-acceptance.ps1');
const shared = path.join(import.meta.dirname, 'windows-production-acceptance.ps1');
const parentEnvironment = JSON.stringify(process.env);
const workRoot = process.env.SHIELD_TEST_WORK_ROOT || process.env.LAGOM_TEST_TEMP || process.env.RUNNER_TEMP || os.tmpdir();

function ordinaryFile(file) {
  assert.ok(file && path.isAbsolute(file), 'An explicit absolute PowerShell executable is required');
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'PowerShell executable must be an existing ordinary file');
  return file;
}

for (const major of [5, 7]) {
  test('actual DPI LibraryOnly trace contract on required PowerShell ' + major, {
    skip: process.platform !== 'win32',
    timeout: 65000,
  }, t => {
    // Both editions are required on Windows. Missing or wrong-major shells fail.
    const systemRoot = process.env.SystemRoot;
    assert.ok(systemRoot && path.isAbsolute(systemRoot), 'Explicit absolute Windows SystemRoot is required');
    const shell = ordinaryFile(major === 5
      ? path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : (process.env.LAGOM_TEST_POWERSHELL7 || process.env.LAGOM_TEST_POWERSHELL));
    assert.ok(path.isAbsolute(workRoot), 'Test work root must be absolute');
    fs.mkdirSync(workRoot, { recursive: true });
    const work = fs.mkdtempSync(path.join(workRoot, 'lagom-dpi-readonly-trace-ps' + major + '-'));
    for (const leaf of ['Profile', 'Roaming', 'Local']) fs.mkdirSync(path.join(work, leaf));
    const env = {
      ...process.env,
      GITHUB_ACTIONS: 'false',
      TEMP: work,
      TMP: work,
      USERPROFILE: path.join(work, 'Profile'),
      APPDATA: path.join(work, 'Roaming'),
      LOCALAPPDATA: path.join(work, 'Local'),
      PSModuleAnalysisCachePath: path.join(work, 'own-module-analysis-cache'),
      PSModulePath: path.join(path.dirname(shell), 'Modules'),
    };
    let stdout;
    try {
      stdout = execFileSync(shell, [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text',
        '-ExecutionPolicy', 'Bypass', '-File', fixture,
        '-DpiLibraryPath', dpi, '-SharedLibraryPath', shared, '-Work', work,
      ], { cwd: root, env, windowsHide: true, timeout: 60000, maxBuffer: 65536, encoding: 'utf8' });
    } catch (error) {
      // Keep errors bounded and stage-only; no EncodedCommand or env dump.
      throw new Error('Readonly trace fixture failed on required PS' + major
        + ' (status=' + error.status + ', signal=' + error.signal + ', code=' + (error.code || 'none') + '): '
        + String(error.stderr || '').trim().slice(0, 1200));
    }
    const receipt = JSON.parse(stdout.trim());
    assert.equal(receipt.major, major, 'Selected PowerShell executable reported the wrong major');
    assert.equal(receipt.kind, 'portable-DPI-readonly-library-trace-guard');
    assert.equal(receipt.schemaVersion, 1);
    assert.ok(receipt.rows.length >= 15 && receipt.rows.every(row => row.passed === true));
    assert.equal(receipt.passed, receipt.cases);
    assert.equal(receipt.actualHostScmNetworkQueries, 0);
    assert.equal(receipt.processesLaunchedByFixture, 0);
    assert.equal(receipt.driverLoadsOrOpens, 0);
    assert.equal(receipt.nativeMutations, 0);
    assert.equal(receipt.installedPrivateReads, 0);
    assert.equal(receipt.sourceWrites, 0);
    assert.equal(receipt.parentUserMachineModulePathPreserved, true);
    assert.equal(receipt.nativeCleanupClaimed, false);
    assert.equal(JSON.stringify(process.env), parentEnvironment, 'Node parent environment changed');
    t.diagnostic('required PS' + major + ': ' + receipt.passed + '/' + receipt.cases
      + ' readonly trace assertions; native mutations 0; source writes 0');
  });
}
