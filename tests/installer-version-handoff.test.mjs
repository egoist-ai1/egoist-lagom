import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const powershell=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const execFileAsync=promisify(execFile);
test('identity publication and manual reinstall use verified PE/runtime ownership', {skip:process.platform!=='win32'}, async()=>{
  assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP || ''),'Set task-scoped LAGOM_TEST_TEMP.');
  const {stdout,stderr}=await execFileAsync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'tests/installer-version-handoff.ps1')],{cwd:root,windowsHide:true,timeout:30_000});
  assert.equal(stderr.trim(),'');assert.match(stdout,/Version and handoff checks: 13 passed/);
});
test('unsafe refusal never dispatches, silent workers never recurse and framework gate precedes extraction',async()=>{
  const source=await fs.readFile(path.join(root,'src/installer/setup.nsi'),'utf8');
  const guard=source.indexOf('ReadRegDWORD $0 HKLM');
  const extraction=source.indexOf('File /oname=$PLUGINSDIR\\owned-cleanup.ps1');
  const handoff=source.indexOf('!insertmacro RunProtectedReinstallHandoff',source.indexOf('RunPhase CheckInstallSafety'));
  assert.ok(guard>=0 && guard<extraction && extraction<handoff);
  assert.match(source.slice(handoff-180,handoff),/\$PhaseResult == "54"[\s\S]*\$\{AndIfNot\} \$\{Silent\}/);
  assert.match(source,/\$PhaseResult == "58"[\s\S]*SetErrorLevel 58[\s\S]*SetErrorLevel 54/);
});
test('actual cleanup safety phase distinguishes protected handoff, unsafe failure and first install', {skip:process.platform!=='win32'}, async()=>{
  const script=path.join(root,'tests/installer-version-handoff.ps1');
  for(const [scenario,expected] of [['Existing',54],['Unsafe',58],['Fresh',0],['Protected',0]]){
    let observed=0;
    try {await execFileAsync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-SafetyScenario',scenario],{cwd:root,windowsHide:true,timeout:30_000});}
    catch(error){observed=error.code;}
    assert.equal(observed,expected,scenario+' returned the wrong safety disposition');
  }
});
