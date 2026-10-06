import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {loadRecovered,sourceFor} from './load-recovered.mjs';
import {extractTopLevelFunction} from './renderer-fixture-helper.mjs';

// Only production StateStore/main functions execute, with memory-only files and
// inert OS adapters. A pending installation read exposes the activation boundary.
const main=sourceFor('electron/main');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const files=new Map(), events=[],metadata=deferred();
  let denied=false,metadataStarted=false,loadSettled=false;
  const base=path.resolve('MemoryOnlyActivationReview','Egoist Lagom'), installation=path.join(base,'installation.json');
  const missing=()=>Object.assign(new Error('Missing virtual file'),{code:'ENOENT'});
  const promises={
    async readFile(file,encoding){
      if(file===installation){metadataStarted=true;return metadata.promise;}
      if(denied&&(file.endsWith('egoistshield-state.json')||file.endsWith('egoistshield-state.json.bak')))throw Object.assign(new Error('Virtual ACL denial'),{code:'EACCES'});
      if(!files.has(file))throw missing();const bytes=Buffer.from(files.get(file));return encoding==='utf8'?bytes.toString('utf8'):bytes;
    },
    async mkdir(){},async writeFile(file,value){files.set(file,Buffer.from(value));},
    async open(file,flags){if(flags==='r')return {async sync(){},async close(){}};return {async writeFile(value){files.set(file,Buffer.from(value));},async sync(){},async close(){}};},
    async rename(from,to){if(!files.has(from))throw missing();files.set(to,files.get(from));files.delete(from);},async rm(file){files.delete(file);}
  };
  const {StateStore,DEFAULT_STATE}=loadRecovered('electron/ipc/state-store',{path,promises,randomUUID,process,
    logger:{info(){},warn(){},error(){}},normalizePersistedDisplayText:value=>value,normalizeCustomDnsUrl:value=>value||'',normalizeSystemDohUrl:value=>value||'',normalizeSystemDohLocalAddress:value=>value||''},['StateStore','DEFAULT_STATE']);
  const store=new StateStore(base,installation);
  const saved={...structuredClone(DEFAULT_STATE),stateRevision:9,legacyMigrationVersion:1,nodes:[{id:'saved',protocol:'vless',server:'private.example',port:443}],activeNodeId:'saved',settings:{...DEFAULT_STATE.settings,autoStart:true,autoConnect:true,systemDohEnabled:true,systemDohUrl:'https://private.example/dns-query'}};
  const original=Buffer.from(JSON.stringify(saved));files.set(store.filePath,original);files.set(store.backupPath,Buffer.from(original));
  const event=(name,detail=null)=>events.push({name,detail,metadataStarted,loadSettled,storageWritable:store.getSnapshot().storage.writable});
  return {store,files,events,original,installation,event,deny(){denied=true;},permit(){denied=false;},
    run(){return store.retryLoad().finally(()=>{loadSettled=true});},
    async held(){for(let n=0;n<25&&!metadataStarted;n++)await turn();assert.equal(metadataStarted,true,'Pending fault reached actual installation metadata read');for(let n=0;n<5;n++)await turn();},
    fail(){metadata.reject(Object.assign(new Error('Virtual installation metadata locked'),{code:'EACCES'}));},
    succeed(){metadata.resolve(JSON.stringify({id:'11111111-1111-4111-8111-111111111111'}));},
    get loadSettled(){return loadSettled;}}
}
function mountActualRecoveryObserver(f) {
  const context=vm.createContext({globalStateStore:f.store,stateStore:f.store,productionRuntime:true,
    mainWindow:{webContents:{send:(_channel,storage)=>f.event('storage-event',{status:storage.status,sequence:storage.sequence})},isDestroyed:()=>false},isQuitting:false,
    pendingBootRecovery:new Set(),reconnectSupervisor:{generation:7},autoUpdateEnabled:false,autoUpdatePreferenceGeneration:0,backgroundUpdateInFlight:false,updateCheckInterval:null,
    app:{isPackaged:true},logger:{info(){},warn(){},error(){}},Promise,clearTimeout,
    syncWindowsLoginItemSettings:async({settings})=>f.event('login-settings',{autoStart:settings.autoStart}),cleanupOwnedLegacyWindowsStartupTasks:async()=>{f.event('startup-cleanup');return[];},applyLoggerSettings:()=>f.event('logger-settings'),scheduleNextUpdateCheck:()=>f.event('auto-update-scheduled'),stopDnsWatchdog:()=>f.event('watchdog-stop'),startDnsWatchdog:()=>f.event('watchdog-start'),
    globalNetworkCombinatorManager:{runCoordinatedMutation:async(_intent,operation)=>operation()},isGravitylessLoopbackDnsRequest:()=>false,
    globalSystemDohManager:{recover:async()=>{f.event('dns-recover');return{verified:true};}},globalGravitylessDnsManager:null,restoreDnsIfLocalResolverIsDown:async()=>f.event('dns-restore'),scheduleAutoConnectWhenNetworkReady:()=>f.event('auto-connect-scheduled')
  });
  for(const name of ['stateStorageReady','assertStateStorageForMutation','applyConfirmedStartupPreferences','recoverBackgroundFeaturesAfterRendererLoad']) {
    const body=extractTopLevelFunction(main,name);vm.runInContext((main.includes('async function '+name+'(')?'async ':'')+body,context);
  }
  const start=main.indexOf('\tstateStore.onStorageChange = storage => {'),end=main.indexOf('\n\tlogger.info(`[updater]',start);
  assert.ok(start>=0&&end>start,'Actual recovery observer is present');
  vm.runInContext('let storageWasWritable=false;let storageActivationReady=true;\n'+main.slice(start,end),context);
  return context;
}
const nativeEvents=events=>events.filter(value=>['login-settings','startup-cleanup','auto-update-scheduled','dns-recover','dns-restore','auto-connect-scheduled','watchdog-start'].includes(value.name));

test('confirmed data remain readable but public storage remains readonly until activation settles',async()=>{
  const f=fixture(),pending=f.run();
  try {await f.held();const current=f.store.getSnapshot();assert.equal(current.state.nodes[0].id,'saved');assert.equal(current.storage.writable,false,'A valid primary alone cannot admit mutations while activation is pending');}
  finally {f.fail();await pending;}
});

test('recovered observer cannot start login, update, DNS or reconnect before failed activation settles',async()=>{
  const f=fixture();f.deny();await f.store.load();f.permit();mountActualRecoveryObserver(f);const pending=f.run();
  try {await f.held();assert.equal(f.loadSettled,false);assert.deepEqual(nativeEvents(f.events),[],'Actual recovered observer must wait for the full load transaction');}
  finally {f.fail();await pending;}
  for(let n=0;n<5;n++)await turn();
  assert.equal(f.store.getSnapshot().storage.writable,false);assert.deepEqual(nativeEvents(f.events),[]);assert.deepEqual(f.files.get(f.store.filePath),f.original);
});

test('queued public patch and native admission cannot pass a pending activation failure',async()=>{
  const f=fixture(),pending=f.run();await f.held();let effects=0;
  const patch=f.store.patchSettings({notifications:false},undefined,{beforeCommit:async()=>{effects++;}});
  const admission=f.store.checkStorageWritable().then(()=>({ok:true}),error=>({ok:false,code:error.code}));
  try {for(let n=0;n<5;n++)await turn();assert.equal(effects,0,'An external write must queue behind activation, not interleave with it');}
  finally {f.fail();await pending;}
  const [result,accepted]=await Promise.all([patch,admission]);
  assert.equal(result.ok,false);assert.equal(result.error,'STATE_STORAGE_UNAVAILABLE');assert.equal(accepted.ok,false);assert.equal(accepted.code,'STATE_STORAGE_UNAVAILABLE');assert.equal(effects,0);
  assert.deepEqual(f.files.get(f.store.filePath),f.original);assert.deepEqual(f.files.get(f.store.backupPath),f.original);assert.equal(f.store.get().nodes[0].id,'saved');
});

test('successful activation commits its internal defaults before public writes without deadlock', {timeout:2000},async()=>{
  const f=fixture(),pending=f.run();await f.held();let effects=0;
  const patch=f.store.patchSettings({notifications:false},undefined,{beforeCommit:async()=>{effects++;}});
  f.succeed();const [snapshot,result]=await Promise.all([pending,patch]);
  assert.equal(snapshot.storage.writable,true);assert.equal(result.ok,true);assert.equal(effects,1);assert.equal(result.state.settings.autoStart,false);assert.equal(result.state.settings.autoConnect,false);assert.equal(result.state.settings.notifications,false);assert.equal(result.state.nodes[0].id,'saved');
  const persisted=JSON.parse(f.files.get(f.store.filePath).toString('utf8'));assert.equal(persisted.stateRevision,result.state.stateRevision);assert.equal(persisted.settings.notifications,false);
});


test('successful recovery publishes readiness once and dispatches the actual observer once', {timeout:2000},async()=>{
  const f=fixture();f.deny();await f.store.load();f.permit();mountActualRecoveryObserver(f);
  const runs=[f.run(),f.run(),f.run()];await f.held();assert.deepEqual(nativeEvents(f.events),[]);
  f.succeed();const snapshots=await Promise.all(runs);
  for(let n=0;n<25;n++)await turn();
  assert.ok(snapshots.every(value=>value.storage.writable===true));
  assert.equal(f.events.filter(value=>value.name==='storage-event'&&value.detail.status==='ready').length,1,'Coalesced loads produce one public ready transition');
  for(const name of ['login-settings','startup-cleanup','auto-update-scheduled','dns-recover','dns-restore','watchdog-start'])assert.equal(f.events.filter(value=>value.name===name).length,1,name);
  assert.equal(f.events.filter(value=>value.name==='auto-connect-scheduled').length,0,'Fresh installation activation resets automatic connection intent before recovery');
  assert.equal(f.events.find(value=>value.name==='login-settings').detail.autoStart,false,'Startup receives the activated preferences');
  assert.equal(f.store.get().nodes[0].id,'saved');
});


test('startup recovery reads preferences after queued user mutation and native admission', {timeout:2000},async()=>{
  const f=fixture();f.succeed();await f.run();
  const context=mountActualRecoveryObserver(f);f.store.onStorageChange=undefined;
  const entered=deferred(),release=deferred();
  const userPatch=f.store.patchSettings({autoStart:true},undefined,{beforeCommit:async()=>{f.event('manual-login-settings',{autoStart:true});entered.resolve();await release.promise;}});
  await entered.promise;
  const applying=context.applyConfirmedStartupPreferences(true);
  for(let n=0;n<3;n++)await turn();
  release.resolve();assert.equal((await userPatch).ok,true);await applying;
  const loginSequence=f.events.filter(value=>value.name==='manual-login-settings'||value.name==='login-settings');
  assert.equal(f.store.get().settings.autoStart,true);
  assert.deepEqual(loginSequence.map(value=>value.detail.autoStart),[true,true],'Recovery cannot restore a pre-admission startup preference after the newer confirmed user intent');
});


test('delayed startup OS effect finishes before a newer manual settings commit', {timeout:2000},async()=>{
  const f=fixture();f.succeed();await f.run();
  const context=mountActualRecoveryObserver(f);f.store.onStorageChange=undefined;
  const syncEntered=deferred(),finishSync=deferred();
  context.syncWindowsLoginItemSettings=async({settings})=>{syncEntered.resolve();await finishSync.promise;f.event('startup-login-settings',{autoStart:settings.autoStart});};
  const revisionBefore=f.store.getRevision();
  const applying=context.applyConfirmedStartupPreferences(true);
  await syncEntered.promise;
  const userPatch=f.store.patchSettings({autoStart:true},undefined,{beforeCommit:async()=>{f.event('manual-login-settings',{autoStart:true});}});
  let manualWasDeferred;
  try {for(let n=0;n<5;n++)await turn();manualWasDeferred=!f.events.some(value=>value.name==='manual-login-settings');}
  finally {finishSync.resolve();await applying;}
  assert.equal((await userPatch).ok,true);
  assert.equal(manualWasDeferred,true,'Startup native effect and storage admission must occupy the same queue entry');
  const loginSequence=f.events.filter(value=>value.name==='manual-login-settings'||value.name==='startup-login-settings');
  assert.deepEqual(loginSequence.map(value=>value.detail.autoStart),[false,true],'Newer manual intent must be the last actual OS effect');
  assert.equal(f.store.get().settings.autoStart,true);
  assert.equal(f.store.getRevision(),revisionBefore+1,'A readiness-owned OS effect must not manufacture a persisted state revision');
});
