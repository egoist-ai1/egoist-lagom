import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const source=await fs.readFile(new URL('../src/installer/setup.nsi',import.meta.url),'utf8');
const rollback=source.match(/Function RollbackFailedInstall[\s\S]*?FunctionEnd/)[0];

test('NSIS preserves extraction errors and restores the stable working directory for shortcuts',()=>{
  assert.match(source,/File \/r "\$\{PAYLOAD\}\\\*\.\*"\s+\$\{If\} \$\{Errors\}[\s\S]*?\$\{EndIf\}\s+SetOutPath "\$PLUGINSDIR"\s+WriteUninstaller/);
  assert.match(source,/StrCpy \$RollbackNeeded "0"[\s\S]*?SetOutPath "\$INSTDIR"\s+CreateShortcut/);
  assert.match(rollback,/SetOutPath "\$PLUGINSDIR"\s+!insertmacro RunPhase RollbackUpgrade/);
});

test('actual NSIS releases its install-root CWD before the production rollback function renames it', {skip:process.platform!=='win32'},async()=>{
  const temporary=path.resolve(os.tmpdir());
  const directory=await fs.mkdtemp(path.join(temporary,'lagom-cwd-rollback-'));
  assert.equal(path.dirname(directory),temporary);
  const compiler=process.env.SHIELD_MAKENSIS||path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe');
  try{
    for(const fixed of [false,true]){
      const name=fixed?'fixed':'previous';
      const install=path.join(directory,name+'-install');
      const returned=path.join(directory,name+'-returned');
      const marker=path.join(directory,name+'.txt');
      const nsi=path.join(directory,name+'.nsi');
      const exe=path.join(directory,name+'.exe');
      const actualRollback=fixed?rollback:rollback.replace(/\s+SetOutPath "\$PLUGINSDIR"/,'');
      const fixture=`Unicode true\n!include "LogicLib.nsh"\nName "CWD rollback contract"\nOutFile "${exe}"\nRequestExecutionLevel user\nSilentInstall silent\nVar PhaseResult\nVar RollbackNeeded\nVar FailureMessage\nVar WaitTicks\n!macro RunPhase PHASE\nSystem::Call 'kernel32::MoveFileW(w "$INSTDIR", w "${returned}") i .r1'\nFileOpen $0 "${marker}" w\nFileWrite $0 "$1"\nFileClose $0\nStrCpy $PhaseResult 0\n!macroend\n${actualRollback}\nFunction .onInit\nInitPluginsDir\nFunctionEnd\nSection\nStrCpy $INSTDIR "${install}"\nSetOutPath "$INSTDIR"\nFileOpen $0 "$INSTDIR\\payload.txt" w\nFileWrite $0 "fixture"\nFileClose $0\nStrCpy $RollbackNeeded 1\nCall RollbackFailedInstall\nSectionEnd\n`;
      await fs.writeFile(nsi,'\uFEFF'+fixture);
      await exec(compiler,['/V2','/INPUTCHARSET','UTF8',nsi],{windowsHide:true,timeout:30000});
      await exec(exe,['/S'],{windowsHide:true,timeout:30000});
      assert.equal(await fs.readFile(marker,'utf8'),fixed?'1':'0');
      assert.equal(Boolean(await fs.stat(returned).catch(()=>null)),fixed);
      assert.equal(await fs.readFile(path.join(fixed?returned:install,'payload.txt'),'utf8'),'fixture');
    }
  }finally{
    assert.equal(await fs.realpath(directory),directory);
    assert.equal((await fs.lstat(directory)).isSymbolicLink(),false);
    await fs.rm(directory,{recursive:true,force:true});
  }
});
