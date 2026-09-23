import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(root, 'tests', 'installer-dns-safety.ps1');
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

test('installer fails safely before interrupting a sole local DNS dependency', async () => {
  const { stdout, stderr } = await execFileAsync(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script
  ], { cwd: root, windowsHide: true });
  assert.equal(stderr.trim(), '');
  assert.match(stdout, /PASS: running SystemDoH and sole loopback DNS block installer mutation/);
  assert.doesNotMatch(stdout, /FAIL:/);
});
