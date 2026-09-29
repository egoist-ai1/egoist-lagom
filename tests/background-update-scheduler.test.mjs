import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { sourceFor, loadRecovered } from './load-recovered.mjs';

function scheduler(overrides={}) {
  const source=sourceFor('electron/main');
  const timers=[],warnings=[];
  const context=vm.createContext({autoUpdateEnabled:true,updateCheckInterval:null,isQuitting:false,componentUpdateInFlight:false,
    desktopUpdater:{installPromise:null,async check(){return {ok:true,phase:'up-to-date'};}},
    globalRuntimeManager:{async status(){return {connected:false};}},globalStateStore:null,
    globalNetworkCombinatorManager:{isMutationIdle:()=>true},pendingBootRecovery:new Set(),
    toPublicUpdateResult:x=>x,emitUpdateResult(){},Notification:{isSupported:()=>false},
    app:{isPackaged:true},logger:{info(){},warn(...args){warnings.push(args);}},
    setTimeout(callback,delay){const timer={callback,delay,unref(){},cleared:false};timers.push(timer);return timer;},
    clearTimeout(timer){timer.cleared=true;},...overrides});
  const start=source.indexOf('var backgroundUpdateInFlight = false;');
  vm.runInContext(source.slice(start,source.indexOf('function setupAutoUpdater()',start)),context);
  return {context,timers,warnings};
}

test('transient background failures have bounded backoff and success resets it',async()=>{
  const {context,timers}=scheduler({desktopUpdater:{async check(){return {ok:false,phase:'failed',retryable:true};}}});
  for(let i=0;i<7;i++)await context.runBackgroundUpdateCheck();
  assert.deepEqual(timers.map(t=>t.delay),[300000,900000,3600000,10800000,86400000,86400000,86400000]);
  assert.equal(timers.filter(t=>!t.cleared).length,1);
  context.desktopUpdater.check=async()=>({ok:true,phase:'up-to-date'});
  await context.runBackgroundUpdateCheck();
  assert.equal(context.backgroundUpdateFailures,0);
  assert.equal(timers.at(-1).delay,86400000);
});

test('concurrent background triggers share one operation and one follow-up timer',async()=>{
  let resolveCheck,calls=0;
  const {context,timers}=scheduler({desktopUpdater:{check(){calls++;return new Promise(resolve=>{resolveCheck=resolve;});}}});
  const first=context.runBackgroundUpdateCheck();
  await context.runBackgroundUpdateCheck();
  assert.equal(calls,1);
  assert.equal(timers.length,0);
  resolveCheck({ok:true,phase:'up-to-date'});await first;
  assert.equal(timers.length,1);
  assert.equal(context.backgroundUpdateInFlight,false);
});

test('disabling updates or quitting during a check leaves no timer',async()=>{
  for(const flag of ['autoUpdateEnabled','isQuitting']){
    let resolveCheck;
    const {context,timers}=scheduler({desktopUpdater:{check:()=>new Promise(resolve=>{resolveCheck=resolve;})}});
    const operation=context.runBackgroundUpdateCheck();context[flag]=flag==='isQuitting';
    resolveCheck({ok:true,phase:'up-to-date'});await operation;
    assert.equal(timers.length,0);
  }
});

test('VPN connection and component update defer automatic installation',async()=>{
  for(const busy of ['vpn','component']){
    let installations=0;
    const {context,timers}=scheduler({componentUpdateInFlight:busy==='component',
      globalRuntimeManager:{async status(){return {connected:busy==='vpn'};}},
      desktopUpdater:{installPromise:null,async check(){return {ok:true,phase:'available',latestVersion:'3.7.9'};},async checkAndInstall(){installations++;}}});
    await context.runBackgroundUpdateCheck();
    assert.equal(installations,0);assert.equal(timers.at(-1).delay,900000);
  }
});

test('update readiness rechecks queued mutations and boot recovery after async VPN status',async()=>{
  let resolveStatus,idle=true;
  const {context}=scheduler({globalNetworkCombinatorManager:{isMutationIdle:()=>idle},
    globalRuntimeManager:{status:()=>new Promise(resolve=>{resolveStatus=resolve;})}});
  const readiness=context.canInstallDesktopUpdate();idle=false;resolveStatus({connected:false});
  assert.equal(await readiness,false);
  idle=true;context.pendingBootRecovery.add(Promise.resolve());
  assert.equal(await context.canInstallDesktopUpdate(),false);
});

test('background exceptions are caught and invalid signatures are not immediately retried',async()=>{
  const {context,timers,warnings}=scheduler({desktopUpdater:{async check(){throw new Error('network unavailable');}}});
  await context.runBackgroundUpdateCheck();
  assert.equal(context.backgroundUpdateInFlight,false);assert.equal(timers.at(-1).delay,300000);assert.equal(warnings.length,1);
  context.desktopUpdater.check=async()=>({ok:false,phase:'blocked',failureCode:'signature-invalid',retryable:false});
  await context.runBackgroundUpdateCheck();
  assert.equal(timers.at(-1).delay,86400000);
});

test('successful metadata checks do not reset repeated installation-failure backoff',async()=>{
  const {context,timers}=scheduler({desktopUpdater:{installPromise:null,
    async check(){return {ok:true,phase:'available',latestVersion:'3.7.9'};},
    async checkAndInstall(){return {ok:false,phase:'failed',retryable:true,failureCode:'offline'};}}});
  for(let i=0;i<3;i++)await context.runBackgroundUpdateCheck();
  assert.deepEqual(timers.map(t=>t.delay),[300000,900000,3600000]);
  assert.equal(context.backgroundUpdateFailures,3);
});

test('minimized second launch never shows, restores or changes the active window',()=>{
  const source=sourceFor('electron/main');
  const start=source.indexOf('app.on("second-instance",');
  const end=source.indexOf('\n\tapp.whenReady()',start);
  const calls=[];let handler;
  vm.runInNewContext(source.slice(start,end),{app:{on(_event,callback){handler=callback;}},
    mainWindow:{isMinimized:()=>true,restore:()=>calls.push('restore'),show:()=>calls.push('show'),focus:()=>calls.push('focus'),webContents:{send:()=>calls.push('renderer')}},
    applyShieldWindowMode:()=>calls.push('resize')});
  handler({},['exe','--minimized']);assert.deepEqual(calls,[]);
  handler({},['exe']);assert.deepEqual(calls,['resize','renderer','restore','show','focus']);
});

test('signed update floor blocks an unsupported source version before installation',async()=>{
  const {DesktopUpdater}=loadRecovered('electron/ipc/desktop-updater',{
    compareLooseVersions:(a,b)=>Number(a.split('.').at(-1))-Number(b.split('.').at(-1)),
    getNetworkErrorDetails:()=>({kind:'unknown'})},['DesktopUpdater']);
  const updater=new DesktopUpdater({currentVersion:'3.7.7'});
  updater.resolveTrustedCandidate=async()=>({candidate:{version:'3.7.9',minimumAppVersion:'3.7.8'},warnings:[]});
  updater.enforceAntiRollback=async()=>{};
  const result=await updater.checkInternal();
  assert.equal(result.phase,'blocked');assert.equal(result.failureCode,'migration-required');assert.equal(result.retryable,false);
});
