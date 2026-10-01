import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
test('actual own ordinary child preserves natural early exit and bounded stdout/stderr before job cleanup', {skip:process.platform!=='win32',timeout:60000},async t=>{
 const base=process.env.LAGOM_TEST_TEMP||os.tmpdir();
 const work=await fs.mkdtemp(path.join(base,'ordinary-gui-diag-'));
 let succeeded=false;t.after(()=>succeeded&&process.env.LAGOM_TEST_KEEP_WORK!=='1'?fs.rm(work,{recursive:true,force:true,maxRetries:10,retryDelay:100}):undefined);
 const shell=process.env.LAGOM_TEST_POWERSHELL||'pwsh.exe';
 const script=path.resolve('tests/windows-ordinary-gui.ps1');
 const command="& '"+script.replaceAll("'","''")+"' -Mode SelfTest -WorkRoot '"+work.replaceAll("'","''")+"'";
 const args=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command];
 const pending=execute(shell,args,{windowsHide:true,encoding:'utf8',maxBuffer:1048576,timeout:50000,killSignal:'SIGKILL'});
 await fs.writeFile(path.join(work,'startup.json'),JSON.stringify({shell,args,processId:pending.child.pid,observedAtUtc:new Date().toISOString()},null,2));
 let output;try{output=await pending;}catch(error){await fs.writeFile(path.join(work,'failure.stdout.txt'),error.stdout||'');await fs.writeFile(path.join(work,'failure.stderr.txt'),error.stderr||'');throw error;}
 const {stdout,stderr}=output;
 const match=stdout.match(/ORDINARY_GUI_BUILD=(.+)/);assert.ok(match,stdout+stderr);
 const report=JSON.parse(await fs.readFile(path.join(match[1].trim(),'self-test.json'),'utf8'));
 assert.equal(report.ok,true);assert.equal(report.productLaunched,false);
 const early=report.earlyExit;assert.equal(early.passed,true);assert.equal(early.productLaunched,false);
 assert.equal(early.originalChild.waitResult,0);assert.equal(early.originalChild.exitCode,37);
 assert.equal(early.originalChild.waitNativeError,null);assert.equal(early.originalChild.exitCodeNativeError,null);
 assert.equal(early.cleanupChild.exitCode,37);assert.equal(early.noOrphans,true);assert.equal(early.activeProcesses,0);
 assert.equal(early.token.elevated,false);assert.equal(early.token.administratorsEnabled,false);assert.equal(early.token.integrityRid,8192);
 if(early.streams.captureAvailable){
 assert.equal(early.streams.stdout.text,'ordinary-diag-stdout\n');assert.equal(early.streams.stderr.text,'ordinary-diag-stderr\n');
 assert.equal(early.streams.stdout.completed,true);assert.equal(early.streams.stderr.completed,true);
 assert.equal(early.streams.stdout.truncated,false);assert.equal(early.streams.stderr.truncated,false);
 }else{assert.equal(early.launchApi,'CreateProcessWithTokenW');assert.match(early.streams.unavailableReason,/original|Original/);}
 assert.ok(early.desktop);assert.equal(early.launchEnvironment.TEMP,work);
 const original=report.originalEarlyExit;assert.equal(original.passed,true);assert.equal(original.originalChild.waitResult,0);assert.equal(original.originalChild.exitCode,37);assert.equal(original.streams.captureAvailable,false);assert.match(original.streams.unavailableReason,/Capture disabled/);assert.equal(original.noOrphans,true);
 assert.ok(report.guardianCrash.passed);assert.ok(report.candidateCases.every(entry=>entry.passed));
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
