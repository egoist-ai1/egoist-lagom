import assert from 'node:assert/strict';
import { lstatSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const testsRoot = dirname(fileURLToPath(import.meta.url));
const declaredTemp = process.env.LAGOM_TEST_TEMP;
const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL ||
  join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
test('post-close DNS cleanup retains the actual failed inventory without rescuing the native gate',
  { skip: process.platform !== 'win32' || !declaredTemp, timeout: 40_000 }, () => {
    assert.ok(isAbsolute(declaredTemp), 'LAGOM_TEST_TEMP must name an existing declared private directory');
    const temp = lstatSync(declaredTemp);
    assert.ok(temp.isDirectory() && !temp.isSymbolicLink(), 'declared directory must be ordinary');
    assert.ok(isAbsolute(shell), 'PowerShell executable must be absolute');
    const executable = lstatSync(shell);
    assert.ok(executable.isFile() && !executable.isSymbolicLink(), 'PowerShell executable must be ordinary');
    const child = spawnSync(shell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(testsRoot, 'windows-dns-post-close-evidence.ps1'),
      '-SourcePath', join(testsRoot, 'windows-dns-native-acceptance.ps1'),
    ], { cwd: declaredTemp, env: { ...process.env, TEMP: declaredTemp, TMP: declaredTemp },
      windowsHide: true, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_048_576 });
    assert.equal(child.error, undefined, 'bounded inert child must complete');
    assert.equal(child.signal, null, 'inert child must not be terminated');
    const result = JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1).replace(/^\uFEFF/, ''));
    const failed = result.cases.filter(row => !row.passed).map(row => `${row.name}: ${row.error}`).slice(0, 4);
    assert.equal(child.status, 0, `post-close evidence regression failed: ${failed.join('; ')}`);
    assert.equal(child.stderr.trim(), '', 'inert child must not emit unexpected errors');
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.sourceParseErrors, 0);
    assert.equal(result.cases.length, 12);
    assert.equal(result.passed, 12);
    assert.equal(result.failed, 0);
    assert.equal(result.nativeBootstrapEvaluated, false);
    assert.equal(result.nativeQueries, 0);
    assert.equal(result.fileWrites, 0);
    for (const name of [
      'post-close mismatch saves the latest complete failed inventory',
      'unrelated Task definition mismatch stays fatal and is captured',
      'diagnostic failure preserves the original equality error',
      'Reset failure must not save an earlier stale observation',
      'protected-intent failure without new inventory mismatch does not save stale evidence',
      'Library consumer mismatch uses actual saver guard and makes no host/file actions',
      'Guardian consumer mismatch uses actual saver guard and makes no host/file actions',
      'actual first-capture guard preserves earlier artifact and cannot call host',
    ]) assert.equal(result.cases.find(row => row.name === name)?.passed, true);
  });
