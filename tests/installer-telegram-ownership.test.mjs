import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('Windows upgrade rejects a reachable foreign Telegram listener', {skip: process.platform !== 'win32'}, async () => {
  const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const {stdout, stderr} = await promisify(execFile)(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'tests/installer-telegram-ownership.ps1'
  ], {windowsHide: true, timeout: 20_000});
  assert.equal(stderr.trim(), '');
  assert.match(stdout, /20 checks passed/);
});
