import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { loadRecovered } from './load-recovered.mjs';

const login = loadRecovered('electron/ipc/login-item-settings', { path, promisify, execFile, process },
  ['buildWindowsLoginItemSettings', 'syncWindowsLoginItemSettings']);
const executablePath = 'C:\\Program Files\\EgoistShield\\EgoistShield.exe';
function fixture() {
  const calls = [], runWrites = [];
  let enabled = false, legacy = false;
  const app = { isPackaged: true, getLoginItemSettings: () => ({ openAtLogin: legacy }),
    setLoginItemSettings: value => { runWrites.push(value); legacy = value.openAtLogin; } };
  const execute = async (_exe, args, options) => {
    calls.push({ args: Array.from(args), options });
    enabled = args[args.indexOf('-Enabled') + 1] === 'true';
    return { stdout: JSON.stringify({ schemaVersion: 1, owner: 'EgoistShield', purpose: 'gui-login-startup', enabled, verified: true, suspended: false }) };
  };
  return { app, execute, calls, runWrites, get enabled() { return enabled; }, legacy(value) { legacy = value; } };
}
function sync(f, settings, previousSettings) { return login.syncWindowsLoginItemSettings({ ...f, settings, previousSettings, executablePath, platform: 'win32' }); }
function actualHooks(f) {
  const source = fs.readFileSync('src/recovered/electron/ipc/handlers-system.js', 'utf8');
  const start = source.indexOf('\tlet startupSideEffectAttempted = false;');
  const end = source.indexOf('\tconst patchSettingsWithLoginItemSync', start);
  assert.ok(start >= 0 && end > start, 'actual settings transaction hooks must be present');
  return vm.runInNewContext(source.slice(start, end) + '\nsettingsCommitHooks;', { app: f.app,
    syncWindowsLoginItemSettings: options => login.syncWindowsLoginItemSettings({ ...options, execute: f.execute, executablePath, platform: 'win32' }) });
}

test('Windows GUI startup follows only explicit autoStart, independently of autoConnect', () => {
  for (const autoStart of [false, true]) for (const autoConnect of [false, true]) {
    const actual = login.buildWindowsLoginItemSettings({ autoStart, autoConnect }, executablePath);
    assert.equal(actual.openAtLogin, autoStart);
    assert.deepEqual(Array.from(actual.args), ['--background', '--minimized']);
  }
});
test('false preference reconciles removal using authenticated helper readback without Run-key enable', async () => {
  const f = fixture();
  assert.equal(await sync(f, { autoStart: false, autoConnect: true }), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.enabled, false);
  assert.equal(f.runWrites.length, 0);
  assert.ok(f.calls[0].args.includes('Sync'));
  assert.ok(f.calls[0].args.includes('false'));
});
test('true preference uses fixed installed helper and retires the previous Run registration after readback', async () => {
  const f = fixture(); f.legacy(true);
  await sync(f, { autoStart: true });
  assert.equal(f.enabled, true);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].args[f.calls[0].args.indexOf('-File') + 1], /resources[\\/]installer[\\/]gui-login-startup\.ps1$/);
  assert.equal(f.calls[0].options.windowsHide, true);
  assert.equal(f.runWrites.length, 1);
  assert.equal(f.runWrites[0].openAtLogin, false);
});
test('unrelated settings and nonproduction profiles never call the scheduler helper', async () => {
  const f = fixture();
  assert.equal(await sync(f, { autoStart: true, dns: 'new' }, { autoStart: true, dns: 'old' }), false);
  f.app.isPackaged = false;
  assert.equal(await sync(f, { autoStart: true }), false);
  assert.equal(f.calls.length, 0);
  const g = fixture(), hooks = actualHooks(g);
  await hooks.beforeCommit({ settings: { autoStart: false, dns: 'new' } }, { settings: { autoStart: false, dns: 'old' } });
  await hooks.rollback({ settings: { autoStart: false } });
  assert.equal(g.calls.length, 0);
});
test('foreign task rejection and invalid readback never remove the legacy registration', async () => {
  const f = fixture(); f.legacy(true);
  f.execute = async () => { throw new Error('foreign task refused'); };
  await assert.rejects(sync(f, { autoStart: true }), /foreign task refused/);
  assert.equal(f.runWrites.length, 0);
  f.execute = async () => ({ stdout: JSON.stringify({ verified: true, enabled: true }) });
  await assert.rejects(sync(f, { autoStart: true }), /verification failed/);
  assert.equal(f.runWrites.length, 0);
});
test('real StateStore primary commit failure rolls back the task side effect and preserves preference', async t => {
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'lagom-login-state-'));
  t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));
  let deny=false,store;
  const adapter={...fs.promises,async rename(from,to){
    if(deny&&to===store.filePath)throw Object.assign(new Error('disk unavailable'),{code:'ENOSPC'});
    return fs.promises.rename(from,to);
  }};
  const {StateStore}=loadRecovered('electron/ipc/state-store',{promises:adapter,path,process,randomUUID,
    logger:{info(){},warn(){},error(){}},normalizePersistedDisplayText:s=>s,
    normalizeCustomDnsUrl:v=>v||'',normalizeSystemDohUrl:v=>v||'',normalizeSystemDohLocalAddress:v=>v||''},['StateStore']);
  store=new StateStore(root);await store.load();
  const f=fixture(),previous=JSON.stringify(store.get()),revision=store.getRevision();
  deny=true;const result=await store.patchSettings({autoStart:true},revision,actualHooks(f));
  assert.equal(result.ok,false);assert.equal(f.enabled,false);
  assert.deepEqual(f.calls.map(call=>call.args[call.args.indexOf('-Enabled')+1]),['true','false']);
  assert.equal(JSON.stringify(store.get()),previous);assert.equal(store.getRevision(),revision);
  assert.equal(JSON.stringify(JSON.parse(await fs.promises.readFile(store.filePath,'utf8'))),previous);
});
