import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const exec = promisify(execFile);
const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const options = {windowsHide:true, timeout:30000};

test('32-bit NSIS invokes the packaged cleanup directly through 64-bit PowerShell', {skip:process.platform!=='win32'}, async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shield-nsis-phase-'));
  try {
    const cleanup=path.join(dir,'owned-cleanup.ps1');
    const marker=path.join(dir,'phase-code.txt');
    const cleanupMarker=path.join(dir,'cleanup-ran.txt');
    const exe=path.join(dir,'test.exe');
    const nsi=path.join(dir,'test.nsi');
    const setupSource=await fs.readFile('src/installer/setup.nsi','utf8');
    const runPhase=setupSource.match(/!macro RunPhase PHASE[\s\S]*?!macroend/)[0];
    await fs.writeFile(cleanup,`param($Phase,$InstallRoot)\n[IO.File]::WriteAllText('${cleanupMarker}', $Phase)\nexit 0\n`);
    await fs.writeFile(nsi,'\ufeff'+`Unicode true\n!include "x64.nsh"\nName "Shield phase fixture"\nOutFile "${exe}"\nRequestExecutionLevel user\nSilentInstall silent\nVar PhaseResult\n${runPhase}\nFunction .onInit\nInitPluginsDir\nFile /oname=$PLUGINSDIR\\owned-cleanup.ps1 "${cleanup}"\nFunctionEnd\nSection\nStrCpy $INSTDIR "${dir}"\n!insertmacro RunPhase PreInstall\nFileOpen $0 "${marker}" w\nFileWrite $0 "$PhaseResult"\nFileClose $0\nSetErrorLevel $PhaseResult\nSectionEnd\n`);
    const compiler=process.env.SHIELD_MAKENSIS || path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe');
    await exec(compiler,['/V2',nsi],options);
    await exec(exe,['/S'],options);
    assert.equal(await fs.readFile(marker,'utf8'),'0');
    assert.equal(await fs.readFile(cleanupMarker,'utf8'),'PreInstall');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('silent NSIS failure runs the production rollback function before exiting', {skip:process.platform!=='win32'}, async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shield-nsis-'));
  try {
    const source=await fs.readFile('src/installer/setup.nsi','utf8');
    const rollback=source.match(/Function RollbackFailedInstall[\s\S]*?FunctionEnd/)[0];
    const preinstall=source.match(/  !insertmacro RunPhase PreInstall[\s\S]*?\n  \$\{EndIf\}/)[0];
    const script=`Unicode true\n!include "LogicLib.nsh"\nName "Shield isolated rollback test"\nOutFile "${path.join(dir,'test.exe')}"\nRequestExecutionLevel user\nSilentInstall silent\nVar PhaseResult\nVar RollbackNeeded\nVar FailureMessage\nVar WaitTicks\n!macro RunPhase PHASE\n!if "\${PHASE}" == "PreInstall"\nStrCpy $PhaseResult 23\n!else\nFileOpen $0 "${path.join(dir,'rolled-back.txt')}" w\nFileWrite $0 "rollback ran"\nFileClose $0\nStrCpy $PhaseResult 0\n!endif\n!macroend\n${rollback}\nSection\nStrCpy $RollbackNeeded 1\n${preinstall}\nSectionEnd\n`;
    const file=path.join(dir,'test.nsi'); await fs.writeFile(file,'\ufeff'+script);
    const compiler=process.env.SHIELD_MAKENSIS || path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe');
    await exec(compiler,['/V2',file],options);
    let failure; try {await exec(path.join(dir,'test.exe'),['/S'],options);} catch(e){failure=e;}
    assert.equal(failure?.code,41);
    assert.equal(await fs.readFile(path.join(dir,'rolled-back.txt'),'utf8'),'rollback ran');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('runtime split recovery executes production functions and retains conflicting data', {skip:process.platform!=='win32'}, async()=>{
  const result=await exec(powershell,['-NoProfile','-NonInteractive','-File',path.resolve('tests/installer-stale-quarantine-regression.ps1')],options);
  assert.match(result.stdout,/PASS/);
});

test('installer force-stops legacy processes and services only when their executable is under an owned root', {skip:process.platform!=='win32'}, async()=>{
  const result=await exec(powershell,['-NoProfile','-NonInteractive','-File',path.resolve('tests/installer-owned-root-force-stop.ps1')],options);
  assert.match(result.stdout,/Owned-root force-stop discovery: PASS/);
});

test('NSIS install mutex rejects a second installer before its work begins', {skip:process.platform!=='win32'}, async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shield-mutex-'));
  let first;
  try {
    const source=await fs.readFile('src/installer/setup.nsi','utf8');
    const mutex=source.match(/!macro AcquireInstallerMutex[\s\S]*?!macroend/)[0]
      .replace('Global\\EgoistShield.Installation','Local\\ShieldTest.'+path.basename(dir));
    const exe=path.join(dir,'test.exe'), marker=path.join(dir,'entered.txt'), file=path.join(dir,'test.nsi');
    await fs.writeFile(file,'\ufeff'+`Unicode true\n!include "LogicLib.nsh"\nName "Shield mutex fixture"\nOutFile "${exe}"\nRequestExecutionLevel user\nSilentInstall silent\nVar InstallerMutex\n${mutex}\nFunction .onInit\n!insertmacro AcquireInstallerMutex\nFunctionEnd\nSection\nFileOpen $0 "${marker}" w\nFileWrite $0 "entered"\nFileClose $0\nSleep 2000\nSectionEnd\n`);
    const compiler=process.env.SHIELD_MAKENSIS || path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe');
    await exec(compiler,['/V2',file],options);
    first=exec(exe,['/S'],options);
    for(let n=0;n<100;n++){if(await fs.stat(marker).catch(()=>null))break;await new Promise(r=>setTimeout(r,20));}
    assert.equal(await fs.readFile(marker,'utf8'),'entered');
    let error;try{await exec(exe,['/S'],options);}catch(e){error=e;}
    assert.equal(error?.code,48);
    await first;
  } finally {await first?.catch(()=>{});await fs.rm(dir,{recursive:true,force:true});}
});
