import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const command=promisify(execFile);
const testsRoot=path.dirname(fileURLToPath(import.meta.url));
const harness=path.join(testsRoot,'windows-production-acceptance.ps1');
const fixture=path.join(testsRoot,'fixtures/telegram-stop-completion-readonly.ps1');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const zeroActions=['mockOnRequests','liveUiAutomationCalls','nativeServiceActions','privateStateReads','nativeProcessQueries','actualNetworkActions','sourceWrites'];
const environmentNames=['PSModulePath','SystemDrive','TEMP','TMP','SHIELD_TEST_WORK_ROOT','LAGOM_TEST_TEMP'];
const environmentSnapshot=()=>Object.fromEntries(environmentNames.map(name=>[name,process.env[name]]));
async function testWorkRoot(){
 const scoped=process.env.SHIELD_TEST_WORK_ROOT||process.env.LAGOM_TEST_TEMP;
 if(scoped){assert.ok(path.isAbsolute(scoped));assert.ok((await fs.stat(scoped)).isDirectory());return fs.realpath(scoped);}
 assert.ok(process.env.CODEX_THREAD_ID,'Set SHIELD_TEST_WORK_ROOT or use the actual Agent Brain task ID');
 const pointer=JSON.parse(await fs.readFile(path.join(os.homedir(),'.codex/brain-pointer.json'),'utf8'));
 assert.ok(path.isAbsolute(pointer.python)&&path.isAbsolute(pointer.root));
 const result=await command(pointer.python,[path.join(pointer.root,'brain.py'),'task','paths','--id',process.env.CODEX_THREAD_ID],{windowsHide:true,timeout:15000,maxBuffer:32768});
 const task=JSON.parse(result.stdout);assert.equal(task.task_id,process.env.CODEX_THREAD_ID);assert.ok(path.isAbsolute(task.work)&&(await fs.stat(task.work)).isDirectory());return fs.realpath(task.work);
}
for(const major of[5,7])test(`actual Telegram GUI stop completion guard on PowerShell ${major}`,{skip:process.platform!=='win32',timeout:80000},async t=>{
 const systemRoot=process.env.SystemRoot;assert.ok(systemRoot&&path.isAbsolute(systemRoot),'Windows requires an absolute SystemRoot');
 const nativeShell=path.join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 const shell=major===5?nativeShell:(process.env.LAGOM_TEST_POWERSHELL7||process.env.LAGOM_TEST_POWERSHELL);
 assert.ok(shell&&path.isAbsolute(shell),'Windows requires an explicit absolute PowerShell 7 path');assert.ok((await fs.stat(shell)).isFile());assert.equal((await fs.realpath(shell)).toLowerCase(),path.resolve(shell).toLowerCase(),'Shell must be canonical');
 const beforeEnvironment=environmentSnapshot(),beforeHarness=sha256(await fs.readFile(harness)),beforeFixture=sha256(await fs.readFile(fixture));
 const work=await testWorkRoot(),ownWork=await fs.mkdtemp(path.join(work,`lagom-tg-stop-completion-ps${major}-`));assert.equal(path.dirname(ownWork),work);
 const receiptPath=path.join(ownWork,'receipt.json'),stderrPath=path.join(ownWork,'stderr.log'),env={...process.env,TEMP:ownWork,TMP:ownWork};
 if(major===5)env.PSModulePath=path.join(path.dirname(nativeShell),'Modules');
 let result;try{result=await command(shell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fixture,'-HarnessPath',harness],{env,windowsHide:true,timeout:60000,maxBuffer:262144});}
 catch(error){await fs.writeFile(receiptPath,error.stdout||'');await fs.writeFile(stderrPath,error.stderr||'');t.diagnostic(JSON.stringify({powershellMajor:major,failure:'own-readonly-telegram-stop-completion-fixture',code:error.code,timedOut:Boolean(error.killed),receiptPath,stderrPath}));throw error;}
 finally{assert.deepEqual(environmentSnapshot(),beforeEnvironment,'Child changed parent environment');}
 await fs.writeFile(receiptPath,result.stdout);await fs.writeFile(stderrPath,result.stderr);assert.equal(result.stderr.trim(),'');
 const receipt=JSON.parse(result.stdout);assert.equal(receipt.schemaVersion,1);assert.equal(receipt.kind,'source-bound-readonly-telegram-stop-completion-ci-guards');assert.equal(receipt.powerShellMajor,major);assert.equal(receipt.edition,major===5?'Desktop':'Core');assert.equal(receipt.parserErrors,0);assert.equal(receipt.actualAstFunctions,2);assert.equal(receipt.actualOriginalIfGuards,1);assert.equal(receipt.redCallerInMemoryOnly,true);assert.equal(receipt.passed,14);assert.equal(receipt.cases.length,14);assert.equal(new Set(receipt.cases.map(row=>row.name)).size,14);for(const row of receipt.cases)assert.equal(row.passed,true,row.name);
 assert.equal(receipt.inputs.length,1);assert.equal(receipt.inputs[0].sha256,beforeHarness);assert.equal(path.resolve(receipt.inputs[0].path),path.resolve(harness));assert.equal(sha256(await fs.readFile(harness)),beforeHarness);assert.equal(sha256(await fs.readFile(fixture)),beforeFixture);
 for(const action of zeroActions)assert.equal(receipt.scope[action],0,action);assert.equal(receipt.scope.mockUiLeaves,true);
 t.diagnostic(JSON.stringify({powershellMajor:major,passedCases:receipt.passed,actualAstFunctions:receipt.actualAstFunctions,harnessSha256:beforeHarness,nativeAcceptanceExecuted:false,liveUiAutomationCalls:0,privateStateReads:0,receiptPath}));
});
