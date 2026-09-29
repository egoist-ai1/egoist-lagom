import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('production installer preserves hidden restart and checks an actual app root',{skip:process.platform!=='win32'},()=>{
  const result=execFileSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/installer-background-restart.ps1')],
    {windowsHide:true,encoding:'utf8',timeout:15000});
  assert.match(result,/PASS: background restart stays hidden/);
});
