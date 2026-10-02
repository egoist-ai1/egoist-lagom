import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadRecovered } from './load-recovered.mjs';
const root='C:\\ProgramData\\EgoistShield\\Runtime\\TelegramProxy';
const target=path.win32.join(root,'runtime','egoistshield-tg-ws-proxy.exe');
function fixture(response={schemaVersion:1,operation:'telegram-runtime-cleanup',target:'primary',runtimePath:target,cleanupComplete:true,quiescent:true,stopped:[]}) {
 const calls=[];let cleared=0;
 const {TelegramProxyManager}=loadRecovered('electron/ipc/telegram-proxy-manager',{path:path.win32,process:{platform:'win32',env:{ProgramData:'C:\\ProgramData'}},promisify:fn=>fn,
 execFile:async(exe,args,options)=>{calls.push({exe,args,options});return{stdout:JSON.stringify(response)}},resolveWindowsExecutable:name=>name},['TelegramProxyManager']);
 const manager=new TelegramProxyManager('C:\\Lagom\\resources','app','user',root);manager.clearManagedState=async()=>{cleared++};
 return{manager,calls,cleared:()=>cleared};
}
test('fresh runtime cleanup uses fixed native query/stop rather than CIM or broad PowerShell enumeration',async()=>{
 const {manager,calls}=fixture();await manager.stopProcessesUsingManagedRuntime(target);
 assert.equal(calls[0].exe,'C:\\Lagom\\resources\\core-service\\win-x64\\EgoistShield.Service.exe');
 assert.deepEqual(Array.from(calls[0].args),['--telegram-runtime-cleanup','--runtime','primary']);
});
test('arbitrary runtime paths are refused before any child launch',async()=>{
 const {manager,calls}=fixture();await assert.rejects(manager.stopProcessesUsingManagedRuntime('C:\\Foreign\\egoistshield-tg-ws-proxy.exe'));assert.equal(calls.length,0);
});
test('unknown cleanup cannot clear saved state or permit copy',async()=>{
 const f=fixture({schemaVersion:1,operation:'telegram-runtime-cleanup',target:'primary',runtimePath:target,cleanupComplete:false,quiescent:false,stopped:[]});
 await assert.rejects(f.manager.stopProcessesUsingManagedRuntime(target));assert.equal(f.cleared(),0);
});

for (const change of [p => p.schemaVersion = 2, p => p.operation = 'other', p => p.target = 'legacy',
 p => p.runtimePath = 'C:\\Foreign\\egoistshield-tg-ws-proxy.exe', p => p.quiescent = false,
 p => p.stopped = [{processId:42,createdAt:null,executablePath:target}],
 p => p.stopped = [{processId:42,createdAt:'2026-10-01T00:00:00Z',executablePath:'C:\\Foreign\\egoistshield-tg-ws-proxy.exe'}],
 p => p.stopped = [1,2].map(() => ({processId:42,createdAt:'2026-10-01T00:00:00Z',executablePath:target}))]) {
 test(`cleanup rejects contradictory or incomplete native proof ${change.toString()}`,async()=>{
  const proof={schemaVersion:1,operation:'telegram-runtime-cleanup',target:'primary',runtimePath:target,cleanupComplete:true,quiescent:true,stopped:[]};change(proof);
  const f=fixture(proof);await assert.rejects(f.manager.stopProcessesUsingManagedRuntime(target));assert.equal(f.cleared(),0);
 });
}
test('legacy cleanup uses only fixed legacy token and validates exact resulting identity',async()=>{
 const legacy=path.win32.join(root,'runtime','TgWsProxy_windows_7_64bit.exe');
 const f=fixture({schemaVersion:1,operation:'telegram-runtime-cleanup',target:'legacy',runtimePath:legacy,cleanupComplete:true,quiescent:true,
 stopped:[{processId:42,createdAt:'2026-10-01T00:00:00Z',executablePath:legacy}]});
 await f.manager.stopProcessesUsingManagedRuntime(legacy);assert.equal(f.calls[0].args.at(-1),'legacy');assert.equal(f.cleared(),1);assert.equal(Object.hasOwn(f.calls[0].options,'env'),false);
});
test('unknown cleanup prevents destination removal',async()=>{
 const f=fixture({schemaVersion:1,operation:'telegram-runtime-cleanup',target:'primary',runtimePath:target,cleanupComplete:false,quiescent:false,stopped:[]});
 await assert.rejects(f.manager.prepareManagedRuntimeDestination(target));assert.equal(f.cleared(),0);
});
test('actual Windows runtime cleanup terminates only exact-path held harmless child', {skip:process.platform!=='win32',timeout:150000},async()=>{
 const base=process.env.LAGOM_TEST_TEMP || process.env.RUNNER_TEMP;
 assert.ok(base && path.isAbsolute(base),'Caller-owned test temp is required');
 const work=await fs.mkdtemp(path.join(base,'native-runtime-cleanup-'));
 const local=path.resolve('.tools/dotnet-10.0.401/dotnet.exe');
 const dotnet=process.env.SHIELD_DOTNET || (process.env.DOTNET_INSTALL_DIR && path.join(process.env.DOTNET_INSTALL_DIR,'dotnet.exe')) || (await fs.stat(local).then(()=>true,()=>false)?local:'dotnet');
 const env={...process.env,LAGOM_NATIVE_RUNTIME_CLEANUP_TEST_ROOT:path.join(work,'fixture'),DOTNET_CLI_HOME:path.join(work,'dotnet-home'),NUGET_PACKAGES:process.env.LAGOM_NATIVE_NUGET_ROOT || path.join(work,'n'),TEMP:work,TMP:work,
 DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1',DOTNET_GENERATE_ASPNET_CERTIFICATE:'false',DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'1'};
 if(path.isAbsolute(dotnet)){env.DOTNET_ROOT=path.dirname(dotnet);env.DOTNET_ROOT_X64=path.dirname(dotnet)}
 const run=promisify(execFile);
 const compiled=await run(dotnet,['build',path.resolve('tests/NativeRuntimeCleanupRegression/NativeRuntimeCleanupRegression.csproj'),'-c','Release','--nologo',
 `-p:BaseIntermediateOutputPath=${path.join(work,'obj').replace(/\\/g,'/')}/`,`-p:OutputPath=${path.join(work,'bin').replace(/\\/g,'/')}/`],{env,windowsHide:true,timeout:120000,maxBuffer:8*1024*1024}).catch(async error=>{await fs.writeFile(path.join(work,'compile-failed.txt'),(error.stdout??'')+(error.stderr??''));throw error});
 await fs.writeFile(path.join(work,'compile.txt'),compiled.stdout+compiled.stderr);
 const result=await run(path.join(work,'bin','NativeRuntimeCleanupRegression.exe'),[],{env,windowsHide:true,timeout:20000,maxBuffer:128*1024}).catch(async error=>{await fs.writeFile(path.join(work,'actual-native-failed.txt'),(error.stdout??'')+(error.stderr??''));throw error});
 await fs.writeFile(path.join(work,'actual-native.txt'),result.stdout+result.stderr);
 const actual=JSON.parse(result.stdout.trim());assert.equal(actual.kind,'actual-harmless-native-runtime-cleanup');assert.equal(actual.actualNativeApis,true);
 assert.ok(actual.checks.length>=11 && actual.checks.every(check=>check.passed));assert.equal(actual.scmWrites,false);assert.equal(actual.dnsWrites,false);assert.equal(actual.registryWrites,false);assert.equal(actual.serviceInstallationVerified,false);
});
