import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exec = promisify(execFile);
const powershell = process.env.LAGOM_TEST_POWERSHELL || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

test('CI Git OpenSSL resolution handles duplicate applications and native layouts, and rejects missing or invalid inputs', {skip:process.platform !== 'win32'}, async () => {
  assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP || ''), 'Set task-owned LAGOM_TEST_TEMP.');
  const {stdout, stderr} = await exec(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tests/ci-git-openssl.ps1')], {cwd:root, windowsHide:true, timeout:15000});
  assert.equal(stderr.trim(), '');
  assert.match(stdout, /Git OpenSSL resolution checks: 10 passed/);
});
