import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('uninstall serializes with upgrades and preserves pending recovery before destructive work',{skip:process.platform!=='win32'},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'uninstall-'));
  try{
    const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
    const result=await exec(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/installer-uninstall-maintenance.ps1'),'-TestDirectory',dir],{windowsHide:true,timeout:30000});
    assert.match(result.stdout,/Installer uninstall maintenance: 4 groups passed/);
  }finally{assert.equal(await fs.realpath(dir),dir);await fs.rm(dir,{recursive:true,force:true});}
});
