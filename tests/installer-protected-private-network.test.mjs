import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test('authenticated NSIS handoff preserves private DNS and rejects unverified network bypasses',{skip:process.platform!=='win32'},async t=>{
  assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP||''),'Set task-scoped LAGOM_TEST_TEMP.');
  const dir=await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP,'protected-private-'));
  const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const {stdout,stderr}=await promisify(execFile)(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/installer-protected-private-network.ps1'),'-TestDirectory',dir],{windowsHide:true,timeout:30000,env:{...process.env,TEMP:process.env.LAGOM_TEST_TEMP,TMP:process.env.LAGOM_TEST_TEMP,PSModulePath:path.join(path.dirname(ps),'Modules')}});
  assert.equal(stderr.trim(),'');assert.match(stdout,/integration: 13 groups passed/);assert.match(stdout,/mutations0/);t.diagnostic(stdout.trim());
});
