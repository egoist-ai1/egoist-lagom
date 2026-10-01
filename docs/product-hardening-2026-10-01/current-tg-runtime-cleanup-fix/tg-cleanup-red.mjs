import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const project='C:\\Users\\Egoist\\Desktop\\Проекты\\Приложения\\Egoist Lagom';
const {loadRecovered}=await import(pathToFileURL(path.join(project,'tests/load-recovered.mjs')));
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
