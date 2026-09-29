import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import vm from 'node:vm';

const widget = await fs.readFile(new URL('../src/brand/ShieldWidget.jsx', import.meta.url), 'utf8');
const readiness = vm.runInNewContext(widget.slice(0, widget.indexOf('function ShieldWidget(')) + '\n({telegram:rubyTelegramReady,zapret:rubyZapretReady,dns:rubyDnsReady})');

test('UI rejects running SCM wrappers when the actual runtime is unavailable', () => {
  assert.equal(readiness.telegram({ serviceRunning:true, running:true, runtimeReady:false, listenerReady:false }), false);
  assert.equal(readiness.telegram({ serviceRunning:true, running:true, listenerReady:false }), false);
  assert.equal(readiness.zapret({ serviceRunning:true, standaloneRunning:true, runtimeReady:false }), false);
  assert.equal(readiness.zapret({ serviceRunning:true, serviceReady:false, runtimeReady:false }), false);
});

test('UI accepts confirmed runtime readiness and preserves older status compatibility', () => {
  assert.equal(readiness.telegram({ runtimeReady:true, listenerReady:true }), true);
  assert.equal(readiness.telegram({ running:true }), true);
  assert.equal(readiness.telegram({ serviceRunning:true }), true);
  assert.equal(readiness.telegram(null), false);
  assert.equal(readiness.zapret({ runtimeReady:true, serviceRunning:false }), true);
  assert.equal(readiness.zapret({ standaloneRunning:true }), true);
  assert.equal(readiness.zapret(null), false);
});

test('UI distinguishes a running DNS worker from failed DNS verification', () => {
  assert.equal(readiness.dns({ running:true, verified:false }), false);
  assert.equal(readiness.dns({ running:true, verified:true }), true);
  assert.equal(readiness.dns({ running:true }), true);
  assert.equal(readiness.dns({ running:false, verified:true }), false);
});

test('stopping Telegram requires its background service to stop, even without a listener', async () => {
  const start = widget.indexOf('  async function toggleTelegram()');
  const end = widget.indexOf('  async function cancel()', start);
  const calls = [];
  let actionError;
  const toggle = vm.runInNewContext('(' + widget.slice(start, end).trim() + ')', {
    begin: () => true, running:true, telegramRunning:true, telegramEnabled:true,
    api:{telegramProxy:{stop: async () => ({ok:true, running:false, runtimeReady:false, listenerReady:false, serviceRunning:true})}},
    Z: (_name, method) => method(), rubyTelegramReady:readiness.telegram,
    refreshNow: async () => {calls.push('refresh');return {telegramRunning:false}},
    mounted:{current:true}, setActionError: value => {actionError=value},
    setTelegramEnabled: () => calls.push('preference'), localStorage:{setItem: () => calls.push('persist')},
    finish: () => calls.push('finish')
  });
  await toggle();
  assert.equal(actionError, 'Не удалось изменить Telegram Proxy');
  assert.deepEqual(calls, ['finish'], 'A live service wrapper must not save a false stopped preference');
});

test('preload preserves successful update result payload and removes the listener', async () => {
  const source = await fs.readFile(new URL('../src/recovered/preload.cjs', import.meta.url), 'utf8');
  const ipcRenderer = new EventEmitter();
  let api;
  vm.runInNewContext(source, {require: name => {
    assert.equal(name, 'electron');
    return {ipcRenderer, contextBridge:{exposeInMainWorld: (name, value) => {assert.equal(name, 'egoistAPI');api=value;}}};
  }});
  const payload = { ok:true, phase:'up-to-date', latestVersion:'3.7.8', message:'Release is current' };
  let received;
  const unsubscribe = api.updater.onUpdateNotAvailable(result => {received=result});
  ipcRenderer.emit('update-not-available', {}, payload);
  assert.equal(received, payload);
  assert.equal(ipcRenderer.listenerCount('update-not-available'), 1);
  unsubscribe();
  assert.equal(ipcRenderer.listenerCount('update-not-available'), 0);
});
