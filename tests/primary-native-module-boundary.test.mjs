import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const sourceFile=process.env.SHIELD_PRIMARY_QUERY_SOURCE || fileURLToPath(new URL('../src/recovered/electron/ipc/zapret-manager.js',import.meta.url));
const source=fs.readFileSync(sourceFile,'utf8');
function slice(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,'Actual production function boundaries required');return source.slice(a,b).trim();}
const reader=slice('async readDnsProtectionServiceIdentity() {','async readDnsProtectionStandaloneIdentity() {');
const execute=slice('async execPowerShell(','async fetchText(');
const quote=slice('function psQuote(value) {','function buildCommandResult(');
const service=source.match(/^var SERVICE_NAME = "[A-Za-z0-9_-]+";$/m)?.[0];assert.ok(service);
const executable='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const wrapper="C:\\Program Files\\Own ' Fixture\\egoistshield-zapret-service.exe";
function fixture(response,failure){
 const calls=[];
 const exec=(exe,args,options)=>{calls.push({exe,args:[...args],options:{...options}});const pending=failure?Promise.reject(failure):Promise.resolve({stdout:JSON.stringify(response)});pending.child={pid:12345};return pending;};
 const context=vm.createContext({path:path.win32,performance,Buffer,Date,Error,SyntaxError,execFileAsync$1:exec,resolveWindowsExecutable:()=>executable});
 vm.runInContext(service+'\n'+quote+'\nglobalThis.reader=({'+reader+'}).readDnsProtectionServiceIdentity;\nglobalThis.execute=({'+execute+'}).execPowerShell;',context,{timeout:1000});
 const owner={getServiceWrapperPaths:()=>({wrapperPath:wrapper}),execPowerShell:context.execute};
 return {run:()=>context.reader.call(owner),calls};
}
const stopped={state:'Stopped',pid:0,birth:null,image:wrapper};
test('actual identity reader imports absolute native Utility before Cim within original execution contract',async()=>{
 const f=fixture(stopped);assert.equal((await f.run()).state,'Stopped');assert.equal(f.calls.length,1);
 const c=f.calls[0],script=c.args[3];assert.equal(c.exe,executable);assert.deepEqual(c.args.slice(0,3),['-NoProfile','-NonInteractive','-Command']);
 assert.equal(c.options.timeout,8000);assert.equal(c.options.windowsHide,true);assert.equal(Object.hasOwn(c.options,'env'),false);
 const utility="Import-Module -Name 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop";
 const cim="Import-Module -Name 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\CimCmdlets\\CimCmdlets.psd1' -ErrorAction Stop";
 assert.ok(script.includes("$PSModuleAutoLoadingPreference='None'"));assert.ok(script.indexOf(utility)>0);assert.ok(script.indexOf(cim)>script.indexOf(utility));assert.ok(script.indexOf('Get-CimInstance Win32_Service')>script.indexOf(cim));
 assert.match(script,/Name=''EgoistShieldZapret''/);assert.ok(script.includes(wrapper.replaceAll("'","''")));
 assert.match(script,/Owned Zapret service missing/);assert.match(script,/Owned Zapret service image mismatch/);assert.match(script,/Owned Zapret wrapper identity unavailable/);
 assert.match(script,/Get-CimInstance Win32_Process/);assert.match(script,/CreationDate\.ToUniversalTime\(\)\.ToString\('o'\)/);assert.match(script,/ConvertTo-Json -Compress/);
 assert.doesNotMatch(script,/Set-Dns|Start-Service|Stop-Service|Start-Process|Stop-Process|PSModulePath|Import-Module[^;]*-Force/);
});
test('actual reader accepts only valid running/stopped identity snapshots',async()=>{
 for(const response of [stopped,{state:'Running',pid:12345,birth:'2026-10-06T00:00:00.000Z',image:wrapper}]) assert.equal((await fixture(response).run()).state,response.state);
 for(const response of [{...stopped,state:'Pending'},{...stopped,pid:-1},{...stopped,pid:1.5},{...stopped,image:'C:\\foreign.exe'},{...stopped,state:'Running'},{...stopped,state:'Running',pid:12345,birth:'invalid'}]){
  await assert.rejects(fixture(response).run(),e=>{assert.equal(e.nativeQueryDiagnostic.kind,'invalid-snapshot');return true;});
 }
});
test('actual execution timeout remains refusal with compact diagnostic and no captured text in message',async()=>{
 const secret='synthetic-private-cause-must-not-leak';const failure=Object.assign(new Error(secret),{code:1,killed:true,signal:'SIGTERM',stdout:'',stderr:secret});
 const f=fixture(null,failure);await assert.rejects(f.run(),e=>{
  assert.equal(e.nativeQueryDiagnostic.kind,'terminated');assert.equal(e.nativeQueryDiagnostic.timeoutMs,8000);assert.equal(e.nativeQueryDiagnostic.stdoutBytes,0);assert.equal(e.nativeQueryDiagnostic.stderrBytes,Buffer.byteLength(secret));assert.equal(e.nativeQueryDiagnostic.pid,12345);
  assert.equal(e.cause.name,'PowerShellExecutionError');assert.equal(e.cause.cause,failure);assert.ok(!e.message.includes(secret));assert.ok(!e.cause.message.includes(secret));
  assert.deepEqual(Object.keys(e.nativeQueryDiagnostic).sort(),['code','elapsedMs','killed','kind','pid','signal','stderrBytes','stdoutBytes','timeoutMs'].sort());return true;
 });assert.equal(f.calls[0].options.timeout,8000);
});
test('module import child failure is not accepted as service absence or snapshot success',async()=>{
 const failure=Object.assign(new Error('inert module load refusal'),{code:1,killed:false,signal:null,stdout:'',stderr:'inert error'});
 await assert.rejects(fixture(null,failure).run(),e=>{assert.equal(e.nativeQueryDiagnostic.kind,'exit');assert.equal(e.nativeQueryDiagnostic.killed,false);assert.equal(e.nativeQueryDiagnostic.timeoutMs,8000);return true;});
});
