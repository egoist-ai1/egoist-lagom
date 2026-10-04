import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('local private DNS recovery requires exact generation, owned processes and both DNS listeners', {skip: process.platform !== 'win32'}, async t => {
  assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP || ''), 'Set task-scoped LAGOM_TEST_TEMP.');
  const dir = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP, 'dp-'));
  const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = await promisify(execFile)(ps, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/installer-private-dns-proof.ps1'),'-TestDirectory',dir], {
    windowsHide: true, timeout: 45_000, env: {...process.env, TEMP:process.env.LAGOM_TEST_TEMP, TMP:process.env.LAGOM_TEST_TEMP, PSModulePath:path.join(path.dirname(ps),'Modules')}
  });
  assert.equal(result.stderr.trim(), '');
  const count = result.stdout.match(/Private DNS local proof checks: (\d+) passed/);
  assert.ok(count && Number(count[1]) >= 50, result.stdout);
  assert.match(result.stdout, /native SCM\/registry\/network\/termination mutations0/);
  t.diagnostic(result.stdout.trim());
});
