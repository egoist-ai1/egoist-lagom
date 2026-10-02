import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRecovered } from './load-recovered.mjs';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
const bindings = {
 path, process, resolveWindowsExecutable:value=>value, promisify:value=>value, execFile:async()=>{}, normalizeSystemDohUrl:value=>value, parseSystemDohUrl:()=>({serverPort:8443}), buildSystemDohLoopbackCandidates:()=>['127.0.0.1','127.0.0.2'],
};
const selectedSource=process.env.LAGOM_DNS_STOP_MANAGER_SOURCE;
const { SystemDohManager } = selectedSource ? (()=>{const context=vm.createContext({URL,Buffer,AbortController,setTimeout,clearTimeout,console,...bindings}); vm.runInContext(fs.readFileSync(selectedSource,'utf8')+'\n;globalThis.api={SystemDohManager}',context); return context.api;})() : loadRecovered('electron/ipc/system-doh-service-manager', bindings, ['SystemDohManager']);
function fixture(state='running') {
 const events=[]; let running=state==='running'; const saved={url:'https://private.example:8443/profile',localAddress:'127.0.0.1',localPort:53};
 const manager=Object.create(SystemDohManager.prototype);
 Object.assign(manager,{runtimeDir:path.join(process.env.TEMP ?? process.cwd(),"synthetic-dns"),coreService:{ stopOwnedService:async()=>{events.push('core-stop');running=false;}, installOwnedService:async()=>events.push('install'), startOwnedService:async()=>{events.push('start');running=true;} },
  status:async()=>({running:false,verified:false,serviceRunning:running,serviceState:state,currentUrl:saved.url}),
  queryServiceStatus:async()=>({installed:true,running,state:running?'running':state==='stop-pending'?'stop-pending':'stopped',pid:123}),
  readManagedState:async()=>saved, stopLegacyStandaloneRuntime:async()=>events.push('cleanup'), waitForServiceState:async()=>events.push('confirm'),
  waitUntilReady:async()=>true, writeManagedState:async value=>events.push(['saved',value.url,value.localAddress]), invalidateStatusCache:()=>{},
  applyInternal:async()=>{events.push('apply');throw new Error('Unexpected apply');},
 });
 return {manager,events,saved};
}
test('manual restart replaces a degraded running local resolver without DNS restore or config rewrite',async()=>{
 const {manager,events,saved}=fixture(); await manager.restart();
 assert.deepEqual(events.filter(v=>typeof v==='string'),['core-stop','confirm','cleanup','install','start','confirm']);
 assert.equal(events.at(-1)[1],saved.url); assert.equal(events.at(-1)[2],saved.localAddress);
});
test('explicit restart replaces a healthy resolver too',async()=>{
 const {manager,events}=fixture(); manager.status=async()=>({running:true,verified:true,serviceRunning:true,serviceState:'running'}); await manager.restart(); assert.ok(events.includes('core-stop')&&events.includes('start'));
});
test('stop pending goes through Core stop and must confirm completion',async()=>{
 const {manager,events}=fixture('stop-pending'); await manager.stopServiceInternal(); assert.deepEqual(events,['core-stop','confirm']);
});
test('stop readiness error is surfaced rather than enabling subsequent removal',async()=>{
 const {manager,events}=fixture(); manager.waitForServiceState=async()=>{throw new Error('SCM stop timeout');}; await assert.rejects(manager.stopServiceInternal(),/SCM stop timeout/); assert.deepEqual(events,['core-stop']);
});
test('unknown SCM state refuses manual restart before any mutation',async()=>{
 const {manager,events}=fixture('unknown'); await assert.rejects(manager.restart(),/состояние|неизвестно/i); assert.deepEqual(events,[]);
});
test('foreign SCM image rejected by Core leaves runtime and saved configuration untouched',async()=>{
 const {manager,events}=fixture(); manager.coreService.stopOwnedService=async()=>{throw new Error('foreign ImagePath');}; await assert.rejects(manager.restart(),/foreign ImagePath/); assert.deepEqual(events,[]);
});
test('failed fresh readiness keeps saved URL and reports the restarted but degraded resolver',async()=>{
 const {manager,events}=fixture(); manager.waitUntilReady=async()=>false; await assert.rejects(manager.restart(),/перезапущена.*проверку/); assert.ok(events.includes('start')); assert.equal(events.includes('apply'),false);
});
test('protected orphan cleanup delegates to privileged fixed owned service stop and surfaces refusal',async()=>{
 const {manager,events}=fixture(); delete manager.stopLegacyStandaloneRuntime; await manager.stopLegacyStandaloneRuntime(); assert.deepEqual(events,['core-stop']);
 manager.coreService.stopOwnedService=async()=>{throw new Error('owned cleanup refused');}; await assert.rejects(manager.stopLegacyStandaloneRuntime(),/owned cleanup refused/);
});


function applyFixture() {
 const {manager,events}=fixture('stopped'); let written=0;
 Object.assign(manager,{status:async()=>({serviceRunning:false,serviceState:'stopped'}),ensureManagedRuntimeInstalled:async()=>({runtimePath:'synthetic.exe'}),ensureServiceWrapperInstalled:async()=>{},
  stopAndRemoveInternal:async()=>events.push('initial-restore'), prepareConfig:async()=>events.push('candidate'),writeServiceWrapperConfig:async()=>{},writeManagedState:async()=>written++,
  installService:async()=>events.push('new-install'),startServiceInternal:async()=>{throw new Error('bind: initial failure');},readLogTail:async()=>null,
  removeServiceInternal:async()=>{throw new Error('rollback service ownership changed');},stopLegacyStandaloneRuntime:async()=>events.push('kill-after-refusal'),clearManagedState:async()=>events.push('clear-after-refusal')});
 delete manager.applyInternal;
 return {manager,events,written:()=>written};
}
test('failed candidate removal keeps saved state/runtime and surfaces both original and rollback failure',async()=>{
 const {manager,events,written}=applyFixture(); await assert.rejects(manager.applyInternal('https://private.example:8443/profile'),/bind: initial failure.*ownership changed/); assert.deepEqual(events,['initial-restore','candidate','new-install']); assert.equal(written(),1);
});
test('failed orphan cleanup after candidate removal keeps state and prevents trying another loopback',async()=>{
 const {manager,events,written}=applyFixture(); manager.removeServiceInternal=async()=>events.push('candidate-removed'); manager.stopLegacyStandaloneRuntime=async()=>{throw new Error('orphan cleanup denied');}; await assert.rejects(manager.applyInternal('https://private.example:8443/profile'),/initial failure.*orphan cleanup denied/); assert.deepEqual(events,['initial-restore','candidate','new-install','candidate-removed']); assert.equal(written(),1);
});
