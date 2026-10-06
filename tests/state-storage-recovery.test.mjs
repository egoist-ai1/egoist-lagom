import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadRecovered } from './load-recovered.mjs';

// Run the real StateStore with a deterministic filesystem, never the user's profile.
function fixture() {
  const files = new Map(), faults = new Map(), writes = [];
  const fail = (operation, file) => {
    const code = faults.get(operation + ':' + file) ?? faults.get(operation + ':*');
    if (code) throw Object.assign(new Error(code), { code });
  };
  const fs = {
    async readFile(file) { fail('read', file); if (!files.has(file)) throw Object.assign(new Error('missing'), {code:'ENOENT'}); return files.get(file); },
    async mkdir() {},
    async copyFile(from, to) { fail('copy', to); writes.push(['copy', from, to]); files.set(to, await this.readFile(from)); },
    async writeFile(file, value) { fail('write', file); files.set(file, value); writes.push(['write', file]); },
    async open(file, flags) {
      fail('open', file);
      return { async writeFile(value) { fail('write', file); files.set(file, value); writes.push(['write',file]); }, async sync() {}, async close() {} };
    },
    async rename(from, to) { fail('rename', to); files.set(to, files.get(from)); files.delete(from); writes.push(['rename',from,to]); },
    async rm(file) { files.delete(file); },
  };
  const {StateStore, DEFAULT_STATE} = loadRecovered('electron/ipc/state-store', {
    promises: fs, path, process, randomUUID, logger:{info(){},warn(){},error(){}},
    normalizePersistedDisplayText:s=>s, normalizeCustomDnsUrl:v=>v||'',
    normalizeSystemDohUrl:v=>v||'', normalizeSystemDohLocalAddress:v=>v||'',
  }, ['StateStore','DEFAULT_STATE']);
  const directory = path.resolve('InertStateFixture', 'Egoist Lagom');
  const create = () => new StateStore(directory);
  const store = create();
  const saved = {...structuredClone(DEFAULT_STATE), stateRevision:9,
    nodes:[{id:'saved',server:'private.example',port:443,protocol:'vless'}],
    subscriptions:[{id:'sub',url:'https://subscription.example/private'}], activeNodeId:'saved'};
  const legacy = path.join(path.dirname(directory),'EgoistShield','egoistshield-state.json');
  return {files,faults,writes,store,saved,legacy,create};
}
function snapshot(store) { return store.getSnapshot(); }

test('temporary access failure cannot erase primary or backup through settings or side effects', async () => {
  const f=fixture(), bytes=JSON.stringify(f.saved); let effects=0;
  f.files.set(f.store.filePath,bytes); f.files.set(f.store.backupPath,bytes);
  f.faults.set('read:'+f.store.filePath,'EACCES'); f.faults.set('read:'+f.store.backupPath,'EACCES');
  await f.store.load();
  f.faults.clear();
  const result=await f.store.patchSettings({notifications:false},undefined,{beforeCommit:async()=>{effects++;}});
  assert.equal(result.ok,false); assert.equal(result.error,'STATE_STORAGE_UNAVAILABLE');
  assert.equal(effects,0); assert.equal(f.files.get(f.store.filePath),bytes); assert.equal(f.files.get(f.store.backupPath),bytes);
  await f.store.retryLoad();
  assert.equal(snapshot(f.store).storage.writable,true); assert.equal(f.store.get().nodes[0].id,'saved');
});

test('existing valid profile is authoritative even without a migration marker', async () => {
  const f=fixture(); f.files.set(f.store.filePath,JSON.stringify({...f.saved,nodes:[],subscriptions:[],activeNodeId:null}));
  f.files.set(f.legacy,JSON.stringify(f.saved)); await f.store.load();
  assert.equal(f.store.get().nodes.length,0); assert.equal(f.store.get().subscriptions.length,0);
});

test('fresh legacy import is atomic and deletion survives three restarts', async () => {
  const f=fixture(); f.files.set(f.legacy,JSON.stringify(f.saved)); await f.store.load();
  assert.equal(f.store.get().nodes.length,1);
  assert.equal(JSON.parse(f.files.get(f.store.filePath)).legacyMigrationVersion,1);
  await f.store.update(s=>({...s,nodes:[],subscriptions:[],activeNodeId:null}));
  for(let i=0;i<3;i++){const next=f.create();await next.load();assert.equal(next.get().nodes.length,0);assert.equal(next.get().subscriptions.length,0);}
});

test('valid backup remains available when restoration fails and corrupt primary bytes survive', async () => {
  const f=fixture(), corrupt='{truncated-private-profile';
  f.files.set(f.store.filePath,corrupt); f.files.set(f.store.backupPath,JSON.stringify(f.saved));
  f.faults.set('rename:'+f.store.filePath,'EACCES'); await f.store.load();
  assert.equal(f.store.get().nodes[0].id,'saved'); assert.equal(f.store.getRevision(),9);
  assert.equal(snapshot(f.store).storage.writable,false);
  assert.equal(f.files.get(f.store.filePath),corrupt);
  assert.equal(JSON.parse(f.files.get(f.store.backupPath)).nodes[0].id,'saved');
  assert.ok([...f.files].some(([file,raw])=>file.includes('.corrupt-')&&raw===corrupt));
  f.faults.clear(); await f.store.retryLoad(); assert.equal(snapshot(f.store).storage.writable,true);
});

test('both corrupt files stay untouched and mutations return an exact corruption error', async () => {
  const f=fixture(); f.files.set(f.store.filePath,'{bad'); f.files.set(f.store.backupPath,'[bad');
  await f.store.load(); const result=await f.store.patchSettings({autoConnect:true});
  assert.equal(result.error,'STATE_STORAGE_CORRUPT'); assert.equal(snapshot(f.store).state,null);
  assert.equal(f.files.get(f.store.filePath),'{bad'); assert.equal(f.files.get(f.store.backupPath),'[bad'); assert.equal(f.writes.length,0);
});

test('a denied primary is never overwritten from a readable older backup', async () => {
  const f=fixture(); f.files.set(f.store.filePath,JSON.stringify(f.saved)); f.files.set(f.store.backupPath,JSON.stringify({...f.saved,stateRevision:8}));
  f.faults.set('read:'+f.store.filePath,'EACCES'); await f.store.load();
  assert.equal(snapshot(f.store).storage.writable,false); assert.equal(f.writes.length,0);
  f.faults.clear(); await f.store.retryLoad(); assert.equal(f.store.get().nodes[0].id,'saved');
});

test('failure after a confirmed read preserves the last snapshot and blocks beforeCommit', async () => {
  const f=fixture(); f.files.set(f.store.filePath,JSON.stringify(f.saved)); await f.store.load();
  const before=JSON.stringify(f.store.get()); let effects=0;
  f.faults.set('read:'+f.store.filePath,'EACCES');
  const result=await f.store.patchSettings({autoStart:true},undefined,{beforeCommit:async()=>{effects++;}});
  assert.equal(result.error,'STATE_STORAGE_UNAVAILABLE'); assert.equal(effects,0);
  assert.equal(JSON.stringify(f.store.get()),before); assert.equal(snapshot(f.store).state.nodes[0].id,'saved');
});

test('failed fresh migration does not leave an empty committed profile', async () => {
  const f=fixture(); f.files.set(f.legacy,JSON.stringify(f.saved)); f.faults.set('rename:'+f.store.filePath,'ENOSPC');
  await f.store.load(); assert.equal(f.files.has(f.store.filePath),false); assert.equal(snapshot(f.store).storage.writable,false);
  f.faults.clear(); await f.store.retryLoad(); assert.equal(f.store.get().nodes[0].id,'saved');
});

test('unreadable legacy source prevents creating defaults until absence or data is confirmed', async () => {
  const f=fixture(); f.files.set(f.legacy,JSON.stringify(f.saved)); f.faults.set('read:'+f.legacy,'EACCES');
  await f.store.load(); assert.equal(f.files.has(f.store.filePath),false); assert.equal(snapshot(f.store).storage.writable,false);
  f.faults.clear(); await f.store.retryLoad(); assert.equal(f.store.get().nodes[0].id,'saved');
});

test('parallel retries coalesce and a stale mutation cannot replace a recovered revision', async () => {
  const f=fixture(); f.files.set(f.store.filePath,JSON.stringify(f.saved)); await f.store.load();
  const revision=f.store.getRevision(); f.faults.set('read:'+f.store.filePath,'EACCES'); await f.store.retryLoad(); f.faults.clear();
  const a=f.store.retryLoad(),b=f.store.retryLoad(); await Promise.all([a,b]);
  const current=f.store.getRevision();
  const results=await Promise.all([f.store.patchSettings({notifications:false},current),f.store.patchSettings({autoStart:true},current)]);
  assert.equal(results.filter(r=>r.ok).length,1); assert.equal(results.filter(r=>r.conflict).length,1);
  assert.ok(f.store.getRevision()>=revision);
});

test('external revision change produces a conflict instead of lost profiles', async () => {
  const f=fixture(); f.files.set(f.store.filePath,JSON.stringify(f.saved)); await f.store.load();
  const revision=f.store.getRevision();
  f.files.set(f.store.filePath,JSON.stringify({...f.store.get(),stateRevision:revision+1,nodes:[...f.saved.nodes,{id:'other'}]}));
  const result=await f.store.patchSettings({notifications:false},revision);
  assert.equal(result.error,'STATE_REVISION_CONFLICT'); assert.equal(result.conflict,true);
  assert.equal(JSON.parse(f.files.get(f.store.filePath)).nodes.length,2);
});

test('full state replacement cannot remove the migration marker', async () => {
  const f=fixture(); f.files.set(f.legacy,JSON.stringify(f.saved)); await f.store.load();
  const next=f.store.get(); delete next.legacyMigrationVersion; await f.store.set(next);
  assert.equal(JSON.parse(f.files.get(f.store.filePath)).legacyMigrationVersion,1);
});
test('native admission detects a readable profile with denied writes without replacing data', async () => {
  const f=fixture(); f.files.set(f.store.filePath,JSON.stringify({...f.saved,legacyMigrationVersion:1}));await f.store.load();
  const primary=f.files.get(f.store.filePath),revision=f.store.getRevision();let effects=0;
  f.faults.set('open:*','EACCES');
  await assert.rejects(async()=>{await f.store.checkStorageWritable();effects++;}, {code:'STATE_STORAGE_UNAVAILABLE'});
  assert.equal(effects,0);assert.equal(f.store.getRevision(),revision);assert.equal(f.files.get(f.store.filePath),primary);
  assert.equal(f.store.getSnapshot().storage.writable,false);assert.equal(f.store.getSnapshot().storage.systemCode,'EACCES');
  f.faults.clear();await f.store.retryLoad();await f.store.checkStorageWritable();
  assert.equal(f.files.get(f.store.filePath),primary);assert.equal([...f.files.keys()].some(file=>file.endsWith('.tmp')),false);
});
