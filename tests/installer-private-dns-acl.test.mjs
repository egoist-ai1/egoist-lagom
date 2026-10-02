import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('legacy private resolver ACL upgrade preserves its owned running generation and refuses foreign authority', {skip: process.platform !== 'win32'}, async t => {
  const taskTemp = process.env.LAGOM_TEST_TEMP || '';
  assert.ok(path.isAbsolute(taskTemp), 'Set task-scoped LAGOM_TEST_TEMP.');
  const root = await fs.mkdtemp(path.join(taskTemp, 'dns-acl-'));
  const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = await promisify(execFile)(shell, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/installer-private-dns-acl.ps1'),'-TestDirectory',root], {
    windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024,
    env: {...process.env, TEMP: taskTemp, TMP: taskTemp, PSModulePath: path.join(path.dirname(shell), 'Modules')}
  });
  assert.equal(result.stderr.trim(), '');
  assert.match(result.stdout, /Private DNS ACL upgrade: 14 cases passed/);
  assert.match(result.stdout, /production mutations0/);
  t.diagnostic(result.stdout.trim());
});
