import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('recovery reports pending application rollback and preserves the desktop launch gate',{skip:process.platform!=='win32'},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lagom-recovery-report-'));
  try{
    const result=await exec(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',path.resolve('tests/installer-recovery-reporting.ps1'),'-TestDirectory',directory],{windowsHide:true,timeout:30000});
    assert.match(result.stdout,/PASS:/);
  }finally{
    assert.equal(await fs.realpath(directory),directory);
    await fs.rm(directory,{recursive:true,force:true});
  }
});
