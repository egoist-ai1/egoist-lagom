import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
const source=fs.readFileSync(new URL('../src/native-runtime-trust.js',import.meta.url),'utf8');
const failure=source.slice(source.indexOf('function trustFailure('),source.indexOf('function verifierEnvironment('));
const check=source.slice(source.indexOf('export async function checkProtectedGuiPrivilege('),source.indexOf('export async function requestProtectedGuiElevation(')).replace('export ','');
const compile=new Function('path','probeWindows','spawn','verifierEnvironment','setTimeout','clearTimeout','Buffer','protectedVerifierProbe',failure+check+';return checkProtectedGuiPrivilege;');
function fixture() {
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
  const timers=[];let released=0;
  const resources='C:\\Program Files\\EgoistShield\\resources';
  const invoke=compile(path.win32,async()=>({value:{helperPath:path.win32.join(resources,'core-service','win-x64','EgoistShield.Service.exe')},release:()=>released++}),()=>child,()=>({}),fn=>{timers.push(fn);return fn;},()=>{},Buffer,'fixture-probe');
  return {child,timers,resources,invoke,released:()=>released};
}
for(const exited of [false,true])test(`native token diagnostics distinguish ${exited?'exited child with unfinished pipes':'live child deadline'}`,async()=>{
  const f=fixture(),pending=f.invoke(f.resources);await Promise.resolve();
  f.child.stdout.emit('data',Buffer.from('partial'));
  if(exited)f.child.emit('exit',0);
  assert.equal(f.timers.length,1);f.timers[0]();
  await assert.rejects(pending,error=>{
    assert.equal(error.code,exited?'GUI_TOKEN_STREAM_TIMEOUT':'GUI_TOKEN_PROCESS_TIMEOUT');
    assert.deepEqual(error.observation,{responseBytes:7,exitObserved:exited,exitCode:exited?0:null});return true;
  });
  assert.equal(f.released(),1);
});
test('native privilege refusal keeps fixed native code and releases verifier lease',async()=>{
  const f=fixture(),pending=f.invoke(f.resources);await Promise.resolve();
  f.child.stdout.emit('data',Buffer.from(JSON.stringify({ok:false,code:'GUI_PRIVILEGE_UNVERIFIED',private:'secret'})));
  f.child.emit('exit',1);f.child.emit('close',1);
  await assert.rejects(pending,error=>{assert.equal(error.code,'GUI_TOKEN_UNVERIFIED');assert.deepEqual(error.observation,{nativeCode:'GUI_PRIVILEGE_UNVERIFIED',exitCode:1});assert.doesNotMatch(error.message,/secret/);return true;});
  assert.equal(f.released(),1);
});