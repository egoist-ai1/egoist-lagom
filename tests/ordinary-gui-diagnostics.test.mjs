import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
test('actual current Windows token proves an elevated child or refuses a local medium fixture', {skip:process.platform!=='win32',timeout:60000},async t=>{
 const base=process.env.LAGOM_TEST_TEMP||os.tmpdir();
 const work=await fs.mkdtemp(path.join(base,'ordinary-gui-diag-'));
 let succeeded=false;t.after(()=>succeeded&&process.env.LAGOM_TEST_KEEP_WORK!=='1'?fs.rm(work,{recursive:true,force:true,maxRetries:10,retryDelay:100}):undefined);
 const shell=process.env.LAGOM_TEST_POWERSHELL||'pwsh.exe';
 const script=path.resolve('tests/windows-ordinary-gui.ps1');
 const pinned=(JSON.parse(await fs.readFile(path.resolve('global.json'),'utf8'))).sdk.version;
 const sdk=process.env.SHIELD_DOTNET||path.join(process.env.DOTNET_ROOT||path.resolve('.tools',`dotnet-${pinned}`),'dotnet.exe');
 assert.ok(path.isAbsolute(sdk),'Selected .NET SDK executable must be absolute');
 assert.ok((await fs.stat(sdk)).isFile(),'Selected .NET SDK executable is missing');
 assert.ok((await fs.stat(path.join(path.dirname(sdk),'sdk',pinned))).isDirectory(),`Exact global.json SDK${pinned} is missing`);
 const environment={...process.env,SHIELD_DOTNET:sdk};
 const command="& '"+script.replaceAll("'","''")+"' -Mode SelfTest -LaunchPolicy elevated -WorkRoot '"+work.replaceAll("'","''")+"'";
 const args=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command];
 const pending=execute(shell,args,{windowsHide:true,encoding:'utf8',maxBuffer:1048576,timeout:50000,killSignal:'SIGKILL',env:environment});
 await fs.writeFile(path.join(work,'startup.json'),JSON.stringify({shell,args,sdk,pinnedSdk:pinned,processId:pending.child.pid,observedAtUtc:new Date().toISOString()},null,2));
 let output;let invocationError=null;try{output=await pending;}catch(error){invocationError=error;output={stdout:error.stdout||'',stderr:error.stderr||''};await fs.writeFile(path.join(work,'failure.stdout.txt'),output.stdout);await fs.writeFile(path.join(work,'failure.stderr.txt'),output.stderr);}
 const {stdout,stderr}=output;
 const match=stdout.match(/ORDINARY_GUI_BUILD=(.+)/);assert.ok(match,stdout+stderr);
 const report=JSON.parse(await fs.readFile(path.join(match[1].trim(),'self-test.json'),'utf8'));
 const build=match[1].trim();
 await t.test('unknown launch policy refuses before launch',async()=>{
  const receipt=path.join(work,'invalid-policy-receipt.json');const options=path.join(work,'invalid-policy-options.json');
  await fs.writeFile(options,JSON.stringify({mode:'self-test',workRoot:work,receiptPath:receipt,launchPolicy:'unexpected'}));
  let rejected=null;try{await execute(path.join(build,'bin','Release','net10.0-windows','OrdinaryGuiHarness.exe'),['--options',options],{windowsHide:true,encoding:'utf8',timeout:5000,env:{...environment,DOTNET_ROOT:path.dirname(sdk),DOTNET_ROOT_X64:path.dirname(sdk)}});}catch(error){rejected=error;}
  assert.ok(rejected,'Unknown policy was silently accepted');assert.equal(rejected.code,1);
  const failure=JSON.parse(await fs.readFile(receipt,'utf8'));assert.equal(failure.productLaunched,false);assert.equal(failure.ok,false);assert.match(failure.error,/Invalid harness mode/);
 });
 if(report.stage==='elevated-fixture-refused'){
  assert.notEqual(process.env.GITHUB_ACTIONS,'true','Hosted CI must prove a real elevated child');
  assert.ok(invocationError,'Medium token refusal must return nonzero');assert.equal(report.ok,false);
  assert.equal(report.failureCode,'current-token-not-elevated');assert.equal(report.childCreated,false);assert.equal(report.productLaunched,false);
  assert.equal(report.runnerToken.elevated,false);assert.equal(report.runnerToken.administratorsEnabled,false);assert.equal(report.runnerToken.integrityRid,8192);
  assert.equal(report.runnerToken.uiAccess,false);assert.equal(report.runnerToken.tokenType,1);assert.ok(report.runnerToken.sessionId>0);
  assert.ok(report.runnerToken.userSid.startsWith('S-1-5-21-'));assert.equal(report.noOrphans,true);assert.equal(report.activeProcesses,0);
  t.diagnostic('Actual local medium Windows token refused; no elevated-child positive proof on this host. Hosted CI requires the positive path.');
  succeeded=true;return;
 }
 assert.equal(invocationError,null,stdout+stderr);assert.equal(report.ok,true);assert.equal(report.productLaunched,false);assert.equal(report.launchPolicy,'elevated');
 assert.equal(report.runnerToken.elevated,true);assert.equal(report.runnerToken.administratorsEnabled,true);assert.ok(report.runnerToken.integrityRid>=12288);
 const early=report.earlyExit;assert.equal(early.passed,true);assert.equal(early.productLaunched,false);
 assert.equal(early.originalChild.waitResult,0);assert.equal(early.originalChild.exitCode,37);
 assert.equal(early.originalChild.waitNativeError,null);assert.equal(early.originalChild.exitCodeNativeError,null);
 assert.equal(early.cleanupChild.exitCode,37);assert.equal(early.noOrphans,true);assert.equal(early.activeProcesses,0);
 assert.equal(early.launchPolicy,'elevated');assert.equal(early.token.elevated,true);assert.equal(early.token.administratorsEnabled,true);assert.ok(early.token.integrityRid>=12288);
 assert.equal(early.token.uiAccess,false);assert.equal(early.token.tokenType,1);assert.equal(early.token.userSid,report.runnerToken.userSid);assert.equal(early.token.sessionId,report.runnerToken.sessionId);
 assert.equal(early.tokenMethod,'current-elevated');assert.equal(early.launchApi,'CreateProcessW-fixture');assert.equal(early.streams.captureAvailable,true);
 if(early.streams.captureAvailable){
 assert.equal(early.streams.stdout.text,'ordinary-diag-stdout\n');assert.equal(early.streams.stderr.text,'ordinary-diag-stderr\n');
 assert.equal(early.streams.stdout.completed,true);assert.equal(early.streams.stderr.completed,true);
 assert.equal(early.streams.stdout.truncated,false);assert.equal(early.streams.stderr.truncated,false);
 }else{assert.equal(early.launchApi,'CreateProcessWithTokenW');assert.match(early.streams.unavailableReason,/original|Original/);}
 assert.ok(early.desktop);assert.equal(early.launchEnvironment.TEMP,work);
 const original=report.originalEarlyExit;assert.equal(original.passed,true);assert.equal(original.originalChild.waitResult,0);assert.equal(original.originalChild.exitCode,37);assert.equal(original.streams.captureAvailable,false);assert.match(original.streams.unavailableReason,/Capture disabled/);assert.equal(original.noOrphans,true);
 assert.equal(original.token.elevated,true);assert.equal(original.token.administratorsEnabled,true);assert.ok(original.token.integrityRid>=12288);assert.equal(original.token.userSid,report.runnerToken.userSid);assert.equal(original.token.sessionId,report.runnerToken.sessionId);
 assert.ok(report.guardianCrash.passed);assert.equal(report.guardianCrash.token.elevated,true);assert.equal(report.guardianCrash.token.administratorsEnabled,true);assert.equal(report.guardianCrash.token.userSid,report.runnerToken.userSid);assert.equal(report.guardianCrash.token.sessionId,report.runnerToken.sessionId);
 succeeded=true;
});

test('ordinary receipt reader preserves an exact100ns timestamp as a string', {skip:process.platform!=='win32',timeout:15000},async t=>{
 const work=await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP||os.tmpdir(),'ordinary-json-diag-'));
 t.after(()=>fs.rm(work,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const input=path.join(work,'receipt.json');const birth='2026-10-01T18:26:12.1624554Z';await fs.writeFile(input,JSON.stringify({startTimeUtc:birth}));
 const quote=value=>value.replaceAll("'","''");const library=path.resolve('tests/windows-ordinary-gui.ps1');
 const command=`. '${quote(library)}' -LibraryOnly;$value=Read-OrdinaryGuiJson -Path '${quote(input)}';if($value.startTimeUtc -isnot [string]){throw 'Receipt reader changed timestamp type'};$value|ConvertTo-Json -Compress`;
 const {stdout}=await execute(process.env.LAGOM_TEST_POWERSHELL||'pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,encoding:'utf8',timeout:10000});
 assert.equal(JSON.parse(stdout).startTimeUtc,birth);
});
