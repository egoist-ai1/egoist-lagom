import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRecovered} from './load-recovered.mjs';
const {SystemDohManager}=loadRecovered('electron/ipc/system-doh-service-manager',{promisify:()=>()=>{},execFile:()=>{},normalizeSystemDohUrl:value=>value,parseSystemDohUrl:()=>({serverPort:8443})},['SystemDohManager']);

function fixture(pendingAdapters=0){
  const calls=[];
  const manager=Object.create(SystemDohManager.prototype);
  Object.assign(manager,{
    coreService:{restoreOwnedDns:async()=>{calls.push('restore');return {pendingAdapters}}},
    readManagedState:async()=>({localAddress:'127.0.0.1'}),
    removeServiceInternal:async()=>calls.push('remove'),
    stopLegacyStandaloneRuntime:async()=>calls.push('stop'),
    clearManagedState:async()=>calls.push('clear'),
    invalidateStatusCache:()=>{},status:async()=>({running:false})
  });
  return {manager,calls};
}
test('System DoH restores adapter ownership before stopping its resolver',async()=>{
  const {manager,calls}=fixture();
  await manager.stopAndRemove();
  assert.deepEqual(calls,['restore','remove','stop','clear']);
});
test('an absent owned adapter keeps its DNS resolver and recovery state alive',async()=>{
  const {manager,calls}=fixture(1);
  await assert.rejects(manager.stopAndRemove(),/адаптер/);
  assert.deepEqual(calls,['restore']);
});
test('failed ownership restoration propagates without deleting the resolver',async()=>{
  const {manager,calls}=fixture();
  manager.coreService.restoreOwnedDns=async()=>{throw new Error('journal unavailable')};
  await assert.rejects(manager.stopAndRemove(),/journal unavailable/);
  assert.deepEqual(calls,[]);
});
test('applying the same upstream keeps the running local resolver online',async()=>{
  const {manager,calls}=fixture();
  const current={serviceRunning:true,running:true,verified:true,currentUrl:'https://resolver.example/dns-query',localAddress:'127.0.0.1'};
  manager.status=async()=>current;
  manager.stopAndRemove=async()=>calls.push('stop');
  const result=await manager.apply(current.currentUrl);
  assert.equal(result,current);
  assert.deepEqual(calls,[]);
});
test('changing a running upstream fails before stopping its resolver',async()=>{
  const {manager,calls}=fixture();
  manager.status=async()=>({serviceRunning:true,running:true,verified:true,currentUrl:'https://old.example/dns-query'});
  manager.stopAndRemove=async()=>calls.push('stop');
  await assert.rejects(manager.apply('https://new.example/dns-query'),/безопасного переноса/);
  assert.deepEqual(calls,[]);
});
