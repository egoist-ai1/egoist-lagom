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

test('packager compiles the production NSIS source explicitly as UTF-8 with a BOM', async()=>{
  const source=await fs.readFile('scripts/package-windows.mjs','utf8');
  assert.match(source,/setupSourceWithBom = '\\uFEFF'/);
  assert.match(source,/\['\/V2', '\/INPUTCHARSET', 'UTF8'/);
});

test('direct interactive install hands a sole-local-DNS upgrade to the protected worker exactly once', async()=>{
  const source=await fs.readFile('src/installer/setup.nsi','utf8');
  const init=source.match(/Function \.onInit[\s\S]*?FunctionEnd/)?.[0] ?? '';
  assert.match(source,/!macro RunProtectedReinstallHandoff/);
  assert.match(source,/-EmbeddedRelease -InstallerUiPath "\$PLUGINSDIR\\ModernInstaller\.exe" -InstallerFontPath "\$PLUGINSDIR\\Unbounded\.ttf" -HandoffSignalPath "\$PLUGINSDIR\\handoff-started\.flag" -RunAfterPath "\$PLUGINSDIR\\run_after\.txt" -DelaySeconds 8/);
  assert.match(init,/\$PhaseResult == "54"[\s\S]*?\$\{AndIfNot\} \$\{Silent\}[\s\S]*?!insertmacro RunProtectedReinstallHandoff/);
  assert.equal((init.match(/!insertmacro RunProtectedReinstallHandoff/g) ?? []).length,1);
  assert.match(init,/The \/S[\s\S]*?preventing recursive dispatch/);
  assert.match(init,/handoff-ack\.flag[\s\S]*?SetErrorLevel 0[\s\S]*?Quit/);
  assert.match(init,/IntOp \$WaitTicks \$WaitTicks \+ 1[\s\S]*?\$WaitTicks < 30/);
  assert.match(init,/SetErrorLevel 54[\s\S]*?Abort/);
});

test('interactive upgrade stays on branded surfaces during handoff and duplicate launch', async()=>{
  const [nsi,ui]=await Promise.all([
    fs.readFile('src/installer/setup.nsi','utf8'),
    fs.readFile('src/installer/ModernInstaller.cs','utf8')
  ]);
  const init=nsi.match(/Function \.onInit[\s\S]*?FunctionEnd/)?.[0] ?? '';
  assert.ok(init.indexOf('Exec \'"$PLUGINSDIR\\ModernInstaller.exe"') < init.indexOf('RunPhase CheckInstallSafety'));
  assert.match(nsi,/ExecWait '\"\$PLUGINSDIR\\ModernInstaller\.exe\" \"\$PLUGINSDIR\" --busy'/);
  assert.match(init,/!insertmacro AcquireInstallerMutex 1[\s\S]*?!insertmacro RejectRunningDeferredInstall[\s\S]*?Exec '\"\$PLUGINSDIR\\ModernInstaller\.exe\"/);
  assert.match(nsi,/OpenMutexW[^\r\n]*EgoistShield\.DeferredReinstall[\s\S]*?WaitForSingleObject/);
  assert.doesNotMatch(nsi,/MessageBox[^\r\n]*Защищённая переустановка/);
  assert.match(ui,/--monitor/);
  assert.match(ui,/--busy/);
  assert.match(ui,/ui-ready\.flag/);
  assert.match(ui,/handoff-started\.flag[\s\S]*?handoff-ack\.flag/);
  assert.doesNotMatch(ui,/MessageBox\.Show/);
});

test('production NSIS handoff passes the exact running installer and launch preference to its embedded helper', {skip:process.platform!=='win32'}, async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shield handoff '));
  try {
    const setupSource=await fs.readFile('src/installer/setup.nsi','utf8');
    const handoff=setupSource.match(/!macro RunProtectedReinstallHandoff[\s\S]*?!macroend/)?.[0];
    assert.ok(handoff);
    const marker=path.join(dir,'handoff.json');
    const helper=path.join(dir,'invoke-final-silent-reinstall.ps1');
    const exe=path.join(dir,'fixture.exe');
    const nsi=path.join(dir,'fixture.nsi');
    const fixtureVersion='9.8.7';
    const psMarker=marker.replaceAll("'","''");
    await fs.writeFile(helper,`param([string]$InstallerPath,[string]$ExpectedVersion,[switch]$EmbeddedRelease,[string]$InstallerUiPath,[string]$InstallerFontPath,[string]$HandoffSignalPath,[string]$RunAfterPath,[int]$DelaySeconds)\n[IO.File]::WriteAllText('${psMarker}',([ordered]@{installer=$InstallerPath;version=$ExpectedVersion;embedded=[bool]$EmbeddedRelease;ui=$InstallerUiPath;font=$InstallerFontPath;signal=$HandoffSignalPath;runAfter=$RunAfterPath;delay=$DelaySeconds}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))\nexit 0\n`);
    await fs.writeFile(nsi,`\ufeffUnicode true\n!define PRODUCT_VERSION "${fixtureVersion}"\n!include "x64.nsh"\nName "Shield handoff fixture"\nOutFile "${exe}"\nRequestExecutionLevel user\nVar HandoffResult\n${handoff}\nFunction .onInit\nInitPluginsDir\nFile /oname=$PLUGINSDIR\\invoke-final-silent-reinstall.ps1 "${helper}"\nFileOpen $0 "$PLUGINSDIR\\run_after.txt" w\nFileWrite $0 "1"\nFileClose $0\n!insertmacro RunProtectedReinstallHandoff\nSetErrorLevel $HandoffResult\nQuit\nFunctionEnd\nSection\nSectionEnd\n`);
    const compiler=process.env.SHIELD_MAKENSIS || path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe');
    await exec(compiler,['/V2','/INPUTCHARSET','UTF8',nsi],options);
    await exec(exe,[],options);
    const observed=JSON.parse(await fs.readFile(marker,'utf8'));
    assert.equal(path.resolve(observed.installer),path.resolve(exe));
    assert.equal(observed.version,fixtureVersion);
    assert.equal(observed.embedded,true);
    assert.equal(path.basename(observed.ui),'ModernInstaller.exe');
    assert.equal(path.basename(observed.font),'Unbounded.ttf');
    assert.equal(path.basename(observed.signal),'handoff-started.flag');
    assert.equal(path.basename(observed.runAfter),'run_after.txt');
    assert.equal(observed.delay,8);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('production NSIS writes readable Unicode progress for the branded window', {skip:process.platform!=='win32'}, async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shield-progress-unicode-'));
  try {
    const source=await fs.readFile('src/installer/setup.nsi','utf8');
    const statusWrites=[...source.matchAll(/FileWriteUTF16LE \/BOM \$0 "([^"\r\n]+)"/g)].map(match=>match[0]);
    assert.equal(statusWrites.length,8);
    assert.doesNotMatch(source,/FileWrite \$0 "(?:\d+\|)/);
    const exe=path.join(dir,'probe.exe'), nsi=path.join(dir,'probe.nsi'), status=path.join(dir,'status.txt');
    await fs.writeFile(nsi,'\ufeff'+`Unicode true\nName "Unicode progress"\nOutFile "${exe}"\nRequestExecutionLevel user\nSilentInstall silent\nSection\nFileOpen $0 "${status}" w\n${statusWrites[0]}\nFileClose $0\nSectionEnd\n`);
    const compiler=process.env.SHIELD_MAKENSIS || path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe');
    await exec(compiler,['/V2','/INPUTCHARSET','UTF8',nsi],options);
    await exec(exe,['/S'],options);
    const bytes=await fs.readFile(status);
    assert.deepEqual([...bytes.subarray(0,2)],[0xff,0xfe]);
    assert.match(bytes.toString('utf16le').slice(1),/^5\|Проверяем готовность системы к обновлению/);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

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
    await fs.writeFile(file,'\ufeff'+`Unicode true\n!include "LogicLib.nsh"\nName "Shield mutex fixture"\nOutFile "${exe}"\nRequestExecutionLevel user\nSilentInstall silent\nVar InstallerMutex\n${mutex}\nFunction .onInit\n!insertmacro AcquireInstallerMutex 0\nFunctionEnd\nSection\nFileOpen $0 "${marker}" w\nFileWrite $0 "entered"\nFileClose $0\nSleep 2000\nSectionEnd\n`);
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

test('interactive installer rejects an active deferred worker before showing configuration', {skip:process.platform!=='win32'}, async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shield-deferred-mutex-'));
  let holder;
  try {
    const source=await fs.readFile('src/installer/setup.nsi','utf8');
    const mutexName='Local\\ShieldDeferredTest.'+path.basename(dir);
    const macro=source.match(/!macro RejectRunningDeferredInstall[\s\S]*?!macroend/)[0]
      .replace('Global\\EgoistShield.DeferredReinstall',mutexName);
    const holderExe=path.join(dir,'holder.exe'), probeExe=path.join(dir,'probe.exe');
    const ready=path.join(dir,'ready.txt'), entered=path.join(dir,'entered.txt');
    const holderNsi=path.join(dir,'holder.nsi'), probeNsi=path.join(dir,'probe.nsi');
    await fs.writeFile(holderNsi,'\ufeff'+`Unicode true\nName "Mutex holder"\nOutFile "${holderExe}"\nRequestExecutionLevel user\nSilentInstall silent\nSection\nSystem::Call 'kernel32::CreateMutexW(p 0, i 1, w "${mutexName}") p .r0'\nFileOpen $1 "${ready}" w\nFileWrite $1 "ready"\nFileClose $1\nSleep 2000\nSystem::Call 'kernel32::ReleaseMutex(p r0)'\nSectionEnd\n`);
    await fs.writeFile(probeNsi,'\ufeff'+`Unicode true\n!include "LogicLib.nsh"\nName "Deferred mutex probe"\nOutFile "${probeExe}"\nRequestExecutionLevel user\nSilentInstall silent\n${macro}\nFunction .onInit\nInitPluginsDir\n!insertmacro RejectRunningDeferredInstall\nFunctionEnd\nSection\nFileOpen $2 "${entered}" w\nFileWrite $2 "entered"\nFileClose $2\nSectionEnd\n`);
    const compiler=process.env.SHIELD_MAKENSIS || path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe');
    await exec(compiler,['/V2','/INPUTCHARSET','UTF8',holderNsi],options);
    await exec(compiler,['/V2','/INPUTCHARSET','UTF8',probeNsi],options);
    holder=exec(holderExe,['/S'],options);
    for(let n=0;n<100;n++){if(await fs.stat(ready).catch(()=>null))break;await new Promise(r=>setTimeout(r,20));}
    assert.equal(await fs.readFile(ready,'utf8'),'ready');
    let rejection;try{await exec(probeExe,['/S'],options);}catch(e){rejection=e;}
    assert.equal(rejection?.code,48);
    assert.equal(await fs.stat(entered).catch(()=>null),null);
    await holder;
    await exec(probeExe,['/S'],options);
    assert.equal(await fs.readFile(entered,'utf8'),'entered');
  } finally {await holder?.catch(()=>{});await fs.rm(dir,{recursive:true,force:true});}
});
