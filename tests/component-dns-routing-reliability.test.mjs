import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const calls = [];
  let local = { serviceState: 'not-installed', serviceInstalled: false, serviceRunning: false, currentUrl: null };
  let native = { supported: true, enabled: false, verified: false, url: null, servers: [] };
  let nativeError = null;
  const context = vm.createContext({ URL,
    componentOperations: () => ({ SystemDoH: Object.fromEntries(['status', 'apply', 'recover', 'restart', 'stop', 'stopAndRemove'].map(method => [method, {}])) }),
    COMPONENT_QUERIES: new Set(['status']),
  });
  vm.runInContext(fs.readFileSync('src/component-facade.js', 'utf8') + '\nglobalThis.wrap=useComponentService;', context);
  const core = {
    request: async (_operation, payload) => { calls.push(`worker:${payload.method}`); return local; },
    nativeDohStatus: async () => { calls.push('native:status'); if (nativeError) throw nativeError; return native; },
    restoreOwnedDns: async () => { calls.push('restore'); return { pendingAdapters: 0 }; },
    removeNativeDoh: async () => { calls.push('native:remove'); native = { ...native, enabled: false }; return native; },
  };
  const manager = {
    mapNativeStatus: state => ({ ...state, nativeManaged: true, currentUrl: state.url }),
    async apply(url) {
      const current = await this.status({ force: true });
      if (current.enabled && new URL(url).port && new URL(url).port !== '443') throw new Error('unsafe custom port transfer');
      calls.push('native:apply'); native = { ...native, enabled: true, verified: true, url };
      return this.mapNativeStatus(native);
    },
  };
  const result = { manager: context.wrap(manager, 'SystemDoH', core), calls,
    setLocal: value => { local = { ...local, ...value }; },
    setNative: value => { native = { ...native, ...value }; } };
  result.setNativeError = value => { nativeError = value; };
  return result;
}

test('desktop facade reaches native DoH when capability is explicit and local state is absent', async () => {
  const f = fixture();
  const result = await f.manager.apply('https://resolver.example/dns-query');
  assert.equal(result.nativeManaged, true);
  assert.equal(result.currentUrl, 'https://resolver.example/dns-query');
  assert.equal(f.calls.filter(call => call === 'native:apply').length, 1);
  assert.equal(f.calls.includes('worker:apply'), false);
  assert.equal(f.calls.includes('restore'), false);
  await f.manager.stopAndRemove();
  assert.equal(f.calls.filter(call => call === 'native:remove').length, 1);
  assert.equal(f.calls.includes('worker:stopAndRemove'), false);
});

test('running and stopped saved local configurations retain their worker mode', async () => {
  for (const serviceRunning of [true, false]) {
    const f = fixture();
    f.setLocal({ serviceState: serviceRunning ? 'running' : 'stopped', currentUrl: 'https://local.example/dns-query', serviceInstalled: true, serviceRunning });
    await f.manager.apply('https://local.example/dns-query');
    assert.equal(f.calls.includes('worker:apply'), true);
    assert.equal(f.calls.includes('native:apply'), false);
    await f.manager.stop();
    assert.ok(f.calls.indexOf('restore') < f.calls.indexOf('worker:stop'));
  }
});

test('custom-port and unsupported new configurations use the authenticated worker', async () => {
  const custom = fixture();
  await custom.manager.apply('https://resolver.example:8443/dns-query');
  assert.equal(custom.calls.includes('worker:apply'), true);
  assert.equal(custom.calls.includes('native:apply'), false);
  const unsupported = fixture();
  unsupported.setNative({ supported: false });
  await unsupported.manager.apply('https://resolver.example/dns-query');
  assert.equal(unsupported.calls.includes('worker:apply'), true);
});

test('unknown local state and conflicting managed modes refuse mutations', async () => {
  const unknown = fixture();
  unknown.setLocal({ serviceState: 'unknown' });
  assert.equal((await unknown.manager.status()).serviceState, 'unknown');
  await assert.rejects(unknown.manager.stopAndRemove(), /конфигурация сохранена/);
  assert.equal(unknown.calls.some(call => ['native:apply', 'native:remove', 'restore', 'worker:stopAndRemove'].includes(call)), false);
  const conflict = fixture();
  conflict.setLocal({ currentUrl: 'https://local.example/dns-query' });
  conflict.setNative({ enabled: true });
  await assert.rejects(conflict.manager.apply('https://resolver.example/dns-query'), /два управляемых режима/);
});

test('active native custom-port transfer preserves DNS', async () => {
  const f = fixture();
  f.setNative({ enabled: true, url: 'https://native.example/dns-query' });
  await assert.rejects(f.manager.apply('https://resolver.example:8443/dns-query'), /unsafe custom port transfer/);
  assert.equal(f.calls.includes('native:remove'), false);
  assert.equal(f.calls.includes('restore'), false);
});

test('local status survives native inspection failure while mutations stay blocked', async () => {
  const f = fixture();
  f.setLocal({ currentUrl: 'https://local.example/dns-query', serviceInstalled: true, serviceRunning: true, running: true });
  f.setNativeError(new Error('native inspection failed'));
  const status = await f.manager.status();
  assert.equal(status.running, true);
  assert.equal(status.nativeStatusUnavailable, true);
  await assert.rejects(f.manager.stopAndRemove(), /native inspection failed/);
  assert.equal(f.calls.includes('restore'), false);
});

test('concurrent native and custom-port selections inspect state in mutation order', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.manager.apply('https://native.example/dns-query'),
    f.manager.apply('https://local.example:8443/dns-query'),
  ]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal(f.calls.filter(call => call === 'native:apply').length, 1);
  assert.equal(f.calls.includes('worker:apply'), false);
});
