import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const calls = [];
  const context = vm.createContext({
    componentOperations: () => Object.fromEntries(['SystemDoH', 'Zapret', 'TelegramProxy'].map(name => [name, {status: {}, listProfiles: {}, tailLogs: {}, cancelAutoSelect: {}}])),
    COMPONENT_QUERIES: new Set(['status', 'tailLogs', 'cancelAutoSelect']),
  });
  vm.runInContext(fs.readFileSync('src/component-facade.js', 'utf8') + '\nglobalThis.wrap = useComponentService;', context);
  const core = {request(operation, payload) {
    const deferred = Promise.withResolvers();
    calls.push({operation, payload, ...deferred});
    return deferred.promise;
  }};
  const managers = Object.fromEntries(['SystemDoH', 'Zapret', 'TelegramProxy'].map(name => [name, context.wrap({}, name, core)]));
  return {calls, ...managers};
}

test('one renderer refresh shares pending component statuses before opening Core pipes', async () => {
  const f = fixture();
  const promises = [f.SystemDoH.status(), f.SystemDoH.status(), f.Zapret.status(), f.Zapret.listProfiles(), f.TelegramProxy.status()];
  for (let reader = 0; reader < 2; reader++) promises.push(f.SystemDoH.status(), f.Zapret.status(), f.TelegramProxy.status());
  promises.push(f.TelegramProxy.tailLogs(80));
  assert.equal(f.calls.length, 5, 'dashboard, network and health must not consume separate pipes for the same pending status');
  for (const call of f.calls) call.resolve({running: false});
  await Promise.all(promises);
  const next = f.SystemDoH.status();
  assert.equal(f.calls.length, 6, 'settled status must not become a stale cache');
  f.calls.at(-1).resolve({running: true});
  assert.equal((await next).running, true);
});

test('failed status can be retried and forced reads keep their own request', async () => {
  const f = fixture();
  const first = f.TelegramProxy.status();
  const duplicate = f.TelegramProxy.status();
  const forced = f.TelegramProxy.status({force: true});
  assert.equal(f.calls.length, 2);
  const results = Promise.allSettled([first, duplicate, forced]);
  f.calls[0].reject(new Error('Core unavailable'));
  f.calls[1].resolve({running: false});
  assert.deepEqual((await results).map(value => value.status), ['rejected', 'rejected', 'fulfilled']);
  const retry = f.TelegramProxy.status();
  assert.equal(f.calls.length, 3);
  f.calls[2].resolve({running: true});
  await retry;
});

test('distinct status arguments and cancellation calls are never collapsed', async () => {
  const f = fixture();
  const promises = [f.Zapret.status(), f.Zapret.status({force: false}), f.Zapret.cancelAutoSelect(), f.Zapret.cancelAutoSelect()];
  assert.equal(f.calls.length, 4);
  for (const call of f.calls) call.resolve(null);
  await Promise.all(promises);
});

test('packaged DoH reconfiguration avoids a redundant restore while stop restores DNS once', async () => {
  const calls=[];
  const context=vm.createContext({componentOperations:()=>({SystemDoH:{apply:{},stopAndRemove:{}}}),COMPONENT_QUERIES:new Set()});
  vm.runInContext(fs.readFileSync('src/component-facade.js','utf8')+'\nglobalThis.wrap=useComponentService;',context);
  let pending=0;
  const core={restoreOwnedDns:async()=>{calls.push('restore');return {pendingAdapters:pending}},request:async(_operation,payload)=>{calls.push(payload.method);return {running:true}}};
  const manager=context.wrap({},'SystemDoH',core);
  await manager.apply('https://resolver.example/dns-query');
  await manager.stopAndRemove();
  assert.deepEqual(calls,['apply','restore','stopAndRemove']);
  calls.length=0;pending=1;
  await assert.rejects(manager.stopAndRemove(),/адаптер/);
  assert.deepEqual(calls,['restore']);
});
